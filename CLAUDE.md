# EVE.js web companion — maintenance guide

This repo is a **fork of `rrfarmer/evejs-web-companion`**, and it is the companion we actually
run. Upstream is a real git repo with history, and we contribute to it by pull request. The
point of the branch model below is that we **never drift from upstream**: everything we run is
upstream plus a short, named list of patches, and each patch either goes upstream or is
recorded as deliberately ours.

The model is the one `D:\evet` uses (see its `CLAUDE.md`), adapted to an upstream we can fetch
instead of one that arrives as a zip.

## Remotes

| Remote   | URL                                             | Role                                                         |
| -------- | ----------------------------------------------- | ------------------------------------------------------------ |
| `origin` | `git@github.com:rrfarmer/evejs-web-companion.git` | **Upstream.** Fetch only. Never push to it.                  |
| `fork`   | `git@github.com:Tokeiito/evejs-web-companion.git` | Our backup and the source of every upstream PR. Default branch `main`. |

## Branch model

```
origin/master: ──A──B──C─────────D──E──F────────
                       │               │
vendor:        ──A──B──C  (ff)  ──D──E──F
                       │               │
main:                  └─ p1 ─ p2       └─ p1 ─ p2 ─ p3
                             ↑
                    tag custom/<date> before each rebuild
```

| Branch                     | Contents                                                          | Who writes it                    |
| -------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `vendor`                   | Exactly `origin/master`, nothing else                               | `git merge --ff-only origin/master` only |
| `main`                     | `vendor` + one `--no-ff` merge per live patch, in `PATCHES.md` order | `git merge` only                 |
| `fix/*` `feat/*`           | One logical patch each, based on `vendor`, meant for upstream       | You / agents                     |
| `ext/*`                    | Somebody else's patch, carried here. **Never sent upstream**        | Applied here, authored elsewhere |
| `local/*`                  | Permanently ours, never upstreamable: tooling, these docs, deploy   | You / agents                     |

`PATCHES.md` lists every live patch branch in apply order with the reason it is still carried.
It is the recipe `main` is rebuilt from and the checklist for retiring patches.

**Every commit on `main` arrives through a merge.** Never commit to `main` directly: a direct
commit belongs to no branch, so nothing can say where it came from or whether it went upstream,
and the next rebuild has no branch to replay. `git branch --merged main` is the real answer to
"what is on main"; the `On main` column in `PATCHES.md` is a cache of it.

**The health check** is `git diff --stat vendor main`. It should be the `local/*` files plus
whatever is in flight upstream. If it grows into the hundreds of files, we have drifted again.

## Hard rules

1. **Never commit on `vendor`.** No commits, cherry-picks or merges other than
   `--ff-only origin/master`. If a fast-forward is refused, `vendor` was touched: find out how,
   do not force it.
2. **Never merge `vendor` into `main`.** `main` is rebuilt (below). Merging collapses every patch
   into one resolution in which a patch upstream already took never announces itself.
3. **Patch branches are based on `vendor`, never on `main`.** `git diff vendor fix/x` is the
   patch *only* when `vendor` is its base; branch from `main` and the PR drags every other local
   patch along.
4. **`vendor` is never rewritten; `main` and patch branches are**, on every rebuild. Tag first
   (`custom/<date>` for `main`, `archive/<branch>/<date>` for branches), then
   `git push --force-with-lease fork main`.
5. **Never delete a branch `main` is rebuilt from.** Retire a patch by removing its row from
   `PATCHES.md` during a rebuild, recording why.
6. **Keep patches surgical, and never reformat upstream files.** Rebuild pain is proportional to
   how much of the upstream tree a patch touches; a whitespace-only change turns every later
   upstream edit of that file into a conflict.
