# EveJS Web Client: Scope and Roadmap

**Status:** Active — rewritten 2026-07-18. Supersedes the 2026-07-12 planning baseline and its Goal 0A–0F ladder. The old goal ladder, its execution records, and the deleted `docs/progress.md` live in this repository's git history (through commit `8dccc5d`); do not resurrect their retired decisions (section 11).

**Related repositories:** `eve.js` (game server, sole authority) and `evejs-web-poc` (browser client).

## 1. Goal

Reimplement as much of the EVE Online client as practical in a web browser, by making the browser drive the **same service calls the retail client makes**, dispatched to the **same EveJS handlers** the retail client hits. EveJS remains authoritative for all state, validation, movement, transactions, and persistence. The browser is an alternate client, not another simulation.

The first end-to-end playable milestone is a courier mission completed entirely in the browser (section 7). Combat and the rest of the client surface come later, as practical — deferred, not forbidden.

The UI stays text/data-driven and EVE-styled. Graphical space rendering is not a goal.

## 2. The retail call surface (the spec)

The decompiled retail client at `eve.js/tools/ClientCodeGrabber/Latest` (EVE release V24.01; ~12,500 Python modules present as `.py`/`.pyc`/`.pyj` triplets, ~269 MB) is the specification for what the browser should call. It is client source only — no server implementations and no captured network traffic.

Every server interaction in that client takes one of three forms:

- `sm.RemoteSvc('<service>').Method(*args, **kwargs)` — server-tier call. 157 distinct service names, ~884 literal call sites (e.g. `sm.RemoteSvc('charMgr').GetPublicInfo(charID)`, `sm.RemoteSvc('agentMgr')...`).
- `sm.ProxySvc('<service>').Method(...)` — proxy/session-tier call. 14 names (e.g. `machoNet`, `marketProxy`, `fleetProxy`).
- `sm.GetService('<name>')` — client-local service; never crosses the wire and is out of scope for the bridge.

The unit the bridge mirrors is the tuple **(service name, method name, positional args, keyword args)**.

There is no manifest file in the dump. The call surface is mined by grepping the `.py` sources for `sm\.RemoteSvc\('...'\)` / `sm\.ProxySvc\('...'\)` and reading the surrounding call sites. The transport internals (`carbon/common/script/sys/serviceManager.py`, `basesession.py`, `carbon/common/script/net/machoNet.py`, machoVersion 496) are background only — the browser does **not** speak machoNet.

## 3. How EveJS receives those calls

The retail path in `eve.js` (all under `server/src/`):

- TCP listener `network/tcp/index.js` (default port 26000) → machoNet handshake (`network/tcp/handshake.js`) → `ClientSession` → `network/packetDispatcher.js`.
- `CALL_REQ` packets resolve the service via `serviceManager.lookup(serviceName)` and run `service.callMethod(method, args, session, kwargs)` (`services/baseService.js`), which reflectively invokes **`Handle_<method>(args, session, kwargs)`**.
- ~1,500 unique `Handle_*` methods across ~200 service files under `services/` implement the game.

Two facts make a thin browser bridge practical:

1. **Sessions are duck-typed.** Handlers accept any object with the right fields (`characterID`/`charid`, `shipid`, location fields, `sendServiceNotification`, ...). The 500+ parity tests under `server/tests/` already invoke `Handle_*` directly with hand-built plain-object sessions and no socket.
2. **The dispatch seam is one call.** `serviceManager.lookup(service).callMethod(method, args, session, kwargs)` is the entire retail dispatch below the wire protocol. A bridge that packages browser requests into that call, with a browser-backed session object, exercises the same code path as a retail client.

Login and character selection on the retail path: `handshake.js` `_handleAuthentication` supports `config.devAutoCreateAccounts` (unknown accounts auto-created) and `config.devSkipPasswordValidation` (any password accepted) — the emulator's "who cares" login. A character comes online via `charService.js` `Handle_SelectCharacterID` → `applyCharacterToSession` (`characterState.js`) plus the character-control runtime, which also rejects retail login while a browser controls the character.

