# EveJS Web Client

Browser client for a local or WAN-hosted EveJS server.

The goal is to reimplement as much of the EVE Online client as practical in the browser, by driving the **same service calls the retail client makes** against the same EveJS handlers. EveJS is the game server and sole authority; this app is an alternate client, not another simulation. The full scope, architecture, and roadmap live in [docs/web-client-scope-and-roadmap.md](docs/web-client-scope-and-roadmap.md) — read that first.

This repo is intentionally separate from `eve.js`. The web process never reads or writes gameplay SQLite; all gameplay state flows through EveJS.

## Run

```powershell
npm install
npm run webpass -- <evejs-username> <web-password>
npm start
```

Open `http://127.0.0.1:26500`.

The `webpass` step is transitional: login will become emulator-style (any password accepted) when the retail-call bridge lands. Until then web credentials live in this repo's own ignored `data/` folder.

## TS web stack (R1b scaffold)

The R2+ page migrations build on a TypeScript + Vite stack under `web/`, living alongside the vanilla `public/` app (roadmap section 5). Node >= 22.18 is required (the TS unit tests run natively under `node --test` via type stripping).

```powershell
npm run typecheck   # tsc, no emit
npm run build:web   # typecheck + Vite build into public/dist/ (git-ignored), served at /dist/
npm run dev:web     # Vite dev server; proxies /api to the BFF (EVEJS_WEB_BFF_URL overrides)
npm test            # node --test: vanilla JS tests + web/**/*.test.ts together
```

After `npm run build:web`, the scaffold smoke page is at `http://127.0.0.1:26500/dist/` (sign in on the vanilla app first so the bridge call has a session). See the "Consuming the bridge from TypeScript" section of [docs/bridge-wire-contract.md](docs/bridge-wire-contract.md) for the client/store layout and how R2 adds a page.

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
