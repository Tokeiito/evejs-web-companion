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
- **Two more server fixes are on eve.js's local `main`, not pushed by me** (2026-10-08, late):
  `c6e7e6672` (a declined mission is pushed as `'declined'`, not `'reset'`) and `e066a81e9`
  (a briefing's "Decline Time" is the time left, not the moment it ends). Both were settled by
  recordings of the retail client on Tranquility that a sub-agent found on this machine
  (`D:\SSDSync\EveBadStuff\LOGS`), not by inference, and both have a test in the server's suite
  that was watched to fail first. `main` is four commits ahead of `origin/main` now, counting
  the two from earlier that are still unpushed.
- **Four more things in those recordings differ from EveJS and I have left them** (the entry
  "the agent's window listens" lists them): the order of the `accepted` and `declined` pushes
  against the call's answer, the decline question's `when`, a chain's next part before it is
  asked for, and `GetReplayTimestamp`. None is known to change what a player sees; say if you
  want any of them fixed.
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
- **Measured, and left for you: in a warp the server's own ship runs one to three seconds ahead
  of what it sends its clients.** The same path, to the decimetre; not the same time, and not
  by the same amount from warp to warp. The entry "the park beside the server's movement log"
  has the tables, and `scripts/park-against-movement-log.js` measures it from any recording.
  The web client shows what a retail client fed the same stream would compute, so nothing here
  is wrong on the client's side. Not handed to a sub-agent: it is how the server moves ships
  and stamps its orders, not a handler answering wrongly, and the last attempt at the stamps
  after a warp found them pinned by the server's own tests. **My recommendation:** read it
  with the item above and with the "not massive" after a warp. Stepping piloted ships on the
  server by CCP's rules, on the stamps it sends, is the one change I can see that could remove
  all three; this repository's port of those rules is exact against CCP's fixtures. I have not
  tried it.
- **The server's question before a quit or a decline is shown in the browser** on the game port
  and the user answers it. With no browser attached (a hosted bot) it is answered Yes; left
  unanswered for 110 seconds it lapses as a No. The web client's own question before the press is
  gone again, so on the gateway a decline is asked about by nobody, as it was before 2026-10-08
  (default taken). Overrule either by saying so.
- **On the gateway a mission cannot be quit.** The server refuses to commit a quit it could not
  warn about, and the gateway gives it nobody to warn. Measured 2026-10-08. On the game port it
  works. Not a defect of either: it goes away when the gateway does.
- **Test Two's standing** with agent Antaken Kamola went to -0.539 with the quit that proved
  this, and reads -0.434 after the courier run that followed.
- **Three more server fixes are committed in eve.js and not pushed**: `624378554` (a No to the
  decline question), `7282f54cc` (the contraband warning at undock) and `85042bbce` (the customs
  question's contraband sent as a list, which the retail client needs to word it). They sit on
  `main` beside whatever else is there, as you instructed for fixes.
  **Later the same day they were on `origin/main` too, and again I did not put them there:**
  eve.js's reflog records a push of `main` at 2026-10-08 10:30:00 local, while this loop was
  stalled and running nothing. It is the same thing as the push at 01:09 described above.
- **My live checks had turned eve.js's own tests red, and I had told you they were red on their
  own.** Its test runner copies the live store as its baseline and flies Test Two and Test
  Three, so what I left on them (a stack of Slaves, fourteen customs cases, three notifications,
  Test Three moved to another system) failed 27 of its tests. I have taken those out, and both
  files pass again. From now on the store is copied before a live check that stages anything
  and put back after it. **If you ran eve.js's tests on 2026-10-08 and saw customs or mission
  scenarios fail, that was this.**
- **A fourth server fix is committed in eve.js**: `7d5dbb532`, the ship's hull damage sent in
  hit points. Another session was committing to that checkout while the sub-agent worked (its
  commits `db3102e15` and `35aeb673c` sit under the fix); nothing of theirs was touched.
  Three things the sub-agent found beside it are left for you, in the entry "the ship's health":
  station repair's totals, the ratios in the ship state's instance rows, and stray attributes on
  module rows.
- **The rack's heat bars read on the game port** (`836f1ef`, `21c55b5`); on the gateway they
  still say "heat not known".
- **After a warp to a station at 0, the client's ship ends 413 m from the server's, and this
  one is yours to decide.** The client makes the ship massive as it drops out of warp, the
  server's second "not massive" comes one step late in three landings of four, and for that
  step the ship bounces off the station's ball. Measured on the park, not seen in a retail
  client. Nothing was changed in eve.js: a third entry cannot be sent under the server's own
  ceiling, and would make the client's park take two steps in a second and run a tick ahead;
  the two entries one tick apart is clean on the recording but leaves a later drop uncovered.
  The entries "collisions" and "the overview's distance" have the stamps and the replays.
- **A fifth server fix is committed in eve.js**: `10e2c22f4`, the pilot told when a module
  starts and stops heating its rack. eve.js `main` is two commits ahead of its origin
  (`7d5dbb532` and this one); I have not pushed it.
- **Seventeen eve.js test files are red on unchanged source** against the store as it is, by
  the sub-agent's measurement: `propulsionModuleParity`, `remoteSensorLinkParity`,
  `vortonProjectorParity`, `warpDisruptFieldGeneratorParity`,
  `commandTimeRangeUnavailableFallback`, `emergencyHullEnergizerParity`,
  `informationCommandBurstGameplayParity`, `microJumpDriveParity`, `remoteRepairFleetShow`,
  `shipDestructionParity`, `signatureSuppressorParity`, `skirmishCommandBurstGameplayParity`,
  `structureBurstProjectorParity`, `structureControlService`, `structureDoomsdayParity`,
  `targetingModuleParity`, `harnessCrimewatchScenarios`. I ran three of them myself on the
  restored store: `propulsionModuleParity` 12 of 13 (a scrambler refused with
  "SafetyActivated"), `microJumpDriveParity` 18 of 19, `targetingModuleParity` 6 of 7. What I
  checked: the safety rule's source last changed on 10-03 and that test file on 09-19; the
  store's `crimewatchRuntime` table is empty in the day's first copy (07:01) and its latest
  (12:10). **Not found: when they last passed, or why they fail.** My live checks today were
  each undone from a copy, but I cannot rule the store out.
- **Two faults in the BFF that were there on either transport since 2026-07-28 are fixed**
  (`2451cb1`): the Scanner Center's "Reconnect to probes" never asked the server, and a ship
  boarding that failed after the server accepted it answered "kind is not defined". One branch,
  put in the wrong function by commit `503b214`, caused both. Your own BFF on 26500 has the fix
  when it is next started from this checkout.
- **The undock warning's sentence, which is the client's text, was written out in this
  repository** from commit `cba50d1` until `81f2c33` took it out of the files. It is still in
  the history. I do not rewrite history; say if you want it rewritten.
- **The retail client's text is read from your installed client, not kept in the repository.**
  Set `EVEJS_CLIENT_ROOT` to the client's folder (the one holding `tq` and `ResFiles`) for the
  BFF to serve the client's own words for the server's labels. Unset, which is how the BFF runs
  unless you set it, nothing is read and the web client words things itself. I kept the text out
  of the repository because it is CCP's. Once a mission's text has been asked for, the BFF keeps
  the whole language file in memory, about 90 MB.
- **A recording that would settle a question** (2026-10-09). On this server a courier's agent,
  talked to again in its own station before the package has gone anywhere, offers Quit and
  nothing else. On Tranquility every recorded talk to an agent about an accepted mission,
  docked with that agent, offered Complete Mission and Quit (29 of 29, objective done or
  not), but none of them is that case: a mission to carry something, the pilot docked where
  the agent is and that not being the drop-off. If you record one (accept a courier whose
  drop-off is another station, close the agent's window, open it again before undocking), the
  answer's buttons decide whether the server's rule is right. I have not changed the server:
  the recordings do not show it wrong.
- **The BFF now starts a Python when it first needs one of the client's built data tables**
  (2026-10-09, default taken). The client's static data is laid out by loaders compiled into the
  client, so the client's own loader reads it, inside the client's own `python27.dll`, hosted
  by a 64-bit Python 3 on this machine (`python`, or what `EVEJS_PYTHON` names). It runs once
  for each table, for under half a second, and only when `EVEJS_CLIENT_ROOT` is set. With no
  Python the table is "not available" and the page does without. Nothing is written to disk.
  The other way would have been to work out each table's layout by hand; say if you would
  rather not have the BFF start a second program.
- **The page's own automation undocks without asking about contraband** (default taken): the
  autopilot and the bots send `ignoreContraband`, as the client does once its warning is
  suppressed, so a bot carrying contraband is fined at the undock as before. Only the Undock
  button asks. Overrule by saying automation should stop and ask.
- **Test Two has an offer open** from Antaken Kamola (not accepted), left from the re-check.
- **Test Two was fined and lost standing proving the customs question**: 37,500 ISK and 0.2 with
  the Caldari State at an undock with contraband aboard, and the same again for surrendering ten
  Slaves at the gate. The Slaves were given by GM command and are all confiscated. The customs
  cases, the penalty and the notifications those runs left in the store have since been removed
  (see the entry "dialogs by name"); the wallet and the standing are as the fines left them.
- **Test Three was moved and changed to prove the research questions**: it was docked at
  Iyen-Oursta III - Roden Shipyards Factory until later on 2026-10-08, when I moved it back to
  Jita 4-4, where it had been. It still has Science V and two research
  skills at level 1, and three datacores. To get research points I edited the game store with
  the server stopped (one project's start moved back 300 days; the project has since been
  cancelled). The store as it was is kept in the scratchpad.
- **A hosted courier bot stops at once on a pilot who already holds the mission**, on either
  transport: "There is no accepted mission naming cargo to load". Seen on 2026-10-08 with Test
  Two, on the gateway BFF and the game-port one alike. Not looked into further: it is the bot's
  own logic, not the transport. See the entry "a hosted bot on the game port".
- **Travel no longer takes the fewest jumps. It takes the route the retail client's autopilot plots**
  with its settings as they come: the safe way (high security wherever there is one, however much
  longer), and round Jita and Zarzakh unless one of them is where it is going. That is every
  traveller's route, the bots' too: a hauler that used to cut through low security or through
  Jita now goes round. Seen on 2026-10-09: Muvolailen to Perimeter went by Maurasi, where the
  fewest jumps go by Jita; Muvolailen to a low-security station 18 jumps off is 29 the safe way.
  The retail client lets a pilot change this, and since the entry "the autopilot's settings" so
  does the Travel panel, under "Route settings": "prefer shorter" for the fewest jumps, and the
  tick for avoiding the systems on the list (click it twice the first time: the client's own
  first click leaves it on). The settings are each pilot's own and are kept in the browser, so
  a bot flies by whatever its pilot has set there; nothing sets them for a whole fleet. See the
  entries "travel by the client's route" and "the autopilot's settings".
- **eve.js's test runner cleans the temp folder.** The first sub-agent's test run swept 32 stale
  directories (11.7 GB, none touched for 29 hours) from the OS temp folder, `evejs-web-*` among
  them. That is the runner's own housekeeping, not something asked for; nothing in use was lost.
- **Three routes ask the server for less than they did** (2026-10-09), because the retail client
  does not make the calls and the page read none of the answers. The Fitting window's dogma
  route asks `GetAllInfo` alone, where the plumbing sweep had it ask eleven reads; the calendar
  route asks for an event's details and responses only when an event is named; a corporation's
  assets are searched only when a request names a filter. Nothing was taken off the allowlist
  and no decoder was removed. To have the dogma reads asked again, add them back to
  `DOGMA_BOUND_READS` in `src/server.js`. See the entries "the ledger from a walk" and "the
  proxy's services".
- **A station's hangar has no limit on the game port** (2026-10-09). The Inventory panel's holds
  are reckoned as the retail client reckons them, and for a station's hangar the client's own
  figure is 9,000,000,000,000,000 m³. The server, asked, says 1,000,000 m³ for the same hangar
  (it has no branch for that flag and answers its default). The page and its bots took that
  for the hangar's size when working out whether something fits; on the game port they no
  longer do. Whether the server holds a move to its 1,000,000 has not been tried. To go back,
  take the hangar out of `CLIENT_RECKONED`'s reach by answering `askedOf` for it in the
  inventory route of `src/server.js`. See the entry "the Inventory panel's holds".
- **A ship in the hangar shows its type's own capacities on the game port** (2026-10-09), as it
  does in the retail client, whose dogma has only the ship being flown loaded. The server,
  asked, gives a ship in the hangar the pilot's skills: three haulers of eighty staged hulls
  came back five per cent bigger from the server than from the type. So the page can now show
  a hangar ship's cargo as smaller than the server will let it be filled. The ship being flown
  is not affected: its capacities are godma's, which have the skills in them. See the entry "a
  ship's bays".
- **The game-port transport now makes two calls nobody in the page asked for** (2026-10-09).
  When the server says a module is in a slot of the pilot's ship, the transport asks
  `ItemGetInfo(module)`, and for a module newly fitted it then sends
  `SetModuleOnline(ship, module)`, because the retail client does both of its own accord: a
  recording of it on Tranquility has them in that order. On this server the fit has put the
  module online already and the second call is answered without complaint. If a server
  refuses it for any reason but "already online", the module shows as offline and the page
  says nothing of why; the retail client shows the refusal. To turn both off, take
  `onSlotted` and `onFitted` out of where the dogma store is made in
  `src/gamePort/pilots.js`: a module then shows offline after a fit until the pilot docks,
  undocks or logs in again. See the entry "the ship's own dogma, from godma".
- **This server puts a module online when it is fitted; Tranquility, in the one recording
  there is, did not** (2026-10-09). Here the online effect's start is told before the item's
  move. In the recording nothing of the kind was read between the item's move and the
  client's own `SetModuleOnline`. I have not called it a defect or had it changed: the end
  state is the same for a retail client, and the recording was not read past that call's
  answer. Say if you want it looked into.

## Server defects

| Found | Defect | Evidence | Fix (eve.js) | Re-checked |
|---|---|---|---|---|
| 2026-10-08 | `corpRegistry.CanLeaveCurrentCorporation` returns `[0, "CrpAccessDenied", {}]`; the bare `{}` cannot be marshalled, so every client gets None | server log: `[PKT] ERR corpRegistry CanLeaveCurrentCorporation() Cannot marshal value: object {}` (7 times); the client unpacks three values (`corp_ui_home.py` 97, 532, 544) | `2e3101da4`; on `origin/main` since 01:09 (not pushed by this loop, see above) | 2026-10-08: harness reports it identical on both transports; no `[PKT] ERR` in the run |
| 2026-10-08 | `corpRegistry.KickOutMembers` returns a bare `{kicked, notKicked}`, which cannot be marshalled either, so the client gets None after the kicks are applied | the client indexes the answer, `results['kicked']` (`base_corporation.py` 469-471); the marshaller throws on the handler's old answer (the new test, before the fix) | `22940f822`; on `origin/main` since 01:09 (not pushed by this loop, see above) | 2026-10-08: called live on the game port with an empty list as a CEO (Farmer, docked): answers `{kicked: [], notKicked: []}` as a dict of two lists; no `[PKT] ERR` |

| 2026-10-08 | A movement order is stamped from one clock (the next whole second) and applied on another (the server's next one-second step, which begins where the system was woken). When they disagree the client is told one tick later than the server acts, and its ship ends a tick of travel away | my run: `CmdStop` handled 18 ms into one of the server's seconds, stamped B+12, server's ship slowing from 11 s after it first moved; a client stepping by the stamp is 199 m ahead five seconds later and gaining. Sub-agent: three placements, two of them wrong by a tick (`stopSpeedCommands.js` 225-229 against `nativeSubwarp.js` 676-721) | **not fixed**: not small, pinned by a test one way and by capture-tuned stamps the other; left for the operator | - |
| 2026-10-08 | The state sent when a client asks for it (`UpdateStateRequest`) carries where the ships are now under the next second's stamp, not carried forward to that tick as `AddBalls2` is | probes every 3.5 s read -1.49, +0.58, -0.53, +0.58 ticks against a park stepped from the state before (my run); `dispatch/sceneRefresh.js` 216-229, `authority/destinyAuthority.js` 955-968 (sub-agent's read) | **not fixed**: same code, same reasons; matters only after a client has lost its place | - |
| 2026-10-08 | After a No to the decline question (`agents.YesNo`), `agentMgr.DoAction` is answered with "This agent is unavailable." and no buttons, though the offer still stands | the retail client draws whatever DoAction answers (`agentDialogueWindow.py` 402); seen live on the game port: that conversation, with the offer still in the journal | `624378554` on `main`, not pushed | 2026-10-08: server restarted; Decline then No in the browser brings back the offer with Accept, Decline, Defer |
| 2026-10-08 | Undocking with contraband aboard: the server fines and confiscates at once. It never raises `ShipContrabandWarningUndock` and ignores `ignoreContraband`, so the client's warning (OK to go on, Cancel to stay) is never shown | `ui/station/base.py` 488 to 510 catches that refusal and retries with `ignoreContraband` set; server log `[Contraband] ... fine=37500 standingLoss=0.200` at undock, the goods gone from the hold | `7282f54cc` on `main`, not pushed | 2026-10-08: server restarted; in the browser, Undock with ten Slaves aboard asks, Cancel leaves ship, goods and wallet untouched, OK undocks; the gateway route warns too |
| 2026-10-08 | The customs question (`XmppChat.AskYesNoQuestion`, dialog `ChtCustomsConfiscationConfirmation2`) sends its contraband entries in a tuple. The client's `cfg.FormatConvert` reads a tuple given as a value as one more typed value, so it raises instead of wording the dialog | the server's bytes (one entry: opcode `0x25`, a one-tuple); the conversion's shape run in the client's own `python27.dll` raises `IndexError` on a tuple of entries and words a list; the client's own caller builds a list (`eveCfg.py` 170). Not observed on a running retail client | `85042bbce`, by a sub-agent: the entries go as a list | the fix's test decodes the bytes (watched to fail first); in the browser on the game port the question was asked, worded and answered with the server on that commit |
| 2026-10-08 | `GetAllInfo` sends the active ship's hull `damage` (attribute 3) as the 0 to 1 ratio. The client reads hit points: hull is `(hp - damage) / hp` (`activeShipController.py` 107 to 119), so its panel shows a full hull on a damaged ship | a real answer: `damage = 0.2`, `hp = 150`, while `armorDamage = 52.5` of 150 and the server's own ballpark damage state said armour 0.65, hull 0.8; the gateway's snapshot said hull 0.8, the game port's 0.9987. Not observed on a running retail client | `7d5dbb532`, by a sub-agent: hit points, as armour and shield are sent | the fix's test (watched to fail first); the damaged ship re-recorded and read on each transport in turn: hull 0.8 on both; the browser's panel |

| 2026-10-08 | The server never sends `OnHeatAdded` or `OnHeatRemoved`. The client's dogma location registers for both (read from its compiled class) and only carries a rack's heat upward for modules it has been told are heating it (`clientDogmaLocation.py` 1340 to 1356, `heatAttribute.py`), so between the server's heat changes it cools a rack that is being heated | a model that follows the client's code, fed by the live server: the mid rack read 0.7648, then 0.7572 a second later, then 0.7694, while its module was overloading. Not observed on a running retail client | `10e2c22f4`, by a sub-agent: one add when a module starts counting toward its rack's incoming heat, one remove when it stops | the fix's nine scenarios (watched to fail first, by the sub-agent); live on the game port: sixteen readings half a second apart, none lower than the one before, each within 0.002 of the client's formula; the same in the browser's rack |

| 2026-10-08 | After a warp the server's second `SetBallMassive(ship, 0)` is stamped two ticks after the first. A ball dropping out of warp makes itself massive (`Ballpark::WarpDistance`), and when the drop is on the first stamp's tick the second arrives one step late: for that step the ship is massive, and beside a station (sent as a massive ball 100 km in radius) it bounces off it (`Ballpark::Potential`) | two recordings, four landings: stamps (D, D+2) in three, (D+1, D+3) in one; replayed through the park the ship rests 413.2 m and 412.8 m from the server's at the station, 0.06 m in the fourth. Not observed on a running retail client | **not fixed**: a third entry cannot go out under the server's own ceiling and would make the client's park double-step; left for the operator | the recording replayed with the stamps one tick apart: within a metre at both rests (a test) |
| 2026-10-08 | Declining a mission pushes `OnAgentMissionChange('reset', agentID)`. The client closes the agent's window on `reset` (`agents.py` 688 to 696), so the agent's answer to the decline is never laid out | recordings of the retail client on Tranquility (`D:\SSDSync\EveBadStuff\LOGS`): both declines arrive as `'declined'`, and `reset` is nowhere in the tree | `c6e7e6672`, by a sub-agent: `'declined'` is pushed; a test in the server's suite watched to fail first | live in the browser on the game port: the window stays, with the agent's greeting, Request Mission and "Mission declined." |
| 2026-10-08 | A briefing's "Decline Time" is the absolute time the decline cooldown ends. The client writes it out as an interval (`agentDialogueWindow.py` 326 to 337, `FmtTimeInterval`), which for a timestamp is about 425 years | the same recordings: None 110 times, -1 13 times, and otherwise the time remaining, never more than four hours of ticks | `e066a81e9`, by the same sub-agent | live in the browser on the game port: a new offer inside the decline window says 3 hours and 59 minutes are left |

Withdrawn the same day: "after undocking the server's ship is a tick behind". It is not; that was
the second row above, seen through a recorder that always asked at the same point in the second.

Judged, not a defect to hand off: the server answers None, and logs `[PKT] ERR`, whenever a handler
or its marshaller throws. See "For the operator".

Seen and left, 2026-10-08: the decline question is sent with the time of asking as its `when`,
and the client's text reads "if you decline a mission before {when} you will lose standings", so
a retail player is warned about the present minute. The server's own decline timer for the agent
is the time meant. Not handed off: what a real server does with no timer running is not known.
The Tranquility recordings (found later the same day) have two decline questions, asked four
seconds apart. In both `when` is hours in the future, not the time of asking: the second
names 2026-05-27T01:58:15Z, which is three hours and a second after the first decline by the
log's own clock (four hours, the game's decline window, if that clock is an hour ahead of UTC;
not checked). Still not known: whether the question is asked at all with no timer running.

Seen and left, 2026-10-08, around the decline question (the entry "the server fix for a No to the
decline question" has them): a research agent's No brings back its research screen and not the
offer (measured); three more read from the code and not measured.

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

---

## 2026-10-08 — a game-port pilot flies: its own ballpark, and the space snapshot from it

Commits `c8cc6cf` and the one this entry is in, pushed.

**What changed.** A pilot on the game-port transport can be selected in space, undock, fly and
dock. Until now it was refused at each of those.

- **`src/gamePort/pilotSpace.js`** is what the retail client's `michelle` does for a pilot in
  space (`UpdateBallpark`, `AddBallpark`, `RemoveBallpark`, and the park's
  `InitializeRemoteBallpark`). When the session enters a solar system: ask
  `beyonce.GetFormations()`, start a park ticking once a second, bind the system's ballpark
  (ten tries, a second apart). The server answers the bind with its state and the park steps
  itself from there. Docking lets the park go; another system gets another. What the BFF's routes
  bind as `beyonce` is that one bound object, as `michelle.GetRemotePark()` is. A park that
  loses its place asks it for the whole state, as the client does.
- **`src/gamePort/spaceProjection.js`** reads the gateway's two answers out of that park, in the
  gateway's shape, so no route and nothing in the browser changed: the space snapshot (one row
  per ball that has a slim item, and the pilot's own ship) and the movement half of the flight
  status. What a thing is (`station`, `moon`, `sentryGun`...) is told from the slim item's
  category and group, which is all a client has. Health is the damage state the server sent, with
  the shield brought forward by its own recharge as the client's
  `CalculateCurrentDamageStateValues` does; the park now keeps the tick each state arrived at.

**Proof, in order.**

*Tests.* 17 new or replaced, across the park's keeping (`test/gamePortSpace.test.js`) and the
transport (`test/gamePortPilots.test.js`, where three tests that asserted the refusals are
replaced by tests of the flying). 49 deliberate breakages of the two new modules: nine got
through at first, six were gaps and are closed, two were code that did nothing and is removed,
one changes nothing that can be seen. Suite: 8852 tests, 8827 pass, 0 fail, 24 skipped, 1 todo.

*The same pilot on each transport in turn* (`scripts/space-parity.js`, new): Test Pilot
undocked at Jita 4-4 through the BFF's ordinary routes, on the gateway BFF and then on the
game-port one. The server's log shows the second pass as real client calls
(`[PKT] IN ship Undock()`, `beyonce GetFormations()`, `N=65450:10 CmdDock()`).

| | Gateway | Game port |
|---|---|---|
| Entities in the snapshot | 95 | 95, none missing either way |
| Rows identical in every field | | 57 |
| The 94 fixed things, largest difference in position | | 0.00006 m |
| Flight status | in space, GOTO, speed fraction 1 | the same |
| Ship moved between two reads | 668.0 m in 2.019 s | 682.0 m in 2 ticks, at 341 m/s |
| Docked again | yes | yes |

Every difference, and there are five kinds:

| Count | Field | Game port | Gateway | Why |
|---|---|---|---|---|
| 18 x 3 | a station's shield, armour, hull | 1 | null | the server sends the client a damage state for stations; the gateway leaves out what cannot be damaged |
| 16 | a sentry gun's name | null | its type's name | the slim item carries no name; the browser names a row by its type when there is none |
| 3 | kind of scenery the server placed | `celestial` | `authoredSpaceProp` | the server's own word; to a client they are ordinary celestials |
| 1 | the ship's radius | 38.400001525878906 | 38.4 | the client's ball holds a radius as a 32-bit float |
| own ship | capacitor, the three capacities | null | 1; 175, 150, 150 | the client takes these from dogma, not from the ballpark. **Not read yet.** |

*Two pilots at once, one per transport* (`space-parity.js --together`): Test Pilot on the
gateway and Test Three on the game port, both undocked at Jita 4-4. Each sees 96 entities, the
same 96, and each sees the other's ship. Read ten times over seven seconds, each ship's position
in the two views, as seconds of its own travel:

| | Game-port view against the gateway's |
|---|---|
| The gateway pilot's Reaper, as the game-port pilot's park has it | within 0.1 s of where the gateway has it, once the two clocks' readings are allowed for (the park holds whole seconds) |
| The game-port pilot's own Capsule, as its park has it | a steady 0.38 s further on than the Reaper is, in all ten reads: about 0.45 s ahead of where the gateway has it |
| Velocities | identical |

So another pilot's ship is where the server has it, and the pilot's own is under half a second
of travel ahead (65 to 80 m for a capsule). I have not established why. It is what the defect
already recorded would give (the server starts a ship moving at the start of its own second,
which is not the stamp's second, while the first state says it is moving from the stamp), and
the size fits the offsets the sub-agent measured, but that is a fit, not a finding.

*In the browser.* On the game-port BFF: opened Test Pilot from the pilot list, pressed
**Undock**. The page went to "IN SPACE · Jita · GOTO · 100%", with the ship's panel (341 m/s,
shield, armour and hull 100%, capacitor a dash) and the overview listing the grid by distance
("Jita IV - Moon 4 - Caldari Navy Assembly Plant · Station · 65.7 km" first). Pressed **Stop**:
the route answered 200 and the ship was at 0.15 m/s in STOP a few seconds on. Pressed **Dock**:
the page went back to "DOCKED · Jita IV - Moon 4 - Caldari Navy Assembly Plant". Every route the
space view called answered 200 (snapshot, targets, drones, ore hold, flight status). One thing
about the check itself: the browser pane is hidden here, so the page pauses its own polling;
what was on the page after each press is what it drew then, and the later numbers were read
through the page's own session.

**Not done.**

- **The scanner in space** still answers 501 on the game port.
- **The ship's readings from dogma**: capacitor, the capacities, which modules are running or
  overloaded, their damage. The panel shows a dash for capacitor.
- **The park's seconds against the server's** when time is slowed (`DoSimClockRebase`,
  `OnSetTimeDilation`), and a pilot docked in a structure, who is given a view of space too.
- Seen: the BFF's undock route calls `ship.Undock` as a service's method; the retail client
  calls it on the ship object bound for the station. It works, and it is one for the call ledger.
- Seen: asking to dock from far off answers `DockingApproach` and the ship flies in; the route
  has to be asked again on arrival. The retail client's own docking does that asking. Not looked
  into whether the web client's does.

### Next

1. **The ship's readings from dogma**, as the retail client takes them: what it reads on
   entering space and which notifications keep it current. Then the panel's capacitor and
   capacities, and the modules' state, on the game port.
2. **A gate jump** on the game port, recorded and played through, then live: the session changes
   system, the park is replaced.
3. **The scanner in space** on the game port.
4. **Warp, in the browser, on the game port**, and then a hosted bot flying a courier mission
   end to end on it, which is Phase 4's "done when". Test Two is docked with the package aboard.
5. **Collisions** (notes, section 5); **the park beside the server's movement log**; the sim
   clock; MISSILE, FORMATION, MUSHROOM.
6. The call ledger, Phase 3's hosted check and the session-less gateway calls, as before.

---

## 2026-10-08 — the ship's own numbers, from dogma

Commit: the one this entry is in, pushed.

**What the retail client does.** The ship's panel does not take its numbers from the ballpark.
It reads the godma item for the ship (`shipHud/activeShipController.py`): capacitor is `charge`
over `capacitorCapacity`, and the three capacities are `shieldCapacity`, `armorHP` and `hp`.
Godma (`environment/godma.py`) gets every attribute of the ship and its modules in one call,
`GetAllInfo(primeCharacter, primeShip, primeStructure)` on the dogma location bound for where
the pilot is, and is then told of each change (`OnModuleAttributeChanges`, and the same changes
bundled in `OnMultiEvent` or riding with a ballpark update). The capacitor and the shield are
not numbers that stay put: godma keeps each as a value, a time, a recharge time and a capacity,
and works out what it is now whenever it is read.

**What was built.** `src/gamePort/pilotDogma.js` is that part of godma: loading from
`GetAllInfo`, applying a change the way `ApplyAttributeChange` does (a redundant one ignored,
someone else's refused, an older one arriving late dropped, a capacity or recharge-time change
carrying the charge on from what it is), `OnMultiEvent`'s ordering, and the recharge formula
(`GetChargeValue`). A game-port pilot's transport keeps one, loads it once for a ship in a
place the first time the snapshot wants it, and feeds it the session's notifications. The
snapshot's ship block now carries the capacitor and the three capacities.

**Proof.**

*From a real server's bytes* (`scripts/record-dogma.js`, `test/fixtures/dogmaFlight.json`):
Test Pilot undocked and ran its afterburner for twelve seconds. The server reported the
capacitor about twice a second: 32 times in the sixteen seconds before it was last asked.

| | |
|---|---|
| Loaded from `GetAllInfo` | capacitor 125 of 125, shield 175, armour 150, hull 150: the gateway's numbers for the same ship |
| Reports while the capacitor was only recharging | 28 |
| Godma's formula, from one report to the next | within 0.000001 of what the server then reported, every time (the server sends six places) |
| The two cycle starts | 5 units gone at once, as reported |
| The report straight after each cycle start | 0.04 and 0.06 off the curve: the server's own first step from the new value |
| The server's last `GetAllInfo` | repeats its last report (120.440107) under a time 0.24 s later |

So between the server's reports the client's own working lands on the server's next number to
the last place it sends. The last row is why a first comparison read 0.08 apart: the server
answered with a number a quarter of a second old.

*Tests.* 9 for the dogma port, 2 for the transport, 1 for the projection. 34 deliberate
breakages of the port: seven got through at first, six were gaps and are closed, one changes
nothing that can be seen. Suite: 8864 tests, 8839 pass, 0 fail, 24 skipped, 1 todo.

*Each transport in turn* (`scripts/space-parity.js`), same pilot, same grid: the pilot's own
ship now differs from the gateway's in one field, the radius held as a 32-bit float. Capacitor
and capacities agree. The kinds of difference in the whole snapshot are down from five to four.

*In the browser*, on the game port: undocked Test Pilot from the web UI. The ship's panel reads
"100% CAP" where it read a dash, with 341 m/s and shield, armour and hull at 100%. Docked again
from the UI.

**Decisions and things seen.**

- `GetAllInfo` is asked as godma's first prime asks it: `(True, True, None)`. I have not traced
  what the retail client asks on each later change of place (it has `ForcePrimeLocation` for
  that); here it is the same call again for a new ship or a new place.
- The clock a recharge is worked out against is this machine's, taken as the server's. On one
  machine they are the same clock. For a server elsewhere the client's sim clock is set from the
  server's (`DoSimClockRebase`), which is not ported.
- Health (shield, armour, hull as fractions) still comes from the ballpark's damage states, as
  in the last entry. The retail panel reads those from godma too. They agree here; I have not
  seen what the server sends for either while a ship is being shot.
- The BFF's activate route calls `dogmaIM.Activate` as a service's method; the retail client
  calls it on the bound dogma location. The recorder uses the client's form. One for the ledger.
- That route decides whether a module came on by reading which modules are running from the
  snapshot, and on the game port that list is still empty. **Activating a module from the web UI
  on the game port will report it did not start.** Next unit.

### Next

1. **Which modules are running** on the game port: godma's effects, from `activeEffects` in
   `GetAllInfo` and `OnGodmaShipEffect` (three of those are in `dogmaFlight.json`). Then the
   activate and deactivate routes work on the game port, and the panel's modules light up.
2. **A gate jump** on the game port, recorded and played through, then live.
3. **The scanner in space** on the game port.
4. **Warp, in the browser, on the game port**, then a hosted bot flying a courier mission end to
   end on it (Phase 4's "done when"). Test Two is docked with the package aboard.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (now with `ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the
   client does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — which modules are running

Commits `fe79800` and the one this entry is in, pushed.

**What the retail client does.** A module is running when an effect is active on it. Godma
learns which are active from each item's row in `GetAllInfo` (`RefreshItemEffects`) and is told
of each start and stop by `OnGodmaShipEffect`, alone or bundled in `OnMultiEvent`, where the
last one for an item's effect in a moment is what stands (`BroadcastFilteredGSF`).

**What was built.** `pilotDogma.js` keeps the effects on the pilot's items. A module is
running when an effect of the activation, target or area kind is active on it, and overloaded
when one of the overload kind is; the kinds come from the game's static data
(`staticData.getEffect`, new). The snapshot's ship block on the game port now carries
`activeModuleIDs` and `overloadedModuleIDs`, which is what the BFF's activate and deactivate
routes read to say whether a module came on.

One thing the static data did not say the way I expected: being online is an effect too, and
this data files it as an activation, the same kind as an afterburner. Godma leaves it out by
name wherever it asks what is running, so the port leaves it out by its ID. Without that, every
fitted module would have counted as running; the test on the real recording is what would have
caught it.

**Proof.**

*From the recorded flight* (`dogmaFlight.json`): loaded in space, the afterburner is fitted,
online and not running. It is running from the server's word that it started, through its second
cycle ten seconds later to the tick of the server's clock, and stops at the server's word. The
`GetAllInfo` taken while it ran says it is running by itself. On the wire the server's word
that a module started arrives one millisecond before its answer to `Activate`, so a route that
re-reads straight after the call sees it.

*Tests.* 5 new, 2 extended. 25 deliberate breakages of the new part: two got through at first,
both gaps, both closed. Suite: 8869 tests, 8844 pass, 0 fail, 24 skipped, 1 todo.

*Through the BFF's own routes, each transport in turn*, Test Pilot's afterburner:

| | Gateway | Game port |
|---|---|---|
| Before | nothing running, capacitor 1.0000 | the same |
| `POST /modules/activate` | `active: true`, the module listed | the same |
| Four seconds on | running, capacitor 0.9707 | running, capacitor 0.9713 |
| `POST /modules/deactivate` | `stopped: true`, nothing listed | the same |
| Docked again | yes | yes |

*In the browser*, on the game port: undocked, pressed the afterburner's button. It went from
"click to switch on" to "active. Click to switch off." (and `aria-pressed` true); pressed again,
back to "click to switch on". Docked from the UI. A note on the check: the button answers to a
pointer press and release, not to a synthetic click, which sent nothing.

**Not done:** how damaged each module is (`moduleDamage`, dogma's `damage` on the module) and
which weapons are grouped (`weaponBanks`, in `GetAllInfo`'s ship state). Both are empty on the
game port; the gateway reads them from the server's own state. Overloading has only its unit
tests: nothing has been overloaded live.

### Next

1. **A gate jump** on the game port: recorded and played through, then live through the BFF's
   jump route. The session changes system, the park is replaced, dogma is asked again.
2. **Warp, in the browser, on the game port**, then a hosted bot flying a courier mission end to
   end on it (Phase 4's "done when"). Test Two is docked with the package aboard.
3. **The scanner in space** on the game port.
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — through a gate and back on the game port

Commits `6e64a79` and the one this entry is in, pushed.

**Nothing in the transport had to change for a jump.** The last entries built it: a change of
solar system lets the pilot's park go and makes another, forgets what was bound for the old
place, and has dogma asked again. This entry is the proof that it holds on a real trip, and two
things the trip turned up.

**The trip, on each transport in turn** (`scripts/route-parity.js`, new): Test Pilot, through
the BFF's routes with the calls the browser's autopilot makes. Undock at Jita 4-4, warp 40 AU to
the Perimeter gate, jump, fly up to the gate arrived at, jump back, warp to the station, dock.

| | Gateway | Game port |
|---|---|---|
| Warp to the gate: seconds in warp, top speed | 41, 3.00 AU/s | 41, 3.00 AU/s |
| Jump out | Jita to Perimeter | Jita to Perimeter |
| Perimeter at first look, and once settled | 89, 89 | 53, then 89 two seconds on |
| The two views of Perimeter | | nothing missing either way; 81 fixed things within 0.0005 m |
| Jump back: refusals while flying up to the gate | 17 | 17 |
| Jita at first look, and once settled | 111, 111 | 84, then 111 two seconds on |
| The two views of Jita at the gate | | nothing missing either way; 102 fixed things within 0.002 m |
| Warp to the station: seconds in warp | 42 | 38 |
| Own ship after each jump | STOP, capacitor 1, shield 175 | the same |
| Docked again | yes | yes |

The "first look" row is the client's own experience, not a fault. A client is sent a new system
in two pieces: everything fixed in it, then what is on the gate's own grid stamped two ticks
later, which the park waits for. The gateway reads the server's scene and has it all at once.

**I nearly reported that row as a defect.** The first run of the script looked once, straight
after arriving, and the game port was 36 entities short: every sentry gun, billboard and piece
of scenery at the gate. Before writing that down as the server or the park losing them, I
recorded the trip and looked at what each park held when it was let go: all of it. The script
now waits for the count to stop changing. That is the brief's newest rule doing its job.

**The recording** (`scripts/record-jump.js`, `test/fixtures/destinyJump.json`): the same trip on
the game port, with a park for each system kept by the transport's own park keeper, as michelle
keeps them. Four tests play it through:

- three parks, ending with 111, 89 and 95 balls, each kind for kind what the live park held;
  no entry failed, nothing reset;
- a new system arriving as 53 then 89 two ticks later, the ship 15.6 km from the gate it came
  out of, and within the 2,500 m a gate is used from by the time it jumped back;
- the 40 AU warp: 43 ticks, as the live park counted, **cruising at exactly 3 AU a second**,
  with the grids changing under it (station 95, in warp 76, gate 111);
- what is at each gate by kind, the same as the gateway's lists.

**A long warp against the server, at rest.** The earlier warp was 280,000 km and never reached
top speed. `record-warp.js` to the same gate and back, asking the server for its state once the
ship had stopped: **0.12 m and 0.06 m apart after 40 AU each way.** (Out of warp but not yet
stopped, the route script's two passes read 600 m and 1,400 m from the gate; that is when in the
coast each happened to look, as those two numbers at rest show.)

**Two things fixed.**

- **A billboard was being called a ship.** Billboards are in the same category as the ships
  nobody flies and the sentry guns. The game port said 12 ships at Jita's gate where the gateway
  says 9 and 3 billboards. `kindOf` now knows the group.
- **An entry the park could not apply was counted and never said.** The park passes over it, as
  the client does, and the count was all there was; nothing reached a log. The park now reports
  which entry and why, and the pilot's space passes that on to the BFF's log.

Suite: 8873 tests, 8848 pass, 0 fail, 24 skipped, 1 todo.

**Not done:** the trip in the browser by the web client's own autopilot (the routes it uses are
the ones flown here, by a script), and a hosted bot's courier run. The scanner in space.

### Next

1. **The browser's autopilot on the game port**: set a destination a jump away in the web UI and
   let it fly, then a hosted bot flying Test Two's courier mission end to end, which closes
   Phase 4.
2. **The scanner in space** on the game port (the one route that still answers 501 there).
3. Module damage and weapon banks from dogma; health from godma as the panel reads it.
4. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
5. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — a hosted bot on the game port, and a call the server makes to the client

No code changed in this entry. It records a run that stopped short, why, and a gap it exposed.

**The aim** was Phase 4's last line: a hosted bot flying a courier mission end to end on the
game port. Test Two has had a courier mission accepted, with the package in its Badger, since
Phase 3.

**The bot ran on the game port, as far as it runs on the gateway.** I saved a script made of the
courier blocks (ask the agent, accept, load, fly the delivery, turn in, fly back), approved a run
of it the way the web UI's review step does, and started it with `POST /api/bots/start`. On the
game-port BFF and on the gateway BFF alike it took the pilot over, passed the first two blocks,
and paused at the third within five seconds, with the same words: "There is no accepted mission
naming cargo to load — accept one first." Putting a find-an-agent block first changed nothing.

So this is not a difference between the transports. It is how a hosted script behaves when the
mission was accepted before the run began: the accept block is satisfied by the journal and
moves on without the briefing that says what the cargo is, and the load block then has nothing
to go on. I did not chase it further; it is the bot's own logic, the same on both transports,
and outside what this loop is for. **It is worth the operator knowing**: a courier bot started
on a pilot who already holds the mission stops at once. It is under "For the operator".

**To get a clean run I tried to quit the old mission, and that found a real gap in the
game-port transport.** Pressing Quit in the agent's conversation (`agentMgr` bound,
`DoAction(<the Quit action>)`) was answered, and the mission stayed. The server's log says why:

```
[PKT] OUT agents YesNo() client-call callID=610001
```

The server asked the client a question. On the retail client that is `agents.YesNo(title, body,
agentID, contentID, suppressID)` (`ui/station/agents/agents.py` 404): it puts up a Yes/No window
and answers whether Yes was pressed. **The game-port session does not answer calls the server
makes to it**, so the question hangs and the quit never happens. ~~The gateway never sees the
question at all: the server finds no client there to ask and goes ahead.~~ (Withdrawn the same
day, unchecked and wrong: on the gateway the quit does not happen either. See the next entry.)

Every confirmation the server asks of a client goes this way (quitting or declining a mission
are two), so this is not a corner. It needs: the session answering an incoming call; and a
decision about who gives the answer. On the retail client the player does. ~~The web UI has its own
confirmation before it presses Quit, and on the gateway the server proceeds without asking, so
answering Yes on the web client's behalf matches what the web client does today;~~ (withdrawn:
neither was checked, and the web UI had no confirmation) passing the question to the browser is
the faithful end state.

**Left as it was:** Test Two is docked at Muvolailen with the mission still accepted and the
package aboard. The hosted bots are stopped (three stopped records across the two check BFFs).

### Next

1. **Calls the server makes to the client**, on the game port: answer them in the session, with
   `agents.YesNo` first. Then quitting and declining a mission work there as on the gateway.
2. **A hosted bot's courier run end to end on the game port**, with a fresh mission (quit the old
   one once 1 is done), which closes Phase 4. Then the same trip by the browser's own autopilot.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — the server's questions answered on the game port; a mission quit and declined there

Commit `9526060`, pushed.

**Two things in the entry above were written without being checked. One is wrong, and both are
withdrawn** (they are struck through there, with a pointer here).

- I wrote that on the gateway "the server finds no client there to ask and goes ahead". Measured
  today, on the gateway BFF, with Test Two's accepted mission: pressing Quit is answered with the
  same conversation, the Quit button still on it, and the mission stays. The server's own code
  says why (`agentMgrService.js`, "a cancellation must never be committed when the warning could
  not be shown"). **So on the gateway a mission cannot be quit at all.** A decline is the other
  way round in that code: with nobody to ask it goes ahead. I have read that and not measured it.
- I wrote that the web UI "has its own confirmation before it presses Quit". It had none: the
  button called the action directly (`AgentsMissions.svelte`). It has one now, below.

That is the third claim this loop has had to take back, and the first two since the rule against
them went into the brief. Both were in a paragraph arguing for a design, which is where I was not
looking for them.

**What the retail client does**, from its source:

- A call from the server arrives as an ordinary call packet addressed to the client, naming one
  of the client's own services. The client runs the method and sends back what it returned, with
  the two addresses swapped (`ServiceCallGPCS.CallUp`, `machoNetPacket.Response`).
- Before the server asks, it answers the call that caused the question with an answer marked
  **provisional**: (seconds, an event's name, its arguments). That is not the answer. The client
  goes on waiting, for that many seconds from then, and raises the event meanwhile
  (`machoNet._BlockingCall`). The real answer comes when the player has answered. This is why
  the quit looked "answered" in the last entry: the session took the provisional answer for the
  real one.
- `agents.YesNo` puts up a Yes/No window and answers whether Yes was pressed. If the player has
  ticked "do not show this again" on that message, it answers at once with no window.

**What was built.**

- **The session answers a call the server makes to it.** The call goes to the client's services
  (a function the session is given); what that returns goes back as the client sends it. A call
  nobody here answers is left unanswered and reported, with the reason. (The client would answer
  with the exception it raised. Nothing but the server's patience waits on that.)
- **A provisional answer is waited out.** The call keeps waiting for as long as the server says,
  and the event the server names is raised as a notification. The BFF caps that wait at two
  minutes, because a browser's request is behind it and the server's figure is a day.
- **The pilot's client services**, as far as the server calls them today:

  | The server calls | The retail client | Here |
  |---|---|---|
  | `agents.YesNo` (quit, decline, cancel research) | a Yes/No window | answered Yes |
  | `objectCaching.InvalidateCachedMethodCall` | forgets a cached answer; returns None | None; nothing is cached to forget |
  | `agents.SingleChoiceBox`, `agents.GetQuantity` (research) | a choice box, a quantity box | not answered |
  | `XmppChat.AskYesNoQuestion` (customs) | a Yes/No in chat | not answered |

- **The web client asks before Quit and before Decline.** Since the server's question is now
  answered for the pilot, the user has to be asked somewhere. The words are the web client's own;
  the server's are label IDs only the retail client can turn into text.

**Proof.**

- Tests, each watched to fail on the old code: seven new (five for the session, two for the
  pilot), and one for the web client's question. 24 ways of breaking the new session code, and 3
  of breaking the question: all caught, after one test was fixed that could not tell the call's
  user from the session's.
- Suite: 8880 tests, 8855 pass, 0 fail, 24 skipped, 1 todo.
- **Live, a quit on the game port** (Test Two, through the BFF's route). The server's log:

  ```
  [PKT] OUT agents YesNo() client-call callID=610001
  [PKT] IN  agents YesNo() response callID=610001
  [AgentMgr] Quit confirmation char=140000002 agent=3008416 responseType=boolean confirmed=true
             sameCharacter=true missionMatches=true atAgentLocation=true
  ```

  The route's answer was the conversation after the quit (`missionQuit: true`), with the
  provisional event, the standings change and the mission change beside it. The journal is empty.
- **In the browser, a decline on the game port.** Asked for a mission; pressed Decline and
  answered No: the question was shown, nothing was sent, the offer stayed. Pressed it again and
  answered Yes: one request, the server asked and was answered within a millisecond, the
  conversation went back to "Request Mission" with "Mission declined." under it, and the journal
  is empty.

**Cost to the test character:** the quit's standing event carried a change of -0.0409 with the
agent (leaving it at -0.539) and -0.0035 with the agent's corporation. The decline was the first in four hours and cost nothing.

**Not done:** the three calls in the table marked "not answered" (a research agent's choice and
quantity, and the customs question). Each needs the question shown in the browser and the answer
brought back, which the BFF has no way to do yet. Until then a call that sets one off waits two
minutes and fails as unanswered.

### Next

1. **A hosted bot's courier run end to end on the game port**, with a fresh mission, which closes
   Phase 4. Then the same trip by the browser's own autopilot.
2. **The server's questions shown in the browser**: a way for the BFF to put a question to the
   user and bring back the answer, then the three unanswered calls, and `agents.YesNo` asked
   rather than answered.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — a hosted bot flies a courier mission end to end on the game port

No code changed in this entry. It is the run Phase 4's "done when" asks for.

**The run.** Test Two (`test2`, on the game port by the check BFF's setting), docked at
Muvolailen with no mission. A hosted script of the seven courier blocks, saved and approved the
way the web UI's review step does it and started with `POST /api/bots/start`. The bot's own
account of it, read from `GET /api/bots` every five seconds:

| Seconds in | The bot says |
|---|---|
| 5 | Asking for work |
| 15 | accepting |
| 20 | Loading cargo |
| 25 to 250 | Flying the delivery (in warp four times) |
| 256 | Turning in |
| 261 to 481 | Heading back to the agent (in warp four times) |
| 486 | **Finished**: "The program finished, so the bot stopped." |

**The server's account of the same eight minutes** (its log, 09:52:02 to 10:00:07 UTC):

- the mission accepted: "Technological Secrets (2 of 3)", a transport to system 30000120;
- undocked from station 60000004; three gate jumps; docked at station 60001480; undocked;
  the same three gates back; docked at 60000004;
- every call of the run came in as a packet on the game port, and no browser session of the
  gateway's was started in that time. By name: 2 `ship.Undock`, 8 `CmdWarpToStuff`,
  6 `CmdStargateJump`, 2 `CmdDock`, 11 `DoAction`, 8 ballparks bound (two undocks and six
  jumps), 10 `GetAllInfo`;
- no error lines.

**The BFF's log** for the run has no ballpark failure and no unanswered call from the server.

**Afterwards:** Test Two is docked where it began, its journal is empty, the agent greets it with
"Request Mission", and its standing with the agent reads -0.434, up from the -0.539 the quit left
it at. (The last entry said the quit "lost 0.04 standing". What the server's event carried was a
change of -0.0409 and a standing of -0.539 after it; I should have quoted both.)

**What this does and does not show.** It shows the whole courier loop, from asking the agent to
docking back home, driven by a hosted bot over the game-port transport, with the pilot's own
ballpark as its view of space across two undocks and six jumps. It was one run of one mission.
It does not show the browser's own autopilot making the trip, which is next.

**Phase 4's "done when" is met**: the two-pilot comparison across a warp, jump and dock route is
in the entries above, and this is the hosted bot's courier mission. What is left of Phase 4 is
the list of things not yet read on the game port (the plan's table has them).

### Next

1. **The same trip by the browser's own autopilot** on the game port. The browser pane here is
   hidden and the page pauses its polling when hidden, so this needs the page told it is visible
   (a test trick, not a product change), or the operator's eyes.
2. **The server's questions shown in the browser**: a way for the BFF to put a question to the
   user and bring back the answer, then the three unanswered calls, and `agents.YesNo` asked
   rather than answered.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — the browser's own autopilot flies a trip on the game port

No code changed in this entry.

**The trip, in the web UI.** Test Pilot (`test`, on the game port by the check BFF's setting),
docked at Jita 4-4. In the Travel window: "Start route by ID" to Perimeter (30000144), and when
that had arrived, to the Jita 4-4 station (60003760). The requests below are the browser's own,
caught by wrapping the page's `fetch`; the states are what the Travel window showed.

| At (mm:ss) | The browser sent | The Travel window said |
|---|---|---|
| 04:07 | `flight/undock` | route to Perimeter, 1 jump |
| 04:10 | `flight/warp` to gate 50001249 at 0 | running · In warp |
| 05:01 | `flight/jump` 50001249 to 50002185 | running · Jumping |
| 05:05 | | **arrived · In space**, Perimeter, 0 of 1 jumps left |
| 05:22 | `flight/approach` gate 50002185 | route to Jita IV - Moon 4, approaching, closing in |
| 05:56 | `flight/jump` 50002185 to 50001249 | running · Jumping |
| 06:03 | `flight/warp` to station 60003760 at 0 | running · Warping, then In warp |
| 06:54 | `flight/dock` | running · Docking |
| 06:58 | | **arrived · Docked**, elapsed 1m 37s |

**The server's account of the same three minutes:** undocked 10:04:07, jumped 10:05:05, jumped
back 10:06:00, docked 10:06:58. Every call came in as a packet on the game port (1 `ship.Undock`,
2 `CmdWarpToStuff`, 2 `CmdStargateJump`, 1 `CmdFollowBall`, 1 `CmdDock`, 3 ballparks bound,
5 `GetAllInfo`), no gateway browser session was started, and there is no error line. The BFF's
log has no ballpark failure.

**How it was driven.** The browser pane here is hidden, and a hidden page stops polling space,
so the autopilot would have had nothing to decide on. Before selecting the pilot I told the page
it was visible (`document.visibilityState` and `document.hidden` redefined in the page, then a
`visibilitychange` event). That is a trick on the test's side; nothing in the product changed.
It is now in the brief's traps, since every browser proof of something in space needs it.

**What this shows:** the web client's own autopilot, deciding in the browser from the game-port
pilot's ballpark, makes a round trip with a warp, two jumps and a dock. One trip, one jump each
way. A hosted bot's six-jump courier run is in the entry above.

### Next

1. **The server's questions shown in the browser**: a way for the BFF to put a question to the
   user and bring back the answer, then the three unanswered calls, and `agents.YesNo` asked
   rather than answered.
2. **The scanner in space** on the game port (the one route that still answers 501 there).
3. Module damage and weapon banks from dogma; health from godma as the panel reads it.
4. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
5. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — the server's question shown in the browser, and answered by the user

Commit `1e324cd`, pushed.

**What the retail client does.** The server calls the client's `agents.YesNo` and waits; the
client puts up a Yes/No window; closing it is not a Yes (`agents.py` 404). The call that caused
the question stays open the whole time, held by the provisional answer.

**What was built.**

- **The BFF holds the question for the user.** When the server asks, and a browser is on that
  pilot's event stream, the question goes out on the stream as an event of its own kind
  (`question`: the service and method, the title and body as the server worded them, the agent,
  when it lapses) and the server is kept waiting. The user's answer comes back by
  `POST /api/bridge/questions/:id/answer`. When it is answered, lapses or the session ends, a
  `question-closed` event says so.
- **Who answers when.** A browser attached: the user, and anything but Yes is No. Nobody
  attached (a hosted bot): Yes at once, as before. A question nobody answers lapses after 110
  seconds as a No, ten seconds before the call behind it would give up.
- **The page shows it.** A bar across the workspace with the title, the body and Yes / No. The
  web client's own question before the press, added two entries ago, is gone again: the user is
  now asked once, by the server, after the press, as on the retail client.
- **A bot in the page answers for itself.** While one of the page's own bots is pressing an
  agent's button, the server's question about that agent is answered Yes and not shown.
- **The words.** The server words a question with localisation labels that only the retail
  client's data turns into text. The four it sends for quit and decline are worded in this
  client's own words; any other label is shown as the label.

**The live run found what the tests had not.** The first time, the answer was refused: the BFF
lets one write per pilot run at a time, the press was the write in flight, and the answer was
turned away as a second one (`CHARACTER_IN_USE`), so the press could never finish. My route
test had no write in flight. There is one now, which hung on the old code and passes: an answer
is the rest of the write that caused the question, and goes through. (The refused question then
did what an unanswered one should: it lapsed, the server was told No, and the offer stayed.)

**Proof.**

- Tests, each watched to fail or checked by breaking the code: 7 for the pilot's side, 3 for the
  route, 2 for the store, 6 for the question's decoding and words and the bot's presses, 4 for
  the flow. 57 ways of breaking the new code, all caught after one test was added.
- Suite: 8902 tests, 8877 pass, 0 fail, 24 skipped, 1 todo.
- **In the browser, on the game port** (Test Two, an offered mission, the page's own requests
  recorded):

  | | Pressed Decline, answered No | Pressed Decline, answered Yes |
  |---|---|---|
  | The question on the page | "Decline mission" and its body, Yes / No, about 0.1 s after the press | the same |
  | While it was open | the press still waiting; the conversation's buttons disabled | the same |
  | The answer | `{"answer":false}`, 200 in 7 ms | `{"answer":true}`, 200 in 4 ms |
  | The press, after the answer | finished 10 ms later | finished 34 ms later |
  | The BFF's log | "the server called agents.YesNo on the client, and was answered false" | "... answered true" |
  | Afterwards | the offer still in the journal | "Mission declined.", "Request Mission", nothing on offer |

**A server defect, found by answering No** (fixed and re-checked in the next entry). After a No to the decline question the server
answers the press with "This agent is unavailable." and no buttons. The retail client shows
whatever that answer holds (`agentDialogueWindow.py` 402), so a player who presses Decline and
then No is left with a dead-looking window while the offer still stands. The quit question's No
is handled properly in the same function. The fix is with a sub-agent as this is written (same checkout, no branch, no push); its result and the live re-check are in the next entry.

**A trap in the server's log, measured.** The line `[PKT] OUT agents YesNo() client-call` is not
stamped when the question is sent. In the second run above the question was on the page 0.1 s
after the press (28:48.5), and that line is stamped 28:54.214, the moment the answer arrived.
In the first run it is stamped 12.6 s after the press. I had begun to wonder what the server
was doing for 12.6 seconds; it was doing nothing, and I have not looked into why the line is
stamped late. It is in the brief's traps.

**Decisions taken in the operator's place** (both under "For the operator"):

- The web client no longer asks before Quit and Decline. On the game port the server asks; on
  the gateway nobody does, which is how it was before yesterday.
- A second decline inside four hours was spent on Test Two to prove the Yes.

**Not done:** a question that is open when a browser first connects is not shown to it (it has
110 seconds to live, and the stream only replays to a browser that was already connected). The
wiring of a page bot's press to its automatic Yes is covered by the helper's tests and by
reading; no test drives a bot through the flow. Research's choice and quantity boxes and the
customs question are still unanswered. The server's own words for a label.

### Next

1. **The three calls still unanswered**, on the same channel: `agents.SingleChoiceBox` and
   `agents.GetQuantity` (a research agent), `XmppChat.AskYesNoQuestion` (customs).
2. **The retail client's words**: turn localisation labels into the client's own text, from the
   client's localisation data, for questions and for what agents say (the conversation shows a
   raw label today).
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — the server fix for a No to the decline question

eve.js commit `624378554` on `main`, **not pushed** (by a sub-agent in the same checkout: no
branch, no worktree, only its two files staged). No change in this repository.

**The defect**, from the entry above: after a No to "decline this mission?", the server answered
the press with "This agent is unavailable." and no buttons. The retail client draws whatever
that answer holds (`agentDialogueWindow.py` 402).

**The fix** is the line the quit question already had: anything but a confirmed Yes answers with
the conversation as it stands (`doAgentAction(characterID, agentID, null, { session })`).

**Evidence, the sub-agent's:** a new test in `server/tests/agentMgrParity.test.js` asks for an
offer, presses Decline and answers the question five ways that are not Yes (False, None, an
empty response, no response, a truthy 1). Before the fix all five failed on
`[ 'This agent is unavailable.', null ]` (35 tests, 29 pass, 6 fail); after it, 35 of 35. Each
checks the answer is the offer with Accept, Decline and Defer, and that the mission's record is
untouched. A sixth checks Yes still declines; that one passed before and after, so the sub-agent
broke the confirmed check by hand to see it fail. Seven neighbouring test files still pass.

**Re-checked live, mine:** server restarted on the new commit (stopped without force, started
detached, listening in 15 seconds). In the browser on the game port, Test Two: asked for a
mission, pressed Decline, answered No. The conversation came back as **the offer, with Accept,
Decline and Defer**, the journal still lists it, and the press finished 9 ms after the answer.
Before the fix the same steps gave "This agent is unavailable."

**Seen by the sub-agent and left alone.** One measured, the rest read from the code:

- *Measured, through its harness:* with a **research** agent, a No brings back the agent's
  research screen (a greeting; View Mission, Buy Datacores, Cancel Research) and not the offer.
  The offer is unchanged and one press away.
- *Read only:* a referred mission can make that same read return a promise, which the answer
  builder would turn into "This agent is unavailable." again. The quit question's No has the
  same exposure.
- *Read only:* the decline question has none of the quit question's checks that the answer still
  belongs to the same pilot and the same offer by the time it arrives.
- *Read only:* when no client can be asked, a decline goes ahead and a quit does not.
- What a real server answers to a No is not in any capture in the repository, so the fix follows
  the quit question rather than a recording.

**Left as it is:** Test Two has an offer from Antaken Kamola open (not accepted). The server is
running on `624378554` (pid in the scratchpad's `evejs.pid`).

### Next

Unchanged from the entry above:

1. **The three calls still unanswered**, on the same channel: `agents.SingleChoiceBox` and
   `agents.GetQuantity` (a research agent), `XmppChat.AskYesNoQuestion` (customs).
2. **The retail client's words**: turn localisation labels into the client's own text, from the
   client's localisation data, for questions and for what agents say.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — a research agent's boxes and the customs question reach the user

Commit `3fe9b01`, pushed. **Built and tested; not yet seen live.** Read the last paragraph before
relying on it.

**What the retail client does**, from its source, and what the server sends, from eve.js:

| The server calls | The retail client | It answers | The server reads |
|---|---|---|---|
| `agents.SingleChoiceBox(title, body, choices, agentID)` (which field to research) | radio buttons, OK / Cancel (`agents.py` 437, `gameui.py` 817) | (OK pressed, the selected button's name), the name being `radioboxOption<n>Selected` counted from 1 (`radioButtonMessageBox.py` 48), on Cancel too | the name back into an index; not OK means nothing was hired |
| `agents.GetQuantity(maxvalue, minvalue, setvalue, caption, label, digits)`, keywords only (how many datacores) | a number box, OK / Cancel (`agents.py` 469, `uix.QtyPopup`) | the number, or None on Cancel | a number above 0, else "invalid input" |
| `XmppChat.AskYesNoQuestion(messageID, props)` (customs, over contraband) | a Yes/No dialog by message ID (`xmppchatsvc.py` 1745) | whether Yes was pressed | a boolean, within its own 30 seconds |

**What was built**, on the channel the last entries made:

- **Each is a kind of question**: `choice` (with what there is to choose from), `quantity` (with
  the server's limits), and the customs one as another `yesNo`. The answer goes back in the
  client's own shape.
- **Who answers when:**

  | | A browser attached | Left unanswered | Nobody attached |
  |---|---|---|---|
  | `agents.YesNo` | the user | No | Yes |
  | `agents.SingleChoiceBox` | the user | dismissed: not OK, first button | dismissed |
  | `agents.GetQuantity` | the user | None | None |
  | `XmppChat.AskYesNoQuestion` | the user | not answered | not answered |

  The customs question is the only one left unanswered on purpose: the server gives it thirty
  seconds and then decides for itself, which is what it does for a player who is not there.
- **A question now lasts no longer than the server will wait.** The server says how long with
  each call; the session passes that on, and a question expires at the sooner of that and this
  client's own 110 seconds. For customs that is 30 seconds.
- **An answer the question's own window could not have given is refused**, by the BFF and before
  that by the page: a choice outside the list, a fraction where a whole number is asked, a number
  outside the server's limits.
- **The page** shows radio buttons with OK / Cancel, or a number field with its limits and OK /
  Cancel. The research and customs labels are worded in this client's own words, with the names
  of what they are about (the skill, the datacore, the contraband, the faction) taken from the
  page's name cache.

**Proof.**

- Tests, built from the arguments eve.js sends (`researchRuntime.js`, `researchDialogue.js`,
  `customsInspectionPresentation.js`): 7 new for the pilot's side and 1 changed, 7 for the
  page's decoding, words and answers, 1 for the flow, and one more check in the session's. All
  the pilot's and the session's were watched to fail on the old code but one, which pins what the
  new code must keep (a question the server will wait a day for still lapses in 110 seconds).
- 61 ways of breaking the new code (33 in the pilot's side, 27 in the page's, 1 in the
  session's): all caught, after one fixture was given its keyword names as the wire carries them.
- Suite: 8917 tests, 8892 pass, 0 fail, 24 skipped, 1 todo.
- **Live, only this:** after the change, Decline then No in the browser on the game port still
  shows the server's question and keeps the offer (the server fix from the last entry in place).

**Not seen live, and why.** None of the three new questions has been raised by the running
server in front of this code. A research agent needs to be found, a test pilot put in its
station with the agent's field trained to the agent's level, and research started, bought and
cancelled. Customs needs contraband in a hold and a gate where customs scans. Neither is set up
on this server (the two stations the test pilots sit in have no research agent). **Until that
run, what is proven is that this code answers the calls as the server's own code builds them and
reads them, not that the server and this client agree in practice.** The last entry's live run
found a fault the tests had missed; this one may too.

### Next

1. **The research agent's boxes and the customs question, live**: stage a research agent with a
   qualifying pilot (start research, buy datacores, cancel), then contraband through a customs
   gate. Fix what that finds.
2. **The retail client's words**: turn localisation labels into the client's own text, from the
   client's localisation data, for questions and for what agents say.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — a research agent's boxes, seen live

Commit `92dd023`, pushed (names for the agent buttons the page did not know). The questions'
own code is unchanged from the entry above: **this run found no fault in it.**

**Staging** (GM commands through the page's own session, and one edit of the game store):

- Test Three, on the game port, moved to Iyen-Oursta III - Roden Shipyards Factory (`/tr me
  60010387`), where Harcarin Angamuere (3009373) is a level 1 research agent with two fields.
- Skills: both fields at level 1, and Science at level 5, which the server asks for before it
  offers research at all (`/giveskill me <typeID> <level>`; without Science the agent says
  "CharacterSkillsNotSufficient" and no box is raised).
- Research points: a datacore costs 100 and a new project earns 4.8 a day, so to see the number
  box I stopped the server, copied the game store aside (with its write-ahead log), moved the
  project's start back 300 days in `researchRuntimeState`, and started the server again.

**The run, in the browser** (the page's own requests recorded; the BFF's log beside them):

| Pressed | The server asked | On the page | Answered | The BFF told the server | Then |
|---|---|---|---|---|---|
| Start Research | `agents.SingleChoiceBox` | "Choose a field of research", two radio buttons with the skills' names and level, the first selected, OK / Cancel | the second, OK | `[true,"radioboxOption2Selected"]` | "ResearchStarted"; the project in the game store is on the second field (11450) |
| Buy Datacores | `agents.GetQuantity` | "Buy datacores", the datacore's name and price, a number field 1 to 14 showing 14, OK / Cancel | 15, then 2.5: refused on the page, nothing sent. Then 3, OK | `3` | "BoughtDatacores"; three datacores in the item hangar |
| Cancel Research | `agents.YesNo` | "Cancel research" and its warning, Yes / No | No | `false` | research still running |
| Cancel Research | `agents.YesNo` | the same | Yes | `true` | "ResearchCancelled"; Start Research offered again |

Each press stayed in flight until its answer. The two that were timed finished 13 ms and 29 ms
after their answers were sent.

**Seen on the way, and what was done:**

- **The page called a research agent's buttons "Action 12", "Action 13", "Action 14".** It knew
  9 of the client's 19 button kinds. All 19 are named now (`appConst.agentDialogueButton*`),
  with a test that was watched to fail.
- **After a No to cancelling research the agent says "DatacoreInvalidInput".** That is the
  server's choice of line for a No there (`researchDialogue.js`). I do not know what the retail
  server says, so it is recorded and not called a defect.
- **The server's log stamps the number box's call 1.95 s after the press**, and the answer was
  sent twelve seconds after that. I did not record when the box reached the page in this run, so
  I cannot say whether that stamp is late, as the Yes/No's was two entries ago, or true. The
  brief's trap stands as written: do not time by that line.

Suite: 8918 tests, 8893 pass, 0 fail, 24 skipped, 1 todo.

**Not done:** the customs question is still unseen live. It needs a ship with a hold (Test Three
is in a capsule), contraband in it, and a gate where customs scans.

**Left as it is:** Test Three is docked at Iyen-Oursta III with Science V and two level 1
research skills it did not have, three datacores, and no research project. The game store as it
was before the edit is in the scratchpad (`gamestore.before-research-backdate.sqlite` with its
`-wal` and `-shm`). The server is running, restarted twice this session.

### Next

1. **The customs question, live**: a ship with contraband through a gate customs scans. Fix what
   that finds.
2. **The retail client's words**: turn localisation labels into the client's own text, from the
   client's localisation data, for questions and for what agents say (the conversation shows raw
   labels such as "UI/Agents/Research/ResearchStarted" today).
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — the customs question, seen live

No code changed in this entry: **the run found no fault in the questions' code.** It found a
server difference at undock, which is the next unit.

**Staging.** Customs has a post at the Muvolailen gate to Maurasi (50016472), where Slaves
(3721) are contraband under Caldari law, and Test Two's Badger is docked one warp away. The
contraband has to be put aboard **in space** (`/giveitem 3721 10` through the page's own
session): the first ten, loaded in the station, were taken at undock (below). Then out to
Maurasi and back in through the gate, by the browser's own autopilot.

**The server rolls dice, and they kept coming up against me.** Customs selects an arrival for a
scan with chance 0.75 and then detects each stack with chance 0.75, both decided by a seed the
server stores with the case. Four arrivals with contraband aboard were not selected. I checked
each from the game store rather than guess: recomputing the roll from the stored seed gives
0.768, 0.994, 0.993 and 0.934 against 0.75, and the same recomputation agrees with the stored
outcome of all fourteen cases on the server (nine of those arrivals carried nothing). By the
server's code the roll depends only on the jump's random ID. Four misses in a row is a 1 in 256
event; I have recorded it and not explained it.

**The fifth arrival was scanned.**

| When (UTC) | What |
|---|---|
| 11:30:15 | the ship arrives at the gate; the server opens a case |
| 11:30:19.024 | the server calls `XmppChat.AskYesNoQuestion` (its log) |
| 11:30:19.159 | on the page: **"Caldari State customs has found contraband in your cargo: 10 × Slaves. Hand it over?"** with Yes / No, the faction's and the goods' names already filled in |
| 11:30:23.173 | Yes pressed; `{"answer":true}`, 200 in 5 ms |
| 11:30:23.177 | the server has the answer (its log); the BFF's log: "the server called XmppChat.AskYesNoQuestion on the client, and was answered true" |
| after | the case is "surrendered" with the answer true and one stack detected; the Slaves are gone from the hold |

(Here the server's stamp on its outgoing call is 135 ms before the page showed it, so that
stamp is not always late. The trap in the brief still stands.)

**With that, every call the server makes to the client today has been answered live** on the
game port: `agents.YesNo`, `agents.SingleChoiceBox`, `agents.GetQuantity`,
`XmppChat.AskYesNoQuestion`, and `objectCaching.InvalidateCachedMethodCall` by test only (the
server sends it when a saved fitting changes, which this loop has not done).

**Found on the way: the server takes contraband at undock without the warning the client is
built to show.** The retail client's undock catches a refusal named
`ShipContrabandWarningUndock`, asks OK / Cancel, and on OK undocks again with
`ignoreContraband` set (`ui/station/base.py` 488 to 510; a structure's undock does the same).
The server logs `ignoreContraband` and passes it nowhere (`shipService.js` `Handle_Undock`
calls `undockSession(session)` without it, and `space/transitions.js` 2562 would only hand it
back), never raises that refusal (the name does not occur in the server), and inspects on every
undock: the
log line `[Contraband] char=140000002 ... items=1 fine=37500 standingLoss=0.200`, and the ten
Slaves gone from the hold before the ship had moved. So a player undocking with contraband is
fined and loses the goods with no warning and no chance to cancel. Not yet handed off: raising
the refusal on the server and handling it in the web client have to land together, or a web
pilot with contraband could not undock at all. It is first in Next.

**What it cost Test Two:** a 37,500 ISK fine and 0.2 standing with the Caldari State at the
undock, the same again for the surrender at the gate (the case's own figures), and twenty Slaves
that were never its own. It is docked at Muvolailen again.

### Next

1. **Contraband at undock**: the server's warning (`ShipContrabandWarningUndock`, by a
   sub-agent, with the evidence above) and the web client's question and second attempt, together.
2. **The retail client's words**: turn localisation labels into the client's own text, from the
   client's localisation data, for questions and for what agents say.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — undocking with contraband: the warning, on the server and in the browser

Commits `5911ec3` and `cba50d1` here, pushed. eve.js commit `7282f54cc` on `main`, **not
pushed** (by a sub-agent in the same checkout: no branch, no worktree, its six files staged by
path).

**What the retail client does** (`ui/station/base.py` 488 to 510): it calls
`ship.Undock(shipID, ignoreContraband)`. Refused with `ShipContrabandWarningUndock`, it shows an
OK / Cancel dialog, and on OK undocks again with `ignoreContraband` set. With the dialog
suppressed it sends the flag the first time. A structure's undock does the same.

**The server** (the sub-agent's work):

- `ship.Undock` and `structureDocking.Undock` without the flag, with cargo the local law acts
  on, now raise that refusal **before anything is changed**: the pilot stays docked, with no
  fine, no standing loss, and the goods where they were. With the flag, or with nothing the law
  acts on, they behave as before. The two server-side callers that are not a client's undock are
  unchanged.
- **The dialog's parameter was read from the retail client's own data**, not guessed: dialog
  1552, a title of 19 characters and a body of 112, the body with one parameter, `item`. (The
  body was quoted here until 2026-10-08, when the client's text was taken out of this
  repository's files; `node scripts/client-words.js <client> dialog:ShipContrabandWarningUndock`
  shows it from an install.) (My
  brief had suggested the customs dialog's two; the same reading confirms those for the customs
  dialog and not for this one.) **Not verified:** what value a real server puts in `item`. The
  fix sends (UE_TYPEID, typeID) of the first such item, which the client shows as a type's name.
- Its tests: nine new, three of them failing before the fix with "Missing expected exception"
  and passing after; the six that passed before pin what must not change. It also broke the
  order on purpose (inspect, then warn) and saw the "nothing was touched" tests fail. Sixteen
  neighbouring files give the same counts before and after, three of them with the same
  failures as before.

**Here:**

- **The BFF's undock route takes `ignoreContraband`**, and answers that refusal as
  `CONTRABAND_WARNING` with the dialog's own sentence, the item named when the transport passed
  the refusal's values on (the game port does; the gateway only words it). The ship is left
  docked and free to undock on a second ask.
- **The game-port transport keeps a refusal's name and values** beside its words.
- **The Undock button asks**, in that sentence, and on OK undocks again ignoring the warning.
  Cancel stays docked and reports no failure.
- **The page's own automation** (autopilot, bots) undocks ignoring the warning, as the client
  does once the dialog is suppressed. Decision taken in the operator's place; it is under "For
  the operator".

I first wrote the BFF's words around the customs dialog's parameters, before the sub-agent had
read the real ones; `cba50d1` replaces that with the one real parameter and the client's own
sentence. The first commit's guess never met a live server.

**Proof.**

- Tests here: 9 new (3 for the route, 1 for the transport, 5 for the page), all but one watched
  to fail first; that one pins a refusal that is not the warning. 37 ways of breaking the code
  across the two commits: all caught, after a fixture was strengthened where two had slipped
  through (it could not tell a parameter found by name from one found by place).
- Suite: 8927 tests, 8902 pass, 0 fail, 24 skipped, 1 todo.
- **Live, in the browser on the game port** (server restarted on `7282f54cc`; Test Two docked at
  Muvolailen with ten Slaves in the hold; the page's requests recorded):

  | | Undock, then Cancel | Undock, then OK |
  |---|---|---|
  | Sent | `{"ignoreContraband":false}` → 409 `CONTRABAND_WARNING` | the same, then `{"ignoreContraband":true}` → 200 |
  | Asked | the dialog's sentence with "(Slaves)" for its item | the same, once |
  | The server's log | "Undock held for the contraband warning" | held, then `Undock(... ignoreContraband=true)`, then `[Contraband] ... fine=37500 standingLoss=0.200` |
  | Afterwards | docked; ten Slaves in the hold; wallet unchanged; no error on the page | in space; the Slaves gone; wallet down 37,500 |

- **Live, on the gateway** (the other check BFF, restarted on the new code): with the Slaves
  aboard the route answers 409 `CONTRABAND_WARNING` with the sentence and no item named, and the
  ship stays docked; with them moved back to the hangar it undocks.

**Seen by the sub-agent and left alone** (all read from code or data, none measured unless said):

- The dialog says "contraband somewhere", which suggests a real server warns about anything that
  is contraband anywhere. The fix warns only where the local law acts, as I asked.
- The client's data has a twin, `ShipContrabandWarningJump`, that the server never raises. The
  decompiled client only mentions the name at the two undock sites.
- The undock inspection, and so the warning, looks only in the cargo hold.
- A warned attempt still switches on the modules the client listed, before it is refused.
- ~~*Measured:* three test files in eve.js fail on unchanged source and are not in its baseline
  list (`customsInspectionLifecycle` 8, `harnessCustomsInspectionScenarios` 1,
  `harnessMissionScenarios` 4). Not looked into.~~ **Withdrawn later the same day:** the 8 and
  the 4 were what this loop's own live checks had left in the live store, which is those tests'
  baseline. See the entry "dialogs by name, and what my live checks had done to the server's
  tests".

**Still true after this:** once the player says OK, the server fines and confiscates at the
undock itself, with no customs ship having scanned anything. That is the server's own model of
inspection and was not in scope.

**Left as it is:** Test Two is docked at Muvolailen, 37,500 ISK poorer again, with ten Slaves in
its station hangar. Both check BFFs and the server were restarted and are running.

### Next

1. **The retail client's words**: turn localisation labels and dialog IDs into the client's own
   text, from the client's data. The sub-agent has shown the data can be read (the resource
   index, `dialogs.static`, `localization_fsd_en-us.pickle`); the web client still words
   everything else itself, and shows raw labels for what agents say.
2. **The scanner in space** on the game port (the one route that still answers 501 there).
3. Module damage and weapon banks from dogma; health from godma as the panel reads it.
4. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
5. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — the retail client's own words, read from the client

Commit `fb0f2fa`, pushed. The first half of the unit: the BFF can now give the client's text for
a label. **The web client does not use it yet**; that is the second half, and first in Next.

**What the retail client does.** A label such as `UI/Agents/StandardMission/DeclineMessage` is
looked up in two files of the client's own (`localizationBase.py` loads them): one maps every
label to a message ID, the other holds each message's text in one language, with typed
parameters such as `{[datetime]when}` or `{[item]skillID.name}` left in for the client to fill.

**Where the text comes from, and where it does not go.** It is read at run time from the
player's own installed client, found through the client's resource index. **None of it is
copied into this repository**: the tests use made-up texts in the files' real shape, and the
checking script prints sizes, parameters and a first few characters, not the text.

**What was built.**

- **A reader for Python pickle protocol 0**, which is what those two files are (I had expected
  the binary protocol; the first bytes said otherwise). It reads the opcodes they use and
  refuses any other by name.
- **The label lookup**: the client's index, the label table, the language file; a label answers
  with the client's template or null. Read once, the first time a label is asked for, in about
  0.55 s; only texts a label names are kept (31,814 of the 307,046 in the English file), which
  leaves 14 MB on the heap.
- **`EVEJS_CLIENT_ROOT`** names the client's folder (the one holding `tq` and `ResFiles`).
  Unset, there are no words and nothing is read.
- **`POST /api/words {labels}`** answers `{available, words: {label: template | null}}`, at
  most 200 labels a request.
- **`scripts/client-words.js <clientRoot> [label ...]`** checks an installed client.

**Proof.**

- Tests: 13 for the reader and the lookup, 3 for the route. The route's were watched to fail
  without it. The reader's and the lookup's are new files against new code, so they were
  checked the other way: 48 ways of breaking the code, all caught, after three tests were added
  where three had slipped through.
- Suite: 8943 tests, 8918 pass, 0 fail, 24 skipped, 1 todo.
- **Against the real client** (`scripts/client-words.js`): 31,855 labels, 31,814 with English
  text, read in 557 ms. Every label the server has sent this loop is found, with the parameters
  the server sends for it:

  | Label | The client's text takes |
  |---|---|
  | `.../StandardMission/DeclineMissionTitle`, `QuitMissionTitle`, `QuitMissionMessage` | nothing |
  | `.../StandardMission/DeclineMessage` | `{[datetime]when}` |
  | `.../Research/SkillListing` | `{[item]skillID.name}`, `{[numeric]skillLevel}` |
  | `.../Research/DatacorePrice` | `{[item]datacoreTypeID.name}`, `{[numeric]rpAmount}`, `{[numeric]iskAmount}` |
  | `.../DefaultMessages/RootAgentSays/GenericGreetings` | `{[character]player.name}` |

- **Live, through the BFF**: with the client's folder set, the route answers those labels with
  their templates (546 ms the first time, 3 ms after) and null for a label that does not exist;
  with it unset, `available` is false and every label is null.

**Two things the real text settles.**

- The decline question's `when` is the time before which another decline costs standing. This
  client's own wording ("within four hours") was a guess at that; the client's text says it with
  the server's own time.
- The line an agent says after a No to cancelling research ("DatacoreInvalidInput", noted three
  entries ago) is the client's "did not catch that" line. So the server answers a No there with
  the agent's line for input it could not read. Still not called a defect: I do not know what a
  real server says.

**Not done:** the browser asking for the words and filling the parameters; dialogs by ID (the
undock warning and the customs question are dialogs, not labels, and their text is found
another way, through `dialogs.static`); other languages than English, which the reader takes
but nothing chooses.

### Next

1. **The web client uses the client's words**: ask `/api/words` for the labels in view, fill the
   typed parameters (item, numeric, character, datetime) from the server's values and the page's
   names, and fall back to its own wording only where the client has none. First what agents
   say and the questions, which show raw labels or this client's guesses today.
2. **Dialogs by ID** from the client's `dialogs.static`, so the undock warning and the customs
   question are worded by the client too.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — the questions and an agent's lines, in the retail client's own words

Commit `c8e55ab`, pushed.

**What the retail client does.** For an agent's message, `agents.ProcessMessage` (`agents.py`
640) takes what the server sent, which is plain text, a label with its parameters, or a
message's number; adds the mission's keywords (asked of the agent) and the agent's own IDs
(`GetAgentArgs`, 609); and hands the label to `localization.GetByLabel`, which adds the player
(`localizationBase.py` 175) and fills the text's tags. The tags' grammar is in the client's
tokenizer (`localization/parser.py`): `{name}`, `{[kind]name.property}`, a choice of words
`-> "a", "b"`, and modifiers and settings after a comma.

**What was built.**

- **The tokenizer's grammar, and a filler for it** (`web/src/bridge/clientWords.ts`). Items,
  characters, organisations and places by name; numbers plain, grouped only where the text says
  so; times as the game writes them; a word chosen by a count; the case modifiers. **The client
  fills these in a compiled module I have not read**, so how each kind comes out is this
  client's reading and is marked as that in the file. Not done: a list of characters, a message
  inside a message, and a word chosen by gender (the first is taken; the page does not know
  anyone's).
- **The page asks for the words it needs** (`flow.requestWords`, `store.words`): batched, each
  label once, and nothing more once the BFF says it has no client to read.
- **The question dialog and an agent's line use the client's text first**, with the agent's IDs
  and the player added as the client adds them. This client's own wording stays for what the
  client has no text for, for the two dialogs that are not labels, and for a BFF with no client
  configured.

**Proof.**

- Tests: 11 for the grammar and the filling, 5 for the wording choice, 1 for what an agent says,
  1 for the store, 6 for the asking. They passed first time on new code, so they were checked by
  breaking it: 52 ways, all caught after two cases and one test were added where three had
  slipped through.
- Suite: 8967 tests, 8942 pass, 0 fail, 24 skipped, 1 todo.
- **In the browser, on the game port, with the client's folder set:**

  | Where | Before | Now |
  |---|---|---|
  | A research agent's greeting | the label `UI/Agents/DefaultMessages/RootAgentSays/GenericGreetings` | "Greetings, Test Three." |
  | Start Research: the box | this client's "Choose a field of research" and its own choices | the client's title and question, and its choices: "Electromagnetic Physics level 1", "Gallente Starship Engineering level 1" |
  | After Cancel | the label `UI/Agents/Research/DatacoreInvalidInput` | the client's line for it |
  | Decline: the question | this client's two sentences | the client's title, and its body beginning "If you decline a mission before 2026.10.08 12:39 you will lose", the server's time filled in, no tag left unfilled |

  The page asked `/api/words` once for each new set of labels, and not again.

**What the client's text shows about the server.** The decline question's text says the pilot
loses standing if they decline **before** the time given. The server gives the time of asking
(`sendAgentDeclineConfirmation(session, agentID, currentFileTime(), ...)`), so on the retail
client the sentence reads "before" the present minute, as it did here: pressed at 12:39, warned
about 12:39. The server keeps a decline timer for each agent (`declineTimersByAgentID`), which
is the time that sentence is about. **Not handed off**: I do not know what a real server does
when no timer is running (asks with some other time, or does not ask at all), and a fix that
guesses would be the kind of claim this log has had to take back. It is in the defects list as
seen.

**Not done:** a mission's own text. An agent offering a mission says a message's number
(Test Two's agent says "129932"), and the client fills that message with the mission's keywords,
which it asks the agent for. The BFF keeps only texts that a label names, so numbers are not
served yet.

### Next

1. **A mission's own text**: serve a message by its number, ask the agent for the mission's
   keywords (`GetMissionKeywords`) as the client does, and word the offer, the briefing and the
   completion with them.
2. **Dialogs by ID** from the client's `dialogs.static`, so the undock warning and the customs
   question are worded by the client too.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — a mission's own text

Commit `ed5623a`, pushed.

**What the retail client does** (`agents.py` 626 to 673). What an agent says when offering a
mission is a message's **number** with the mission's content ID beside it. The client asks the
agent once for that mission's keywords (`GetMissionKeywords(contentID)` on the bound agent),
and fills the numbered message with them, the agent's own IDs and the player.

**What was built.**

- **A text by its message ID** in the BFF's reader. These are among the 300,000 texts no label
  names, so the whole language file is kept from the first time one is asked for by number,
  and not before. Measured: about 90 MB of heap, against 14 MB for the labelled texts alone.
- **`POST /api/words` takes `messageIDs`** beside labels.
- **`GET /api/bridge/agents/:agentID/keywords?contentID=`** asks the bound agent for the
  mission's keywords.
- **The page** keeps the message's number from the conversation, asks for the text and, once
  for each mission, its keywords, and fills the one with the other.
- **The client's markup is shown as plain text.** The live run showed a literal `<br>` in the
  offer: the client's texts carry the client's own markup. A `<br>` is now a new line and any
  other tag leaves the words it wrapped.

**Proof.**

- Tests: 6 in the BFF (4 for the reader, 1 for each route) and 11 in the page; one changed. The
  BFF's were watched to fail on the code before. The page's passed first time, so they were
  checked by breaking the code.
- 42 ways of breaking the new code, all caught in the end. Four slipped through at first: two
  were in code that turned out to do nothing and was removed, two were closed with tests.
  **Five were not tried at all the first time**: a shell heredoc had eaten the backslashes in
  the text to look for, and my helper printed "0 caught" and nothing more. I noticed the zero;
  the helper now names every breakage it could not try. (Earlier runs through the helper all
  had caught-plus-survived equal to the total, so none hid this.)
- Suite: 8984 tests, 8959 pass, 0 fail, 24 skipped, 1 todo.
- **Live through the BFF** (Test Two's open offer, agent 3008416, content ID 2156): the
  keywords route answers eight (`objectiveLocationID` 60000004, `objectiveDestinationID`
  60000019, `objectiveQuantity` 1, `objectiveDestinationSystemID` 30002778, `objectiveTypeID`
  2595, `objectiveLocationSystemID` 30002780, `rewardTypeID` 29, `rewardQuantity` 13800), and
  the words route has message 129932.
- **In the browser:** the agent's line was "129932". It is now the mission's offer, 668
  characters with two line breaks, with "Muvolailen" where the text has
  `{[location]objectiveLocationSystemID.name}`, no tag and no markup left showing. The page
  asked for the keywords once and for the message once.

**Not done:** the client also fills messages inside messages (an agent's label whose parameter
is itself a mission text: `missionOfferText`, `missionBriefingText` and three more are named in
`ProcessMessage`). None has been sent to this client yet, so it is not built. The mission
briefing panel and the journal still show what they showed.

### Next

1. **Dialogs by ID** from the client's `dialogs.static`, so the undock warning and the customs
   question are worded by the client too. The sub-agent read that file once already
   (eve.js `7282f54cc`).
2. **The rest of a mission's words**: the briefing panel and the journal, and messages inside
   messages when one turns up.
3. **The scanner in space** on the game port (the one route that still answers 501 there).
4. Module damage and weapon banks from dogma; health from godma as the panel reads it.
5. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
6. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.

---

## 2026-10-08 — dialogs by name, and what my live checks had done to the server's tests

Commit `81f2c33`, pushed. In eve.js, by a sub-agent: `85042bbce`, not pushed.

**What the retail client does.** Some of what the server asks or refuses with is a **dialog by
its name**: `ShipContrabandWarningUndock`, and the customs question
`ChtCustomsConfiscationConfirmation2`. The client looks the name up in its dialog table
(`eveCfg.GetMessage`: `res:/staticdata/dialogs.static`, 4,221 dialogs), which gives the dialog's
kind, whether it can be suppressed, and the message IDs of its title and its body. Before it
fills those two texts it prepares the parameters (`cfg.__prepdict`, `FormatConvert`): every
value that is a tuple `(code, value[, value2])` is turned to text by its code. An owner (2), a
place (3) and a type (4) become their names; a quantity of a type (24) becomes the label
`UI/Common/QuantityAndItem` filled with both; a list (103) becomes its entries, each converted,
joined by the separator it came with.

**What was built.**

- **A reader for the client's FSD data** (`src/clientData/fsd.js`): the schema that ships beside
  a binary, and the binary read by it, for the node kinds the dialog table uses. Written from the
  client's own loaders (`fsd/schemas/loaders`). The real table reads in 15 ms.
- **A dialog by name** in the BFF's reader, and `POST /api/words` takes `dialogs`. A dialog's two
  texts are kept beside the labelled ones, so a dialog does not cost the 90 MB language file.
- **The undock warning** is the client's own body with its item filled in when the BFF has a
  client to read, and this client's own words when it has not.
- **The customs question** carries its dialog's name for its title and its body, and the page
  fills both from the parameters as the client prepares them. It had no title before.
- `scripts/client-words.js <client> dialog:<Name>` says what a dialog is and what its two texts
  take.

**The client's sentence is out of this repository's files.** The undock warning's sentence had
been written out in `src/server.js`, in two tests and twice in this log since commit `cba50d1`.
It is the client's text, and the rule here is that it is read from the install and not copied.
It is gone from the files; it is still in the history, which I do not rewrite.

**A server defect, found by reading and fixed by a sub-agent.** The customs question sent its
contraband as `(103, entries, "<br>")` with the entries in a **tuple** (a JavaScript array, which
the server's marshaller always sends as a tuple). The client's `FormatConvert` reads a tuple
given as a value as one more typed value to convert first, so it cannot word that:

- the bytes, encoded with the server's own marshaller: one entry goes out as opcode `0x25`, a
  one-tuple;
- the shape of the client's conversion, run in the client's own `python27.dll`: a tuple of one
  entry raises `IndexError`, of two or three raises `IndexError` further in, and a **list** of
  entries gives the text;
- the client's own caller builds a list (`eveCfg.py` 170).

So by the client's code the question raises inside the client and is never shown. **Not
observed:** I have not watched a running retail client do it. The fix (`85042bbce`) sends the
entries as a list; its test decodes the bytes and was watched to fail first. Nothing else in the
server builds such a list. The page reads either shape.

**Proof.**

- Tests: 31 new (15 in the BFF, 16 in the page) and ten changed. The BFF's were watched to fail
  on the code from before, all but the FSD reader's, which had no code before; those and the
  page's were checked by breaking the code.
- 118 ways of breaking the new code. 116 were caught, one more once a test was added for it,
  and the last was a guard that did nothing and was removed. None was left untried.
- Suite: 9016 tests, 8991 pass, 0 fail, 24 skipped, 1 todo. (32 more than last time: the runner
  counts the new helper file as one.)
- **In the browser, the undock warning.** Test Two docked with ten Slaves in the hold, Undock
  pressed: one request, 409 `CONTRABAND_WARNING`, and the page asked with a sentence of 112
  characters, the dialog's body with "Slaves" where its `{item}` is, no tag left in it. Answered
  Cancel: still docked.
- **In the browser, the customs question**, with the server on `85042bbce`:

  | When (UTC) | What |
  |---|---|
  | 13:44:19 | first arrival at the Muvolailen gate with ten Slaves aboard: not selected for a scan |
  | 13:47:39 | second arrival: selected, one stack detected |
  | 13:47:46.335 | the page asks `/api/words` for `dialogs: ["ChtCustomsConfiscationConfirmation2"]` and `labels: ["UI/Common/QuantityAndItem"]`; it gets a question with a title of 21 characters and a body of 330, and a label of 52 |
  | 13:47:46.989 | the question is on the page: the client's title, the client's body with "Caldari State" where its `{empire}` is, a blank line, and "10 x Slaves" where its `{contraband}` is; Yes and No; no brace and no markup left |
  | 13:47:50.984 | Yes pressed; `{"answer":true}`, 200 |
  | 13:47:51 | the server's case: surrendered, answer true |

  Before this entry the same question read, in this client's own words, "Caldari State customs
  has found contraband in your cargo: 10 × Slaves. Hand it over?", with no title.

**Not done:** a dialog with no title gets the client's title for its kind
(`TITLE_BY_DIALOG_TYPE`), and a suppressable one gets a "do not ask again" box; neither is here.
The other typed codes (dates, amounts, ISK, distances, group names, a message inside a message)
come out as nothing. The undock warning's own title is not shown (the page asks with a plain
confirm).

### A finding of mine, withdrawn: the server's red tests were my own doing

The entry "contraband at undock" lists, as measured, "three test files in eve.js fail on
unchanged source". That was true and it pointed the wrong way. eve.js's test runner copies the
**live** store as every test file's baseline, and its fixture pilots are the characters this
loop flies: Test Three is its default pilot, Test Two its second. What my live checks left in
the store is what those tests started from.

Measured today, each row a re-run of the file with the live server stopped:

| File | Then | What the failures found | After removing it |
|---|---|---|---|
| `customsInspectionLifecycle` | 22 of 23 failed (the sub-agent's run, with the live server running) | Test Two's hangar already held a stack of Slaves, mine, and the test's own grant merged into it ("granted nothing", in all 22) | 8 failed, none of them with that message |
| the same | 8 failed | 7 or 8 customs cases where 0 or 1 were expected; the store held 14, all from my runs today | 3 failed |
| the same | 3 failed | a customs notification already in Test Two's inbox, from my surrendered case | **0 failed** |
| `harnessMissionScenarios` | 4 failed, 6 skipped | "agent 3009373 offered nothing": the pilot's nearest level 1 agent was the research agent at Iyen-Oursta, where I had moved Test Three | **17 of 17 pass** with it back at Jita 4-4 |
| `customsInspectionRestart` | 2 of 3 failed (the sub-agent's run) | "persistence owner scheduler is active in another instance": the live server was running | 3 of 3 pass with it stopped |
| `harnessCustomsInspectionScenarios` | 1 of 4 failed | a different test on different runs, on the old source and the new alike | still 1; **not explained** |

**What I took out of the live store**, with the server stopped and the store copied first: the
stack of ten Slaves (trashed in the game), the 14 customs cases and the one contraband penalty
of today, three notifications of today in Test Two's inbox (two "standings lost", one customs),
and Test Three went back to Jita 4-4 by GM command.

**What I could not put back:** Test Two's wallet and its standing with the Caldari State after
two fines; Test Three's Science V, its two research skills and three datacores; Test Two's open
offer from Antaken Kamola. None of those made a test fail today.

**From now on a live check that stages anything is undone:** the store is copied with the
server stopped, the check is run, and the copy is put back. Today's customs check above was the
first done that way: the store is as it was before it. The brief says so.

### Next

1. **The rest of a mission's words**: the briefing panel and the journal, and messages inside
   messages when one turns up.
2. **The scanner in space** on the game port (the one route that still answers 501 there).
3. Module damage and weapon banks from dogma; health from godma as the panel reads it.
4. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
5. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does), Phase 3's hosted check and the session-less gateway calls.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — a mission's line in the journal, and its title

Commit `3236186`, pushed.

**What the retail client does.**

- **The journal** (`journal.py` 676 on) has one line for each mission: its state, the agent, the
  mission's **name** (a message by its number, filled with nothing), the mission's **type** (a
  label, wrapped in a second label when the server marks the mission important), and when it
  expires. `agentUtil.GetMissionExpirationAndStateText` chooses the state and the expiry.
- **The agent's window** (`agentDialogueWindow.py` 235 on) puts the mission's **title** above
  what the agent says whenever there is a mission between the two. It is filled like everything
  else the agent says about the mission.

**The decompiled source was wrong about the expiry, so I ran the real thing.** As printed, the
second half of `GetMissionExpirationAndStateText` sits one level too shallow, and every expiry
would end up as "expires in" with a date for a length of time. Rather than guess what was meant,
I took the module's compiled code out of the client's own archive (`code.ccp`) and ran that one
function in the client's own `python27.dll`, with stand-ins for the clock and the label lookup.
For a mission that is offered (the labels' names begin "Offer") or accepted or failed
("Mission"), it gives:

| The expiry | The label |
|---|---|
| more than a week and a minute away | `ExpiresAt`, with the time |
| more than a day away | `ExpiresAtExact`, with the time |
| a day or less away | `ExpiresIn`, with the time left cut down to whole minutes |
| **under a minute away** | **`DoesNotExpire`** |
| any time ago | `Expired`, and the state reads `StateOfferExpired` or `StateMissionExpired` |
| a time of zero | `DoesNotExpire` |
| no time at all | `UndefinedExpiration` |

and nothing for any other state. That is from 14 expiries for each of states 0 to 5 and 7, and
7 more at the edges for states 1 and 2. So a
retail player's mission with fifty seconds left reads as one that never expires; the page says
what the client says. `scripts/client-code.py` now does the taking-out, for the next time a
decompiled function looks odd.

**What was built** (the page only; nothing in the BFF changed).

- `web/src/bridge/journalWords.ts`: the journal line's words, chosen as above.
- The journal's line reads state, agent, name, type, expiry, in the client's own text when the
  BFF has a client to read. Without one it is in this client's own words, the type is the last
  part of its label, and a name that is only a message's number is left out, as before.
- The mission's title above what the agent says, and beside the briefing's heading, when the
  page has the client's text for it.

**Proof.**

- Tests: 14 new (9 for the words, 4 that draw the panel, 1 for the journal row), all in the
  page. The panel's were watched to fail on the panel from before; the rest were checked by
  breaking the code.
- 82 ways of breaking the new code. 76 were caught at once and 3 more once tests were added for
  them. One was a condition that did nothing and was removed, one made no difference and the
  code it was in was rewritten more simply, and one is left: a guard whose removal changes
  nothing that is drawn, only what is asked for. None was left untried.
- Suite: 9030 tests, 9005 pass, 0 fail, 24 skipped, 1 todo.
- **In the browser** (Test Two, its open offer from Antaken Kamola):

  | | Before | Now |
  |---|---|---|
  | The journal's line | "Courier · Antaken Kamola" | "Offered · Antaken Kamola · (the mission's name, 23 characters) · Courier · This offer expires at 2026.10.15 10:44" |
  | Asked of the BFF | nothing | one request: three labels and message 57959, all four found |
  | Above the agent's line | nothing | the mission's title, the same 23 characters |

  The agent's own line is the 668 characters it was, with Accept, Decline and Defer under it.
- **The live check was undone**: the store was copied with the server stopped before it and put
  back after it.

**Not done.**

- The journal's expiry is worked out when the line is drawn and from the browser's clock, not
  the server's; it does not count down.
- The agent's name without its level (the client shows both).
- The mission's time under the agent's line (`ThisMissionExpiresAt` and the two decline
  notices), the mission's picture, and the objectives pane in the client's words.
- Messages inside messages: still none has been sent to this client.

### Next

1. **The scanner in space** on the game port (the one route that still answers 501 there).
2. Module damage and weapon banks from dogma; health from godma as the panel reads it.
3. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
4. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — the scanner in space on the game port

Commit `2451cb1`, pushed.

**What the retail client does.** It is never handed a list of its scan probes. Its scan service
(`scanSvc.py`, with `probescanning/probeTracker.py`) keeps one from what the server tells it as
things happen, and from what it does itself:

| Told by the server | What the client does |
|---|---|
| `OnNewProbe(probe)` | holds it: idle, where it is, on the range step used last (7 to begin with) and that step's range |
| `OnRemoveProbe(probeID)` | drops it |
| `OnProbesIdle([probe, ...])` | each is idle and bound for where the server says |
| `OnProbeStateChanged(probeID, state)` | that state |
| `OnSystemScanStarted(start, ms, {id: probe})` | each is scanning, and is where the server says |
| `OnSystemScanStopped(probeIDs, results, absent)` | each is idle again |
| a change of system, ship or structure | no probes |

After its own `RequestScans` the probes it sent are "moving", and so are the ones a
`RecoverProbes` was answered with. A pilot that logs in with probes still out knows of none
until it asks to be reconnected to them. The launcher is godma's: the first online module of the
launcher group, and the charge at that module's flag, which is not an item with an ID but a
"sublocation" keyed by (ship, flag, type) whose `quantity` is how many are loaded.

**What was built.**

- `src/gamePort/pilotScanner.js`: that list.
- The pilot's dogma now keeps what each item is (its inventory row) and the charges in modules,
  takes the server's changes to a charge's count, and takes a single item told of after the ship
  was loaded (`OnGodmaPrimeItem`), which is how probes coming back to an empty launcher arrive.
- `readScannerState` on the game port answers the JSON the gateway answers, made from those
  two. It was the last pilot read that answered 501 there.
- **The scan calls go out as the client sends them** (`retailCalls.js`): `RequestScans` with
  `{probeID: probe}`, each a `util.KeyVal`, and the IDs to recall or to switch in a list.
- `scripts/record-probes.js` records a real probe flight; `test/fixtures/probeFlight.json` is
  one (a Reaper with a Core Probe Launcher I and eight probes: four launched, a scan, the four
  recalled).

**Three faults found by running it live.**

1. **Analyze could not be sent at all on the game port.** The route hands `RequestScans` a
   plain object keyed by probe ID, which the gateway took as JSON and the game port cannot
   marshal: 400, "Cannot marshal value". It now goes out in the client's form.
2. **"Reconnect to probes" never asked the server, on either transport, since 2026-07-28.** The
   branch that calls `ReconnectToLostProbes` had been put in the wrong function (commit
   `503b214`): the route refused with "no active probes" when none were known, which on the
   game port is always the case before a reconnect, and when some were known it fell through
   with nothing called.
3. **The wrong function was the board route's error handling**, where that branch made a board
   that failed after the server accepted it answer "kind is not defined" instead of its failure.
   Reproduced in a test, then fixed.

**Proof.**

- Tests: 31 new, all against the real recording where there is one. The ones for existing
  routes and files were watched to fail on the code from before (11, 2 and 1 of them); the
  rest were checked by breaking the code.
- 118 ways of breaking the new code. 109 were caught at once and 5 more once tests were added
  for them. One was a piece of code that could be written more simply, and was. Three make no
  difference: `>=` for `>` exactly at the edge of a probe's reach (the scale there is 1),
  not emptying a table whose rows nothing can reach any more, and treating `ConeScan`'s
  arguments as probes (they are numbers). None was left untried.
- Suite: 9060 tests, 9035 pass, 0 fail, 24 skipped, 1 todo.
- **The recorder against the real server**, on the game port: four probes launched (the
  server sent `OnNewProbe` four times, and the count in the launcher went 8 to 4), a scan (the
  server said started, then stopped with its results), four recalled (`OnRemoveProbe` four
  times, the count back to 8). What the list held at each step is in the script's output.
- **In the browser**, Scanner Center, Test Pilot on the game port:

  | Step | The route | The scanner afterwards |
  |---|---|---|
  | open the panel in space | `GET scanner/state` 200 (it was 501) | launcher: Core Probe Launcher I, 8 loaded, 8 to launch; no probes |
  | Launch probes | `POST scanner/launch` 200 | 8 probes, each idle, step 7, 16 AU; 0 loaded |
  | the BFF restarted (a new session) | | no probes known, as on the client after logging in |
  | Reconnect to probes | `POST scanner/reconnect` 200 | the 8 probes again, idle |
  | Analyze signatures | `POST scanner/analyze` 200 | 8 moving; idle again when the scan was over |
  | Recover probes | `POST scanner/recover` 200 | 8 moving, then none; 8 loaded again |
  | Launch, then Recover, again | 200, 200 | the same |

  The second launch is the check on the empty launcher: the first build showed nothing loaded
  after the probes came back, because the charge was new to godma and its changes were dropped.
- **The staging was undone**: the store was copied with the server stopped before Test Pilot
  was given the skill, the launcher and the probes, and put back after the last check.

**A difference from the gateway, on purpose.** The gateway's scanner state lists the probes
the server has stored for the pilot, so it shows them straight after logging in. The game
port's shows what the client would know: none until a reconnect.

**Not done.**

- Scan results are still read through the web client's own calls, not kept from
  `OnSystemScanStopped` as the client keeps them.
- Moving a probe and changing its range still go to the server (`SetProbeDestination`,
  `SetProbeRangeStep`), which the retail client never calls: it keeps both itself and sends
  them with the next scan. The list here is changed as the client changes its own, so what is
  shown is right; the calls are counted as the web client's own.
- A route's probes do not carry the `scanBonuses` the server sent, which the client sends back.
- The 5-minute wait between reconnects and the capsule's refusals are the server's to enforce
  here; the client checks both before asking.

### Next

1. Module damage and weapon banks from dogma; health from godma as the panel reads it.
2. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
3. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — the ship's health, its modules' damage and its weapon banks, from dogma

Commit `15de516`, pushed. In eve.js, by a sub-agent: `7d5dbb532`, not pushed by me.

**What the retail client does.**

- **Health.** The ship's own panel does not read the ballpark. It reads godma
  (`activeShipController.py` 92 to 133): shield is `shieldCharge / shieldCapacity`, armour is
  `(armorHP - armorDamage) / armorHP`, hull is `(hp - damage) / hp`, each shown rounded to
  hundredths. The ballpark's damage state is what everyone else is shown of the ship.
- **A module's damage** is its `damage` over its `hp` (`shipmodulebutton.py` 192), for a banked
  weapon the worst of its bank.
- **Weapon banks** are not attributes. `GetAllInfo` carries the ship's state, a tuple of
  (instances, charges by flag, weapon banks, heat), and the client makes the third its banks
  when the ship becomes its own. After that: `OnWeaponBanksChanged(shipID, banks)`,
  `OnWeaponGroupDestroyed(shipID, itemID)`, and the answers to its own grouping calls
  (`clientDogmaLocation.py` 763 to 801).

**What was built.** The pilot's dogma (`pilotDogma.js`) now gives all three, and the game
port's space snapshot says them. `moduleDamage` and `weaponBanks` were empty objects there,
which the page reads as "nothing damaged, nothing banked"; they are null when dogma could not
be asked, as on the gateway. The row everyone sees of the ship keeps the ballpark's health.

**A server defect, found by setting the two transports side by side.** A Reaper given the GM's
medium test damage and two grouped guns, read on the game port and then on the gateway:

| | Game port | Gateway |
|---|---|---|
| shield, armour | 1, 0.65 | 1, 0.65 |
| module damage | 0.18 on each of three | the same |
| weapon banks | the one bank | the same |
| **hull** | **0.9987** | **0.8** |

The server's `GetAllInfo` gave the ship `damage = 0.2` with `hp = 150`: the 0 to 1 ratio, where
the client reads hit points of damage (30). Armour and shield were sent in hit points. The
server's own ballpark, in the same second, said hull 0.8. So by the client's own formula a
retail player's panel showed a full hull on a ship at 80%. **Not observed** in a running retail
client. Fixed by a sub-agent (`7d5dbb532`); with it both transports read 0.8.

The sub-agent also reported, and left alone: station repair tells the client hit points worked
out from the hull type's base totals, not the fitted ones `GetAllInfo` carries (412 against
473.8 for a skilled pilot's Badger); the instance rows of the ship's state carry all four
health fields as ratios, where by the client's code they are base values in hit points; and
fitted module rows carry stray shield and armour attributes after the GM's damage command.

**Proof.**

- Tests: 8 new and 4 changed. Two are on a recording of the damaged ship from the fixed server
  (`test/fixtures/dogmaDamaged.json`): one holds godma's health to the damage state the
  server's own ballpark sent for the same ship, and it **failed on the recording made before
  the fix** (hull 0.9987), which is how the fixture is known to notice.
- 42 ways of breaking the new code. Three slipped through at first and were closed with tests.
  None was left untried.
- Suite: 9068 tests, 9043 pass, 0 fail, 24 skipped, 1 todo.
- **Each transport in turn, the same damaged ship, the server fixed:** identical, field for
  field: shield 1, armour 0.65, hull 0.8, capacitor 1, the three capacities, three modules at
  0.18, one bank.
- **In the browser, on the game port:** the ship's panel reads "SHIELD 100% ARMOR 65% HULL
  80%"; each gun's slot says "Banked: fires with 1 other. Damaged: 18%" and the afterburner's
  "Damaged: 18%". Before this entry the game port's rack said neither.
- **The staging was undone both times**: the store was copied with the server stopped before
  Test Pilot was given a skill, two guns and the damage, and put back after.

**Not done.** Rack heat (the panel's "heat not known"): the heat states are the fourth part of
the same ship's state and are not read yet. A banked weapon's damage is each module's own
here, as on the gateway, where the client shows the worst of the bank. The client's rounding
to hundredths is left to the page.

### Next

1. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
2. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
3. Rack heat from the ship's state, as the client reads it.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — rack heat, kept as the client's heat attributes keep it

Commit `836f1ef`, pushed. Taken out of order (it was third on the list): it finishes the
reading of the ship's state the last entry began, and it was small.

**What the retail client does.**

- **Heat is three attributes of the ship**, heatHi, heatMed and heatLow (1175, 1176, 1177),
  one for each rack, and they are the one reading the client works out for itself as time
  passes (`dogma/attributes/heatAttribute.py`). Each holds a value and the moment it was true.
  With nothing heating the rack the value falls by the rack's dissipation rate, and is nothing
  once it rounds to nothing. With heat coming in it climbs toward the rack's capacity, at what
  is coming in times the ship's heat generation multiplier.
- **The server sets the value.** An attribute change for one of the three is taken as true
  from the moment it arrives (`clientDogmaLocation.OnModuleAttributeChanges`,
  `HeatAttribute.SetBaseValue`).
- **The server says what is heating a rack.** `OnHeatAdded(heatID, moduleID)` adds that
  module's `heatAbsorbtionRateModifier` to what is coming in; `OnHeatRemoved` takes it off.
- **The gauge** shows value over capacity (`shipDogmaItem.GetHeatValues`).
- The heat states in `GetAllInfo`'s ship state, which the last entry said were "not read yet",
  are unpacked by the client and never used. They are not read here either.

How it was read: the decompiled source, and for the formula the client's own compiled
`CalculateHeat`, run in the client's Python for 16 cases. The decompiler prints a class's list
of notifications as numbers, so the names the dogma location registers for were read from
the compiled class: `OnHeatAdded` and `OnHeatRemoved` are two of its nine. That reading is a
script now, `scripts/client-notify-events.py`.

**What was built.**

- `pilotDogma.js`: `calculateHeat`, the three heat states of a ship that has racks, the
  server's word and the two notifications applied as the client applies them, and `rackHeat`.
- The game port's space snapshot says `ship.rackHeat`, `{ high, mid, low }` as fractions of
  each rack's capacity.
- The page: the decoder, and the rack's heat bar given the reading. The bar and its words
  were already there, saying "heat not known" for want of one. On the gateway, whose snapshot
  does not carry heat, they still say that.

Two places where this is the client's rule to within a hair and not to the letter. The client
leaves a rack alone when the server's number is what it already has, going by what its gauge
last worked out; here that is the heat as of now. And the client heats its current ship; here
it is the ship the module is fitted to.

**Proof.**

- Tests: 9 new, 5 changed. `calculateHeat` gives the client's own answer for all 16 cases, to
  one part in a million million.
- 73 ways of breaking the new code. Three slipped through at first and were closed with
  tests. None was left untried.
- Suite: 9077 tests, 9052 pass, 0 fail, 24 skipped, 1 todo.
- **Live, on the game port** (server at `7d5dbb532`): Test Pilot's Reaper, given
  Thermodynamics I, its civilian afterburner overloaded.

  | | Mid rack, from the snapshot |
  |---|---|
  | undocked, nothing running | 0 (and high 0, low 0) |
  | overloaded, 1 s, 10 s, 39 s | 0.038, 0.329, 0.781 |
  | stopped, then 23.3 s later | 0.853, 0.676 |

  0.853 falling to 0.676 in 23.3 seconds is the rack's own rate of 0.01 a second
  (0.853 x e^-0.233 = 0.676).
- **In the browser, on the game port:** the rack's line read "Mid 1% heat" a second after the
  overload, "25% heat" at eight seconds, the bar's width with it; after the stop "32% heat"
  falling to "30% heat" in eight seconds, the bar turning from warm to cool. High and Low read
  "0% heat" before the overload; they were not read during it. Before this entry all three
  read "heat not known".
- **The staging was undone**: the store was copied with the server stopped before Test Pilot
  was given the skill, and put back after; the store and its write-ahead log compare equal to
  the copies.

**A server defect, found by setting the model beside the live numbers.** While the afterburner
was overloading, the reading went down between the server's words: 0.7648, then 0.7572 a
second later, then 0.7694. The model was cooling the rack, because nothing had told it a
module was heating it: **EveJS never sends `OnHeatAdded` or `OnHeatRemoved`.** The client
registers for both. By its code a retail client's gauge does the same on this server. **Not
observed** in a running retail client. A sub-agent is fixing it; the outcome is in the next
entry.

**Seen, and left.**

- I let the first overload run on. The afterburner took 22.8% damage ten seconds in, still
  read that at forty, and was burnt out by the time I stopped it. Not checked against what the
  client's data says heat damage should be.
- When the browser brought the pilot online that my script had been flying, the BFF made a
  new session for it, and the mid rack that had read 0.68 read 0 for the fourteen seconds I
  watched. A new session loads dogma afresh, which starts every rack at nothing, as the
  client's does. Whether the server had also let the ship's heat go, or still had it and said
  nothing, was not checked.
- The words round and the colour does not: at 29.7% the line says "30% heat" in the cool
  colour.

**Not done.** Heat on the gateway. The page reads the rack at each snapshot and does not carry
it on between them.

### Next

1. **The server's heat notices on the game port**, once the sub-agent's fix is in: the rack
   climbing by the client's formula between the server's words, watched live.
2. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
3. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — the server's heat notices, and heat kept through a dock

Commit `21c55b5`, pushed. In eve.js, by a sub-agent: `10e2c22f4`, not pushed by me.

**The server fix.** EveJS now tells the ship's pilot `OnHeatAdded(heatID, moduleID)` when a
fitted module starts counting toward its rack's incoming heat and `OnHeatRemoved` when it
stops, once each way, so the modules the client holds as heating are the ones the server's
own sum counts. The sub-agent's report, which I did not re-run except where said:

- Nine new scenarios in `harnessOverheatingScenarios.test.js`, all failing on the old code at
  the first missing `OnHeatAdded`, all passing after.
- 190 other test files that touch heat, overload or module activation: 171 passed, 19 failed.
  It measured 17 of the 19 failing on unchanged source too (see "For the operator"). Two
  failed only when run eight at a time and passed alone.
- `superweaponParity` failed once in ten runs alone with the change and passed 13 of 13
  without it. I ran it 25 more times with the change: 25 passed. The assertion that failed
  compares a number of milliseconds worked out when a notification was sent with one worked
  out from the sim clock afterwards; they were 7 apart. Whether the change moves how often
  that happens is not settled by these numbers.

**What the sub-agent read in the client, and I checked.** Asked to make a ship active that is
already its current ship, the client's dogma location does nothing
(`clientDogmaLocation._MakeShipActive`), and the dogma location itself is only dropped on a
session reset (`clientDogmaIM`). So the client keeps its ship item, and with it the racks'
heat and what is heating them, through a dock, an undock or a jump in the same ship. The
last entry's model dropped the heat each time dogma was loaded again. It now brings the heat
to that moment and keeps it, and lets it go only when the ship is not among what is loaded
next (`21c55b5`).

**Proof.**

- The test for it was rewritten and watched to fail on the old code ("0.2 is not 0.6725").
  Nine ways of breaking the new rule, all caught.
- Suite: 9077 tests, 9052 pass, 0 fail, 24 skipped, 1 todo.
- **Live, on the game port, the server at `10e2c22f4`.** The call that started the overloaded
  afterburner came back with `OnHeatAdded` among its notifications; the one that stopped it,
  with `OnHeatRemoved`. Sixteen readings of the mid rack, half a second apart:

  | seconds in | snapshot | the client's formula from cold |
  |---|---|---|
  | 0.52 | 0.0222 | 0.0204 |
  | 4.11 | 0.1530 | 0.1514 |
  | 8.21 | 0.2812 | 0.2799 |

  None of the sixteen was lower than the one before. Before the fix the same overload gave
  readings that fell between the server's words. Stopped, the rack went from 0.3252 to 0.2910
  in 11.1 seconds, the rack's own rate.
- **A dock and an undock in the same ship:** 0.254 before docking, 0.144 on undocking about a
  minute later, and falling on from there (0.1437, 0.1423, 0.1408 a second apart).
- **In the browser:** the rack's line went from "Mid 0% heat" to "Mid 28% heat" in 8.2
  seconds, sixteen readings half a second apart, none lower than the one before, the bar's
  width with each; High and Low read "0% heat" at the end of it. After the stop, 32% falling
  to 30%.
- **The staging was undone**: the store was copied with the server stopped before Test Pilot
  was given the skill, and put back after.

**Seen, and left.**

- **The server lets a ship's heat go at a dock; the client does not.** After the undock the
  rack read 0.139 here. A new overload began, and the server's first word put it at 0.02: the
  server had started the ship from cold. By its code a retail client's gauge would make the
  same drop. Whether a real server keeps a ship's heat through a dock I do not know.
- From the sub-agent, measured in the harness and left: a hull its pilot ejects from goes on
  cycling its overloaded afterburner (the rack went from 7.69 to 42.88 in 12 seconds with
  nobody aboard); the capsule appears about 34 km from the hull; no remove is sent for a
  module that is unfitted while it heats (read in the code, not measured).

### Next

1. **Collisions**; **the park beside the server's movement log**; the sim clock; MISSILE,
   FORMATION, MUSHROOM.
2. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
3. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
4. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
5. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — collisions: a massive ball against other balls

Commit `6cb92f4`, pushed.

**What the retail client does** (CCP's destiny, `src/Ballpark.cpp` 2746 to 3006,
`src/Collision.cpp` 108 to 157, `src/Partition.cpp` 302 to 487).

- Each tick, for every ball that is free and massive, the park asks which balls are near
  (`Gradient`) and works out what each does to it (`Potential`). Both balls are carried a tick
  ahead on their own steering. If they touch on the way, the ball bounces: off a fixed ball its
  speed along the line between them is turned round; off a free one the two exchange it by
  their masses. If they overlap already, the ball is pushed clear, a metre over.
- The answer is not a new position. It is the steady acceleration that would get the ball
  there over the whole tick, damped to 0.85, added to the ball's steering when it is stepped.
  Of several balls touched in one tick, the one touched latest counts.
- What can be run into: balls that are massive, not cloaked, not on their way out, not
  missiles; a force field only by a stranger to it; wreckage only by wreckage.

**What this server sends**, measured over the four recordings: every free ball is sent *not*
massive, the pilot's ship among them. Of the 76 balls on the Jita 4-4 grid, 25 fixed ones are
massive and none carries collision shapes of its own. The station is one of the 25, a ball
100 km in radius; the ship undocks 34.6 km inside it. So on this server the client's
collisions run only when the client makes a ball massive itself, which it does to a ball
dropping out of warp (`Ballpark::WarpDistance`).

**What was built.** `Gradient`, `Potential`, `CollideTwoSpheres` and `Quadratic` in
`destiny/ballpark.js`, and the partition's filter for which balls count. Not the partition
itself: every ball is asked, in order of id, and a ball that touches two in one tick is
counted (`unported.collisionOrder`), since the order is the one thing the partition would
have decided. Not a fixed ball's own collision shapes, its miniballs, capsules and boxes: a
massive ball stepped while the park holds any is counted (`unported.minis`). Neither count
moved on any recording.

**Proof.**

- **CCP's own collision tests come out to the last digit**: two balls at one point pushed
  apart (10 ticks), two overlapping (10), two sent at each other, meeting and bouncing (20),
  both balls each time; and two warping through each other, which pass.
- Tests: 13 new, and the one test that had been waiting for this since the port began is now
  a test. Where CCP has no numbers (a bounce off a fixed ball, the push out of one, the
  exchange between unequal balls) the expected values are worked out in the test from what the
  collision means, with the integrator, not from the collision's own formula.
- 95 ways of breaking the new code. Eight slipped through at first and were closed with
  tests. None was left untried. One of the 95 is the breakage recorded in the first destiny
  entry as something "nothing can tell apart until collisions are ported" (committing each
  ball as it is stepped): it is caught now.
- Suite: 9090 tests, 9066 pass, 0 fail, 24 skipped, 0 todo.
- **The recorded warp, replayed.** At rest at the moon the park's ship is 0.17 m from where
  the server has it, as before. Back at the station it is now **413.2 m** away. See below.
- **Live** (server at `10e2c22f4`), the same trip flown again by the park and recorded: 0.06 m
  apart at the moon, **412.8 m** at the station.
- **From the browser's session, on the game port**, a warp to the station at 0. The snapshot
  the page reads, a second apart: in warp 216.4 m from the station's surface; out of warp
  43.5 m off, doing 54 m/s inward; then 33.5 m off, doing 30.9 m/s *outward*; at rest 185.9 m
  off. The page's own warp (the autopilot's, which lands 10 km off) touched nothing: at rest
  9,776 m off.
- **The staging was undone**: the store was copied with the server stopped before the
  flights and put back after.

**What the 413 m is, and a server defect.** The server keeps ships from colliding by sending
them not massive, and after a warp it says so again, twice, because the client has just made
the ship massive on its own. Counted from the first state, with D the tick the park posts
`OnDeactivatingWarp` at:

| landing | D | the server's "not massive" stamps |
|---|---|---|
| recorded earlier, at the moon | 37 | 37, 39 |
| recorded earlier, at the station | 106 | 106, 108 |
| today, at the moon | 37 | 38, 40 |
| today, at the station | 107 | 107, 109 |

The drop happens in the step from D to D+1, and an entry stamped S is applied before the step
that starts at S. So a stamp of D does nothing, D+1 is in time, and D+2 is one step late. In
three of the four landings the stamps were D and D+2: for one step the ship was a massive
ball. At the moon nothing was near. At the station it was 43.5 m from a massive ball and
flying at it: the park's ship touched 0.89 of the way through the step and was turned back,
and the server's ship coasted on to 225 m inside. In the fourth landing (D+1, D+3) the two
ended 0.06 m apart. The recorded stream replayed with the late entries stamped one tick
sooner leaves the two within a metre at both rests; that is a test.

By CCP's code a retail client does the same on this server. **Not observed** in a running
retail client, and the park is a port of the client's library and clock, not the client. A
sub-agent is looking at the server's side of it; the outcome is in the next entry.

**Seen, and left.**

- **The page's overview shows the distance between centres.** After the landing its row for
  the station read "101 km", for a station whose surface was 186 m away. The retail overview
  shows the distance between surfaces (`overviewNodeUtil.py` 87). Next on the list.
- The page's own warp is the autopilot's (`CmdWarpToStuffAutopilot`), ten kilometres off.
  What the client sends when a pilot picks "warp to" from a menu was not looked at here.
- Driving the pilot through the BFF's routes from outside the page's own controls left the
  page saying "Docked" until it was reloaded.

### Next

1. **The overview's distance, surface to surface**, as the client's overview reads it.
2. **The server's "not massive" after a warp**, once the sub-agent is back: the trip flown
   again, and the park's ship within a metre of the server's at the station.
3. **The park beside the server's movement log**; the sim clock; MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
4. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
5. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
6. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
7. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — the overview's distance, and why the server's stamps were left alone

Commit `869d6e6`, pushed. Nothing changed in eve.js.

### The overview's distance, between hulls

**What the retail client does.** Its overview shows, and sorts by, the distance from the
ship's surface to the object's, never below nothing: the centres' distance less both radii
(`overviewScrollEntry._GetSurfaceDistance`, `overviewNodeUtil.py` 87). The column words it in
three steps (`_GetColumnValueDistance`): whole metres under 10 km, whole kilometres under
10,000,000 km, AU to one decimal beyond, the figures grouped.

**What was built.** A row carries both distances now. The overview's rows, the line about the
picked row and the threat strip show the one between hulls, in the client's steps, and the
rows sort by it. Everything else that reads a row's distance still gets the centres': the
bots, the tactical view, the pickers.

**Proof.**

- Tests: 5 new. 25 ways of breaking the change, all caught, none left untried.
- Suite: 9095 tests, 9071 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, undocked by the page's own button: 94 rows. The
  station the ship had just left, whose ball it is still inside, reads "0 m". Then the
  sentry guns, "72 km", "84 km", "101 km"; farther out "1,094 km", "1,841,421 km",
  "3,249,759 km"; and from there "2.8 AU" to "42.5 AU". Before this the station's row gave
  the distance to its centre, some 65 km at the undock and "101 km" after the landing in the
  last entry.
- **The staging was undone**: the store was put back from its copy after the check.

**Not done.** The words for the units are this page's ("m", "km", "AU"), not read from the
client. The target bar, the selected item and the brackets show a distance between hulls in
the client too (`FmtDist`: the same steps, AU to two decimals); here they still show the
centres'.

### The server's "not massive" after a warp: looked at, and left alone

The last entry measured that after a warp the server's second "not massive" comes one step
late in three landings of four, and that the park's ship bounces off the station in that
step. A sub-agent was set to see whether a third entry, one tick after the first, could close
it. **It changed nothing, and was right not to.** What it found, each checked by me where
said:

- **The two stamps are not a bracket around an uncertain client.** The later one is the
  server's landing stamp, four ticks ahead of the session when it is written; the earlier is
  two before it, placed so that the client holds the later one in its queue. The server's own
  comment says the later one is there "before the next collision pass"
  (`space/runtime/scene/visibility.js` 5020 to 5023). By the measurement it lands one step
  after it.
- **A third entry cannot be sent as things stand.** The server lets exactly one update per
  landing go out beyond its ordinary ceiling of two ticks ahead
  (`delivery/postWarpDemotion.js`, `authority/destinyAuthority.js` 916 to 922), and its tests
  pin two entries, two ticks apart. Sent the ordinary way, an entry meant for the tick
  between came out stamped a tick early; sent with the one-off allowance, the whole landing
  was rolled back. (The sub-agent's measurement; I did not repeat it.)
- **A third entry would not be harmless to the client.** After applying one group of updates,
  if more than one is still queued, the client's park takes a step there and then
  (`michelle.py` 900 to 915; `destiny/park.js` 223 to 226 here). Two queued entries never
  do that; three do. The recorded warp replayed with three: the ship touches nothing, but the
  park takes two steps in one second at each landing and runs a tick ahead of the server from
  then on. (Re-run by me: the same.)
- Replayed with the two entries one tick apart instead of two, the recording is clean: one
  step a second, nothing touched, 0.07 m apart at the station. But that leaves a client that
  drops out one tick later than any of the four did with the ship massive until something
  else says otherwise, and no landing measured so far says whether that happens.

So there is no change that is plainly right. It is a choice about the server's landing
design, and it is the operator's. It is in "For the operator" and in the defects table as
found and not fixed.

### Next

1. **The other places the client shows a distance between hulls**: the target bar, the
   selected item, the brackets; and the words for the units read from the client.
2. **The park beside the server's movement log**; the sim clock; MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
3. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — a target's distance and the picked item's, in the client's wording and words

Commit `8eb1268`, pushed.

**What the retail client does.**

- Everywhere but the overview's column it words a distance with one function, `FmtDist`
  (`carbon/common/script/util/format.py` 192): whole metres under 10 km, except that a
  distance under a metre and not nothing keeps its decimals; whole kilometres under
  10,000,000 km; AU beyond, to the number of decimals the caller asks for, two by default.
- The target bar gives it `ball.surfaceDist` and takes the default
  (`bracketsAndTargets/targetInBar.py` 668 to 674). The selected item gives it the same
  distance and asks for one decimal (`selectedItemWnd.py` 587 to 592). The brackets take the
  default and say nothing at no distance (`bracket.py` 814 to 816).
- The unit is a label: `/Carbon/UI/Common/FormatDistance/fmtDistInMeters`,
  `fmtDistInKiloMeters`, `fmtDistInAU`, each with one parameter, the figure. The overview's
  column uses the same three.

**What was built.** `fmtDist` in `web/src/space/overview.ts`. A target's card now carries
the distance between hulls beside the one between centres and shows it by that rule; the line
about the picked row does too, at one decimal. The unit is put on by the client's own label
when the page holds it (`distanceWords.ts`; the overview asks the BFF for the three), and by
the page's own words when it does not.

**Proof.**

- Tests: 8 new. 44 ways of breaking the change; one slipped through and was closed with a
  test; none was left untried.
- Suite: 9103 tests, 9079 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, undocked by the page's own button. The page asked the
  BFF for the three labels and was answered from the client's install. The station's row,
  picked: "… · Station · 0 m". Locked with the panel's Lock button: its card reads "0 m", and
  to a screen reader "…, 0 m away". The ship was inside the station's ball; the card would
  have given the distance to its centre before.
- **The staging was undone**: the store was copied with the server stopped before the check
  and put back after.

**Not determined.** Whether the client writes a distance's decimals out in full ("2.80 AU")
or drops a trailing nought ("2.8 AU"). That is decided inside its number formatter,
`_evelocalization.FormatNumeric`, which is native code. It would not load into the client's
Python on its own: it needs `blue.dll`, the client's runtime. This page writes them in full,
here and in the overview's column. A target is never AU away, so the target bar is not
touched by it; the picked row and the overview's far rows are.

**Not done.** The brackets in the tactical view still give the distance between centres, in
the page's own steps. So do the show-info window, the pickers and the ship's readout of its
target.

### Next

1. **The tactical view's brackets**, the show-info window and the ship's readout of its
   target: the distance between hulls, by `FmtDist`.
2. **The park beside the server's movement log**; the sim clock; MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
3. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — the rest of the distances: the tactical view, show-info, the ship's line, the pickers

Commit `1ce00fd`, pushed.

**What the retail client does.** As in the last entry: a bracket, the selected item and the
rest give the ball's surface distance through `FmtDist`. A bracket says nothing at no
distance (`bracket.py` 814 to 816: `if distance:`).

**What was built.** The four places that still gave the distance between centres, in the
page's own steps, now give the one between hulls by `FmtDist`, with the client's word for
the unit when the page holds it:

- a bracket's label in the tactical view, and nothing at no distance (where the bracket is
  *drawn* still goes by its centre), and the view's spoken summary;
- the show-info window's "Distance", at one decimal as the selected item asks;
- the ship's line about what it is acting on ("Orbiting … at …");
- the hint beside each thing in a picker.

**Proof.**

- Tests: 7 new, 2 changed. The bracket's label is read off a stand-in canvas. 23 ways of
  breaking the change, all caught, none left untried.
- Suite: 9110 tests, 9086 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, with the ship orbiting a sentry gun:
  - the tactical view's summary: "94 objects on grid. Nearest Caldari Sentry Gun I at 33 km."
  - show-info, opened from the tactical view's own menu on a bracket: "Distance: 2.8 AU" for a
    customs office, "Distance: 114 km" for a gun, each the same figure as the picked row's;
  - the ship's line, in the phone layout where it lives: "Orbiting Caldari Sentry Gun I at
    44 km", then "at 43 km".
- Not read in the browser: the label drawn beside a bracket (it is on a canvas), and a
  picker's hint (no picker was opened). Both rest on their tests.
- **The staging was undone**: the store was copied with the server stopped before the check
  and put back after.

**Seen, and left.**

- **An approach reads "Under way."** on the game port. The ship's line names what the ship is
  acting on only for the modes it has words for (approach, orbit, keep at range, and so on),
  and the game port's ship says its mode as the park has it: an approach is FOLLOW. Pressed
  Approach, the line said "Under way."; pressed Orbit, "Orbiting … at 44 km".
- After Orbit the workspace's header still read "FOLLOW" while the ship's line read
  "Orbiting". Not looked into.
- The tactical view's "Nearest" goes by centres: it named the gun at 33 km while the
  station's hull was nearer.

### Next

1. **The ship's mode on the game port, in the words the page has**: an approach and a keep at
   range are the park's FOLLOW, and the ship's line and the header should say which.
2. **The park beside the server's movement log**; the sim clock; MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
3. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — what the ship is doing, said as the client's HUD says it

Commit `53760e5`, pushed.

**What the retail client does.** Its HUD carries a line about the ship's own manoeuvre: a
header and a line beneath. It is made from the pilot's own ball and nothing else
(`eve/client/script/parklife/spaceMgr.py`, `GetHeaderAndSubtextForActionIndication`):

- in ORBIT and following something: orbiting, whom, and at what range;
- in FOLLOW and following something: approaching (and whom) when the range in the order is
  50 m (`appConst.approachRange`) or none; keeping at range (whom, and the range) otherwise;
- the range is the one in the order, the ball's `followRange`, worded by `FmtDist` with no
  decimals. It is not how far off the thing is.

The words are six labels under `UI/Inflight/Messages`, a header and a line beneath for each of
the three.

**What was built.** The game port's snapshot gives the own ship's follow range (null when it
follows nothing). `web/src/space/actionIndication.ts` is the client's rule; the ship's line
and the workspace header are made from it, in the client's labels when the page holds them.
Where the snapshot gives no range, which is the gateway's, both say what they said before.

Found on the way: `FmtDist` asked for no decimals cuts a distance under a metre to nothing
(`int`), where the last entry's port rounded it. Corrected, with a test.

**Proof.**

- Tests: 11 new, 2 changed. 44 ways of breaking the change; two slipped through at first and
  were closed with tests; none was left untried.
- Suite: 9121 tests, 9097 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, a sentry gun picked and the page's own buttons
  pressed:

  | pressed | the header | the ship's line |
  |---|---|---|
  | (nothing, just undocked) | GOTO · 100% | Under way. |
  | Approach | Approaching · 100% | Approaching Caldari Sentry Gun I |
  | Orbit 5 km | Orbiting · 100% | Orbiting Caldari Sentry Gun I - 5,000 m |
  | Keep 10 km | Keeping at Range · 100% | Keeping at Range Caldari Sentry Gun I - 10 km |

  Before this the approach read "FOLLOW" and "Under way.". The words are the client's, read
  from its install through the BFF.
- **The staging was undone**: the store was copied with the server stopped before the check
  and put back after.

**Not done.** The rest of the client's rule: a ship going to a point or aligning (the ball's
GOTO, which needs the point it is going to and what the pilot last aligned to), a warp
(`IndicateWarp`), and the passing "ship stopping" the client shows when Stop is pressed. For
those the page still says its own ("Under way.", "In warp.", "Engines stopped."). The client
shows the header and the line beneath as two lines; here they are one.

### Next

1. **The rest of the ship's action line**: going to a point, aligning, the warp, stopping.
2. **The park beside the server's movement log**; the sim clock; MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
3. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — a ship flying to a point says so as the client's HUD does

Commit `d408ce4`, pushed.

**What the retail client does.** For a ship whose ball is in GOTO, with nothing the pilot last
aligned to, the HUD goes by how far the point is (`spaceMgr.py`, `GetBallApproachType`, and
the GOTO branch of `GetHeaderAndSubtextForActionIndication`):

- under a kilometre: nothing;
- up to 10,000 km (`appConst.maxApproachDistance`): "approaching", and beneath it
  "approaching a point in space";
- farther: "aligning", and beneath it "aligning to a point in space", for as long as the
  ship's course is more than 0.26 radians off the point; lined up, nothing.

**What was built.** The game port's snapshot gives the point the own ship is flying to (null
when it is doing anything else). `pointIndication` in `actionIndication.ts` is that rule. The
workspace header takes the client's header word. The ship's line takes the client's line
beneath, which says the whole of it, since the page has one line where the client has two.
With no point in the snapshot (the gateway's) both say what they said before.

**Proof.**

- Tests: 6 new, 3 changed. 30 ways of breaking the change, all caught but one that no input
  can tell apart: asking about the point before asking what the ship follows, which cannot
  differ because the two rules go by different modes of the ball.
- Suite: 9127 tests, 9103 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, read every 0.3 to 0.4 seconds and noted when it
  changed:

  | what was done | the header | the ship's line |
  |---|---|---|
  | undocked, flying straight out | GOTO · 100% | Under way. |
  | Align to a moon 2.1 radians off the course (the page's button), 1.6 s on | Aligning · 100% | Aligning to a point in space |
  | the same, 8.4 s on, lined up | GOTO · 100% | Under way. |
  | sent to a point 3 km to one side, 1.2 s on | Approaching · 100% | Approaching a point in space |
  | the same, 14.9 s on, within a kilometre of it | GOTO · 100% | Under way. |

  The words are the client's. A first try, aligning to a stargate, showed nothing: when I
  looked the ship's course was 0.002 radians off it, and I had read only every 1.5 seconds.
- **The staging was undone**: the store was copied with the server stopped before the check
  and put back after.

**Not done.** What the pilot last aligned to: the client remembers it (its menu service) and
names it in place of "a point in space"; here an align to a thing reads as an align to a
point. A warp, and the passing "ship stopping".

### Next

1. **The rest of the ship's action line**: what was last aligned to, by name; the warp
   (preparing, then active, with where to and how far); stopping.
2. **The park beside the server's movement log**; the sim clock; MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
3. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — a warp, said as the client's HUD says it

Commit `31854db`, pushed.

**What the retail client does** (`spaceMgr.py`: `IndicateWarp`, `StartWarpIndication`,
`CheckWarpDestination`, `OnBallparkCall`).

- The header is one of two: one while the ship lines up, which is while the ball's effect
  stamp is negative, and one once the warp proper has begun.
- Beneath it: where to, and how far. Three things go into that. The point in the server's
  `WarpTo`, which the space service keeps from the call. The thing the pilot asked to warp
  to, which the client notes from its own order before it sends it
  (`space.WarpDestination(celestialID=...)`, from the menu and from the autopilot). And a
  check that the two agree: the thing is named only if, from the ship, it lies within pi/32
  of the direction of the server's point, or within 20,000 km of it.
- The distance is to the thing when it is named and to the server's point when not, by
  `FmtDist`. With no point from the server the client says nothing at all.
- The client makes the check once, as the warp is ordered.

**What was built.**

- The park keeps the point of its own ship's `WarpTo` (`park.warpPoint`).
- The pilot on the game port remembers the thing its warp was ordered at, from
  `CmdWarpToStuff("item", …)` and `CmdWarpToStuffAutopilot`; a warp to anything else forgets it.
- The snapshot's ship says `warp`: lining up or not, the point, and the thing if the check
  passes. The check is made on each reading here, from where the ship then is.
- The page words it: the client's header, its destination line and its distance line, joined
  as the client joins them. Where the client breaks the line the page puts " · ".
- The header's mode word, when the client's rule has nothing to say, now comes from the
  snapshot before the flight status (see below).

**Proof.**

- Tests: 12 new, 2 changed. 60 ways of breaking the change. Seven slipped through at first:
  six were closed with tests, and one showed a check in the decoder that could never matter,
  which was taken out. None was left untried.
- Suite: 9139 tests, 9115 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, Jita IV - Moon 6 picked and the page's own "Warp to"
  pressed, read every 0.4 seconds:

  | seconds on | the header | the ship's line |
  |---|---|---|
  | 0.4 | GOTO · 100% | Under way. |
  | 2.8 | Establishing Warp Vector · 100% | Establishing Warp Vector · Destination: Jita IV - Moon 6 · Distance: 275,092 km |
  | 12.9 | Warp Drive Active · 100% | Warp Drive Active · Destination: Jita IV - Moon 6 · Distance: 275,090 km |
  | 26.2 | Warp Drive Active · 100% | … · Distance: 5,724 km |
  | at rest | STOP | Engines stopped. |

  The words are the client's, read from its install through the BFF.
- **The staging was undone**: the store was copied with the server stopped before the check
  and put back after.

**Found on the screen, and fixed.** At rest after the warp the header still said "GOTO" over
"Engines stopped.". The header took its word from the flight status, which the page reads
when something is ordered, not as the ship flies. It now takes the snapshot's first. The
"100%" beside it comes from the same flight status and was not touched.

**Not done.** The bar the client fills while the ship lines up. A warp ordered at a bookmark
or a fleet member, which the client names from the bookmark or not at all. What the pilot
last aligned to, by name. The passing "ship stopping".

### Next

1. **What the pilot last aligned to**, by name, as the client's menu remembers it; and the
   passing "ship stopping".
2. **The park beside the server's movement log**; the sim clock; MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
3. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
6. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.

---

## 2026-10-08 — what the pilot last aligned to, by name, and the passing "ship stopping"

Commit `75f49a0`, pushed.

**What the retail client does.**

- **The align.** Its menu keeps what the pilot last aligned to, a thing or a bookmark
  (`menusvc._AlignTo`, `StoreAlignTarget`). While that is kept and the ship's ball is in GOTO,
  the HUD says "aligning" and beneath it the thing's name, or a line of its own for a bookmark
  or for a thing it cannot name. It goes on saying so however near the point or lined up the
  ship is. It is forgotten when the pilot steers by hand (`cameraUtil`, `eveCommands`), and
  whenever the HUD's line is made and the ball is in any other mode (`spaceMgr.py` 695).
- **The stop.** On the pilot's own stop the HUD shows "ship stopping" as a passing
  indication (`eveCommands.CmdStopShip`), which lasts two seconds
  (`hud_action_indication_controller.py` 89) and sits over whatever else the HUD would say.

**What was built.**

- The pilot on the game port keeps the align from its own `CmdAlignTo`, forgets it on a
  `CmdGotoDirection`, and forgets it once the ship has been in another mode for three ticks
  of the park. The three ticks are mine: the order takes a tick or two to come back from the
  server as the ball's new course, and a ship ordered to align from a standstill is still
  stopped for that long.
- The snapshot says `alignTarget` while the ship is in GOTO. The page names the thing from
  what is in view, and words the line with the client's labels.
- The ship's line says "ship stopping" for two seconds after its own Stop button is
  answered, in the client's word.

**Proof.**

- Tests: 8 new, 2 changed. 39 ways of breaking the change; four slipped through at first
  and were closed with tests; none was left untried. One thing no test here can reach: that
  pressing Stop starts the two seconds. The rendered tests cannot press a button; they show
  that the line says the words while the two seconds run. The press is in the browser check.
- Suite: 9147 tests, 9123 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, read every 0.2 to 0.3 seconds and noted when it
  changed:

  | what was done | the header | the ship's line |
  |---|---|---|
  | undocked | GOTO · 100% | Under way. |
  | "Align to" Jita IV - Moon 12, 0.3 s on | Aligning · 100% | Aligning Jita IV - Moon 12 |
  | the same, 14 s on, lined up | Aligning · 100% | Aligning Jita IV - Moon 12 |
  | the HUD's Stop, 0.2 s on | Aligning · 100% | Ship Stopping |
  | 1.6 s on | STOP · 100% | Ship Stopping |
  | 2.0 s on | STOP · 100% | Engines stopped. |

  In the entry before last the same align read "Aligning to a point in space" and then
  nothing once lined up.
- **The staging was undone**: the store was copied with the server stopped before the check
  and put back after.

**Not done.** An align to a character, which the client words as the last place that pilot
was known to be. The client also says "aligning" at once on the order, before the server has
answered; here it waits for the ship's course to change. The header's "100%" still comes
from the flight status and read 100% over a stopped ship.

### Next

1. **The park beside the server's movement log**; the sim clock; MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
2. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
3. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
4. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
5. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
6. Small, in space: the header's speed from the snapshot; the bar the client fills while a
   ship lines up for a warp; a warp ordered at a bookmark or a fleet member.

---

## 2026-10-08 — the park beside the server's movement log

Commit `6a7230e`, pushed.

**What the retail client does** between two ticks (CCP's destiny, `ClientBall::InterpolatedPosition`,
`Ball.cpp` 1208). It does not draw a straight line between two places. A ball not in warp is
stepped again from where it was a tick ago, by the push that took it to where it is now, for
that much of the tick. A ball in warp is placed by the warp's own clock, which runs a tick
ahead of that: part way through a tick it is already on its way to where the next tick will put
it. The client also draws everything two ticks behind its own clock (`GetShiftedTime`).

**What was built.**

- `Ballpark.between(ball, fraction)`: that rule. Looking between ticks changes nothing in the
  park; in particular it does not end a warp.
- `scripts/park-against-movement-log.js <recording> <the server's movement log…>`. It plays a
  recording through the park and, for every row the server wrote of where it had the ship, says
  where the park's ship is at that instant: metres **apart**; how much **later** the park's
  ship is where the server's was, in seconds, found by moving the park's ship along its own
  path; and the metres between them at that **closest** moment, which is what is left once the
  clocks are made to agree. `--restamp=WarpTo:-1` plays the same recording as if the server
  had stamped its warp order a tick sooner.
- The two clocks are tied by the stamps alone: the server's stamp is its clock's whole
  seconds, and each row says how far into its second it was written.

**Proof.**

- Tests: 15 new. The script's are built on the recorded warp: rows made from where the park
  itself has the ship, displaced by known amounts, so what the script should say of each is
  known beforehand. 43 ways of breaking the change. Four got through at first: two are closed
  with tests, and two were one check written twice, the second copy of which is gone.
- Suite: 9162 tests, 9138 pass, 0 fail, 24 skipped, 0 todo.
- My own expectation was wrong once before the code was: in warp the place half a tick on is
  good to a hundredth of a metre against the next tick's, not to the last digit, because the
  heading is worked out from a different point on the line.

**Measured live.** Two round trips by Test Pilot on the game port, eve.js `10e2c22f4`, each
recorded with `scripts/record-warp.js` and set beside that hour's movement log. Trip A is the
recording of the collisions entry (Jita 4-4, Jita IV Moon 6 and back, 280,000 km each way, too
short to cruise). Trip B is new: Jita V and back, 11 AU each way, **cruising at 3 AU a second**
on the server and in the park alike. No entry failed and the park was never reset.

What the server's rows show of the server itself:

- Out of warp it steps a ship about nine times a second.
- **In warp it moves the ship once a second** and leaves it standing between. The speeds it
  wrote at those steps are the warp curve's at whole seconds (1,210.3, 24,309.3, 488,264.4,
  9,807,052.1 m/s: three times e to the 6, 9, 12, 15).

The park beside it:

| | Trip A | Trip B |
|---|---|---|
| Flying straight at 341 m/s: apart | 193 to 196 m | 18 to 21 m |
| the same: later | -0.57 s | -0.05 s |
| the same: closest | 0.0 m | 0.0 m |
| Lining up from rest (the way back): closest | 0.0 to 0.1 m | 0.0 to 0.1 m |
| the same: later | 1.4 to 1.7 s | 1.5 to 1.8 s |
| In warp, out: later | 0.9 to 1.0 s | 2.0 to 3.0 s |
| In warp, out: closest, first row to last | 616 m to 0.0 m | 123 m to 0.0 m |
| In warp, back: later | 1.8 to 2.0 s | 1.8 to 2.0 s |
| In warp, back: closest | 0.0 m | 0.0 to 0.1 m |
| Docked again, at rest: apart | 0.0 m | 0.1 m |

(In each trip two of the thirty-odd rows of the lining up from rest read about -2.2 s
instead: the park's ship had only just begun to move, and on so short a path the nearest
moment is not marked. They are left out of the row above.)

Read as: **the two ships fly the same path, and not at the same time.** On a straight course and
from rest the paths agree to the decimetre the server writes its places to. In every warp the
server's ship ran ahead of the park's, by one to three seconds. Where a warp was ordered with
the ship already under way (both trips, out), the two turned at different places and their
tracks ran 123 m and 616 m apart at the start of the warp, closing to nothing at its end.

The times of each warp, in seconds from the first state's stamp, the server's from its log and
the park's from the recording:

| Warp | Server: asked | Order's stamp | Server: warp began | Park: entered | Server: warp over | Park: left |
|---|---|---|---|---|---|---|
| A out | 4.76 | 6 | 15.19 | 16 | 36.02 | 37 |
| A back | 77.30 | 79 | 84.24 | 86 | 105.06 | 107 |
| B out | 4.24 | 6 | 4.53 | 7 | 38.05 | 41 |
| B back | 78.10 | 80 | 85.14 | 87 | 119.01 | 121 |

In B out the ship was already on course for Jita V when the warp was asked for: the server's
warp began 0.29 s later, and the order reached the park stamped 1.76 s after the asking.

**The measurement varied.** The same recordings played with the warp order stamped sooner:

| Warp, later in warp | As sent | 1 tick sooner | 2 sooner | 3 sooner |
|---|---|---|---|---|
| A out | 0.9 to 1.0 s | -0.09 to 0.0 | -1.1 to -1.0 | |
| A back | 1.8 to 2.0 s | 0.8 to 1.0 | -0.18 to -0.01 | |
| B out | 2.0 to 3.0 s | 1.9 to 2.0 | 0.9 to 1.0 | -0.11 to -0.03 |
| B back | 1.8 to 2.0 s | 0.8 to 1.0 | -0.19 to -0.01 | -1.2 to -1.0 |

Each tick sooner moves the park's ship one second on, and nothing else. So the park's ship
would have been where the server's was, to within two tenths of a second, had the order been
stamped one, two, three and two ticks sooner: not the same number from warp to warp. The track
of B out came 123 m, 73 m, 22 m and 28 m from the server's as the stamp went back; of A out,
616 m, 277 m and 63 m.

**What this does and does not say.** It does not say the park is wrong: the park is CCP's rules,
and a retail client fed the same stream steps the same way. It says the server's own ship and
the stream it sends its clients are one to three seconds apart in a warp, differently each
time, and that a ship turning into a warp does so on the server before the order's stamp lets
a client begin. I have not looked for why in the server's code. Two things already in this log
sit beside it and may be the same thing seen from elsewhere: the state stamped with the next
whole second, and the "not massive" after a warp that comes one step late in three landings of
four. It is under "For the operator".

**Not done.** The page still shows the ship where the last tick put it; `Ballpark.between` is
there for drawing it between ticks. The tick's collisions worked out step by step
(`mCollisionLocations`) are not ported, so a ball that bounced within the tick is placed
between ticks by one push and not by the two halves of its bounce. The recorder does not write
down what time it was when it began, so "apart" rests on the stamps, as said in the script.
Seen in passing and not read: the server sent one `DoSimClockRebase` and one
`OnSetTimeDilation` in each trip. That is the sim clock, next.

### Next

1. **The sim clock** (`DoSimClockRebase`, `OnSetTimeDilation`: what the client does with them,
   and when its park steps); MISSILE, FORMATION, MUSHROOM; a fixed ball's collision shapes
   and the partition's order, if a server ever sends a ball that needs them.
2. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
3. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
4. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
5. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
6. Small, in space: the ship drawn between ticks; the header's speed from the snapshot; the
   bar the client fills while a ship lines up for a warp; a warp ordered at a bookmark or a
   fleet member.

---

## 2026-10-08 — the sim clock

Commit `25025be`, pushed.

**What the retail client does.** It keeps two clocks. The real clock is the wall's; the sim
clock is the one the game runs by. The ballpark is shown the sim clock every frame and steps
once for each second of it gone by (`Ballpark::OnTick`, CCP's destiny): so under time dilation
a client's park steps more slowly, and a client that stalled takes at once every step it
missed. The very first frame is one bare step of the simulation, with nothing queued applied.
Dogma measures in the same clock (`gametime.GetSimTime`): a rack's heat, a capacitor's
recharge.

The clock itself is in the client's engine, CCP's `blue`, which is open source
(`blue/src/BlueOS.cpp`). It starts locked to the real clock. Freed
(`blue.os.EnableSimDilation`), it sets its own pace between two bounds, and goes from one pace
to another by a change set two real seconds ahead, so that whoever follows it can change at
the same moment.

**What the server does, which is eve.js's own and not CCP's.** A CCP server slows its clients
over its own network layer, which nothing on the game port speaks. eve.js does it with the
function it sends every client at login, which the client runs: that function frees the
client's clock and installs a handler for a notice of eve.js's own,
`OnSetTimeDilation(max, min, threshold)`, which sets the clock's bounds. The server sends the
notice with both bounds the same when a pilot enters space and when a system's time dilation
changes, and changes its own pace two seconds later. It also sends `DoSimClockRebase(old, new)`
at those moments; on that the client's michelle moves the park's own times by the difference
(`Ballpark::AdjustTimes`), and nothing else of the park's.

**What the client shows** (`tidiIndicator.py`): an indicator while the pace its clock is meant to
hold is under 0.98, with the pace as a whole percentage in its hint, cut and not rounded.

**What was built.**

- `src/gamePort/simClock.js`: blue's sim clock, ported: locked, freed, its bounds, the change two
  seconds ahead, and the easing by how well the clock keeps up. Not ported: a clock following
  a master's events over CCP's network layer, which nothing here sends.
- `src/gamePort/pilotClock.js`: a pilot's clock. We do not run the server's login function; a
  pilot whose session was sent the function we know, and answered as the client answers once
  the handler is in place, gets a clock that does what that client's does with the notice. Any
  other pilot's clock stays the real clock and the notice goes unheard.
- `Park.onTick(simTime)`, `adjustTimes`, `fraction`: the engine's driver. A pilot's park is
  shown its clock every 50 ms and steps by it; it is no longer stepped by a one-second timer.
  `DoSimClockRebase` moves the park.
- The pilot's dogma reads the same clock.
- The space snapshot says the pace (`timeDilation`), and the page's header shows it as the
  client's indicator does, with the client's own hint read from the install.

**Proof.**

- Tests: 26 new, 6 changed. 109 ways of breaking the change. Six got through at first: three
  are closed with tests; three change nothing that can be seen and are left (the two "last
  seen" times of the clock are only ever equal while a change is on its way; the pace a free
  clock holds and the pace it is meant to hold are the same number; adding nothing to the
  park's time when a rebase cannot be read).
- My own expectations were wrong twice before the code was, both about when a clock that
  keeps up eases back: the spell is counted from when the last change was set, not from when
  it came. The tests now say so.
- Suite: 9188 tests, 9164 pass, 0 fail, 24 skipped, 0 todo.
- **Live, on the game port**, eve.js `10e2c22f4`: Test Pilot undocked and given a new heading
  every three seconds, with two parks on the same stream, one stepped by the pilot's clock and
  one by a one-second timer as before. The system was set to half pace for 32 s (`/tidi 0.5`)
  and back.

  | | Stepped by the clock | Stepped by the wall |
  |---|---|---|
  | Full pace: steps in a second | 1 | 1 |
  | Full pace: an order's stamp, ahead of the park when it arrives | 1 tick, each time | 1 tick, each time |
  | Pace changed after the notice | two seconds on, both ways, to the second it was sampled at | never |
  | Half pace: the park's tick moved on, in 30 s | 15 | 16: stepped 30 times, and pulled back at each order |
  | Half pace: an order's stamp against the park (ten orders) | 1 ahead, ten times | 0, 1, 1, 2, 1, 2, 1, 2, 1, 2 behind |
  | Entries failed, resets | none, none | none, none |

  The park stepped by the wall ran ahead of the server and was taken back to the order's tick
  each time one came; it never lost its place outright because an order came every three
  seconds. The server's rebases at each change carried the same reading twice: a difference of
  nothing.
- **In the browser**, on the game port: no badge at full pace; 2.6 s after `/tidi 0.5` the
  header read "TiDi 50%" with the client's own hint (25 characters, read from the install);
  2.4 s after `/tidi 1` it was gone. The page made 30 calls after a reload and none failed.
- **The staging was undone**: `/tidi auto` after each check (the server then said factor 1.000,
  autoscale), and the pilot docked again. Jita ran at half pace for about a minute in all.

**Not done.** The page still shows the ship where the last tick put it (`Park.fraction` and
`Ballpark.between` are both there now). The session's own timer for its next change, and
godma's times of each module's last stop, which the client also moves on a rebase, are not
kept here. On the gateway a pilot has no clock of its own and the page shows no indicator.
The server's sim clock is now behind the wall's by what those spells took off it, as after any
time dilation; a pilot's clock made after such a spell starts from the wall's, as a retail
client's does. Whether a time the server sends in its own clock then reads late to that
client was not looked at.

### Next

1. **The ship drawn between ticks** (the snapshot's places by `Park.fraction` and
   `Ballpark.between`, so the page moves as the client draws); MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order, if a server ever sends a ball
   that needs them.
2. The call ledger (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the client
   does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
   layout of the agent's window), Phase 3's hosted check and the session-less gateway calls.
3. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
4. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
5. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
6. Small, in space: the header's speed from the snapshot; the bar the client fills while a
   ship lines up for a warp; a warp ordered at a bookmark or a fleet member.

---

## 2026-10-08 — the ship drawn between ticks, and its speed as the gauge says it

Commit `da1dd85`, pushed.

**What the retail client does.** It does not show or measure with the park's own places. Each
ball is drawn, and an overview row's distance and speed and the HUD's speed are read, from
where the ball is at that reading of the sim clock (`ClientBall::InterpolatedPosition`,
`GetValueDotAt`; `ball.GetVectorAt(simTime)`, `GetVectorDotAt(simTime)` from Python).

- Each step the engine's driver takes is handed the clock's reading at the step before it, and
  a ball keeps the last two. The client looks two ticks back from its clock. The two cancel:
  in the second after a step a ball is drawn from where it was to where the park now has it.
  **What is drawn is one tick behind what the park knows.**
- A ball no step has been timed for, a fixed one or one that has only just arrived, is where
  the park has it, with no speed to say.
- Steps taken to catch up or go back are not timed, so the drawing runs on between new places.
- A rebase of the clock moves every one of those times with the park's own.
- A ball that was there at the driver's very first step is drawn off its path for two ticks
  (a second early, then where the park has it). That is the source's, and is ported as it is;
  a real park is empty at that step.

The speed gauge (`speedGauge.py`, `activeShipController.py`) reads that speed fifty times a
second: under 100 m/s to one decimal, from 100 up in whole metres cut short, and in warp
mode, lining up or under way, the client's word for warping in brackets and no number. The
velocity it is handed is a single-precision vector.

**What was built.**

- `Ballpark.drawn(ball, simTime)`: the client's drawing of a ball, with the times a step
  leaves on a ball (`evolve(timestamp)`), `SetBallFree`'s, and `AdjustTimes` over all of them.
  The park's own time moved into the ballpark, where the source has it.
- The space snapshot of a pilot on the game port places every ball, and says its speed, as
  drawn at the reading of the clock its park is stepped by. The tick the snapshot names is
  unchanged.
- The header says the ship's speed the gauge's way, in the client's labels, from the
  snapshot's velocity taken in single precision. It replaces the throttle's percentage, which
  came from the flight status and could be minutes old; that stands in only when the snapshot
  has no ship.

**Proof.**

- Tests: 17 new, 4 changed. 64 ways of breaking the change. Five got through at first: four
  are closed with tests, and one was a guard in the header that did nothing, which is gone.
- Suite: 9205 tests, 9181 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, eve.js `10e2c22f4`:

  | what was done | what was read |
  |---|---|
  | undocked; the snapshot read 16 times, 200 ms apart | the ship 67.5 to 69.2 m further at every read, across three changes of tick: 337 to 345 m/s by the page's own clock. The snapshot used to move once a second |
  | the same, the header | GOTO · 341 m/s |
  | the HUD's Stop | STOP · 337, 306, 277, 250 ... 102 m/s, then 92.7, 84.0, 76.1 ... 10.4 m/s: a new number about twice a second |
  | "Warp to" a moon | Establishing Warp Vector · (Warping), then Warp Drive Active · (Warping) |
  | out of warp | STOP · 65.3 m/s, falling to 2.2 |
  | docked again | 30 calls after a reload, none failed |

  Before single precision was put in, the header read 340 m/s at top speed: the park's ship
  flies at 340.9999999999998, which cut to whole metres is 340 and in single precision is 341.
- **Nothing was staged.** The pilot was flown out to Jita IV Moon 6 and back, and docked.

**Not done.** An overview row's radial and transversal speed are worked out by the client
from the park's own places and speeds, not the drawn ones; the snapshot carries only the
drawn. The client's vector to a ball is single precision too (it is taken from the ship's
drawn place), which the page's distances are not. The order the engine's own length adds the
three squares in is not determined. On the gateway the snapshot is the server's, as before.
A speed that rounds to a whole number under 100 is written here with its decimal ("84.0"):
that is my choice, and what the client's own formatter writes there was not read.

### Next

1. **The call ledger** (`ship.Undock`, `dogmaIM.Activate` and `Deactivate` to bind as the
   client does; `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks
   on every layout of the agent's window), Phase 3's hosted check and the session-less
   gateway calls.
2. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
3. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
4. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
5. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
6. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order.

---

## 2026-10-08 — the call ledger: undock and a module's switch, made where the client makes them

Commit `d7d6c1d`, pushed.

**What the retail client does.** It asks almost nothing of `ship` or `dogmaIM` by the
service's name: in the whole client only `ship.GetShipFittingInfo`,
`dogmaIM.CreateNewbieShip` and `dogmaIM.GetRequiredSkillLevels` are. Everything else goes to
a moniker, an object bound for where the pilot is (`eveMoniker.py`): `GetShipAccess()` is
`ship` bound for the station or the solar system, `CharGetDogmaLocation()` is `dogmaIM`
bound the same way, and godma keeps that one and asks everything of it.

- **Undock** (`ui/station/base.py` 485 to 521):
  `GetShipAccess().Undock(shipID, ignoreContraband, onlineModules=...)`, where
  `onlineModules` is the ship's fitted modules whose online effect is running, by the slot
  each is in, `{flagID: moduleID}`, from the client's own dogma.
- **A module switched on** (`shipmodulebutton.py` 1309 to 1352, `godma.py` 2049 to 2071):
  `GetDogmaLM().Activate(itemID, effectName, target, repeats)`. The name is the module's
  default effect's, always. The repeats are 1000 for a module left to repeat, the pilot's own
  count if one was set, and 0 for an effect that cannot repeat: one with no duration, or on a
  module that forbids it.
- **Switched off**: `GetDogmaLM().Deactivate(itemID, effectName)`.

**What the BFF sent.** All three by the service's name. Undock with an empty list for the
online modules. Activate with no name unless the module was a launcher, and -1 for "go on".

**What was built.**

- The registry (`retailCalls.js`) can now say a call is made **on a moniker**, and that the
  pilot must have godma primed first. A call's shape is handed what only the pilot's own
  client would know: which modules are online, what a module's effect is called, whether it
  repeats. A call that cannot be completed that way is still sent, and counted as differing.
- A pilot keeps the monikers the client keeps, one for each service, bound on first use and
  let go when the pilot is somewhere else or the server lets the object go. Godma's own
  priming uses the same dogma location, where it used to bind one each time.
- The three calls go where the client sends them, on the game port, whichever way the BFF's
  route asked. Nothing changes on the gateway.
- The effect's name, when the route gives none, is the one effect of the module's type that a
  pilot switches on. Whether it repeats is the module button's rule.

**Proof.**

- Tests: 10 new, 4 changed. 53 ways of breaking the change; two got through at first and are
  closed with tests.
- Suite: 9215 tests, 9191 pass, 0 fail, 24 skipped, 0 todo.
- **Live, in the browser, on the game port**, eve.js `10e2c22f4`, read from the server's own
  log of what arrived:

  | | before | now |
  |---|---|---|
  | undock | `ship Undock()` | `ship MachoBindObject()` with `[60003760, 15]`, then `N=65450:66 Undock()` |
  | the afterburner switched on | by the service's name | `N=65450:65 Activate()`: effect `moduleBonusAfterburner`, target null, repeat 1000 |
  | switched off | by the service's name | `N=65450:65 Deactivate()`: effect `moduleBonusAfterburner` |

  `N=65450:65` is the dogma location godma was primed from a moment before. On the page the
  module lit half a second after the click, the header's speed climbed from 341 to over 443
  m/s, and fell back after the second click. The "before" for the two module calls is from
  the route's code and its test, not from a log line; the undock's is from the log.
- **The docked routes on both transports** (`scripts/bff-parity.js`, reads only, as Test
  Two): 12 identical, 6 tolerated, 2 moved, 2 divergent. The two divergent are the two there
  were before, the mission journal and the industry facilities, in the tuple spelling their
  readers take.
- **The ledger**, made again from that pass and the flight
  (`docs/game-port-call-ledger.md`): 74 pairs, 476 calls. 11 reshaped, 3 the same, 1 the web
  client's own, none differing, 59 not yet read against the client.
- **Nothing was staged.** Test Pilot undocked, ran the afterburner, and docked again.

**Not done.**

- The rest of `ship` and `dogmaIM`. By the server's log of the last two hours, three more
  still arrive by the service's name: `dogmaIM GetTargets()` (369 times),
  `ShipGetInfo()` (21) and `ShipOnlineModules()` (12). The routes for targeting,
  ammunition, onlining, drones, boarding and leaving a ship ask by name too and were not
  run. Each wants its call site read; then it goes to the moniker the same way. The other
  `dogmaIM` pairs in the ledger (`ItemGetInfo`, `GetTargeters`, the attribute queries) are
  already made on a bound object and are unread only as to their arguments.
- A module type with two effects a pilot could switch on is sent unnamed and counted as
  differing: the client tells them apart by a flag the BFF's static data does not carry.
- The pilot's own repeat count for a module (the client keeps one per module) is not kept.
- Undocking from a structure is another call (`structureDocking.Undock`) and was not read.
- `GetMissionBriefingInfo` and `GetMissionObjectiveInfo`, which the client asks on every
  layout of the agent's window, are as they were.

### Next

1. **The rest of the ledger's `ship` and `dogmaIM`**, as above; then
   `GetMissionBriefingInfo` and `GetMissionObjectiveInfo` asked when the client asks them;
   Phase 3's hosted check and the session-less gateway calls.
2. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
3. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
4. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
5. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
6. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order.

---

## 2026-10-08 — the call ledger: the rest of `ship` and `dogmaIM` on their monikers

Commit `8619393`, pushed.

**What the retail client does**, each read at its call site:

| Call | Where | As the client sends it |
|---|---|---|
| `GetTargets` | `godma.py` 2361 | `GetDogmaLM().GetTargets()` |
| `AddTarget`, `CancelAddTarget`, `RemoveTarget` | `targetMgr.py` 1366, 1303, 1385 | `GetDogmaLM().X(targetID)` |
| `SetModuleOnline`, `TakeModuleOffline` | `clientDogmaLocation.py` 702, 718 | `X(the ship the module is in, moduleID)` |
| `LoadAmmo` | `clientDogmaLocation.py` 996 | `LoadAmmo(shipID, [modules], [charges], where the charges are)`: two lists |
| `UnloadAmmo` | `clientDogmaLocation.py` 1140, 1127 | the modules as a list; with a quantity, one module by itself |
| `LaunchDrones` | `eveMisc.py` 29 | `GetShipAccess().LaunchDrones([(itemID, quantity), ...], whoseBehalfID, ignoreWarning)`, with None for whose behalf unless it is someone else's |
| `ScoopDrone` | `droneFunctions.py` 195 | `GetShipAccess().ScoopDrone(droneIDs)` |
| `LeaveShip` | `ui/station/base.py` 248 | `GetShipAccess().LeaveShip(shipID)` |
| `GetShipConfiguration` | `shipConfigSvc.py` 51 | `GetShipAccess().GetShipConfiguration(shipID)` |

Two reads the web client makes are not the client's at all. `ShipGetInfo` is nowhere in the
client: what it knows of its ship is in `GetAllInfo`. `ShipOnlineModules` has a wrapper in
godma that nothing calls and that throws the answer away; eve.js answers it with the online
modules, and the BFF reads that.

**What was built.**

- The rule is the services', not each entry's: on the game port **everything** asked of `ship`
  or `dogmaIM` by name is made on the moniker, read against the client or not, but the three
  the client itself asks by name. A pair nobody has read goes there with its arguments as the
  BFF spelt them, and is still counted unread.
- Entries for the twelve above and the two reads. Eight are the client's arguments as they
  stood. Reshaped: ammunition's lists, one module by itself when a quantity is named,
  drones' list of stacks and nobody's behalf, and the ship's ID for its configuration, which
  the BFF's route did not send.
- A call asked by name and made on the moniker is counted as reshaped even when its
  arguments were already the client's; on a handle the BFF bound itself it is counted as the
  same.

**Proof.**

- Tests: 8 new, 2 changed. 35 ways of breaking the change, each caught.
- Suite: 9223 tests, 9199 pass, 0 fail, 24 skipped, 0 todo.
- **Live, in the browser, on the game port**, eve.js `10e2c22f4`: the afterburner taken
  offline and put online while docked, the ship's configuration read, undock, a lock on the
  station and an unlock, dock. By the server's log of what arrived in that hour:

  | | by the service's name | on a bound object |
  |---|---|---|
  | `GetTargets` | 0 (369 in the two hours before) | 57 |
  | `ShipOnlineModules` | 0 (12 before) | 3 |
  | `ShipGetInfo` | 2 | 3 |
  | `AddTarget`, `RemoveTarget` | 0 | 2, 1 |
  | `SetModuleOnline`, `TakeModuleOffline` | 0 | 1, 1 |
  | `GetShipConfiguration`, `Undock` | 0 | 1, 1 |

  The two `ShipGetInfo` still by name are the transport's own, made when a pilot is
  selected, and not through this path. The first lock, on a sentry gun 73 km off, was
  refused by the server as out of range; the lock on the station held, and the unlock
  released it.
- **The docked routes on both transports** (`scripts/bff-parity.js`, reads only, as Test
  Two): 12 identical, 6 tolerated, 2 moved, 2 divergent, as before.
- **The ledger**, made again (`docs/game-port-call-ledger.md`): 78 pairs, 461 calls. 16
  reshaped, 3 the same, 3 the web client's own, none differing, 56 unread.
- **The staging was undone**: the module is online again as it was, the target unlocked, the
  pilot docked.

**Not checked live.** Ammunition, drones and leaving a ship: Test Pilot's Reaper has no
charges to load and no drones, and leaving it was not tried. Those three stand on their
tests.

**Not done.** The transport's own `ShipGetInfo` at select, by name. The BFF's bound-dogma
route asks `GetRequiredSkillLevels` on the bound object, where the client asks that one by
the service's name. The other writes on these two services (eject, jettison, drop,
overload and the rest) now go to the moniker with their arguments unread.

### Next

1. `GetMissionBriefingInfo` and `GetMissionObjectiveInfo` asked when the client asks them
   (on every layout of the agent's window); Phase 3's hosted check; the session-less gateway
   calls.
2. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
3. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
4. More of a mission's words: the objectives pane, the mission's time under the agent's line,
   messages inside messages when one turns up.
5. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
6. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
7. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order.

---

## 2026-10-08 — the agent's window, opened and laid out as the client's

Commit `8dd65a9`, pushed.

**What the retail client does** (`agentDialogueWindow.py`).

- **Opening** (`_GetConversation`, 402 to 411). It asks the agent what it has to say
  (`DoAction(None)`). If the first thing on offer is to request a mission or to view one, the
  window presses that at once and shows what comes of it, unless the agent has other business
  too: a research agent, or one that locates characters, with more than that one thing on
  offer.
- **Every layout** (`ReconstructLayout`, 210 to 219), after opening and after every button:
  it reads where the agent is (`GetAgentLocationWrap`, for its header), the mission's
  briefing (`GetMissionBriefingInfo`, for the title, the time and the picture), and the
  objectives (`GetMissionObjectiveInfo`), in that order.
- **The objectives are shown** unless the last action completed the mission, declined it, quit
  it, or was answered "not yet" (`GetObjectiveHTML`, 221 to 225). So an offer's objectives
  are on show before it is accepted.

**What the page did.** Opening showed "Request Mission" as a button to press. The briefing was
read only after an accept, with the three reads asked in another order, and cleared again on
opening, so a mission already offered or accepted showed nothing until something was pressed.

**What was built.**

- Opening makes the client's press. An agent the roster does not have is pressed for only
  when the mission is all there is, since the client always knows what kind of agent it has.
- Every layout reads the three again, in the client's order (the BFF's route asked for the
  briefing first), and shows the objectives by the client's rule.
- The title above what the agent says is the briefing's when one is held, as in the client,
  and the journal's otherwise. After the window's own press the journal is read again.
- An offer's briefing is on show without the two buttons for the package, which is only
  handed over on accepting.

**Proof.**

- Tests: 12 new, 2 changed. 37 ways of breaking the change; one got through at first and is
  closed with a test.
- Suite: 9235 tests, 9211 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, eve.js `10e2c22f4`, as Test Two with its courier
  agent, read from the page and from the server's log of what arrived:

  | what was done | the page | the server's log |
  |---|---|---|
  | the agent clicked, a mission already on offer | Accept, Decline, Defer; the mission's title; the briefing as an offer, no package buttons | `DoAction`, `GetAgentLocationWrap`, `GetMissionBriefingInfo`, `GetMissionObjectiveInfo` |
  | Defer | the same offer, read again | |
  | Decline, and Yes to the server's question | Request Mission; "Mission declined."; no briefing; nothing in the journal | |
  | the agent clicked again | a new offer, with its title and briefing, and in the journal | `DoAction`, `DoAction`, then the same three reads |

  The second `DoAction` in the last row is the window's own press: nothing was clicked on
  the page but the agent. In the first row eve.js answers the opening with the offer itself,
  so there was nothing for the window to press.
- **The staging was undone**: the store was copied with the server stopped before the check
  and put back after, and the journal again holds the offer it held before.

**Not done.** The window does not lay itself out again when the server says the mission has
changed (`OnAgentMissionChange`) or when the pilot changes station, as the client's does.
The objectives pane is still the courier's table: a mission that is not a courier has a
conversation and a title and no objectives. The mission's time and picture under the
agent's line are not shown. The agent's place is read and not shown. The hosted mission
bot talks to agents by its own calls and was not changed.

### Next

1. Phase 3's hosted check; the session-less gateway calls.
2. The agent's window: laid out again on `OnAgentMissionChange` and a change of station;
   the objectives of a mission that is not a courier; the mission's time under the agent's
   line; messages inside messages when one turns up.
3. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
6. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
7. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order.

---

## 2026-10-08 — what the client asks before a character is chosen, asked as the account

Commit `f50c742`, pushed.

**What the retail client does.** On its character selection and creation screens it is logged
in as the account and nothing more, and what those screens need it asks of `charUnboundMgr`
by name, all on the one connection it later chooses a character on:

| call | where | what is sent |
|---|---|---|
| `GetCharacterSelectionData` | `characterSelection.py` | nothing |
| `ValidateNameEx` | `chooseNameSection.py:201` | `(charName, how many names the screen has checked before)` |
| `CreateCharacterWithDoll` | `ccSvc.py:97` | ten: `(name, raceID, bloodlineID, genderID, ancestryID, charInfo, portraitInfo, schoolID, None, qaStarterSystemID)` |
| `GetCharCreationInfo` | nowhere | the client never asks; races and bloodlines are in its own static data |

**What the BFF did.** With no pilot held, those four went to the web gateway on a session
naming the account, whatever transport the account's pilots were on. They were the last calls
of a retail kind that a game-port account still made over HTTP.

**What was built.**

- The seam has a tenth function, `accountCall`: for `charUnboundMgr` and an account on the game
  port it goes to the game port, and otherwise it is the gateway's `callMethod` exactly as
  before. The gateway is never told the login name. With no game port nothing is in between.
- On the game port an account has one connection, opened by the first thing asked and logged
  in as the client logs in. What is asked in one go shares it (making a character is five
  calls), and it is closed five seconds after the last. The server saying no leaves it open,
  as the client stays on its screen; any other failure and it is not asked again. It will not
  choose a character.
- The registry: `ValidateNameEx` gets the client's second argument (0: the BFF checks the one
  name it is about to create); `GetCharCreationInfo` is the web client's own;
  `CreateCharacterWithDoll` differs, since the web client draws no doll and sends the
  server's older seven.

**Proof.**

- Tests: 29 new. 69 ways of breaking the change, all caught but one, and the line that one
  showed to be doing nothing was taken out.
- Suite: 9264 tests, 9240 pass, 0 fail, 24 skipped, 0 todo.
- **Live, on the game port**, eve.js `10e2c22f4`, the `test` account with no pilot online,
  through the BFF's routes, read from the server's log of what arrived:

  | what was done | the server's log |
  |---|---|
  | the creation tables, once | a new connection, `Login attempt: user="test"`, `charUnboundMgr GetCharCreationInfo()`, and the connection closed 5.0 s later |
  | the same, three times in a row | one connection, one login, the call three times (call IDs 7, 8, 9) |
  | the same on a gateway BFF | `[CharService] GetCharCreationInfo` with nothing arriving on the game port; the two answers identical to the byte |
  | a character made | one connection, one login: `GetCharCreationInfo`, `GetCharacterSelectionData`, `ValidateNameEx` (2 arguments), `CreateCharacterWithDoll` (7), `GetCharacterSelectionData`; closed 5.0 s after the last |
  | the new character selected | its own connection: `GetCharacterSelectionData`, `GetCharacterLockType`, `SelectCharacterID`; docked, in an Ibis |

- **The staging was undone**: the store was copied with the server stopped before the
  character was made and put back after, and the account again has Test Pilot and no other.

**Not done.**

- The client chooses its character on the connection it asked all this on. Here selecting
  opens a second, and the account's is closed by its timer.
- `ValidateNameEx`'s count is always 0. A name refused and another tried would be 1 on the
  client.
- The doll and the portrait: the web client draws neither, so the creation call is not the
  client's.
- The calls the BFF makes as a pilot who is not logged in stay on the web gateway. They are
  listed in the plan (2.3); nothing checks that the list stays whole.
- With a pilot held, the account's calls are made on that pilot's connection, as before. The
  client cannot be on the creation screen with a character online, so there is nothing of the
  client's to compare that with.

### Next

1. Phase 3's hosted check: Ready Fit's Replenish on a selected session on the game port. It
   needs a corporation fitting and stock staged for a test character, with the store copied
   and put back.
2. The agent's window: laid out again on `OnAgentMissionChange` and a change of station;
   the objectives of a mission that is not a courier; the mission's time under the agent's
   line; messages inside messages when one turns up.
3. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
4. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
5. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
6. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
7. Small, before a character is chosen: selecting on the account's own connection; the count
   of names checked.
8. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order.

---

## 2026-10-08 — Phase 3's hosted check: Ready Fit's Replenish on the game port

Commits `9c6f087` and the one this entry is in, pushed.

**What the check is.** The plan's last line for Phase 3: one hosted maintenance flow completes
for a pilot on the game port, with nothing of that pilot's on the web gateway. The flow is
Ready Fit's Replenish (the engine Provisioning Center Apply also runs): read a corporation
fitting, look at the ship and at a source of stock, and move what is missing into the ship.

**Staged**, with the store copied aside first: a corporation fitting for Test Pilot's
corporation (its Reaper as fitted, and 200 rounds of ammunition in the cargo) and 500 rounds
in its hangar.

**What it showed, first run.** It worked: reviewed, replenished, complete. But the server's log
had eight calls on the web gateway, all `corpFittingMgr.GetFittings`, asked on a session made
up for a pilot who is not logged in, when the pilot was logged in on the game port and its
client would ask that itself. And the hangar's roster, with no pilot held, was still asked of
the gateway for an account on the game port: the last entry sent the creation screens'
calls to the game port and missed the route the roster takes.

**What the retail client does** (`fittingSvc.py` 420 to 431). It asks the manager for the
owner, with the owner: `GetFittingMgr(ownerID).GetFittings(ownerID)`, where the owner is the
session's character, corporation or alliance, and keeps the answer.

**What was built.**

- When the fitting provider is the pilot that is held, its corporation's fittings are asked
  on its own session, with the owner. A provider nobody is flying is read as before. Its
  session going during the read surfaces as for every held call.
- The registry has `GetFittings` for the three managers: the owner is filled in from the
  session where the BFF leaves it out, and a pilot in no alliance is marked as asking what
  its client would not.
- `/api/bridge/call` with no pilot held goes through the seam's `accountCall`:
  `charUnboundMgr` for an account on the game port is asked there; everything else reaches
  the gateway exactly as it did.

**Proof.**

- Tests: 12 new, 2 changed to say where each read is made. 56 ways of breaking the change,
  all caught.
- Suite: 9276 tests, 9252 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, eve.js `10e2c22f4`, as Test Pilot in the page's Ready
  Fit window: the fitting chosen, Review ("Equipment: VERIFIED · Supplies: MISSING", 0 of 200
  aboard, 500 at the source), Replenish Consumables ("Replenishment: COMPLETE", 200 of 200,
  300 at the source).
- **The same flow by script on each transport, from the same staged store**, read from the
  server's log of what arrived:

  | | on the game port | on the web gateway |
  |---|---|---|
  | pilot on the game port | `List` 15, `corpFittingMgr GetFittings` 8 (1 argument), `ListByFlags` 6, `GetCapacity` 4, `Add` 1, the binds | the account-level reads of the plan's 2.3 and nothing else: no call, no bound call, no session |
  | pilot on the gateway | nothing | 8 calls, 28 bound calls, 24 session reads |

  The routes' answers (options, review, replenish, review again, hangar, cargo) were the same
  on both, byte for byte, once the review's own name, deadline and session fingerprint were
  masked.
- **The roster, live**, with no pilot held: on the game-port BFF a connection, a login as
  `test` and `charUnboundMgr GetCharacterSelectionData()`; on the gateway BFF a gateway call.
  The two answers are the same once the two known differences of form are opened (a long as
  text or as a number, a real wrapped or bare).
- **The staging was undone**: the store was put back, and Test Pilot again has no fitting to
  choose and only its ship in the hangar.

**Not done.**

- The client asks for a library once and keeps it, told of changes by `OnFittingAdded` and
  `OnFittingDeleted`. The engine asks afresh at every step (eight times here), on purpose:
  it will not move anything on a definition it has not just read.
- A provider who is another character of the account is still read through the gateway, as
  a pilot who is not logged in.
- `invbroker.GetCapacity` is asked four times in the flow, and the client never asks it.
- The corporation-hangar source and Provision Ship were not run on the game port.
- The page's Ready Fit window had to be told "Refresh sources" after the pilot was switched.

### Next

1. The agent's window: laid out again on `OnAgentMissionChange` and a change of station;
   the objectives of a mission that is not a courier; the mission's time under the agent's
   line; messages inside messages when one turns up.
2. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
3. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
4. Phase 3's writes, feature by feature, each set beside what the client sends (the plan's
   last open line for the phase). The ledger says which are called most.
5. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
6. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
7. Small, before a character is chosen: selecting on the account's own connection; the count
   of names checked.
8. Small, in Ready Fit: the capacity the client never asks for; the window following a change
   of pilot.
9. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
   a fixed ball's collision shapes and the partition's order.

---

## 2026-10-08 — the agent's window listens: a mission changed, a change of station

Commits `f56a19a` and `ada92da`, pushed. In eve.js, by a sub-agent, not pushed:
`c6e7e6672` and `e066a81e9`.

**What the retail client does.** `agentDialogueWindow` has two notify events
(`agentDialogueWindow.py` 31 to 33).

- **`OnAgentMissionChange(action, agentID)`.** For `modified` about its own agent, the window
  talks to the agent again from the top: `InteractWithAgent()` with no action, which is the
  whole opening (86 to 90). The agents service closes the window on that agent for
  `offer_removed`, `reset` and `talk_to_completed` (`agents.py` 688 to 696). The journal
  takes every change, of any agent, as its contents being out of date (`journal.py` 168).
- **`OnSessionChanged`.** With `stationid` among what changed, the window talks to its agent
  again (78 to 84): what an agent will do depends on where the pilot is.
- **One conversation at a time.** `InteractWithAgent` does nothing while the window is loading,
  and lays nothing out for a window that was closed while its question was out (183 to 197).

**What the page did.** Nothing with either push. A conversation stayed as it was laid out until
something was pressed.

**What was built.** The page's window does each of those. The journal is read again on every
mission change, wherever it has been read, one read answering all that came while it was out.

**Two things the live run showed.**

- **The first try at talking again is refused.** An undock pushes the change of station while
  the undock itself is still out, and the BFF refuses every action for a session that is
  changing place (409 `SESSION_CHANGE_IN_PROGRESS`). I had expected, and written the wait for,
  its other refusal (`CHARACTER_IN_USE`), without having seen either. What the window asks of
  its own accord is now asked again on both, every 0.2 s for 3 s at most.
- **A push caused by the pilot's own call reaches the page twice**, on the stream and again with
  the call's answer. It was the second copy that got the window through on that first undock.
  Nothing here depends on it now; it costs one journal read too many per press.

**A server defect found, and fixed by a sub-agent** (eve.js `c6e7e6672`). EveJS pushed
`OnAgentMissionChange('reset', agentID)` when a mission was declined. By the client's code a
`reset` closes the agent's window, so the agent's answer to the decline and its Request
Mission button would never be seen. The sub-agent found recordings of the retail client on
Tranquility on this machine (`D:\SSDSync\EveBadStuff\LOGS`, now in the brief as a source):
both declines in them arrive as `'declined'`, and `reset` is nowhere in the tree. EveJS now
sends `'declined'`; a test in its suite was watched to fail first.

**A second, from the same recordings** (eve.js `e066a81e9`). A briefing's "Decline Time" is
the time REMAINING on Tranquility (None, -1, or up to four hours of ticks). EveJS sent the
absolute time the cooldown ends, which the client would write out as about 425 years.

**Proof.**

- Tests: 26 new. 68 ways of breaking the change caught. Six got through at first: five are
  closed (a line that did nothing was taken out, and tests were added), and one is left, an
  option that only shortens the tests' own waiting.
- Suite: 9317 tests, 9293 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, eve.js `c6e7e6672`, as Test Two with its courier
  agent, read from the page, from the page's own requests, and from the server's log:

  | what was done | the page | the server |
  |---|---|---|
  | Decline, and Yes to the server's question | the window stays: the agent's greeting, Request Mission, "Mission declined."; the journal empties | `DoAction`; the push; the journal; the three layout reads |
  | Request Mission, then Accept | the offer, then Complete Mission and Quit; the journal has it | for each: `DoAction`, the push, the journal, the three reads |
  | `/missioncomplete` in the page's GM console, nothing touched in the window | what the agent says changes, and the buttons become what the server now offers | `SlashCmd`; the push 2 ms later; `DoAction` 5 ms after that, then the journal and the three reads |
  | Undock, the window open (before the fix above) | the window's question refused at 0.3 s (`SESSION_CHANGE_IN_PROGRESS`); the undock answered at 1.62 s; the second copy of the push asked again and was answered | `Undock` 23:55:51.083; `DoAction` 23:55:52.683 and the three reads |
  | Dock, the window open (after it) | refused once, asked again 0.2 s later and answered, 25 ms after the dock itself was; the buttons are the station's again | `CmdDock` 00:01:31.043; `DoAction` 00:01:35.275 and the three reads |

  One `DoAction` reached the server for each change; a refused question never leaves the BFF.
- **Not seen live: the window closing.** Nothing I can do makes the server send `offer_removed`,
  `reset` or `talk_to_completed`. The BFF's route for removing an offer asks
  `agentMgr.RemoveOfferFromJournal` of the service by name with no agent, where the client
  asks the agent's bound object (`agents.py` 782), so it removes nothing. Closing is proven by
  tests only.
- **The staging was undone**: the store was copied with the server stopped before the check and
  put back after.

**Not done.**

- The page still takes a push twice when its own call caused it. Told apart, a press would
  read the journal twice, not three times.
- The BFF's remove-offer route is not the client's call (above).
- After `/missioncomplete` the server's conversation offers Quit and no Complete. Not looked
  into: the window shows what the server says.

**Also in this stretch, while the sub-agent worked** (`76a99ee`, `adcd794`): the first two
pieces of the next unit. `FmtTimeInterval` as the client writes an interval (8 tests, 24
breakages caught), and the line `GetMissionTimeText` writes from a briefing's two times (7
tests, 16 of 17 breakages caught; the one left writes the same words either way, at exactly
one minute). Neither is read into the store or shown yet.

**What else the recordings say, read by the sub-agent and not acted on.**

- **The order of a push and the answer to the call that caused it.** On Tranquility `accepted`
  (23 of 23), `declined` (2 of 2) and `quit` come after the `DoAction` answer, `offered` before
  it (24 of 24), and `completed` either way (15 before, 7 after). EveJS sends every one before
  the answer but `quit`. So `accepted` and `declined` differ. Whether the client behaves
  differently for it is not known; the page copes with either.
- **The decline question's `when`** is the end of the running decline timer on Tranquility
  (both recorded declines). EveJS passes the time of asking. No recording has a decline with no
  timer running.
- **A chain's next part, offered at completion**, has "Decline Time" None on Tranquility until
  the pilot asks for it (three samples, one chain). EveJS would answer -1 or the time left.
- **`GetReplayTimestamp`** answered None on Tranquility with a decline timer running; EveJS
  returns the timer's end.
- The sub-agent's decoders are in the loop's scratch folder: `decode-lines.js` (any line range
  of a recording), `decline-time-scan.js`, `push-order-scan.js`.

### Next

1. The mission's time under what the agent says: the line is worded (`missionTime.ts`). Read
   it into the store with each layout, ask for its labels, and show it, but not with a replay
   timer or a special interaction. See it live on the fixed server with a decline timer
   running. Then the replay timer itself, and the agent's header.
2. The objectives of a mission that is not a courier; messages inside messages when one
   turns up.
3. A push the page's own call caused, taken once: the stream's copy and the answer's told
   apart.
4. `agentMgr.RemoveOfferFromJournal` on the agent's bound object, and a way to press it.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.

---

## 2026-10-09 — the mission's time, under what the agent says

Commits `76a99ee`, `adcd794` and `4193b8c`, pushed. Server: eve.js `e066a81e9`.

**What the retail client does.** The window's left pane (`agentDialogueWindow.GetBriefingHTML`,
232 to 250) is the agent's header, the mission's title, what the agent says, and then the
mission's time and picture. The time is `GetMissionTimeText` (326 to 337), from the briefing
read for that layout:

- "Decline Time" -1: its general words about what declining costs.
- "Decline Time" otherwise: how long is left on the decline timer, written out by
  `FmtTimeInterval`, to minutes, or to seconds in the last minute.
- No decline time, and an "Expiration Time": when the mission expires.

There is no line when the agent answered "not yet" (a replay timer takes its place) or offers
one of its special interactions (an action whose data is a briefing and not a button's number).

`FmtTimeInterval` (`carbon/common/script/util/format.py` 39 to 59, and
`timeIntervalFormatters.py`) divides the game's time greedily into years of 365 days, months
of 30, days, hours, minutes, seconds and milliseconds, writes each unit that is not nought with
the client's label for it, and joins them as the client's list.

**What the page did.** It showed none of it. The briefing's expiry was kept for the courier
table only.

**What was built.** The interval, written as the client writes one; the line, read and worded;
the two times read with every layout and kept with it; the line shown straight after what the
agent says, in the client's words or not at all.

**Proof.**

- Tests: 21 new (8 for the interval, 8 for the line, 5 for reading and showing it). 62 ways of
  breaking it; 61 caught, and the one left writes the same words either way, at exactly one
  minute.
- Suite: 9323 tests, 9299 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, eve.js `e066a81e9`, as Test Two with its courier
  agent. The line's words are the client's own, so what is recorded here is its length, its
  first words and its numbers:

  | what was done | the line under what the agent says |
  |---|---|
  | the agent clicked, a mission on offer and no decline timer running | 212 characters, beginning "Declining a mission from a p", naming 4 hours: the general message |
  | Decline, and Yes | none: there is no mission |
  | Request Mission, a new offer inside the decline window | 125 characters, beginning "Declining a mission from thi", with "3 hours" and "59 minutes" |
  | Accept | "This mission expires at 2026.10.16 00:16", a week on |

  The third row is the server fix of the last entry seen from the client's side: the time
  left, where the unfixed server's timestamp would have been written as centuries.
- **The staging was undone**: the store was copied with the server stopped before the check and
  put back after, and the agent again offers what it offered before.

**Not done.**

- The replay timer ("not yet") and the "no mission" words that go with it. EveJS never sends a
  time for it, so it could not be seen.
- The agent's header (its division, where it is, the pilot's standing with it) and the
  mission's picture.
- A special interaction is known for one now, and still drawn as a button with no name.
- The line is as old as its layout, as in the client: it does not count down.

### Next

1. The objectives of a mission that is not a courier; a special interaction drawn as the
   client draws one; messages inside messages when one turns up.
2. A push the page's own call caused, taken once: the stream's copy and the answer's told
   apart.
3. `agentMgr.RemoveOfferFromJournal` on the agent's bound object, and a way to press it.
4. The agent's header: its division, its place (read already, and not shown), the pilot's
   effective standing with it, and loyalty points.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.

---

## 2026-10-09 — a mission's objectives, read whole

Commit `579306d`, pushed. Half a unit: the reading. The laying out is next.

**What the retail client does.** The window's right-hand pane is built from one answer,
`agentMgr GetMissionObjectiveInfo`, by `agentDialogueUtil.GetMissionObjectiveHTML` (282 to 407),
in this order:

1. a warning when the mission matters to standings (`importantStandings`);
2. a heading with the mission's name, by its state: failed (`missionState` 3), finished
   (`completionStatus` above 0), or neither;
3. a line of overview, then each objective: `transport` (pickup, dropoff, cargo), `fetch`
   (where to bring it, what), `agent` (whom to report to, where), and then each of
   `dungeons`: its heading (optional or not), the agent's words for it or the stock ones,
   struck through with "completed" or "failed" once it is over, its place, and its
   restrictions on ships;
4. a warning about low security on the way (`locations`);
5. granted items, rewards (items, ISK, loyalty points, research points), bonus rewards with
   the time left to earn each, a banner about reduced payouts in high security, collateral,
   and a further heading and text of the mission's own (`missionExtra`).

The marks beside a transport's rows go by where the pilot is and whether the cargo is aboard
(`_ProcessObjectiveEntry`, 30 to 97); a dungeon's by its `objectiveCompleted`.

**What the page did.** It read a courier's transport objective and its ISK out of that answer
and nothing else. A mission of any other kind had a conversation and no objectives.

**What was built.** `web/src/bridge/missionObjectives.ts` reads the whole answer into one
shape, on both transports' spellings. Nothing is worded or shown yet.

**Proof.**

- Tests: 11 new, against answers recorded from the server through both BFFs (a courier on
  offer; a fighting mission on offer and accepted) and made-up ones for what those lack. 50
  ways of breaking it; two got through at first and each is closed with a test.
- Suite: 9334 tests, 9310 pass, 0 fail, 24 skipped, 0 todo.
- **Not seen in the page**: there is nothing to see until the pane is laid out.
- **The staging was undone**: standings were raised and a mission requested and accepted on
  a copy of the store, and the store was put back.

**Found on the way.**

- The level 4 security agent at Test Two's station offers nothing: the server has fighting
  missions for levels 1 and 2 only. Not a defect to hand off; it is the server's own list.
- A dungeon that is over is marked `completed: 1` by the server, where the client's pane
  looks for `completionStatus` (`_ProcessDungeonData`, 102). Read from the code on both
  sides and not run; the recordings of Tranquility would say which name is sent.

### Next

1. The objectives pane, laid out from what is now read, in the client's order and words:
   the heading by state, the overview, each objective and dungeon with its marks, then
   granted items, rewards, bonus rewards and collateral; a courier's two package buttons
   kept beside its transport objective. Seen live with the fighting mission (the brief says
   how to get one). Left for after: the security warning, the reduced-payouts banner, the
   restrictions' links.
2. A special interaction drawn as the client draws one; messages inside messages.
3. A push the page's own call caused, taken once: the stream's copy and the answer's told
   apart.
4. `agentMgr.RemoveOfferFromJournal` on the agent's bound object, and a way to press it.
5. The agent's header: its division, its place (read already, and not shown), the pilot's
   effective standing with it, and loyalty points.
6. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
7. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
8. Phase 3's writes, feature by feature, each set beside what the client sends.
9. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
10. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
11. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
12. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
13. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.

---

## 2026-10-09 — the objectives pane, for a mission of any kind

Commit `62a51a3`, pushed. The other half of the last entry: what was read is now laid out.

**What the retail client does** is in the last entry: one answer, written out in a fixed
order. Three more things it does that this needed:

- A bonus's time left is a label's `{[timeinterval]timeRemaining.writtenForm, to=minute}`,
  which is `FormatTimeIntervalWritten` from years down to what the tag says
  (`timeIntervalPropertyHandler.py`, 46 to 68).
- An amount of ISK is `FmtISK`, the label `UI/Util/FmtIsk` with two decimals
  (`eveFormat.py` 24 and 63); anything else is so many of an item, `UI/Common/QuantityAndItem`
  (`_ProcessTypeAndQuantity`, 245).
- A mission's line in the journal has "Start Conversation with" its agent in its menu, wherever
  the agent is (`missionentry.py` 64).

**What the page did.** A table of its own for a courier, in its own words, and nothing for any
other mission. An agent could only be talked to from the list of the station's agents.

**What was built.**

- The pane (`web/src/bridge/missionObjectivePane.ts`), as blocks of plain text in the
  client's order and words, each row with the mark the client draws beside it. It is drawn
  when the client's words are to hand. Without them a courier keeps the page's own table.
- A courier's two package buttons sit beside its transport objective, and not on an offer.
- A label's written interval is written as the client writes one.
- Each journal line has the client's "Start Conversation with" button.

**Proof.**

- Tests: 24 new. 84 ways of breaking it; seven got through at first and each is closed with
  a test (a transport that starts and ends in one place, a thing to bring that is not
  aboard, a place with no ID, the page's own table beside the pane, a pane with no window,
  and two about words that are not to hand).
- Suite: 9358 tests, 9334 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, eve.js `e066a81e9`, as Test Two. The words are the
  client's, so what is recorded is the pane's shape, its marks and its numbers:

  | what was done | the pane |
  |---|---|
  | a fighting mission on offer from an agent in the next system, its window opened from its journal line | heading "…Objectives"; overview; "Objective" with the agent's own 75 characters for the dungeon; ○ Location Ono; Rewards: 65,000.00 ISK, 87 Loyalty Points; Bonus Rewards: 80,000.00 ISK within "2 hours" |
  | Accept | the same, the bonus within "1 hour and 59 minutes"; under what the agent says, when the mission expires |
  | `/missioncomplete` in the GM console, nothing touched in the window | the game master's note; heading "…Objectives Complete"; ✓ Location Ono |
  | the station's courier agent clicked, its mission on offer | "Transport Objective": ✓ Pickup Location (the station the pilot is docked in), ○ Drop-off Location, ○ Cargo "1 x Encoded Data Chip" with its size; the offer's note; Rewards 13,800.00 ISK and 49 Loyalty Points; Bonus Rewards 17,000.00 ISK |
  | Accept | the two package buttons beside the transport, and no note |
  | Load package into ship | the pane as it was; laid out again by clicking the agent: ✓ Cargo |

- **The staging was undone**: the store was put back, and the level 4 agent again says the
  pilot's standings are too low.

**Seen on the way.**

- **The dungeon's words were not struck through when it was over.** The server marked it with
  `objectiveCompleted` (the ✓) and sent no `completionStatus`, which is what the client's pane
  strikes by. This is the difference read from the code in the last entry, now seen. Whether
  Tranquility sends `completionStatus` the recordings would say; not looked up.
- **Loading the package does not change the pane** until it is laid out again: the server
  says `modified` only when a mission's completion changes. The client's pane is as old as
  its layout too.

**Not done.** The security rating before a place's name; the warning about low security on
the way; the banner about reduced payouts in high security; the links to a dungeon's ship
restrictions; a blueprint's properties after its name; a heraldry agent's own loyalty points.
The journal's other two menu entries, Read Details and Remove Offer.

### Next

1. A special interaction drawn as the client draws one; messages inside messages.
2. A push the page's own call caused, taken once: the stream's copy and the answer's told
   apart.
3. The journal line's other entries: `agentMgr.RemoveOfferFromJournal` on the agent's bound
   object, and the mission's details.
4. The agent's header: its division, its place (read already, and not shown), the pilot's
   effective standing with it, and loyalty points.
5. Around the pane: the security rating before a place's name and the low-security warning
   (the page has no security for a system that is not its own); the reduced-payouts banner.
6. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
7. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
8. Phase 3's writes, feature by feature, each set beside what the client sends.
9. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
10. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
11. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
12. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
13. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.

---

## 2026-10-09 — the journal's Remove Offer, asked of the agent's own object

Commit `1d30adc`, pushed. Item 3 of the last list, its first half. Item 1 was passed over:
this server sends no special interaction and no message inside a message, so neither could be
seen working.

**What the retail client does.**

- An offer's line in the journal has "Remove Offer" in its menu; a mission that was accepted
  does not (`missionentry.py` 65). The words are the label `UI/Agents/Commands/RemoveOffer`.
- It is one call, `GetAgentMoniker(agentID).RemoveOfferFromJournal()`, with no arguments, on
  the agent's bound object (`missionentry.py` 75, `agents.py` 782 to 783). Nothing is read
  after it.
- The server then says `OnAgentMissionChange("offer_removed", agentID)`. That closes the
  agent's window if it is open (`agents.py` 688) and outdates the journal (`journal.py` 168).

**What the page did.** Nothing: it had no way to remove an offer. The BFF had a route for it,
`/api/bridge/agent/journal/remove-offer`, which asked `agentMgr` by the service's name with
no agent. EveJS takes the agent from the object the call was made on
(`agentMgrService.js` 1141), and a call by name is made on none. What that route did to a
journal was not measured before it was replaced.

**What was built.**

- `POST /api/bridge/agents/:agentID/remove-offer`: binds the agent as the conversation routes
  do, makes the call with no arguments, and answers with what the server pushed because of
  it. The old route is gone.
- The registry has the call as "same".
- An offer's journal line has the button, in the client's words when they are to hand. The
  click is the call and nothing else; the server's `offer_removed` does the rest, through what
  the page already did with that push.

**Proof.**

- Tests: 6 new. 19 ways of breaking it, each caught by a test in the end. A `?? null` on the
  route's answer turned out to do nothing and was taken out.
- Suite: 9364 tests, 9340 pass, 0 fail, 24 skipped, 0 todo. `tsc` clean.
- **In the browser, on the game port**, eve.js `e066a81e9`, as Test Two, the agent's window
  open on its offer and "Remove Offer" pressed on the journal line:

  | what was read | value |
  |---|---|
  | the page's requests | `agents/3008416/remove-offer` 200, then `journal` 200 twice |
  | the agent's window | closed; no objectives pane; no error |
  | the journal | no offers |
  | the server's log | `[PKT] IN … RemoveOfferFromJournal() callID=71` at 00:54:39.138, `[PKT] OUT OnAgentMissionChange` one millisecond later, then `GetMyJournalDetails` twice |

  This is the first time the window has been seen closing on `offer_removed`; until now only
  a test said it did. The journal is read twice because the push arrives twice (item 2 below).

- **The two transports, side by side**, by script from the same copy of the store:

  | | game port | gateway |
  |---|---|---|
  | journal before | 1 offer | 1 offer |
  | the removal | 200, null, one push `("offer_removed", 3008416)` | the same bytes |
  | journal after | no offers | no offers |
  | the removal again | 200, null, no push | the same bytes |

  The journals are the same once the gateway's tuple wrapping is taken off, which the page
  already does.

- **The staging was undone**: the store was put back after each run, and the offer is in the
  journal again.

**Seen on the way.** Removing an offer that is not there answers as removing one that is: 200
and null, and no push. The page shows no error for it, and neither would the client.

**Not done.** The journal's Read Details, which opens the mission's details window
(`agentMgr.GetMissionJournalInfo`). Whether the agent offers the same mission again after its
offer is removed was not looked at.

### Next

1. The journal line's last entry, Read Details: the mission's details as the client lays them
   out.
2. A push the page's own call caused, taken once: the stream's copy and the answer's told
   apart.
3. The agent's header: its division, its place (read already, and not shown), the pilot's
   effective standing with it, and loyalty points.
4. Around the pane: the security rating before a place's name and the low-security warning
   (the page has no security for a system that is not its own); the reduced-payouts banner.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
13. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.

---

## 2026-10-09 — the client's built data, read by the client's own loader

Commit `078cf0e`, pushed. The first half of the last list's item 1. Read Details needs it, and so
will much else.

**What the retail client does.** The journal's Read Details (and a double click) is
`agents.PopupMission(agentID)` (`missionentry.py` 70 to 79). That opens the mission in the job
board when two feature flags are on, and both are on unless a server turns them off
(`agents.py` 726, `jobboard/client/feature_flag.py` 8 and 13). The old details window is only
the other branch.

- The job board's page asks the server for one thing as it opens,
  `GetMissionObjectiveInfo(ignoreLocateCheck=True)` on the agent's bound object
  (`agent_missions/job.py` 411). The recordings from Tranquility have the call: no arguments, and
  `ignoreLocateCheck` in the keywords.
- Everything it words comes from the client's own record of the mission,
  `evemissions.client.data.get_mission(contentID)`: the name (`nameID`), the briefing
  (`messages['messages.mission.briefing']`, or `messages.mission.offered.agentsays` while the
  mission is on offer), and the extra information's header and body (`job.py` 126 to 157).
- That record is in `res:/staticdata/missions.fsdbinary`, read by `missionsLoader`, a module
  compiled into the client (`evemissions/client/data.py`). The file does not describe itself:
  its layout is in the loader.

So the client never asks the server for a mission's briefing here, and the page cannot word the
mission's page the client's way without that record.

**What the page had.** The client's words for a label or a message ID, and one table of the
older kind that ships with its schema (the dialogs). No way to read a table of this kind.

**What was built.**

- `scripts/client-built-data.py`: runs the client's loader inside the client's own
  `python27.dll` and prints the table as JSON. The client's Python has no `json` and no
  codecs there, so the JSON is written by hand.
- `src/clientData/clientBuiltData.js`: the BFF's reader. A table is read when first asked for,
  once, and kept in memory. No client, no Python, no such file in the client's index or a
  loader that fails: the table is "not available", the reason is kept, and nothing throws.
- `GET /api/client-data/missions/:missionID`: a mission's record, or null for one the client
  does not have.

**Proof.**

- Tests: 13 new (9 on the reader, 4 on the route). 29 ways of breaking them. Three got through
  at first: a `.toLowerCase()` on a name that is already lower case (taken out), a reader with
  no client that failed quietly where it should not try at all (now tested), and a breakage of
  mine that could not be told from the original (replaced).
- Suite: 9377 tests, 9353 pass, 0 fail, 24 skipped, 0 todo.
- **The script, against the real client.** The whole table in 0.34 s: 2892 missions, 2885 with
  a briefing, 1983 with what the agent says on offering, 582 with extra information. Its
  nested parts read as objects, lists and numbers (tallied by shape).
- **The script's own writer, inside the client's Python**, over twelve awkward values (quotes,
  a backslash, control characters, UTF-8 bytes, Latin-1 bytes, unicode, a long, infinity, a
  tuple, a dict keyed by numbers, an object with a hidden, a callable and a missing
  attribute): all twelve read back as they should, and only ASCII was written.
- **Through both check BFFs, live**, eve.js `e066a81e9`, as Test Two, for the mission in its
  journal:

  | what was read | value |
  |---|---|
  | the journal's entry | content ID 2156, name 57959 |
  | the client's record, first asked | 200 in 464 ms (the loader's run) |
  | asked again | 200 in 2 ms, the same answer |
  | the record's `nameID` | 57959, the journal's name and the server's "Mission Title ID" |
  | the record's `messages.mission.briefing` | 129931, the server's "Mission Briefing ID" |
  | the client's texts for the record's four message IDs | all four found |
  | a mission the client has not | 200, `mission: null` |
  | not a number | 400 `INVALID_MISSION` |

  The gateway BFF answered the same. With a Python that is not there, and with a client that
  is not there, the reader said "not available" and why.

- Nothing was staged.

**A decision taken in the operator's absence**: the BFF starts a Python. It is in the
operator's section.

**Not done.** The page that uses it: Read Details itself.

### Next

1. The journal's Read Details: the mission's page as the job board lays it out. The one read
   with `ignoreLocateCheck`; the name, the briefing and the extra information from the client's
   record; objectives as `evemissions/client/mission.py` builds them (cargo, pick-up, drop-off,
   the agent to talk to, the dungeon); rewards; when it expires.
2. A push the page's own call caused, taken once: the stream's copy and the answer's told
   apart.
3. The agent's header: its division, its place (read already, and not shown), the pilot's
   effective standing with it, and loyalty points.
4. Around the pane: the security rating before a place's name and the low-security warning
   (the page has no security for a system that is not its own); the reduced-payouts banner.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
13. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
14. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions, divisions for an agent's header).

---

## 2026-10-09 — the journal's Read Details: a mission's page, as the client's job board shows one

Commit `935f839`, pushed. Item 1 of the last list.

**What the retail client does.** Read Details, and a double click on a journal line, opens the
mission in the job board (the last entry has why). The page is
`jobboard/client/features/agent_missions/page.py`, drawn from a job (`job.py`) that holds an
`evemissions.client.mission.Mission`.

- **One read of the server**, as the page is built and again whenever its job is marked out of
  date: `GetMissionObjectiveInfo(ignoreLocateCheck=True)` on the agent's bound object
  (`job.py` 389 to 413). An answer about another mission, or none, changes nothing
  (`mission.py` 166).
- **The words come from the client's own record** of the mission: its name; its briefing, or
  what the agent says on offering while it is an offer and the mission has such words; the
  extra information, only when it has a body (`job.py` 126 to 157). Each is filled with the
  mission's keywords, asked of the agent once, and the agent's own IDs (`job.py` 378), then
  tidied (`agentinteraction/textutils.py` `fix_text`).
- **The order** (`page.py` 34 to 76): when it expires; a warning when it matters to standings;
  the agent and its corporation; the briefing; the objectives; the ship it needs; the
  collateral, for an offer only; what the agent hands over; rewards, with the bonus inside
  them; a banner about reduced rewards in high security; the extra information.
- **Objectives are steps** (`mission.py` 218 to 304, `agentinteraction/objectivesteps.py`). A
  transport is cargo, pick-up, drop-off; a fetch is cargo and drop-off; an agent to see is
  one step; then the dungeons, in a group of their own. Each group has one line above it,
  its last step's. Beside a step's title is how far its place is: this station, this solar
  system, or so many jumps.
- **The state** beside the title (`job.py` 338): expired before offered, completed after.
- **What changes it** (`provider.py` 79, fed by the journal's `OnAgentMissionChanged`,
  `journal.py` 183): `completed` and `accepted` give the job that state and mark it out of
  date; `modified`, `dungeon_moved`, `failed` and `offer_expired` only mark it; `offered`,
  `declined`, `offer_declined`, `offer_removed`, `quit` and `reset` remove the job. A change
  of ship or of station marks every job out of date (`provider.py` 74).

**What the page did.** A journal line could start a conversation or remove an offer. A
mission could be read only by opening its agent's window, which talks to the agent.

**What was built.**

- `GET /api/bridge/agents/:agentID/mission-objectives`: the read, with the keyword.
- `web/src/bridge/missionPage.ts`: the page as plain text in the client's order and words.
- The flow: Read Details makes the read, asks for the mission's keywords and for the
  client's record (each once for a mission), and keeps the page in the store. A mission
  change or a change of ship or station reads again or closes the page, by the rules above.
- The panel: "Read Details" first on each journal line, as it is first in the client's menu,
  and the page, with the client's "Start Conversation" button and a Close of this page's own.

**Proof.**

- Tests: 45 new (27 on the page, 11 on the flow, 5 on the panel, 2 on the BFF). 172 ways of
  breaking it. Twelve got through at first:
  - three checks that did nothing and were taken out (a mission "active" beside "offered or
    accepted", "is it a solar system" beside "is it the pilot's", a line set and then always
    overwritten);
  - eight things no test looked at, each now tested (the record's keys by name; the record's
    name before the journal's; "there" being where the session is; research that rounds to
    nothing beside pay; one agent's answer landing on another agent's page; the note about
    having no client appearing before that is known; the two groups' order; one breakage
    run against the wrong test file);
  - **one that no test here can see**: which agent the page's "Start Conversation" opens. It
    is in a click handler, and the panel's tests draw without clicking. Seen live, below.
- Suite: 9422 tests, 9398 pass, 0 fail, 24 skipped, 0 todo. `tsc` clean; the panel has no
  `svelte-check` errors.
- **In the browser, on the game port**, eve.js `e066a81e9`, as Test Two. The words are the
  client's, so what is recorded is shape, marks and numbers:

  | what was done | what was seen |
  |---|---|
  | the journal line of the station's courier agent, its mission on offer | three buttons in the client's order and words: Read Details, Start Conversation with the agent, Remove Offer |
  | Read Details | requests: `keywords?contentID=2156`, `mission-objectives`, `client-data/missions/2156`, all 200. The mission's name, "Offered", "Expires in 6d 8h 57m 47s"; a briefing of 668 characters in 3 lines with no tag or brace left in it; "Transport these goods:" over ○ Cargo "1 x Encoded Data Chip (0.1 m³)", ✓ Pickup Location "This station", ○ Drop-off Location; Rewards 13,800.00 ISK and 49 LP; Bonus Rewards 17,000.00 ISK. The agent's window stayed shut. |
  | the server's log | `GetMissionKeywords` with one argument, then `GetMissionObjectiveInfo` with none, both on the agent's bound object |
  | Start Conversation on the page | the window of that agent opened, with Accept, Decline and Defer; the page stayed |
  | Accept | `mission-objectives` read again; "Offered" gone; the journal line lost Remove Offer |
  | Load package into ship, in the window | the page unchanged (the server says nothing); Close, Read Details: one read of the agent, the record and the keywords not asked for again, and ✓ Cargo |
  | Quit in the window, and Yes to the server's question | the page closed; nothing more read for it |
  | a fighting mission offered by an agent in the next system, Read Details on its line | its name, "Offered", a briefing of 426 characters; the agent's own 75 characters over ○ Location Ono; Rewards 65,000.00 ISK and 87 LP; Bonus Rewards 80,000.00 ISK |
  | Remove Offer on that line | the page closed, the journal emptied |

- **The two transports, side by side**, by script from the same copy of the store: the read
  answers the same on both once the gateway's wrapping and the bonus's running time are
  taken off. On this server it also answers the same as the window's read with no keyword.
- **The staging was undone**: the store was put back, and the offer is in the journal.

**A defect found live and fixed before the commit.** The time left did not run down: its
clock was started again by anything at all the agents' store was told, and something tells it
something more often than the clock struck. It now hangs only on whether a page is open, and
was seen to move ("…58m 53s", then "…58m 43s" nine seconds later). No test saw this, and none
here can: the panel's tests do not run effects.

**Not seen.** That `ignoreLocateCheck` is on the wire. The BFF's test pins that it is handed
to the game port, and other calls' keywords are known to go out; the server's log prints a
call's arguments by count and not its keywords, and this server does not read the keyword.

**Seen on the way.**

- **This server never reads `ignoreLocateCheck`.** What Tranquility does differently with it
  the recordings would say; not looked up.
- **The expiry on the page is the journal line's as it was when the page opened.** After
  Accept it still showed the offer's. The client's job keeps the time it was made with too
  (`provider.py` 91 gives it a state and nothing else), until its jobs are made again; when
  that is was not followed through.
- **The push arrives twice** still, so the page read the agent twice on Accept (item 2 below).

**Not done.** The agent's and its corporation's cards on the page (level, division, standing,
faction). How many jumps away a place is. The security rating before a place's name.
"Objectives Complete" as the state, which the client has from its own tracker. A ship's
packaged size as cargo. The ship restrictions panel. The reduced-rewards banner. The bonus's
countdown. A blueprint's properties. What an alpha clone is paid. The client's short written
interval: the time left is in this page's own short form, as it already was on the journal's
line.

### Next

1. A push the page's own call caused, taken once: the stream's copy and the answer's told
   apart. It now costs a second read of the agent each time, as well as of the journal.
2. The agent's cards: its level, its division's name (the client's built data), its
   corporation and faction, the pilot's effective standing with it. They belong on the
   mission's page and above the agent's window both.
3. The client's short written interval (`FormatTimeIntervalShortWritten`), for the journal's
   line, the page's time left and the bonus's countdown.
4. Around a place's name: the security rating before it, the low-security warning, how many
   jumps away it is (the page has no route of its own yet), and the reduced-rewards banner.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
13. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
14. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions, divisions for an agent's card).

---

## 2026-10-09 — what the server says once is acted on once; and where the pilot is now

Commits `6ccd508` and `4f1efec`, pushed. Item 1 of the last list, and a defect seen while
checking it.

### A push taken once

**What the retail client does.** It hears a notification once, on its one connection, and
acts on it once.

**What the page did.** It could hear one twice: on the pilot's live stream as it arrived, and
again with the next answer, because the BFF keeps a copy for a reader with no stream (a pilot
that is not the one on screen has none). Both copies went to the same handler, so the journal
was read twice for every change to a mission, the agent's window talked twice, and since the
last entry the mission's page read its agent twice.

**What was built.**

- On the game port, the copy kept for the answer carries the cursor of the stream event it
  also went out in: the BFF process's epoch and the event's number in the pilot's session
  (`src/gamePort/pilots.js`, `record`). The stream's own frames are as they were.
- The page remembers the cursors it has acted on, 8192 of them, twice what an answer can
  bring (`web/src/bridge/pushOnce.ts`), and acts on a push the first time it sees its
  cursor, whichever way it came. A copy with no cursor is always acted on. Selecting a pilot
  starts the memory afresh, since a new session numbers its events from one again.
- The stream still records what came on it and where it has read to, news or not.

**Proof.**

- Tests: 11 new, and 2 changed to the new shape of an answer's push. 29 ways of breaking it;
  one got through, a line that did nothing, and it was taken out.
- **In the browser, on the game port**, eve.js `e066a81e9`, as Test Two, the agent's window
  and the mission's page both open:

  | what was done | before | now |
  |---|---|---|
  | Accept | `mission-objectives` twice, `journal` three times | once, and twice |
  | Remove Offer on a journal line | `journal` twice | once |
  | Undock | | `mission-objectives` once; the window's talk refused 409 eight times while the session changed, then answered once, and its layout read |
  | Dock | | `mission-objectives` once; the talk refused once, then answered once |

  The server's log for the Accept: one `OnAgentMissionChange`, then `GetMissionObjectiveInfo`
  (the page), `GetMyJournalDetails` (the push), the window's three reads for its layout, and
  `GetMyJournalDetails` again.
- **The two transports, by script**: the game port's answer to a Remove Offer brings its push
  with a cursor (sequence 3 in that session); the gateway's brings the same push with none.
- **The staging was undone.**

**What is still read twice.**

- **The journal after an agent's button is pressed**: once for the push, and once because the
  page's own `chooseAction` ends by reading it. The client makes no such read. The page's bots
  press buttons through the same function and may count on the journal being fresh when it
  answers, so it was left; it is on the list below.
- **Everything on the gateway**, where the answer's copy cannot be told from the stream's.
  The server's web gateway would have to number what it keeps for an answer. Not asked for:
  the retail client is not affected, so it is no server defect by this loop's rule.

### Where the pilot is now

**Seen live** during the check above: after undocking, the mission's page still said the
pick-up was "This station" and ticked it, and so did the agent window's pane.

**Why.** Both took the pilot's place from where it was when it was selected. That record does
not follow an undock, a dock or a jump; the flight status does.

**What the client does**: it reads its session (`session.stationid`, `session.solarsystemid2`,
`session.locationid`) each time it marks an objective (`mission.py` 249,
`objectivesteps.py` 150).

**What was built.** `web/src/bridge/sessionPlace.ts`: the three, from the flight status once
it has been read, and from the selection before that. The pane and the page both go by it.

**Proof.** 6 new tests; 15 ways of breaking it, all caught. Suite: 9439 tests, 9415 pass,
0 fail, 24 skipped. **In the browser, on the game port**: docked, "✓ Pickup Location" with
"This station"; undocked, "○ Pickup Location" with "This solar system", and the pane's tick
gone too; docked again, the tick and "This station" back.

**Seen on the way, and not looked into.** After Accept the agent's window offered Complete
Mission and Quit. After an undock and a dock, when the window talked to the agent again, it
offered only Quit. Both are the server's answers. Which the client would be given on a fresh
talk about an accepted mission the Tranquility recordings would say.

### Next

1. What an agent offers on a fresh talk about a mission already accepted: this server said
   Quit alone, where straight after Accept it said Complete Mission and Quit. Settle it from
   the Tranquility recordings; a server defect goes to a sub-agent.
2. The agent's cards: its level, its division's name (the client's built data), its
   corporation and faction, the pilot's effective standing with it. They belong on the
   mission's page and above the agent's window both.
3. The client's short written interval (`FormatTimeIntervalShortWritten`), for the journal's
   line, the page's time left and the bonus's countdown.
4. Around a place's name: the security rating before it, the low-security warning, how many
   jumps away it is (the page has no route of its own yet), and the reduced-rewards banner.
5. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
6. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
7. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
8. Phase 3's writes, feature by feature, each set beside what the client sends.
9. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
10. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
11. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
12. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
13. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
14. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
15. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions, divisions for an agent's card).

---

## 2026-10-09 — what an agent offers on a fresh talk about a mission already accepted

Commit `20fc2c8`, pushed: tools and this entry, and no change to the client or the server.
Item 1 of the last list. **The question is not settled, and the server was left alone.**

**What was measured on this server** (eve.js `e066a81e9`, as Test Two, the station's courier
agent, the pilot docked in the agent's station, which is the pick-up and not the drop-off):

| the talk | the buttons |
|---|---|
| the first, mission on offer | Accept, Decline, Defer |
| again, nothing pressed | the same |
| Accept pressed | Complete Mission, Quit |
| a fresh talk after that | Quit |
| and another | Quit |

The staging was undone.

**Why this server says so** (`agentMissionRuntime.js` 7779 to 7832): Complete is offered in
the answer to Accept itself; on a fresh talk it is offered when the mission can be completed
remotely, or when the pilot is at the mission's "completion location". For a mission with a
drop-off that is the drop-off's station; for any other it is where the agent is
(`isCharacterAtMissionCompletionLocation`, 5583). Quit is offered where the agent is.

**What Tranquility does**, from the recordings (176 agent `DoAction` calls in 23 files, read
with the new `scripts/recordings/`):

| a fresh talk about a mission already accepted | how often | the buttons |
|---|---|---|
| in space | 61 | none |
| docked, to the mission's agent | 29 | Complete Mission and Quit, every time |
| docked, to another agent whose window was also open | 7 | none; each went to another agent's object and was answered with that agent's "remote" greeting |
| in a recording with no change of station in it, so where the pilot was is not known | 1 | Complete Mission and Quit |

And the 29 by what the mission was when the pilot talked (its objectives as the client read
them next):

| the mission | how often |
|---|---|
| a dungeon, done | 6 |
| a dungeon, not done | 1 |
| something to fetch, docked at the drop-off, the thing held | 16 |
| something to fetch, docked at the drop-off, the thing not held | 5 |
| something to carry, docked at the drop-off, the cargo held | 1 |

So on Tranquility Complete Mission does not wait for the objective: it was offered six times
with the objective not met (and once more in the recording where the pilot's place is not
known: a dungeon, not done). In all 29 the pilot was docked in one station through the talks,
and wherever the mission had a drop-off, that station was it.

**What that leaves open.** This server's Quit-alone comes from one situation, a mission with a
drop-off and the pilot at the agent's station but not at the drop-off, and no recording has
that situation. Tranquility never answered with Quit alone in 176 calls; but it was never
asked in the one place this server does. The same goes for the mirror of it: docked at a
drop-off that is not the agent's station, where this server offers Complete Mission without
Quit.

**What was not done, and why.** The server was not changed. This loop's rule for a server
defect is evidence that the retail client is affected, and here there is a pattern that
points one way and no recording of the case itself. What would settle it is in the operator's
section.

**Tools.** `scripts/recordings/`: the scripts this and two earlier entries read the recordings
with, kept until now in a folder that does not outlast the session. They print numbers and
states, and nothing of the recordings is in the repository.

### Next

1. The agent's cards: its level, its division's name (the client's built data), its
   corporation and faction, the pilot's effective standing with it. They belong on the
   mission's page and above the agent's window both.
2. The client's short written interval (`FormatTimeIntervalShortWritten`), for the journal's
   line, the page's time left and the bonus's countdown.
3. Around a place's name: the security rating before it, the low-security warning, how many
   jumps away it is (the page has no route of its own yet), and the reduced-rewards banner.
4. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
13. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
14. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions, divisions for an agent's card).
15. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section).

---

## 2026-10-09 — the agent's card and its corporation's, on a mission's page

Commit `8333bdf`, pushed. Item 1 of the last list, without the standing.

**What the retail client does.** The mission's page in the job board is headed by two cards
(`page.py` 78 to 106):

- the agent's: "Level N" (the label `UI/Agents/AgentEntry/Level`), its name, and the name of
  its division;
- its corporation's: the pilot's effective standing with the agent, the corporation's name,
  and its faction's.

All of it comes from `agents.GetAgentByID`, which is not a call. The client reads
`agentMgr.GetAgents` once, keeps the table, and adds to each row the faction of the agent's
corporation from its own data (`agents.py` 89 to 107, `npcs/npccorporations.py` 123). A
division's name is the client's own too (`npcs/divisions.py`).

**What the page had.** Each station agent's level, division's number and corporation, from the
same table read for the station's list. Nothing for an agent somewhere else, no faction, and
no name for a division.

**What was built.**

- Two more of the client's tables read by its own loaders: its corporations and its
  divisions. One line each in `TABLES`.
- `GET /api/bridge/agents/:agentID/record`: the agent's row, with its corporation's faction
  and the number of its division's name. The BFF reads the agents table once for its life,
  through whichever pilot first asks, as the client reads it once.
- The page: the two cards, between the warning and the briefing. Asked for once for each
  agent.

**Proof.**

- Tests: 7 new. 51 ways of breaking it. Two got through at first: a check on an array that
  did nothing (taken out) and the level's label, which no test named (now named).
- **A fault of the breakage tool, caught**: one run died on a file error and left its
  breakage in `web/src/app/flow.ts`. The next run said the text was missing, the file was
  set beside its diff and put right, and the whole suite passed after. A run that ends in an
  error is worth a look at the file it was breaking.
- Suite: 9446 tests, 9422 pass, 0 fail, 24 skipped, 0 todo.
- **The route, live, on both transports**, eve.js `e066a81e9`, as Test Two:

  | agent | answer |
  |---|---|
  | 3008416, first asked | 200 in 374 ms: level 1, division 22, corporation 1000002, faction 500001, division's name the message 60113 |
  | 3011895, an agent in another station | 200 in 2 ms: level 1, division 24, corporation 1000031, faction 500001, name 60115 |
  | 3008416 again | 200 in 2 ms, the same |
  | 3000001, no agent | 200, `agent: null` |

  The client has a text for each division's name, and the BFF a name for each corporation and
  faction. The gateway BFF answered the same.
- **In the browser, on the game port**: Read Details on the journal's line asked for
  `agents/3008416/record` once, and the page had, between when it expires and its briefing,
  "Level 1", the agent's name and "Distribution" on one card, and its corporation and
  "Caldari State" on the other.
- Nothing was staged.

**Not done.** The pilot's effective standing on the corporation's card
(`standingsvc.GetEffectiveStandingWithAgent`): the greatest of the pilot's standings with the
faction, the corporation and the agent, each raised by a skill, or the least of them when one
is at -2 or worse. It needs the pilot's standings, three skills' levels and the client's
bonus rule. The same cards above the agent's own window. An agent whose row has no
corporation takes its station's owner in the client; here it has no second card.

### Next

1. The pilot's effective standing with an agent, as the client works it out, on the
   corporation's card.
2. The client's short written interval (`FormatTimeIntervalShortWritten`), for the journal's
   line, the page's time left and the bonus's countdown.
3. Around a place's name: the security rating before it, the low-security warning, how many
   jumps away it is (the page has no route of its own yet), and the reduced-rewards banner.
4. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
5. The agent's cards above its own window, where the client's window has its own header.
6. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
7. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
8. Phase 3's writes, feature by feature, each set beside what the client sends.
9. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
10. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
11. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
12. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
13. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
14. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
15. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions).
16. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section).

---

## 2026-10-09 — the pilot's effective standing with an agent

Commit `7a54707`, pushed. Item 1 of the last list.

**What the retail client does.**

- The corporation's card on a mission's page begins with the pilot's effective standing with
  the agent (`page.py` 102, `standingsvc.GetEffectiveStandingWithAgent`, 200 to 214): three
  standings towards the pilot, the agent's faction's, its corporation's and the agent's own,
  each raised by a skill. The least of them counts when it is -2.0 or worse (the label
  `UI/Agents/Dialogue/EffectiveStandingLow`); otherwise the greatest
  (`UI/Agents/Dialogue/EffectiveStanding`). An owner the server does not list stands at nought.
- The skill goes by the agent's faction for all three (`standingUtil.py` 15 to 37): none for
  four factions no skill moves; Diplomacy for a standing below nought; Criminal Connections
  from nought up with a pirate faction; Connections from nought up with anyone else. It is
  worth 0.4 a level and closes that share of what is left to ten.
- **It reads the pilot's standings once** and after that changes what it holds from what the
  server says (`standingsvc.py` 41 to 90): `OnStandingSet` sets one outright, or drops it when
  it is set to nothing; `OnStandingsModified` moves each by a share of what is left to the end
  of the scale, or starts one for an owner not yet listed.

**What the page had.** The pilot's standings and skills, each read by its own panel. Nothing
that put them together, and nothing that heard the server change a standing.

**What was built.**

- `web/src/bridge/effectiveStanding.ts`: the rule.
- `web/src/bridge/standingChanges.ts`: the two notifications applied to the standings held.
- The page's corporation card says it, in the client's words, marked when it is a low one.
  Opening a mission's page reads the pilot's standings and skills if they have not been read.

**Proof.**

- Tests: 19 new. 78 ways of breaking it. Seven got through at first: two tests of the ends of
  the scale that the sums already answer (taken out), three notifications no test tried
  (now tried), and two that cannot be told from the original (a change of nought taken as a
  rise; a null the type checker needs and the code does not).
- Suite: 9465 tests, 9441 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, eve.js `e066a81e9`, as Test Two, the mission's page
  of the station's courier agent:

  | the pilot | the server lists | the card |
  |---|---|---|
  | as it is: none of the three skills | faction -3.978, corporation 1.069, agent -0.53 | "Effective Standing: -4.0", marked low |
  | given Diplomacy IV by a game master's command, and the page loaded again | the same | "Effective Standing: 1.2" |
  | every agent's standing set to ten by a game master's command, the page left open | 197 `OnStandingSet` in one answer | "Effective Standing: 10.0", and no read of the standings |

  The second is the sum by hand: Diplomacy IV is 1.6, which lifts -3.978 to -1.74 and -0.53
  to 1.15; nothing is at -2.0 or worse any more, and the greatest of -1.74, 1.069 and 1.15
  is 1.15.
- **The staging was undone**: the store was put back after each part.

**A defect of this entry's own first version, found live.** It read the standings again on
each of those notifications: 197 reads for one command. No test said so, because the test
sent one notification and counted one read. The client does not read at all, and now neither
does this; the test sends several and counts none.

**Not done.** The skill's level is the one the pilot has trained; the client uses its
"effective" level, which is lower for a clone that may not use all it has trained. The
corporation's own standings are not kept from these notifications, as the client keeps them.
The same cards above the agent's own window. The standings panel reads its own data and does
not show these changes until it reads again.

### Next

1. The client's short written interval (`FormatTimeIntervalShortWritten`), for the journal's
   line, the page's time left and the bonus's countdown.
2. Around a place's name: the security rating before it, the low-security warning, how many
   jumps away it is (the page has no route of its own yet), and the reduced-rewards banner.
3. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
4. The agent's cards above its own window, where the client's window has its own header.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
13. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
14. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions).
15. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section).

---

## 2026-10-09 — an interval's short written form

Commit `7e18bfb`, pushed. Item 1 of the last list.

**What the retail client does.** A label's `{[timeinterval]x.shortWrittenForm}` is
`FormatTimeIntervalShortWritten` (`timeIntervalFormatters.py` 153 to 166, by way of
`timeIntervalPropertyHandler.py`):

- the interval is rounded **up** to a whole number of the last unit shown;
- it is divided over years of 365 days, months of 30, days, hours, minutes, seconds and
  milliseconds, from the tag's `from` (years unless it says) down to its `to` (seconds unless
  it says);
- each unit that is not nought is written with the client's short label for it
  (`/Carbon/UI/Common/WrittenDateTimeQuantityShort/<Unit>`); if every unit is nought, the last
  one is written, at nought;
- one stands alone, and more are set side by side by the label for that many
  (`DateTimeShortWritten2Elements` to `7Elements`).

The journal's "expires in" and the mission page's time left are both labels of this kind.

**What the page did.** Its own short form: days, hours, minutes and seconds, cut down not
rounded up, with its own letters for the units, whatever the tag's `from` and `to`.

**What was built.** `shortWrittenInterval` beside the written form in
`web/src/bridge/timeInterval.ts`, and a second writer in the label formatter for a tag that
asks for it. Every label worded through the page's one function for the client's words now
has both writers, so an interval in any of them is the client's when its words for one are to
hand. Without them the page's own short form stands, as before.

**Proof.**

- Tests: 9 new. 36 ways of breaking it, all caught.
- Suite: 9474 tests, 9450 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port**, eve.js `e066a81e9`, as Test Two: the page asked the
  BFF for all 13 short labels and the client has a text for each; the mission's page said
  "Expires in 6d 7h 44m 53s". Nothing was staged.
- **What the browser does not show.** In English the client's short labels come out as the
  page's own letters did, so the line read the same before. That the client's are the ones
  being used is from the tests, whose made-up labels differ from the page's own, and from
  the request for them above.

**Not done.** The other two forms a tag can ask for: `shortForm`, which is also what a tag
with no form gets, and `writtenFormTwoPart`. The bonus's countdown on the mission's page,
which is this same short form from days to seconds: when the client shows it depends on an
accepted time it takes from its own tracker, not followed through.

### Next

1. Around a place's name: the security rating before it, the low-security warning, how many
   jumps away it is (the page has no route of its own yet), and the reduced-rewards banner.
2. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
3. The agent's cards above its own window, where the client's window has its own header.
4. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
5. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
6. Phase 3's writes, feature by feature, each set beside what the client sends.
7. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
8. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
9. Small, before a character is chosen: selecting on the account's own connection; the count
   of names checked.
10. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
11. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's countdown.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
13. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
14. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions).
15. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section).

## 2026-10-09 — a place's security rating and its low-security warning

Commits `8b5fa8f` and `105c616` (the tool), pushed. Item 1 of the last list, in part.

**What the retail client does.** A mission's place is written by
`agentDialogueUtil.LocationWrapper` (164 to 202) through one label,
`UI/Agents/LocationWrapper`, which takes:

- the system's security rating, in the colour of that security. The level is the system's own
  from the client's static data, except that anything above nought and below 0.05 counts as
  0.05 (`eveCfg.SolarSystem.pseudoSecurity`, 1092 to 1097); it is shown to one decimal place,
  and never as "-0.0" (`eveformat/client/location.py` `round_security_status`);
- an image, and the place's name as a link;
- a warning: `UI/Agents/LowSecWarning` where the system is low security or lower, which is
  nought or below, or below 0.45 (`eveuniverse/security.py` `SecurityClassFromLevel`); and
  `UI/Agents/HighSecWarning` for a pilot whose own security status is -5.0 or worse, going
  anywhere that is not.

The label has an entity in it: `&nbsp;` between the image and the name. The client's label
parser is CCP's own and its source is open (`trinity/trinity/Tr2LabelTextParser.cpp`, the
state `STATE_GT_AMPSTART`). In text it turns four entities into the characters they stand
for, in any letter case, and no others: `&amp;`, `&lt;`, `&gt;`, and `&nbsp;`, which it writes
as an ordinary space.

**What the page did.** A place was its name alone, on the agent's window and on the
mission's page. And an entity in any of the client's texts was drawn as it is spelled.

**What was built.**

- `web/src/bridge/systemSecurity.ts`: the level the client works with, the rating it shows,
  and its class.
- `web/src/bridge/locationWrapper.ts`: the client's own label filled with the rating, the
  name and the warning, as plain text (so no colour and no link). The name alone until the
  system's security has been read, or where the client's words are not to hand.
- `POST /api/map/security` on the BFF: the security solar systems were made with, by ID, from
  the static reference data the BFF already holds; null for an ID that is no system's; 200 a
  request. Not a call to the server: the client has this in its own static data.
- The page asks once for each system, in one request for all that are wanted together, and
  keeps the answers beside its names (`names.systemSecurity`). A request that fails is asked
  again the next time the system is wanted.
- `plainText` (`web/src/bridge/clientWords.ts`), which every one of the client's texts drawn
  here goes through: the four entities become their characters, each read once and after the
  tags have gone, so an entity never makes a tag nor another entity.
- `scripts/client-words.js` now names a label's tags and entities with its parameters.

**Found live, and what it says about fixtures.** The first look in the browser showed
`0.7&nbsp;` before the name. Every test had passed: my fixture for the label had a space
where the real one has the entity. The fixtures are now in the label's real shape, and the
brief says to ask the tool for a label's markup before making one.

**Proof.**

- Tests: 17 new. 86 ways of breaking it tried. Four survived the first pass, each for a
  reason now set right: three lines that did nothing (the level raised a second time before
  its class is taken; a warning made plain before the whole line is; a check for a number
  JSON would have written as null anyway) are gone, and a test whose made-up answer was the
  same for every system now gives each its own. All are caught.
- Suite: 9491 tests, 9467 pass, 0 fail, 24 skipped, 0 todo.
- **By script, on both transports**, eve.js `e066a81e9`, as Test Two: the courier's two
  places are in systems 30002780 and 30002778; the BFF answered 0.708087 and 0.830855 for
  them and null for an ID that is no system's, in 3 ms; the client has both labels (132 and
  18 characters).
- **In the browser, on the game port:** the mission's page and the agent's window both read
  "0.7 Muvolailen X - Moon 3 - CBD Corporation Storage" and "0.8 Tasabeshi VI - Moon 1 - CBD
  Corporation Storage". One request carried both systems; opening the agent's window after
  the page asked for nothing more.
- **Staged, for the warning** (the store copied first and put back after; the journal is back
  at one offer): standings raised with `/maxagentstandings`, and a level 1 courier agent in
  low security (3008442) asked for a mission, which runs between systems of 0.438684 and
  0.376794. Its page read "0.4" before each station's name and the client's warning, 18
  characters, after each. A second request went out, for the two new systems only.

**Not done.**

- How many jumps away a place is. The client asks its own pathfinder
  (`clientPathfinderService.GetAutopilotJumpCount`), whose route is the safe one unless the
  pilot has set another: a penalty of 50 on low security, and the pilot's avoided systems.
  The page's own route (`web/src/nav/routeSolver.ts`) is the shortest, so the two counts
  would differ wherever the safe way is longer.
- The banner about reduced rewards (`UI/Agents/StandardMission/SecurityTaxMessage`): for an
  agent that is not a career agent, in a system of 0.95 or above (the client asks
  `agentMgr.GetSolarSystemOfAgent`), when the mission pays ISK.
- The second warning, for an outlaw: it needs the pilot's own security status.
- A level the server has changed for a time (`security/client/securitySvc.py`
  `modified_security_levels`) and the icon the client draws for one.
- The rating's colour and the name's link: the line is plain text here.
- The label parser's other habits (a tab becomes a space; what it does with runs of spaces).
- A short interval written inside another label is made plain twice. Nothing in the
  client's interval labels has an entity, so nothing shows; it is a thing to know.

### Next

1. Around a place's name, the rest: how many jumps away it is, by the client's safe route
   (a route solver that takes the security penalty); the reduced-rewards banner; the
   outlaw's warning.
2. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
3. The agent's cards above its own window, where the client's window has its own header.
4. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
5. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
6. Phase 3's writes, feature by feature, each set beside what the client sends.
7. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
8. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
9. Small, before a character is chosen: selecting on the account's own connection; the count
   of names checked.
10. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
11. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
13. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
14. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions).
15. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section).

## 2026-10-09 — the banner about reduced rewards, and what is asked once

Commit `6f8b7a3`, pushed. Item 1 of the last list, in part.

**What the retail client does.** The job board's page of a mission
(`jobboard/client/features/agent_missions/page.py` 63 to 71), after the rewards and before the
extra information:

- takes the agent from its agents service; a career agent (type 12) gets nothing more;
- for any other agent asks where it is: `agents.GetSolarSystemOfAgent`, which is one
  `agentMgr.GetSolarSystemOfAgent(agentID)` to the server for each agent, kept from then on
  (`agents.py` 799 to 802). It asks whatever the mission pays;
- if that system is of the safest class, which is a security of 0.95 or above as the system
  was made (`eveuniverse/security.py`), and the mission pays ISK as a reward or as a bonus,
  shows an information banner with `UI/Agents/StandardMission/SecurityTaxMessage`.

The old details window words the same thing differently (two labels and a percentage,
`agentDialogueUtil.py` 379 to 389); with the job board on, that window is never built. The
agent's own window (`agentinteraction`) has no such banner.

**What the page did.** No banner, and it never asked where the agent is.

**What was built.**

- `GET /api/bridge/agents/:agentID/solar-system` on the BFF: the one call, its answer passed on
  as it came. Each ask goes to the server; it is the page that keeps the answer, as the
  client's service does.
- The page's model (`web/src/bridge/missionPage.ts`): `pageAgentToLocate` (the agent it asks
  about, or none), `pageSystemIDs` (the systems whose security it is drawn with, now the
  agent's too), and `reducedRewards`, the banner's words or nothing.
- The store keeps each agent's system by the agent's ID (`agents.agentSolarSystems`).
- The panel draws the banner after the bonus and before the extra information.

**A defect of mine, found by reading and set right.** What the page asks once — a mission's
keywords and an agent's record, both from earlier units — was remembered in a set beside
the store. Selecting a pilot empties what the store holds of agents, and the set did not
know. On the same flow, the next pilot's page (or the same pilot's, selected again) had no
agent cards and its text went unfilled, for good. Now a thing is "asked" while an ask for it
is on its way or the store holds an answer, and nothing is remembered anywhere else. The
test for it was written first and watched to fail.

**Proof.**

- Tests: 7 new. 50 ways of breaking it tried; one survived the first pass (the record's ask
  and the system's ask sharing one list of what is on its way), and a test for it was added.
  All are caught.
- Suite: 9498 tests, 9474 pass, 0 fail, 24 skipped, 0 todo.
- **By script, on both transports**, eve.js `e066a81e9`, as Test Two: the server places the
  courier's agent (3008416) in 30002780, another (3011895) in 30002779, and an ID that is no
  agent's nowhere (null); the client has the banner's label (24 characters).
- **In the browser, on the game port,** the courier on offer (agent in a system of 0.7): no
  banner; one ask for where the agent is; one request for security, the agent's system being
  one of the mission's own.
- **Staged, for the banner** (the store copied first and put back after; the journal is back
  at one offer): no courier agent is in a system of the safest class in this server's data
  (the highest is 0.949794), so a level 1 agent that is (3020239, in 30100038, security 1.0)
  was asked for a mission, which pays 65,000 ISK and a bonus of 80,000. Its page showed the
  banner, 24 characters of the client's words, last after the rewards and the bonus; one
  ask for where the agent is and one for that system's security. Opening both pages again
  asked for none of it again.
- **The pilot taken offline and brought back in the same tab:** the page asked for the
  agent's record, the mission's keywords and the agent's system again, and had its cards,
  its filled text and its banner. This does not show the defect above being set right: the
  tab makes a new flow for a pilot brought back, so the old code would have asked again here
  too. The flow that selects twice is covered by the test only.

**Seen, not followed.** The banner says rewards are reduced there. The only security tax in
the eve.js server's source is on bounties (`bountyRuntime.js`); whether this server pays a
mission's ISK reduced in such a system was not measured, and no recording of it is to hand.

**Not done.** The percentage the client works out and never shows (20). The banner's icon
and its colours. A system whose class the server has changed for a time (the client does not
use that here either).

### Next

1. Around a place's name, the rest: how many jumps away it is, by the client's safe route
   (a route solver that takes the security penalty); the outlaw's warning (the pilot's own
   security status).
2. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
3. The agent's cards above its own window, where the client's window has its own header.
4. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
5. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
6. Phase 3's writes, feature by feature, each set beside what the client sends.
7. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
8. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
9. Small, before a character is chosen: selecting on the account's own connection; the count
   of names checked.
10. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
11. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
12. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
13. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
14. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions).
15. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
16. Other things asked once beside the store, looked at for the same fault as this entry's.

## 2026-10-09 — how many jumps away a place is, by the client's autopilot route

Commit `f350fec`, pushed. Item 1 of the last list, in part.

**What the retail client does.** Beside each place on a mission's page
(`agentinteraction/objectivesteps.py` 149 to 164): this station; this solar system; or
`UI/Agents/StandardMission/JumpsAway` with the jumps from the pilot's system to the place's,
and `UI/Generic/NoGateToGateRoute` where there is no route. The jumps are
`clientPathfinderService.GetAutopilotJumpCount`: the route its autopilot would plot, with
the pilot's settings. Left as they come (`evePathfinder/stateinterface.py`,
`pathfinderconst.py`) those are the "safe" route type, a penalty of 50 on the slider, which
the pathfinder is given as exp(0.15 x 50), and two avoided systems, Jita and Zarzakh, with
avoiding on. A system is nought jumps from itself; there is no route to or from a system
outside known space.

The route itself is plotted by a native module, `pyEvePathfinder`
(`bin64/_pyevepathfinder.dll`), with no source among the client's scripts.

**How it was learned.** The module loads in the client's own Python
(`imp.load_dynamic`), and takes a map the way `evePathfinder/eveMapWrapper.py` gives it one.
Run over made-up maps, it showed:

- a least-cost flood from the start. To enter a system costs 0.9 where its security is 0.45
  or above; the penalty where it is above nought and below 0.45; twice the penalty at nought
  or below. Found by which of two ways it took as one of them was made longer, to a
  hundredth of a jump;
- the sums are kept in single precision and so is the penalty; the 0.9 is not. Of nine ways
  of doing the arithmetic this is the only one that gives the module's answer in all sixteen
  cases of two low-security systems set against one null-security system, which cost the same
  on paper and differ by a jump;
- an avoided system is never entered, unless it is where the route ends; a route may start in
  one;
- one flood answers for every system it reaches (7,017 read from floods run for another goal,
  none different), as the client's own cache of floods needs;
- **where two routes cost it exactly the same and differ in jumps, its answer goes by the order
  it was told of the map's jumps in.** The same map shuffled gives another answer. In a
  made-up map of six systems, 240 of the 720 orders of its jumps gave one answer and 480 the
  other, whatever order the systems were made in. No simple rule for it was found, and none
  is followed here.

Inside the limits of the other route types a system's cost was measured to vary with its
security (about 0.93 for low security, more for null, by how far below nought). That was not
followed through: only the safe type is built.

**What the page did.** Said "this station" or "this solar system", and nothing for anywhere
else. Its own route solver (`web/src/nav/routeSolver.ts`) is the shortest way, through Jita
or low security alike.

**What was built.**

- `web/src/nav/autopilotRoute.ts`: the flood, as measured. A system costs the same to enter
  from anywhere, so the first way found into it is a cheapest one; the breakage pass showed
  the first version carried ten lines it had no need of, and they are gone.
- `scripts/build-autopilot-fixture.js` and `test/fixtures/autopilotRoute.json`: the module's
  own answers over 131 made-up maps, 2,468 pairs. Each map is put to it in eight orders, and a
  pair whose answer changes with the order is left out (28 were).
- `GET /api/map/graph` carries each system's security. The page works the counts out from the
  map it already reads for its route solver (read once, and now by one read however many ask
  at once), and keeps them by "from:to" beside its names. Nothing is asked of the game server,
  as the client asks nothing.
- The mission's page says them, from where the pilot is now.

**Proof.**

- Tests: 10 new. 90 ways of breaking it tried: of the 14 that survived a first pass, ten were
  lines the flood did not need, three called for a better test (a made-up map on which the
  safe way and the short way were the same length could not tell the settings apart), and one
  changes nothing that can be seen. All that can be caught are.
- Suite: 9508 tests, 9484 pass, 0 fail, 24 skipped, 0 todo.
- **Against the client's own pathfinder over this server's whole map** (5,268 systems, 13,978
  jumps), with the settings as they come: 23,945 pairs from 400 systems, of every kind of
  security at either end. One differs: a null-security pair for which the client's own answer
  changes (21 jumps or 19) when the same map is put to it in another order.
- **In the browser, on the game port,** as Test Two, docked in Muvolailen: the courier's
  pick-up says this station and its drop-off, in Tasabeshi, "3 jumps", which is the client's
  pathfinder's answer for that pair. (Jita is next door to Muvolailen, and the route goes
  round it.) The map was read once.
- **Staged** (the store copied first and put back after; the journal is back at one offer):
  the low-security courier of two entries ago. Both its places said "29 jumps"; the client's
  pathfinder says 29 for each.

**Not seen, and not known.**

- The map here is this server's. That the client's own (`cfg.mapSystemCache`,
  `cfg.mapJumpCache`) has the same systems, jumps and security was not checked.
- The order the client tells its pathfinder of the jumps in, which settles the ties above.
- When the last check ran, another session had uncommitted edits to three files of the eve.js
  checkout (fitting and dogma). Whether the server I started had read them I do not know;
  nothing here touches fitting.

**Not done.** The other route types and the pilot's own settings (there is nowhere to set
them here). The pilot's other avoidance lists; jump gates; systems the server has locked; a
security the server has changed. The agent's own window, whose steps may say the same. The
page's travel autopilot still flies the shortest way, not this one.

### Next

1. The page's travel autopilot by the client's route (it has the route solver's and this one's
   maps already); the agent's own window's steps, if the client's say how far.
2. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
   status).
3. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
4. The agent's cards above its own window, where the client's window has its own header.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
13. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
14. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
15. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
16. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
17. Other things asked once beside the store, looked at for the fault of two entries ago.
18. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.

## 2026-10-09 — travel by the client's route

Commit `c29d913`, pushed. Item 1 of the last list.

**What the retail client does.** Its autopilot flies the route its pathfinder plots
(`clientPathfinderService.GetWaypointPath`, `GetAutopilotPathBetween`), with the settings
of the entry before this: the safe route, a penalty of 50, Jita and Zarzakh avoided. A route
from a system to itself is that system alone, and there is none to or from a system outside
known space.

**What the page did.** Breadth-first: the fewest jumps, through anything. So the mission's
page, since the last entry, could say "29 jumps" of a place the Travel panel would then fly
to in 18.

**What was built.**

- `autopilotPath` in `web/src/nav/autopilotRoute.ts`: the route itself. The flood now keeps,
  for each system, the one it was entered from, and the jump counts are read off the same.
- `routeAlong` in `web/src/nav/routeSolver.ts`: the gates along a way already chosen.
- `startRoute` plans with the two. Everything that travels goes through it.
- The fixture's builder now records, for each pair, how many low-security and how many
  null-security systems the client's route enters, beside its jumps. Which systems it goes
  through is not recorded: among routes that cost it the same, the module picks by the order
  of its map (on this server's map, Muvolailen to a place 29 jumps off, its route and this
  one differ in one system of the thirty).

**A decision taken in the operator's place:** the bots travel this way too. It is under "For
the operator", with the one line to change to go back.

**Tests that changed.** Three files' made-up maps numbered their systems 1, 2 and 3 and gave
them no security. The client plots only through known space and by security, so six tests
failed, rightly. Their maps are numbered and levelled as real ones are; nothing they assert
was loosened.

**Proof.**

- Tests: 4 new. 26 ways of breaking it tried; two survived, both lines that did nothing (the
  start marked as entered from itself; a check for a way with no gate, when the way is through
  the same map), and both are gone.
- The solver's route against the client's, over the fixture's 2,468 pairs: a real way through
  the map each time, as long, with as many low and as many null-security systems, and through
  nothing avoided.
- Suite: 9512 tests, 9488 pass, 0 fail, 24 skipped, 0 todo.
- **Flown, in the browser, on the game port,** eve.js `e066a81e9`, as Test Two in a Badger,
  from the station in Muvolailen to Perimeter (the store copied first and put back after; the
  pilot is docked where it was and the journal is at one offer). The Travel panel planned
  "Muvolailen → Maurasi" and "Maurasi → Perimeter", which is the client's pathfinder's own
  route for that pair; the fewest jumps go by Jita. It undocked, warped, jumped twice and said
  "arrived", in Perimeter, in 1 minute 55 seconds, and the server's flight status said in
  space in 30000144.
- **From there the mission's page** said 2 jumps to the pick-up and 5 to the drop-off; the
  client's pathfinder says 2 and 5.

**Not done.** The pilot's settings for all this (route type, penalty, what is avoided): the
client has a window for them and keeps them with the character's settings. The jumps other
parts of the page count are still the fewest (the agent finder's, the courier's, the industry
window's); the client counts some of those its autopilot's way and some the plain way
(`GetJumpCountFromCurrent`), and each wants looking at. Waypoints, of which the client's
route may have several.

### Next

1. The autopilot's settings, as the client keeps them: the route type (and the two it has that
   are not built), the penalty, the avoided systems, and whether avoiding is on.
2. The jumps the rest of the page counts, each by the way the client counts that one.
3. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
   status). The agent's own window's steps, if the client's say how far.
4. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
5. The agent's cards above its own window, where the client's window has its own header.
6. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
7. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
8. Phase 3's writes, feature by feature, each set beside what the client sends.
9. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
10. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
11. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
12. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
13. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
14. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
15. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
16. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
17. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
18. Other things asked once beside the store, looked at for the fault of three entries ago.
19. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.

## 2026-10-09 — the autopilot's settings

Commit `04e3eef`, pushed. Item 1 of the last list.

**What the retail client does.** Its route panel's menu (`infoPanelRoute.py`
`GetSettingsMenu`) has three kinds of route, "prefer shorter", "prefer safer" and "prefer
less secure" (`pfRouteType`: shortest, safe, unsafe); a slider from 1 to 100 for the
security penalty (`pfPenalty`); and ticks, one of them for avoiding the systems on the
pilot's list (`pfAvoidSystems`, the list being `autopilot_avoidance2`). They are the
character's own settings, kept on the player's machine (`settings.char.ui`). Until set they
are taken to be: safe, 50, on, and Jita and Zarzakh.

Changing one makes the pathfinder work its routes out again (its cache goes by the settings).

One slip of the client's own, kept: the tick is drawn from the setting taken as on until set,
and a click sets it to the opposite of the setting taken as off until set
(`OnCheckBoxAvoidSystems`). The first click on a tick never touched leaves avoiding on.

**The other route types, measured.** Run as before over made-up maps, the client's pathfinder
showed:

- "shortest" has no limits and charges every system the same;
- with limits, a system is inside them when its security is above the lower one and no more
  than the upper. The lower is held in single precision, which is why 0.45 itself is inside
  "safe" (0.45 to 1.0) while 0.0 is outside "unsafe" (0.0 to 0.45) and -1.0 outside "unsafe +
  zerosec" (-1.0 to 0.45);
- inside the limits a system costs 0.9 and up to 0.1 more, by how far its security lies below
  the upper limit as a share of the limits' span; and for that, a system of 0.45 or above
  counts as 1.0 and one above nought as 0.45, while one at nought or below counts as it is.
  For "safe" that is 0.9 for every system inside, as the entry before last had it;
- outside, as before: the penalty above nought, twice it at nought or below.

The formula was fitted to where the module changed its mind between two ways of made-up
lengths, then checked: the fixture now has all four types, 6,364 pairs over 239 maps, and the
solver answers every one as the module does.

**What the page did.** One route for everyone, the safe one, since the last entry.

**What was built.**

- `web/src/nav/autopilotRoute.ts`: every route type.
- `web/src/nav/autopilotSettings.ts`: the settings under the client's names, what each is
  taken to be until set, the tick's slip, and keeping them by character in the browser's
  storage.
- The flow reads the pilot's settings when it plans a route or counts jumps, and forgets the
  jumps it has worked out when a setting changes or the pilot does.
- The Travel panel's "Route settings": the three choices, the slider with its label as the
  client writes it, and the tick, in the client's words.

**Two faults found in the browser, and by no test.**

- The Travel panel stopped ("Travel stopped working: effect_update_depth_exceeded"). Its new
  effect read back the settings it had just set, so each run started the next.
- With that put right, changing a setting blanked the distances on a mission's page and they
  stayed blank: the jumps were forgotten, and the page asked for them only when the page
  itself changed. It now asks whenever what it holds of them changes.

A panel's tests render it once, on the server, where no effect runs. The brief now says so.

**Proof.**

- Tests: 14 new. 73 ways of breaking it tried; five survived a first pass: two checks that
  could not matter were removed, and three tests were made to look at what they had not. All
  that can be caught are.
- Suite: 9526 tests, 9502 pass, 0 fail, 24 skipped, 0 todo.
- **Against the client's own pathfinder over this server's whole map**, from Muvolailen to
  four systems under six settings (safe at 50 with and without avoiding, safe at 1,
  shortest with and without avoiding, unsafe): the same counts every time.
- **In the browser, on the game port,** as Test Two, with the low-security courier staged
  (the store copied first and put back after; the journal is back at one offer):
  - the settings drawn in the client's words (its five labels, by their lengths), with the
    safer route chosen, the slider at 50 and the tick on;
  - the mission's page beside it: 29 and 29 jumps; "prefer shorter" 18 and 15; "prefer less
    secure" 35 and 32; safer again 29 and 29; the slider let go at 1, 19 and 15. Each is the
    client's pathfinder's own count for that setting;
  - the tick clicked once stayed on, and clicked again went off;
  - after a reload the settings were as they had been left. They were cleared from the
    browser afterwards.

**Not done.** The list's own window (adding and removing systems, constellations and regions).
The other ticks: pod kills, Triglavian and EDENCOM systems (each needs a list from the
server), jump gates, stopping at each waypoint. A route already being flown is not plotted
again when a setting changes, as the client's is. The slider's hint, and the dialog the
client shows when avoiding is turned on.

### Next

1. The jumps the rest of the page counts, each by the way the client counts that one (the
   agent finder's, the courier's, the industry window's: some its autopilot's way, some the
   plain way, `GetJumpCountFromCurrent`).
2. The avoidance list's own window, and a route plotted again when a setting changes under it.
3. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
   status). The agent's own window's steps, if the client's say how far.
4. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
5. The agent's cards above its own window, where the client's window has its own header.
6. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
7. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
8. Phase 3's writes, feature by feature, each set beside what the client sends.
9. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
10. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
11. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
12. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
13. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
14. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
15. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
16. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
17. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
18. Other things asked once beside the store, looked at for the fault of four entries ago;
    and other panels' effects, looked at for the two faults of this one.
19. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.

## 2026-10-09 — the jumps the rest of the page counts

Commit `69ce2ed`, pushed. Item 1 of the last list.

**What the retail client does.** It counts jumps two ways, and each list says which
(`clientPathfinderService`):

- **its autopilot's route, with the pilot's settings** (`GetAutopilotJumpCount`): a mission's
  places, its location search's results (`entries/universe.py`), its agent lists
  (`agencyUtil.py`), the assets window, contracts, the info window, bookmarks;
- **the plain fewest jumps, nothing avoided** (`GetJumpCount`, `GetJumpCountFromCurrent`): its
  industry facilities and jobs, market orders, fleets, corporation offices.

**What the page did.** The fewest jumps everywhere but a mission's page.

**What was built.**

- `autopilotDistances` in `web/src/nav/autopilotRoute.ts`: the jumps from a system to every
  system its route can reach, with an avoided system among them where a route may end there
  (each by a flood of its own, as only that one may enter it).
- The Travel panel's search and the agent finder count the autopilot's way.
- So do the bots, for the reason their own comment gives: the number a bot refuses on should
  be the number it would have had to fly, and since two entries ago that is the autopilot's
  route. The jumps a mission bot weighs, the jumps to a drop-off in a script, and the agents a
  script finds within so many jumps all go by the pilot's settings now.
- The industry manager is left on the plain count, which is the client's for industry.

**Proof.**

- Tests: 6 new. 16 ways of breaking it tried; two survived, both checks that could not
  matter, and both are gone.
- The jumps to everywhere against the client's pathfinder: every one of the fixture's 6,364
  pairs, each read from one flood for its start.
- Suite: 9532 tests, 9508 pass, 0 fail, 24 skipped, 0 todo.
- **In the browser, on the game port,** as Test Two, docked in Muvolailen; nothing was staged:
  - the agent finder listed agents in 22 systems, nearest first. Its jumps for all of them
    are the client's pathfinder's with the settings as they come. Two of them, Niyabainen and
    one more beyond Jita, are 3 and 4 jumps where the fewest are 2 and 2;
  - "prefer shorter" chosen and avoiding turned off, and the finder refreshed: those two
    read 2 and 2, which is the client's pathfinder's count for those settings;
  - the Travel panel's search for Niyabainen said "2 jumps" with those settings and "3 jumps"
    with the safer route and avoiding back on.
  The settings were cleared from the browser afterwards.

**Not seen working.** Two of the bots' three counts have no test of their own and were not
run: the jumps a mission bot weighs (`getJumps`) and the jumps to a drop-off in a script.
Each is one line that asks the same helper the finder and the search ask. The third, the
agents a script finds within so many jumps, has a test: an agent two jumps off through Jita is
not found within two until the pilot turns avoiding off.

**Not done.** The page's other lists that the client counts its autopilot's way and that
count nothing here yet (assets, contracts).

### Next

1. The avoidance list's own window, and a route plotted again when a setting changes under it.
2. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
   status). The agent's own window's steps, if the client's say how far.
3. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
4. The agent's cards above its own window, where the client's window has its own header.
5. The ledger's unread pairs, most called first: the inventory and wallet reads, then the
   writes on `ship` and `dogmaIM`.
6. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
   codes not done.
9. Small, in space: an overview row's speed columns the client's way; the bar the client
   fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
10. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
11. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
12. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
13. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
14. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
15. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
16. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
17. Other things asked once beside the store, looked at for the fault of five entries ago;
    and other panels' effects, looked at for the two faults of the entry before this.
18. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
19. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — the wallet's reads, and the corporation registry

Commit `f04ba71`, pushed. From the ledger's unread pairs (item 5 of the last list), taken ahead
of the avoidance list's window: six entries have gone to routes and their settings, and the
plan's own remaining work is the calls on the wire.

**What the retail client does.**

- **The corporation registry is never asked by name.** `sm.RemoteSvc('corpRegistry')` appears
  nowhere in the client. Every call is on a moniker, `Moniker('corpRegistry', session.corpid)`
  (`eveMoniker.GetCorpRegistry`), which the corp service binds once and binds again when the
  pilot's corporation changes (`base_corporation.py` 137 to 148). Its session check is on the
  corporation, not on where the pilot is.
- **The wallet's activity is one read**: `account.GetTransactions(accountingKeyCash, year,
  month, False)` (`accountsvc.py` 116), four positional arguments, the last a bool, with None
  for this month. The client lists it as "Transactions". Its "Market Transactions" are another
  read altogether, `marketProxy.CharGetTransactions`.
- **`account.GetJournal` is a call the client never makes.** The server has a handler for it and
  answers the same entries as a Rowset.
- `account.GetCashBalance(0)`, `account.GetEntryTypes()`, `account.GetWalletDivisionsInfo()`
  and `officeManager.GetMyCorporationsOffices()` are asked as the BFF asked them.

**What the BFF and the page did.** Asked the registry by name, in some forty routes, reads and
writes. Asked for the journal and for the transactions both, the transactions with a number
where the client sends a bool; and the page listed the same activity twice, the second time
under "Market transactions".

**What was built.**

- On the game port every `corpRegistry` call goes out on the registry's moniker: bound with
  the session's corporation, kept through a move, dropped when the corporation changes. One
  change in the transport, for every route that asks it.
- The wallet route asks what the client asks: no journal, and the transactions with False.
  Whatever a route says for that argument, the transport sends a bool.
- The page lists the wallet's activity once, from the transactions. The decoder for the
  journal's Rowset is gone, its tests moved onto the same entries as the client's read
  answers them.
- Six more pairs have entries in `src/gamePort/retailCalls.js`.

**Proof.**

- Tests: 5 new, and the wallet's own brought into line. 23 ways of breaking it tried; one
  survived a first pass (the test moved a ship's object by a bind of its own, which the kept
  moniker has no part in) and the test now makes a call on the moniker either side of the
  move. All are caught.
- Suite: 9537 tests, 9513 pass, 0 fail, 24 skipped, 0 todo.
- **On both transports, by script,** as Test Two: the wallet answered in 13 ms with nine
  entries, each with the twelve fields the client's read has, seven division names, and no
  error; the journal is no longer among the answer's fields.
- **The server's own log of the game-port pass** (eve.js `e066a81e9`, with another session's
  uncommitted edits in the checkout): `account GetCashBalance`, `GetWalletDivisionsInfo`,
  `GetTransactions` with four arguments and `GetEntryTypes`; then
  `corpRegistry MachoBindObject`, "bound object registered", and `GetCorporation` twice on that
  one object. No `GetJournal` anywhere in the log.
- **The transport's own ledger for that BFF**: `corpRegistry.GetCorporation` five calls,
  all counted as reshaped (asked by name, made on the moniker); the four `account` pairs and
  `officeManager.GetMyCorporationsOffices` all counted as the client's.
- **In the browser, on the game port:** the Wallet window drew the balance and one list,
  "Recent activity", with the entries; no "Market transactions"; nothing failed.

**A test run that did not end.** A new test sent its pilot into space and left it there; the
file passed and never exited, and the command behind it was put in the background, which this
loop must not leave. It was found and stopped within the iteration (no test process was left),
the test now moves its pilot between two stations, and the brief says how to run such a file.

**Not done.**

- The ledger's report (`docs/game-port-call-ledger.md`) is not made again: it wants the same
  pass and walk it was made from.
- Whether the client's corp service makes each of the registry's calls the BFF makes, and
  with what arguments, pair by pair: the forty are on the right object now, and only
  `GetCorporation` has been read.
- The explicit `Unbind` the client gives the old registry when the corporation changes.
- The wallet's "Market Transactions" tab, and the transactions the client derives from one
  (`GetDerivedTransactions`: the corporation's tax and the security tax, shown as lines of
  their own).
- When the client asks for the divisions at all: the route asks with every wallet read.

### Next

1. The ledger made again from a pass and a walk, and its unread pairs, most called first:
   `dogmaIM.GetAllInfo` and the other dogma reads, `contractProxy`, `charMgr`.
2. The corporation registry's other calls, each set beside the client's.
3. Phase 3's writes, feature by feature, each set beside what the client sends.
4. The wallet's "Market Transactions", and the lines the client derives from a transaction.
5. The avoidance list's own window, and a route plotted again when a setting changes under it.
6. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
   status). The agent's own window's steps, if the client's say how far.
7. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
8. The agent's cards above its own window, where the client's window has its own header.
9. The scanner the client's way: results kept from the server's word, a probe's destination
   and range kept here and sent with the scan.
10. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
11. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
12. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
13. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
14. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
15. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
16. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
17. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
18. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
19. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
20. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
21. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — fourteen more of the ledger's pairs, and standings asked as the client asks

Commit `6d35884`, pushed. Item 1 of the last list: the ledger made again, and its unread pairs
taken most called first.

**What the retail client does.**

- **`dogmaIM.GetAllInfo`** is asked on the dogma location's moniker with three positional
  arguments, `GetAllInfo(primeCharacter, primeShip, primeStructure)` (`godma.py` 2409), each
  saying whether that one is to be primed. The BFF asked with none.
- **`dogmaIM.ItemGetInfo`** always names its item (`godma.py` 1649). The BFF's probe route asks
  with none, which this server answers for the ship; the client never asks so.
- **`dogmaIM.GetLayerDamageValuesByItems`** is sent a set of the drones in the bay whose damage
  the client does not know, and is not asked at all when there are none
  (`droneDamageTracker.py` 38). The probe route sends an empty list.
- **`dogmaIM.GetTargeters`**, **`agentMgr.GetAgents`**, **`agentMgr.GetMyJournalDetails`** and
  **`standingMgr.GetCharStandings`** are asked with nothing, as the BFF asks them.
- **Six of dogma's reads the client never makes**: `GetDroneSettingAttributes` (godma keeps the
  drone settings `GetAllInfo` brought), `GetCharacterAttributes` (the skills service asks the
  skill handler), `QueryAttributeValue` and `GetLocationInfo` (the client's own dogma works them
  out), and `GetRequiredSkillLevels` and `QueryAllAttributesForItem` (asked only by a
  developer's tool in the client).
- **`standingMgr.GetCorpStandings` is asked only for a pilot whose corporation is not an NPC
  one** (`standingsvc.py` 118, `idCheckers.IsNPC(session.corpid)`). For a pilot in an NPC
  corporation the client asks `GetCharStandings` alone and takes the corporation's to be none.
  The BFF asked both for everyone.
- The client asks its standings when the character or the corporation changes
  (`ProcessSessionChange`), and keeps them; and it asks `standingMgr.GetNPCNPCStandings()`
  first, each time. The page asks when its panel opens, and nothing here asks the third read.

**What was built.**

- Fourteen pairs have entries in `src/gamePort/retailCalls.js`, each with the client file and
  line it was read from. `GetAllInfo` asked with fewer than three arguments goes out as godma's
  first priming does, `(True, True, None)`. `ItemGetInfo` counts as the client's only when it
  names an item. The six are marked as the web client's own, and the drones' damage read as a
  known difference.
- The standings route does not ask for the corporation's standings when the pilot's
  corporation is an NPC one. It answers them as none, with no error, and the page lists them as
  none ("has no standings with anyone yet"), not as unread.
- `docs/game-port-call-ledger.md` is made again, from one pass of `scripts/bff-parity.js` over
  the docked routes as Test Two: 65 pairs in 101 calls. 14 the client's own, 9 reshaped to it,
  9 the web client's own, 2 known differences, 31 not yet read (45 before this entry).

**Proof.**

- Tests: 4 new (two on the registry, one on the route, one on the page's side). 18 ways of
  breaking it tried, all caught.
- Suite: 9541 tests, 9517 pass, 0 fail, 24 skipped, 0 todo. No test process left behind.
- **On both transports, by script** (`scripts/bff-parity.js`, as Test Two): 12 identical,
  6 tolerated, 2 moved, 2 divergent, as before (the two are the tuples in the journal and in
  industry's facilities, known from earlier entries). `/api/bridge/standings` identical.
- **The server's own log** (eve.js `e066a81e9`, with another session's uncommitted edits in
  the checkout): `GetAllInfo` arrives with three arguments. As Test Pilot, in NPC corporation
  1000044, on the game port: `standingMgr GetCharStandings()` and nothing else of
  `standingMgr`; the route answered in 4 ms with the pilot's own standings, the corporation's
  as none, and no error. As Test Two, in a player's corporation, both are asked.
- **In the browser, on the game port:** Test Two's Standings window drew both lists (six rows
  each, in three groups). Test Pilot's drew its own (13 rows) and, under its corporation's,
  "Your corporation has no standings with anyone yet."; nothing failed.

**A wrong note of mine, put right.** Earlier notes of this loop had Test Two in an NPC
corporation. It is in a player's (98000000), which is why the ledger still lists
`GetCorpStandings` after the repair: for that pilot the client asks it too. The NPC case was
then looked at with Test Pilot. The brief now says which pilot is which.

**Not done.**

- `standingMgr.GetNPCNPCStandings`, which the client asks at every refresh and nothing here
  asks; and standings asked once at the session's change and kept, where the page asks at each
  opening of its panel.
- What the client's standings window shows for an NPC corporation's pilot under the
  corporation's heading, if it shows that heading at all.
- The probe route's two differing calls (`ItemGetInfo` with no item, the drones' damage with
  an empty list): the route is a probe of the BFF's own, and whether anything of the page's
  counts on it has not been looked at.
- The ledger has no walk in the browser in it, and nothing in space: pairs the page asks only
  on a click, or only undocked, are not listed.
- The 31 unread pairs: `contractProxy` (the most called), `charMgr`, `marketProxy`,
  `industryManager`, `facilityManager`, `blueprintManager`, `calendarMgr` and
  `calendarProxy`, `mailMgr`, `notificationMgr`, `fleetObjectHandler`, and the rest.

### Next

1. The ledger's unread pairs, most called first: `contractProxy`, then `charMgr`,
   `marketProxy`, industry's three services, the calendar's two, mail and notifications.
2. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
3. The probe route's two differing calls: repaired or the route gone, by what the page uses.
4. The corporation registry's other calls, each set beside the client's.
5. Phase 3's writes, feature by feature, each set beside what the client sends.
6. The wallet's "Market Transactions", and the lines the client derives from a transaction.
7. The avoidance list's own window, and a route plotted again when a setting changes under it.
8. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
   status). The agent's own window's steps, if the client's say how far.
9. The page's own read of the journal after an agent's button: gone, if nothing of the page's
   own counts on it, with the push doing the work as it does for Remove Offer.
10. The agent's cards above its own window, where the client's window has its own header.
11. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
12. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
13. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
14. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
15. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
16. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
17. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
18. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
19. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
20. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
21. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
22. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
23. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — the proxy's services, and the contract search's keywords

Commit `8b342c2`, pushed. Item 1 of the last list: the ledger's unread pairs, most called
first, which were the contracts'. Reading them turned up something wider than a pair.

**What the retail client does.**

- **Fourteen services are reached with `sm.ProxySvc(name)`**, and none of the fourteen any
  other way: `contractProxy`, `marketProxy`, `calendarProxy`, `fleetProxy`, `corpRecProxy`,
  `bountyProxy`, `raffleProxy`, `search`, `XmppChatMgr`, `eventLog`, `alert`,
  `clientStatLogger`, `machoNet`, `pingService`. `ProxySvc` connects to the service at the
  client's proxy node (`serviceManager.py` 558); `RemoteSvc` names no node. The two leave
  with different addresses, and this server's own log of a retail client (9 August) shows it:
  `calendarProxy`, `eventLog` and `XmppChatMgr` arrive as `dst=node`, `calendarMgr` and the
  rest as `dst=any`. A name says nothing: the calendar has a service of each kind.
- **The contract search is one call with twenty-six keywords**, every one every time and no
  positional argument (`contractsearch.py` 1367): None for a filter that is not set, the sort
  the panel's list is on (it starts on date created, oldest first; on price for auctions and
  exchanges together), and `startNum`. The panel starts on the current region; no
  `locationID` is its All Regions.
- **`contractProxy.GetMyCurrentContractList` is never sent.** The client's contracts service
  has a wrapper for it that nothing calls. Its My Contracts panel lists with
  `GetContractListForOwner(ownerID, status, contractType, issuedBy, num=100,
  startContractID=...)` (`contractPanels.py` 419).
- `GetMyExpiredContractList` is asked with False and then with True for the corporation's,
  the two together, and kept. `GetLoginInfo()` is asked once, when the notifications are
  ready, for the Neocom's blink.
- **The market's transactions are asked for with None for the date**, wherever the client
  asks (`marketSvc.py` 23 and its two callers). `GetCharOrders`, `GetMarketOrderHistory` and
  `GetCharEscrow` take nothing.
- **An event's details and its responses are asked of an event the pilot has opened**, by the
  event's ID and its owner's (`eveCalendarsvc.py` 261, 415). The month's list is
  `calendarProxy.GetEventList(month, year)`, the pilot's own responses
  `calendarMgr.GetResponsesForCharacter()`.

**What the BFF did.** Sent every one of the proxy's services with no node. Searched contracts
with three keywords. Asked the market's transactions from date nought. And on every opening
of the Activity panel asked the calendar for the details and the responses of event nought,
with no owner, which the server refused both times.

**What was built.**

- The registry lists the proxy's services, and the transport addresses a call of theirs to
  the pilot's proxy node, on a pilot's connection and on an account's own. One change, for
  every route that asks one.
- A contract search goes out with the client's twenty-six keywords, written in the call's
  order: what the route gave, None for the rest, and the sort the panel starts on.
- The market's transactions go out with None.
- The calendar route asks for an event's details and responses only when an event is named.
  Otherwise each answers as none, with no error. The page uses neither.
- Twelve more pairs have entries in `src/gamePort/retailCalls.js` (the commit's message says
  eleven; twelve is right); the two reads of an event
  count as the client's only with the event and its owner both.
- `docs/game-port-call-ledger.md` made again from one pass: 63 pairs in 99 calls. 21 the
  client's own, 11 reshaped to it, 10 the web client's own, 2 known differences, 19 not yet
  read (31 before this entry).

**Proof.**

- Tests: 6 new, one changed (the calendar's defaults, which asserted the two calls for event
  nought). 57 ways of breaking it tried. Three survived a first pass: two swaps in the list
  of keywords, which the test had compared with itself and now states in the call's order;
  and a check that did nothing, which is gone. All are caught.
- Suite: 9547 tests, 9523 pass, 0 fail, 24 skipped, 0 todo. No test process left behind.
- **The client's own Python** (its `python27.dll`) was asked the order a service's method
  gives those twenty-six keywords and `machoVersion`: the transport's order is the same, all
  twenty-seven, and a test holds it.
- **On the wire**, read with the recorder between a game-port BFF and the server, as Test
  Two: `contractProxy.SearchContracts()` to `node(65450, contractProxy)` with the
  twenty-seven keywords in that order; `marketProxy.CharGetTransactions(None)` and the other
  three to `node(65450, marketProxy)`; `calendarProxy.GetEventList(10, 2026)` to the node,
  `calendarMgr.GetResponsesForCharacter()` and `account.GetCashBalance(0)` to no node.
- **The server's own log** (eve.js `e066a81e9`, with another session's uncommitted edits in
  the checkout), for the pass after the calendar's repair: `contractProxy` five calls and
  `marketProxy` four, all `dst=node`; one `calendarProxy GetEventList`, `dst=node`; one
  `calendarMgr GetResponsesForCharacter`, `dst=any`; no read of an event.
- **On both transports, by script** (`scripts/bff-parity.js`): 12 identical, 6 tolerated,
  2 moved, 2 divergent, as before. Contracts and the calendar identical, the market as it was.
- **In the browser, on the game port:** Contracts ("no public delivery jobs in this world
  yet"), Market (the ISK line and the escrow) and Activity (mail, notifications, one upcoming
  event) drew, and nothing failed.

**A command that did not end.** The recorder's launcher was piped to `tail`, the trap the
brief already names for a BFF. It was found within the iteration and its shells stopped; the
recording was then made with the launchers' output in files. The brief says so for anything
started detached, and how to read a BFF's wire this way.

**Not seen working.**

- A search that finds something. This world has no public contract, so the server was seen to
  take the twenty-six keywords and answer none, not to filter or sort by them. Staging two
  couriers would show the sort the client starts on (oldest first), which is the opposite of
  what the server gives a search with no sort.
- `fleetProxy`, `corpRecProxy`, `bountyProxy`, `search` and the rest of the fourteen: the
  pass asks none of them. They are addressed by the same line, which the tests hold.

**Not done.**

- The page's own lists of contracts read as the client reads them
  (`GetContractListForOwner`), in place of the call the client never makes; the
  corporation's expired list beside the pilot's own; and `GetLoginInfo` asked once and kept.
- The search scoped as the client's panel starts: the current region.
- The gateway transport still sends what the route spells. The game port is the one that is
  set beside the client.

### Next

1. The ledger's unread pairs, most called first: `charMgr` (five), industry's three
   services, `fleetObjectHandler`'s five, mail and notifications.
2. The page's own contracts read the client's way: `GetContractListForOwner`, both expired
   lists, the summary asked once. Two couriers staged, for the search's sort and filters.
3. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
4. The probe route's two differing calls: repaired or the route gone, by what the page uses.
5. The corporation registry's other calls, each set beside the client's.
6. Phase 3's writes, feature by feature, each set beside what the client sends.
7. The wallet's "Market Transactions", and the lines the client derives from a transaction.
8. The avoidance list's own window, and a route plotted again when a setting changes under it.
9. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
   status). The agent's own window's steps, if the client's say how far.
10. The page's own read of the journal after an agent's button: gone, if nothing of the page's
    own counts on it, with the push doing the work as it does for Remove Offer.
11. The agent's cards above its own window, where the client's window has its own header.
12. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
13. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
14. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
15. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
16. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
17. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
18. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
19. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
20. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
21. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
22. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
23. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
24. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — the ledger's last unread pairs, and the character sheet's reads

Commit `e1df11b`, pushed. Item 1 of the last list: `charMgr`, industry's three services, the
fleet's object, mail and notifications. With them the ledger's pass has no pair unread.

**What the retail client does.**

- **A read of one character names the character.** `charMgr.GetPublicInfo3(itemID)` is asked
  by the window that shows a character (`characterInfoWindow.py` 194), and
  `charMgr.GetCharacterDescription(session.charid)` by the sheet's bio (`bioPanel.py` 28). The
  BFF asked both with nothing, and the server took the session's.
- **The home station is `charMgr.GetHomeStationRow()`**, asked once by the character sheet's
  service and kept until the session is reset (`charactersheet.py` 59). The client never asks
  `GetHomeStation`; this server answers both with the same row.
- **`charMgr.GetCloneInfo` is a call the client never makes.** Its jump clones, their
  implants and the time of the last jump come from `GetCloneState()` on the `jumpCloneSvc`
  moniker for where the pilot is (`clonejumpsvc.py` 65 to 80: bound for the solar system in
  space or in a structure, for the station otherwise). The implants in the pilot's own head
  are godma's, from `GetAllInfo`.
- **All of a pilot's notifications are asked for with a keyword**:
  `notificationMgr.GetAllNotifications(fromID=fromID)` (`notificationSvc.py` 93). The BFF
  sent the number positionally.
- Asked as the BFF asks them: `charMgr`'s `ListStations()` on invCache's global container;
  `blueprintManager.GetBlueprintDataByOwner(ownerID, None)`;
  `industryManager.GetJobsByOwner(ownerID, includeCompleted)` and
  `GetJobCounts(session.charid)`; `facilityManager.GetFacilities()` and
  `GetMaxActivityModifiers()`; `mailMgr.SyncMail(firstID, lastID)`, which is `(None, 0)`
  for a client that holds no mail; `notificationMgr.GetByGroupID(groupID)` and
  `GetUnprocessed()`; and on a fleet's own object `GetInitState()`, `GetWings()`,
  `GetMotd()`, `GetJoinRequests()` and `GetFleetComposition()`.

**What was built.**

- Twenty more pairs have entries in `src/gamePort/retailCalls.js`. The two reads of a
  character go out naming the pilot's own when a route names none, and another character's
  as given. The notifications' read goes out with its keyword.
- The character sheet's route asks `GetHomeStationRow` where it asked `GetHomeStation`. Its
  answer keeps its place in the route's own.
- `charMgr.GetHomeStation` and `charMgr.GetCloneInfo` are marked as the web client's own.
- `docs/game-port-call-ledger.md` made again from one pass: 63 pairs in 99 calls. 36 the
  client's own, 14 reshaped to it, 11 the web client's own, 2 known differences, **none
  unread** (19 before this entry). 100 pairs have an entry.

**Proof.**

- Tests: 5 new, among them the first the BFF has of the character sheet's route. 27 ways of
  breaking it tried, all caught. A length check that would have swapped a named character
  for the pilot's own when a route gave two arguments was taken out before the pass.
- Suite: 9552 tests, 9528 pass, 0 fail, 24 skipped, 0 todo. No test process left behind.
- **The server's own log of the game-port pass** (eve.js `e066a81e9`, with another session's
  uncommitted edits in the checkout), as Test Two: `charMgr GetPublicInfo3` and
  `GetCharacterDescription` each with one argument, the server's own line reading
  `GetPublicInfo3(140000002)`; `GetHomeStationRow` with none; `notificationMgr
  GetAllNotifications` with no positional argument.
- **On both transports, by script** (`scripts/bff-parity.js`): 12 identical, 6 tolerated,
  2 moved, 2 divergent, as before; the character sheet, industry, mail, notifications,
  assets and the fleet's reads each as they were.
- **In the browser, on the game port:** the Character Sheet drew the pilot's name, the home
  station by its name, the bio and "Your active clone has no implants."; Activity drew
  twenty notifications and one event. Nothing failed.

**Not seen working.**

- The fleet's five reads for a pilot in a fleet: Test Two is in none, and the route that
  asks them is a probe of the BFF's own, which asks whether or not there is a fleet. The
  client has a fleet's object only while it is in one.
- A named character's public info through the game port (another pilot's, as the info
  window asks): no route of the page's asks it.

**Not done.**

- The clones the client's way: `jumpCloneSvc` on its moniker, `GetCloneState()`, and the
  implants read from what `GetAllInfo` brought. The sheet still asks the call the client
  never makes.
- What the client's own character sheet asks when it opens, set beside the route's four:
  the sheet's corporation, alliance and security status are not from `GetPublicInfo3` in
  the client.
- The ledger is of one pass by script over the docked routes. Pairs the page asks only on a
  click, and everything in space, are not in it: "none unread" is of that pass and no more.
- The gateway transport sends what a route spells; only the game port is set beside the
  client.

### Next

1. The ledger from a walk: every panel of the page opened in the browser on the game port,
   docked and then in space, and its unread pairs read, most called first.
2. The web client's own calls, one at a time, each replaced by what the client asks:
   `invbroker.GetCapacity` (29 a pass), `contractProxy.GetMyCurrentContractList`
   (`GetContractListForOwner`), `charMgr.GetCloneInfo` (`jumpCloneSvc.GetCloneState` on
   its moniker, and godma's implants), the dogma reads.
3. The probe route's two differing calls: repaired or the route gone, by what the page uses.
4. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
5. Two couriers staged, for the contract search's sort and filters; the corporation's
   expired list beside the pilot's own; the summary asked once and kept.
6. The corporation registry's other calls, each set beside the client's.
7. Phase 3's writes, feature by feature, each set beside what the client sends.
8. The wallet's "Market Transactions", and the lines the client derives from a transaction.
9. The avoidance list's own window, and a route plotted again when a setting changes under it.
10. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
    status). The agent's own window's steps, if the client's say how far.
11. The page's own read of the journal after an agent's button: gone, if nothing of the page's
    own counts on it, with the push doing the work as it does for Remove Offer.
12. The agent's cards above its own window, where the client's window has its own header.
13. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
14. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
15. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
16. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
17. Small, in Ready Fit: the capacity the client never asks for; the window following a change
    of pilot.
18. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
19. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
20. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
21. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
22. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
23. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
24. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
25. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — the ledger from a walk, and two routes that asked too much

Commit `3288122`, pushed. Item 1 of the last list, docked: the ledger made from the scripted
pass and from a walk in the browser through every panel of the page.

**What the walk showed.** All twenty-two panels and the mission's page opened on the game
port with nothing failing. Beside the pass's pairs it made eleven more, nine of them unread.
It also showed that two things taken for probes are the page's own traffic: the Fitting
window opens the dogma route, and the Fleet panel asks the fleet's five reads whether or not
the pilot is in a fleet.

**What the retail client does.**

- **Its fitting window asks dogma nothing of its own.** godma is primed once with
  `GetAllInfo` (`godma.py` 2409) and the window reads from that. The route the page opens
  asked eleven reads; the page read one of them.
- **A corporation's assets are searched when the pilot presses Search**
  (`corp_ui_accounts.py` 752), with `SearchAssets(which, itemCategoryID, itemGroupID,
  itemTypeID, qty)`, and a filter that is not set is None. The route searched with every
  reading of where the offices are, with nought for each filter, and the page did not read
  the answer.
- Asked as the BFF asks them: `stationSvc.GetStationItemBits()`, `station.GetGuests()`,
  `map.GetStationInfo()`, `structureDirectory.GetStructureInfo(structureID)`,
  `agentMgr.GetSolarSystemOfAgent(agentID)`, `GetMissionKeywords(contentID)` on the agent's
  object, and `corpmgr.GetAssetInventory(session.corpid, which)` and
  `GetAssetInventoryForLocation(session.corpid, locationID, which)`.

**What was built.**

- The dogma route asks `GetAllInfo` alone. Nine calls fewer with every opening of the
  Fitting window, among them both of the ledger's known differences.
- The assets route searches only when a request names one of the four filters, and answers
  the search as none, with no error, when it does not. On the game port a filter that is not
  set goes out as None.
- Nine more pairs have entries in `src/gamePort/retailCalls.js` (109 now).
- `docs/game-port-call-ledger.md` is made from the pass, the walk, and the assets asked by
  script: 64 pairs in 447 calls. 43 the client's own, 16 reshaped to it, 5 the web client's
  own, **none differing and none unread**.

**A decision taken in the operator's place.** The dogma route was built in the plumbing sweep
to make eleven reads reachable. It now makes one. The other ten stay on the allowlist, and
their decoders and the decoders' tests stay; what is gone is asking them of the server with
nothing to ask about, each time a window opens. To have them asked again, add them back to
`DOGMA_BOUND_READS` in `src/server.js`.

**Proof.**

- Tests: 5 new, 3 changed (two of the ledger's own and the transport's tally used the
  station's guests as their pair nobody had read; they use a made-up pair now). 31 ways of
  breaking it tried. Three survived a first pass and the tests were tightened: each filter
  named alone, a filter that is text, and a sixth argument. All are caught.
- Suite: 9557 tests, 9533 pass, 0 fail, 24 skipped, 0 todo. No test process left behind.
- **The server's own log of the game port** (eve.js `e066a81e9`, with another session's
  uncommitted edits in the checkout), as Test Two: the assets asked for the offices alone,
  one `corpmgr GetAssetInventory` with two arguments and no search; asked with a filter,
  that and one `SearchAssets` with five. The dogma route: one bound `GetAllInfo` with three
  arguments, and no other read of dogma behind it.
- **On both transports, by script** (`scripts/bff-parity.js`): 12 identical, 6 tolerated,
  2 moved, 2 divergent, as before, and the game port's pass nine calls shorter.
- **In the browser, on the game port:** every panel opened again after the change with
  nothing failing. The Fitting window drew the ship for Test Two (a Badger) and for Test
  Pilot (a Reaper).

**Not seen working.**

- **A module's figures in the Fitting window.** Neither test pilot's ship has a module
  fitted, so the window had nothing to list and nothing to click. That the page reads a
  module's figures out of `GetAllInfo` alone is held by its tests, not seen.
- The assets route reached from the page: the second walk did not open the views that ask it
  (PI, Build), so it was asked by script.

**Not done.**

- The walk in space.
- What the ledger cannot see: a route that answers from the store's file asks the server
  nothing, so it is in no ledger, and the client's way of reading the same thing is not set
  beside it. The Skills panel made no call of the game port at all.
- The Fleet panel's five reads for a pilot in no fleet: the client has a fleet's object only
  while it is in one.
- The five calls the client never makes that the page still does:
  `invbroker.GetCapacity` (128 in this walk), `contractProxy.GetMyCurrentContractList`,
  `dogmaIM.ShipGetInfo` and `ShipOnlineModules`, `charMgr.GetCloneInfo`.

### Next

1. The web client's own calls, one at a time, each replaced by what the client does:
   `invbroker.GetCapacity` first (the client works a capacity out itself), then
   `dogmaIM.ShipGetInfo` and `ShipOnlineModules`, `contractProxy.GetMyCurrentContractList`
   (`GetContractListForOwner`), `charMgr.GetCloneInfo` (`jumpCloneSvc.GetCloneState` on
   its moniker, and godma's implants).
2. The Fleet panel asking nothing of a fleet's object while the pilot is in no fleet.
3. The walk in space: undocked, every panel and the space view, the store put aside first
   and put back after; its unread pairs read.
4. A ship with modules fitted, staged, for the Fitting window's figures seen in the browser.
5. The routes that answer from the store, listed, and each set beside what the client asks.
6. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
7. Two couriers staged, for the contract search's sort and filters; the corporation's
   expired list beside the pilot's own; the summary asked once and kept.
8. The corporation registry's other calls, each set beside the client's.
9. Phase 3's writes, feature by feature, each set beside what the client sends.
10. The wallet's "Market Transactions", and the lines the client derives from a transaction.
11. The avoidance list's own window, and a route plotted again when a setting changes under it.
12. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
    status). The agent's own window's steps, if the client's say how far.
13. The page's own read of the journal after an agent's button: gone, if nothing of the page's
    own counts on it, with the push doing the work as it does for Remove Offer.
14. The agent's cards above its own window, where the client's window has its own header.
15. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
16. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
17. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
18. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
19. Small, in Ready Fit: the window following a change of pilot.
20. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
21. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
22. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
23. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
24. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
25. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
26. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
27. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — the Inventory panel's holds, reckoned as the client reckons them

Commit `469b7cc`, pushed. Item 1 of the last list: `invbroker.GetCapacity`, the call the page
made most that the client never makes.

**What the retail client does.**

- **It never asks the server how full a hold is.** Its inventory cache answers `GetCapacity`
  itself (`invCache.py` 1224), and for a ship godma does (`godma.py` 871).
- **A station's hangar has no capacity to show.** Its controllers have none
  (`invControllers.py`: `hasCapacity` is true for a ship's cargo and bays and for containers,
  not for a station's items or ships), and the cache's own answer for a station is
  9000000000000000.0 with nothing used.
- **A ship's hold is the ship's attribute as godma has it now** (the cargo is `capacity`), and
  what is used is summed from the hold's List: each thing in that flag, by
  `GetItemVolume` (`inventorycommon/util.py` 43), where its volume is above nought.
- **A thing's volume:** assembled (a singleton), its type's own; packaged, the override for
  its type, else for its group, else its type's own (`GetPackagedVolume`); a plastic wrap,
  its quantity over a hundred, negated; times the stack, unless the volume is -1.
- **The overrides are tables in the client's code** (`inventorycommon/const.py`): 49 groups
  and 264 types in this build.
- **Which bays a ship has is its type's attributes**, read from godma's type and not asked of
  anyone (`treeData.py` 300 to 363: `droneCapacity`, `specialOreHoldCapacity` and the rest).
  The page asks the server about each of twenty-seven flags to find that out.

**What was measured first.** With the overrides taken out of the client into the scratchpad,
the client's sum was set beside the server's own `GetCapacity` for both test pilots' hangar
and cargo: the same to the last digit, four holds of four. And dogma's `capacity` for the
active ship in `GetAllInfo` was the server's cargo capacity for both (3900 and 120). The
holds are nearly empty: one assembled ship in each hangar, one stack in one cargo.

**What was built.**

- `scripts/client-constants.py` and `src/clientData/clientConstants.js`: the client's own
  constants, read by running one module of its code in its own Python when first asked for.
  The packaged volumes are the first set.
- `src/clientData/holdCapacity.js`: the client's rule for a thing's volume and for what is
  used of a hold.
- The game-port transport answers a ship's attribute from the godma it keeps.
- On the game port the Inventory panel's route asks two Lists and no `GetCapacity`. The
  hangar has the client's figure for a station and what is used of it summed the client's
  way (the client shows no figure for a hangar; the page shows the room used). The cargo has
  godma's capacity and the same sum. Where that cannot be followed, and on the gateway, the
  server is asked as before.
- `scripts/bff-parity.js` names the one figure that is meant to differ between the
  transports, and counts any other difference in a hold's capacity as divergent.

**Proof.**

- Tests: 16 new. 74 ways of breaking it tried; three survived a first pass, all checks in the
  constants' reader that a printed JSON value cannot fail, and they are gone. All are caught.
- Suite: 9573 tests, 9549 pass, 0 fail, 24 skipped, 0 todo. No test process left behind.
- **The real client**: the script printed the two tables and the wrap's type from the
  install; the BFF read them on first use (it would have asked the server otherwise).
- **The server's own log of the game port** (eve.js `e066a81e9`, with another session's
  uncommitted edits in the checkout): both test pilots' Inventory read by script, four
  `List` calls on the bound inventories and no `GetCapacity`.
- **On both transports, by script** (`scripts/bff-parity.js`, as Test Two): the Inventory
  route differs in one figure, the hangar's capacity, named as the client's own; what is
  used of the hangar, and the cargo's capacity and use, are identical to what the server
  answers the gateway. 11 identical, 7 tolerated, 2 moved, 2 divergent (the two as before).
- **In the browser, on the game port:** the Inventory window drew "0.1 of 3,900 m³" for the
  cargo and "250,000 m³" for the item hangar; all twenty-two panels opened with nothing
  failing.
- The ledger of the pass and the walk: 62 pairs in 314 calls. `invbroker.GetCapacity` 81,
  every one from the bays route (three readings of twenty-seven flags); none from the
  Inventory panel.

**Not seen working.**

- **A packaged ship, a container or a wrap in a hold.** No test pilot has one. The rule for
  them is the client's, held by tests with made-up numbers, and has not been set beside the
  server's answer for a real one.
- A ship whose cargo a module or a skill has changed: both pilots' ships are bare.
- Whether the server holds a station's hangar to the 1,000,000 m³ it answers (see "For the
  operator").

**Not done.**

- The other three routes that ask `GetCapacity`: a ship's bays (twenty-seven flags a
  reading), the mining holds, a container. They need each flag's capacity attribute, which
  is in a module of the client's code that imports others.
- The gateway transport: it keeps no godma, and asks as before.
- A structure's hangar: the route is refused in a structure before it gets there.

### Next

1. A ship's bays the client's way: which bays from its type's attributes, each one's capacity
   from godma or the type, what is used from one List; then the mining holds and a
   container. The flag's attribute from the client's own table.
2. A ship with modules fitted and a hold with a packaged ship in it, staged: the Fitting
   window's figures and the client's sum, each set beside the server's.
3. The rest of the web client's own calls: `dogmaIM.ShipGetInfo` and `ShipOnlineModules`,
   `contractProxy.GetMyCurrentContractList` (`GetContractListForOwner`),
   `charMgr.GetCloneInfo` (`jumpCloneSvc.GetCloneState` on its moniker, godma's implants).
4. The Fleet panel asking nothing of a fleet's object while the pilot is in no fleet.
5. The walk in space: undocked, every panel and the space view, the store put aside first
   and put back after; its unread pairs read.
6. The routes that answer from the store, listed, and each set beside what the client asks.
7. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
8. Two couriers staged, for the contract search's sort and filters; the corporation's
   expired list beside the pilot's own; the summary asked once and kept.
9. The corporation registry's other calls, each set beside the client's.
10. Phase 3's writes, feature by feature, each set beside what the client sends.
11. The wallet's "Market Transactions", and the lines the client derives from a transaction.
12. The avoidance list's own window, and a route plotted again when a setting changes under it.
13. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
    status). The agent's own window's steps, if the client's say how far.
14. The page's own read of the journal after an agent's button: gone, if nothing of the page's
    own counts on it, with the push doing the work as it does for Remove Offer.
15. The agent's cards above its own window, where the client's window has its own header.
16. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
17. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
18. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
19. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
20. Small, in Ready Fit: the window following a change of pilot.
21. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
22. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
23. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
24. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
25. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
26. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
27. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
28. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — a ship's bays, known as the client knows them

Commit `b8ab8f1`, pushed. Item 1 of the last list. With it the game port sends no
`invbroker.GetCapacity` anywhere in the pass or the walk.

**What the retail client does.**

- **Which bays a ship has is its type's attributes**, read from godma's type and asked of
  nobody (`treeData.py` 300 to 363): a drone bay by `droneCapacity` or by the ship being one
  built of parts (`IsModularShip`, the strategic cruisers); a ship maintenance bay and a
  fleet hangar by the type saying it has one (`hasShipMaintenanceBay`, `hasFleetHangars`);
  every other hold by the type having that hold's capacity. The cargo is the ship itself.
- **How big a bay is**, for the ship being flown: godma's value of that bay's attribute
  (`godma.py` 871 on). For any other ship: the client's dogma has not loaded it
  (`clientDogmaIM.GetCapacityForItem` answers None), so the type's own value, the cargo by
  `evetypes.GetCapacity` (`invCache.py` 1268 on).
- **Each bay's attribute is a table in the client's code** (`inventoryFlagsCommon.py`,
  `inventoryFlagData`): thirty flags in this build, the route's twenty-seven among them.
- **What is in the bays is one `ListByFlags(flags=[...])`** for the flags not yet listed
  (`invCache.py` 1174), which is what the route already asked.

**What was measured first.** With the table read from the install, the client's way was set
beside the server's `GetCapacity` for all twenty-seven flags of both test pilots' ships: the
same for every one (a Badger with a cargo hold; a Reaper with a cargo hold and a drone bay).

**What was built.**

- `scripts/client-constants.py` gives a module the modules it imports, from the same
  archive, and stands in for those it does not use; a name can reach through an import. The
  holds' attributes are the second set `src/clientData/clientConstants.js` reads.
- `shipHasHold` in `src/clientData/holdCapacity.js`: the inventory tree's rule.
- The game-port transport says which ship is being flown and its type, from the session and
  godma.
- On the game port the bays route asks one `ListByFlags` for the bays the hull has, and no
  `GetCapacity`. A ship in the hangar has its type from the hangar's own list. What is used
  of each bay is summed from that one list. A bay that cannot be known so (a flag the
  client's table has not, no size to be found, a thing of unknown volume in it) is asked
  about by itself; the whole reading is asked as before where the client's way cannot be
  followed, and on the gateway.

**Proof.**

- Tests: 10 new, one changed for the reader's new arguments. 57 ways of breaking it tried,
  all caught; four checks that could not be made to matter were taken out before the pass.
- Suite: 9583 tests, 9559 pass, 0 fail, 24 skipped, 0 todo. No test process left behind.
- **Eighty hulls, staged** (`/gmships` as Test Two, the store put aside first and put back
  after: one row in the hangar again, the journal `[1,0]`): each one's twenty-seven bays read
  through both check BFFs. 2,160 bays; 2,153 the same in whether it is there, how big, how
  much is used and how many things are in it. By the server's count: a cargo hold on 76 of
  the hulls, a drone bay on 50, an ore hold on 3, and sixteen other kinds of bay on one hull
  each (whether that is one hull or several was not looked at). The seven that differ are
  two things, both the client's own way and neither a fault here:
  - four shuttles whose cargo holds nothing: the client has a cargo for every ship, where
    the route took the server's nought to mean there is none;
  - three haulers: the server gives a ship in the hangar the pilot's skill (5040 for 4800),
    the client the type's own. This is under "For the operator".
- **On both transports, by script** (`scripts/bff-parity.js`, as Test Two): the bays route
  identical; 11 identical, 7 tolerated, 2 moved, 2 divergent, as before.
- **The server's own log of the game port's pass** (eve.js `e066a81e9`, with another
  session's uncommitted edits in the checkout): no `GetCapacity` at all. The pass is 160
  lines of calls where it was 214.
- **In the browser, on the game port:** the Inventory window's "Badger bays (1)" drew the
  cargo hold, "0.1 of 3,900 m³", with its one stack; all twenty-two panels opened with
  nothing failing.
- The ledger of two passes, the walk and the staged reading: 61 pairs in 476 calls, and
  `invbroker.GetCapacity` not among them. Four calls the client never makes are left.

**Not seen working.**

- A ship built of parts (a strategic cruiser): none was among the eighty. Its drone bay is
  held by tests.
- A ship being flown whose bays a module or a skill has changed, beside the server's figure:
  the two test pilots' ships are bare, and the eighty were read from the hangar.
- A bay with something in it: the eighty were empty. What is used was the same on both
  transports only for the Badger's one stack.

**Not done.**

- The mining holds' route and a container's still ask `GetCapacity`. Neither is in the pass
  or the walk; the bots ask the first.
- A reading of a hangar ship's bays lists the hangar to learn the ship's type, once a
  reading. The client has the hangar's rows already.
- The gateway transport, which keeps no godma.

### Next

1. The last `GetCapacity`: the mining holds' route and a container's, the client's way.
2. The rest of the web client's own calls: `dogmaIM.ShipGetInfo` and `ShipOnlineModules`
   (the flight status read), `contractProxy.GetMyCurrentContractList`
   (`GetContractListForOwner`), `charMgr.GetCloneInfo` (`jumpCloneSvc.GetCloneState` on
   its moniker, godma's implants).
3. A ship with modules fitted and a hold with a packaged ship in it, staged: the Fitting
   window's figures and the client's sums, each set beside the server's.
4. The Fleet panel asking nothing of a fleet's object while the pilot is in no fleet.
5. The walk in space: undocked, every panel and the space view, the store put aside first
   and put back after; its unread pairs read.
6. The routes that answer from the store, listed, and each set beside what the client asks.
7. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
8. Two couriers staged, for the contract search's sort and filters; the corporation's
   expired list beside the pilot's own; the summary asked once and kept.
9. The corporation registry's other calls, each set beside the client's.
10. Phase 3's writes, feature by feature, each set beside what the client sends.
11. The wallet's "Market Transactions", and the lines the client derives from a transaction.
12. The avoidance list's own window, and a route plotted again when a setting changes under it.
13. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
    status). The agent's own window's steps, if the client's say how far.
14. The page's own read of the journal after an agent's button: gone, if nothing of the page's
    own counts on it, with the push doing the work as it does for Remove Offer.
15. The agent's cards above its own window, where the client's window has its own header.
16. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
17. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
18. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
19. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
20. Small, in Ready Fit: the window following a change of pilot.
21. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
22. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
23. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
24. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
25. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
26. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
27. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
28. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — the mining holds, reckoned as the client reckons them

Commit `6eecc7e`, pushed. Item 1 of the last list, the half of it that the bots ask.

**What the retail client does.** Nothing new to read: a hold's capacity is never asked of the
server (`invCache.py` 1224, `godma.py` 871), and each hold's contents are one `List(flag=...)`
(`invCache.py` 1138), which is what the route already asked beside each `GetCapacity`.

**What was built.** On the game port the mining holds' route lists each hold the hull has and
asks nothing else. A hold's size is godma's, or the type's where godma was not told of it;
what is used is summed from the hold's own List; which holds the hull has comes from the
client's own table. A hold that cannot be reckoned is asked about by itself, and off the game
port, or with no client to read, every hold is asked about as before.

**Proof.**

- Tests: 2 new. 11 ways of breaking it tried, all caught; one check that could not be made to
  matter was taken out first.
- Suite: 9585 tests, 9561 pass, 0 fail, 0 cancelled, 24 skipped, 0 todo. No test process left
  behind.
- **A hull with an ore hold, staged and boarded** (`/gmships` as Test Two, a ship of type
  48648 boarded; the store put aside first and put back after: one row in the hangar and one
  in the cargo again, the journal `[1,0]`). Its mining holds and its bays read through both
  check BFFs: the five holds the same on both (an ore hold of 2,400 m³ and a cargo of 50 m³,
  nothing in either; no gas, ice or asteroid hold), and all twenty-seven bays the same. This
  is the ship being flown, so its sizes on the game port are godma's.
- **The server's own log of the game port for that reading** (eve.js `e066a81e9`, with
  another session's uncommitted edits in the checkout): two `List` calls for the holds and
  one `ListByFlags` for the bays. No `GetCapacity`.
- **On both transports, by script** (`scripts/bff-parity.js`): 11 identical, 7 tolerated,
  2 moved, 2 divergent, as before.

**A test I took for broken, and was not.** A run of the mining tests showed one cancelled
after thirty seconds, with this entry's change and without it. It waits out a boarding that
never settles, 45 seconds by design, and it was my own 15-second limit on the run that
cancelled it; the suite, which has no such limit, passes it. The brief says so now, and to
read `cancelled` beside `fail`: my earlier totals in this log did not print it.

**Not seen working.**

- **In the browser.** The page shows the mining holds in space and to its bots; Test Two is
  docked in a hauler. The route was read by script.
- A hold with something in it, on a mining hull: the staged hull's were empty.

**Not done.**

- **A container's capacity.** The last `GetCapacity` the BFF sends. The client reckons it
  from the container's type (`evetypes.GetCapacity`; for a plastic wrap, whatever is in it;
  for a wreck there is no capacity at all, `invControllers.py` 1636), and the route is given
  only the container's ID. Its six callers in the page each have the row the container came
  from, with its type; none passes it. An office is opened by the same route, and the client's
  figure for one is the station's.
- The ledger's document is as the last entry left it: nothing this entry changed is in the
  pass or the walk it was made from.

### Next

1. A container's capacity the client's way: its type handed to the route by each of the
   page's callers, the wrap and the wreck and the office by their own rules.
2. The rest of the web client's own calls: `dogmaIM.ShipGetInfo` and `ShipOnlineModules`
   (the flight status read), `contractProxy.GetMyCurrentContractList`
   (`GetContractListForOwner`), `charMgr.GetCloneInfo` (`jumpCloneSvc.GetCloneState` on
   its moniker, godma's implants).
3. A ship with modules fitted and a hold with a packaged ship in it, staged: the Fitting
   window's figures and the client's sums, each set beside the server's.
4. The Fleet panel asking nothing of a fleet's object while the pilot is in no fleet.
5. The walk in space: undocked, every panel and the space view, the store put aside first
   and put back after; its unread pairs read.
6. The routes that answer from the store, listed, and each set beside what the client asks.
7. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
8. Two couriers staged, for the contract search's sort and filters; the corporation's
   expired list beside the pilot's own; the summary asked once and kept.
9. The corporation registry's other calls, each set beside the client's.
10. Phase 3's writes, feature by feature, each set beside what the client sends.
11. The wallet's "Market Transactions", and the lines the client derives from a transaction.
12. The avoidance list's own window, and a route plotted again when a setting changes under it.
13. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
    status). The agent's own window's steps, if the client's say how far.
14. The page's own read of the journal after an agent's button: gone, if nothing of the page's
    own counts on it, with the push doing the work as it does for Remove Offer.
15. The agent's cards above its own window, where the client's window has its own header.
16. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
17. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
18. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
19. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
20. Small, in Ready Fit: the window following a change of pilot.
21. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
22. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
23. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
24. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
25. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
26. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
27. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
28. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.

## 2026-10-09 — a container's capacity, from its type

Commit `d367a0c`, pushed. Item 1 of the last list, and the last `invbroker.GetCapacity` the
BFF sent.

**What the retail client does.** It opens a container by a controller that asks its
inventory cache for a capacity with no flag (`invControllers.py` 418), and the cache reckons
one (`invCache.py` 1224 on): the capacity of the container's type (`evetypes.GetCapacity`),
and the volume of everything the container lists, summed flag by flag over the flags the
list has. A plastic wrap is as big as what is in it. A wreck has no capacity at all
(`invControllers.py` 1636). The client knows the type because it has the item it opens.

**What the page did.** Opened a container by its ID alone, and the route asked the server for
its list and its capacity. Six places in the page open one; only the Inventory window reads
the capacity. The bots open cans and customs offices for what is in them.

**What was built.**

- The Inventory window says what the container is, from the row it was opened by (or, read
  again after its row has gone from the lists, what it was opened as; never another
  container's type).
- On the game port the route reckons the capacity from that type and asks the server for the
  list alone. A caller that does not say the type gets no capacity and costs the server none.
  Where it cannot be reckoned (a type the static tables have not or with no capacity, a thing
  of unknown volume in it, no client to read), and on the gateway, the server is asked as
  before.

**Proof.**

- Tests: 5 new (3 on the route, 2 on the page), 2 of the page's changed for the request's new
  form. 23 ways of breaking it tried; one survived a first pass (how the type is read from
  the request), and a case was added. All are caught.
- Suite: 9590 tests, 9566 pass, 0 fail, 0 cancelled, 24 skipped, 0 todo. No test process left
  behind.
- **A container, staged** (a Small Standard Container given, assembled, and 2,500 Tritanium
  put in it, as Test Two; the store put aside first and put back after: one row in the hangar
  and one in the cargo again, the journal `[1,0]`). Opened through both check BFFs with its
  type said: 120 m³ with 25 used on both, the gateway's from the server and the game port's
  reckoned. Opened on the game port with no type said: no capacity.
- **In the browser, on the game port:** the Inventory window's item hangar listed the
  container, "Open" asked the route with the container's type in the request, and the
  container's own view drew "25 of 120 m³" over its one stack. Nothing failed. The item
  hangar's own figure was 250,100 m³: the ship and the assembled container, each by its
  type's volume.
- **The server's own log** (eve.js `e066a81e9`, with another session's uncommitted edits in
  the checkout): from the game port, through the script and the browser both, `List` calls
  and no `GetCapacity`.
- **On both transports, by script** (`scripts/bff-parity.js`): 11 identical, 7 tolerated,
  2 moved, 2 divergent, as before.

**Not seen working.**

- A plastic wrap, and a container with a packaged ship in it: held by tests with made-up
  numbers.
- A can in space opened by a bot on the game port: no capacity is asked for there now, and no
  bot was run.

**Not done.**

- A wreck has no capacity in the client. Nothing in the page opens one with its type said,
  so the rule is not here.
- The item hangar's figure with an assembled container in it was not set beside the server's.
- The four calls the client never makes that the page still does.

### Next

1. The rest of the web client's own calls: `dogmaIM.ShipGetInfo` and `ShipOnlineModules`
   (the flight status read), `contractProxy.GetMyCurrentContractList`
   (`GetContractListForOwner`), `charMgr.GetCloneInfo` (`jumpCloneSvc.GetCloneState` on
   its moniker, godma's implants).
2. The Fleet panel asking nothing of a fleet's object while the pilot is in no fleet.
3. A ship with modules fitted and a hold with a packaged ship in it, staged: the Fitting
   window's figures and the client's sums, each set beside the server's.
4. The walk in space: undocked, every panel and the space view, the store put aside first
   and put back after; its unread pairs read.
5. The routes that answer from the store, listed, and each set beside what the client asks.
6. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
7. Two couriers staged, for the contract search's sort and filters; the corporation's
   expired list beside the pilot's own; the summary asked once and kept.
8. The corporation registry's other calls, each set beside the client's.
9. Phase 3's writes, feature by feature, each set beside what the client sends.
10. The wallet's "Market Transactions", and the lines the client derives from a transaction.
11. The avoidance list's own window, and a route plotted again when a setting changes under it.
12. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
    status). The agent's own window's steps, if the client's say how far.
13. The page's own read of the journal after an agent's button: gone, if nothing of the page's
    own counts on it, with the push doing the work as it does for Remove Offer.
14. The agent's cards above its own window, where the client's window has its own header.
15. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
16. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
17. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
18. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
19. Small, in Ready Fit: the window following a change of pilot.
20. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
21. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
22. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
23. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
24. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
25. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
26. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
27. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.
28. A wreck opened with its type said: no capacity, as the client has none for one.

## 2026-10-09 — the ship's own dogma, from godma

Commits `d5e1da7` and `1c0b7e5`, pushed. The first part of item 1 of the last list: two of
the four calls the page made that the client never makes.

**What the retail client does.** It never asks `dogmaIM.ShipGetInfo` or
`ShipOnlineModules`. Its godma is primed once with `GetAllInfo` (`godma.py` 2409) and kept
right by the server's notices; the fitting window and the undock read the ship from there.

A module fitted, moved or taken out arrives as an item that moved (`OnItemsChanged`, which
`invCache.py` 219 hands on one item at a time as `OnItemChange`). Two of the client's
services then act, and **a recording of the retail client on Tranquility has both on the
wire** (`Missions/Done/Combat/Encounter at Station 464 - Plus Some Data Analyzer
Mechanics.txt`, 2026-07-17 20:13:32, a module moved from the hold to a middle slot, docked):

1. `Add` on the inventory object, and before its answer two `OnItemsChanged` notices: the
   item made a single one, then the item in its slot.
2. Godma asks `ItemGetInfo(itemID)` on the dogma location and holds the answer, the item's
   row as `GetAllInfo` lists one (`godma.py` 1208, 1629).
3. The dogma location fits it ("Fitting item as a result from item change") and, its type
   having the online effect, calls `SetModuleOnline(ship, module)` on the same object, which
   answered None (`clientDogmaIM.py` 57, `clientDogmaLocation.py` 570, 611, 624, 698). The
   code takes a refusal of "EffectAlreadyActive2" as no failure.

**What the page did.** The Fitting route, the drones route and the script observation asked
the server `ShipGetInfo` and `ShipOnlineModules` each time; the flight status asked
`ShipGetInfo` for the ship's type and whether it is a capsule.

**What was built.**

- On the game port those routes answer from godma: the ship's row as `GetAllInfo` gave it,
  with its attributes as they are now (the capacitor and shield as they have recharged to),
  and the modules whose online effect is running. Only for the ship godma was primed for
  where it is now; otherwise, and on the gateway, the server is asked as before.
- The dogma store takes `OnItemsChanged` and `OnItemChange`: an item now in a slot of the
  held ship is held from then on, one that has left is forgotten with what was known of it,
  one that changed slot is in the new one.
- The transport does what the client does next, one call at a time and in the order the
  items were told of: `ItemGetInfo` for a module or a subsystem in a slot (not for what is
  in the drone bay or a fighter tube), its answer held in place of what was known; then, for
  one newly fitted whose type has the online effect, online at once and `SetModuleOnline`,
  and offline after all if the server refuses for another reason or does not answer. A read
  of the ship, and the undock, wait for these.

**How it went, and a claim withdrawn.** The first build (`d5e1da7`) was from the client's
code alone and had `SetModuleOnline` without `ItemGetInfo`. I had searched the top folder
of the recordings for a fitting, found none, and had "no recording was found" written for
this entry. A search of every folder found the one above, and the second build (`1c0b7e5`)
followed it. The brief now says to search every folder, and before building.

**Measured on the way.**

- Before the item changes were taken: a cargo expander fitted through the game port left
  godma's ship attributes equal to the server's own, and the online list empty where the
  server's had the module. This server's notices for the fit were one bundle (four attribute
  changes and the online effect starting) and then `OnItemsChanged`: the effect is told
  before the item is.
- After the second build, the server's own log for a fit in a session primed without the
  module: `GetAllInfo`, `Add` on another object, the notices, then `ItemGetInfo` and
  `SetModuleOnline` on the object `GetAllInfo` was asked of. Neither was refused.
- A module taken offline through the game port: the server sent the ship's capacity, speed
  and hull changes with the effect stopping, and godma's capacity was the server's (3,900).

**Proof.**

- Tests: 22 new (10 on the dogma store, 9 on the transport, 3 on the routes); four of the
  flight status's rewritten to read godma; one example swapped (a test used
  `OnItemsChanged` as its notice that is not dogma's). 142 ways of breaking it tried over
  the two builds. The survivors each led to a check that did nothing being taken out or a
  test being made to carry what the wire carries (a row's 64-bit IDs); one found a real
  fault before it was committed (a ship change with dogma not answering gave the last
  ship's row). All are caught.
- Suite: 9612 tests, 9588 pass, 0 fail, 0 cancelled, 24 skipped. No test process left behind.
- **A module, staged three times** (a cargo expander given to Test Two; the store put aside
  first and put back after each time: one row in the hangar and one in the cargo again, the
  journal `[1,0]`, nothing fitted). With the second build: fitted in a session primed
  without it and read at once through the game port, then through the gateway: capacity
  4,582.5, speed, hull, what is fitted and how many are online, the same on both.
- **In the browser, on the game port, with the second build:** the Fitting panel drew the
  fitted Badger from godma's priming ("Online", cargo 0.1 / 4,582.5 m³). "Unfit": the slot
  empty, cargo 3,900 m³. The expander picked and put in low slot 1 through the panel: the
  slot read "Online" a second and a half later, with "Take offline" beside it, cargo
  4,582.5 m³. "Take offline": "Offline". "Bring online": "Online". With the first build the
  bare ship was seen too (CPU 0 / 456, power grid 0 / 222).
- **The server's own log** (eve.js `e066a81e9`, with another session's uncommitted edits in
  the checkout), for everything the game port did across both builds: `ShipGetInfo` 0,
  `ShipOnlineModules` 0.
- **On both transports, by script** (`scripts/bff-parity.js`): 11 identical, 7 tolerated,
  2 moved, 2 divergent, as before; the flight status identical. One pass, made seconds
  after the server came back up, read 10 identical and 3 moved; the pass after it was as
  before. Which third route moved was not kept.
- The ledger (`docs/game-port-call-ledger.md`), from the pass, the browser's read of all 22
  panels and the fittings: 58 pairs, none unchecked, none differing, 2 the client never
  makes (4 before).

**Seen and not repaired.**

- In the browser (first build) the Fitting panel's cargo figure stayed 4,582.5 m³ while the
  module was offline. By script at the same step the route's capacity was 3,900. The panel
  takes that figure from the page's inventory read, which it did not make again after the
  module's state changed. The page's code is the same on both transports; the gateway was
  not looked at in the browser.
- This server has the module online before the client asks, where the recording has
  nothing of the kind before the client's own call (the operator's section).

**Not seen working.**

- A refusal to put a module online ("already online", or any other): tests only. This
  server refused nothing.
- What `ItemGetInfo` answered being held: tests only. No route reads a module's own
  attributes from godma while docked, so live there were the call and the online state.
- A module moved from one slot to another, a subsystem, a fit in space, a change of ship
  with modules aboard: tests, or nothing.
- The drones route and the script observation on the game port: tests only; no request for
  either was among the browser's.

**Not done.**

- A charge put in a slot as an item while docked. Godma asks about those too; there is a
  recording of ammunition topped up from the hold while docked, not yet read.
- Godma's other cases for an item that moved: a stack that only changed size, an item put
  in one of the ship's other holds.
- A refusal to put a module online is not shown to the user.
- A drone launched is let go of by the store, where the client keeps it. Nothing asked of
  the store is about a drone.
- The Fitting window's dogma route still asks `GetAllInfo` of its own each time, where the
  client primes once.
- The recording past the answer to `SetModuleOnline`: what Tranquility tells the client
  once the module is online.

### Next

1. The rest of the web client's own calls: `contractProxy.GetMyCurrentContractList`
   (`GetContractListForOwner`), `charMgr.GetCloneInfo` (`jumpCloneSvc.GetCloneState` on
   its moniker, godma's implants).
2. Around a fitted module: the recording read past `SetModuleOnline`'s answer, and this
   server's fit set beside it; the recording of ammunition loaded while docked, and charges
   in slots as godma holds them; the Fitting panel's cargo figure after a module's state
   changes; a refusal to put one online shown as the client shows it; the dogma route
   answered from godma's priming instead of its own `GetAllInfo`.
3. The Fleet panel asking nothing of a fleet's object while the pilot is in no fleet.
4. A ship with several modules fitted and a hold with a packaged ship in it, staged: the
   Fitting window's figures and the client's sums, each set beside the server's.
5. The walk in space: undocked, every panel and the space view, the store put aside first
   and put back after; its unread pairs read.
6. The routes that answer from the store, listed, and each set beside what the client asks.
7. The standings the client's way: `GetNPCNPCStandings`, and asked once at the session's
   change and kept, with the server's notices keeping them right.
8. Two couriers staged, for the contract search's sort and filters; the corporation's
   expired list beside the pilot's own; the summary asked once and kept.
9. The corporation registry's other calls, each set beside the client's.
10. Phase 3's writes, feature by feature, each set beside what the client sends, **each
    looked for in every folder of the recordings first**.
11. The wallet's "Market Transactions", and the lines the client derives from a transaction.
12. The avoidance list's own window, and a route plotted again when a setting changes under it.
13. Around a place's name, the last of it: the outlaw's warning (the pilot's own security
    status). The agent's own window's steps, if the client's say how far.
14. The page's own read of the journal after an agent's button: gone, if nothing of the page's
    own counts on it, with the push doing the work as it does for Remove Offer.
15. The agent's cards above its own window, where the client's window has its own header.
16. The scanner the client's way: results kept from the server's word, a probe's destination
    and range kept here and sent with the scan.
17. Small, around dialogs: the title for a dialog's kind, the "do not ask again" box, the typed
    codes not done.
18. Small, in space: an overview row's speed columns the client's way; the bar the client
    fills while a ship lines up for a warp; a warp ordered at a bookmark or a fleet member.
19. Small, before a character is chosen: selecting on the account's own connection; the count
    of names checked.
20. Small, in Ready Fit: the window following a change of pilot.
21. Small, in words: an interval's `shortForm` and `writtenFormTwoPart`; the bonus's
    countdown; a place's rating in its colour and its name as a link.
22. In the park, if a server ever sends a ball that needs them: MISSILE, FORMATION, MUSHROOM;
    a fixed ball's collision shapes and the partition's order.
23. If a server ever sends one: a special interaction drawn as the client draws one; messages
    inside messages.
24. More of the client's built data as it is needed: one line in `TABLES` for each (dungeons
    for ship restrictions); the client's own map, to set beside this server's.
25. When there is a recording of it: a courier's agent talked to again where the pilot
    accepted, before the package has gone anywhere (the operator's section); and a mission
    paid in a system of the safest class, for whether its ISK is reduced.
26. Other things asked once beside the store, and other panels' effects, looked at for the
    faults of earlier entries.
27. The pathfinder's ties: how the order of the map's jumps settles them, and the order the
    client's own map is in.
28. Jumps in the assets and contracts lists, the autopilot's way, where the page lists them.
29. A wreck opened with its type said: no capacity, as the client has none for one.
