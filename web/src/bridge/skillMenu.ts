// A skill's menu, as the client's menu service makes it (menusvc.py GetMenuForSkill, 2379 to 2389): a GM's give-skill
// entries (not the page's), the skill queue's entries for a skill the pilot has (skillQueueSvc.py
// GetAddMenuForSkillEntries) or Buy This Type for one it has not (QuickBuy), then the type's menu
// (GetMenuFromItemIDTypeID(None, typeID, includeMarketDetails=True), 2281 to 2352: Show Info, View Market Details where
// the type has a market group, Find in Contracts and Find Personal Assets where it is published, Compare for a category
// in compareCategories, a skill's among them).
//
// The skill queue's entries (GetAddMenuForSkillEntries), for a skill below level V:
//   Add To Front Of Queue ({takes})    the next level at the front, where the skill is not the one training and the
//                                      level after the one trained is not queued; {takes} the time to train it there
//                                      (GetTrainingLengthOfSkill at position 0), or Completion Imminent
//   Remove Level {level} From Queue    the highest level queued, where any is
//   Add Level {nextLevel} To Queue     the next level (FindNextLevel) at the end, where it is below 6
//   Train To Level 5                   every level from the next to V (AddAllLevels), where it is below 6
//   Apply Skill Points                 where the pilot has free points (UseFreeSkillPoints)
// then a separator where there were any.

/** One entry of a skill's menu, in the order the client puts them. */
export type SkillMenuEntry =
  | { readonly kind: "front"; readonly level: number; readonly ticks: number | null }
  | { readonly kind: "removeHighest"; readonly level: number }
  | { readonly kind: "end"; readonly level: number }
  | { readonly kind: "toLevel5"; readonly level: number }
  | { readonly kind: "applyPoints"; readonly points: number }
  | { readonly kind: "separator" }
  | { readonly kind: "buy" }
  | { readonly kind: "showInfo" }
  | { readonly kind: "marketDetails" }
  | { readonly kind: "findInContracts" }
  | { readonly kind: "findPersonalAssets" }
  | { readonly kind: "compare" }
  /** A queue entry's own (SkillQueueSkillEntry.GetMenu): Remove, of the queue's selection. */
  | { readonly kind: "remove" };

/** What the menu is made from, read as the client's services hold it. */
export interface SkillMenuFacts {
  /** GetSkillIncludingLapsed(typeID).trainedSkillLevel; null where the pilot has not the skill. */
  readonly trainedLevel: number | null;
  /** The queue as it stands: each skill's level, in order. */
  readonly queue: readonly { readonly typeID: number; readonly toLevel: number }[];
  /** SkillInTraining(typeID): the queue's head is this skill and is training. */
  readonly inTraining: boolean;
  /** GetTrainingLengthOfSkill(typeID, trainedLevel + 1, 0)'s time, in ticks; null where it cannot be reckoned. */
  readonly frontTicks: number | null;
  /** GetFreeSkillPoints(). */
  readonly freePoints: number;
  /** SkillpointsNextLevel(typeID) + 0.5 - trainedSkillPoints, as the Apply Skill Points entry is given it; null unknown. */
  readonly pointsToNextLevel: number | null;
  /** evetypes.GetMarketGroupID(typeID). */
  readonly marketGroupID: number | null;
  /** evetypes.IsPublished(typeID). */
  readonly published: boolean;
  /** evetypes.GetCategoryID(typeID). */
  readonly categoryID: number | null;
}

/** characterskills MAX_SKILL_LEVEL (skillConst.skill_max_level). */
const MAX_SKILL_LEVEL = 5;

/** inventorycommon/const.py compareCategories: charge, commodity, drone, implant, material, module, structure module,
 * ship, skill, starbase, deployable, subsystem, fighter. */
const COMPARE_CATEGORIES: ReadonlySet<number> = new Set([8, 17, 18, 20, 4, 7, 66, 6, 16, 23, 22, 32, 87]);

/**
 * skillQueueSvc.FindNextLevel (824 to 839): the first level above the one trained (nought where the skill is not had)
 * that the queue has not, up to 6; 6 where every level to V is trained or queued.
 */
export function nextLevelToQueue(typeID: number, trainedLevel: number | null, queue: SkillMenuFacts["queue"]): number {
  const current = trainedLevel ?? 0;
  for (let level = 1; level <= 6; level += 1) {
    if (level <= current) continue;
    if (!queue.some((entry) => entry.typeID === typeID && entry.toLevel === level)) return level;
  }
  return 6;
}

