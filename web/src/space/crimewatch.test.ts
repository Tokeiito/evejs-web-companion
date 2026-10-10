// The safety level and the combat timers, as the page says them.
//
// The fixture is this server's own answer to crimewatch.GetClientStates for a pilot with nothing running, as the
// BFF hands it on (read 2026-10-10 through the game-port BFF): five timers, each (state, expiry); the
// engagements; who is flagged; the safety level. The states with a timer running are the client's own
// (crimewatch/const.py): the idle state of each kind, plus 1 while the cause goes on, plus 2 while it counts down.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeClientStates } from "../bridge/boundCrimewatch.ts";
import { crimewatchTimers, filetimeToMs, safetyBadge, safetyChoices, safetyLockedToFull, safetyPress, timerText } from "./crimewatch.ts";

const aSet = (...items: number[]) => ({ type: "objectex1", header: [{ type: "token", value: "__builtin__.set" }, [{ type: "list", items }]], list: [], dict: [] });
const QUIET = [[[100, null], [200, null], [400, null], [300, null], [500, null]], { type: "dict", entries: [] }, [aSet(), aSet()], 2];
/** A server's clock time as the wire has one: 100 ns ticks since 1601. */
const filetime = (ms: number) => ({ type: "long", value: String(BigInt(ms) * 10000n + 116444736000000000n) });
const NOW = Date.UTC(2026, 9, 10, 3, 0, 0);
const states = (timers: unknown[], safety = 2) => decodeClientStates([timers, { type: "dict", entries: [] }, [aSet(), aSet()], safety] as never);

test("a pilot with nothing running has no timer to show", () => {
  assert.deepEqual(crimewatchTimers(decodeClientStates(QUIET as never), NOW), []);
  assert.deepEqual(crimewatchTimers(null, NOW), []);
});

test("a server's clock time is read to the millisecond, and what is no time is none", () => {
  assert.equal(filetimeToMs(String(BigInt(NOW) * 10000n + 116444736000000000n)), NOW);
  assert.equal(filetimeToMs("116444736000000000"), 0);
  for (const none of [null, "", "x", "12.5"]) assert.equal(filetimeToMs(none), null, String(none));
});

test("each timer is named for its kind, in the order the client holds them, with what is left of it", () => {
  const running = states([
    [102, filetime(NOW + 42_000)],
    [202, filetime(NOW + 14 * 60_000 + 20_000)],
    [402, filetime(NOW + 4 * 60_000 + 59_000)],
    [304, filetime(NOW + 15 * 60_000)],
    [502, filetime(NOW + 5_000)],
  ]);
  assert.deepEqual(crimewatchTimers(running, NOW), [
    { kind: "weapons", word: "Weapons", phase: "timer", remainingMs: 42_000 },
    { kind: "pvp", word: "PvP", phase: "timer", remainingMs: 860_000 },
    { kind: "npc", word: "NPC", phase: "timer", remainingMs: 299_000 },
    { kind: "criminal", word: "Suspect", phase: "timer", remainingMs: 900_000 },
    { kind: "disapproval", word: "Disapproval", phase: "timer", remainingMs: 5_000 },
  ]);
  // The fourth timer is the criminal's or the suspect's, by its state.
  assert.deepEqual(crimewatchTimers(states([[100, null], [200, null], [400, null], [303, filetime(NOW + 1000)], [500, null]]), NOW).map((timer) => timer.word), ["Criminal"]);
  assert.deepEqual(crimewatchTimers(states([[100, null], [200, null], [400, null], [301, null], [500, null]]), NOW).map((timer) => [timer.word, timer.phase]), [["Criminal", "active"]]);
  assert.deepEqual(crimewatchTimers(states([[100, null], [200, null], [400, null], [302, null], [500, null]]), NOW).map((timer) => [timer.word, timer.phase]), [["Suspect", "active"]]);
  assert.deepEqual(crimewatchTimers(states([[100, null], [200, null], [400, null], [305, null], [500, null]]), NOW).map((timer) => [timer.word, timer.phase]), [["Criminal", "inherited"]]);
  assert.deepEqual(crimewatchTimers(states([[100, null], [200, null], [400, null], [306, null], [500, null]]), NOW).map((timer) => [timer.word, timer.phase]), [["Suspect", "inherited"]]);
});

test("a timer whose cause goes on has no time left to count, and one that has run out is gone", () => {
  // The weapons' timer while a weapon is still firing: the state says so, and there is no expiry.
  const firing = crimewatchTimers(states([[101, null], [201, null], [400, null], [300, null], [500, null]]), NOW);
  assert.deepEqual(firing, [{ kind: "weapons", word: "Weapons", phase: "active", remainingMs: null }, { kind: "pvp", word: "PvP", phase: "active", remainingMs: null }]);
  // Inherited from another's doing: shown, with what is left where the server says when it ends.
  assert.deepEqual(crimewatchTimers(states([[103, filetime(NOW + 3000)], [200, null], [400, null], [300, null], [500, null]]), NOW), [{ kind: "weapons", word: "Weapons", phase: "inherited", remainingMs: 3000 }]);
  // Counting down to a time that has passed: the server has not said it is over yet, and nothing is left to show.
  assert.deepEqual(crimewatchTimers(states([[102, filetime(NOW - 1)], [202, filetime(NOW)], [400, null], [300, null], [500, null]]), NOW), []);
  // Inherited, or going on, with an end the server gave that has passed: shown still, with nothing left to count.
  assert.deepEqual(crimewatchTimers(states([[103, filetime(NOW - 5000)], [201, filetime(NOW - 1)], [400, null], [300, null], [500, null]]), NOW),
    [{ kind: "weapons", word: "Weapons", phase: "inherited", remainingMs: null }, { kind: "pvp", word: "PvP", phase: "active", remainingMs: null }]);
  // A state that is no state of its kind's is not shown as one.
  assert.deepEqual(crimewatchTimers(states([[999, null], [0, null], [407, null], [300, null], [500, null]]), NOW), []);
});

