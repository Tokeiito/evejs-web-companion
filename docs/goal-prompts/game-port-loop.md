# Loop: EVE in a web browser, on the retail client's protocol

This file is the standing brief for an unattended work loop. Start it with:

```text
/loop Read docs/goal-prompts/game-port-loop.md in evejs-web-poc and carry out the next iteration it describes. Commit as you go and push.
```

Each time the loop fires, read this file again, then the log, then do one iteration. Your context
will be summarised more than once before this is finished. The files named below are the memory,
not the conversation.

---

## What this is for

The operator wants **EVE Online in a web browser, with minimal graphics**: a client that talks to
the EveJS server the way the retail client (build 3396210) does, so that the server cannot tell the
two apart, and that does what the retail client does. They are away and have asked for this to be
worked until it is done.

The operator restated it on 2026-10-17, restarting the loop self-directed: the goal is still the
EVE web app companion, plus fixing anything found wrong in the EveJS repository.

The route is already planned and partly walked. Phases 0 to 2 are complete: there is a game-port
session that logs in and stays connected as the retail client does, and a measured answer to "can
the browser's decoders read what the game port sends". What remains is moving the pilot off the
web gateway and onto that session, giving it a ballpark in space, and then moving the client's
logic into the browser.

## Read these first, every iteration

| File | What it holds |
|---|---|
| `docs/game-port-loop-log.md` | **The loop's own journal, kept in the working tree and never committed (git ignores it). Its Next list, at its end, says what to do next.** Begun afresh on 2026-10-15 (the operator's word); the entries before, with the old "For the operator" and "Server defects" sections, are in `docs/game-port-loop-log-until-2026-10-15.md`, also untracked, read for history and not written to. |
| `docs/game-port-transport-plan.md` | The plan, each phase's "done when", and each phase's status |
| `docs/game-port-client-reference.md` | What the retail client does on the connection, and where we match |
| `docs/game-port-parity-report.md` | Gateway against game port, read by read (generated) |

Then check the machine: `git status` in `evejs-web-poc` and in `eve.js`, and whether anything is
listening on 26000 and 26002. If a previous iteration was cut off with work uncommitted, finish it
or put it right before starting anything new.

## One iteration

1. **Pick the next unit** from the log's "Next", or failing that the earliest unfinished "done
   when" in the plan. A unit is something you can build, see working against the live server, and
   commit, in one sitting. If the next thing is bigger than that, the first unit is to split it.
2. **Find out what the retail client does** before writing anything (sources below). The standard
   is the retail client's behaviour, feature by feature: the same calls, the same arguments, the
   same order. "The server accepted it" is not the standard.
3. **Build it.**
4. **Prove it** by the real thing against the running server, with the client's own code read
   beside the change. A unit that touches what the browser shows is proven in the browser. Say
   what you saw, with the output. **No test is run** (the operator's word of 2026-10-13: the
   section "Tests" below).
5. **Commit it and push it.** Web changes in `evejs-web-poc`; server fixes are a separate matter
   (below).
6. **Write the log entry**: what was done, the evidence, the commit, any decision you took in the
   operator's place, and what is next. Update the plan's status when a phase's "done when" is met.
   The log is the loop's own and is not committed (the operator's word of 2026-10-15). Nothing in it
   is written twice: the entry goes in before the Next list, and the Next list, once, at the end, is
   changed in place, never appended again. A standing thing (no test run, eve.js's state) is said
   in an entry only where it changed.
7. **Go straight on to the next unit.** There is nothing to wait for between units.

## Tests: the operator's word of 2026-10-13

> I am finding tests are going "red" but those tests have bad assumptions or
> testing mechanics wrong. I don't trust any of the old tests. We need to stop
> skipping them and rarely writing tests. Any new test or old test needs to
> only be verified against a deep-decompiled client (not just the python), or
> the open source CCP repos. Also, stop wasting time running tests here. They
> are proving to be wrong.

From that day, in this loop:

- **No test is run.** Not a unit's own, not `eve.js`'s by its isolated runner, not the whole suite
  (`scripts/game-port-audit.js`), not a breakage run. Whatever this file says further down of
  running a test, of watching one fail, or of breaking a fix to watch a test catch it, is the
  older arrangement: it is kept for what it says of the machine and the tools, and is not
  followed. The type check and the page's build (`npm run typecheck`, `npm run build:web`) are
  not tests and are still run.
- **A unit is proven** by the client's own code read beside the change (its lines named in the
  commit and the log), by a recording where there is one, and by the real thing against the
  running server, in the browser where the browser shows it.
- **A test is written rarely**, and only for a rule that is the client's. Each assertion names
  where the rule is: in the decompiled client (its Python where the rule is there, and its
  binaries and data where it is there: the Python alone is not the whole client), or in CCP's
  open-source repositories (`destiny`, `blue`, `io`, `core`, `fsd`, `trinity`). A test of this
  repository's own plumbing (what a store keeps, what a route calls a field, the text of a
  source file) is not written.
- **An old test is not evidence.** A red one is not a finding about the code and a green one is
  not proof of it. Where an old test says what a unit's change makes untrue, it is read against
  the client's code or CCP's source: where it is right the code is mended, where it is wrong the
  test is mended or taken out, and the log says which and by what lines. It is not marked
  skipped, and it is not put on a list for the operator.
- **This loop's reading of one phrase**, for the operator to overrule: "stop skipping them and
  rarely writing tests" is taken as "no test is skipped or put aside, and tests are written
  rarely". If it meant that more are to be written, the third point changes and the rest stands.

**The operator's word of 2026-10-17**, restarting the loop:

> if needed, you can update any tests or AI harness testing we have, as you fix things. I
> wouldn't want a future session to get confused on what a test is testing or is wrong, if we
> have updated the code it tests. I still don't trust the old tests.

