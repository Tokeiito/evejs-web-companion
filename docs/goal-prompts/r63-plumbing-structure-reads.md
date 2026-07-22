# Goal R63: Plumbing sweep — structure directory reads

**Issued:** 2026-07-22 (plumbing sweep, Phase-1 reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`) and worklist (`docs/plumbing-worklist.md`). Batch R-STRUCT (`space/structureDirectoryService.js`). **Grep-confirm each `Handle_<Method>` exists + is top-level before adding its pair.**

## ⚠ GOVERNANCE — do NOT wire `GetStructures`

The worklist lists `structureDirectory.GetStructures` (:469), but **R38 deliberately declined it** and the reasoning still holds: it returns **owner-only operational data — fuel expiry, reinforcement timers, vulnerability schedule — for arbitrary structure IDs with no ownership check** (its gated sibling `GetStructureInfo`, already allowlisted in R38, does the ownership check). Wiring `GetStructures` would let any logged-in browser read any structure's operational calendar. **Skip it, cite R38.** More generally: **any read here that returns owner-only operational data for a structure the character does not own must be skipped and reported** — prefer the session-scoped `My*` reads.

## This batch — top-level READS (session-scoped / safe)

- `GetMyCharacterStructures` (:432), `GetMyCorporationStructures` (:438), `GetMyDockableStructures` (:457) — session-scoped, safe.
- `GetCorporationStructures` (:453) — your own corp's; confirm it scopes to the session's corp, not an arbitrary corpID (if it takes an arbitrary corpID and leaks, skip + report).
- `GetStructureMapData` (:489), `GetStructureDescription` (:507) — public-ish; confirm they don't leak owner-only operational fields; if a description read only returns name/type/location that's fine.
- `CheckMyDockingAccessToStructures` (:544), `GetMyAccessibleOnlineCynoBeaconStructures` (:553), `GetSolarSystemsWithBeacons` (:572), `GetValidWarHQs` (:587), and `GetJumpBridgesWithMyAccess` if the handler exists — all `My*`/access-scoped, safe.

`structureDirectory.GetStructureInfo` is already allowlisted (R38) — don't re-add. **Wire only the session/access-scoped reads; skip `GetStructures` and anything that leaks owner-only data for un-owned structures.**

## Traps

- **Ownership leakage is the R38 lesson** — some reads gate on ownership, some don't. Check what each returns for a structure the char doesn't own before wiring. When unsure, skip + report rather than wire.
- **Args:** ID-taking reads (`GetStructureDescription(structureID)`, `CheckMyDockingAccessToStructures([ids])`) forward the input.
- **Wire shapes vary / player structures are runtime data** (R38) — decode from **real captured bytes**; structure IDs are int64 (>2^32); IDs stay as data (R7d).
- **Empty is legitimate** — Farmer may own no structures; verify the empty path.

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report bound/no-handler/**ownership-leaking**; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**. Never `git add -A`; never push.

## Invariants

**R7d** IDs kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined `node --test` (expect **1882/1882**), `tsc` + `build:web` clean.
2. Wire the safe reads per the contract; **skip `GetStructures` (R38) and any ownership-leaking read, with the reason**. Tests watched failing first, from real bytes. Update the allowlist snapshot (isolated runner).
3. **Verify live:** `rrfarmer` → Farmer, hit each new route, capture real bytes, confirm decoders. Report real shapes + empty-but-legitimate results, and explicitly which reads you skipped for ownership-leak reasons. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R63 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The session/access-scoped structure read calls are allowlisted (existing handlers), reachable via BFF, decoded from real bytes with tests — no UI, no writes. `GetStructures` and any owner-only-data leak are left unwired with cited reasons. Snapshot current. Suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow`. `webGatewayEvents` GREEN (8/8); `webGatewayServiceCall` needs the **isolated runner**; rare `skillsPanel`/`planetsPanel` time-flakes rerun green — rerun the full suite before assuming a single failure is yours.
- **Watch new tests fail first** — twenty+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS (PID 8296), :26500 web (PID 39952, SPA at `/`), :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`) after edit/before commit; verify live.** Own the process; no other `EVEJS_*` overrides; leave all three healthy.
- **You are the only BUILD worker.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer, `test2` → Test Two; any password.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