## 4. Architecture

Browser → web BFF (this repo) → thin EveJS bridge → the same `Handle_*` handlers the retail client hits.

The bridge is **not new server infrastructure**: it is the **existing** web gateway (`server/src/_secondary/express/evejsWebGateway.js`, HTTP/WS on :26002, already separate from the machoNet game listener on :26000) extended with a whitelisted `callMethod` invocation path — the only eve.js edit in the entire plan (landed in Goal R1).

```mermaid
flowchart LR
    Browser[Browser UI] --> BFF[Web backend BFF]
    BFF -->|HTTP and WS| Bridge[EveJS bridge endpoint]
    Bridge -->|callMethod on looked-up service| Handlers[Handle_ service handlers]
    Handlers --> Memory[Authoritative in-memory state]
    Memory --> Persistence[EveJS SQLite persistence]
    Handlers -->|session notifications| Bridge
    Bridge -->|events| Browser
```

Rules:

- **The bridge translates transport only.** It turns a browser request into `serviceManager.lookup(service).callMethod(method, args, session, kwargs)` against a browser-backed session, and turns handler results and `sendServiceNotification` traffic back into browser responses/events. It must not reimplement, fork, or "improve" game mechanics.
- **eve.js changes are restricted to bridge/interface endpoints** — concretely, the `_secondary/express` gateway files (plus their tests under `server/tests/`). Never modify game-mechanics code — the same server concurrently serves real retail clients, and their behavior must stay untouched.
- **A browser session is a real client session.** It carries the same duck-typed fields the parity tests use, participates in the same online-character and duplicate-login rules as a retail session, and receives handler notifications for forwarding. Long-term, EveJS's own session registry arbitrates control; the web-side lease machinery is stripped as that takes over (section 5).
- **The web process never reads or writes gameplay SQLite.** Read-only static reference data (names, icons, SDE JSON) may stay local to the web app.
- Retail `Handle_*` handlers expect retail argument shapes (positional tuples, kwargs, occasionally typed/coerced values) and may emit retail-shaped notifications. That is now the point, not a prohibition: the browser mirrors the retail call sites mined from the decompiled client, and the parity tests are the oracle for argument shapes.

## 5. Transitional state — today's app and the strip-down direction

What exists today (built under the previous roadmap, working, tested last on 2026-07-15):

- Eve-dark UI with four faction themes; web login (separate ignored password store); character list.
- Pages: overview, skill browser + drag/drop queue planner with save/save-paused, inventory grouped by location, read-only Jita 4-4 market, read-only industry jobs/blueprints, PI colony/extractor timers with extractor restart. Manual local icon scraper with manifest and rate limiting.
- Plumbing: versioned `/_evejs-web/v1` gateway (broad `/snapshot` route + `src/eveStore.js` table emulation), browser character-control leases, per-character idempotent commands with expected state versions, sequenced WebSocket events with replay/reconnect snapshots. All of that state is process-memory; a restart starts a new event epoch.

Direction: **strip toward the thin bridge.** Pages migrate one at a time to retail calls. As each migrates, delete its `eveStore` emulation path and its dependence on the broad snapshot. Retire the lease/idempotency/event machinery when the session-based bridge covers the same guarantees the way retail does. The v1 gateway remains until its last consumer is gone — but no new feature should be built on it.

### Web app tech stack (decided 2026-07-18)

The web app began as a slim read-only companion — a single ~2,600-line vanilla `public/app.js` plus hand-rolled WS/event/command layers, no types, no build. That fit the original scope; the client-surface ambition makes the browser a genuinely stateful client (a live session/space/inventory/journal mirror plus the client-side autopilot loop), so the stack moves. **This is web-app-only; eve.js is unaffected, and the Node + Express 5 + `ws` backend stays.**

