"use strict";

// src/gamePort/skillSheet.js: the Skills window's sheet made from what the client's skill services keep.
//
// The kept state is taken from test/fixtures/skillsSession.json, a real session on an EveJS server, replayed
// through src/gamePort/pilotSkills.js to the point each test names. The figures set beside the sheet's are the
// server's own, read through the web gateway for the same pilot on 2026-10-09: a rank 1 skill's levels at
// 250, 1415, 8000, 45255 and 256000 points, a rank 2's at 500, 2829, 16000, 90510 and 512000, a rank 3's at 750,
// 4243, 24000, 135765 and 768000; the pilot's 52 skills and 385,914 points; 30 points a minute with every
// attribute at 20; a queue of 150 at most.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createPilotSkills } = require("../src/gamePort/pilotSkills");
const { buildSkillSheet, pointsTrainedBy, skillPointsForLevel, skillPointsPerMinute } = require("../src/gamePort/skillSheet");

const revive = (key, value) => (value && typeof value.$long === "string" ? BigInt(value.$long) : value && typeof value.$str === "string" ? Buffer.from(value.$str, "latin1") : value);
const recording = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "skillsSession.json"), "utf8"), revive);
const KEPT_AS = { GetSkills: "skills", GetAllSkills: "allSkills", GetSkillQueueAndFreePoints: "queue", GetBoosters: "boosters", GetImplants: "implants", GetAttributes: "attributes", GetSkillHistory: "history", GetFreeSkillPoints: "freeSkillPoints", GetRespecInfo: "respecInfo" };
const { skillTypeID: GIVEN, otherSkillTypeID: OTHER } = recording.pilot;
const FILETIME_EPOCH = 116444736000000000n;
const ms = (filetime) => Number((filetime - FILETIME_EPOCH) / 10000n);

/** The services' state after the recording's events up to (and with) the one `stop` says, or all of them. */
function replayedTo(stop = () => false) {
  const skills = createPilotSkills();
  const seen = new Set();
  for (const event of recording.events) {
    if (event.kind === "notice") skills.feed({ method: event.method, args: event.args });
    else if (event.kind === "answer" && !seen.has(KEPT_AS[event.call])) {
      seen.add(KEPT_AS[event.call]);
      skills.keep(KEPT_AS[event.call], event.value);
    }
    if (stop(event)) break;
  }
  return skills;
}
const first = (call) => (event) => event.kind === "answer" && event.call === call;
const command = (start) => (event) => event.kind === "command" && event.command.startsWith(start);
const did = (call, nth) => { let count = 0; return (event) => event.kind === "does" && event.call === call && (count += 1) === nth; };

/** What a client knows of a type without asking: here a name made of its ID, and the two attributes every skill of the recording trains by. */
const KNOWN = { typeName: (typeID) => `Skill ${String(typeID).padStart(6, "0")}`, typeGroupName: (typeID) => `Group of ${typeID}`, typeAttribute: (typeID, attributeID) => ({ 180: 166, 181: 164 })[attributeID] ?? null };
const sheetOf = (skills, more = {}) => buildSkillSheet({
  characterID: recording.pilot.characterID,
  characterName: "Test Two",
  skills: skills.read("skills"),
  allSkills: skills.read("allSkills"),
  queue: skills.read("queue"),
  freeSkillPoints: skills.read("freeSkillPoints"),
  attributes: skills.read("attributes") ?? null,
  now: () => 1_791_552_000_000,
  ...KNOWN,
  ...more,
});
const rowOf = (sheet, typeID) => sheet.skills.find((row) => row.typeID === typeID);

test("the points a skill has at each level are the client's sum, which is the server's", () => {
  const levels = (rank) => [1, 2, 3, 4, 5].map((level) => skillPointsForLevel(rank, level));
  assert.deepEqual([levels(1), levels(2), levels(3)], [[250, 1415, 8000, 45255, 256000], [500, 2829, 16000, 90510, 512000], [750, 4243, 24000, 135765, 768000]]);
  assert.deepEqual([skillPointsForLevel(8, 5), skillPointsForLevel(16, 1)], [2048000, 4000]);
  // No level has none; a level past the last is the last (GetSPForLevelRaw).
  assert.deepEqual([skillPointsForLevel(3, 0), skillPointsForLevel(3, -1), skillPointsForLevel(3, 6)], [0, 0, 768000]);
});

