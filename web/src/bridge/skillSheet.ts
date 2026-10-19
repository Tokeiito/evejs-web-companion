// The Skills window's sheet, made by whoever shows it (the plan's Phase 6b).
//
// Until 2026-10-10 the sheet was made in one place, on the BFF
// (src/gamePort/skillSheet.js), from what the game-port transport keeps of the
// skill handler's answers. This is the same making, in TypeScript the page and
// the hosted bots share, on the answers as the generic call hands them
// (src/gamePort/bridgeJson.js): text is a string, and a 64-bit integer past
// what a number holds, which a server's time is, is {type:"long",
// value:"<digits>"}. With it the page can make the sheet from the reads it asks
// for itself (skillReads.ts). The sheet is in the form the route's is in, so one
// decoder (skills.ts) reads either.
//
// Each figure is made the way the client's own windows make it:
//
//   a skill's row        its entry as answered: level, points, rank
//   a level's points     characterskills/util.py GetSPForLevelRaw
//   the skill training   skillQueueSvc.SkillInTraining: the queue's first entry,
//                        where that has an end
//   its points           skillQueueSvc.GetSkillPointsFromSkillObject: the points
//                        answered and what the time since the queue began has
//                        added at the pilot's rate
//   the rate             characterskills/util.py GetSkillPointsPerMinute, from
//                        the character's attributes for the skill's two
//   the total            skillsvc.GetTotalSkillPointsForCharacter: every skill's
//                        points, the lapsed with them, and the free points
//
// Given the skill accelerators running and the clone's grade, the points in
// training and each queued level's time are reckoned as the client reckons them,
// a booster running out on the way and an alpha clone's attributes halved
// (skillTraining.ts: GetEstimatedSkillPointsTrained and GetAllTrainingLengths).
// The BFF's making (the web gateway's sheet) does neither.

import type { JsonValue } from "./wire.ts";
import { allTrainingLengths, estimatedPointsTrained, trainingEstimate, type SkillAccelerator, type TrainingFacts } from "./skillTraining.ts";

/** characterskills/const.py */
const MAX_SKILL_LEVEL = 5;
const SKILL_POINT_MULTIPLIER = 250;
/** characterskills/queue.py */
const SKILLQUEUE_MAX_NUM_SKILLS = 150;
/** dogma/const.py: which of the character's attributes a skill trains by. */
export const ATTRIBUTE_PRIMARY = 180;
export const ATTRIBUTE_SECONDARY = 181;
/** 1601 to 1970, in the 100 ns the server counts in. */
const FILETIME_EPOCH = 116444736000000000n;

type Entry = readonly [unknown, unknown];

/** A long as the generic call hands one that a number cannot hold: its digits, or null. */
function longDigits(value: unknown): string | null {
  if (value === null || typeof value !== "object" || (value as { type?: unknown }).type !== "long") return null;
  const digits = (value as { value?: unknown }).value;
  return typeof digits === "string" && /^-?\d+$/.test(digits) ? digits : null;
}

/**
 * A number as answered: a number as it is, a long as the nearest number. Null for anything else. (What is read
 * here came as JSON, and a number in JSON is a finite one.)
 */
function number(value: unknown): number | null {
  if (typeof value === "number") return value;
  const digits = longDigits(value);
  return digits === null ? null : Number(BigInt(digits));
}

const entriesOf = (value: unknown): readonly Entry[] => {
  const entries = value !== null && typeof value === "object" && (value as { type?: unknown }).type === "dict" ? (value as { entries?: unknown }).entries : null;
  return Array.isArray(entries) ? (entries as Entry[]) : [];
};
const itemsOf = (value: unknown): readonly unknown[] => {
  const items = value !== null && typeof value === "object" ? (value as { items?: unknown }).items : null;
  return Array.isArray(items) ? items : [];
};

/** A server's time as this machine counts it, in milliseconds. Null for none. */
function epochMs(filetime: unknown): number | null {
  const digits = longDigits(filetime);
  const ticks = digits !== null ? BigInt(digits) : typeof filetime === "number" ? BigInt(Math.trunc(filetime)) : null;
  return ticks !== null && ticks > 0n ? Number((ticks - FILETIME_EPOCH) / 10000n) : null;
}

/** A CharacterSkillEntry's own arguments: (typeID, trainedSkillLevel, trainedSkillPoints, skillRank, virtualSkillLevel). Null where it is none. */
function skillFields(entry: unknown): readonly unknown[] | null {
  const header = entry !== null && typeof entry === "object" ? (entry as { header?: unknown }).header : null;
  return Array.isArray(header) && Array.isArray(header[1]) ? (header[1] as unknown[]) : null;
}

