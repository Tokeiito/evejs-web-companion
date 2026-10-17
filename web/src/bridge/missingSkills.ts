// What a pilot is missing to fly a ship or use a thing, as the retail client reckons it, out of the skills each type
// needs (the client's requiredSkillsForTypes table: GET /api/client-data/required-skills) and the pilot's skills
// (skillHandler.GetSkills, and GetAllSkills for those lapsed too).
//
//   the gate      baseDogmaLocation.GetMissingSkills (970 to 976): each skill the type needs that the pilot has not,
//                 or has below its level, by the skill's EFFECTIVE level. station.TryActivateShip boards nothing
//                 where any is missing (base.py 221 to 223), and shows the skill requirement window.
//   the window    skillRequirementDialog.py, with skillsvc.py's walks:
//                   the skills listed  GetSkillsMissingToUseItemRecursive (581 to 595): each needed skill below its
//                                      level by the TRAINED level (GetMyLevel), its own needs first where the pilot
//                                      has no points in it at all, each once at the highest level asked
//                   the levels         GetTotalMissingSkillLevelsToUseItem (556 to 566): over every skill needed,
//                                      however deep, the levels short of each
//                   the books          GetSkillBooksMissingFromList (597): the skills listed the pilot has not even
//                                      lapsed
//
// The order of a type's own needs is the table's as the BFF gives it (by skill, rising); the client's is its built
// table's, which was not read.
//
// And the rest of the window (skill_requirement.py, skillBtns.py, the skill bar):
//
//   each skill's mark   RequiredSkillRow._GetTexturePathAndHint (60 to 74): a book not injected, buyable or rare, or
//                       a level short, by the level with the lapsed (SkillController.GetMyLevel)
//   its five boxes      skillLevel.SkillLevel.Layout (44 to 72) with the bar's controller (skillBar/controller.py)
//   the training time   GetSkillTrainingTimeLeftToUseType (620 to 646) and GetRawTrainingTimeForSkillLevel (708 to
//                       724): every skill needed short of its level, each level's points at the pilot's rate
//   the points needed   SkillActionContainer: GetSkillsMissingToUseItemExpandedList (79 to 92), each level to
//                       train, and GetSkillPointsRequiredForSkills (648 to 666) over them
//   Train Skills        AddToQueueButton (130 to 171): those levels of the skills held, added to the queue's end
//                       (skillQueueSvc.AddSkillsToQueue, 285 to 323, those already in it passed over)

import { skillPointsForLevel } from "./skillSheet.ts";

/** const.MIN: a minute in the game's 100 ns ticks. */
const MINUTE_TICKS = 600_000_000;
/** characterskills.MAX_SKILL_LEVEL */
const MAX_SKILL_LEVEL = 5;

/** The skills each type needs, by type: skill to level. */
export type RequiredSkills = Readonly<Record<number, Readonly<Record<number, number>>>>;

/** One skill of the pilot's, as its CharacterSkillEntry says. */
export interface PilotSkill {
  readonly trainedSkillLevel: number;
  readonly trainedSkillPoints: number;
  readonly effectiveSkillLevel: number;
}

/** The pilot's skills by type. */
export type PilotSkills = ReadonlyMap<number, PilotSkill>;

/** A type's own needs, in the table's order: [skill, level]. */
function needsOf(required: RequiredSkills, typeID: number): readonly (readonly [number, number])[] {
  return Object.entries(required[typeID] ?? {}).map(([skill, level]) => [Number(skill), Number(level)] as const);
}

/** baseDogmaLocation.GetMissingSkills: skill to the level needed, for each one the pilot is short of. */
export function missingSkills(typeID: number, required: RequiredSkills, skills: PilotSkills): ReadonlyMap<number, number> {
  const missing = new Map<number, number>();
  for (const [skill, level] of needsOf(required, typeID)) {
    const mine = skills.get(skill);
    if (mine === undefined || mine.effectiveSkillLevel < level) missing.set(skill, level);
  }
  return missing;
}

/** skillsvc.GetSkillsMissingToUseItemRecursive: [skill, level], each once, its own needs before it. */
export function missingSkillsRecursive(
  typeID: number,
  required: RequiredSkills,
  skills: PilotSkills,
  includingLapsed: PilotSkills,
): readonly (readonly [number, number])[] {
  const listed = new Map<number, number>();
  const walk = (of: number): void => {
    for (const [skill, level] of needsOf(required, of)) {
      const myLevel = skills.get(skill)?.trainedSkillLevel;
      if (myLevel !== undefined && myLevel >= level) continue;
      if (skill !== of) {
        const lapsed = includingLapsed.get(skill);
        if (lapsed === undefined || lapsed.trainedSkillPoints <= 0) walk(skill);
      }
      listed.set(skill, Math.max(listed.get(skill) ?? 0, level));
    }
  };
  walk(typeID);
  return [...listed.entries()];
}

