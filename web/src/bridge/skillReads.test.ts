// The sheet the Skills window's reads are made into (bridge/skillSheet.ts; the plan's Phase 6b): the client's
// figures, and its times as read. (The reads' own plumbing, which calls in which order and the type facts kept, was
// tested here until 2026-10-16 and was taken out: it is the page's own, and the reads now ask the attributes and the
// boosters wherever the queue has anything, as the client's GetCharacterAttributes does.)

import test from "node:test";
import assert from "node:assert/strict";

import { buildSkillSheet, pointsTrainedBy, skillInTraining, skillPointsForLevel, skillPointsPerMinute, skillTypeIDs } from "./skillSheet.ts";
import type { JsonValue } from "./wire.ts";

const long = (digits: string): JsonValue => ({ type: "long", value: digits });
const skill = (typeID: number, level: number | null, points: number | null, rank = 1): JsonValue =>
  ({ type: "objectex1", header: [{ type: "token", value: "characterskills.common.character_skill_entry.CharacterSkillEntry" }, [typeID, level, points, rank, null], { type: "dict", entries: [["groupName", "Gunnery"]] }], list: [], dict: [] });
const skillsOf = (...entries: readonly JsonValue[]): JsonValue => ({ type: "dict", entries: entries.map((entry) => [(entry as { header: [unknown, [number]] }).header[1][0], entry]) });
/** 2026-10-09 12:00:00 UTC, as the server counts it, and the same in milliseconds. */
const START = "134361072000000000";
const START_MS = Number((BigInt(START) - 116444736000000000n) / 10000n);
const queued = (typeID: number, toLevel: number, start: JsonValue, end: JsonValue, position = 0): JsonValue => ({
  type: "object",
  name: "util.KeyVal",
  args: { type: "dict", entries: [["queuePosition", position], ["trainingTypeID", typeID], ["trainingToLevel", toLevel], ["trainingStartSP", 8000], ["trainingDestinationSP", 45255], ["trainingStartTime", start], ["trainingEndTime", end]] },
});
const listOf = (...items: readonly JsonValue[]): JsonValue => ({ type: "list", items });

const SKILLS = skillsOf(skill(3300, 4, 45255), skill(3450, 3, 8000), skill(3327, null, null));
const ALL = skillsOf(skill(3300, 4, 45255), skill(3450, 3, 8000), skill(3402, 1, 250));
const ATTRIBUTES: JsonValue = { type: "dict", entries: [[164, 21], [165, 20], [166, 27], [167, 20], [168, 20]] };
const TRAINING = listOf(queued(3450, 4, long(START), long("134361108000000000")));

test("the figures are the client's: a level's points, the rate, the points trained, and what is in training", () => {
  const levels = (rank: number) => [1, 2, 3, 4, 5].map((level) => skillPointsForLevel(rank, level));
  assert.deepEqual([levels(1), levels(2), levels(3)], [[250, 1415, 8000, 45255, 256000], [500, 2829, 16000, 90510, 512000], [750, 4243, 24000, 135765, 768000]]);
  assert.deepEqual([skillPointsForLevel(3, 0), skillPointsForLevel(3, -1), skillPointsForLevel(3, 6)], [0, 0, 768000]);
  assert.deepEqual([skillPointsPerMinute(20, 20), skillPointsPerMinute(27, 21), skillPointsPerMinute(17, 0)], [30, 37.5, 17]);
  assert.deepEqual([pointsTrainedBy(0, 1000, 5100, 30), pointsTrainedBy(92, 1000, 5100, 30), pointsTrainedBy(0, 1000, 61000, 37.5)], [2, 94, 37]);
  assert.deepEqual([pointsTrainedBy(92, 1000, 1000, 30), pointsTrainedBy(92, 1000, 999, 30)], [92, 92]);
  // In training: the first entry, where it has an end. A time is a long past what a number holds, or a number.
  assert.deepEqual([skillInTraining(TRAINING), skillInTraining(listOf(queued(3450, 4, null, 5))), skillInTraining(listOf(queued(3450, 4, long(START), null))), skillInTraining(listOf(queued(3450, 4, long(START), 0)))], [3450, 3450, null, null]);
  assert.deepEqual([skillInTraining(listOf()), skillInTraining(null), skillInTraining(listOf(queued(3300, 5, null, null), queued(3450, 4, long(START), long(START), 1)))], [null, null, null]);
  // An entry that is no KeyVal is in training with nothing, whatever fields it has and wherever it has them.
  const fields: JsonValue = { type: "dict", entries: [["trainingEndTime", 5], ["trainingTypeID", 3450]] };
  assert.deepEqual([skillInTraining(listOf({ type: "object", name: "util.KeyVal", args: fields })), skillInTraining(listOf({ type: "list", args: fields })), skillInTraining(listOf({ args: fields })), skillInTraining(listOf(fields)), skillInTraining(listOf(null)), skillInTraining(listOf("an entry"))],
    [3450, null, null, null, null, null]);
  // An entry whose own arguments are no list is no skill's entry, whatever is where a level would be.
  assert.deepEqual(skillTypeIDs({ type: "dict", entries: [[3304, { type: "objectex1", header: [null, { 1: 4, 2: 100, 3: 1 }], list: [], dict: [] }], [3305, { type: "objectex1", header: { 1: [3305, 4, 100, 1, null] }, list: [], dict: [] }]] }), []);
  // The types a list names: those at a level.
  assert.deepEqual([skillTypeIDs(SKILLS), skillTypeIDs(null), skillTypeIDs(skillsOf(skill(3300, 0, 0))), skillTypeIDs({ type: "dict", entries: [[3300, null], ["x", skill(1, 1, 1)]] })], [[3300, 3450], [], [3300], []]);
});

