"use strict";

// src/gamePort/pilotSkills.js: a pilot's skills as the retail client's two skill services keep them, set beside a
// real server's own word for them.
//
// test/fixtures/skillsSession.json is one real game-port session on an EveJS server: the reads the client's
// services make of the skill handler when a character is chosen and when something first wants the rest, then a
// skill given by a GM, queued, another queued behind it, a level given while it trains, the training stopped, both
// skills taken away, and an expert system installed and removed, with the skills and the queue read again after
// each. Every notice the server sent is there in order, among the answers.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPilotSkills } = require("../src/gamePort/pilotSkills");

const revive = (key, value) => (value && typeof value.$long === "string" ? BigInt(value.$long) : value && typeof value.$str === "string" ? Buffer.from(value.$str, "latin1") : value);
const recording = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "skillsSession.json"), "utf8"), revive);
const answers = (call) => recording.events.filter((event) => event.kind === "answer" && event.call === call).map((event) => event.value);
/** What each read is kept as. */
const KEPT_AS = { GetSkills: "skills", GetAllSkills: "allSkills", GetSkillQueueAndFreePoints: "queue", GetBoosters: "boosters", GetImplants: "implants", GetAttributes: "attributes", GetSkillHistory: "history", GetFreeSkillPoints: "freeSkillPoints", GetRespecInfo: "respecInfo" };
const FIRST = Object.fromEntries(Object.keys(KEPT_AS).map((call) => [call, answers(call)[0]]));
const { skillTypeID: GIVEN, otherSkillTypeID: OTHER } = recording.pilot;

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : value);
/** A skill list's entries by type: each (typeID, trainedSkillLevel, trainedSkillPoints, skillRank, virtualSkillLevel). */
const fieldsOf = (list) => new Map(list.entries.map(([typeID, entry]) => [Number(typeID), entry.header[1]]));
const queueField = (entry, name) => (entry.args.entries.find(([key]) => text(key) === name) ?? [])[1];
const queued = (list) => list.items.map((entry) => [Number(queueField(entry, "trainingTypeID")), queueField(entry, "trainingToLevel")]);
const times = (list) => list.items.map((entry) => [queueField(entry, "trainingStartTime"), queueField(entry, "trainingEndTime")]);
/** A skill entry in the form the server sends one in, with no state of its own. */
const skillEntry = (typeID, level, points, rank = 1, virtualLevel = null) => ({ type: "objectex1", header: [{ type: "token", value: "characterskills.common.character_skill_entry.CharacterSkillEntry" }, [typeID, level, points, rank, virtualLevel]], list: [], dict: [] });
const skillInfos = (...entries) => ({ type: "dict", entries: entries.map((entry) => [entry.header[1][0], entry]) });
const queueEntry = (typeID, toLevel, position, start = 100n, end = 200n) => ({
  type: "object", name: Buffer.from("utillib.KeyVal"),
  args: { type: "dict", entries: [[Buffer.from("trainingStartSP"), 0], [Buffer.from("queuePosition"), position], [Buffer.from("trainingTypeID"), typeID], [Buffer.from("trainingDestinationSP"), 250], [Buffer.from("trainingEndTime"), end], [Buffer.from("trainingStartTime"), start], [Buffer.from("trainingToLevel"), toLevel]] },
});
const changed = (infos, event = null, timeStamp = 10n) => ({ method: "OnServerSkillsChanged", args: [infos, event, timeStamp] });
const removed = (infos, timeStamp = 10n) => ({ method: "OnServerSkillsRemoved", args: [infos, timeStamp] });
const saved = (...entries) => ({ method: "OnNewSkillQueueSaved", args: [{ type: "list", items: entries }] });
/** A store with the recording's first answers kept, all of them or the ones named. */
function primed(calls = Object.keys(KEPT_AS)) {
  const skills = createPilotSkills();
  for (const call of calls) skills.keep(KEPT_AS[call], FIRST[call]);
  return skills;
}
const NAMES = Object.values(KEPT_AS);
const has = (skills) => NAMES.filter((name) => skills.has(name));

