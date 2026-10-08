# Plan: pilots on the game port (retire REST for game calls)

Written 2026-10-07 against web `1874327` and eve.js `7603a2966`. Nothing in this plan has been
built or run live; every "verified" below means "read in the source at those commits".

**Decision this plan implements (option B):** the BFF becomes the retail-protocol client. Each
logged-in pilot is one TCP connection to the eve.js game port (26000) speaking machoNet with
marshal frames, exactly as the client in `D:\EVE Online - 3396210 - Copy` does. The browser talks
to the BFF over one WebSocket. HTTP remains only for things the retail protocol cannot do.

```
browser ── one WebSocket (calls + pushed notifications) ──> BFF ── TCP 26000 machoNet ──> eve.js
                                                             ├── XMPP 5222 (chat, already built)
                                                             └── HTTP :26002 gateway, ACCOUNT-LEVEL routes only
```

⚠ **This needs no eve.js feature.** It moves Web Companion further onto "the published stock EveJS
interfaces and original game protocol" (`docs/stock-evejs-integration-policy.md`). The web client
conforms to the server; nothing is added to the server for the web client's sake.

A **server defect** is different, and since 2026-10-08 it gets fixed: something the retail client
would suffer too is handed to a sub-agent to fix and commit in `eve.js`. The procedure, and the
unattended loop that now works this plan, are in
[`goal-prompts/game-port-loop.md`](goal-prompts/game-port-loop.md); its journal is
[`game-port-loop-log.md`](game-port-loop-log.md).

---

## 0. Goal and standard (operator, 2026-10-07)

**The ultimate goal is EVE in a web browser, with minimal graphics.** This plan is the transport
half of that. Option B is a step toward it, not the end state: Phase 6b moves the client's logic
into the browser.

**The standard is "identical to the retail client", not "frames the server accepts".** The game
port must not be able to tell our session from build 3396210: same handshake, same calls in the
same order at login and character select, same handling of what the server pushes. Where the
existing `GameClient` takes a shortcut the retail client does not, the shortcut is a defect.

Sources of truth, in the order to consult them:

1. **The decompiled client**, `eve.js/tools/ClientCodeGrabber/Latest` — what the client does.
   Decompile further with `eve.js/tools/ClientCodeGrabber` (and its V2) when a module is missing.
2. **CCP's own source**, in `C:\Users\ryanf\Documents\GitHub`: `destiny` (the ballpark
   simulation the client runs), `blue` (the marshaller and the Python runtime glue), `io`, `core`,
   `fsd`, `trinity`. Where one of these covers the question it outranks decompiling a binary.
3. **The legacy client install**, `D:\EVE Online - 3396210 - Copy` — the binaries the Python
   calls into (`blue.dll`, `_destiny.dll`, `code.ccp`). Decompile them when neither of the above
   answers the question. Its `python27.dll` answers questions about Python itself.
4. **The eve.js server source** — what the server accepts and sends.
5. **A recorded real-client session** settles any disagreement between the others. One exists:
   `eve.js/_local/logs/direct-tcp-real-client-20260809-163920.stdout.log` (login, character
   select, in station). Record more when a phase needs them.

**This is a dev machine.** Staging data in the game database (accounts, items, colonies) is
allowed and expected. "The data does not exist" is never a reason to leave a live check undone;
stage it, run the check, and say what was staged.

---

## 1. What is true today (verified)

### 1.1 The two REST hops

| Hop | What it is | Size |
|---|---|---|
| Browser → BFF | Express routes in `src/server.js` | 574 routes; 460 under `/api/bridge`; one SSE stream |
| BFF → eve.js | HTTP JSON gateway `/_evejs-web/v1/*` on :26002 | ~25 routes; allowlist of 717 pairs; WebSocket `/session-events` |

### 1.2 The seam the swap happens behind

The BFF does not call the gateway from 460 places. It calls a handful of helpers:

