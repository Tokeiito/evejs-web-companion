# Goal R97: Plumbing sweep — Phase-4 bound WRITES: corpRegistry batch B (member/corp config + settings) (14)

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES — WB-CORPREG split 2 of ~3). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R96.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). **Continues R96's corpRegistry work** — read `docs/goal-prompts/r96-plumbing-writes-corpreg-a.md`. Not market files (separate session).

## Wire-path (from R96 — follow it): dispatch TOP-LEVEL on `corpRegistry`

Allowlist `{corpRegistry, <method>}`, `heldTopLevelCall`, session corp via `resolveCorporationID(session)`, NO bind two-step, **DO NOT allowlist `corpRegistry.MachoBindObject`**. Role-gated (CEO/director) — a role refusal for a non-director is CORRECT (note it, don't fix). Confirm-gate every write; never fire destructive live.

## This batch — WRITES (grep-confirm each `Handle_*` exists in `corpRegistryRuntime.js`)

**`DeleteTitle`** (:2152, destructive), `UpdateMember` (:1942), `UpdateMembers` (:1980), `UpdateCorporation` (:2468), `UpdateCorporationAbilities` (:2440), `UpdateLogo` (:2452), `UpdateDivisionNames` (:2162), `SetAccountKey` (:1998), `SetCorpWelcomeMail` (:1821), `SetStructureReinforceDefault` (:2705), `RegisterNewAggressionSettings` (:2628), `RegisterNewAcceptStructureSettings` (:2664), `RegisterNewCorpMailRestrictionSettings` (:2680), **`ExecuteActions`** (:2031, a generic corp-action executor — treat as extra-care: it can drive multiple role-gated mutations; confirm-gate + reachability only, do NOT fire live).

**Bold = destructive/extra-care** — confirm-gate + reachability/refusal ONLY, NEVER fired live. The rest are corp config/member/settings updates (confirm-gated; role-gated).

## Arg-injection note (flag, don't fix)

All derive the corp from the session (MachoBindObject un-wired) → act on the SESSION's own corp; a foreign memberID/titleID misses. But `UpdateMember`/`UpdateMembers` mutate a member record — verify they scope the member to the session corp (a member not in the session corp should miss/refuse). If any mutates a foreign entity → append to `docs/arg-injection-leak-handoff.md`; don't block (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; DO NOT allowlist `corpRegistry.MachoBindObject`; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire destructive/extra-care live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2379), `tsc` + `build:web` clean.
2. Wire each write top-level per R96: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `corpRegistry` across `webGateway*.test.js` — `webGatewayCorpHangar` refusal loop names `UpdateDivisionNames`/`UpdateCorporation`, now allowlisted here). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire destructive/extra-care writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R97 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 14 corpRegistry-B writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers, `MachoBindObject` NOT among them), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no destructive/extra-care write fired live, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 65312 / web BFF 34632 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005, corp 98000001, director), `test2` → Test Two (140000002, corp 98000000); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 14 writes landed / skipped (missing-handler reason), (b) confirm-gate + a sample refuses-without-confirm smoke result + any role-refusal, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact + `corpRegistry.MachoBindObject` NOT allowlisted, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no destructive/extra-care write fired.
