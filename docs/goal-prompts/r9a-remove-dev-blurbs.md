# Goal R9a: Remove the developer-facing blurbs from the player UI

**Issued:** 2026-07-19 by the orchestrator (Phase 1 cleanup, half A). **Status:** Ready to run. **Web-only — no eve.js change.** Runs in parallel with R9b (legacy-machinery retirement, which owns `src/`) — **you own `web/src/ui/*.svelte` only.**

Every tab currently opens with a paragraph describing the *bridge implementation* — e.g. "Bound-object bridge: the station hangar and active-ship cargo are bound with invbroker (GetInventory / GetInventoryFromId); List / Add / StackAll / Board dispatch on those handles…", "the beyonce remote park (Moniker('beyonce', solarSystemID)) is bound on the BFF…", "map.GetStationInfo: answered with the retail cached-object envelope…", "agentMgr bridge: … the agent moniker (Moniker('agentMgr', agentID)) is bound on the BFF…". These describe internals to a **player** and name retail service methods. They were useful during bring-up; they do not belong in the player-facing client.

## Objective

Remove the developer/implementation-facing prose from the player UI, leaving each tab with either nothing or a short, plain-language line a player would understand.

- Delete the implementation blurbs (service/method names, Moniker/bound-handle/BFF/bridge/gateway/notification-drain talk, retail-call jargon, goal codenames like "R5a"/"R7").
- Where a tab genuinely benefits from orientation, keep **one short player-facing sentence** (e.g. Travel: "Set a destination and the autopilot flies you there."; Agent Finder: "Find an agent and set your destination."). Prefer removing over rewriting when the tab is self-evident (Station, Inventory & Ship, Chat).
- Also remove implementation asides embedded elsewhere in the markup (e.g. the "map.GetStationInfo: answered with the retail cached-object envelope (rowset rides the object cache)" note under the station panel, and any "The system transition completes after a short handoff…" style bridge commentary). Section headings that name a retail call (e.g. "Station services — stationSvc.GetStationItemBits", "Guests — station.GetGuests") should lose the method suffix and read as plain headings ("Station services", "Guests").
- **Do not** change behavior, markup structure needed for layout/responsiveness (R8), data flow, or reintroduce any numeric ID (R7d must hold). Code comments in `.svelte`/`.ts` files are fine to keep — this is about **rendered** text.

## Required work

1. **Baseline** (record): web `npm test` (expect 358/358). Never `git add -A`; stage only `web/src/ui/*.svelte` (+ docs/roadmap).
2. Sweep every `web/src/ui/*.svelte` for rendered implementation prose and remove/replace per above. Check all tabs: Station, Inventory & Ship, Agents & Missions, Agent Finder, Flight, Travel, Chat, plus login/character-select.
3. **Verify:** grep the components for the giveaway jargon (`Moniker`, `BFF`, `bound`, `bridge`, `gateway`, `invbroker`, `agentMgr`, `beyonce`, `stationSvc`, `GetStationItemBits`, `GetGuests`, `rowset`, `notification drain`, `R5a`, `R5b`, `R7`, `decide-loop`, `retail client`) and confirm zero **rendered** hits (comments excluded). Paste that proof in your report.
4. Re-run the R7d **ID sweep** (zero rendered numeric IDs) and confirm still clean.
5. `npm test` + `build:web` green; update the roadmap (R9a row); commit; report hash. **Do not push.**

## Definition of done

- No tab renders implementation/bridge jargon or retail method names; any remaining orientation text is one plain player-facing sentence. Behavior, layout/responsiveness, and zero-visible-IDs all intact. Tests + build green. Committed; hash reported; not pushed.

## Constraints

- **You own `web/src/ui/*.svelte` only.** A parallel worker (R9b) is concurrently editing `src/` (legacy machinery retirement) — do NOT touch `src/`, do not revert its changes, and if `npm test` shows a failure originating in `src/` legacy code, note it and continue (it is not yours to fix).
- If `git` reports the index is locked, wait a moment and retry (the parallel worker may be staging).
- eve.js READ-ONLY. Operator runs EveJS (:26002); orchestrator runs the web app (:26500) — do NOT start/stop/restart either. Never push.
