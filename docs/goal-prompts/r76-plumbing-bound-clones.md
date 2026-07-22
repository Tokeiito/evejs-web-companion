# Goal R76: Plumbing sweep — Phase-2 bound reads: jump clones (RB-CLONE) (6)

**Issued:** 2026-07-22 (plumbing sweep, Phase-2 bound reads). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI, no writes.**

Follows the PLUMBING CONTRACT (`docs/goal-prompts/r57-plumbing-toplevel-reads.md`, incl. **step 7**) + worklist (`docs/plumbing-worklist.md`, RB-CLONE). `jumpCloneSvc` bound reads (Moniker keyed on solarsystem/station). Clone files only — not market files (separate session).

## Phase-2 mechanics — RESOLVE the bind first (like R73 did for skillHandler)

`jumpCloneSvc` is a bound service (worklist: "Moniker keyed on solarsystem/station"). FIRST TASK: grep how the retail client obtains the `jumpCloneSvc` moniker/bind and how the gateway dispatches these reads — is there a top-level `Get*` that returns the moniker (like `GetMySkillHandler`), or a `MachoBindObject` two-step (like `dogmaIM`/`invbroker`)? Wire whatever the gateway actually dispatches on, mirroring the established pattern (R73 skillHandler moniker, R74 dogma two-step, R75 invbroker bind). Confirm the service string the allowlist pair must name.

## ⚠ OWNERSHIP + ARG-INJECTION CHECK per read (R63 + the 2026-07-22 audit — MANDATORY)

These return the SESSION's clone state — but they take a **station / system / structure id** as a location filter, and `/api/bridge/call` forwards args verbatim. Verify each returns the SESSION's OWN clones (a location id is a filter, NOT an owner selector) under attacker-chosen args: read the handler + live-probe with a foreign station/system id and confirm it returns Farmer's own clone state at that location, never another character's clones. If any read takes a **charID** and returns a foreign char's clones with no session check → arg-injection LEAK: **keep plumbed but FLAG it in `docs/arg-injection-leak-handoff.md`** (do NOT de-allowlist — operator's flag-only decision). Clones/implants are private.

## This batch — bound READS off the jumpCloneSvc bind (grep-confirm each `Handle_*` exists in `jumpCloneService.js`)

`GetCloneState` (:40), `GetStationCloneState` (:45), `GetShipCloneState` (:50), `GetNumClonesInPilotsStructure` (:55), `GetPriceForClone` (:60), `ValidateInstallJumpClone` (:65).

## Traps

- **Args:** `GetStationCloneState(stationID)`, `GetNumClonesInPilotsStructure(structureID)`, `GetPriceForClone`/`ValidateInstallJumpClone` (station/structure) take a location id — capture the retail signature; forward exactly. An argless call that needs an id returns empty — a 200 is not proof.
- **`ValidateInstallJumpClone` is a READ-style validator** (returns whether an install is allowed + a reason) — it must NOT install anything; confirm it's non-mutating before wiring (if it has side effects, treat as a write and DEFER to the writes phase + report).
- **Wire shapes:** decode from **real captured bytes**; clone ids/station ids stay as data (R7d); ISK price (`GetPriceForClone`) bigint-safe; FILETIMEs bigint. Carry LOCAL coercions; do NOT import from `web/src/bridge/market*.ts`.
- **Empty is legitimate** — a char with no jump clones at a given station is a real state; verify + assert the empty path. (Farmer is a maxed char — likely has clones somewhere.)

## Hard rules

Same as the sweep: **bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing/leaking (leaking → flag in the handoff doc, keep plumbed) / mutating-validator (defer); commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); a 200 is not proof; don't chase mechanics; **reads only**; **do not touch market files**. Never `git add -A`; never push. **CONTRACT STEP 7: grep every `webGateway*.test.js` for each method + `jumpCloneSvc` and un-stale any refusal assertion; update the `webGatewayServiceCall` snapshot via the isolated runner.**

## Invariants

**R7d** IDs/ISK kept as data · **R18** `panelFirstMount` unaffected — stays green.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2119), `tsc` + `build:web` clean.
2. Resolve the jumpCloneSvc bind; wire each read per the contract. Tests watched failing first, from real bytes. Snapshot updated; per-service refusal tests un-staled.
3. **Verify live:** `rrfarmer` → Farmer, obtain the bind, hit each read; capture real bytes; confirm decoders AND run the arg-injection check (foreign location/char id → own clones or refusal). Report real shapes, empty-but-legitimate results, `ValidateInstallJumpClone`'s non-mutating confirmation, and any leak flagged into the handoff doc. Session short; leave Farmer docked.
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R76 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The clone bound reads (minus any skipped for no-handler/mutating, with reason) are allowlisted (existing handlers), reachable via the BFF off the jumpCloneSvc bind, decoded from real bytes with tests, each ownership-checked under arg-injection (own clones only, or flagged-and-kept-plumbed) — no UI, no writes, market files untouched. Snapshot current, per-service refusal tests un-staled, suite green.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner**; it reports pass/fail at the FILE level — check subtest tallies. Rare `skillsPanel`/`planetsPanel` time-flakes rerun green.
- **Watch new tests fail first** — 20+ tests here have been caught passing while asserting nothing.
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC (RPC not HTTP; curl 000 normal). **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; verify live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 43232 / web BFF 23508 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password. Use test2 for the arg-injection cross-check.
- **Browser pane:** no UI — verify via BFF routes + decoder tests against real bytes. Say plainly what you could not see.
