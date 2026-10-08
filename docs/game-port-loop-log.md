# Game-port loop log

The journal of the unattended loop described in
[`goal-prompts/game-port-loop.md`](goal-prompts/game-port-loop.md). Newest entry last. Each entry
says what was done, how it was proved, what was committed, and what is next.

## For the operator

Decisions taken in your place, and anything waiting on you. Overrule any of these by saying so.

- **Pushing.** You started the loop with "commit as you go and push". I push `evejs-web-poc` after
  each commit. I do **not** push `eve.js`: your instruction there was to commit the fix, and its
  `main` is what others pull. Server fixes are local commits in `eve.js`, listed in the table
  below, waiting for you to push or to tell me to.
- **A BFF restart drops every game-port pilot** (default taken: accept it, as a retail client
  closing would).
- **The generic call path** keeps today's list of pairs as the BFF's own allowlist once the
  gateway's is gone (default taken).
- **The server answering None when a handler throws is left alone.** A real server sends the
  client an error there (`ExceptionWrapperGPCS.py` lines 45 and 93 wrap any exception into an
  `ErrorResponse`); EveJS answers None on purpose (`packetDispatcher.js` ~757). Changing that
  would turn every unfinished handler into an error dialog for anyone playing on the real client,
  which is your call, not a defect for a sub-agent. Handlers that throw are fixed one at a time.
- **eve.js's test runner cleans the temp folder.** The first sub-agent's test run swept 32 stale
  directories (11.7 GB, none touched for 29 hours) from the OS temp folder, `evejs-web-*` among
  them. That is the runner's own housekeeping, not something asked for; nothing in use was lost.

## Server defects

| Found | Defect | Evidence | Fix (eve.js) | Re-checked |
|---|---|---|---|---|
| 2026-10-08 | `corpRegistry.CanLeaveCurrentCorporation` returns `[0, "CrpAccessDenied", {}]`; the bare `{}` cannot be marshalled, so every client gets None | server log: `[PKT] ERR corpRegistry CanLeaveCurrentCorporation() Cannot marshal value: object {}` (7 times); the client unpacks three values (`corp_ui_home.py` 97, 532, 544) | `2e3101da4`, local, not pushed | 2026-10-08: harness reports it identical on both transports; no `[PKT] ERR` in the run |
| 2026-10-08 | `corpRegistry.KickOutMembers` returns a bare `{kicked, notKicked}`, which cannot be marshalled either, so the client gets None after the kicks are applied | the client indexes the answer, `results['kicked']` (`base_corporation.py` 469-471); read in the handler, not yet seen live | handed to a sub-agent | |

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

1. **Finish the `KickOutMembers` defect**: read the sub-agent's diff, widen
   `decodeCorpRegistryKickManyWriteAck` to read the dict as well as the bare object, restart,
   make the call live with an empty list as a character that may administer its corporation.
2. **Phase 3, step 1: the `PilotSession` seam as a pure refactor.** Start by reading how
   `heldTopLevelCall`, the bound bind and call, select, release and the event stream reach
   `src/eveGatewayClient.js` today, and write the interface down in the plan (2.1 has a sketch).
   Then move one helper at a time behind it, the suite green after each.
3. **Phase 3, step 2** and onward, as listed in the entry above this one.

