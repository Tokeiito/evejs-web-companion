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

**The skill handler's, 2026-10-09.** The client's two skill services and its notifications ask the
handler eight things when a character is chosen: `skillMgr2.GetMySkillHandler`, the bind of the
moniker that answers (which carries the first read), `GetSkills`, `GetBoosters`,
`GetSkillQueueAndFreePoints`, `GetAllSkills`, `CheckAndSendNotifications` and
`GetSkillHistory(10)`. The transport asks them in the order a real client asked this server
(`server.2026-10-06_15.log`), keeps what the services keep (`src/gamePort/pilotSkills.js`) and
keeps it right from the server's notices. A read of the handler the BFF asks for is answered from
what is kept where the client's service would answer from what it keeps, and asked for once where
it would ask once. With those the report is 17 kinds of the client's 100 at login, 18 by a feature,
15 by a route only, 50 by nothing of ours.

**The Skills window's sheet, 2026-10-09.** On the game port the page's sheet is made from what is
kept (`src/gamePort/skillSheet.js`), each figure the way the client's windows make it: a level's
points from the rank (`characterskills/util.py`), the skill in training from the queue's first
entry, its points from the entry kept plus the time since the queue began at the pilot's rate
(`skillQueueSvc.GetEstimatedSkillPointsTrained`), the rate from the character's attributes, the
total from every skill's points and the free points. The attributes are asked for when a skill is
first found in training, as the client's reckoning asks for them. The web gateway's own sheet, a
snapshot no retail client asks for, is read on the gateway alone. That reckoning needs the skill
list to hold the points a training skill had when the queue's first entry began: see the log's
entry "the Skills window from what is kept" for what this server answered there and what
Tranquility's recordings say.