test("what the handler answers is kept, and read back in the form it came in", () => {
  const skills = createPilotSkills();
  assert.deepEqual([has(skills), NAMES.map((name) => skills.read(name))], [[], NAMES.map(() => undefined)]);
  for (const call of Object.keys(KEPT_AS)) skills.keep(KEPT_AS[call], FIRST[call]);
  // The recording has something to keep: the pilot's skills, its attributes, a history, a respec.
  assert.deepEqual([fieldsOf(FIRST.GetSkills).size, FIRST.GetAttributes.entries.length, FIRST.GetSkillHistory.items.length > 0, FIRST.GetRespecInfo.type], [52, 5, true, "object"]);
  for (const call of ["GetSkills", "GetAllSkills", "GetBoosters", "GetImplants", "GetAttributes", "GetSkillHistory", "GetFreeSkillPoints", "GetRespecInfo"]) {
    assert.deepEqual(skills.read(KEPT_AS[call]), FIRST[call], call);
  }
  // The queue is the first of the two the read answers, and the second is the free points.
  assert.deepEqual([skills.read("queue"), FIRST.GetSkillQueueAndFreePoints[1]], [FIRST.GetSkillQueueAndFreePoints[0], 0]);
  assert.deepEqual(has(skills), NAMES);
  // What is read back is not what is kept: a reader that changes it changes nothing here.
  skills.read("skills").entries.length = 0;
  skills.read("queue").items.push("x");
  assert.deepEqual([fieldsOf(skills.read("skills")).size, skills.read("queue")], [52, FIRST.GetSkillQueueAndFreePoints[0]]);

  // An entry that is no skill entry is read back as it came, under the key it came under.
  const odd = { type: "dict", entries: [[7, null], [8n, { type: "objectex1", header: [null] }]] };
  skills.keep("skills", odd);
  assert.deepEqual(skills.read("skills"), odd);

  skills.clear();
  assert.deepEqual(has(skills), []);
});

test("the queue's read keeps the free points where there are some, and not where there are none (PrimeSkillQueue)", () => {
  const none = primed(["GetSkillQueueAndFreePoints"]);
  assert.deepEqual([none.has("queue"), none.has("freeSkillPoints")], [true, false]);
  for (const [points, kept] of [[5000, true], [1, true], [0, false], [null, false], [-3, false]]) {
    const skills = createPilotSkills();
    skills.keep("queue", [{ type: "list", items: [] }, points]);
    assert.deepEqual([skills.has("queue"), skills.has("freeSkillPoints"), skills.read("freeSkillPoints")], [true, kept, kept ? points : undefined], String(points));
  }
  // Points already kept are not forgotten by a queue that comes with none.
  const some = createPilotSkills();
  some.keep("freeSkillPoints", 700);
  some.keep("queue", [{ type: "list", items: [] }, 0]);
  assert.equal(some.read("freeSkillPoints"), 700);
});

test("an answer that is not the kind its read gives is not kept, and leaves what was kept as it was", () => {
  for (const odd of [null, undefined, 7, { type: "list", items: [] }, { type: "dict" }]) {
    const none = createPilotSkills();
    none.keep("skills", odd);
    none.keep("allSkills", odd);
    assert.deepEqual([none.has("skills"), none.has("allSkills")], [false, false]);
    const skills = primed();
    skills.keep("skills", odd);
    skills.keep("allSkills", odd);
    assert.deepEqual([skills.read("skills"), skills.read("allSkills")], [FIRST.GetSkills, FIRST.GetAllSkills]);
  }
  for (const odd of [null, undefined, 7, [], [null, 0], [{ type: "list" }, 0], { type: "list", items: [] }]) {
    const none = createPilotSkills();
    none.keep("queue", odd);
    assert.equal(none.has("queue"), false);
    const skills = primed();
    skills.keep("queue", odd);
    assert.deepEqual(skills.read("queue"), FIRST.GetSkillQueueAndFreePoints[0]);
  }
  // Nothing answered is nothing kept; an answer of nothing (no boosters is an empty dict, but None is an answer too) is kept.
  const skills = createPilotSkills();
  skills.keep("boosters", undefined);
  assert.equal(skills.has("boosters"), false);
  skills.keep("boosters", null);
  assert.deepEqual([skills.has("boosters"), skills.read("boosters")], [true, null]);
});

