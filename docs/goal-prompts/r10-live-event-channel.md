# Goal R10: Live event channel (G6 push) — stop polling, start pushing

**Issued:** 2026-07-19 by the orchestrator (Phase 2). **Status:** Ready to run. eve.js changes are **gateway/interface only** (`_secondary/express/*` + tests) — the standing bridge-only rule applies.

Today every server→browser signal is pull-based: handler notifications are captured into a per-session array and `splice(0)`-drained onto the next response, chat polls a backlog every 4s, and **the browser throws the drained notifications away**. This goal delivers a real push channel.

## What the research established (verified — build on this, don't rediscover it)

**A complete WebSocket push channel already exists in the gateway** and is the thing to extend:
- `evejsWebGateway.js:3` requires `ws` (already a dependency of both repos; the BFF doesn't use it yet).
- `mountEvejsWebGatewayUpgrades(server, runtimeContext, options)` at `evejsWebGateway.js:400-748`, mounted at `_secondary/express/server.js:1059-1064`. It has: `WebSocketServer({noServer:true, …})` (`:441`), the single `server.on("upgrade", onUpgrade)` handler (`:609-666`, registered `:745`) which **404s any pathname that isn't `EVENTS_PATH`** — that is your attach point; `sendFrame` with 2 MB frame / 4 MB buffer guards closing 1009 on overflow (`:541-572`); ping/pong heartbeat (`:497-539`); graceful shutdown (`:678-739`); inbound client messages rejected — strictly server→client (`:578-580`).
- The existing path `EVENTS_PATH = "/_evejs-web/v1/events"` (`:10`) carries only **character-events keyed by characterID**, not bridge sessions.
- **Replay model to copy** — `services/online/characterEventRuntime.js`: per-process `runtimeEpoch` (`:146`), per-stream `{sequence, history, subscribers}` (`:175-187`), `makeEventFrame` stamping `cursor:{epoch,sequence}` (`:189-199`), `canReplay` (`:376-389`), `buildSnapshotFrame` fallback (`:391-409`), `subscribe` registering the subscriber **before** draining so replay→live is atomic (`:411-446`), `DEFAULT_EVENT_HISTORY_LIMIT = 256` (`:8`), and `drainSubscriber` treating `onFrame(...) === false` as consumer rejection (`:217-238`).
- ⚠ **`authorizeGatewayUpgrade` (`:135-143`) returns `false` when no `EVEJS_WEB_GATEWAY_TOKEN` is configured** — unlike `authorizeGatewayRequest` (`:125-133`) which falls back to loopback-allow. A new WS path must handle this (add the loopback branch, mirroring the request-auth behavior) or it will never connect in the operator's token-less local setup. **This is the most likely thing to silently break — verify a connection actually opens.**

**What must be carried:**
1. **Session notifications** — the three capture stubs on the persistent session (`evejsWebGatewayRuntime.js:439-495`): `sendServiceNotification` → `{kind:"service",…}`, `sendNotification` → `{kind:"client",…}`, `sendSessionChange` → `{kind:"sessionchange", method:"OnSessionChanged",…}`. They push into `entry.notifications` (`browserSessions` map, `:1206`, entry `:1648-1660`), drained via `entry.notifications.splice(0)` at `:1573,1684,1809,1847,1891,1971,2088`.
2. **Chat** — which bypasses session capture entirely. `_secondary/chat/chatRuntime.js` module-level `runtimeEmitter` (`:53`) emits `channel-message` (`:990`), `local-message` (`:1651`), `local-join`/`local-leave`/`local-membership-*`; exported `on`/`off`/`once` (`:1919-1921`). Plus the corp emitter used by `webChatGatewayService`. This is the ready-made source that lets the Chat panel stop polling.

## Objective

1. **eve.js (gateway only):** add a second WS path (e.g. `/_evejs-web/v1/session-events`) on the existing `onUpgrade` seam, **keyed by `bridgeSessionID`** (authorized like the other bridge routes — the session must belong to the requesting `userid`). It pushes: the session-notification frames described above, and chat events sourced from the chat emitters for the session's character (local + corp). Reuse the existing frame/heartbeat/backpressure/shutdown machinery and the epoch/sequence **replay-or-snapshot** model. Fix the `authorizeGatewayUpgrade` token gap.
2. **Keep the drain working.** The push is **additive**: `notifications` must still be returned on responses so nothing regresses and a reconnect gap can't lose data. Do not remove the drain.
3. **BFF:** hold **one gateway WS per held bridge session** (`src/eveGatewayClient.js` + the `bridgeSessions` map in `src/server.js`), and expose the stream to the browser as **SSE** (`GET /api/bridge/events`, same-origin, cookie-authed, routed to the right web session). Reconnect with the cursor; fall back cleanly when the gateway WS drops.
4. **Web client:** consume the SSE and feed the store (today `flow.ts` never reads `.notifications` — wire it now), and **switch the Chat panel from its 4s poll to live events**, keeping a low-frequency poll as a safety net. No visual regression: R7d zero-IDs, R8 responsive, and R9a plain-language text all still hold.

## Required work

1. **Baseline** (record): web `npm test` (expect 319/319); eve.js `test:manifest:check` 3/3, `test:agent-parity` 6/6, and the isolated gateway suites (`webGatewayServiceCall, webGatewayV1, webGatewayPersistentSession, webGatewayBoundObject, webGatewayAgentMgr, webGatewaySpaceBridge, webGatewayCourierComplete, webGatewayLocalChat, webGatewayCorpChat`) all green.
2. Implement the four parts above with tests: a gateway test that a session-events subscriber receives a pushed notification frame and a chat message frame, that replay-or-snapshot works across a reconnect cursor, and that an unauthorized/foreign-session upgrade is refused; BFF/web tests for the SSE route + the store wiring + chat-live-with-poll-fallback.
3. **Prove the token gap is fixed** — show a connection opening with no `EVEJS_WEB_GATEWAY_TOKEN` configured (the operator's setup).
4. Update `docs/bridge-wire-contract.md` (the push contract, cursor/replay semantics, what stays polled) and the roadmap (R10 row). Commit eve.js and web **separately**; report both hashes. **Do not push.**

## Definition of done

- A browser holding a bridge session receives **live** session notifications and chat messages over SSE (gateway WS → BFF → browser), with cursor-based replay-or-snapshot on reconnect; chat no longer depends on its 4s poll for liveness; the response drain still works unchanged. Connection opens in a token-less local setup. All baselines green; `build:web` clean; eve.js diff confined to `_secondary/express/*` + tests. Committed (both repos separately); hashes reported; not pushed.

## Constraints

- eve.js: **gateway/interface files only** (`_secondary/express/*` + `server/tests/*`). Do NOT modify chat mechanics, `chatRuntime`, `characterEventRuntime`, or any game-mechanics code — subscribe to existing emitters, don't change them. Other agents are active in eve.js: stage only your files, never `git add -A`, never revert their work.
- The OPERATOR runs EveJS (:26002) and the ORCHESTRATOR runs the web app (:26500) — do NOT start/stop/restart either. Run only tests + builds. Never push.
- If the scope proves too large for one session, land the **eve.js gateway push path + its tests** first (committed, green), and report the BFF/web split precisely — never leave broken or uncommitted work.
