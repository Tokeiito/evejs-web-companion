# Deploying the companion to the dedicated server

Production runs on **hive** under Portainer, alongside the EveJS stack it talks
to. Development stays on this machine. Nothing on hive is ever edited by hand; a
release is a tag here and a poll there.

This is the *instance*. The pattern is `doc/DEPLOYMENT_PLAYBOOK.md` in the evej
repo, and `Tokeiito/evej` is the worked reference. What follows is only what is
different here, plus the three things that are genuinely harder for this repo
than for evej.

## The three hard parts, up front

The companion is not a self-contained service, and two of its everyday
operations are host-shell operations. Those facts shape everything below.

1. **It cannot start itself.** The BFF is useless without EveJS's
   `/_evejs-web/v1` gateway. On hive that means joining the evej stack's network
   and mounting its volume, both as external resources this stack never owns.
   Bring evej up first.
2. **The gateway token is the deploy.** The gateway grants token-less access
   only to peers at `127.0.0.1`/`::1`. Container to container, the request
   arrives from a bridge address and is refused. A shared secret must therefore
   be set on **both** stacks, and it must not be committed.
3. **There is no way to create a web user.** `npm run webpass` needs a shell.
   hive has none, and Portainer has no equivalent of `docker compose run`.

## The shape

```
  you --tag release/*--> Gitea Actions --push--> Gitea registry
                              |
                              +--commit--> deploy/prod --poll--> Portainer --> hive
```

### Which remote, and why both

This repo develops on GitHub and releases from Gitea. That is two remotes doing
two jobs, not a mirror kept in sync for its own sake.

| Remote | URL | Carries |
| --- | --- | --- |
| `origin` | `github.com/rrfarmer/evejs-web-companion` | upstream. Fetch only |
| `fork` | `github.com/Tokeiito/evejs-web-companion` | the personal fork: `tokeiito` and the patch branches |
| `hive` | `git.airplane-rooster.ts.net:3000/Tokeiito/evejs-web-companion` | `tokeiito`, the `release/*` tags, and `deploy/prod` |

The playbook leaves open whether the Gitea remote could carry `deploy/prod`
alone. It cannot: the release workflow *builds the image from the tagged tree*,
so the code and the tag have to be on Gitea for Actions to see them. The registry,
the runner and the package-prune API are all Gitea's as well. GitHub stays the
development remote because that is where upstream is.

### Branch roles

| Branch | Role | Rewritten |
| --- | --- | --- |
| `master` | tracks `origin`. Never committed on | by upstream |
| `tokeiito` | integration: every merged patch branch. **Release tags come from here** | possibly, as upstream moves |
| `feat/*` `fix/*` `patch/*` | one work stream each, branched from `tokeiito`, merged back `--no-ff` | yes |
| `deploy/prod` | orphan branch: `compose.yaml` plus `stack.env`. What production actually runs | **never** |

Note that `master` is *not* the integration branch here, so the playbook's
"tag `main`" becomes "tag `tokeiito`". Tagging `master` would release upstream
without a single local patch in it.

## Develop to release

1. Branch from `tokeiito`, merge back with `--no-ff`, push to `fork`.
2. Prove it locally. A code change needs the image rebuilt; a restart runs the
   old code, and in Docker mode nothing is live until it is rebuilt:
   ```bash
   docker compose up --build --detach
   ```
3. Push the integration branch and the tag to Gitea. The version is the
   `package.json` version plus an incrementing release number, so `v0.1.0-3` is
   the third release built from 0.1.0.
   ```bash
   git push hive tokeiito && git tag release/v0.1.0-3 tokeiito && git push hive release/v0.1.0-3
   ```
   The tag is the only thing that triggers a build. Ordinary pushes do nothing.
4. `.gitea/workflows/release.yaml` then builds the image, pushes it, copies
   `compose.hive.yaml` onto `deploy/prod` as `compose.yaml` with the release tag
   written in as the default of `EVEJS_WEB_IMAGE_TAG`, prunes the registry to the
   newest 5, and reclaims runner disk under `if: always()`.
5. Portainer's poll sees `deploy/prod` move and recreates the stack.

Steps 3-5 are the whole release. There is no step where you touch hive.

Because `public/dist` is excluded from the build context, the image builds the
Vite bundle itself -- so the release is also the typecheck gate. A TS error in
`web/src` fails the build rather than shipping a stale bundle.

## The token is the deploy

`compose.hive.yaml` resolves with no external environment, with one deliberate
exception: `EVEJS_WEB_GATEWAY_TOKEN` defaults to empty, because a shared secret
does not belong in a git branch that Portainer clones.

The consequence is worth stating plainly, because the failure is quiet: **the
stack comes up healthy with no token and every gateway call answers 403.** The
container healthcheck only proves the BFF is serving HTTP -- `/api/health` is the
readiness answer, and that is the one that 500s.

Set it as a **Portainer UI variable** on both stacks, to the same value. UI
variables do substitute; a committed `stack.env` does not (playbook behaviour 1).

- the companion stack: `EVEJS_WEB_GATEWAY_TOKEN`
- the evej stack: `EVEJS_WEB_GATEWAY_TOKEN`, which today defaults to empty in
  `compose.hive.yaml` there -- so **the evej stack needs this change too**, and
  the companion cannot work on hive until it has it.

The alternative is baking the literal into both `deploy/prod` branches as a
default. That keeps the "no external environment" property whole and is no worse
than the rest of what those private branches hold, but it puts a shared secret in
two git histories and makes rotating it a release on both repos. The UI-variable
path is the recommendation; it is the one thing an operator sets by hand.

