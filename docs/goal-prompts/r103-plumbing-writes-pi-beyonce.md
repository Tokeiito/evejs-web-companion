# Goal R103: Plumbing sweep — Phase-4 bound WRITES: planet colony ops + beyonce nav/bookmark (WB-PI 4 + WB-BEYONCE 7) (11)

**Issued:** 2026-07-23 (plumbing sweep, Phase-4 bound WRITES, fast mode). **Status:** Ready. **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R102.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirm; missing → SKIP+report). Follow the R86–R102 write pattern: allowlist + **confirm-gated BFF POST route** (`requireWriteConfirmation`) + educated-guess decoder + basic UNIT test; **un-stale refusal tests (heavy)**. Not market files (separate session).

## ⚙ SERVER PROTOCOL (operator owns EveJS) — DO NOT restart EveJS (:26002) OR the web BFF (:26500)

Verify WITHOUT a running-server smoke: allowlist via `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js`, routes/decoders + refuse-without-confirm via web `node --test` UNIT tests. NO live smoke, NO `Start-Process`, NO server restart. New pairs go live when the operator next restarts EveJS. State this in your report.

## Phase-4 two-step — TWO established binds (no new MachoBindObject pair)

- **WB-PI → off the `planetMgr` planetID bind.** The R77 RB-PI colony READS use `planetBindSpec(planetID)` + `boundCall` in `src/server.js` (the two-step off `planetMgr.MachoBindObject(planetID)` — see ~line 748 `planetBindSpec` + ~1414). Mirror it: add a `dispatchBoundPlanetWrite` (like `dispatchBoundDogmaWrite`/`dispatchBoundInventoryWrite`) → `boundCall(held, webSessionID, planetBindSpec(planetID), method, args, kwargs)`. The browser sends the target `planetID`; the BFF binds it and holds the OID handle. **Note the arg-injection concern below — planetID is caller-supplied.**
- **WB-BEYONCE → off the `beyonce` solar-system bind.** The autopilot movement path already holds the beyonce bound handle server-side via `Moniker('beyonce', solarSystemID)` (~line 12718, `BEYONCE_BIND_GROUP=5`, bind args `[[Number(solarSystemID), 5]]`). Mirror THAT bind spec for these 7 nav/bookmark writes — reuse the existing beyonce bind helper if one is factored out; otherwise add `dispatchBoundBeyonceWrite` alongside the autopilot code. Do NOT invent a new mechanism.

## This batch — WRITES (grep-confirm each `Handle_*` exists; SKIP+report missing)

**planetMgr (4)** (`planetMgrService.js`) — bound to planetID: `UserUpdateNetwork` (:1091), `UserLaunchCommodities` (:1172), `UserTransferCommodities` (:1226), **`UserAbandonPlanet`** (:1259, DESTROYS the colony).

**beyonce (7)** (`beyonceService.js`) — off the beyonce solar-system bind: `CmdGotoPoint` (:2420), `CmdGotoBookmark` (:2433), `CmdAbandonLoot` (:2558), `CmdFleetTagTarget` (:2572), `CmdJumpThroughFleet` (:2198), `BookmarkLocation` (:3299), `BookmarkScanResult` (:3325).

**Bold = destructive** — `UserAbandonPlanet` gets an extra-explicit confirm message ("ABANDONS the colony — all structures lost, cannot be recovered") + never-fire (you're not firing anything anyway — no live server). The rest are colony network-update / commodity-launch/transfer + in-space nav (goto/jump) + bookmark-create (reversible-ish in-space ops).

## Arg-injection note (flag, don't fix)

- **planetMgr writes take a caller `planetID`.** The R77 RB-PI reads were LIVE-PROVEN cross-account leaks (Test Two read Farmer's colony 40009077) — flags #18-#20 in `docs/arg-injection-leak-handoff.md`. The WRITES here bind the SAME caller-supplied planetID with NO session-ownership gate, so `UserUpdateNetwork`/`UserLaunchCommodities`/`UserTransferCommodities`/`UserAbandonPlanet` are the **write realization of that same leak** — a browser could reconfigure or ABANDON a foreign colony. READ each handler quickly to confirm it trusts the bound planetID's ownerID without checking session char; if unguarded → append to `docs/arg-injection-leak-handoff.md` (write-side, note UserAbandonPlanet is the most consequential).
- **beyonce writes** act on the session's own ship/position (movement) — verify each resolves ship/char from session, not a caller shipID. Bookmark writes create bookmarks owned by the session char. Flag anything that takes a caller-supplied foreign id.

Don't block on exhaustive proof (server-side fix + QA later). Keep plumbed + confirm-gated.

## Hard rules

**Bridge-only, existing handlers only** (never author a `Handle_*`); skip+report missing-handler; commit by pathspec onto the `ReconcileEliteMode` tip without disturbing the other agent's work (verify `git status` after); **do not touch market files**. Never `git add -A`; never push. Confirm-gate every write. **NO server restart (operator owns EveJS).**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2448), `tsc` + `build:web` clean.
2. Wire each write off its bind (planetMgr planetID / beyonce solar-system): allowlist + confirm-gated BFF POST route + educated-guess decoder + basic UNIT test. **Un-stale ALL refusal tests/enumerations** (grep each method + `planetMgr`/`beyonce` across ALL `server/tests/webGateway*.test.js` — `webGatewayServiceCall` "exactly-the-set" enumeration; check for any `planetMgr`/`beyonce` refusal loops or `listed*` deepEquals). Update the snapshot. **STEP-7 REMINDER (R90 debt lesson): snapshot-only checks MISS cross-file "exactly-the-set" enumerations — grep the FULL webGateway suite for every new method AND its service, and re-run any `webGateway*.test.js` file that names planetMgr or beyonce.**
3. **Verify via isolated eve.js `webGatewayServiceCall` test + web `node --test` — NO server restart, NO live smoke.**
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R103 row. Commit by pathspec; report hashes. **Do not push.**

## Definition of done

The 11 colony/beyonce writes (minus any skipped for missing-handler, with reason) are allowlisted (existing handlers) off the planetMgr/beyonce binds, reachable via confirm-gated BFF routes, decoded (educated-guess), with basic unit tests — refusal tests/enumerations un-staled so the suite is GREEN (isolated eve.js test + web `node --test`), snapshot current, no UI, market files untouched, NO server restarted.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- **Servers:** EveJS (:26002) + web BFF (:26500) are OPERATOR-MANAGED — do NOT restart them. Market daemon :40111 untouched. **Log hygiene:** temp files → scratchpad, NOT the repo root.
- **A separate session is editing market files — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. No live login needed (no smoke this batch).
- **Browser pane:** no UI — verified via unit tests only.

RETURN: (a) which of the 11 writes landed / skipped (missing-handler reason) + the bind mechanism per service, (b) confirm-gate + how refuse-without-confirm is UNIT-tested, (c) which refusal tests/enumerations you un-staled (and confirmation you grep'd the FULL webGateway suite per the R90-debt lesson), (d) final web `node --test` count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work + market files intact, (f) any write arg-injection issues flagged (esp. the planetMgr caller-planetID write realization of #18-#20), (g) confirmation you did NOT restart EveJS or the web BFF + did not push.
