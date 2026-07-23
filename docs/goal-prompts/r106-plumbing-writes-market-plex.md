# Goal R106: Plumbing sweep — Phase-3 top-level FINANCIAL WRITES: marketProxy PLEX/instant-buy (W-MARKET 3) — CLOSES THE SWEEP (588/588)

**Issued:** 2026-07-23 (plumbing sweep, financial writes, fast mode). **Status:** Ready — the operator EXPLICITLY authorized these 3 on 2026-07-23 ("we want it all plumbed. go"). **Client + bridge. PLUMBING ONLY — no UI.**

**⚡ WRITES FAST MODE — same as R86–R105, with the FINANCIAL/REACHABILITY-ONLY overlay.** Educated-guess models/responses; SKIP heavy testing; only plumb writes whose server `Handle_*` EXISTS (grep-confirmed — all 3 present). These are the 3 pairs deferred the whole sweep because they are FINANCIAL. **REACHABILITY-ONLY: wire the pair + confirm-gated route + refuse-without-confirm unit test; NEVER fire the happy-path mutation live (you have no live server anyway). The confirm-gate must exist and the route must be reachable; the ISK-spending / order-placing path stays UNTRIGGERED.**

## ⚙ SERVER PROTOCOL (operator owns EveJS) — DO NOT restart EveJS (:26002) OR the web BFF (:26500)

Verify WITHOUT a running-server smoke: allowlist via `npm run test:isolated -- server/tests/webGatewayServiceCall.test.js`, routes/decoder + refuse-without-confirm via web `node --test` UNIT tests. NO live smoke, NO `Start-Process`, NO server restart, NO live order/buy of any kind. New pairs go live when the operator next restarts EveJS. State this in your report.

## ⚠ STAY OFF THE MARKET SESSION'S FILES

A separate session owns `web/src/bridge/market.ts` + the `marketProxy`/market-daemon server code. You touch ONLY the shared plumbing infra you need:
- eve.js `WEB_CALL_ALLOWLIST` (`server/src/_secondary/express/evejsWebGatewayRuntime.js`) — shared, orchestrator-edited all sweep.
- web-poc `src/server.js` — the BFF, shared.
- **A NEW decoder file `web/src/bridge/marketWrites.ts`** (+ its `.test.ts`) — do NOT edit the existing `market.ts`. Import nothing that forces a `market.ts` edit.
- Do NOT touch `marketProxyService.js` or any market-daemon file (never author/modify a `Handle_*`).

## Service + dispatch — TOP-LEVEL (the service is `marketProxy`, NOT `market`)

**⚠ The real service is `marketProxy` (`marketProxyService.js`) — daemon-backed, real wallet debits. `market` (marketService.js) is a DEAD STUB; the allowlist refuses it. Name `marketProxy` on every pair.** marketProxy is TOP-LEVEL (`heldTopLevelCall` / the generic top-level write path `dispatchBridgeWrite(req,res,next,service,method,args)` at ~line 4917 in `src/server.js`) — NO bound-object machinery. Mirror the R91-family top-level financial write routes (the `account.GiveCash` reachability-only pattern): confirm-gate → `dispatchBridgeWrite("marketProxy", method, args)`.

## This batch — WRITES (all 3 `Handle_*` grep-confirmed present in `marketProxyService.js`)

- **`PlacePlexSellOrder`** (:4003) — lists PLEX for sale at a price (commits an asset to a real sell order). FINANCIAL.
- **`ModifyPlexCharOrder`** (:4245) — re-prices/modifies one of the caller's existing PLEX orders. FINANCIAL.
- **`BuyMultipleItems`** (:3911) — instant-buy against existing sell orders; **spends ISK immediately**. FINANCIAL (most consequential).

**ALL THREE are financial → each gets an EXTRA-EXPLICIT confirm message** (e.g. BuyMultipleItems: "This SPENDS ISK immediately to buy at market — irreversible. Confirm."; PlacePlexSellOrder: "This lists your PLEX for sale on the live market. Confirm."; ModifyPlexCharOrder: "This re-prices your live market order. Confirm.") + reachability-only (never fired).

## Arg-injection note (flag, don't fix)

marketProxy writes act on the session's own wallet/orders (`BuyMultipleItems` debits the session char's wallet; `ModifyPlexCharOrder` should only touch the caller's own orderID). READ each quickly: does `ModifyPlexCharOrder` verify the orderID belongs to the session char before modifying (owner check), or will it re-price ANY order by id? Does `BuyMultipleItems` charge the session wallet (not a caller-supplied wallet/charID)? If a write mutates a foreign order or charges/credits a foreign wallet with no session gate → append to `docs/arg-injection-leak-handoff.md` (write-side, financial). Don't block on exhaustive proof (server-side fix + QA later). Keep plumbed + confirm-gated.