| Helper in `src/server.js` | Call sites | Game-port equivalent |
|---|---|---|
| `heldTopLevelCall` | 332 | `CallReq` to a service |
| bound bind / bound call (`gateway.bindObject`, `callBoundMethod`) | few, shared | `MachoBindObject`, `CallReq` with the `N=...` object id |
| `readHeldFlight` (`/session/flight-status`) | 69 | **none** — derive from session changes + ballpark |
| `gateway.readSpaceSnapshot` (`/space/snapshot`) | 9 | **none** — derive from `DoDestinyUpdate` |
| `gateway.readScannerState` | 1 | **none** — derive from scan notifications |
| `gateway.selectCharacter` / `releaseBridgeSession` | 3 / 5 | `SelectCharacterID` / close the socket |
| `gateway.openSessionEventStream` | 1 | notifications arrive on the same socket |

The three "none" rows are web-only projections. They are the real work.

### 1.3 What already speaks the real protocol

- `src/gameClient.js` — handshake, login, `call`, `bind`, `callBound` over TCP 26000. Short-lived
  and calls-only: it drops every packet that is not a `CallRsp` (7) or `ErrorResponse` (15). Used
  only by `src/piCustomsExport.js`.
- `src/gameProtocol/marshal.js` — the codec, vendored from eve.js. **Stale:** it predates eve.js
  `4544f5747` (pickle framing), `972e70c96` (negative longs) and `65f759873` (NULL bool flag).
- `src/evejsXmppChat.js` — Local and Corp chat over XMPP 5222.

### 1.4 Constraints

1. **One character, one session.** A game-port select evicts the gateway session for that
   character and vice versa (`loginTakeoverEnabled: true`). In space, eviction is an emergency-warp
   logoff. A pilot is on one transport for its whole session; there is no per-call mixing.
2. **A game-port session has no snapshot to poll.** The gateway session deliberately discards
   `DoDestinyUpdate` (`evejsWebGatewayRuntime.js`, "Candidate F") and serves `/space/snapshot`
   from the server's own ballpark. The retail client simulates the ballpark itself (`_destiny.dll`).
3. **The game port accepts any password** (`devSkipPasswordValidation: true`). Web auth in the BFF
   is the only thing tying a browser to an account, so the BFF must do the login itself and never
   relay a browser-chosen `user_name`.
4. **Session lifetime becomes socket lifetime.** `socketIdleTimeoutMs` is 0 in stock config, so an
   idle connection is not reaped; but a closed socket is an immediate logoff. Today a gateway
   session outlives a BFF restart until its 30-minute TTL.
5. **Hosted bots share the seam.** `src/botHost.js` runs the browser stack in Node and calls the
   BFF's own HTTP routes through `botFetch`.
6. **BFF write routes carry behaviour.** `/api/bridge/call` refuses writes; dedicated routes do
   read-before, call, re-read, and static-data lookups (e.g. `modules/activate`). That logic is
   transport-independent and stays where it is until Phase 6.

### 1.5 Not yet verified — each is answered by a named phase

| Unknown | Answered in |
|---|---|
| ~~Does eve.js compress outbound packets?~~ **No.** Nothing it sent in any recording was compressed. It does inflate what the client compresses. | answered, Phase 1 |
| ~~Does the retail client send "placebo" or a real AES session key?~~ **Placebo, no key, nothing encrypted.** The eve.js client setup sets `cryptoPack = Placebo`, and the server's constant `challenge_responsehash` only verifies under Placebo. | answered, Phase 1 |
| Do wire-decoded values match the gateway's JSON closely enough for the 142 browser decoders? | Phase 2 |
| How much of a ballpark simulation do overview, targeting and autopilot actually need? | Phase 4 spike |
| BFF CPU cost of decoding 10 Hz destiny updates for N pilots | Phase 4 |
| Does `piCustomsExport` work live on the refreshed codec? | Phase 0 |

---

## 2. Target design

### 2.1 `PilotSession` — the one interface

Everything that today goes through the helpers in 1.2 goes through one interface with two
implementations. The gateway one is today's behaviour; the game-port one is the goal.

