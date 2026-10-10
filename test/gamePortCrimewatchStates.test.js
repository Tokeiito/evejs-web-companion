"use strict";

// Crimewatch's client states, changed as the retail client's crimewatch service changes what it keeps
// (crimewatchSvc.py 222 to 288): each of the server's notices changes one thing, and nothing is asked.
//
// The states and the notices of "the walk" are this server's own, read through the game-port BFF on 2026-10-10
// as a pilot in space had the GM's command set each timer and let it run out: the answer to GetClientStates
// after each notice is what the notice must leave. Tranquility's recordings have the NPC timer's three forms,
// (400, None), (401, None) and (402, a long), and the criminal flags' notice as three sets where this server
// sends three tuples.

const test = require("node:test");
const assert = require("node:assert/strict");

const { CLIENT_STATE_NOTICES, ENGAGEMENT_ONGOING, statesAfter } = require("../src/gamePort/crimewatchStates");

/** A Python set as the wire has one. */
const set = (...items) => ({ type: "objectex1", header: [{ type: "token", value: "__builtin__.set" }, [{ type: "list", items }]], list: [], dict: [] });
const dict = (...entries) => ({ type: "dict", entries });
const IDLE = [[100, null], [200, null], [400, null], [300, null], [500, null]];
/** The server's answer for a pilot with nothing running; `more` puts something else in a place. */
const states = (more = {}) => [
  "timers" in more ? more.timers : IDLE.map((timer) => [...timer]),
  "engagements" in more ? more.engagements : dict(),
  "flagged" in more ? more.flagged : [set(), set()],
  "safetyLevel" in more ? more.safetyLevel : 2,
];
const timersWith = (changed) => IDLE.map((timer, place) => changed[place] ?? timer);
const PILOT = 140000002;

test("the notices that change what crimewatch keeps are the client's eleven", () => {
  assert.deepEqual([...CLIENT_STATE_NOTICES].sort(), [
    "OnCrimewatchEngagementCreated", "OnCrimewatchEngagementEnded", "OnCrimewatchEngagementStartTimeout", "OnCrimewatchEngagementStopTimeout",
    "OnCriminalTimerUpdate", "OnDisapprovalTimerUpdate", "OnNpcTimerUpdate", "OnPvpTimerUpdate", "OnSystemCriminalFlagUpdates", "OnSystemDisapprovalFlagUpdates", "OnWeaponsTimerUpdate",
  ]);
});

test("each timer's notice sets that timer's state and expiry, and leaves every other place as it was", () => {
  const until = 134360781425000000n;
  for (const [notice, place, idle] of [["OnWeaponsTimerUpdate", 0, 100], ["OnPvpTimerUpdate", 1, 200], ["OnNpcTimerUpdate", 2, 400], ["OnCriminalTimerUpdate", 3, 300], ["OnDisapprovalTimerUpdate", 4, 500]]) {
    const before = states({ engagements: dict([PILOT, 5n]), flagged: [set(1), set(2)], safetyLevel: 1 });
    // Counting down to a time; then, as Tranquility sends it while the cause goes on, with no time; then idle again.
    const counting = statesAfter(before, notice, [idle + 2, until]);
    assert.deepEqual(counting, states({ timers: timersWith({ [place]: [idle + 2, until] }), engagements: dict([PILOT, 5n]), flagged: [set(1), set(2)], safetyLevel: 1 }), notice);
    const active = statesAfter(counting, notice, [idle + 1, null]);
    assert.deepEqual(active[0], timersWith({ [place]: [idle + 1, null] }), notice);
    assert.deepEqual(statesAfter(active, notice, [idle, null]), before, notice);
    // What was handed in is not changed.
    assert.deepEqual(before, states({ engagements: dict([PILOT, 5n]), flagged: [set(1), set(2)], safetyLevel: 1 }), notice);
  }
});

