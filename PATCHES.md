# Patch manifest

Every branch carried on top of `vendor`, in the order it is merged into `main`. This file is the
authority: a patch not listed here is lost on the next rebuild, and a patch listed here is one
somebody has decided is still needed. See `CLAUDE.md` for the workflow.

**Vendor:** `origin/master` at `344380d` (2026-09-29, PR #35 merged).

The `On main` column is a cache of `git branch --merged main`; if the two disagree, ancestry wins.

| # | Branch | What it carries | Files | Upstream | On main |
| - | ------ | --------------- | ----- | -------- | ------- |
| 1 | `local/tooling` | This workflow: `CLAUDE.md`, this manifest, and the Claude Code hooks registered in `.claude/settings.local.json` -- `guard-live-bot.sh` (refuses restarts that would kill running bots) and `rebuild-when-stale.sh`, each with its test | `CLAUDE.md`, `PATCHES.md`, `.claude/hooks/` | never | yes |
| 2 | `local/deploy` | The hive release pipeline: a `release/*` tag on Gitea builds and pushes the image and moves `deploy/prod`, which Portainer polls; `compose.hive.yaml` joins the evej stack's network and volume as externals | `.gitea/workflows/release.yaml`, `compose.hive.yaml`, `docs/DEPLOYMENT.md` | never | yes |
| 3 | `fix/companion-fleet-not-in-fleet` | A fleetless character is refused `FleetNotInFleet` by the server's member gate, not `FleetNotFound`; the Fleet window read that as "could not read" and bot fleet lookups never settled. Accept either refusal | `web/src/bridge/fleetCenter.ts` (+ test) | [#36](https://github.com/rrfarmer/evejs-web-companion/pull/36) open | yes |
| 4 | `feat/companion-bot-manager-rail` | The Bot Manager laid out like the PI Manager: a menu rail (Groups, Pilots, Recent runs, Saved bots), a four-number strip, one view at a time; a group row is one line of controls, with the explanations every row repeated said once under the list | `web/src/ui/BotManager.svelte`, `web/src/ui/BotManagerGroupRow.svelte` (+ tests) | not yet sent | yes |

## Retired at the start of this model (2026-09-29)

The old `tokeiito` branch is frozen as tag `custom/2026-09-29`. Against `origin/master` it
differed in 40 files; everything else it carried had already gone upstream as the stacked
PRs #11-#35, all merged. The rest was dropped rather than carried:

- **Chat blocks** (`send-chat`, the `players-in-system-above` condition, `web/src/bridge/social.ts`
  and their tests). Upstream retired companion chat on purpose (`e500758 feat(web): retire companion
  chat`); the 2026-09-28 sync had kept ours. Dropped to follow upstream: saved bots using either
  are now refused on load with upstream's retired-feature message.
- **Comment drift**: a dated incident note in `compose.yaml`, leftover hunt/`engagePrey` comments
  in `flow.ts` and `fleetCompanionLoop.ts`, and chat wording in `PanelHost.svelte`. Upstream's
  wording taken.
- The 25 local feature branches of the `up/*` era, every one of them absorbed upstream; they
  stay reachable from the tag.