test("the recording replayed: after each change what is kept of the skills and the queue is what the server then answers", () => {
  const skills = createPilotSkills();
  const seen = new Set();
  let step = "the choosing";
  const checked = { skills: 0, allSkills: 0, queue: 0 };
  const next = [];
  for (const event of recording.events) {
    if (event.kind === "notice") {
      next.push(...skills.feed({ method: event.method, args: event.args }));
      continue;
    }
    if (event.kind !== "answer") {
      step = event.command ?? event.call;
      continue;
    }
    const name = KEPT_AS[event.call];
    if (!seen.has(name)) {
      seen.add(name);
      skills.keep(name, event.value);
      continue;
    }
    if (name === "queue") {
      assert.deepEqual(skills.read("queue"), event.value[0], `the queue after ${step}`);
      checked.queue += 1;
    } else if (name === "skills" || name === "allSkills") {
      // The server answers the points a skill in training has got so far. The client's entry for it is as it
      // was when the training began, and it reckons the rest itself from the queue (skillQueueSvc
      // GetEstimatedSkillPointsTrained). So that one skill's points are not set beside each other.
      const training = skills.read("queue").items.find((entry) => queueField(entry, "trainingEndTime"));
      const inTraining = training ? Number(queueField(training, "trainingTypeID")) : null;
      const comparable = (list) => [...fieldsOf(list)].sort(([a], [b]) => a - b).map(([typeID, fields]) => (typeID === inTraining ? [...fields.slice(0, 2), "training", ...fields.slice(3)] : fields));
      assert.deepEqual(comparable(skills.read(name)), comparable(event.value), `${name} after ${step}`);
      checked[name] += 1;
    }
  }
  assert.deepEqual(checked, { skills: 9, allSkills: 1, queue: 9 });
  // Nothing in it asked the transport for anything: no booster, implant or respec changed, and nothing was reset.
  assert.deepEqual(next, []);
});

/** The store as it is after the recording's events up to (and with) the nth of a kind, and what its `feed`s answered. */
function replayedTo(stop) {
  const skills = createPilotSkills();
  const seen = new Set();
  for (const event of recording.events) {
    if (event.kind === "notice") skills.feed({ method: event.method, args: event.args });
    else if (event.kind === "answer" && !seen.has(KEPT_AS[event.call])) {
      seen.add(KEPT_AS[event.call]);
      skills.keep(KEPT_AS[event.call], event.value);
    }
    if (stop(event)) return skills;
  }
  throw new Error("the recording has no such event");
}
const command = (start) => (event) => event.kind === "command" && event.command.startsWith(start);
const did = (call, nth) => { let count = 0; return (event) => event.kind === "does" && event.call === call && (count += 1) === nth; };

test("the recording, step by step: a skill given, queued, trained, stopped, taken away, and lent by an expert system", () => {
  const before = fieldsOf(FIRST.GetSkills);
  assert.deepEqual([before.has(GIVEN), before.has(OTHER), before.has(3336)], [false, false, false]);

  // Given at no level: in both lists, as the server said it.
  const given = replayedTo(command(`/giveskill me ${GIVEN} 0`));
  assert.deepEqual([fieldsOf(given.read("skills")).get(GIVEN), fieldsOf(given.read("allSkills")).get(GIVEN), fieldsOf(given.read("skills")).size], [[GIVEN, 0, 0, 3, null], [GIVEN, 0, 0, 3, null], 53]);
  // A skill changed, and the history kept is forgotten (ResetSkillHistory). Nothing else is.
  assert.deepEqual(has(given), NAMES.filter((name) => name !== "history"));

  // Queued, and another behind it: the queue is what the server said was saved, with its times.
  const one = replayedTo(did("SaveNewQueue", 1));
  assert.deepEqual([queued(one.read("queue")), times(one.read("queue")).map(([start, end]) => [typeof start, typeof end])], [[[GIVEN, 1]], [["bigint", "bigint"]]]);
  const two = replayedTo(did("SaveNewQueue", 2));
  assert.deepEqual(queued(two.read("queue")), [[GIVEN, 1], [OTHER, 1]]);

  // Its second level given outright: the entry is the new one, and the queue the server then saved has the other alone.
  const levelled = replayedTo(command(`/giveskill me ${GIVEN} 2`));
  assert.deepEqual([fieldsOf(levelled.read("skills")).get(GIVEN).slice(0, 2), queued(levelled.read("queue"))], [[GIVEN, 2], [[OTHER, 1]]]);

  // Training stopped. This server says so in the skill change's own event, as Tranquility does, and the queue's
  // entries are left with no start and no end.
  const stopping = recording.events.filter((event) => event.kind === "notice" && event.method === "OnServerSkillsChanged").map((event) => text(event.args[1]));
  assert.deepEqual(stopping, [null, null, null, "OnSkillQueuePausedServer", null]);
  const stopped = replayedTo(did("AbortTraining", 1));
  assert.deepEqual([queued(stopped.read("queue")), times(stopped.read("queue"))], [[[OTHER, 1]], [[null, null]]]);

  // Taken away: out of both lists.
  const gone = replayedTo(command(`/removeskill me ${OTHER}`));
  assert.deepEqual([fieldsOf(gone.read("skills")).has(GIVEN), fieldsOf(gone.read("allSkills")).has(OTHER), fieldsOf(gone.read("skills")).size, gone.read("queue").items], [false, false, 52, []]);

  // An expert system lends a level of a skill the pilot never trained: held with no level or points of its own.
  const lent = replayedTo(command("/expertsystem add"));
  assert.deepEqual([fieldsOf(lent.read("skills")).get(3336), fieldsOf(lent.read("allSkills")).get(3336)], [[3336, null, null, 8, 1], [3336, null, null, 8, 1]]);
  const returned = replayedTo(command("/expertsystem remove"));
  assert.deepEqual([fieldsOf(returned.read("skills")).has(3336), fieldsOf(returned.read("skills")).size], [false, 52]);
});