/** skillsvc.GetTotalMissingSkillLevelsToUseItem: the levels short of every skill needed, however deep. */
export function totalMissingLevels(typeID: number, required: RequiredSkills, skills: PilotSkills): number {
  const all = new Map<number, number>();
  const walk = (of: number, seen: Set<number>): void => {
    for (const [skill, level] of needsOf(required, of)) {
      all.set(skill, Math.max(all.get(skill) ?? 0, level));
      if (skill !== of && !seen.has(skill)) walk(skill, new Set([...seen, skill]));
    }
  };
  walk(typeID, new Set([typeID]));
  let short = 0;
  for (const [skill, level] of all) {
    const myLevel = skills.get(skill)?.trainedSkillLevel ?? 0;
    if (myLevel < level) short += level - myLevel;
  }
  return short;
}

/** skillsvc.GetSkillBooksMissingFromList: the skills listed that the pilot has not, lapsed or not. */
export function missingSkillBooks(listed: readonly (readonly [number, number])[], includingLapsed: PilotSkills): readonly number[] {
  return listed.map(([skill]) => skill).filter((skill) => !includingLapsed.has(skill));
}

/** skillsvc.GetMissingSkillBooksFromList, which the skill actions go by: the skills listed the pilot has not (GetSkill). */
export function skillsNotHeld(listed: readonly (readonly [number, number])[], skills: PilotSkills): readonly number[] {
  return listed.map(([skill]) => skill).filter((skill) => !skills.has(skill));
}

/** skillsvc.GetRequiredSkillsRecursive: every skill the type needs, however deep, at the highest level any asks it. */
export function requiredSkillsRecursive(typeID: number, required: RequiredSkills): ReadonlyMap<number, number> {
  const all = new Map<number, number>();
  const walk = (of: number, seen: ReadonlySet<number>): void => {
    for (const [skill, level] of needsOf(required, of)) {
      all.set(skill, Math.max(all.get(skill) ?? 0, level));
      if (skill !== of && !seen.has(skill)) walk(skill, new Set([...seen, skill]));
    }
  };
  walk(typeID, new Set([typeID]));
  return all;
}

/** skillsvc.IsSkillRequirementMet: each skill the type itself needs trained to its level (MySkillLevel). */
export function isSkillRequirementMet(typeID: number, required: RequiredSkills, skills: PilotSkills): boolean {
  return needsOf(required, typeID).every(([skill, level]) => (skills.get(skill)?.trainedSkillLevel ?? 0) >= level);
}

/** What a skill's training is reckoned by, as the client's skill service has it. */
export interface SkillTrainingFacts {
  /** The skill's rank: its type's skillTimeConstant (GetSkillRank). Null where it is not known. */
  rank(skill: number): number | null;
  /** The pilot's points a minute at the skill, skill accelerators left out (GetSkillpointsPerMinute(includeBoosters=False)). */
  rate(skill: number): number | null;
  /** The pilot's points in the skill now, the training since it began counted (skillQueueSvc.GetSkillPointsFromSkillObject). */
  pointsNow(skill: number): number;
}

/**
 * dogma/effects SKILL_ACCELERATOR_EFFECT_IDS (dogma/effects/__init__.py 345 to 350): the five effects that add to an
 * attribute from a booster (Analytical Mind 306, Empathy 302, Instant Recall 304, Iron Will 308, Spatial Awareness 310).
 */
export const SKILL_ACCELERATOR_EFFECT_IDS: ReadonlySet<number> = new Set([306, 302, 304, 308, 310]);

/**
 * dogma/effects IsBoosterSkillAccelerator (352 to 357): a booster is a skill accelerator where its type's passive
 * effects (GetPassiveFilteredEffectsByType) hold one of those five.
 */
export function isBoosterSkillAccelerator(passiveEffects: readonly number[] | null | undefined): boolean {
  return Array.isArray(passiveEffects) && passiveEffects.some((effectID) => SKILL_ACCELERATOR_EFFECT_IDS.has(effectID));
}

