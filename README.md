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
