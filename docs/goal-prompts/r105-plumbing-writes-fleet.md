# Goal R105: Plumbing sweep — Phase-4 bound WRITES: fleet composition + membership + broadcast (WB-FLEET 16) — CLOSES WB-FLEET

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R104.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R104 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic UNIT test; **un-stale refusal tests (heavy)**. Not market files (separate session). **This CLOSES WB-FLEET and brings the writes phase to 298/301 (only the 3 PLEX writes deferred).**

## ⚙ SERVER PROTOCOL (operator owns EveJS) — DO NOT restart EveJS (:26002) OR the web BFF (:26500)

Verify WITHOUT a running-server smoke: allowlist via `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js`, routes/decoders + refuse-without-confirm via web `node --test` UNIT tests. NO live smoke, NO `Start-Process`, NO server restart. New pairs go live when the operator next restarts EveJS. State this in your report.

## Phase-4 two-step — off the fleetObjectHandler bind (no new MachoBindObject pair)

BOUND writes off `fleetObjectHandler.MachoBindObject`. The R85/RB-FLEET reads use `fleetBindSpec()` in `src/server.js` (~line 734: `{ key:"fleet", service:"fleetObjectHandler", method:"MachoBindObject", args:[], kwargs:null }`) via `probeBind(...)`/`boundCall`. Add a `dispatchBoundFleetWrite(req,res,next,method,args,kwargs)` (mirror `dispatchBoundScanWrite`/`dispatchBoundInventoryWrite`) → `boundCall(held, webSessionID, fleetBindSpec(), method, args, kwargs)`. **Security note: the dedicated route's `fleetBindSpec()` passes `args:[]`, so the server binds the SESSION's OWN fleet (session-scoped, documented at ~line 1644 as "never leaks"). This is DIFFERENT from the generic `/api/bridge/call` seam, where a browser could pass a caller fleetID to `MachoBindObject` directly (the #26-#30 bind-gateway leak). Dispatch these writes through `fleetBindSpec()` (empty args), NOT a caller fleetID.** Do NOT add a new MachoBindObject allowlist pair.

## This batch — WRITES (grep-confirm each `Handle_*` exists in `fleetObjectHandlerService.js`; SKIP+report missing)

`CreateWing` (:175), `CreateSquad` (:196), `MoveMember` (:221), **`KickMember`** (:250, removes a member), `MakeLeader` (:258), `LeaveFleet` (:266), **`DisbandFleet`** (:273, destroys the fleet), `SetOptions` (:280), `SetMotdEx` (:304), `UpdateMemberInfo` (:339), `SendBroadcast` (:363), `Invite` (:398), `MassInvite` (:409), `AcceptInvite` (:375), `RejectInvite` (:383), `Reconnect` (:391).

**Bold = consequential** — `DisbandFleet` (destroys the whole fleet) + `KickMember` (removes another char) get extra-explicit confirm messages + never-fire (you're not firing anything anyway — no live server). The rest are wing/squad create + member-move + leader/leave + options/motd/member-info + broadcast + invite/accept/reject/reconnect — fleet-management ops, no ISK, no asset destruction (a disbanded fleet is re-formable).

## Arg-injection note (flag, don't fix)

The bind is session-scoped (`fleetBindSpec()` empty args → the session's own fleet), the primary control. But member/wing/squad-targeting args (`MoveMember`/`KickMember`/`MakeLeader`/`UpdateMemberInfo` take a memberID; `CreateSquad`/`MoveMember` take a wingID) act WITHIN the bound fleet — that's normal fleet-boss authority, gated server-side by the session char's fleet ROLE (boss/wing-cmd). READ each quickly: does the handler check the session char actually holds the required fleet role before kicking/moving/promoting, or will any fleet member (or non-member) mutate the roster? If a non-boss can kick/disband with no role check → append to `docs/arg-injection-leak-handoff.md` (write-side, note it's a privilege-escalation-within-fleet rather than a cross-account leak). `Invite`/`MassInvite` take target charIDs (inviting others is normal). Don't block on exhaustive proof (server-side fix + QA later). Keep plumbed + confirm-gated.

## Hard rules

**Bridge-only, existing handlers only** (never author a `Handle_*`); skip+report missing-handler; commit by pathspec (eve.js onto `ReconcileEliteMode` tip, web-poc onto `master` tip — same as R102/R103/R104) without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write. **NO server restart (operator owns EveJS).**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ the count at the start of your run, ~2474+ post-R104), `tsc` + `build:web` clean.
2. Wire each write off the fleet bind (mirror `fleetBindSpec`/`boundCall`): allowlist + confirm-gated BFF POST route + educated-guess decoder + basic UNIT test. **Un-stale ALL refusal tests/enumerations** — grep each of the 16 methods AND the word `fleetObjectHandler` (and `fleet`) across the FULL `server/tests/webGateway*.test.js` suite (all ~24 files); update the `webGatewayServiceCall` "exactly-the-set" enumeration + snapshot AND any `listed*` deepEqual (there is likely a `listedFleet`/fleet-surface enumeration from the R85 reads) / refusal loop that names fleetObjectHandler. **STEP-7 REMINDER (R90-debt lesson): snapshot-only checks MISS cross-file "exactly-the-set" enumerations — grep the FULL webGateway suite for every new method AND the service word, and re-run every `webGateway*.test.js` file that names fleetObjectHandler to confirm green.**
3. **Verify via isolated eve.js `webGatewayServiceCall` test + web `node --test` — NO server restart, NO live smoke.**
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R105 row. Commit by pathspec; report hashes. **Do not push.** **This CLOSES WB-FLEET (21/21 across R95 top-level + R105 bound) and reaches writes 298/301.**

## Definition of done

The 16 fleet writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers) off the fleetObjectHandler bind via `fleetBindSpec()` (session-scoped, empty args), reachable via confirm-gated BFF routes, decoded (educated-guess), with basic unit tests — refusal tests/enumerations un-staled so the suite is GREEN (isolated eve.js test + web `node --test`), snapshot current, no UI, market files untouched, NO server restarted. Writes 298/301.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- **Servers:** EveJS (:26002) + web BFF (:26500) are OPERATOR-MANAGED — do NOT restart them. Market daemon :40111 untouched. **Log hygiene:** temp files → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. No live login needed (no smoke this batch).
- **Browser pane:** no UI — verified via unit tests only.

RETURN: (a) which of the 16 writes landed / skipped (missing-handler reason) + the bind mechanism, (b) confirm-gate + how refuse-without-confirm is UNIT-tested, (c) which refusal tests/enumerations you un-staled (esp. any `listedFleet` deepEqual; and confirmation you grep'd the FULL webGateway suite per the R90-debt lesson), (d) final web `node --test` count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged (esp. fleet-role privilege checks on kick/disband/move/promote), (g) confirmation you did NOT restart EveJS or the web BFF + did not push.
