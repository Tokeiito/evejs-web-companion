# Goal R6a: Agent Finder — find a courier agent and set the autopilot to it

**Issued:** 2026-07-19 by the orchestrator session. **Depends on:** R5b (route solver + autopilot) and R6 (courier accept/complete). **Status:** Ready to run.

To actually run a courier the player must first **find a courier agent and travel to it**. The per-station `agentMgr.GetAgents` is unreliable for this (it returns 0 for a character re-selected directly into a docked station, and only shows the *current* station's agents anyway). This goal adds an **Agent Finder** that lists agents from **static reference data**, sorts them by jumps from the current location, and sets the browser autopilot (R5b) to a chosen agent's station. Traveling there via autopilot dock then populates the live agents normally, so the player can talk to the agent and accept a courier (R4/R6).

You are a worker session. Read FIRST: `docs/web-client-scope-and-roadmap.md`, `docs/bridge-wire-contract.md`, and how R5b's route solver + `startRoute` and `src/staticData.js` + the `/api/map/graph` route work (this feature mirrors that "static reference data served read-only" pattern). Execute exactly this goal, then stop. **Web-only — no eve.js change** (it's static-data + UI reusing existing bridge routes; if you think a gateway change is needed, STOP and report).

## The data (confirmed present)

`eve.js/_local/gameStore/data/agentAuthority/data.json` (manifest-wrapped; ~10,941 agents):
- `agentsByID[<id>]` → `{ agentID, ownerName, agentTypeID, divisionID, level, corporationID, factionID, stationID, stationTypeID, solarSystemID, missionKind ("courier"|"encounter"|"mining"|...), missionTypeLabel, isLocator, ... }`
- `indexes` → `divisionIDToAgentIDs`, `solarSystemIDToAgentIDs`, `agentTypeIDToAgentIDs`, `stationIDToAgentIDs`, `corporationIDToAgentIDs`, `factionIDToAgentIDs`, `missionPoolKeyToAgentIDs`.

Read it through `src/staticData.js` (like the solar-system graph) — read-only static reference data, NOT a gateway call, NOT gameplay SQLite. `ownerName` is the agent's name; resolve station/system names via the existing `staticData.getStation` / `getSolarSystemName`.

## Objective

1. **Static agent data + BFF route (web):** `src/staticData.js` exposes agents (id, name, level, missionKind, corporationID, stationID, solarSystemID). A read-only BFF route `GET /api/agents/find` accepts filters — at minimum `kind` (default `courier`), `level` (optional), and a result cap — and returns the matching agents with their station/system names. Do NOT dump all ~11k agents; filter server-side and cap (e.g. a few hundred), leaving distance sort/paging to the client.
2. **Distance-from-current-system:** add a route-solver helper `distancesFrom(originSystemID)` — a single BFS over the already-loaded system graph returning the jump distance to every reachable system (efficient; do NOT run a separate `solveRoute` per agent). The finder sorts agents by their system's distance from the player's current system (unreachable → last / flagged).
3. **Agent Finder page (new Svelte tab):** filters (mission kind — default courier; level; text search on name/system), a list showing agent name, level, mission kind, station name, system name, and **jumps away**, sorted nearest-first, with the rendered rows capped (like R6's agent filter) so it stays responsive. Each row has a **"Set destination"** button → reuse R5b `startRoute(agent.stationID)` (autopilot to that agent's station) and switch to / point the user at the Travel tab. Show the currently-selected target agent so the player knows who they're flying to.
4. Reuse everything: the client already fetches `/api/map/graph` for Travel — reuse that graph for `distancesFrom`; reuse `startRoute` for the autopilot.

## Required work

1. **Baseline** (record): web `npm test` (expect 280/280). Confirm no eve.js change is needed (this is static data + UI + existing bridge routes). Never `git add -A`.
2. **staticData + BFF route** with tests (filter by kind/level, cap, station/system name resolution; a fixture or the real data file).
3. **`distancesFrom` route-solver helper** with unit tests (fixture graph: distances correct, unreachable handled, origin = 0).
4. **Agent Finder page** (new tab) wired to the store (new slice/decoder as needed; long-aware IDs), with the filter + nearest-sort + capped render + "Set destination" → `startRoute`. Robust: a failed find surfaces a reason; session-loss unwinds like the other pages.
5. **Update** `docs/bridge-wire-contract.md` (the `/api/agents/find` static route + finder) and **README** (Spot test: open Agent Finder → filter couriers → Set destination to a nearby L1 courier → the autopilot flies there).
6. Tests green; `build:web` clean; update the roadmap (add an R6a row) to Complete with evidence. Commit web work; report hash(es). **Do not push.**

## Out of scope

- Any eve.js change. Talking to / accepting from the agent on arrival (that's the existing Agents & Missions tab, R4/R6). The `GetAgents`-on-select nuance itself (separate follow-up). Combat/mining agent workflows beyond listing them. Auth/security.

## Definition of done

- `GET /api/agents/find?kind=courier[&level=N]` returns capped, name-resolved courier agents from static data; the Agent Finder tab lists them sorted by jumps from the current system with a working "Set destination" that starts the R5b autopilot to the agent's station; responsive with the full dataset; all web tests green; `build:web` serves it at `/dist/`. eve.js untouched. Committed; hash reported; not pushed.
- Roadmap R6a row Complete with evidence "in-process/simulated; live spot test pending orchestrator".

## Constraints

- Web repo only; eve.js READ-ONLY (read `agentAuthority/data.json` and staticData; change nothing there).
- A live EveJS (:26002) + web app (:26500) are running (orchestrator's); Farmer is docked at Jita 4-4. Do NOT touch those processes; run only npm test + Vite builds; leave nothing new running.
- Preserve web `data/`, icon caches, manifests, ignored credentials. Commit your work; never push. If it exceeds one session, land the staticData + BFF route + `distancesFrom` (with tests) and commit, then report the split for the page.
