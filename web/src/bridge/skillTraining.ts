// A skill's training reckoned as the client's skill services reckon it, a skill accelerator running out on the way
// (characterskills/skill_training.py SkillTrainingTimeCalculator, characterskills/skill_accelerators.py
// SkillAcceleratorBoosters, characterskills/client/skill_training.py ClientCharacterSkillInterface; the queue's
// times are skillQueueSvc.GetAllTrainingLengths and its estimate of the points in training GetEstimatedSkillPointsTrained).
//
// The character's attributes, as the server answers them, hold what each running booster adds. At a time ahead, a
// booster that has run out by then no longer adds its bonus (get_attribute_bonus_expired_at_time_offset), so a
// training that runs past a booster's expiry is reckoned in parts: at the rate with the booster up to its expiry, and
// at the rate without it after. An alpha clone's attributes, and the bonuses taken off them, are halved
// (clonegrade.ALPHA_TRAINING_MULTIPLIER).
//
// Times here are epoch milliseconds, and spans milliseconds; the client's are FILETIME (100 ns). A span the client
// makes a whole number of (long(...)) is truncated to a whole hundred nanoseconds here as well.

import { skillPointsForLevel, skillPointsPerMinute } from "./skillSheet.ts";

/** carbon/common/lib/const.py MIN, in milliseconds; and one hundred nanoseconds, in milliseconds. */
const MIN = 60000;
const TICK = 0.0001;
/** clonegrade/const.py ALPHA_TRAINING_MULTIPLIER */
const ALPHA_TRAINING_MULTIPLIER = 0.5;

/** A skill accelerator the character has running (BoosterInfo): when it runs out, and what it adds to each attribute. */
export interface SkillAccelerator {
  readonly expiryMs: number | null;
  readonly bonus: ReadonlyMap<number, number>;
}

/** What the reckoning needs of the character and its skills (ClientCharacterSkillInterface). */
export interface TrainingFacts {
  /** skillHandler.GetAttributes: the character's attribute, boosters and all; null where it is not known. */
  attribute(attributeID: number): number | null;
  /** clone_grade_svc.is_omega_with_grace_period, not. */
  readonly alpha: boolean;
  /** SkillAcceleratorBoosters: the skill accelerators running (_GetSkillAcceleratorBoosters). */
  readonly boosters: readonly SkillAccelerator[];
  /** A skill's rank, and the two attributes it trains by (godma.GetTypeAttribute); null where not known. */
  rank(skill: number): number | null;
  primary(skill: number): number | null;
  secondary(skill: number): number | null;
  /** GetSkillIncludingLapsed: the skill's trained level and points; null where the character has it not. */
  trained(skill: number): { readonly level: number; readonly points: number } | null;
}

/** A queue's entry: its skill and the level it trains to. */
export interface QueuedLevel {
  readonly typeID: number;
  readonly toLevel: number;
}

const graded = (facts: TrainingFacts, value: number): number => (facts.alpha ? value * ALPHA_TRAINING_MULTIPLIER : value);

/**
 * ClientCharacterSkillInterface.get_character_attribute_at_time: the attribute as the character has it now, less what
 * each booster that has run out by `nowMs + offsetMs` adds to it (SkillAcceleratorBoosters
 * get_attribute_bonus_expired_at_time_offset), both halved for an alpha clone.
 */
function attributeAt(facts: TrainingFacts, attributeID: number, offsetMs: number, nowMs: number): number | null {
  const value = facts.attribute(attributeID);
  if (value === null) return null;
  let expired = 0;
  for (const booster of facts.boosters) {
    if (booster.expiryMs !== null && booster.expiryMs !== 0 && booster.expiryMs <= nowMs + offsetMs) expired += booster.bonus.get(attributeID) ?? 0;
  }
  return graded(facts, value) - graded(facts, expired);
}

/** _get_skill_points_per_minute_at: the rate at a skill at a time ahead; null where it cannot be had or is none. */
function rateAt(facts: TrainingFacts, skill: number, offsetMs: number, nowMs: number): number | null {
  const primary = facts.primary(skill);
  const secondary = facts.secondary(skill);
  if (primary === null || secondary === null) return null;
  const [first, second] = [attributeAt(facts, primary, offsetMs, nowMs), attributeAt(facts, secondary, offsetMs, nowMs)];
  if (first === null || second === null) return null;
  const rate = skillPointsPerMinute(first, second);
  // The calculator refuses a rate of nothing or less (SkillPointsTrainedPerMinuteError).
  return rate > 0 ? rate : null;
}