test("a rate is the first attribute and half the second; points trained are whole, and none before the start", () => {
  assert.deepEqual([skillPointsPerMinute(20, 20), skillPointsPerMinute(27, 21), skillPointsPerMinute(17, 0)], [30, 37.5, 17]);
  // Four seconds and a tenth at 30 a minute is two points and a twentieth: two.
  assert.deepEqual([pointsTrainedBy(0, 1000, 5100, 30), pointsTrainedBy(92, 1000, 5100, 30), pointsTrainedBy(0, 1000, 61000, 37.5)], [2, 94, 37]);
  // Sampled at the start it has what it had; sampled before the start (the client's clock behind the server's) the same.
  assert.deepEqual([pointsTrainedBy(92, 1000, 1000, 30), pointsTrainedBy(92, 1000, 999, 30), pointsTrainedBy(92, 1000, 0, 30)], [92, 92, 92]);
});

test("the sheet of the recording's pilot as it was chosen: its skills, their levels and points, nothing queued", () => {
  const skills = replayedTo(first("GetRespecInfo"));
  const looked = [];
  const sheet = sheetOf(skills, { now: () => { looked.push("clock"); return 1_791_552_000_123.7; }, typeName: (typeID) => { looked.push("type"); return KNOWN.typeName(typeID); } });
  assert.deepEqual([sheet.characterID, sheet.characterName, sheet.skills.length, sheet.totalSkillPoints, sheet.freeSkillPoints, sheet.queueWarning], [recording.pilot.characterID, "Test Two", 52, 385914, 0, null]);
  assert.deepEqual(sheet.queue, { active: false, entries: [], endTimeMs: null, maxEntries: 150 });
  // The clock is read once, after everything known of the types has been looked up, and is the sheet's time in whole milliseconds.
  assert.deepEqual([sheet.serverNowMs, looked.filter((what) => what === "clock").length, looked.at(-1), looked.length], [1_791_552_000_123, 1, "clock", 53]);
  // A row is the entry as kept, with what the client knows of the type and works out of the rank.
  assert.deepEqual(rowOf(sheet, 3300), { typeID: 3300, name: "Skill 003300", groupName: "Group of 3300", level: 4, rank: 1, skillPoints: 45255, levelSkillPoints: [250, 1415, 8000, 45255, 256000], inTraining: false });
  assert.deepEqual(rowOf(sheet, 3310), { typeID: 3310, name: "Skill 003310", groupName: "Group of 3310", level: 2, rank: 2, skillPoints: 2828, levelSkillPoints: [500, 2829, 16000, 90510, 512000], inTraining: false });
  // A skill part of the way to its first level is at no level, with the points it has.
  assert.deepEqual([rowOf(sheet, 3315).level, rowOf(sheet, 3315).skillPoints, rowOf(sheet, 3315).rank], [0, 262, 4]);
  // In order of name, and none in training.
  assert.deepEqual(sheet.skills.map((row) => row.name), sheet.skills.map((row) => row.name).sort((left, right) => left.localeCompare(right)));
  assert.equal(sheet.skills.some((row) => row.inTraining), false);
  // Names that run the other way put the rows the other way.
  const backwards = sheetOf(skills, { typeName: (typeID) => String(999999 - typeID) });
  assert.deepEqual(backwards.skills.map((row) => row.typeID), sheet.skills.map((row) => row.typeID).reverse());
  // A type the client knows nothing of has no name, and is listed all the same.
  const nameless = sheetOf(skills, { typeName: () => undefined, typeGroupName: () => null });
  assert.deepEqual([nameless.skills.length, nameless.skills[0].name, nameless.skills[0].groupName], [52, "", ""]);
});

