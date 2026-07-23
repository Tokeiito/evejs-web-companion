# Goal R100: Plumbing sweep — Phase-4 bound WRITES: dogma module ops batch A (WB-DOGMA split 1 of 2) (11)

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R99.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R99 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**. Not market files (separate session).

## ⚙ NEW SERVER PROTOCOL (operator now owns EveJS) — READ THIS

**DO NOT start or restart EveJS (:26002) OR the web BFF (:26500).** The operator manages EveJS restarts. Verify your work WITHOUT a running-server smoke:
- Allowlist correctness → the **isolated eve.js test**: `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js` (checks the `WEB_CALL_ALLOWLIST` array directly — no server needed).
- Routes/decoders + the **route-refuses-without-confirm** assertion → your **web `node --test`** unit tests (a unit test of the route handler, NOT a live `curl`).
- **No live smoke, no `Start-Process`, no server restart of any kind.** The new pairs go live whenever the operator next restarts EveJS. State this in your report.

## Phase-4 two-step — off the dogmaIM bind (R74)

These are BOUND writes off `dogmaIM.MachoBindObject` (wired R72; the R74 dogma READS use `dogmaBindSpec()` + `boundCall` in `src/server.js`). Mirror that: bind → boundHandle → the write dispatches against it via `boundCall(dogmaBindSpec(), ...)`. Do NOT invent a new mechanism.

## This batch — WRITES (grep-confirm each `Handle_*` exists in `dogmaService.js`)

`RemoveTargets` (:6742), `ClearTargets` (:6754), `Overload` (:8250), `OverloadRack` (:8267), `StopOverload` (:8283), `StopOverloadRack` (:8300), `InitiateModuleRepair` (:8316), `InitiateModuleRepairMany` (:8336), `StopModuleRepair` (:8361), `LinkWeapons` (:6957), `MergeModuleGroups` (:6983).

These are ship-module ops (overload / module-repair / target-drop / weapon-link) — reversible-ish in-space actions, no ISK, no permanent destruction. Confirm-gate all; none is destructive-of-assets, so this batch has no "never-fire" writes — but you're not firing anything anyway (no live server this batch).

## Arg-injection note (flag, don't fix)

Dogma writes act on the session's own ship (resolved from session, like the R74 reads — `_getShipID(session)`). Verify quickly none takes a caller-supplied moduleID/shipID and acts on a foreign ship. If unguarded → append to `docs/arg-injection-leak-handoff.md`; don't block (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write. **NO server restart (operator owns EveJS).**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2412), `tsc` + `build:web` clean.
2. Wire each write off the dogmaIM bind (mirror `dogmaBindSpec`/`boundCall`): allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `dogmaIM` across `webGateway*.test.js` — `webGatewayTargetingActivation`/`webGatewayDronesAndHostiles` have dogmaIM enumerations/refusal loops). Update the snapshot.
3. **Verify via `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js` + web `node --test` — NO server restart, NO live smoke.**
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R100 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 11 dogma module-op writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers) off the dogmaIM bind, reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN (isolated eve.js test + web `node --test`), snapshot current, no UI, market files untouched, NO server restarted.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- **Servers:** EveJS (:26002) + web BFF (:26500) are OPERATOR-MANAGED — do NOT restart them. Market daemon :40111 untouched. **Log hygiene:** any temp files → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** not needed (no live smoke this batch).
- **Browser pane:** no UI — verified via unit tests only.

RETURN: (a) which of the 11 writes landed / skipped (missing-handler reason) + the bind mechanism used, (b) confirm-gate pattern + how the refuse-without-confirm is unit-tested (not live), (c) which refusal tests/enumerations you un-staled, (d) final web `node --test` count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) confirmation you did NOT restart EveJS or the web BFF + did not push.