test("a time in the queue is read as the server's, whichever way a long of it comes, and what is no time is none", () => {
  const sheetWith = (start: JsonValue, end: JsonValue) => (buildSkillSheet({ characterID: 1, characterName: "", skills: SKILLS, allSkills: ALL, queue: listOf(queued(3450, 4, start, end)), freeSkillPoints: 0, attributes: ATTRIBUTES, now: () => START_MS + 60_000, typeName: () => "a", typeGroupName: () => "b", typeAttribute: (typeID, attributeID) => ({ 180: 166, 181: 164 })[attributeID] }) as unknown as { queue: { entries: { startTimeMs: number | null; endTimeMs: number | null }[]; endTimeMs: number | null; active: boolean }; skills: { typeID: number; skillPoints: number }[] });
  const times = (start: JsonValue, end: JsonValue) => { const sheet = sheetWith(start, end); return [sheet.queue.entries[0]?.startTimeMs, sheet.queue.entries[0]?.endTimeMs, sheet.queue.endTimeMs, sheet.queue.active]; };
  assert.deepEqual(times(long(START), long(START)), [START_MS, START_MS, START_MS, true]);
  // A number that holds it (a time that small is no real one, but a number is read).
  assert.deepEqual(times(116444736000010000.0, 116444736000020000.0), [1, 2, 2, true]);
  // A number with a part of a tick is the whole ticks of it.
  assert.equal(times(5.5, long(START))[0], Number((5n - 116444736000000000n) / 10000n));
  // What is no time: nothing, digits that are not a long, a long of no digits, a time of nought or before it.
  assert.deepEqual(times(null, long(START)), [null, START_MS, START_MS, true]);
  assert.deepEqual(times(START, { type: "long", value: "soon" }), [null, null, null, true]);
  assert.deepEqual(times({ type: "long", value: "0" }, { type: "long", value: "-5" }), [null, null, null, true]);
  assert.deepEqual(times({ type: "long" }, { type: "real", value: 5 }), [null, null, null, true]);
  // What has entries and is no dict is no attributes: no rate is said.
  const rateWith = (attributes: JsonValue) => (buildSkillSheet({ characterID: 1, characterName: "", skills: SKILLS, allSkills: ALL, queue: TRAINING, freeSkillPoints: 0, attributes, now: () => START_MS, typeName: () => "a", typeGroupName: () => "b", typeAttribute: (typeID, attributeID) => ({ 180: 166, 181: 164 })[attributeID] }) as unknown as { queue: { entries: { skillPointsPerMinute: number }[] } }).queue.entries[0]?.skillPointsPerMinute;
  assert.deepEqual([rateWith(ATTRIBUTES), rateWith({ type: "list", entries: [[164, 21], [166, 27]] } as unknown as JsonValue), rateWith(null)], [37.5, 0, 0]);
  // With no start the skill in training has what it had; with one, a minute at 37.5.
  assert.deepEqual([sheetWith(null, long(START)).skills.find((row) => row.typeID === 3450)?.skillPoints, sheetWith(long(START), long(START)).skills.find((row) => row.typeID === 3450)?.skillPoints], [8000, 8037]);
});
