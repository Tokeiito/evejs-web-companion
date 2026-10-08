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

**As built (2026-10-08): the interface is the gateway client's own nine pilot functions**, not a
new set of names. The BFF reaches a selected pilot through `selectCharacter`, `callMethod`,
`bindObject`, `callBoundMethod`, `releaseBridgeSession`, `readFlightStatus`,
`readSpaceSnapshot`, `readScannerState` and `openSessionEventStream`, each naming the session
by an opaque handle. `src/pilotTransport.js` stands where the gateway client stood and sends each
of the nine to the transport that holds the handle; a game-port handle starts `gp:`, which a
gateway handle (base64url) cannot. The sketch above maps onto them one for one (`location` is
`readFlightStatus`, `ballpark` is `readSpaceSnapshot`, `scanner` is `readScannerState`,
`close` is `releaseBridgeSession`, the three `on...` are `openSessionEventStream`).

Why this and not a `PilotSession` object threaded through the BFF: `src/server.js` has some 360
places that reach a pilot, other modules have more, and every test injects a fake gateway client
of this shape. Keeping the shape means none of them change, the suite keeps proving the gateway
path, and a pilot's transport is still one decision made at select. When the gateway's pilot
routes are deleted (Phase 5) the nine functions are simply the game port's.

**The protocol core takes a byte transport; it never imports `node:net`.** The session, the
packet handling and the ballpark are written against "something that sends and receives frames",
so the same code can later run in a browser over a relay (option C) without a rewrite.

**The contract of `location()`, `ballpark()` and `scanner()` is the JSON the browser already
consumes.** That is what keeps the browser, the bots and 584 call sites unchanged while the
transport underneath is replaced.

### 2.2 Transport is chosen per pilot, and is reversible

A setting (`EVEJS_PILOT_TRANSPORT=gateway|gameport`, with single accounts overridden by
`EVEJS_PILOT_TRANSPORT_OVERRIDES="test=gameport,other=gateway"`) picks the
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
- ~~The gateway reports a session's pilot as `controlState: "retail_client"`, `transport: "tcp"`.~~
  **Not evidence (corrected 2026-10-08).** The server reports exactly that for a gateway session
  too, because the gateway registers its session as a retail one. What tells the transports apart
  is the server's log: a gateway session writes `[EvejsWebGateway] Browser session started`, and
  only a call on the game port writes `[PKT] IN`. The other three points here stand on their own.
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

**All three are made (2026-10-08, `351826d`), and the harness was run again** against a server
carrying the fix below:

| | First run | After |
|---|---|---|
| Identical, or the same shape with data that moved | 142 | 143 |
| Differ only in spellings the shared readers accept | 9 | 14 |
| Refused alike on both transports | 15 | 15 |
| Differ in a spelling no shared reader takes | 9 | 4 |
| The server cannot marshal its own answer | 1 | 0 |

The four that remain are two known spellings, and each has a reader that takes both or no reader:

| Read | Kind | Its reader |
|---|---|---|
| `agentMgr.GetMyJournalDetails` | tuple with or without its wrapper | `agents.ts` `seqItems`, tested on both |
| `facilityManager.GetFacilities` | the same | `industry.ts` `tupleItems` already took both |
| `pvpFilamentMgr.GetAllEvents`, `GetMostRecentEvent` | bytes with or without their wrapper | none: the bytes are inside a date's header, which no decoder reads |

Widening `unwrapLong` also repaired something on the gateway today: the market panel's
`decodePriceHistory` read every history day as null, because the gateway prints that day as bare
digits. Twenty decoders had each grown their own guard against it.

One reader had to be held where it was. `moduleReach.ts` reads the BFF's own JSON, in which a
string where a range should be is malformed and must stay "unknown"; it relied on `unwrapLong`
refusing strings, and now refuses them itself. An existing test caught this.

Fourteen more reads come back from the gateway inside a cached-answer envelope that the browser
opens, where the game port returns the answer itself. The browser's `unwrapCachedResult` helpers
already pass a bare answer through, so these compared equal once opened. Phase 3 confirms each such
decoder goes through one.

Found along the way:

- **A client defect, fixed.** We sent integers above 32 bits as int64, which the server reads as a
  BigInt. The retail client sends a Python long, which the server reads as a number. Every read on
  a ship's inventory answered None because of it. `src/gamePort/clientMarshal.js` now encodes what
  the client sends. This also settles the reference's open row on call-ID encoding.