So, from that day: **a test (a unit test, or one of `eve.js`'s AI gameplay-harness scenarios) whose
code a unit changes is brought into line with the change in the same commit**, so that it says
what the code now does and why, with the client's lines or the recording named. Where what it
asserted was the old, wrong behaviour, its assertion is changed and its title and comments say
the new rule; where it tested only this repository's own plumbing, it may be taken out. The log
names each test touched. Old tests are still not evidence, and the suite is still not run as a
check of a unit.

## Where the truth is

Consult in this order. When two disagree, a recording of the real thing settles it.

1. **The decompiled client**: `eve.js/tools/ClientCodeGrabber/Latest` (and `ClientCodeGrabberV2`).
   What the client does and when. Decompile more with those tools when a module is missing.
   The decompiled Python can be wrong: each `.py` has its `.pyc` beside it, and a suspicious
   constant is read in the `.pyc`'s bytes (2026-10-16: `fittingUtil.py` reads `u'\u0x2022 '`, the
   `.pyc` holds two spaces, U+2022 and a space). The client's own devtools (`eve/devtools/script/*`)
   show what it expects of the server (`svc_fittingspawner` assembles the ship `/createitem`
   answers, so CCP's server makes it packaged).
2. **CCP's own source, on this machine** under `C:\Users\ryanf\Documents\GitHub`:
   `destiny` (the ballpark simulation the client runs: `Ball.cpp`, `Ballpark.cpp`), `blue` (the
   marshaller, `src/Marshal.cpp`, and the Python runtime glue), `io` (socket I/O and compression),
   `core`, `fsd`, `trinity`. For anything in space, `destiny` is the specification: port it, do not
   approximate it.
3. **The client install**: `D:\EVE Online - 3396210 - Copy\tq`. Its `python27.dll` answers
   questions about Python itself (`scripts/py27-oracle.py`): a dict's order, a hash, a float's
   print. The models checked against it are `src/gamePort/py27.js` and
   `web/src/bridge/py27DictOrder.ts` (`IntDict`); a merge (`d.update`, `dict(d)`, `d.copy()`) grows
   the table to above four times the count, as measured, not twice. Its texts (the localization
   labels, `dialogs.static`) are read through `src/clientData/clientWords.js`; its static data
   (`.fsdbinary`) through its own loaders, `scripts/client-built-data.py`
   (`src/clientData/clientBuiltData.js`, a `TABLES` line a table). Its other binaries can be
   decompiled when neither of the above answers. Never grep the whole install (it hangs).
4. **The EveJS server source**, `eve.js/server/src`: what the server accepts and sends.
5. **The server's logs**, `eve.js/_local/logs`: real client sessions by call name, handshake
   details, and `[PKT] ERR` lines, which are the only trace when a call answers None. Mark
   `server.log` with `wc -l`, act, and read what came after: `[PKT] IN`/`OUT` lines, the method,
   a GM command's text; bound calls show `N=`. `eve.js/doc` has the server's own parity ledgers
   (`PARITY_*.md`, `CHAT_COMMAND_REFERENCE.md`): read the topic's section before changing the
   server, and write to it when you do.
6. **Recordings of the retail client on Tranquility**: `D:\SSDSync\EveBadStuff\LOGS` (index in
   `LOG_MANIFEST.md`, missions under `Missions/`). The client's own log of sessions against CCP's
   server, every packet printed as a `MarshalStream` repr. This is what CCP's server really
   sends, and it settles what the decompiled client only implies: grep it for a call or a
   notification by name before calling anything EveJS does right or wrong, and before building
   from the decompiled source alone. **Search every folder of it** (`grep -rl`): most recordings
   are in subfolders, and one named for a mission may hold a fitting. On 2026-10-09 a search of
   the top folder alone missed the one recording of a module being fitted, which showed a call
   the reading of the code had missed. Reading the bytes:
   a dict entry's value is written BEFORE its key; `\x01` is None, `\x07` is -1, `/\x05`
   and five bytes is a long. An answer too large is not in a recording at all (it reads
   `LARGE PAYLOAD` and a size; a pilot's whole skill list is one): what a server sends there is
   then worked out, not read, and is written down so.

Tools already built for this: `scripts/recordings/` (read the Tranquility recordings: decode a
file's lines, list the calls made on a bound object and what answered each, tally what agents
offered, see `README.md` there), `scripts/capture-game-frames.js`
(record a conversation as a fixture), `scripts/record-game-port.js` (record any client),
`scripts/record-fleet-session.js` (two real sessions through a fleet's life, every notice and
answer each got: the pattern for a fixture that sets what a store keeps beside the server's own
later answer), `scripts/record-standings-session.js` and `scripts/record-skills-session.js` (one
session each, with a GM's changes: the same pattern for a store one pilot fills),
`scripts/record-journal-session.js` (a mission taken through its states by its agent's buttons,
the server's questions answered yes),
`scripts/login-calls-report.js` (a login read out of the server's own log, the
retail client's set beside the game port's: `docs/game-port-login-calls.md`; the logs of real
clients on this server are `eve.js/_local/logs/direct-tcp-real-client-*.stdout.log`, docked, and
`server.2026-10-06_15.log`, in space),
`scripts/parity-harness.js`,
`scripts/missiles-in-park.js` (a recording of the game port played through the client's park:
for each missile, the tick its ball touched its target, the stamp the server removed it at,
whether the explosion's entry came, and the stamps of its target's damage),
`scripts/soak-game-session.js`, `scripts/py27-oracle.py` with `scripts/build-py27-fixture.js`,
`scripts/vendor-marshal.js`.

## What you may do

The operator has given the run of this machine for this work (2026-10-08):

- Start, stop and restart the EveJS server. Reset game data. Edit the database. Stage whatever a
  test needs. **Not Docker** (the operator, 2026-10-16: "Don't touch Docker, that is there always
  because we need it but never change the market code"): never stop, restart or change a
  container, and never edit the market daemon's code.
- Profile the server where a pause or a slow answer is the question (`eve.js` since 2026-10-17,
  `doc/PAUSE_PROFILING.md`): `EVEJS_PAUSE_PROFILE=1` (with `EVEJS_PAUSE_PROFILE_SECONDS`) and
  `EVEJS_TICK_PROFILE=1` set when the server starts write CPU, GC and scene-tick profiles under
  `_local/logs/pause-profiles/`; `ProfileServer.bat` does the same with Windows counters. Remove the
  flags at the next ordinary start.
- Read and decompile anything on the machine.
- Take the recommended path at a fork and carry on, recording the decision in the log.

Start the server detached so nothing waits on an approval: a PowerShell `Start-Process node` in
`eve.js/server` with `EVEJS_PROXY_LOCAL_INTERCEPT=1`, `EVEJS_LOCAL_DATABASE_ROOT` and
`EVEJS_GAMESTORE_DATA_DIR` set as `StartServer.bat` sets them. Stop it with `taskkill /PID` and
**no** `/F`, which lets it flush. Copy `gamestore.sqlite` aside before a reset you could not undo.

## When the server is wrong

A **server defect** is something the retail client would also suffer: a handler that returns what
the server cannot marshal, answers the wrong shape, or mishandles what the retail client sends.
The test is evidence that the retail client is affected (a log line, the decompiled client, CCP's
source). Something only the web gateway or the web client would want is not a defect; the web
client conforms to the server, not the other way round.

When you find one:

1. Write down the evidence and a way to reproduce it.
2. **Hand it to a sub-agent** to fix in `eve.js` and commit. Do not give the sub-agent its own
   worktree. Brief it with: the evidence, the files, how to reproduce, `eve.js/CLAUDE.md` (its
   rules bind the sub-agent: commit to `main`, stage own paths one by one, serial tests, one step
   per commit, no co-author line), and the instruction to change no more than the defect needs.
3. When it returns, read its diff yourself, restart the server, and re-run the check that failed.
4. Log the defect, the fix's commit, and the re-check.

**Since 2026-10-12 the operator's word is wider**: "This is a dev machine. You can do anything to
the EveJS server, start it, find issues and fix them and commit based on what you find from the
decompiled client." So a defect may be mended and committed by the loop itself as well as by a
sub-agent, on the same evidence (the client's code, or a recording), by that repository's own rules
(commit to `main`, own paths one by one, its tests by its own runner, no co-author line). It is
still not pushed by this loop, and other sessions' files there are still left alone.

**The operator said it again that day**, after fifteen iterations that had written the server's
differences down as "found and left" or "the operator's to say" and gone on with the game port:
"Just a reminder: Any issue you find with the EveJS server, please fix and commit as you go." So:

- A difference between this server and a recording, or the client's own code, is **mended in the
  iteration that finds it**, or made the very next unit where it is large. It is not put under
  "Found and left".
- Those already written down come before any new unit of the game port's (the log's Next list has
  them at its head).
- "The operator's to say" is for a choice of what the product is to do, not for a defect, however
  large its mending. A defect whose proof this loop cannot see (the retail client's own picture)
  is mended as far as can be measured, and the operator's eye asked for the rest.
- A difference with no recording and nothing in the client's code is still not called a defect.

One is already known and waiting: `corpRegistry.CanLeaveCurrentCorporation` returns a bare `{}`
the marshaller refuses, so every client gets None (plan, Phase 2).

## What you must not do

- **Push `evejs-web-poc` after each commit**: the operator started the loop with "commit as you go
  and push". **Do not push `eve.js`**: there the instruction was to commit the fix, its `main` is
  what other people pull, and its own rules say not to push unless the owner asks. List each
  server fix in the log. Know that a commit on that shared `main` does not stay local: on
  2026-10-08 something else on this machine pushed `main` with the loop's two fixes on it. So
  commit there only what you would be content to see published, and check
  `git log origin/main..main` in `eve.js` at the start of an iteration so the log says what is
  true.
- Never create a branch or a worktree, including by the way a sub-agent is launched. Never force
  a push or rewrite history. No co-author or "generated by" lines in a commit.
- **Never launch the retail client outside `Play.bat`.** Its checks keep the client from reaching
  CCP's servers. Do not take over the operator's screen to drive it.
- **One transport per character at a time.** A gateway session and a game-port session for the same
  character evict each other, and in space that is an emergency-warp logoff.
- **Other sessions share the `eve.js` checkout.** Changes there that are not yours are someone
  else's work in progress: do not stage, revert, stash or "fix" them. If they stop the server
  booting, work on what needs no server and look again next iteration. Since 2026-10-16 another
  agent also switches this checkout to its own `codex/review-*` branches and back: read
  `git rev-parse --abbrev-ref HEAD` before a server fix, commit only on `main`, and commit right
  after the edit, before the live proof, so a switch cannot carry the change off. The running
  server runs whatever was checked out at its last start.
- Do not edit `src/gameProtocol/*` by hand (`npm run vendor:marshal -- --write`), or generated
  reports and fixtures (run their scripts).
- Do not weaken a test to make it pass, or call something done that you have not seen work.

## Decisions the operator left open

Take these defaults, and list each under "For the operator" in the log so they can overrule it:

- **A BFF restart drops every game-port pilot at once.** Default: accept it, as the retail client
  closing would; make the BFF close sessions cleanly on shutdown.
- **The generic call path after the gateway's allowlist is gone.** Default: keep today's list of
  pairs as the BFF's own allowlist, and widen it only where a feature needs it.
- **Anything new.** Prefer the choice that is closest to what the retail client does and easiest to
  undo. If a choice is neither reversible nor clearly what the retail client does, do the other
  available work first and leave that one for the operator, with your recommendation.

## Things that have already cost time

- A call that answers None for no reason: look for `[PKT] ERR` in the server log.
- An integer above 32 bits must go out as a Python long (`src/gamePort/clientMarshal.js` does it).
  Passing a BigInt into a handler any other way breaks it.
- The gateway's session is not a retail session (different roles, an extra attribute). Do not
  treat the gateway's answer as the correct one when the two disagree; find out which is right.
- Large inline patches through a shell heredoc get mangled on this machine. Write the file with
  the file tools and run it.
- A file git has checked out on this machine ends its lines CRLF (`core.autocrlf` is on); one
  a tool has just written ends them LF. A patch script that looks for several lines at once
  stops matching after a `git checkout` of the file. Normalise to LF before matching and put
  the endings back; `scripts/break-and-check.js` does.
- `taskkill //PID n` works in this shell only while path conversion is on. With
  `MSYS_NO_PATHCONV=1` set (which the BFF helper scripts need for their `/api/...` arguments)
  it must be `taskkill /PID n`, and the wrong one fails quietly enough to leave the old
  process holding the port.
- A long foreground `sleep` is refused. Wait with a short loop on a condition, or in the
  background.
- **Start a check BFF with the launcher's output sent to a file, never through a pipe.** The
  launcher redirects the BFF's own output, which makes the BFF inherit the launcher's handles;
  with `powershell ... | tail`, the pipe stays open for as long as the BFF lives, the shell
  command never ends, and the harness keeps it as a running background task. On 2026-10-08 one
  such task was open when the iteration ended, and the wakeup scheduled for 09:53 had not fired
  at 10:32, when the operator asked why the loop had stopped. Use
  `powershell -File start-bff-check.ps1 ... > bffgp.start.log 2>&1 < /dev/null`. Before ending
  an iteration, make sure no command of yours is still running. The same holds for anything
  else started detached: on 2026-10-09 the recorder's launcher was piped to `tail` and the
  command sat for four minutes until its shells were stopped.
- **A constant written into the client's code can be read at run time**, where the client knows
  something from neither the server nor its data files. `python scripts/client-constants.py
  <client>\tq\bin64 <client>\tq\code.ccp <module ending .pyj> <name> ...` runs one module of the
  client's code in its own Python and prints the named values as JSON; the BFF reads a set the
  same way on first use (`src/clientData/clientConstants.js`, one entry in `CONSTANTS` each). The
  module that imports others is given those it uses while it runs (`--with
  dogma.const=dogma/const.pyj`, from the same archive, in the order they need each other) and has
  the ones it does not use stood in for (`--stub evetypes`); a name may be dotted, to reach
  through an import (`dogma.const.attributeCapacity`). Look for the table in the decompiled
  source first, then read it from the install: the numbers are not to be copied into this
  repository.
- **A set of hulls to measure against is one GM command away.** `POST /api/bridge/gm/slash` with
  `{"command": "/gmships", "confirm": true}` put 146 assembled ships of as many types in Test
  Two's hangar (2026-10-09), and reading each through both check BFFs set the client's way of
  knowing a thing beside the server's for eighty of them in two minutes. Put the store aside
  first and put it back after.
- **A route given to `scripts/bff-parity.js` on the command line is rewritten by the shell**
  (`/api/...` becomes a path under the Git folder). Put `MSYS_NO_PATHCONV=1` before the command.
  The same for a GM command given to a script (`/giveskill ...`), and then the script's own path
  has to be written `C:/...`.
- **What a BFF really puts on the wire can be read**, where the server's log says too little
  (it gives a call's service, method, argument count and `dst=node` or `dst=any`, and none of
  its keywords). Start `scripts/record-game-port.js record 26007 26000 <file outside the
  repository>` detached, start one more check BFF with `EVEJS_GAME_PORT=26007` in its
  environment, ask it what is wanted, stop both, and `describe` the file: each call with its
  address, its arguments and its keywords in the order sent. The order the client's own Python
  would give a call's keywords is asked of `scripts/py27-oracle.py`, which has builtins only
  (no `copy`, no `json`; `copy.copy` of a dict is `dict(d)`).
- **The browser pane is hidden, and a hidden page stops polling space**, so the autopilot and
  anything else that decides from the space feed does nothing there. Before selecting a pilot,
  tell the page it is visible: redefine `document.visibilityState` (to `"visible"`) and
  `document.hidden` (to `false`) in the page and dispatch a `visibilitychange` event. Do it again
  after every reload. Dispatch a click in one call and read the result in the next.
- **The server's log stamps an outgoing client call late.** `[PKT] OUT agents YesNo()
  client-call` carried the time the answer arrived, seconds after the question was on the page.
  Do not time the server by that line; time what the client saw.
- **The server's log is kept by the hour.** `server.log` has the hour now; the hours before are
  `server.<date>_<hour>.log` beside it. A check that straddles the hour is in two files, and a
  search of `server.log` alone finds a session with no login.
- **A breakage that was "not tried" proves nothing.** `scripts/break-and-check.js` says NOT TRIED
  when the text to find is not in the file, and a shell heredoc halves the backslashes in a list
  of them, so a regular expression is never found. Write breakage lists with the Write tool, and
  read the count: caught plus survived must equal the total.
- **The client's own text for a label**: `node scripts/client-words.js "<client folder>" <label>`
  says whether the client has it and which parameters it takes. Look there before wording a
  label or sending one's parameters; two guesses of mine on 2026-10-08 were wrong. The check
  BFFs get the client's folder through `EVEJS_CLIENT_ROOT`. Do not copy the client's text into
  the repository: fixtures use made-up text in the real shape. The shape includes the label's
  markup, which the tool names too (its tags and its entities): a fixture of mine with a space
  where the real label has `&nbsp;` passed every test and drew the entity on the page. The
  client's label parser is CCP's own and open (`trinity/trinity/Tr2LabelTextParser.cpp`).
- **An effect that sets something must not read it, and something forgotten must be asked for again by
  something that sees it go.** Two faults of 2026-10-09, both in a panel's `$effect`, both invisible to
  every test (a panel's tests render it once, on the server, where no effect runs): one read the state
  it had just set and stopped the panel ("effect_update_depth_exceeded"); the other asked for a thing
  once and never again after the store forgot it. Any unit that adds or changes an effect is looked at
  in the browser, through the change that makes it run again.
- **The test pilots are not alike, and a check on one says nothing of the other's case.** Test Two
  (account `test2`) is in a player's corporation (98000000); Test Pilot (account `test`, docked in
  Jita) is in an NPC one (1000044). Anything the client does by `idCheckers.IsNPC(session.corpid)`
  wants both looked at. Every pilot's corporation is in the store's `characters` table (`key`,
  `json`), which `node:sqlite` reads with `readOnly: true` while the server runs.
- **The page brings its pilots back by itself.** It keeps who was online in
  `sessionStorage['evejs-web-online-pilots:v1']` and signs them in again on a reload, so a
  `POST /api/logout` from a script does not leave the tab logged out: use the page's own "Log out"
  button, once for each pilot. Another pilot is brought on from "Pilots" (a row of the roster); the
  "Bringing pilots online" dialog stays up over the page until "Stay here" or "Go to first pilot" is
  clicked, and "in client" in it means the pilot is on. The pilot's button in the bar makes it the
  one the page shows.
- **A test that sends a pilot into space must bring it back, or the file never ends.** In
  `test/gamePortPilots.test.js` a session change that gives the pilot a solar system starts its space
  (timers and all); a test that leaves it there passes and then the file hangs, and so does the whole
  suite behind it. Move a pilot between stations to test what a move does. Run a file you have added
  to with a limit (`timeout 200 node --test --test-timeout=15000 <file>`), and check afterwards that no
  test process is left (`Get-CimInstance Win32_Process` for node with `--test`): one was, on 2026-10-09.
- **One test is slow by design, and a short limit cancels it.** `test/bridgeMining.test.js` has "a
  hull type reported for a different ship than the bound one is not trusted", which waits out a
  boarding that never settles: 45 seconds. Run with `--test-timeout=15000` it is cancelled, and
  a cancelled test is not counted as failed. Give that file `--test-timeout=60000`, and when
  reading a run's totals read `cancelled` beside `fail`.
- **A pass over an empty world proves little.** The Contracts route read "identical" on both
  transports through every parity pass while there were no contracts. With four staged
  between the two test pilots (`contracts-stage.js` in the scratchpad shows how: give items,
  `/api/bridge/contracts/create` and `accept` through the gateway BFF), a search differed and
  a server defect was behind it. Stage what a list route lists before trusting a pass of it.
- **What a pass of the parity tool reads when nothing is wrong** (2026-10-16, docked, the tool
  exiting 0): as Test Two (`test2 140000002`), 19 identical and 15 tolerated; as Test Pilot
  (`test 140000001`), who is in no alliance, 22 identical and 12 tolerated. Nothing moved,
  nothing divergent. Anything else is news: read it. The count is the pilot's: I once took the
  other pilot's for a fault and spent a while finding out it was not, so say which pilot a pass
  was of. (Test Two's was 20 and 14 from 2026-10-10 until the flight's hull group, the server's
  sets of rows and a named refusal were read for what they are, on 2026-10-16.)
- **What the parity tool calls moved is a reading, not a fact.** It prints a `moved?` line for
  each value it puts down to time passing between its two reads, with both values: read them.
  A clock is a clock, and the tool leaves the server's own (`serverNowMs`) and a search's own
  time (`searchTime`) out; a count of none against two is not. A read that takes what it reads
  (`skillHandler.GetSkillChangesForISIS`, which this server forgets at the fourth asking) is
  read as `taken-by-the-first-reader`, not moved. The notices a session gets at login are
  taken before the first route (the pilot's state read until two reads bring none) and printed
  on the transport's line, so they no longer ride the first route's answer: the game port gets
  `OnModuleAttributeChanges` twice and `OnServerBrainUpdated`, the gateway none.
- **Print the whole of a pass, and make the first pass after a restart one of the two.** A pass
  read "1 moved" straight after the game-port BFF was restarted, and I had printed its last
  line only. It was `searchTime`, which the tool was meant to leave out and did not: the
  server's answer keeps it as a dict's entry (`{type: "dict", entries: [...]}`), and the test
  that said it was left out had it as an object's own field, a shape no answer has. Send the
  tool's output to a file and `grep -vE "^(identical|tolerated) "` it. And take a fixture's
  shape from an answer printed off the running BFF, not from the path the tool prints.
- **The market.** Orders are kept by a daemon of its own (`externalservices/market-server`, ports
  40110 and 40111), not in the store: `store.sh` does not put them back, so take down what you
  placed. Its running binary knows the stations of its seed only. Test Two's station, 60000004,
  is not one ("station 60000004 does not exist in market database", told to the pilot as "Market
  is currently offline"); Test Pilot's, 60003760 at Jita, is. So a market check is as Test
  Pilot. In the page: MARKET, type in "Search for an item to trade", Search, the item's button,
  "Offer to buy…", the two number inputs and the select in `section.bulk`, "Check this order…",
  "Yes, place this buy order"; then "Your orders", "Take it down…", "Yes, take this order
  down". The pilot's "GO TO FIRST PILOT" dialog has to be answered first.
- **A plain object in a call's arguments cannot be put on the wire.** The gateway hands one on
  as it is, and the server's handlers read it. On the game port the call is refused before it
  is sent: "was given an argument that cannot be sent: Cannot marshal value". A sale and a
  saved fitting were both so, and nothing had tried either. `plain-args.js` in the scratchpad
  finds the calls that write one out; the routes that take one from the page's request are
  found with `grep -n 'typeof body\.[a-zA-Z]* === "object"' src/server.js`. Each needs the
  client's own form in the registry, and a try on the game port.
- **What the gateway shows may be what the game port cannot be sent.** The gateway prints a
  handler's answer without marshalling it. An answer the server cannot marshal (a number too
  big for its column, a bare object) reaches a game-port client as nothing at all, with a
  `[PKT] ERR` line in the server's log and no error to the caller. A pilot's launches were so
  from the first launch on. After any walk, look for those lines over the walk's minutes:
  `awk '/^\[<date>T<hh:m>/' server.log | grep -aE "\[PKT\] ERR|Cannot marshal|out of range"`.
- **A feature the page has is proven by using it in the page.** Three routes were mended and
  tried by script, with "not in the browser" written each time. The first of them used in the
  page, the Planetary Industry window's Haul, found a server fault and a call that was not the
  client's, neither of which any script of mine had reached. The steps, with the pane hidden:
  the window's Pilots tab, `#pi-add-choice` set to the pilot and Add; its Colonies tab,
  Refresh, the box `input.pi-haul-tick`, and "Haul 1 colony". The run is the BFF's own bot:
  its log is `bot-logs/<characterID>.jsonl` in the BFF's data folder (`botlog.js` in the
  scratchpad prints it), `/api/bots/active` says whether it still runs, and it must have
  ended before the store is put back. `haul-stage.sh` stages a colony's two pins with the
  server stopped, and `gm-run.js` gives the pilot the hauler (`/giveskill me 3340 1`,
  `/giveitem 655 1`).
- **Before writing that the client cannot do a thing, find every caller of what does it.** I
  wrote that the client makes a customs transfer "at the office". The one recording has the
  pilot there. The client's window has three callers, two of them from the planet's windows,
  and wants only that the office be in the ballpark. `grep -rn "<function>"` over the
  decompiled client, and read each caller, before a recording's one case becomes a rule.
- **The gateway answers before the game port does, after a restart.** `store.sh` and the
  staging scripts wait for the gateway. A select through the game-port BFF fifteen seconds
  after one answered 502, "the game server is unreachable"; eight seconds later it went
  through. Wait a little longer, or try again, before taking it for a fault.
- **A byte in a recording's marshal is an opcode before it is a number.** `` is the integer
  nought, `	` one, `` minus one, `` None, `$` an empty tuple, `,` a tuple of two,
  `/` a long with its length after it, `
` a float of eight bytes, `` a dict with its
  count after it (each entry its value first), `` a name out of the string table. A note
  beside one recording had `GetInventoryFromId(officeID, 8)` where the wire has nought. Read
  the bytes, not the note.
- **A pair added to the BFF's write list changes a generated file.** `node
  scripts/build-bridge-contract.js --write` rewrites `contracts/evejs-web-bridge-contract.json`,
  and a test holds the two together. Read the diff: it should be the pair and nothing else. A pair put on the page's own writes
  (`PAGE_WRITE_PAIR_KEYS`) changes it too: the manifest names those (`genericBridgeWrites`).
- **eve.js's tests run through its own runner**, from that repository's root:
  `npm run test:isolated -- server/tests/<file>.test.js`. A bare `node --test` of one refuses
  to open the store and reads as one failed test.
- **A pilot with no skills cannot show that a module fits.** Test Pilot has none: the server
  answers that the module failed to load, through either transport. Test Two has the skills
  for an afterburner and a mining laser.
- **The check BFFs since the default changed (2026-10-10):** `restart-bffgp.sh` starts the
  game-port one with nothing said (the bare default, every account on the game port), and
  `restart-bffgw.sh` starts the other with `-Transport gateway`. `start-bff-check.ps1` takes
  `-Transport` and `-Overrides`; each BFF's `<name>.out.log` has the "Pilot transport:" line
  it started with. Read that line before trusting which transport a check ran on.
- **`.env` and `.env.example` cannot be read or changed from here** (the permission is
  withheld, and that is deliberate). A setting that wants documenting goes in the README.
- **The Docker combination can be checked on this machine.** `docker build -t
  evejs-web-poc-check:e .`, then run it as `compose.yaml` does but under its own name and
  port (26512), with `--add-host host.docker.internal:host-gateway`, `EVEJS_GATEWAY_URL` at
  `host.docker.internal:26002` and the eve.js checkout mounted read-only at `/srv/evejs`;
  `docker exec <name> node scripts/doctor.js` is the first thing to read. Remove the
  container (`docker rm -f -v`) and the image after. The operator's own image
  (`evejs-web-poc-local`) and volume (`evejs-web-poc-data`) are not to be touched.
- **A fleet with a second pilot handed to the host as a companion:** `companion-walk.mjs <repo>
  <bff> <commander account> <id> <companion account> <id> <out.json>` (the page's own setup
  and grant; Test Pilot and Test Three are both docked at Jita). As of 2026-10-10 the start
  is refused on both transports ("Join a fleet first"), so it gets no further than that.
- **Read the tally after every live run, whatever the run was for.** The companion's run
  failed at its start and still showed a read of an online pilot that no earlier walk had
  made: a start asked by the session that holds the pilot. `ledger-show.js
  <bff>-data/gateway-ledger.json` takes a second.
- **A read made of the account is measured twice: with nobody flying the pilot, and with the
  pilot flown in another web session of the same BFF.** Only the second shows a read of an
  online pilot in the tally. `training-walk.js <scratch> <bff> <account> <id> <out.json>` does
  both for Pilot Training's reads and prints a digest of each answer; `roster-flown.js` reads
  the hangar's roster rows with one pilot flown.
- **A site for a check:** `sites-scan.js <eve.js root> <first systemID> <count>` asks the
  server's own generator which systems have an ice site (run it from `eve.js/server`);
  `/solar <system name>` through the GM route moves an undocked pilot there; and
  `ice-walk.js <scratch> <bff> <account> <id> <out.json> <system>` reads the scanner's sites
  (`/api/bridge/bound-small-services`, `GetFullState`), warps to the ice one and then an ore
  one by label (`/api/bridge/flight/warp-scan`), and prints each grid's rows by shape.
  Halaima (30002781) has an ice site.
- **What the server's code calls a thing is not what a row calls it.** The site service
  makes an ice chunk with the kind "iceChunk"; the gateway's row for it says "asteroid". Read
  the row.
- **Two ways of asking one thing are set side by side for every case before one replaces the
  other.** `owner-compare.js <repo> <account>...` did it for whose a character is (the
  snapshot's row against the account's list, for each character of the server's), and it
  also showed the one place they differ: what is said of a character that is not the
  account's. `owner-live.js` asks the routes that check it, with the pilot flown elsewhere.
- **The brief's whole run, by the page's own buttons** (it passed twice on 2026-10-10; the
  log's entry has the steps). What made it quick the second time: one call that reads the
  docked windows by title (`.win-body`, the title in its parent; the inventory is not a
  window but `section.stn-view`); one that presses "Start Conversation with …", "Accept",
  "Load package into ship" and "Set autopilot to dropoff" in turn (the last undocks and
  starts the route by itself); a poll of the Travel window's STATE until the header says
  DOCKED; "Complete Mission"; then undock, the module by pointer events, a sentry gun's row
  and LOCK (`.target-card` loses `acquiring` when it has locked, some twenty seconds),
  the station's row and DOCK, and "Log out". `ab-stage.js` fits the afterburner Test Two's
  Badger needs for it.
- **A test that waits on a socket bounds its wait.** A `node --test` that never ends is moved
  to the background and stays there; mine did, twice. Give every wait a deadline, run a new
  socket test under `--test-timeout` the first time, and if one is left running stop it by
  its own command line (`Get-CimInstance Win32_Process` filtered on the test file's name),
  never by killing every `node`: the server and both BFFs are `node` too.
- **A request made in process** (`dispatchInProcess`, `src/pilotSocket.js`) wants a real
  stream where its connection would be, one that says it is readable, and `complete` set:
  the body parser skips a request it takes for finished, and Node takes an incomplete one
  for cut off. `socket-walk.js <repo> <bff> <account> <id>` asks a running BFF over a real
  socket and sets each read beside the same over HTTP.
- **The page is on the socket unless told otherwise** (since 2026-10-10). For a check over
  HTTP: in the page, `localStorage.setItem("evejs-web-transport:v1", "http")` and reload
  (take it off again after, and say so; a browser left on `http` is not the default). To
  see what goes which way from a script in the page: wrap `WebSocket.prototype.send` to count
  frames before choosing a pilot, and read `performance.getEntriesByType("resource")` for
  what went over HTTP. The first run of a thing in the browser is where its faults are: the
  socket's tests all passed while ten sockets stood open on the page.
- **A route moved into the page (Phase 6b), as the wallet was:** find what the client's own
  service asks and keeps (the recordings, then its code); write that asking once under
  `web/src/bridge/`, each call by `api.bridgeAsk(callOptions)`; have the flow use it and
  leave the route standing; answer the flow's tests call by call from the same things
  described; and set the route beside the page's own asking, live, on both transports, for
  pilots of more than one corporation (`wallet-compare.mjs <repo> <scratch> <bff> <account>
  <characterID>` is the pattern: it imports the page's TypeScript and asks through
  `/api/bridge/call`). Reading the client for a route is where the route's own faults show:
  the wallet's divisions had the hangar's names.
- **Size a route before it is named next.** A handler's length is not its size: the skills'
  is eleven lines, and its answer is made by 155 more from kept reads, static data and the
  server's clock. Read what the answer is made from, then ask each read by name through
  `POST /api/bridge/call` as a pilot (`skills-probe.js <scratch> <bff> <account>
  <characterID>` is the pattern): a call no list carries answers 403 `CALL_NOT_ALLOWED`, and
  then the game port's own list (`GAME_PORT_ONLY_CALLS`) is where it goes, the gateway's
  being `eve.js`'s. What a unit needs of the BFF first is a unit of its own.
  `routes-survey.js <repo> [list]` counts the routes the page still names.
- **The page's clock** is `serverNowMs` on a pilot's answer of the generic call: on the game
  port the server's clock as the pilot's session has it, through the gateway the BFF's
  own. A route that put a time beside its answer is moved by reading the clock the
  call's own answer has just said (`serverNow()` in `web/src/app/flow.ts`).
- **Run the whole suite before calling a unit's tests done.** A test elsewhere may list what
  a flow asks at some moment (`web/src/app/flow.test.ts` lists every generic call made at
  the choosing of a pilot), and a read moved to the page's own call is one more in it.
- **Something the BFF makes, made again in the page's TypeScript, is proved by making both
  from one kept state** at every point of a recorded session
  (`test/gamePortSkillSheet.test.js`): the BFF's given the state as it came off the wire,
  the page's given each read through `wireToBridgeJson`. What cannot come off the wire as
  such cannot be written there, and is tested in the page's own test, where its form can.
  Then live, leaf by leaf: `skills-compare.mjs <repo> <scratch> <bff> <account> <characterID>
  [typeID toLevel]`. The clock's leaf differs, being read at two moments.
- **The page's writes by kind are in `writes-survey.js <repo> all`.** Of 89, seven are a
  confirmation and one call by name; most of the rest are calls on an object the BFF binds.
  Size a write there before naming it next.
- **A write the pilot's transport does not carry answers false, and the flow asks the route**,
  as a read not carried answers null (`saveQueue`, `readSkillSheet`). A refusal by
  `CALL_NOT_ALLOWED` means nothing was made, so asking the route after it is safe; no other
  failure is taken so.
- **A flag that says "for the corporation" is read in the server before the write is moved.**
  `AcceptContract`'s `forCorp` was taken from any member (fixed in eve.js `378ef753f`). Look
  for the role's check on the path the flag takes, not only for a check of the ID; the
  client's own gate (a button shown by `session.corprole`) says which role.
- **A handler that hands a store the session's character is read for what the store does with
  nought.** Nothing between a socket and a service asks whether a character is chosen: an
  account at its selection screen has none, and a store that reads nought as "no filter"
  serves it everyone's (`DeleteLaunch`, fixed in eve.js `ccf788b7b`). The BFF lets no such
  call through; a raw session for seeing one live is `nochar-launch.js`.
- **A server defect goes to a sub-agent with the reading, the client's file and line, the
  test wanted first, and the checkout's rules** (no branch, no worktree, no push, the other
  sessions' files by name). Then read its diff, run its test file through that repository's
  runner, and see the fix live: `store.sh save` restarts EveJS on the new code. Do not stage
  the live store while its tests run. Continue the same sub-agent (`SendMessage`) for what it
  reports beside.
- **The store keeps each child of a map in a row of its own**, keyed by the map's name, the
  unit separator (U+001F) and the child's key (`launchesByID\u001f910000001`). A printed key
  does not show the separator, and a row staged without it is not read by the server
  (`launch-store.js`, `colony-store.js`).
- **A write only a bot makes is tested through the flow first**: a one-block bot started over
  a stand-in BFF, and what it asks read in order (`web/src/app/launchCollectorFlow.test.ts`).
  Live, the thing the bot acts on is made real (`colony-store.js` puts goods in a command
  centre in a copy of the store; `launch-real.js` launches them and saves the one-block bot),
  and the bot is started from the Bot Manager's Pilots tab, the pilot in space.
- **"Run here" asks through the browser's `confirm`**, which the hidden pane answers "no" with
  nothing shown: the row stays at "Nothing is running". Set `window.confirm` in the page to
  keep its text and answer true before pressing, and write down what it asked.
- **A fleet for a check is made by script through the gateway BFF**: `fleet/create`, then
  `fleet/advert/add` with `{ fleetName, inviteScope: 16, joinNeedsApproval }` (a plain object
  goes through the gateway and not the game port). Test Pilot and Test Three are docked
  together at Jita on two accounts. `fleet-writes-live.js <boss bff> <member bff> ...` sets the
  two writes side by side.
- **A boss is kept in one script while the browser is driven** (`scram-boss.js`): it does a
  step, then waits for a word left as a file in the scratch folder. Run it in the background
  with its output in a file, and see it ended before the iteration is. `/ewar` by `gm/slash`
  gives the caller a ship with a scrambler, a disruptor, a web and a painter fitted; a ship
  that has attacked cannot dock for a while.
- **A companion is started from the Companions window**: type the fleet's name, add the
  pilot. It applies, accepts, undocks and follows a member who is no companion, by itself.
  Afterwards: Stop all, Remove, and empty the name.
- **What the page is answered on its socket can be read**: in the wrapper of
  `WebSocket.prototype.send`, add a `message` listener to each socket once. A pilot's ship is
  in the answers to `flight/status`; a pushed notice is found by its method's name.
- **The named routes are counted with `routes-exact.js`**, by the whole path.
  `routes-survey.js` took a path's beginning for a path and missed a parameter inside one.
- **A test that starts a companion or a bot stops it in a `finally`.** One left flying after a
  failed assertion keeps its file's process from ending, and the run waits on it for ever.
- **A scratch name is checked by itself** (a count over three names says nothing of which
  one is there), **and a script is written with the Write tool**: a heredoc or `node -e` in
  the shell loses backslashes and quotes.
- **A write the BFF made on an object it bound for itself is asked by the service's name.**
  Where the client asks the service on a moniker (`MONIKER_SERVICES`), the game port makes a
  call asked by name on the moniker it keeps, and counts it `reshaped` whatever its arguments.
  The gateway makes it as it is asked. The entry's judge is handed what godma knows through
  the transport's context (`contextFor` in `pilots.js`), and `needing(entry, "dogma")` has
  godma primed first.
- **What the client knows from its static data, the page asks of the BFF's**, once, and
  keeps: a route under `/api/types/`, no call of the server's (`overload-effects`,
  `cycle-times`). A helper for it goes in `staticData.js` with a fixture of the table for
  its test (`test/typeOverloadEffects.test.js`).
- **A pilot ready to use its modules**: `/ewar` and `/giveskill me <typeID> <level>` by
  `gm/slash` (`overload-stage.js`). A module on the rack is held by a `pointerdown`, a wait
  past 600 ms, and a `pointerup`.
- **What the client does by itself after a call belongs to the call's unit.** Read past the
  call for the threads it starts and for its session-change hooks (`RepairModule_thread`,
  `ProcessSessionChange`), and read the server for when the thing asked for is done: it may
  wait on a second call the client makes unasked, as a repair's mending waits on
  `StopModuleRepair`.
- **A hull a slash command boards is not what the BFF's "hold" means** until the pilot is
  chosen afresh: the BFF holds the ship it last boarded by its own route. Give the ship in one
  web session, log out, and go on in another (`repair-live.js`).
- **Damaged modules for a check**: overload the drive and run it, and within two minutes
  several modules of its rack read 16% damaged. Paste is `/giveitem 28668 200` into the
  hangar and the transfer route into the hold. `repair-live.js <bff> <account> <characterID>
  compare|stage`: `stage` leaves the pilot in space for the browser.
- **After a drive's run the pilot is far from its station.** Dock from the header then takes
  minutes; where the BFF is restarted and the store put back next, do not wait on it to log
  the page out by its button, and say that it was left.
- **What the client does with a call's answer is the transport's to do on every path the
  call can take.** The game port set its banks after a grouping asked on a handle (the
  routes' way) and not after one asked by name (the page's): the first live run of the page's
  write showed the ship's old banks. When a call moves from a route to the page's asking, find
  what the game port does after the route's call (`afterGroupingCall` and its fellows at the
  end of `callBoundMethod`) and see that the by-name path does it too, with a test.
- **A handler that takes whose thing to act on from its caller is a defect of the server**, to
  be fixed there before the page names the thing, and seen live after. A route of the BFF's
  that names the thing itself hides it (the weapon banks, and `docs/arg-injection-leak-handoff.md`
  for the ones written down earlier: read it for the pair in hand).
- **A ship with weapons to group**: `/probe2` by `gm/slash` gives a hull with three guns of
  one kind, and no ammunition. `banks-live.js <bff> <account> <characterID> <other bff>
  <other account> <other characterID>` flies two of them and names one's ship from the other.
- **While a sub-agent mends the server the live store is not staged**, and it may be forty
  minutes. Do what needs no live store in that time, in the turn: the page's tests, the
  breakage pass, the whole suite, the live script, a flow test for each asker of the call
  that has none, and the reading and sizing of the units after. Look at `eve.js` (`git
  status`, `git log origin/main..main`) for how far it has got; do not ask it.
- **Count before writing a count.** `loadammo-shapes.js <recordings>` reads every recorded
  call of one name off the bytes the transport logged, however it was sent (riding a bind,
  or on the bound object), and says how many are of the shape expected.
- **Ammunition for a check**: `/giveitem 230 2000` gives a medium hybrid charge, which
  `/probe2`'s guns take, to the hangar; the transfer route moves a stack into the hold;
  given again, there is a stack in each. `ammo-live.js <bff> <account> <characterID>
  <other bff> <other account> <other characterID> [stage]`: `stage` leaves the pilot docked
  in the ship with its charges, for the browser.
- **In the browser**: the fitting window's slots are `button.fit-socket` (their
  `aria-label` names the slot and the module) and a chosen slot's ammunition is `.fit-ammo`.
  The rack's menu opens on a `contextmenu` event on a `.module-slot.filled` and is
  `.rack-menu`; "Reload all" is a button of `.rack-ammo`. Two windows can be `.win.focused`
  at once: find a window by its heading.
- **A boss for a companion's run goes on the gateway's BFF** (`scram-boss.js`): its advert is
  a plain object, which the game port cannot send. The companion's pilot must be online in
  the tab before the Companions window can add it; the fleet's name is typed into
  `#companion-op-fleet`; the pilot's row reads Running once it has joined. A plain `fetch`
  from the tab is refused (401): the page's own reads go by its socket.
- **When a loop of the page's does nothing, read its own readout first.** A companion's is
  in the page (`FleetCompanion.svelte`): its phase in a `<strong>` and its reason in a
  `p.note` that begins "Why:". Then take the reads it makes off the socket (a `message`
  listener on the socket, each answer matched to its request by the `id`), and then look at
  what it works out once at its start. A companion's module lists are read off the hull at
  the start with the dogma loaded (`resolveDefenseModuleIDs`).
- **A flow test that leaves a read unanswered proves nothing of what is worked out from
  it.** A check with a "not known" answer keeps what it cannot judge, so the test passes
  whatever the rule is. Give the test the answer the live read gives: for a module's dogma,
  the attributes a module of that kind has (`effect-durations.js <repo> [typeID...]` says
  which attribute an effect names as its duration, and what a type carries).
- **A call in the tab is given up after 45 seconds**, and the script goes on. Wait on a dock
  in calls of half a minute, and read the page again before pressing anything.
- **Before a test is made to fail, see that it ends.** A test that starts a companion or a
  bot and stops it after its assertions leaves it flying when an assertion fails, and the
  run never ends. Look at every test the change will fail on the old code, put each stop in
  a `finally`, and run old-code checks with `--test-timeout=60000`. A run that hangs all the
  same is stopped by the one child's own command line.
- **A call the client makes on its ballpark** (`bp = michelle.GetRemotePark()`), asked by
  name: add its name to `ON_THE_PARK` (`src/gamePort/retailCalls.js`), and the transport
  makes it on the park's own object (`parkCall`) and refuses it for a pilot with no park.
  Look at what the handle's path does after such a call (`afterMovementCall`) and whether
  it belongs to this one.
- **A fleet for a check without an advert**: the boss forms it, invites the other by
  `fleet/invite` (`inviteeCharID`), and the other accepts by `fleet/invite/accept` with the
  fleet's ID from the boss's `bound-fleet` read (`tag-live.js`). What a fleet's tags are is in
  the last `OnFleetStateChange` among the notices that come with a pilot's answers.
- **A companion that is to tag**: `tag-boss.js` on the gateway's BFF (words `boss.lead` with
  the companion pilot's character ID, `boss.undock`, `boss.go` with the companion's ship,
  `boss.end`). It sets a tag, hands the fleet to the companion's pilot, undocks and
  scrambles it; the tab then tags the scrambler's ship.
- **A service the client asks on a Moniker it makes for each call** (`eveMoniker.GetEntityAccess`
  for the drones, as crimewatch's): it goes in `MONIKER_SERVICES`, `madeAfresh` and, where
  the session may lack what the Moniker is for, `MONIKER_NEEDS` (`src/gamePort/retailCalls.js`);
  what it is bound by is `monikerParams` (`pilots.js`). The recordings say which a service
  is: count the binds that carry a call (`service::MachoBindObject args=(..., ('Method', ...`)
  against the same method sent on an object (the transport's `Write:` lines).
- **Look for a name in `retailCalls.js` before adding it.** A constant named twice is no
  program, and every test file that loads the ledger then fails to load.
- **Drones for a check**: `salvage-live.js <bff> <account> <characterID>` gives the prepared
  ship, the skills (3436 to 5, 24241 and 3440 to 1), two light drones (2454) and two salvage
  drones (32787), and moves them to the bay (`to: { kind: "shipBay", bay: "drone" }`).
  `/probe2`'s bay already holds five light and five medium drones, and five go out at once:
  launch the stack wanted by itself, as the drones window does. The window's rows have a
  Launch each; "Bring them all home" is the recall.
- **Wrecks for a check are made, not fought for**: `/wreck <n>` in space makes n wrecks of
  the pilot's own within 20 km (`dsalv-live.js <bff> <account> <characterID> [stage]` does the
  whole of a salvage). `/npc 1` draws any hull: one draw was a frigate, the next a battleship
  five light drones did not kill in four minutes. A hostile in the snapshot is `kind: "ship"`
  with `npcEntityType: "npc"`.
- **A warp is over when the place is near and the ship is slow**, not when the sentry guns are
  gone from the snapshot: eight are in it at Jita VI's warp-in, the nearest 2,699 km off
  (`warp-probe.js <bff> <account> <characterID> [planetID]` prints the lot).
- **When a window says what the server does not, record the page's own reads with their
  answers before naming a cause** (in the tab: keep each request's ID as it is sent, and the
  answer that comes with that ID). Twice in one unit a true measurement was called the cause
  too soon: the notice the page did not hear was real, and the answer it then read was wrong
  as well. And give a recorder ONE listener per socket: the page's sends come on more than
  one, and a listener added at each change of socket counts every line many times.
- **One item's move is `OnItemChange`, several are `OnItemsChanged`**: the item as it now is
  (`fields`), and what it was by column (3 where, 4 which flag). A listing of a bay is itself
  answered with one for each stack, nothing changed, the first time after a change.
- **A call the client makes on an object for a thing it names** (`eveMoniker.GetPlanet(planetID)`,
  an agent's, a character's): the page's call says which with `of` (the fifth argument of
  `Ask`), and the BFF makes it on the object bound for that, by the bind the call's route
  used. To move another: one line in `PAGE_OBJECT_CALLS` (`src/bridgeCallPolicy.js`), and,
  for a kind of thing that is no planet, its check and its bind in the generic call's
  handler (`src/server.js`, `objectKind`). A read is listed only with its handler read
  first: the planet's reads once took an owner from the caller.
- **A name found in the recordings' folders is not yet a recording of it.** `grep -rla` counts
  the notes kept beside the recordings (`.md`) with them. `LeaveShip` was "in one recording"
  for two entries of the Next list: the file was a note saying the recorded flow ejects.
  Open what is found.
- **What a route keeps of the BFF's own goes with its call.** Leaving the ship's route set the
  BFF's word for the pilot's ship and held the next swap back; the generic call does the same
  for a pair listed in `PAGE_SHIP_SWAP_CALLS` (`src/bridgeCallPolicy.js`), by the route's own
  function. Read a route for such a thing before calling its write short.
  `ls-live.js <bff> <account> <characterID>` leaves a docked pilot's ship and boards it again.
- **A stand-in BFF's bare `{ ok: true }` is no answer to the page's own call.** A flow's test
  whose write moves to the generic call needs its stand-in to answer `/api/bridge/call` with
  the call's service and method, or the page takes the call for failed (as it should) and
  the test fails for a reason that is not its subject. The whole suite finds these: the
  unit's own files do not.
- **What a panel goes by after a write is seen in the tab.** The corvette's button goes by
  the flight in the page's store. Its test put a flight there and rendered, and passed; in
  the tab nothing put a new one there after the swap, and the button stayed in use. While
  docked nothing reads the pilot's flight again but a swap of the ship
  (`refreshActiveShipViews`). Before calling a panel's state done, find what writes the part
  of the store it reads, and press the button in the tab twice.
- **The page words the server's refusals from a table** (`web/src/bridge/refusals.ts`, its
  keys pinned by a test). A write whose handler refuses by a bare key wants that key there,
  or the pilot reads that it was turned down without a reason. Read the handler's refusals
  when reading what it trusts.
- **In the tab a wrapped `fetch` sees nothing once a pilot is chosen**: the page's requests
  go over the pilot's socket, and `read_network_requests` does not list them either. To read
  what a press sent, wrap `JSON.stringify` and keep what has the call's `service` and
  `method` (the answer passes through it too), or wrap `WebSocket.prototype.send`. Put
  `JSON.stringify` back after. The BFF's ledger counts the calls whatever the recorder saw.
- **A pilot is opened in the tab with one click of its row after a fresh load**, then "Go to
  first pilot". Two clicks in quick succession left no pilot in the client.
  `bc-live.js <bff> <account> <characterID>` boards a corvette, asks for a second from
  aboard it, and boards the first ship again.
- **A handler is read for where it acts, as well as for what it takes.** The office's rent
  took nothing of the caller's, and acted wherever the session was: asked by name from
  space, that was the solar system, and the server rented an office there. Its route's
  check that the pilot was docked was all that kept the page from it. Before a write goes
  on the page's list, measure it from where a client cannot make it (in space for a docked
  call, docked for one in space, by name for one on an object): `rof-live.js <bff> <account>
  <characterID> space` does for the office. What it shows is the server's to mend, by a
  sub-agent, and is measured again on the mended server.
- **A panel says a refused call by its reason only since `45ad44d`.** The panels word a
  caught error with `panelErrorWords`, which worded its code; a server's refusal comes in
  the envelope `CALL_REFUSED`, whose reason is its message. A flow's test that reads the
  error's message, or the store's `actionError`, does not go that way: test what the panel
  itself says (`panelErrorWords(caught)`), with the refusal as the BFF was measured to
  hand it on, and see it in the tab.
- **A value the server handed over goes back as it came.** The rent goes with the price the
  station quoted, a long as a long (Tranquility's was one), not with the number shown.
- **Test Three is its corporation's chief executive** (98000000, an office in Jita 4-4,
  nothing in its wallet). `give-cash.js <scratch> <bff> test2 140000003 98000000 30000`
  gives it three rents; `rof-look.js` reads its offices and the price and writes nothing;
  `rof-live.js` gives the office up and rents it. Each between `store.sh save` and
  `restore`.
- **While a sub-agent works in `eve.js`, the turn is kept and the live store left alone.**
  Put the store back before it starts (its tests copy it). Then do what touches neither:
  commit, the old-sources check, the log. Look for its commit with a wait in the same
  command (`node -e "setTimeout(()=>{}, 240000)"; git log --oneline -1`), read its diff
  when it is in, restart EveJS on it, and measure again.
- **What a route says beside its answer goes with the call too, or the page finds it for
  itself.** The scanner's route said the BFF's word for the pilot's system with the sites,
  and the page went by it. The page's own call has only the answer; the client pairs it
  with its own session's system, read before it asks, and so does the page now. Read a
  route's whole answer, and every use the flow makes of each part, before calling it one
  call.
- **A call on an object the session has one of names none** (`PAGE_OBJECT_CALLS`, a kind
  that is not in `OBJECTS_THE_PAGE_NAMES`): the BFF asks the object it keeps for the pilot.
  The system's scan manager is the first. `sfs-look.js <bff> <account> <characterID>` asks
  the sites so and writes nothing. GM Elysian's system, Maurasi, has six anomalies and
  seven signatures; Jita has none.
- **The Bot Manager's "Run here" asks with the browser's own box**, as the Station panel's
  corvette does. In the tab, put `window.confirm = () => true` first, or nothing starts and
  nothing says why. A bot's own log is in `bffgp-data/bot-logs/<characterID>.jsonl`. A bot
  flies no script for a pilot in a capsule: it looks once and stops.
- **A patch that rewrites a whole test file counts first**, the tests and a name that is in
  every one, and stops where the count is not what was read. It did this time.
- **"One call by name" is read off the route, not off its length.** `routes-calls.js` showed
  `fleet/leave` as 28 lines and one call. It is two calls, chosen by what the transport
  says the pilot holds, and a state of the BFF's dropped after. Read the route's body
  before naming it short.
- **A stand-in whose usual answer is a default argument cannot be told to answer nothing.**
  `harness(undefined)` answers as usual. A row for an answer of nothing answers it in the
  row. The test failed on the code, which is how it was found.
- **A proof that changes nothing needs no copy of the store.** `/help` and the bare stroke
  proved the console's call on both transports and in the tab. `gms-live.js <bff> <account>
  <characterID>` runs them; `gms-help.js <bff> <bff> <account> <characterID>` says how the
  two transports' replies differ.
- **A route's call is not the client's until the client's caller is read.** The repair's
  route sent `repairSvc.RepairItems(itemIDs, None)` by name. The client reaches that
  service only on a Moniker it makes for each call, and sends `RepairItemsInStation` with
  a payment. Search the decompiled client for how it reaches the SERVICE
  (`RemoteSvc('<service>')`, `Moniker('<service>'`, a function of `eveMoniker.py`) before
  reading the route. A service reached only by Moniker wants a line in `MONIKER_SERVICES`,
  its parameters in `monikerParams` (`pilots.js`), and `madeAfresh` where the client
  keeps none.
- **The gateway's list may have a write under another name, or not at all.** Ask what the
  way back does with the client's name before moving a write to it
  (`evejsWebGatewayRuntime.js`, the allowlist). `gatewaysNameFor` (`bridgeCallPolicy.js`)
  names the one the gateway has for the same thing; the answer is still the call that
  was asked.
- **`/dmg medium`, sent from the page's console or by `slash.SlashCmd`, damages the active
  ship and one fitted module where it is docked**; `/heal` mends it. `rps-live.js <bff>
  <account> <characterID> [space] [<other account> <other characterID>]` damages, quotes,
  repairs and reads the wallet; with `space` it then asks from space; with another pilot
  it asks a quote for that pilot's ship. Test Pilot's Reaper costs 615.41 ISK after it.
- **A stand-in that says only the names of what was asked cannot say what a call went
  with.** The fleet's test helper logged `service.method`; a forced leaving sent with the
  page's arguments passed it. Where a breakage of what a call carries is not caught, look
  at what the stand-in keeps before adding a row.
- **A choice the route made by what the pilot's connection holds stays the BFF's.** The
  page asks the client's first call; the BFF makes it, or the one the client makes in
  its place, by the route's own function, and answers as the call that was asked
  (`leaveFleetCall`). `flv-live.js <bff> <account> <characterID>` forms a fleet and
  leaves it; the Fleet window's "Form fleet" and "Leave fleet" each ask with the
  browser's own box.
- **A test that fails must still stop what it started.** The companion's check failed
  before its code, as it should, and its companion was stopped on the line after the
  checks: the loop ticked on, and `node --test` waited for the file's process for ever.
  A check on something a test set running goes in `try`, with the stopping in
  `finally`. A run that hangs so is stopped by its own PID (`taskkill //PID <n> //T
  //F`), never by stopping every node.
- **The ledger is of what was sent: read its count in the live check.** An align asked
  for a docked pilot was refused by the BFF before anything was sent, and stood in the
  ledger as one of the client's, because the note was made before the park was looked
  for. A call the BFF may refuse by itself is noted after that refusal.
- **A refusal the page makes is a sentence a player reads.** The panel shows a page's
  own refusal as it stands only where it reads as plain language (`describeRefusal`
  in `refusals.ts`): a sentence with `targetID` or a `SCREAMING_NAME` in it is taken
  for jargon and replaced. Pin the panel's words in the flow's test.
- **A flight order's route read the flight before and after: `orderedStep`** in
  `flow.ts` does both for the panel, and keeps the reading before where the one after
  fails. `aln-live.js <bff> <account> <characterID> [ledger.json]` undocks, aligns
  and says how many degrees off the thing the ship flies. In the tab: a row's
  `.spc-row-btn`, then `.spc-action-btn[title="Align to"]`; the station's row has
  "Dock", and the pilot is logged out once docked.
- **Count the recordings by form, not by presence.** `fbl-look.js <recordings>
  <method>` groups a ballpark call's recorded arguments by how each was written. The
  ledger called the throttle and the autopilot's follow the client's "as they stand"
  while the game port sent whole numbers for a fraction and a range that are floats in
  every recording: a number that is whole goes as an int from JavaScript, and only a
  shape in the ledger (`{ type: "real", value }`) makes it the float. Where a call
  carries a number, look at which it is in the bytes.
- **A stand-in BFF that knows an order only as its route goes quiet when the page asks
  the call.** After the code, run the whole suite and read each failure for a stand-in:
  one that waits for "a POST to a route" must count the page's own writes (`confirm`),
  and one that answers every path with a bare ok gives no answer to a call. Answer the
  call for the service concerned, with what was asked.
- **A ship that follows a station flies away from it.** The station's ball is 100 km in
  radius and a ship undocks inside it, so a follow at fifty metres flies outward to the
  surface, on both transports. It was measured before it was explained
  (`fbl-radius.js`: centre to centre, and surface to surface). `fbl-live.js <bff>
  <account> <characterID> [ledger.json]` runs the follows; the BFF's ledger file is
  written a moment after a call, so a count read straight after may be one behind.
- **The autopilot's approach is seen in the tab from the dock ladder.** Keep the
  station at 10 km (about 110 seconds from the undock), then press the station's
  "Dock": the page asks the throttle and the follow with no range, and docks.
- **A rule made for one call in a function several calls share names the call, and a
  row holds each side of its edge.** `followCall` let a range of nought through
  unlooked-at whatever the method, which is the autopilot's follow alone: an orbit of
  nought is an orbit. And a breakage that let every follow under ten metres through
  passed every row, until one held a follow of a single metre back.
- **Where a route made a number "as the client does", read how the client does.** The
  orbit's route rounded its range; the client's `int()` cuts it. `orb-live.js <bff>
  <account> <characterID> [ledger.json]` runs the orbits; the overview's button reads
  "Orbit 5 km", and a second press of it a few seconds on is held back by the BFF,
  which the ledger's count shows.
- **Before a call becomes the page's, find the tests that take it for an example of
  something else.** Four did of the stop: of "a write of beyonce's that is not the
  page's", and of "an order asked of beyonce by name" for a docked pilot. They fail
  once the code is in, rightly; each wants another example, not the old behaviour
  back (`grep -n '"<service>", "<method>"' test/*.js` before the tests are written).
- **A ship is in the WARP mode before it is in the warp.** While it still turns to its
  warp a stop calls the warp off and the server says nothing; in the warp itself, at
  thousands of metres a second, the stop is answered with `OnRemoteMessage`
  `ShipInWarp` and the ship flies on. `stp-live.js <bff> <account> <characterID>
  [ledger.json]` waits for the speed. It leaves the pilot in space: put the store back
  between its runs, not only after the last. In the tab the stop is `button.hud-stop`.
- **What the client refuses by itself, measure of the server before building.** The
  client forms no fleet from within one (`fleetSvc.py` 332), so no recording and no
  client ever showed what the server does then: it formed a second and left the pilot
  in the first (`ffm-twice.js`, a dozen lines, run first). Where the client's own
  code refuses before it asks, ask the server all the same, on both transports, and
  give what it does wrong to a sub-agent. The game port then refuses in the client's
  place, before anything is sent or counted.
- **A sub-agent in `eve.js` is told its proof by file, and its wait is spent on the
  page.** Name the test files it is to run (a wide run took most of an hour and proved
  nothing asked for); say that the live server and the BFFs are node too. While it
  works the page's own tests, breakages and suite can all be run, since none touches
  the server's store; only the live checks wait. Read what it says it measured and
  left: the first found two more holes beside the one it was given.
- **A stand-in session stays where a test left it.** A notice that a pilot has left a
  fleet does not take a test's session out of it: a server sends the session's change
  as well. A test that forms a fleet after a leaving takes the session out first.
  `ffm-live.js <bff> <account> <characterID> [ledger.json]` forms, asks again from
  within, leaves and forms again; the Fleet window's "Form fleet" asks with the
  browser's own box.
- **A number the page names is taken as its route took it.** A fleet named with `of`
  ("fleetByNumber": `PAGE_OBJECT_CALLS`, `OBJECTS_THE_PAGE_NAMES`, the number's own
  check in the generic call, and its branch) was first checked as a planet is, a whole
  number and nothing else; the route took the text of one too (`strictPositiveID`),
  and the Fleet panel's own read answers a fleet's number as text. The first live run
  showed it, not a test: read what the route takes for a number before writing the
  check, and give the live script what the page would have.
- **A sentence in the table of refusals is more than twenty characters**, by the
  table's own test: one that only names the trouble is turned back.
- **Two pilots on one BFF, and the tab as one of them.** `fai-live.js <bff> <account>
  <characterID> <account> <characterID> [ledger.json]` runs boss and guest as two
  sessions of the script's own. With `wait` as its last word it forms a fleet, invites
  and reads the fleet for forty seconds: started in the background, it leaves the tab
  free to be the guest (the hangar's other row, the "Fleet" button for the window,
  then "Accept invitation", which asks with the browser's own box). It ends by itself;
  it is waited for before anything is put back.
- **An `of` that may be said.** A call on the pilot's own object that a caller may
  hold to a number ("fleetExpected": `OBJECTS_THE_PAGE_MAY_NAME`,
  `pageMayNameTheObject`) goes with `of` or without: the generic call's check of
  `of` passes it either way, and its number is checked only where one is said. In the
  page's function a number said that is none is refused, and **not taken for none
  said**: the route refused it so, and the fence is the point.
- **A test that looks for a route's not being asked passes once nothing asks the
  route.** The hosted recovery's test of the fence did. Such a test looks for the call
  now, and breakages show it looking (the fence not put, the fence never run). A write
  asked under a caller's fence goes through `fencedDo` in `flow.ts`.
- **What the client takes for no pilot, by the number alone**: `couldBeAPilot`
  (`retailCalls.js`, and its twin in `fleetWrites.ts`): 90,000,000 to 97,999,999 and
  100,000,000 to 2,129,999,999. A test's toy number (43) is no pilot to the page.
- **Ask "all the same" in the first live script.** What the server does with what the
  client never sends (an agent invited: answered true) was seen in the first live
  run, and the game port's refusal, the ledger's rows, a second breakage list and a
  second run of the suite came after it.
- **Two pilots, the tab the boss.** `fiv-live.js <bff> <account> <characterID>
  <account> <characterID> <ledger.json> wait` is the guest alone. The tab forms the
  fleet and invites; the fleet's number is the last in the server's log (`grep -a -o
  "6545000[0-9]\{5\}" server.log | sort -u | tail -1`) and is written to
  `<ledger.json>.fleet.txt`; then the guest is started in the background (it
  accepts, stays twenty seconds, leaves: thirty-five in all) and the tab's window is
  read meanwhile.
- **The wire contract's list of the page's writes is one line of many thousand
  characters.** Never print it: `grep -c`, `grep -o "<a few words>"`, or `cut
  -c1-200`.
- **A unit may be a feature the page has not got.** The route for turning an
  invitation down was asked by nothing of the page (`grep -n "<route>"
  web/src/app/api.ts`), and the Fleet window had no control for it. Then the unit is
  the page's call, the window's control, and what the client does by itself; no route
  comes off, and the log says so.
- **What the client does unasked at a notice is the flow's to do.** The page is the
  client: with no page open nothing is done, as with no client. Where the client goes
  by its session and the page by a read (its pilot's fleet), the page acts where it
  knows and again when it learns, and the log says what is left between.
- **Look at what the store forgets without a word.** The fleet's slice dropped a
  pending invitation when a read found the pilot in a fleet, and told the server
  nothing; the flow answers for it now, looking at the slice before the read is
  applied.
- **What the other pilot is told** comes with that pilot's next answer where no
  stream is open: `fdc-live.js` keeps the inviter's `OnFleetJoinReject` from each of
  its answers and reads them with a look at its fleet. With `invite` as its last word
  the script is the inviter alone for fifty seconds, and the tab the pilot invited.
- **The server may never send what the client is written to answer** (an invitation
  to a pilot in a fleet). Then the page's handling is proven by its test, the log
  says "not seen" and why, and it is not called a defect without a recording.
- **A notice the page takes nowhere is a unit too.** After building what one pilot's
  client does, look at what the other pilot's client is told and whether the page
  reads it (`grep -n "<notice>" web/src/app/flow.ts`). A notice is taken in
  `applyPushedNotification` (`flow.ts`), read by a decoder in `web/src/bridge/`, and
  said in **the page's own words**: the client's sentences are not the page's to use.
- **What happened without the pilot pressing anything goes to the notice board by a
  string field of a slice** (`web/src/ui/noticeSources.ts`). A watched field tells
  only when it changes: the flow says it no longer and then says it (null, then the
  words), so that the same thing a second time is told a second time.
- **A name waited for, and the pilot looked at again after the wait**:
  `resolveNamesNow`, then `nameCache`, then `onlineCharacterID()` against what it was
  before, so that a sentence meant for one pilot is not said to the next.
- **The pilot invited, as a script of a few seconds**: `fia-guest.js <bff> <account>
  <characterID> <fleetID> [plain|false|within]`, run in the foreground while the tab
  is the inviter. The fleet's number is the last in the server's log.
- **Who asks the route, before how long it is.** `flight/bookmark-location` was the
  shortest route left, and its one asker's one caller is a bot's action, a mining
  operation's hauler: used in no window, and proven in a page only by running that
  operation, which had never been run live. Read the asker's callers in `flow.ts`
  when choosing the next unit, and put first what a window of the page can show.
- **What a route says by keyword, and when.** The bookmark's route said the subfolder
  by keyword only where there was one; the client says it every time, None for none
  (`subfolderID=subfolderID`). The ledger puts it in where a call came without it,
  and counts that reshaped.
- **A wire string in a read is `{ type: "wstring", value }`**, not text: a live
  script that looks for its own bookmark by its name unwraps it (`fbk-live.js`,
  `plain`), or finds nothing and says "NOT FOUND" of what is there.
- **A pilot in space for a check with no undock**: GM Elysian (`test2`, 140000004),
  in Maurasi, stationary, with one personal bookmark folder and no bookmarks.
  `fbk-live.js <bff> <account> <characterID> [ledger.json]` bookmarks the ship's
  place and reads it back; from a docked pilot it asks the one call.
- **A refusal's sentence changed is looked for first**: `grep -rn "<the sentence>"
  web/src test`. `BookmarkNotAvailable` meant a warp alone, and means a bookmark made
  as well.
- **Look in `src/gamePort` for the client's own service before building anything.**
  `pilotTargets.js` kept the client's list of what is locked already, fed by the
  server's word, and answered `GetTargets` from it: the unit was the page's calls and
  the routes' doings, and the ledger could judge a call by that list
  (`context.targetLocked`).
- **A route's own doings move to the flow, not away.** The lock's route read what was
  locked after the call, and the unlock's asked two calls and read: the flow makes
  the read by the page's own read route, and asks the one call the client would by
  the page's word for the thing, with the second only where its read shows the first
  did nothing.
- **Tests that stand on a route's answer are rewritten, each keeping its claim.** Six
  of the flow's tests answered `/api/bridge/targets/lock` in the route's own shape; a
  stand-in that answers every path alike was found only when the code was in (run the
  unit's test files again after the code, and the whole suite).
- **A pilot undocked for a check, and docked again in the tab**: `tlk-live.js <bff>
  <account> <characterID> [ledger.json]` undocks Test Pilot in Jita and locks the
  station it left (in reach at once; locked in a second). Put the store back between
  the two transports' runs: the script asks its first call docked. In the tab the
  station's row has "Lock", "Release lock" and, for a second, "Locking… stop"; the
  row's "Dock" docks the ship, and the page's "Log out" is there again.
- **Read every branch of a route before its length is believed.** The jettison's
  fifty-six lines were three things, two of them the BFF's own keeping (a hosted bot's
  custody, a mining operation's can), chosen by a header and records the page has
  not got. Such a route is left, with why, until what it keeps is looked at whole.
- **What a route read after its call, the page reads by its own read, and the two are
  measured.** On the game port the scoop's route read the pilot's park in the same
  breath as the call and still had the drone out; the page's read, a round trip on,
  did not. Print both in the live script (`dsc-live.js`: "the route's own read has it
  out still").
- **Count the reads a panel makes after an action before writing how many a test
  expects.** `runDroneAction` reads the drones again by itself (`loadDrones`), after
  whatever read the step made to be judged by.
- **A drone for a scoop**: `dsc-live.js <bff> <account> <characterID> [ledger.json]
  [stage]` takes `/probe2`'s ship (five light and five medium drones in its bay),
  undocks, launches a stack and lets go of one or two by the route's `abandon`: the
  server scoops only a drone nobody controls. With `stage` it leaves the pilot in
  space **and does not log it out**: a pilot that logs out with drones out has none of
  its own on grid after. The tab then takes the pilot over (its row, "Go to first
  pilot"); the loose drone is in the overview at once, and in the Drones window once a
  drone is launched from it. It is some kilometres behind by then: its row's
  "Approach", and "Scoop" when it is under 2,500 m. Start both BFFs again after: the
  script's session is still theirs.
- **A window's every button is pressed on the game port, and a route the gateway
  takes is not thereby one the game port can send.** The Industry window's install
  sends a plain object: the gateway takes it, and on the game port it is 400
  `CALL_INVALID`, "an argument that cannot be sent". It was found only because another
  unit wanted a job staged. **The full run does not install a job.** When a unit
  touches a window, ask each of that window's routes once on both transports in the
  first live script, and write down any that differ.
- **Read what a call answers before a route's read after it is kept.** A delivery
  and a stop each answer the job as the server reads it after it acted: the routes'
  second call (`GetJob`) said nothing more, and the client makes none.
- **A route's twin goes with it.** Where two routes are one form of call, of handler
  and of answer (a delivery and a stop), moving one alone leaves the window sending
  two different things for the same argument.
- **A new test that passes before the code is saying the old thing in other words.**
  A stand-in that answers every path with `{ ok: true }` reads as "no change" to the
  old code too: have the test say which call was made.
- **Look at what the window offers in each state beside what the client's button
  does.** The page's Industry window offered the stop of a ready job; the client's
  one button delivers there, and the server refused the stop.
- **A job for the Industry window**: `ijd-live.js <bff> <account> <characterID>
  [ledger.json] [stage]`. It gives the pilot every skill (`/allskills`: the install
  says `MISSING_SKILL` otherwise), and makes jobs by `/bpauto seed <preset>` and
  `/bpauto build <preset> [ready]` (presets: frigate, ammo, module and others, in
  `industryConstants.js`). With `stage` it leaves one ready and one running for the
  tab. From Git Bash a GM command given on a command line wants
  `MSYS_NO_PATHCONV=1`, or the shell makes a path of its slash. `ijd-why.js` asks
  the page's install for a blueprint and prints what the server says.
- **An argument the gateway takes may be one no marshal can write.** A route's plain
  object goes through the gateway as it is; on the game port it is 400 `CALL_INVALID`.
  It is made the client's form in the ledger, as a `reshaped` entry
  (`src/gamePort/retailCalls.js`, `jobDumped`): a dict by `dict(entries)`, a float by
  `{ type: "real" }`, a pair as a plain list, an object of a client's class as an
  `objectex2` whose header is the class's token in a tuple and then its state. Test
  that the marshal writes it and reads it back (`marshalEncode`, `marshalDecode`),
  and that the pilots send it (`test/gamePortPilots.test.js`).
- **Where no recording has a call, the server's own tests may have the client's form
  of it.** `eve.js`'s `server/tests/industryPayloads.test.js` had how the client
  writes an industry place. The oracle (`scripts/py27-oracle.py`) gives the order a
  dict's names are iterated in, and has no `copy_reg`: it cannot say how an instance
  is written.
- **A pilot has one write at a time, and a second is refused, not made to wait**
  (`src/pilotMutationFence.js`, `CHARACTER_IN_USE`). A route that answers before its
  last write is made leaves that write in the way of the next request. A live script
  that asks one write straight after another route's answer finds these; so ask them
  so.
- **Run the suite by itself.** Started in one command behind a breakage part, it had
  two tests cancelled that have their own limit of five seconds and take a third of
  one alone. Run it again alone before anything is made of a cancelled test, and say
  how many times it was run.
- **Driving the tab**: the page keeps the `fetch` it started with, so a
  `window.fetch` wrapped later sees nothing. Wrap `JSON.stringify` and tell a
  route's request by its fields (an install's has `blueprintItemID`, and `confirm`
  where it is the install). A `<select>` is set by its `value` and a `change` event
  that bubbles.
- **A blueprint for the Industry window**: `iin-live.js <bff> <account> <characterID>
  "" stage` gives the pilot its skills and a Rifter Blueprint copy with its
  materials (`/bpauto seed frigate`). The Jita station manufactures and neither
  copies nor researches (`FACILITY_ACTIVITY`): another facility is wanted for those.
- **The whole suite is run by `npm run audit:game-port`.** It is `node --test` with an
  audit in every test process (`scripts/gamePortAudit.js`), and its report after:
  every call a test causes the BFF to make is given to the game port's marshal as
  the ledger reshapes it, and timed against its request's answer. It fails where the
  suite fails, and where a finding is one a window can meet. `--keep <folder>` keeps
  the suite's output and the audit's files; `-- <files>` runs some test files only
  (and then says nothing of what it did not look at). `npm test` is the same suite
  without it.
- **The audit sees what the tests send.** A route that passes on what the browser
  gave it is as sendable as its test's body; what a window sends is in the page's own
  tests, which are looked at too. And **a route no test asks is looked at by nothing**:
  the report lists those the page names at every run. Read that list.
- **A finding goes on the audit's list only where nothing of the page asks its
  route**, with what it wants before a window does
  (`scripts/game-port-audit-known.json`). What a window can meet is never listed: it is
  put right.
- **A question about every route is asked of every test, not of the routes one by
  one.** A file loaded first in each test process (`NODE_OPTIONS=--require`) can wrap
  what a module exports as it is loaded (`Module._load`), give each request a record
  of its own (`AsyncLocalStorage`, run from the server's `request` event), and write
  down what passes. Try it on sources that are known to be wrong before believing
  that it found nothing (`rga-old.sh`).
- **A breakage must fail, not wait.** The breakage tool runs under no limit of time, so
  a breakage that leaves a test waiting for an answer that never comes (a call made
  twice, the first one answered) stops everything. Read each for that before it is
  run.
- **A look after a restore is a script that only reads.** `ffr-live.js` forms a fleet
  and takes it down; run "for its first lines" after a restore, it did all of it. The
  scripts that only read are named `*-look.js`: use one of those, or the tab's own
  list of pilots, and nothing else.
- **What stages a check may itself not go on the game port.** A fleet's advert is made
  by a route that passes on an object: 400 `CALL_INVALID` there. Stage through the
  gateway's BFF and test through the game port's: `ffr-live.js <bff under test> <the
  boss's bff>`, and `ffr-stage.js <bff>` for the tab (it leaves the boss logged in,
  so that its fleet stays: start that BFF again afterwards).
- **A server defect goes to a sub-agent with the recording's line, the builder's
  place, and the server's own helper for the thing**, and with what else to look at
  and report without changing. It works in the `eve.js` checkout itself, on `main`.
  While it runs, do what touches neither `eve.js` nor the store (tests, breakages,
  the audit), and make the page read both the old form and the new before the fix is
  run live. EveJS takes the fix when it is next started (`store.sh save`). Wait for
  its commit by reading `git log` there, and for its own word that it is done.
- **Text the client is sent as unicode is a wire string here** (`{ type: "wstring",
  value }`), on both transports. A decoder that takes text for a plain string writes
  such a name out as "[object Object]". Each decoder has its own small reader for
  text (`toText` in `bridge/fleetAds.ts`): look at it whenever a name is decoded.
- **A fixture in a recording's form has the recording's names and kinds, and made-up
  values for what is other pilots'**: their names, and the numbers of their
  characters, corporations and fleets.
- **The Companions window keeps the op's fleet name and its roster in the browser.**
  Note what the field holds before typing another name, and put it back. "Remove" on
  a pilot's row was followed by its leaving the fleet. And find the page's "Log out"
  before any BFF is started again, and read who is online after: one script, run
  after the Fleet window was opened, did not find the button, and why was not looked
  into.
- **A route may be asked for a part of what it answers.** `pi-colonies` made two
  calls, and its one asker read the launches alone. Read what the page takes of the
  answer before both are moved; and `grep` the pairs in `src/gamePort/retailCalls.js`
  and `pilots.js` first: the transport kept both of these already, and the ledger
  judged them, so that only the page's asker was the route's.
- **A live script can run the page's own function.** Node loads a `.ts` file of
  `web/src/bridge` as it is: `await import(pathToFileURL(<repo>/web/src/bridge/x.ts))`,
  and an `ask` made of a script's session (`lrd-live.js`). What is seen live is then
  what the page runs, not a script's own reading of the answer.
- **A launch for the collector's bot**: `lrd-stage.sh` (EveJS stopped: three launch
  records, and goods in Test Two's command centre), `launch-real.js <bff> 40176368
  1054656331534 2268 300` (a container in space, and the one-block bot saved), then
  the tab: Test Two, "Undock", the Bot Manager's Pilots tab, the bot chosen in the
  pilot's own chooser, "Run here". It warps, collects and ends in about a minute.
  After: the station's row in the overview and "Dock" (wait for "Docked": about half
  a minute), the page's "Log out", and `lrd-unsave.js <bff> test2 "<the bot's name>"`,
  which takes the bot out of the BFF's library (a restore of the store does not).
- **Two routes may be one reader's, and one call of the client's.** The refit library
  read the pilot's own fittings by one route and its corporation's by a third of
  another: the client's one call, `GetFittingMgr(owner).GetFittings(owner)`, for two
  owners. Follow the reader in `flow.ts`, and move what it reads together.
- **An answer may not be the same thing on the two transports.** A cached call's
  result comes whole through the gateway and already taken out on the game port,
  which keeps it. Print the raw answer on each in the live script, and see that the
  decoder reads both (`rfl-live.js`: "its corporation's answer is").
- **Before a page names an owner, read what the server trusts of one, and ask for
  another's in the live script.** The fittings' managers refuse an owner that is not
  the session's own; the page's own call with another pilot's number is 409.
- **A test may take a route's asker for an example of something else.** The test of
  the page's requests on its socket used the fittings' asker as its request of
  `api.ts`. `grep -rn "<asker>" web/src --include=*.test.ts` before the asker is taken
  out, and give such a test another asker that is staying a while.
- **A fitting for a check** is saved through the BFF's own route in the wire's forms,
  which both transports take: `rfl-live.js <bff> <account> <characterID> "" stage`
  (`rfl-look.js` reads a pilot's fittings and changes nothing). In the tab the Bot
  Builder is "New bot" in the bots' library; it reads the library as it opens, and
  a refit step's picker lists it ("Dock, refit, and repair" adds such a step).
- **A route that settles its reads apart answers a failed read as nothing: read what
  the page did with nothing.** The bookmarks' route answered 200 with `null` and a code
  beside it, the asker took `data.active ?? null`, and the decoder read `null` as no
  bookmarks: a bot was told its spot was not in the list. Where a route is
  `Promise.allSettled`, follow the nothing through the asker and the decoder to what
  each reader does with it, and give the flow a test of the read failing.
- **The page's requests ride its socket where the socket is open, and go by a plain
  request where it is not** (the first request of a page just loaded did: corrected
  2026-10-11, having been written as "none of them"). So a check of what the page
  asked looks in both: the frames (wrap `JSON.stringify` and keep each object that has
  a `path`, its `method` beside it, and each with `pilot === true` for the generic
  calls) and `performance.getEntriesByType("resource")`. "No request went to the
  route" is seen only where neither has it.
- **A window that reads as it opens reads once.** "New bot" on a Bot Builder that is
  open already asks nothing: close the window by its ✕ and open it again.
- **What a bot says in the store is the bot's reason, not a step's.** A step that cannot
  be done sends the bot home, and one with no home known stops saying so. A flow's test
  of a step asserts what was asked and done, and prints the bot's lines in its message
  (`bookmarksFlow.test.ts`: `run` gives them).
- **A bot for a check is loaded into the Bot Builder from its box** (`#bot-io`, "Load
  from box"; "Export to box" shows the form). A step is opened by a click on it, and
  its picker is a `select`. Saved, it is run from the Bot Manager's "Pilots 1" tab. A
  bookmark for a check is saved through the BFF's own route:
  `bkr-live.js <bff> <account> <characterID> <stationID> "" stage` (`bkr-look.js` reads
  a pilot's bookmarks and where it is, and changes nothing). 60003757 is another
  station in Jita.
- **Before the page asks the server about another pilot, read how a client knows it
  without asking.** The client's `GetMember` asks the registry only for a number its
  own list of members has, and the list is `GetEveOwners`. A route's read that names
  whoever the page was told of may be a call no client makes. Read the client's
  function from its first line, guards and all, before taking its remote call for
  "what the client asks".
- **A route the page names that no test asks may carry a feature no test reaches.**
  The corporation's route was asked by one thing, a mate's fleet invitation taken
  unasked, and nothing tested the taking. Write the flow's test of the feature first,
  with the old route answered so that the old code visibly acts on it.
- **A changed test whose new line holds on the old sources is proven by a breakage made
  for that line**, and said so in the log.
- **Two pilots of one account stay online at once, one on each BFF**
  (`cmb-two-look.js`, reads only). Test Two and Test Three are of one corporation
  (98000000); Test Pilot's (1000044) and GM Elysian's (1000006) have no other test
  pilot. `cmb-invite.js <bff> <account> <inviter> <invitee> <seconds>` forms a fleet,
  invites, says who is in the fleet every 5 seconds and leaves; `cmb-live.js` and
  `cmb-look.js` read only. The Fleet window's buttons are "Leave fleet" (it asks
  `confirm`), "Accept invitation" and "Decline".
- **A call the client makes on an object wants a kind in the policy before the page
  may make it.** Asked by the generic call by name, it goes to the service by name:
  this server answers, and no client sends it. `PAGE_OBJECT_CALLS`
  (`bridgeCallPolicy.js`) says what the object is; one the session has only one of
  takes no `of`, and the BFF binds it for the pilot it holds (`globalAssetsCall`).
  Put the route on the same function, so that the two cannot part.
- **Print what the transport sent for one read of the page's.** Read the game port's
  ledger before the read and three seconds after, and print the pairs that moved
  (`ast-live.js`, "what the transport sent for it"). It shows a call gone by name
  that should be on an object, and a read the BFF makes beside the page's.
- **A route that answers the BFF's static data beside a server's answer is two
  things.** Move the server's call, and give the static half its own way to the page:
  a client has it in its own data. Split the unit there.
- **A test that stands on a route is made to stand on the page's call, with the
  route's stand-in answering something else** (another station), so that a read by
  the route shows. Change the stand-in before the tests, and watch each fail on the
  old sources.
- **A window that reads as the desktop opens has read before you look.** Use its own
  Refresh for the read you record. The Personal Assets window's buttons are
  "Refresh", "See what's here" and "Set destination".
- **A unit that only reads wants no copy of the store and no restart of EveJS**: the
  BFFs are restarted on the new code, and the log says nothing was staged.
- **What a client has in its own static data is the BFF's static data to the page,
  by a read of its own outside the bridge's path** (`/api/types/volumes`, in the
  pattern of `/api/types/overload-effects`): each thing asked of once, null where
  the tables have nothing and never nought, a limit, and `capped` said. The page
  keeps what it is told for a type; a type not answered for is asked for again, and
  one answered null is not. A static read that fails takes nothing from the list it
  was for.
- **Set the page's rows beside the route's in the live script, whole.** Where a read
  is rebuilt from two (the server's call and the static read), print whether the
  page's decoded rows are the same as the route's, by `JSON.stringify`
  (`asi-live.js`, "the page's rows beside the route's").
- **Read each breakage for what would catch it before the run, and make the test say
  more where nothing would.** Three of this unit's would have passed: a list where an
  object was wanted (its first place is no type), one stack of a type where two were
  wanted, and a type left out of an answer. A check nothing at the wire can tell from
  its absence is no breakage: leave it out, and say so.
- **A test written after the code is said to be so**, with the breakages that catch
  its lines and its failing on the old sources.
- **Measure what a read carries before the page is made to carry it.** The table of
  agents is a megabyte and a half and eleven thousand lines; the route carried two
  rows. Print the bytes, the lines and the time on each transport in a look that only
  reads (`agt-look.js`), and say in the log what the page carries now and how often.
  Where a client asks once and keeps, so does the page (the flow keeps the promise,
  and drops it where the asking failed).
- **Read what the game port's transport keeps before sizing a read as costly there.**
  It kept the agents' table already (`pilots.js`, `agentsKnown`): the page's asking
  sent nothing to the server.
- **Where the route went by the BFF's word for something of the pilot's, say what
  word the page goes by, and what each said at the edges.** The route listed agents
  by the station the BFF had the pilot at, which was every agent at no station; the
  page goes by the station its store has the pilot docked at, and lists none at no
  station. Write the route's edge into its own test.
- **A fixtures module for an answer many stand-ins give** (`app/agentFixtures.ts`,
  after `botFixtures.ts`): the answer in the server's form from the page's own rows,
  the check that a request is that call, the call as the page sends it, and a pilot
  put where the read wants one. Six stand-ins in two files were moved by it.
- **A route under the bridge's path that makes no call of the server's is moved, not
  given a call.** Read the route for `heldTopLevelCall`, `boundCall` and the gateway
  before sizing it as a read to move to the page: where there is none it is static
  data, it goes where the static reads are (`/api/types/...`), and the old path goes
  away with it, there being nothing a second path would be for. Say so among the
  decisions: the routes that make calls were left standing.
- **Ask the route as it stands at its edges before it is changed** (`cut-look.js`: a
  type not known, one named twice, what is no type, none, more than its limit), and
  the same of what replaces it after. What was refused, and what was left out and
  read as not asked, are found so.
- **A bot's read is proven by a bot of two steps loaded from the Builder's box**:
  leave the station, and the step whose look makes the read. `fight-with-drones`
  with no arguments makes the loadout's. With nothing to fight it finishes by
  itself; dock by the overview after.
- **Give a stand-in a value its record does not carry** where the code may read it
  from either: the route's test has a type's category come from the static data's
  own function and not from the type's record, so a breakage that reads the record
  is caught.
- **A route may be one thing that stays.** Where half of what it answers is the BFF's
  own keeping (the creation's mark: a name journalled before the call, so that
  nothing is made twice), which a client has nothing like and the page cannot keep
  across a reload, the route is not moved: it is given its tests, and the log says
  why. Ask first what the server would see either way: the same call.
- **Tests of a route as it stands cannot fail first: every line they are about wants
  a breakage.** Write the breakages from the code's branches, read each for the test
  that would catch it, and say in the log that none failed first.
- **A unit with no source changed wants no rebuild, no restart and no copy of the
  store**: the look that only reads is run against what is running.
- **Reading a route for its test may find that it sends what no client sends.** Read
  the client's caller for each thing a route sends, keywords and all, and the
  recordings' bytes for them (a dict's count of entries is after `\x16`; a value
  comes before its key): the warps' keywords were found so.
- **A client's call has more than one caller: read each from its first line before
  its judge is written.** A grep for the call's name over the whole of the client's
  source lists them. It names the warp in twenty places besides its definition: one
  sends nothing for the pilot's own ship, one asks an agent in the call's place, one
  warps to an anomaly as an item and not by its label. I had the judge built and seen
  live before I had read them all, and went back for two guards.
- **A guard added after a proof is proven again**: its tests, the breakages of the
  new lines, the audit by itself, and live on the code as it is committed. What ran
  before it is said to have run before it.
- **A breakage is aimed at one test file.** Where a line before the broken one gives
  the same answer for that file's cases, it survives and says nothing of the tests.
  Read each breakage for the test that catches it, in that file.
- **Ask of each check what a breakage of it would change, before the lists are
  run**: a check that changes nothing is taken out, not left to survive.
- **A pair put among the page's writes changes three pinned things**: the policy's
  list (its test), any older test that counted the pair among the writes that are not
  the page's (`test/bridgeSession.test.js`: run the file whole), and the contract's
  manifest, which is built by `node scripts/build-bridge-contract.js --write` and never
  by hand (`test/bridgeContractManifest.test.js`).
- **The breakage tool will not break a source against a test file that fails as it
  stands: it says NOT TRIED.** Run each test file of a list whole before the list, and
  read the list's output for the words.
- **What a flow's test cannot reach by a bot, reach by what the function goes by.** A
  bot's look always reads the scanner, so "no read kept" was not reachable; a flight
  that names no system made the kept read not this system's, and the same path ran.
- **A hull for a pilot in space in a capsule**: the GM's `/probe` and its like board
  in a station only (in space: `TARGET_SHIP_NOT_ON_GRID`). Warp to a station, dock,
  send it, undock (`swp-stage.js`, between a copy of the store and its putting back).
  The overview lists 200 rows at most: in a den no station is among them.
- **A check of what the page asked says no more than its filter**: a filter for
  "warp" in a request's address finds a route, and not the generic call that took its
  place. Read the frames for the call's own service and method.
- **"Read whole" is to the last line of the handler, and is said only then.** The
  warp's handler was put among the page's writes with its branches listed from a read
  that stopped short of the last: there it takes a point of the caller. Read a
  handler to its closing brace before a pair goes among the page's writes, and list
  each `else`.
- **The generic route sends a page's write as it came.** What a handler takes beyond
  what the client's callers send is open to any browser the moment the pair is among
  the page's writes. Where it takes more, hold the page's call at the BFF to what the
  ledger's judge says is a client's (`src/server.js`, `notAClientsWarp`): one place
  says what the client's call is.
- **The page's JSON has one kind of number.** Where the client's is a float, the page
  says the number and the ledger makes the float where the call is sent, counted the
  client's (a follow's nought, a bookmark's range). What was not said at all and is
  put in is a reshaping.
- **A launch for a live check is put in the store** (`lrd-stage.sh`, between a copy
  of the store and its putting back; it starts EveJS again itself, and both BFFs want
  starting after it).
- **A long wait in the tab is two calls, not one**: a script that polls longer than
  some forty seconds is cut off, and goes on running in the page.
- **A pair made to go on the ballpark's object changes every older test that asked it
  by name as an example.** Three tests of the transport asked the autopilot's warp of
  beyonce "as an order that goes by name". Grep the tests for the pair before it is
  put in `ON_THE_PARK`, and give each another pair that goes by name still (a jump
  through a gate does).
- **A move to the page keeps the call each place made, and says where that is not the
  client's.** The route made the menu's warp for the page's autopilots; so does the
  page. That a client's autopilot makes another call is written under "Left", with
  the note that says why it was chosen, and is a unit of its own.
- **A window of the page's is opened by the button of its name** (a `button` whose
  text is "Flight", "Travel"); the Flight window's warp is the picker's `select` in
  the section headed "Warp to something" and the button "Warp to it"; the Travel
  window's is the number input "station or system ID" and "Start route".
- **A script that forms a fleet has both pilots leave first.** A member whose boss
  left was seen still in that fleet (the corporation's members' unit), and this server
  refuses a second fleet to one who is in one (`440c52ef7`).
- **Where a recording has other numbers than the decompiled source, ask the client's
  own Python.** The source printed two tables of a fleet's formation as other numbers
  than the client's own (20 to 22 and 100 to 107, where the client has thousands; why
  was not looked at). `scripts/client-code.py`
  takes one module's compiled code out of the client; a module that imports nothing
  runs whole in `scripts/py27-oracle.py` (`exec module in names`), and its names are
  then the client's own.
- **A handler that answers nothing whether it did the thing or not takes a refusal
  away from the page.** Say under "Left" what the page's block does then (it waits,
  and gives up), and do not make a refusal up.
