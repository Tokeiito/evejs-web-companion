# Game-port loop log

The journal of the unattended loop described in
[`goal-prompts/game-port-loop.md`](goal-prompts/game-port-loop.md). Newest entry last. Each entry
says what was done, how it was proved, what was committed, and what is next.

## For the operator

Decisions taken in your place, and anything waiting on you. Overrule any of these by saying so.

- **Pushing.** You started the loop with "commit as you go and push". I push `evejs-web-poc` after
  each commit. I do **not** push `eve.js`: your instruction there was to commit the fix, and its
  `main` is what others pull.
- **The two server fixes are on `origin/main` of eve.js all the same, and I did not put them
  there.** Its reflog records a push of `main` at 2026-10-08 01:09:26 local, fourteen minutes
  after the second fix was committed. None of my commands pushed in that repository (mine at that
  minute were test runs in this one), neither sub-agent pushed (both had finished, and both were
  told not to), and it has no git hooks. The same reflog shows earlier commits there followed by a
  push some minutes later, and other sessions on this machine share that checkout, so I take it
  to be one of them pushing `main` with my two commits on it. I have not found which, and have
  not asked them. The fixes are small, tested and re-checked live, so I have left them where they
  are rather than rewrite a shared branch. **If you want server fixes held back until you have
  looked, they need somewhere other than `main` to sit, and I will not make a branch unasked.**
  Until you say, I carry on committing them to `main` as you instructed, and report each here.
- **A BFF restart drops every game-port pilot** (default taken: accept it, as a retail client
  closing would).
- **The generic call path** keeps today's list of pairs as the BFF's own allowlist once the
  gateway's is gone (default taken).
- **The server answering None when a handler throws is left alone.** A real server sends the
  client an error there (`ExceptionWrapperGPCS.py` lines 45 and 93 wrap any exception into an
  `ErrorResponse`); EveJS answers None on purpose (`packetDispatcher.js` ~757). Changing that
  would turn every unfinished handler into an error dialog for anyone playing on the real client,
  which is your call, not a defect for a sub-agent. Handlers that throw are fixed one at a time.
- **Something I told you earlier was not evidence.** I wrote, in Phase 1 and again in a commit
  message today, that the server reporting a pilot as `retail_client` on `tcp` showed it was on
  the game port. The server says exactly that for a gateway session too. Nothing built on it was
  wrong, but the claim was. What does tell the transports apart is the server's log, and the plan
  and `scripts/bff-parity.js` now use that.
