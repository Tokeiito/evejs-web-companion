# Goal R5a: Space bridge — undock, warp, jump, dock (manually stepped)

**Issued:** 2026-07-19 by the orchestrator session. **Depends on:** R4 complete (agentMgr bridge; the bound-object bridge and persistent session are live-validated). **Status:** Ready to run.

R5 (get a ship through space from the browser) is the hardest integration in the plan because **space transitions expect a live player session** (undock → `OnSessionChanged` → space runtime attach → warp/jump/dock). This goal (**R5a**) proves that foundation with **manually-stepped** movement: undock, warp to a gate, jump, dock — each issued by an explicit button, so we validate the space-session participation and the atomic movement bridge before building the autopilot decide-loop (**R5b**) on top. **Do not build the automated decide-loop in this goal.**

You are a worker session. Read FIRST: `docs/web-client-scope-and-roadmap.md` (esp. §7 autopilot + §3.4 "space transitions expect a player session"), `docs/bridge-wire-contract.md` (persistent-session + bound-object contract), and `docs/retail-call-inventory.md` **Steps 7, 8, 9** (undock / travel / dock — your spec). Also read `docs/goal-prompts/` R2–R4 for the established patterns. Execute exactly this goal, then stop.

## Critical architecture (from memory + roadmap — do not violate)

- **Autopilot is CLIENT-side (the browser), never the server.** This goal does NOT create any server-side travel job. It exposes the atomic movement calls the retail client issues, and the browser issues them (here, via buttons). EveJS's existing handlers remain authoritative for each atomic move; the browser only *sequences* calls, never simulates or predicts position.
- The BFF is a **relay + session holder**; it must never drive movement on its own. Closing the tab = closing the client (the ship finishes its last in-flight command and sits) — faithful, not a failure to engineer around.

## Objective

1. **eve.js (gateway/interface files + their tests ONLY):** allowlist + bridge the atomic space calls on the persistent session, and make the persistent browser-backed session **participate in space** the way a retail socket does across undock (so the character actually enters space and subsequent movement calls resolve). The `beyonce` remote park is a **bound object** (`Moniker('beyonce', solarsystemID)` via `michelle.GetRemotePark()`), so reuse R3's bound-object bridge.
2. **web:** a **Flight** view (shown when Farmer is in space): undock from the station, then step-by-step controls to warp to a selected gate/celestial, jump, and dock at the destination — plus a compact live status readout (current system, ship state, location, last action / failure reason). Manual buttons only; no timer loop.
3. Prove undock→warp→jump→dock in-process with fixtures; the orchestrator live-tests afterward.

## Verified background facts (inventory Steps 7–9)

- **Undock:** `ship→binding.Undock(shipID, ignoreContraband, onlineModules=...)` — `Handle_Undock` (`ship/shipService.js:1720`; `onlineModules` must be a **kwarg**). (Player-structure alt: `structureDocking.Undock`, `structureDockingService.js:162`.)
- **beyonce (remote park) bound object:** `michelle.GetRemotePark()` → `Moniker('beyonce', solarsystemID)`. Methods (all `Covered`): `CmdWarpToStuffAutopilot(destinationID)` (`beyonceService.js:2958`), `CmdSetSpeedFraction(1.0)` (`:2483`), `CmdFollowBall(destID, 0.0)` (`:2454`), `CmdStargateJump(fromStargateID, toStargateID, requestedShipID)` (`:3012`), `CmdDock(itemID, shipID)` (`:2973`), and manual `CmdWarpToStuff(subject, itemID, minRange=)` (`:2527`).
- **Jump through Upwell gate (alt):** `structureJumpBridgeMgr.CmdJumpThroughStructureStargate(destID)` (`structureJumpBridgeMgrService.js:633`) — server tier.
- **Dock (player structure alt):** `structureDocking.Dock` (`structureDockingService.js:119`).
- **Route/waypoints are CLIENT-side (G2):** retail solves the path with `clientPathfinderService`; there is no `RemoteSvc` for waypoints. For R5a you do NOT need a route solver — the operator/tests pick a specific gate and destination. (The route solver is R5b.)
- **Space session participation:** undock issues a session change into space; the browser-backed session must be carried through it. Read how `Handle_Undock` / `applyCharacterToSession` / the space runtime attach a session (and how a retail socket session gets space state), and make the persistent session do the same. Determine how the browser reads current location / ship state between steps (drain the session notifications the bridge already returns, plus a state read if needed) — full push streaming is still G6, so a manual "Refresh flight status" is acceptable here.

