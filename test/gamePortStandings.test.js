"use strict";

// src/gamePort/pilotStandings.js: a pilot's standings as the retail client's standing service keeps them, set
// beside a real server's own word for them.
//
// test/fixtures/standingsSession.json is one real game-port session on an EveJS server (a pilot in a player's
// corporation): the three reads the client's service makes when a character is chosen, then a GM's changes to the
// pilot's standings (one given where there was none, changed, another owner's changed, one taken away), with the
// character's standings read again after. Every notice the server sent is there in order, among the answers.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPilotStandings, standingByRawChange, newStanding } = require("../src/gamePort/pilotStandings");

const revive = (key, value) => (value && typeof value.$long === "string" ? BigInt(value.$long) : value && typeof value.$str === "string" ? Buffer.from(value.$str, "latin1") : value);
const recording = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "standingsSession.json"), "utf8"), revive);
const answers = (call) => recording.events.filter((event) => event.kind === "answer" && event.call === call).map((event) => event.value);
const [NPC_NPC] = answers("GetNPCNPCStandings");
const [CORP] = answers("GetCorpStandings");
const CHAR = answers("GetCharStandings");

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : value);
const field = (rowset, name) => (rowset.args.entries.find(([key]) => text(key) === name) ?? [])[1];
/** A standings answer's rows as [fromID, standing], in the order it has them. */
const rowsOf = (rowset) => field(rowset, "lines").items.map((line) => [Number(line.items[0]), line.items[1]]);
const rowset = (lines, header = ["fromID", "standing"]) => ({
  type: "object", name: Buffer.from("eve.common.script.sys.rowset.Rowset"),
  args: { type: "dict", entries: [["header", { type: "list", items: header.map((name) => Buffer.from(name)) }], ["RowClass", { type: "token", value: "util.Row" }], ["lines", { type: "list", items: lines.map((items) => ({ type: "list", items })) }]] },
});
const ME = recording.characterID;
const MY_CORP = recording.corporationID;
const fresh = (corporationID = MY_CORP) => createPilotStandings({ characterID: ME, corporationID: () => corporationID });
const set = (fromID, toID, standing) => ({ method: "OnStandingSet", args: [fromID, toID, standing] });
const modified = (...modifications) => ({ method: "OnStandingsModified", args: [{ type: "list", items: modifications.map((items) => ({ type: "list", items })) }] });

test("what the server answers when a character is chosen is kept, and read back in the form it came in", () => {
  const standings = fresh();
  assert.deepEqual([standings.loaded, standings.char(), standings.corp(), standings.npcNpc()], [false, null, null, null]);
  assert.equal(standings.refreshed({ npcNpc: NPC_NPC, char: CHAR[0], corp: CORP }), true);
  assert.equal(standings.loaded, true);
  assert.deepEqual([standings.char(), standings.corp()], [CHAR[0], CORP]);
  // The NPCs' standings with each other are kept as they came.
  assert.equal(standings.npcNpc(), NPC_NPC);
  // The recording has something in each.
  assert.deepEqual([rowsOf(CHAR[0]).length, rowsOf(CORP).length, field(NPC_NPC, "lines").items.length > 100], [6, 6, true]);

  // A pilot in an NPC corporation is not asked for its corporation's, which are none (standingsvc.py 118).
  const npc = fresh(1000044);
  assert.equal(npc.refreshed({ npcNpc: NPC_NPC, char: CHAR[0] }), true);
  assert.deepEqual([npc.loaded, npc.char(), npc.corp()], [true, CHAR[0], null]);

  // A character's answer that is no rowset is nothing kept, and leaves what was kept as it was.
  const noLines = (lines) => ({ ...CHAR[0], args: { type: "dict", entries: CHAR[0].args.entries.filter(([key]) => text(key) !== "lines").concat(lines === undefined ? [] : [["lines", lines]]) } });
  for (const odd of [null, undefined, 7, { type: "dict", entries: [] }, rowset([], ["toID", "standing"]), rowset([], ["fromID"]), { ...CHAR[0], args: null }, noLines(), noLines(null), noLines({ type: "list" })]) {
    const none = fresh();
    assert.equal(none.refreshed({ npcNpc: NPC_NPC, char: odd, corp: CORP }), false);
    assert.equal(none.loaded, false);
    assert.equal(standings.refreshed({ npcNpc: null, char: odd, corp: null }), false);
    assert.deepEqual([standings.char(), standings.npcNpc()], [CHAR[0], NPC_NPC]);
  }
  // A corporation's answer that is no rowset is none kept for the corporation; the character's are kept.
  const half = fresh();
  assert.equal(half.refreshed({ npcNpc: NPC_NPC, char: CHAR[0], corp: "nothing" }), true);
  assert.deepEqual([half.char(), half.corp()], [CHAR[0], null]);
  standings.clear();
  assert.deepEqual([standings.loaded, standings.char(), standings.corp(), standings.npcNpc()], [false, null, null, null]);
});