/** A queue entry's fields by name (it is a KeyVal), with none where it has none. */
const queueFields = (entry: unknown): ReadonlyMap<unknown, unknown> =>
  new Map(entriesOf(entry !== null && typeof entry === "object" ? (entry as { args?: unknown }).args : null));

/** characterskills.util.GetSPForLevelRaw: the points a skill of a rank has at a level. */
export function skillPointsForLevel(rank: number, level: number): number {
  if (level <= 0) return 0;
  return Math.ceil(rank * SKILL_POINT_MULTIPLIER * 2 ** (2.5 * (Math.min(level, MAX_SKILL_LEVEL) - 1)));
}

/** characterskills.util.GetSkillPointsPerMinute */
export const skillPointsPerMinute = (primary: number, secondary: number): number => primary + secondary / 2.0;

/**
 * skill_training.get_skill_points_trained_at_sample_time, with no booster running out on the way: the points a
 * skill had, and what training since `startMs` at `rate` a minute has added by `nowMs`, whole points.
 */
export function pointsTrainedBy(points: number, startMs: number, nowMs: number, rate: number): number {
  if (startMs > nowMs) return points;
  return Math.trunc(((nowMs - startMs) / 60000) * rate + points);
}

/** The queue's places as answered (a list of entries), in order: each one's skill and the level it trains to. */
export function queuedLevels(queue: unknown): readonly { readonly typeID: number; readonly toLevel: number }[] {
  return itemsOf(queue)
    .filter((entry) => entry !== null && typeof entry === "object" && (entry as { type?: unknown }).type === "object")
    .map(queueFields)
    .map((fields) => ({ typeID: number(fields.get("trainingTypeID")) ?? 0, toLevel: number(fields.get("trainingToLevel")) ?? 0 }));
}

/**
 * skillQueueSvc.SkillInTraining: the type of the queue's first entry, where that entry has an end. Null with an
 * empty queue, a stopped one, or none. `queue` is the queue as answered: a list of entries.
 */
export function skillInTraining(queue: unknown): number | null {
  const head = itemsOf(queue)[0];
  if (head === null || typeof head !== "object" || (head as { type?: unknown }).type !== "object") return null;
  const fields = queueFields(head);
  return fields.get("trainingEndTime") ? number(fields.get("trainingTypeID")) : null;
}

/**
 * skillsvc.MyEffectiveSkillLevelsByID().get(typeID, 0), which the client's industry reads of each skill a job
 * requires (industrySvc._UpdateSkills, 224: skillInfo.effectiveSkillLevel): the larger of the level trained and the
 * level lent, out of skillHandler.GetSkills as answered. Nought for a skill the pilot has not.
 */
export function effectiveSkillLevel(skills: unknown, typeID: number): number {
  for (const [key, entry] of entriesOf(skills)) {
    if (number(key) !== typeID) continue;
    const fields = skillFields(entry);
    return fields ? Math.max(number(fields[1]) ?? 0, number(fields[4]) ?? 0) : 0;
  }
  return 0;
}

/**
 * Each skill's trained level and points, and its effective level (the larger of the level trained and the level lent,
 * as effectiveSkillLevel above), out of skillHandler.GetSkills or GetAllSkills as answered, by type.
 */
export function skillLevelsOf(
  skills: unknown,
): ReadonlyMap<number, { readonly trainedSkillLevel: number; readonly trainedSkillPoints: number; readonly effectiveSkillLevel: number; readonly injected: boolean; readonly virtualSkillLevel: number }> {
  const levels = new Map<number, { trainedSkillLevel: number; trainedSkillPoints: number; effectiveSkillLevel: number; injected: boolean; virtualSkillLevel: number }>();
  for (const [key, entry] of entriesOf(skills)) {
    const typeID = number(key);
    const fields = skillFields(entry);
    if (typeID === null || fields === null) continue;
    const trained = number(fields[1]) ?? 0;
    levels.set(typeID, {
      trainedSkillLevel: trained,
      trainedSkillPoints: number(fields[2]) ?? 0,
      effectiveSkillLevel: Math.max(trained, number(fields[4]) ?? 0),
      // An expert system's skill alone: its trainedSkillLevel None (skillsvc.IsSkillInjected).
      injected: number(fields[1]) !== null,
      // The level an expert system gives it (virtualSkillLevel), nought where none.
      virtualSkillLevel: number(fields[4]) ?? 0,
    });
  }
  return levels;
}

