# Goal R90: Plumbing sweep — Phase-3 WRITES: ship + fighter in-space ops (W-SHIP + W-FIGHTER) (23)

**Issued:** 2026-07-23 (plumbing sweep, Phase-3 top-level WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R89.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R89 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**; NEVER fire the extra-care writes live. Not market files (separate session).

**Live note:** Farmer is DOCKED — most ship/fighter ops require being in space, so they are NOT live-exercisable. Verify reachability + refuses-without-confirm only; educated-guess the responses (QA later).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**ship (14)** (`shipService.js`): **`Eject`** (:1746), `LeaveShip` (:1586), `BoardStoredShip` (:1602), `StoreVessel` (:1641), `AssembleShip` (:1327), `FitShips` (:1469), `ConfigureShip` (:1797), `Scoop` (:1173), `ScoopToMobileDepotHold` (:1191), **`Jettison`** (:1240), `LaunchFromShip` (:1254), `LaunchFromContainer` (:1267), **`Drop`** (:1294), **`SafeLogoff`** (:1869).

**fighterMgr (9)** (`fighterMgrService.js`): `LoadFightersToTube` (:305), `UnloadTubeToFighterBay` (:348), `LaunchFightersFromTubes` (:373), `RecallFightersToTubes` (:381), `ExecuteMovementCommandOnFighters` (:395), `CmdActivateAbilitySlots` (:406), `CmdDeactivateAbilitySlots` (:423), **`CmdAbandonFighter`** (:439), `CmdScoopAbandonedFighterFromSpace` (:447).

**Bold = extra-care** (irreversible or leaves-state-in-space): `Eject`/`SafeLogoff` (change session state), `Jettison`/`Drop` (dump cargo to space — could lose items), `CmdAbandonFighter` (abandons a fighter). Confirm-gate + reachability/refusal ONLY, NEVER fired live. The rest are ship/fighter management — confirm-gated; Farmer is docked so most just return a not-in-space error anyway.

## Arg-injection note (flag, don't fix)

Ship/fighter writes act on the session's own ship/fighters (resolved from session). If any takes a caller-supplied itemID/shipID and acts on it with no ownership check (like R75's inventory reads), note + append to `docs/arg-injection-leak-handoff.md`; don't block on exhaustive proof (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire extra-care writes live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2317), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `ship`/`fighterMgr` across `webGateway*.test.js` — ship already has many allowlisted movement pairs; check `webGatewayFlightVerbs`/`webGatewayDronesAndHostiles`/`webGatewayTargetingActivation` enumerations). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire extra-care writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R90 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The ship/fighter writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no extra-care write fired live, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 51216 / web BFF 36980 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 23 writes landed / skipped (missing-handler reason), (b) confirm-gate pattern + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no extra-care write fired.