**A queue saved, 2026-10-09.** On the game port the page's save is the client's queue panel's
(`skillQueuePanelNew.ApplySkillQueue`): the attributes read where they are not kept and the queue
is not empty (the trimming reckons each entry's time), then
`SaveNewQueue({position: (typeID, toLevel)}, activate=True)` on the skill handler, then the queue
asked for again (`GetSkillQueueAndFreePoints`, the panel's new transaction), after a refusal too
but for two. Tranquility's recording has the last two one after the other. The gateway transport
saves by name on `skillMgr` with a list, as before. The page's "Stop training" saves an empty
queue; the client's Pause is `AbortTraining` and keeps the queue.

**The agents' journal, 2026-10-09.** The client's journal service asks
`agentMgr.GetMyJournalDetails()` once and keeps the answer. `OnAgentMissionChange(state, agentID)`
marks the agent (with no agent, the journal is forgotten), and the next reading asks each marked
agent's own moniker for `GetMyJournalDetails()`, takes that agent's first mission out of what is
kept and puts the answer at the end of both lists. A Tranquility recording of a mission accepted
and quit has four such readings, all on the one object the agent's talk was on. The transport
does the same (`src/gamePort/pilotJournal.js`): the journal read when a character is chosen, the
agent asked at once after each notice, and one object for an agent whoever asks on it, the BFF's
handle or the journal's own reading (`agents.GetAgentMoniker`). On the game port the Journal
route answers from what is kept.

**The agents' table, 2026-10-09.** The client's agents service asks `agentMgr.GetAgents()` once,
as its character is chosen, and keeps the whole table for as long as it runs. On Tranquility the
answer is a cached object the client fetches and writes to disk; this server answers the table
itself, some eleven thousand rows, each time it is asked. Each pilot on the game port asks as it
is chosen, without the choosing waiting on it, and one copy is kept for all pilots, in the
gateway's form: what the last to ask was answered. A read of the table through the BFF is
answered from that copy. Measured: 88 to 95 ms a read of the Agents route before, 1 to 5 after.

**The corporation's registry at login, 2026-10-09.** As its character is chosen the client binds
`Moniker('corpRegistry', session.corpid)`, with no call, and three of its services ask what it
bound, each with nothing:

- `crimewatchSvc` asks `GetAggressionSettings()` and keeps the answer. It asks again when the
  session's corporation changes, and takes the server's `OnCorpAggressionSettingsChange(settings)`
  for what it keeps. A director's own change (`RegisterNewAggressionSettings(bool)`, the button in
  the corporation window) answers that window only: what `crimewatchSvc` keeps changes by the
  notice.
- the corporation service's members ask `GetEveOwners()`, which primes the client's names and is
  kept by nothing else. Again when the corporation changes.
- its applications ask `GetMyApplications()` once and keep the list, which the client then works
  over itself at each `OnCorporationApplicationChanged(corpID, applicantID, applicationID, row)`.

On the game port the transport asks the same three as a pilot is chosen and waits for them, 6 ms
on this machine, and asks the first two again when the pilot's corporation changes. They are asked
before the table of agents: sent right behind it, the first of them was answered 82 ms after it
reached the server, and 1 ms when sent before. The settings are kept as the client keeps them, and
a read of them through the BFF is answered from what is kept. The applications are not kept: a
read of them asks the server each time, because the BFF's pilot-training onboarding reads a
trainee's applications straight after an officer's change to them, on another connection, where a
kept list could be a notice behind.

**The address book at login, 2026-10-09.** As its character is chosen the client's address book
asks, side by side (`addressbookService.GetContacts`): `charMgr.GetContactList()` by name, for the
pilot's contacts and blocked owners; its corporation's contacts, `GetCorporateContacts()` on the
corporation's registry, unless the corporation is an NPC one; its alliance's, `GetAllianceContacts()`
on the alliance's own moniker, if it is in one; and `onlineStatus.GetInitialState()` by name
(the online status service's `Prime`), for who of its watched contacts is online. One Tranquility
login of a pilot in a player's corporation has the contact list, the corporation's and the online
state one after another in that order (calls 99, 100, 101); another has the online state asked
earlier (424) and then the contact list and the corporation's together (443, 444). In both they
come after the members' names and before the applications. The client keeps all of them and works
them over at the server's notices (`OnPersonalContactsUpdated`, `OnOrganizationContactsUpdated`,
`OnContactLoggedOn`, `OnContactLoggedOff` and others).

On the game port the transport asks the same, in that order, as a pilot is chosen, and waits for
them. It keeps none of them: no window of the page reads a contact yet, and a read of the routes
asks the server as before. `onlineStatus.Prime`, which a BFF route asks of the server, is the
client's own service's method and never a call of the client's.

**The alliance's registry, 2026-10-09.** No Tranquility recording has a pilot in an alliance, so
this is the decompiled client alone (`all_cso.py`, `eveMoniker.py`). The client's alliance service
keeps one moniker, `Moniker('allianceRegistry', (session.allianceid, 1))`, the 1 for "is master",
and binds it for its own sake when it makes it (`GetMoniker`: `Bind()`), as the corporation's
registry is bound. It makes it when something first wants it, which at login is the address book
asking `GetAllianceContacts()`, and makes and binds a new one at once when the session's alliance
changes. With no alliance it cannot make one (`eveMoniker.GetAlliance` raises) and asks nothing.
Everything of the session's own alliance is asked of the moniker. What is asked about any
alliance by its ID is asked of the service by name: `GetAlliancePublicInfo`, `GetRankedAlliances`,
`GetEmploymentRecord`, `GetAllianceMembers`, `GetDaysInAlliance`, `GetAllianceMembersOlderThan`,
and `GetAlliance(allianceID)` for an alliance that is not the session's (its own is
`GetMoniker().GetAlliance()`, with nothing).

On the game port the transport does the same. For a pilot in an alliance the address book's reads
at the choosing bind the moniker and ask its contacts, and what the BFF asks of the alliance's
registry goes to the moniker or by name as the client's would. For a pilot in none, what the BFF
asks all the same goes by name as before, and the ledger says it is the web's alone.

**The notifications, 2026-10-09.** The client's notification service (`notificationSvc.py`) keeps
three lists. All of a pilot's notifications are asked for as its character is chosen, by the
notification window (`notificationUI._NotificationProvider`): `notificationMgr.GetAllNotifications`
with the keyword `fromID`, which is the last notification the user cleared and nought in a
recorded Tranquility login. The unread ones (`GetUnprocessed()`) and those of a group
(`GetByGroupID(groupID)`) are asked for when first wanted. Each list is kept, and the client
works the server's `OnNotificationReceived`, `OnNotificationDeleted` and `OnNotificationUndeleted`
and its own marking and deleting into them itself.