/** The types of the skills a list of them names, as answered: those that are a skill's entry at a level. */
export function skillTypeIDs(skills: unknown): readonly number[] {
  const types: number[] = [];
  for (const [typeID, entry] of entriesOf(skills)) {
    const fields = skillFields(entry);
    const type = number(typeID);
    if (fields !== null && number(fields[1]) !== null && type !== null) types.push(type);
  }
  return types;
}

/** What goes into a sheet: whose it is, the handler's reads as answered, the clock, and what is known of a type without asking. */
export interface SkillSheetGiven {
  readonly characterID: number;
  readonly characterName: string;
  /** skillHandler.GetSkills and GetAllSkills. */
  readonly skills: JsonValue;
  readonly allSkills: JsonValue;
  /** The queue alone: the first of what skillHandler.GetSkillQueueAndFreePoints answers. */
  readonly queue: JsonValue;
  /** skillHandler.GetFreeSkillPoints. */
  readonly freeSkillPoints: JsonValue;
  /** skillHandler.GetAttributes, or null: then no rate is said and the skill in training has the points answered. */
  readonly attributes: JsonValue;
  /**
   * The skill accelerators running (skillsvc._GetSkillAcceleratorBoosters, of skillHandler.GetBoosters), each its
   * expiry and its bonus to each attribute; none where not known.
   */
  readonly boosters?: readonly SkillAccelerator[];
  /** An alpha clone (clone_grade_svc): its attributes are halved, and the boosters' bonuses with them. */
  readonly alpha?: boolean;
  /** The server's clock, in milliseconds. Read once, when the rows are made. */
  now(): number;
  typeName(typeID: number): string | null | undefined;
  typeGroupName(typeID: number): string | null | undefined;
  typeAttribute(typeID: number, attributeID: number): number | null | undefined;
}

