# EveJS Web Client

Browser client for a local or WAN-hosted EveJS server.

The goal is to reimplement as much of the EVE Online client as practical in the browser, by driving the **same service calls the retail client makes** against the same EveJS handlers. EveJS is the game server and sole authority; this app is an alternate client, not another simulation. The full scope, architecture, and roadmap live in [docs/web-client-scope-and-roadmap.md](docs/web-client-scope-and-roadmap.md) — read that first.

This repo is intentionally separate from `eve.js`. The web process never reads or writes gameplay SQLite; all gameplay state flows through EveJS.

## Run

```powershell
npm install
npm start
```

Open `http://127.0.0.1:26500`.

Login is emulator-style "who cares" (since R1): enter an existing EveJS account username and **any password, including none** — passwords are not checked. Unknown usernames are rejected. The old `npm run webpass` scrypt store still exists but is bypassed and no longer needed.

## TS web stack (R1b scaffold)

The R2+ page migrations build on a TypeScript + Vite stack under `web/`, living alongside the vanilla `public/` app (roadmap section 5). Node >= 22.18 is required (the TS unit tests run natively under `node --test` via type stripping).

```powershell
npm run typecheck   # tsc, no emit
npm run build:web   # typecheck + Vite build into public/dist/ (git-ignored), served at /dist/
npm run dev:web     # Vite dev server; proxies /api to the BFF (EVEJS_WEB_BFF_URL overrides)
npm test            # node --test: vanilla JS tests + web/**/*.test.ts together
```

After `npm run build:web`, the first migrated page (goal R2, Svelte 5) is at `http://127.0.0.1:26500/dist/` — it has its own login form, so no vanilla-app sign-in is needed. See the "Consuming the bridge from TypeScript" section of [docs/bridge-wire-contract.md](docs/bridge-wire-contract.md) for the client/store layout and how to add a page.

### Styling: Tailwind CSS v4, responsive (R8)

The Svelte app is styled with **Tailwind CSS v4** via its first-party Vite plugin (`@tailwindcss/vite`), CSS-first: `web/src/styles.css` does `@import "tailwindcss"` (imported from `main.ts`), so `npm run build:web` compiles Tailwind into the `public/dist/` bundle automatically — no `tailwind.config.js` or PostCSS step. The Eve-dark palette lives in an `@theme` token block; the element/component look is built in `@layer base`/`@layer components` on top of Tailwind's preflight.

The UI is **mobile-first responsive** from ~360px phones up to desktop: the tab bar wraps to touch-sized rows on a phone; data tables (station guests, inventory, agents, search results) reflow to stacked labelled **cards** at ≤640px and stay tables on wider screens (each wrapped so a wide table scrolls in its own box, never the page); form/control rows stack full-width on mobile; the page container caps its width on desktop for readable line length. Names-only still holds — no numeric game IDs are rendered.

## Spot test (R2): log in → pick a character → see your station

The first live end-to-end check of the new stack (goal R2). What it proves: the browser drives the real retail calls (`SelectCharacterID` on a persistent live session, then the docked reads) against the same EveJS handlers the retail client hits.

1. Start EveJS (`eve.js` repo) the way you normally run it, so the web gateway is listening on `:26002`.
2. In this repo: `npm run build:web` (once, or after pulling), then `npm start`.
3. Open `http://127.0.0.1:26500/dist/`.
4. Log in with the EveJS account that owns your test character (any password — it is not checked).
5. Click the character (e.g. **Farmer**). This brings the character **online on a live EveJS session** — the same duplicate-login and control rules as the retail client apply, so a character already logged in elsewhere is refused with the server's own message.
6. You should see the docked station panel: station name/system/region (client-local static data, as in retail), the `GetStationItemBits` services row, and the `GetGuests` list with your character in it.

What to expect:

