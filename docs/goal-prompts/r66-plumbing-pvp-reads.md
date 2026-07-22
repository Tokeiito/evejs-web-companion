# Goal R66: Plumbing sweep — pvp-info reads (bounties, wars)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) + worklist (`docs/plumbing-worklist.md`). Batches R-BOUNTY (remaining) + R-WAR1 + R-WAR2. Bounty/war files only — **not** market files (separate session).

## ⚠ Ownership-leak check per read (R63). Verify LIVE; skip+cite any leak. (Bounties/wars are largely public data — low risk — but verify.)

## This batch — top-level READS (grep-confirm each `Handle_*` exists + top-level)

**bountyProxy** (`bounty/bountyProxyService.js`; `GetMyKillRights` already done R57):
- `GetBounties` (:460), `GetMyBounties` (:490), `GetKillRightsOnCharacters` (:510), `GetBountiesAndKillRights` (:469), `GetTopPilotBounties` (:592), `GetTopCorpBounties` (:596), `GetTopAllianceBounties` (:600), `SearchCharBounties` (:616)

**warsInfoMgr** (`warsInfoMgrService.js`):
- `GetWarsByOwnerID` (:146), `GetWarsByOwners` (:159), `GetTop50` (:191), `GetWarsRequiringAssistance` (:174), `GetWarsForStructure` (:215), `GetPublicWarInfo` (:209)

**warStatisticMgr** (`warStatisticMgrService.js`):
- `GetKillMail` (:178) — **⚠ verify-first binding: reachable top-level AND via a `GetWarStatistic` moniker. Confirm which the BFF should use (prefer top-level `/call` if it answers); if it's genuinely bound-only, defer + note.**

## Traps

- **Args:** most bounty/war reads take an owner/character/war/structure ID (`GetBounties([charIDs])`, `GetKillRightsOnCharacters([ids])`, `GetWarsByOwnerID(ownerID)`, `GetWarsForStructure(structureID)`, `GetPublicWarInfo(warID)`, `GetKillMail(killID/warID)`) — capture the retail signature and forward.
- **Wire shapes vary** — decode from **real captured bytes**; bounty amounts + kill values are bigint ISK; IDs stay as data (R7d); FILETIMEs bigint.
- **Empty is legitimate** — no bounties on Farmer, no active wars in this world is a real state; verify the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler/leaking; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push.

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1946/1946**), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions (esp. `GetKillMail` binding). Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer, hit each new route (real args where needed), capture real bytes, confirm decoders + ownership-safety. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R66 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's bounty/war read calls are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests, each confirmed non-leaking — no UI, no writes, market files untouched. `GetKillMail` binding resolved. Snapshot current. Suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — twenty+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 1988), :26500 web (PID 64976, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`) after edit/before commit; verify live.** Own the process; no other `EVEJS_*` overrides; leave all three healthy.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
