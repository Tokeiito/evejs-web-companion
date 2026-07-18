# Goal G3: Fix the agent-mission remote-acceptance parity oracle (eve.js track)

**Issued:** 2026-07-18 by the orchestrator session. **Track:** this is an **eve.js emulator/parity goal**, not web-client work — hand it to an eve.js-focused session. It gates web Goal R4 (browser courier accept/complete needs a trustworthy oracle). **Status:** Ready to run; independent of R1/R1b (different files — coordinate commits, don't clobber).

You are a worker session. Repos: `C:\Users\ryanf\Documents\GitHub\eve.js` (branch `main`, the only repo you commit to) and, for context only, `C:\Users\ryanf\Documents\GitHub\evejs-web-poc\docs\retail-call-inventory.md` (gap G3, baseline note). Follow eve.js's own test conventions (`doc/TEST_RULEBOOK.md`) and parity-workflow norms; other agents are active in this repo.

## Objective

Make `npm run test:agent-parity` pass 6/6 files **honestly** — resolve the 4 failing assertions in `server/tests/agentMissionRuntime.test.js`, which orchestrator review (2026-07-18) diagnosed as **test-side bugs**, after validating that diagnosis yourself.

## The diagnosis to validate (do not take it on faith)

All four failures are in the remote-accept feature area, introduced 2026-07-17 in commit `ed442548` ("feat(agent): enable remote accept/complete of agent missions") and have plausibly never passed:

1. **Tests at `:3487`, `:3524`, `:3560`** assert strict booleans (`assert.equal(x, true/false)` under `node:assert/strict`) against journal-row flags the runtime deliberately emits as `1`/`0` integers: `buildMissionJournalRow` writes `isMissionRemoteOfferable(...) ? 1 : 0` and `isMissionRemoteCompletable(...) ? 1 : 0` at row indexes 7/8 (`server/src/services/agent/agentMissionRuntime.js:4950-4954`), consistent with the row's established convention (`importantMission` at `:4944` is also `? 1 : 0`, and no test asserts it as boolean). **Semantics agree in every case** — fetch → 1 vs `true`, encounter → 1 vs `true`, courier → 0 vs `false`.
2. **Test at `:3594`** ("a remote accept for an in-person-only courier mission is refused and left offered") checks `actionTuple[0]` for `AGENT_DIALOGUE_BUTTON_ACCEPT` (3), but the action tuple layout is `[token, buttonID]` — index 0 is the dialogue token (816-823 range; constants at `agentMissionRuntime.js:97`, `:108`, tuple built at `:6611-6615`). Every sibling assertion in the file uses `actionTuple[1]`. The runtime's refusal behavior is correct (`:6874-6887` returns the offered conversation without accepting). Because the test aborts at `:3594`, its trailing "left offered" assertions (`:3600-3606`) have never executed — after your fix, confirm they pass too.

## Required work

1. Reproduce: run `npm run test:agent-parity`; confirm exactly the 4 failures above (baseline: 5/6 files, `agentMissionRuntime.test.js` 45/49).
2. **Adjudicate int-vs-bool with wire evidence before editing anything**: check what the retail wire actually carries for the journal `remotelyAcceptable`/`remotelyCompletable` columns — the golden logs/captures behind commit `4ab70e50` ("golden-driven mission UI parity") and/or the decompiled client's consumption of `GetMyJournalDetails` rows (`tools/ClientCodeGrabber/Latest`, e.g. `journal.py` — note Python truthiness makes `1`/`True` interchangeable client-side). Record what you find in the commit message.
   - If evidence says integers (expected): fix tests `:3487`/`:3524`/`:3560` to assert `1`/`0`.
   - If evidence genuinely says booleans: change the runtime's two emit sites instead (and `importantMission` for consistency) — a deliberate, evidence-backed parity fix, not a mechanics change; say so in the commit message.
3. Fix test `:3594` to check `actionTuple[1]` (the button ID), matching its siblings. Verify the trailing "left offered" assertions now execute and pass; if they reveal a real runtime defect, **stop and report** rather than papering over it.
4. Run `npm run test:agent-parity` (expect 6/6) and `npm run test:manifest:check` (expect 3/3).
5. Commit in eve.js — tightly scoped (the test file, plus runtime emit sites only in the boolean-evidence branch), e.g. `fix(agent-parity): correct remote-acceptance oracle assertions`. Report the hash. Do **not** push.

## Out of scope

- Any web-repo change (the orchestrator updates the web roadmap/inventory G3 status at review).
- Any mission-mechanics behavior change beyond the narrow evidence-backed flag-encoding branch in step 2.
- The R4-era design question of whether a docked-at-agent's-station browser session counts as in-person — noted in the inventory's Direction section; not this goal.

## Constraints

- Other agents are active in eve.js: keep the change small and self-contained; never revert, reset, or clobber others' work or uncommitted changes; if the test file has work in flight, pause and surface it.
- Never start or stop servers/processes you did not start. Preserve all unrelated worktree changes. Never push.
