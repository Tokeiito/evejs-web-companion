"use strict";

// src/gamePort/pilotJournal.js: a pilot's agents' journal as the retail client's journal service keeps it, set
// beside a real server's own word for it.
//
// test/fixtures/journalSession.json is one real game-port session on an EveJS server: the whole journal read as
// the client's service reads it, then a mission accepted, quit, another asked for and declined by pressing its
// agent's buttons, with the agent's own journal and the whole journal read again after each press. Every notice
// the server sent is there in order, among the answers.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPilotJournal } = require("../src/gamePort/pilotJournal");

const revive = (key, value) => (value && typeof value.$long === "string" ? BigInt(value.$long) : value && typeof value.$str === "string" ? Buffer.from(value.$str, "latin1") : value);
const recording = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "journalSession.json"), "utf8"), revive);
const AGENT = recording.pilot.agentID;
const WHOLE = recording.events.filter((event) => event.kind === "answer" && event.of === "agentMgr").map((event) => event.value);
const OWN = recording.events.filter((event) => event.kind === "answer" && event.of === AGENT).map((event) => event.value);

const list = (...items) => ({ type: "list", items });
/** A journal answer: its missions and its second list. */
const journalOf = (missions = [], research = []) => [list(...missions), list(...research)];
/** A mission as the server sends one, with only what tells it apart filled in. */
const mission = (agentID, state = 1, contentID = 1) => [state, 0, "UI/Agents/MissionTypes/Courier", 5000 + contentID, agentID, 134365346460600000n, list(), 0, 0, contentID];
const changed = (state, agentID) => ({ method: "OnAgentMissionChange", args: [state, agentID] });
const states = (journal) => journal[0].items.map((each) => [each[0], each[4], each[9]]);

test("the whole journal is kept as the server answered it, and read back in the form it came in", () => {
  const journal = createPilotJournal();
  assert.deepEqual([journal.kept, journal.read()], [false, null]);
  assert.equal(journal.full(WHOLE[0]), true);
  assert.deepEqual([journal.kept, journal.read()], [true, WHOLE[0]]);
  // The recording's pilot has one mission, offered and not yet accepted, and nothing in the second list.
  assert.deepEqual([WHOLE[0][0].items.length, WHOLE[0][0].items[0][0], WHOLE[0][0].items[0][4], WHOLE[0][1].items], [1, 1, AGENT, []]);
  // What is read back is not what is kept, and what was answered is not what is kept either.
  journal.read()[0].items.length = 0;
  const answered = journalOf([mission(7)]);
  const other = createPilotJournal();
  other.full(answered);
  other.feed(changed("quit", 7));
  other.partial(other.takeOutdated(), [journalOf()]);
  assert.deepEqual([journal.read(), other.read()[0].items, answered[0].items.length], [WHOLE[0], [], 1]);
  // An answer that is no journal is nothing kept, and leaves what was kept as it was.
  for (const odd of [null, undefined, 7, [], [list()], [list(), null], [null, list()], [{ type: "list" }, list()], list(), { type: "dict", entries: [] }]) {
    const none = createPilotJournal();
    assert.deepEqual([none.full(odd), none.kept], [false, false]);
    assert.deepEqual([journal.full(odd), journal.read()], [false, WHOLE[0]]);
  }
});

test("the recording replayed: with each agent's own answer put in after a mission's change, what is kept is the whole journal the server then answers", () => {
  const journal = createPilotJournal();
  let read = 0;
  let checked = 0;
  const seen = [];
  for (const event of recording.events) {
    if (event.kind === "notice") {
      if (journal.feed({ method: event.method, args: event.args })) seen.push(Buffer.isBuffer(event.args[0]) ? event.args[0].toString() : event.args[0]);
    } else if (event.kind === "answer" && event.of === AGENT) {
      // The service's partial reading: the marked agent's own answer, put in.
      const marked = journal.takeOutdated();
      assert.deepEqual(marked, [AGENT]);
      journal.partial(marked, [event.value]);
    } else if (event.kind === "answer") {
      read += 1;
      if (read === 1) journal.full(event.value);
      else {
        assert.deepEqual(journal.read(), event.value, `the journal after the ${seen.at(-1)}`);
        checked += 1;
      }
    }
  }
  // Accepted, quit, another offered, declined: each read by the agent's own answer, each the server's whole journal after.
  assert.deepEqual([seen, checked], [["accepted", "quit", "offered", "declined"], 4]);
  assert.deepEqual(WHOLE.map(states), [[[1, AGENT, 2156]], [[2, AGENT, 2156]], [], [[1, AGENT, WHOLE[3][0].items[0][9]]], []]);
  // The accepted mission came with its places, which the offer had none of.
  assert.deepEqual([WHOLE[0][0].items[0][6].items.length, WHOLE[1][0].items[0][6].items.length, OWN.length], [0, 3, 4]);
});

