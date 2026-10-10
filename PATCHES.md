# Patch manifest

Every branch carried on top of `vendor`, in the order it is merged into `main`. This file is the
authority: a patch not listed here is lost on the next rebuild, and a patch listed here is one
somebody has decided is still needed. See `CLAUDE.md` for the workflow.

**Vendor:** `origin/master` at `8c26fba` (2026-10-10, skill queue writes made by the page). `main` as it ran before the last sync is tag `custom/2026-10-10c`.

The `On main` column is a cache of `git branch --merged main`; if the two disagree, ancestry wins.

| # | Branch | What it carries | Files | Upstream | On main |
| - | ------ | --------------- | ----- | -------- | ------- |
| 1 | `local/tooling` | This workflow: `CLAUDE.md`, this manifest, and the Claude Code hooks registered in `.claude/settings.local.json` -- `guard-live-bot.sh` (refuses restarts that would kill running bots) and `rebuild-when-stale.sh`, each with its test | `CLAUDE.md`, `PATCHES.md`, `.claude/hooks/` | never | yes |
| 2 | `local/deploy` | The hive release pipeline: a `release/*` tag on Gitea builds and pushes the image and moves `deploy/prod`, which Portainer polls; `compose.hive.yaml` joins the evej stack's network and volume as externals | `.gitea/workflows/release.yaml`, `compose.hive.yaml`, `docs/DEPLOYMENT.md` | never | yes |
| 3 | `fix/companion-persist-bridge-sessions` | A BFF restart releases the pilots the previous process held. The bridge handles lived only in memory, so every restart left each selected pilot online at the gateway (`retail_client`) until its 30-minute idle TTL, and hosted Start refused them all ("A web session is flying this character"). The held map now mirrors handle/account/character to `data/bridge-sessions.json`; `startServer` releases those before resuming bots. Seen live 2026-10-04: five pilots refused after the 08:22 rebuild. Upstream #91 reworked held-session release on selection but still keeps the map only in memory, so the restart leak stands. | `src/bridgeSessionJournal.js` (new), `src/server.js`, `src/bridgeSessionJournal.test.js`, `test/bridgeSessionRestart.test.js` | not yet (verify live first) | yes |
| 4 | `fix/companion-pi-haul-final-products` | The PI Haul sends up only what a colony makes. Both export paths (the Haul button's game-port hop, `planCustomsExports`, and the run's `collect-customs` block) sent EVERYTHING on a colony's launchpads up into the customs office. A colony with no extractors (launchpad as its only store) keeps the imports its factories run on there, so a haul exported the factories' feed with the product. A type that a route on the colony delivers into a factory is now an input and stays on the planet; a launchpad holding only inputs counts as empty. | `src/piCustomsExport.js`, `web/src/bridge/colonyRoutes.ts`, `web/src/nav/scriptMacros.ts`, `web/src/nav/scriptConditions.ts`, `web/src/app/flow.ts`, tests | [#113](https://github.com/rrfarmer/evejs-web-companion/pull/113) (open; seen live 2026-10-10) | yes |
| 5 | `fix/companion-pi-restart-budget` | Restart-extractors no longer stops a healthy run on a fixed cap. Restarts and reroutes shared one action count capped at 20, so a roster of six colonies x two expired extractors (12 restarts + up to 12 reroutes) stopped on its 21st action with "The extractor reroutes kept not taking" though every edit landed. Seen live 2026-10-10 on two pilots: 20 actions each, all ok, zero refusals. The cap is now two per extractor on the roster plus the old margin. | `web/src/nav/scriptMacros.ts`, `web/src/nav/scriptMissionMacros.test.ts` | [#114](https://github.com/rrfarmer/evejs-web-companion/pull/114) (open) | yes |
| 6 | `fix/companion-pi-haul-from-space` | A PI haul started in space flies home or hauls from where it is. It paused at once ("does not know which station is home"): a run started in space had no starting station, and board-planetary-hauler refused any pilot not docked. In space a ship with a planetary hold is done and hauls; any other hull flies home (shared travel-home) and boards there. A run started in space resolves its starting station to the bot's home if concrete, else the character's home station (charMgr.GetHomeStationRow). The haul's home is the Deliver-to station when picked. Seen live 2026-10-10 after re-logging pilots stranded by the server's stale warp landings. | `web/src/nav/scriptMacros.ts`, `web/src/app/flow.ts`, `web/src/app/piDispatch.ts`, tests | not yet (verify live first) | yes |
| 7 | `fix/companion-pi-haul-tax-funds` | A PI haul stops when the wallet cannot pay the customs export tax. A pilot short of ISK was refused `NotEnoughMoney` on every launchpad; the haul retried each five times, set it aside and finished silently. `NotEnoughMoney` is now refusal kind `no-funds` (a property of the wallet, like `no-room` of the hold), and collect-customs stops the run on the first one with a sentence saying so. Seen live 2026-10-10 (128k ISK against a 24k-unit P1 export). | `web/src/nav/refusalLedger.ts`, `web/src/nav/scriptMacros.ts`, `web/src/bridge/refusals.ts`, `web/src/store/types.ts`, tests | not yet (verify live first) | yes |
| 7 | `fix/companion-launcher-keeps-target` | A missile or rocket launcher keeps its target on the game port. `effectTargeted` judged a launcher by its own `useMissiles`, an activation effect (category 1), so `dogmaIM.Activate` went with None for the target and the server refused it (`TARGET_REQUIRED`). The client's `GetRelevantEffect` asks the loaded charge's default effect (`missileLaunching`, category 2) for `useMissiles` and a charged `warpDisruptSphere`; godma now says what is loaded in a module (`chargeIn`) and the BFF does the same. | `src/gamePort/pilotDogma.js`, `src/gamePort/pilots.js`, tests | [#115](https://github.com/rrfarmer/evejs-web-companion/pull/115) (open; seen live 2026-10-10) | yes |

## Retired 2026-10-10 (fifteenth sync): upstream merged row 4

Upstream merged PR #111 as a true merge, so the branch is an ancestor of `vendor` and is retired outright.

- `fix/companion-station-search-no-pilot` -- [#111](https://github.com/rrfarmer/evejs-web-companion/pull/111)

## Retired 2026-10-07 (fourteenth sync): upstream merged rows 4-6

Upstream merged PRs #108-#110 as true merges, so each branch is an ancestor of `vendor` and is retired outright.

- `fix/companion-scan-full-state-route` -- [#108](https://github.com/rrfarmer/evejs-web-companion/pull/108)
- `fix/companion-ice-site-already-inside` -- [#109](https://github.com/rrfarmer/evejs-web-companion/pull/109)
- `fix/companion-ore-hold-by-hull` -- [#110](https://github.com/rrfarmer/evejs-web-companion/pull/110)

## Retired 2026-10-06 (thirteenth sync): upstream merged rows 4-9

Upstream merged PRs #101-#107 as true merges, so each branch is an ancestor of `vendor` and is retired outright.

- `fix/companion-hangar-header-buttons` -- [#101](https://github.com/rrfarmer/evejs-web-companion/pull/101)
- `feat/companion-pi-coverage` -- [#102](https://github.com/rrfarmer/evejs-web-companion/pull/102)
- `fix/companion-mined-out-site-refusal` -- [#103](https://github.com/rrfarmer/evejs-web-companion/pull/103)
- `feat/companion-gate-jump-closes-in` -- [#104](https://github.com/rrfarmer/evejs-web-companion/pull/104)
- `feat/companion-bot-builder-floats` -- [#105](https://github.com/rrfarmer/evejs-web-companion/pull/105)
- `feat/companion-refit-corp-fittings` -- [#106](https://github.com/rrfarmer/evejs-web-companion/pull/106)
- `feat/companion-builder-startup-list` -- [#107](https://github.com/rrfarmer/evejs-web-companion/pull/107)

## Retired 2026-10-05 (twelfth sync): the freeze lifts; upstream merged the refusal fix and the ice sites

From 2026-10-04 `main` was frozen on `custom/2026-10-03b` (upstream `2ef352f`), because upstream
`de60080` (#81) sent every hosted bot Start through `POST /_evejs-web/v1/factory/session`, a gateway
route our server does not serve, and every Start failed with `GATEWAY_ROUTE_NOT_FOUND`. Upstream #91
(`2be818c`, "restore stock hosted start selection") moved hosted selection onto the stock
`/session/select`, which the server does serve, and `e43cad5` removed the `/factory/session` call
altogether. This sync rebuilt `main` on `vendor` again; `local/tooling-frozen`, the side branch the
manifest reached the frozen `main` through, is retired with it. The frozen `main` is tag
`custom/2026-10-05b`.

- `fix/companion-refused-warp-and-lock` -- [#90](https://github.com/rrfarmer/evejs-web-companion/pull/90), taken by upstream through #92/#93
- `feat/companion-scanner-ice-sites` -- [#95](https://github.com/rrfarmer/evejs-web-companion/pull/95)

## Retired 2026-10-04 (eleventh sync): upstream merged the facility bonuses

Upstream merged PR #79 as a true merge, so the branch became an ancestor of `vendor` and was
retired outright. The same sync brought in #74-#78 and #80-#85 from another contributor
(provisioning, Startup/Main execution, the Defender role) and an overview PR that upstream merged
and then reverted (#87-#89); 143 files in all, `scriptRunner.ts`, `scriptDecide.ts` and
`scriptMacros.ts` among them, none of it touching how a refused action is committed. `main` as it
ran before this sync is tag `custom/2026-10-04`; the branches are `archive/<branch>/2026-10-04`.

- `feat/companion-industry-facility-bonuses` -- [#79](https://github.com/rrfarmer/evejs-web-companion/pull/79)

## Retired 2026-10-03 (tenth sync): upstream merged the customs export

Upstream merged PR #70 as a true merge, so the branch became an ancestor of `vendor` and was
retired outright. Upstream added two commits of its own to the PR branch before merging
(`1279c05` export ownership and partial progress, `721edc4` drone readiness across the docked
handback); they arrive through `vendor`. Stale local branches `feat/companion-pi-haul-button`
(retired in the ninth sync) and `patch/happy-albattani-658b4f` (already in `vendor`) were deleted
with it, and every fork branch whose PR is merged. `main` as it ran before this sync is tag
`custom/2026-10-03b`; the branches are `archive/<branch>/2026-10-03b`.

- `feat/companion-pi-customs-export` -- [#70](https://github.com/rrfarmer/evejs-web-companion/pull/70)

## Retired 2026-10-03 (ninth sync): upstream took the Haul button its own way

Upstream did not merge `feat/companion-pi-haul-button` as commits. It re-expressed the work on
its own `codex/pr-68-integration` branch and merged that as
[#69](https://github.com/rrfarmer/evejs-web-companion/pull/69), so the branch is NOT an ancestor
of `vendor` and `git branch --merged vendor` does not list it. The Haul button, the per-colony
checkboxes, the "Deliver to" / "Unload into" pickers, the division-name learning, the
`planetList` arg and the `board-planetary-hauler` block are all in `vendor` now, so the branch is
retired.

⚠ ONE THING DID NOT COME BACK. Upstream dropped the in-tab path (our `a553827`): their
`restartExtractors` and `haul` both go straight to the server bot host, which refuses a pilot a
web session holds. So the one pilot the player has open in the tab is again the one pilot the PI
window cannot use. Nothing carries that behaviour today; it is a deliberate gap, recorded here
rather than silently re-added.

- `feat/companion-pi-haul-button` -- [#68](https://github.com/rrfarmer/evejs-web-companion/pull/68),
  taken via [#69](https://github.com/rrfarmer/evejs-web-companion/pull/69)

## Retired 2026-10-02 (eighth sync): upstream merged four

Upstream merged PRs #64-#67 as true merges, so all four branches became ancestors of `vendor` and were
retired outright. The Haul button work, which had been one more commit on `feat/companion-pi-customs-haul`,
had already moved to its own branch (row 4) and was rebased onto the new `vendor`. `main` as it ran before
this sync is tag `custom/2026-10-02b`; the branches are `archive/<branch>/2026-10-02b`.

- `feat/companion-rack-reload` -- [#64](https://github.com/rrfarmer/evejs-web-companion/pull/64)
- `fix/companion-probe-launcher-activation` -- [#65](https://github.com/rrfarmer/evejs-web-companion/pull/65)
- `fix/companion-stale-upstream-tests` -- [#66](https://github.com/rrfarmer/evejs-web-companion/pull/66)
- `feat/companion-pi-customs-haul` -- [#67](https://github.com/rrfarmer/evejs-web-companion/pull/67)

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
