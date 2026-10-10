// The Skills window's reads, made by the page itself (bridge/skillReads.ts), and the sheet made of them
// (bridge/skillSheet.ts; the plan's Phase 6b).
//
// What has to hold: the calls are the client's own, each with nothing, the attributes asked only where a skill is
// in training; a read that fails fails the sheet; where the queue's read is not carried (the web gateway) there is
// no sheet here and the route's is the one to read; and what is known of a type is asked of the static data once.
//
// That the sheet's figures are the BFF's is test/gamePortSkillSheet.test.js, at every point of a real session.

import test from "node:test";
import assert from "node:assert/strict";

import type { Ask } from "./ask.ts";
import { TYPES_AT_ONCE, createSkillTypeFacts, readSkillSheet, type SkillSheetFor, type StaticReads } from "./skillReads.ts";
import { buildSkillSheet, pointsTrainedBy, skillInTraining, skillPointsForLevel, skillPointsPerMinute, skillTypeIDs } from "./skillSheet.ts";
import type { JsonValue } from "./wire.ts";

const failing = (code: string): Error => Object.assign(new Error("it failed"), { code });
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

/** An asking the test answers, with what was asked kept in order. */
function asking(answers: Record<string, JsonValue | (() => JsonValue)>): { ask: Ask; asked: string[] } {
  const asked: string[] = [];
  const ask: Ask = async (service, method, args) => {
    asked.push(`${service}.${method}(${JSON.stringify(args).slice(1, -1)})`);
    const answer = answers[method];
    return typeof answer === "function" ? answer() : (answer as JsonValue);
  };
  return { ask, asked };
}
const READS = { GetSkillQueueAndFreePoints: [listOf(), 0] as unknown as JsonValue, GetSkills: SKILLS, GetAllSkills: ALL, GetFreeSkillPoints: 700, GetAttributes: ATTRIBUTES };
const NAMES: Record<number, readonly [string, string]> = { 3300: ["Gunnery", "Gunnery"], 3450: ["Afterburner", "Navigation"] };
function whoseSheet(more: Partial<SkillSheetFor> = {}): SkillSheetFor & { wanted: (readonly [readonly number[], number | null])[] } {
  const wanted: (readonly [readonly number[], number | null])[] = [];
  return {
    characterID: 140000002,
    characterName: "Test Two",
    wanted,
    async typeFacts(typeIDs, trainingTypeID) {
      wanted.push([typeIDs, trainingTypeID]);
      return { name: (typeID) => NAMES[typeID]?.[0], groupName: (typeID) => NAMES[typeID]?.[1], attribute: (typeID, attributeID) => (typeID === 3450 ? { 180: 166, 181: 164 }[attributeID] : undefined) };
    },
    now: () => START_MS + 120_000,
    ...more,
  };
}

test("the sheet is made from the client's own reads, each asked with nothing, and the attributes are not asked for with nothing in training", async () => {
  const { ask, asked } = asking(READS);
  const whose = whoseSheet();
  const sheet = (await readSkillSheet(ask, whose)) as unknown as { skills: { typeID: number; name: string; groupName: string; level: number; skillPoints: number; inTraining: boolean }[]; totalSkillPoints: number; freeSkillPoints: number; serverNowMs: number; queue: { active: boolean; entries: unknown[] }; characterID: number; characterName: string };
  // The queue first, alone: it is what says whether the sheet can be made here at all. Then the rest.
  assert.deepEqual(asked, ["skillHandler.GetSkillQueueAndFreePoints()", "skillHandler.GetSkills()", "skillHandler.GetAllSkills()", "skillHandler.GetFreeSkillPoints()"]);
  // The types whose facts are wanted are the skills at a level; none is in training.
  assert.deepEqual(whose.wanted, [[[3300, 3450], null]]);
  assert.deepEqual([sheet.characterID, sheet.characterName, sheet.serverNowMs, sheet.freeSkillPoints, sheet.totalSkillPoints], [140000002, "Test Two", START_MS + 120_000, 700, 45255 + 8000 + 250 + 700]);
  // In order of name, with what is known of each type; a skill at no level of its own is no row.
  assert.deepEqual(sheet.skills.map((row) => [row.typeID, row.name, row.groupName, row.level, row.skillPoints, row.inTraining]), [[3450, "Afterburner", "Navigation", 3, 8000, false], [3300, "Gunnery", "Gunnery", 4, 45255, false]]);
  assert.deepEqual(sheet.queue, { active: false, entries: [], endTimeMs: null, maxEntries: 150 });
});

