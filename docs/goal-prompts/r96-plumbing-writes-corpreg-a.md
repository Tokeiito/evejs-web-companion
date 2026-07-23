# Goal R96: Plumbing sweep — Phase-4 bound WRITES: corpRegistry batch A (bulletins/labels/contacts/titles) (15)

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES — WB-CORPREG split 1 of ~3). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R95.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R95 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**; NEVER fire destructive writes live. Not market files (separate session).

## Wire-path — dispatch TOP-LEVEL on `corpRegistry` (like the R80-82 reads)

The R80/R81/R82 reads proved corpRegistry dispatches on the ordinary top-level `/call` seam (session corp via `resolveCorporationID(session)`; **`corpRegistry.MachoBindObject` NOT wired** — keeps a foreign corp unbindable). These WRITES dispatch the same way — allowlist `{corpRegistry, <method>}`, `heldTopLevelCall`, NO bind two-step, DO NOT allowlist `MachoBindObject`.

## Role-gating (EXPECTED — not a bug)

corpRegistry writes are CEO/director-role-gated. A normal-member session (or a session lacking the role) gets a **role refusal / error return** — that is CORRECT server behavior, note it, do NOT try to "fix" it. Farmer may be CEO of corp 98000001 (so some may succeed the role check) — but still confirm-gate + reachability only; do NOT fire destructive ones.

## This batch — WRITES (grep-confirm each `Handle_*` exists in `corpRegistryRuntime.js`)

`AddBulletin` (:1561), `UpdateBulletin` (:1598), `UpdateBulletinOrder` (:1622), **`DeleteBulletin`** (:1610, destructive), `CreateLabel` (:1431), `EditLabel` (:1462), **`DeleteLabel`** (:1449, destructive), `AssignLabels` (:1481), `RemoveLabels` (:1506), `AddCorporateContact` (:1360), `EditCorporateContact` (:1378), **`RemoveCorporateContacts`** (:1382, destructive), `EditContactsRelationshipID` (:1398), `UpdateTitle` (:2122), `UpdateTitles` (:2143).

**Bold = destructive** — confirm-gate + reachability/refusal ONLY, NEVER fired live. The rest are corp-admin writes (confirm-gated; role-gated so may refuse anyway).

## Arg-injection note (flag, don't fix)

corpRegistry writes derive the corp from the session (MachoBindObject un-wired) → they act on the SESSION's own corp; a foreign bulletinID/labelID/titleID simply misses the session-corp table. Verify quickly (like the reads). If any takes a caller-supplied corpID and mutates a foreign corp → append to `docs/arg-injection-leak-handoff.md`; don't block on exhaustive proof (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; DO NOT allowlist `corpRegistry.MachoBindObject`; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire destructive live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2369), `tsc` + `build:web` clean.
2. Wire each write top-level per the corpRegistry read pattern: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `corpRegistry` across `webGateway*.test.js` — `webGatewayCorpHangar` has a corpRegistry writer refusal loop; the R80-82 read snapshots). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire destructive writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R96 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 15 corpRegistry-A writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers, `MachoBindObject` NOT among them), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no destructive write fired live, role-gating noted, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 33972 / web BFF 65900 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005, corp 98000001), `test2` → Test Two (140000002, corp 98000000); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 15 writes landed / skipped (missing-handler reason), (b) confirm-gate + a sample refuses-without-confirm smoke result + any role-refusal seen, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact + `corpRegistry.MachoBindObject` NOT allowlisted, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no destructive write fired.
