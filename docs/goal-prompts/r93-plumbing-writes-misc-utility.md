# Goal R93: Plumbing sweep — Phase-3 WRITES: misc utility (agent / petition / industry / PI / structure / asset-safety) (13)

**Issued:** 2026-07-23 (plumbing sweep, Phase-3 top-level WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R92.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R92 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**; NEVER fire destructive/outward writes live. Not market files (separate session).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**agentMgr (4)** (`agentMgrService.js`): `RemoveOfferFromJournal` (:856), `GotoLocation` (:910), `WarpToLocation` (:936), `WarpToAgentInSpace` (:1048). *(Nav writes — need to be in space; Farmer docked. agentMgr READS wired R64 — reuse its route file.)*

**petitioner (3)** (`petitionerService.js`): **`CreatePetition`** (:203, opens a support ticket — outward-ish), `PetitionerChat` (:226), `CancelPetition` (:249). *(petitioner READS wired R70 if present — reuse.)*

**industryManager (1)** (`industryManagerService.js`): `CompleteManyJobs` (:73).

**planetMgr (1)** (`planetMgrService.js`): **`DeleteLaunch`** (:1304, destructive).

**structureDirectory (1)** (`structureDirectoryService.js`): `SetStructureDescription` (:517).

**structureAssetSafety (3)** (`structureAssetSafetyService.js`): **`MovePersonalAssetsToSafety`** (:254), **`MoveCorpAssetsToSafety`** (:271), **`MoveSafetyWrapToStructure`** (:288). *(Moving assets — consequential.)*

**Bold = destructive/consequential/outward** — confirm-gate + reachability/refusal ONLY, NEVER fired live. `DeleteLaunch` destroys, asset-safety moves relocate assets, `CreatePetition` opens a ticket. The nav/chat/complete writes are confirm-gated (docked → nav returns not-in-space anyway).

## Arg-injection note (flag, don't fix)

If any takes a caller-supplied id and acts on another entity's data with no scope check (e.g. `MoveCorpAssetsToSafety` for a corp you're not in, `SetStructureDescription` on a foreign structure), note + append to `docs/arg-injection-leak-handoff.md`; don't block on exhaustive proof (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire destructive/outward live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2348), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + the 6 service names across `webGateway*.test.js`). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire destructive/outward writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R93 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 13 misc-utility writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no destructive/outward write fired live, no UI, market files untouched. **This finishes all Phase-3 top-level writes except fleet (W-FLEETPROXY + W-FLEETMGR = R94) and the deferred PLEX writes.**

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 46608 / web BFF 69776 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 13 writes landed / skipped (missing-handler reason), (b) confirm-gate pattern + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no destructive/outward write fired.