test("the walk as the server answered it: after each notice the states are what the server then said they were", () => {
  const [npc, weapons, pvp, criminal, disapproval] = [134360781425000000n, 134360781430220000n, 134360781445430000n, 134360781506000000n, 134360781521230000n];
  const walk = [
    ["OnNpcTimerUpdate", [402, npc], states({ timers: timersWith({ 2: [402, npc] }) })],
    ["OnWeaponsTimerUpdate", [102, weapons], states({ timers: timersWith({ 0: [102, weapons], 2: [402, npc] }) })],
    ["OnPvpTimerUpdate", [202, pvp], states({ timers: timersWith({ 0: [102, weapons], 1: [202, pvp], 2: [402, npc] }) })],
    ["OnNpcTimerUpdate", [400, null], states({ timers: timersWith({ 0: [102, weapons], 1: [202, pvp] }) })],
    ["OnWeaponsTimerUpdate", [100, null], states({ timers: timersWith({ 1: [202, pvp] }) })],
    ["OnPvpTimerUpdate", [200, null], states()],
    // The pilot made a suspect: its criminal timer, and the system told who is flagged (idle, suspects, criminals).
    ["OnCriminalTimerUpdate", [304, criminal], states({ timers: timersWith({ 3: [304, criminal] }) })],
    ["OnSystemCriminalFlagUpdates", [[], [PILOT], []], states({ timers: timersWith({ 3: [304, criminal] }), flagged: [set(), set(PILOT)] })],
    ["OnDisapprovalTimerUpdate", [502, disapproval], states({ timers: timersWith({ 3: [304, criminal], 4: [502, disapproval] }), flagged: [set(), set(PILOT)] })],
    ["OnSystemDisapprovalFlagUpdates", [[], [PILOT]], states({ timers: timersWith({ 3: [304, criminal], 4: [502, disapproval] }), flagged: [set(), set(PILOT)] })],
    ["OnCriminalTimerUpdate", [300, null], states({ timers: timersWith({ 4: [502, disapproval] }), flagged: [set(), set(PILOT)] })],
    ["OnSystemCriminalFlagUpdates", [[PILOT], [], []], states({ timers: timersWith({ 4: [502, disapproval] }) })],
    ["OnDisapprovalTimerUpdate", [500, null], states()],
    ["OnSystemDisapprovalFlagUpdates", [[PILOT], []], states()],
  ];
  let kept = states();
  walk.forEach(([notice, args, then], step) => {
    kept = statesAfter(kept, notice, args);
    assert.deepEqual(kept, then, `step ${step + 1}, ${notice}`);
  });
});

test("who is flagged: the idle forgotten, then the criminals, then the suspects, whichever way the three were sent", () => {
  const flaggedAfter = (flagged, args) => statesAfter(states({ flagged }), "OnSystemCriminalFlagUpdates", args)[2];
  // Tranquility sends three sets; this server three tuples; a list is read as well. Each leaves the same.
  for (const sent of [(...ids) => set(...ids), (...ids) => ids, (...ids) => ({ type: "list", items: ids })]) {
    assert.deepEqual(flaggedAfter([set(), set()], [sent(), sent(11), sent()]), [set(), set(11)]);
    assert.deepEqual(flaggedAfter([set(), set(11)], [sent(), sent(), sent(22)]), [set(22), set(11)]);
    // A suspect made a criminal is a criminal, and no more a suspect; a criminal named a suspect is a suspect.
    assert.deepEqual(flaggedAfter([set(22), set(11)], [sent(), sent(), sent(11)]), [set(22, 11), set()]);
    assert.deepEqual(flaggedAfter([set(22, 11), set()], [sent(), sent(22), sent()]), [set(11), set(22)]);
    // The idle are flagged no more, of either kind; one not flagged named idle changes nothing.
    assert.deepEqual(flaggedAfter([set(11), set(22, 33)], [sent(11, 33, 44), sent(), sent()]), [set(), set(22)]);
    // Named idle and criminal at once: forgotten first, then a criminal. Named criminal and suspect at once: a suspect.
    assert.deepEqual(flaggedAfter([set(), set(11)], [sent(11), sent(), sent(11)]), [set(11), set()]);
    assert.deepEqual(flaggedAfter([set(), set()], [sent(), sent(11), sent(11)]), [set(), set(11)]);
  }
  // Those who stay flagged keep their places, the new come after in the notice's order, and none is there twice.
  assert.deepEqual(flaggedAfter([set(5, 6, 7), set(1, 2)], [[6], [9, 1, 8, 9], [7, 3]]), [set(5, 7, 3), set(1, 2, 9, 8)]);
  // A pilot is the same pilot as a number and as a long.
  assert.deepEqual(flaggedAfter([set(11n), set(22)], [[11], [], [22n]]), [set(22n), set()]);
  // The sets handed in are not changed, and the set written is like the one read.
  const kept = [set(1), { ...set(2), list: ["kept"] }];
  const after = flaggedAfter(kept, [[1], [3], []]);
  assert.deepEqual([kept[0], after[1]], [set(1), { ...set(2, 3), list: ["kept"] }]);
});

