# Progress

## 2026-07-02

Created the first self-contained EveJS Web POC repo at:

```text
C:\Users\ryanf\Documents\GitHub\evejs-web-poc
```

Implemented:

- Express server with static browser UI.
- Read-only EveJS SQLite access through `src/eveStore.js`.
- Separate web-password store in ignored local `data/web-users.json`.
- HttpOnly cookie session token signed by a local secret in ignored `data/session-secret.txt`.
- Real POC function: authenticated character skill and queue dashboard backed by EveJS runtime tables.
- CLI helper: `npm run webpass -- <evejs-username> <web-password>`.
- Health/check script: `npm run check`.

Verified:

- `npm install` completed with no vulnerabilities reported.
- `npm run check` found 3 EveJS accounts, 5 characters, and a real skill dashboard sample for Farmer.
- Local HTTP login works with the separate web-password store.
- `/api/characters/:characterID/skills` returned Farmer with 511 trained skills and 641,792,000 skill points.
- Server started successfully on `http://127.0.0.1:26500`.

Added the first multi-page console:

- Eve dark mode shell with Caldari, Amarr, Gallente, and Minmatar theme selector in the header.
- Overview, Skills, Market, Inventory, and PI pages behind the same login.
- Read-only inventory dashboard backed by the EveJS `items` runtime table.
- Read-only PI dashboard backed by `planetRuntimeState`.
- Market page backed by the local EveJS market daemon on `127.0.0.1:40111`.
- Static data lookups for type, station, and solar-system names from `_local/gameStore/data`.
- Skill browser upgraded to an Eve-like workbench with visible skill icons, group/search filters, drag/drop queue planning, queue reorder/remove controls, and save/save-paused actions.
- Skill browser now renders grouped skill sections instead of one flat list.
- Queue saves route through EveJS' existing `skillQueueRuntime.saveQueue` validation instead of direct SQLite writes.
- Queue saves use the authenticated EveJS web gateway on the existing Express secondary service at `/_evejs-web/v1/skill-queue`; there is no local gameplay-runtime fallback.
- Inventory location translation now resolves fitted modules and drones through their parent ship/container to station and solar-system names.
- Inventory now has a location selector so the item table can be viewed per station/root location.
- Item, skill, market, blueprint, and product icons use CCP's EVE Image Server type icon URLs.
- Industry page added for read-only job, activity, timer/ETA, progress, and blueprint-library display.
- Market now uses station-scoped Jita 4-4 summaries from the market daemon and groups rows by item category using local SDE category names.

Verified after the page update:

- Node parser checks passed for the new frontend and backend modules.
- `npm run check` still passes against the live EveJS gamestore.
- Authenticated API smoke test for Farmer returned 511 skills, 18 inventory rows, 0 PI colonies, and 80 market rows.
- Server restarted successfully on `http://127.0.0.1:26500`.
- Authenticated API smoke test after the usability update returned 0 current queue entries, 18 inventory rows with translated locations such as `Algos / Drone Bay`, 0 industry jobs, 0 blueprints, and 80 market rows.
- Authenticated API smoke test after the gateway/filter update returned queue save source `evejs-web-gateway`, 18 inventory rows across 2 root locations, and 19,351 Jita 4-4 market rows across 32 item categories.
- Controlled EveJS gateway queue mutation test saved one paused `Hull Upgrades IV` queue entry for `Test Pilot` through `/_evejs-web/v1/skill-queue`, verified the gateway snapshot contained it, then restored that queue to empty.

Local setup:

- A local-only web password record was created for `rrfarmer` in ignored `data/web-users.json`.

Intentional limits:

- The web process performs no direct gameplay SQLite reads or writes.
- No market, inventory, or PI mutation endpoints yet.
- Market, inventory, industry, and PI dashboards are read-only for the first POC.
- Skill queue save is available only through the v1 EveJS gateway on the existing Express secondary service.

Next good step:

- Add queue preview/validation feedback before saving, then start adding mutation endpoints for the lowest-risk read/write workflows.