/** _get_booster_expiry_time_offsets: each running booster's expiry after `startMs`, as a span from it, soonest first. */
function expiryOffsets(facts: TrainingFacts, startMs: number): number[] {
  return facts.boosters
    .filter((booster) => booster.expiryMs !== null && booster.expiryMs !== 0 && booster.expiryMs > startMs)
    .map((booster) => booster.expiryMs!)
    .sort((left, right) => left - right)
    .map((expiry) => expiry - startMs);
}

/**
 * _get_training_time_given_skill_points_to_train (115 to 130): the time `points` take from `startMs`, at the rate
 * then, and from each booster's expiry on at the rate without it. Null where a rate cannot be had.
 */
export function trainingTimeFor(facts: TrainingFacts, skill: number, points: number, startMs: number, nowMs: number): number | null {
  const offset = startMs - nowMs;
  let rate = rateAt(facts, skill, offset, nowMs);
  if (rate === null) return null;
  let accumulatedPoints = 0;
  let accumulatedTime = 0;
  for (const expiry of expiryOffsets(facts, startMs)) {
    const untilExpiry = expiry - accumulatedTime;
    const pointsUntilExpiry = (untilExpiry / MIN) * rate;
    if (accumulatedPoints + pointsUntilExpiry >= points) break;
    accumulatedPoints += pointsUntilExpiry;
    accumulatedTime += untilExpiry;
    rate = rateAt(facts, skill, offset + expiry, nowMs);
    if (rate === null) return null;
  }
  const remaining = points - accumulatedPoints;
  return accumulatedTime + Math.trunc((remaining / rate) * (MIN / TICK)) * TICK;
}

/**
 * get_skill_points_trained_at_sample_time (147 to 167): a skill's points at `sampleMs` of a training begun at
 * `startMs`, each booster that runs out before it taking its bonus away from then on. `nowMs` is the time the
 * reckoning stands at (GetEstimatedSkillPointsTrained stands it at the queue's start).
 */
export function pointsTrainedAt(facts: TrainingFacts, skill: number, startingPoints: number, startMs: number, sampleMs: number, nowMs: number): number | null {
  if (startMs > sampleMs) return startingPoints;
  const offset = startMs - nowMs;
  let rate = rateAt(facts, skill, offset, nowMs);
  if (rate === null) return null;
  const sampleOffset = sampleMs - startMs;
  let untilSample = sampleOffset;
  let accumulatedPoints = 0;
  let accumulatedTime = 0;
  for (const expiry of expiryOffsets(facts, startMs)) {
    if (expiry >= sampleOffset) {
      untilSample = sampleOffset - accumulatedTime;
      break;
    }
    const untilExpiry = expiry - accumulatedTime;
    accumulatedPoints += (untilExpiry / MIN) * rate;
    accumulatedTime += untilExpiry;
    rate = rateAt(facts, skill, offset + expiry, nowMs);
    if (rate === null) return null;
  }
  accumulatedPoints += (untilSample / MIN) * rate;
  return Math.trunc(accumulatedPoints + startingPoints);
}

/**
 * GetEstimatedSkillPointsTrained's reckoning as data (the reckoning stood at the queue's start), for the readout to step
 * between reads as the client's skill entry does each second (skillQueueSkillEntry.UpdateProgress): the points the
 * skill has, the queue's start, the rate then, and the rate from each booster's expiry after it.
 */
export interface TrainingEstimate {
  readonly startingPoints: number;
  readonly startMs: number;
  readonly rate: number;
  readonly changes: readonly { readonly offsetMs: number; readonly rate: number }[];
}

/** The estimate of the skill in training from the queue's start (now where none is had); null where a rate cannot be had. */
export function trainingEstimate(facts: TrainingFacts, skill: number, queueStartMs: number | null, nowMs: number): TrainingEstimate | null {
  const start = queueStartMs ?? nowMs;
  const rate = rateAt(facts, skill, 0, start);
  if (rate === null) return null;
  const changes: { offsetMs: number; rate: number }[] = [];
  for (const expiry of expiryOffsets(facts, start)) {
    const after = rateAt(facts, skill, expiry, start);
    if (after === null) return null;
    changes.push({ offsetMs: expiry, rate: after });
  }
  return { startingPoints: facts.trained(skill)?.points ?? 0, startMs: start, rate, changes };
}

