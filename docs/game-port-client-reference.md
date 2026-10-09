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

**What a container lists, 2026-10-09.** The client's inventory cache (`invCache.py`) asks a
container for a flag's items once: `invCacheContainer.List(flag)` sends `List(flag=flag)` only
for a flag it has not listed, and `ListByFlags` sends only the flags not yet listed. From then
on it goes by the server's `OnItemChange` and `OnItemsChanged`, working each changed item into
what it holds (`_ProcessItemChange`), and asks again for nothing. A whole mining mission
recorded on Tranquility has twelve `List` calls, one for each container and flag, and a
recording of one mining cycle has none.

On the game port the transport now keeps each listing as the server answered it, by the handle
it was asked on and what was asked, and forgets every listing when anything may have changed
one: at either notice, in another place or ship, and at any write of the pilot's own, done or
refused (`pilots.js`, `INVENTORY_LISTINGS`). What is forgotten is asked for when next wanted.
The gateway's listings are as they were.

What that changes is small, and was measured in the server's logs of two flights, one before
and one after:

| | Before | After |
|---|---|---|
| At a login, as the page's windows open | each of two containers listed two or three times at once | each listed once |
| After each of the server's notices of an item | two `List` and one `ListByFlags` | the same |
| With no notice | nothing but at a login, and twice at the pilot's own doing | nothing but at a login |

The page was not asking over and over, as the ledger's count had seemed to say: it reads the
holds again when the server says an item changed, and a mining laser's cycle is such a change.
The client asks nothing there. To match it the notices have to be worked into what is kept, as
its cache does, and that is not done.

**The object cache, for a service's method calls, 2026-10-09.** Where the server answers a
service's method with a `CachedMethodCallResult`, the client's object cache keeps the answer
(`objectCaching.py`). The result carries what the server says of the method's answers: a
`versionCheck`, and perhaps a `sessionInfo`. The first such word for a method holds for the run
(`CacheMethodCall`). The answer is kept by the service, the method, the session's value of
`sessionInfo` if there is one, and the arguments. A later call of the same finds it
(`PerformCachedMethodCall`) and asks `__ShouldVersionCheck`:

| `versionCheck` | The kept answer is used without asking |
|---|---|
| `never` | always |
| `run` (and no word) | for the rest of the run |
| a time (`5 minutes`, `1 hour`, ...: `__versionchecktimes__`), or a number of 100 ns | until it is that old, by its own stamp |
| `utcmidnight`, `utcmidnight_or_3hours` | until it is as old as is left to the first UTC midnight after the run began, or three hours if that is less |
| `always`, or None | never |

The client's log says "returning a cached result" where the cache answered outright, and
"returning a cached result that requires version checking" where it held an answer that was due
a check with the server. Across the Tranquility recordings the cache answered outright 978
times: `agentMgr.GetMessagesForEpicArcMissions` 800,
`fwWarzoneSolarsystem.GetAllWarzonesOccupationStates` 53, `beyonce.GetFormations` 43,
`shipKillCounter.GetItemKillCountPlayer` 34, `structureDirectory.GetStructureMapData` 17, and
nine more. (This paragraph first gave 61, 55 and 42 for three of these. That counted both kinds
of line as one. The checks are counted in the paragraph after this one.)
The server tells the client when an answer has changed by calling
`objectCaching.InvalidateCachedMethodCall(service, method, *args)` or
`InvalidateCachedMethodCalls` on it.

The game-port session opened such an answer and kept nothing of it: every call was sent. It now
keeps and answers as above (`session.js` `cachedMethodCall`), for a call by a service's name or
to the proxy's node, and forgets what the server names in either of its two calls. This server
marks some three dozen methods as cached. Read twice in one session, a docked pilot's routes cost
29 calls the second time before and 26 after: `account.GetEntryTypes`,
`marketProxy.GetCharOrders` and `marketProxy.GetMarketOrderHistory` were answered by the cache.

Not as the client does it:

- A bound object's cached answers are not kept.
- Some of what the client's own code names is not named here. The paragraph after the next has
  which.

(This list had the server naming several calls by a part of their arguments. The client's
object cache has a function for that, `__ListPartialMatch`, and nothing in the client calls it.)

**The object cache's check with the server, 2026-10-09.** When an answer held is due a check,
the client sends the call all the same, with the version it holds where every other call
carries a `1`: `machoVersion=[when, checksum]`, a list (`ServiceCallGPCS.py`
`RemoteServiceCallWithoutTheStars`). The server answers with a new `CachedMethodCallResult`,
which is kept in place of the old one, or with the exception `objectCaching.CacheOK`. Then the
copy held is the answer, and it is good from that moment (`UpdateVersionCheckPeriod`).