test("a skill change puts each skill into both lists, unless the one kept is newer", () => {
  const skills = primed();
  const known = [...fieldsOf(FIRST.GetSkills).keys()][0];
  skills.feed(changed(skillInfos(skillEntry(known, 5, 256000), skillEntry(99001, 1, 250, 2)), null, 500n));
  for (const name of ["skills", "allSkills"]) {
    assert.deepEqual([fieldsOf(skills.read(name)).get(known), fieldsOf(skills.read(name)).get(99001), fieldsOf(skills.read(name)).size], [[known, 5, 256000, 1, null], [99001, 1, 250, 2, null], 53], name);
  }
  // An older word for a skill does not replace a newer one; one as new does, and a newer one does.
  skills.feed(changed(skillInfos(skillEntry(known, 4, 45255), skillEntry(99001, 2, 1415, 2)), null, 499n));
  assert.deepEqual([fieldsOf(skills.read("skills")).get(known)[1], fieldsOf(skills.read("allSkills")).get(99001)[1]], [5, 1]);
  skills.feed(changed(skillInfos(skillEntry(99001, 2, 1415, 2)), null, 500n));
  assert.equal(fieldsOf(skills.read("allSkills")).get(99001)[1], 2);
  skills.feed(removed(skillInfos(skillEntry(known, 3, 8000)), 501n));
  assert.equal(fieldsOf(skills.read("skills")).get(known)[1], 3);
  // A time that came as a plain number is a time all the same.
  skills.feed(changed(skillInfos(skillEntry(known, 4, 45255)), null, 502));
  skills.feed(changed(skillInfos(skillEntry(known, 1, 250)), null, 501n));
  assert.equal(fieldsOf(skills.read("skills")).get(known)[1], 4);
  // One skill's word being older does not stop the next skill's in the same notice, and the history is forgotten with it.
  skills.keep("history", FIRST.GetSkillHistory);
  skills.feed(changed(skillInfos(skillEntry(known, 2, 1415), skillEntry(99007, 1, 250)), null, 400n));
  assert.deepEqual([fieldsOf(skills.read("skills")).get(known)[1], fieldsOf(skills.read("skills")).has(99007), skills.has("history")], [4, true, false]);
  // What was answered at the choosing has no time, and anything replaces it.
  const other = [...fieldsOf(FIRST.GetSkills).keys()][1];
  skills.feed(changed(skillInfos(skillEntry(other, 5, 256000)), null, 0n));
  assert.equal(fieldsOf(skills.read("skills")).get(other)[1], 5);
});

