# Goal R4: Agents + accept a courier mission in the browser

**Issued:** 2026-07-19 by the orchestrator session. **Depends on:** R3 complete (bound-object bridge, live-validated inventory/ship). **Status:** Ready to run.

This is the milestone goal of the courier arc: **accept a courier mission entirely in the browser.** It reuses R3's bound-object bridge for a second service (`agentMgr`) and adds the two gateway pieces the R3 de-risk found missing (deferred call responses, `afterCallResponse`).

You are a worker session. Read FIRST: `docs/web-client-scope-and-roadmap.md` (source of truth), `docs/bridge-wire-contract.md` (persistent-session + bound-object contract + "how to add a page"), and `docs/retail-call-inventory.md` **Steps 2, 3, 4, 11** (agents / conversation / accept / briefing — your spec). Execute exactly this goal, then stop.

## Objective

1. **eve.js (gateway/interface files + their tests ONLY):**
   - Add the `agentMgr` allowlist pairs and support the agent bound object (`Moniker('agentMgr', agentID)` via `GetAgentMoniker`→`MachoBindObject`) through the existing bound-object bridge.
   - **Deferred call responses:** `agentMgr.Handle_DoAction` can return `buildDeferredCallResponse(...)` (e.g. the decline/provisional-confirmation round-trip). The gateway currently JSON-serializes that wrapper as a broken object. Detect `isDeferredCallResponse(result)` in **both** dispatch seams (`callServiceMethod` and `callBoundMethod`) and handle it: prefer a gateway-side deferred adapter that drives the deferred response to completion and returns its real result + notifications; if a given deferred flow genuinely requires a client round-trip the bridge can't service, refuse it with a typed error (`CALL_DEFERRED_UNSUPPORTED`) rather than emitting a broken object. Whichever you do, the **synchronous accept path must work** (see below). Prove with a test.
   - **`afterCallResponse`:** after a successful dispatch, invoke `serviceInstance.afterCallResponse(method, session, {args, kwargs, result})` in a try/catch, mirroring `packetDispatcher.js` — this is faithful retail behavior the gateway currently skips (matters for docked-fitting bootstrap, session-change flush, and R5). Confirm it doesn't throw on the R3/R4 methods.
2. **web:** an **Agents & Missions** view on the new Svelte stack: list the agents at Farmer's station, open a conversation with one, request/accept a **courier** mission, and show its briefing (title, cargo, pickup, destination, reward, time bonus) and its journal entry.
3. Prove the accept flow in-process with fixtures; the orchestrator live-tests afterward (Farmer visits an agent and accepts a courier).

## The accept path (what "done" hinges on)