The version is `CachedMethodCallResult.GetVersion()`. An answer held inline has a version of
its own. An answer that is a reference to a cached object has none (`version=None`), and its
version is the object's.

Across the Tranquility recordings the client made 64 such checks and the server answered 61 of
them `CacheOK`:

| Service | Checks | Answered `CacheOK` |
|---|---|---|
| `shipKillCounter` | 27 | 25 |
| `structureDirectory` | 25 | 24 |
| `standingMgr` | 7 | 7 |
| `fwWarzoneSolarsystem` | 2 | 2 |
| `agentMgr` | 2 | 2 |
| `map` | 1 | 1 |

Tranquility answers so for a reference too. `fwWarzoneSolarsystem.GetAllWarzonesOccupationStates`
came first as a reference with no version of its own, good for a minute; its object's checksum
was 42023. The check went out with the object's stamp and 42023, and `CacheOK` came back. The
standings come with a version check of three words, the client's own first
(`('always', None, None)`), and are checked at every asking.

The game-port session now makes the check (`session.js` `_serviceCall`), and keeps no answer
it has no version for. Seen live, on a session whose clock the script moves:

| Call | Good for | Inside that time | Past it |
|---|---|---|---|
| `standingMgr.GetStandingCompositions`, held inline | 5 minutes | at 4 minutes, nothing sent | at 6, sent with the version; `CacheOK`; nothing sent after |
| `corporationSvc.GetAllCorpMedals`, a reference | 1 hour | at 59 minutes, nothing sent | at 61, sent with the object's version; `CacheOK`; nothing sent after |

The second row is so since a fix to EveJS (`eve.js` `342a366a6`). Before it the server
answered that check with a whole new answer of the same checksum: it compared against the
result's own version, and a reference has none.

The first build here made the same mistake from the other side. It read the result's own
version, and for a reference sent `[0, None]` at the very next asking. Every test passed, each
on an answer I had made up with a version of its own. Recording the frames again from the real
server showed it, and there is now a test on the server's own recorded bytes.

**What the client's own code names, 2026-10-09.** Some cached answers are good for the whole
run: this server answers a pilot's own market orders so (`versionCheck: run`, kept by
`charid`). What makes the client ask again is a name: the server calling
`InvalidateCachedMethodCall` on it, or the client's own code calling the same on its own cache.
The client's code does so at 62 places. They are of three kinds.

On a notice from the server:

| Notice | Calls named | Client |
|---|---|---|
| `OnOwnOrdersChanged(orders, reason, isCorp)` | `marketProxy`: `GetCharOrders`; for each order `GetOrders(typeID)` and `GetPlexOrders`; `GetSystemAsks`, `GetStationAsks`, `GetMarketOrderHistory`, `GetPlexBest` | `marketsvc.py` 113 |
| `OnCorporationMedalAdded` | `corporationSvc.GetAllCorpMedals(corpid)`, `GetRecipientsOfMedal(medalID)` | `medals.py` 120 |
| `OnMedalIssued`, `OnMedalStatusChanged` | `corporationSvc.GetMedalsReceived(charid)` | `medals.py` 131, 139 |
| `OnAssetSafetyCreated(ownerID, system, locationID)`, the corporation's | `corpmgr.GetAssetInventoryForLocation(corpid, locationID, 'offices')`, `structureAssetSafety.GetItemsInSafetyForCorp` | `assetSafetySvc.py` 58 |
| `OnAssetSafetyDelivered(ownerID)` | `structureAssetSafety.GetItemsInSafetyForCorp`, or for the pilot's own `GetItemsInSafetyForCharacter` | `assetSafetySvc.py` 65 |
| `OnStationInformationUpdated(stationID)` | `stationSvc.GetStation(stationID)` | `station/base.py` 589 |
| `OnKillNotification` | `charMgr.GetRecentShipKillsAndLosses(25, None)` | `charactersheet.py` 90 |
| `OnKillRightCreated`, `OnKillRightUsed`, `OnKillRightForYouSold` | `bountyProxy.GetMyKillRights` | `bountySvc.py` 154, 158, 171 |
| `OnEditCalendarEvent`, where the event's time changed | `calendarMgr.GetResponsesToEvent(eventID, ownerID)` | `eveCalendarsvc.py` 352 |
| `OnEventResponseByExternal(eventID, event, response)` | `calendarMgr.GetResponsesToEvent(eventID, the event's owner)` | `eveCalendarsvc.py` 409 |
| `OnNPCStandingChange` | `facWarMgr.GetMyCharacterRankInfo`, `GetMyCharacterRankOverview` | `facWarSvc.py` 308 |
| `OnCommunityFittingsUpdated` | `corpFittingMgr.GetCommunityFittings` | `fittingSvc.py` 1269 |
| `OnBrowserLockdownChange`, `OnFlaggedListsChange` | `browserLockdownSvc`'s three | `sites.py` 335, 442 |