test("the engagements: one made or timed is its pilot's entry, one whose timing stops goes on with no end, one ended is gone", () => {
  const engagementsAfter = (engagements, notice, args) => statesAfter(states({ engagements }), notice, args)[1];
  const [until, later] = [134360781425000000n, 134360781999990000n];
  const made = engagementsAfter(dict(), "OnCrimewatchEngagementCreated", [PILOT, until]);
  assert.deepEqual(made, dict([PILOT, until]));
  // Another pilot's is beside it; this pilot's, timed again, is changed where it stands.
  const two = engagementsAfter(made, "OnCrimewatchEngagementCreated", [7, later]);
  assert.deepEqual(two, dict([PILOT, until], [7, later]));
  assert.deepEqual(engagementsAfter(two, "OnCrimewatchEngagementStartTimeout", [PILOT, later]), dict([PILOT, later], [7, later]));
  assert.deepEqual(engagementsAfter(dict(), "OnCrimewatchEngagementStartTimeout", [PILOT, later]), dict([PILOT, later]));
  // crimewatchEngagementTimeoutOngoing, for one named and for one not yet known.
  assert.equal(ENGAGEMENT_ONGOING, -1);
  assert.deepEqual(engagementsAfter(two, "OnCrimewatchEngagementStopTimeout", [BigInt(PILOT)]), dict([PILOT, -1], [7, later]));
  assert.deepEqual(engagementsAfter(dict(), "OnCrimewatchEngagementStopTimeout", [7]), dict([7, -1]));
  // Ended: gone, and one that was never there changes nothing.
  assert.deepEqual(engagementsAfter(two, "OnCrimewatchEngagementEnded", [PILOT]), dict([7, later]));
  assert.deepEqual(engagementsAfter(two, "OnCrimewatchEngagementEnded", [8]), two);
  // What was handed in is not changed.
  assert.deepEqual(made, dict([PILOT, until]));
});

test("the notice of who is disapproved of, and a notice that is none of crimewatch's, leave the states as they are", () => {
  const kept = states({ flagged: [set(1), set(2)] });
  assert.equal(statesAfter(kept, "OnSystemDisapprovalFlagUpdates", [[1], [2]]), kept);
  assert.equal(statesAfter(kept, "OnItemChange", [1, 2]), kept);
  assert.equal(statesAfter(kept, "toString", [1, 2]), kept);
  // And so states in a form that is not read: nothing is to be changed in them.
  for (const odd of ["states", null, { type: "list", items: [1, 2] }]) {
    assert.equal(statesAfter(odd, "OnSystemDisapprovalFlagUpdates", [[1], [2]]), odd);
    assert.equal(statesAfter(odd, "OnSecurityStatusUpdate", [1.5]), odd);
  }
});

