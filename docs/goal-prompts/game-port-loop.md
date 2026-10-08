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

The route is already planned and partly walked. Phases 0 to 2 are complete: there is a game-port
session that logs in and stays connected as the retail client does, and a measured answer to "can
the browser's decoders read what the game port sends". What remains is moving the pilot off the
web gateway and onto that session, giving it a ballpark in space, and then moving the client's
logic into the browser.

## Read these first, every iteration

| File | What it holds |
|---|---|
| `docs/game-port-loop-log.md` | **The loop's own journal. Its last entry says what to do next.** |
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
4. **Prove it**, in this order: a test that you have watched fail; the whole suite; the real thing
   against the running server. A unit that touches what the browser shows is proven in the
   browser. Say what you saw, with the output.
5. **Commit it and push it.** Web changes in `evejs-web-poc`; server fixes are a separate matter
   (below).
6. **Write the log entry**: what was done, the evidence, the commit, any decision you took in the
   operator's place, and what is next. Update the plan's status when a phase's "done when" is met.
7. **Go straight on to the next unit.** There is nothing to wait for between units.

## Where the truth is

Consult in this order. When two disagree, a recording of the real thing settles it.

1. **The decompiled client**: `eve.js/tools/ClientCodeGrabber/Latest` (and `ClientCodeGrabberV2`).
   What the client does and when. Decompile more with those tools when a module is missing.
2. **CCP's own source, on this machine** under `C:\Users\ryanf\Documents\GitHub`:
   `destiny` (the ballpark simulation the client runs: `Ball.cpp`, `Ballpark.cpp`), `blue` (the
   marshaller, `src/Marshal.cpp`, and the Python runtime glue), `io` (socket I/O and compression),
   `core`, `fsd`, `trinity`. For anything in space, `destiny` is the specification: port it, do not
   approximate it.
3. **The client install**: `D:\EVE Online - 3396210 - Copy\tq`. Its `python27.dll` answers
   questions about Python itself (`scripts/py27-oracle.py`). Its other binaries can be decompiled
   when neither of the above answers.
4. **The EveJS server source**, `eve.js/server/src`: what the server accepts and sends.
5. **The server's logs**, `eve.js/_local/logs`: real client sessions by call name, handshake
   details, and `[PKT] ERR` lines, which are the only trace when a call answers None.

Tools already built for this: `scripts/capture-game-frames.js` (record a conversation as a
fixture), `scripts/record-game-port.js` (record any client), `scripts/parity-harness.js`,
`scripts/soak-game-session.js`, `scripts/py27-oracle.py` with `scripts/build-py27-fixture.js`,
`scripts/vendor-marshal.js`.

## What you may do

The operator has given the run of this machine for this work (2026-10-08):

- Start, stop and restart the EveJS server. Reset game data. Edit the database. Stage whatever a
  test needs. Use Docker if it helps.
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
  booting, work on what needs no server and look again next iteration.
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
  an iteration, make sure no command of yours is still running.
- **The browser pane is hidden, and a hidden page stops polling space**, so the autopilot and
  anything else that decides from the space feed does nothing there. Before selecting a pilot,
  tell the page it is visible: redefine `document.visibilityState` (to `"visible"`) and
  `document.hidden` (to `false`) in the page and dispatch a `visibilitychange` event. Do it again
  after every reload. Dispatch a click in one call and read the result in the next.
- **The server's log stamps an outgoing client call late.** `[PKT] OUT agents YesNo()
  client-call` carried the time the answer arrived, seconds after the question was on the page.
  Do not time the server by that line; time what the client saw.
- **A breakage that was "not tried" proves nothing.** `scripts/break-and-check.js` says NOT TRIED
  when the text to find is not in the file, and a shell heredoc halves the backslashes in a list
  of them, so a regular expression is never found. Write breakage lists with the Write tool, and
  read the count: caught plus survived must equal the total.
- **The client's own text for a label**: `node scripts/client-words.js "<client folder>" <label>`
  says whether the client has it and which parameters it takes. Look there before wording a
  label or sending one's parameters; two guesses of mine on 2026-10-08 were wrong. The check
  BFFs get the client's folder through `EVEJS_CLIENT_ROOT`. Do not copy the client's text into
  the repository: fixtures use made-up text in the real shape.
- **Staging a pilot.** GM commands go through `POST /api/bridge/gm/slash {command, confirm:
  true}` with a pilot selected: `/tr me <stationID>` moves it, `/giveskill me <typeID> <level>`
  trains it, `/help` lists the rest. From the browser, send them with the page's own token
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
- **A dialog by its name**: `node scripts/client-words.js "<client folder>" dialog:<Name>` says
  what kind it is and which parameters its title and body take. A dialog's parameters may be
  typed tuples, `(code, value[, value2])`, which the client turns to text first
  (`cfg.FormatConvert`). A list inside one must be sent as a list: the client reads a tuple there
  as one more typed value and raises. The bridge's JSON keeps the two apart (an array is a tuple,
  `{type: "list", items}` a list), so look at which one the server sent.
- **The BFF runs one write per pilot at a time** (`CHARACTER_IN_USE`). Anything that must get
  through while a write is waiting on the server, as an answer to its question must, has to be
  let past that gate in `src/server.js`, and tested with a write in flight.
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
  step, `eve.js/_local/logs/space-movement-debug.log`. This was read as a server defect once,
  written into a commit message, and was not one.
- Write down what was measured. Do not write down its cause until the cause has been checked. Twice
  in this loop a cause went into a commit message and the log and had to be taken back.
- The web client in a browser tab selects its pilot again when it loses the session. Log the tab
  out before a script selects the same character, or the two take it from each other.

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
