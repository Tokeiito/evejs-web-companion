# Patch manifest

`main` is `vendor` plus one `--no-ff` merge per branch below, in this order. Git and GitHub are the
truth: `git log --first-parent vendor..main` says what is merged, and the PR says what upstream has
been offered. This file is only the merge order the rebuild replays. Every branch that is not
`local/*` is an open upstream PR; a feature without one does not go on `main`. See `CLAUDE.md`.

**Vendor:** `origin/master` at `b7e1376c` (2026-10-19, corporation member IDs kept from login). `main` as it ran before this sync is tag `custom/2026-10-19.2`.

| # | Branch | PR |
| - | ------ | -- |
| 1 | `local/tooling` | never |
| 2 | `local/deploy` | never |
| 3 | `fix/companion-pi-haul-final-products` | [#113](https://github.com/rrfarmer/evejs-web-companion/pull/113) |
| 4 | `fix/companion-pi-restart-budget` | [#114](https://github.com/rrfarmer/evejs-web-companion/pull/114) |
| 5 | `fix/companion-launcher-keeps-target` | [#115](https://github.com/rrfarmer/evejs-web-companion/pull/115) |
| 6 | `feat/companion-fleet-combat` | [#131](https://github.com/rrfarmer/evejs-web-companion/pull/131) |
| 7 | `pr/companion-site-salvager` | [#132](https://github.com/rrfarmer/evejs-web-companion/pull/132) |
| 8 | `pr/redeem-items` | [#134](https://github.com/rrfarmer/evejs-web-companion/pull/134) |
| 9 | `fix/companion-persist-bridge-sessions` | [#135](https://github.com/rrfarmer/evejs-web-companion/pull/135) (seen live 2026-10-19) |
| 10 | `fix/companion-pi-haul-from-space` | [#136](https://github.com/rrfarmer/evejs-web-companion/pull/136) (seen live 2026-10-19) |
| 11 | `fix/companion-pi-haul-tax-funds` | [#137](https://github.com/rrfarmer/evejs-web-companion/pull/137) (seen live 2026-10-19) |
| 12 | `feat/login-rewards` | [#138](https://github.com/rrfarmer/evejs-web-companion/pull/138) |
| 13 | `feat/server-messages` | [#139](https://github.com/rrfarmer/evejs-web-companion/pull/139) (seen live 2026-10-19) |
| 14 | `fix/bridge-abyss-strip-only` | [#140](https://github.com/rrfarmer/evejs-web-companion/pull/140) (bot engine loads in the live BFF 2026-10-20) |

## Synced 2026-10-19 (nineteenth sync): `main` rebuilt from the PR branches

Upstream moved 4 commits (`1df61ef3`..`b7e1376c`: corporation member IDs, native chat conversations), which
merged into the old `main` without a conflict. The old 55 rows were 6 PRs split finer (#131 alone was 41 rows)
plus 7 features no PR carried. Those 7 are now PRs #135-#139, except drone aggro and rearm, which need #131's
companion loop and went into #131. `main` is now these 13 branches; the old rows are tags
`archive/<branch>/2026-10-19`. Checked: each PR branch merged into the rebuilt old `main` changes nothing, and the
new `main`'s tree equals the old `main` replayed onto `b7e1376c`. #131 and #132 had kept code the previous sync
re-expressed on `main` only (upstream's targeters read, the park's `OnDbuffUpdated`, upstream's bookmark folder
writes); both now match `main`. Each branch's own tests on master: no failing test name that master does not
already fail. The previous sync (eighteenth) was never pushed and never moved its branches; this one supersedes it.

## Synced 2026-10-19 (eighteenth sync): `fix/companion-account-in-use` retired

Upstream moved 423 commits (`c88f3e3`..`1df61ef3`): the client's waypoints and autopilot, the Locations window's
folders, the fitting window's dogma, abyssal gates, chat private rooms, and the client's own dialogs. Retired:
`fix/companion-account-in-use` (was row 56), never rebased: upstream fixed the closed retail client its own way
(`1a13deba`, `2d6f28e4`, `dbb78b67`); its branch is tag `archive/fix/companion-account-in-use/2026-10-19`. No
other row was taken upstream. Re-expressed against it (noted in their rows): `fix/companion-recall-before-ordered-warp`
(the targeters read is upstream's), `wip/companion-park-setstate-main` (a test hears upstream's `OnDbuffUpdated`),
`feat/companion-site-salvager` (the folder plumbing is upstream's), `feat/server-messages` (one import). Every
other row replayed as it was: vendor-based rows rebased onto the new `vendor`, the `wip/*-main` rows each as its
own commits onto the rebuilt `main` at its place, old `main`'s hand resolutions at each merge carried forward. The
rebuilt tree was checked against a target built first (old `main` with the retired row reverted, merged with the
new `vendor`, the same re-expressions): identical but for the order of two fields in `SpaceEntity`. Upstream's
`web/src/bridge/abyssObjectives.ts` uses a TypeScript parameter property, which Node's strip-only mode cannot load,
so 132 web test files fail to load on `vendor` alone; the suites were compared with
`NODE_OPTIONS=--experimental-transform-types`: the rebuilt tree fails the same 93 BFF and 114 web test names as `vendor` alone, `tsc` clean, the web-build stage builds. Found for later: upstream's whole-SetState target wipe against the
re-asks of `fix/companion-drone-state-lost` and `wip/companion-park-setstate-main` (noted there).

## Synced 2026-10-15 (seventeenth sync): nothing retired

Upstream moved 386 commits (`a6d5d3f`..`c88f3e3`): mail, contacts, notifications, and some 370 BFF routes
retired for the page's own calls (docking, reprocessing, mail, drone launch, module activation). No row was
taken upstream. Three rows were re-expressed against it (`feat/companion-target-modes`, `wip/companion-passive-modules-main`, `feat/companion-site-salvager`, noted in their rows); every other row
replayed as it was, the `wip/*-main` rows each as its own commits only, onto the rebuilt `main` at its place.
The rebuilt tree was checked against a target built first (old `main` merged with the new `vendor`, its
conflicts resolved and the module calls moved to `switchModuleOn`/`Off`): identical. The target's suites
failed the same 45 BFF and 9 web test names as `vendor` alone; `tsc` clean.

## Retired 2026-10-13 (sixteenth sync): upstream ported the missile itself

Upstream did not merge #117; it ported the ballpark's MISSILE mode its own way in `2fd33844` (CCP's
`EvolveMissile`, `MissileFollow` and `PyLaunchMissile`, with nine Tranquility missiles as a fixture), which
conflicts with the branch in all three of its files. Ours went further only in a defender missile's collision
candidates, which upstream steps without and counts (`unported.defenderMissiles`); that never froze a park.
#117 is closed as superseded.

- `fix/companion-destiny-missile` -- [#117](https://github.com/rrfarmer/evejs-web-companion/pull/117)

The same sync took 259 upstream commits (`8c26fba`..`a6d5d3f`) and moved `main` off the `8c26fba`-based
`wip/*-main` lines: every row is now its PR branch rebased on `vendor`, merged once. The row 9 branch
(drone state) gained the never-stop commit main already ran. The rebuilt tree was checked against old `main`
with row 9's merge reverted and merged with the new `vendor`: equal but for the order of two fields in one
object literal. Web suite 8138/0 failing, BFF failures the same 8 names as `vendor` alone, `tsc` clean.

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