test("with a skill in training: the queue as the server saved it, the pilot's rate, and the skill's points reckoned from the time since", () => {
  const skills = replayedTo(did("SaveNewQueue", 2));
  const [head, next] = skills.read("queue").items.map((entry) => new Map(entry.args.entries.map(([key, value]) => [key.toString(), value])));
  const start = ms(head.get("trainingStartTime"));
  const sheet = sheetOf(skills, { now: () => start + 4100 });
  assert.deepEqual([sheet.skills.length, sheet.queue.active, sheet.queue.maxEntries, sheet.queue.endTimeMs], [54, true, 150, ms(next.get("trainingEndTime"))]);
  // Each entry is the server's own, its times as this machine counts them. The rate is said of the skill in training alone.
  assert.deepEqual(sheet.queue.entries, [
    { queuePosition: 0, typeID: GIVEN, toLevel: 1, startSP: 0, destinationSP: 750, startTimeMs: start, endTimeMs: ms(head.get("trainingEndTime")), skillPointsPerMinute: 30 },
    { queuePosition: 1, typeID: OTHER, toLevel: 1, startSP: 0, destinationSP: 500, startTimeMs: ms(next.get("trainingStartTime")), endTimeMs: ms(next.get("trainingEndTime")), skillPointsPerMinute: 0 },
  ]);
  // 750 points at 30 a minute is 25 minutes, which is what the server gave the entry.
  assert.equal(sheet.queue.entries[0].endTimeMs - start, 25 * 60 * 1000);
  // The skill in training: its entry kept has no points, and four seconds on it has two. The other queued skill is not in training.
  assert.deepEqual(rowOf(sheet, GIVEN), { typeID: GIVEN, name: `Skill 0${GIVEN}`, groupName: `Group of ${GIVEN}`, level: 0, rank: 3, skillPoints: 2, levelSkillPoints: [750, 4243, 24000, 135765, 768000], inTraining: true });
  assert.deepEqual([rowOf(sheet, OTHER).inTraining, rowOf(sheet, OTHER).skillPoints, sheet.skills.filter((row) => row.inTraining).length], [false, 0, 1]);
  // The total is of the points kept: what is being trained is not in it until the server says so.
  assert.equal(sheet.totalSkillPoints, 385914);
  // An hour on it would have more than the level takes: the reckoning is the client's, and does not stop there.
  assert.equal(rowOf(sheetOf(skills, { now: () => start + 60 * 60 * 1000 }), GIVEN).skillPoints, 1800);
  // A clock behind the server's start: what it had.
  assert.equal(rowOf(sheetOf(skills, { now: () => start - 5000 }), GIVEN).skillPoints, 0);
});

test("the rate is the pilot's attributes for the skill's two, and with either not known there is none said and the points are as kept", () => {
  const skills = replayedTo(did("SaveNewQueue", 1));
  const start = ms(new Map(skills.read("queue").items[0].args.entries.map(([key, value]) => [key.toString(), value])).get("trainingStartTime"));
  const at = (more) => { const sheet = sheetOf(skills, { now: () => start + 120_000, ...more }); return [sheet.queue.entries[0].skillPointsPerMinute, rowOf(sheet, GIVEN).skillPoints, rowOf(sheet, GIVEN).inTraining]; };
  const attributes = (values) => ({ type: "dict", entries: Object.entries(values).map(([id, value]) => [Number(id), value]) });
  assert.deepEqual(at({}), [30, 60, true]);
  // Memory 27 and charisma 21, which are this skill's two: 27 and half of 21.
  assert.deepEqual(at({ attributes: attributes({ 164: 21, 165: 99, 166: 27, 167: 99, 168: 99 }) }), [37.5, 75, true]);
  // The two the other way about, for a skill that trains by them so.
  assert.deepEqual(at({ attributes: attributes({ 164: 21, 166: 27 }), typeAttribute: (typeID, attributeID) => ({ 180: 164, 181: 166 })[attributeID] }), [34.5, 69, true]);
  // No attributes read, one of the two missing from them, the skill's own two not known, or a rate of nothing.
  for (const none of [{ attributes: null }, { attributes: attributes({ 166: 27 }) }, { attributes: attributes({ 164: 21 }) }, { typeAttribute: () => null }, { typeAttribute: (typeID, attributeID) => (attributeID === 180 ? 166 : null) }, { attributes: attributes({ 164: 0, 166: 0 }) }, { attributes: attributes({ 164: 10, 166: -5 }) }, { attributes: attributes({ 164: 2, 166: -9 }) }]) {
    assert.deepEqual(at(none), [0, 0, true], JSON.stringify(none.attributes ?? "types"));
  }
  // An entry with an end and no start is in training, and reckoned from now (GetEstimatedSkillPointsTrained): what it had.
  const noStart = replayedTo(did("SaveNewQueue", 1));
  const headless = { type: "list", items: skills.read("queue").items.map((entry) => ({ ...entry, args: { ...entry.args, entries: entry.args.entries.map(([key, value]) => (key.toString() === "trainingStartTime" ? [key, null] : [key, value])) } })) };
  noStart.feed({ method: "OnNewSkillQueueSaved", args: [headless] });
  const unstarted = sheetOf(noStart, { now: () => start + 120_000 });
  assert.deepEqual([rowOf(unstarted, GIVEN).inTraining, rowOf(unstarted, GIVEN).skillPoints, unstarted.queue.entries[0].startTimeMs, unstarted.queue.entries[0].skillPointsPerMinute], [true, 0, null, 30]);
  // The points kept are what the reckoning starts from.
  const kept = replayedTo(did("SaveNewQueue", 1));
  kept.feed({ method: "OnServerSkillsChanged", args: [{ type: "dict", entries: [[GIVEN, { type: "objectex1", header: [null, [GIVEN, 0, 500, 3, null]], list: [], dict: [] }]] }, null, 2n ** 62n] });
  assert.equal(rowOf(sheetOf(kept, { now: () => start - 1 }), GIVEN).skillPoints, 500);
  assert.equal(rowOf(sheetOf(kept, { now: () => start + 120_000 }), GIVEN).skillPoints, 560);
});