test("kept right by the server's notices, a pilot's standings are what the server says they are whenever it is asked again", () => {
  const standings = fresh();
  let compared = 0;
  let asked = 0;
  for (const event of recording.events) {
    if (event.kind === "notice") assert.equal(standings.feed(event), undefined);
    if (event.kind !== "answer" || event.call !== "GetCharStandings") continue;
    asked += 1;
    if (asked === 1) standings.refreshed({ npcNpc: NPC_NPC, char: event.value, corp: CORP });
    else {
      compared += 1;
      assert.deepEqual(standings.char(), event.value, `at the character's standings asked for the ${asked}th time`);
    }
  }
  assert.equal(compared, 3);
  // The recording has what this is about: a standing given, changed, another's changed, and one taken away.
  const fromIDs = CHAR.map((answer) => rowsOf(answer).map(([fromID]) => fromID));
  assert.deepEqual([fromIDs[0].includes(1000125), fromIDs[1].includes(1000125), fromIDs[3].includes(1000125)], [false, true, false]);
  assert.deepEqual([new Map(rowsOf(CHAR[1])).get(1000125), new Map(rowsOf(CHAR[2])).get(1000125), new Map(rowsOf(CHAR[0])).get(500001), new Map(rowsOf(CHAR[2])).get(500001)], [3.5, -2.25, -3.978, 7]);
  // None of it was the corporation's.
  assert.deepEqual(standings.corp(), CORP);
});

test("OnStandingSet sets an NPC's standing with the character or its corporation, and takes it away at nothing", () => {
  const standings = fresh();
  standings.refreshed({ npcNpc: NPC_NPC, char: rowset([[500001, 1.5], [1000002, 2.5]]), corp: rowset([[500001, -1.5]]) });
  const both = () => [rowsOf(standings.char()), rowsOf(standings.corp())];
  // To the character: one it has is changed (however the server writes its number); one it has not is given, in its place by number.
  standings.feed(set(1000002n, ME, 9));
  standings.feed(set(1000002, ME, 4.25));
  standings.feed(set(500003, BigInt(ME), -0.5));
  assert.deepEqual(both(), [[[500001, 1.5], [500003, -0.5], [1000002, 4.25]], [[500001, -1.5]]]);
  // To the corporation, the same of the corporation's.
  standings.feed(set(500001, MY_CORP, 3));
  standings.feed(set(3008416, MY_CORP, 0.25));
  assert.deepEqual(both()[1], [[500001, 3], [3008416, 0.25]]);
  // A standing of nothing is none: the row goes, and one that was not there is not missed.
  standings.feed(set(500001, ME, 0));
  standings.feed(set(500099, ME, 0));
  standings.feed(set(500001, MY_CORP, 0.0));
  assert.deepEqual(both(), [[[500003, -0.5], [1000002, 4.25]], [[3008416, 0.25]]]);
  // Only an NPC's standing is kept (idCheckers.IsNPC: above the system's items, below the players' owners), and
  // only with this character or its corporation.
  for (const [fromID, toID] of [[10000, ME], [90000000, ME], [140000009, ME], [98000001, MY_CORP], [500001, ME + 1], [500001, MY_CORP + 1], [null, ME]]) standings.feed(set(fromID, toID, 9));
  assert.deepEqual(both(), [[[500003, -0.5], [1000002, 4.25]], [[3008416, 0.25]]]);
  for (const edge of [10001, 89999999]) standings.feed(set(edge, ME, 1));
  assert.deepEqual(rowsOf(standings.char()).map(([fromID]) => fromID), [10001, 500003, 1000002, 89999999]);
  // A pilot in an NPC corporation keeps what it is told of that corporation's all the same: they begin as none.
  const npc = fresh(1000044);
  npc.refreshed({ npcNpc: NPC_NPC, char: rowset([]) });
  assert.equal(npc.corp(), null);
  npc.feed(set(500001, 1000044, 2));
  assert.deepEqual(rowsOf(npc.corp()), [[500001, 2]]);
  // Nothing kept, nothing to keep right, whoever the notice is about.
  const none = fresh();
  none.feed(set(500001, ME, 2));
  none.feed(set(500001, MY_CORP, 2));
  none.feed(modified([500001, ME, 0.5, 0, 10]));
  assert.deepEqual([none.loaded, none.char(), none.corp()], [false, null, null]);
  // A notice with nothing in it, and a notice of something else that looks like one of these, are nothing.
  standings.feed({ method: "OnStandingSet", args: null });
  standings.feed({ method: "OnStandingsModified", args: null });
  standings.feed({ method: "OnSkillsChanged", args: [500003, ME, 9] });
  standings.feed({ method: "OnSkillsChanged", args: [[[500003, ME, 0.5, 0, 10]]] });
  assert.deepEqual(rowsOf(standings.char()), [[10001, 1], [500003, -0.5], [1000002, 4.25], [89999999, 1]]);
});

