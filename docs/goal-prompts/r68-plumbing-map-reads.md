# Goal R68: Plumbing sweep — map / starmap reads (17)

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready (fire after R67 test-fix lands). **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) + worklist (`docs/plumbing-worklist.md`). Batch **R-MAP** (the whole `map` service read set). Map files only — **not** market files (separate session).

## ⚠ Ownership-leak check per read (R63, MANDATORY). Verify LIVE; skip+cite any leak.

Most map reads are public starmap/region data — low risk — BUT three have a personal/`My` scope and MUST be verified against an un-owned entity before allowlisting:
- `GetMyExtraMapInfo`, `GetMyExtraMapInfoAgents` — the `My` prefix is NOT proof of session-scoping (R63 lesson: `GetMyCharacterStructures` leaked a rival's calendar). Verify they return only the session's own extra-map layer.
- `GetSolarSystemVisits`, `GetHistory` — may be personal visit/jump history; confirm they're the session's own, not another character's.

## This batch — top-level READS (grep-confirm each `Handle_*` exists + top-level in `mapService.js`)

`GetStationCount` (:659), `GetSolarsystemItems` (:572), `GetHistory` (:495), `GetSolarSystemVisits` (:510), `GetBeaconCount` (:517), `GetCurrentSovData` (:590), `GetRecentSovActivity` (:596), `GetFacWarZoneInfo` (:581), `GetDeadspaceAgentsMap` (:526), `GetDeadspaceComplexMap` (:532), `GetMyExtraMapInfo` (:551), `GetMyExtraMapInfoAgents` (:556), `GetConstellationLPData` (:561), `GetAllRoamingWeatherSystems` (:567), `GetSecurityModifiedSystems` (:436), `GetIncursionGlobalReport` (:475), `GetSystemsInIncursions` (:485).

## Traps

- **Args:** several take a solarsystem / constellation / region ID (`GetSolarsystemItems(systemID)`, `GetStationCount(systemID?)`, `GetConstellationLPData(constellationID)`, `GetSystemsInIncursions`/`GetIncursionGlobalReport` may be argless). Capture the retail signature from the client and forward exactly; an argless call that actually needs an ID will silently return empty (a 200 is not proof).
- **Wire shapes vary** — decode from **real captured bytes**, not a guess (briefs have guessed wrong repeatedly). Expect big CRowset/dict payloads for the system-map reads; use `unwrapCachedResult`/`readRowsetRows`/`readDictPairs` as the shape dictates. IDs stay as data (R7d); any ISK/LP values bigint-safe; FILETIMEs bigint.
- **Empty is legitimate** — no incursions, no fac-war zones, no roaming weather in this seeded world is a real state; verify the empty path and say so.
- **`GetSecurityModifiedSystems`** overlaps conceptually with the already-different `securityMgr.get_modified_systems` — this is the **map** one; wire `map.GetSecurityModifiedSystems` only.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler/**leaking**; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push.

**PLUMBING CONTRACT step 7 (un-stale refusal tests) — DO NOT SKIP.** After allowlisting, `grep -rn` each new method AND the `map` service across `server/tests/webGateway*.test.js`; if any test asserts a method you just allowlisted is refused / the service is out-of-slice, update that assertion (remove the now-allowed READ; keep still-refused writes asserted). Run every affected test via the isolated runner and confirm green. R67 existed only because prior batches skipped this — do not recreate the debt.

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green, `tsc` + `build:web` clean. (Check the current pass count and hold ≥ it.)
2. Wire each read per the contract; skip+report exceptions. Tests watched failing first, from real bytes. Update the `webGatewayServiceCall` allowlist snapshot (isolated runner) AND un-stale any per-service refusal test (contract step 7).
3. **Verify live:** `rrfarmer` → Farmer, hit each new route (real args where needed — capture the client's real signature first), capture real bytes, confirm decoders + ownership-safety on the four `My`/history reads. Report real shapes + empty-but-legitimate results. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R68 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 17 `map` read calls (minus any skipped for leak/no-handler, with reason) are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests, each confirmed non-leaking — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (value 4650≠2450), `webGatewayPersistentSession`:244 (station-id 60000004≠60003760 — world-data drift, predates the sweep, an allowlist gate cannot cause/fix it). `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours. The isolated runner reports pass/fail at the FILE level — a one-subtest red shows as "0 passed, 1 failed"; check subtest tallies.
- **Watch new tests fail first** — twenty+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web (SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`) after edit/before commit; verify live.** Own the process; no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh `netstat`/health check — do not trust a stale PID.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