/** The highest level of the skill queued (FindHighestLevelInQueue); null where none is. */
export function highestQueuedLevel(typeID: number, queue: SkillMenuFacts["queue"]): number | null {
  const levels = queue.filter((entry) => entry.typeID === typeID).map((entry) => entry.toLevel);
  return levels.length === 0 ? null : Math.max(...levels);
}

/** GetMenuForSkill(typeID), as entries (the GM's left out). */
export function skillMenuEntries(typeID: number, facts: SkillMenuFacts): SkillMenuEntry[] {
  const entries: SkillMenuEntry[] = [];
  if (facts.trainedLevel !== null) {
    const level = facts.trainedLevel;
    if (level < MAX_SKILL_LEVEL) {
      const nextLevel = nextLevelToQueue(typeID, level, facts.queue);
      if (!facts.inTraining) {
        const nextQueued = facts.queue.some((entry) => entry.typeID === typeID && entry.toLevel === level + 1);
        if (nextLevel < 6 && !nextQueued) entries.push({ kind: "front", level: nextLevel, ticks: facts.frontTicks });
      }
      const highest = highestQueuedLevel(typeID, facts.queue);
      if (highest !== null) entries.push({ kind: "removeHighest", level: highest });
      if (nextLevel < 6) {
        entries.push({ kind: "end", level: nextLevel });
        entries.push({ kind: "toLevel5", level: nextLevel });
      }
      if (facts.freePoints > 0 && facts.pointsToNextLevel !== null) entries.push({ kind: "applyPoints", points: facts.pointsToNextLevel });
    }
    if (entries.length > 0) entries.push({ kind: "separator" });
  } else {
    entries.push({ kind: "buy" });
  }
  entries.push({ kind: "showInfo" });
  if (facts.marketGroupID !== null) entries.push({ kind: "marketDetails" });
  if (facts.published) {
    entries.push({ kind: "findInContracts" });
    entries.push({ kind: "findPersonalAssets" });
  }
  if (facts.categoryID !== null && COMPARE_CATEGORIES.has(facts.categoryID)) entries.push({ kind: "compare" });
  return entries;
}

/**
 * The queue after an entry is chosen, or a refusal (the client's UserError) where AddSkillToQueue raises one before it
 * changes anything; null for an entry that is no change of the queue. Its other checks (CheckCanInsertSkillAtPosition)
 * the server makes when the queue is saved, and its refusal is said then.
 *   front       AddSkillToQueue(typeID, nextLevel, 0)
 *   removeHighest  RemoveHighestLevelFromQueue: the highest level taken out
 *   end         AddSkillToQueue(typeID): the next level at the end
 *   toLevel5    AddAllLevels(typeID, nextLevel): each level from it to V at the end, any already there passed over
 */
export function queueAfter(
  typeID: number,
  entry: SkillMenuEntry,
  queue: SkillMenuFacts["queue"],
  maxQueued: number,
): { readonly queue: SkillMenuFacts["queue"] } | { readonly refusal: "QueueSkillAlreadyPresent" | "QueueTooManySkills" } | null {
  const present = (level: number): boolean => queue.some((each) => each.typeID === typeID && each.toLevel === level);
  if (entry.kind === "front" || entry.kind === "end") {
    if (entry.level > MAX_SKILL_LEVEL) return null;
    if (present(entry.level)) return { refusal: "QueueSkillAlreadyPresent" };
    if (queue.length >= maxQueued) return { refusal: "QueueTooManySkills" };
    const added = { typeID, toLevel: entry.level };
    return { queue: entry.kind === "front" ? [added, ...queue] : [...queue, added] };
  }
  if (entry.kind === "removeHighest") {
    return { queue: queue.filter((each) => !(each.typeID === typeID && each.toLevel === entry.level)) };
  }
  if (entry.kind === "toLevel5") {
    const levels: { typeID: number; toLevel: number }[] = [];
    for (let level = entry.level; level <= MAX_SKILL_LEVEL; level += 1) {
      if (!present(level)) levels.push({ typeID, toLevel: level });
    }
    if (levels.length === 0) return null;
    if (queue.length >= maxQueued) return { refusal: "QueueTooManySkills" };
    return { queue: [...queue, ...levels.slice(0, maxQueued - queue.length)] };
  }
  return null;
}
