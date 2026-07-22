# Goal R62: Plumbing sweep — trading reads (market, contract)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) and worklist (`docs/plumbing-worklist.md`). Batches R-MARKET + R-CONTRACT. **Grep-confirm each `Handle_<Method>` exists + is top-level before adding its pair.**

## This batch — top-level READS

**marketProxy** (`market/marketProxyService.js`) — the market panel's existing reads (SearchContracts etc. and the item-market reads) are already allowlisted; these are the corp-orders + PLEX reads:
- `GetCorporationOrders` (:3498), `CorpGetTransactions` (:3597 — **bigint ISK amounts**), `GetPlexOrders` (:3711), `GetPlexBest` (:3670), `GetPlexHistory` (:3754), `GetPlexOldPriceHistory` (:3768), `GetPlexNewPriceHistory` (:3780)

**contractProxy** (`_other/contractProxyService.js`) — `SearchContracts`/`GetContract` are already allowlisted (contracts panel, R32-decoded); these are the my-bids / escrow / items reads:
- `GetMyBids` (:728), `GetMyContractEscrow` (:703), `NumOutstandingContracts` (:712), `GetItemsInContainer` (:865), `GetItemsInDockableLocation` (:878), `GetNumItemsInContainers` (:873), `GetCourierContractFromItemID` (:896)

## Traps

- **⚠ `GetMyContractEscrow` (contractProxy) is NOT the known-failing `webGatewayMarket`/`GetCharEscrow` test** — different call, different service. **Do not touch that failing test or its call.** If confusion arises, skip and report.
- **R32 shapes:** contract data uses `buildPackedRow` (detail rows) vs `buildKeyVal` (list rows), and FILETIMEs/large IDs arrive as **bare decimal strings**. Decode via `readRowField` (dispatches packedrow/KeyVal) + the bigint-tolerant path. `CorpGetTransactions` amounts are bigint ISK. Build from **real captured bytes**.
- **Args:** `GetItemsInContainer(containerID)`, `GetItemsInDockableLocation(locationID)`, `GetCourierContractFromItemID(itemID)`, `GetNumItemsInContainers([ids])` take inputs — capture the retail signature and forward.
- **Empty is legitimate** — no corp orders, no bids, no PLEX history for this world is a real state, not a bug. Verify the empty path and say so.
- **IDs stay as data** (R7d); longs bigint-safe.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**. Never `git add -A`; never push.

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1849/1849**), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions. Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer, hit each new route (real args where needed), capture real bytes, confirm decoders. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R62 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's market + contract read calls are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests — no UI, no writes, the failing GetCharEscrow test untouched. Snapshot current. Suite green. Report which landed / skipped with reasons.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (**note the GetMyContractEscrow caution above**). `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — nineteen+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 52872), :26500 web (PID 42392, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal — note the market daemon backs some market reads). **You add gateway pairs → restart EveJS (detached `Start-Process`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`) after edit/before commit; verify live.** Own the process; no other `EVEJS_*` overrides; leave all three healthy.
- **You are the only BUILD worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
