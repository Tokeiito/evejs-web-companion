# Patch manifest

Every branch carried on top of `vendor`, in the order it is merged into `main`. This file is the
authority: a patch not listed here is lost on the next rebuild, and a patch listed here is one
somebody has decided is still needed. See `CLAUDE.md` for the workflow.

**Vendor:** `origin/master` at `6b9d3ec` (2026-10-02, PR #63 merged). `main` as it ran before this sync is tag `custom/2026-10-02`.

The `On main` column is a cache of `git branch --merged main`; if the two disagree, ancestry wins.

| # | Branch | What it carries | Files | Upstream | On main |
| - | ------ | --------------- | ----- | -------- | ------- |
| 1 | `local/tooling` | This workflow: `CLAUDE.md`, this manifest, and the Claude Code hooks registered in `.claude/settings.local.json` -- `guard-live-bot.sh` (refuses restarts that would kill running bots) and `rebuild-when-stale.sh`, each with its test | `CLAUDE.md`, `PATCHES.md`, `.claude/hooks/` | never | yes |
| 2 | `local/deploy` | The hive release pipeline: a `release/*` tag on Gitea builds and pushes the image and moves `deploy/prod`, which Portainer polls; `compose.hive.yaml` joins the evej stack's network and volume as externals | `.gitea/workflows/release.yaml`, `compose.hive.yaml`, `docs/DEPLOYMENT.md` | never | yes |
| 3 | `feat/companion-industry-facility-bonuses` | The Industry Manager counts facility bonuses and shows job times: each job is worked where it would run (its copy, else the plan Build at / React at facility, saved as `choices.facilities`), with that facility material and time modifiers from GetFacilities (category, group, type matching), and job time the server way (TE, facility, the pilot industry time attribute from skills, required-skill bonuses from dogma 1982). Checked against the server own functions on 64 cases. Not exercised in game, by choice. | `web/src/bridge/industryFacility.ts`, `industry.ts`, `industryRecipes.ts`, `industryChain.ts`, `web/src/ui/IndustryManager.svelte`, `web/src/app/industryPlans.ts`, `api.ts`, `store/types.ts`, `src/industryRecipes.js`, `industryPlanStore.js`, `server.js` (closure route), tests | not yet | yes |
| 4 | `feat/companion-rack-reload` | Reload weapons from the HUD module rack: right-click (or tap an empty gun) for a cargo charge menu, an ammo strip with Reload all, round counts on the tiles, and a button under the rack that loads an empty gun a refusal named. In space the server queues a load for the reload time, so its OnChargeBeingLoadedToModule push is recorded and loadAmmo no longer reports a queued reload as "loaded nothing"; each shot's OnModuleAttributeChanges quantity keeps the counts live. A rack refusal is said once, by the notice popup: the red `.rack-error` line under the HUD (already on `master`) repeated every one, and is gone. Loading, Reload all and the single popup exercised live; the live counts while firing and the empty-gun load button not yet. | `web/src/ui/ModuleRack.svelte`, `rackAmmo.ts`, `web/src/bridge/reloadNotifications.ts`, `fitting.ts` (`slotFlagOf`), `web/src/app/flow.ts`, `store/types.ts`, `clientStore.ts`, `feed.ts`, `styles.css`, tests | [#64](https://github.com/rrfarmer/evejs-web-companion/pull/64) (open) | yes |
| 5 | `fix/companion-probe-launcher-activation` | Probe launchers launch probes, and bots stop firing them. The server launches probes only when Activate names "useMissiles"; the bridge sent an empty effect, so a probe launcher cycled and launched nothing. The activate route takes an optional typeID and names "useMissiles" for any type with dogma effect 101; the rack and equipment panel send it. `isWeaponModuleGroup` drops the Scan/Survey Probe, Interdiction Sphere and Festival launchers from the bot weapon list (a bot was cycling its Core Probe Launcher at rats). From a user report. | `src/server.js`, `src/staticData.js`, `web/src/app/api.ts`, `flow.ts`, `web/src/ui/ModuleRack.svelte`, `EquipmentPanel.svelte`, tests | not yet | yes |

## Retired 2026-10-01 (seventh sync): upstream merged one

Upstream merged PR #62 as a true merge, so the branch became an ancestor of `vendor` and was
retired outright. `main` as it ran before this sync is tag `custom/2026-10-01.12`; the branch is
`archive/feat/companion-industry-decryptor-handoff/2026-10-01.12`.

- `feat/companion-industry-decryptor-handoff` -- [#62](https://github.com/rrfarmer/evejs-web-companion/pull/62)

## Retired 2026-10-01 (sixth sync): upstream merged one of ours

Upstream merged PR #55 as a true merge, at the branch's third commit. The branch had one more
commit on it by then (the decryptor handoff), which moved to its own branch off the new `vendor`
(row 3); the rest was an ancestor of `vendor` and was retired outright. Upstream also merged
#56-#61 from another contributor (mining support), touching none of our files. `main` as it ran
before this sync is tag `custom/2026-10-01.11`; the branch is
`archive/feat/companion-industry-invention-setup/2026-10-01.11`.

- `feat/companion-industry-invention-setup` -- [#55](https://github.com/rrfarmer/evejs-web-companion/pull/55)

## Retired 2026-10-01 (fifth sync): upstream merged one

Upstream merged PR #54 as a true merge, so the branch became an ancestor of `vendor` and was
retired outright. `main` as it ran before this sync is tag `custom/2026-10-01.7`; the branch is
`archive/feat/companion-industry-manager/2026-10-01.7`.

- `feat/companion-industry-manager` -- [#54](https://github.com/rrfarmer/evejs-web-companion/pull/54)

## Retired 2026-10-01 (fourth sync): upstream merged one

Upstream merged PR #53 as a true merge, so the branch became an ancestor of `vendor` and was
retired outright. `main` as it ran before this sync is tag `custom/2026-10-01`; the branch is
`archive/fix/companion-fight-back-out-of-reach/2026-10-01`.

- `fix/companion-fight-back-out-of-reach` -- [#53](https://github.com/rrfarmer/evejs-web-companion/pull/53)

## Retired 2026-09-30 (third sync): upstream merged four

Upstream merged PRs #49-#52 as true merges, so each branch became an ancestor of `vendor` and was
retired outright. `main` as it ran before this sync is tag `custom/2026-09-30.3`; each branch is
`archive/<branch>/2026-09-30.3` (`.3` because `archive/feat/companion-bot-categories/2026-09-30.2`
already named an earlier rebase that day).

- `fix/companion-builder-without-pilot` -- [#49](https://github.com/rrfarmer/evejs-web-companion/pull/49)
- `feat/companion-bot-categories` -- [#50](https://github.com/rrfarmer/evejs-web-companion/pull/50)
- `fix/companion-repair-quoted-parts` -- [#51](https://github.com/rrfarmer/evejs-web-companion/pull/51)
- `feat/companion-fight-back-drone-rotation` -- [#52](https://github.com/rrfarmer/evejs-web-companion/pull/52)

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