## Required work

1. **Baseline** (record): web `npm test` (expect 214/214); eve.js `test:manifest:check` (3/3), `test:agent-parity` (6/6), and the FIVE gateway test files green via `node scripts/Tests/run-isolated-tests.js` over `webGatewayServiceCall/webGatewayV1/webGatewayPersistentSession/webGatewayBoundObject/webGatewayAgentMgr`. Leave other agents' in-flight eve.js work alone; stage only your files; never `git add -A`.
2. **eve.js — space bridge (do first; commit early, gateway files + tests only):** allowlist `ship.Undock`, the `beyonce` bound methods above (+ `beyonce.MachoBindObject` / the remote-park bind path), and `structureJumpBridgeMgr.CmdJumpThroughStructureStargate`; carry the persistent session through undock into space. In-process tests (model the existing gateway tests + a fixture docked character with a real ship): prove undock puts the character in space (session/location reflects undocked/in-space), a warp command is accepted and advances state, a stargate jump transitions the system, and dock returns the character to a station. Deny-by-default still holds for non-allowlisted space methods. Commit (`feat(web-gateway): space bridge — undock/warp/jump/dock (R5a)`); report hash; **do not push**.
3. **web BFF + Flight page:** BFF routes for undock / bind-park / warp / jump / dock / flight-status, holding the beyonce bound handle server-side; a **Flight** Svelte view with explicit buttons and a status readout (current system, in-space vs docked, target, last action, failure reason). Long-aware decoders (`unwrapLong`). Robust error surfacing + session-loss unwind like R3/R4. Serve at `/dist/`.
4. **Pause-on-unsafe:** movement steps must surface the handler's own refusal (scrambled, invalid target, session-change timeout, lost control, ship destroyed) as a visible reason — never a silent no-op or a fake success.
5. **Update `docs/bridge-wire-contract.md`** (space bridge + session-into-space) and **README** (Spot test R5a: undock → warp to a gate → jump → dock). Note the destination gate/station to use.
6. Tests green; commit web; update roadmap (add an R5a row or annotate R5) to Complete with evidence (in-process; live spot test pending orchestrator). Report all hashes.
7. *(Optional, only if trivial)* A live observation to verify: an **offered** agent mission currently renders under the journal's "Active" bucket instead of "Offered" (seen in R4 live). If the fix is a one-line classification correction in the journal decoder with a test, include it; otherwise leave it and note it for a follow-up.

## Out of scope

- The **automated autopilot decide-loop**, the client-side **route/pathfinding solver**, and the multi-jump travel panel — that is **R5b**. R5a is manual single-step movement only.
- Delivering/completing a mission (R6). Moving mission cargo (R3, done).
- Notification push/streaming (G6) beyond draining into responses. Auth/security hardening. Any game-mechanics change in eve.js.

## Definition of done

- eve.js: the persistent session participates in space across undock; undock/warp/jump/dock bridged and proven in-process (state actually transitions); deny-by-default intact; footprint = `_secondary/express` + gateway tests; baselines non-regressed. Committed; hash reported; not pushed.
- web: Flight page at `/dist/` can undock, warp to a chosen gate, jump, and dock, with a live status readout and visible failure reasons, against a stubbed/in-process backend in tests; wire contract + README updated; all web tests green. Committed; hash(es) reported; not pushed.
- Roadmap updated (R5a Complete; R5b = the decide-loop, still pending) with evidence "in-process end-to-end; live spot test pending orchestrator".

## Constraints

- eve.js coordination: other agents active — small early self-contained commit; stage only your files; never clobber/revert their work; if your gateway files have their work in flight, pause and surface it.
- Space is the riskiest integration: if undock/space-session participation proves larger than one session, land the eve.js space bridge + undock (proving the session enters space) with tests and commit it, then report the clean split for warp/jump/dock. Never leave broken/uncommitted work.
- Never start/stop servers you didn't start (the orchestrator has EveJS on :26002 + web on :26500 running right now — do NOT touch them; run only the repos' npm test scripts + Vite builds; leave nothing new running).
- Preserve `_local` gameplay data, web `data/`, icon caches, manifests, ignored credentials. Commit each repo separately; never push.