- **Going offline:** the "Go offline" button releases the session (character logs off through the same disconnect path as a retail client closing). Closing the tab does *not* release immediately — the gateway's idle TTL (30 minutes) reaps the session and logs the character off then. Logging out also releases.
- While the browser session is live, a retail-client login for the same character is refused ("already online") unless login takeover is enabled, in which case the retail client evicts the browser session — faithful behavior; the page will report the session as lost on its next call.
- `map.GetStationInfo` is issued faithfully but answers with the retail cached-object envelope; the panel notes this rather than decoding rows from it (station identity comes from static data, exactly like retail's client-side static DB).
- If the panel looks stale after server-side changes, use "Refresh panel" — push forwarding of notifications is a later goal (G6); the backlog is drained into each call response for now.

## Spot test (R3): station inventory + ship operations

The second live check (goal R3). What it proves: the browser drives the retail **two-step bound-object** call pattern (`invbroker` / `ship` moniker → `MachoBindObject` → `List`/`Add`/`StackAll`/`Board`) against the same handlers the retail client hits. The bound-object handles live only in the BFF and gateway — the browser moves items and boards ships by their game IDs.

1. Same setup as the R2 spot test (EveJS running, `npm run build:web`, `npm start`).
2. Open `http://127.0.0.1:26500/dist/`, log in as the account that owns **Farmer**, and select the character (R2 flow).
3. Click the **Inventory & Ship** tab. You should see two panels: the **station hangar** (all hangar items, with a capacity readout) and the **active-ship cargo** (its items + cargo capacity).
4. **Move an item:** click **→ Cargo** on a non-ship hangar item (optionally type a quantity first for a partial move). The item should disappear from the hangar and appear in the cargo, and cargo "used" should rise. **→ Hangar** moves it back. **Stack all** consolidates loose stacks.
5. **Board a ship:** a ship sitting in the hangar shows a **Board** button. Click it — that ship becomes the active ship, and the cargo panel now shows *its* cargo.

What to expect:

- Every move/board is validated server-side by the real handlers, exactly as retail — an over-capacity move, an unfittable item, or a ship you cannot board is refused with the handler's own reason (shown under "Last action failed"), and nothing relocates.
- Reads refresh after each mutation (push forwarding is still G6). A slow or failed read of one container never blanks the other (`Promise.allSettled`).
- There is no separate "split stack" call (gap G4); a partial quantity folds into the move.
- Moving cargo requires an active ship with a cargo hold. If your active ship is a **Capsule**, board a real ship first — a capsule has no cargo.

## Spot test (R4): talk to an agent → accept a courier → see it in the journal

The courier milestone's key check (goal R4). What it proves: the browser drives the retail `agentMgr` bound-object flow (`GetAgents` → `MachoBindObject` the agent moniker → `DoAction` → `GetMission*` / `GetMyJournalDetails`) against the same handlers the retail client hits, and **accepts a courier mission entirely in the browser**. The agent bound handle lives only in the BFF and gateway — the browser addresses agents and missions by their game IDs.

**Setup expectation:** the character must be **docked at a station that has an agent offering a courier** (the accept is in person — a co-located accept, the normal path). Not every station has one; pick a character docked at an agent station (level-1 courier agents are common). The orchestrator's live check docks Farmer at such a station.

1. Same setup as the R2/R3 spot tests (EveJS running, `npm run build:web`, `npm start`).
2. Open `http://127.0.0.1:26500/dist/`, log in, and select the character (R2 flow).
3. Click the **Agents & Missions** tab. You should see the **station agents** list and your **mission journal** (active + offered).
4. **Talk to an agent:** click an agent. The **Conversation** panel shows what the agent says and the available action buttons (Request Mission / Accept / Decline / …), rendered from the retail `availableActions`.
5. **Request + accept a courier:** click **Request Mission** to get an offer, then **Accept**. The conversation advances to the accepted state, the **Courier briefing** panel appears (cargo type/quantity/volume, pickup, destination, reward, time bonus, loyalty points), and the accepted mission shows under **Active** in the journal.

What to expect:

- Everything is validated server-side by the real handlers, exactly as retail. Accepting is the **synchronous in-person path**; **declining** is a retail *deferred* round-trip — the gateway drives it to completion (a direct decline, since the browser has no client YesNo dialog) and the offer clears from the journal.
- ISK rewards and mission times are decoded bigint-safe (they can exceed 2^53) — no silent zeroes or rounding.
- Moving the courier cargo into your ship is the R3 inventory move (**Inventory & Ship** tab); completing/turning in the mission (the delivery end) is R6.
- Reads refresh after each action (push forwarding is still G6). A slow or failed briefing read never blanks the rest (`Promise.allSettled`).

## Spot test (R5a): undock → warp to a gate → jump → dock (manually stepped)

The travel foundation (goal R5a). What it proves: the **persistent browser-backed session participates in space** the way a retail socket session does — `ship.Undock` puts the character in space, and the retail **remote-park** bound calls (`beyonce.CmdWarpToStuffAutopilot` / `CmdStargateJump` / `CmdDock`) move the ship through space against the same handlers the retail client hits. Movement is **manual, one button per step** here; the client-side autopilot decide-loop and route solver are R5b. EveJS gains no travel-job code — the browser only sequences the atomic moves.

**Setup expectation:** the character is docked and has an active ship that can undock, warp, and jump (Farmer's ship works). You need the **game IDs** of the gate/celestial to warp to, the source + destination **stargate IDs** to jump, and the destination **station ID** to dock — R5a has no route solver, so you supply them. From Maurasi (system 30000140, where the orchestrator docks Farmer at station 60003454), a worked example: warp to gate `50000801` (→ Kisogo), or use the neighbours mapped in `docs/retail-call-inventory.md` Steps 7–9. A simple round trip: undock, warp to a gate, dock back at your origin station.

1. Same setup as the R2–R4 spot tests (EveJS running, `npm run build:web`, `npm start`).
2. Open `http://127.0.0.1:26500/dist/`, log in, and select the character (R2 flow).
3. Click the **Flight** tab. The **Status** readout shows *Docked · station …*, the solar system, and the active ship.
4. **Undock:** click **Undock**. Click **Refresh flight status** — the readout flips to *In space · system …* with a ship movement state (e.g. `STOP`).
5. **Warp:** enter a gate/celestial ID under **Warp to a gate / celestial** and click **Warp to target**. Refresh — the ship state shows `WARP`.
6. **Jump:** once at the gate, enter the source + destination stargate IDs under **Jump through a stargate** and click **Jump**. Refresh after a moment — the **Solar system** changes to the destination.
7. **Dock:** once at the destination station, enter its station ID under **Dock at a station** and click **Dock**. Refresh — the readout returns to *Docked · station …*.

What to expect:

- Every move is validated server-side by the real space handlers. The browser never simulates or predicts position; it only issues the atomic calls (exactly like retail's `autopilot.py`, minus the loop).
- **Pause on unsafe:** a refused move (warp scrambled, invalid target, out-of-docking-range → docking-approach, lost control, ship destroyed) shows as the handler's own reason under **Last failure** — never a silent no-op or a fake success.
- Warp travel and the jump handoff take time; the ship keeps its last command in flight. Refresh flight status to see where it actually is (push streaming is G6). Closing the tab is closing the client — the ship finishes its last command and sits (R5b autopilot behaviour, faithful to retail).

## Spot test (R5b): pick a destination → the browser autopilots there

The client-side autopilot (goal R5b). What it proves: the **browser** runs the retail autopilot decide-loop — it solves the jump route locally (client-side route solver over the static gate graph, no server route call) and then **sequences** the R5a atomic moves (undock → warp to each gate → jump → warp to the station → dock) autonomously, reading `flight-status` between moves. Movement stays authoritative on the server; the browser only sequences it, exactly as `autopilot.py` does. Closing the tab stops the autopilot (the ship finishes its last move and sits) — faithful to closing the retail client mid-autopilot.

**Setup expectation:** the character is docked with an active ship that can undock/warp/jump (Farmer works). Pick a destination **a few jumps away** — a **station ID** (a courier destination) or a **solar system ID**. From Maurasi (system `30000140`), Jita is one jump: station `60003760` (Jita 4-4) is a good target.

1. Same setup as the R2–R5a spot tests (EveJS running, `npm run build:web`, `npm start`).
2. Open `http://127.0.0.1:26500/dist/`, log in, and select the character (R2 flow).
3. Click the **Travel** tab. Under **Start route**, enter the destination ID (e.g. `60003760`) and click **Start route**.
4. The route is computed from your current location and the **Status** readout goes live: current/next system, target, travel state, **remaining jumps**, and **elapsed time**. The **Planned route** lists each hop (which gate to warp to, which gate to jump through).
5. Watch it drive itself: undock → warp to the gate → jump → (next system) → … → warp to the station → dock. The dock is re-issued through the approach until the ship is in range (approach-then-redock).

What to expect:

- **Client-side loop, server-authoritative moves.** The ~2-second loop lives in the browser and only sequences the atomic calls; each move's truth comes from `flight-status`. EveJS gains no travel-job code.
- **Controls:** **Pause** stops issuing (the ship finishes its current move and sits); **Resume** continues from where it stopped; **Abort** stops for good. After abort/pause the loop never calls the bridge again.
- **Pause on unsafe:** a refusal that is not the normal docking-approach (warp scrambled, gate restricted, invalid target, lost control) pauses the loop and shows the handler's own reason under **Failure** — it does not guess.
- **Tab close = client close:** closing the tab stops the autopilot with **no "stop" sent** — the ship completes whatever server-side command was last issued and then sits. The BFF is a relay + session holder; it never advances travel with no client connected.

## Spot test (R6): the full courier run — pick a courier agent → accept → load the package → autopilot to the dropoff → Complete → see the reward

The courier-milestone capstone (goal R6): a player completes a courier mission entirely in the browser. What it proves: the built pieces (agent accept, inventory move, browser autopilot) tie into one run, plus the new gameplay — deliver + **Complete** — and the post-completion wallet/LP/standings/journal readout (inventory Step 12).

**Setup expectation:** the character is docked at a station with courier agents and an active ship with cargo space (Farmer at Jita 4-4, station `60003760`, which has 882 courier agents). Same server setup as the R2–R5b spot tests (EveJS running, `npm run build:web`, `npm start`).

1. Open `http://127.0.0.1:26500/dist/`, log in, and select the character (R2 flow).
2. Click the **Agents & Missions** tab. The roster is filtered: **Courier only** is on by default, with a **Level** dropdown and a **Search** box, and the render is capped (first 60, with a "showing X of Y" count) so the ~1,700-agent station stays responsive. Narrow to a level-1 courier agent and click it.
3. In the conversation, click **Request Mission**, then **Accept** (in person — you are docked at the agent's station). The **Courier briefing** shows the package (type / quantity / volume), pickup, **destination station**, reward, time bonus, and loyalty points; the mission appears under **Active** in the journal.
4. Click **Load package into ship** (the R3 inventory move loads the staged package into the active ship's cargo). Verify capacity on the **Inventory & Ship** tab if you like.
5. Click **Set autopilot to dropoff** (reuses the R5b route solver + browser autopilot to fly to the dropoff station), then watch it drive on the **Travel** tab (undock → warp → jump → … → dock), exactly as the R5b spot test.
6. Docked at the dropoff, reopen the agent conversation (or the journal) and click **Complete Mission**. The mission completes.
7. The **Reward & wallet (post-completion)** panel shows the updated **wallet balance**, the **loyalty points** for the agent's corp, and the **standings** gained; the mission leaves the **Active** journal.

What to expect:

- **Complete is the synchronous `agentMgr.DoAction(<complete>)`** — the same bound two-step accept uses, no new call. Courier delivery has no distinct RPC: `DoAction(Complete)` validates the package at the dropoff and pays out.
- **The reward reads are pull-refreshes** (`account.GetCashBalance` / `LPSvc.GetAllMyCharacterWalletLPBalances` / `standingMgr.GetCharStandings` / `agentMgr.GetMyJournalDetails`) issued after Complete — deny-by-default, top-level reads on the held session.
- The full accept→cargo→autopilot→complete path is proven in-process against a deterministic courier fixture (`eve.js server/tests/webGatewayCourierComplete.test.js`); this spot test is the live end-to-end run.

## Spot test (R6a): find a courier agent → set the autopilot to it

The Agent Finder (goal R6a). What it proves: a player can **find a courier agent to travel to** even when the per-station roster is empty. The per-station `agentMgr.GetAgents` returns 0 for a character re-selected directly into a docked station (and only ever lists the current station's agents), so the finder lists agents from **static reference data** (`agentAuthority`), sorts them by **jumps from the current system** (a single client-side BFS over the map graph — no server route call), and sets the **browser autopilot** (R5b) to a chosen agent's station. Traveling there and docking populates the live agents normally, so you can then talk to the agent and accept a courier (R4/R6). Web-only — no eve.js change.

**Setup expectation:** the character is docked (Farmer at Jita 4-4, station `60003760`, system Jita `30000142`). Same server setup as the R2–R6 spot tests (EveJS running, `npm run build:web`, `npm start`).

1. Open `http://127.0.0.1:26500/dist/`, log in, and select the character (R2 flow).
2. Click the **Agent Finder** tab. It loads couriers by default, each row showing **name, level, mission kind, station, system, and jumps away**, sorted **nearest-first** from your current system. The render is capped (first 60, with a "showing X of Y" count) so the ~11k-agent dataset stays responsive.
3. Set **Level** to `1` to narrow to level-1 couriers (the full level is fetched, so the sort is complete). Use **Search** (name / system) to jump to a system, e.g. type `Jita`.
4. Pick a **nearby** L1 courier and click **Set destination**. The **Autopilot target** panel names who you're flying to, and the app switches you to the **Travel** tab where the R5b autopilot is already running.
5. Watch it drive itself (undock → warp → jump → … → dock), exactly as the R5b spot test. On arrival, the **Agents & Missions**, **Station**, and **Inventory & Ship** panels reflect the new station **without a page reload** (R6b) — open **Agents & Missions** to talk to the agent and accept a courier (R4/R6).

What to expect:

- **Static reference data, not a gateway call.** `GET /api/agents/find?kind=courier[&level=N]` reads `agentAuthority/data.json` through `src/staticData.js` — the same read-only static-data pattern as `/api/map/graph`. It filters by kind (default courier) + optional level and caps the result server-side; the browser sorts by jumps and renders a page.
- **Real distribution agents only (R6b).** The finder classifies each kind by its retail agent division + type — courier = Distribution division 22 / basic agent type 2 — not the raw `missionKind` the static export also stamps on special agents. So Paragon (e.g. "IRIS - Jita" 3020034), epic, career, storyline, and event placeholders no longer appear under Courier.
- **Panels refresh on dock (R6b).** When the docked station changes (autopilot arrival, manual dock, select), the flow learns it from flight status and re-fetches the Station panel, agent list, and inventory for the new station without a reload; opening the Agents tab always shows the current station.
- **One BFS, not one route per agent.** `distancesFrom(originSystemID)` runs a single breadth-first sweep over the already-loaded gate graph, giving the jump distance to every system at once; the finder looks each agent's system up. Unreachable systems sort last.
- **Set destination reuses the R5b autopilot** (`startRoute(agent.stationID)`) — no new movement code.
- Proven in-process by `test/agentFinder.test.js` (staticData read/filter + classification + the `/api/agents/find` route), `web/src/nav/routeSolver.test.ts` (`distancesFrom`), `web/src/app/finderFlow.test.ts` (the finder flow), and `web/src/app/dockRefreshFlow.test.ts` (the dock refresh); this spot test is the live end-to-end run.

## Spot test (R7): the character shows up in Local and Corp chat — read and send

Local + Corp chat (goal R7). What it proves: the browser character **appears in Local and Corp** (others see it; it sees the roster) and can **read and send** in both, from a **Chat** panel. Retail chat runs over XMPP and its delivery deliberately bypasses the notification drain, so READ is a **poll of the backlog store** (`chatRuntime.getChannelBacklog`), not an RPC that returns messages. Local presence is derived live from the session registry (`getVisibleLocalSessions`); the gateway **joins Local on select** and moves the room on a system change (the browser session's `sendSessionChange` is a capture stub, so retail's auto chat-sync never fires). Corp is XMPP-only in retail, so R7 adds a **session-derived corp path** mirroring Local: the roster is enumerated from the session registry by `corporationID`, and a corp send writes to the `corp_<id>` backlog (not an XMPP send).

**Setup expectation:** the character is docked (Farmer at Jita 4-4, station `60003760`, system Jita `30000142`), in a corporation. Same server setup as the R2–R6 spot tests (EveJS running, `npm run build:web`, `npm start`).

1. Open `http://127.0.0.1:26500/dist/`, log in, and select the character (R2 flow).
2. Click the **Chat** tab. It opens on **Local**, showing the **member roster** (every pilot in your system, including you) and the **recent messages**. It polls the open channel every ~4s.
3. Type in the send box and **Send**. Your message appears in the Local backlog (confirm from a second client in the same system, e.g. the retail client or another browser login, that it shows up — and that your character is listed in their Local).
4. Switch to the **Corp** tab: it shows your **corp roster** (your corp-mates who are online) and the **corp backlog**. Send a corp message; corp-mates polling corp (or the retail client) see it.
5. Close the tab (switch away): polling stops. Undock and travel (R5b) to another system, then reopen Chat — **Local now reflects the new system** (the poll re-syncs presence on a dock/system-change).

What to expect:

- **READ is a backlog poll.** `POST /_evejs-web/v1/chat/read` returns the channel's live member roster + recent backlog; the BFF exposes it as `GET /api/bridge/chat/:channel`, which the panel polls while open and stops polling when closed. There is no chat push (that is G6).
- **SEND.** `POST /_evejs-web/v1/chat/send` broadcasts to Local (`chatRuntime.broadcastLocalMessage`) or Corp (the session-derived corp broadcast); the BFF exposes it as `POST /api/bridge/chat/:channel/send`. A channel access failure or mute surfaces as the handler's own `CALL_REFUSED` reason.
- **Presence.** The gateway calls `chatHub.joinLocalChannel` on select and `chatHub.moveLocalSession` on a system change; the corp channel record is ensured and the corp roster is derived from the session registry by `corporationID`. Core chat mechanics (`chatRuntime`/`chatHub`/`xmppStubServer`) are untouched — only called.
- Proven in-process by eve.js `server/tests/webGatewayLocalChat.test.js` (join → visible in `getVisibleLocalSessions` + the read roster, send lands in the backlog + reads back, a second same-system pilot sees the char, a system change moves the room) and `server/tests/webGatewayCorpChat.test.js` (the browser char in the corp roster, session-derived by `corporationID`, corp send to the `corp_<id>` backlog reads back), plus web-side `test/bridgeChat.test.js`, `web/src/bridge/chat.test.ts`, and `web/src/app/chatFlow.test.ts`. This spot test is the live end-to-end run.

## Spot test (R7a): read the Flight tab by name → pilot anywhere by name

Travel usability (goal R7a). What it proves: the **Flight** tab shows system/station **names** (not raw EVE IDs), and the **Travel** tab lets you **search any system or station by name and Set destination** — so you can pilot to Jita (or anywhere) without knowing IDs and without going through the Agent Finder / courier flow. Web-only — no eve.js change.

**Setup expectation:** the character is docked (Farmer at Jita 4-4). Same server setup as the R2–R7 spot tests (EveJS running, `npm run build:web`, `npm start`).

1. Open `http://127.0.0.1:26500/dist/`, log in, and select the character (R2 flow).
2. Click the **Flight** tab. The **Location** line reads `Docked · Jita IV - Moon 4 - Caldari Navy Assembly Plant` and the **Solar system** row reads `Jita (30000142)` — the resolved **names**, not bare IDs. (Undock and it reads `In space · Jita`.)
3. Click the **Travel** tab. Under **Set destination**, type a name — e.g. `Jita`, or the name of a system a few jumps away — and click **Search** (or press Enter). A short results list shows each match's **name, kind (system/station), system, and jumps away**, with the exact-name system ranked first.
4. Click **Set destination** on a result. The R5b autopilot starts immediately (the panel switches to the live route readout) and drives there — undock → warp → jump → … → dock — exactly as the R5b spot test.
5. The **Start route by ID** block below the search still accepts a raw station/solar-system ID as a fallback.

What to expect:

- **Names, not IDs (Fix 1).** The Flight readout resolves the current system / station ID → name through the existing read-only `/api/map/resolve/:id` route, cached client-side so the flight-status poll doesn't refetch. An ID with no static name (e.g. a player structure) or one not yet resolved falls back to showing the ID.
- **Search anywhere by name (Fix 2).** `GET /api/map/find?q=<text>[&kind=system|station]` searches the static solar-system + station tables (read-only static data, mirroring `/api/agents/find` — **not** a gateway call), ranks by match quality (exact → prefix → substring) so "Jita" surfaces the Jita system first, and caps the result. **Set destination** reuses the R5b autopilot (`startRoute(id)`) — no new movement code; jumps-away come from the already-loaded map graph (`distancesFrom`).
- Proven in-process by `test/bridgeMapFind.test.js` (the name search + `/api/map/find` route against real + fixture data), `web/src/app/flightFlow.test.ts` (the Flight status resolves and caches names), and `web/src/app/travelFlow.test.ts` (search → jumps annotation → Set-destination via startRoute); this spot test is the live end-to-end run.

## Spot test (R7c): names everywhere — no raw IDs across the tabs

Display pass (goal R7c). What it proves: across every tab, raw numeric IDs are shown as **names** — ships/items as **type names**, agents as **agent names**, corps/alliances/factions/characters as **names**, and locations as **station/system names** — with the ID kept only as a secondary detail or an unresolved fallback. Web-only — no eve.js change.

**Setup expectation:** the character is docked (Farmer at Jita 4-4). Same server setup as the R2–R7a spot tests (EveJS running, `npm run build:web`, `npm start`).

1. Open `http://127.0.0.1:26500/dist/`, log in, and select the character (R2 flow).
2. **Inventory & Ship** tab: the **Type** column reads item names (e.g. `Tritanium`) and the **Cat** column category names (e.g. `Ship`) — not `34` / `6`; the active-ship cargo header reads the **ship type name** (e.g. `Ibis (ship …)`). The raw typeID/categoryID stay on the cell tooltip and the Item column keeps the itemID.
3. **Station** tab: the services row shows **Owner** as the corp/faction name (`… · School of Applied Knowledge`) and **Station type** as the type name; the **Guests** table shows character / corporation / alliance **names** (IDs on the tooltip).
4. **Agents & Missions** tab: agent buttons and the conversation heading read the **agent name** (e.g. `Antaken Kamola`), the courier briefing shows the **cargo type name** and **station + system names** for pickup/destination, and the reward LP/standings rows show **corp / owner names**.
5. **Agent Finder / Travel** tabs: still name-resolved (R6a/R7a); the finder's "sorted nearest-first from …" note now names the origin system, and any leftover `System {id}` fallback attempts a name first.

What to expect:

- **One batched round-trip, cached, non-blocking.** Components ask for names by `(kind,id)`; the client name cache (`app/flow.ts` `requestNames`) batches every unresolved ref raised in a tick into one `POST /api/names` and caches each result — including a definitive **null** (unknown) so it never refetches. IDs render instantly and swap to names as they arrive; nothing blocks on resolution.
- **Static, not a bridge call.** `POST /api/names` resolves `{kind,id}` refs over `src/staticData.js` (read-only gameStore reference tables, like `/api/map/find`) — **not** a gateway/bridge call.
- **IDs kept where they still matter.** A field with no name in any available data stays an ID: the mission `title` (a localization message id), route-hop warp/jump **gate** IDs, the services **operationID**, and the labeled **Station ID** reference row (its name is the panel header).
- Proven in-process by `test/bridgeNames.test.js` (the `resolveNames` batch across kinds + the `/api/names` route shape/unknown/empty/auth) and `web/src/app/namesFlow.test.ts` (batching, cache-no-refetch, definitive-unknown, transient-retry, and a previously-ID cell rendering the name); this spot test is the live end-to-end run.

## Configuration

Defaults assume both repos live under `C:\Users\ryanf\Documents\GitHub`:

```text
C:\Users\ryanf\Documents\GitHub\eve.js
C:\Users\ryanf\Documents\GitHub\evejs-web-poc
```

Optional environment variables:

```text
PORT=26500
HOST=127.0.0.1
EVEJS_ROOT=C:\Users\ryanf\Documents\GitHub\eve.js
EVEJS_GATEWAY_URL=http://127.0.0.1:26002/_evejs-web/v1
EVEJS_WEB_GATEWAY_TOKEN=
EVEJS_ICON_CACHE_DIR=C:\Users\ryanf\Documents\GitHub\evejs-web-poc\data\icon-cache
```

Set `HOST=0.0.0.0` for WAN hosting; this is a trusted-environment emulator and hardening is deliberately out of scope (see roadmap section 6).

## Local Icon Cache

By default, item and skill icons fall back to `https://images.evetech.net`. To cache icons locally, run the manual scraper:

```powershell
node scripts/cache-icons.js --dry-run
node scripts/cache-icons.js --rate-limit 60/min --limit 200
```

The default scraper source scans the current EveJS gamestore and downloads the icon variants the web app is likely to show. `EVEJS_GAMESTORE_DB` may override that scraper-only database path; the web runtime never uses it for gameplay access. Cached files are written under the ignored `data/icon-cache/` directory and served by the web app from `/icon-cache/...`. A cache manifest is written to `data/icon-cache/manifest.json` during real runs.

For rate limiting, prefer `--rate-limit 60/min`. The downloader is sequential and waits before every CDN request, including retry attempts, so `60/min` means one request starts about every second. You can still use `--delay-ms 1000`; `--rate-limit` is clearer when you want a request budget.

Useful options:

```powershell
node scripts/cache-icons.js --type 34 --type 670 --rate-limit 60/min
node scripts/cache-icons.js --file .\typeids.txt --variations icon,bp,bpc --rpm 60
node scripts/cache-icons.js --source all-types --rate-limit 60/min --limit 500
node scripts/cache-icons.js --force --rate-limit 30/min --limit 100
node scripts/cache-icons.js --manifest .\data\icon-cache\manifest.json --type 34 --rate-limit 60/min
```

If running through npm, pass an extra separator before script options:

```powershell
npm run cache-icons -- -- --dry-run
```

## Current Function

After web login, the app lists characters for the EveJS account and opens a dark Eve-style capsuleer console with selectable Caldari, Amarr, Gallente, and Minmatar header themes.

Current pages:

- overview summary (wallet, location, PLEX, skill points, queue state, inventory and industry summaries)
- skill browser with drag/drop queue planner and save / save-paused controls
- grouped skill browser sections with group filter/search
- Jita 4-4 market orders, browsed by category (read-only)
- inventory/assets with a location selector, item group summaries, and fitted-item location translation (ship slots, drone bay, station, system)
- read-only industry jobs and blueprint library with timers, ETA, and progress
- PI colony and extractor overview with extractor restart

The two registered gameplay mutations are skill-queue save (with a save-paused variant) and PI extractor restart. Both run through EveJS's authoritative validation and runtime code; EveJS owns persistence.

## Current plumbing (transitional)

Today the app talks to EveJS through the versioned `/_evejs-web/v1` gateway: broad character snapshots for reads, exclusive browser character-control leases, per-character serialized commands with idempotency keys and expected state versions, and a sequenced WebSocket event stream with replay and reconnect snapshots. Lease, receipt, and event state is process-memory; an EveJS restart starts a new event epoch and clients recover via snapshot.

This plumbing is being **replaced, not extended**: the roadmap's direction is a thin bridge in eve.js that invokes the same `Handle_*` service handlers the retail client uses, with pages migrating one at a time and each legacy path deleted as its page moves. Do not build new features on the v1 gateway. See the roadmap for the R0–R6 goal ladder.