On a change to the session: another corporation names
`corporationSvc.GetEmploymentRecord(charid)` (`base_corporation_ui.py` 98); in or out of a
militia names the two ranks above, `facWarMgr.GetCorpFactionalWarStatus` and the employment
record (`facWarSvc.py` 57, 199).

Beside one of its own calls, once the call is done:

| Call | Calls named | Client |
|---|---|---|
| `bountyProxy.AddToBounty(ownerID, amount)` | `charMgr.GetPublicInfo3(ownerID)` | `bountyWindow.py` 447, 1007 |
| `bountyProxy.SellKillRight`, `CancelSellKillRight` | `bountyProxy.GetMyKillRights` | `bountySvc.py` 255, 262 |
| `calendarMgr.SendEventResponse(eventID, ownerID, response)` | `calendarMgr.GetResponsesToEvent(eventID, ownerID)` | `eveCalendarsvc.py` 296 |
| `calendarMgr.UpdateEventParticipants(eventID, ...)` | `calendarMgr.GetResponsesToEvent(eventID, charid)` | `eveCalendarsvc.py` 196 |
| `structureAssetSafety.MoveSafetyWrapToStructure` | `GetStructuresICanDeliverTo`, `GetItemsInSafetyForCharacter`, `GetItemsInSafetyForCorp` | `assetSafetyDeliverWindow.py` 147 |

The transport forgot every cached answer at each of the pilot's own writes. It now names what
the tables name, when they name it (`cachedCallsNamed.js`), and a write names nothing else.
A row is a no-op where nothing is kept under the name, which on this server is most rows: of
the thirty or so methods it marks as cached, the rows reach the market's, the corporation's
medals, a station, and the corporation's assets and asset safety.