/**
 * skillsvc.GetSkillTrainingTimeLeftToUseType(typeID, includeBoosters=False): the time, in ticks, to train every skill
 * the type needs to its level; nought where the type's own needs are met. Null where a rank or a rate is not known.
 */
export function trainingTimeLeft(
  typeID: number,
  required: RequiredSkills,
  skills: PilotSkills,
  includingLapsed: PilotSkills,
  facts: SkillTrainingFacts,
): number | null {
  if (isSkillRequirementMet(typeID, required, skills)) return 0;
  return trainingTimeForSkills(requiredSkillsRecursive(typeID, required), skills, includingLapsed, facts);
}

/**
 * skillsvc.GetTrainingTimeForSkills (1112 to 1123): the time, in ticks, to train each skill from the level trained
 * (GetSkillIncludingLapsed's, the lapsed counted) to the level given, each level at GetRawTrainingTimeForSkillLevel.
 * Null where a rank or a rate is not known.
 */
export function trainingTimeForSkills(
  levels: Iterable<readonly [number, number]>,
  skills: PilotSkills,
  includingLapsed: PilotSkills,
  facts: SkillTrainingFacts,
): number | null {
  let total = 0;
  for (const [skill, toLevel] of levels) {
    const had = includingLapsed.get(skill);
    if (had !== undefined && had.trainedSkillLevel >= toLevel) continue;
    for (let level = (had?.trainedSkillLevel ?? 0) + 1; level <= toLevel; level += 1) {
      // GetRawTrainingTimeForSkillLevel: the level's points less those the pilot has toward it, at the pilot's rate.
      const rank = facts.rank(skill);
      const rate = facts.rate(skill);
      if (rank === null || rate === null || !(rate > 0)) return null;
      const toTrain = skillPointsForLevel(rank, level);
      const mine = skills.get(skill);
      const existing = mine === undefined ? 0 : level - 1 === mine.trainedSkillLevel ? facts.pointsNow(skill) : skillPointsForLevel(rank, level - 1);
      if (existing <= toTrain) total += ((toTrain - existing) / rate) * MINUTE_TICKS;
    }
  }
  return Math.trunc(total);
}

/** SkillActionContainer.GetSkillsMissingToUseItemExpandedList: each level of each skill listed above the one trained. */
export function levelsToTrain(listed: readonly (readonly [number, number])[], skills: PilotSkills): readonly (readonly [number, number])[] {
  const levels: (readonly [number, number])[] = [];
  for (const [skill, level] of listed) {
    const trained = skills.get(skill)?.trainedSkillLevel ?? 0;
    for (let at = trained + 1; at <= level; at += 1) levels.push([skill, at]);
  }
  return levels;
}

/** skillsvc.GetSkillPointsRequiredForSkills, summed: the points each level costs, less those already toward it. Null where a rank is not known. */
export function skillPointsRequired(
  levels: readonly (readonly [number, number])[],
  skills: PilotSkills,
  rank: (skill: number) => number | null,
): number | null {
  let sum = 0;
  for (const [skill, level] of levels) {
    const mine = skills.get(skill);
    if (mine !== undefined && mine.trainedSkillLevel >= level) continue;
    const skillRank = rank(skill);
    if (skillRank === null) return null;
    const present = mine !== undefined && mine.trainedSkillLevel === level - 1 ? mine.trainedSkillPoints - skillPointsForLevel(skillRank, mine.trainedSkillLevel) : 0;
    sum += skillPointsForLevel(skillRank, level) - skillPointsForLevel(skillRank, level - 1) - present;
  }
  return sum;
}

/** characterskills.util.DIVCONSTANT */
const DIVCONSTANT = Math.log(2) * 2.5;
/** characterskills.SKILL_POINT_MULTIPLIER */
const SKILL_POINT_MULTIPLIER = 250;

/** characterskills.util.GetSkillLevelRaw: the level a skill of a rank is at with so many points. */
export function skillLevelRaw(skillPoints: number, rank: number): number {
  const base = rank * SKILL_POINT_MULTIPLIER;
  if (base > skillPoints || base === 0) return 0;
  return Math.min(1 + Math.trunc(Math.log(skillPoints / base) / DIVCONSTANT), MAX_SKILL_LEVEL);
}

/** characterskills.util.GetLevelProgress: how far into its next level a skill with so many points is, nought to one. */
export function levelProgress(skillPoints: number, rank: number): number {
  const level = skillLevelRaw(skillPoints, rank);
  if (level >= MAX_SKILL_LEVEL) return 0.0;
  const base = skillPointsForLevel(rank, level);
  const next = skillPointsForLevel(rank, level + 1);
  return (skillPoints - base) / (next - base);
}

