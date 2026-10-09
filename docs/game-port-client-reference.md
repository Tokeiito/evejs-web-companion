# Game-port client reference: what the retail client does, and where we match

Written 2026-10-08 against retail client build 3396210 and eve.js `7603a2966`. It is the checklist
`src/gamePort/` is held to. The plan it serves is
[`game-port-transport-plan.md`](game-port-transport-plan.md).

## What "identical" means here

**The server must decode the same values, in the same order, from our packets as from the retail
client's.** Field for field, dict entry for dict entry, address for address.

It does **not** mean the same bytes. The client's marshaller (`blue.marshal`) shares repeated
objects inside one stream, and which objects it shares depends on Python object identity at the
moment of the call. That cannot be reproduced from outside the client, and no receiver can tell
the difference once the stream is decoded. Compression is in the same category: whether a packet
is compressed depends on its encoded size.

## How each fact was established

| Mark | Meaning |
|---|---|
| **S** | Read in the client's own source (`eve.js/tools/ClientCodeGrabber/Latest`) |
| **O** | Answered by the client's own Python 2.7 (`python27.dll`, via `scripts/py27-oracle.py`) |
| **L** | Seen in an eve.js log of a real client session |
| **V** | Confirmed live: a real server accepted it and answered as it answers the real client |
| **?** | Not settled. Needs a recording of the real client (last section) |

## Handshake (`GPS.py` `Authenticate`)

