# Goal R89: Plumbing sweep — Phase-3 WRITES: FINANCIAL cluster (ISK / LP / insurance / bounty) (15)

**Issued:** 2026-07-23 (plumbing sweep, Phase-3 top-level WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R88 BUT this is the FINANCIAL cluster: EVERY write here spends/transfers ISK or LP, or affects kill rights. ⚠⚠ NONE of these may be FIRED on the live world — allowlist + confirm-gate + verify reachability + refuses-without-confirm ONLY. NEVER dispatch a happy-path mutation.** Educated-guess decoders (they won't be exercised); only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R88 write pattern (`requireWriteConfirmation`, un-stale refusal tests). Not market files (separate session).

## This batch — FINANCIAL WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing) — ALL reachability-only, NEVER fired

**account (3)** (`accountService.js`): `SetContactCost` (:632), **`GiveCash`** (:697, ISK transfer), **`GiveCashFromCorpAccount`** (:739, corp ISK transfer).

**LP transfers (5)**: `LPSvc.ExchangeConcordLP` (`lpService.js:164`), **`LPSvc.TransferLPFromMyWalletToOtherCorp`** (:120), **`LPSvc.TransferLPFromMyCorpWalletToOtherCorp`** (:137); **`LPStoreMgr.TakeOfferForCharacter`** (`lpStoreMgrService.js:543`, spends LP), **`LPStoreMgr.TakeOfferForCorporation`** (:569).

**insuranceSvc (2)**: **`InsureShip`** (`insuranceService.js:66`, spends ISK), `UnInsureShip` (:82).

**bounty / kill rights (5)**: **`bountyProxy.AddToBounty`** (`bountyProxyService.js:376`, spends ISK), `bountyProxy.SellKillRight` (:525), `bountyProxy.CancelSellKillRight` (:554); `killRightMgr.ActivateKillRight` (`killRightMgrService.js:171`), **`killRightMgr.BuyKillRight`** (:197, spends ISK).

**Bold = spends/transfers ISK or LP** — extra-explicit confirm message; NEVER fired. (The whole batch is financial; treat ALL 15 as never-fire.)

## The WRITES contract (SAFETY — CRITICAL here)

1. Allowlist pair (existing `Handle_*` only). 2. **Confirm-gated BFF POST route** (`requireWriteConfirmation` — no `confirm` ⇒ refused; give ISK/LP writes an explicit "this spends/transfers ISK" message). 3. Educated-guess decoder (never exercised). 4. Basic test (route-refuses-without-confirm + decoder shape). 5. Update snapshot + **un-stale refusal tests (heavy** — grep each of the 15 methods + the 6 service names across `webGateway*.test.js`; these financial writes are currently asserted-refused). 6. **⚠ NEVER FIRE ANY of these live** — verify ONLY reachability (route exists) + refuses-without-confirm. Do NOT send a confirmed happy-path with a live session that would actually move ISK/LP. If you must prove allowlist landing, use an `/api/bridge/call` that the server will REFUSE for another reason (no target / no funds), never a successful transfer.

## Arg-injection note (flag, don't fix)

A financial write that acts on a caller-supplied FOREIGN source (e.g. `GiveCashFromCorpAccount` for a corp you're not in, `TransferLPFromMyCorpWalletToOtherCorp` draining another corp's LP) is the write-side arg-injection class — and the WORST kind (moves someone else's money). Note + append to `docs/arg-injection-leak-handoff.md` if the handler doesn't scope the SOURCE to the session. Don't block on exhaustive proof (server-side fix + QA later). Keep plumbed + confirm-gated.

## Hard rules

**Bridge-only, existing handlers only** (never a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. **Confirm-gate every write; NEVER fire any financial write live.**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2303), `tsc` + `build:web` clean.
2. Wire each write: allowlist + confirm-gated BFF POST route + educated-guess decoder + basic test. Un-stale ALL refusal tests/enumerations. Update snapshot. Restart EveJS; smoke-check routes refuse-without-confirm ONLY (NEVER fire a financial mutation).
3. Append result + decisions to `docs/afk-session-log.md`; roadmap R89 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 15 financial writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic tests — refusal tests/enumerations un-staled so the suite is GREEN, snapshot current, **NO financial write fired live**, no UI, market files untouched.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- Servers: :26002 EveJS, :26500 web, :40111 market daemon RPC. **You add gateway pairs → restart EveJS (detached `Start-Process -WindowStyle Hidden`, canonical `EVEJS_PROXY_LOCAL_INTERCEPT=1`, from `eve.js/server`) after edit/before commit; smoke-check live (refusal path only).** Own the process (never a background bash shell); no other `EVEJS_*` overrides; leave all three healthy. Confirm current PIDs from a fresh check (last known EveJS 51392 / web BFF 25460 / market 54808). **Log hygiene:** detached logs → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. **Logins:** `rrfarmer` → Farmer (140000005), `test2` → Test Two (140000002); any password.
- **Browser pane:** no UI — verify via BFF routes (refusal path only). Say plainly what you could not see.

RETURN: (a) which of the 15 writes landed / skipped (missing-handler reason), (b) confirm-gate pattern + a sample refuses-without-confirm smoke result, (c) which refusal tests/enumerations you un-staled, (d) final web suite count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged (esp. foreign-source ISK/LP), (g) servers healthy + did not push + **explicit confirmation NO financial write was fired on the live world**.