- **A new action of the bots is four places**: the union (`nav/scriptDecide.ts`), its
  sentence (`nav/botLog.ts`, whose test lists every kind), where the flow carries it
  out (the coverage test reads the union), and the settle table where its block is
  guarded as a neighbour's is.
- **A field added to a decoded row is optional in the type and always there in the
  decode**: older fixtures build rows without it, and an older test that compares a
  whole row is given it.
- **A mission for a live check**: `msw-stage.js` docks GM Elysian at a station of
  Maurasi (60003454), gives it a hull, and asks and accepts a mission of the level 1
  encounter agent there (3011918). The journal then has a `dungeon` and an
  `agenthomebase` in that system. `msw-agents.js` lists a station's agents by kind.
- **A change to where the ship comes out of warp changes the leg after it.** Size
  that leg too: read its handler to the closing brace, and search the recordings for
  its answer and for what the server sends next, not only for its call. (The
  autopilot's warp put the ship ten kilometres off a station; the approach and a dock
  from out of range then ran, which seldom had; and the server never finished that
  dock. The recordings had it all along: 9 docks answered `DockingApproach`, each
  then accepted by Tranquility with no second call in 7.)
- **Search the recordings for a refusal's name too**, and for the server's next word
  after it. `apw-docks.js` counts a call so answered, whether it was asked again, and
  how long till the acceptance.
- **A ship is put at a said distance by the GM's `/tr me pos=x,y,z`**
  (`POST /api/bridge/gm/slash`), in space. `apw-measure.js` puts it there, reads the
  distance back as the page measures it, asks one warp and watches: a boundary of
  the server's is found to a few hundred metres at a minute a point.
- **The page's autopilot is driven by `run()`**; `start()` only readies it.
  `apw-live.js` flies the page's own loop over a BFF with the page's own functions,
  one gate and a dock.