## Hard rules

**Bridge-only, existing handlers only** (never author a `Handle_*`); commit by pathspec (eve.js onto `ReconcileEliteMode` tip, web-poc onto `master` tip — same as R102–R105) without disturbing the other agent's work OR the market session's `market.ts` (verify `git status` after); **do not touch `market.ts` or any market-daemon/marketProxy server file**. Never `git add -A`; never push. Confirm-gate every write. **REACHABILITY-ONLY — never fire the mutation. NO server restart.**

## Required work

1. Baseline: combined web `node --test` green (hold ≥ current 2488), `tsc` + `build:web` clean.
2. Wire each write top-level (mirror the R91 `dispatchBridgeWrite` financial pattern): allowlist `marketProxy.<method>` + confirm-gated BFF POST route (extra-explicit financial message) + educated-guess decoder in the NEW `web/src/bridge/marketWrites.ts` + basic UNIT test asserting refuse-without-confirm does NOT dispatch. **Un-stale ALL refusal tests/enumerations** — grep each of the 3 methods AND `marketProxy` across the FULL `server/tests/webGateway*.test.js` suite (all ~24 files); update the `webGatewayServiceCall` "exactly-the-set" enumeration + snapshot AND any `webGatewayMarket` enumeration / refusal loop that names marketProxy. **STEP-7 REMINDER (R90-debt lesson): snapshot-only checks MISS cross-file "exactly-the-set" enumerations — grep the FULL webGateway suite for every new method AND the service word, and re-run every `webGateway*.test.js` file that names marketProxy.** NOTE: `webGatewayMarket.test.js` carries the KNOWN pre-existing `GetCharEscrow` world-drift red (4650≠2450) — do NOT try to fix that; just ensure your enumeration change doesn't add NEW failures beyond it.
3. **Verify via isolated eve.js `webGatewayServiceCall` test + web `node --test` — NO server restart, NO live smoke, NO live order.**
4. Append result + decisions to `docs/afk-session-log.md`; roadmap R106 row. Commit by pathspec; report hashes. **Do not push.** **This CLOSES the entire plumbing sweep at 588/588.**

## Definition of done

The 3 marketProxy financial writes are allowlisted (existing handlers, `marketProxy` service) top-level, reachable via confirm-gated BFF routes with extra-explicit financial confirm messages, decoded (educated-guess) in the NEW `marketWrites.ts`, with basic unit tests proving refuse-without-confirm does not dispatch — refusal tests/enumerations un-staled so the suite is GREEN (isolated eve.js test + web `node --test`) except the KNOWN pre-existing `webGatewayMarket`/GetCharEscrow red, snapshot current, no UI, `market.ts`/marketProxy server files untouched, NO server restarted, NO order/buy fired live. Sweep 588/588.

## Constraints

- **Known pre-existing failures — do not touch:** `droneRuntimeParity`, `webGatewayMarket`/`GetCharEscrow` (4650≠2450 — this is in the very file you'll be editing enumerations near; leave the GetCharEscrow subtest alone), `webGatewayPersistentSession`:244 (60000004≠60003760, world-drift). `webGatewayServiceCall` needs the **isolated runner** (file-level pass/fail — check subtest tallies).
- **Servers:** EveJS (:26002) + web BFF (:26500) are OPERATOR-MANAGED — do NOT restart them. Market daemon :40111 untouched. **Log hygiene:** temp files → scratchpad, NOT the repo root.
- **The market session owns `market.ts` + marketProxy/daemon — stay off them.** Preserve `_local`, `data/`, icon caches, manifests. `icon-typeids*.txt` are the orchestrator's. No live login needed (reachability-only, no smoke).
- **Browser pane:** no UI — verified via unit tests only.

RETURN: (a) all 3 writes landed + the top-level dispatch mechanism, (b) confirm-gate + how refuse-without-confirm is UNIT-tested (and confirmation reachability-only — no live order/buy fired), (c) which refusal tests/enumerations you un-staled (and confirmation you grep'd the FULL webGateway suite per the R90-debt lesson, and that you did NOT disturb the GetCharEscrow pre-existing red), (d) final web `node --test` count + eve.js isolated `webGatewayServiceCall` result, (e) both commit hashes + `git status` proving the other agent's work AND the market session's `market.ts` intact, (f) any write arg-injection issues flagged (esp. ModifyPlexCharOrder foreign-orderID / BuyMultipleItems foreign-wallet), (g) confirmation you did NOT restart EveJS or the web BFF, did NOT edit market.ts/marketProxy server files, and did not push.