| # | The retail client | How known | Ours |
|---|---|---|---|
| H1 | Before login, on the same connection: version reply, then `(None, 'QC')`; reads its queue position; the server restarts the handshake | S, L | matches, V |
| H2 | Version reply is `(170472, 496, 0, 24.01, 3396210, 'V24.01@ccp')`: the third field is 0, not the server's user count | S | matches, V |
| H3 | Refuses the server on a region, codename, version or protocol mismatch, or a newer build, before sending anything | S | matches |
| H4 | `(None, 'VK', CryptoHash(CaseFold(username)))` | S | matches, V |
| H5 | Crypto pack is Placebo: request is `('placebo', {})`, nothing is encrypted | S, L | matches, V |
| H6 | `CryptoHash(x)` is `str(crc_hqx(blue.marshal.Save((x,)), 0))`, a decimal string | S, O | matches |
| H7 | Client challenge is 64 NUL bytes; its hash is `55087`, which the server sends back and the client checks | S, O, L | matches, V |
| H8 | Credentials dict has eleven keys, in the order Python 2.7 iterates that dict literal | S, O | matches, V |
| H9 | `user_name` is a unicode object (it comes from an edit box); the other strings are byte strings | S | matches, V |
| H10 | `user_password_hash` is SHA-1 chained 1000 times over UTF-16LE, salted with the name lowered bytewise | S, O, L | matches, V |
| H11 | Answers the server's challenge with `(CryptoHash(serverChallenge), stdout of the server's login function, its result)`; eve.js logged this as a 5-byte string, a 75-byte string and None | S, L | matches, V |
| H12 | Runs the Python function the server sends | S | **emulated**: answered from a table of known functions; an unknown one gets an empty answer and `unknownHandshakeFunction` is set |

The stored password hashes of three accounts in the dev database equal H10's result for their
password, which is how H10 is tied to a real client login.

## After login (`machoNet.ConnectToServer`, `connectionService`)

| # | The retail client | How known | Ours |
|---|---|---|---|
| A1 | First call is `machoNet.GetServiceInfo`, addressed to the proxy node from `proxy_nodeid` | S, L | matches, V |
| A2 | `SynchronizeClock`: up to five `machoNet.GetTime`, ending early after three readings that each beat the last | S, L | matches, V |
| A3 | Re-syncs every three minutes with five `GetTime` calls | S | matches (interval and count; the client's drift smoothing is not reproduced) |
| A4 | After 60 s with nothing sent, calls `pingService.Ping` | S, L | matches, V |
| A5 | Answers a server `PingReq` with its times plus a `client::turnaround` entry | S | matches |
| A6 | Dozens of further calls as its services start (login screen, character select, station) | L | **per feature, by decision**: see "Startup call sequence" |

## Packets and addresses (`machoNetPacket.py`, `machoNetAddress.py`, `*GPCS.py`)

| # | The retail client | How known | Ours |
|---|---|---|---|
| P1 | A packet's state is 14 fields: command, source, destination, userID, body, oob, contextKey, journeyID, six trace fields | S | matches |
| P2 | Call source is `client(clientID=0, callID)`; call IDs count from 1 | S, L | matches, V |
| P3 | `sm.ProxySvc` calls go to `node(proxyNodeID, service)`; `sm.RemoteSvc` calls go to `any(service)` | S, L | matches, V |
| P4 | A bound object's call goes to `node(nodeID)` with no service; body is `(1, pickle((objectID, method, args, kw)))` | S, L | matches, V |
| P5 | A service call's body is `(0, pickle((1, method, args, kw)))` | S | matches, V |
| P6 | Every call's keywords carry `machoVersion`, 1 unless a cached answer supplies another | S | matches (always 1; no answer cache yet) |
| P6a | Keywords go out in the order of the client's own dict, which a service call and a bound-object call build differently (below) | S, O | matches |
| P7 | A Moniker resolves first (`MachoResolveObject(bindParams)` to any node), then binds on the node that names (`MachoBindObject(bindParams, call)`) | S, L | matches, V |
| P7a | One call at a time of any one thing (`machobase.ThrottledCall`, from `ServiceCallGPCS` 697 and `ObjectCallGPCS` 616): the same call made again while it is out (the same service or object, method, `str(args)`, `str(kwargs)`) is not sent, waits, and takes the first one's answer. A call that failed is no answer: the first of those waiting asks for itself. No client call opts out (`noCallThrottling` is passed nowhere outside the net code) | S, and a Tranquility recording ("Sharing result for call ('N=...', 'GetInitState', '()', '{}') ... for 1 waiting threads") | matches, V: three of one call at once were one packet, and two binds of one address with the same call in each were one bind |
| P8 | `oob` is None unless set; `contextKey` is never set by a client | S | matches |
| P9 | Packets over 200 bytes are compressed with zlib level 1 when that saves more than 5% | S | matches, V; **?** which of the client's two compression paths is live (below) |
| P10 | Anything received that does not start `~` or `}` is zlib | S | matches |
| P11 | `journeyID` is `str(uuid4)` for the current journey | S | a fixed UUID per session; **?** when the client changes it |
| P12 | The six trace fields | S | all None; **?** whether the client ever fills them |
| P13 | Call ID is a Python long, and so is a bound object's node ID (`long(nid)`) | S | matches, V |
| P14 | A Python long is written as opcode 0x2f (blue's `WriteLong`), and on 64-bit Windows every integer above 2^31-1 is one | S, O | matches, V: `src/gamePort/clientMarshal.js`. The server reads 0x2f as a number and an int64 as a BigInt, so this is not cosmetic: sent as int64, an item ID broke every read on a ship's inventory |
| P15 | A refused call comes back as an `ErrorResponse` carrying the exception; a game refusal is a `UserError(msg, dict)` | S, L | read into `error.refusal`, with the reason worded as the gateway words it |

## What the server pushes

| Packet | Handling |
|---|---|
| `SessionChangeNotification` | Applied to `session.attributes`; listeners told what changed |
| `SessionInitialStateNotification` | Same |
| `Notification` | Peeled as the client's three layers peel it: object-call flag and pickle, service-or-broadcast, then the broadcast's `(1, args)` |
| `PingReq` | Answered (A5) |
| `CallRsp`, `ErrorResponse`, `PingRsp` | Matched to the waiting call by the call ID in the destination address |
| `TransportClosed` | Closes the session |

## Cached answers (`objectCaching.py`, `cachedObject.py`)

Some calls answer with a `CachedMethodCallResult` instead of the answer. The caller of a remote
call in the client never sees that wrapper, and neither does a caller of `session.call`.

| # | The retail client | How known | Ours |
|---|---|---|---|
| C1 | Unwraps a `CachedMethodCallResult` before returning (`ret = ret.GetResult()`) | S | matches, V |
| C2 | Its result is either the answer as a marshal string, carried inline... | S | matches, V (`account.GetKeyMap`) |
| C3 | ...or a `util.CachedObject` reference, fetched with `objectCaching.GetCachableObject(shared, objectID, objectVersion, nodeID)` through the proxy node when shared | S, L | matches, V (`map.GetStationInfo`, `corporationSvc.GetAllCorpMedals`) |
| C4 | The fetched object's pickle is zlib when its `compressed` flag is set | S | matches, V |
| C5 | Keeps what it fetched; fetches again only when the checksum differs and its copy is older | S | matches, V (asked twice, fetched once) |

## Python 2.7 behaviour that reaches the wire

`src/gamePort/py27.js` reproduces, for 64-bit Windows, the string, int and long hashes and the dict
table of CPython 2.7. `test/fixtures/py27Oracle.json` holds what the client's own interpreter
answered for 1,303 keys and 44 dicts, built two ways each; the test requires an exact match.

It covers a dict built by a literal, by inserting into an empty dict, and by `copy()`.

**Keyword order (P6a).** A call's keywords pass through several dicts before they are sent, and two
keys that want the same slot can come out either way round depending on the route:

- A remote **service's** method is a plain function, so its keywords are collected in the order
  written. (`MachoServiceConnection.__getattr__` returns a closure.)
- A **bound object's** method is an object with `__call__`, so the interpreter collects them last
  first and then refills them. (`MachoObjectCallWrapper`.)
- Either way the dict is then copied and `machoVersion` added.

The oracle was asked 406 keyword sets by both routes. The two routes disagree in 78 of them, and
`keywordOrder` matches the interpreter in all of them. One thing the interpreter corrected: a
copied dict's table is four times its entry count, not the two that the CPython source suggests
from memory.

## Not done

**Startup call sequence (A6): per feature, decided 2026-10-08.** At login, at character select and
on entering a station the client makes roughly ninety calls as its services start. We do not replay
them wholesale. Each browser feature makes the calls its retail counterpart makes, with the same
arguments in the same order, when that feature is built on the game port. Many of the ninety serve
screens we will not have (paper dolls, login campaigns).

What this accepts: a server-side observer can tell our login from a retail one by which calls are
absent. The recorded real session
(`eve.js/_local/logs/direct-tcp-real-client-20260809-163920.stdout.log`) names the calls in order,
and the decompiled service that issues each one gives its arguments.

**Measured 2026-10-09** (`docs/game-port-login-calls.md`, from `scripts/login-calls-report.js`): that
session's client made 117 calls of 100 kinds between connecting and sitting docked with nothing
opened. A pilot chosen on the game port and left alone made 12 calls of 7 of those kinds, and none
the client did not make. Of the other 93 kinds, 24 are asked later by a feature in a form read
against the client's, 16 only by a route of the BFF's, and 53 by nothing of ours.
The report is made again as services are done; the standings' two were the first.

**The customs export's call shape.** `src/piCustomsExport.js` binds `invbroker` with the office ID
and calls `ImportExportWithPlanet` on that. The client goes through `invCache`: it binds the
broker for a location, asks it for the office's inventory, and calls that. eve.js accepts both.
Its commodity dict now goes out in the client's dict order, which is exact unless two type IDs
want the same slot (the client fills it from another dict whose own order is not reproduced).

**Asking with a cached version.** When the client already holds an answer, it sends that answer's
version as `machoVersion`, and the server can reply "still good" instead of the answer. We always
send 1, so the server always answers in full. (What comes back is handled; see below.)

## Reading the server's answers in the browser

`src/gamePort/bridgeJson.js` maps what the game port decodes to onto the JSON the web gateway
emits, which is what the browser's decoders were written against. How well that holds, read by
read, is [`game-port-parity-report.md`](game-port-parity-report.md); what is decided about the
differences is in the plan's Phase 2 section.

One thing to know when a call answers None for no reason: the server answers None when a handler
or its own marshaller throws. The only trace is a `[PKT] ERR` line in `eve.js/_local/logs/server*.log`.

## Still needs a recording of the real client

The `?` rows above. `scripts/record-game-port.js` is the tool: it sits between any client
and the server and writes every frame; its `describe` mode prints each frame's kind, addresses,
call and value types, which is exactly what the `?` rows need.

To record without touching the client or its launcher, start eve.js with `EVEJS_SERVER_PORT=26005`
(a stock setting) and run the recorder on 26000 forwarding to 26005.

This has not been done. The client must be started through the eve.js launcher, whose checks keep
it from reaching CCP's servers, and on 2026-10-07 its `start.ini` pointed at a server other than
this machine, so a local recorder would not have seen it.