- **`eve.js`'s tests run by its own runner**: `npm run test:isolated --
  server/tests/<file>.test.js`. A bare `node --test` is refused before it opens the
  store.
- **The server's own state at a call is in its log** (`eve.js/_local/logs/server.log`,
  `[Beyonce] CmdDock state={...}`: its distance, its threshold, the ship's speed).
  Set it beside the page's measure before saying which of the two is off. The log
  starts again when EveJS does.
- **On the game port the page's measure of a closing ship ran ahead of the
  server's** (about 500 m at 172 m/s). A call asked at a threshold by the page's
  measure can be refused by the server's; through the gateway it was not.
- **A loop that features share is each feature's.** Before a loop's call is changed,
  list every starter of the loop (the travel loop's are `startRoute`, `dockAt` and
  `jumpThrough`) and name each one's counterpart in the client. The unit that made
  the autopilot's warp the client's autopilot's changed a pilot's own Dock and Jump
  with it, whose counterpart is another thing.
- **The client has two ways to a thing.** Its autopilot (`autopilot.Update`: its own
  warp, and the throttle with a follow at nought), and its system navigation
  (`NavigateSystemTo`, behind the menu's Dock, Jump and every gate's activation:
  the menu's warp at nought, and the menu's approach at fifty metres with no
  throttle). Say which one a feature of the page's is before choosing its calls.
- **What the client asks before a call is in the recordings too.** `dkl-docks.js`
  lists every recorded dock with the client's orders to the ship in the three
  minutes before it, and with `--tally` counts the last order before each: that is
  how a dock was seen to follow the menu's warp 25 times and a follow never.
- **`dkl-live.js` flies each of the travel loop's three plans** over a BFF (a Dock,
  a Jump, a route), with the page's own functions. `break-check.js` checks a
  breakage list's finds before the list is run.
- **Two ships that drift apart are not two clocks that disagree.** Set the page's
  ship beside the server's over a whole move and read how the gap changes: a gap that
  holds is a matter of time (the page's ship is a steady part of two seconds behind,
  as a client's is), and a gap that grows is a matter of speed. `cls-measure.js` does
  it from the page's snapshot and the server's movement log, with a `/tr` and a warp
  first if asked. The Dock asked "530 m early" was a speed: the page's ship flew a
  tenth faster than the server's after a warp.
- **What the page shows can be the measurement.** The Travel window said "189 m/s"
  for a capsule the server's log had at 172.5, in two iterations' proofs, before it
  was read as a finding. A number on the page that is not the server's is to be
  chased the first time it is seen.
- **What the server sent is in the recordings this repository keeps of it**
  (`test/fixtures/destiny*.json`). `cls-speeds.js` lists a recording's orders about
  speed and movement with their stamps: that is how a `SetMaxSpeed` with each
  `WarpTo`, and none after, was found.
- **A sub-agent asked to remove something is asked first why it is there.** The
  tenth had a reason once (a client that would not fly a warp by itself) and a later
  commit took away what put it back; knowing both is what made taking it out safe.
- **`eve.js`'s tests write into the server's own `server.log`.** A line there may
  be a test's: go by the character and the time.
- **A session that ends near a station does not find the ship where it left it.**
  The server puts a ship that is at rest within 100 km of a station 500 m off that
  station wherever a session's ship is put into a scene (`eve.js`,
  `normalizeLegacyStationState`; an undock skips it). Place the ship and
  measure in one session, or leave it more than 100 km off, or off a gate.
  `lgn-measure.js` leaves a ship at a said distance and says where the next session
  finds it.
- **A number the server gives twice the same is a rule to look for in its code**
  ("500 m", twice): the search for the number beside the word of the thing found the
  function in one step, before anything was measured.
- **A recording taken again is set beside the old one before a test is touched.**
  `rwp-facts.js` plays a recorded warp through the park as the tests do and prints
  every thing they pin; run on the old recording and on the new, it says which
  numbers moved and which claims no longer hold. A number that moved is the new
  recording's; a claim that no longer holds is read again and said in the log.
- **A harness can hold a claim.** The warp tests' replay asserted that a state at rest
  is stamped with the park's own tick, which was true of the one recording it was
  written on. Keep what a harness measures, and let a test say what it should be.
- **Each recording has its hour of the server's movement log** (`eve.js/_local/logs/
  space-movement-debug.<date>_<hour>.log`; the newest is `space-movement-debug.log`),
  and the old hours are kept: the old fixture could still be set beside its own.
  `warp.requested`, `warp.started` and `warp.completed` are the server's own times.
- **The hour's movement log holds more of a ship than the recording's minutes**: 708
  rows of Test Pilot's ship from other minutes beside the recording's 122, an hour in
  which `eve.js`'s tests had run (they fly Test Pilot on a copy of the store). Whose
  each row was I did not check; the comparison script takes only the recording's own
  seconds.
- **A `[PKT] OUT` line of `eve.js`'s `server.log` is stamped with the time of the next
  logged line, not of the sending**: the logger keeps a packet-out line until the next
  thing is logged, to count repeats (`utils/logger/index.js`, `pktOut`). `[PKT] IN`,
  `[LOG]` and `[DBG]` lines are stamped as they happen. Do not time a sending by the
  log: time it by the asker's clock (`rfa-time.js` asks a call several times through a
  BFF and prints when each was asked and answered).
- **A time read off a log is a time of the log's.** Two entries carried "answered
  1.5 to 1.9 s after the refusal" from `server.log`; twenty calls timed by the asker
  took a minute and said 10 to 20 ms. Measure by a second clock before a log's gap
  goes into an entry.
- **Read every caller of the client's call, and the answer may be one line.** The
  client's `CmdFollowBall` is called from five places, and a follow at nought from
  the autopilot's two alone: that settled what a bot's approach is before a
  recording was counted. `bap-follows.js` then counted them: 88 at fifty with no
  throttle, 2 at nought after one.
- **A note in Next can be wrong about the page.** It said the fleet companion's
  approach was the autopilot's; the dispatch says otherwise. Read each asker's own
  line before a unit is sized by the note.
- **A bot does not fly a capsule**: it heads home, and stops where it has none. A
  check of a bot's block in the tab wants a hull first (the GM's `/probe`, docked),
  and the ship placed in the tab's own session: both can be asked of the BFF's
  routes from the page's own session, with its own token read inside the request and
  never returned.
- **A branch of the client's on something it keeps may be about a thing of its
  own.** "Where the sensor suite has a bracket for the ball" read as a rule for
  things in space; the balls are the client's own (`AddClientSideBall`), for every
  site but a structure's. Read where the kept thing is made before a unit is sized
  by the branch.
- **A note beside a recording is somebody's reading of it.** The citadel's notes have
  a warp's range as 150000; the recording's bytes have nought. Go by the `.txt`,
  and by the bytes of the call itself: a dict's count (`\x16\x02`), then each value
  before its key.
- **A search of the whole decompiled source by a shell `grep -r` takes minutes.**
  Use the search tool, or name the folder.
- **A write moved onto the generic call leaves its route's path behind in whatever
  reads paths.** The bot host's guard of a recovery tells a write by `url.pathname`
  and takes `/api/bridge/call` for a read, as it was when the guard was written; 48
  writes had moved onto the call before it was looked at. Before a write is moved,
  search the BFF's sources for the route's path as text, and for
  `"/api/bridge/call"` itself.
- **A test's double keeps making the old form.** The recovery's tests accept a
  fleet's invitation by its route and lose a write by a route; they pass, and say
  nothing of the form the page makes now. When a form changes, search the tests'
  doubles for the old one.
- **Count routes off the app, not off the source's text.** `app.router.stack` has
  483 under the bridge's path where `app.get("…")` in `src/server.js` has 472: a
  route can be registered by a list of paths, by a helper or from another file. And a
  `${…}` in a path named is a route's parameter: `chat/${channel}` is not
  `chat/send-message`.
- **Where one gate tells a write by its path, look for the others.** The bot host's
  guard was one of five: the BFF's gate of a session's change and of a hosted
  generation took `/api/bridge/call` for a read too, and the flight routes' gate
  stood on those routes' own path. Search every source of the BFF for the call's
  path as text, and for `req.path`, `url.pathname` and each `app.use(` with a
  path, before a unit about one of them is sized.
- **A test that chooses a pilot chooses it as the page does.** Seven tests of the
  page's orders left the check for lost drones unresolved after `select`, which the
  page never does, and passed only while a gate was open. Use the file's own helper
  that resolves it (`acknowledgeRecovery`, `selectOnServer`).
- **A test that holds a request open lets it go whatever it finds.** An assertion
  that fails before a held jump or a held recovery is released leaves the run
  waiting: a minute for a server that cannot close, three for a recovery's own
  watch. Release in a `finally`.
- **What is said of `eve.js` and its origin is read when it is written.** Another
  hand pushed it while a unit ran, and that unit's entry said "two commits ahead,
  and not pushed", as it was when the unit began. Run `git log origin/main..main`
  there as the last thing before an entry is committed.
- **`node scripts/appRoutes.js` lists the app's routes**, off the app itself. Count
  by it, and by the audit's own lines (`npm run audit:game-port`: "of the N routes
  the page names"), and not by a search of `src/server.js`: the text had 582 of the
  614 under `/api/`.
- **A measure is checked by taking it a second way.** The audit's count of the page's
  routes stood at what one file's text and another's gave it. A kept record
  (`--keep`) can be counted again by a few lines of script: do it when a count is
  first relied on.
- **A test of a module that is not there yet cannot be watched to fail.** Say so, and
  watch each of its claims fail by a breakage, and by the old-sources check with the
  new file left in.
- **What a flow asks is counted under a test first.** A flow given a fetch that
  keeps every request, and a bot's clock stepped by the test, counted 20 askings of
  the static data in 20 looks in half a second, where the tab would have wanted a
  fight staged. Count there; the tab is for seeing it once.
- **The tab's requests are read off its socket.** `WebSocket.prototype.send`,
  wrapped after the page has loaded, sees every frame the page carries
  (`{ id, method, path, body }`). A wrap of `JSON.stringify` saw the GETs and none
  of the POSTs, and a wrap of `fetch` saw nothing.
- **A read that keeps nothing has a keeper.** `app/api.ts` keeps nothing of a static
  read on purpose: its caller owns the cache. An asker of a read by type asks
  through `bridge/keptTypeFacts.ts`, or keeps for itself and says so.
- **A wire between the page and the BFF is tested by the page's own asker.** A test
  of the BFF's can load `web/src/app/api.ts` and ask a route with it
  (`test/pagesPlainReads.test.js`): what the page sends and reads, and what the route
  takes and answers, are then one test's, and a name changed on either side fails it.
- **A test that passes at its first run is proved by breaking both sides.** Where no
  source changes with a test, nothing can be watched to fail first: break the route,
  and break its asker, each in turn.
- **"Asked by a test" is not "tested".** A request refused for its body takes a route
  off the audit's list and looks at nothing. Ask a route as the page does, or leave
  it on the list.
- **The audit fails for a call of the page's own that goes by a service's name where
  a route makes it on an object.** The routes' own binds are its evidence (95 pairs
  in the suite). A call the client makes on an object goes on one for the page only
  where the page names the object (`PAGE_OBJECT_CALLS`), where the game port asks
  the service's moniker, or where it is the ballpark's own (`retailCalls.js`,
  `madeOnAnObject`). A new call of the page's of that kind is given its object
  there first.
- **A call of the page's own has an entry in the table of the client's calls.** The
  audit names one that has none ("NOT READ"). Read the client's function and enter
  it, with its file and line, in the unit that adds the call.
- **A measure that names something at its first run has earned its place.** The line
  for unread calls named `fleetObjectHandler.CreateFleet`, which the game port made
  as the client does and the table had never been told of.
- **A count weighs what it counts.** Twenty static reads were asked once, or once a
  click; the one that mattered was found by the tab's socket and the size of an
  answer (the map's graph, 745 KB, twice), and not by reading who keeps what.
  Count the askings, and weigh the answers.
- **What is kept for a page is kept by what it is asked with.** A keeper every flow
  of a process shares is shared by a test's flows too, each with a map of its own.
  Key it by the fetch (`callOptions.fetch ?? pageFetch()`): one for a page, and a
  test's own in a test (`nav/systemGraphKept.ts`).
- **A window left open is mounted as the page loads, before a recorder is in.** An
  asking that comes some times and not others may be its. Close the window, load
  the page again, count from there; and put the window back as it was found.
- **"No test makes it" is first a question of what the looking sees.** The audit said
  six pairs of the page's were made by no test; three were made, by calls that did not
  say `pilot`, which was all it looked at. Before a test is written for a thing a
  measure says is untested, find a test that makes it and ask why it was not seen.
- **A call of the page's own is told by its body, not by a flag.** An account's call
  and a call on the session held go to the game port as a pilot's does. The audit
  takes the four names the page builds a call of (`callMethod.ts`).
- **A name in a recording is not a call.** The bookmark manager's name is in three dozen
  recordings and its asking in three: the rest are lists of services a client is sent.
  "Agent Missions" is in 19, each a menu's entry. Say what kind of line each match is
  before recordings are counted, and count again before a count is written a second
  time: "five recordings" stood in three places and could not be counted again.
- **What a client makes for itself says what form it can live with.** A client keeps a
  KeyVal of its own making beside the server's rows of the same thing
  (`NewBookmarkCreated`): the names it gives are the names every reader of its cache
  goes by. Look for the client's own making of a thing before a server's form is set
  against a recording's.
- **What a server keeps for itself can show in an answer.** This server files a
  mission's spots in a bookmark folder of the pilot's, and the folder is in the answer
  a client lists its folders from. Where a server's own keeping is found in what a
  client is answered, say what a client would show of it, and find a recording before
  it is called a defect.
- **What several of ours ask is kept where they all ask through.** The page has a flow
  and each hosted bot has one, and a keeping in a flow is one for each. The game
  port's transport is the one place they all ask through, and it has a table of reads
  kept until something changes them (`pilots.js`, `KEPT_UNTIL_CHANGED`): a read the
  client keeps is a line there (what it is kept as, the notices, the writes), and the
  page is left as it was.
- **A count an earlier unit made is the "before".** A bot's askings for its bookmarks
  had been counted in the tab by the unit that made the read the page's. Look in the
  log for a measure before staging to take it again.
- **The server's own log counts what reaches it, on either transport.** A handler's
  line for each asking it answers, by the character, is there for the gateway's calls
  too, which have no packet line. Note the log's size before a check, and count from
  there (`bkk-count.js`).
- **"Kept as" is broken three ways, not two.** Something sent beside the call, a
  keyword, and another read of the same service with nothing. The last lived until a
  test asked one.
- **What a server hands out is a thing to meet, though no client shows it.** The rule
  was that a difference no client behaviour meets is not sent to a sub-agent. A list
  that hands every pilot what another pilot's client sent in confidence (whom a fleet's
  boss lets in and keeps out) is met by whoever reads the wire. Where a recording has
  None and the client's own code says the None is the server's, measure it live with
  two pilots, and send it.
- **A sub-agent told not to run a test has left it unrun.** The server's harness
  scenarios copy the live store, and the sub-agent was told to leave them; it changed
  two and ran neither. Run what it changed yourself, by the server's own isolated
  runner (`node scripts/Tests/run-isolated-tests.js --jobs 1 --timeout-ms 600000
  <file>`), with the store as it was before any staging, before the fix is called seen.
- **A note beside a recording is a list of things to check, and it ages.** Another
  hand's note of fourteen differences was three months old: of the five looked at,
  none held any more. Say which were looked at and how (a search, or a measure), and
  leave the rest named.
- **A tab closed with the servers has no account signed in.** The hangar lists its
  pilots from what the browser keeps, and a click on one only marks it. An account is
  signed in at the hangar's own form (a test account's name out of the fixtures; the
  form takes any password), and a marked pilot is brought online by "Bring online".
- **Work in the write the page makes, and let go at the rest.** Sixteen writes change
  what the client's bookmark service keeps, and the page makes one of them. Working
  that one in as the client does took the page's last asking a client does not make;
  the other fifteen stay let go at, which is never behind. Count who of ours makes a
  call before building for all of its kind.
- **What is kept is proven by a session begun after.** A bookmark the transport made
  for itself was set beside the one the server answered at the next choosing, by the
  page's own decoding, name by name: the same but for when it was made. Do that for
  anything worked in without asking.
- **Run a live check on the gateway too, and read what it answers.** The same call by
  the same function saved a bookmark with a place on the game port and with none
  through the gateway. A count alone would not have shown it.
- **Where a recording has a course, run the course.** A note's nine differences were
  settled by running the recording's own course with two pilots and printing what each
  was told at each step (`flb-live.js`), beside the recording's lines. Seven fell in one
  run, where reading the source for each would have left them "read". What a pilot is
  told comes back with its next answer, on either transport.
- **Read the recording before a note of it.** A note said the recorded state had a
  `squads` beside its wings; the answer's own dict counts six entries, and the name
  stands once, inside the wing. A field was made in the server after that misreading.
  Count a dict's entries off the packet where the client's own line of it is cut short.
- **A number the server holds against its own is all or nothing.** A job's cost, tax
  and time go as nought, and the server reckons each; sent as anything else, each must
  be the server's to the whole or the job is refused. Before building such a number,
  list every input the client's reckoning takes and which of them nothing of ours
  asks, and build one number a unit, each seen accepted live. Do not half-build one.
- **A unit found to be four is written down as four.** The sizing is the iteration's
  work where the unit will not fit: what the client does, by its lines; what it wants
  that is not asked; what the server does with it; the steps in order. Build only
  what the sizing turned up that is whole by itself.
- **Read every input of a reckoned number as the server has it, and write each beside the
  result.** A first live run came out at the number expected for a reason not expected:
  the blueprint had no time research, and the station had a time modifier of its own that
  nothing had said. The number was right and the account of it was wrong. A facility's
  row, a blueprint's, a pilot's attribute: each is read live before the proof is written.
- **Floats multiplied in another order are another number.** Where the client reckons a
  number the server holds against its own, the order and the grouping of the
  multiplications are part of the reckoning: keep the client's, one factor at a time, and
  hold it with a test that another order fails. Then sweep the game's own data for inputs
  where the server's order rounds another way, kept to states the game can make, and
  stage one: what the server says of it is the finding.
- **The tab serves the built page.** `public/dist` is what a check BFF hands the
  browser, and it is not built by a test or a restart: `npm run build:web` before a
  change to the page is looked for in the tab, then load the tab again.
- **A call only the transport makes has no entry in the routes' table.** A call of the
  client's own that a route may not ask by name (the contract refuses it before
  dispatch) is listed with the transport's own calls (`TRANSPORT_OWN_CALLS`,
  `retailCalls.js`) and noted in the ledger where it is made, with its place in the
  client's source. Do not allowlist a pair to make the transport's own asking of it
  pass: the transport's askings do not go through the list.
- **The gateway's askings are not in the server's log.** A call on the game port is one
  `[PKT] IN` line there (and one `[PyPacket]` line beside it: count one of the two).
  A call through the web gateway is written nowhere in it: count those in the gateway
  BFF's own tally (`gateway-ledger.json` in its data folder), from a BFF started
  afresh.
- **The recordings begin at the choosing of a character.** What a client asks as it
  starts (its cfg loading, its selection screen) is in none of them, and "no recording
  has it" there says nothing of whether a client asks it. This server's own log of a
  retail client's login has that stretch (the login report's source, in `eve.js`'s
  logs): look there before writing that a client does not ask.
- **A thread of the client's that waits is a timer here, and other tests ask for none.**
  A call whose place among a login's calls is the clock's is made by the transport's
  injectable `timers`, never by the tests' `sleep` (which is instant, and would put the
  call in every test's login). The stand-in session lists such a call apart, and the
  tests' transport is told not to make it; the tests of it hold the timers themselves.
- **A number read back is named by where it was read.** A job's row carries the job's
  total as its `cost`; the request carries the cost alone. Set beside each other they
  looked like a server charging twice. Before writing that two numbers differ, write
  for each the line it was read at and what that line says it is.
- **A kind of account can be staged by the server's own setting.** Started with
  `EVE_CLONE_GRADE=alpha` in its environment, EveJS answers every account's clone grade
  as an alpha's; started again without, as its settings have it. Nothing on disk
  changes. It showed a cost sent and held (an alpha's job refused), which an omega's
  job, taken either way, could not.
- **A stand-in that answers alike for every ID hides one refusal behind another.** A
  test's lookup that made every type a blueprint had a price refused for a blueprint
  among its own materials, and the breakage of the check it was written for lived.
  Make a stand-in answer for the IDs meant, and nothing for the rest.
- **A guard that repeats the reckoning's own cannot be seen broken.** A route refused
  a fee where the cost or the tax was null, and so did the reckoning it called:
  breaking either changed no test's answer. Keep a refusal in one place, the
  reckoning's, and take the other out rather than write a test round it.
- **A wrong value for a decoder's test is wrong in one way only.** A fee with a part
  below nought was refused for not adding up, and the check of the part lived broken.
  Make the wrong one pass every check but the one meant.
- **Read whether a thing can be seen here before promising to see it.** Every facility
  of the region had a tax of nought, and no system a gate reaches the security a tax
  wants: both were read before a line was built, and the unit said from its start
  which of its numbers would be in tests only and what would have to be staged to
  see them.
- **A fault beyond 32 bits hides in every station.** An item's ID, a structure's, a
  fleet's: the client holds each as a long, and blue writes a long its own way. A
  station's ID is an int, and a check made only in a station shows nothing of how a
  long goes. Where an ID goes out inside anything (a tuple, a dict, an object, an
  extended object), try it once with one beyond 32 bits.
- **When a reproduction and the live server disagree, read the sender.** The server's
  own parser, fed what the server's own encoder wrote, threw for a station's job too;
  live, it did not. The bytes on the wire were not the ones the reproduction made.
  Make the reproduction from what is sent (`src/gamePort/clientMarshal.js`), and
  read the file that writes it before the file that reads it.
- **The server's log names a throw the route can only call a silent decline.**
  `_local/logs/server.log` has a `[PKT] ERR` line with the error's words. Where it
  was thrown can be had with no source of `eve.js` touched: start EveJS once with a
  script of the scratchpad's loaded before it (`restart-evejs-diag.sh on`, which sets
  `NODE_OPTIONS=--require`), read the stack it wrote, and start it again `off`.
- **A structure for a check is three GM commands and a store edit.** `/upwellauto
  raitaru` (online in under a minute), `/upwell service <id> 22 online`, `/tr me
  <id>` to dock in it; `/bpauto seed` seeds where the pilot is docked. A facility's
  tax is a row of the server's own table (`stx-tax.sh <facility>=<rate>`, the server
  stopped for it). All of it goes with the store's copy put back.
- **A rounding is asked of the client's own Python, not remembered.** Its `round(x, 2)`
  rounds by what the number is and a true half away from nought; `toFixed(2)` is the
  same for a number not below nought, and `Math.round(x * 100) / 100` is not (2.675).
  `scripts/py27-oracle.py` answers for thousands of numbers in a second: ask it for
  the edges, and take a test's expected numbers from what it printed.
- **Where two sums of floats can part, search the game's own numbers for where they
  do.** Every quantity the blueprints list, every research, a hundred runs: two
  million cases took seconds, said none part at a station and 209 in a complex, and
  named the blueprint to stage. A defect found so is seen live at the first try.
- **A test's vectors should each kill one wrong way of doing the sum.** Beside each
  expected quantity is written which other order or rounding gets it wrong. A vector
  that every wrong way gets right proves nothing but the arithmetic.
- **A server's fix is looked at on a store staged afresh.** The store is put back
  before a sub-agent begins and its tests are run, and staged again after
  (`mat-restage.sh` is one script for it): no test of the server's meets a staged
  store, and the look at the fix starts from what the first look started from.
- **Read every caller of the client's function, not the one the feature came from.**
  `GetFreshFacility` was built for the job a window makes; it has two more callers,
  and one of them is every job the server answers. A grep of the function's name
  over the whole client, read to each caller's first line, is part of sizing a unit
  that builds what a function does.
- **What the server was asked is in its own log, and can be counted from a mark.**
  `rig-asked.js mark` gives the log's length; `rig-asked.js <mark>` lists the
  facility's and the industry's calls since, in their order, with runs of the same
  call counted. One reading of a panel, counted so, shows a call made once for each
  row where one was expected.
- **A structure's rig is an item with a rig slot's flag.** Give the rig by the GM
  command to a pilot docked in the structure, stop the server, and set the item's
  flag (92 to 99) in the store's table of items (`rig-store.js`). The facility's row
  then lists the rig and its modifiers. `rig-restage.sh` is the whole of it.
- **A thing the client keeps for a window has a life, and its end is a call too.** The
  job a window has is made at one moment, kept, and let go at another, and the
  client sends something at each: the unit that builds the keeping is not done till
  it has read where the window lets go (`Close`, and every place the window's job is
  set to another), and what the service's hold on it is (here a weak reference,
  which is gone with the job).
- **A page's part that goes away is not a window that closed.** The Industry panel is
  taken off the page when its window is put away, when the pilot undocks, and when
  another pilot is shown. Only the workspace's own close of the window is the
  client's `Close`: hang a window's close on that, and not on the panel's going.
- **A loop of changes in a test sets each beside the last, unless it is made to set
  each beside the first.** Four ways of being another job, tried one after another,
  were each another job than the one before for more than one reason, and three
  breakages lived. Go back to the thing as it was between the changes.
- **One failure in a whole run is looked at before the run is made again.** Run its
  file alone, read what it tests, and write down what was found and what was not:
  here a test of a socket's stream, nothing of the unit's, three passes alone, and a
  clean run after. That is what was measured; why it failed is not known.
- **Where the server's sum reads the same as the client's, a second copy of it proves
  nothing.** Written out again it agrees with itself. Hold this code against the
  client's own interpreter instead (`scripts/py27-oracle.py`), over what the game's
  data has, and take the tests' vectors from the cases that tell the client's order
  from another (`cpy-vectors.js` finds them: for each other way of doing the sum, the
  first cases it comes apart at). A search of the game's blueprints for where the
  server parts from the client is for where the two are written differently.
- **A name the client's job always sends is a name of every kind of job.** The runs a
  copy is licensed for went as 1 with a manufacturing job for as long as the route
  had sent one, because only a copy job "used" them: the client's job has them for
  any work, and sends them. Read `dump` name by name against what the job has for the work in hand.
- **The bare interpreter has no `functools`.** `reduce` fails in the oracle for want
  of it: write the reduction out by hand, in the same order.
- **A script that makes a number of an answer says the answer's status first.** A
  hangar read as nought, four times, was a route refusing with 409: the count was of
  nothing. (`GET /api/bridge/inventory` refuses for a pilot docked in a structure.)
- **A search for where the server parts from the client is over what both are given, and
  says what it left out.** The search of the researches skipped every blueprint the
  two price differently, to compare bases like for like, and so found the pricing
  itself: 649 blueprints the client prices at nought and the server by their own
  type. Count what a search sets aside, and look at it.
- **A sum whose terms cancel is still told apart by its floats.** The activity's time
  is multiplied into a research's base and divided out again; a breakage that made it
  1 lived until a case out of the client's Python's answers was put to the route,
  where the two come an ISK apart. Take such a case from the oracle's own cases
  (`rsc-vectors.js` lists them by the other way of doing the sum).
- **A new test that fails on its first run is read both ways before either side is
  changed.** Two of this unit's did. One was my own sum in a comment (a product
  rounded the wrong way): the expectation was mine to correct. The other was the code
  taking the text "3" for the number 3: the code was made strict.
- **Before the server is called wrong for a number, read what it serves the client that
  number from.** The client priced a blueprint at nought because the table this server
  serves it has no price for the materials; the BFF's table was the one served. That
  settled whose fault it was before anything was changed, and it is one handler to
  read (`configService.js`, `getAverageMarketPricesPayload`).
- **When the server is made the client's, say what that does to the game.** A blueprint
  priced as the shared code prices it made 411 rigs' jobs cost nothing here: right by
  the code, and the operator's to know. Ask the sub-agent what else moves, and write
  it under what is left.
- **A sub-agent's count and one's own are set side by side, with what each counted.**
  631 and 701 were both right: one was of blueprints that have a manufacturing, the
  other of every blueprint for every activity.
- **After the store is put back, check both of the server's doors.** A boot once
  failed to start the web gateway (a lock file under `_local/certs` could not be
  opened) with the game port up: `store.sh` says "the gateway did not come up" and
  ends 1. Start EveJS again in the ordinary way (`restart-evejs-as.sh asitis`).
- **Two things staged to tell a difference are first reckoned to differ on this
  server.** The Rifter's two inventions were staged to show which blueprint a job is
  priced by, and are priced alike here: what parts their materials is served no
  price. A reckoning over the game's data by this server's own prices, which reads
  only, found a pair that differ. Do that reckoning before the staging.
- **Writing a breakage for a guard, ask what the next line makes of the same input.**
  Two checks were found to be made already by what they guard while the list was
  being written, and a third by the run. Take such a check out, or say why it is
  left.
- **A mark into the server's log can be past the log's end.** The server cuts its log
  down to its tail when it has grown, and a reader that starts at an old mark then
  finds nothing and says "none". `rig-asked.js` says so now; read the log from its
  start and tell the calls by their times.
- **What the client's dump has that the server drops is still sent.** The empty place
  of an invention's decryptor is a None key the server takes out before it compares;
  the job goes with it all the same, because the measure is the client's request
  and not what the server needs of it.
- **A refusal with a code of its own may be a decision.** `git log -S"<CODE>"` it, read
  the commit and whatever policy it names, and say whose it is before sizing a fix.
  The structure's 409 was a boundary for the web gateway, by another hand: it was
  kept where its reason holds and lifted only where it does not, and the entry says
  which commit to take back if that was not wanted.
- **Count a call's forms across every recording before the client's code is believed
  alone.** The cache's code makes a structure's hangar `GetInventory(containerStructure)`;
  no recording has it, because godma has bound the same key first, another way.
  `grep -rhoE "\('GetInventory(FromId)?', \([^)]*\), \{[^}]*\}\)" . | sed -E
  's/[0-9]{9,}L?/<id>/g' | sort | uniq -c`; and a call on an object already bound is in
  the transport's bytes only (`grep -rlaF "GetInventory,\x05\x1e'"`).
- **A page's control may ask before it acts, and one in a hidden section does
  nothing.** The hangar's "to Cargo" opens "Confirm move". Where a scripted click
  changes nothing, read the control's rectangle (0 by 0 is a hidden one: open its
  tab first) and what the page shows after it.
- **A test of another unit that fails in the whole suite is run alone, read for what
  it waits on, and held still there.** `node scripts/game-port-audit.js --keep
  <folder>` keeps the suite's output; the plain run keeps only the test's name. Two
  failed once each for a running clock and a frame's arrival: neither a longer wait
  nor a run again is the fix.
- **Before a route is sized, see that the page still asks it.** The repair's two routes
  were on the list of what a structure's check opens, and nothing of the page has
  asked either since its repair became its own call. `grep -rn "<route>" web/src`
  first: a route named only in a comment is no caller.
- **A feature hidden behind a reading that could not be had has never been seen.**
  The panel's repair in a structure was built and tested and stood hidden until the
  structure's services could be read; its first showing had words for a charge of
  nothing. When a reading comes to be had, list what it was hiding and look at each.
- **While something is staged, try what the next units will want of it.** Three GM
  commands and one look told that a complex's reprocessing and market can be set
  online, and a short script saw the server's notice let the kept services go: each
  was a line under "left" in the entry before.
- **Nothing heavy runs beside the breakage tool, and it runs a test file under twenty
  seconds.** A store put back beside it started EveJS under it. And a file with a
  slow test in it is "NOT TRIED … the tests fail before the source is broken", which
  reads like a failure of the unit's: run the file as the tool does
  (`node --test --test-timeout=20000 <file>`) before the list is made, and give a
  test that waits on the server's own clock a clock of its own
  (`transitionNow`, `transitionSleep`).
- **A check that reads the world for what is gone says the opposite for what stays
  the less.** The reprocess route read the hangar for the stacks that were gone, and
  called a stack with a remainder left and a stack that was never there done. Where
  the server says what it did, go by that, as the client does; read the world only
  where it does not say.
- **A stand-in's function replaced after the server is made may be one the server
  never calls.** A test that swapped `callBoundMethod` on the stand-in refused
  nothing, and passed. Give the stand-in the refusal as its own state, and hold the
  test to the refusal having happened.
- **Before a row is sent back to the server, write one and compare the bytes.** A row
  decoded and written again was a byte longer (its text came back as bytes); read
  as text first, it was the server's own bytes. `rpc-roundtrip.js` is the check,
  with this server's own codec for the first writing.
- **A window's tab says where it is offered: read it before a control in it is called
  a feature.** `web/src/ui/tabs.ts`, `where`. The Mining window's refining is for a
  docked pilot, and the window is offered in space only.
- **A test may hold a defect as what should be.** The reprocess route's oldest test
  had its stack in the ore hold, and asserted the hangar as the place the stack was
  reprocessed of. Read where a stand-in's thing is before what a test says is done
  with it is believed; and give a stand-in's rows what a server's have (a place).
- **Where a tab is offered is held by more tests than the tab table's.** The rail's
  own test had Mining for its example of an in-space tab. Run the page's UI tests on
  their own before the whole suite (`node --test "web/src/ui/*.test.ts"`; a folder's
  name alone is taken for a file, and fails). And why a tab is where it is: `git log
  -S` its line of `web/src/ui/tabs.ts`.
- **The whole suite is run on the tree that is committed.** Words of a page changed
  after the audit want the audit again: it was run twice for one line of the Station
  panel.
- **A server's own test may stand on a session no pilot has.** `eve.js`'s tests of a
  structure's market built their docked session with the structure as its
  `locationid`; a recorded one has the solar system there, and the running server
  refused what the tests passed. Before a server's test of a place is believed, set
  its session beside a recording's session change.
- **Whether a thing can be done at all: try it with the least, then with the most.**
  A buy order in a structure was refused for a skill; with every skill
  (`/allskills`) it got as far as the market daemon, whose refusal was the answer.
  And read the server's own comment at the place before a refusal is called a
  fault: the daemon is told of no structure by decision.
- **A rate the server holds an order to is proven by the refusal that comes next.**
  Read the order of the server's checks first (`executeBuyRequest`): a rate that is
  not the server's is `MktBrokersFeeUnexpected2` before anything else, and one that
  is gets as far as the check after it.
- **Where what the server tells the client and what it charges are two things, the
  client's own rule says which the client believes.** An unset tax was answered as
  True and charged as nothing; the client's Python makes one percent of True
  (`scripts/py27-oracle.py`, with the client's `tq/bin64`).
- **List a new function's breakages before running them, and take out what none of
  them changes.** Four guards of mine made no difference to any answer (nought is
  what `Number()` makes of None, and a rate of nothing comes of it by itself).
- **A window offered in two states carries its picks from one to the other.** The
  Mining window's ticks were the holds' alone while it was offered in space only.
  Offered docked too, with the hangar's ore to tick, a hangar's stack would have
  been counted, and asked for, by a dumping after an undock. When a window's reach
  grows, read every use of its selection.
- **`Number(x) || null` makes nought unknown.** The quote's route said a stack with
  nothing to process had an amount that was not known, and the window offered to
  refine it. Nought is an answer: look for `|| null` after a `Number(` in a decoder.
- **What the page was told beforehand is not the server's silence afterwards.** A
  refining that left the one stack its own quote called too few was told as
  "the server did not say why". A sentence that says so is to be set beside what
  the page itself was told a moment before. And it took a pick of two, one that
  goes and one that stays, to see it: try the mixed case in the tab.
- **A refusal taken out is held by tests that do not name it.** The page's
  refusal of an office in a structure was held in the call's own tests, which I
  changed, and in the flow's, by other words ("and nothing in a structure"),
  which the whole suite found. Before the suite, `grep -rn` every test folder
  for the refusal's sense as well as its sentence.
- **A blanket refusal can stand where a check was never made.** With the
  structure refused, nobody had set the place of the offices' listing beside the
  place the flight names; with it gone, a station's listing would have given up
  an office in a structure. When a refusal goes, ask what else it was keeping
  out, and run its old case to see what is sent.
- **`innerText` leaves out what the window's width hides.** The panel's "1
  rented" was in the page and not in its text: the counts are hidden in a narrow
  window. Read `textContent`, or the computed `display`, before calling a thing
  missing. And a press's refusal may be said at the panel's top, not where the
  button is: read the whole panel after a press.
- **A block moved is seen again where it was.** The station's Offices block
  became a snippet for the structure's sake; the tab's station was looked at
  again after, and all three calls made there.
- **A test that tells a call by its method alone fails for another service's
  method of that name.** `structureGuests.GetGuests` failed a test that held
  "no NPC station's reads in a structure" by the names `GetGuests`,
  `GetStationItemBits` and `GetStationInfo`. Run the page's test folders by
  themselves before the suite when a call is added (`node --test
  "web/src/app/*.test.ts" "web/src/ui/*.test.ts" "web/src/bridge/*.test.ts"`,
  about a minute), and make such a test tell its calls by service and method.
- **A guard the breakages cannot reach may be the store's or the typecheck's
  to hold.** Listing the breakages before running them found a guard of the
  transport's that changed no answer (what is kept is let go at every change of
  structure, so a late answer is never read): it was taken out and the reason
  written in its place. One guard of the page's survived the tests and is held
  by the typecheck alone: measure that (the breakage in, `tsc`, the source put
  back from a copy), and say so.
- **A notice is caused by every way a pilot can cause it.** The leaving of a
  structure was sent at an undock and never at a move from one dock to another
  (a GM's transfer, and a clone jump to a station): that transition announced
  the arrival alone. A script that leaves its pilot's session at once also hides
  an arrival behind the leaving its logout sends: hold the second pilot online
  while the first is read. When a list is kept and changed by notices, cause
  each notice the plain way first, then by each other transition the server has.
- **A recording of a docking is the order to ask in.** The lines of one docking,
  listed in order (`rec-seq.js` in the scratchpad: line, time, service, what
  was sent), said at once what a client asks there, which the transport asked
  already, and where the new call goes among them.
- **Read every word on the page in the state a wording is for.** The unit named
  one label ("Station hangar"). The tab docked in a complex showed two more
  that no search for the label finds: "this station" in the header, and
  "Station services" over the panel's own "Structure services". After a change
  of words, in the tab: `document.body.innerText.match(/[^\n]*\bstation\b[^\n]*/gi)`.
- **The Station panel's last tab is "Structure services" in a structure.** A
  script that finds it by "Station services" finds nothing there: match
  `/services/`.
- **A test of a source's own line holds the line.** The fitting window's first
  test matched the text of its source; it was replaced by one of what is
  rendered, the store fed a module in the hangar and one in the hold. A source
  match is for what nothing renders (a question behind a press), and for
  nothing else.
- **What is open in the tab is in its saved layout, in the order first opened.**
  `JSON.parse(localStorage["evejs-web-desktop:v1:<pilot>"]).wins`, read before a
  rail button is pressed, says whether the press opens a window or raises one.
- **What is said of `eve.js` is read with the eyes before it is written.** A
  docs script was handed the count of commits ahead straight from the command
  that read it, and wrote "0 ... none of which this loop pushes" of an origin
  another hand had pushed to minutes before. Read the three (local `main`, the
  origin asked now, how many ahead) in a command of their own, look, write the
  sentence by hand, and hand the script the sentence. Where the origin moved,
  `git reflog show refs/remotes/origin/main --date=iso` says when, and whether
  by a push from this checkout.
- **Where a thing cannot be seen live, say what stands for it, and why that is
  enough.** No recording has a clone jump and the page makes none. The server's
  own tests stood for the running server because, the unit before, tests of the
  same notice had failed and passed exactly as the live server did.
- **While a sub-agent works, read the next unit; do not build it.** The
  reaction's job was read whole and sized into Next while one worked in
  `eve.js`. Nothing of it was built, so the iteration ended on a clean tree,
  and the breakage tool never ran beside another's tests.
- **Where no recording is, the server that holds a number against its own is the
  oracle.** No recording has an install. The server refuses a job whose time,
  materials or cost is not nought and is not its own: a reckoning is proven by a
  job accepted with each number not nought. Stage the case that makes each one
  so (a reaction's tax was nought until the refinery was given a rate in the
  store).
- **A test that passes may be saying what is no longer so.** Four passages held
  "a reaction is not reckoned", asking one of a blueprint that has no reaction.
  They pass with every kind reckoned, for the blueprint's want of a recipe. When
  the last case of a kind goes, `grep` the tests for the kind's name and read
  what each says.
- **The server started by its launcher outlives a background shell.** A script
  run in the background stopped EveJS, changed the store and started it through
  `start-evejs.ps1`; the server was listening by the same pid after the shell
  was gone, and through the checks that followed. It is the shell's own child
  that dies with it. Look at the listener's pid after such a start all the same.
- **A script's press is of the thing it names, or it is not named.** A press
  written down as "the second blueprint's row" took the window's first "Start
  a job…" button, and that was the first blueprint's again: the form had been
  closed by a refusal. It stood in the notes as a call that was not sent and
  could not be explained. Find the thing pressed by what it holds (the row's
  own text or class, its place among the rows read in the call before), read
  which is the chosen one after, and read the transcript's own script before a
  press is said to be of anything.
- **Listing the breakages can move a rule to where a test reaches it.** What
  keeps a job from being asked about was one long line of a window: nine ways
  to break it and no test that could see one. Made a function of the bridge,
  each is caught. Where a list has a breakage no test could catch for want of
  anything to call, move the rule and do not write a test of the source's text.
- **What a transport answers from what it kept sends nothing, and the server's
  log shows nothing.** A second asking of the job that is the one monitored is
  answered so. Before a call "not sent" is taken for a fault, read what the
  transport keeps for that call and by what.
- **What a route starts is stood in for where no breakage can reach the real
  one.** A route that spawns a program, writes a file of the operator's or
  fetches from outside is not made safe by a stand-in handed to the app: a
  breakage of the line that takes the stand-in puts the real thing back, and
  the breakage tool runs it. Stand in for the thing itself before the server
  is loaded (`child_process.spawn`, the data folder by its variable), and look
  after the run that nothing was started and nothing of the operator's written.
- **An asker that takes no options is asked through what it does take.** The
  icons' three use the tab's own `fetch` and the tab's own token. Stand in for
  those two (a path with no origin sent on to the BFF; the token set through
  the page's own module) and the asker is the page's own still.
- **A hosted bot's route is asked as a hosted bot asks it.** Such a route wants
  three things of a request: a web session's token, that session's pilot held,
  and the bot host's private header with the secret the held session carries
  (`botClaimSecret`). A held session with that secret refuses any write
  without it before the route is reached (`HOSTED_GENERATION_CHANGED`), so a
  fixture whose held rows have no secret tests another refusal than the one a
  cockpit beside a bot meets. Put the secret on the row.
- **A count in a sentence is counted again against the list beside it.** "The
  five writes' askers read nothing" was four: the reserve's reads what it is
  answered. Before a number goes in the log, name its members.
- **A route that answers before its work is done is waited for, with an end.**
  The support's stop answers 202 and stops the bots after. A test that reads
  the state at once reads it too soon, and one that sleeps reads a guess: wait
  a little at a time for the state, to a bound, and assert what the wait
  answered.
- **Where a route's answer is a module's number, break the number through the
  route's test.** Ten seconds fresh and thirty seconds lost are the support
  policy's, and what a bot's page is answered turns on them. No test asked
  them through a route; ten breakages of the two modules were caught by the
  routes' own test.
- **A request a test holds open is raced against its own ending.** A test
  that waits for an Apply to reach the state it is held at waits for ever
  where a breakage ends the Apply first. Wait on whichever comes first
  (`held` in `test/pagesProvisioning.test.js`), and give every test of
  such a file its own limit.
- **A BFF's ending is two apps on one journal.** An Apply held open in the
  first at a state it has journalled, and a second app started on the same
  file: what the second finds is what a BFF started after a crash finds, and
  no file is written by hand.
- **Where a check reads two things of one answer, the stand-in says them
  apart, and where two askings are to meet, it holds the first.** A server
  whose "not online" and "let go of" were one switch could not show which a
  recover reads. And a stand-in that answers within one turn cannot show two
  askings meeting: a recover "asked twice at once" was said and its breakage
  lived, until the release was held open and the second asking seen to reach
  the BFF and wait.
- **What a test does not hold can still be measured once**: a copy of the
  test file that prints what it was answered, run and removed
  (`pp-probe.js` in the scratchpad). It showed a recovered Apply keeping the
  reason it was held for, which no assertion was about.
- **Where an asker goes on from a route's answer, the test goes on as the
  asker does.** A look at a ship being made answers `READY`, and the panel
  then asks the plan again and applies it: followed by the page's own askers
  to the finished ship, the wire's second half is in the test too.
- **A consumer of something already tested is broken through its own test
  too.** The Center's Apply has lines only a consumer that is not the Center
  reaches (which consumer a plan is for, the session that asked, the
  training read again under control): eleven breakages of it were caught by
  the Training's test, and by no other.
- **A second line of defence is seen only where the first is got past: have
  the stand-in answer one asking otherwise than the last.** The Center's
  read of a fitting is held to what the page accepted, after the
  qualification's read has refused a changed fitting already. A library that
  answers its n-th asking differently (`world.saved` in
  `test/pagesTrainingEquipment.test.js`) is a fitting saved between the two,
  and the second check is then the one that refuses.
- **A thing checked at two places is lost at each in turn.** Skills lost
  before an Apply are refused at the first of the two readings whichever is
  broken. An Apply held at each place, the skill lost there
  (`provisioningCenterFault`), tells the two apart.
- **Next's order is a decision, and can be taken again.** The jettison's two
  were set to wait on a live run. Read again, what waits on it is their use in
  a page, not the asking of them. A change of the order is said among the
  decisions, with why.
- **The real thing may be easier to stand up than a stand-in is to write.**
  The bot host with an engine that runs nothing (`createBotHost` and a stack
  of stubs, as `src/botHostRecovery.test.js` makes it) gives a hosted bot's
  real request, by the host's own fetch for that bot, and its real keeping.
  Before something is stood in for, read how its own tests make it
  (`test/pagesJettison.test.js`).
- **What is kept "before the call leaves" is read while the call is at the
  server.** The stand-in server tells the test when a call arrives
  (`world.amid`), and the test reads what the BFF has kept at that moment.
  Taking out the host's marking of a jettison as issued changed no state a
  test could see afterwards, and lived until then.
- **A refusal made at two places is told apart by what was read for it.** A
  jettison held back by unsettled custody is refused by the handler before
  anything is read, and again by the host five reads on: the same answer.
  Assert the reads.
- **A replacement that says the same thing another way is no breakage.** Two
  lived for that: a value the line above holds equal to what replaced it, and
  a check rewritten to the same truth. Read each replacement for the input
  that makes it differ, before the list is run.
- **A route's clock may not be the one the fixture holds.** The custody's is
  the BFF's own `Date.now()`; the operations' is the test's.
- **The servers, from nothing.** With EveJS down the store's three files are copied aside as
  they lie (`gamestore.sqlite` with its `-wal` and `-shm`); then `start-evejs.ps1` (it writes
  `evejs.pid`), and `restart-bffgw.sh` and `restart-bffgp.sh`, each given a pid file with a
  number no process has. `store.sh restore <label>` from then on. The scripts name their own
  scratch folder: a new session copies them and changes the folder's name in them.
- **How soon a thing is in a pilot's scene is measured from the answer, more than once, on both
  transports.** `jet-live.js <bff> <account> <characterID> [ledger.json]` gives minerals,
  undocks, jettisons and looks every 25 ms: 1635, 944 and 1681 ms on the game port, 9 ms through
  the gateway. One jettison a run: this server refuses a second for three minutes
  (`ShpJettisonPending`), so the store goes back between runs. `jet-look.js` only reads.
- **A listing is a list of rows, or a set of them.** A ship's hold on the game port is answered
  as `__builtin__.set`, the hangar as a list. A script that takes `list.items` alone reads an
  empty hold; print a row's shape with a look that only reads before a writer goes by it.
- **A call asked by name of a Moniker's service is counted "reshaped", and that is the client's
  way.** The ledger's count for `ship.Jettison` after its entry was 4 reshaped and 1 differing,
  not "same": read the entry's source in the row to see that it was judged.
- **A route that looks at space after a call that adds a ball waits on the game port, by the app's
  own sleep, and its tests stand the game port in.** `createApp({ gamePortPilots: <the stand-in>,
  pilotTransportFor: () => "gameport", transitionSleep })`, with a held pilot whose handle begins
  `gp:`; the stand-in server has the ball come at the n-th look (`world.arrivesAt`,
  `test/pagesJettison.test.js`). A wait is skipped where the answer says there is nothing to
  wait for, and its bound is one already measured for (the launch's three seconds), not a new one.
- **Where the thing itself cannot be seen live without a staging that is a unit of its own, say
  what was seen, what stands for the rest, and which unit will see it.** A jettison's wait is a
  hosted bot's of an operation: the cockpit's jettison and its refusal were seen in the tab, the
  wait by tests that reproduce the measured late can.
- **In the tab, since 2026-10-12.** The hangar's sign-in: set each input by the native value
  setter with an `input` event, then `form.requestSubmit()` in a call of its own (a click on its
  button in the call that typed did nothing). The pilot's row is `.hangar-row-main`, then
  "Bring online ▶" and "Go to first pilot". The Mining window: a stack's checkbox, "Dump N into
  space…", "Yes — dump N into space"; a refusal is the window's `p.error`. One `message`
  listener a socket, in the wrap of `WebSocket.prototype.send`, pairs each frame with its answer
  by `id`.
- **A small ship wants small stacks.** A Reaper's hold is 120 m³: of 1,000 Veldspar and 1,000
  Scordite asked into it, one went, and the transfer route said "applied". Read the hold after
  a move before going by it (`jet-stage.js <bff> <account> <characterID> [typeID:quantity,...]`).
- **A live run is sized from its start route's text before anything is staged.** Each refusal
  of the start is a thing to stage: a Mining Operation's start refuses a member whose
  corporation has no saved fitting that its ship is (`OPERATION_EQUIPMENT_NOT_READY`), which
  no note had said. Read the start, what it plans by, and the routines it starts; then look,
  reading only, at whether the world has each thing.
- **Looks for a mining operation, each of which only reads**: `mo-look.js <bff> <account>
  <characterID>...` (where a pilot is, in what, and its corporation's saved fittings as the
  BFF's provisioning reads them); `mo-two-look.js <bff> <account> <characterID> <characterID>`
  (two pilots of one account online at once, each read before and after the other comes on);
  `mo-static.js <repo> <stationID>` (the BFF's static data for a station and its system). A
  login brings a pilot online and the logout takes it off: nothing is changed.
- **Two pilots of one account are online at once on the game-port BFF** (Test Two and Test
  Three, seen 2026-10-12). Of the test pilots only those two are of a player's corporation.
- **When one of two pilots at one place sees less than the other, the server's own logs say
  what each was sent.** They are in `eve.js/_local/logs`, timed in UTC: `server.log` (a warning
  is `[WRN]`, not WARN), `space-destiny-debug.log` (each `destiny.send`, by character, with
  the entries' names and how many balls an AddBalls2 has), `space-warp-debug.log`.
  `mo-sent.js <logs> <characterID> <from> <to>` prints one pilot's. A pilot that keeps the
  sentry guns of the station it warped from was sent nothing since.
- **Two pilots of one account are two connections.** This server gave both one client ID until
  `eve.js` `2c8eb9a6d`, and kept only the later one's session in a solar system. It showed as a
  bot that found no rock at a belt. `mo-two-warp.js <bff> <belt> <account>:<pilot>
  <account>:<pilot>` undocks two pilots, warps both and prints what each sees: run it for two
  of one account and for two of two before blaming anything else. This server still lets both
  fly; Tranquility closes the first, and that is the operator's to decide.
- **A hosted pilot's scene is read without taking the pilot**: `GET
  /api/bots/observation?characterID=` with a web session of the account that owns it, and `GET
  /api/bots` for the account's bots, each with its `jettisonCustody` (`mo-observe.js`).
- **A refusal that has one sentence for many causes is found with a line of the source**, for
  one run: the cause's code and words written to the BFF's error output where the refusal is
  made, the BFF started again, the run made, the line read, and the file put back (`git
  checkout -- <file>` only when the line is the file's one change; `git diff --stat` first).
  Nothing of it is committed.
- **Git Bash rewrites an argument that begins with a slash**: `"/tr me 60000004"` reached the
  GM route as `C:/Program Files/Git/tr me 60000004`. Put `MSYS_NO_PATHCONV=1` before the
  command, and then write every path argument Windows-style (`C:/...`), since it stops that
  rewriting too.
- **A Mining Operation's scripts, for a run**: `mo-stage.js` (stages two pilots and the
  corporation's two fittings; between `store.sh save` and `restore`), `mo-pieces.js` (the look
  after it), `mo-plan.mjs save|plan|list|delete` and `mo-run.mjs start|watch|stop` (the page's
  own askers loaded by `import()` of `web/src/app/api.ts`, with `{ baseUrl, token }`),
  `mo-logs.js` (each bot's actions with their results, the BFF's errors, the ledger by status).
  With the ore hold staged at 84 of 100, a run jettisons three and a half minutes after its
  start, the hauler takes the can at six and unloads at eight. A hauler delivers only when
  nine tenths full: give it a hold one can fills.
- **The Mining Command Center is a page of its own**, `/mining-command-center`, signed in by an
  account's name alone and with no pilot. Its Start and Delete ask with the browser's own box
  (`window.confirm` stood in beforehand). Its table shows a bot's phase, read at the page's own
  pace: a step of a few seconds falls between two reads.
- **CCP's destiny has tests of its own for each mode** (`destiny/python/destiny/test/ballpark/
  evolve/test_<mode>.py`, and `test_movement_controls.py` for the orders): carry them over
  before writing any other, and say which could not be and why.
- **Tranquility's ballpark states can be read out of the recordings.** michelle logs every
  entry as `Action: <name> <stamp> - current: <tick> (<args>)`, and an `AddBalls2`'s first
  argument is the state as a Python string. `ml-blob.js <repo> <recording> [n]` reads them
  with the port's own reader and prints the balls of a mode; `ml-fixture.js <repo> <folder>
  [<fixture>]` counts them by kind and writes a fixture of the bytes as hex. A claim about
  what the server's park holds can be checked over every recorded ball in one script (502
  missiles: each one's goto its velocity made one long and multiplied by 1e16, to the bit).
- **A park that has stopped says so in the BFF's error output**, once a frame (`bffgp.err.log`:
  `ballpark tick failed`), and an entry it could not apply once by name (`ballpark entry <name>
  failed`). Count the distinct lines after any live check in space.
- **A hostile for a live check**: `/npc 1 guristas` beside the pilot's ship, away from a
  station's guns (a belt). It brings a battleship with torpedoes or a cruiser with heavy
  missiles, and a belt may add a rat of its own: a Badger's shield lasts under a minute.
  `ml-live.js <bff> <account> <pilot> <belt> <seconds> "<GM command>"` flies there, runs the
  command and prints the scene every second (the park's tick, the pilot's health, each
  hostile's distance, each charge's distance and speed).
- **A real missile is at its speed within half a millisecond** (mass 100, agility 5.2), so a
  knock it takes is undone inside the tick and a test of what turns one sees nothing. Fly a
  sluggish one, and beside it an ordinary ball that is turned.
- **The pilot workspace in the tab, by its own controls**: a pilot's row
  (`.hangar-row.is-clickable`) selects it, "Bring online" brings it on; "Undock"; an overview
  row is a button, and once it is pressed "Warp to" is one; the GM console is in the Settings
  window (the text field whose placeholder begins `/giveitem`, then "Run command"), and
  "Ship" in the same row of names goes back to the ship and its overview. Each press in a
  call of its own, read in the next.
- **Text for a test file is written to a scratch file and appended by a script**, never by a
  shell's here-document: a backtick or a quote in it ends the document early.
- **A route that answers a refusal with a code and a sentence of its own may be dropping the
  cause's.** Look for a catch that keeps `error.code` and not `error.message`, and for an
  error class in the page with one sentence for every code. A hosted bot's log is the code and
  the error's words and nothing else; a refusal that cannot be told from another there costs
  a run to find. The custody's now say which check failed (`src/jettisonCustody.js`).
- **A refusal is proven live where it still happens.** The gateway's BFF (26511) still refuses
  a hosted miner's jettison, its scene's ship naming nobody: the staged copy of the mining
  operation (`store.sh restore mo-staged`) runs on either BFF, since `mo-plan.mjs` and
  `mo-run.mjs` take the BFF's address, and each BFF keeps its bots' logs in its own data
  folder (`bffgw-data/bot-logs`, `bffgp-data/bot-logs`; `mo-logs.js` reads either).
- **A breakage of your own that survives may be saying what the test expects.** Read what it
  makes the code say before calling the test weak: a fallback in the breakage itself ("is not
  ore") was the very words the one case looked for.
- **What the page is sent can be read off the tab's own socket, beside what it shows.** The
  page's askers do not go through `window.fetch` (a wrapper there sees nothing) and each pilot's
  token is kept in memory, so a script in the page cannot ask for the scene itself. Wrap
  `WebSocket.prototype.send`: at the socket's next send, add a `message` listener to it and look
  in each frame for an `entities` list. One recording then has the scene and the page's own
  rows second by second. A reload takes the wrapper away.
- **A pilot is held in the tab from the Pilots hangar**: press its row (which only selects it)
  and then "Bring online ▶". A pilot a script left in space and logged out is where it was, its
  rat still firing, so one staging serves a script on one BFF and then the tab on the other, one
  transport at a time.
- **What the client draws a thing as, and what its overview can list, are two tables.**
  `spaceObject/repository.py` (a class by group, and a Missile for every group its data marks
  "fittable non-singleton") and `parklife/tacticalConst.py` (the groups an overview is made
  of). The client's own groups table is read with its loader (`scripts/client-built-data.py`,
  `groupsLoader`; `cg-groups.js` in session 2e7ceba2's scratchpad sets it beside the BFF's data).
- **When the client asks at all is in the callers above the call.** The ledger judges a call's
  form. Whether the client would make it is in what stands between the button and the
  `RemoteSvc` line: read every `return` on the way down (for the survey scan: the command, in
  space; the overlay's controller, not in warp and no wave playing; the service, the ship's
  upgrade from godma; the throttle).
- **An attribute the client reads from godma is the game port's to read**:
  `gamePortPilots.shipAttribute(attributeID, { userid }, bridgeSessionID)`, whose null is the
  client's "godma has none". A route held to it is tested by the page's own asker over a
  transport that answers the attribute: `test/pagesSurveyScan.test.js` is the smallest model
  (a held row in `bridgeSessionStore`, a handle that begins `gp:`, and `pilotTransportFor`).
- **Which types carry an attribute, and what gives a ship one**: `ss-types.js <repo>` reads
  every type's dogma of the BFF's static data for an attribute and prints the effects of the
  modules that have it; an effect's `modifierInfo` says what it does to the ship.
- **A bot's "once and never again" wants the bot's clock turned.** In the 150 ms a flow test
  waits, a bot looks once. `context.mock.timers.enable({ apis: ["setTimeout"] })`, a tick of
  2000 and twenty turns of `setImmediate`, six times over, is six looks
  (`web/src/app/botApproachFlow.test.ts` is the model).
- **A belt may have rats of its own.** A staged miner in a bare Venture was destroyed two
  minutes into a run by two native rats, where no earlier run met any. A live run that must
  reach its jettison wants looking at the grid's hostiles first (`ml-live.js` prints them), and
  a run that is cut short is said so in the entry, with what it did reach.
- **The BFF's ledger is written a little after a call.** Read `call-ledger.json` at the end of
  a run, not a second after the call it is read for.
- **What the server does on purpose for the client's eye is sized and left.** Where the
  server's own comments say what was seen in the retail client, and a recording says
  Tranquility does otherwise, the entry sets the two measures beside each other with what a
  change would need and what the choice costs meanwhile, and nothing is changed: the proof of
  such a change is a picture this loop cannot look at. (The missile's lifecycle, 2026-10-12.)
- **A missile of the recordings and of this server, measured the same way**: `ms-size.js
  <recordings>` (every `LaunchMissile` to its `RemoveBalls`, the terminal entry and the
  target's damage state by their stamps) and `ms-evejs.js <eve.js _local/logs> <characterID>
  <from HH:MM:SS>` (the same of `space-destiny-debug.log`). A recording's `Action:` name is
  cut at twelve letters (`LaunchMissil`, `TerminalPlay`); a `DoDestinyUpdate` line has every
  entry with its stamp.
- **`TerminalPlayDestructionEffect(id, None)` is an explosion to the client**
  (`michelle.py` 1205): None is not "none", and nought is.
- **The server's destiny log is added to across its restarts, and the numbers of its missiles
  and its rats begin again at each.** A reader that goes by a number alone joins one run's
  launch to another's removal: begin a new thing at each launch, and read from a time.
- **`/npc 1 guristas` brings a different rat each time** (light missiles from 35 km once,
  rockets and a laser from 7 km the next). Read what came, and what it fires, before a
  measure of damage is believed: with a turret firing, a damage state belongs to no missile.
- **A recording of the very thing is looked for by its name first.** `ls` the recordings'
  folder and its `Archive` before reading the client's code for what the server sends:
  `Getting Killed to POD.txt` and `Eject from Ship and Board ship.txt` were there all along.
  `sl-calls.js <recording>` lists every call the client made, in order, with each session
  change of the ship; the park's actions are the `Action:` lines.
- **What the client changes by itself at a session change is in gameui**
  (`parklife/gameui.py`: `_HandleSessionChangeInSpace`, `InStation`, `InStructure`), not in
  the service whose state it is. michelle's park takes its ego from a whole state alone; it is
  gameui that makes another ship the ego, and that asks for the targets to be cleared.
- **A ship is lost with nobody's hand on its session** by `sl-rats.js`: a second pilot brings
  the rats to the belt and leaves, and they turn to who is left. That is how a loss is seen in
  the tab, where the pilot's own session cannot be asked for a GM's command. `sl-live.js` loses
  one by script and prints what the flight status, the Fitting read and a bot's observation
  say as it goes (`AFTER_MS` for a longer look after).
- **A route that reads the flight for a guard of its own must not be made to adopt what it
  reads.** Six tests of other routes failed when every read of the flight took the new ship,
  and they were right: each refuses a request made for a ship the pilot is no longer in. What
  follows the server's own change belongs to the read the page makes to learn it.
- **Keep a live run's whole output, and filter the file.** A filter on the lines as they came
  dropped every line after the loss, because the thing looked for had the value filtered on.
- **A recording's call is read by its line.** A `Packet::CallReq` line has the service it was
  addressed to and, for a call by name, the method and its arguments in plain text
  (`sed -n "<line>p" <recording>`): `(1, 'MachoBindObject', ((30004971, 5), ('GetAllInfo',
  (False, True, None), {})), {'machoVersion': 1})`. A call on a bound object is bytes: the
  object's name, the method, `$` for an empty tuple, and the keywords.
- **A form counted across every recording settles what the client sends**:
  `grep -rhoE "'<Method>', \([^)]*\)" <recordings> | sort | uniq -c`. Godma's priming was
  `(True, True, None)` in the BFF and in its entry's note; the recordings have it so 4 times
  in 164.
- **A test that puts a pilot in space wants a ballpark whose clock the test holds**
  (`handTicked().options`): a real one keeps the file from ending, and the run is cut off with
  every test passed and the file failed.
- **A slip of the client's own is followed, not mended.** Its target manager asks whether
  `'ship' in change`, which no session change has, so it never clears its locks at a change of
  ship by itself; gameui asks the server to, and that is the call the game port makes.
- **The client's own log has the server's answers.** A `MethodCalls` line of a recording,
  `dogmaIM::MachoBindObject args=(...), retval=(<RemoteObject:...>, <KeyVal: {...}>)`, has
  Tranquility's answer whole (`grep -n "<Method>', (<args>), {})), retval" <recording>`). What
  the server sends is read there, and set beside what this server sends
  (`scripts/record-godma-priming.js` prints the shape of each of its answers).
- **This server's handler may already tell the client's forms apart.** Read it before the
  BFF's form is kept or changed: `GetAllInfo`'s takes its three arguments as the client means
  them and has an arm for the client's later form docked, which the BFF's own form never
  reached. Its notes are its authors', with what they saw: a "DO NOT" there is theirs to lift.
- **A fixture of the server's answers has its recorder beside it**, as the dogma fixtures have:
  a login, a choosing, the bound call in each form, an undock and a docking
  (`scripts/record-godma-priming.js` is the smallest). `answers(fixture)`
  (`test/helpers/destinyRecording.js`) reads them by the step each was asked in. Record with a
  test account, between a copy of the store and its putting back.
- **A regular expression written through a shell's here-document loses its backslashes.**
  Write that line of a test with the Edit tool, or look for the words with `includes`.
- **Two requests of the same call at a login may be one call.** The first call of a service
  goes to `Address::Any(service=...)`, is answered with an `ErrorResponse`, and is sent again
  to `Address::Node(...)`. Count a recording's calls by their answers
  (`grep -ac "<service>::<Method> args=" <recording>`), not by their requests.
- **A stand-in that leaves a name out of a session change hides what goes by that name.** The
  pilots' stand-in changed the session at a choosing without the ship, where the server's
  change has it; a guard for "the choosing's own change" could not be broken by any test until
  it did. Read the server's own change in a recording (`grep -a "ProcessSessionChange:  {"`).
- **A call the game port begins to make at a login is shown in the login's report**, made
  again in two steps (above: `login-only.js`, `login-report.js`, in session 2aba99c0's
  scratchpad), and the report is committed with the unit's docs. A call that is not on the
  gateway's list is added to `GAME_PORT_ONLY_CALLS` beside its entry, and a test pins that
  list whole.
- **The server is stopped without `/F`, at the loop's end as in a check.** On 2026-10-12, told
  to stop everything, the loop killed EveJS with `taskkill /T /F`; the store had been put back
  five minutes before, and the next start is to put it back again (`store.sh restore fg-before`),
  which is all that makes that harmless. `store.sh`'s own stop waits for the server to go.
- **A recorded line may be cut short, and what is cut is not left out.** The
  client's "MethodCalls" lines stop at about 2,600 characters. Of 82 logged
  answers to `GetAllInfo`, 80 stop inside `shipInfo`, before three keys that
  the two whole answers have. A note in the server and two of its tests held
  those keys' values None for three months on the cut lines. Before saying a
  recorded answer has not something: measure the line (`awk '{print
  length}'`), read its end, and look for an answer short enough to be whole
  (a capsule's).
- **A note that says DO NOT is read for its ground.** The server's note
  forbade leaving three keys out, and was right (the client raises); its
  ground, that the captures leave them out, was the cut lines. The warning is
  kept and still tested; the mending went by the evidence.
- **The loop's shell scripts are run without `MSYS_NO_PATHCONV=1`.** Under it
  `taskkill //PID` and `tasklist //FI` are handed as they stand and fail
  without a word: `store.sh` took a running server for stopped, copied the
  store from under it and started a second. It refuses now while anything
  listens on 26000. A node script given a `C:/` path is the thing that
  wants the setting.
- **A red in `eve.js` is compared on the unchanged sources before it is
  anyone's.** Copy the edits aside, write the committed files back
  (`git show HEAD:<file> > <file>`), run, and put the edits back (`cmp`).
  Three reds of this unit's runs were there without it: a test that fails
  one run in five, and two files red before.
- **The client's log prints what its own functions were handed.** Beside the
  "MethodCalls" lines, which are cut at about 2,600 characters, it has "PAT:
  Wrap: Enter <function> with self= ... args= (...)" lines for some of the
  client's own functions. "Enter MakeShipActive with" has the ship's state of
  every priming: 83 of them, where two of the 82 answers' own lines were
  whole. Before a cut line is taken for the end of the evidence, `grep` the
  recordings for the thing's own form (a row's columns) and for the function
  the client hands it to.
- **What a store keeps and what a client is told may be in different units.**
  This server keeps a ship's condition as fractions and sent them in a row
  the client reads as amounts. Read both ends before a number is called
  right: what the store's own name for it means, and what the client's table
  says the column is (`dgmAttributesByIdx`).
- **A patch that adds a name looks for the name first.** A patch script
  checks that each text it replaces is there once; it does not check what it
  adds. One added a `const` the file already declared sixty lines on, and the
  service would not load. `grep -n "const <NAME>\b"` before a constant is
  added; and load the module after every patch, before any test.
- **The client's "Enter <function>" lines are whole.** Where its
  "MethodCalls" lines stop at about 2,600 characters, the longest "Enter
  MakeShipActive with" line is 24,607: every row of every state is there.
- **A recorded print tells a number's kind.** Tranquility's
  `(0.0, 100.0, 0, 1.0, 0.01)` is four floats and an integer. This server
  sends a whole number as an integer unless it is marked a real
  (`{ type: "real", value }`), so a constant written `100.0` in its source
  went out as the integer 100.
- **What a recorded line answers is read before it is used.** The one state
  with heat left in a rack was a docked ship's: the call it answers, some
  eight hundred lines above it, is bound for a station. Read as a thing of
  space it would have been mended in the wrong place.
- **The client's godma prints every item it loads, whole.** "godma
  UpdateItem:" lines have the item's row and all its attributes (1,059 in the
  recordings, 79 of ships, 11 of structures, the longest 2,192 characters).
  Where a `GetAllInfo` answer's line is cut inside `shipInfo`, the line
  after it has the ship: `grep -rha "godma.UpdateItem: " <recordings>`.