test("a skill with no points and a lent level is kept as a copy with nothing of its own; with neither it is taken out", () => {
  const skills = primed();
  const known = [...fieldsOf(FIRST.GetSkills).keys()][0];
  // Points of -1, as this server marks a skill gone, and of nothing: with a virtual level each is held by that level alone.
  const withState = { ...skillEntry(99001, 3, -1, 4, 2), header: [...skillEntry(99001, 3, -1, 4, 2).header, { type: "dict", entries: [["inTraining", true]] }] };
  skills.feed(changed(skillInfos(withState, skillEntry(99002, null, null, 5, 1))));
  for (const name of ["skills", "allSkills"]) {
    const kept = new Map(skills.read(name).entries.map(([typeID, entry]) => [typeID, entry]));
    assert.deepEqual(kept.get(99001).header, [withState.header[0], [99001, null, null, 4, 2]], name);
    assert.deepEqual(kept.get(99002).header[1], [99002, null, null, 5, 1], name);
  }
  // A lent level of none at all is still a lent level (the client asks whether it is None).
  skills.feed(changed(skillInfos(skillEntry(99004, 0, -1, 1, 0))));
  assert.deepEqual(fieldsOf(skills.read("skills")).get(99004), [99004, null, null, 1, 0]);
  // A lent level older than what is kept changes nothing.
  skills.feed(changed(skillInfos(skillEntry(99001, null, null, 4, 5)), null, 9n));
  assert.equal(fieldsOf(skills.read("skills")).get(99001)[4], 2);
  // No points and no lent level: out of both lists. Zero points is points.
  skills.feed(removed(skillInfos(skillEntry(99001, 0, -1, 4), skillEntry(known, 0, 0))));
  assert.deepEqual([fieldsOf(skills.read("skills")).has(99001), fieldsOf(skills.read("allSkills")).has(99001), fieldsOf(skills.read("skills")).get(known)], [false, false, [known, 0, 0, 1, null]]);
  skills.feed(changed(skillInfos(skillEntry(99002, null, null, 5, null))));
  assert.deepEqual([fieldsOf(skills.read("skills")).has(99002), fieldsOf(skills.read("allSkills")).has(99002)], [false, false]);
});

test("a skill to be taken out that is not kept stops the client's handler there: nothing after it is done", () => {
  const skills = primed();
  skills.feed(saved(queueEntry(99001, 1, 0)));
  const known = [...fieldsOf(FIRST.GetSkills).keys()][0];
  // The first is done, the second is not kept, and the third is never reached. The history stays, and the queue is not stopped.
  skills.feed(changed(skillInfos(skillEntry(99001, 1, 250), skillEntry(99002, 0, -1), skillEntry(known, 5, 256000)), "OnSkillQueuePausedServer"));
  assert.deepEqual([fieldsOf(skills.read("skills")).has(99001), fieldsOf(skills.read("skills")).get(known)[1] === 5, skills.has("history"), queued(skills.read("queue")), times(skills.read("queue"))],
    [true, false, true, [[99001, 1]], [[100n, 200n]]]);
  // Something that is no skill entry stops it the same way.
  skills.feed(changed(skillInfos(skillEntry(99006, 1, 250)), "OnSkillQueuePausedServer", 5n));
  skills.keep("history", FIRST.GetSkillHistory);
  skills.feed(changed({ type: "dict", entries: [[7, null], [99008, skillEntry(99008, 1, 250)]] }, "OnSkillQueuePausedServer"));
  assert.deepEqual([fieldsOf(skills.read("skills")).has(99008), skills.has("history")], [false, true]);
  // The same with the plain removal.
  skills.feed(removed(skillInfos(skillEntry(99003, 0, -1))));
  assert.equal(skills.has("history"), true);
  // And one that is done forgets the history.
  skills.feed(removed(skillInfos(skillEntry(99001, 0, -1))));
  assert.equal(skills.has("history"), false);
});