test("a queue that is stopped has its entries and no times, and nothing is in training", () => {
  const skills = replayedTo(did("AbortTraining", 1));
  const sheet = sheetOf(skills);
  assert.deepEqual([sheet.queue.active, sheet.queue.endTimeMs, sheet.skills.some((row) => row.inTraining)], [false, null, false]);
  assert.deepEqual(sheet.queue.entries.map((entry) => [entry.typeID, entry.toLevel, entry.startTimeMs, entry.endTimeMs, entry.skillPointsPerMinute]), [[OTHER, 1, null, null, 0]]);
});

test("a skill lent by an expert system has no level of its own and is left out; its going changes nothing shown", () => {
  const lent = replayedTo(command("/expertsystem add"));
  assert.equal(lent.read("skills").entries.some(([typeID]) => Number(typeID) === 3336), true);
  const sheet = sheetOf(lent);
  assert.deepEqual([sheet.skills.length, rowOf(sheet, 3336), sheet.totalSkillPoints], [52, undefined, 385914]);
  assert.deepEqual(sheetOf(replayedTo()).skills.map((row) => row.typeID), sheet.skills.map((row) => row.typeID));
});

test("free points are in the total, and what is not kept or is no such thing reads as none", () => {
  const skills = replayedTo(first("GetRespecInfo"));
  const withFree = sheetOf(skills, { freeSkillPoints: 109092n });
  assert.deepEqual([withFree.freeSkillPoints, withFree.totalSkillPoints], [109092, 385914 + 109092]);
  for (const none of [null, undefined, -5, "many"]) assert.deepEqual([sheetOf(skills, { freeSkillPoints: none }).freeSkillPoints, sheetOf(skills, { freeSkillPoints: none }).totalSkillPoints], [0, 385914], String(none));
  // The total is of the list with the lapsed, the rows of the list without.
  const lapsed = { type: "dict", entries: [...skills.read("allSkills").entries, [99001, { type: "objectex1", header: [null, [99001, 2, 1500, 1, null]], list: [], dict: [] }]] };
  const more = sheetOf(skills, { allSkills: lapsed });
  assert.deepEqual([more.skills.length, more.totalSkillPoints], [52, 385914 + 1500]);
  // Nothing kept at all is an empty sheet, not a failure; an entry that is no skill entry is no row.
  const empty = sheetOf(skills, { skills: undefined, allSkills: null, queue: undefined });
  assert.deepEqual([empty.skills, empty.totalSkillPoints, empty.queue], [[], 0, { active: false, entries: [], endTimeMs: null, maxEntries: 150 }]);
  const odd = { type: "dict", entries: [[7, null], [8, { type: "objectex1", header: [null] }], [9, { type: "objectex1", header: [null, [9, 1, 250, 1, null]] }]] };
  assert.deepEqual(sheetOf(skills, { skills: odd, allSkills: odd }).skills.map((row) => [row.typeID, row.level, row.skillPoints]), [[9, 1, 250]]);
  // A queue entry with a field missing says nothing for it, and its place in the list is its position.
  // A time of nothing is no time, as the client reads one.
  const bareEntry = (typeID, more = []) => ({ type: "object", name: Buffer.from("utillib.KeyVal"), args: { type: "dict", entries: [[Buffer.from("trainingTypeID"), typeID], ...more] } });
  const bare = { type: "list", items: [bareEntry(9), bareEntry(10, [[Buffer.from("trainingStartTime"), 0n], [Buffer.from("trainingEndTime"), 0]])] };
  const none = { toLevel: 0, startSP: 0, destinationSP: 0, startTimeMs: null, endTimeMs: null, skillPointsPerMinute: 0 };
  assert.deepEqual(sheetOf(skills, { queue: bare }).queue, { active: false, entries: [{ queuePosition: 0, typeID: 9, ...none }, { queuePosition: 1, typeID: 10, ...none }], endTimeMs: null, maxEntries: 150 });
});