test("with a skill in training the attributes are asked for, and its points are reckoned at the pilot's rate from the clock given", async () => {
  const { ask, asked } = asking({ ...READS, GetSkillQueueAndFreePoints: [TRAINING, 0] as unknown as JsonValue });
  const whose = whoseSheet();
  const sheet = (await readSkillSheet(ask, whose)) as unknown as { skills: { typeID: number; skillPoints: number; inTraining: boolean }[]; totalSkillPoints: number; queue: { active: boolean; endTimeMs: number; entries: { typeID: number; toLevel: number; startTimeMs: number; endTimeMs: number; skillPointsPerMinute: number; startSP: number; destinationSP: number; queuePosition: number }[] } };
  assert.deepEqual(asked.slice(4), ["skillHandler.GetAttributes()"]);
  assert.deepEqual(whose.wanted, [[[3300, 3450], 3450]]);
  // Memory 27 and half of charisma 21: 37.5 a minute, and two minutes on the 8000 it had.
  assert.deepEqual(sheet.skills.map((row) => [row.typeID, row.skillPoints, row.inTraining]), [[3450, 8075, true], [3300, 45255, false]]);
  assert.deepEqual(sheet.queue.entries, [{ queuePosition: 0, typeID: 3450, toLevel: 4, startSP: 8000, destinationSP: 45255, startTimeMs: START_MS, endTimeMs: START_MS + 3_600_000, skillPointsPerMinute: 37.5 }]);
  assert.deepEqual([sheet.queue.active, sheet.queue.endTimeMs, sheet.totalSkillPoints], [true, START_MS + 3_600_000, 45255 + 8000 + 250 + 700]);
  // It is the making itself, given the same things.
  const facts = await whose.typeFacts([], null);
  assert.deepEqual(sheet, buildSkillSheet({ characterID: 140000002, characterName: "Test Two", skills: SKILLS, allSkills: ALL, queue: TRAINING, freeSkillPoints: 700, attributes: ATTRIBUTES, now: whose.now, typeName: facts.name, typeGroupName: facts.groupName, typeAttribute: facts.attribute }));
});

test("where the queue's read is not carried there is no sheet here, and nothing else is asked; any other failure fails the sheet", async () => {
  // The web gateway's list has not got the call: the route's sheet is the one to read.
  const refused = asking({ ...READS, GetSkillQueueAndFreePoints: () => { throw failing("CALL_NOT_ALLOWED"); } });
  const whose = whoseSheet();
  assert.equal(await readSkillSheet(refused.ask, whose), null);
  assert.deepEqual([refused.asked, whose.wanted], [["skillHandler.GetSkillQueueAndFreePoints()"], []]);
  // Anything else the queue's read fails with is the sheet's failure.
  for (const code of ["CALL_REFUSED", "SESSION_NOT_FOUND", "NO_LIVE_SESSION", "BRIDGE_NETWORK_ERROR"]) {
    const lost = failing(code);
    await assert.rejects(readSkillSheet(asking({ ...READS, GetSkillQueueAndFreePoints: () => { throw lost; } }).ask, whoseSheet()), (error) => error === lost, code);
  }
  // So is each other read's, the not-carried kind too: only the queue's says where the sheet is made.
  for (const method of ["GetSkills", "GetAllSkills", "GetFreeSkillPoints", "GetAttributes"]) {
    for (const code of ["CALL_REFUSED", "CALL_NOT_ALLOWED"]) {
      const lost = failing(code);
      await assert.rejects(readSkillSheet(asking({ ...READS, GetSkillQueueAndFreePoints: [TRAINING, 0] as unknown as JsonValue, [method]: () => { throw lost; } }).ask, whoseSheet()), (error) => error === lost, `${method} ${code}`);
    }
  }
  // And the facts' reading.
  const noFacts = failing("BRIDGE_NETWORK_ERROR");
  await assert.rejects(readSkillSheet(asking(READS).ask, whoseSheet({ typeFacts: async () => { throw noFacts; } })), (error) => error === noFacts);
});