/** The sheet, in the form the route's is in (decoded by skills.ts). */
export function buildSkillSheet(given: SkillSheetGiven): JsonValue {
  const queued = itemsOf(given.queue).map(queueFields);
  const training = skillInTraining(given.queue);
  const head = queued[0];
  const attribute = (attributeID: number | null): number | null =>
    number((entriesOf(given.attributes).find(([id]) => number(id) === attributeID) ?? [])[1]);
  // skillsvc.GetCharacterAttribute: halved for an alpha clone (clonegrade.ALPHA_TRAINING_MULTIPLIER).
  const grade = given.alpha === true ? 0.5 : 1;
  /** The pilot's rate at a skill, or null where the attributes or the skill's two are not known. */
  const rateFor = (typeID: number): number | null => {
    const [primary, secondary] = [ATTRIBUTE_PRIMARY, ATTRIBUTE_SECONDARY].map((which) => attribute(number(given.typeAttribute(typeID, which))));
    const rate = primary === null || primary === undefined || secondary === null || secondary === undefined ? null : skillPointsPerMinute(primary * grade, secondary * grade);
    // The client's calculator refuses a rate of nothing or less.
    return rate !== null && rate > 0 ? rate : null;
  };
  const trainingRate = training === null ? null : rateFor(training);
  const trainingStartMs = training === null || head === undefined ? null : epochMs(head.get("trainingStartTime"));
  // What the client's training calculator is given (ClientCharacterSkillInterface): the skills including the lapsed,
  // the attributes, the boosters and the grade.
  const lapsed = skillLevelsOf(given.allSkills);
  const ranks = new Map<number, number>();
  for (const [typeID, entry] of entriesOf(given.allSkills)) {
    const type = number(typeID);
    const rank = number((skillFields(entry) ?? [])[3]);
    if (type !== null && rank !== null) ranks.set(type, rank);
  }
  const facts: TrainingFacts = {
    attribute: (attributeID) => (given.attributes === null ? null : attribute(attributeID)),
    alpha: given.alpha === true,
    boosters: given.boosters ?? [],
    rank: (skill) => ranks.get(skill) ?? null,
    primary: (skill) => number(given.typeAttribute(skill, ATTRIBUTE_PRIMARY)),
    secondary: (skill) => number(given.typeAttribute(skill, ATTRIBUTE_SECONDARY)),
    trained: (skill) => {
      const levels = lapsed.get(skill);
      return levels === undefined ? null : { level: levels.trainedSkillLevel, points: levels.trainedSkillPoints };
    },
  };

  interface Row { typeID: number | null; name: string; groupName: string; level: number; rank: number; skillPoints: number; levelSkillPoints: number[]; inTraining: boolean }
  const rows: Row[] = [];
  let inTrainingRow: Row | null = null;
  for (const [typeID, entry] of entriesOf(given.skills)) {
    const fields = skillFields(entry);
    const level = fields ? number(fields[1]) : null;
    if (fields === null || level === null) continue;
    const type = number(typeID);
    const rank = number(fields[3]) ?? 0;
    const row: Row = {
      typeID: type,
      name: String((type === null ? null : given.typeName(type)) ?? ""),
      groupName: String((type === null ? null : given.typeGroupName(type)) ?? ""),
      level,
      rank,
      skillPoints: number(fields[2]) ?? 0,
      levelSkillPoints: Array.from({ length: MAX_SKILL_LEVEL }, (unused, index) => skillPointsForLevel(rank, index + 1)),
      inTraining: type === training,
    };
    if (row.inTraining) inTrainingRow = row;
    rows.push(row);
  }
  rows.sort((left, right) => left.name.localeCompare(right.name));
  // The clock is read after the rows are made: the sheet's time is the time its figures were worked at.
  const nowMs = given.now();
  if (inTrainingRow !== null && trainingRate !== null && trainingStartMs !== null && training !== null) {
    // GetSkillPointsFromSkillObject: the estimate, where it is more than the points answered.
    const estimate = estimatedPointsTrained(facts, training, trainingStartMs, nowMs);
    inTrainingRow.skillPoints = estimate === null
      ? pointsTrainedBy(inTrainingRow.skillPoints, trainingStartMs, nowMs, trainingRate)
      : Math.max(estimate, inTrainingRow.skillPoints);
  }
  // Each queued level's own time and whether a booster runs as it begins (GetAllTrainingLengths), where they can be had.
  const lengths = given.attributes === null
    ? new Map<string, { readonly lengthMs: number; readonly accelerated: boolean }>()
    : allTrainingLengths(
      facts,
      queued.map((entry) => ({ typeID: number(entry.get("trainingTypeID")) ?? 0, toLevel: number(entry.get("trainingToLevel")) ?? 0 })),
      training === null ? null : { typeID: training, queueStartMs: trainingStartMs },
      nowMs,
    );

  const free = Math.max(0, number(given.freeSkillPoints) ?? 0);
  const trained = entriesOf(given.allSkills).reduce((sum, [, entry]) => sum + (number((skillFields(entry) ?? [])[2]) ?? 0), 0);
  const last = queued[queued.length - 1];
  return {
    characterID: given.characterID,
    characterName: given.characterName,
    totalSkillPoints: Math.max(0, trained) + free,
    freeSkillPoints: free,
    serverNowMs: Math.trunc(nowMs),
    skills: rows,
    queue: {
      active: training !== null,
      entries: queued.map((entry, index) => ({
        queuePosition: number(entry.get("queuePosition")) ?? index,
        typeID: number(entry.get("trainingTypeID")) ?? 0,
        toLevel: number(entry.get("trainingToLevel")) ?? 0,
        startSP: number(entry.get("trainingStartSP")) ?? 0,
        destinationSP: number(entry.get("trainingDestinationSP")) ?? 0,
        startTimeMs: epochMs(entry.get("trainingStartTime")),
        endTimeMs: epochMs(entry.get("trainingEndTime")),
        // The rate is said of the skill in training alone: a later entry's is what the attributes are then.
        skillPointsPerMinute: index === 0 && trainingRate !== null ? trainingRate : 0,
        lengthMs: lengths.get(`${number(entry.get("trainingTypeID")) ?? 0}:${number(entry.get("trainingToLevel")) ?? 0}`)?.lengthMs ?? null,
        accelerated: lengths.get(`${number(entry.get("trainingTypeID")) ?? 0}:${number(entry.get("trainingToLevel")) ?? 0}`)?.accelerated ?? false,
      })),
      endTimeMs: last === undefined ? null : epochMs(last.get("trainingEndTime")),
      // skillQueueSvc.GetTrainingEndTimeOfQueue: now and the queue's reckoned length (the level in training at its head,
      // so no correction by its end), where every level's time was had.
      reckonedEndMs: queued.length > 0 && lengths.size === queued.length
        ? nowMs + [...lengths.values()].reduce((sum, length) => sum + length.lengthMs, 0)
        : null,
      maxEntries: SKILLQUEUE_MAX_NUM_SKILLS,
      // GetEstimatedSkillPointsTrained's reckoning of the skill in training, which the readout steps between reads.
      estimate: training === null || given.attributes === null ? null : trainingEstimate(facts, training, trainingStartMs, nowMs),
    },
    queueWarning: null,
  } as unknown as JsonValue;
}
