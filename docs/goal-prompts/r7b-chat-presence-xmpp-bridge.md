# Goal R7b: Bridge session-derived chat presence into XMPP (retail sees the web player)

**Issued:** 2026-07-19 by the orchestrator, operator-authorized. **Status:** Ready to run. **This is an eve.js CORE-chat-mechanics change** — the operator has explicitly approved touching `xmppStubServer`/`chatHub`/`chatRuntime` for this one fix. It is otherwise outside our "bridge/interface only" footprint; stay surgical.

## The confirmed bug (from a full investigation)

The retail EVE client renders its **Local/Corp roster from XMPP MUC presence stanzas**, generated only for characters holding a live XMPP socket (`connectedClients` in `server/src/services/chat/xmppStubServer.js`). The browser-backed web session never opens an XMPP socket — it drives chat through the web gateway (`chatHub.joinLocalChannel` → `chatRuntime.joinLocalLsc` → `runtimeEmitter` `local-join`). **`xmppStubServer` subscribes to none of `chatRuntime`'s events**, so no XMPP presence is ever injected for a socketless member. Result: **retail clients don't see the web player** (Local or Corp), though the web player sees everyone (it reads `getVisibleLocalSessions`, which enumerates all sessions). This is a general latent gap — any non-XMPP member is invisible to retail; ours is the first to hit it.

Investigation evidence (read these): `xmppStubServer.js` `roomMembers` (:48), `addRoomMember` (:683), `getDistinctRoomCharacterIds` (:696), `handleJoinPresence`/`getConnectedClientsForLocalRoom` (:2150, :2208-2262, :717-770 — note it **intersects** visible sessions with `connectedClients`, dropping socketless ones), `buildRoomPresenceXml` (:1409), `deliverRoomMessage`; `chatRuntime.js` `runtimeEmitter` (:53) with `local-join/leave/message` (emitted :1400,:1429,:1453,:1551,:1559,:1600,:1651), `getVisibleLocalSessions` (:1357); `chatHub.js` `joinLocalChannel` (:243, no XMPP side-effect) vs `moveLocalSession` (:263, which does call the XMPP move helper); `localChatGatewayService.js` (:414-500, the only `runtimeEmitter` subscriber today). Corp: retail corp roster/count are pure XMPP; the web corp send (`webChatGatewayService.js` `broadcastCorpMessage` :234-253) emits a **separate private `corpChatEmitter`** (:55) that `xmppStubServer` doesn't see.

You are a worker session. Read FIRST: the files above end-to-end, plus `docs/web-client-scope-and-roadmap.md`. Execute exactly this goal, then stop.

## Objective

Make **socketless (session-derived) chat members visible and audible to XMPP (retail) clients**, for both **Local** and **Corp**, without disturbing existing retail↔retail chat.

1. **Local presence + messages → XMPP.** Have `xmppStubServer` mirror `chatRuntime.runtimeEmitter` into the MUC it serves:
   - `local-join` (member with **no** `connectedClients` entry) → broadcast an `available` presence for that character to the XMPP occupants of the local room (`buildRoomPresenceXml` to each `roomMembers` occupant).
   - `local-leave` → broadcast `available:false` (+ any admin-leave notice retail expects).
   - `local-message` from a socketless author → `deliverRoomMessage` to the room's XMPP occupants (retail's own sends already deliver; don't double-send).
   - **Initial roster seam:** in `handleJoinPresence` / `getConnectedClientsForLocalRoom`, when a retail client joins a room, ALSO send it presence for `getVisibleLocalSessions` members that have no `connectedClient` — so its opening roster includes the web player.
   - **System change:** ensure a socketless member's `moveLocalSession` produces a leave in the old room and a join in the new one for XMPP occupants.
2. **Corp presence + messages → XMPP.** Same synthetic-presence injection for `corp_<id>`, and bridge the web corp message to XMPP corp occupants. Reconcile the private `corpChatEmitter`: route corp join/leave/message onto a channel `xmppStubServer` observes (either emit corp events on `chatRuntime.runtimeEmitter`, or subscribe to `corpChatEmitter`) — editing `webChatGatewayService.js` for this is in-footprint (it's the gateway helper).
3. **Guardrails (must hold):**
   - **Never double-present** a character that already has a live XMPP `connectedClient` (dedup by characterID).
   - Respect `descriptor.suppressPresenceBroadcast` and the delayed-local room kinds (wormhole/Pochven/nolocal) exactly as the existing code does.
   - Do **not** change retail↔retail behavior — a retail-only room must broadcast identically to today.
   - Reuse existing helpers (`buildRoomPresenceXml`, `deliverRoomMessage`, `addRoomMember`/roster reads); don't fork the presence format.

## Required work

1. **Baseline** (record): eve.js `test:manifest:check` (3/3), `test:agent-parity` (6/6), and the 9 web-gateway suites (incl. `webGatewayLocalChat`, `webGatewayCorpChat`) via the isolated runner; any existing chat-runtime/xmpp suites. web `npm test` should be unaffected (expect 341/341) — the web client doesn't change.
2. Implement Local, then Corp (Local first as a checkpoint). Stay within `xmppStubServer.js` + minimal hooks in `chatHub.js`/`webChatGatewayService.js`; do NOT rewrite `chatRuntime` delivery.
3. **Tests (in-process, since retail-XMPP live test needs an operator restart):** prove a socketless session-derived Local member causes an XMPP presence to the room's XMPP occupants and a socketless local message is delivered to them; the same for Corp; and a **regression** test that a room with only XMPP clients behaves exactly as before (no double presence, no extra stanzas). If the existing harness can simulate an XMPP occupant + a socketless session in one room, use it; otherwise add a focused unit around the new emitter handlers.
4. Update `docs/bridge-wire-contract.md` (note the presence bridge) and the roadmap (R7b row). eve.js core-chat change is committed **separately** with a clear message; report the hash. **Never push. Never `git add -A`** — other agents are active in eve.js (parity work in `newEdenStore*` etc.); stage ONLY your files and never touch theirs.

## Definition of done

- In-process: a socketless (web) session-derived member of a Local room produces an XMPP `available` presence + message delivery to that room's XMPP occupants, and leaves/moves correctly; the same for Corp; retail-only rooms are byte-for-byte unchanged (regression test). Guardrails hold (no double-present, delayed-room suppression respected). All eve.js baselines green; web 341/341 unchanged. Committed (eve.js core-chat separately; web only if the gateway helper changed); hashes reported; not pushed.
- Roadmap R7b row Complete, evidence "in-process proof; live retail-sees-web spot test pending an operator EveJS restart".

## Constraints

- The OPERATOR runs EveJS (:26002) with a live retail client connected; the ORCHESTRATOR runs the web app (:26500). **Do NOT start/stop/restart either server** — your file changes don't affect the running EveJS until the operator restarts it, which is intended. Run only `npm test` / the isolated eve.js test runner / builds. Leave nothing running.
- eve.js: commit your files only, separately from the parity agents' work; never `git add -A`; never push. If Local lands but Corp needs more time, commit Local and report the split — never leave broken/uncommitted work.