- **A breakage that no test catches is read before a test is written for
  it.** A write of a ship's heat at its pilot's leaving the scene was taken
  out and every test still passed: not for want of a test, but because the
  write did nothing (taking an entity out of a scene persists it already).
  The code was taken out, not a test added.
- **A decoded number does not say what it was on the wire.** The game port's
  decoder gives a number for an integer and for a float alike. What this
  server sent is read from the frame's bytes: a dict's value comes before
  its key, a float is 0x0a and eight bytes (0x0b for 0.0), an integer 0x08,
  0x09, 0x06, 0x05 or 0x04.
- **A server test run while the store is staged reads the staging.** The
  isolated runner copies the live store. A test of a cold docked ship read
  11.2 in a rack: the store had a ship staged warm for the live look. The
  store is put back before any server test is run, and the live look made
  again afterwards if it is still wanted.
- **A thing that changes with the time wants a test whose clock moves.** A
  docked answer cooled a stored heat to the time of each reading: its two
  places differed by the milliseconds between them, and a cache went on
  serving the first. The test had a clock that stood still and one answer,
  and passed; the live look read two answers and showed both. Its clock now
  moves on at every reading, and it asks twice.
- **Before a move, a test that the moved code is run by.** A rack's cooling
  was about to be moved and no test noticed it gone: two breakages of it
  passed three test files. A test of the cooling was written and committed
  first, and the move after it.
- **A value made a float for the wire is an object to everything else.**
  `{ type: "real", value }` is how this server sends a whole number as a
  float, and the web gateway makes JSON of an answer as it stands: the
  browser reads attribute values with `typeof value === "number"`. Where
  only the wire is to change, the marshaller is given a mark instead (a
  dict's `realValues: true`), and the values stay the numbers they were.
- **A test that passes with its part broken may be reading another part.**
  With a structure's mark taken away one test of a controlled structure
  still passed: it read the structure's entry in `structureInfo`, which is
  built elsewhere. The breakage that is not caught says which place has no
  test; the place is read before the test is written.
- **What a thing lists and what kind its values are, are two differences.**
  A module's attribute values were to be made floats; the tally that showed
  which stay integers showed also that Tranquility lists a module's charge
  and this server does not. One is mended and the other is put on the list
  by name, with its tally, and not folded into the first.
- **Where many send one thing, it is mended where it leaves.** Eleven
  places send the notice of a changed attribute, and each transport has one
  place where a notification goes out: the game's own session marshals it
  (`ClientSession.sendNotification`), the web gateway's keeps it as JSON.
  What only the wire is to have is made there, in a copy.
- **A stand-in first, where the thing to be written is a new file.** A test
  of a module that is not there fails for the missing file and says nothing.
  The module was written first handing its argument back, the tests run
  (three failed for what they say, two passed that say what is left alone),
  and then it was written.
- **No look at the live server while the server's tests run.** A test file
  copies the live store as it begins; a pilot logged in and out then is a
  write under the copy. The look waits for the run to end.
- **Where Tranquility has two forms, this server's being one of them is no
  defect.** A module's online flag and damage are listed as nought here;
  Tranquility lists nought for a module that was online or damaged once, and
  nothing for one that never was. The commoner form is not the only right
  one: what tells them apart is read first (here the client's own
  `baseDogmaItem.Load`), and where this server cannot know it the thing is
  left and said to be left.
- **A reader that says "unsure" is followed, not rounded.** Six of a
  character's attributes were in both forms in the bytes of one answer: this
  server's first answer carried the character's attributes twice (its item,
  and `shipModifiedCharAttribs`), and only one had been mended. A reader of
  bytes names what it cannot tell, and a thing an answer has twice is read
  twice.
- **Who prints a log line is read in the client's code before the line is
  evidence.** "UpdateAttributeIDs" lines are printed by
  `RefreshItemAttributes`, which godma's `UpdateItem` calls for every item
  it loads: a run of them after an item is that item's loading. On
  2026-10-13 such runs were taken for the refresh from
  `shipModifiedCharAttribs`, a mend was built on it, and it was taken back
  a unit later: there was one run after each item where the claim wanted
  two. Count what a claim predicts. And a field of an answer is looked for
  by its own name first: `GetAllInfo`'s "MethodCalls" line is cut at about
  2,600 characters, but its first fields (`systemWideEffectsOnShip`,
  `shipModifiedCharAttribs`) are whole in every one
  (`allinfo-recorded.js`).
- **A breakage that no test catches is a test to write or a line to take
  out.** Five things read alike are each given a value of their own in a
  test, or two of them crossed pass it; and a guard that every test passes
  without is taken out, not tested into staying.
- **A mend found between a copy of the store and its putting back waits for
  the putting back.** The store is put back, the server's tests are run, and
  the store is copied again for the recording: twice the restarts, and no
  test on a staged store.
- **An attribute that is not listed is read as its default** (godma's
  `GetAttribute`, and the dogma location's `itemAttributeFactory`). So
  what a type has may not be left out of an item, and what it has not may be
  where it holds the default: that is how Tranquility's character lists 68
  and no more.
- **A test with nobody in it finds what a pilot hides.** A character that is
  in no store has no industry figures, and the reckoning of them is no
  number; a real pilot never shows it. A value is laid over another only
  where it is a number.
- **An older test that asks for what Tranquility does not send is read to
  its reason and rewritten to ask for that**: here the value a client would
  read of an attribute, not the attribute's being listed.
- **Tranquility's own number, asked of this server, is the sharpest test
  there is.** Where a recording has a reckoned value and what it was reckoned
  from, fit the same and ask for the same digits. A line cut short may be
  made up from another kind of line: godma's "UpdateItem:" lines have every
  module of a ship that a "MethodCalls" line stops short of, and
  `allinfo-by-file.js` sets each recorded answer beside its ship.
- **The end of every chain of modifiers is rounded to six places here**
  (`applyModifierGroups` in `fitting/liveFittingState.js`), and Tranquility's
  is not: its `1.1804337950307635` is `1.180434` on this server. The
  rounding is the operator's decision (`3a4ff978c`, with a note not to
  remove it without the owner's word), so this loop does not touch it: a
  test of a recorded value asks for the six places and says why, and the
  difference is written for the operator. A note in the code that says whose
  decision a thing is, is that decision.
- **What one carrier carried is moved to the right one before the first is
  put right.** The character's attributes went in the second dict; the item
  was made whole first, and the dict given Tranquility's form after, so that
  no client was ever short of its character. The older tests of the first
  carrier are each rewritten to what they were written for.
- **A change of form on this server's wire is a change for every reader of
  the gateway's JSON.** The game port reads a sequence by its items, list or
  tuple; the page on the gateway reads the JSON's own shape, where a tuple
  is an array and a list an object with items. Before a tuple is made a list
  (or a set) in `eve.js`: find the page's and the BFF's readers of that
  answer and that notice, mend them to read either, commit that first; and
  open every test file a search for the name lists, for each has an
  expectation of the old form.
- **A log's printing of a marshal stream can be read back.** The client's
  "Read:" lines print a notice's bytes as Python prints a string;
  `stream-recorded.js <game port> <recordings> <notice>` makes them bytes
  again and decodes them. A Python set is an object of `__builtin__.set`
  made of one list, which is what this server's `buildPythonSet` makes.
- **A live look at a form on the wire is two small scripts away**:
  `guests-live.js` (two docked pilots, one watching the other come and go)
  and `flags-live.js` (a pilot made a suspect by `/cwatch`) say of each
  sequence whether it is a list, a tuple or an object; the pattern serves
  any answer or notice a second pilot or a GM command can raise.
- **A long has two spellings through the web gateway.** A bare BigInt in a
  handler's answer goes to the page as a string of digits; this server's
  wire long (`{ type: "long", value }`) goes with its type, and is what
  the page's and the BFF's readers of a long take. Both are a long on the
  game's own wire. An answer that the page reads is made a wire long; a
  value in a notice that no reader takes may be a bare BigInt, which the
  server's own tests read with `Number()`.
- **An answer on a bound object is in the packets, not in a "MethodCalls"
  line.** The call's "Write: Packet::CallReq" has its callID and the
  method's name in the bytes; the "Read: Packet::CallRsp" with that callID
  has the answer's bytes, which may come after the notices the call raised
  (`\x01` is None; `/\x03...` a long of three bytes).
- **Who is sent a notice is in its address**: by `stationid` the sessions
  in those stations, by `corpid` those corporations' (the client's own
  `machoNet.py`, `FindClientsAndHoles`). A sender here that sends "to all
  sessions" under such an address is read for whether it should.
  `office-live.js` shows the pattern for seeing it: an actor and a watcher
  who shares one of the two and not the other.
- **A harness scenario that is red is measured before it is blamed**: the
  unit's own source files put as they were (copied aside, put back,
  compared), and the scenario run again. Two were red before the units that
  met them; they are on the Next list to be read, not on this loop's
  account.
- **Some harness scenarios are red on the tree as it stands** (2026-10-13:
  crimewatch's CONCORD, the office's home station reset, the container's
  second jettison, the tractor beam's parking, the customs officers'
  surrender; the AIR mining file times out). None is on the list of known
  reds, and each was red with this loop's change taken out. Other sessions'
  uncommitted files are in the tree. So a harness scenario's red is no word
  on a unit until it has been run with the unit's own source files put as
  they were; and it is written for the operator, not chased through files
  that are another's.
- **A tolerant reader makes a change of form free.** The BFF's route and the
  page's decoder of a jettison read a list or an array at each level, and
  the server's change needed nothing of either. A reader written for one
  form (the guests' decoder, an office's price) is the one that has to be
  mended first. New readers of an answer's sequences take both.
- **A notice the client lives by and no recording has is read before it is
  sent**: when the thing it tells of changes here, to whom, and by what
  address. `OnSubscriptionChangedServer` is such a one.
- **Sizing a notice that is not recorded, count its siblings that are.**
  `OnSubscriptionChangedServer` is in no recording; a count of every
  recorded broadcast by its name and idtype (one grep over every folder)
  showed `OnSubscriptionTimeUpdateServer` seven times, which this server
  did not send either, and gave the first its address. The count is cheap,
  and is made before a decision is taken in a recording's place.
- **A guard no input reaches is taken out, not tested around.** A notifier
  that compares before and after needs no check for a replay: a replay
  changes nothing. Ask of each `if` what input reaches it, before the
  breakages do.
- **Nothing is run against the live store outside the test runner**, a
  one-line look at the tests' fixtures included (2026-10-13: the store
  refused a reader's write; it need not have). The fixtures' identities are
  read in `_shared/fixtureIdentities.js`, and in a test by
  `installCoreFixtures`.
- **A server wanted with a setting changed for a look** is started so by
  the store's own script (`EVEJS_OMEGA_LICENSE=false bash store.sh save
  <label>`): the setting is that server's alone, and the putting back
  starts the next without it.
- **An outgoing packet's line in `server.log` once carried the time of the
  line after it** (until `eve.js` `13b3507ea`, 2026-10-13): the logger holds
  the last `[PKT] OUT` line back to count repeats, and stamped it when it
  wrote it. A log written before that commit is not a measure of when a
  packet went out. A client's own frame clock is (`sub-live.js`,
  `lapse-live.js`: every frame kept with its time). A held line still
  stands under the debug lines logged after it; its own time says where it
  belongs.
- **A test's stand-in for the process's output can swallow the runner's
  report.** A helper that passed on only the lines that did not quote the
  test's own text hid three failing tests: the runner's report of a failure
  quotes what failed. The count of tests the runner prints is read against
  the count written, each time a file is new.
- **A thing that happens at a time is staged by moving the time in the
  store**, with EveJS stopped, between a copy of the store and its putting
  back (`lapse-stage.sh`, after `ecu-expire.sh`): a row is read on a
  saved copy first (`store-rows.js`), to know its key and its form.
- **A second pilot on the BFF beside a session of one's own** shows both
  ends of a notice in one look: the wire, with its times, and what the
  transport keeps of it. Two accounts were staged alike for it.
- **A notice is counted by its `Read:` lines.** A notice that waits for a
  session change is logged again as `packet=`, and each is scattered once
  more: a count of the name alone gave 75 `OnTaleData` where 36 were read.
- **What goes before a notice says what sends it.** For every recorded
  `OnTaleData`: the last session change before it, how many packets back,
  and the calls written before it (`tale-recorded.js`); then the other way,
  every session change of the kind and whether the notice follows
  (`tale-changes.js`). 19 of 20 is a rule; one login is a guess. The one
  that does not follow is read too: it was a system with nothing to send.
- **Before a recorded notice is mended, the client's reader of it is read
  for a guard.** The fitting's events ahead of a docked login are dropped:
  godma returns where `session.charid` is None, and the notice comes ahead
  of the session change that sets it. The recording says so itself
  (`OnAttributes` with an empty list).
- **A model of the operator's that a recording contradicts is mended to the
  recording, and its scenario rewritten; a device of the operator's with a
  commit that says what it is for is left** and written down as a
  difference (the skills primed at a login, `c6ea2ff44`; the six places).
- **`/solar <system's ID>`** moves a pilot in space to a system for a look
  (`tale-live.js`); a session change of `solarsystemid2` follows it.