```
PilotSession
  call(service, method, args, kwargs)            -> result
  bind(service, bindParams)                      -> handle
  callBound(handle, method, args, kwargs)        -> result
  onNotification(fn)   onSessionChange(fn)   onClosed(fn)
  location()     -> what flight-status returns today
  ballpark()     -> what space/snapshot returns today
  scanner()      -> what scanner-state returns today
  close()
```

**The protocol core takes a byte transport; it never imports `node:net`.** The session, the
packet handling and the ballpark are written against "something that sends and receives frames",
so the same code can later run in a browser over a relay (option C) without a rewrite.

**The contract of `location()`, `ballpark()` and `scanner()` is the JSON the browser already
consumes.** That is what keeps the browser, the bots and 584 call sites unchanged while the
transport underneath is replaced.

### 2.2 Transport is chosen per pilot, and is reversible

A setting (`EVEJS_PILOT_TRANSPORT=gateway|gameport`, with a per-account override) picks the
implementation at select time. Default stays `gateway` until Phase 5. Any pilot can be moved back
by flipping it and re-selecting.

### 2.3 What stays on HTTP, permanently

The retail protocol only sees the logged-in character. Management needs more:

- **eve.js gateway, account-level only:** `health`, `status`, `accounts`, `account`,
  `account/create`, `characters`, `character-status`, `skills` and `skill-queue` for offline
  pilots, `character-control/*`.
- **BFF app API (~115 routes):** web login, bot host, mining/PI/industry plans, pilot training,
  provisioning, and static data (map graph, types, names, icons, market reference).

### 2.4 Authority that does not move

`bridgeCallPolicy`, `pilotMutationFence`, custody journals, hosted claims and reservations are BFF
logic above the seam. They are untouched by Phases 0–5.

---

## 3. Phases

Each phase ends on something observable. Do not start a phase on the strength of the previous
phase's tests alone where a live check is named.

### Phase 0 — Refresh the codec (small)

- Re-copy `marshal.js` and the string table from eve.js; record the source commit in the header.
- Add `scripts/vendor-marshal.js` (`npm run vendor:marshal`): reports when the vendored copy
  differs from the eve.js source, and re-copies it with `--write`. A test runs the same check
  against `STOCK_EVEJS_ROOT` and is skipped when that is unset, like the bridge-contract test.
- **Done when:** existing `gameClient` / `piCustomsExport` tests pass, a round-trip test over
  frames captured from a real server passes, and one live PI customs export succeeds.

**Status 2026-10-08: done.**

- Codec re-copied from eve.js `65f759873`; `npm run vendor:marshal` reports no drift.
- `test/gameProtocolMarshal.test.js` pins the three fixes. All four wire tests were watched
  failing on the old copy first.
- `test/fixtures/gamePortFrames.json` is a recording of a real login and three read-only calls
  (`scripts/capture-game-frames.js`, account `test2`, eve.js `7603a2966`).
  `test/gamePortFrames.test.js` decodes it, round-trips it, and replays it through `GameClient`.
  Watched failing under three kinds of tampering.
- Run live as Test Two (docked): login → `SelectCharacterID` → `map.GetSolarsystemItems`
  (92 rows, 11 customs offices) → `GetTaxRate` → `invbroker` bind. That is the PI export's whole
  hop except `ImportExportWithPlanet`. The pilot was offline again after the socket closed.
- Run live as Test Two: the real `runCustomsExport` exported 80 Biofuels from a launchpad on
  Muvolailen I into customs office 1200040176368. The server answered `ImportExportWithPlanet`
  and pushed `OnAccountChange`, `OnMajorPlanetStateUpdate`, `OnRefreshPins` and `OnItemsChanged`;
  the pad read back empty and the pilot was offline again afterwards.
  **Staged for this:** one colony row for Test Two, `40176368:140000002` (a command center and a
  launchpad holding 80 of type 2396), plus `nextIDs.pinID` moved on by two.