On the game port the transport asks for all of them, from nought, as a pilot is chosen, and waits
for the answer. The three lists are kept as they were answered, and a read of one through the BFF
is answered from what is kept. One thing is not the client's: at any of the three notices, and
after any of the pilot's own six writes (`MarkAsProcessed`, `MarkGroupAsProcessed`,
`MarkAllAsProcessed`, `DeleteNotifications`, `DeleteGroupNotifications`, `DeleteAllNotifications`),
done or refused, all three lists are forgotten and asked for when next wanted, where the client
changes its lists in place. An answer on its way when they are forgotten is handed on and not
kept. All of them from a later notification is another list, asked each time.

**The calendar's months and the contracts' login figures, 2026-10-09.** The client's calendar
service keeps a month's events once it has asked for them (`calendarProxy.GetEventList(month,
year)`, at the proxy node), for the session. Its minute timer asks for this month and the next
soon after a character is chosen (`GetEventsNextXMonths`): a recorded Tranquility login has the
two as calls 186 and 187. It works the server's `OnNewCalendarEvent`, `OnEditCalendarEvent` and
`OnRemoveCalendarEvent` into the months it keeps, puts a personal event of its own making into
them itself (the server does not tell a pilot of its own), and forgets every month when the
session's corporation or alliance changes. Its contracts service asks
`contractProxy.GetLoginInfo()` once, when the notification window is ready, to raise its own
notices of contracts that want attention, and keeps nothing of it.

On the game port the transport asks for the contracts' figures, then the notifications, then the
two months by the server's clock, as a pilot is chosen. The months are kept, and a read of a kept
month through the BFF is answered from what is kept; another month is asked for when first
wanted and kept. As with the notifications, the months are forgotten rather than changed in
place: at any of the three notices, after any of the pilot's own makings, changings and deletings
of an event (seven writes on `calendarMgr`), done or refused, and in another corporation or
alliance. The contracts' figures are asked for and not kept: the page's Contracts window asks
for them again each time it opens, which is the page's own way.

The notifications' lists and the calendar's months are kept by one helper,
`src/gamePort/keptReads.js`: answers kept until something changes them.

**Training paused, 2026-10-09.** The client's queue panel pauses with one call,
`skillHandler.AbortTraining()`, made only while a skill is in training (`skillQueuePanelNew.py`
`PauseTraining`, `skillsvc.py` `AbortTrain`). The server stops the skill and says so with
`OnServerSkillsChanged`, its event `OnSkillQueuePausedServer`: the client then takes the start and
the end off every entry of the queue it keeps, and keeps the entries. It does not ask for the
queue again, so an entry's starting points stay what they were when the queue was last saved; the
skill's own row has the points it stopped at. Its start button saves the queue as it stands,
`SaveNewQueue(queue, activate=True)`. One Tranquility recording has the pause and the save after.

The page's "Stop training" used to save an empty queue, which threw the queue away. It now pauses
as the client does (the BFF's `/api/bridge/skills/abort-training`, then the sheet read again), a
paused queue is shown as paused with its skills still on it, and "Start training" saves the queue
as it stands. On the game port the pause goes to the skill handler's object and the kept queue is
stopped by the server's notice. Measured on this server: a pause with nothing in training is
answered and changes nothing. The gateway's sheet marks a paused queue's first skill as in
training; the game port's marks none.

**The names of owners, 2026-10-09.** The client names a character, a corporation, an alliance or a
faction from `cfg.eveowners`. NPCs' owners are in its own built data. For any other it asks the
server, `config.GetMultiOwnersEx(a list of IDs)` by name (`carbon/common/script/sys/cfg.py`,
`Recordset._Prime`), for every owner it does not have yet, in one call, and keeps each row it is
answered, `(ownerID, ownerName, typeID, gender, ownerNameID)`. An owner it gets no row for it does
not ask about again. The call is in 29 of the Tranquility recordings. This server answers a row
for every ID asked about, with type nought and the name "Item <ID>" for what is no owner.

The BFF's names route answered a player's corporation or alliance from its static tables, which
did not have Test Two's, so the Character Sheet read "Unknown corporation". On the game port the
route now asks the transport for a corporation, alliance or character that the static tables
cannot name and whose ID is a player owner's (90,000,000 and up), and the transport asks as the
client does and keeps the rows (`ownersNamed` in `pilots.js`). A row names an owner only as the
kind of thing its type says it is, and a row of type nought names nothing. With no pilot online
the route says it does not know, so that the page asks again. On the gateway nothing changed.
The call is the transport's own: no route of the BFF's can ask it by name.

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