/** get_skill_points_trained_at_sample_time (skill_training.py 147 to 167) of an estimate, at `sampleMs`. */
export function estimateAt(estimate: TrainingEstimate, sampleMs: number): number {
  if (estimate.startMs > sampleMs) return estimate.startingPoints;
  let rate = estimate.rate;
  const sampleOffset = sampleMs - estimate.startMs;
  let untilSample = sampleOffset;
  let accumulatedPoints = 0;
  let accumulatedTime = 0;
  for (const change of estimate.changes) {
    if (change.offsetMs >= sampleOffset) {
      untilSample = sampleOffset - accumulatedTime;
      break;
    }
    const untilExpiry = change.offsetMs - accumulatedTime;
    accumulatedPoints += (untilExpiry / MIN) * rate;
    accumulatedTime += untilExpiry;
    rate = change.rate;
  }
  accumulatedPoints += (untilSample / MIN) * rate;
  return Math.trunc(accumulatedPoints + estimate.startingPoints);
}

/** The rate of an estimate at `sampleMs`: the last booster's expiry passed decides it. */
export function estimateRateAt(estimate: TrainingEstimate, sampleMs: number): number {
  let rate = estimate.rate;
  for (const change of estimate.changes) if (estimate.startMs + change.offsetMs <= sampleMs) rate = change.rate;
  return rate;
}

/**
 * skillQueueSvc.GetEstimatedSkillPointsTrained: the points of the skill in training now, reckoned from the queue's
 * start with the reckoning stood at that start (specific_current_time_context).
 */
export function estimatedPointsTrained(facts: TrainingFacts, skill: number, queueStartMs: number | null, nowMs: number): number | null {
  const estimate = trainingEstimate(facts, skill, queueStartMs, nowMs);
  return estimate === null ? null : estimateAt(estimate, nowMs);
}

/**
 * skillQueueSvc.GetSkillPointsAndTimeNeededToTrain: the points a level takes and their time from `startMs`. With
 * points to start from, from those (a level they already reach takes none); without, from the level below's, or the
 * points trained where that is the level the skill has.
 */
function pointsAndTimeToTrain(facts: TrainingFacts, skill: number, toLevel: number, existing: number, startMs: number, nowMs: number): { points: number; time: number } | null {
  const rank = facts.rank(skill);
  if (rank === null) return null;
  let points: number;
  if (existing) {
    points = skillPointsForLevel(rank, toLevel) - existing;
    if (points <= 0) return { points: 0, time: 0 };
  } else {
    const trained = facts.trained(skill);
    const from = (trained?.level ?? 0) === toLevel - 1 ? trained?.points ?? 0 : skillPointsForLevel(rank, toLevel - 1);
    points = skillPointsForLevel(rank, toLevel) - from;
  }
  const time = trainingTimeFor(facts, skill, points, startMs, nowMs);
  return time === null ? null : { points, time };
}

/** Each queued level's figures (GetAllTrainingLengths): the queue's time to its end, its own time, and whether a booster is running as it begins. */
export interface TrainingLength {
  readonly untilEndMs: number;
  readonly lengthMs: number;
  readonly accelerated: boolean;
}

/**
 * skillQueueSvc.GetAllTrainingLengths (585 to 600, with GetAddedSpAndAddedTimeForSkill): each level of the queue in
 * turn, begun where the one before ends, from the points the skill has (the one in training at its estimate) and
 * those the queue's earlier levels of it add. A level whose time cannot be had ends the reckoning.
 */
export function allTrainingLengths(
  facts: TrainingFacts,
  queue: readonly QueuedLevel[],
  inTraining: { readonly typeID: number; readonly queueStartMs: number | null } | null,
  nowMs: number,
): Map<string, TrainingLength> {
  const lengths = new Map<string, TrainingLength>();
  const theoretical = new Map<number, number>();
  let trainingTime = 0;
  for (const { typeID, toLevel } of queue) {
    const startMs = trainingTime + nowMs;
    const accelerated = facts.boosters.some((booster) => booster.expiryMs !== null && booster.expiryMs !== 0 && booster.expiryMs > startMs);
    if (!theoretical.has(typeID)) {
      // GetSkillPointsFromSkillObject: the points trained, or the estimate of the skill in training where that is more.
      const trained = facts.trained(typeID);
      let points = trained?.points ?? 0;
      if (trained !== null && inTraining !== null && inTraining.typeID === typeID) {
        points = Math.max(estimatedPointsTrained(facts, typeID, inTraining.queueStartMs, nowMs) ?? points, points);
      }
      theoretical.set(typeID, points);
    }
    const added = pointsAndTimeToTrain(facts, typeID, toLevel, theoretical.get(typeID)!, startMs, nowMs);
    if (added === null) break;
    trainingTime += added.time;
    theoretical.set(typeID, theoretical.get(typeID)! + added.points);
    lengths.set(`${typeID}:${toLevel}`, { untilEndMs: trainingTime, lengthMs: added.time, accelerated });
  }
  return lengths;
}