test("a raw change is worked into a standing as the client works it", () => {
  // standingUtil.CalculateStandingsByRawChange: towards 10 by the share of what is left, towards -10 likewise.
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not ${expected}`);
  near(standingByRawChange(0, 0.1), 1);
  near(standingByRawChange(5, 0.1), 5.5);
  near(standingByRawChange(-5, 0.1), -3.5);
  near(standingByRawChange(0, -0.1), -1);
  near(standingByRawChange(5, -0.1), 3.5);
  near(standingByRawChange(-5, -0.1), -5.5);
  // It stops at the ends, and a standing at an end is not moved further that way.
  assert.deepEqual([standingByRawChange(9.5, 5), standingByRawChange(10, 0.5), standingByRawChange(-9.5, -5), standingByRawChange(-10, -0.5)], [10, 10, -10, -10]);
  near(standingByRawChange(10, -0.1), 8);
  near(standingByRawChange(-10, 0.1), -8);
  // No change at all goes by the falling rule, which changes nothing but at the bottom.
  assert.deepEqual([standingByRawChange(3, 0), standingByRawChange(-10, 0)], [3, -10]);
  // standingUtil.CalculateNewStandings, where there was none: ten times the change, within the ends.
  assert.deepEqual([newStanding(0.25), newStanding(-0.25), newStanding(3), newStanding(-3), newStanding(0)], [2.5, -2.5, 10, -10, 0]);
});

test("OnStandingsModified works each raw change into the character's standings, and the corporation's the client's own way", () => {
  const standings = fresh();
  standings.refreshed({ npcNpc: NPC_NPC, char: rowset([[500001, 5], [1000002, -5]]), corp: rowset([[500001, 2], [1000009, 1]]) });
  const both = () => [rowsOf(standings.char()), rowsOf(standings.corp())];
  // (fromID, toID, rawChange, minAbs, maxAbs): to the character, one it has and one it has not.
  assert.equal(standings.feed(modified([500001, ME, 0.1, 0, 10], [1000002, ME, -0.1, 0, 10], [3008416, BigInt(ME), 0.05, 0, 10])), undefined);
  assert.deepEqual(both()[0], [[500001, 5.5], [1000002, -5.5], [3008416, 0.5]]);
  // To the corporation: one it has not is new. One it has is worked from the CHARACTER's standing with that
  // owner, which is the client's own code (standingsvc.py _ModifyCorporationStandings).
  standings.feed(modified([1000002, MY_CORP, 0.2, 0, 10], [500001, MY_CORP, 0.1, 0, 10]));
  assert.deepEqual(both()[1].map(([fromID, standing]) => [fromID, Math.round(standing * 1e6) / 1e6]), [[500001, 5.95], [1000002, 2], [1000009, 1]]);
  // And where the character has no standing with that owner the client's handler fails there: that change is
  // not made, nor any after it in the same notice. Those before it were.
  standings.feed(modified([500001, ME, -0.1, 0, 10], [1000009, MY_CORP, 0.5, 0, 10], [1000002, ME, 0.5, 0, 10]));
  const [char, corp] = both();
  assert.deepEqual([Math.round(new Map(char).get(500001) * 1e6) / 1e6, new Map(char).get(1000002), new Map(corp).get(1000009)], [3.95, -5.5, 1]);
  // Anyone else's standings are not this pilot's to keep, and a change that names no owner or no amount is none.
  const before = both();
  standings.feed(modified([null, ME, 0.5, 0, 10], [500077, ME, null, 0, 10], [500077, MY_CORP, null, 0, 10], [null, MY_CORP, 0.5, 0, 10]));
  standings.feed(modified([500001, ME + 1, 0.5, 0, 10], [500001, MY_CORP + 1, 0.5, 0, 10]));
  standings.feed({ method: "OnStandingsModified", args: [] });
  standings.feed({ method: "OnStandingsModified", args: [{ type: "list", items: [null, 7, { type: "list", items: [] }] }] });
  assert.deepEqual(both(), before);
  // The modifications may come as a tuple of tuples.
  standings.feed({ method: "OnStandingsModified", args: [[[1000002, ME, 0.5, 0, 10]]] });
  assert.equal(new Map(rowsOf(standings.char())).get(1000002), standingByRawChange(-5.5, 0.5));
});