- **TypeScript** — the project reproduces *typed* retail call/row contracts (`(service, method, args, kwargs)`, marshaled rowsets, flag constants, positional tuples). Types make the bridge compiler-checked; this is the highest-ROI change and the reason to move at all.
- **Vite** — a light build for TS + ES modules + the view layer.
- **A small reactive view layer** — Svelte 5 (recommended) or SolidJS; deliberately not a heavy SPA, to keep the UI text/data-driven and EVE-styled. The exact library is finalized by a spike on the first migrated page.
- **One client-state store** — a single source of truth mirroring the relevant EveJS session/space/inventory/journal state, with the UI **and** the browser autopilot loop as pure readers. It is fed by whatever event transport exists at the time: initially the legacy sequenced WS event stream, transitioning to bridge-forwarded session notifications (§9/G6) as the legacy machinery retires — the store's interface hides which. Keep it framework-agnostic (plain signals) so the view lib isn't load-bearing. This replaces the ad-hoc `eventClient`/`mutationScope` sprawl as pages migrate.

Applied **page-by-page on the R2–R6 rail** — each page rewrite to retail calls also moves it onto the new stack; no big-bang migration. R2 (re-scoped to the login → character select → station-entry spot test) was the proving ground and locked the view library: **Svelte 5** (the plain-signal store deliberately implements the Svelte store contract, so the view lib stays non-load-bearing).

## 6. Security posture (deliberate — do not "fix")

This is an emulator run in a trusted development environment.

- WAN hosting is expected: `0.0.0.0` binding is fine. EveJS already runs this way; **PlayerConnect** handles the WAN side and is out of scope for the web client.
- Login is emulator-style "who cares": the retail path already accepts any password via `devSkipPasswordValidation` / `devAutoCreateAccounts`. The web client should match — take a username and any password, log the character in. No real credential storage, no EveJS-backed auth project.
- Do not add auth hardening, token schemes, session-revocation work, or security-review gates, and do not block work on previously catalogued gaps (token-less loopback fallback, cookie flags, HMAC session lifetime). They are accepted by policy.

## 7. Milestone: courier mission in the browser

The milestone is complete only when a player can do all of this without opening the retail client:

1. Log in with an EveJS account and select an offline character.
2. View available agents and open an agent conversation.
3. Request and accept a courier mission.
4. See the mission briefing, cargo, pickup, destination, reward, and time bonus.
5. Move mission cargo into the active ship when required.
6. Verify the active ship has sufficient cargo capacity.
7. Take browser control of the character and start the route.
8. Undock and travel through every required gate using the browser-run (client-side) autopilot.
9. Dock at the destination station.
10. Deliver the required cargo.
11. Complete the mission through the agent interface.
12. Observe updated wallet, loyalty points, standings, inventory, and journal state.

The browser shows a compact live travel panel (current system, next system, target gate/station, travel state, remaining jumps, elapsed time, failure reason). No map or rendered scene.