- **What the loop has left running** between iterations: the EveJS server (started detached, its
  process ID in the loop's scratch folder) and two check BFFs on ports 26510 and 26511, each with
  its own data folder so yours is untouched and with hosted bots not resumed. Stop any of them
  with `taskkill /PID`. Your own BFF on 26500 is not running and was not started.
- **I logged in as Farmer once**, docked, to call `KickOutMembers` with an empty list, because
  that call needs a CEO or director and no test character is one. Nobody was kicked; Farmer was
  logged straight off again.
- **Phase 3's last check names a flow that no longer exists.** The plan asks for "one hosted
  maintenance flow (Provisioning Center Apply)". `docs/provisioning-center-apply.md` says Center
  Apply is deliberately unavailable on stock EveJS. I will use the supported one in its place,
  Ready Fit's Replenish on a selected session, which runs the same provisioning engine. It needs a
  corporation fitting and stock staged for a test character first.
- **I am taking Phase 4 before that check**, out of the plan's order. Flying is the largest thing
  the web client cannot yet do on the game port and the one with real unknowns in it; the hosted
  flow goes through the same nine functions and has no new mechanism to prove. Say so if you
  would rather the phases closed in order.
- **I told you the server held a ship a tick behind after every undock. It does not.** That was
  in the log and in the message of commit `e0d95fc` for about forty minutes. A sub-agent found
  the real cause, I checked it by running, and the entry "the server question answered" is the
  correction. It is the second time in this loop I have written down a cause before checking it
  (the first was the status field); the brief now says not to.
- **A server defect I am leaving for you: a movement order can reach the client a tick later than
  the server acts on it.** The stamp and the server's one-second step come from two clocks. On a
  system woken by an undock a fair share of `Stop` orders are affected, and the client's ship
  ends a tick of travel from the server's (341 m for a frigate). Measured, reproduced by me, and
  in the defects table. Not fixed: both ways of fixing it go through stamp code tuned against
  captures of the real client or against a test that pins the present behaviour, and I cannot
  check either against the real client. **My recommendation:** give it to whoever owns the
  server's movement work, with the table in that entry; the first thing to settle is whether the
  server's seconds should begin on whole seconds.
- **Test Two now has a courier mission accepted** (agent Antaken Kamola, Reports to Veisto) with
  the package in its Badger's cargo, left that way for the flight in Phase 4.
- **eve.js's test runner cleans the temp folder.** The first sub-agent's test run swept 32 stale
  directories (11.7 GB, none touched for 29 hours) from the OS temp folder, `evejs-web-*` among
  them. That is the runner's own housekeeping, not something asked for; nothing in use was lost.

## Server defects

| Found | Defect | Evidence | Fix (eve.js) | Re-checked |
|---|---|---|---|---|
| 2026-10-08 | `corpRegistry.CanLeaveCurrentCorporation` returns `[0, "CrpAccessDenied", {}]`; the bare `{}` cannot be marshalled, so every client gets None | server log: `[PKT] ERR corpRegistry CanLeaveCurrentCorporation() Cannot marshal value: object {}` (7 times); the client unpacks three values (`corp_ui_home.py` 97, 532, 544) | `2e3101da4`; on `origin/main` since 01:09 (not pushed by this loop, see above) | 2026-10-08: harness reports it identical on both transports; no `[PKT] ERR` in the run |
| 2026-10-08 | `corpRegistry.KickOutMembers` returns a bare `{kicked, notKicked}`, which cannot be marshalled either, so the client gets None after the kicks are applied | the client indexes the answer, `results['kicked']` (`base_corporation.py` 469-471); the marshaller throws on the handler's old answer (the new test, before the fix) | `22940f822`; on `origin/main` since 01:09 (not pushed by this loop, see above) | 2026-10-08: called live on the game port with an empty list as a CEO (Farmer, docked): answers `{kicked: [], notKicked: []}` as a dict of two lists; no `[PKT] ERR` |

| 2026-10-08 | A movement order is stamped from one clock (the next whole second) and applied on another (the server's next one-second step, which begins where the system was woken). When they disagree the client is told one tick later than the server acts, and its ship ends a tick of travel away | my run: `CmdStop` handled 18 ms into one of the server's seconds, stamped B+12, server's ship slowing from 11 s after it first moved; a client stepping by the stamp is 199 m ahead five seconds later and gaining. Sub-agent: three placements, two of them wrong by a tick (`stopSpeedCommands.js` 225-229 against `nativeSubwarp.js` 676-721) | **not fixed**: not small, pinned by a test one way and by capture-tuned stamps the other; left for the operator | - |
| 2026-10-08 | The state sent when a client asks for it (`UpdateStateRequest`) carries where the ships are now under the next second's stamp, not carried forward to that tick as `AddBalls2` is | probes every 3.5 s read -1.49, +0.58, -0.53, +0.58 ticks against a park stepped from the state before (my run); `dispatch/sceneRefresh.js` 216-229, `authority/destinyAuthority.js` 955-968 (sub-agent's read) | **not fixed**: same code, same reasons; matters only after a client has lost its place | - |

Withdrawn the same day: "after undocking the server's ship is a tick behind". It is not; that was
the second row above, seen through a recorder that always asked at the same point in the second.

Judged, not a defect to hand off: the server answers None, and logs `[PKT] ERR`, whenever a handler
or its marshaller throws. See "For the operator".

Seen and left: `corpRegistry.KickOutMember` (one member) returns its internal result object, which
cannot be marshalled. The client ignores that call's answer and None is what it gets, so nothing a
player sees is wrong; it only writes a `[PKT] ERR` line.

---

## 2026-10-08 — where the loop starts

Phases 0, 1 and 2 of the plan are done; their status sections in
`game-port-transport-plan.md` say what exists and how it was proved. 20 local commits on `master`,
nothing pushed. The EveJS server is not running. Test characters: `test` / Test Pilot 140000001
(docked, Jita 4-4) and `test2` / Test Two 140000002 (docked, with a staged colony).

### Next

In order. Each line is one unit unless it says otherwise.

1. **Hand off the known server defect** (table above) to a sub-agent; re-run the parity harness
   after the fix and regenerate the report.
2. **The three reader changes Phase 2 decided on**, in the browser, each with a test that fails
   first: `unwrapLong` reads a string of digits; `agents.ts` `seqItems` reads a bare array; byte
   readers (`boundPlanets.ts`, and whatever reads the Proving Grounds dates) read both spellings.
   Then re-run the harness: those nine reads should no longer be a risk to a decoder.
3. **Phase 3, step 1: the `PilotSession` seam as a pure refactor.** Introduce the interface in the
   BFF, implement it on the gateway, and route `heldTopLevelCall`, the bound bind and call,
   select, release and the event stream through it. No behaviour change; the existing suite is
   the proof. This is several units: split it by helper.
4. **Phase 3, step 2: the game-port implementation**, behind the per-pilot setting. Calls first,
   then binds as the retail client binds them (`eveMoniker.py` gives the parameters), then
   notifications and session changes mapped with `bridgeJson.js`. Undock refuses until Phase 4.
5. **Phase 3's check**: one account on the game port, browser unchanged, each docked feature
   exercised; one hosted maintenance flow.
6. **Phase 4 begins with reading `C:\Users\ryanf\Documents\GitHub\destiny`**, CCP's own ballpark,
   and recording a `DoDestinyUpdate` stream. The plan's spike question ("how much simulation is
   needed") changes now that the simulation's source is to hand: the unit is a port, checked
   against the server's snapshot of the same grid.

---

## 2026-10-08 — the reader changes, and the first server fix

**Unit 2, the three reader changes: done.** Commit `351826d`, pushed.

- `unwrapLong` reads a bare string of digits; `agents.ts` and the BFF's strict fitting reader
  read a tuple given as a bare array; `boundPlanets.ts` reads bytes with or without the wrapper.
- Each had a test that failed first (five failed, then passed). The whole suite then failed in two
  places, and both were worth having:
  - `moduleReach.ts` reads the BFF's own JSON and must keep a string range "unknown". It relied on
    `unwrapLong` refusing strings. It now refuses them itself, and its test is unchanged.
  - `characterSelection.test.ts` asserted the old contract in so many words ("bare strings are
    not longs"). That assertion is changed to the new contract, on purpose, with a note.
- Every one of the 137 callers of `unwrapLong` is a numeric helper, checked by listing them, so a
  string of digits can only ever become the number it spells.
- A gain nobody asked for: the market panel's price history read every day as null on the gateway,
  because the gateway prints that day as bare digits. It reads now.
- Suite: 8594 tests, 8570 pass, 0 fail, 24 skipped. `tsc` clean.

**Unit 1, the known server defect: fixed and re-checked.** A sub-agent fixed
`CanLeaveCurrentCorporation` in eve.js `2e3101da4` (three bare `{}` became `buildDict([])`, with
a test that round-trips all four paths through the marshaller, seen failing first). I read the
diff, restarted the server and ran the harness.

**The harness again**, against that server (`docs/game-port-parity-report.md`, regenerated):

| | Before | Now |
|---|---|---|
| identical | 138 | 139 |
| moved | 4 | 4 |
| tolerated | 9 | 14 |
| divergent | 9 | 4 |
| refused alike | 15 | 15 |
| server cannot marshal | 1 | 0 |

The four left are the tuple and bytes spellings, each with a reader that takes both or no reader
at all (the plan's Phase 2 section has the table). The compare now calls bare digits a tolerated
spelling and gives the bytes difference its own name.

**Found along the way.** The sub-agent noticed `KickOutMembers` has the same fault. I checked the
handler and the client's code myself, and handed it to a second sub-agent (table above). The web
client's decoder for that call's answer reads the bare shape, so it gets widened when the fix
lands.

### Next

1. ~~Finish the `KickOutMembers` defect.~~ Done: next entry.
2. ~~Phase 3, step 1.~~ Done: next entry.
3. **Phase 3, step 2** and onward: next entry.

---

## 2026-10-08 — the second server fix, and the seam (Phase 3, step 1)

**`KickOutMembers`: fixed and re-checked.** eve.js `22940f822`, local. The handler answers a
dict of two lists; the sub-agent's test fails on the old handler with the marshaller's own error
and passes on the new one, and it found and fixed a test-harness verb that read the old shape.
I read the diff, restarted the server and made the call on the game port (table above). The web
client's decoder for that call read only the old bare object, so it now reads both
(`decodeCorpRegistryKickManyWriteAck`, test first). The gateway's JSON for this call changes
shape with the fix, which is why the decoder had to move in the same breath.

**Phase 3, step 1: done.** Commit `37171f5`, pushed. `src/pilotTransport.js`.

- A decision taken in your place, recorded in the plan (2.1): the interface is **the gateway
  client's own nine pilot functions**, routed by session handle, rather than a new
  `PilotSession` object threaded through the BFF. The BFF has some 360 places that reach a
  pilot and every test injects a fake gateway of that shape; keeping the shape means none of
  them change. A game-port handle starts `gp:`.
- With no game-port transport the module returns the gateway client itself, so this step changes
  nothing that runs. The proof is the suite: 8607 tests, 8583 pass, 0 fail.
- The tests passed first time, so I broke the code thirteen ways (ten in the module, three in the
  BFF's wiring) and each was caught.
- `EVEJS_PILOT_TRANSPORT` and `EVEJS_PILOT_TRANSPORT_OVERRIDES` are parsed and refuse a value
  that is not a transport. Nothing reads them yet.

**What step 2 has to match**, read from the gateway's source and written into the plan's Phase 3
section as a table: what the gateway does for each of the nine, and what the game port does
instead. Three things worth knowing before building it:

- The gateway hands a call's JSON arguments to the handler untouched, and those arguments are
  already the marshaller's own tree. So the game port can encode them as they are.
- A "bind" on the gateway is not a retail bind. It calls a method as if it were a service's
  (`invbroker.GetInventory(stationID)`) and keeps the bound object that comes back. The retail
  client binds the broker to its location first and calls it with the container
  (`GetInventory(containerHangar)`). Each of the BFF's fifteen bind shapes needs its retail
  form; that is the bulk of step 2.
- The retail client's selection is three calls, seen in a real client's log:
  `GetCharacterSelectionData`, `GetCharacterLockType`, `SelectCharacterID`. The session
  change arrives before the last one answers.

### Next

1. ~~`src/gamePort/pilots.js`, part one.~~ 2. ~~Part two: binds.~~ 3. ~~The browser, on the game
   port, while docked.~~ All done: next entry.
4. Phase 3's "done when", then Phase 4: next entry.

---

## 2026-10-08 — a pilot on the game port, in the browser (Phase 3, step 2)

Commits `59236d2`, `8e49c3e`, `12db272`, all pushed.

**The transport.** `src/gamePort/pilots.js` implements the pilot's nine functions on a game-port
session, to the gateway client's contract. With `EVEJS_PILOT_TRANSPORT_OVERRIDES="test=gameport"`
the BFF selects that account's pilots on the retail protocol; unset, nothing changes.

- Selecting is the retail client's three calls. The login name comes from the BFF's signed
  session and the server's account is checked against the BFF's before anything else is asked.
- A pilot in space is refused at select, before the server brings it online, and undocking is
  refused and never sent. Both wait for Phase 4.
- Release closes the connection and says "released" once the server itself has the character
  offline (measured: 3 ms).
- Binds are made the retail way; the plan's Phase 3 section has the table, with the client file
  each came from.

**Proof, in the order the brief asks for.**

1. Tests that fail: 59 in `test/gamePortPilots.test.js`. They passed first time, so I broke the
   code 80 ways across the two halves; every one was caught.
2. The suite: 8675 tests, 8651 pass, 0 fail, 24 skipped. `tsc` clean.
3. The real thing, in the browser: logged in as `test` on a BFF with that account on the game
   port, selected the Test Pilot, and opened all nineteen docked panels. Each drew its content.
   No failed request, no script error, nothing in the BFF's error log, no `[PKT] ERR`. During
   the walk the server logged 280 game-port calls and no gateway session for the pilot.
4. Against the gateway: `scripts/bff-parity.js` compares the JSON of the 22 routes those panels
   fetch, one BFF per transport. Test Pilot: 13 identical, 5 tolerated, 2 moved, 2 tuple
   spellings whose readers take both. Test Two: 11, 6, 3, 2.

**Two mistakes of mine, both caught here.**

- The status-field claim, above under "For the operator".
- A patch script of mine used `String.replace` with a replacement that contained a dollar sign
  and a backtick together, which JavaScript reads as "insert everything before the match". It
  pasted a test file's head into its middle. Repaired at once (the file was not yet committed);
  the scripts now pass a function as the replacement, and the brief lists the trap.

**What this does not show yet.** Every panel was read; nothing was written. The BFF's writes go
through the same two functions and will reach the server, but what each one sends has not been set
beside what the retail client sends for the same action. That is the remaining Phase 3 work, and
it is where "the same calls, the same arguments" is still unproven.

### Next

1. **A write, end to end, on the game port, checked against the retail client's call**: start
   with the ones the acceptance run needs while docked. Accepting a courier mission
   (`agentMgr` `DoAction`), moving an item between hangar and cargo (`invbroker` `Add`),
   queueing a skill, sending a mail. For each: what the decompiled client sends, what the BFF
   sends, the difference fixed in the game-port transport or the route, then done live.
2. **One hosted maintenance flow** (Provisioning Center Apply) with its account on the game port.
   That closes Phase 3's "done when".
3. **Phase 4.** Read `C:\Users\ryanf\Documents\GitHub\destiny` (`Ball.cpp`, `Ballpark.cpp`),
   record a `DoDestinyUpdate` stream with `scripts/record-game-port.js`, and port the ballpark:
   the unit test is our ballpark's positions against the server's snapshot of the same grid.
   Then `readSpaceSnapshot`, `readScannerState` and flight status's ship mode from it, and
   undock stops refusing.

---

## 2026-10-08 — the first writes on the game port, and a ledger of every call

Commit `e3a407f`, pushed.

**Writes, in the browser, on the game port.** As Test Two, docked where a courier agent is: opened
the conversation, asked for a mission, accepted it, and loaded the package into the ship. The
briefing drew (Reports ×1, Muvolailen to Veisto, 13,800 ISK, 49 LP), the journal went to one
active mission, and after the load the cargo hold read 0.1 of 3,900 m³ with the Reports in it. No
failed request, no script error, no `[PKT] ERR`. The server's log shows `DoAction` and `Add`
arriving on bound objects over the game port.

**Each checked against the retail client first.** `DoAction(actionID)` and the three briefing
reads are the client's own calls (`agentDialogueWindow.py`, `agents.py`). The load is
`Add(itemID, sourceLocationID, qty=, flag=)` on the ship's inventory, as in
`invControllers.py`. The same move through each transport delivers the same notification
(`OnItemChange`) on the same answer.

**What reading the inventory code turned up.** The BFF was free to spell a call any way the
handler would take, and it did:

- The client lists an inventory as `List(flag=flag)` and `ListByFlags(flags=[...])`. The BFF
  sent the flag by position and the flags as a tuple.
- `MultiAdd`'s item IDs are a list in the client. The BFF's array went out as a tuple.
- The client **never asks the server for a capacity**. It works it out from dogma and the
  listing. The web client asked 29 times in one pass over the docked panels, and 246 times in the
  hour before. That is the most frequent thing we send, and the retail client does not send it.
- `Add` always carries `qty`. The BFF leaves it out when a whole stack moves on one route.

**So there is now a registry, and a count.** `src/gamePort/retailCalls.js` holds each pair
checked against the decompiled client, with the file and line, as one of: same, reshaped (the
transport sends the client's form), differs (the route must change), web-only (the client never
makes the call). The transport reshapes what it can and tallies every call it makes.
`docs/game-port-call-ledger.md` is that tally for one pass over the docked routes: **65 pairs,
3 the same, 7 reshaped, 1 web-only, 54 not yet read.** With the reshaping in, the BFF's answers on
all 22 docked routes still match the gateway's.

This is what criterion 4 of "done" costs: one entry per pair, a few minutes each to read, and
for the web-only ones a piece of the client's own logic to rebuild. The ledger is how to see it
shrink.

Proof: 16 new tests, each watched fail or broken on purpose (22 breakages, three of which first
survived and showed real gaps in the tests, now closed). Suite: 8690 tests, 8666 pass, 0 fail.

**Also found.** Twenty call sites in the BFF reach the gateway with no held session
(`accountLevelCall`, the structure directory reads, corporation fittings). Some of those act
for a pilot. They do not pass through the pilot's transport, so they are gateway traffic that
Phase 5 has to account for one by one.

### Next

1. **Phase 4, first unit: read `destiny`.** `C:\Users\ryanf\Documents\GitHub\destiny`
   (`Ball.cpp`, `Ballpark.cpp`) and the client's `michelle.py` / `ballpark` Python that
   feeds it. Write down, in the plan, what a ballpark is made of, what `DoDestinyUpdate` carries,
   and what the port has to compute for the overview, flight status and autopilot. Then record a
   real `DoDestinyUpdate` stream (undock Test Two on the gateway BFF is not a recording: use
   `scripts/record-game-port.js` or the session's own packet listener on a game-port session
   that undocks).
2. **Phase 4, the port**, in units the first one defines. The test is our ballpark's positions
   against the server's snapshot of the same grid at the same time.
3. **The call ledger, as it goes**: the pairs each new feature uses get their entries when the
   feature is touched. `GetCapacity` computed the client's way is the first web-only one to
   remove.
4. **Phase 3's hosted check** (Ready Fit's Replenish, staged), and the twenty session-less
   gateway calls, before Phase 5.

---

## 2026-10-08 — Phase 4 begins: a real destiny stream, recorded

Commits `6347dc8`, `869086b`, pushed.

**A recording.** `scripts/record-destiny.js` undocks a docked character on the game port the way
a real client's session shows it in the server's log (`ship.Undock`, `beyonce.GetFormations`,
then the `beyonce` bind, which is what makes the server send the ballpark), stops it, docks it
again, and keeps every frame with its arrival time. `test/fixtures/destinyUndock.json` is one run
as the Test Pilot at Jita 4-4, who ended docked where it started. Seven tests pin its contents.

What the server sends a client in space, as recorded:

- `DoDestinyUpdate(events, waitForBubble)`, where `events` is a list of `(stamp, (name, args))`
  and a stamp is whole seconds of the server's clock.
- State arrives as binary blobs: `AddBalls2((blob, [slim items]))` for the ship (129 bytes),
  `SetState(KeyVal{stamp, state, ego, damageState, slims, droneState, ...})` for the grid (3,054
  bytes), and another `AddBalls2` (1,747 bytes, 19 items) for what is added after.
- Movement is commands, not positions: `SetBallPosition`, `SetBallVelocity`, `SetBallMass`,
  `SetBallMassive`, `SetBallAgility`, `SetMaxSpeed`, `GotoDirection`, `Stop`. After the first
  second the client is told what the ship was ordered to do and has to work out where it is.
- Around them: `DoSimClockRebase`, `OnSetTimeDilation`, `OnSpecialFX`, `OnDockingAccepted`,
  `OnDockingFinished`, and `OnMachoObjectDisconnect` each time the pilot changes place.

**A fix that fell out of it.** The server announces each bound object it lets go
(`OnMachoObjectDisconnect`); the retail client unregisters the object. The transport now forgets
any handle that names it. Test first; four breakages caught.

**In progress when this entry was written.** A sub-agent is reading CCP's `destiny` source and
the client's `michelle` and writing `docs/game-port-destiny-notes.md`: the state blob's layout,
the tick, each movement mode's equations, every update event, all with file and line. It writes
one file and commits nothing. The port is done from the source with those notes as the map; each
part is checked against the code it cites as it is ported.

Retail's undock also sends an `onlineModules` keyword (`station/base.py`), which the recorder
does not. It goes in the call registry when undock stops being refused.

### Next

1. **Read the notes when they land, and check the state-blob section against `Ballpark.cpp`.**
   Then the first port unit: decode the three blobs in the recording into balls (id, position,
   velocity, radius, mass, mode and each mode's fields). The test is the recording: the ship's
   ball in the first blob must sit where `SetBallPosition` then puts it, and the 19 added items
   must match their slim items one for one.
2. **The event applier and the tick**: apply the recorded events at their stamps and step the
   ballpark; the ship must leave the station along `GotoDirection` at no more than
   `SetMaxSpeed`, and come to rest after `Stop`.
3. **A second recording with a warp and a gate jump in it**, then those modes.
4. **`readSpaceSnapshot`, flight status's ship mode, the scanner** from the ballpark, compared
   with the gateway's snapshot of the same grid; then undock stops refusing.
5. The call ledger, Phase 3's hosted check and the session-less gateway calls, as listed above.

---

## 2026-10-08 — the destiny port: the state reader and four movement modes

Commits `8bdafac`, `2596c20`, `b4417a1`, pushed.

**The notes landed.** `docs/game-port-destiny-notes.md` (2,466 lines) is the sub-agent's map of
CCP's `destiny` and the client's `michelle`, cited to file and line, with its own list of what
it could not determine. Its header now says which sections have been checked against the source.
The port is made from the source; the notes say where to look.

**The state blob reader** (`src/gamePort/destiny/state.js`), ported from `ReadBallFromStream`.
All three blobs in the recording read to their last byte: 1, 76 and 19 balls, each with its slim
item, and the ship's record holds exactly the position, velocity, mass and top speed the same
recording then states in plain numbers. One thing the recording taught: this server stamps the
grid's state one tick after it adds the ship, with the ship's record unchanged, not a second's
travel further on. My test assumed otherwise and was wrong.

**The simulation** (`src/gamePort/destiny/ballpark.js`): adding balls, the setters and orders,
the integrator, the three-pass tick, and STOP, GOTO, FOLLOW and ORBIT.

The expected numbers are CCP's own. Seven of the evolve tests that ship with `destiny` give a
position or velocity after every tick. CCP's tests accept four decimal places; mine require every
digit, and all seven match exactly:

| CCP test | Ticks |
|---|---|
| goto direction | 10 |
| goto point, through the homing branch | 18 |
| a stopping ball's velocity | 10 |
| a ball at rest | 10 |
| follow a ball at rest | 10 |
| follow a ball under way | 10 |
| ball 2 orbiting ball 1 from tick 0 | 10 |

What makes the digits come out is the source's arithmetic, not the physics: float members round
to float32 on every store, a vector divided by a number is multiplied by its reciprocal, and the
integrator is evaluated as written. So far JavaScript's `exp`, `sin` and `cos` have agreed with
CCP's to the last bit wherever a fixture reaches them.

**Proof.** 91 deliberate breakages across the reader and the simulation. Fourteen got through at
first and each showed a real gap in the tests, now closed; they were mostly groupings that differ
only in the last place for some values, which the fixtures happened not to reach. Two remain, both
recorded in the tests: an orbit branch that can never give a different number, and committing
balls one at a time, which nothing can tell apart until collisions are ported. Suite: 8742 tests,
8717 pass, 0 fail, 24 skipped, 1 todo.

**Not ported yet, and the step refuses or counts rather than guesses:** WARP, MISSILE, FORMATION,
collisions (a massive ball is stepped without them and that is counted), orientation, and the
whole of time: which tick it is, when to step, and what to do with an update stamped in the past
or the future.

### Next

1. **Time and the update events** (notes, sections 3 and 6): the history queue, when the client
   steps, an update one or two ticks ahead or behind, the rewind. Then apply the recording's
   events at their stamps. The test is the recording: the ship leaves the station along
   `GotoDirection`, never faster than `SetMaxSpeed`, and stops after `Stop`. Read
   `_ticker.py` and `michelle.py` themselves for this; the notes flag that the decompiler
   mis-rendered `RealFlushState`.
2. **WARP** (4.8), against CCP's `test_warp.py`. The notes say only the alignment phase was
   checked by calculation; cruise and deceleration need the fixture.
3. **Collisions** (section 5): `Gradient`, `Potential`, the partition. This is what the todo test
   waits for.
4. **A second recording** with a warp and a gate jump, then the snapshot: `readSpaceSnapshot`,
   flight status's ship mode and the scanner from our ballpark, set beside the gateway's snapshot
   of the same grid. Then undock stops refusing and the browser flies.
5. The call ledger, Phase 3's hosted check and the session-less gateway calls, as before.

---

## 2026-10-08 — the client's clock, and the park held up to the server

Commits `484668c`, `01c74ac`, `e0d95fc`, pushed.

**A state read into the park and written back** (`484668c`): `Ballpark.readState` and
`writeState`, and removing balls (at once, or kept for an explosion's length and let go by the
tick). A park written and read back is the same park, byte for byte, for all three of the
recording's blobs.

**The client's clock** (`src/gamePort/destiny/park.js`, `01c74ac`). This is `Park` from the retail
client's `michelle.py`, with the copy of the same logic that ships with CCP's `destiny` beside it
for its tests. There is no clock exchange between client and server. The park's tick is whatever
the last state it read said, plus one for each second of its own, and every update is placed
against that:

| The update is for | What the client does |
|---|---|
| the tick the park is at | applies it |
| one or two ticks ahead | leaves it queued; the park's own ticking gets there |
| three or more ahead | steps the park up to it, then applies it |
| a tick already past | goes back to a snapshot of itself at or before that tick, steps forward to it, applies it, **and stays there** |
| a past tick with no snapshot that old | gives up its state and asks the server for the whole thing again (`UpdateStateRequest`) |

Other rules that turned out to matter: a `SetState` drops everything queued for before it and
anything older that arrives later; a group marked "wait for bubble" blocks the whole queue until
the second half of its tick arrives; entries that are not the simulation's (`OnSpecialFX`,
`OnDamageStateChange` and eight more) are applied without moving the park at all; an entry that
throws is logged and the rest of its group still applied. The snapshots: one whenever a state is
read, one in the middle of any tick that changed something, a fresh base after it, one every
eleventh quiet tick, never more than the oldest and the newest five. The step after an order
throws away every older snapshot, so an update from before the last order applied cannot be
reached and costs a full state.

One thing came from the bytecode, as the notes warned: the decompiled `RealFlushState` reads as if
any group beginning with a special effect reset the park. It does not, and the recording has such
a group.

Also from `michelle.py` rather than CCP's copy: packaged actions (a marshalled list of entries
inside one entry) are unpacked where they stand; an update holding two different ticks is counted
as the client counts it and still applied; balls that leave are reported with whether they blew
up, which the client works out from a `TerminalPlayDestructionEffect` anywhere in the same group.

`ballpark.js` gained the orders those updates reach and had not needed before: global,
interactive, harmonic (a ball made a force field), rigid, troll (a wreck that drifts for a set
time and then turns to stone, in the step), cloak and uncloak.

**Proof.** 49 tests in `test/destinyPark.test.js`:

- CCP's own cases for the merge (eleven) and the ticker (ten), carried over case for case.
- The recording played through as it arrived, a tick of the park's for every second between: the
  ship-only group at stamp -1 is dropped unapplied when the state for stamp 0 lands, the grid
  fills to 95 balls with 95 slim items, nothing fails and nothing resets; the ship flies along
  `GotoDirection` at 341 m/s to within a micrometre per second for eight ticks, covers 341 m a
  tick along that heading, takes `Stop` at the tick it is stamped for and then loses the same
  share of its speed every tick, `exp(-1e6 / (mass x agility))`.
- The rest are the rules above, each with a case.

About a hundred deliberate breakages of `park.js` and the new setters. Seven got through at first, each a gap
now closed (a tick's housekeeping, which snapshot survives a new base, `AddBalls` against
`AddBalls2`, what is cleared when a ball goes). One hung the tests rather than failing them, which
counts, and the breakage script now has a timeout. Two are equivalent and left: `Stop` on a ball
already stopped, and a troll checked twice. Suite: 8819 tests, 8794 pass, 0 fail, 24 skipped,
1 todo.

**Held up to the server** (`e0d95fc`). `scripts/record-destiny.js` can now ask the server for its
whole state again every few seconds while in space. That is the client's own recovery call, and
each answer is the server's account of where everything is at that tick. `scripts/destiny-compare.js`
plays such a recording through the park and, at each of those states, sets the park's ship beside
the server's just before the park is replaced by it. `test/fixtures/destinyUndockProbed.json` is
one such flight (probes every 3 s); a second, with one probe after 31 s, was looked at and not
kept.

| Stamp | Mode | Apart | Server ahead of the park | Speeds, server / park |
|---|---|---|---|---|
| +3 | GOTO | 357.7 m | **-1.05 ticks** | 341 / 341 |
| +6 | GOTO | 14.3 m | +0.042 ticks | 341 / 341 |
| +9 | GOTO | 14.0 m | +0.041 ticks | 341 / 341 |
| +15 | STOP (ordered at +12) | 125.4 m | slowing for **0.98 s less** | 228.4 / 187.9 |
| +18 | STOP | 5.3 m | slowing for 0.042 s more | 124.8 / 125.8 |
| +21 | STOP | 2.9 m | slowing for 0.043 s more | 68.2 / 68.8 |
| +31 (other flight, first probe) | GOTO | 335.2 m | **-0.98 ticks** | 341 / 341 |

What this says about the park: velocities agree with the server's to 1e-13 m/s; given the
server's state, three ticks later the park's ship is within 15 m of the server's while flying
and within 1% of its speed while stopping; every state is taken at its own stamp with the ship
put exactly where it says; nothing fails, nothing resets.

**What I wrote here about the server was wrong, and is withdrawn.** I read the rows in bold as
the server holding the ship a tick behind after every undock and applying a `Stop` a second late,
said a retail client would sit 341 m ahead of the server after every undock, and put that in the
message of commit `e0d95fc`. The measurements are right. The reading was not: see the next entry.
The rows were handed to a sub-agent to find the cause, which is how the mistake was found.

The tests pin the park's side and put bounds on the rest (never more than 1.1 ticks apart, the
difference always along the heading), so they keep passing whichever way the server question
goes, short of a re-recording.

### Next

1. **WARP** (notes 4.8), against CCP's `test_warp.py`. The notes say only the alignment phase was
   checked by calculation; cruise and deceleration need the fixture. `WarpTo` and `EntityWarpIn`
   are the orders that reach it; today they are counted as failed.
2. **Collisions** (section 5): `Gradient`, `Potential`, the partition. What the todo test waits
   for, and what makes a massive ball's step right near a station.
3. **A second recording** with a warp and a gate jump, probed the same way. Then the snapshot:
   `readSpaceSnapshot`, flight status's ship mode and the scanner from our park, set beside the
   gateway's snapshot of the same grid. Then undock stops refusing and the browser flies.
4. The damage clock (the client files each damage state with the time it arrived, to work out the
   shield since), `DoSimClockRebase` and `OnSetTimeDilation`: the park's seconds are not always
   wall seconds.
5. The call ledger, Phase 3's hosted check and the session-less gateway calls, as before.

---

## 2026-10-08 — the server question answered: the undock is fine, one thing is not

No code changed in either repository for this; the corrections are to what was written.

**I was wrong about the undock.** The sub-agent found the cause in the server, and I checked the
two parts of it that a run can show.

The server does step once a second, as CCP's does: once a second it fixes each ship's thrust for
the second to come, and its ten-a-second ticks only draw the ship along that. (That is the
sub-agent's reading of `simulation/nativeSubwarp.js`; what I ran agrees with it.) Two things
about those seconds explain every row of the table above:

- They do not begin on the stamp's whole seconds. They begin where the system was woken, and
  undocking into an empty system wakes it. The ship is put in 10 to 25 ms later and waits for the
  next one, so it leaves the undock point most of a second after it appears, at the start of the
  second its first state is stamped for. Seen in the server's movement log on my own run: held
  993 ms. A client stepping from that state is in step with it.
- A state the client asks for in flight is where the ships are at that moment, stamped with the
  next whole second. Depending on when in the second the question lands, it is most of a tick
  behind the tick it names, or ahead. My recorder asked every 3 s, so it always landed at about
  the same point: a tick behind on the first answer, close after that. **Asked every 3.5 s
  instead, the same comparison reads -1.49, +0.58, -0.53, +0.58 ticks** (my run). The offset
  followed the question, not the undock.

So a probed recording is good to about a tick and no finer, and what it showed as a defect was
its own blur. The sub-agent set a client stepping only from the first state and the `Stop`
against every step in the server's movement log for three ordinary flights: never more than 7 m
apart (the log is written a little after the step), 0.3 m at the last step, slowing included.
The pilot's own ship is where a retail client has it.

The test comments, both scripts' headers, the brief and the plan said the wrong thing and are
corrected. The message of `e0d95fc` cannot be, and history is not rewritten; this entry is the
correction.

**One thing is wrong on the server, in the other direction, and it is not fixed.** A movement
order is stamped from one clock and applied on another. The stamp is the next whole second of the
server's time (`stopSpeedCommands.js` 225-229); the order takes hold at the start of the
server's next one-second step (`nativeSubwarp.js` 676-721), and those steps begin where the
system was woken. When the two disagree, the client is told a tick later than the server acts.

My own run of the sub-agent's driver, which places the `Stop` in time and asks for no states:

| | |
|---|---|
| Ship appears | 183.384 s |
| First state, stamp B | sent 183.389 |
| Ship first moves | 184.377 (the server's seconds begin at .377) |
| `CmdStop` handled | 195.395, 18 ms into one of the server's seconds |
| Stamp on the `Stop` the client is sent | B+12 |
| Server's ship starts slowing | 195.375: **11** of its seconds after first moving |
| A client stepping by the stamp | starts slowing 12 ticks after its state: one tick late |
| Five seconds on | the client's ship is 199 m further along than the server's, and still gaining |

The sub-agent placed the order three ways:

| `Stop` sent | Stamp | Server starts slowing | Client beside server |
|---|---|---|---|
| after one of the server's seconds begins, before the whole second | B+12 | 12.000 s after first moving | identical |
| after a whole second, before the server's next second begins | B+13 | 12.003 s | client 193 m ahead, growing |
| within a tenth of a second after one of the server's seconds begins | B+12 | 11.000 s | client 200 m ahead, growing |

The second case is open for as long as the server's seconds are offset from whole ones, which was
between 0.09 and 0.6 of every second in these runs. So on a freshly woken system a fair share of
orders reach a retail client a tick late: its ship ends up a tick of travel from where the server
has it (341 m for this frigate, kilometres for something fast), until something corrects it. The
sub-agent expects the same of every order that goes through the same path, and of an undock into
a system already awake; those two are read from the code, not run.

It is a defect by the standard this loop works to, the client's ball where the server's is. It
was not fixed, and I agree with leaving it. Either the stamps have to come from the step the
order will be applied in, which is stamp code tuned against captures of the real client, or the
server's seconds have to be kept on whole seconds, which a test pins the other way
(`destinyPhase8NativeSubwarp.test.js` 2251-2300). Neither is small, neither can be checked
against the real client from here, and other sessions are at work in that code. It is in the
defects table and under "For the operator".

Smaller, also left: the state sent on request is the only one of the server's updates not
carried forward to the tick it is stamped for (`AddBalls2` and corrections for other pilots'
ships are, `projection/entityProjection.js` 103-199). A client that has just asked for its
state is up to a tick of travel off until the next thing corrects it. A healthy client rarely
asks.

**What this changes for the port.** Nothing in the park: it does what the retail client does with
the same bytes. What changes is how it is checked. For positions to the metre the truth is the
server's movement log, not a state asked for in flight.

### Next

1. **WARP** (notes 4.8), against CCP's `test_warp.py`. `WarpTo` and `EntityWarpIn` are the
   orders that reach it; today they are counted as failed.
2. **Collisions** (section 5): `Gradient`, `Potential`, the partition.
3. **The park beside the server's movement log.** A script of this repository's that steps the
   park from a recording and sets it against each step the server logged, to the metre. The
   sub-agent's version used a formula for the client; this one uses the park. It is the live check
   for warp too.
4. **A second recording** with a warp and a gate jump. Then the snapshot: `readSpaceSnapshot`,
   flight status's ship mode and the scanner from our park, set beside the gateway's snapshot of
   the same grid. Then undock stops refusing and the browser flies.
5. The damage clock, `DoSimClockRebase` and `OnSetTimeDilation`.
6. The call ledger, Phase 3's hosted check and the session-less gateway calls, as before.

---

## 2026-10-08 — WARP, and the first flight by the park

Commits `e6fd02b`, `bf99895`, pushed.

**The port** (`src/gamePort/destiny/ballpark.js`), from `Ballpark.cpp` (`WarpTo`, `EvolveWarp`,
`RealWarp`, `SetupWarpConstants`, `WarpDistance`, `EntityWarpIn`) and `Ball.cpp`
(`IsAlignedForWarp`, `SetMode`). One mode, two phases:

- **Lining up.** The ship is flown as an ordinary GOTO at the destination while a counter runs.
  It is lined up when its heading is within about eight degrees (the cosine above 0.99) and its
  speed above three quarters of its top speed, or after 180 ticks whatever it is doing. A
  destination nearer than 100 km is not a warp at all, just a flight there.
- **The warp proper.** From then on the ship is not stepped. Where it is, is worked out from how
  long ago the warp began: distance growing as `exp(rate x t)`, a cruise at top speed, then speed
  falling as `exp(-rate x t)`. A warp too short to reach top speed has its top speed lowered
  until there is no cruise. Once under 100 m/s, or half the ship's top speed if that is less, the
  ship drops out: massive again, stopped, and one ordinary step taken from there.

The engine posts three events to the client's Python on the way (`OnActivatingWarp`,
`OnDeactivatingWarp`, `OnExitWarp`); the port hands them to a hook. The park now applies
`WarpTo` and `EntityWarpIn` instead of counting them as failed, and refuses a fractional warp
factor as the engine's argument parsing does.

**Checked against CCP.** `test_warpto`, ten ticks of lining up, matched to the last digit on the
first run. That is the only warp fixture CCP ships, and it never reaches the warp proper. So the
rest is checked against the equations the source states in its own comment, worked out in the
tests from those equations rather than copied from the code, and by flying whole warps tick by
tick: never overshooting, cruising at exactly top speed, out on the first tick under the limit.

About a hundred deliberate breakages of the warp code and the park's two new orders. Ten got
through at first. Four were gaps and are closed. Six change nothing that can be seen and are left:
four because the engine always stops a ball before giving it a new mode, two because the
breakage itself came to the same number. My own expectations were wrong six times before the code
was (which tick stops being massive, where slowing down ends, and four smaller); each is
corrected in the tests with the reason.

**Flown live** (`scripts/record-warp.js`, `bf99895`). Nothing tells a client its warp is over:
its own ballpark drops the ship out, and that is how the retail client knows. So the recorder
runs the park on the live stream, one tick a second, and waits on what the park says. It is the
first thing to fly by the park. Test Pilot, Jita 4-4 to Jita IV Moon 6 and back, some 280,000 km
each way:

| | Out | Back |
|---|---|---|
| `WarpTo` from the server | stamp +6, no stopping short, warp factor 3000 | +78, 100,076.8 m short, 3000 |
| Park's ship enters warp | +16, ten ticks after it began lining up | +85 |
| Park's ship leaves warp | +37, twenty-one ticks later | +106 |
| Entries failed, resets | none, none | none, none |
| **At rest: park's ship from the server's** | **0.17 m** | **0.07 m** |

The last row is the one that matters. At rest there is no "which part of the second" to blur a
state asked of the server, so that state is where the server has the ship. Between the order to
warp and that state the server sent the pilot's ship nothing about its position: the `WarpTo`,
the old grid's nineteen balls removed (inside a packaged action, so that path has now run on real
bytes), the new grid's twenty-four added, and a flag. The lining up, the warp, the drop-out and
the coast to rest are the park's, and they end within a hand's width of the server's after
280,000 km.

The recording is `test/fixtures/destinyWarp.json`. Played back, the park enters and leaves warp
at the same ticks the live park wrote down, and the three tests on it fail under each of four
deliberate breaks, the smallest being a slowing-down rate wrong by one part in a thousand.
Suite: 8838 tests, 8813 pass, 0 fail, 24 skipped, 1 todo.

**Seen, not chased.** The pilot's ship is not massive from the moment it undocks, and the server
sets it not massive again two ticks after the park, dropping out of warp, has made it massive.
The park applies what it is sent, as the client does. Whether that is the server's undock and
warp-exit protection or something it should not be sending is a server question, noted here only.

**Not done for warp:** a warp long enough to cruise at top speed against the server (this one was
capped); another pilot's ship arriving (`EntityWarpIn` has only its unit tests); a gate jump.

### Next

1. **The snapshot.** `readSpaceSnapshot`, flight status's ship mode and the scanner from our
   park, set beside the gateway's snapshot of the same grid. The park can now follow a pilot
   through undock, flight, warp and stop, which is what those reads need. Then a pilot's
   game-port transport gets a park of its own, undock stops refusing, and the browser flies.
2. **A gate jump** recorded and played through (the session changes system; the park is replaced).
3. **Collisions** (notes, section 5): `Gradient`, `Potential`, the partition. What makes a
   massive ball's step right near a station, and what the todo test waits for.
4. **The park beside the server's movement log**, to the metre and tick by tick, for flight and
   for a warp long enough to cruise.
5. The damage clock, `DoSimClockRebase` and `OnSetTimeDilation`; MISSILE, FORMATION, MUSHROOM.
6. The call ledger, Phase 3's hosted check and the session-less gateway calls, as before.
