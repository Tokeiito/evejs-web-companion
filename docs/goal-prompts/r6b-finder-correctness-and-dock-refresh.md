# Goal R6b: Agent Finder correctness (real distribution agents) + dock/station-change refresh

**Issued:** 2026-07-19 by the orchestrator session, from live-test feedback. **Status:** Ready to run. **Web-only — no eve.js change.**

Two focused fixes found while live-testing the courier flow:

1. **The Agent Finder mislabels Paragon (and other special) agents as courier.** "IRIS - Jita" (agentID 3020034) shows as an L1 courier, but it's a **Paragon** agent (`agentTypeID: 13`, `divisionID: 37`, corp `1000419`) — those missions aren't supported. The static export's `missionKind` heuristic is wrong for special agents.
2. **The Agents & Missions tab (and station panel) go stale after the autopilot docks** — the character arrives at the new station but the tab keeps showing the old station's agents until a full page reload. The server is fine (a fresh `GetAgents` returns the new station's agents); the web app just doesn't re-fetch on the station change.

You are a worker session. Read FIRST: `docs/goal-prompts/r6a-agent-finder.md`, `docs/web-client-scope-and-roadmap.md`, and the current `web/src/ui/{AgentFinder,AgentsMissions,Station}.svelte`, `web/src/app/flow.ts`, `src/server.js` (`/api/agents/find`, `/api/bridge/agents`), `src/staticData.js`. Execute exactly this goal, then stop.

## Fix 1 — real distribution agents only

Data facts (from `_local/gameStore/data/agentAuthority/data.json`, ~10,941 agents): the `missionKind` field is right for ordinary agents but wrong for special ones. Of 4,421 `missionKind:"courier"` agents, **4,389 are division 22 (Distribution — the real courier agents), 12 are division 37 (Paragon), 20 are division 25**. Special `agentTypeID`s (3 research, 5, 6, 7, 8 career, 10 storyline, 11 event, 12 epic, 13 Paragon/special) are NOT ordinary mission agents. Also note: **every agent in this export is a `conversationMetadata.placeholder:true` with empty `missionTemplateIDs`** — the directory has no mission *content* (runnable missions come from the mission runtime), so the finder can only filter to the right *kind*, not guarantee content.

- In `src/staticData.js` / the `/api/agents/find` filter, classify agents by **division + agentType**, not the raw `missionKind`. A "courier" (distribution) agent = **`divisionID === 22` and a standard `agentTypeID` (2)** — exclude Paragon (37), division 25, and all special agent types. Do the analogous correct thing for the other kinds you expose (encounter = the security division(s), mining, research) OR, if a kind's correct division isn't obvious from the data, drop that kind from the finder rather than mislabel it — investigate the division/type breakdown and document what you chose.
- The finder must **not** list Paragon/career/storyline/epic/event agents as courier. Verify "IRIS - Jita" (3020034) no longer appears under Courier.
- Keep the finder responsive (the cap/sort from R6a).

## Fix 2 — refresh station context on dock / station change

- When the character's **docked station changes** (autopilot arrives and docks, or a manual dock, or select), the web app must refresh the station-scoped reads without a manual page reload: the **Agents & Missions** agent list, the **Station** panel, and the **Inventory & Ship** panel should re-fetch for the new station.
- Implement it reactively: the flow already learns the new station (flight-status / the autopilot "arrived" / select response). On a station-ID change, re-run the station-context loads (guard against redundant refetches; a lost session still unwinds). Also re-fetch agents when the Agents & Missions tab is opened (so switching to it always shows the current station).
- Confirm the exact reported bug is gone: after the autopilot docks at a new station, the Agents tab shows that station's agents without a full page reload.

## Required work

1. Baseline: web `npm test` (expect 297/297). No eve.js change (confirm and say so). Never `git add -A`.
2. Fix 1 (classification) + Fix 2 (dock refresh) with tests: a staticData/`find` test proving Paragon/special agents are excluded from courier (and IRIS-Jita 3020034 specifically), and a flow test proving a station-ID change triggers the agents/station/inventory re-fetch (and opening the Agents tab re-fetches).
3. Update `docs/bridge-wire-contract.md` / README where the finder classification or refresh behavior is described. Update the roadmap (annotate R6a/R6b).
4. Tests green; `build:web` clean; commit web work; report hash. **Do not push.**

## Out of scope

- Any eve.js change. Chat (separate goal). The live `GetAgents`-returns-1678-at-Jita-4-4 anomaly (separate investigation — the finder now doesn't depend on GetAgents for discovery anyway). Notification push/streaming build-out beyond what the refresh needs.

## Definition of done

- The Agent Finder lists only real distribution agents under Courier (Paragon/special excluded; IRIS-Jita 3020034 gone from Courier), still responsive. After the autopilot docks, the Agents & Missions / Station / Inventory panels reflect the new station without a manual page reload; opening the Agents tab re-fetches. Tests green; `build:web` clean; eve.js untouched. Committed; hash reported; not pushed.

## Constraints

- Web repo only; eve.js READ-ONLY. A live EveJS (:26002) + web app (:26500) are running (orchestrator's); Farmer is docked at Jita VI (60015169). Do NOT touch those processes; run only npm test + Vite builds; leave nothing new running. Never push; stage only your files.