## The first web user

`webpass` in `compose.hive.yaml` is the answer to hard part 3, on the same shape
as the evej stack's `market-seed`: a one-shot service whose trigger is a
**change, not a state**.

| Situation | What happens |
| --- | --- |
| `EVEJS_WEB_SEED_TOKEN` empty | nothing. Empty is *no opinion*, never *go* |
| Token set to a value never used before | sets that user's password exactly once |
| Same token on any later deploy | nothing |
| Token set but user or password empty | fails loudly rather than half-acting |

To set or reset a password: set `EVEJS_WEB_SEED_TOKEN` (a date works),
`EVEJS_WEB_SEED_USER` and `EVEJS_WEB_SEED_PASSWORD` as Portainer UI variables,
redeploy, then clear all three. The stamp recorded in the data volume is what
makes clearing them safe, and what stops a later release -- which rewrites the
whole compose file from `compose.hive.yaml` and reverts every value to its
default -- from re-running the job. A token value is single-use: reusing an
earlier one matches the stamp and does nothing.

`set-web-password.js` resolves the EveJS account **through the gateway**, so this
job cannot succeed before the evej stack answers and the token matches. It waits
two minutes for that and then fails with a message naming both causes. The stamp
is written only on success, so a failed run retries on the next deploy rather
than going quiet with no password set.

## What lives on hive and is never deployed

Named volumes, not host directories -- hive has no shell to create or populate a
host path, and a bind mount over a missing path yields an empty root-owned
directory this container (`USER node`, uid 1000) cannot use.

| Volume | Mounted at | Owner | Contents |
| --- | --- | --- | --- |
| `evejs-web-data` | `/app/data` | this stack | `web-users.json`, `session-secret.txt`, the bot script store, the bot flight recorders, the icon cache |
| `evejs-data` | `/var/lib/evejs` (ro) | **the evej stack** | the universe. Read here for static gameStore and SDE names only |

`evejs-data` is declared `external` so that `docker compose down --volumes` in
this project can never delete the game database. `evejs-net` is external for the
same class of reason: two compose projects cannot both non-externally own one
named network, and the second to start fails with "found but has incorrect
label".

The local `compose.yaml` bind-mounts `${EVEJS_ROOT:-../eve.js}` for those same
static names. That mount is absent from `compose.hive.yaml` entirely; the paths
point at the volume instead, which is where the overlay already pointed them.

**Confirm on the first deploy** that `/var/lib/evejs/sde/eve-online-static-data-3396210-jsonl`
exists in the volume as the overlay assumes. If evej's image does not ship the
SDE JSONL at that path, static names degrade and the fix is a path, not a rebuild.

## Rollback

```bash
git revert --no-edit HEAD && git push
```

...on a clone of `deploy/prod`. The previous tag is still in the registry -- that
is what `KEEP_RELEASES` buys. The next poll pulls it. Rolling back the *code* is
a separate act: revert on `tokeiito`, then cut a new release.

## One-time setup

None of it needs a shell on hive.

1. **Create the Gitea repository** and add it as the `hive` remote. Push
   `tokeiito`.
2. **Create the Actions secrets**: `REGISTRY_USER`, `REGISTRY_TOKEN`
   (`write:package`), `DEPLOY_TOKEN` (`write:repository`). An unset secret
   interpolates to an empty string rather than failing, which is why the workflow
   opens with a preflight that names any that are missing.
3. **Create `deploy/prod`** as an orphan branch holding `compose.yaml` (a copy of
   `compose.hive.yaml`) and `stack.env` (one line, `EVEJS_WEB_IMAGE_TAG=`).
4. **Cut the first release**, so the registry has an image before Portainer is
   pointed at anything.
5. **Add the registry in Portainer** if it is not already there from evej --
   Registries are global, Stacks are not.
6. **Add the gateway token to the evej stack** as a UI variable, and redeploy it.
   The companion is dead on arrival without this.
7. **Create the Portainer stack** (Stacks -> Add stack -> Repository). Select the
   environment from Home first, or the sidebar shows only the global Edge
   sections. Reference `refs/heads/deploy/prod`, compose path `compose.yaml`
   (Portainer defaults to `compose.yml` and fails with `no such file or
   directory` otherwise), GitOps updates on with polling, and the
   `EVEJS_WEB_GATEWAY_TOKEN` UI variable set.
8. **Set the first web user** through `webpass`, above.

If something added to the branch afterwards appears to be missing, force a pull
before concluding anything about behaviour: Portainer clones when the stack is
created, and a stale clone is indistinguishable from the feature not working.

## What this does not solve

**Exposure is a decision, not a default.** The stack publishes on hive's
tailscale address, matching evej. The companion is a login-gated BFF with a
file-backed user store and a self-generated session secret; it has had no
security review and is no more hardened for a public interface than the emulator
behind it. Tailnet-only is the posture the default encodes, and moving it is a
separate piece of work.

**`evejs-web-data` has no backup story.** It holds every web password, every bot
script anyone has written, and the flight recorders. It is not a deploy target
and nothing here protects it. `docker compose down --volumes` destroys it.

**A release destroys the container log.** Every deploy is a recreate, and a
container's log belongs to the container -- so the deploy that ships the fix also
erases the evidence of the bug. The `max-size`/`max-file` settings bound growth;
they do not survive a recreate. Anything you will want to read afterwards has to
be on the data volume (the bot flight recorders under `/app/data/bot-logs`
already are) or copied out first.