test("where a notice cannot be worked in, it says so: states or a notice in a form that is not read", () => {
  const cannot = (kept, notice, args, why) => assert.equal(statesAfter(kept, notice, args), undefined, why);
  // States that are not the four places.
  for (const odd of ["states", null, undefined, { type: "list", items: [IDLE, dict(), [set(), set()], 2] }, [IDLE, dict(), [set(), set()]], [IDLE, dict(), [set(), set()], 2, 0]]) {
    cannot(odd, "OnNpcTimerUpdate", [402, 5n], JSON.stringify(odd ?? null).slice(0, 40));
  }
  // A notice with no arguments to read.
  cannot(states(), "OnNpcTimerUpdate", null, "no arguments");
  cannot(states(), "OnNpcTimerUpdate", { type: "list", items: [402, 5n] }, "arguments not a tuple");
  // A timer: the timers not five, or the notice not (state, expiry), which the client's handler would refuse.
  cannot(states({ timers: IDLE.slice(0, 4) }), "OnWeaponsTimerUpdate", [102, 5n], "four timers");
  cannot(states({ timers: "timers" }), "OnWeaponsTimerUpdate", [102, 5n], "timers not a tuple");
  cannot(states(), "OnWeaponsTimerUpdate", [102], "one argument");
  cannot(states(), "OnWeaponsTimerUpdate", [102, 5n, 1], "three arguments");
  // The flags: not two sets kept, not three told, a place that holds no pilots, or one that is no pilot.
  cannot(states({ flagged: [set()] }), "OnSystemCriminalFlagUpdates", [[], [], []], "one set kept");
  cannot(states({ flagged: [[], set()] }), "OnSystemCriminalFlagUpdates", [[], [], []], "a tuple kept for a set");
  cannot(states({ flagged: [set(), { type: "list", items: [] }] }), "OnSystemCriminalFlagUpdates", [[], [], []], "a list kept for a set");
  cannot(states({ flagged: "flagged" }), "OnSystemCriminalFlagUpdates", [[], [], []], "no flags kept");
  const notASet = { ...set(), header: [{ type: "token", value: "__builtin__.frozenset" }, [{ type: "list", items: [] }]] };
  cannot(states({ flagged: [notASet, set()] }), "OnSystemCriminalFlagUpdates", [[], [], []], "another object kept for the criminals");
  cannot(states({ flagged: [set(), notASet] }), "OnSystemCriminalFlagUpdates", [[], [], []], "another object kept for the suspects");
  cannot(states(), "OnSystemCriminalFlagUpdates", [[], notASet, []], "another object told for the suspects");
  cannot(states(), "OnSystemCriminalFlagUpdates", [[], []], "two told");
  cannot(states(), "OnSystemCriminalFlagUpdates", [[], [], [], []], "four told");
  cannot(states(), "OnSystemCriminalFlagUpdates", [[], 5, []], "a number for a set");
  cannot(states(), "OnSystemCriminalFlagUpdates", [[], ["x"], []], "a pilot that is no number");
  cannot(states(), "OnSystemCriminalFlagUpdates", [[1.5], [], []], "a pilot that is no whole number");
  cannot(states({ flagged: [set("x"), set()] }), "OnSystemCriminalFlagUpdates", [[], [], []], "a pilot kept that is no number");
  cannot(states({ flagged: [set(), set(null)] }), "OnSystemCriminalFlagUpdates", [[], [], []], "a suspect kept that is no number");
  // The engagements: not a dict kept, the wrong count told, or a pilot that is none.
  cannot(states({ engagements: [] }), "OnCrimewatchEngagementCreated", [7, 5n], "a tuple kept for the dict");
  cannot(states({ engagements: { type: "dict" } }), "OnCrimewatchEngagementCreated", [7, 5n], "a dict with no entries");
  cannot(states({ engagements: null }), "OnCrimewatchEngagementEnded", [7], "nothing kept for the dict");
  cannot(states(), "OnCrimewatchEngagementCreated", [7], "a making with no time");
  cannot(states(), "OnCrimewatchEngagementStartTimeout", [7, 5n, 1], "a timing with too much");
  cannot(states(), "OnCrimewatchEngagementStopTimeout", [7, 5n], "a stop with a time");
  cannot(states(), "OnCrimewatchEngagementEnded", [], "an ending of nobody");
  cannot(states(), "OnCrimewatchEngagementEnded", ["x"], "an ending of no pilot");
});
