# Goal R60: Plumbing sweep — lookup / presence / social reads

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) and the worklist (`docs/plumbing-worklist.md`). Batches R-LOOKUP + R-ONLINE + R-SOCIAL. **Grep-confirm each `Handle_<Method>` exists + is top-level before adding its pair.**

## This batch — top-level READS

**lookupSvc** (`corporation/lookupSvcService.js`) — name/id search; **these take a QUERY arg** (the BFF route passes a `?q=`/search param through, e.g. `LookupCharacters(query, exactMatch)`), so wire the route to accept and forward the search args:
- `LookupCharacters` (:445), `LookupOwners` (:498), `LookupPCOwners` (:515), `LookupEvePlayerCharacters` (:454), `LookupCorporations` (:480), `LookupFactions` (:489), `LookupKnownLocationsByGroup` (:553), `LookupNoneNPCAccountOwners` (:531), `LookupWarableCorporationsOrAlliances` (:576)

**onlineStatus** (`online/onlineStatusService.js`):
- `GetOnlineStatus` (:31), `GetInitialState` (:41), `Prime` (:48)

**social:**
- `LSC.GetChannels` (`chat/lscService.js:46`), `account.GetDefaultContactCost` (`accountService.js:628`)

## Traps

- **Search args:** lookupSvc methods need input (a query string, sometimes an exact-match flag / id list). Capture the retail call signature from `ClientCodeGrabber` and forward the args; a zero-arg call returns nothing useful. A too-short/empty query may legitimately return `[]` — that's fine.
- **`LSC` / `onlineStatus` binding:** confirm top-level (a Moniker = bound → defer + note). `Prime` may be a no-op/void — if so, note it and still wire it (it's a real call).
- **Wire shapes vary** — decode from **real captured bytes**, `readRowField`/`readRowsetRows`/`readDictPairs` (all in `wire.ts` now) as needed; IDs stay as data (R7d); longs bigint-safe.
- **Empty is legitimate.**

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**. Never `git add -A`; never push.

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1790/1790**), `tsc` + `build:web` clean.
2. Wire each read per the contract; skip+report exceptions. Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer, hit each new route (with a real query for the lookups — e.g. search "Farmer"/"Caldari"), capture real bytes, confirm decoders. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R60 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The batch's read calls are allowlisted (existing handlers), reachable via BFF (search args forwarded for lookups), decoded from real bytes with tests — no UI, no writes. Snapshot current. Suite green. Report which landed / skipped with reasons.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — seventeen+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 30292), :26500 web (PID 22428, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`) after edit/before commit so the running server serves the committed pairs; verify live.** Own the process; no other `EVEJS_*` overrides; leave all three healthy.
- **You are the only BUILD worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
