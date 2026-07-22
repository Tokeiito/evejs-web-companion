# Goal R67: Fix the stale refusal tests the plumbing sweep created

**Issued:** 2026-07-22 (correction, not a plumbing batch). **Status:** Ready. **eve.js TESTS ONLY (permitted bridge surface) — no allowlist, no BFF, no client changes.**

## The problem

The plumbing sweep (R57–R66) allowlisted many reads. Workers kept `webGatewayServiceCall.test.js`'s central snapshot current, but **several per-service gateway tests have their OWN "these methods are refused / this service is out of slice" assertions**, and those went stale — a method the sweep legitimately allowlisted is still asserted refused, so the test now gets 200 and fails.

Confirmed failing (isolated runner):
- `webGatewayContracts.test.js` — `contractProxy.GetItemsInContainer` (**already fixed**, eve.js `500bf112` — leave it).
- `webGatewayAgentMgr.test.js` — `agentMgr.GetMissionJournalInfo` (R64).
- `webGatewayCourierComplete.test.js` — `LPSvc.GetAllMyCorporationWalletLPBalances` (R61).
- `webGatewayMail.test.js` — asserts *"the mailingListsMgr service is out of slice — no pair may name it"*, but R59 allowlisted `mailingListsMgr` reads.

**And there are ~10 more `webGateway*.test.js` files I did not check** — some may have refusal lists touching swept services (corpmgr, structureDirectory, marketProxy, bountyProxy, warsInfoMgr, calendarMgr, notificationMgr, lookupSvc, insuranceSvc, corp/allianceFittingMgr, accessGroupBookmarkMgr). **Sweep them all.**

## What to do

1. **Run every `server/tests/webGateway*.test.js` via the isolated runner** (`npm run test:isolated -- server/tests/<file>`). Find every failure caused by the plumbing sweep — i.e. a method or service the test asserts is refused / out-of-slice that is now legitimately on `WEB_CALL_ALLOWLIST`.
2. **Fix each stale assertion the RIGHT way:** remove the now-allowlisted method from the refusal list (or, for a service-level "no pair may name it" assertion like `webGatewayMail`'s mailingListsMgr, update it to reflect that the service now has allowlisted READS while its WRITES stay refused — assert the writes still refuse, don't just delete the check). **Cross-check `WEB_CALL_ALLOWLIST` for each: only move a method out of "refused" if it is actually allowlisted now.**
3. **DO NOT weaken a still-valid assertion.** A method that is still refused MUST stay asserted-refused. A mutator/write that is still not allowlisted MUST stay in the refusal list. The security property these tests protect is real — you are correcting staleness, not loosening the gate. When in doubt, keep the assertion and verify against the live allowlist.
4. **Do NOT touch** the known-failing `webGatewayMarket`/`GetCharEscrow` case (pre-existing, unrelated) or `webGatewayEvents`/`droneRuntimeParity`. If `webGatewayMarket` has a NEW stale refusal from the sweep (distinct from GetCharEscrow), fix that one and say so, but leave GetCharEscrow.
5. Verify **every** `webGateway*.test.js` green via the isolated runner at the end. Also run the combined web `node --test` (expect **1974/1974**) to confirm no web regression.

## Hard rules

- **eve.js test files only** (`server/tests/webGateway*.test.js`). No allowlist change, no BFF, no client change, no `Handle_*`. Another agent has in-flight destiny/parity work on `ReconcileEliteMode` — commit by pathspec, only the test files you fix; verify `git status` after. Never `git add -A`; never push.
- **A separate session is fixing market decoder files** — you touch eve.js tests only, no overlap.

## Required work

1. Run all `webGateway*.test.js` (isolated), list every failure and its cause.
2. Fix each stale assertion; keep every still-valid refusal. Commit by pathspec; report the exact methods/services corrected and which tests.
3. Confirm all `webGateway*.test.js` green + web suite 1974/1974.
4. Append result to `docs/afk-session-log.md`; roadmap R67 row. **Do not push.**

## Definition of done

Every `webGateway*.test.js` is green (except the pre-existing `GetCharEscrow`/`droneRuntimeParity`), each stale refusal from the sweep corrected without weakening a still-valid one, and you report the full list of methods/services fixed. This unblocks the sweep's assertion that "bridge-only held."

## Constraints

- Servers: :26002 EveJS (PID 68976), :26500 web (PID 23224), :40111 market daemon RPC. This goal is test-only — no server restart needed; leave all three healthy.
- **You are the only BUILD-ish worker** (a separate market-decoder session and read-plumbing are paused for this). Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's.
- Report exactly which test files + methods you corrected, and confirm you weakened no still-valid refusal.
