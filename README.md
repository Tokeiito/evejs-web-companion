# EveJS Web Client

A **no-graphics, browser-based client for [EveJS](../eve.js)** — play EVE Online through
a web page instead of the retail 3D client, by driving the **same service calls the
retail client makes** against the same EveJS handlers.

EveJS is the game server and the sole authority. This app is an *alternate client*, not
another simulation: it renders no 3D scene and runs no game logic of its own. It shows
you the game as lists, panels, and a HUD, and every action it takes is a real retail
call the server validates exactly as it would for the retail client.

> Full scope, architecture, and per-milestone history live in
> [docs/web-client-scope-and-roadmap.md](docs/web-client-scope-and-roadmap.md) and
> [docs/afk-session-log.md](docs/afk-session-log.md).

## Why a browser client — the vision

A retail EVE client is a heavy 3D application: one process, one machine, a lot of GPU.
This client is a **web page talking to a thin bridge**. That single change unlocks three
things the retail client can't do easily:

1. **Multibox from one browser.** Each account is just a tab. Open ten tabs, sign into
   ten accounts, and you're flying ten characters at once — no VMs, no client copies, no
   GPU. One tab ≙ one client ≙ one account.
2. **Automate with sharable, block-built bots.** Instead of third-party injectors, the
   automation is a first-class feature: build a bot from ready-made **blocks** (like
   Lego), validate it, and export it as a small JSON file you can share. See
   [The Bot Builder](#the-bot-builder).
3. **Scale to as many "players" as you want.** Because commands originate in the
   *browser*, not the server, the server just answers calls — it holds no per-client bot
   loop and does no client-side thinking. So you can spin up as many browser-driven
   characters (real or fake/NPC filler) as you have clients to run them, and the world
   fills with activity that the server still authoritatively validates. The load lives in
   the clients; the authority stays on the server.

The through-line: **the server is dumb and authoritative, the client is smart and
disposable.** Closing a tab closes that client — the server never keeps driving it.

## Architecture — the thin bridge

```
  Browser (Svelte + Vite)                 ← one tab per account; all the "thinking"
        │  fetch POST /api/bridge/*
        ▼
  Web BFF  (src/server.js, :26500)        ← relay + session holder; deny-by-default
        │  the retail {service, method} call tuple
        ▼
  EveJS gateway (eve.js, :26002)          ← the retail Handle_* handlers, unchanged
        │
        ▼
  EveJS  = the game, the sole authority   ← owns all state + validation + persistence
```

- **Bridge-only.** Every read and every mutation goes through `POST /api/bridge/*` (the
  retail call tuple, bound objects, the persistent session, flight, chat) or the
  login-gated read-only static routes (`/api/map/*`, `/api/names`, `/api/agents/find`)
  that serve EveJS's static reference export the way retail resolves names from its local
  static DB. The web process **never** touches gameplay SQLite.
- **Deny-by-default, but everything is pre-plumbed.** The gateway carries an allowlist of
  `{service, method}` pairs; a call not on it is refused. The **entire retail call surface
  is already plumbed** — all 588 pairs (287 reads + 301 writes), each with a BFF route, a
  browser-side decoder, and tests, so a new feature almost never needs new plumbing: it
  composes calls that already exist. **YMMV on testing, though** — reads are solid, but the
  writes were plumbed rapidly with educated-guess decoders/args and confirm-gated rather
  than fired live, so expect to test them and find bugs as you wire real features onto
  them. See the roadmap for the QA state.
- **The client is a pure reader of one store.** State lives in a framework-agnostic
  reactive store (`web/src/store/clientStore.ts`); all fetch/decode is in
  `web/src/app/flow.ts`; the Svelte components never write state, they read it.
- **Two spatial shells.** The whole UI follows one flag — *docked* vs *in space*:
  `StationShell` (station interior: services rail, ship hangar, undock) and `SpaceShell`
  (a HUD: locked-target brackets, overview, capacitor + shield/armor/hull, module rack,
  dock), with a persistent Neocom rail of the panels reachable in both states.

## The Bot Builder

Automation is built into the client, not bolted on. A bot is an **ordered list of blocks
that repeat as a whole, plus a row of "watches" checked every moment** — Lego for EVE
routines.

- **Blocks (macros)** are high-level, named actions from a catalog — `undock`,
  `travel-to-station`, `mine-at-belt`, `deliver-ore`, `refine-ore`, `find-combat-agent`,
  `request-mission` / `accept-mission` / `turn-in-mission`, `fight-the-rats`,
  `salvage-wrecks`, `warp-to-anomaly`, `restart-extractors`, and more. Each block is a
  sentence a player understands, not a script API.
- **Watches** are conditions checked continuously that interrupt the loop to respond —
  e.g. *shield below 50% → repair*, *hostiles on grid → launch drones*, *hull below 50% →
  dock and pause*. They make a bot safe without hand-coding a state machine.
- **Sharable.** A bot is a small JSON document (`web/src/bots/scriptCodec.ts`) you can
  export, hand to someone, and import — no code, no injector. Example bots ship in
  `web/src/bots/exampleBots.ts` ("Mining day", "Delivery runs").
- **Built on tested pure logic.** The catalog, validator, text/sentence rendering, and
  JSON codec are pure, unit-tested modules under `web/src/bots/`, so the builder shows you
  exactly the logic the runner will execute.

**Where it stands:** the builder (`web/src/ui/BotBuilder.svelte`) can shape, validate, and
import/export a bot today. The generic block *runner* that drives an arbitrary bot on the
live session is the next step. The purpose-built loops it generalizes already run
in-browser and server-authoritative — the autopilot (`web/src/nav/autopilotLoop.ts`),
mining bot, and mission bot — each a ~2s loop that only *sequences* atomic retail calls
and reads flight status between them, exactly as retail's `autopilot.py` does. Closing the
tab stops the bot; the server never advances it on its own.

## Run

Requires Node ≥ 22.18 (the TypeScript unit tests run natively under `node --test` via type
stripping). EveJS must be running so its gateway is listening on `:26002`.

```bash
npm install
npm run build:web   # typecheck (tsc) + Vite build into public/dist/ (git-ignored)
npm start           # the BFF on http://127.0.0.1:26500
```

Open `http://127.0.0.1:26500` and sign in with an existing EveJS **account name** and
**any password** (emulator-style "who cares" login — passwords are not checked; unknown
names are rejected). The login screen pings the server's health check once on load and
won't let you attempt a login while EveJS is offline.

For UI iteration, use the hot-reloading dev server instead:

```bash
npm run dev:web     # Vite on :5173, proxies /api to the BFF; run `npm start` alongside it
npm test            # node --test over the JS + web/**/*.test.ts suites
```

## Multibox

Each browser tab holds its own per-tab session token, so **N tabs = N independent
clients**. Sign a different account into each tab and fly them side by side. The BFF holds
each tab's persistent EveJS session server-side and never drives movement for a tab that
has no browser connected — the same duplicate-login and control rules as retail apply
(a character already online elsewhere is refused with the server's own message unless
login-takeover is enabled).

## Configuration

Defaults assume both repos live side by side (e.g. under `.../GitHub/eve.js` and
`.../GitHub/evejs-web-poc`). Optional environment variables:

```text
PORT=26500
HOST=127.0.0.1                 # 0.0.0.0 to host on a LAN/WAN (trusted-environment emulator)
EVEJS_ROOT=/path/to/eve.js
EVEJS_GATEWAY_URL=http://127.0.0.1:26002/_evejs-web/v1
EVEJS_WEB_GATEWAY_TOKEN=
EVEJS_ICON_CACHE_DIR=/path/to/evejs-web-poc/data/icon-cache
```

Hardening is deliberately out of scope — this is a trusted-environment emulator client
(see roadmap section 6).

## Local icon cache

Item/ship icons fall back to `https://images.evetech.net`. To cache them locally (served
from `/icon-cache/...`), run the scraper:

```bash
node scripts/cache-icons.js --dry-run
node scripts/cache-icons.js --rate-limit 60/min --limit 200   # scan the gamestore
node scripts/cache-icons.js --types 34,670,11                 # specific typeIDs (e.g. overview 404s)
node scripts/cache-icons.js --source all-types --rate-limit 60/min --limit 500
```

Cached files land under the git-ignored `data/icon-cache/`; a manifest is written to
`data/icon-cache/manifest.json`. The default `gamestore` source scans the current EveJS
gamestore for the icons the app is likely to show; if the overview logs a 404 for a typeID
it didn't cover (celestials, beacons, effects), pass those IDs with `--types`.

## Repo map

```
src/                 the web BFF (Express) — routes, the bridge, session holding
  server.js            the BFF + /api/bridge/* + /api/health
web/                 the Svelte front-end
  src/app/flow.ts      all fetch/decode; the AppFlow the components call
  src/store/           the reactive client store (single source of truth)
  src/bridge/          per-call decoders (raw retail bytes → typed store events)
  src/ui/              the shells (StationShell/SpaceShell), Neocom, panels, BotBuilder
  src/nav/             the in-browser bot loops (autopilot, mining, mission) + route solver
  src/bots/            the block bot model: script, macro catalog, validator, codec, examples
scripts/cache-icons.js  the local icon scraper
docs/                the scope/roadmap, wire contract, and session log
```

## Status

- **Bridge:** complete — **all 588/588 retail read + write calls are pre-plumbed**, so
  most new work is composition, not plumbing. YMMV on testing: reads are solid; the write
  decoders/args are educated guesses awaiting live QA, so expect to find bugs as you use
  them.
- **UI:** two-shell docked/in-space client with live panels, Neocom, and a health-gated,
  centered login.
- **Bots:** the block Bot Builder (shape / validate / share) plus live in-browser
  autopilot, mining, and mission loops; the generic block runner is next.