- **The BFF's own bytes are seen with the recorder between it and EveJS.**
  `node scripts/record-game-port.js record 26006 26000 <file>` in the
  background, the game port's BFF restarted with `EVEJS_GAME_PORT=26006`
  (`EVEJS_GAME_PORT=26006 bash restart-bffgp.sh`), the look made, the
  recorder stopped and the BFF restarted plainly. `price-frames.js` prints
  the bytes after a method's name. The server's log cannot tell a long
  from an int: its decoder reads blue's long as a plain number.
- **The client's own bytes of a call are in a recording's `Write:` line**
  (`<MarshalStream '...'>`), opcodes and all: `%` a tuple of one, `/` a
  long, `\x04` an int of 32 bits. A form is compared byte for byte with
  it, not by the value it decodes to.
- **A value the client hands back keeps its Python type; the page's JSON
  does not, for a small long.** The transport names the answers that are
  handed back (`pilots.js`, `HANDED_BACK_AS_ANSWERED`) and hands the page
  those with the long kept. One found is added there, with its line of the
  client's code.
- **A breakage that nothing catches says what test is missing**, not that
  the line is idle: "every call's answer keeps its long" passed until a
  test held another call's long to a number.
- **A look at the game's own data is made in the server's test runner**: a
  scratch test file under `server/tests`, run by
  `run-isolated-tests.js`, printed from and deleted (the safe systems and
  their stations were found so). It reads the static data with a copy of
  the store, and touches nothing live.
- **Several fixes in one file's tests are split by a script that takes a
  part's name** (`ind-part.js`): each commit carries its own tests, and a
  test is watched to fail on the thing itself, after what it calls is
  exported, not on the missing export.
- **A breakage that changes nothing is said to be none**, with the reason: a
  system that is not known reads as a security of nought whichever way the
  comparison is written. It is not counted as caught.
- **Doubles are held to the client's own double**, not to the rounded
  amount: a test of every blueprint by `Object.is` tells an order of
  multiplying from another in thousands of cases, where the rounded amounts
  part in two of the game's.
- **A pilot is put in a station by `/tr me <stationID>`**, a blueprint and
  its materials by `/bpauto seed <name> <runs> copy` (`mat-live.js`), the
  skills by `/allskills`: a job can then be installed through the BFF
  (`sectax-live.js`).
- **The breakage runners copy aside every file the breaks script names**
  (`break-run.sh`, `web-break-run.sh`, since 2026-10-13), before each
  breakage, and put every one back after it. Until then the one file was
  found by the breakage's name, and a name that ends another's
  ("nosession", "servicenosession") had the wrong file copied and the
  broken one left broken. The line the runner prints for a breakage names
  the file it changed: read it each time, and read the source's whole
  change against the commit before it is committed.
- **A red file is measured before a cause is written anywhere, the source
  included.** Two files red beside this unit's were taken for an import
  cycle and a require moved with a comment saying so; with the unit's files
  put as committed they were red the same. The changed files are copied
  aside, put as `git show HEAD:<file>` has them, the test run, and the
  copies put back and compared.
- **A test that stands in for a module can go stale without a word**:
  `repackagingSupport`'s stand-in for the shared helpers lacks a helper
  the source began to call a fortnight after the test was written. "X is
  not a function" in a test that loads its subject through the module
  loader is read in the test's own stand-ins first.
- **A notice that changes what the transport keeps is taken where the
  client takes it.** The transport answers a monitor's second asking from
  its first answer; the server's notice of the materials had to go into
  that kept answer, or the server's telling would have reached nobody. Each
  thing the transport keeps is listed with the notice that changes it.
- **The browser pane has no size, and the page is in its one-panel layout
  there**, where one panel replaces another. Size it (`resize_window`, 1500
  by 950) and send the window a `resize` event by hand (the sizing alone
  sends none): the page is then its desktop, and two windows are open at
  once. So a change can be staged from the page's own GM console
  (Settings) while the window under look stays open. The page's session is
  in memory only: a bare `fetch` from the pane is refused, and the page's
  own calls are not `window.fetch`'s.
- **This hour's `server.log` has the server tests' lines in it** (each
  test process writes "role=standalone ... acquired persistence owner",
  and its own `[ERR]` lines). The live server's starts are the lines with
  "role=world": an error line is the live server's only between one of
  those and the next.
- **A row of the skill history is staged by training**, with the server
  started fast: `EVEJS_SKILL_TRAINING_SPEED=200 bash store.sh save
  <label>` (a level of a rank-1 skill in seconds; the putting back starts
  the server at the usual speed). The pilot wants a skill whose next level
  has its requirements: Test Two has many, Test Pilot's one has not. No GM
  command gives free points.
- **What an answer does NOT have is read from several recordings laid end
  to end.** Three logins' ten newest rows of one pilot's history overlap
  into eighteen rows one after the other, and it is that run which shows
  no row of a start: one answer of ten could not.
- **A recorded answer is set beside this server's own building of it**
  (`hist-same.js` is the pattern, and loads nothing of the store): the
  recorded bytes decoded, the same rows given to the server's builder,
  encoded and decoded. The object, the descriptor and each row's packed
  bytes are compared; the whole answer's bytes differ for every rowset
  (the Next list's (4b)).
- **The two transports hand a packed row on in two shapes**: the game
  port's with `fields` by name and a long for a date, the gateway's with
  `values` by place and a string of digits. A reader of the page's takes
  a row by `readRowField`, and is run on both running BFFs' answers
  (`hist-decode.mjs` is the pattern).
- **Where the client shows a thing is read before it is built**: the
  skill history is in the character sheet's History panel, not in the
  skills window the Next list had named. `grep -rn "<the panel's class>"`
  in the client finds who makes it.
- **The client's words come by their labels from the player's install**
  (`flow.requestWords`, `$words.templates`), a date's form among them
  (`FmtDate(date, 'ls')` is the label
  `/Carbon/UI/Common/DateTime/DateLongShort` with `datetime`,
  `formatTemplate`). A window that shows the client's word and the page's
  own stand-in differently proves which it has: "Skill Training Canceled"
  was the install's, "Training stopped" the page's.
- **A read the page makes for itself is tried on both running BFFs before
  it is built on** (`ask-live.js <service.method>[=<file>]`, the generic
  call with no arguments): that the pair is allowed on each, and the answer
  kept for the reader to be run on.
- **The origin of `eve.js` is read at a unit's end as at its start.** On
  2026-10-13 it moved between the two, "by push", with fifty-two of this
  loop's commits, and this loop had pushed nothing: what the log says of
  it is what `git ls-remote` and `git reflog show origin/main` say then.
- **A node script given an argument that begins with a slash is run with
  `MSYS_NO_PATHCONV=1`**: without it the shell makes a path of the
  argument ("/npc 1 guristas" became a path under the shell's own folder,
  the server answered COMMAND_INVALID, and a pilot sat at a belt for 70
  seconds with no hostile). The loop's `.sh` scripts are still run
  without it.
- **A recording of the BFF's own game port, for a measure**: the recorder
  started in the background (`node scripts/record-game-port.js record
  26006 26000 <file>`), the BFF started at it (`EVEJS_GAME_PORT=26006
  bash restart-bffgp.sh`), the flight flown, the BFF restarted plainly,
  and then the recorder's process stopped by its pid (the listener on
  26006). The recording's frames are by connection; the pilot's is the one
  with ballpark updates.
