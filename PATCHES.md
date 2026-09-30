# Patch manifest

Every branch carried on top of `vendor`, in the order it is merged into `main`. This file is the
authority: a patch not listed here is lost on the next rebuild, and a patch listed here is one
somebody has decided is still needed. See `CLAUDE.md` for the workflow.

**Vendor:** `origin/master` at `7c5d540` (2026-09-30, PR #48 merged). `main` as it ran before this sync is tag `custom/2026-09-30`.

The `On main` column is a cache of `git branch --merged main`; if the two disagree, ancestry wins.

| # | Branch | What it carries | Files | Upstream | On main |
| - | ------ | --------------- | ----- | -------- | ------- |
| 1 | `local/tooling` | This workflow: `CLAUDE.md`, this manifest, and the Claude Code hooks registered in `.claude/settings.local.json` -- `guard-live-bot.sh` (refuses restarts that would kill running bots) and `rebuild-when-stale.sh`, each with its test | `CLAUDE.md`, `PATCHES.md`, `.claude/hooks/` | never | yes |
| 2 | `local/deploy` | The hive release pipeline: a `release/*` tag on Gitea builds and pushes the image and moves `deploy/prod`, which Portainer polls; `compose.hive.yaml` joins the evej stack's network and volume as externals | `.gitea/workflows/release.yaml`, `compose.hive.yaml`, `docs/DEPLOYMENT.md` | never | yes |
| 3 | `fix/companion-builder-without-pilot` | The Bot Manager's New bot and Edit work with no pilot in the client: the Bot Builder takes a narrow `BuilderFlow`, and on the hangar it floats on the global layer riding an account sign-in | `web/src/bots/builderFlow.ts`, `web/src/ui/HangarBotBuilder.svelte`, `BotBuilder`/`BotManager`/`App`/`GlobalPanel.svelte`, `globalWindow.ts`, picker prop types | [#49](https://github.com/rrfarmer/evejs-web-companion/pull/49) | yes |
| 4 | `feat/companion-bot-categories` | Categories for saved bots: shelves under Saved bots on the Bot Manager rail (All, each category, Uncategorized) with add / rename / reorder / delete there, a Category menu on every row and beside the name in the Bot Builder. Deleting a category keeps its bots (they become Uncategorized). Merging it after #3 needs `await botOpts()` in BotBuilder, resolved in the merge | `src/botScriptStore.js`, `src/server.js`, `web/src/app/api.ts`, `web/src/bots/libraryView.ts`, `BotManager`/`BotBuilder.svelte`, tests | [#50](https://github.com/rrfarmer/evejs-web-companion/pull/50), after #49 | yes |
| 5 | `feat/companion-fight-back-drone-rotation` | Bots recall a combat drone that starts losing shield and relaunch it. While mining, the mining drone flight owns every drone order, so the recall lives there (`decideMiningDroneFlight`: a shield DROP since the last reading, never with one drone out, three per drone per fight); `fight-the-rats` runs `droneRotation` for fights off a mining step | `web/src/nav/miningDroneFlight.ts`, `web/src/nav/scriptMacros.ts`, tests | [#52](https://github.com/rrfarmer/evejs-web-companion/pull/52) | yes |
| 6 | `fix/companion-repair-quoted-parts` | Repairs by each quoted part's OWN item id. A hull's quote lists its modules and drone-bay contents under the hull's key; repairing by the key fixed only the hull, so damaged drones stayed damaged, RepairItems answered OK, and `repair-ship` stopped on "not enough money?". Fixes the bot observations and the station panel's Repair button. Also prices each part as ceil(damage) * `costToRepairOneUnitOfDamage` (the client's formula; the row has no total, so the panel said "no price") and lists one row per damaged part, so a bay drone is named instead of its hull | `web/src/bridge/repairQuotes.ts`, `web/src/app/flow.ts`, `StationPanel.svelte`, tests | [#51](https://github.com/rrfarmer/evejs-web-companion/pull/51) | yes |
| 7 | `fix/companion-fight-back-out-of-reach` | A `hostile-on-grid -> fight-back` watch no longer seizes the ship for a pirate beyond targeting range. The condition counts the whole grid and the borrowed ladder only what is in reach, so the ladder spent its three empty-grid confirm reads, released for one tick and was borrowed again: the step under it ran one tick in four. The watch now falls through when every visible hostile is out of reach and it has no fight in progress. The block's confirm reads (2026-09-14) and the mid-fight stand-down are unchanged; `hostilesInReach` moves to `scriptConditions.ts` so both callers share it. Merging after #5 needs one duplicate `scriptDecide` import dropped from `scriptMacros.test.ts`, resolved in the merge | `web/src/nav/scriptDecide.ts`, `scriptConditions.ts`, `scriptMacros.ts`, tests | not yet opened | yes |

## Retired 2026-09-29 (second sync): upstream merged all five

Upstream merged PRs #36-#40 as true merges, so each branch became an ancestor of `vendor` and was
retired outright. `main` as it ran before this sync is tag `custom/2026-09-29.2`; each branch is
`archive/<branch>/2026-09-29.2`.

- `fix/companion-fleet-not-in-fleet` -- [#36](https://github.com/rrfarmer/evejs-web-companion/pull/36)
- `fix/companion-pi-narrow-container` -- [#37](https://github.com/rrfarmer/evejs-web-companion/pull/37)
- `feat/companion-bot-manager-rail` -- [#38](https://github.com/rrfarmer/evejs-web-companion/pull/38)
- `fix/companion-drone-stack-quantity` -- [#39](https://github.com/rrfarmer/evejs-web-companion/pull/39)
- `fix/companion-salvage-lock-wreck` -- [#40](https://github.com/rrfarmer/evejs-web-companion/pull/40)

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