> Correction: an earlier version of this status said no pilot had a colony. That was a misreading
> of the store. `planetRuntimeState` keeps one row per colony under the key
> `coloniesByKey` + U+001F + `planetID:ownerID`; the bare `coloniesByKey` row is an empty
> skeleton. Farmer has three colonies in Jita, untouched by this work.

Found along the way, for later phases:

- The server's version tuple carries build `3396210`, the same build as the retail client folder.
- The recording decodes identically on the old codec: pre-select traffic contains no pickle,
  negative long or NULL bool. The recording proves the codec reads real bytes; it does not prove
  the fixes. (Phase 1 captures of in-game traffic should be checked for those.)
- An integer above 32 bits can arrive as a JS number or a BigInt depending on which opcode the
  server used, and re-encoding a number that size turns it into the BigInt form. Phase 2's
  normaliser must treat the two as the same value.
- `GameClient` decodes with `marshalDecode`, which ignores bytes left over after a value.
  Phase 1 should decide whether a long-lived session uses `marshalDecodeExact`.
- The server's handshake reply carries Python source for the retail client to run (time-dilation
  handler, portrait upload hook). The Node client ignores it; Phase 1 should confirm nothing the
  server later expects depends on it.

### Phase 1 — A long-lived game-port session, docked (medium)

Extend `GameClient` into a session that can stay connected and behaves as the retail client
does (section 0). Spec is the decompiled client
(`eve.js/tools/ClientCodeGrabber/Latest/carbon/common/script/net/machoNet*.py`, `GPS.py`), the
server's `network/` code, and the recorded real-client session.

- Handshake exactly as the retail client sends it, including its crypto request.
- The retail client's own call sequence, feature by feature (decided 2026-10-08), read from the
  recorded session and the decompiled services that issue each call.

- Dispatch `Notification` (12), `SessionChangeNotification` (16), `SessionInitialStateNotification`
  (18), `PingReq`/`PingRsp` (20/21), `TransportClosed` (8).
- Keep a session mirror updated from session changes (`charid`, `stationid`, `solarsystemid2`, …).
- Inflate compressed inbound frames if the server sends them; match retail's outbound threshold.
- Decode cached-object replies. (Done: see the reference, "Cached answers".)
- Socket loss is session loss. No silent reconnect; report it upward like retail does.
- **Done when:** a docked pilot stays connected for 60 minutes with every pushed packet logged and
  typed (zero "unknown packet" lines), and the two handshake unknowns in 1.5 are written down.

**Status 2026-10-08: done as specified. Two fidelity items remain, both waiting on a recording.**

The exit check, run with `scripts/soak-game-session.js` as Test Two, docked:

| | |
|---|---|
| Held | 3600 s, not dropped |
| Packets the session could not name | 0 |
| Frames | 147 sent, 150 received |
| Sent | 1 `GetServiceInfo`, 1 `SelectCharacterID`, 98 `GetTime` (the first sync, then one every three minutes), 40 `pingService.Ping` |
| Received | 140 call answers, the initial session state, the character's session change, `OnServerSkillsChanged` |

Forty keep-alives in an hour is the client's own rhythm: a clock sync counts as activity, so a ping
only goes out when a full minute passes with nothing else sent.

What exists (`src/gamePort/`, checklist in
[`game-port-client-reference.md`](game-port-client-reference.md)):

- `session.js` — `GamePortSession`: the retail handshake, calls, binds, session mirror,
  notifications, ping answers, clock sync and idle keep-alive. Takes a frame transport.
- `tcp.js` — the socket binding. `packets.js`, `placebo.js`, `py27.js` — packet layout, the
  Placebo crypto pack, and CPython 2.7's dict ordering.
- `src/gameClient.js` is now a thin wrapper over the session, so the customs export logs in the
  retail way too. It was re-run live after the change and exported 80 units.
