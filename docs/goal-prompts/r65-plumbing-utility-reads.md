# Goal R65: Plumbing sweep — utility reads (insurance, corp/alliance fittings, bookmarks)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) and worklist (`docs/plumbing-worklist.md`). Batches R-INS + R-FIT (corp/alliance) + R-BM. Touches insurance/fitting/bookmark files — **not** the market decoder (a separate session owns that).

## ⚠ Ownership-leak check on EVERY read (R63 rule, mandatory)

Verify LIVE what each read returns for an un-owned entity; a read is safe only if it returns the session's own data OR genuinely public data. Skip + cite any leak. (R63 skipped `GetMyCharacterStructures` for leaking a rival corp's reinforce calendar despite its `My` prefix.) The batch below is low-risk but verify, don't assume.

## This batch — top-level READS (grep-confirm each `Handle_*` exists + top-level)

- **insuranceSvc** (`insurance/insuranceService.js`): `GetContracts` (:23 — the char's ship insurance policies), `GetContractForShip` (:59, takes shipID), `GetInsurancePrice` (:43, takes shipTypeID), `GetInsurancePrices` (:50). *(These are ship-INSURANCE contracts, not player contracts.)*
- **corp/alliance fittings:** `corpFittingMgr.GetFittings` (`corpFittingMgrService.js:35`), `corpFittingMgr.GetCommunityFittings` (:50), `allianceFittingMgr.GetFittings` (`allianceFittingMgrService.js:31`). *(charFittingMgr.GetFittings already done in R57 — these are the corp/alliance libraries; confirm they scope to the session's corp/alliance, not arbitrary.)*
- **bookmarks** (`character/accessGroupBookmarkMgrService.js`): `GetMyActiveBookmarks` (:97), `GetFolderInfo` (:202, takes folderID), `SearchFoldersWithAdminAccess` (:218).

## Traps

- **Args:** `GetContractForShip(shipID)`, `GetInsurancePrice(shipTypeID)`, `GetFolderInfo(folderID)` take inputs — capture the retail signature and forward.
- **Wire shapes vary** — decode from **real captured bytes** (`readRowField`/`readRowsetRows`/`readDictEntry`/`unwrapCachedResult` as needed); IDs stay as data (R7d); ISK prices bigint-safe; FILETIMEs bigint.
- **Empty is legitimate** — no insurance policies, no corp/alliance fits, no bookmarks for Farmer is a real state; verify the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler/**leaking**; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push.

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1931/1931**), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions. Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer, hit each new route (real args where needed), capture real bytes, confirm decoders + ownership-safety. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R65 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's read calls are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests, each confirmed non-leaking — no UI, no writes, no market files touched. Snapshot current. Suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — twenty+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 71004), :26500 web (PID 70712, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`) after edit/before commit; verify live.** Own the process; no other `EVEJS_*` overrides; leave all three healthy.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
