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
| 2026-10-08 | After a No to the decline question (`agents.YesNo`), `agentMgr.DoAction` is answered with "This agent is unavailable." and no buttons, though the offer still stands | the retail client draws whatever DoAction answers (`agentDialogueWindow.py` 402); seen live on the game port: that conversation, with the offer still in the journal | `624378554` on `main`, not pushed | 2026-10-08: server restarted; Decline then No in the browser brings back the offer with Accept, Decline, Defer |
| 2026-10-08 | Undocking with contraband aboard: the server fines and confiscates at once. It never raises `ShipContrabandWarningUndock` and ignores `ignoreContraband`, so the client's warning (OK to go on, Cancel to stay) is never shown | `ui/station/base.py` 488 to 510 catches that refusal and retries with `ignoreContraband` set; server log `[Contraband] ... fine=37500 standingLoss=0.200` at undock, the goods gone from the hold | `7282f54cc` on `main`, not pushed | 2026-10-08: server restarted; in the browser, Undock with ten Slaves aboard asks, Cancel leaves ship, goods and wallet untouched, OK undocks; the gateway route warns too |
| 2026-10-08 | The customs question (`XmppChat.AskYesNoQuestion`, dialog `ChtCustomsConfiscationConfirmation2`) sends its contraband entries in a tuple. The client's `cfg.FormatConvert` reads a tuple given as a value as one more typed value, so it raises instead of wording the dialog | the server's bytes (one entry: opcode `0x25`, a one-tuple); the conversion's shape run in the client's own `python27.dll` raises `IndexError` on a tuple of entries and words a list; the client's own caller builds a list (`eveCfg.py` 170). Not observed on a running retail client | `85042bbce`, by a sub-agent: the entries go as a list | the fix's test decodes the bytes (watched to fail first); in the browser on the game port the question was asked, worded and answered with the server on that commit |
| 2026-10-08 | `GetAllInfo` sends the active ship's hull `damage` (attribute 3) as the 0 to 1 ratio. The client reads hit points: hull is `(hp - damage) / hp` (`activeShipController.py` 107 to 119), so its panel shows a full hull on a damaged ship | a real answer: `damage = 0.2`, `hp = 150`, while `armorDamage = 52.5` of 150 and the server's own ballpark damage state said armour 0.65, hull 0.8; the gateway's snapshot said hull 0.8, the game port's 0.9987. Not observed on a running retail client | `7d5dbb532`, by a sub-agent: hit points, as armour and shield are sent | the fix's test (watched to fail first); the damaged ship re-recorded and read on each transport in turn: hull 0.8 on both; the browser's panel |

| 2026-10-08 | The server never sends `OnHeatAdded` or `OnHeatRemoved`. The client's dogma location registers for both (read from its compiled class) and only carries a rack's heat upward for modules it has been told are heating it (`clientDogmaLocation.py` 1340 to 1356, `heatAttribute.py`), so between the server's heat changes it cools a rack that is being heated | a model that follows the client's code, fed by the live server: the mid rack read 0.7648, then 0.7572 a second later, then 0.7694, while its module was overloading. Not observed on a running retail client | `10e2c22f4`, by a sub-agent: one add when a module starts counting toward its rack's incoming heat, one remove when it stops | the fix's nine scenarios (watched to fail first, by the sub-agent); live on the game port: sixteen readings half a second apart, none lower than the one before, each within 0.002 of the client's formula; the same in the browser's rack |

| 2026-10-08 | After a warp the server's second `SetBallMassive(ship, 0)` is stamped two ticks after the first. A ball dropping out of warp makes itself massive (`Ballpark::WarpDistance`), and when the drop is on the first stamp's tick the second arrives one step late: for that step the ship is massive, and beside a station (sent as a massive ball 100 km in radius) it bounces off it (`Ballpark::Potential`) | two recordings, four landings: stamps (D, D+2) in three, (D+1, D+3) in one; replayed through the park the ship rests 413.2 m and 412.8 m from the server's at the station, 0.06 m in the fourth. Not observed on a running retail client | **not fixed**: a third entry cannot go out under the server's own ceiling and would make the client's park double-step; left for the operator | the recording replayed with the stamps one tick apart: within a metre at both rests (a test) |

Withdrawn the same day: "after undocking the server's ship is a tick behind". It is not; that was
the second row above, seen through a recorder that always asked at the same point in the second.

Judged, not a defect to hand off: the server answers None, and logs `[PKT] ERR`, whenever a handler
or its marshaller throws. See "For the operator".

Seen and left, 2026-10-08: the decline question is sent with the time of asking as its `when`,
and the client's text reads "if you decline a mission before {when} you will lose standings", so
a retail player is warned about the present minute. The server's own decline timer for the agent
is the time meant. Not handed off: what a real server does with no timer running is not known.

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