// ── the page's own making (web/src/bridge/skillSheet.ts) ─────────────────────
//
// The page makes the sheet itself from the reads it asks for (the plan's Phase 6b). It has each read as the
// generic call hands it on (bridgeJson.js), where the making above has it as it came off the wire. Given the same
// kept state the two must make the same sheet.

const { wireToBridgeJson } = require("../src/gamePort/bridgeJson");
const page = require("../web/src/bridge/skillSheet.ts");

/** A queue's entry as it comes off the wire: a KeyVal of the fields given. */
const queueEntry = (fields) => ({ type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: Object.entries(fields).map(([key, value]) => [Buffer.from(key), value]) } });

/** The page's sheet of the same kept state, each read handed on as the generic call hands it. `more` is as sheetOf's. */
const pageSheetOf = (skills, more = {}) => {
  const given = { skills: skills.read("skills"), allSkills: skills.read("allSkills"), queue: skills.read("queue"), freeSkillPoints: skills.read("freeSkillPoints"), attributes: skills.read("attributes") ?? null, now: () => 1_791_552_000_000, ...KNOWN, ...more };
  return page.buildSkillSheet({
    characterID: recording.pilot.characterID,
    characterName: "Test Two",
    ...given,
    ...Object.fromEntries(["skills", "allSkills", "queue", "freeSkillPoints", "attributes"].map((read) => [read, wireToBridgeJson(given[read])])),
  });
};

test("at every point of the recorded session the page's making gives the sheet this one gives", () => {
  let compared = 0;
  const seen = { training: 0, queued: 0, stopped: 0, rows: new Set() };
  recording.events.forEach((upTo, index) => {
    const state = () => replayedTo((event) => event === upTo);
    const made = sheetOf(state());
    const start = made.queue.entries[0]?.startTimeMs ?? 1_791_552_000_000;
    // As the clock stood at the queue's start, a little after it, long after it, before it, and between two milliseconds.
    for (const now of [start, start + 4100, start + 3_600_000, start - 5000, start + 61_000.7]) {
      assert.deepEqual(pageSheetOf(state(), { now: () => now }), sheetOf(state(), { now: () => now }), `event ${index} (${upTo.kind} ${upTo.call ?? upTo.method ?? upTo.command ?? ""}) at ${now - start}`);
      compared += 1;
    }
    if (made.queue.active) seen.training += 1;
    if (made.queue.entries.length > 0) seen.queued += 1;
    if (made.queue.entries.length > 0 && !made.queue.active) seen.stopped += 1;
    seen.rows.add(made.skills.length);
  });
  // The session has what the comparison is for: a skill in training, a queue stopped, and skills coming and going.
  assert.deepEqual([compared, recording.events.length], [480, 96]);
  assert.ok(seen.training > 0 && seen.stopped > 0 && seen.queued > seen.training && seen.rows.size > 2, JSON.stringify({ ...seen, rows: [...seen.rows] }));
  // And the page's sheet is the gateway's kind of thing through and through: it goes as JSON and comes back the same.
  const whole = pageSheetOf(replayedTo(did("SaveNewQueue", 2)));
  assert.deepEqual(JSON.parse(JSON.stringify(whole)), whole);
});

