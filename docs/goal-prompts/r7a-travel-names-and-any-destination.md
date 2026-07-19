# Goal R7a: Travel — show system/station names, and set a destination anywhere by name

**Issued:** 2026-07-19 by the orchestrator session, from live-test feedback. **Status:** Ready to run. **Web-only — no eve.js change.**

Two Travel/Flight usability gaps from live testing:

1. **Bare numeric IDs instead of names.** The Flight tab shows `In space · system 30000140`, `Docked · station 60003760`, and a `Solar system: 30000140` row — raw IDs a player can't read. (The Travel *route* panel already resolves names, so the pattern exists.)
2. **You can only set a destination through the Agent Finder / courier flow.** The Travel tab's "Start route" is a raw **numeric-ID** input (`placeholder="station or system ID"`), so a player who doesn't know EVE IDs can't pilot to Jita — or anywhere — on their own. Make destination-setting work **by name** for any system/station.

You are a worker session. Read FIRST: `docs/goal-prompts/r6a-agent-finder.md` (the Agent Finder already does name-resolved search + `startRoute` — mirror it), `web/src/ui/{Flight,Travel}.svelte`, `web/src/app/flow.ts`, `web/src/bridge/flight.ts`, `src/server.js` (`/api/map/resolve/:id`, `/api/map/station/:id`, `/api/map/find` if any, `/api/agents/find`), `src/staticData.js` (`getSolarSystemName`, `getStation`, the solar-systems table). Execute exactly this goal, then stop.

## Fix 1 — names, not IDs

- Everywhere the UI renders a bare solar-system or station **ID**, show the resolved **name** (fall back to the ID only when unresolved). Known spots: `Flight.svelte` location line (`In space · system <id>`, `Docked · station <id>`) and the `Solar system` row; audit for any others (autopilot/travel status, etc.).
- Resolve names with the existing static routes — `/api/map/resolve/:id` returns `systemName`; `/api/map/station/:id` returns the station's `stationName` + `solarSystemName`. Cache resolved names client-side so the Flight status doesn't refetch every poll. No new gateway/bridge calls.

## Fix 2 — set a destination anywhere, by name

- Add a **name search** to the Travel tab: a `GET /api/map/find?q=<text>[&kind=system|station]` **static** BFF route (read-only, login-gated, mirroring `/api/agents/find` — NOT a bridge call) that searches the static solar-system table (and stations if feasible) by name and returns matches with `{id, name, kind, solarSystemID, solarSystemName}`, capped/responsive.
- In the Travel tab: a search box → a short results list (name + system + kind) → **Set destination** on a result calls the existing `flow.startRoute(id)` (route solver + autopilot). Keep the raw-ID input as a secondary/fallback option. Optionally show jumps-away using the already-loaded graph (`distancesFrom`), like the finder — nice-to-have, not required.
- Result: from any docked/space location, a player can type "Jita", pick it, and the autopilot flies there — no agent/courier flow, no knowing IDs.

## Required work

1. **Baseline** (record): web `npm test` (expect 329/329). No eve.js change (confirm + say so). Never `git add -A`.
2. Fix 1 (name resolution + cache) and Fix 2 (`/api/map/find` + Travel search UI + Set destination) with tests: a staticData/`find` test (name search returns the right systems/stations, capped, login-gated) and a flow/UI test (picking a result starts the route; the Flight status shows a resolved name not a bare ID).
3. **Verify end-to-end** against the running app if EveJS is up (the operator may be running it): from a docked location, search "Jita", set destination, and confirm the autopilot plans/starts a route; confirm the Flight tab shows the system **name**. If EveJS isn't reachable, prove it in-process/unit and say so.
4. Update `docs/bridge-wire-contract.md` (the `/api/map/find` static route) + README (Travel spot test: pilot anywhere by name). Update the roadmap (R7a row).
5. Tests green; `build:web` clean; commit web work; report hash. **Do not push.**

## Out of scope

- Any eve.js change. Chat (separate track — a server-side bug is under investigation). The `GetAgents`-1678 anomaly. A full map/region browser UI (a name search is enough).

## Definition of done

- The Flight tab shows system/station **names** (ID only as fallback); the Travel tab lets a player **search any system/station by name and Set destination**, which starts the R5b autopilot there; raw-ID entry still works. Piloting to Jita (or any system) works without the agent/courier flow. Tests green; `build:web` clean; eve.js untouched. Committed; hash reported; not pushed.
- Roadmap R7a row Complete with evidence.

## Constraints

- Web repo only; eve.js READ-ONLY. The operator runs EveJS (:26002) and the orchestrator runs the web app (:26500) — do NOT start/stop/restart either; run only `npm test` + `npm run build:web`. If you need a live check and EveJS is down, note it and fall back to in-process proof. Never push; stage only your files.