test("an answer that is no queue is no sheet: said, and nothing more asked", async () => {
  for (const answer of [null, 0, [], [null, 0], [0, 0], [{ type: "list" }, 0], [{ type: "list", items: "none" }, 0], { type: "list", items: [] }] as unknown as JsonValue[]) {
    const { ask, asked } = asking({ ...READS, GetSkillQueueAndFreePoints: answer });
    await assert.rejects(readSkillSheet(ask, whoseSheet()), (error: { code?: string }) => error.code === "BRIDGE_BAD_RESPONSE", JSON.stringify(answer));
    assert.equal(asked.length, 1, JSON.stringify(answer));
  }
});

test("what is known of a type is asked of the static data once, two names a type, no more than the route takes at once", async () => {
  const namesAsked: (readonly { kind: string; id: number }[])[] = [];
  const attributesAsked: (readonly [readonly number[], readonly number[]])[] = [];
  let unanswered = new Set<string>();
  const reads: StaticReads = {
    async names(items) {
      namesAsked.push(items);
      return Object.fromEntries(items.map((item) => [`${item.kind}:${item.id}`, item.id === 99 ? null : `${item.kind} ${item.id}`]).filter(([key]) => !unanswered.has(key as string)));
    },
    async typeAttributes(typeIDs, attributeIDs) {
      attributesAsked.push([typeIDs, attributeIDs]);
      return typeIDs[0] === 404 ? {} : { [typeIDs[0] as number]: { 180: 166, 181: 164 } };
    },
  };
  const facts = createSkillTypeFacts(reads);
  const first = await facts([3300, 3450, 3300, 99], null);
  assert.deepEqual(namesAsked, [[{ kind: "type", id: 3300 }, { kind: "typeGroup", id: 3300 }, { kind: "type", id: 3450 }, { kind: "typeGroup", id: 3450 }, { kind: "type", id: 99 }, { kind: "typeGroup", id: 99 }]]);
  assert.deepEqual([first.name(3300), first.groupName(3450), first.name(99), first.name(7), first.attribute(3300, 180), attributesAsked.length], ["type 3300", "typeGroup 3450", null, undefined, undefined, 0]);
  // Again, with one more: only the one not known is asked for. A type the static data has no name for is known to have none.
  const second = await facts([3450, 3300, 99, 3327], 3450);
  assert.deepEqual(namesAsked.slice(1), [[{ kind: "type", id: 3327 }, { kind: "typeGroup", id: 3327 }]]);
  // The type in training: the two attributes it trains by, asked for once.
  assert.deepEqual(attributesAsked, [[[3450], [180, 181]]]);
  assert.deepEqual([second.attribute(3450, 180), second.attribute(3450, 181), second.attribute(3450, 182), second.attribute(3300, 180), second.name(3327)], [166, 164, undefined, undefined, "type 3327"]);
  await facts([3450], 3450);
  assert.deepEqual([namesAsked.length, attributesAsked.length], [2, 1]);
  // Attributes that were not answered are not kept: asked for again when next wanted.
  assert.equal((await facts([], 404)).attribute(404, 180), undefined);
  await facts([], 404);
  assert.deepEqual(attributesAsked.slice(1), [[[404], [180, 181]], [[404], [180, 181]]]);
  // A name that was not answered is not kept either, whichever of the two it was.
  unanswered = new Set(["type:5000", "typeGroup:5001"]);
  const partly = await facts([5000, 5001], null);
  assert.deepEqual([partly.name(5000), partly.groupName(5000), partly.name(5001), partly.groupName(5001)], [undefined, "typeGroup 5000", "type 5001", undefined]);
  unanswered = new Set();
  const then = namesAsked.length;
  await facts([5000, 5001, 3300], null);
  assert.deepEqual(namesAsked.slice(then), [[{ kind: "type", id: 5000 }, { kind: "typeGroup", id: 5000 }, { kind: "type", id: 5001 }, { kind: "typeGroup", id: 5001 }]]);

  // More types than the route takes names for at once: asked for in turns, each no longer than that.
  const many = createSkillTypeFacts(reads);
  const from = namesAsked.length;
  await many(Array.from({ length: 2 * TYPES_AT_ONCE + 100 }, (unused, index) => 10_000 + index), null);
  assert.deepEqual([TYPES_AT_ONCE, namesAsked.slice(from).map((items) => items.length)], [250, [500, 500, 200]]);
  assert.equal((namesAsked[from + 2] as { id: number }[])[0]?.id, 10_000 + 2 * TYPES_AT_ONCE);
});

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
