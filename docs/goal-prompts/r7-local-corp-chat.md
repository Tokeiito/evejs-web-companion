# Goal R7: Full Local + Corp chat for the browser client (presence + read + send)

**Issued:** 2026-07-19 by the orchestrator session (operator requested "the character shows up in Local and Corp chat", full read+send). **Status:** Ready to run. **This is the one goal where the operator has authorized a broader eve.js footprint** (see Footprint below) — but core chat *mechanics* stay untouched.

A survey mapped the EveJS chat subsystem; this goal implements it. Read that context below, then the code, then execute.

You are a worker session. Read FIRST: `docs/web-client-scope-and-roadmap.md`, `docs/bridge-wire-contract.md`, and the EveJS chat code named below. Execute exactly this goal, then stop.

## What the survey established (ground truth)

- Retail chat runs over **XMPP**, and chat delivery **deliberately bypasses** the `sendServiceNotification`/`sendNotification`/`sendSessionChange` surfaces the bridge drains — so **polling the notification drain yields zero chat**. Chat READ must come from the **backlog store** every channel writes to: `chatRuntime.getChannelBacklog(...)` (`eve.js/server/src/services/_secondary/chat/chatRuntime.js`). There is no macho RPC that returns messages.
- **LOCAL is session-derived and mostly ready:** membership = all live registered sessions in the system (`chatRuntime.getVisibleLocalSessions(roomName)`); the browser session appears once it is registered (it already is) AND has joined. Join = **`chatHub.joinLocalChannel(session)`**; on system change = **`chatHub.moveLocalSession(session, prevSystemID)`**; send = **`chatRuntime.broadcastLocalMessage(session, msg)`**. Local room name = `getLocalChatRoomNameForSolarSystemID(solarSystemID)` (`chat/channelRules.js`). A browser-native `localChatGatewayService` already exists — study it as the pattern.
- **CORP is XMPP-only and needs NEW plumbing:** `chatRuntime.ensureCorpChannel(corpid)` only ensures the channel record `corp_<id>` exists; it does NOT add the session as a member, and corp send/presence live in `xmppStubServer` keyed by real XMPP sockets (a browser session no-ops there). So corp presence + send need a **session-derived corp path mirroring Local** — enumerate `sessionRegistry.getSessions()` by `corpid` for the roster, and a corp broadcast that writes to the `corp_<id>` channel backlog + notifies session members (mirror `broadcastLocalMessage`). Corp READ is then nearly free (same backlog store).
- The browser-backed persistent session's `sendSessionChange` is a **capture stub** (`evejsWebGatewayRuntime.js` ~:475), so retail auto chat-sync never fires — the gateway must call the join explicitly (on select + on dock/system-change).
- The `callMethod` allowlist currently has **zero** chat pairs.

## Objective

The web character **appears in Local and Corp** (others see it; it sees the roster), and can **read and send** in both, from a Chat panel in the web app.

1. **eve.js — presence/join (gateway side-effect):** when the browser session comes online (select) and whenever it docks / changes system, join its **Local** channel (`chatHub.joinLocalChannel` / `moveLocalSession`) and **Corp** channel (ensure `corp_<corpid>` + register the session in a session-derived corp roster). Reuse the existing session-change data the gateway already has.
2. **eve.js — the corp session-derived path (NEW, gateway/chat-gateway layer):** a corp analogue of the Local gateway — session-derived corp membership (roster from `sessionRegistry` by `corpid`) and a corp broadcast (write to the `corp_<id>` backlog + notify member sessions), mirroring `broadcastLocalMessage` and `localChatGatewayService`. Do NOT rewrite `chatRuntime` delivery or `xmppStubServer`; build alongside them.
3. **eve.js — gateway chat read + send surfaces:** gateway methods (in `evejsWebGatewayRuntime.js`, or a small new chat-gateway module it calls) to (a) **read** a channel's backlog + current member roster for Local and Corp for the held session, and (b) **send** a message to Local or Corp. Expose via new gateway routes (e.g. `POST /_evejs-web/v1/chat/read`, `/chat/send`) with the same auth + persistent-session handling as the other bridge routes. Keep the browser handle server-side.
4. **web — BFF + Chat panel:** BFF routes (`/api/bridge/chat/*`) holding the session server-side; a **Chat** Svelte tab with **Local** and **Corp** sub-channels, each showing a **member/roster list**, a **message list**, and a **send box**. Since push (G6) isn't built, **poll** the read route on a modest interval (e.g. 3–5s) while the tab is open; stop polling when it's closed. Long-aware decoders; session-loss unwinds like the other pages.

## Footprint (operator-authorized exception)

eve.js changes may touch: the gateway runtime/routes (`server/src/_secondary/express/*`), **and** a new/edited **chat-gateway** helper analogous to `localChatGatewayService` for the corp session-derived path. You may READ all of `services/chat/*`. Do **NOT** modify core chat mechanics — `chatRuntime` message-delivery internals, `chatHub` local logic, `xmppStubServer`, `channelRules`, or the XMPP path — reuse them. Other agents are active in eve.js: stage only your files, never `git add -A`, never clobber their work.

## Required work

1. **Baseline** (record): web `npm test` (expect 308/308); eve.js `test:manifest:check` (3/3), `test:agent-parity` (6/6), the 7 gateway suites green.
2. **Land LOCAL first, commit it** (join local on the browser session + gateway read/send for local + the web Local channel), with tests (an in-process gateway test: the browser session joins local, appears in `getVisibleLocalSessions`, a sent message lands in the backlog + is read back). Then **land CORP** (session-derived corp membership + corp broadcast + read + the web Corp channel) with tests, and commit. This ordering keeps a working checkpoint.
3. eve.js: new allowlist/route surfaces + tests; footprint per above; commit eve.js separately, report hash, never push.
4. web: BFF chat routes + Chat panel + polling; tests; `build:web` clean; commit; report hash.
5. Update `docs/bridge-wire-contract.md` (chat read/send/presence contract + polling note) and README; update the roadmap (R7 row).

## Definition of done

- The browser character joins and **appears in Local and Corp** member lists (verified in-process against `getVisibleLocalSessions` and the corp roster); it can **read** recent Local and Corp messages (from the backlog) and **send** to both; the web Chat panel shows both channels' rosters + messages + a working send box, polling while open. eve.js core chat mechanics untouched (only gateway + a corp chat-gateway helper). All suites green; `build:web` clean. Committed (eve.js + web separately); hashes reported; not pushed.
- Roadmap R7 row Complete with evidence "in-process end-to-end; live spot test pending orchestrator".

## Constraints

- A live EveJS (:26002) + web app (:26500) are running (orchestrator's); Farmer (account rrfarmer, charID 140000005) is at Jita VI (60015169). Do NOT touch/restart/stop those processes; run only npm test + Vite builds; leave nothing new running.
- Commit eve.js and web separately; report both hashes; **never push**; never `git add -A`.
- If the whole scope exceeds one session, land LOCAL fully (eve.js + web, committed) and report the CORP split precisely — never leave broken/uncommitted work.
