# Goal R5b: Browser autopilot — client-side decide-loop + route solver + travel panel

**Issued:** 2026-07-19 by the orchestrator session. **Depends on:** R5a complete (undock/warp/jump/dock atomic bridge + `POST /session/flight-status`, all live-validated — a full undock→space→dock round-trip was driven manually from the browser). **Status:** Ready to run.

R5a exposed the atomic moves and proved manual stepping. **R5b automates them:** a browser-side autopilot decide-loop (a port of the retail client's `autopilot.py Update`) that sequences warp→jump→…→dock over a computed route, with a live travel panel. This is **web-only** — R5a already allowlisted every atomic call and added flight-status; do NOT add eve.js gateway code unless you find a genuine, unavoidable gap (if so, stop and report rather than expanding the eve.js footprint quietly).

You are a worker session. Read FIRST: `docs/web-client-scope-and-roadmap.md` (esp. §7 autopilot — the client owns the loop; tab close = client close; the BFF never drives movement with no client), `docs/bridge-wire-contract.md` (space bridge + flight-status), `docs/retail-call-inventory.md` Steps 7–9, and the memory-referenced behavior. Also read the retail loop itself: `C:\Users\ryanf\Documents\GitHub\eve.js\tools\ClientCodeGrabber\Latest\eve\client\script\parklife\autopilot.py` (`AutoPilot.Update` / `NavigateSystemTo`). Execute exactly this goal, then stop.

## Non-negotiable behavior (from roadmap §7 + memory)

- **The decide-loop runs in the BROWSER**, never the BFF/server. It only *sequences* the authoritative atomic calls (R5a's undock/warp/jump/dock) — it never simulates or predicts position; each move's truth comes from `flight-status`.
- **Closing the tab = closing the client:** the loop stops, the ship completes whatever server-side command was last issued and then sits — no further commands. Do NOT issue a "stop" on tab close; simply stop sending. The BFF is a relay + session holder and must NEVER advance travel when no client is connected.
- **Pause, don't guess:** on any unsafe/blocked condition (warp scrambled, invalid target, session-change timeout, ship destroyed, lost control, a handler refusal that isn't the normal docking-approach) the loop pauses and shows the reason. The user can resume or abort.

## What R5a already gives you (reuse, don't rebuild)

- Atomic bridge (browser → BFF → gateway): undock, warp-to-target (`CmdWarpToStuffAutopilot`), jump (`CmdStargateJump` with from/to gate), dock (`CmdDock`), and `POST /session/flight-status` (location docked/in-space, solar system, ship state incl. mode+speed, last action/failure) for polling between steps. The Flight page (`web/src/ui/Flight.svelte`, `web/src/app/flow.ts`, `web/src/bridge/flight.ts`, `web/src/store` flight slice) is your starting point.
- The real docking behavior you must automate (observed live): `CmdDock` out of range refuses with `DockingApproach` and the ship enters an approach (FOLLOW); once in range, **re-issuing `CmdDock`** completes docking after a short accept delay. Your loop must replicate this approach-then-redock, not assume one dock call docks.

## Objective

1. **Client-side route solver:** given the current system and a destination (system or station), compute the jump route — the ordered list of systems and, at each hop, the source stargate to warp to and the stargate to jump through. This is client-side (retail solves it locally; there is no wire call — G2). Build a system-adjacency graph from the local static data: extend `src/staticData.js` (which already reads the EveJS gameStore) to expose stargates (each connects two systems) and the gate IDs per hop. Investigate the gameStore data layout under `eve.js/_local/gameStore` — the `data/<name>/data.json` files are manifest-wrapped; the actual records live in the accompanying JSONL (or nested) files. Verify your graph against a known short route before wiring it to the loop.
2. **Browser autopilot decide-loop:** a port of `autopilot.py`'s tick loop. Each iteration: read `flight-status`; pick the next action for the current route step (undock if docked; warp to the next gate; when arrived, jump; at the destination system, warp to the station then dock, re-issuing dock through the approach); issue it via the R5a bridge; wait for the real transition (warp travel, ~1.25s jump handoff, dock approach/accept) before the next decision. It must be resilient to the real timing you saw live. Loop cadence ~2s like retail; the loop lives in the browser and stops when the page is closed.
3. **Travel panel:** compact live status — current system, next system, target gate/station, travel state, remaining jumps, elapsed time, and an actionable failure reason — with **Start route** (enter/choose a destination), **Pause**, **Resume**, **Abort**. No map/rendered scene.

## Required work

1. **Baseline** (record): web `npm test` (expect 236/236); confirm the eve.js gateway baselines are untouched (you make no eve.js changes). Never `git add -A`.
2. **Route solver** in TS with unit tests (a fixture adjacency → a known multi-hop route; degenerate cases: same-system destination, unreachable, adjacent).
3. **Decide-loop** as a framework-agnostic controller driven by the store + flight-status, unit-tested against a **simulated flight-status sequence** (docked→undock→warp→arrived→jump→…→approach→docked) proving it issues the right atomic call at each state, replicates approach-then-redock, pauses on an injected refusal/scramble, and stops cleanly on abort. The loop must never call the bridge after abort/stop.
4. **Travel panel** Svelte view with Start/Pause/Resume/Abort + the live readout; long-aware decoders; session-loss unwind like R3–R5a. Serve at `/dist/`.
5. **Update `docs/bridge-wire-contract.md`** (route solver + loop contract; reaffirm tab-close semantics) and **README** (Spot test R5b: pick a destination a few jumps away, Start route, watch it undock→warp→jump→dock autonomously; note that closing the tab stops it).
6. Tests green; commit web (one or a few focused commits); update roadmap R5b row to Complete with evidence (in-process/simulated; live spot test pending orchestrator). Report hash(es). **Do not push.**

## Out of scope

- Delivering/completing the mission (R6). Any eve.js change (R5a covered the bridge). Combat, manual flight beyond the loop's atomic calls. Notification push/streaming (G6) — keep polling flight-status. Auth/security (roadmap §6).

## Definition of done

- Route solver computes correct multi-hop routes from static data, unit-tested. Decide-loop, unit-tested against a simulated flight-status timeline, sequences undock→warp→jump→…→approach→dock (with approach-then-redock), pauses on unsafe, and stops on abort/tab-close without further bridge calls. Travel panel drives Start/Pause/Resume/Abort with a live readout. All web tests green; `build:web` serves it at `/dist/`. eve.js untouched. Committed; hash(es) reported; not pushed.
- Roadmap R5b Complete with evidence "in-process/simulated end-to-end; live spot test pending orchestrator".

## Constraints

- **Web repo only** — eve.js is READ-ONLY (read `autopilot.py` and the gameStore data; change nothing there). If you believe an eve.js gateway change is truly required, STOP and report instead of editing it.
- A live EveJS (:26002) + web app (:26500) are running (orchestrator's); Farmer is docked at Maurasi VIII. Do NOT touch those processes; run only npm test + Vite builds; leave nothing new running.
- Preserve web `data/`, icon caches, manifests, ignored credentials. Commit your work; never push.
- If R5b exceeds one session, land the route solver (with tests) and commit it, then report the split for the decide-loop + panel. Never leave broken/uncommitted work.
