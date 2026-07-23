# Goal R95: Plumbing sweep — Phase-4 bound WRITES: skills + clones + safety (WB-SKILL + WB-CLONE + WB-CRIME) (17)

**Issued:** 2026-07-23 (plumbing sweep, **Phase-4 bound WRITES — first Phase-4 batch**). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R94.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R94 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**; NEVER fire destructive/financial writes live. Not market files (separate session).

## Phase-4 wire-path — these dispatch TOP-LEVEL, session-scoped (like their reads)

The reads R73/R76/R78 established that **`skillHandler`, `jumpCloneSvc`, `crimewatch` dispatch on the ordinary top-level `/call` seam** (session-derived; `MachoBindObject` NOT wired). These WRITES dispatch the same way — allowlist `{skillHandler, <method>}` / `{jumpCloneSvc, <method>}` / `{crimewatch, <method>}` (grep-confirm the service string the gateway sees, same as R73/R76/R78). Reuse the `heldTopLevelCall` pattern; NO bind two-step.

## This batch — WRITES (grep-confirm each `Handle_*` exists in the service file; SKIP+report missing)

**WB-SKILL — service `skillHandler`, handlers in `skillMgrService.js` (8):** `CharStartTrainingSkill` (:402), `AbortTraining` (:525), `ApplyFreeSkillPoints` (:504), **`ExtractSkills`** (:562, DESTROYS SP into an injector), `InjectSkillpoints` (:531), `SplitSkillInjector` (:572), `CombineSkillInjector` (:582), **`InjectSkillIntoBrain`** (:353, CONSUMES a skillbook).

**WB-CLONE — service `jumpCloneSvc`, `jumpCloneService.js` (8):** **`InstallCloneInStation`** (:70, spends ISK), **`InstallCloneInStructure`** (:75, ISK), `CloneJump` (:94), **`DestroyInstalledClone`** (:89, destructive), `SetJumpCloneName` (:80), `OfferShipCloneInstallation` (:105), `AcceptShipCloneInstallation` (:110), `CancelShipCloneInstallation` (:115).

**WB-CRIME — service `crimewatch`, `crimewatchService.js` (1):** `SetSafetyLevel` (:67, sets the char's safety flag — safe-ish, session-scoped).

**Bold = destructive/financial** — confirm-gate + reachability/refusal ONLY, NEVER fired live (`ExtractSkills`/`InjectSkillIntoBrain` destroy/consume; `InstallClone*`/`CloneJump`/`DestroyInstalledClone` spend/destroy).

## Arg-injection note (flag, don't fix)

These derive the character from the session (like their reads). Verify quickly that none takes a caller-supplied charID and mutates a foreign char's skills/clones. If unguarded → append to `docs/arg-injection-leak-handoff.md`; don't block on exhaustive proof (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire destructive/financial live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2358), `tsc` + `build:web` clean.
2. Wire each write TOP-LEVEL per the R73/R76/R78 pattern: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `skillHandler`/`skillMgr`/`jumpCloneSvc`/`crimewatch` across `webGateway*.test.js` — the reads' refusal sweeps named these writes). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire destructive/financial writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R95 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 17 skill/clone/safety writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no destructive/financial write fired live, no UI, market files untouched. First Phase-4 batch — establishes that bound writes dispatch top-level like the reads.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 37644 / web BFF 27852 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) the resolved dispatch (service string per group) + which of the 17 writes landed / skipped (missing-handler reason), (b) confirm-gate + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged, (g) servers healthy + did not push + no destructive/financial write fired.