Autopilot stays **client-side, in the browser** (decided 2026-07-18): retail autopilot is a client loop (`eve/client/script/parklife/autopilot.py` in the dump), and we keep it exactly that — the ~2-second decide-loop runs in the browser (the client surface) and issues the same atomic movement calls the retail client does (`beyonce.CmdWarpToStuffAutopilot` / `CmdFollowBall` / `CmdStargateJump` / `CmdDock`, `structureJumpBridgeMgr.CmdJumpThroughStructureStargate`). **EveJS gains no travel-job code**; its existing handlers stay authoritative for each atomic move, and route/pathfinding are client-side too (retail's `clientPathfinderService`). **Closing the browser tab is closing the client:** the loop stops, the ship completes whatever server-side command was last issued (a warp or approach in flight) and then sits — no further jumps — and browser control releases as its lease lapses. That is faithful retail behavior (identical to closing the real client mid-autopilot), not a failure mode; on tab close we issue no "stop", the ship simply stops receiving commands. The BFF is a **thin transport relay + session/lease holder; it must never autonomously drive movement when no client is connected** — doing so would make it a server-side bot, not a client. Movement authority stays server-side: the browser never simulates or predicts position, it only *sequences* the authoritative atomic calls, exactly as `autopilot.py` does (this supersedes the earlier "browser timers must never drive movement" phrasing — the browser sequences movement like retail, it just never simulates it). The browser may start, pause, resume, or abort the loop; travel pauses instead of guessing on any unsafe condition (invalid route, failed transition, lost control).

## 8. Roadmap

### Orchestrated execution

This project runs with a **master orchestrator session** and **worker sessions**:

1. The orchestrator writes each goal prompt and checks it into `docs/goal-prompts/`.
2. The operator hands the prompt to a fresh worker session.
3. The worker implements exactly that goal, leaves both repositories working, updates this table with status and evidence, and commits.
4. The operator returns to the orchestrator, which reviews the committed work against the prompt's definition of done before issuing the next goal.

**Every iteration commits its work** — including documentation-only iterations. No iteration ends with uncommitted changes. eve.js and web commits stay separate, both hashes are reported, and nothing is pushed unless separately requested.

| Goal | Status | Scope | Exit condition |
| --- | --- | --- | --- |
| R0 | Complete | Courier-path call inventory: mine the decompiled client for the (service, method, args) sequences behind login, character select, station UI, agent/courier flow, and travel | Done — [retail-call-inventory.md](retail-call-inventory.md) maps all 12 milestone steps to their retail calls with client file refs and EveJS coverage verdicts; key findings: autopilot/route are client-side browser work by design (G1/G2, reframed in the inventory's Direction section) and the courier remote-acceptance parity oracle fails 4 test-side assertions (G3 — own goal prompt; fix before R4) |
| R1 | Complete | Thin bridge endpoint (extend the existing `server/src/_secondary/express/evejsWebGateway.js` web interface; no game-mechanics change) + who-cares web login: browser-backed session creation and a whitelisted `(service, method, args, kwargs)` invocation path through `callMethod`. This is the only eve.js edit in the plan. | Done — gateway `POST /_evejs-web/v1/call` (eve.js `6de856fc`, gateway files + tests only): deny-by-default (service, method)-pair allowlist seeded with `charUnboundMgr.GetCharacterSelectionData` + `map.GetStationInfo`, gateway-materialized browser-backed session (JSON scalars in, `sendServiceNotification` captured into the response), refusals before any service lookup; web side: who-cares login (any/empty password; unknown username → 401 `UNKNOWN_EVEJS_ACCOUNT`), BFF `POST /api/bridge/call` + `eveGatewayClient.callMethod`, live character-selection bridge panel; contract documented in [bridge-wire-contract.md](bridge-wire-contract.md). Evidence: in-process end-to-end test (`eve.js server/tests/webGatewayServiceCall.test.js`, 8/8, drives the reference call and asserts off-allowlist/unknown refusals); live browser round-trip not available this session (no EveJS/web server was running; none started per policy) |
| R1b | Complete | Web stack scaffold (web repo only): TS + Vite build alongside the existing app, the framework-agnostic client-state store skeleton, and a browser-side TS `callMethod` client consuming R1's bridge route through a thin BFF proxy. No page migration, no view library. | Done — TS + Vite scaffold under `web/` (web repo only): `npm run build:web` (tsc typecheck + Vite build into git-ignored `public/dist/`, served at `/dist/` by the existing Express static setup; vanilla app untouched) and `npm run dev:web` (Vite dev server proxying `/api` to the BFF); plain-signal client-state store skeleton (`web/src/store/`: typed session/character/feed slices, subscribe/read API for pure readers, `FeedAdapter` seam hiding the event transport, in-memory adapter as the minimal proof); typed browser `callMethod` client (`web/src/bridge/`) with the reference call `charUnboundMgr.GetCharacterSelectionData` typed end to end incl. long/KeyVal decoding; 28 TS unit tests run natively by the same `npm test` (142/142, was 114/114; Node >= 22.18 for type stripping); scaffold smoke page at `/dist/`; TS-consumer + "how to add a page" notes appended to [bridge-wire-contract.md](bridge-wire-contract.md). View library deliberately not chosen (R2 spike) |
| R2 | Complete | **Spot-test milestone** (re-scoped 2026-07-18; character sheet/skills moved to a later goal): persistent browser-backed session in the gateway + `SelectCharacterID`, and the first page on the new stack (view-lib spike): login → character-selection UI → docked station panel (`GetStationInfo`/`GetStationItemBits`/`GetGuests`) | Done — **in-process end-to-end; live spot test pending operator** (README "Spot test (R2)"). eve.js `14e775aa` (gateway files + tests only): persistent-session store in the gateway runtime — `session/select` mints a live **registered** session (parity-test duck shape, all three notification surfaces captured) and dispatches the retail `SelectCharacterID` tuple through the allowlisted `callMethod` seam; `/call` takes an optional server-held `bridgeSessionID`; release + 30-min idle TTL run the same `sessionDisconnect` path as a retail socket close; refusals surface as typed `CALL_REFUSED` with the handler's own message; allowlist = exactly 5 pairs (R1's two + `charUnboundMgr.SelectCharacterID`, `stationSvc.GetStationItemBits`, `station.GetGuests`), deny-by-default proven still refusing before lookup. `server/tests/webGatewayPersistentSession.test.js` (8/8) proves fixture char online on a persistent session → docked reads + cross-session notification drain → refused-when-controlled → release/TTL → character offline. Web side: BFF `/api/bridge/select`/`release` keep the `bridgeSessionID` server-side in the cookie-session store (never in browser JS); **view lib locked: Svelte 5** (signal store doubles as Svelte stores); `/dist/` page = login → character list (typed `GetCharacterSelectionData`) → station panel (static station identity + `GetStationItemBits` + `GetGuests`; `GetStationInfo` issued faithfully, answers the retail cached-object envelope). Wire contract updated ("Persistent browser-backed sessions"); web tests 168/168 (was 142) |
| R3 | Complete | Station inventory and ship operations via the same services retail uses (`invbroker`, ship/station services) | Done — **in-process end-to-end; live spot test pending orchestrator** (README "Spot test (R3)"). Introduces the retail **bound-object (moniker/`MachoBindObject`) two-step** that R4/R5 reuse. eve.js `0682492e` (bound-object bridge) + `7f22a89d` (echo active shipID in select), gateway files + tests only: `POST /_evejs-web/v1/bound/bind` mints an opaque `boundHandle` (dispatches an allowlisted bind — `invbroker.GetInventory`/`GetInventoryFromId`/`MachoBindObject`, `ship.MachoBindObject` — registers the bound OID on the shared service manager as `packetDispatcher` does, and holds it on the persistent session); `POST /_evejs-web/v1/bound/call` resolves the handle on that session only, enforces deny-by-default on the bound `(service, method)` **before** resolving the OID, sets `currentBoundObjectID`, and dispatches through `callMethod`. Handles are confined to their session and never cross to the browser; released on session teardown. R3 allowlist adds 10 pairs (invbroker `MachoBindObject`/`GetInventory`/`GetInventoryFromId`/`List`/`Add`/`MultiMerge`/`StackAll`/`GetCapacity`, ship `MachoBindObject`/`Board`). `server/tests/webGatewayBoundObject.test.js` (7/7) proves bind→`List` returns the seeded items, `Add` relocates an item hangar→cargo (verified by a follow-up `List`), `GetCapacity` answers a real number, `StackAll` merges, `Board` makes a hangar ship active, a non-allowlisted bound method is refused before any dispatch, and foreign/unknown handles are typed errors. Web side: BFF holds the handles server-side keyed by web session (`/api/bridge/inventory` + `/inventory/move`/`/inventory/stack`/`/ship/board`), the browser addresses items/ships by game IDs only; Svelte **Inventory & Ship** page at `/dist/` (typed `inventoryShip` decoders + `inventory` store slice + flow), `Promise.allSettled` per-container reads. Wire contract + README updated; web tests 198/198 (was 170). |
| R4 | Pending | Agents and courier missions (`agentMgr` and mission services) | Accept a courier mission in the browser |
| R5 | Pending | Undock, **client-side (browser) autopilot** travel, dock — the browser runs `autopilot.py`'s decide-loop, issuing the existing atomic `beyonce`/jump/dock calls; browser owns route + pathfinding. Closing the tab stops autopilot (client closed), like retail. | Full multi-jump route completed from the browser; EveJS travel handlers unchanged; closing the tab halts progression with the ship left where its last command finished |
| R6 | Pending | Courier milestone end to end + legacy cleanup | The 12-step milestone passes; broad snapshot, eveStore emulation, and redundant lease/command machinery removed |

After R6: expand the client surface as practical — mail, market transactions, fitting, chat, contracts, corp tools — each area starting from its mined retail calls. Mining and combat are reconsidered only after the courier loop is solid.

## 9. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Retail handlers expect retail argument shapes | Mine exact call sites from the decompiled client; use the parity tests as the oracle for args and returns |
| Handlers emit session/TCP-style notifications | The browser-backed session captures notifications and the bridge forwards them as browser events |
| Retail client and browser control the same character | EveJS's own duplicate-login/session rules plus the existing control runtime until it is redundant |
| A mechanics change sneaks into eve.js | Bridge-only rule: eve.js diffs may touch bridge/interface files only, and reviews enforce it |
| Retail autopilot logic is client-side | Keep it client-side in the browser: the browser runs the autopilot decide-loop and issues authoritative atomic moves; EveJS handlers are unchanged. Closing the tab = closing the client → autopilot stops (faithful). The BFF only relays; it never drives movement with no client connected, and the browser never simulates movement |
| Mission content coverage is limited | Start with one deterministic courier fixture; expose only missions EveJS can actually issue |
| Legacy gateway and bridge drift apart mid-migration | Migrate page by page, deleting each legacy path as its page moves; no new features on the v1 gateway |

## 10. Operational rules

- Never start or stop processes you did not start. Before server work, check ports 443, 26000, 26001, 26002, 26003, 26500, and 40110.
- Never delete or rewrite `_local` gameplay data, web `data/`, icon caches, manifests, or ignored credential files.
- Preserve all unrelated EveJS parity and emulator work; never reset or revert it. Stay on `main` (eve.js) and `master` (web).
- Commit every iteration's work in the repo it touches — documentation included; no iteration ends with uncommitted changes. Commit eve.js and web changes separately and report both hashes. Never push unless explicitly requested.
- `eve.js/doc/PHASE_0E_ITEM_CUSTODY.md` belongs to EveJS's internal phase numbering and has nothing to do with this roadmap.

## 11. Retired decisions (recorded 2026-07-18 — do not resurrect)

- **"The gateway must not invoke `Handle_*`"** — retired. Invoking the same handlers the retail client hits is now the core architecture. The old rule's concerns (retail arg shapes, TCP-style notifications) are handled by mirroring retail call sites and forwarding session notifications.
- **Goal 0E (narrow versioned query projections)** — retired unimplemented. Broad snapshots are replaced by retail-call responses as pages migrate, not by a bespoke projection layer.
- **Goal 0F (EveJS-backed web authentication)** — retired unimplemented. Login is who-cares by policy (section 6).
- **Localhost-only rule and the security-hardening backlog** — retired. Trusted dev environment, WAN-hosted, PlayerConnect out of scope.
- **"Text-first companion app" framing and the hard combat exclusion** — superseded. The ambition is the client surface, courier first; combat is deferred, not forbidden. The UI remains text/data-driven.
- **The Goal 0A–0D.1 ladder and its execution records** — completed work, preserved in git history (this file at `8dccc5d` and earlier). The machinery it built is transitional (section 5).
- **Server-owned autopilot / server travel-job orchestrator, and the "browser timers must never drive movement" rule** — retired 2026-07-18 (same day it was written, reversed after R0). Autopilot is client surface: the browser runs the decide-loop and sequences the authoritative atomic calls (section 7); EveJS gains no travel-job code; the BFF never drives movement with no client connected. Do not reintroduce a server travel job.