- **A server defect, since fixed.** `corpRegistry.CanLeaveCurrentCorporation` returned a bare `{}`
  the server's marshaller refuses, so the game port, and the retail client, got None. The gateway
  printed it happily. Fixed in eve.js `2e3101da4` (a local commit there) and re-checked live: the
  two transports now answer alike and the server logs no error. More generally the server answers
  None when a handler or the marshaller throws; the only trace is a `[PKT] ERR` line in its log.
  The loop log keeps the list of such defects.
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

1. ~~Three small reader changes in the browser~~ Done, above. What carries forward is the rule:
   a decoder of a tuple takes a bare array, and a decoder of bytes takes them without the wrapper.
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

**Status 2026-10-08: step 1 done.** `src/pilotTransport.js` is the seam, and `createApp` reaches
every pilot through it (2.1 says what it is and why it has the gateway client's shape). With no
game-port transport it returns the gateway client itself, so there is nothing in between and
nothing to have changed: the suite is green at 8583. Tests drive a pilot through the real BFF
routes onto a stand-in game-port transport and check the gateway never hears of it.

Step 2 is the game-port transport itself, `src/gamePort/pilots.js`: those nine functions on a
`GamePortSession`. What the gateway does for each, which the game port has to match, was read
from `evejsWebGatewayRuntime.js`:

| Function | The gateway | The game port |
|---|---|---|
| `selectCharacter` | mints a session object, runs `SelectCharacterID` on it, echoes character, station, structure, system, corporation, ship | logs in as the account (name from the BFF's signed session, never the browser), calls `SelectCharacterID`, builds the same echo from the session attributes |
| `callMethod` | hands the JSON arguments to the handler as they are; drains the session's notification backlog onto the answer | the JSON arguments are already the marshaller's own tree, so they are encoded as they are; the answer through `bridgeJson.js`; the same backlog and drain |
| `bindObject`, `callBoundMethod` | registers the bound object's ID under an opaque handle | the same, holding the object ID the server returned |
| `releaseBridgeSession` | runs the disconnect a socket close runs | closes the socket |
| `readFlightStatus` | reads the session's station, structure, system and ship; ship mode from the scene | the same from the session attributes; ship mode from our ballpark (Phase 4) |
| `readSpaceSnapshot`, `readScannerState` | projections of the server's own scene | refuse until Phase 4 |
| `openSessionEventStream` | a WebSocket of the same notifications, with a replay cursor | the session's own notifications, mapped by `bridgeJson.js` |

**Status 2026-10-08: step 2 built, and the docked half of "done when" met.**
`src/gamePort/pilots.js` is the transport; `EVEJS_PILOT_TRANSPORT` and
`EVEJS_PILOT_TRANSPORT_OVERRIDES` choose it at select. Unset, no transport is created and nothing
changes.

What a "bind" turned out to be. The gateway's bind calls a method as though it were a service's
(`invbroker.GetInventory(stationID)`) and keeps the bound object that comes back. The retail
client binds a service's object for where the pilot is, then asks that. Each of the BFF's bind
shapes is now made the retail way:

| The BFF asks the gateway for | The game port does, as the retail client does | From |
|---|---|---|
| `invbroker.GetInventory [locationID]` | the station's manager, bound to `(stationid, groupStation)`, then `GetInventory(containerHangar, None)`; in a structure the manager for where the pilot is, and `containerStructure` | `invCache.py` |
| `invbroker.GetInventoryFromId [id] {passive}` | `GetInventoryFromId(id, passive)`, both positional, on the manager for where the pilot is | `invCache.py` |
| `ship`, `invbroker`, `dogmaIM` `.MachoBindObject` | bound to `(solarsystemid, groupSolarSystem)` or `(stationid, groupStation)`, whatever was passed | `eveMoniker.py` |
| `fleetObjectHandler.MachoBindObject [[fleetID]]` or `[]` | `fleetID` alone, or `session.fleetid` | `eveMoniker.py` |
| `agentMgr`, `planetMgr`, `charMgr`, `reprocessingSvc` | as passed, which is what the client passes | `eveMoniker.py` |
| `entity`, `beyonce` | none while docked; the solar system once in space | `eveMoniker.py` |
| `scanMgr.GetSystemScanMgr`, `fleetObjectHandler.CreateFleet` | the service call itself, keeping the bound object it answers with | `scanSvc.py`, `fleetSvc.py` |

When the pilot moves, what was bound for the old place is dropped, as the client's session checks
drop it, and the BFF binds again.

How it was checked, with the test accounts on the game port and the browser unchanged:

- **In the browser.** Logged in, selected the Test Pilot, and opened every docked panel: station
  inventory, fitting, market, skills, wallet, mail, chat, agents and missions, agent finder,
  character sheet, personal assets, standings, industry, contracts, planets, fleet, corporation
  wallet, activity, travel, ready fit, log. Each drew its content; no failed request, no script
  error, nothing in the BFF's error log, no `[PKT] ERR` on the server.
- **Against the gateway, route by route.** `scripts/bff-parity.js` asks two BFFs, one per
  transport, the 22 routes those panels fetch and compares the JSON. For the Test Pilot: 13
  identical, 5 differing only in spellings the readers take either of, 2 where a clock moved, and
  2 with the tuple spelling whose readers take both (the mission journal, industry facilities).
  For Test Two, who has more to read: 11, 6, 3 and the same 2.
- **Which transport each really used** comes from the server's log, as above: the gateway pass
  wrote one gateway session and no game-port call; the game-port pass wrote no gateway session
  and 230 game-port calls.

Since then (2026-10-08, `e3a407f`): the first writes. A courier mission requested and accepted
and its package loaded into the ship, in the browser on the game port, each call read against the
retail client's first. `src/gamePort/retailCalls.js` is now the registry of what the client sends
for each pair, and the transport tallies every call against it
([`game-port-call-ledger.md`](game-port-call-ledger.md)).

Not done yet in this phase:

- One hosted maintenance flow on the game port. The flow this plan named, Provisioning Center
  Apply, is deliberately unavailable on stock EveJS (`provisioning-center-apply.md`); Ready Fit's
  Replenish on a selected session is the supported one and takes its place.
- The BFF's writes. Every write route goes through the same two functions, but what each sends
  has not been set beside what the retail client sends for it (list or tuple, text as str or
  unicode, keyword or positional). That is per feature, and is where the remaining fidelity work is.
- ~~Undocking is refused and a pilot in space is refused at select, until Phase 4.~~ Both are
  allowed since 2026-10-08: the pilot has a ballpark.

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

**Status, 2026-10-08.** Steps 1 to 3 are under way. A pilot on the game port undocks, flies, warps
(by the park, not yet through the browser) and docks; its view of space is its own ballpark.

| Part | State | Checked against |
|---|---|---|
| State blob reader and writer (`state.js`) | done | a real server's blobs, byte for byte |
| Integrator, STOP, GOTO, FOLLOW, ORBIT, the setters, removal (`ballpark.js`) | done | CCP's per-tick fixtures, to the last digit |
| The client's clock: update queue, when to step, rewind, snapshots (`park.js`) | done | CCP's merge and ticker cases; a recorded stream played through |
| The park beside the server's own states (`scripts/destiny-compare.js`) | measured | velocities equal; positions agree as far as such a state can show, which is about a tick (see the loop log, 2026-10-08, "the server question answered") |
| WARP: lining up, the warp proper, dropping out (`ballpark.js`) | done | CCP's one fixture (lining up) to the last digit; the source's own equations; a real warp flown live, at rest 0.17 m and 0.07 m from the server's ship after 280,000 km |
| MISSILE, FORMATION, MUSHROOM | not ported; the step refuses, the orders are counted as failed | |
| Collisions | not ported; counted | |
| Sim clock rebase, time dilation, the damage clock | not ported | |
| A pilot's own park, kept as michelle keeps one (`pilotSpace.js`); the space snapshot and flight status from it (`spaceProjection.js`) | done | the same pilot on each transport in turn: 95 entities both ways, fixed things within 0.0001 m, five kinds of difference, each explained; two pilots at once, one per transport, see the same 96; undock, stop and dock in the browser |
| The ship's capacitor and capacities from dogma, kept as godma keeps them (`pilotDogma.js`) | done | a real flight with a module running: the client's recharge lands on each of the server's next reports to the sixth place; the gateway's numbers for the same ship |
| Which modules are running, overloaded, damaged; the scanner in space | not started | |

One thing the spike's question got wrong: the stream is not 10 Hz. The server sends an update
when something changes and the client steps once a second on its own, so decoding load follows
events, not frames.

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
