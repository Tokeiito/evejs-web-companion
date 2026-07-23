# Goal R88: Plumbing sweep — Phase-3 WRITES: character + social (W-CHAR1 + W-CHAR2 + W-SOCIAL) (18)

**Issued:** 2026-07-23 (plumbing sweep, Phase-3 top-level WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86/R87.** Educated-guess models/responses; SKIP heavy testing (basic tests to keep suite green); only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86/R87 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation` — no `confirm` ⇒ refused) + educated-guess decoder + basic test; **un-stale refusal tests/enumerations (heavy)**; NEVER fire destructive writes live. Not market files (separate session).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**charMgr (12)** (`charMgrService.js`): `SetCharacterDescription` (:945), `SetActivityStatus` (:956), `LogSettings` (:975), `AddContact` (:887), `DeleteContacts` (:906), `EditContactsRelationshipID` (:914), `BlockOwners` (:929), `UnblockOwners` (:937), `SetNote` (:1047), `AddOwnerNote` (:1014), `EditOwnerNote` (:1022), `RemoveOwnerNote` (:1032). (charMgr READS wired R58 — reuse its BFF route file.)

**charUnboundMgr (5)** (`charService.js`): `CancelCharacterDeletePrepare` (:1456), `ToggleValidation` (:1480), **`CreateCharacterWithDoll`** (:824, creates a character — unusual/heavy), `UpdateCharacterGender` (:1116), `UpdateCharacterBloodline` (:1144).

**LSC (1)** (`lscService.js`): **`SendMessage`** (:80, sends a chat message — an outward message).

**⚠ Extra-care writes:** `CreateCharacterWithDoll` (creates a whole character — treat as heavy: confirm-gate + reachability/refusal ONLY, never fired live), `CancelCharacterDeletePrepare` (char-lifecycle), `LSC.SendMessage` (sends a message to a channel — confirm-gate + reachability/refusal only, do NOT actually send a live message). The contact/note writes are safe/reversible (may be triggered-and-reverted, optional in fast mode).

## Arg-injection note (flag, don't fix)

A write mutating a caller-supplied FOREIGN entity (`SetNote`/`AddOwnerNote` for another char's note store, `EditContactsRelationshipID` on someone else's list) is the write-side arg-injection class. Note + append to `docs/arg-injection-leak-handoff.md` if clearly unguarded; don't block on exhaustive proof (server-side fix + QA later). Keep plumbed. (Notes/contacts are usually session-char scoped — verify quickly.)

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit pairs by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire destructive/outward writes live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2293), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** for each allowlisted write (grep each method + the 3 service names across `webGateway*.test.js`). Update the snapshot (isolated runner). Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire destructive/outward writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R88 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The character/social writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no destructive/outward write fired live, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live.** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 38764 / web BFF 48668 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 18 writes landed / skipped (missing-handler reason), (b) confirm-gate pattern + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no destructive/outward write fired.