- Tools: `scripts/py27-oracle.py` (asks the client's own `python27.dll`),
  `scripts/capture-game-frames.js` (records a conversation as a fixture),
  `scripts/soak-game-session.js`, `scripts/record-game-port.js` (records any client).

How it was checked:

- The server's own probe log records what a client answers at login. For the real client it reads
  `Buffer(5), Buffer(75), null`. The old `GameClient` gave `Buffer(0), Buffer(0), null`; the
  session gives the real client's line.
- The gateway reports a session's pilot as `controlState: "retail_client"`, `transport: "tcp"`.
- The server log shows the real client's addressing pattern for our calls: resolve to any node,
  bind to the named node, bound calls to that node, proxy services to the proxy node.
- Tests replay a recorded real-server conversation and require the session to send its own half
  again byte for byte; nine deliberate breakages were each caught.

Remaining:

1. ~~The startup call sequence.~~ **Decided 2026-10-08: per feature.** Each browser feature makes
   the calls its retail counterpart makes, same arguments and order; the roughly ninety startup
   calls are not replayed wholesale. Phase 3 applies this as each feature moves.
2. **Six `?` rows in the reference** (call-ID encoding, journey ID, trace fields, which compression
   path is live). Same recording settles them.

Decision taken while building it: "identical" is defined at the level of decoded values, not
bytes, because the client's marshaller shares objects by Python identity. The reference explains.

### Phase 2 — Normaliser and parity harness (medium)

- `wireToBridgeJson`: turn decoded wire values into the JSON the gateway emits (longs → decimal
  strings, buffers → `{type:"Buffer",data}`, packed rows, object/dict shapes).
- Notification normaliser: wire `Notification` → `{kind, service, method, idType, args, kwargs}`.
- Parity harness: for every allowlisted read that is safe on a docked pilot, read via the gateway,
  release, read via the game port, and diff. Sequential, never concurrent (constraint 1).
- **Done when:** the harness report lists every pair as identical, normalised, or a named
  divergence with a decision. This number is the real size of the browser-side work.

**Status 2026-10-08: done for every read that can be made without a player's input.**

What exists:

- `src/gamePort/bridgeJson.js` — maps a game-port value, a notification or a session change to the
  JSON the gateway emits.
- `scripts/parity-harness.js` and `scripts/parity-compare.js` — make each read through the gateway,
  then the game port, and judge the pair. The list of reads comes from the BFF's own source.
- [`game-port-parity-report.md`](game-port-parity-report.md) — the generated result, every read
  listed. Regenerate it; do not edit it.
- Tests feed mapped values from the recorded real server to the browser's own readers
  (`web/src/bridge/wire.ts`, loaded directly), so "a decoder can read this" is checked, not argued.

The result, as the Test Pilot docked in Jita. The gateway allows 366 reads; 176 were compared (the
two inventory reads were each made on two inventories, which is why the rows sum to 368):

| | Reads |
|---|---|
| Identical JSON, or the same shape with data that moved between the two reads | 142 |
| Differ only in spellings the shared readers accept either of | 9 |
| Refused by the server on both transports, with the same reason reported | 15 |
| **Differ in a way a decoder could trip on** | **9** |
| The server cannot marshal its own answer | 1 |
| Not compared: 88 need a player's choice of argument, 104 are not top-level calls in the BFF | 192 |

The 9 that differ, by kind, and what is decided for each. None can be fixed in the mapping: in
every case the gateway prints a detail of the handler's value that marshalling erases.

| Kind | Reads | Also in | Decision |
|---|---|---|---|
| A timestamp the gateway prints as bare digits; the game port gives `{type:"long"}` | 5 | `OnGodmaShipEffect`, `OnModuleAttributeChanges`, the session change | Teach `unwrapLong` to read a string of digits, and read these fields through it. Bare digits are the minority spelling on the gateway too (5 reads against 26 with the wrapper). |
| A tuple the gateway prints as `{type:"tuple"}`; the game port gives an array | 2 | | A reader of a tuple accepts an array. `agents.ts` `seqItems` does not yet; `fittings.ts`'s does. |
| A byte string the gateway prints as `{type:"bytes"}`; the game port gives `{type:"Buffer"}` | 2 | planet data (`boundPlanets.ts`) | A reader of bytes accepts both. The wire does distinguish the two (a buffer and a string are different opcodes) but the stock decoder merges them; a decoder option upstream would remove this row. |

Fourteen more reads come back from the gateway inside a cached-answer envelope that the browser
opens, where the game port returns the answer itself. The browser's `unwrapCachedResult` helpers
already pass a bare answer through, so these compared equal once opened. Phase 3 confirms each such
decoder goes through one.

Found along the way:

- **A client defect, fixed.** We sent integers above 32 bits as int64, which the server reads as a
  BigInt. The retail client sends a Python long, which the server reads as a number. Every read on
  a ship's inventory answered None because of it. `src/gamePort/clientMarshal.js` now encodes what
  the client sends. This also settles the reference's open row on call-ID encoding.
- **A server defect, reported, not ours to fix.** `corpRegistry.CanLeaveCurrentCorporation` returns
  a bare `{}` the server's marshaller refuses, so the game port, and the retail client, get None.
  The gateway prints it happily. More generally the server answers None when a handler or the
  marshaller throws; the only trace is a `[PKT] ERR` line in its log.
- **The gateway's session is not a retail session.** On character select the gateway reports a role
  mask of `0x6000000000000000` where the game port reports `0x65fc2062a0e41800`, an extra `baseID`
  attribute the retail session change does not carry, and old values of null where retail has 0.
  Anything gated on roles can behave differently between the two.
- **Refusals carry the same reason.** `error.refusal.reason` on the game port is put together the
  way the gateway's `CALL_REFUSED` message is, and matched it in all 15 refused reads.
- **A capability gained.** A cached answer that is a reference into the object cache is unreadable
  through the gateway (`map.GetStationInfo`, `corporationSvc.GetAllCorpMedals`). The game port
  fetches the object.

What Phase 3 inherits:

1. Three small reader changes in the browser (the table above), each a widening that leaves the
   gateway path working.
2. The 192 reads not compared here are compared as their feature moves, with the arguments that
   feature really sends. The harness takes them as soon as they are top-level calls with arguments
   it can derive.
3. Bound-object reads beyond the inventory (agents, dogma, fleet, planets) need their retail bind
   parameters, which `eveMoniker.py` gives.

### Phase 3 — `PilotSession` in the BFF, docked features on the game port (medium–large)

- Step 1 (pure refactor): introduce the interface, implement it on the gateway, route the helpers
  in 1.2 through it. No behaviour change; the existing suite is the proof.
- Step 2: implement it on the Phase 1 session for calls, binds, notifications and select/release.
  `ballpark()` and undock **refuse deliberately** on the game port until Phase 4.
- Decide the BFF-restart behaviour (constraint 4): accept retail-equivalent drop, or host the
  sockets in a small separate process that survives BFF restarts. Write the decision here.
- **Done when:** with one account flagged `gameport` and the browser unchanged: login, select,
  inventory, fitting, market, agents, skills, mail and chat all work; one hosted maintenance flow
  (Provisioning Center Apply) completes; the gateway log shows no held session for that pilot.

### Phase 4 — Space: a ballpark from destiny (large; spike first)

**Spike (time-boxed, throwaway code):** record the full `DoDestinyUpdate` stream for one pilot
through undock → warp → gate jump → dock. Write a decoder for the state blob and the incremental
actions as the inverse of `eve.js/server/src/space/destiny/stream/*.js`, cross-checked against
`eve/client/script/remote/michelle.py`. Answer: which ball modes must be simulated for the numbers
the app uses (overview distance, in-range checks, arrival detection) to stay correct.

Then build, in this order:

1. Destiny decoder with recorded-stream tests.
2. Ball simulation. **CCP's own source for it is on this machine**
   (`C:\Users\ryanf\Documents\GitHub\destiny`: `Ball.cpp`, `Ballpark.cpp`), so this is a port of
   the client's simulation, not an approximation sized by the spike. The server's
   `eve.js/server/src/space/destiny/simulation/` and the client's `michelle.py` show how it is
   driven. The client's numbers win.
3. `ballpark()` producing today's `/space/snapshot` JSON; ship HUD from dogma reads and
   notifications, as retail does.
4. `location()` from the session mirror plus ballpark; `scanner()` from scan notifications.
5. Measure BFF CPU with several pilots in space; move decoding to a worker thread if needed.

- **Done when:** two pilots on the same grid, one per transport, report the same entities with
  distances within an agreed tolerance across a warp/jump/dock route; then a hosted bot flies a
  courier mission end to end on the game port.

### Phase 5 — Cutover (small)

- Default the setting to `gameport`. Keep `gateway` selectable for one release as the way back.
- Then remove: held `bridgeSessionID` handling, the `/session-events` client, the gateway
  implementation of `PilotSession`, and the pilot pairs from the bridge contract.
- **Done when:** the only gateway routes the BFF calls are the account-level ones in 2.3.

### Phase 6 — Browser ↔ BFF over one WebSocket (large, mechanical; independent of 0–5)

Can run in parallel with the phases above; it touches a different hop.

- 6a: one WebSocket per pilot carrying named operations (the existing `/api/bridge` route bodies,
  unchanged) and pushed notifications. Replaces 460 routes' HTTP carriage, the SSE stream, and the
  four-request lane cap in `web/src/app/transport.ts`. Hosted bots call the same operations
  in-process instead of through loopback HTTP.
- 6b (planned; this is what "EVE in a web browser" means for the code): move route orchestration
  into shared TypeScript used by both the browser and hosted bots, leaving only generic `call` /
  `bind` / `callBound` on the socket. After it, the browser decides what to call and when, as the
  retail client does, and the BFF only relays those calls. It is also what makes option C
  (browser speaks machoNet through a relay) a relocation, not a rewrite.
- **Done when:** no `/api/bridge/*` HTTP route remains and no `EventSource` is opened.

---

## 4. Risks

| Risk | Effect | Handling |
|---|---|---|
| Ballpark simulation is larger than expected | Phase 4 stalls; pilots who fly stay on the gateway | Spike before committing; docked-only pilots still benefit after Phase 3 |
| Wire shapes diverge from gateway JSON | Many browser decoders need changes | Phase 2 measures this before any decoder is touched |
| BFF restart logs every pilot off at once | Pilots in space emergency-warp | Decision in Phase 3; separate socket host if unacceptable |
| Marshal decode load on the BFF's main thread | Latency for every pilot | Measure in Phase 4; worker thread |
| Gateway allowlist no longer filters the generic call path | A browser could reach any handler as its own account | Keep the current pair list as a BFF-side allowlist at cutover; widen deliberately |
| Vendored codec drifts again | Silent wire bugs | Phase 0 drift check |

## 5. Decisions needed from the operator

1. **BFF restart behaviour** (Phase 3): retail-equivalent drop, or a separate socket host.
2. **Generic call path after cutover** (Phase 5): keep an allowlist in the BFF, or accept retail
   trust (a logged-in client may call anything as itself).
3. ~~Phase 6b: wanted, or stop at 6a.~~ Settled 2026-10-07 by the stated goal: 6b is planned.

## 6. Out of scope

- Any eve.js change made for the web client's sake. (Server defects are fixed; see the top.)
- The gRPC public gateway (`publicGatewayLocal.js`). Node can speak it if a feature needs it; none
  in this plan does.
- Option C (browser as the machoNet client). Phase 6b keeps it possible.
- Rendering the ballpark. This plan only reproduces the data the app already shows.

## 7. Evidence rules for this work

- Fixtures come from real server bytes, captured and committed, not hand-built.
- Watch each new test fail before trusting it.
- A local or patched server is not evidence of stock compatibility.
- Missing data is staged, not skipped. Record what was staged beside the result.
- Never run both transports for one character at the same time.