Seen live on the game port, as Test Pilot at Jita, with the server's log counted between steps
(the market's three cached calls: the type's book, the pilot's orders, the order history):

| Step | Before | After |
|---|---|---|
| The market read twice | all three sent, then none | the same |
| A buy order placed; the route reads the pilot's orders at once | sent, and the order is in it | the same: the notice had named it |
| The market read again | the book and the history sent | the same, each named by the notice |
| A write the client names nothing beside (`/giveitem`), and the market read again | all three sent | none sent |
| The order taken down | refused: see below | done; the pilot's orders sent, and the order gone from them |

Not named here, each for its reason:

- **Calls the BFF cannot make**: the mailing lists' members, joining and leaving a militia, a
  character's looks, an office let go and impounded items trashed, the access groups', the
  development indices'. A row for a call nothing makes would be dead.
- **Names that need an item's owner, flag and station**: items delivered to a corporation's
  hangar or to a member, a stack split and items trashed at another station
  (`invItemFunctions.py` 287).
- **Names given on a refusal**: a kill right that was not there, a donation whose tax changed.
- **Names that hang on what a window holds**, and the two a GM has.

**An order taken down or repriced, 2026-10-09.** The client has an order's ID off the order's
own row, a number: `CancelCharOrder(orderID, regionID)` and
`ModifyCharOrder(order.orderID, newPrice, order.bid, order.stationID, order.solarSystemID,
order.price, order.range, order.volRemaining, order.issueDate)` (`marketsvc.py` 281, 285). The
BFF's routes have the ID as the text the page sent. On the wire that was a string, this server
read it as order 0, and no order could be taken down on the game port. The registry now sends
the number.

The client has both calls' other arguments off the same row: the order is one of the pilot's
own orders, `GetCharOrders`, which its object cache keeps (`quote.py` 302 passes
`order.orderID, order.regionID`). The BFF's routes have no row, and sent nought for the region, a
bool for the side, where the pilot is for the station, and nought for the date of issue. The
server reads only the order and the new price, so both worked and neither was the client's
call. The transport now reads the row out of the pilot's orders the session keeps
(`pilots.js` `ownOrderOf`) and sends what the client sends, each value as it came off the wire.
Where the session keeps no orders it asks for them first, as the client has them before it
touches one. An order in no such list goes out as it came.

Made first as the client makes them, on a session of a script's own, to see the server take
them. The order's row off the wire, and the nine sent:

| Column | Off the wire | Sent to reprice |
|---|---|---|
| `orderID` | a long | first |
| the new price | | second |
| `bid` | 1 | third |
| `stationID`, `solarSystemID` | numbers | fourth, fifth |
| `price` | 0.01 | sixth |
| `range` | -1 | seventh |
| `volRemaining` | 1 | eighth |
| `issueDate` | a long | ninth |

The server answered None to each, the order's price was the new one, and its two notices said
"Modified" and "Cancelled".

Three more of the market's calls are in the registry. A type's book, `GetOrders(typeID)`, is
the client's as it stands. Its price history was not: the client asks two halves,
`GetOldPriceHistory` and `GetNewPriceHistory`, and the BFF's route asked the new one alone
(both since the paragraph below). A buy order was not: the client's ninth argument is the
broker's fee its window showed (`buyThisTypeWindow.py` 701), and the route sent none (worked
out since the fee's paragraph).

**A type's price history, 2026-10-09.** `marketsvc.GetPriceHistory` (333) asks
`GetOldPriceHistory(typeID)` and `GetNewPriceHistory(typeID)` and joins them with
`GetHistoryRowList` (344):

1. The old half's days, in order. Where the day after the last one taken is not the next
   day of the half, a row is put in for each day between, at the average of the day before,
   with 2 for the quantity and 2 for the orders.
2. The same from the last day of the old half up to yesterday's midnight.
3. The new half as it came; or, where it is empty, one row for now at the last average with
   nothing traded.

It counts from now, not from the first day, so nothing is filled in before the old half
begins. And the new half goes last whatever its days are. This server puts every day but the
last in the old half and the last alone in the new, and its history for Tritanium ends on 8
September: the client's join of that is the old half, a month of days filled in, and then the
new half's one day, out of order.

The BFF's Market read asks both halves and hands both on, and the page joins them so
(`market.ts` `joinPriceHistory`). A history's day is named by the game's calendar, which is
UTC.

**A sale, 2026-10-09.** `PlaceMultiSellOrder(itemList, useCorp, duration, expectedBrokersFee)`
(`marketsvc.py` 276, called at `sellMulti.py` 462). The list's items are each a `util.KeyVal`
the sale window makes with eight keywords (`sellMulti.py` 501):

| Keyword | What it is |
|---|---|
| `stationID`, `typeID` | whole numbers |
| `itemID` | the stack's |
| `price` | rounded to the hundredth |
| `quantity` | a whole number |
| `officeID` | None, or the office for an item in a corporation's hangar |
| `delta` | how far the price is from the type's average, as a fraction of it |
| `rawBrokerFeePercentage` | the broker's fee rate the window worked out for the station |

The fourth argument is that same fee rate for an order that stands, and None for a sale at
once.

The BFF's route gave an item as a plain object. The wire has no such value, and nothing could
be sold on the game port. The registry now makes each item the client's KeyVal. A route has no
`delta` and no fee rate. Both are worked out now, as the two paragraphs after this have it,
and the item goes out with all eight.

**A sale item's delta, 2026-10-09.** Each entry of the client's sale window asks the market
for its type's average price when it is made (`buySellItemContainerBase.py` 28), and the item
carries `(price - averagePrice) / averagePrice` (57). `marketsvc.GetAveragePrice(typeID)`
(368) is:

1. The type's price history, its two halves asked and joined (the paragraph on the history).
2. Of the rows no older than seven days: the sum of average times quantity, over the sum of
   quantity. The days the join filled in count, each with its 2.
3. With nothing traded in the week: the type's base price over its portion size, or 1.0 where
   that is nothing.
4. Rounded to the hundredth.

`priceHistory.js` has the join, the average and the delta, held to the client's own Python
over ten histories. On the game port a sale asks for the two halves for each item that has no
delta, in the client's order and before the sale, and the registry works the delta out. This
server's history for Tritanium ends a month ago, so its week is seven filled-in days at
100.00 and the average is 100.00.

**The broker's fee rate, 2026-10-09.** The client names it with an order: a buy order's ninth
argument (`buyThisTypeWindow.py` 701), a sale's fourth for an order that stands
(`sellMulti.py` 444) and each sale item's `rawBrokerFeePercentage`. The server works the rate
out for itself and refuses an order whose named rate is not its own
(`MktBrokersFeeUnexpected2`, which says the server's rate). For an NPC station
(`marketsvc.py` 161 `GetBrokersFeeCommissionFromStationID`):

| Step | Client |
|---|---|
| The base, 3 percent, less 0.3 of a percent for each level of Broker Relations in effect | `skilllimits.py` 25 |
| A tenth off for each level a warzone system is upgraded to | `facwarCommon.py` 200 |
| Less 0.0003 for each point of standing the owner's faction has to the pilot, and 0.0002 for each point the owner has | `brokerFee.py` 67 |

The level in effect is the larger of the level trained and the level lent
(`CharacterSkillEntry.effectiveSkillLevel`). A standing is the one the client's standing
service keeps of that NPC to the character, or nought (`standingsvc.py` 154). An owner that
is no NPC has none that counts (`marketsvc.py` 745). The buy window names the station's rate
whatever the order's length; the sale names it for an order that stands, and None for a sale
at once.

`brokerFee.js` has the sums in the client's order, and is held to the client's own Python to
the last digit. The transport works the rate out from the skills and standings it keeps and
the station's owner from the game's static data (`pilots.js` `brokersFeeAt`), and the registry
names it. Asked first, this server refused a buy order naming 0.5 and said its own rate was
2.96 percent; the rate worked out for that pilot and station is 0.0295803, and orders naming
it are taken.

Not done: a structure, whose base the client asks of the server
(`structureSettings.CharacterGetService`) and where no skill applies; and the upgrade level
of a warzone system, which the client asks of the war's manager. This server lowers its own
rate for neither.

The page shows the fee at that rate. The BFF's Market read says the rate for the station the
pilot is docked at (`brokersFeeRate`: a number on the game port, none through the gateway), and
the order form works the fee out as `BrokerFeeProvider.GetBrokerFeeInfo` does for a new order:
the order's value at the rate, and the smallest fee there is where that comes to no more. An
offer to buy 1000 Tritanium at 50 ISK showed 1,479.02 ISK, and the server charged 51,479.02:
the 50,000.00 set aside and that fee.

**A saved fitting applied, 2026-10-09.** `fittingSvc.LoadFitting` (554):

```
shipInv = invCache.GetInventoryFromId(activeShip)
shipInv.FitFitting(activeShip, shipTypeID, itemsToFit, session.stationid or session.structureid,
                   fittingObjKeyVal, cargoItemsByType, fitRigs)
```

| Argument | What it is |
|---|---|
| `shipTypeID` | the type of the ship's own item |
| `itemsToFit` | a `defaultdict(set)`: for each type the fitting wants, the hangar's items of it to take from |
| `fittingObjKeyVal` | `KeyVal(chargesByType, dronesByType, fightersByTypeID, iceByType, modulesByFlag, implantsByTypeID)`, six dicts (`shipfitting/fitting.py` 119) |
| `cargoItemsByType` | a dict: the rigs to put in the cargo where they are not to be fitted |

The call is made on the ship's own inventory, which the inventory cache asks the location's
manager for once and keeps (`invCache.py` 533).

How a `defaultdict` and a `set` go to the wire is in no recording. The client's own Python
reduces a `defaultdict` to a call of `collections.defaultdict` with `set`, its items after,
and a `set` to a call of `set` with a list. This server sends a set in that form and reads
that form of both. So here: an object made by `collections.defaultdict` whose dict part is
the types, each to an object made by `__builtin__.set` with a list of the items. The KeyVal's
fields go in the order `fightersByTypeID, dronesByType, modulesByFlag, iceByType, chargesByType,
implantsByTypeID`, which is the client's Python's for those six.

The BFF's route gave plain objects for the three, which the wire has no form for, and made
the call on the manager. No saved fitting could be applied on the game port. The registry
makes the three, the ship's type is godma's, and the transport makes the call on the ship's
inventory.

**A colony's commodities launched and moved, 2026-10-09.** Both on the planet's own object
(`clientPlanet.py` 412 and 448):

| Call | Arguments |
|---|---|
| `UserLaunchCommodities(commandPinID, commoditiesToLaunch)` | the command center's pin; a dict of the quantities to launch by type |
| `UserTransferCommodities(path, commodities)` | a list of pins, from the one the commodities leave to the one they reach; a dict of the quantities to move by type |

No recording has either on the wire: one note in the recordings' archive names the second, to
say the walk it describes did not use it. Both are from the client's source. The dicts are in
the order the client's Python keeps the types, which is not the order of their numbers (for
2073, 2268 and 9848 it is 9848, 2073, 2268).

The BFF's routes gave the commodities as a plain object, which the wire has no form for.
Nothing could be launched from a colony, or moved in one, on the game port. The registry makes
the dict, and the path a list. This server answers a move with two times (the colony's, and
when the pin the commodities left may send again: five minutes on) and a launch with one (when
it was made); it refuses a second launch inside a minute.

**A pilot's colonies and launches, 2026-10-09.** Both asked of the planet manager by name, with
nothing, and both recorded on Tranquility so:

| Call | Where the client makes it | What it keeps |
|---|---|---|
| `planetMgr.GetPlanetsForChar()` | `planetSvc.py` 67 | asked once; the client changes its own copy as a colony's pins change |
| `planetMgr.GetMyLaunchesDetails()` | `planetUISvc.py` 172 | asked once; asked again after `OnPILaunchesChange`, or when its window reloads |

The launches come as a `CRowset` whose row descriptor Tranquility sent as `launchID` int32,
`solarSystemID` int32, `itemID` int64, `ownerID` int32, `planetID` int32, `status` uint8,
`launchTime` a file time, and `x`, `y`, `z` doubles. The recordings have empty lists only, so no
launch's own numbers are known: the column's kind says a launch's ID fits 32 bits.

This server counted launches up from 910,000,000,000, which does not fit, and could not put a
list with a launch in it on the wire: the client was answered nothing. It counts from
910,000,000 since eve.js `c30983877` (2026-10-09), and gives a stored launch a new ID when it
reads the store.

What the client's journal does with a launch in its list (`journal.py` 436 to 465). No recording
has any of the three:

| The pilot's choice | The call |
|---|---|
| Warp to it, when it is further than the least a warp goes | `CmdWarpToStuff('launch', launchID)` on the ballpark's object: the launch's ID, not its container's, and no range |
| Approach it, when it is nearer | `CmdFollowBall(itemID, 50)`: the container's item, at 50 m |
| Remove it from the list | `planetMgr.DeleteLaunch(launchID)` by name, then the launches asked for afresh |

The page's haul warps to a launch the first way, through a route of its own
(`/api/bridge/flight/warp-launch`). The page's block was written to warp to the container as an
item, counting on this server to find an item anywhere in the system by its ID. That was never
seen to work or fail here: the list came back empty first. The client's journal names the
launch, so the page does now.

**The order of a KeyVal's fields on the wire.** `utillib.KeyVal(a=1, b=2)` keeps its keywords
as the instance's own dict, so its fields go out in that dict's order. That is not the order
written, and not the order a plain function's keywords are in. A class is not a plain
function: the interpreter collects the keywords off its stack, last one first, and the
class's `__init__` is given them from that dict (`py27.js` `constructorKeywordOrder`). The
client's own Python, asked for the sale's eight:

| Made by | Order |
|---|---|
| Written | `stationID, typeID, itemID, price, quantity, officeID, delta, rawBrokerFeePercentage` |
| A plain function's keywords | `itemID, typeID, rawBrokerFeePercentage, price, delta, stationID, officeID, quantity` |
| The KeyVal | `itemID, typeID, rawBrokerFeePercentage, price, officeID, stationID, delta, quantity` |
| The KeyVal of the six a route has | `itemID, typeID, price, stationID, officeID, quantity` |

The fixture of the client's Python has this for each of its 409 keyword sets
(`constructed`), and the model agrees with every one. The other KeyVals the registry makes (a
scanner's probes) have their fields in the order the registry lists them. Those are KeyVals the
server sent and the client changed, so their order is the one they came in, and that has not
been looked at.

**The formations, asked for once, 2026-10-09.** `michelle.AddBallpark` asks
`sm.RemoteSvc('beyonce').GetFormations()` each time it makes a ballpark (`michelle.py` 324). The
answer is a cached method call's, and the client's object cache answers every asking after the
first: a Tranquility recording of a flight through several systems has "ObjectCaching beyonce ::
GetFormations ( () ) returning a cached result" at each ballpark it adds. So the server is asked
once.

On the game port each ballpark asked the server for itself, and the BFF's own route asked again
each time the page wanted them: nine askings for four ballparks in one hour of this server's
log. Now the first asking is sent, counted in the ledger as the client's own, and kept for the
pilot; a ballpark made later, and the BFF's route, are answered from it. An asking that fails is
not kept. The gateway's route is as it was.

This is one cached method call kept by hand. The client's object cache does the same for every
call the server marks as cached, and the transport has no such cache of its own.

**An attribute's value, 2026-10-09.** The client never asks the server for an attribute's
value: its own dogma location answers (`baseDogmaLocation.GetAttributeValue`), from what
`GetAllInfo` brought and each change the server has told of since. The BFF asked the server
(`dogmaIM.QueryAttributeValue(itemID, 73)`) for a module's cycle each time a module that was
still running out its cycle was switched off: one call the client never makes, each time.

On the game port the transport now answers from what godma holds of the item
(`pilots.js` `attributeHeld`), priming godma first as the client's is primed, and asks the
server only for an item, or an attribute of one, that godma holds nothing of. What godma holds
is the server's own figure: for a fitted Venture and its three modules, all 195 attributes
`GetAllInfo` gave were what the server answered for the same items when asked attribute by
attribute, the afterburner's cycle of 8,500 ms among them.

**A whole stack moved, 2026-10-09.** The client adds an item to a container with
`Add(itemID, sourceLocationID, qty=quantity, flag=self.locationFlag)` (`invControllers.py` 213),
and the quantity is the stack's size when the whole stack moves (`_AddItem`: `quantity =
item.stacksize`, from the item its inventory cache holds). Of 22 `Add` calls read from the
recordings (the first three in each file that has any), 21 carry one, 3,822 for a hold of ore
among them; one carries `qty=None`, from a path not found. The BFF's three routes that move
one item (a move between places, cargo to and from the hangar, and the ore hold unloaded) send
no quantity for a whole stack.

On the game port the transport now fills it in, from the item's row in a listing the pilot
holds (the listings kept since the entry above): the row's stack size, or its quantity, and 1
for a thing that is one of a kind, whose quantity is below nothing. A quantity the caller gave
is the caller's. An item in no listing held goes as it came, and the ledger marks the call.
The route for a move between places lists the source before it moves, so the row is there; that
one was seen live. The other two go by what the page listed to show the item, if nothing has
been said to change since.

**A follow, an orbit, and the throttle, 2026-10-09.** The client's menu sends an approach as
`bp.CmdFollowBall(targetID, const.approachRange)`, keep at range as `bp.CmdFollowBall(targetID,
range)` and an orbit as `bp.CmdOrbit(targetID, range)` (`movementFunctions.py` 302, 229, 260),
each alone. Only its autopilot opens the throttle first: `park.CmdSetSpeedFraction(1.0)`, then
`park.CmdFollowBall(destinationID, 0.0)` (`autopilot.py` 434). The Tranquility recordings have
all four so: a mission's flight with a dozen follows and orbits and no speed call beside any, and
an autopilot's flight with the speed call before each follow of a gate. On this server a stopped
ship told to follow or orbit moves off without it: seen live for each, the ship's own ballpark
reading FOLLOW or ORBIT with its speed fraction at 1 again. (CCP's ballpark library sets a
stopped ball's fraction to 1 only for a go-to-point; for a follow it would be their server's own
code, which is not on this machine.)

The BFF's three routes sent the speed call before every one. On the game port they now send it
only before an approach with no range, which is the autopilot's and is what the page's own
autopilot asks for. Through the gateway they are as they were. `CmdOrbit` and `CmdStop()`
(`eveCommands.py` 1104) were read against the client in the same walk and are the client's as
the BFF sends them.

The client's menu sends nothing when the ship is already flying the order
(`_IsAlreadyFollowingBallAtRange`, `movementFunctions.py` 192): its own ball, in its own
ballpark, is in that mode, after that ball, at that range. The two recordings read for it agree:
the same follow goes out three times within one second, and not again while the ship is flying
it. On the game port the three routes now ask the pilot's transport, which
has the ship's own ballpark, and hold such an order back (`pilots.js` `alreadyFollowing`); the
route's answer then says `alreadySo`. The autopilot's approach is always sent, as the client's
autopilot does not look. Through the gateway every order is sent, as before.

One thing is held to more than the client holds it: the pilot's last order must have been this
one, or none. The client goes by its ballpark alone, which has not yet heard of a stop sent a
moment before. By its source it would hold back an approach sent straight behind a stop, and
the ship would be left stopped; that has not been seen in a recording. Here such an approach is
sent.

**What the ship has locked, and a module's target, 2026-10-09.** The client's target service
(`targetMgr.py`) asks the server for neither list while it flies. On undocking, or on logging in
in space, godma asks the dogma location once for each (`RefreshTargets`, godma.py 2360):
`GetTargets()` and `GetTargeters()`, after its own prime. A Tranquility recording of an undock has
exactly that: the bind of the dogma location carrying `GetAllInfo`, then the two calls on the
object, once each. From then on it goes by the server's `OnTarget(what, targetID, reason)`
('add', 'lost', 'clear', and 'otheradd' and 'otherlost' for what has the ship locked) and
`OnTargets`, a list of the same. It adds a target itself when `AddTarget` answers that the lock
is made already, and drops one whose ball leaves the ballpark. Docked, or with its ballpark let
go, it has none.

The page reads the locked targets about once a second, and on the game port each reading was a
`GetTargets` to the server: 395 of them in one short flight. The transport now keeps both lists
as the client does (`src/gamePort/pilotTargets.js`) and answers the BFF's readings from them. A
list that is not known is asked for, so a reading never answers from a guess. The gateway's
reading is as it was.

The client's module button gives an effect a target only when the effect is aimed at one
(`effectCategory` 2, shipmodulebutton.py 1318); an afterburner's goes out with None. The page
sends whatever is locked with every module it switches on, and the transport sent that on. It now
sends a target for a target effect alone.

Read against the client in the same walk, and the BFF's as the client's: `CmdFollowBall(targetID,
range)` (the menu's approach, `movementFunctions.py` 302; recorded as `(itemID, 50)`),
`CmdSetSpeedFraction(1.0)` (the autopilot's, before its approach), `Board(shipID, session.shipid
or session.stationid)` on the ship's moniker (recorded in space with the bind carrying it), and
`slash.SlashCmd(command)` by name. One thing was not the client's, and is repaired above: the
BFF's routes for the menu's approach, keep at range and orbit sent `CmdSetSpeedFraction(1.0)`
first, as the autopilot does, and the client's menu sends none.

**The flight's calls and the scanner's sites, 2026-10-09.** Read against the client after a walk
in space on the game port found them unread. The menu's warp is `bp.CmdWarpToStuff('item', itemID,
minRange=...)` on the ballpark's object (`michelle.py`, from `movementFunctions.py`); the
autopilot's is `CmdWarpToStuffAutopilot(destinationID)` (`autopilot.py`); docking is
`CmdDock(itemID, session.shipid)`, sent through `sessionMgr.PerformSessionChange('dock', ...)`.
The Tranquility recordings have each in that form (30, 3 and 24 files). `michelle` asks
`beyonce.GetFormations()` by name once, as it makes its park. The BFF sent all four as the client
does.

The sensor suite asks for the sites it can see with `scanSvc.GetScanMan().GetFullState()`: on the
system's scan manager, which is the object `scanMgr.GetSystemScanMgr()` answers, and so it is
recorded on Tranquility. The BFF's scanner route asked `scanMgr.GetFullState` by the service's
name. On the game port it now asks the scan manager's object, bound once for the pilot's system,
as the scanner's other calls already did. The gateway's route is as it was. Asked by name on the
game port (one route with no window behind it still does), the ledger says the call differs.

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

**At a customs office, 2026-10-09.** What the client's window sends (`importExportUI.py` 383 and
549), as Tranquility's recording of an export has it on the wire:

| Step | The call | Recorded |
|---|---|---|
| The office's inventory | `GetInventoryFromId(officeID, 0)` on the inventory manager for where the pilot is | on the manager's bound object, both positional |
| What it holds | `List(flag=4)`, `GetSelfInvItem()`, `List(flag=None)`, `List(flag=0)` on the office's inventory | in that order, before the transfer |
| Its tax rate | `eveMoniker.GetPlanetOrbitalRegistry(session.solarsystemid).GetTaxRate(officeID)` | `MachoResolveObject(systemID)`, then `MachoBindObject(systemID, ('GetTaxRate', (officeID,), {}))`: a Moniker made for the call, three times in one export |
| The transfer | `ImportExportWithPlanet(spaceportPinID, importData, exportData, taxRate)` on the office's inventory | `(pinID, {}, {2398: 100.0}, 0.20000000149011612)`, all positional |

What comes down is a dict of quantities by the item in the office, what goes up a dict of
quantities by type, and the rate is the one the registry answered. Tranquility's quantity is a
float because its colony's pins hold floats. This server's pins hold whole numbers, so a client
of it sends whole numbers. A note beside that recording reads the second argument of
`GetInventoryFromId` as 8: the byte is ``, which is the marshal's code for the integer
nought.

The BFF has a route that makes the rate's call and the transfer on the pilot's own session
(`/api/bridge/planet/customs/export`), in space only, as the window is. The game port carries
the transfer and the web gateway's list has not got it, so the transport has a short list of
its own beside the gateway's (`GAME_PORT_ONLY_CALLS`). Through the gateway the route is
refused.

The page's haul uses that route for a pilot on the game port: its collecting block sends a
colony's launchpads up when the ship is at that planet's office, one launchpad at a time, and
then empties the office. Which planet an office is, the client reads off the office's slim
item (`customsOfficeItem.planetID`, `importExportUI.py` 94), and so does the page: the game
port's snapshot passes it on for an orbital. The web gateway's snapshot does not say it.

Not the client's yet:

- For a pilot on the gateway the launchpads are still sent up before the bot starts, docked,
  through `src/piCustomsExport.js`, which logs a second game-port client in for it, asks the
  rate by the service's name, and binds `invbroker` with the office's ID. This server takes
  both.
- The page reads an office as it reads any container, with one `List`, not the window's four
  reads. And the collecting block reads every office in the system on every tick, from
  wherever the ship is. A client opens the office it is at.

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