test("what is left of a timer reads as minutes and seconds, rounded up, and a timer that only goes on reads as its word", () => {
  assert.equal(timerText({ kind: "weapons", word: "Weapons", phase: "timer", remainingMs: 42_000 }), "Weapons 0:42");
  assert.equal(timerText({ kind: "pvp", word: "PvP", phase: "timer", remainingMs: 860_000 }), "PvP 14:20");
  assert.equal(timerText({ kind: "npc", word: "NPC", phase: "timer", remainingMs: 1 }), "NPC 0:01");
  assert.equal(timerText({ kind: "npc", word: "NPC", phase: "timer", remainingMs: 59_001 }), "NPC 1:00");
  assert.equal(timerText({ kind: "criminal", word: "Criminal", phase: "active", remainingMs: null }), "Criminal");
});

test("the safety level is said in a word, and what is no level is not said at all", () => {
  assert.deepEqual([safetyBadge(decodeClientStates(QUIET as never)), safetyBadge(states([], 1)), safetyBadge(states([], 0))], [
    { level: 2, word: "Full", tone: "full" }, { level: 1, word: "Partial", tone: "partial" }, { level: 0, word: "None", tone: "none" },
  ]);
  for (const level of [3, -1]) assert.equal(safetyBadge(states([], level)), null, String(level));
  assert.equal(safetyBadge(null), null);
});

// ── the selector ─────────────────────────────────────────────────────────────
//
// shipSafetyButton.py: three buttons, None, Partial and Full. One lower than the level now wants a second press;
// any other is set at once. Where the level is held at Full (crimewatchSvc.IsSafetyLockedToFullLevel: a system
// of the safest class of security, 0.95 and above by eveuniverse/security.py) only Full can be pressed, and Full
// is the level shown whatever the server said.

test("the safety level is held at Full in a system of the safest class of security, and nowhere else", () => {
  for (const [security, held] of [[1, true], [0.95, true], [0.9499, false], [0.9, false], [0.5, false], [0.45, false], [0.2, false], [0, false], [-0.4, false]] as const) {
    assert.equal(safetyLockedToFull(security), held, String(security));
  }
  // A system whose security is not known yet holds nothing.
  assert.equal(safetyLockedToFull(null), false);
});

test("where the level is held at Full the level shown is Full whatever crimewatch said, and what said no level still shows none", () => {
  for (const said of [0, 1, 2]) {
    assert.deepEqual(safetyBadge(states(QUIET[0] as unknown[], said), true), { level: 2, word: "Full", tone: "full" }, String(said));
  }
  assert.deepEqual([safetyBadge(states(QUIET[0] as unknown[], 1), false)?.word, safetyBadge(states(QUIET[0] as unknown[], 1))?.word], ["Partial", "Partial"]);
  assert.deepEqual([safetyBadge(null, true), safetyBadge(states(QUIET[0] as unknown[], 7), true)], [null, null]);
});

test("the selector has the three levels in the client's order, the level now marked and the lower ones wanting a second press", () => {
  const brief = (current: 0 | 1 | 2, held = false) => safetyChoices(current, held).map((choice) => [choice.level, choice.word, choice.tone, choice.selected, choice.confirms, choice.locked]);
  assert.deepEqual(brief(2), [[0, "None", "none", false, true, false], [1, "Partial", "partial", false, true, false], [2, "Full", "full", true, false, false]]);
  assert.deepEqual(brief(1), [[0, "None", "none", false, true, false], [1, "Partial", "partial", true, false, false], [2, "Full", "full", false, false, false]]);
  assert.deepEqual(brief(0), [[0, "None", "none", true, false, false], [1, "Partial", "partial", false, false, false], [2, "Full", "full", false, false, false]]);
  // Held at Full: the two others are locked, and Full is not.
  assert.deepEqual(brief(2, true).map((row) => row[5]), [true, true, false]);
  // Each says what it lets the ship do, and no two say the same.
  const says = safetyChoices(2, false).map((choice) => choice.says);
  assert.equal(new Set(says).size, 3);
  for (const said of says) assert.match(said, /^The ship refuses /);
});

test("a press sets a level at once unless it is lower than the level now, which waits for a second press", () => {
  const press = (current: 0 | 1 | 2, confirming: 0 | 1 | 2 | null = null, held = false) => safetyChoices(current, held).map((choice) => safetyPress(choice, confirming));
  // From Full, both others are lower; Full itself is set again at once, as the client sets it.
  assert.deepEqual(press(2), ["confirm", "confirm", "set"]);
  assert.deepEqual(press(1), ["confirm", "set", "set"]);
  assert.deepEqual(press(0), ["set", "set", "set"]);
  // While one waits to be confirmed, no button of the selector answers: not the one waiting, not a higher one.
  assert.deepEqual([press(2, 0), press(2, 1), press(1, 0)], [["nothing", "nothing", "nothing"], ["nothing", "nothing", "nothing"], ["nothing", "nothing", "nothing"]]);
  // Held at Full: only Full answers.
  assert.deepEqual(press(2, null, true), ["nothing", "nothing", "set"]);
});