7. **Local files live on `local/*`.** Hooks, these docs and the deploy pipeline are tracked on
   `local/tooling` / `local/deploy`, never on `vendor`. `.git/info/exclude` (not `.gitignore`,
   which is upstream's file) is for paths that must never be tracked at all.

## Making a change

```bash
git fetch origin && git switch vendor && git merge --ff-only origin/master
git switch -c fix/<area>-<short-description> vendor
# edit, test, commit -- keep committing while testing finds things
git switch main && git merge --no-ff fix/<area>-<short-description>
```

Then add a row to `PATCHES.md` on `local/tooling` (one row per branch) and merge that too. Do
this from a worktree (`git worktree add .claude/worktrees/<name> vendor`) rather than switching
the main checkout to `vendor`: see **Gotchas**.

**A branch is a work stream.** Anything found while testing that breaks the work being done is
a further commit on the same branch. Anything noticed in passing that the work does not depend
on is scope creep: note it as an issue and leave it.

**A shared symbol is a dependency, and dependencies are never split.** If fix B needs a
function, constant or table fix A introduces, A and B are one branch and one PR.

Commit subjects follow the existing history: `fix(companion): ...`, `feat(companion): ...`,
`deploy: ...`, `tooling: ...`.

## Delivering upstream

The patch branch **is** the PR branch:

```bash
git log -1 --format=%B <branch> | grep '^Origin:'   # any output: ext/ work, stop
git diff --stat vendor <branch>                       # the PR, exactly
git push -u fork <branch>
gh pr create --repo rrfarmer/evejs-web-companion --base master --head Tokeiito:<branch>
```

- Rebase onto the latest `vendor` before opening, so the PR applies to what upstream has now.
- One PR per branch. Never a stacked series: upstream merges each PR on its own, and a stack
  that is merged out of order leaves the fork with nothing matching upstream.
- Squash exploration before opening; the reviewer should not walk a route we know was wrong.
- `~/.claude/CLAUDE.md` governs: no AI attribution anywhere, and no real character ids,
  account names or token subjects in the diff, the commits or the PR body. Grep before pushing.
- In the PR body say what was exercised on the running companion, with evidence.

A PR merged upstream comes back through `vendor`. The next rebuild finds the branch already
contained in `vendor` and retires it (below).

## Syncing with upstream (rebuilding `main`)

Do this whenever upstream moves, and always before opening a PR.

```bash
# 1. Freeze what is running now
D=$(date +%F)
git tag custom/$D main
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/fix refs/heads/feat refs/heads/ext refs/heads/local); do
  git tag archive/$b/$D $b
done

# 2. Move vendor
OLD=$(git rev-parse vendor)
git fetch origin
git switch vendor && git merge --ff-only origin/master

# 3. Retire what upstream took
git branch --merged vendor           # a patch branch listed here is fully upstream
```

A branch whose PR was merged is an ancestor of `vendor` and is retired outright: drop its
`PATCHES.md` row, recording the PR, then delete the branch. A patch upstream fixed **their own
way** is not an ancestor, so also read `git diff <old-vendor> vendor -- <files the patch touches>`
for each live branch. A clean apply on top of an upstream fix for the same bug leaves two fixes
fighting each other.

```bash
# 4. Replay each live patch onto the new vendor, in PATCHES.md order
git rebase vendor <branch>           # re-express on conflict, or drop it (retire)

# 5. Rebuild main
git switch -C main vendor
git merge --no-ff <branch>           # once per live branch, in PATCHES.md order

# 6. Finish
git diff --stat vendor main          # the health check
git range-diff $OLD..custom/$D vendor..main   # what the rebuild changed, patch by patch
git push --force-with-lease fork main <live branches>
git push fork vendor --tags
```

At each rebase stop there are three outcomes: **re-express** the patch's intent against the new
code, **retire** it (`git rebase --abort`, drop the row), or **bail out** and look again later.
The old `main` is always one `git switch -C main custom/<date>` away.

## Useful commands

```bash
git diff vendor main                       # every local change
git diff --stat vendor main                # the health check
git log --oneline --first-parent vendor..main   # one merge per live patch
git log --oneline vendor..main -- <file>   # which patches touched this file
git branch --merged vendor                 # patch branches upstream has taken
git tag -l 'custom/*'                      # every main that ran
```

## Gotchas

- **Don't switch the main checkout to `vendor`.** The Claude hooks registered in
  `.claude/settings.local.json` live on `local/tooling`, so on `vendor` they vanish from disk and
  every Bash call trips a missing-script hook. Work on `vendor`-based branches in a worktree.
- **`main` is what runs.** Deploying is `docker compose up --build --detach` from this checkout
  on `main`; merging a branch changes nothing until then.
- **`custom/2026-09-29`** is the old `tokeiito` branch as it stood when this model started: the
  full history of the stacked `up/*` era, including the chat blocks upstream retired and we
  dropped.