test("a mission's change marks its agent once, and one with no agent forgets the journal", () => {
  const journal = createPilotJournal();
  journal.full(journalOf([mission(7), mission(8)]));
  assert.deepEqual([journal.feed(changed("accepted", 7)), journal.feed(changed("offer_expired", 7)), journal.feed(changed("offered", 8)), journal.feed(changed("quit", 7n))], [true, true, true, true]);
  // Marked in the order they were first marked, and then marked no longer.
  assert.deepEqual([journal.takeOutdated(), journal.takeOutdated()], [[7, 8], []]);
  // No agent: nothing kept, to be read again in whole. An agent marked before stays marked.
  journal.feed(changed("offered", 9));
  assert.deepEqual([journal.feed(changed("reset", null)), journal.kept, journal.read()], [true, false, null]);
  journal.full(journalOf([mission(9)]));
  assert.deepEqual(journal.takeOutdated(), [9]);
  assert.equal(journal.feed({ method: "OnAgentMissionChange", args: ["reset"] }), true);
  assert.equal(journal.kept, false);
  // A change with nothing kept marks its agent all the same.
  assert.equal(journal.feed(changed("offered", 4)), true);
  assert.deepEqual([journal.kept, journal.takeOutdated()], [false, [4]]);
  // Other notices are not the journal's.
  for (const method of ["OnAgentMissionChanged", "OnStandingsModified", "OnItemChange", "OnAgentProvisionalResponse"]) {
    journal.full(journalOf([mission(7)]));
    assert.deepEqual([journal.feed({ method, args: ["accepted", 7] }), journal.takeOutdated(), journal.kept], [false, [], true], method);
  }
});

test("an agent's own answer takes that agent's first mission out and is put at the end of both lists, as the client does it", () => {
  const journal = createPilotJournal();
  const [a, b, c, second] = [mission(7, 1, 1), mission(8, 2, 2), mission(7, 2, 3), mission(9, 1, 4)];
  journal.full(journalOf([a, b, c], ["research of 8"]));
  // Two agents at once: each one's first mission goes, and the answers follow in the order the agents were marked.
  journal.partial([8, 7], [journalOf([second], ["research of 8"]), journalOf([mission(7, 2, 5)])]);
  assert.deepEqual(states(journal.read()), [[2, 7, 3], [1, 9, 4], [2, 7, 5]]);
  // Nothing is taken out of the second list: what an agent answers there again is there twice.
  assert.deepEqual(journal.read()[1].items, ["research of 8", "research of 8"]);
  // An agent with nothing kept and nothing to say changes nothing; one that answers for the first time is added.
  journal.partial([5], [journalOf()]);
  journal.partial([6], [journalOf([mission(6)])]);
  assert.deepEqual(states(journal.read()).map(([, agentID]) => agentID), [7, 9, 7, 6]);
  // An answer that is no journal stops it there: the missions were taken out, the answers before it are in, the rest are not.
  journal.partial([7, 9, 6], [journalOf([mission(7, 2, 8)]), null, journalOf([mission(6, 2, 9)])]);
  assert.deepEqual(states(journal.read()), [[2, 7, 5], [2, 7, 8]]);
  // With no journal kept there is nothing to put an answer into.
  const none = createPilotJournal();
  none.partial([7], [journalOf([mission(7)])]);
  assert.deepEqual([none.kept, none.read()], [false, null]);
  // What the agent answered is not itself changed by what is done to what is kept.
  const answer = journalOf([mission(3)]);
  journal.partial([3], [answer]);
  journal.partial([3], [journalOf()]);
  assert.deepEqual([answer[0].items.length, states(journal.read()).some(([, agentID]) => agentID === 3)], [1, false]);
});