test("a queued level that is now the skill's trained level leaves the queue, and the entries behind it are as they were", () => {
  const skills = primed();
  const [first, second, third] = [queueEntry(99001, 1, 0), queueEntry(99001, 2, 1, 200n, 300n), queueEntry(99002, 1, 2, 300n, 400n)];
  skills.feed(saved(first, second, third));
  assert.deepEqual(skills.read("queue").items, [first, second, third]);
  // Another level of it trained, or a skill not queued: the queue is as it was.
  skills.feed(changed(skillInfos(skillEntry(99001, 3, 8000), skillEntry(99005, 1, 250))));
  assert.deepEqual(skills.read("queue").items, [first, second, third]);
  // The second entry's level: that one goes, from the middle.
  skills.feed(changed(skillInfos(skillEntry(99001, 2, 1415))));
  assert.deepEqual(skills.read("queue").items, [first, third]);
  skills.feed(changed(skillInfos(skillEntry(99001, 1, 250), skillEntry(99002, 1, 250))));
  assert.deepEqual(skills.read("queue").items, []);
  // A skill the list does not have, said to be trained to a level: the client says so in its log and leaves the queue.
  skills.feed(saved(first));
  skills.feed(removed(skillInfos({ ...skillEntry(99001, 1, -1), header: [skillEntry(99001, 1, -1).header[0], [99001, 1, -1, 1, null]] })));
  assert.deepEqual([fieldsOf(skills.read("skills")).has(99001), skills.read("queue").items], [false, [first]]);
  // A skill not had that is skipped does not stop the next skill's queued level from leaving.
  skills.feed(changed(skillInfos(skillEntry(99001, 0, 0))));
  skills.feed(saved(first, third));
  skills.feed(changed({ type: "dict", entries: [[99001, skillEntry(99001, 1, -1)], [99002, skillEntry(99002, 1, 250)]] }));
  assert.deepEqual([fieldsOf(skills.read("skills")).has(99001), skills.read("queue").items], [false, [first]]);
  // The queue the server answered is not itself changed by what leaves the one kept.
  const answered = { type: "list", items: [first, third] };
  skills.keep("queue", [answered, 0]);
  skills.feed(changed(skillInfos(skillEntry(99001, 1, 250))));
  assert.deepEqual([skills.read("queue").items, answered.items], [[third], [first, third]]);
  // With no queue kept there is none to take from.
  const none = primed(["GetSkills", "GetAllSkills"]);
  none.feed(changed(skillInfos(skillEntry(99001, 1, 250))));
  assert.deepEqual([none.has("queue"), fieldsOf(none.read("skills")).has(99001)], [false, true]);
});

test("the queue is replaced by what the server says was saved, and stopped by its word alone or by a skill change's event", () => {
  const skills = primed();
  const [first, second] = [queueEntry(99001, 1, 0), queueEntry(99002, 1, 1, 200n, 300n)];
  skills.feed(saved(first, second));
  assert.deepEqual([skills.read("queue").items, times(skills.read("queue"))], [[first, second], [[100n, 200n], [200n, 300n]]]);
  // Stopped: no entry has a start or an end, and the rest of each is as it was.
  skills.feed({ method: "OnSkillQueuePausedServer", args: [] });
  assert.deepEqual([queued(skills.read("queue")), times(skills.read("queue")), skills.read("queue").items.map((entry) => queueField(entry, "trainingDestinationSP"))], [[[99001, 1], [99002, 1]], [[null, null], [null, null]], [250, 250]]);
  assert.deepEqual(times({ items: [first] }), [[100n, 200n]], "the entries the server sent are not themselves changed");
  // Saved again, and stopped by the event a skill change names. Another event stops nothing.
  skills.feed(saved(first, second));
  skills.feed(changed(skillInfos(skillEntry(99005, 0, 10)), "OnSomethingElse"));
  assert.deepEqual(times(skills.read("queue")), [[100n, 200n], [200n, 300n]]);
  skills.feed(changed(skillInfos(skillEntry(99005, 0, 20)), Buffer.from("OnSkillQueuePausedServer")));
  assert.deepEqual(times(skills.read("queue")), [[null, null], [null, null]]);
  // An entry that is no entry is left as it is.
  skills.feed(saved(first, null, 7));
  skills.feed({ method: "OnSkillQueuePausedServer", args: [] });
  assert.deepEqual([times({ items: [skills.read("queue").items[0]] }), skills.read("queue").items.slice(1)], [[[null, null]], [null, 7]]);
  // An empty queue saved is an empty queue.
  skills.feed(saved());
  assert.deepEqual([skills.has("queue"), skills.read("queue").items], [true, []]);
  // With no queue kept, a stop is nothing; a queue saved is a queue kept.
  const none = createPilotSkills();
  none.feed({ method: "OnSkillQueuePausedServer", args: [] });
  assert.equal(none.has("queue"), false);
  none.feed(saved(first));
  assert.deepEqual(none.read("queue").items, [first]);
});

test("the free points are what the server last said they are", () => {
  const skills = primed(["GetSkillQueueAndFreePoints"]);
  assert.equal(skills.has("freeSkillPoints"), false);
  skills.feed({ method: "OnFreeSkillPointsChanged", args: [109092] });
  assert.deepEqual([skills.has("freeSkillPoints"), skills.read("freeSkillPoints")], [true, 109092]);
  skills.feed({ method: "OnFreeSkillPointsChanged", args: [0] });
  assert.deepEqual([skills.has("freeSkillPoints"), skills.read("freeSkillPoints")], [true, 0]);
});

