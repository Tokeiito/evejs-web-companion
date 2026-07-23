# Goal R98: Plumbing sweep — Phase-4 bound WRITES: corpRegistry batch C (shares/dividend/kicks/applications/alliance/war) (14) — CLOSES corpRegistry writes

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES — WB-CORPREG split 3 of 3). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R97. BUT this batch is ALL FINANCIAL/DESTRUCTIVE — treat the ENTIRE batch as never-fire: allowlist + confirm-gate + reachability/refusal ONLY. NEVER fire a confirmed happy-path.** Educated-guess responses; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Continues R96/R97 corpRegistry — dispatch TOP-LEVEL on `corpRegistry`, `MachoBindObject` NOT wired, role-gated. Not market files (separate session).

## This batch — WRITES (grep-confirm each `Handle_*` exists in `corpRegistryRuntime.js`) — ALL never-fire

`MoveCompanyShares` (:2201), `MovePrivateShares` (:2205), **`PayoutDividend`** (:2225, ISK), **`KickOutMember`** (:2771, destructive), **`KickOutMembers`** (:2789, destructive), **`ResignFromCEO`** (:2840, destructive), `InsertApplication` (:1679), `InsertInvitation` (:1842), `UpdateApplicationOffer` (:1711), **`AddCorporation`** (:2507, ISK — creates a corp), **`CreateAlliance`** (:2363, ISK — creates an alliance), `ApplyToJoinAlliance` (:2408), `DeleteAllianceApplication` (:2389), **`DeclareWarAgainst`** (:2720, ISK — declares war).

**Every one is financial or destructive** — confirm-gate + reachability/refusal ONLY. Do NOT fire ANY confirmed happy-path (no shares moved, no dividend paid, no member kicked, no CEO resigned, no corp/alliance created, no war declared). Reachability is proven by the allowlist snapshot + isolated gateway test + the refuse-without-confirm smoke — NOT by a live confirmed dispatch.

## Wire-path (from R96/R97): dispatch TOP-LEVEL on `corpRegistry`

Allowlist `{corpRegistry, <method>}`, `heldTopLevelCall`, session corp via `resolveCorporationID(session)`, NO bind two-step, **DO NOT allowlist `corpRegistry.MachoBindObject`**. Role-gated (CEO/director) — a role refusal is CORRECT (note it, don't fix).

## Arg-injection note (flag, don't fix)

Most derive corp from session. Watch **`AddCorporation`/`CreateAlliance`** (spend the session char's ISK — verify source is session), and **`DeclareWarAgainst(targetID)`** (takes a target — declaring war is intended cross-entity, but confirm the DECLARER is the session corp, not a caller-supplied one). If a financial write draws from a caller-supplied foreign source → append to `docs/arg-injection-leak-handoff.md` (write-side, financial). Don't block on exhaustive proof (server-side fix + QA later). Keep plumbed + confirm-gated.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; DO NOT allowlist `corpRegistry.MachoBindObject`; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. **Confirm-gate every write; NEVER fire any financial/destructive write live.**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2390), `tsc` + `build:web` clean.
2. Wire each write top-level per R96/R97: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `corpRegistry` across `webGateway*.test.js` — `webGatewayCorpHangar` names `CreateAlliance`/`DeleteMember`; remove now-allowlisted, keep still-refused). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm ONLY (NEVER fire a confirmed financial/destructive write).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R98 row. Commit by pathspec; report hashes. **Do not push.** **This CLOSES corpRegistry writes (43/43). Next: allianceRegistry / war / PI / dogma / inventory / beyonce / entity / scan / fleet bound writes.**

## Definition of done

The 14 corpRegistry-C writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers, `MachoBindObject` NOT among them), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, **NO financial/destructive write fired live**, no UI, market files untouched. corpRegistry writes complete.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path only).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 19412 / web BFF 50028 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005, corp 98000001, director), `test2` → Test Two (140000002, corp 98000000); any password.
- **Browser pane:** no UI — verify via BFF routes (refusal path only). Say plainly what you could not see.

RETURN: (a) which of the 14 writes landed / skipped (missing-handler reason), (b) confirm-gate + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact + `corpRegistry.MachoBindObject` NOT allowlisted, (f) any write arg-injection issues flagged (esp. financial source), (g) servers healthy + did not push + **explicit confirmation NO financial/destructive write was fired on the live world**.
