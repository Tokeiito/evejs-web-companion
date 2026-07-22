# Goal R61: Plumbing sweep — corp reads (corpmgr, corp LP)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) and worklist (`docs/plumbing-worklist.md`). Batches R-CORPMGR + R-LP. **Grep-confirm each `Handle_<Method>` exists + is top-level before adding its pair.**

## This batch — top-level READS

**corpmgr** (`corporation/corpmgrService.js`):
- `GetPublicInfo` (:439), `GetCorporationIDForCharacter` (:475), `GetCorporations` (:481)
- `GetAssetInventory` (:534) and `GetAssetInventoryForLocation` (:553) — **⚠ CRowset via `buildCachedMethodCallResult`** (unwrap the cached-result wrapper, then the CRowset — same shape R37 personalAssets and R55 compositions handled; reuse `readRowField`/the CRowset path, don't hand-roll)
- `SearchAssets` (:574), `GetAggressionSettings` (:487), `GetAggressionSettingsForCorps` (:500), `AuditMember` (:510)

**corp LP:**
- `LPSvc.GetAllMyCorporationWalletLPBalances` (`lpService.js:100`)
- `LPStoreMgr.GetAvailableOffersFromCorp` (`lpStoreMgrService.js:520`)

`corpRegistry.GetCorporation` is already allowlisted (R2-era) and is BOUND — don't confuse `corpmgr` (top-level, this batch) with `corpRegistry` (bound, a later batch).

## Traps

- **CRowset + cached-result wrapper** on the two asset-inventory reads — unwrap both layers; decode from **real captured bytes**.
- **Some reads may take args** (`GetAssetInventoryForLocation(locationID)`, `AuditMember(memberID)`, `SearchAssets(query)`) — capture the retail signature and forward. `GetCorporationIDForCharacter(charID)` likely wants the char id.
- **Data seeding:** Farmer's player corp 98000001 may have sparse corp assets — an empty asset inventory is a legitimate state, not a bug. Verify the empty path and say so.
- **IDs stay as data** (R7d); longs bigint-safe.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**. Never `git add -A`; never push.

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1823/1823**), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions (esp. any that turn out bound). Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer (corp 98000001), hit each new route (with real args where needed), capture real bytes, confirm decoders. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R61 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's corp read calls are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests (CRowset unwrapped correctly) — no UI, no writes. Snapshot current. Suite green. Report which landed / skipped with reasons.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — eighteen+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 57176), :26500 web (PID 30036, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`) after edit/before commit so the running server serves the committed pairs; verify live.** Own the process; no other `EVEJS_*` overrides; leave all three healthy.
- **You are the only BUILD worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
