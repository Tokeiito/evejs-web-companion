# Goal R104: Plumbing sweep — Phase-4 bound WRITES: probe / scan control (WB-SCAN 9)

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R103.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R103 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic UNIT test; **un-stale refusal tests (heavy)**. Not market files (separate session).

## ⚙ SERVER PROTOCOL (operator owns EveJS) — DO NOT restart EveJS (:26002) OR the web BFF (:26500)

Verify WITHOUT a running-server smoke: allowlist via `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js`, routes/decoders + refuse-without-confirm via web `node --test` UNIT tests. NO live smoke, NO `Start-Process`, NO server restart. New pairs go live when the operator next restarts EveJS. State this in your report.

## Phase-4 two-step — off the scanMgr bind (no new MachoBindObject pair, no caller args)

These are BOUND writes off `scanMgr.GetSystemScanMgr`. The R72/RB-SCAN reads use `systemScanBindSpec()` in `src/server.js` (~line 726: `{ key:"scanMgr", service:"scanMgr", method:"GetSystemScanMgr", args:[], kwargs:null }`) via `probeBind(...)`/`boundCall`. Add a `dispatchBoundScanWrite(req,res,next,method,args,kwargs)` (mirror `dispatchBoundInventoryWrite`/`dispatchBoundPlanetWrite`) → `boundCall(held, webSessionID, systemScanBindSpec(), method, args, kwargs)`. **Note the good security property: `GetSystemScanMgr` takes NO caller args — it always binds the SESSION's own current-system scan manager, so the bind cannot be pointed at a foreign system.** Do NOT invent a new mechanism.

## This batch — WRITES (grep-confirm each `Handle_*` exists in `scanMgrService.js`; SKIP+report missing)

`SignalTrackerRegister` (:1540), `SetProbeDestination` (:1592), `SetProbeRangeStep` (:1619), `ConeScan` (:1671), `RequestScans` (:1767), `ReconnectToLostProbes` (:1883), **`DestroyProbe`** (:1908, destroys a launched probe), `RecoverProbes` (:1923), `SetActivityState` (:1950).

**Bold = destructive** — `DestroyProbe` gets an extra-explicit confirm message + never-fire (you're not firing anything anyway — no live server). The rest are probe-position / range-step / cone-scan / request-scan / reconnect / recover / activity-state — reversible in-space scanning ops, no ISK, no permanent asset loss.

## Arg-injection note (flag, don't fix)

The bind itself is session-scoped (no caller args → session's own system), which is the primary control. But the METHOD args may carry caller-supplied probeIDs (`SetProbeDestination`/`SetProbeRangeStep`/`DestroyProbe`/`RecoverProbes`). READ each quickly: does the handler verify the probeID belongs to the session's own probe set (owner/launcher check), or does it act on any probeID in the system? A probe belongs to whoever launched it; scanMgr should scope by the session char's probes. If a write mutates/destroys a probe launched by ANOTHER char with no owner check → append to `docs/arg-injection-leak-handoff.md` (write-side). If probes are inherently session-scoped (the scan manager only knows the caller's own probes) → note that and flag nothing. Don't block on exhaustive proof (server-side fix + QA later). Keep plumbed + confirm-gated.

## Hard rules

**Bridge-only, existing handlers only** (never author a `Handle_*`); skip+report missing-handler; commit by pathspec (eve.js onto `ReconcileEliteMode` tip, web-poc onto `master` tip — same as R102/R103) without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write. **NO server restart (operator owns EveJS).**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2465), `tsc` + `build:web` clean.
2. Wire each write off the scanMgr bind (mirror `systemScanBindSpec`/`boundCall`): allowlist + confirm-gated BFF POST route + educated-guess decoder + basic UNIT test. **Un-stale ALL refusal tests/enumerations** — grep each of the 9 methods AND the word `scanMgr` across the FULL `server/tests/webGateway*.test.js` suite (all ~24 files), update the `webGatewayServiceCall` "exactly-the-set" enumeration + snapshot AND any `listed*` deepEqual / refusal loop that names scanMgr. **STEP-7 REMINDER (R90-debt lesson): snapshot-only checks MISS cross-file "exactly-the-set" enumerations — grep the FULL webGateway suite for every new method AND the service word, and re-run any `webGateway*.test.js` file that names scanMgr.**
3. **Verify via isolated eve.js `webGatewayServiceCall` test + web `node --test` — NO server restart, NO live smoke.**
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R104 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 9 probe/scan-control writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers) off the scanMgr bind, reachable via confirm-gated BFF routes, decoded (educated-guess), with basic unit tests — refusal tests/enumerations un-staled so the suite is GREEN (isolated eve.js test + web `node --test`), snapshot current, no UI, market files untouched, NO server restarted.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- **Servers:** EveJS (:26002) + web BFF (:26500) are OPERATOR-MANAGED — do NOT restart them. Market daemon :40111 untouched. **Log hygiene:** temp files → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. No live login needed (no smoke this batch).
- **Browser pane:** no UI — verified via unit tests only.

RETURN: (a) which of the 9 writes landed / skipped (missing-handler reason) + the bind mechanism, (b) confirm-gate + how refuse-without-confirm is UNIT-tested, (c) which refusal tests/enumerations you un-staled (and confirmation you grep'd the FULL webGateway suite per the R90-debt lesson), (d) final web `node --test` count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged (esp. caller-probeID ownership), (g) confirmation you did NOT restart EveJS or the web BFF + did not push.
