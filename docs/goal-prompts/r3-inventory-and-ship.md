# Goal R3: Station inventory + ship operations (bound-object bridge + cargo moves + board)

**Issued:** 2026-07-19 by the orchestrator session. **Depends on:** R2 complete (persistent browser-backed gateway session, live-validated: login → select → docked station panel). **Status:** Ready to run.

You are a worker session. Read FIRST: `docs/web-client-scope-and-roadmap.md` (source of truth), `docs/bridge-wire-contract.md` (the wire contract + persistent-session + "how to add a page"), and `docs/retail-call-inventory.md` **Steps 5, 6, 7** (the inventory/ship/board call tables — your spec). Execute exactly this goal, then stop.

## Why this goal matters beyond itself

R3 introduces the **retail bound-object (moniker) call pattern**, which R4 (agents are `Moniker('agentMgr', agentID)`) and R5 (travel is `Moniker('beyonce', solarsystemID)`) also need. Get the bound-object bridge right here and the rest of the courier path reuses it. This is the single most important architectural piece of R3.

## Objective

1. **eve.js (gateway/interface files + their tests ONLY):** extend the bridge to support the retail **two-step bound-object call** on the persistent session — a `MachoBindObject` bind (e.g. `Moniker('invbroker',(stationID,groupStation))`, `Moniker('ship',(stationID,groupStation))`) returns a bound handle, and subsequent methods (`List`, `Add`, `Board`, …) dispatch on that handle. Add the R3 allowlist pairs. Deny-by-default must still hold for bound-object method calls.
2. **web:** an **inventory + ship** page on the new Svelte stack: show the docked character's station hangar and active-ship cargo (bind + list), move an item hangar↔cargo (Add / MultiAdd / MultiMerge / StackAll), show cargo capacity, and board a ship in the hangar. All mutations run the same retail calls the client makes, on Farmer's live session.
3. Prove the whole flow in-process with fixtures; the orchestrator live-tests afterward with a real server + browser.

## Verified background facts (from the inventory, Steps 5–7)

- **invbroker two-step:** manager moniker `Moniker('invbroker',(stationID,groupStation))` → `Handle_MachoBindObject` (`inventory/invBrokerService.js:8598`, reads `bindParams[0]=inventoryID`, `bindParams[1]=flag`) returns a bound inventory object; then `GetInventory(containerHangar,None)` (`:5933`) / `GetInventoryFromId(itemid=shipID, passive=0)` (`:6082`, only these two args cross the wire), `List(flag=)` (`:6265`) / `ListByFlags(flags=)` (`:6401`), `Add(itemID, sourceLocationID, qty, flag)` (`:7286`), `MultiAdd(itemIDs, sourceID, flag)` (`:7679`), `MultiMerge(ops, sourceContainerID)` (`:7242`), `StackAll(flag)` (`:7185`), `GetCapacity(flag)` (`:7168`). Priming reads `GetItemDescriptor` (`:8547`), `GetSelfInvItem` (`:6734`).
- **ship two-step:** `Moniker('ship',(stationID,groupStation))` (retail `eveMoniker.GetStationShipAccess()`) → `Board(shipID, oldShipID)` (`ship/shipService.js:1666`, `args[0]=shipID`, `args[1]=session.shipid`), `BoardStoredShip` (`:1602`). `super("ship")` at `shipService.js:252`.
- **Capacity (Step 6):** retail reads capacity client-locally, but `invbroker.GetCapacity(flag)` (`:7168`) is the server-authoritative equivalent — use it so the browser shows a real number.
- **`SplitStack` is missing on invbroker (G4)** — the drag-move path folds a partial quantity into `Add(qty)`/`MultiMerge(op qty)`, so you do NOT need a split call for courier cargo. Do not add one to eve.js.
- **How EveJS resolves bound objects:** `serviceManager.lookup` resolves bound-object OID strings, and `network/packetDispatcher.js` auto-registers OIDs returned from a `Handle_` (see `_scanAndRegisterOIDs`). Your bridge replicates that registration on the persistent session instead of a socket. Read the dispatcher and `Handle_MachoBindObject` to see the real OID shape before designing the handle.

## Design constraints (bound-object bridge)

