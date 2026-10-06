# Patch manifest

Every branch carried on top of `vendor`, in the order it is merged into `main`. This file is the
authority: a patch not listed here is lost on the next rebuild, and a patch listed here is one
somebody has decided is still needed. See `CLAUDE.md` for the workflow.

**Vendor:** `origin/master` at `6aabf24` (2026-10-05, PR #100 merged). `main` as it ran before the last sync is tag `custom/2026-10-05b`.

The `On main` column is a cache of `git branch --merged main`; if the two disagree, ancestry wins.

| # | Branch | What it carries | Files | Upstream | On main |
| - | ------ | --------------- | ----- | -------- | ------- |
| 1 | `local/tooling` | This workflow: `CLAUDE.md`, this manifest, and the Claude Code hooks registered in `.claude/settings.local.json` -- `guard-live-bot.sh` (refuses restarts that would kill running bots) and `rebuild-when-stale.sh`, each with its test | `CLAUDE.md`, `PATCHES.md`, `.claude/hooks/` | never | yes |
| 2 | `local/deploy` | The hive release pipeline: a `release/*` tag on Gitea builds and pushes the image and moves `deploy/prod`, which Portainer polls; `compose.hive.yaml` joins the evej stack's network and volume as externals | `.gitea/workflows/release.yaml`, `compose.hive.yaml`, `docs/DEPLOYMENT.md` | never | yes |
| 3 | `fix/companion-persist-bridge-sessions` | A BFF restart releases the pilots the previous process held. The bridge handles lived only in memory, so every restart left each selected pilot online at the gateway (`retail_client`) until its 30-minute idle TTL, and hosted Start refused them all ("A web session is flying this character"). The held map now mirrors handle/account/character to `data/bridge-sessions.json`; `startServer` releases those before resuming bots. Seen live 2026-10-04: five pilots refused after the 08:22 rebuild. Upstream #91 reworked held-session release on selection but still keeps the map only in memory, so the restart leak stands. | `src/bridgeSessionJournal.js` (new), `src/server.js`, `src/bridgeSessionJournal.test.js`, `test/bridgeSessionRestart.test.js` | not yet (verify live first) | yes |
| 4 | `fix/companion-hangar-header-buttons` | The Pilot Hangar header reads as controls. The global-window doors (Bots, PI, Build, Companions, MCC) had no fill and a line-3 border on the header's own background, so they read as labels; they now carry a fill, a line-5 border and a blue glyph. Pilot Training, a link styled as `.hangar-manage`, sat at the top of its 30px box; the class is now inline-flex and centred. Both links drop the default underline. CSS only. | `web/src/styles.css` | [#101](https://github.com/rrfarmer/evejs-web-companion/pull/101) (open) | yes |
| 5 | `feat/companion-pi-coverage` | Two PI Manager pieces that share one aim, so one branch. **Coverage**, a view built like Stock: what every roster colony makes per tier, and how evenly the basics (P1) cover the recipe tree, weighted by "one of every top product" walked down the recipes. **Expansion plans** in the Planner: free colony slots (from Interplanetary Consolidation, now on each roster pilot) go to the basic furthest behind, on the richest planet within N jumps that carries its resource, nullsec unless poorer by a tolerance; kept plans track built/not built against live colonies. Richness of uncolonised planets is the game's own GetPlanetResourceInfo on a pilot already online in the tab, cached in the browser. Adds migration 3 (`pi_expansion_plans`). | `web/src/bridge/piCoverage.ts`, `web/src/bridge/piExpansion.ts`, `web/src/app/piExpansions.ts`, `web/src/app/piRichness.ts`, `web/src/ui/PiManager.svelte`, `src/server.js`, `src/staticData.js`, `src/companionDb.js`, `src/piExpansionStore.js`, tests | [#102](https://github.com/rrfarmer/evejs-web-companion/pull/102) (open) | yes |
| 6 | `fix/companion-mined-out-site-refusal` | The anomaly miner stops hammering a site that is gone. Mine-at-a-belt in site mode picked the next ore site and pressed the warp on the same tick; a site the fleet had just emptied was still on the scanner, the server refused ("You have not scanned that site down"), the refused tick committed nothing, and the same site was re-picked until the runner stopped the bot on ten refusals in a row, in space. The pick is now committed by a wait tick first; a refusal strikes the site off and the next one is tried, and with none left the step ends "Every ore site in this system is mined out." (which flies home before stopping). Seen live 2026-10-06. | `web/src/nav/scriptMacros.ts`, tests | [#103](https://github.com/rrfarmer/evejs-web-companion/pull/103) (open; fixed path not yet seen live) | yes |
| 7 | `feat/companion-refit-corp-fittings` | Refit from a saved fitting can apply the session corp's fits, not only the pilot's own. The block, the apply step and the Bot Builder picker read the character library plus corpFittingMgr.GetFittings through the existing `/api/bridge/shared-fittings` route; personal fits come first so a shared name still resolves to the pilot's own, and a failed corp read leaves the personal library working. The picker is a dropdown with a filter field on top (hull or fit name) and fits grouped under their hull; corp fits are marked "(corp)" when personal fits sit beside them. Applying is unchanged (a flag-to-type plan the server fills from the hangar). | `web/src/app/api.ts`, `web/src/app/flow.ts`, `web/src/bridge/sharedFittings.ts`, `web/src/nav/scriptMacros.ts`, `web/src/bots/macroCatalogView.ts`, `web/src/bots/fittingPicker.ts` (new), `web/src/ui/BotBuilder.svelte`, `web/src/ui/BotInspector.svelte`, `web/src/ui/FittingSelect.svelte` (new), tests | not yet (verify live first) | yes |
| 8 | `feat/companion-gate-jump-closes-in` | Jump on a selected stargate (overview verb bar and radial) closes the distance first, like Dock. It fired the raw CmdStargateJump, which the server refuses outside 2,500 m, so a pilot had to Warp to, wait, then Jump. `flow.jumpThrough` hands the autopilot decide-loop a one-hop plan through that gate with no final dock; it warps, approaches and jumps as the measurement calls for, and arrival is the far system from flight status. The Flight tab's raw Jump is unchanged. | `web/src/app/flow.ts`, `web/src/space/rowActionRunner.ts`, `web/src/space/rowActions.ts`, tests | [#104](https://github.com/rrfarmer/evejs-web-companion/pull/104) (open; verified live 2026-10-06) | yes |
| 9 | `feat/companion-bot-builder-floats` | The Bot Builder opens on top of the Bot Manager. The Manager floats on App's global layer, above every desktop; Edit and New bot opened the builder on the active pilot's desktop, so it appeared BEHIND the Manager (upstream's fix only started it to the right of the Manager's default spot). It now floats on the global layer too, bound to the pilot it was opened for (or nobody from the hangar); the binding holds through pilot switches so the draft survives. A "Data from" select in its strip picks which signed-in pilot (or none) the pickers read -- fittings and corp fittings, bookmarks, hangar items, corp division names -- swapping store and flow without remounting, so the draft is kept. Desktops refuse and drop builder windows. Phones unchanged. | `web/src/ui/App.svelte`, `web/src/ui/GlobalPanel.svelte`, `web/src/ui/HangarBotBuilder.svelte`, `web/src/ui/BotBuilder.svelte`, `web/src/bots/builderFlow.ts`, `web/src/ui/globalWindow.ts`, `web/src/ui/desktop.ts`, `web/src/ui/BotManager.svelte` (comment), tests | [#105](https://github.com/rrfarmer/evejs-web-companion/pull/105) (open; floating window and one-line strip seen live 2026-10-06) | yes |
| 9 | `feat/companion-builder-startup-list` | The Bot Builder's Startup section is a list you can add to. It was a heading over a note in internal wording, reachable only through a Main row's "Move to Startup", so it read as fixed. It now has "+ Startup step" (the same picker, inserting at the end of Startup), headings matching Main's ("Main: repeats 20 times"), and a plain note on which steps a server-hosted run supports there today. Hidden when the plan runs saved bots. The saved document is unchanged. **Hosted refit in Startup:** a server-hosted run refused `refit-ship` there (no proof adapter, one action per step, any ship change blocked). The run now reads the active ship's fitted slots during a refit (`activeFitting`); the postcondition is docked in the fitting's hull with every slotted module of the fit present; a step may issue its next action once the dispatched one is seen to land (max 4, not across a restart); a ship-changing step may sit in another hull once its own action is in flight, and its proven hull becomes the run's ship. Already-fitted pilots skip it; a partial fit never opens Main. | `web/src/ui/BotBuilder.svelte`, `web/src/styles.css`, `src/startupRuns.js`, `src/botHost.js`, `web/src/bots/startup.ts`, `web/src/app/flow.ts`, `web/src/nav/scriptConditions.ts`, `web/src/bridge/fitting.ts`, tests | not yet (verify live first) | yes |

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
