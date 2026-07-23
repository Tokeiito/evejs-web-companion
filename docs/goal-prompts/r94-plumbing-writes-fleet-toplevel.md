# Goal R94: Plumbing sweep — Phase-3 WRITES: fleet top-level (W-FLEETPROXY + W-FLEETMGR) (11) — CLOSES Phase-3

**Issued:** 2026-07-23 (plumbing sweep, Phase-3 top-level WRITES, fast mode — LAST Phase-3 batch). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R93.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R93 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**; NEVER fire outward writes live. Not market files (separate session).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**fleetObjectHandler (1, top-level)** (`fleetObjectHandlerService.js`): `CreateFleet` (:116, creates a fleet). *(Its MachoBindObject bind was wired R72; the fleet BOUND writes are Phase-4/WB-FLEET, NOT this batch.)*

**fleetProxy (4)** (`fleetProxyService.js`): `ApplyToJoinFleet` (:21), `AddFleetFinderAdvert` (:29, public advert), `RemoveFleetFinderAdvert` (:34), `UpdateAdvertInfo` (:44). *(fleetProxy READS wired R66 if present — reuse.)*

**fleetMgr (6)** (`fleetMgrService.js`): `ForceLeaveFleet` (:11), `AddToWatchlist` (:15), `RemoveFromWatchlist` (:23), `RegisterForDamageUpdates` (:31), **`BroadcastToBubble`** (:38, outward — messages fleet), **`BroadcastToSystem`** (:50, outward — messages fleet).

**Bold = outward** (`BroadcastToBubble`/`BroadcastToSystem` send a message to the fleet) — confirm-gate + reachability/refusal ONLY, do NOT actually broadcast live. The rest are fleet-management writes (confirm-gated; Farmer is fleetless/docked so most return a not-in-fleet error anyway).

## Arg-injection note (flag, don't fix)

Fleet writes act on the session's own fleet (resolved from session). If any takes a caller-supplied fleetID and acts on it with no membership check (like the R85 fleet READS, handoff #26-30), note + append to `docs/arg-injection-leak-handoff.md`; don't block on exhaustive proof (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire outward live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2354), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `fleetObjectHandler`/`fleetProxy`/`fleetMgr` across `webGateway*.test.js` — the R69 `deniedCalls` sweep named surviving fleetProxy advert mutators; R72/R85 touched fleetObjectHandler). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT broadcast live).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R94 row. Commit by pathspec; report hashes. **Do not push.** **This CLOSES all Phase-3 top-level writes (except the 3 deferred PLEX writes). Next is Phase-4 bound writes (149).**

## Definition of done

The 11 fleet writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no outward write fired live, no UI, market files untouched. Phase-3 top-level writes complete.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 31936 / web BFF 21300 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 11 writes landed / skipped (missing-handler reason), (b) confirm-gate pattern + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no outward write fired.
