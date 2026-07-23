# Goal R92: Plumbing sweep — Phase-3 WRITES: in-space services (sov + ESS + abyssal + pvp) (W-SOV + W-ESS + W-ABYSS + W-PVP) (16)

**Issued:** 2026-07-23 (plumbing sweep, Phase-3 top-level WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R91.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R91 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**; NEVER fire admin/financial writes live. Not market files (separate session).

**Live note:** Farmer is DOCKED — these in-space service ops need being in space / at an ESS / in an abyss, so they are NOT live-exercisable. Verify reachability + refuses-without-confirm only; educated-guess responses.

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**sovMgr (3)** (`sovMgrService.js`): `SetSovHubFuelAccessGroup` (:66), **`DestroySkyhooks`** (:76, **admin — expect 403**), **`AcquireSkyhooks`** (:80, **admin — expect 403**).

**essMgr (5)** (`essMgrService.js`): `AttemptLinkToMainBank` (:214), `AttemptLinkToReserveBank` (:239), `RequestMainBankUnlink` (:264), `RequestReserveBankUnlink` (:279), **`RequestUnlockReserveBank`** (:298, **ISK payout — reachability only**).

**abyssalMgr (5)** (`abyssalMgrService.js`): `AbyssalEntranceDeployment` (:73), `AbyssalEntranceGateActivation` (:81), `AbyssalGateActivation` (:89), `AbyssalEndGateActivation` (:97), `ClientIsReady` (:105).

**pvpFilamentMgr (3)** (`pvpFilamentMgrService.js`): `JoinPVPQueue` (:149), `LeavePVPQueue` (:155), `AbyssalPVPEndGateActivation` (:160).

**Bold = admin/financial** — confirm-gate + reachability/refusal ONLY, NEVER fired live; `*Skyhooks` are admin (403 expected — wire the pair, note it), `RequestUnlockReserveBank` is an ISK payout. The rest are in-space activation/link ops (confirm-gated; docked → most return a not-in-space error anyway).

## Arg-injection note (flag, don't fix)

These act on the session's current system / ESS / abyss (resolved from session position). If any takes a caller-supplied system/structure id and acts on it with no scope check, note + append to `docs/arg-injection-leak-handoff.md`; don't block on exhaustive proof (server-side fix + QA later). Keep plumbed.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire admin/financial live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2342), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `sovMgr`/`essMgr`/`abyssalMgr`/`pvpFilamentMgr` across `webGateway*.test.js` — the reads were wired R66/R69, so the writes may be in refusal sweeps). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire admin/financial writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R92 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 16 in-space service writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no admin/financial write fired live, `*Skyhooks` 403 noted, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 45436 / web BFF 66280 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 16 writes landed / skipped (missing-handler reason), (b) confirm-gate pattern + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged + the `*Skyhooks` 403, (g) servers healthy + did not push + no admin/financial write fired.
