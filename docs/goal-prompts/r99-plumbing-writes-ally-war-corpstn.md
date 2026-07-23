# Goal R99: Plumbing sweep — Phase-4 bound WRITES: alliance + war + corp-station (WB-ALLYREG + WB-WARREG + WB-CORPSTN) (20)

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R98.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R98 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**; NEVER fire financial/destructive/outward writes live. Not market files (separate session).

## Wire-path — dispatch TOP-LEVEL (like their reads R83/R84/R79)

`allianceRegistry`, `warRegistry`, `corpStationMgr` dispatch on the ordinary top-level `/call` seam (session-derived; their `MachoBindObject` NOT wired). Allowlist `{allianceRegistry|warRegistry|corpStationMgr, <method>}`, `heldTopLevelCall`, NO bind two-step, **DO NOT allowlist any `MachoBindObject`**. allianceRegistry/warRegistry writes are exec-role-gated (a role refusal is CORRECT — note it, don't fix).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**allianceRegistry (10)** (`allianceRegistryRuntime.js`): `SetRelationship` (:826), **`DeleteRelationship`** (:839, destructive), `AddAllianceContact` (:571), `AddBulletin` (:741), `UpdateApplication` (:436), **`PayBill`** (:927, ISK), `SetPrimeHour` (:857), `SetCapitalSystem` (:878), `DeclareExecutorSupport` (:517), `UpdateAlliance` (:421).

**warRegistry (9)** (`warRegistryService.js`): `CreateWarAllyOffer` (:186), `RetractWarAllyOffer` (:210), `CreateSurrenderNegotiation` (:226), **`AcceptAllyNegotiation`** (:261, consequential), `DeclineAllyOffer` (:267), **`AcceptSurrender`** (:293, consequential — ends a war), **`DeclineSurrender`** (:299), `RetractMutualWar` (:283), `SetOpenForAllies` (:315).

**corpStationMgr (1)** (`corpStationMgrService.js`): **`MoveCorpHQHere`** (:313, moves corp HQ — consequential/ISK).

**Bold = financial/destructive/consequential** — confirm-gate + reachability/refusal ONLY, NEVER fired live (`PayBill`/`MoveCorpHQHere` spend ISK; `DeleteRelationship` destroys; the surrender/ally accepts change war state). The rest are governance writes (confirm-gated; exec-role-gated).

## Arg-injection note (flag, don't fix)

allianceRegistry writes derive the alliance from the session (like R83/R84 reads); warRegistry from the session's war entity. Verify quickly none takes a caller-supplied allianceID/warID and mutates a foreign entity. `PayBill(billID)` — verify the payer is the session, not caller-supplied. If unguarded → append to `docs/arg-injection-leak-handoff.md` (write-side); don't block (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; DO NOT allowlist any `MachoBindObject`; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire financial/destructive/consequential live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2403), `tsc` + `build:web` clean.
2. Wire each write top-level per the read pattern: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `allianceRegistry`/`warRegistry`/`corpStationMgr` across `webGateway*.test.js`). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire financial/destructive/consequential writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R99 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 20 alliance/war/corp-station writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers, no `MachoBindObject`), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no financial/destructive/consequential write fired live, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 40836 / web BFF 62096 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005, corp 98000001); `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 20 writes landed / skipped (missing-handler reason), (b) confirm-gate + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no financial/destructive/consequential write fired.