test("a skill change before the lists are kept changes nothing, and nothing is kept by it", () => {
  for (const calls of [[], ["GetSkills"], ["GetAllSkills"]]) {
    const skills = primed([...calls, "GetSkillHistory", "GetSkillQueueAndFreePoints"]);
    skills.feed(saved(queueEntry(99001, 1, 0)));
    assert.deepEqual(skills.feed(changed(skillInfos(skillEntry(99001, 1, 250)), "OnSkillQueuePausedServer")), []);
    skills.feed(removed(skillInfos(skillEntry(99001, 0, -1))));
    assert.deepEqual([skills.has("skills"), skills.has("allSkills"), skills.has("history"), times(skills.read("queue"))], [calls.includes("GetSkills"), calls.includes("GetAllSkills"), true, [[100n, 200n]]], String(calls));
    if (calls.length) assert.equal(fieldsOf(skills.read(KEPT_AS[calls[0]])).has(99001), false);
  }
  // Notices that say nothing a skill service can read are nothing.
  const skills = primed();
  for (const odd of [{ method: "OnServerSkillsChanged", args: [] }, { method: "OnServerSkillsChanged", args: [null, null, 5n] }, { method: "OnServerSkillsChanged", args: [{ type: "list", items: [] }, null, 5n] }, { method: "OnServerSkillsChanged" }, { method: "OnServerSkillsRemoved", args: null }, changed({ type: "dict", entries: [[7, null], [8, { type: "objectex1", header: [null] }]] })]) {
    assert.deepEqual(skills.feed(odd), []);
  }
  assert.deepEqual([skills.read("skills"), skills.read("allSkills"), has(skills).includes("queue")], [FIRST.GetSkills, FIRST.GetAllSkills, true]);
});

test("after a change of boosters, implants, clone or respec the client reads its attributes again; a forced refresh forgets all but the queue", () => {
  for (const method of ["OnServerBoostersChanged", "OnServerImplantsChanged", "OnCloneDestruction", "OnJumpCloneTransitionCompleted", "OnRespecInfoChanged"]) {
    const skills = primed();
    assert.deepEqual(skills.feed({ method, args: [] }), ["attributes"], method);
    // What is kept stays until the reads answer; the respec is forgotten by its own notice alone.
    assert.deepEqual(has(skills), NAMES.filter((name) => !(method === "OnRespecInfoChanged" && name === "respecInfo")), method);
  }
  const skills = primed();
  assert.deepEqual(skills.feed({ method: "OnSkillForcedRefresh", args: [] }), ["reset"]);
  assert.deepEqual(has(skills), ["queue"]);
  for (const method of ["OnSkillsChanged", "OnSkillLevelsTrained", "OnMultipleCharactersTrainingUpdated", "OnServerBrainUpdated", "OnExpertSystemsUpdated", "OnModuleAttributeChanges", "OnLogonSkillsTrained"]) {
    assert.deepEqual(primed().feed({ method, args: [] }), [], method);
  }
});

test("several notices in one are each read, and what they ask of the transport is asked once", () => {
  const skills = primed();
  const multi = (...events) => ({ method: "__MultiEvent", args: events.map(([name, args]) => ({ type: "tuple", items: [Buffer.from(name), { type: "list", items: args }] })) });
  const first = queueEntry(99001, 1, 0);
  const next = skills.feed(multi(
    ["OnServerSkillsChanged", [skillInfos(skillEntry(99001, 0, 0)), null, 7n]],
    ["OnNewSkillQueueSaved", [{ type: "list", items: [first] }]],
    ["OnServerImplantsChanged", []],
    ["OnFreeSkillPointsChanged", [42]],
    ["OnServerBoostersChanged", []],
  ));
  assert.deepEqual(next, ["attributes"]);
  assert.deepEqual([fieldsOf(skills.read("skills")).get(99001), skills.read("queue").items, skills.read("freeSkillPoints"), skills.has("history")], [[99001, 0, 0, 1, null], [first], 42, false]);
  assert.deepEqual(skills.feed(multi(["OnServerImplantsChanged", []], ["OnSkillForcedRefresh", []])), ["attributes", "reset"]);
});
