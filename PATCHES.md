# Patch manifest

Every branch carried on top of `vendor`, in the order it is merged into `main`. This file is the
authority: a patch not listed here is lost on the next rebuild, and a patch listed here is one
somebody has decided is still needed. See `CLAUDE.md` for the workflow.

**Vendor:** `origin/master` at `7967153` (2026-10-04, PR #89 merged). `main` as it ran before this sync is tag `custom/2026-10-04`.

The `On main` column is a cache of `git branch --merged main`; if the two disagree, ancestry wins.

| # | Branch | What it carries | Files | Upstream | On main |
| - | ------ | --------------- | ----- | -------- | ------- |
| 1 | `local/tooling` | This workflow: `CLAUDE.md`, this manifest, and the Claude Code hooks registered in `.claude/settings.local.json` -- `guard-live-bot.sh` (refuses restarts that would kill running bots) and `rebuild-when-stale.sh`, each with its test | `CLAUDE.md`, `PATCHES.md`, `.claude/hooks/` | never | yes |
| 2 | `local/deploy` | The hive release pipeline: a `release/*` tag on Gitea builds and pushes the image and moves `deploy/prod`, which Portainer polls; `compose.hive.yaml` joins the evej stack's network and volume as externals | `.gitea/workflows/release.yaml`, `compose.hive.yaml`, `docs/DEPLOYMENT.md` | never | yes |
| 3 | `fix/companion-refused-warp-and-lock` | A refused warp or lock is handled instead of re-pressed to the runner's ten-refusal cap. Since upstream `2fd4a77` the runner commits a block's memory only when its action succeeds, so the warp tour (already in the site = arrived; refused site set aside, next one tried) and the mining lock (would not lock = move on) never saw their own "issued" flag after a refusal. The tour now commits its pick on a wait tick before the warp and reads the refusal from the ledger; the mining lock waits for a known targeting range, holds a far refusal until the rock is 20% closer, and baselines the ledger at pick time. Seen live 2026-10-03/04: five miners sent home by the cap. | `web/src/nav/scriptMacros.ts`, `scriptRunnerRefusals.test.ts` (new, real runner + refusing issue), `scriptMacros.test.ts`, `scriptMissionMacros.test.ts` | not yet opened | yes |

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