Per the inventory Step 2–4:
- `agentMgr.GetAgents().Clone()` → the station's agents (bind target list).
- Bind the agent: `GetAgentMoniker(agentID)` → `Moniker('agentMgr', agentID)` → `Handle_MachoBindObject` (`agent/agentMgrService.js:628`), resolved via `_resolveBoundAgentID`.
- Open conversation: bound `DoAction(None)` → `((agentSays, availableActions), lastActionInfo)`. Each available action carries a **server-assigned actionID**; the UI renders buttons from `availableActions` and calls `DoAction(actionID)`.
- Accept a courier: `DoAction(<accept actionID>)`. Read the briefing/objectives with `GetMissionBriefingInfo` / `GetMissionObjectiveInfo` (courier cargo/pickup/dropoff/reward/time-bonus) / `GetMissionKeywords` / `GetAgentLocationWrap` / `GetStandingGainsForMission`, and the journal with `GetMyJournalDetails`.
- **Determine which `DoAction` outcomes are deferred** (read `agentMgrService.js` `Handle_DoAction` + `agentMissionRuntime.doAgentAction`, and the decompiled client's dialogue flow). The **in-person courier accept** should be the synchronous path — verify and use it. Decline/confirm provisional round-trips may be deferred; handle per the gateway rule above (adapter or typed refusal), but they are secondary to accept.

## In-person vs remote (design note — do NOT block on it)

Farmer accepts **in person**: the browser session is docked at the agent's station, so this is a co-located accept, the normal path — not a remote accept. Use the in-person path. The separate question of whether a browser session should count as in-person for *remote* acceptance (G3 finding: EveJS emits `remoteOfferable=1` regardless of location) is a later refinement and is **out of scope** here. If the in-person accept unexpectedly requires the remote flag, stop and report rather than changing mission mechanics.

## Decoder rule (de-risk finding)

Mission rows carry long-encoded IDs and ISK/LP amounts. Decode numerics with `unwrapLong` (see `web/src/bridge/wire.ts`) — never the `typeof === "number" ? … : 0` pattern, which silently zeroes a `{type:"long"}`/decimal-string value. Amounts that exceed 2^53 (ISK) should be kept as bigint or decimal string, not lossy `Number`.

## Required work

1. **Baseline** (record): web `npm test` (expect 201/201); eve.js `test:manifest:check` (3/3), `test:agent-parity` (6/6), and `node scripts/Tests/run-isolated-tests.js server/tests/webGatewayServiceCall.test.js server/tests/webGatewayV1.test.js server/tests/webGatewayPersistentSession.test.js server/tests/webGatewayBoundObject.test.js` (green). eve.js worktree carries other agents' in-flight parity work — leave it alone; stage only your own files; never `git add -A`.
2. **eve.js — gateway (do first; commit early, small, gateway files + tests only):** agentMgr allowlist pairs + agent bound object; deferred-response handling in both dispatch seams; `afterCallResponse`. In-process tests (model: `webGatewayBoundObject.test.js` + a fixture world with an agent at the character's station offering a courier): prove bind-agent → `DoAction(None)` opens a conversation → accept a courier mission actually creates the mission (assert it appears in `GetMyJournalDetails` / mission state), briefing reads return the courier cargo/dropoff, deny-by-default still holds for non-allowlisted agent methods, and a deferred `DoAction` outcome is handled (adapter result or typed refusal — not a broken object). Commit (e.g. `feat(web-gateway): agentMgr bridge + deferred-response + afterCallResponse (R4)`); report hash; **do not push**.
3. **web BFF:** extend `src/eveGatewayClient.js` + `/api/bridge/*` for agent list / bind / conversation (DoAction) / briefing / journal, holding agent bound handles server-side (never to the browser). The browser refers to agents/missions by game ID.
4. **web page (new Svelte stack):** "Agents & Missions" reachable from the station panel: agent list → open conversation (render `agentSays` + action buttons from `availableActions`) → accept a courier → briefing panel (cargo, pickup, destination, reward, time bonus) + a journal list showing the accepted mission. Robust reads (`Promise.allSettled`, session-loss unwind like R3). Serve at `/dist/`.
5. **Update `docs/bridge-wire-contract.md`** (deferred-response handling, agent conversation shape, journal) and **README** (Spot test R4: log in → select Farmer → Agents & Missions → talk to an agent → accept a courier → see it in the journal; note expectations, incl. that the station must have an agent offering a courier).
6. Tests green everywhere; commit web; update roadmap R4 row to Complete with evidence (in-process; live spot test pending orchestrator). Report all hashes.

## Out of scope

- Completing/turning in the mission (that's the delivery end — R6), undock/travel (R5), moving mission cargo into the ship (that's R3's inventory move, already built — you may link to it but don't rebuild it).
- Remote-accept semantics / the in-person flag decision (noted above).
- Notification push/streaming (G6) beyond draining notifications into responses. Auth/security hardening. Any game-mechanics change in eve.js.

## Definition of done

- eve.js: agentMgr bridged through the bound-object path; deferred-response handled (adapter or typed refusal, tested); `afterCallResponse` invoked; accept-courier proven in-process (mission actually created + in journal); deny-by-default intact; footprint = `_secondary/express` + gateway tests; baselines non-regressed. Committed; hash reported; not pushed.
- web: Agents & Missions page at `/dist/` lists agents, opens a conversation, accepts a courier, and shows the briefing + journal entry against a stubbed/in-process backend in tests; wire contract + README updated; all web tests green. Committed; hash(es) reported; not pushed.
- Roadmap R4 row Complete with evidence "in-process end-to-end; live spot test pending orchestrator".

## Constraints

- eve.js coordination: other agents active — small early self-contained commit; stage only your files; never clobber/revert their work; if your gateway files have their work in flight, pause and surface it.
- If R4 exceeds one session, land the eve.js gateway piece (agentMgr bridge + deferred + afterCallResponse) fully with tests and commit it, then report the clean split for the web page. Never leave broken/uncommitted work.
- Never start/stop servers you didn't start (ports 443, 26000-26003, 26500, 40110 are others'); npm test + Vite builds are fine; leave nothing running.
- Preserve `_local` gameplay data, web `data/`, icon caches, manifests, ignored credentials. Commit each repo separately; never push.
