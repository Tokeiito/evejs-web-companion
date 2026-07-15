# EveJS Web POC

Minimal browser companion for a local EveJS server.

This repo is intentionally separate from `eve.js`. All gameplay state is read and mutated through the authenticated EveJS v1 web gateway. Web credentials remain in this repo's own ignored `data/` folder.

## Run

```powershell
npm install
npm run webpass -- <evejs-username> <web-password>
npm start
```

Open `http://127.0.0.1:26500`.

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

## Current POC Function

After web login, the app lists characters for the EveJS account and opens a dark Eve-style capsuleer console with selectable Caldari, Amarr, Gallente, and Minmatar header themes.

Current pages:

- overview summary
- skill browser with drag/drop queue planner and save controls
- grouped skill browser sections with group filter/search and drag/drop queue planning
- Jita 4-4 market orders through the EveJS v1 gateway, browsed by category
- inventory/assets with a location selector and item group summaries
- read-only industry jobs and blueprint library
- PI colony and extractor overview

The dashboards currently show:

- wallet, location, PLEX, and character context
- total skill points
- trained skill count
- current skill queue state
- top skill groups
- searchable trained skills
- grouped skill browsing by skill group
- owned inventory rows
- location-filtered inventory browsing
- translated fitted-item locations such as ship slots, drone bay, station, and system
- manufacturing/research job status, timers, ETA, and progress when jobs exist
- PI colony/extractor counts
- read-only Jita 4-4 market rows grouped by item category

Gameplay dashboards are read through the EveJS v1 gateway. The web app also uses local EveJS static-data JSON and CCP's EVE Image Server for names and icons. No EveJS account password hashes are modified.

The EveJS gateway is required. Account, character, snapshot, market, skill-queue, and PI requests use only the versioned `/_evejs-web/v1` namespace. Skill queue saves therefore run through EveJS' authoritative queue validation/runtime code, emit normal queue notifications, and let EveJS own persistence.
