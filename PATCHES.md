# Patch manifest

Every branch carried on top of `vendor`, in the order it is merged into `main`. This file is the
authority: a patch not listed here is lost on the next rebuild, and a patch listed here is one
somebody has decided is still needed. See `CLAUDE.md` for the workflow.

**Vendor:** `origin/master` at `b0dfa57` (2026-10-04, PR #93 merged; fast-forwarded from `7967153` to cut row 5's PR, no sync yet). `main` as it ran before the last sync is tag `custom/2026-10-04`.

⚠ **Upstream has moved under the freeze.** `7967153..b0dfa57` brings row 3's commits in through #92/#93
(retire it at the next sync) and #91 "restore stock hosted start selection", which may be the fix the
freeze is waiting for. Check hosted Start against it before syncing.

## FROZEN 2026-10-04: `main` is rolled back to `custom/2026-10-03b`, built on upstream `2ef352f`

Do NOT rebuild `main` on the current `vendor`, and do not sync, until upstream fixes hosted Start.

Upstream `de60080` ("fix(bots): honor exact hosted start reservations", part of #81) sends every
hosted bot Start through `POST /_evejs-web/v1/factory/session`. Our server's gateway has no such
route (404, and nothing under `/d/evet` serves it), so after the eleventh sync every bot Start
failed with `GATEWAY_ROUTE_NOT_FOUND` ("EveJS web gateway route was not found."). That call was
upstream's mistake, and we are not patching around it. We are waiting for upstream to fix it.

- `main` is `custom/2026-10-03b` (upstream `2ef352f` + rows 1-2 + the facility bonuses branch,
  since merged upstream as #79) plus a merge of `local/tooling-frozen` for this note. 
  `local/tooling` itself is based on `7967153`, so merging it would bring the broken upstream
  back. While the freeze lasts, edit the manifest on `local/tooling`, copy it to
  `local/tooling-frozen` (based on the tooling `main` already had) and merge that. The broken
  `main` is tag `custom/2026-10-04b`.
- `vendor` stays at `7967153`: rule 1 forbids rewinding it. Until the freeze lifts, `vendor` is
  NOT the base of `main`. Row 3 is based on `2ef352f`, not `vendor`; `git diff vendor <branch>` is
  not the patch while frozen, so use `git diff 2ef352f <branch>`.
- Row 3 (PR #90) was rebased onto `2ef352f` (one import-context conflict from the Defender imports;
  the patch itself is unchanged, and its 415 tests pass in the web-build image). The pre-rebase tip is
  `archive/fix/companion-refused-warp-and-lock/2026-10-04b`.
- Row 3 is on the frozen `main` (merged after the rollback); row 4 is NOT.
- Row 5 runs on the frozen `main` as tag `archive/feat/companion-scanner-ice-sites/2026-10-04`: three
  commits on `2ef352f`, merged with one conflict against row 3 in `warpToAnomalyOfKind` (row 3's
  `visitedLabels`, row 5's `flavour.matches`). The branch itself was then squashed onto `vendor`
  (`b0dfa57`) for its PR, keeping upstream's `scriptScannerSites` in place of row 5's own archetype
  carry, so `git branch --merged main` no longer lists it; the next rebuild merges the branch.
- To lift the freeze: once upstream serves hosted Start without the missing route (or the
  server gains it), do a normal sync from `vendor` and rebuild `main` from the rows below.

The `On main` column is a cache of `git branch --merged main`; if the two disagree, ancestry wins.

| # | Branch | What it carries | Files | Upstream | On main |
| - | ------ | --------------- | ----- | -------- | ------- |
| 1 | `local/tooling` | This workflow: `CLAUDE.md`, this manifest, and the Claude Code hooks registered in `.claude/settings.local.json` -- `guard-live-bot.sh` (refuses restarts that would kill running bots) and `rebuild-when-stale.sh`, each with its test | `CLAUDE.md`, `PATCHES.md`, `.claude/hooks/` | never | yes |
| 2 | `local/deploy` | The hive release pipeline: a `release/*` tag on Gitea builds and pushes the image and moves `deploy/prod`, which Portainer polls; `compose.hive.yaml` joins the evej stack's network and volume as externals | `.gitea/workflows/release.yaml`, `compose.hive.yaml`, `docs/DEPLOYMENT.md` | never | yes |
| 3 | `fix/companion-refused-warp-and-lock` | A refused warp or lock is handled instead of re-pressed to the runner's ten-refusal cap. Since upstream `2fd4a77` the runner commits a block's memory only when its action succeeds, so the warp tour (already in the site = arrived; refused site set aside, next one tried) and the mining lock (would not lock = move on) never saw their own "issued" flag after a refusal. The tour now commits its pick on a wait tick before the warp and reads the refusal from the ledger; the mining lock waits for a known targeting range, holds a far refusal until the rock is 20% closer, and baselines the ledger at pick time. Every other lock that recorded its press on the pressing tick reads the ledger the same way (`readLockRefusals`): salvage, fight-the-rats and the fight-back watch, the drone boat's primary and its pre-lock, the fleet-mate rep and cap locks, and the fight out of a blocked trip home, whose decider is now told the id its presses are booked under. Seen live 2026-10-03/04: five miners sent home by the cap. | `web/src/nav/scriptMacros.ts`, `droneBoatLadder.ts`, `scriptDecide.ts`, `refusalLedger.ts`, `scriptRunnerRefusals.test.ts` (new, real runner + refusing issue), `scriptMacros.test.ts`, `scriptMissionMacros.test.ts` | [#90](https://github.com/rrfarmer/evejs-web-companion/pull/90) (open, based on `2ef352f`) | yes (merged into the frozen main 2026-10-04) |
| 4 | `fix/companion-persist-bridge-sessions` | A BFF restart releases the pilots the previous process held. The bridge handles lived only in memory, so every restart left each selected pilot online at the gateway (`retail_client`) until its 30-minute idle TTL, and hosted Start refused them all ("A web session is flying this character"). The held map now mirrors handle/account/character to `data/bridge-sessions.json`; `startServer` releases those before resuming bots. Seen live 2026-10-04: five pilots refused after the 08:22 rebuild. | `src/bridgeSessionJournal.js` (new), `src/server.js`, `src/bridgeSessionJournal.test.js`, `test/bridgeSessionRestart.test.js` | not yet (verify live first); still based on `7967153` | no (frozen) |
| 5 | `feat/companion-scanner-ice-sites` | Fly to / Mine at "the scanner's ice sites" without a Mining Operation. An ice field is a gravimetric (211) scanner row like an ore site; only archetype 28 tells it apart, so the standalone ore tour flew into ice fields and the `ice-site` mode could not run without an operation (Fly-to refused, and Ice Harvesters were only identified under one). The tours now filter by family (ore skips ice, a new ice tour takes only ice, each with its own visited/barren lists); a site script gets its miners split into ore lasers and ice harvesters (Start refuses an ice script with no harvester); an ice grid mines only ice chunks with only Ice Harvesters and reads "ice chunk" not "rock"; an ice step's hold-full reads the ice hold; the block editor offers the option (not on Fleet Miner). | `web/src/nav/scriptMacros.ts`, `scriptDecide.ts`, `scriptRunner.ts`, `miningSite.ts`, `scannerIceSites.test.ts` (new), `web/src/app/flow.ts`, `web/src/bots/scriptText.ts`, `web/src/ui/BotInspector.svelte` | PR pending (verified live 2026-10-04: ice tour, harvest into the mining hold); branch squashed onto `b0dfa57` | as `archive/feat/companion-scanner-ice-sites/2026-10-04` (frozen main) |

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