- **Bound handles live on the persistent session** (R2's session store), exactly as retail OIDs live on the socket's session. A bind call returns an opaque bound-handle token to the BFF; subsequent calls address `(bridgeSessionID, boundHandle, method, args, kwargs)`. Like `bridgeSessionID`, the bound handle is BFF↔gateway only — **it must never reach browser JS**; the browser refers to inventories/ships by their game IDs, and the BFF maps those to held handles.
- **Deny-by-default still governs bound-object methods.** Allowlist the underlying `(service, method)` pairs (e.g. `invbroker.List`, `invbroker.Add`, `ship.Board`, plus the bind entry point). A method on a bound handle whose `(service, method)` is not allowlisted is refused **before** dispatch, same as R1. Prove this.
- **Faithful dispatch only.** Resolve the bound object and invoke its real `Handle_` through the same `callMethod`/lookup seam — do not reimplement inventory or ship logic. Interface glue only; retail on machoNet (:26000) untouched.
- **R3 allowlist additions (pairs):** `invbroker.MachoBindObject`, `invbroker.GetInventory`, `invbroker.GetInventoryFromId`, `invbroker.List`, `invbroker.ListByFlags`, `invbroker.Add`, `invbroker.MultiAdd`, `invbroker.MultiMerge`, `invbroker.StackAll`, `invbroker.GetCapacity`, `invbroker.GetItemDescriptor`, `invbroker.GetSelfInvItem`, `ship.MachoBindObject`, `ship.Board`, `ship.BoardStoredShip`. (Confirm each method name/arity against the cited handler before whitelisting; drop any you don't actually call and note it.) Do NOT whitelist any destructive or unrelated method.

## Required work

1. **Baseline** (record): web `npm test` (expect 170/170); eve.js `npm run test:manifest:check` (3/3), `npm run test:agent-parity` (6/6), and `node scripts/Tests/run-isolated-tests.js server/tests/webGatewayServiceCall.test.js server/tests/webGatewayV1.test.js server/tests/webGatewayPersistentSession.test.js` (green). The eve.js worktree carries other agents' in-flight parity work — leave every bit of it alone; stage only your own files; never `git add -A`.
2. **eve.js — bound-object bridge (do first; commit early, small, gateway files + tests only):** bind/resolve/invoke on the persistent session; the R3 allowlist pairs; in-process tests (model: `webGatewayPersistentSession.test.js` + a fixture world with a docked character who owns hangar items and a ship). Prove: bind hangar → `List` returns the fixture items; `Add` moves an item hangar→cargo (assert the item's location/flag actually changed via a follow-up `List`); `Board` makes a hangar ship active; a non-allowlisted bound method is refused before dispatch; bound handles are confined to the session (unknown/mismatched handle → typed error). Commit (e.g. `feat(web-gateway): bound-object bridge for invbroker/ship (R3)`); report hash; **do not push**.
3. **web BFF:** extend `src/eveGatewayClient.js` + `/api/bridge/*` for bind + bound-method calls, holding bound handles server-side keyed by the web session (never sent to the browser). Map browser-facing game IDs (inventoryID/shipID/itemID) to held handles.
4. **web page (new Svelte stack, under `web/`):** an "Inventory & Ship" view reachable from the station panel: list station-hangar contents and active-ship cargo (typed decoders per the "how to add a page" recipe + new store slices), a control to move a selected item hangar↔cargo (and stack), a cargo capacity readout, and a control to board a different hangar ship. Reads refresh after each mutation (push forwarding is still G6). Keep the failure handling robust like R2's `Promise.allSettled` panel (one failed read must not blank the rest). Serve at `/dist/`.
5. **Update `docs/bridge-wire-contract.md`** with the bound-object contract (bind route/response, bound-method call shape, handle confinement, error codes) and note the shared use for R4/R5.
6. **README:** extend the "Spot test" section with an R3 check (log in as the account owning **Farmer** → open Inventory & Ship → see hangar + cargo → move an item → board a ship). Note expectations.
7. Tests green everywhere; commit web work; update roadmap R3 row to Complete with evidence (in-process; live spot test pending orchestrator). Report all repo hashes.

## Out of scope

- Undock / travel / dock (R5), agents/missions (R4), `SplitStack` (G4, not needed).
- Notification push/streaming (G6). Deleting legacy vanilla pages / v1-gateway machinery (R6). Auth/security hardening (roadmap §6).
- Any game-mechanics change in eve.js. Gateway/interface files + their tests only.

## Definition of done

- eve.js: bound-object bind/resolve/invoke on the persistent session, proven in-process (bind → list → move actually relocates an item; board makes a ship active); deny-by-default holds for bound-object methods; bound handles confined server-side; footprint = `_secondary/express` + gateway tests; baselines non-regressed. Committed; hash reported; not pushed.
- web: Inventory & Ship page at `/dist/` lists hangar + cargo, moves/stacks an item, shows capacity, and boards a ship — against a stubbed/in-process backend in tests; wire contract + README updated; all web tests green. Committed; hash(es) reported; not pushed.
- Roadmap R3 row Complete with evidence "in-process end-to-end; live spot test pending orchestrator".

## Constraints

- eve.js coordination: other agents are active — small early self-contained commit; stage only your files; never clobber/revert anything of theirs; if your target gateway files have their work in flight, pause and surface it in your report.
- Never start or stop servers/processes you did not start (ports 443, 26000-26003, 26500, 40110 are others'); npm test scripts + Vite builds are fine; leave no dev server running.
- Preserve `_local` gameplay data, web `data/`, icon caches, manifests, ignored credentials. Commit each repo separately; never push.
- Report clearly if R3 is too large for one session — name the clean split (bound-object bridge + reads, then mutations + board) so the orchestrator can decide.