/** characterskills/common/purchase.py DIRECT_PURCHASE_TAX_RATE */
const DIRECT_PURCHASE_TAX_RATE = 0.3;

/** characterskills.common.get_direct_purchase_price: a book's base price and its tax. */
export function directPurchasePrice(basePrice: number): number {
  return basePrice * (1.0 + DIRECT_PURCHASE_TAX_RATE);
}

/**
 * SkillPurchaseValidator.prevalidate (characterskills/client/purchase.py): the skills asked, each once, those that are
 * skills, those not injected (IsSkillInjected: among the skills with the lapsed), split into those sold
 * (IsSkillAvailableForPurchase) and those not.
 */
export function booksToBuy(
  skillTypeIDs: readonly number[],
  includingLapsed: PilotSkills,
  isSkill: (typeID: number) => boolean,
  isSold: (typeID: number) => boolean,
): { readonly available: readonly number[]; readonly unavailable: readonly number[] } {
  const wanted = [...new Set(skillTypeIDs)].filter((typeID) => isSkill(typeID) && !includingLapsed.has(typeID));
  return { available: wanted.filter(isSold), unavailable: wanted.filter((typeID) => !isSold(typeID)) };
}

/** A skill's row's mark (RequiredSkillRow): its book not injected (one to buy, or a rare one), or a level short. */
export type SkillRowMark = "book-missing" | "rare-book-missing" | "level-short" | null;

export function skillRowMark(skill: number, level: number, includingLapsed: PilotSkills, buyable: boolean): SkillRowMark {
  const had = includingLapsed.get(skill);
  if (had === undefined) return buyable ? "book-missing" : "rare-book-missing";
  return had.trainedSkillLevel < level ? "level-short" : null;
}

/** One place of the queue: a skill and the level it trains to. */
export interface QueuedLevel {
  readonly typeID: number;
  readonly toLevel: number;
}

/** skillQueueSvc.IsSkillRequirementMetIncludingSkillQueue: each skill the type needs trained to its level, or queued to it. */
export function isRequirementMetIncludingQueue(typeID: number, required: RequiredSkills, skills: PilotSkills, queue: readonly QueuedLevel[]): boolean {
  return needsOf(required, typeID).every(([skill, level]) =>
    (skills.get(skill)?.trainedSkillLevel ?? 0) >= level || queue.some((entry) => entry.typeID === skill && entry.toLevel >= level));
}

/** A level's box of the skill bar (skillLevel.SkillLevel.Layout), as an omega clone's bar shows it. */
export type SkillLevelBox = "none" | "training" | "trained" | "trained-omega" | "queued" | "untrained" | "small" | "small-omega";

/**
 * An alpha clone's highest level of each skill (clonegrade.CloneGradeStorage()[session.raceID].skillsByTypeID: a
 * skill not in it is 0). An omega has none: every skill to 5 (clone_grade_svc.get_max_skill_level).
 */
export type AlphaCeilings = ReadonlyMap<number, number>;

/** skillsvc.IsUnlockedWithExpertSystem (502 to 516): every skill the type needs held, and at least one short of its level trained but at it with what an expert system gives. */
function isUnlockedWithExpertSystem(typeID: number, required: RequiredSkills, skills: PilotSkills): boolean {
  let unlocked = false;
  for (const [skill, level] of needsOf(required, typeID)) {
    const mine = skills.get(skill);
    if (mine === undefined) return false;
    if (mine.trainedSkillLevel < level && mine.effectiveSkillLevel >= level) unlocked = true;
    else if (mine.trainedSkillLevel < level) return false;
  }
  return unlocked;
}

/**
 * ItemObject.NeedsOmegaUpgrade (tooltip/itemObject.py 18 to 31): an alpha clone's, where a skill the type needs, at any
 * depth, is needed above the alpha's ceiling for it (clone_grade_svc.is_requirements_restricted) and an expert system
 * does not unlock the type. And for a type that is a skill (`skillLevelIncludingQueued` given: skillsvc
 * MySkillLevelIncludingQueued, the level trained or queued, nought where the skill is not had), where that level, or
 * the level after it below V, is above the alpha's ceiling for the skill (is_skill_level_restricted). Never an omega's.
 */