test("the two makings agree where the attributes, the types' facts or the free points are other than the recording's", () => {
  const training = () => replayedTo(did("SaveNewQueue", 1));
  const start = sheetOf(training()).queue.entries[0].startTimeMs;
  const attributes = (values) => ({ type: "dict", entries: Object.entries(values).map(([id, value]) => [Number(id), value]) });
  const variants = [
    {},
    { attributes: attributes({ 164: 21, 165: 99, 166: 27, 167: 99, 168: 99 }) },
    { attributes: attributes({ 164: 21, 166: 27 }), typeAttribute: (typeID, attributeID) => ({ 180: 164, 181: 166 })[attributeID] },
    { attributes: null },
    { attributes: attributes({ 166: 27 }) },
    { attributes: attributes({ 164: 21 }) },
    { attributes: attributes({ 164: 0, 166: 0 }) },
    { attributes: attributes({ 164: -4, 166: 1 }) },
    { attributes: "many" },
    { typeAttribute: () => null },
    { typeAttribute: () => undefined },
    { typeAttribute: (typeID, attributeID) => (attributeID === 180 ? 166 : null) },
    { typeName: () => undefined, typeGroupName: () => null },
    { typeName: (typeID) => String(999999 - typeID) },
    { freeSkillPoints: 109092n },
    { freeSkillPoints: 2n ** 60n },
    { freeSkillPoints: null },
    { freeSkillPoints: -5 },
    { freeSkillPoints: "many" },
    { queue: null },
    { queue: { type: "list", items: [] } },
    { skills: null, allSkills: null },
    { allSkills: { type: "dict", entries: [[99001, { type: "objectex1", header: [null, [99001, 2, 1500, 1, null]], list: [], dict: [] }], [99002, null], [99003, { type: "objectex1", header: [null], list: [], dict: [] }]] } },
    // Points below nothing in all: a total of none, and the free points with it.
    { allSkills: { type: "dict", entries: [[99001, { type: "objectex1", header: [null, [99001, 1, -500, 1, null]], list: [], dict: [] }]] }, freeSkillPoints: 40 },
    // In training with an end and no start: reckoned from now, which is what it had.
    { queue: { type: "list", items: [queueEntry({ trainingTypeID: GIVEN, trainingToLevel: 1, trainingStartSP: 0, trainingDestinationSP: 750, trainingStartTime: null, trainingEndTime: 134360261550000000n, queuePosition: 0 })] } },
    // Entries that do not say where they are in the queue are where they are; ones that say nothing else say nought.
    { queue: { type: "list", items: [queueEntry({ trainingTypeID: OTHER, trainingToLevel: 1 }), queueEntry({ trainingTypeID: GIVEN, trainingToLevel: 2, trainingEndTime: 134360261550000000n }), queueEntry({})] } },
    { skills: { type: "dict", entries: [[3300, { type: "objectex1", header: [null, [3300, 4, 45255, 1, null]], list: [], dict: [] }], [3301, { type: "objectex1", header: [null, [3301, null, null, 1, 2]], list: [], dict: [] }], [3302, "no entry"], [3303, { type: "objectex1", header: [null, [3303, 2, null, null, null]], list: [], dict: [] }], [3304, { type: "objectex1", header: [null, { 1: 4, 2: 100, 3: 1 }], list: [], dict: [] }]] } },
  ];
  for (const [index, more] of variants.entries()) {
    assert.deepEqual(pageSheetOf(training(), { now: () => start + 120_000, ...more }), sheetOf(training(), { now: () => start + 120_000, ...more }), `variant ${index}`);
  }
  // The variants are not all one sheet: the rate, the points reckoned, the total and the rows each move.
  const figures = variants.map((more) => { const sheet = pageSheetOf(training(), { now: () => start + 120_000, ...more }); return [sheet.queue.entries[0]?.skillPointsPerMinute ?? null, sheet.skills.find((row) => row.inTraining)?.skillPoints ?? null, sheet.totalSkillPoints, sheet.skills.length].join("/"); });
  assert.ok(new Set(figures).size >= 8, figures.join(" "));
  assert.deepEqual(figures.slice(0, 3), ["30/60/385914/53", "37.5/75/385914/53", "34.5/69/385914/53"]);
});
