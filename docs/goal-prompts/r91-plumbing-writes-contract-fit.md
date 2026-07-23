# Goal R91: Plumbing sweep — Phase-3 WRITES: contracts + fittings (W-CONTRACT + W-FIT) (16)

**Issued:** 2026-07-23 (plumbing sweep, Phase-3 top-level WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R90.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R90 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic test; **un-stale refusal tests (heavy)**; NEVER fire financial/destructive writes live. Not market files (separate session — but contractProxy is NOT a market file; contract writes are yours).

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**contractProxy (11)** (`contractProxyService.js`): `CreateContract` (:803), **`AcceptContract`** (:819, financial), `CompleteContract` (:826), **`DeleteContract`** (:835, destructive), **`DeleteMultipleContracts`** (:841, destructive), **`PlaceBid`** (:850, ISK), `FinishAuction` (:855), `SplitStack` (:860), `DeleteNotification` (:886), `DeleteContractNotification` (:891), **`GM_ExpireContract`** (:908, **admin — expect 403 for a normal session; wire the pair, note the 403**).

**charFittingMgr + corpFittingMgr (5)**: `charFittingMgr.SaveManyFittings` (`charFittingMgrService.js:67`), **`charFittingMgr.DeleteFitting`** (:86, destructive), **`charFittingMgr.DeleteManyFittings`** (:103, destructive), `charFittingMgr.UpdateNameAndDescription` (:120); `corpFittingMgr.SaveManyFittings` (`corpFittingMgrService.js:88`). (Fitting READS wired R57/R65 — reuse those BFF route files.)

**Bold = financial/destructive/admin** — confirm-gate + reachability/refusal ONLY, NEVER fired live. `AcceptContract`/`PlaceBid` move ISK/items; `DeleteContract*`/`DeleteFitting*` destroy data; `GM_ExpireContract` is admin (403 expected). The save/complete/split/update writes are normal — confirm-gated.

## Arg-injection note (flag, don't fix)

`AcceptContract(contractID)`/`DeleteContract(contractID)`/`PlaceBid(contractID)` take a caller contractID (contract READS already leak per handoff #11 — the WRITES likely share the no-visibility-check flaw: accept/delete/bid on a contract you're not party to). READ each handler quickly: does it validate the contract's party/visibility against the session? If unguarded → append to `docs/arg-injection-leak-handoff.md` (write-side). Don't block on exhaustive proof (server-side fix + QA later). Keep plumbed + confirm-gated.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write; never fire financial/destructive live.

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2326), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. **Un-stale ALL refusal tests/enumerations** (grep each method + `contractProxy`/`charFittingMgr`/`corpFittingMgr` across `webGateway*.test.js` — `webGatewayContracts`/`webGatewayFitting` have refusal loops naming these writes). Update the snapshot. Restart EveJS; smoke-check routes refuse-without-confirm (do NOT fire financial/destructive writes).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R91 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The contract/fitting writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, no financial/destructive write fired live, `GM_ExpireContract` 403 noted, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 51360 / web BFF 39392 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes. Say plainly what you could not see.

RETURN: (a) which of the 16 writes landed / skipped (missing-handler reason), (b) confirm-gate pattern + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged (esp. contract accept/delete/bid) + the GM_ExpireContract 403, (g) servers healthy + did not push + no financial/destructive write fired.