- **Tranquility's whole states are cut by the client's logger at 64 KB**
  (`tq-state.js <repo> <recording>` says how many balls of each are left
  and whether the pilot's ship is among them): a recording cannot be
  played through the park from its start. What is whole there: every
  `AddBalls2` of a few balls, and every order by name with its stamp.
- **A pilot chosen in space has no scene for a few seconds**: a script that
  reads the scene at once finds it empty.
- **The server has its own ledger of what is law and what is open**
  (`eve.js` `doc/PARITY_DESTINY_LAWS_AUDIT.md`, `doc/README.md` for the
  rest): it is read before a part of the server is sized, and written to
  when that part is changed. The missile's had, open in its owner's
  words, the very thing this loop had sized without it.
- **The server's missile debug log**: `EVEJS_SPACE_MISSILE_DEBUG_ENABLED=true
  bash store.sh save <label>` starts the server with it
  (`_local/logs/space-missile-debug.log`, one JSON a line: a launch with
  the attacker's and the target's places, each tick, each stamp given a
  session). Copy it aside before the store is put back; the putting back
  starts the server with it off.
- **A client's stamps are this server's raw ones and two more** (a
  launch, a removal; recorded 2026-10-13). What the server reckons in raw
  stamps is set beside a recording with two added.
- **A module ported from CCP's library is set beside this repository's
  port of the same** (`mcb-beside.js` is the pattern, and loads nothing of
  the store): the same case given to both, stepped side by side, the two
  places compared to the bit.
- **Any ball in a client's park can be set beside the server's own
  places for it**: `node scripts/park-against-movement-log.js
  <recording.jsonl> <copy of space-movement-debug.log> --ship=<id>
  [--summary]`. The server's log has an NPC's commands and, for five
  seconds after each, its place at every step. The pilot's own ship, by
  its id, is the control: within a metre.
  `npc-orders.js <repo> <recording.json> <log> <id>` (scratch) lists the
  server's commands and the client's entries for one ball by time.
- **A client's park keeps the server's own stamps.** An entry stamped
  ahead is applied that many seconds after it is sent. A count "from the
  launch" on each side hides a difference of two seconds between the two
  launches: set the two side by side by stamp, not by count.
- **What the server sent, and when by its own clock, is in its missile
  debug log** (`destiny.send-request`: the time, the raw stamp, each
  payload's name and stamp) for the lanes that log there; a ship's prime
  updates (`SetMaxSpeed`) are not among them, and their time is had from
  the recording's arrival times, set to the server's clock by a send that
  is in both.
- **Tranquility's count of an order is one grep**: `grep -rhao
  "Action:\s*<the name's first twelve letters>" <recordings> | sort |
  uniq -c`. michelle's log cuts a name at twelve.
- **A rat that chases, for a measure**: `MSYS_NO_PATHCONV=1 node
  msp-live.js <T> <bff> test2 140000002 75 "/npc 1
  parity_dire_guristas_destructor; wait 6; away 22000"` flies Test Two to
  a belt, brings the rat about 17 km off, and moves the pilot 22 km
  straight away from it (a GM's `/tr me offset=x,y,z`): the rat, then 39
  km off, follows at its chase speed (1,440 m/s), goes back to its cruise
  speed (180) and orbits at 16.5 km, with missiles every 15 seconds. The
  script takes several commands parted by ";", "wait <seconds>" and
  "away <metres>". `/npc 1 guristas` brings a hull of a pool, which may
  not chase; a profile's name is in the server's
  `tools/DatabaseCreator/staticTables/npcProfiles`, and whether it chases
  in `npcBehaviorProfiles` (`useSdeChaseVelocity`).
- **`/invu` makes rats ignore the pilot**: it is not a way to keep a
  ship alive under a rat that is wanted to shoot. A rat 75 km off does
  not see the pilot; 39 km is seen.
- **A change is measured before and after by the same instrument, and a
  try that makes the measure worse is as good as one that mends it**: the
  first stamp tried for an NPC's speed left the ball twice as far off, by
  exactly two of the model's seconds, which said the model was right and
  the stamp wrong.
- **A recording with several logins in it**: the park's tools take the
  connection with the most frames. Keep one flight to a recording, or cut
  the wanted connection's lines out to a file of their own.
- **What the server's delivery did to a stamp is in its own trace.** With
  the missile debug log on (`EVEJS_SPACE_MISSILE_DEBUG_ENABLED=true`),
  each `destiny.emit-group` row has the stamp a group was authored at,
  the scene's stamp, and `restampSteps`: every step's name, the stamp
  before and after, and whether it was applied. The scratch
  `emit-steps.js <missile debug log> <from ms> <name,name>` lists them.
  Read it before saying why an entry came with the stamp it did.
- **A stamp can be tried on an old recording before a line of the server
  is changed**: `scripts/park-against-movement-log.js
  --restamp=<entry>:-1` plays the recording with every update holding
  that entry one stamp sooner.
- **A proof from one quiet flight is of that flight.** With one rat, its
  change of top speed came one stamp after five times of five; with three
  rats the delivery raised it. Fly the busier scene too.
- **The pilot's own ship is not a control that always holds**: it was a
  second out in one flight of four. Look at its first rows
  (`--ship=9988400091900`, no `--summary`) before measuring anything
  against it.
- **The server's debug logs rotate on the hour** (`space-movement-debug.
  <date>_<hour>.log`): a flight across the hour is in two files, and the
  park's tool takes several logs.
- **michelle's "Action … current" line is written as an entry is
  applied**, so its two numbers are the same. The lead at arrival is in
  the history's dump (the reference, "When an entry is applied"; the
  scratch `tq-arrival.js <recordings>` counts it).
- **The recorder's clock is set to the server's** by a frame that follows
  a logged command by a known time (the `WarpTo` after
  `warp.requested`; an NPC's order after its `cmd.` row); the scratch
  `lead-by-name.js <repo> <recording.jsonl> <ms to add>` then counts
  each entry's stamp against the server's as it arrived, and
  `first-updates.js <repo> <recording.jsonl> <how many> [ball]` lists
  them.
- **This server's movement begins on the clock's second** (since
  `eve.js` `ba3422279`; before, a scene with no pilot in it that woke began
  its seconds where the waking fell, and a measure by stamps was out by
  that part of a second). To see when a ball begins to move: the first
  row of a ship's or a rat's movement after an undock or a command (the
  scratch `ego-ticks.js <repo> <recording.jsonl> <movement log> <ball>
  <x,y,z of where it was put>` prints the park's ball tick by tick beside
  the server's rows). To see the cadence itself: the scratch
  `cadence-probe.js <eve.js/server> [wake ms]` calls the server's
  movement controller across a quiet stretch and says where its frames
  fall.
- **An old test that states what a change undoes** is read line by line
  against CCP's code: the lines that state CCP's rule stay, the lines
  that state this server's old way go, and which lines the change makes
  untrue is found by calling the same code from a scratch script (as
  `cadence-probe2.js` does), not by running the test.
- **A pilot brought into space at a chosen part of the second**: the
  scratch `state-live.js <T> <bff> <account> <character> "<undocks:
  ms,ms>" "<logins: ms,ms>"` undocks (docking between), then warps to a
  belt and is chosen in space beside its rats. An undock asked at a part
  of the second has its whole state built 0.11 to 0.21 s later, a
  choosing 0.24 to 0.30 s later; the authority's trace says when, to the
  ms (`emit-steps.js <missile debug log> <from ms> SetState`).
- **The old code beside the new, by the same flight, without a commit**:
  copy the changed file aside, write the committed one in its place
  (`git show HEAD:<path> > <path>`), restart, fly, then copy the changed
  file back and compare it with the copy. Never the other way about (the
  memory "old-code check destroys uncommitted work").
- **The tool's rows with the server's own time on them, inside
  windows**: the scratch `rows-at.js <repo> <recording.jsonl> <log>
  <ball> <from ms-to ms,...> [rows]`: for a ball just after each of
  several whole states. Each login is a connection of its own in a
  recording (`grep '"connection":N,'` into a file).
- **A stamp is measured against the client's own tick too**:
  `scripts/park-tick-against-stamps.js <recording.jsonl>
  [--server-clock=<ms>] [--timeline]` plays a recording through the park
  clocked as the client clocks it and says, by the entry's name, how far
  each stamp was past the park's tick, and how often the park went back,
  asked for a new state, or stepped forward. A change of a stamp is held
  to it as well as to the park's tool for place. The server's clock for a
  recording: the ms into its second that a whole state was built (the
  authority's trace, `emit-steps.js <missile debug log> <from ms>
  SetState`) set against the first update's arrival (`first-updates.js`).
- **Read the client's side of a server's rule before sizing a change to
  it.** The delivery's floors looked like a lag to be removed; the
  client's code and a measure said what they keep from happening.
- **A count before a cause, again**: "the entry four ahead pushed the
  park forward" was written from a list of arrivals; the park's own count
  of its steps forward said never (a nearer entry queued before it
  shields it).
- **Read an entry's arguments and not only its name.** "A ball stopped
  with a correction of its place" (`Stop` with `SetBallPosition`) was a
  ship at rest sent its own place again every five seconds: the same
  three numbers each time.
- **What a correction corrects is measured**: the scratch
  `anchor-moves.js <repo> <recording.jsonl> [connection]` lists every
  `SetBallPosition` as the client's park applied it, how far it moved
  the ball, and how it came against the park's tick. A net that moves
  nothing in 29 tries and makes the client go back is not a net.
- **The pilot's own ship told from the rest**: `lead-by-name.js <repo>
  <recording.jsonl> <ms to add> <ball> [others]` counts only the entries
  naming that ball first, or only those that do not.
- **Senders that share a lead are tried together.** A hit's damage, its
  effect and a missile's removal come at one stamp because each is two
  after the server's; one moved alone parts them. The lead is one
  constant (`MICHELLE_HELD_FUTURE_DESTINY_LEAD`), and whether it is 1 or
  2 is **the operator's to say**: this loop does not change it.
- **A trial is not a commit.** A constant tried on disk: the committed
  file copied aside first (`git show HEAD:<path>` into the scratchpad),
  put back after and compared with `cmp`, and `git status` read. The
  server's ledger takes the trial's numbers, and says "not kept".
- **A copied log holds the flights before it too.** A rat of the unit
  before's has another number; "no ship in the park at that time" for
  every row is the wrong ball or the wrong minutes, not a finding.
- **The server reads its clock more than once for one sending.** What
  builds an entry reads it (`getCurrentSimTimeMs` follows the wall clock
  between a scene's ticks) and `sendDestinyUpdates` reads it again for
  each group; the delivery raises what the second reading finds behind.
  A group whose places depend on its stamp carries
  `rebuildKinematicsAtDeliveryStamp` in its send options and is built
  again for the stamp it leaves with (same count, same names).
- **The groups about each whole state, from the authority's trace**: the
  scratch `emit-around.js <missile debug log> <ms before> <ms after> [1]`
  (when, the scene's stamp as sent, authored, left, the steps that
  changed it; "1" for the raised ones only); `emit-row.js <log>
  <name,...> [n]` prints a trace row whole. Not every group is traced
  (the prime after a whole state is not): the recording has every stamp.
- **To catch a whole state raised**: `state-live.js` with undocks asked
  0.79 to 0.91 s into a second and no logins (`""`): 2 of 12.
- **Never list the server's log folder or a scratchpad whole** (done
  twice): the two logs are `space-missile-debug.log` and
  `space-movement-debug.log`, and a rotated hour's is named with the
  date and the UTC hour.
- **`pilot-ships.js` is in this loop's first scratchpad**, given the
  other (with `bff-session.js`) as its first argument.
- **What turns on a constant is found by two flights with it at two
  values**, `scripts/park-tick-against-stamps.js` on each, side by side:
  a row that moves with it is inside it. "Outside the lead" was said of
  three senders from their names, and all three moved.
- **What a thing is sent with is not when it is sent.** The server's
  authors read "`SetBallMassive 1` comes with `WarpTo`" in
  Tranquility's recordings as the flag tracking warp. Read in order for
  the pilot's own ship (the scratch `tq-massive-order.js <root> [1]`: the
  ship is the "ego" of the recording's states and its session's shipid)
  it comes with the first command after an undock only.
  `tq-massive-shapes.js <root>` counts the entries that come together,
  the pilot's ship apart from the rest.
- **What an `AddBalls2` or a whole state carries**: the scratch
  `addballs-in.js <repo> <recording.jsonl> [entries] [balls]` (each
  ball's id, mode, flags, speed, and its slim item's type, group and
  name). An `AddBalls2` is handed one chunk: the state and the slim
  items together. Tranquility's own come inside a `PackagedAction`
  (`tq-first-order.js` decodes them: the lesson further down).
- **`--timeline` of the park tool needs `--server-clock`**; alone it
  prints nothing more.
- **When a group was sent is in the delivery's trace, to the
  millisecond** (`emit-steps.js <missile debug log> <from ms>
  Orbit,FollowBall`: "raw 600 (025 ms in)"). The recorder's clock counts
  from the recorder's start, and a moment reckoned from it was a second
  out. The rows of the park beside the movement log do not show lateness
  at all: the park is played to each stamp, so an entry sent late and
  stamped rightly reads as right.
- **Tranquility's `AddBalls2` can be decoded**: it comes inside a
  `PackagedAction`, a `MarshalStream` printed as a Python string; the
  scratch `tq-first-order.js <marshal.js> <repo> <root> [1] [orders]`
  reads the string, decodes it with the server's marshal decoder and
  reads each state with `src/gamePort/destiny/state.js`: each ball
  added, its mode, and the first entry (or the first steering order)
  that names it after.
- **A reading from a trial's flight is not how the server stands.** The
  stamp of an `AddBalls2` was read with the lead at 1 and written as the
  server's; it is the lead less one. Say which flight a number is from,
  and with what on disk.
- **A hold in the server's delivery is weighed by what the client does
  with a stamp**, not by when an entry arrives: the client orders what
  it is sent by stamp. A wait "until the client has surely applied it"
  buys nothing that a later stamp does not.
- **Never read "not sent" off a line cut short.** `first-updates.js`
  with a ball's number prints each entry's arguments, and a line cut at
  some width lost the fourth entry of an update: a `Stop` that was
  sent. Without the ball's number it prints names only, a count for
  each ("OnSpecialFX x3, Stop"): read that for what an update holds.
- **What the server sent, by its own record**: the sync ledger
  (`eve.js/_local/logs/sync-ledger.log`, the hour's; rotated like the
  debug logs): each group as it is queued and each packet as it is sent,
  with the entries' names, stamps and balls. It has what the delivery's
  trace leaves out (an NPC's `Stop`).
- **A thing found is not said to the operator until it is checked.** A
  line of progress said the client was never sent a `Stop`; it had
  been.
- **A rat's number comes again after each restart of the server.** With
  a copied log that holds earlier flights, the time tells one rat from
  another, not the number.
- **A rat that loses its target while its pilot looks on**:
  `msp-live.js <T> <bff> <account> <character> 30 "/npc 1
  parity_dire_guristas_destructor; wait 6; away 22000; wait 14; /invu"`.
  It is stopped, and half a second later heads home by a direction given
  anew each second. A belt's own rats may not come at all in 40 s
  (`state-live.js` waited for them and got none).
- **Whose ball Tranquility steers and by what**: the scratch
  `tq-steering.js <root> [name]`.
- **To make the server send a whole state in mid-session**:
  `EVEJS_GAME_PORT=26006 node scripts/record-destiny.js test2 140000002 30
  <scratch>/x.fixture.json 2.3`, through the recorder. It logs in on the
  game port by itself (the pilot docked, and not in the BFF's hands),
  undocks, asks for the state every 2.3 s, stops half-way and docks.
  **Give it the file's path**: without one it writes over
  `test/fixtures/destinyUndock.json`.
- **Before and after within one copy of the store**: save, fly, change
  the code, `store.sh restore <label>` (with the debug setting: it
  starts the server again, on the code now on disk), fly, restore, and
  only then delete the copy.
- **The road a thing takes is read from its start.** Why a GM's rat
  waits a second was in the GM's spawn (six lines), not in the rat's
  thinking, which was read first.
- **A recording's name is not used twice.** `scripts/record-game-port.js`
  writes on at the end of a file that is there, and a name of an
  earlier unit's (`mcb.jsonl`) came back holding two flights: the park
  tool went wild (entries 15,289 stamps ahead). Look for the name
  before recording (`ls <scratch>/<name>.jsonl`). A file that holds two
  is cut where the recorder's clock goes back (`awk -F'"at":'`, then
  `sed -n '<line>,$p'`).
- **The server's copy of a missile's client ball beside the client's**:
  `node scripts/missiles-in-park.js <recording>` ("launched", "touched
  in the tick from") beside the missile debug log's
  `missile.client-ball.launched` ("stamp") and
  `missile.client-ball.touched` ("touchedInStepFrom", "whenInStep").
- **A gate in the server's ledger is read as it is written.** "Before
  changing collision, impact, or release timing" is before: the Next
  list had the acting at the touch done first and the retail client
  looked at after.
- **How a session's calls were addressed, by service**, from this
  server's log: `sed 's/\x1b\[[0-9;]*m//g' <log> | grep "CALL_REQ
  src=client"`, then the service's name and `dst=any` or `dst=node`
  counted. The logs of a real client (`direct-tcp-real-client-*`) have
  colour codes in them and their fields one place to the left of
  `server.log`'s; a tally by `awk` comes out empty until the codes are
  off.
- **What Tranquility's client says of itself is in its recordings**:
  "I haven't got a clue where ... should run" and "Redirecting call to
  node" are the client's own lines of machoNet finding a service; a
  `grep -rh` of each, counted, is what the server did.
- **A pilot with a mission accepted, and flown**: the scratch
  `mti-live.js <bff> <account> <character> [agentID]` (beside
  `bff-session.js` in this loop's first scratchpad) finds a level 1
  agent in the pilot's own station (`/api/agents/find?kind=courier&level=1`),
  presses its buttons (3 is accept), undocks and warps to a belt.
  **Do not ask for a docking from the belt**: the server turns it into
  an approach across the system and the ship never docks; dock before
  the warp, or warp back first.
- **What a pilot was asked at a moment, from the server's own log**:
  `sed 's/\x1b\[[0-9;]*m//g' server.log | grep "T<hh:mm>"`, then the
  lines `Call: method="..."`, `SessionChange` and the service's
  `CALL_REQ`. No recorder is needed to see that a call was made and
  when.
- **A thing the game port asks of its own accord is added in four
  places** of `src/gamePort/pilots.js` and two of `retailCalls.js`: the
  asking itself, the choosing, the session's change, the park's event if
  it has one; and the call's name among those the gateway's list has
  not, with its entry judged against the client's line.
- **Read what the older tests' stand-in writes down before building an
  asking of the game port's own.** `test/gamePortPilots.test.js` keeps
  every call by name (`session.calls`), every bind (`session.binds`)
  and every call on a bound object (`session.boundCalls`), and its ship
  as godma has it is a type and a group with no category (`shipInfo`,
  line 32). An asking that binds at a choosing makes untrue what a
  hundred lines read; one that waits on godma's priming and on the
  ship's category does not. A first build was seen working and then put
  aside for this.
- **Whose an asking is**: `sl-calls.js <recording>` (in the second
  scratchpad) lists every call the client made with its time and each
  session change; then `grep -rn "<method>" --include=*.py` in the
  decompiled client for who calls it, and that caller's own callers. A
  service's `OnSessionChanged` is a service's own; a class under
  `ui/` is a window's.
- **A change of ship while docked**: the scratch `tsl-live.js <bff>
  <account> <character>` leaves the ship for the capsule
  (`/api/bridge/ship/leave`) and boards it again
  (`/api/bridge/ship/board`), reading the flight after each.
- **The state file of `eve.js` is written afresh for every entry**, from
  `git rev-parse HEAD` and `git ls-remote origin` read as the entry is
  written. An earlier unit's file was used again where no server commit
  had been made, and the origin had been moved by another's push in the
  meantime: the entry said three commits were not on it when none was.
- **An asking added to a choosing by a service's name is said in four
  places of the old pilot tests**, and they are mended by reading in
  the unit's own sitting (`test/gamePortPilots.test.js`): the list every
  choosing is held to (`CHOSEN_ASKS`, near the top), the first
  choosing's list spelled out (the test "select logs in as the
  account"), the line that says what each asking carries (it maps
  `CHOSEN_ASKS` to `[pair, [], ...]`: an asking that carries something
  is said there), and the whole tally of a session (the test "the
  transport keeps a tally"). Nothing else there reads a choosing by a
  position that an asking before the corporation's reads moves. An
  asking on a bound object, or one that waits on godma, is in none of
  them.
- **The game port's own list is spelled out in an old test too**
  (`test/gamePortRetailCalls.test.js`, "the game port carries the
  customs office's transfer"): a name added to
  `GAME_PORT_ONLY_CALLS` is added there, in the list's own order. The
  scratch `jtm-tests.js` ends by setting the spelled list beside the
  list itself, from the test's text. One unit added to the list and
  not there, and the next found it.
- **The login's report is made from Test Pilot's login** (`test`,
  140000001), the retail login's own character:
  `login-only.js <bff> test 140000001 <server.log> 8`, then
  `login-report.js <repo> <logs dir> <from> <to>`. Made from another
  pilot's it lists that pilot's corporation's and alliance's reads as
  calls the client did not make. `login-what.json` beside the scripts
  has the report's two descriptions, and its date is changed by hand.
- **A call's arguments and answer in one of Tranquility's `.txt`
  recordings**: the file is binary to grep, so
  `grep -a "<service>" "<file>" | tr -c '\40-\176\n' ' ' | grep -o "<service>::<method>.\{0,170\}"`
  gives `args=(...), retval=...`, and the same with
  `Packet::CallReq` gives whom it was sent to.
- **A moniker that every choosing binds is set aside by the old pilot
  tests' own builder**, and another is added the same way, by reading
  (`test/gamePortPilots.test.js`): its objects counted on a node of
  their own in the stand-in's `bind` (`REGISTRY_NODE`, `WAR_NODE`), and
  its bind and its calls at the choosing taken out of the session's
  lists in the wrapper round `selectCharacter` (`registryAtChoosing`,
  `warsAtChoosing`), so that every count and object number of the rest
  stands. A thread's timer is switched off in the builder's own options
  (`averagePricesAfterMs: null`, `warsAgainAfterMs: null`): old tests
  count the timers a session set.
- **The moniker services are spelled out in an old test too**
  (`test/gamePortRetailCalls.test.js`, "everything of ship, dogmaIM,
  corpRegistry and the skill handler is made on a moniker"): a service
  added to `MONIKER_SERVICES` is added there. The scratch
  `war-tests.js` ends by setting the spelled services beside the list.
- **A call's arguments as the game port sent them**:
  `node scripts/record-game-port.js describe <recording> | grep -a "<service>\|<method>"`
  prints each call with its arguments and whom it was sent to
  (`warRegistry.MachoBindObject((int(99000000), int(1)), None)`), to be
  set beside Tranquility's line.
- **The war registry's reads through the BFF**:
  `/api/bridge/bound-small-services` asks its four (with
  `?ownerID=` for another owner's wars); the scratch `war-live.js <bff>
  <account> <character> <another owner> <server.log>` asks them three
  times and says where the server's log stood at each.
- **The server's log starts afresh on the hour**: line numbers taken
  before the hour are the old file's. `login-only.js` prints the
  hour's own (a small FROM just after the hour is right).
- **A GM's command not yet seen working in this loop is run for its
  own sake first**, after the copy of the store: one that fails half
  way leaves the store half-changed (`/corpcreate` had the corporation
  made and the character in it, and the session never told). The
  server's log has only the error's words for a failed slash command
  (`[SlashService] Command failed: ...`): its path is read from the
  command down (`services/chat/chatCommands.js`).
- **A change of corporation, live**: `warc-live.js <bff> <account>
  <character> "<corporation name>" <server.log>` (session 2aba99c0's
  scratchpad) has a docked pilot found a corporation by the GM's
  `/corpcreate`, with the war registry's reads asked before and after;
  through the recorder its calls are in `describe`'s lines. The session
  changes `corpid` and `corpAccountKey`. Between a copy of the store
  and its putting back.
- **What every choosing binds and a later change binds again is listed
  apart in the old pilot tests' stand-in** (crimewatch's Monikers, the
  war registry's and the calls on them: `session.crimewatch`,
  `session.wars`, `session.warCalls`), not set aside by the builder's
  wrapper, which runs only at the choosing: the tests that change a
  corporation or an alliance state the exact lists of binds and bound
  calls afterwards.
- **After a commit in `eve.js`, `git show --stat HEAD`** says what the
  commit holds. `git diff HEAD~1 --stat` there counts the six files of
  others that lie changed in the working tree.
- **What the BFF keeps of a session is set at the choosing and kept
  current at the flight's reading** (`makeHeldCharacter` and
  `readHeldFlight` in `src/server.js`): the station, the structure, the
  system, the roles, and the corporation. A thing of the session's that
  a route goes by and that can change under the pilot is said by the
  transport in the flight's status (`readFlightStatus` in
  `src/gamePort/pilots.js`), adopted there, and taken out of what the
  page is handed. The alliance is kept nowhere in the BFF. A route's
  own echo of `held.<something>` in its answer is a quick live look at
  what the BFF holds (`/api/bridge/bound-small-services` says the
  corporation).
- **A line of the client's is named from `grep -n`, at the writing.**
  Counted down a printout that began part way into a file, the numbers
  drift: two units named `war_cso.py`'s `GetWars` as 95 to 104 (it is
  98 to 106) and its thread as 166 to 176 (172 to 182), and
  `fwWarzoneSvc.py`'s handlers likewise, in comments, in a call's note
  and in commit messages. `grep -n "    def " <file>` gives every
  method's first line, and the next one's less two is its last.
- **An asking by a service's name that comes at every choosing and
  again at a later change of the session is listed apart in the old
  pilot tests' stand-in** (`call` in `fakeSession`:
  `session.gradeAsks`, `priceAsks`, `occupationAsks`), with an answer
  that suits it (the occupation's is of the system the session is in,
  or the game port asks twice and fails). `calls` and `sent` then hold
  what a test caused, and only the whole tally of a session gains the
  pair.
- **A change of solar system, live**: `occ-live.js <bff> <account>
  <character> <system name> <server.log>` (session 2aba99c0's
  scratchpad) logs a pilot in and moves it with the GM's
  `/solar <system name>`, which puts a docked pilot in space by a gate
  of that system: the session changes `solarsystemid2` and the rest.
  Between a copy of the store and its putting back.
- **What the server answered a call, out of a game-port recording**:
  `call-answers.js <repo> <recording> <text>` (session 2aba99c0's
  scratchpad) prints each call whose service or method has the text,
  whom it was sent to, its arguments and the answer. It shows a float
  that is a whole number as an int (the decoder's numbers are
  JavaScript's): whether the wire had a float is read from the frame's
  bytes (`0a` and eight bytes; `2c0a000000000000f03f20` is the tuple
  `(1.0, False)`).
- **This server's "safe" answers are set beside Tranquility's.** A
  handler that answers zeros or nothing "safely" may answer what the
  retail client never shows and Tranquility never sends
  (`dynamicBountyMgr.GetOutputForClientSolarSystem` answered `(0, 0)`
  for Tranquility's `(1.0, False)`). For each call a unit adds, the
  recordings' `retval=` is read (`grep -a "<service>" <file> | tr -c
  '\40-\176\n' ' ' | grep -o "<service>::<method>.\{0,170\}"`) and
  set beside what the handler builds; where they differ the server is
  mended first.
- **A server answer is set beside Tranquility's byte for byte** where
  the recording has the answer's stream (the `MarshalStream '...'` in
  the `.txt`): a scratch probe requires the handler and the server's
  encoder (`server/src/network/tcp/utils/marshal`, `marshalEncode`),
  prints the bytes as text with the unprintable ones as dots and as
  hex, and the two are read side by side; then the frame's hex of a
  game-port recording is searched for them. The server's rowset helper
  `buildDbIndexRowset` puts an `idName` in an indexed rowset's state
  that the one recorded answer read so far has not.
- **`store.sh save <label>` is also how EveJS is restarted onto mended
  code** with nothing staged: the copy it makes is deleted at once.
- **A scratch probe of the server's does not require a service that
  reads the store.** Requiring `charMgrService.js` loads the
  character's state modules, which open the live store from a second
  process. The answer's expression is probed with the helpers alone
  (`services/_shared/serviceHelpers`, `network/tcp/utils/marshal`), and
  the handler's own answer is read out of a game-port recording
  (`call-answers.js`, and the frame's hex).
- **The server's tests are searched for a method before its answer's
  form is changed** (`grep -rn "<Method>" server/tests`): one of them
  may read the old form, and is then read against the recording and
  mended in the same commit, unrun
  (`characterSettingsParity.test.js` read the settings as a dict of
  plain strings). The harness's verbs decode an answer through
  `tests/harness/verbs/verbEncoding.js`, whose `decodeKeyVal` takes a
  dict or a KeyVal alike.
- **Tranquility's recordings are of a later build than the client
  decompiled here**, and a service may have another name in them
  (`monolithTaskTrackerMgr` there for this build's
  `achievementTrackerMgr`). A search for `<service>::<method>` then
  finds nothing though the method is in the file: the method is
  searched for by its own name. What the game port asks is this
  build's: the decompiled client's own line, and the retail client's
  login on this server (`docs/game-port-login-calls.md`).
- **A login through the game port runs the account's login
  milestone** (since `d1298c33`, as a retail client's does:
  `milestoneMgr.ProcessCharacterLogon`), and the server writes the
  account's time online as the session ends
  (`server/src/services/character/milestoneMgrService.js`). A look that
  is only a login leaves its seconds in the store; after two hours of
  them the account's milestone stands achieved. A look that must leave
  nothing is made between a copy of the store and its putting back.
- **A call of the client's that tells the server something is read at
  the server before the first look with it.** `ProcessCharacterLogon`
  answers nothing and looked like a notice of no weight; the handler
  starts a timer, sends a notice and writes the account's progress.
- **`caching.Memoize` keeps for minutes, and with no argument for
  thirty hours** (`caching/memoize.py` 12 to 37: `Memoize(0.5)` is
  half a minute; a bare `@Memoize` is 108000 seconds), not "for as long
  as the client runs". `threadutils.expiring_memoize(n)` is seconds.
- **What the client keeps a while is seen live by two changes**, one
  inside the time and one after it: `ins-live.js <bff> <account>
  <character> <first system> <second system> <seconds between>
  <server.log>` (session 2aba99c0's scratchpad) moves a pilot twice
  with the GM's `/solar`, and `call-answers.js` shows which change the
  call followed. Between a copy of the store and its putting back.
- **The login's report goes by a call's name.** A call the client
  makes before a character is chosen and again after shows as asked
  in both places once the game port makes it in either
  (`scripts/login-calls-report.js` 98): the count that falls is the
  report's, and the entry says how many are left by the moment of
  asking (the redeeming's tokens: asked at the character selection
  screen, which the game port has none of, and again from the choosing
  on).
- **The server's live log is `server.log`.** It has the lines of
  the hour that is running; an hour gone by is in
  `server.<date>_<hour>.log` (measured 2026-10-13: the 22nd hour's
  file ran from 22:00:46 to 22:59:46 and `server.log` began at
  23:00:46). A login's lines are counted in `server.log`, and the
  login's report is made within the hour of the login. That day a
  login's lines were looked for in the hour's file a minute after the
  hour had turned, and the count before the login and after it was
  the same.
- **What a client told the server's loggers is in the hour logs at
  debug level**, and not in a capture of the server's stdout
  (`direct-tcp-real-client-*.stdout.log`), which has a call's name
  alone: `grep -rhas "ClientStatLogger\] LogString"` over the logs
  folder gave the text of three on 2026-10-13. A call whose
  arguments matter is looked for there before it is said that they
  are not on record.
- **The chat stub writes every stanza, in and out, to
  `eve.js/_local/logs/xmpp-stub.log`.** A look at the chat is that
  log read from the line it had before the look, beside the
  recording of the game port: the calls are in the one and the
  stanzas in the other.
- **A JS array answered by a handler of the server's goes on the wire
  as a tuple.** Where Tranquility's recorded answer opens with 0x15
  it is a list (`TY_LIST = 21`, CCP's `blue/src/Marshal.h` 92), and
  the handler answers `buildList(...)`. A recording of a game-port
  session shows which went: `(...)` a tuple, `[...]` a list.
- **The login's report wants a login of its own, between a copy of
  the store and its putting back.** On 2026-10-13 it was forgotten
  inside the look's own copy, and a second copy and putting back were
  made for it: `login-only.js` is run while the look's copy stands.
- **A retail client's own chat stanzas are on this machine**: the
  chat stub's hour logs (`eve.js/_local/logs/xmpp-stub.<date>_<hour>.log`)
  have every stanza of every connection, a retail client's among
  them (grep `id='id1' type='set'`). What the web client's chat
  sends is set beside one of those, stanza for stanza, and the
  reading of the code is checked by it: on 2026-10-13 the login's
  second join of each channel was in the code (`xmppchatsvc.py` 363)
  and plain in the log.
- **A socket destroyed straight after several writes loses the later
  ones.** Three stanzas written and the socket destroyed: the stub
  logged the first. It is ended (`socket.end`), with a timer to
  destroy it should the other side never close.
- **The client's own Python answers what its standard modules say**:
  `scripts/py27-oracle.py` with the client's `bin64` put on
  `sys.path` inside the snippet loads `unicodedata.pyd` (and the
  other `.pyd` there). A table had from it is put into the source by
  a script that reads the oracle's output, and checked whole against
  it as it is written.
- **What a service of the client's hears is by its handlers' names
  where the decompile has numbers for its notices** (`__notifyevents__
  = [3, 4, ...]`): the `On...`, `Process...` and `Do...` methods of
  the class are the notices, one for one. The chat service's eight
  were read so on 2026-10-13.
- **The chat and the game port are two sockets, and what the server
  sends on each at one change comes in either order.** At a move the
  stub's presences of the new room came 67 ms ahead of the session's
  change reaching the chat's connection. What is kept of a room is
  made right for both orders, and a look says which came first.
- **The chat stub's log turns over at the hour as the server's
  does**: `xmpp-stub.log` has the running hour's stanzas and an hour
  gone by is in `xmpp-stub.<date>_<hour>.log`. A look read from "the
  line it had before" across the hour's turn reads nothing: the log
  is read from its start then.
- **What a client does only when nothing happens is measured before
  it is built for.** The chat window's check of a quiet channel
  (`xmppchatwindow.py` 1344 to 1364) reads as a join every three
  minutes; the stub's log of a retail client's sixteen minutes has
  none, the server sending a presence every thirty seconds. Both are
  written: what the code does, and what the log shows of it here.
- **A thing no live look can make happen is seen by a scratch probe
  that calls the code** against a stand-in, and is said to be seen so
  and not live: a dropped socket of the chat's was (`chat-reconnect-
  probe.js`). The probe is a scratch script, not a test, and is not
  put in the repository.
- **A decompiled constant that could not run is read from the
  compiled module.** `chatutil/spam.py` decompiled to a mangled
  string and to `ord` called on numbers; the truth was the module's
  `co_consts`, had by `marshal.loads` of the `.pyc` (eight bytes
  in) inside the client's own `python27.dll`
  (`scripts/py27-oracle.py`; `open` and `marshal` are there, the
  standard library is not, so the module is read and not run). A
  function's flow is checked the same way, its bytecode against the
  decompile, opcode by opcode. This is the operator's "deep-decompiled
  client (not just the python)".
- **A state file of `eve.js` is not used twice.** On 2026-10-13 an
  entry was appended with the state file of the entry before, which
  named two commits not on the origin; the origin had been moved to
  the head since, by another's push, and the entry said what was no
  longer so. It was put right before it was committed. The records
  script is given the origin's hash as well as the head's, both read
  as it is run, and holds the state file to naming both.
- **Tranquility's recordings of a login begin at its fortieth call.**
  What a client asks before a character is chosen is not in them
  (the cfg's loading, the global config's coming), but for the last
  of it, the population cap's moniker. For those the truth is this
  server's log of a retail client's own login
  (`direct-tcp-real-client-*.stdout.log`, names alone) and the
  client's code; a search of the recordings that finds nothing is
  checked against where they begin before it is said that the client
  does not make the call.
- **A write that leaves its route for the page takes its read with
  it.** The scoop's route read the drones after the call; when the
  page took the call (2026-10-11) it took that read too, and with it
  the launch's fault by one round trip's grace. A page's own call
  that puts a ball into space or takes one out is judged by a read
  that waits for the ball, as the launch's route waits
  (`scoopLeaveWaitMs`, `flow.ts`).
- **The browser pane will not be turned to `about:blank`.** A page
  left open on a BFF after its pilot's look is turned to a route that
  runs no page (`/api/health`), before the store is put back: a page
  left running asks for its pilot again.
- **A pilot staged in space by a script and taken over in the tab**
  is brought in from the pilots' list: the row clicked, "BRING ONLINE";
  the pane is told it is visible first (the memory's note), and a
  click and its reading are two calls.
- **A module's collections of named constants are read from two
  compiled modules.** `tacticalConst.pyc` builds its sets from
  `invconst.<name>` (a LOAD_ATTR each), and the numbers are in
  `inventorycommon/const.pyc` (a LOAD_CONST and a STORE_NAME each):
  a snippet of the oracle's walks both bytecodes and prints each name
  with its number (`tactical-snippet.py` in session 2aba99c0's
  scratchpad), and a patch script puts the oracle's answer into the
  source and reads back what it wrote. A bare number among the names
  is told from a constant's place so: here the 11 was the module's
  own.
- **A route that is only a read, a guard and a call is the page's
  to make where the page has the read.** The scanner's four each read
  the transport's keeping, refused by it, and called with it; the
  page reads the same keeping. What decides is whether the route goes
  by something the BFF alone knows: read every branch for that
  before its length is believed, and count the routes over a helper
  (the list said three, and there were four).
- **A page's order that takes the client's rule takes it for the
  bots too.** A bot's block that issues an order the page now refuses
  stops the bot's run: the blocks that decide by the same read are
  given the same rule (`launchOf`, `scanOf`, `recallOf`), and wait
  where what stops the order passes by itself.
- **A read of space made in a launch's own second has not the things
  launched.** The scanner's read had all eight probes at once (their
  notices come before the launch's answer); the space snapshot had
  none of them yet, and had each a little later. A look at where a
  new thing is waits for the ball.
- **A search of a whole repository is given its folders.** A
  `grep -r` over `eve.js` from its root ran past two minutes and was
  stopped: `server/src`, `server/tests`, `doc` or the client's code
  are named, never the root.
- **The server's prepared scanning ship is over its CPU.** `/probe2`
  gives a Stratios at 590 of 484 CPU with one module of fifteen
  offline: a module taken offline there is refused back until a
  larger one is off (the expanded probe launcher makes room for the
  damage control). An online in space leaves 5 in 100 of the
  capacitor, and the next is refused under 95: a look that onlines
  twice in space waits, or onlines docked.
- **The fitting's read is the wire's own.** `GET /api/bridge/fitting`
  answers `slots`, `shipInfo` and `online` as they came: a script
  takes the online modules from `online` as a list, a module's type
  from the row of `slots` that names the ship, and CPU and powergrid
  from the dict of `shipInfo` that has attributes 48 and 49
  (`online-cpu.js`, which only reads).
- **A window that words its own verdict is read beside the flow's.**
  The Equipment window said "gave no reason" beside the reason the
  flow had from the server. Where a flow already says why an order
  failed, a window's own check after it is for the case the flow says
  nothing of.
- **Test Two has an agent at its station; Test Pilot has none.**
  Jita IV-4 has no agents. Muvolailen X-3 (60000004) has two, and one
  of level 1 (3008416), with an offer open for Test Two in the store
  as it stands: a look at a conversation, a decline's question or
  "Remove Offer" needs no staging. In the tab the second pilot is
  brought online from the pilots' list ("Pilots", the row, "BRING
  ONLINE") and made the one shown by the chip under "▾".
- **A script reads what an agent offers before it presses.** The
  first thing an agent with an offer open has is Accept (3), not a
  mission to request (2) or view (1): a script that pressed "the
  first button" accepted a mission, and the store was put back to
  have the offer again.
- **Old tests written to a route's path are kept by their stand-in's
  naming.** Where some twenty places of a test file name a route's
  path and body, the stand-in hands the page's own call to them
  under that name and says so (`asAgentRoute` beside `asRead`,
  `web/src/app/agentsFlow.test.ts`); a test of the route itself goes
  with the route.
- **A short route is read for what it is before it is counted
  short.** Of the aid's shortest, five were no route's move, of three
  kinds: one told the transport of a window's closing (the transport
  keeps that window's job), two were calls on an inventory's own
  object with a flag the BFF alone names, and two were a call and
  then the BFF's own watching. What a route keeps, binds or watches is read
  before its length is believed.
- **A drone is let go of by a route, and the window does not know.**
  A loose drone for a look is made by `POST
  /api/bridge/entity/drones/abandon` (a route still), from a script or
  from the tab with the page's own token. Done from outside the
  page's flow, the Drones window offers no "Reconnect" until it reads
  its drones again, which any order from the window makes it do.
- **A pilot taken over with a drone loose meets the lost-drone
  check.** The tab says "DRONE RECOVERY BLOCKED" and offers "Retry
  Recovery": pressed once it reconnects and recalls, pressed again
  with the drone home it clears. It is the page's own machinery, and
  a look that wants the Drones window's own buttons gets past it
  first.
- **A call that answers nothing takes its verdict's reads with it.**
  The order's route read the pilot's orders and wallet before and
  after, and the page's call makes the same four reads. The verdict
  is by the thing itself where the reads name it (this order was
  there, and is not), and not by a count.
- **An offer to buy for a market look.** `POST /api/bridge/market/buy`
  with `{ typeID: 34, price: 0.01, quantity: 1, durationDays: 1,
  confirm: true }` places one as Test Pilot at Jita for 100.01 ISK;
  its number and region are in `marketProxy.GetCharOrders`, read by
  the generic call (`mktcancel-live.js`). Each is taken down before
  the look ends: the market's daemon keeps them, and the store's copy
  puts back the wallet alone.
- **A wallet's balance came as a number through the generic call on
  the game port** (the page's verdict had its 0.01 ISK from the
  page's own amount reader, which reads no real in its wrapper). The
  route's helper took a real in its wrapper too, and the cancel's own
  reader takes both; through the gateway the page's reading of it was
  not looked at.
- **Test Three is Test Two's account's second pilot.** Account
  `test2` has Test Two (140000002, Muvolailen) and Test Three
  (140000003, docked at Jita IV-4 in a capsule, where Test Pilot is
  docked too): two pilots of two accounts in one station, for a look
  at what one may do with the other's things. A pilot's account is
  read from the store's file opened to read alone (`whose-pilot2.js`:
  the `characters` table is a key and a JSON, with `accountId`).
- **What the server takes of a caller is asked before a kind of call
  is opened to the page.** A stack given to one pilot (`/giveitem 34
  100`, into its hangar) and asked for by another in the same station
  (`invowner-live.js`) was refused, `FakeItemNotFound`. The handler's
  own lines named no owner, and the refusal was found by asking.
- **A unit may end sized.** Where the next thing is a making, the
  unit that finds it so lays it out in the Next list, measures its
  unknown of the server's, and builds nothing: the making is the next
  unit's.
- **A recording is read for each call's form before a verdict is
  believed.** The script's verdicts were right and the wire was not:
  the game port gave the unfittings a quantity the client never names.
  Describe the recording and set each call beside the client's line.
- **The client's gesture names the method, not the route's.** The
  route's fit to no slot was one `Add` with flag 0; the client's is
  `MultiAdd` on the ship's inventory. Search the client for the flag
  or the constant (`flagAutoFit`) before keeping the route's method.
- **A refit of the prepared ship wants a skill**: `/giveskill me 3394
  5` (Hull Upgrades), for its Damage Control II. The Fitting window's
  fit is "Pick up" on the module, then "Fit here" on a slot or "Fit …
  in the first free slot" (`fitmod-live.js`).
- **The gateway's fitting read has packed rows by field**
  (`{ type: "packedrow", fields }`), the game port's by list; a
  script reads both.
- **The working tree ends lines CRLF.** A patch script's own check of
  a find reads the file with its endings made LF, as `patch.js` does.
- **The online pilot's station is not where it is.** The store's
  online pilot keeps the station it was chosen or last docked in, and
  nothing clears it on an undock. Where the page needs the session's
  place it reads the flight's (`dockedNow` in `flow.ts`).
- **A server run is the page's own code.** The bot host loads
  `web/src/app/flow.ts` from the source at the BFF's start, so a
  run proves a page's own call once the BFF is restarted on the
  change. Its log is `bffgp-data/bot-logs/<characterID>.jsonl` in
  session 2e7ceba2's scratchpad.
- **A haul in the tab.** Test Two's colony is planet 40176368
  (Muvolailen I), launchpad 1054656331535, customs office
  1200040176368. The launchpad is staged with the server stopped
  (`stage-pad.sh '<contents as JSON>'`, with `pad-stage.js`); an
  Epithal given (`/giveitem Epithal`, `/giveskill me 3340 1`, which
  is Gallente Hauler: `gm-say.js` under `MSYS_NO_PATHCONV=1`). In
  the PI window Test Two is added on its Pilots tab, the colony ticked
  under Colonies and "Haul 1 colony" pressed. A pilot this tab holds
  is refused ("A web session is flying this character"): the Station
  window's "Go offline" lets it go. Take Test Two off the board after
  ("Remove Test Two").
- **The page has no Fitting window in space**, so its in-space unfit
  is not reached from a window.
- **Two stacks of a type for a look.** `/giveitem` adds to a stack
  there is. A stack is split by the client's own form, part of it
  added to the inventory it is in: `invbroker.Add(stack, station,
  qty=N, flag=4)` with `of: "hangar"` (`merge-live.js`). Test
  Three, in a capsule at Jita, takes `/giveitem 34 50` as the other
  pilot's stack in the same hangar.
- **The Inventory & Ship window's rows** are `li.stn-row`, each with
  its own checkbox ("Select <name>"); two of a type ticked offer
  "Merge the two stacks".
- **Measure the route before believing a reading of the transport.**
  A bind of `MachoBindObject` read as the ballpark's; the trash route
  destroyed a stack on both BFFs all the same, and the bind was a
  Moniker for the session's place. Measure, then read the path the
  measurement says was taken.
- **A second bind of a kept moniker shows only on the wire.** The
  trash's answers were right while it bound the station's manager
  afresh beside the one held since login: count the binds of a service
  in the recording against the client's keeping of it.
- **A route that takes the thing from its caller is the vehicle for
  asking the server.** Before a call is a page write, the route that
  already makes it with the caller's number asks the server just as
  well (`fitfit-whose.js`).
- **No saved fitting, no refit run.** Test Pilot's library is empty
  (`fittings-read.js`), and the page saves none.
- **The aid's length of a route runs to the next route.** A route
  followed by a long comment or a section reads long: read its own
  lines before sizing it (`inventory/stack` read 390 and was 24).
- **A replenishment's custody is at the gateway's bound calls**, so it
  holds back the page's own calls as it held the routes'.
- **A route that coordinates hosted bots stays a route.** A claim
  between bots or a haul's contract is the BFF's own word, which no
  client has; the pilot's own use of the same call is the page's.
- **The panel's moves**: a row's "Move <name> to Ship cargo" and,
  with rows ticked, the bar's place buttons ("Item hangar") each ask
  "Move N stacks · M m³ to …?" before "Confirm move".
- **A constant the client names is read from its compiled module**,
  with the oracle (`bayflags-snippet.py`: LOAD_CONST then STORE_NAME in
  `inventorycommon/const.pyc`), before the page holds it.
- **A bay's own moves in the tab**: a hangar row's "▾" offers "Move to
  <bay>"; a bay's row moves to the hangar by its own button.
- **The corporation's hangar in the tab**: "Pilots", Test Three's "Bring
  online" (its corporation has an office at Jita), then the Inventory &
  Ship window's "Corp hangar" and "Division N"; a hangar row's "▾" offers
  "Move to Division N".
- **One thing, one bind**: a page's own call on something a BFF read binds
  too is bound by the read's own key; count `GetInventoryFromId(<it>` in
  the recording, once a session.
- **The describer cannot tell a whole float from an int**:
  `record-game-port.js describe` prints any whole number as `int(...)`,
  its decoder reading both as a number. Count the bytes (`num-bytes.js`
  in session 2aba99c0's scratchpad: each number's int forms and its float
  form in the frame) before saying what kind a value went as.
- **A live script can run the page's own module**: Node loads
  `web/src/bridge/*.ts` as it stands, so a script makes the page's calls
  through the code that was built (`mkt-own.js`, `import()` of
  `marketOrderWrites.ts` with asks through the generic call).
- **The Market window in the tab**: "Market", the box "Search for an
  item to trade", the item's `button.pick-row`, "Offer to buy…" or
  "Offer to sell…", "Check this order…", "Yes, place this buy order";
  "Your orders": "Change the price…", "Take it down…". Every order
  placed is taken down again: the market's daemon is not the store's.
- **A change of place is the BFF's to keep**: a page's write that changes
  its pilot's place goes in `PAGE_PLACE_CHANGE_CALLS` (bridgeCallPolicy.js)
  with its kind, and `dispatchPlaceChangeWrite` (server.js) gives it the
  route's keeping: the client's session manager's work, which is the
  BFF's for a pilot of the page's.
- **Offline from space in the tab**: there is no "Go offline" in space;
  the flight bar's "Dock" at the station on grid, then the Station
  window's "Go offline".
- **A test that looks for a removed route's path passes whatever the page
  does**: look for the page's own call by its pair (`call:ship.Undock`)
  instead.
- **A page's call on the park goes there only by the game port's list**:
  a `beyonce` call the page makes is put on the ballpark's object only
  where `ON_THE_PARK` (retailCalls.js) names it; a call a route made by
  its own bind goes by name once the page makes it. Look for
  `any(beyonce)` in the recording.
- **A jump to try live**: from Jita's undock, the Maurasi gate is on the
  space snapshot (`jump-own.js`); the menu's warp at nought lands in range, and
  the jump goes at the first ask. In the tab: the Overview's gate row,
  "Jump to Maurasi"; in Maurasi a station to dock at is on the bar.
- **A jettison to try in the tab**: the Settings window's GM console gives the cargo
  something (`/giveitem 34 100`, "Run command"); in space the Mining window is in the
  Neocom's Ship group; a stack's "Pick" box, "Dump 1 into space…", then "Yes — dump 1 into
  space". The server takes one jettison in three minutes: a second straight after is
  `ShpJettisonPending`; after a putting back of the store (EveJS restarted with it) the
  next was taken at once, on 2026-10-14.
- **After the machine has been down**, look at what holds the pid files' numbers before
  `store.sh` stops one (`tasklist //FI "PID eq <pid>"`): after a start of Windows another
  process may have it. `store.sh` judges the gateway through the gateway's BFF (26511), so
  with the BFFs down it says "the gateway did not come up" while EveJS listens: start the two
  BFFs after it, and look at 26000 and 26002 (2026-10-14).
- **What the page asks in the tab is on its socket, not in the network list**: a pilot's
  requests go as frames on the tab's socket (`pageFetch.ts`), so neither the network tool
  nor the page's resource timing shows them. Reload the tab, wrap
  `WebSocket.prototype.send` to keep each frame, then do the thing; each frame is JSON with
  its method, path and body (2026-10-14).
- **A command centre launches once a minute.** A launch inside the minute after another is
  refused (`CannotLaunchCommandPinNotReady`), whatever else is wrong with it: a check on two
  transports waits the minute out between them (`node -e "setTimeout(()=>{}, 25000)"` in
  the same command; a bare `sleep` is not for this). `cc-goods.sh '<launchpad JSON>'
  '<command centre JSON>'` puts goods on Test Two's colony with EveJS stopped, and
  `la-live.js <bff> <account> <characterID> <planetID>` launches ten and tries the refusals.
  A bot's block with settings is saved with them: `bot-save.js <bff> <account>
  launch-commodities <name> '{"anyAmount":{"kind":"toggle","enabled":true}}'`.
- **A check in a patch script is as narrow as what it checks.** One that looked for the word
  "export" to tell code from comment stopped on a comment about export tax. It stopped
  before writing, which is what the check is for; look for the line that begins so.
- **A script that writes is not run to look.** `rs-live.js`, `ecu-live.js` and `ecu-stage.js`
  change the colony whatever is done with their output; `net-live.js <bff> <account>
  <characterID> <planetID> look` and `colony-read.js <repo> <store> <planetID> <ownerID>`
  only read. Cutting a writer's output to one line does not stop it.
- **Python rounds a half away from nought; JavaScript rounds it up.** They differ below
  nought (-0.5 is -1 there and -0 here), and a sum the client carries its rounding through
  comes out in another order (two equal shares of five: 2 and 3 there). Where the client's
  arithmetic is copied, its rounding is copied too (`extractorRestart.ts`, `rounded`).
- **A read on an object for a thing the page names** is listed in `PAGE_OBJECT_CALLS` like a
  write, and asked with `bridgeAsk` and `of`: a pilot's, no `confirm`. The planet's yield
  read is the first (`rs-live.js` asks it and makes the one change of a restart).
- **An extractor for a check**: `ecu-stage.js <bff> <account> <characterID> <planetID>` builds
  one on Test Two's colony by the page's own write (the centre to level 2, a control unit, a
  link, a head and a programme of Base Metals, a route to the launchpad), and stops where a
  step is refused. A programme that is running cannot be installed again
  (`CantInstallProgramNeedsCooldown`): run it out with `ecu-expire.sh <planetID> <ownerID>
  <hours>`, which stops EveJS, moves the unit's times back in the store and starts it again
  (both BFFs want starting again after). `ecu-live.js` sends the page's two forms and reads
  the colony round them.
- **A bot run from the tab**: save one of a single block with `bot-save.js <bff> <account>
  <macro> <name>` (the BFF's own route), choose the pilot and "Go to first pilot", then in
  the Bot Manager's Pilots list pick it in the pilot's row ("Choose a bot") and press "Run
  here". Its own words are in the BFF's data folder, `bot-logs/<characterID>.jsonl`: the
  Bot Manager's "Recent runs" does not list a run made in the tab.
- **A colony for a check**: Test Two's (`test2`, 140000002) on Muvolailen I, planet 40176368,
  where the pilot is docked: a command centre and a launchpad, one link, no routes, level 0.
  `net-live.js <bff> <account> <characterID> <planetID> [look]` reads it and changes it. It
  takes none of a route made, a route removed or a programme installed: the one change it
  takes is its command centre raised a level (`[[9, [commandPinID, level]]]`), which costs
  ISK and is undone by the store put back.
- **A breakage not caught is one of two things.** A guard that does nothing (the answer is
  the same without it): take the guard out. Or a case no test has: write the case, see it
  pass, and try the breakage again, and then the next way of writing the same breakage.
- **A bound call moved to the page leaves behind what its handle left.** The handle's path
  in `pilots.js` does things once a call is answered (the pilot's last order, the banks, a
  fleet's state, the listings forgotten). Read those lines before moving a call, and give the
  by-name path the same: a ship sent to a point by name was not the pilot's last order
  until it was, and the next keep-at-range would have been held back.
- **A float on the wire is `{ type: "real", value }`.** A whole JS number goes as an int (or a
  long beyond 32 bits). Where the client's argument is a float (a position, a fraction), the
  ledger's shape makes it one (`goingToPoint`, `retailCalls.js`).
- **A pair added to the page's own writes changes the contract's manifest**: run `node
  scripts/build-bridge-contract.js --write` before the whole suite, or its pin fails.
- **A ship flown for a check**: `goto-live.js <bff> <account> <characterID> [ledger.json]`
  undocks, tries the write's refusals, the last order and a flight to a point, and docks.
  The server's own word for what it received is in `eve.js/_local/logs/server.log`
  (`[Beyonce] CmdGotoPoint char=... point=(...)`).
- **A staging script stops where its staging failed.** One that went on asked the server six
  times with no contract's ID. And a contract is made through the gateway's BFF: its route
  cannot be sent on the game port (`accept-live.js <bff> <stage bff> [corp]`,
  `accept-offer.js <gateway bff>`).
- **Run a new test before the breakage pass.** A test that fails as written makes every
  breakage of its file "not tried".
- **What a route checked of its arguments, the generic call does not.** Read the route for
  every check besides the confirmation (`safety/set-level` refused a level that was none of
  three), then read the server's handler for what it makes of what the route would have
  refused, and the transport for what it KEEPS of the call's arguments: it kept whatever
  level a set named. Judge the pair in `retailCalls.js`, and have the transport keep nothing
  of a call that differs.
- **Look for a scratch file's name before writing it** (`ls <scratch> | grep -c "^name$"`).
  Two older ones were written over in two units.
- **A write that either transport carries needs no route behind it.** Look for the pair in the
  manifest's gateway list first (`contracts/evejs-web-bridge-contract.json`): where it is
  there, the page's module only makes the call (`applyFreePoints`), and the route's name goes
  out of `api.ts`. Where it is not, the module answers false and the flow asks the route
  (`saveQueue`).
- **Look for the pair's entry against the client's line before moving a write.**
  `skillHandler.ApplyFreeSkillPoints` had none, and was counted unchecked on the game port by
  its route too. `grep` the pair in `src/gamePort/retailCalls.js`; where there is none, write
  it with the move, from the client's line and the recording's bytes.
- **A store is staged in a copy, and a reading probe confirms the restore before the copy is
  deleted.** `free-store.js <repo> <a COPY of the store> <characterID> [points]` reads or sets
  a character's free skill points; `sheet-read.js <bff> <account> <characterID> [typeID...]`
  reads a sheet and saves nothing; `free-live.js <bff> <account> <characterID> <points>` sets
  the route's way beside the page's.
- **Read every caller of a call before saying what the client sends with it.** The panel's own
  two saves of a queue say whether a skill is in training, and that was written down as what a
  change of the queue does (`cea56d7`). Every adding, removing and moving goes through the
  service's `OnClientQueueModified`, which says otherwise (`bcf13d5`). `grep` the method
  across the whole client, list the callers in the log, and say which the page's button is
  the counterpart of. A claim about the client is held to this as a build is.
- **A test whose stand-in holds an answer back says how long it will wait**
  (`test(name, { timeout: 5000 }, …)`). One that did not hung a run for 400 seconds, and
  would hang the breakage tool, which is not to be time-limited from outside. Run a new test
  file once by itself with `--test-timeout` before it joins a longer command.
- **A script that stages is not a read.** After a restore, confirm with a probe that only
  reads (`write-start.js <bff> <account> <characterID> read`), and keep the store's copy
  until that is done.
- **An account's extra training slots are in the store's `accounts` rows.**
  `slots-store.js <repo> <a COPY of the store> clear <accountID>` clears them in a copy,
  which `store.sh restore <label>` puts in; `slots-live.js <bff> <account> <characterID>
  stage <otherCharacterID>` then sets another character training and saves a queue each way.
- **A patch script of several files stops at the first find that is wrong, with the files
  before it written.** Take each find from the file as it is (grep it), not from memory, and
  finish from the file it stopped at in a second script. Better, have the script look for
  every find of every file before it writes any (`slots1.js` in the scratchpad is the form).
- **A write is moved by the generic call's three sayings, and only after its handler is read.**
  The page says `pilot` and `confirm`, and the pair goes on `PAGE_WRITE_PAIR_KEYS`
  (`src/bridgeCallPolicy.js`); the page's side is `api.bridgeDo` and a module beside the
  reads' (`web/src/bridge/skillWrites.ts`). The generic call hands the page's arguments on
  as they come, so read the server's handler first for what it trusts, and correct
  `docs/bridge-wire-contract.md` where it lists the pairs. Prove a write as the pause was:
  what is refused (each saying left out, another write with all said, no pilot chosen), the
  route's way and the page's one after the other with the sheets after compared
  (`write-live.js <bff> <account> <characterID>`), then the button in the browser on both
  pages.
- **A survivor of the breakage pass is read, not waved through.** Two `typeof` checks that
  no test caught led to a way round the write check: what was not text was no write to the
  check, and was made into text further on. Where a check asks "is this text", ask what
  becomes further on of what is not.
- **A read may be no read of its window's at all.** Find every caller of the call in the
  client before moving it: `beyonce.GetFormations` has one, the ballpark's making, and the
  page's scanner was asking it for a readout the client's scanner has not got. Then the
  right move is to take the read out, and what showed it, and to say so in the log as a
  thing removed.
- **What a window shows is asked as that window asks it, which is not always the service a
  route was written against.** The Character Sheet's route read the home station by
  `charMgr.GetHomeStationRow`, which is the client's map's and market's call; the client's
  sheet asks another service altogether. Find every caller of a call in the client, and
  then find what the window itself reads: the two can differ.
- **A call of a service the client asks by its name, kept by that service**, is carried and
  kept in three places: the game port's own list and its entry (`src/gamePort/retailCalls.js`),
  a `createKeptReads()` on the pilot's entry read in `callMethod`, and its forgetting where
  the notices are fed and where a session change is worked (`home_station.get_home_station`
  is the pattern, in `src/gamePort/pilots.js`). A test of the answer reads a field's name as
  JSON has it, not by a lookup that bytes and text both satisfy, and asks for the
  notifications that came with it: both were survivors.
- **A read every transport carries needs no way back**, and its route comes off the page's
  list whole. Ask each of a route's reads by name on the gateway BFF too
  (`charsheet-probe.js` is the pattern) before writing a fallback.
- **A pilot staged with implants**: `implant-stage.js <scratch> <bff> <account> <characterID>
  <typeID...>` (9899 and 9941 are two, of slots 1 and 2). Save the store first. No test
  pilot has one otherwise.
- **A flow's test that chooses no pilot tests the route's way.** With nobody chosen the flow
  reads a route where it has one (the skills' sheet does); the page's own asking is reached
  only after `flow.selectCharacter`, with the stand-in answering `/api/bridge/select` and
  each read by `/api/bridge/call`. Hold the browser's clock still for anything worked from
  the server's (`atBrowserNow` in `web/src/app/skillsFlow.test.ts`).
- **A read no test reaches is not moved.** Find who calls it and write the test first. The
  drone range's read of the skill levels was moved, found untested, and put back. A bot's
  reading can be reached: start the bot through the flow over a faked BFF and watch what
  its first reading asks (`web/src/app/missionBotJournalFlow.test.ts`).
- **When a route's read becomes a call, its tests name the read by the call**, not by the old
  path: a stand-in that turns the generic call for it into a name of its own
  (`JOURNAL_READ` and `asRead` in `web/src/app/agentsFlow.test.ts`), and that leaves a request
  of the old route with its own path, which nothing answers. A stand-in that answered the
  call under the route's name would pass a flow that had gone back to the route.
- **The gateway BFF's page** (`http://127.0.0.1:26511/`) has the account `test2` signed in since
  2026-10-10 and opens with no windows: open one by its button. One pilot, one transport:
  log it out of the other page first.
- **A countdown is seen to tick** by reading it until it changes; a minute's display wants up
  to a minute. The bar beside it moves at every reading.
- **A number that came as JSON is finite.** A check for it in the page's TypeScript guards
  nothing; two breakages have survived such checks.
- **After `store.sh`, the game port.** It opens a little after the web gateway answers, and a
  pilot chosen in between is refused as unreachable. `store.sh` waits for both now.
- **After a route is moved, read the game port's ledger for its calls** (`call-ledger.json` in the
  check BFF's data folder). A call the route made unchecked is still unchecked when the page
  makes it: the standings' two details were. Set it against the client's spelling in
  `src/gamePort/retailCalls.js` in the same unit, with every caller in the client found.
  And read what the transport already keeps of the feature before writing any keeping in
  the page: the standings' two lists were the transport's, and the page's asking is
  answered from them.
- **A read made of several calls fails as a whole for what is nobody's own failure**
  (`failsTheReading` in `web/src/bridge/ask.ts`): the pilot gone, the BFF holding none, the
  BFF not reached, the flow moved on, the web session not known. Anything the server
  answered one call with is that read's own. A flow test that has "the read fails" answer
  with a status is testing the second; one that throws from its fetch is testing the first.
- **A side-by-side that differs says at which leaves** (`standings-compare.mjs <repo> <scratch>
  <bff> <account> <characterID>` counts them): one leaf of a cached call's answer is the
  clock.
- **Something done to a pilot from outside, with its page open:** the page holds the pilot,
  so a script cannot be it too. Have a pilot of another account do it, through its own
  session on the same BFF (`give-cash.js <scratch> <bff> <account> <characterID> <toID>
  <amount>` gives ISK). Count what the page then asks with a probe set before the pilot
  was chosen; what the server pushed is in the same probe.
- **What a service of the client's keeps, the page keeps the same way** (`keptOnce` in
  `web/src/bridge/walletReads.ts`): asked once, those that want it together waiting for the
  one asking, an asking that fails not kept, and the server's notice either putting the
  new thing in or letting the old go. Where the client works a change in and that is more
  than the unit, let it go and ask again: sooner than the client, never behind it.
- **Through the gateway a cached call's answer carries the time it was made.** Two askings of
  `account.GetEntryTypes` differ in one leaf, call against call. A side-by-side that finds
  one such difference has found the clock.
- **The hangar's row for a pilot is where it was last seen**, and a store put back under it
  does not tell it. Log the pilot in to see where it is, or ask its flight status.
- **A thing kept "once" is to be tried with several asking at once.** A mark set when the
  answer is in lets everyone through who comes while the asking is out. The page asks
  thirty things together at a login now; a test of a once-only asking makes three or five
  of them in one `Promise.all` and counts what was sent. `keptReads.js` is the transport's
  own means for a thing asked once and kept, and takes its askers one at a time.
- **A page loaded twice asks the selection screen's data twice.** A pass that is to be set
  beside another is given the same number of page loads: set the browser's storage on one
  page and start the pass's count at the next load, for every pass alike.
- **Keep a run's ledgers, not their totals.** After each pass of a run that is to be set
  beside another, copy `bffgp-data/call-ledger.json`, `gateway-ledger.json` and both logs
  aside under the pass's name before anything is restarted. Two ledgers are compared call
  by call in a line of Node (each row has `pair`, `calls`, `statuses`); totals said "nine
  more" and could not say of what.
- **The whole run in fewer calls:** one that logs in and reads the windows; one that presses
  the four mission buttons; a poll of nine three-second looks at the header, called until
  it says DOCKED (some seven calls); "Complete Mission" and the wallet's Refresh; undock,
  the module and LOCK; the lock awaited and the module off; the station's row, DOCK, and
  "Log out". A probe set before the pilot is chosen counts frames, HTTP requests,
  `EventSource`s, and what was refused, by path.
- **Two sides of a closing are not done at once.** A tab that has seen its socket close may
  be a moment ahead of the BFF's own end of it: a test that acts on "it is closed" waits
  for the BFF's count of sockets to fall.
- **Whether the BFF is talking to itself:** rows of `netstat -ano` whose foreign address is
  the BFF's own port and whose owning process is the BFF's (`awk -v p=<pid> '$1=="TCP" &&
  $3=="127.0.0.1:26510" && $5==p'`). With hosted bots in process there are none; over
  loopback (`EVEJS_HOSTED_BOT_REACH=loopback`; `restart-bffgp-loopback.sh` in the
  scratchpad) there were five or six for one bot.
- **A hosted bot run for a check:** `fit-stage.js <bff> test2 140000002` (a Venture with two
  miners, through the BFF's routes; save the store first and again after staging, so that
  a second run starts from the same place), then `bot-run.mjs <repo> <bff> test2 140000002
  starter-mine-haul-cycle 15 150`.
- **A restart writes over the BFF's logs.** Copy `bffgp.out.log` and `bffgp.err.log` aside
  before restarting if a run's are to be set beside another's; their size is not what is in
  them.
- **Ask it both ways of the same app.** The test that set an answer over HTTP beside the
  same answer in process found the one that differs (a path no route has); tests of the new
  way alone had passed.
- **What a page is pushed, and which way:** `push-probe.js` in the scratchpad, pasted into
  the page after a reload and before a pilot is chosen; `window.__push` then holds the
  event stream's frames by kind as they come on a socket and by an `EventSource`, each
  `EventSource` made, and what the page sent about the stream. A request that goes on a
  socket is not a `fetch`, so a probe that wraps `fetch` does not count it (the health
  poll, with the setting on). To take the socket from under the page, keep the socket the
  `events` frame was sent on and call its `close()`.
- **A patch is a script written to a file, every time**, however small. A heredoc halves a
  doubled backslash: a `\\n` meant for a string in the file being patched went in as a line
  break, and the test file no longer loaded.
- **The breakage tool runs the tests unbroken first** and refuses if they fail ("NOT TRIED
  any of N"). Before it did, a test file that did not load "caught" every breakage.
- **A login timed in the page:** `login-probe.js` in the scratchpad, pasted into the page
  after a reload and before a pilot is chosen; `await window.__measure()` clicks the pilot's
  hangar row and says the requests over HTTP, the frames, the most outstanding at once and
  the time from the click to the last answer. It wraps `window.fetch` and
  `WebSocket.prototype.send`, so it counts whichever way the page is set. Run it more than
  once each way before saying one way is quicker: one run over HTTP took 797 ms and the
  next 525.
- **The breakage tool matches on LF** whatever line endings the source has: write the text
  to find with `\n`. And do not take `file`, `sed` or `od` in Git Bash at their word
  about a file's line endings; count `\r\n` in Node.
- **A test that stands a page up in Node** (`web/src/app/pageCarried.test.ts`): a
  `location`, a `localStorage`, a `WebSocket` and a `fetch` defined on `globalThis` in
  a file of its own, since they are the process's. It is how the page's own fetch sites are
  tested with the setting on.
- **Every pilot of every account, chosen in turn:** `every-pilot.js <scratch> <bff>
  <store.sqlite> [accounts]` (save the store first; a login brings a pilot online).
- **Both BFFs run the code they were started on.** A change to a route's answer shows through
  the game-port BFF once that is restarted, and through the gateway BFF only when that is
  restarted too: a field I had added read as nothing through it, where the new code says
  none. `restart-bffgp.sh` and `restart-bffgw.sh` in the scratchpad restart each. And the
  page is served from its build: run `npm run build:web` before a browser check of a change
  to `web/src`.
- **A script's own game-port session keeps cached answers and has nothing to name them.** The
  naming on a notice is the transport's (`pilots.js`), not the session's. A script that writes
  and reads again through a bare `GamePortSession` gets the answer from before the write: mine
  read no orders while the one it had just placed stood open, and left it open. Name the call
  by hand first, `session.invalidateCachedMethodCalls([[service, method, args]])`
  (`orders-direct.js` in the scratchpad does).
- **The gateway BFF hands on the server's cached-answer envelope; the game-port BFF hands on
  what was in it.** A script that reads a route's answer on both has to open the envelope for
  the one (`orders-of.js` in the scratchpad does, for the pilot's orders): mine read "no orders"
  through the gateway while an order stood open.
- **A test that puts a pilot in space must use the park that moves by hand.** In
  `test/gamePortPilots.test.js`, `selected({ inSpace: true })` makes a real park with a real
  timer, and the test process then never ends: a run sat until its own time limit killed it
  (2026-10-09). Build with `handTicked().options` (`selectedInSpace` does it), and give every
  `node --test` a `timeout` in front of it.
- **Do not run this repository's whole suite while a sub-agent runs eve.js's tests.** On
  2026-10-09 a full run beside one had two tests cancelled (the two HTTP provisioning tests,
  each over five seconds); both passed alone and in the next full run. The cause was not
  looked for.
- **A native module of the client's can be run and asked.** What a script hands to a module with no
  source among the scripts (`pyEvePathfinder` is `bin64/_pyevepathfinder.dll`, loaded by
  `blue.LoadExtension`) loads in the client's own Python with `imp.load_dynamic('_name', path)`
  (`scripts/py27-oracle.py`; `itertools`, `math` and `imp` are there, `random` is not). Give it
  made-up input the way the client's script gives it the real thing, and measure: the autopilot's
  route was learned this way (`scripts/build-autopilot-fixture.js`). Vary the order things are told
  to it before trusting an answer: some of its answers go by that order.
- **What the client knows without asking the server** is mostly in its built data
  (`res:/staticdata/<name>.fsdbinary`), which only the client's own loader can read
  (`bin64/<name>Loader.pyd`). `python scripts/client-built-data.py "<client>\tq\bin64" <name>Loader
  "<the file under ResFiles>"` prints a whole table as JSON; the file's place is in
  `tq/resfileindex.txt`. The BFF reads tables the same way (`src/clientData/clientBuiltData.js`,
  one line in `TABLES` for each) and serves a mission's record at
  `GET /api/client-data/missions/<contentID>`. Before asking the server for something the client
  never asks for, look for it there. The tables hold IDs and numbers; do not commit a dump.
- **Staging a pilot.** GM commands go through `POST /api/bridge/gm/slash {command, confirm:
  true}` with a pilot selected: `/tr me <stationID>` moves it, `/giveskill me <typeID> <level>`
  trains it (level 0 gives the skill untrained), `/removeskill me <typeID>` takes it away,
  `/expertsystem add|remove <typeID> me` lends and takes back a skill held by a virtual level
  (`/expertsystem list` names them), `/help` lists the rest. From the browser, send them with the page's own token
  (`sessionStorage.evejs_web_poc_session`), or a script's login takes the pilot away from the
  page. Server state the commands do not reach is in `_local/gameStore/gamestore.sqlite`, one
  table per store with `key` and `json` columns: stop the server, copy the file **and its
  `-wal` and `-shm`** aside (the server leaves the log unmerged when it stops), edit with
  `node:sqlite`, start it again.
- **A live check that stages anything is undone afterwards.** The eve.js test harness copies the
  LIVE store (`_local/gameStore`) as every test file's baseline, and its fixture pilots are the
  characters used here: Test Three (140000003) is its default pilot, Test Two (140000002) its
  second, Test Pilot (140000001) its other-account one. On 2026-10-08 a stack of Slaves, fourteen
  customs cases, three notifications and a moved character, all left by this loop's live checks,
  had 27 of its tests red, and I had logged them as the server's. So: stop the server, copy
  `gamestore.sqlite` with its `-wal` and `-shm`, start it, do the check, stop it, copy the three
  files back, start it (a restart is about twenty seconds). Run eve.js's own tests with the live
  server stopped, and before calling one "red on unchanged source", read what its failing
  assertion found and look for that in the live store.
- **When decompiled source looks odd, run the client's own compiled code.** The decompiler can
  print a block at the wrong depth, and then the source says something the client does not do
  (`agentUtil.GetMissionExpirationAndStateText`, 2026-10-08). `python scripts/client-code.py
  <client>/tq/code.ccp <module ending .pyj> <out file>` writes one module's code object to a
  file (outside the repository: it is the client's code), and a snippet for
  `scripts/py27-oracle.py` loads it with `marshal`, picks the function out of `co_consts` and
  calls it with stand-ins for what it reaches for. The script's header shows how.
- **A route written for the gateway may hand a call something the game port cannot send.** The
  gateway took JSON; the game port marshals, and a plain object is not a Python value. When a
  route's call fails with "Cannot marshal value", give the pair an entry in
  `src/gamePort/retailCalls.js` that turns the route's arguments into what the client sends.
- **Recording what the server really sends**: `scripts/record-dogma.js`, `record-probes.js` and
  `record-destiny.js` log a character in on the game port, do one thing, and keep every frame
  for a fixture. Stage the character first and undo it after (the store copy above).
- **What a class in the client is told of**: the decompiler prints `__notifyevents__` as
  numbers. `scripts/client-notify-events.py` reads the names from the compiled class.
- **The browser takes the pilot from a script.** "Bring online" in the page makes a new
  session for a pilot a script was flying on the same BFF, and the script's is gone. To stage
  from the browser's own session, catch the page's `authorization` header inside the page
  (wrap `window.fetch`, keep the value in a closure, never return it) and post with it there.
- **This server sends every free ball not massive**, the pilot's ship among them, and a station as
  a massive ball 100 km in radius that the ship undocks inside of. The client's collisions only
  run when the client makes a ball massive itself: for the step or two after it drops out of
  warp. A warp to a station at 0 is the flight that shows them.
- **The BFF's warp route is the autopilot's warp**, which lands 10 km off. For a warp to 0 send
  `minRange: 0` (`POST /api/bridge/flight/warp {destinationID, minRange: 0}`).
- **Flying the pilot through the BFF's routes from the page's own session** (see "The browser
  takes the pilot from a script") leaves the page saying "Docked" until it is reloaded. Reload,
  then read the overview.
- **The hidden browser pane is 0 pixels wide**, so the page lays itself out for a phone
  (`MobileWorkspace`: one panel at a time, the ship's line in `HudBar`). For the desktop
  layout (the floating windows over the tactical view) set a size with `resize_window`
  (1280 by 860 worked) and reload the page; put it back with the "desktop" preset after.
- **`window.confirm` answers false in the hidden pane**, so a button that asks first (Form
  fleet, Leave fleet) sends nothing when clicked. Set `window.confirm = () => true` in the
  page before the click, in the same call or one before it.
- **The page opens again whatever windows were open**, so choosing a pilot in the desktop
  layout reads every panel that was left open: one login is a read of them all, and the
  ledger of it is as wide.
- **Two pilots can be driven at once by script** (accounts `test` and `test2`, both on the
  game port with the override): that is how an invite, an acceptance and a second member's
  view were checked. Log both out before the store goes back.
- **Show-info for a thing on grid opens from the tactical view**: a right click on its
  bracket, then "Show info". The brackets are on a canvas; send `contextmenu` events across
  it a few pixels apart until the menu appears, and read which thing was picked from the
  overview's picked line.
- **A dialog by its name**: `node scripts/client-words.js "<client folder>" dialog:<Name>` says
  what kind it is and which parameters its title and body take. A dialog's parameters may be
  typed tuples, `(code, value[, value2])`, which the client turns to text first
  (`cfg.FormatConvert`). A list inside one must be sent as a list: the client reads a tuple there
  as one more typed value and raises. The bridge's JSON keeps the two apart (an array is a tuple,
  `{type: "list", items}` a list), so look at which one the server sent.
- **Copying the store aside and putting it back** is one command in the loop's scratch folder:
  `store.sh save <label>` and `store.sh restore <label>` stop EveJS, copy the three store
  files, start it and wait for the gateway. It waits on the gateway BFF (26511), so that one
  must be running. To set two transports side by side, save the staged state too, and restore
  it before each run.
- **A corporation fitting for a test pilot** (none manages its corporation's fittings):
  `corpFittingMgr.SaveManyFittings` straight to the web gateway with `corprole` in the call's
  session, which the gateway takes as given. Stock comes from `/giveitem <typeID> <amount>` on
  the BFF's GM route, into the station hangar.
- **The page's Ready Fit window keeps the pilot it was opened for.** After switching pilots,
  press "Refresh sources" before looking for a fitting in it.
- **A mission that is not a courier, for a test pilot.** A security agent offers nothing unless
  the server has a mission for its level, and it has them for levels 1 and 2 only
  (`eve.js/server/src/config/productionMissionPolicy.json`): the level 4 agent at Test Two's
  station answers a request with its greeting again. A level 1 security agent will talk from
  afar: 3011895 (in Ono, next door) offered a fighting mission to Test Two once
  `/maxagentstandings` had been run in the GM console. The loop's scratch folder has that state
  saved (`store.sh restore staged-objectives`, then put the clean one back).
- **A script that selects a pilot cannot just log out.** `POST /api/logout` answers 409
  `DRONE_RECOVERY_PENDING` until the script has said the pilot's drones are accounted for, as
  the page does: `POST /api/bridge/drone-recovery/ready {checkID}` with the
  `droneRecoveryCheckID` that select answered with (`scripts/bff-parity.js` does this). A
  script that exits without it leaves the pilot held by the BFF.
- **While a session is changing place the BFF refuses every action** (409
  `SESSION_CHANGE_IN_PROGRESS`, from the gate near the top of `src/server.js`), from the moment
  an undock, dock or jump is sent until it has settled. The server's pushes about the change
  reach the page before that. Anything the page does on such a push has to wait the refusal
  out, as the agent's window does (`whenThePilotIsFree` in `web/src/app/flow.ts`).
- **A push reaches the page on the live stream and again with the next answer** (both
  transports keep a copy for the answer as well as streaming it). On the game port the
  answer's copy carries the cursor of its stream event, and the page acts on a push once
  (`web/src/bridge/pushOnce.ts`). On the gateway the answer's copy carries none, so there
  both are still acted on: whatever acts on a push has to be harmless done twice.
- **The BFF runs one write per pilot at a time** (`CHARACTER_IN_USE`). Anything that must get
  through while a write is waiting on the server, as an answer to its question must, has to be
  let past that gate in `src/server.js`, and tested with a write in flight.
- **A call sent right behind the table of agents is answered late.** Measured 2026-10-09 in the
  server's log: the call after `agentMgr.GetAgents` was answered 50 to 80 ms after it came in
  (the registry's resolve 82 ms; the same resolve 1 ms when sent before the table, and under
  1 ms two seconds after login). Why was not looked into. What the choosing waits for is asked
  before the table.
- **A read added to the choosing on a bound object renumbers the transport tests' objects**
  (`N=1:<n>`) and lengthens their lists of binds: some thirty tests said so at once. The
  stand-in in `test/gamePortPilots.test.js` counts the corporation's registries apart
  (`N=2:<n>`) and `build()` takes the choosing's bind and calls of the registry out of the
  session's lists into `session.registryAtChoosing`. Do the same for the next service a
  choosing binds.
- **Before keeping an answer at the transport, find every reader of it in `src/`.** What the
  client keeps and corrects by notices is right for a page, and wrong for a BFF flow that
  checks one pilot's write by reading another pilot's state at once: the notice and the answer
  travel on different connections, and the kept copy can be a notice behind.
  `src/trainingOnboarding.js` reads a trainee's applications that way, so they are asked for
  each time.
- **A change to the page is in the browser only after `npm run build:web`**: the BFF serves the built
  page (`public/dist`, which git ignores). The build checks the page's types, its tests' too, and
  `npm test` does not: a test that passes can still fail the build.
- **A search's line is not the function it is in.** A listing put `if (ball.speedFraction ===
  0.0) ball.speedFraction = 1.0` sixteen lines under `followBall(`, and I wrote that a follow
  restarts a stopped ball. The line is in the function after it. Read the function before
  writing what it does.
- **A route test that fails before the change and after it is testing the stand-in.** A flight
  route answers 409 until the page's check for lost drones is acknowledged
  (`/api/bridge/drone-recovery/ready`), and that check reads the space snapshot. Print the
  answer's body before believing a failure.
- **A count is not a rate, and not a cause.** 62 `List` in a flight read as the page asking over
  and over. Set beside the server's log, nearly every one followed the server's own notice that
  an item had changed: the page asks when it is told. Before calling something polling, put
  each call beside what came just before it: `scripts/server-log-rounds.js <server log> <from>
  <to>` does that. The server's logs of earlier hours are kept beside the current one
  (`eve.js/_local/logs/server.<date>_<hour>.log`), so a "before" can be read after the fact.
- **Sort a walk's ledger by its calls.** A pair's status says its form is the client's. It does
  not say the client sends it that often: the page read the locked targets once a second, each
  reading a `GetTargets` the client sends once in a flight, and the ledger had it as "same",
  395 times. The count column is where that shows.
- **In the page's space windows:** a rack button takes a pointer going down and up, not a
  `.click()` (it tells a click from a hold); and a locked thing's row carries a mark after its
  name, so find a row with `includes`, not `startsWith`.
- **What asks a call may be the page, not the BFF.** The page's own code makes some calls through
  `/api/bridge/call`, by name (`web/src/bridge/stationPanel.ts` asks the station's three so). A
  search of `src/` alone said nothing of ours asked them, and that went into the log and had to
  be taken back. Search `web/src` too, or read the server's log of a session in the browser.
- **A fact offered in support of a decision is still a claim.** Two went into the log unchecked
  on 2026-10-08, in a paragraph arguing for a design, and both were wrong. One route call or one
  grep would have caught each.
- Tests that pass the first time have proved nothing yet. Break the code and watch them fail:
  `node scripts/break-and-check.js <source> <test> <list of [find, replacement]>` does it one
  breakage at a time and puts the file back. Commit a new source file, or at least let that
  script finish, before killing anything: a breakage that makes the tests hang once left an
  untracked file broken with its only good copy in a running process.
- In a patch script, `text.replace(find, replacement)` reads `$&`, `$1`, a dollar and a backtick,
  and a dollar and a quote inside the replacement as instructions. Pass a function:
  `text.replace(find, () => replacement)`.
- The server's character status says `retail_client` on `tcp` for a gateway session as well as
  a game-port one. To know which transport a pilot is on, read the server's log:
  `[EvejsWebGateway] Browser session started` is the gateway, `[PKT] IN` is the game port.
  `scripts/bff-parity.js` does this.
- A state asked of eve.js in flight (`UpdateStateRequest`) is not the truth to the tick. It is
  where the ships are at that moment under the stamp of the next whole second, and the server's
  one-second steps begin where the system was woken, not on the stamp's seconds. Through it a
  correct park can look a tick and a half off. `scripts/destiny-compare.js` is good for modes,
  velocities and "about a tick"; for positions to the metre use the server's own record of each
  step, `eve.js/_local/logs/space-movement-debug.log` (one file an hour, named by the hour in
  UTC), with `scripts/park-against-movement-log.js <recording> <log>`. This was read as a
  server defect once, written into a commit message, and was not one.
- The server's own ship and the stream it sends are not at the same time: in a warp its ship
  runs one to three seconds ahead of the park's, on the same path. A gap between "where the
  server has the ship" and "where the park has it" while moving is that, until shown
  otherwise; compare at rest, or read the script's `closest`.
- Time dilation is set with the server's own chat command through the GM route:
  `POST /api/bridge/gm/slash {"command": "/tidi 0.5", "confirm": true}`, and undone with
  `/tidi auto` (`/tidi` alone says the state). It is the whole system's: keep it short.
- A script of your own that opens a game-port session: `new GamePortSession({ transport })`,
  end it with `process.exit`, give it a hard exit timer, and send its output to a file. One
  that threw at its first line sat for seven minutes behind an open socket and a pipe that
  showed nothing.
- Write down what was measured. Do not write down its cause until the cause has been checked. Twice
  in this loop a cause went into a commit message and the log and had to be taken back.
- The web client in a browser tab selects its pilot again when it loses the session. Log the tab
  out before a script selects the same character, or the two take it from each other.
- Set each place of the server's answer beside the recording's, not only its form. EveJS sent
  a nought for a station guest's missing alliance and war faction where Tranquility sends None
  (fixed, eve.js `3cdc14973`). The page read both as "none", so nothing of ours showed it. Read
  through the game-port BFF, a list comes as `{type: "list"}` and a tuple as a plain array:
  that is how a tuple sent where Tranquility sends a list is seen.
- Staging for a corporation: Elysian Industries (98000000) has Test Three for its CEO and Test
  Two for a member, one office (Jita), and an empty wallet. An office in Jita costs 10,000:
  the CEO gives the corporation the ISK first (`account.GiveCash(corporationID, amount,
  reason)`). No route of the BFF rents an office or gives one up: a script's own game-port
  session sends `officeManager.RentOffice` and `UnrentOffice` by name, as the pilot docked
  there. The GM's `/tr me <stationID>` puts a pilot in a station. Save the store first.
- A pilot the page holds cannot also be a script's: the write that the page is to be seen
  answering comes from another pilot's session, so stage the two into the same station.
- A test of the transport that puts a pilot in space (`solarsystemid` on the stand-in's
  session) sets the ballpark's clock going, and the test file then never ends: every test
  passes and `node --test` hangs. To take a pilot out of a station, change `stationid` alone.
  Run a test file under `timeout 150 node --test --test-timeout=20000 ...` so that a hang
  ends by itself, and stop a run that went to the background.
- A notice told to two audiences comes twice (`OnOfficeRentalChange`: by station, and by
  corporation). Count in the recording what the client asks after it before letting the page
  ask at each telling: the lobby's offices were asked for once there, and twice by the page.
- A service becomes one whose calls go to a bound object by a line in `MONIKER_SERVICES`. Every
  other call of that service goes there too from then on, read or not: look at what the
  BFF's routes send of it first (`grep -n '"<service>"' src/server.js`).
- The contract file has two lists: what the gateway will carry (`gatewayAllowlist.pairs`) and
  what the BFF counts as a write (`bffWritePolicy.pairs`). A pair on the second alone is not
  carried by the gateway, and for the game port goes on `GAME_PORT_ONLY_CALLS`. Look in the
  file before writing which list has a pair: I wrote the wrong one of `officeManager.RentOffice`.
- A new write: `FEATURE_WRITE_METHODS` in `src/bridgeCallPolicy.js`, then `node
  scripts/build-bridge-contract.js --write`, then `test/bridgeCallPolicy.test.js`, which lists
  the feature writes and counts all of them.
- The pilot interface is the gateway client's nine functions, and a test holds it to them.
  What the BFF needs of a game-port session beside them rides the flight's status and is
  taken off in `readHeldFlight` before the page sees it (`corpRole`).
- Run the whole suite before the live check, not after it. The files I had touched were green
  and a list test elsewhere was red, unseen until the staging was undone.
- The login report is made again in two steps, both in the scratch folder: `login-only.js <bff>
  <account> <characterID> <server log> 8` prints the server log's lines for a bare login, and
  `login-report.js <repo> <eve.js logs dir> <from> <to>` writes the report from them (the
  retail log's own lines, 278 to 743, are in it). A scratch folder that has neither: the retail
  log is `direct-tcp-real-client-20260809-163920.stdout.log`, learnt from with
  `server.2026-10-06_15.log`. Do it away from the turn of the hour, when the server's log rolls.
- A call added to the choosing of a character breaks the transport's tests that count a
  choosing's calls. Two lists at the top of `test/gamePortPilots.test.js` hold most of them to
  it (`CHOSEN_ASKS`, `CHOSEN_LAST`); the rest count one service's calls and want the new one
  let through. A stand-in that holds back the first answer of something now asked at the
  choosing hangs the choosing: hold back the second.
- **Never put a time limit round the breakage tool.** `break-and-check.js` puts the source back
  when it ends, and a tool that is killed does not end: a `timeout 590` round it left one
  breakage in `pilots.js`. A breakage that hangs a choosing costs up to two minutes, so thirty
  can outlast one command: give the tool at most four of a file at a time
  (`pairs.slice(n, n + 4)`), compare `git diff --stat` before and after every part, and if they
  differ, match the source against the list (each `find` must be there once) to see which is
  left.
- A bind the choosing of a character now makes shifts every test that holds a session to its
  exact binds and objects. The transport's stand-in session lists and counts apart what every
  choosing binds (the corporation registry's objects, crimewatch's Monikers): put a new one
  there, with a line saying why, rather than telling fifty tests of it.
- **Putting a source file back to an earlier commit destroys what is not committed in it.**
  `git show HEAD:<file> > <file>` followed by `git checkout HEAD -- <file>` gives back the
  commit's file, not yours: I lost seven files' uncommitted work that way and had it back only
  because every change had been made by a script kept in the scratch folder. Check a test
  against the code as it was only after the work is committed (`HEAD~1`), or copy the files
  aside first. And keep making changes by script: it is what made the loss an hour's and not a
  day's. A lost page can be checked against the last build: `sha1sum public/dist/assets/*`
  before and after building again.
- **The page's floating windows are over everything in the workspace.** They are in a layer of
  their own (`.global-layer`, fixed, above the workspace), and the workspace is fixed too, so
  no `z-index` inside it reaches over them: a menu under the header opened underneath a
  window. What must not be covered is a popover of the browser's (`popover="auto"` and a
  button with `popovertarget`, placed from the button's rectangle as it opens:
  `web/src/ui/SafetyChooser.svelte`). Check a new menu live with
  `document.elementFromPoint` at a few of its points: the menu must be what is there.
- **Search `src/server.js` for a method's name before writing that no route sends it.** I
  wrote that `SetSafetyLevel` had no route; it had had one since the plumbing sweep.
- **A flow's request answered after its pilot has gone is thrown by the flow itself**
  (`SESSION_REQUEST_RETIRED`, the guard every request of a pilot's has). A flow function
  needs no check of its own for that, and one written is dead code that no test can reach.
- **No solar system of this server's data is at 0.95 security or above** (the highest is
  0.949794; the systems that were 1.0 are 0.949). What the client does only in the safest
  class of security cannot be seen live here.
- **`git diff --stat` does not see a new file.** After a breakage pass over one, compare it
  with its copy in the scratch folder (keep one: write a new file there and copy it in).
- **A combat timer is one GM command away, in space.** `/cwatch npc 40` (or `weapon`, `pvp`,
  `suspect`, `disapproval`; `/cwatch clear` ends them all; `/cwatch status` says them) through
  `POST /api/bridge/gm/slash`. The server tells a pilot in space of each timer and of each
  ending, and a docked pilot of nothing. The reply's own seconds are not the timer's (it said
  53 for 40): time what the notice says. `cwatch-walk.js` in the scratch folder undocks a
  pilot, runs a list of them and prints each notice and the route's answer after it.
- **A promise nobody waits for must not be able to fail.** Node ends the process at a
  rejection nobody handles, and the BFF with it. What a notice sets going at the transport is
  not awaited: `keptReads.amend` catches what its change throws, and lets the answer go.
- **The same walk on the code before and on the code after, printed and compared,** shows
  what a change of keeping did and did not alter: `diff` of the two printouts with the times
  taken out. The walk made before the change is also where the fixture comes from.
- **The server is an alpha clone's with one variable.** `EVE_CLONE_GRADE=alpha bash store.sh save
  <label>` in the scratch folder saves the store and starts EveJS answering an alpha's grade
  to every account (the start script hands on the shell's environment); `env -u EVE_CLONE_GRADE
  bash store.sh restore <label>` puts both back. `GET /api/bridge/clone-grade` through the
  game-port BFF says which it is.
- **A call the login makes before the character selection is listed apart in the transport's
  tests** (`session.gradeAsks` in the stand-in of `test/gamePortPilots.test.js`, with how many
  calls by name went before it). Some thirty tests hold `session.calls` to the selection's
  three and what follows: put the next such call apart too, with a line saying why.
- **A render on the server never opens a popover or a menu.** What a component hands to a
  child it only draws once opened is held by no render test: say so in the log, keep those
  lines to plain handing-on, and see them work in the browser.
- **"Next" is not the plan.** By 2026-10-10 the log's Next had sixty-one items, all of them a
  feature's calls, and neither of the plan's two unfinished phases (the cutover and the one
  WebSocket), though both are conditions of "done". At the start of an iteration read the
  plan's "Done when" lines and their status as well as Next, and keep the plan's next
  unfinished phase at the head of Next.
- **What the BFF asks the web gateway is tallied** (`src/gatewayLedger.js`), and is the measure
  of the cutover. A check BFF writes it to `<name>-data/gateway-ledger.json` every two seconds;
  `ledger-show.js <file>` in the scratch folder prints it by kind, and `node
  scripts/gateway-ledger-report.js <file> "<what was walked>"` writes
  `docs/game-port-gateway-ledger.md`. Restart the BFF for an empty tally. A row under `pilot`
  on the game-port BFF is a held pilot's call that went to the gateway: news.
- **A patch through a shell heredoc that has backticks in it is mangled** (again, 2026-10-10:
  the script failed to parse, and nothing was changed). Write the script with the Write tool,
  or change a scratch copy with the Edit tool and copy it in.
- **Take the store's copy before a walk that moves a pilot, even one that stages nothing.** I
  undocked and docked Test Pilot for a measure with none taken.
- **A saved bot is run on the server from a script by the page's own start.** `node
  bot-run.mjs <repo> <bff> <account> <characterID> <scriptID> [minutes] [seconds to watch]` in
  the scratch folder imports `web/src/bots/startRun.ts`, prints the approval the page would
  ask for, makes the grant, starts the bot, prints each change of its state, and stops it when
  the time is up. A start with no grant is refused (`BOT_GRANT_REQUIRED`).
  `botscripts-list.js` lists a BFF's saved bots. Save the store first: a bot moves its pilot.
- **Run the same thing through both BFFs before believing either.** "Belt empty" four times
  read as an empty system until the same bot through the gateway found a rock at the first
  belt. A difference between the transports is a fault of ours until shown otherwise.
- **Every live check in space had been at a station or a gate.** Nothing had been to a belt on
  the game port, and no test had a rock in it, so a snapshot with no rock a bot could use
  passed everything. When a feature works on things of a kind (rocks, wrecks, drones, clouds),
  go where one is.
- **A mining ship for Test Two is one script away.** `cd <scratch> && node fit-stage.js <bff>
  test2 140000002` gives a Venture, boards it and fits two Miner I and an afterburner through
  the BFF's own routes. Save the store before it, and the staged state after it under another
  label, and restore the staged one before each transport's run. `ore-read.js` reads the ore
  hold after a run; five minutes of two lasers is some 870 m³.
- **When one field of the gateway's answer is found missing from ours, read the whole of both
  makers.** The rock's was one of four gaps in the space snapshot's rows; the other three were
  found in ten minutes by setting `projectSpaceEntity` (eve.js,
  `evejsWebGatewayRuntime.js`) beside `projectEntity` (`spaceProjection.js`), not by walking.
- **On the game port, what a call changes in space is not there when the call answers.** The
  gateway reads the server's scene; a pilot on the game port reads its own park, which the
  next ballpark update changes. A route that calls and then reads the snapshot to say what
  happened (a launch, a scoop, a jettison) reads the park from before. The launch waits for
  its drones (`DRONE_ARRIVAL_WAIT_MS` in `src/server.js`); look at each route of that shape.
- **Drones for Test Two:** after `fit-stage.js`, `node drone-stage.js <scratch> <bff> test2
  140000002` gives two Hobgoblin I and puts them in the Venture's bay; `drone-walk.js`
  undocks, launches them and prints each drone's row. A pilot who logs off in space with
  drones out has none on grid when it comes back.
- **A rule read out of the client is set beside the server's own data before it is believed.**
  A live check sees what the server happens to put in front of the pilot. The NPC kinds were
  the same on both transports at two gates and wrong for 142 of the server's 5794 profiles,
  which a script that walked `listNpcProfiles()` (`eve.js/server/src/space/npc/npcData.js`)
  showed in a second. Where the server has a table of every case, walk the table.
- **An NPC put out for a check:** undock, warp to a planet (away from a station's and a gate's
  guns), then `/npc 1 <profileID>` through `/api/bridge/gm/slash`; `npc-spawn-walk.js` does
  the whole of it and prints each ship's row. The ship put out goes for the pilot, so read
  the snapshot at once, and put the store back after. `test/fixtures/destinyJump.json` has
  fifteen of the law's ships with their slim items as this server sent them.
- **The page has "Log out" only while docked.** A browser check that ends in space docks first.
  A hostile ship put out beside the pilot kept it from warping off (2026-10-10), so put one
  out last, and if the pilot cannot dock: remove `evejs-web-online-pilots:v1` from the page's
  `sessionStorage`, put the store back, restart both BFFs, load the page again and read that
  nobody is in ("In client 0").
- **A compressing ship for a check:** `compress-stage.js <scratch> <bff> <account> <charID>
  <out.json>` gives a docked pilot a Porpoise, the core, the ore compressor and heavy water
  (300: more does not fit the hold), fits, undocks, starts both and prints the own ship's
  row at each step; `compress-dock-stage.js` stops docked with 50 Scordite aboard, for the
  page. A ship with its core running cannot dock for the core's cycle.
- **A module's button on the page's rack wants the pointer, not a click.** From a script:
  dispatch `pointerdown` then `pointerup` (PointerEvent, bubbling) on
  `button.module-slot.filled`; its `title` says whether the module is active.
- **Read the game port's shaping of a call before changing what the page sends.**
  `src/gamePort/retailCalls.js` already makes many of the page's words the client's: a
  module's -1 becomes the client's 1000 or 0 by whether the effect can repeat, and an effect
  not named is named as godma knows the module. On 2026-10-14 the page was made to send
  1000 itself, which went past the 0 for an effect that cannot repeat, and the next unit
  put it back. Look at the call's entry there (`grep -n '"<service>.<method>"'`) and its
  shaping function first.
- **A value copied from an old note of ours is a guess until it is measured again.** The
  compressor's range in a July note was 375,000 m; the server gave 66,000 m.
- A test's "watched to fail" can be had after the fact, once the work is committed: put the source file back to the commit
  before (`git show HEAD~1:<file> > <file>`), run the test, and restore it with `git checkout
  HEAD -- <file>`. Check `git status` is clean after.

## When to stop

Stop the loop, with a summary in the log and in your last message, when either is true:

**It is done.** All of:

1. Every phase of the plan has met its "done when", and the plan says so.
2. A pilot never touches the web gateway: the only gateway calls left are the account-level ones
   the plan lists.
3. The browser reaches the BFF without `/api/bridge/*` routes or an event stream of its own.
4. Each feature the web client has makes the calls its retail counterpart makes.
5. This run passes twice in a row from a cold server start, in the browser, on the game port, with
   the evidence in the log: log in, select a character, read inventory, fitting, wallet, market,
   skills, mail and chat while docked; accept a courier mission; undock; warp, jump a gate and dock
   by autopilot with the overview drawn from our own ballpark; deliver and complete the mission;
   lock a target and cycle a module; log off.

**Or you are stopped**: every remaining unit needs something only the operator can give. Say
exactly what, and what you recommend.

Do not stop because a phase ended, because a unit was hard, or to report progress. The log is the
progress report. Stop any server you started when the loop ends.