export function needsOmegaUpgrade(typeID: number, required: RequiredSkills, skills: PilotSkills, ceilings: AlphaCeilings | null, skillLevelIncludingQueued: number | null = null): boolean {
  if (ceilings === null) return false;
  let restricted = false;
  for (const [skill, level] of requiredSkillsRecursive(typeID, required)) {
    if ((ceilings.get(skill) ?? 0) < level) {
      restricted = true;
      break;
    }
  }
  if (restricted && !isUnlockedWithExpertSystem(typeID, required, skills)) return true;
  if (skillLevelIncludingQueued === null) return false;
  const ceiling = ceilings.get(typeID) ?? 0;
  if (ceiling < skillLevelIncludingQueued) return true;
  return skillLevelIncludingQueued < 5 && ceiling < skillLevelIncludingQueued + 1;
}

/**
 * The skill bar's five boxes for a skill required at a level: past the level none (showEmpty is off); then the level
 * in training, trained, trainable (queued or not, and the next one marked where the pilot has points toward it), or
 * the small box of one that is not. "partial" is that mark. For an alpha clone whose ceiling for the skill is under
 * 5 (`alphaCeiling`, null for an omega: SkillBarController.isRestricted and restrictedLevel), a level above it is
 * not trainable (IsLevelTrainable), and its box is the omega one: trained in the omega colour, or its small box
 * (skillLevel.py Layout, 54 to 76).
 */
export function skillLevelBoxes(
  skill: number,
  requiredLevel: number,
  required: RequiredSkills,
  skills: PilotSkills,
  includingLapsed: PilotSkills,
  queue: readonly QueuedLevel[],
  training: number | null,
  rank: number | null,
  alphaCeiling: number | null = null,
): readonly { readonly box: SkillLevelBox; readonly partial: boolean }[] {
  const restricted = alphaCeiling !== null && alphaCeiling < MAX_SKILL_LEVEL;
  const myLevel = includingLapsed.get(skill)?.trainedSkillLevel ?? 0;
  const injected = includingLapsed.has(skill);
  const points = skills.get(skill)?.trainedSkillPoints ?? 0;
  const lapsedPoints = includingLapsed.get(skill)?.trainedSkillPoints ?? 0;
  const prerequisitesMet = isRequirementMetIncludingQueue(skill, required, skills, queue);
  const partiallyTrained = injected && rank !== null && lapsedPoints - skillPointsForLevel(rank, myLevel) > 0;
  const boxes: { box: SkillLevelBox; partial: boolean }[] = [];
  for (let level = 1; level <= MAX_SKILL_LEVEL; level += 1) {
    if (requiredLevel > 0 && level > requiredLevel) {
      boxes.push({ box: "none", partial: false });
      continue;
    }
    const inTraining = training === skill && queue[0]?.typeID === skill && queue[0]?.toLevel === level;
    const aboveAlpha = restricted && alphaCeiling! < level;
    const trainable = level > myLevel && injected && (prerequisitesMet || points !== 0) && !aboveAlpha;
    const box: SkillLevelBox = inTraining
      ? "training"
      : level <= myLevel
        ? aboveAlpha ? "trained-omega" : "trained"
        : trainable
          ? queue.some((entry) => entry.typeID === skill && entry.toLevel === level) ? "queued" : "untrained"
          : aboveAlpha ? "small-omega" : "small";
    boxes.push({ box, partial: trainable && !inTraining && level === myLevel + 1 && partiallyTrained });
  }
  return boxes;
}

/**
 * skillQueueSvc.AddSkillsToQueue(levels, ignoreAlreadyPresent=True): the queue with each level not already in it
 * added at its end, in turn.
 */
export function queueWithLevels(queue: readonly QueuedLevel[], levels: readonly (readonly [number, number])[]): readonly QueuedLevel[] {
  const next = [...queue];
  for (const [typeID, toLevel] of levels) {
    if (!next.some((entry) => entry.typeID === typeID && entry.toLevel === toLevel)) next.push({ typeID, toLevel });
  }
  return next;
}

/** AddToQueueButton: whether every level is in the queue already, each skill queued at least so high (the button is then spent). */
export function allLevelsQueued(levels: readonly (readonly [number, number])[], queue: readonly QueuedLevel[]): boolean {
  return levels.every(([skill, level]) => {
    const queued = queue.filter((entry) => entry.typeID === skill).map((entry) => entry.toLevel);
    return queued.length > 0 && Math.max(...queued) >= level;
  });
}
