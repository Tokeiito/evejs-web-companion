// An opened plan's contents: each level's button (skillPlan/contents/SkillPlanContentsSkillEntry.py, its
// SkillLevelEntryPrimaryButton in skillEntryPrimaryButton.py), and the queue's rules it acts by
// (eve/client/script/ui/services/skillQueueSvc.py).
//
//   the state        SkillLevelEntryPrimaryButton._GetState, in this order:
//     omega          not omega, and the level above the clone's ceiling for the skill (RequiresOmegaClone); its click
//                    opens the clone upgrade window
//     book           the skill's book, or the book of a skill it needs however deep, not held, lapsed ones counted held
//                    (IsInjected, IsAllPrereqsInjected); its click buys them (BuyAllRequiredSkillbooks:
//                    buy_missing_skills of its needs and itself)
//     remove         the level is queued and may come out (CheckCanRemoveSkillFromQueue); its click takes it out
//                    (RemoveSkillsFromQueue)
//     remove-locked  the level is queued and may not come out; off
//     trained        the level trained, lapsed counted (GetMyLevel); off
//     add            else; its click queues it and what it needs (AddSkillAndRequirementsToQueue)
//   the hints        HINT_PER_STATE; add's with the level, and under it the skill points the level lacks and the
//                    pilot's skill points a minute for the skill (its tooltip panel)
//   the entry's own  SkillPlanContentsSkillEntry hands its callbacks under keys the button does not read
//                    (onAddToQueueActionCallback, onDefaultActionCallback), so the button's own run, and the entry's
//                    AskTrackPlan (OnEntrySkillAddedToQueue) is never asked from the button

import type { PilotSkills, QueuedLevel, RequiredSkills } from "./missingSkills.ts";

/** skillConst.skill_max_level */
const SKILL_MAX_LEVEL = 5;

export type LevelButtonState = "omega" | "book" | "remove" | "remove-locked" | "trained" | "add";

/** HINT_PER_STATE */
export const LEVEL_BUTTON_HINTS: Readonly<Record<LevelButtonState, string>> = {
  omega: "UI/CloneState/RequiresOmegaClone",
  book: "UI/SkillPlan/ClickToBuyMissingSkillAndRequirements",
  remove: "UI/SkillPlan/RemoveFromQueue",
  "remove-locked": "UI/SkillPlan/RemoveFromQueueLocked",
  trained: "UI/SkillPlan/AlreadyTrained",
  add: "UI/SkillPlan/AddToQueue",
};

/** DISABLED_STATES, of those a level's button can be in. */
export function levelButtonOff(state: LevelButtonState): boolean {
  return state === "remove-locked" || state === "trained";
}

export interface LevelButtonFacts {
  /** clone_grade_svc.is_omega_with_grace_period */
  readonly omega: boolean;
  /** GetCurrCloneStateMaxLevel: the clone's ceiling for the skill. */
  readonly ceiling: number;
  /** IsInjected and IsAllPrereqsInjected: the skill's book and those of every skill it needs held, lapsed counted. */
  readonly booksHeld: boolean;
  /** IsInQueue(level) */
  readonly inQueue: boolean;
  /** CheckCanRemoveSkillFromQueue raised nothing. */
  readonly canRemove: boolean;
  /** GetMyLevel: the level trained, lapsed counted; nought where the skill is not held. */
  readonly myLevel: number;
}

/** SkillLevelEntryPrimaryButton._GetState */
export function levelButtonState(level: number, facts: LevelButtonFacts): LevelButtonState {
  if (!facts.omega && level > facts.ceiling) return "omega";
  if (!facts.booksHeld) return "book";
  if (facts.inQueue) return facts.canRemove ? "remove" : "remove-locked";
  if (facts.myLevel >= level) return "trained";
  return "add";
}

/**
 * CheckCanRemoveSkillFromQueue: the refusal's dialog, or null where the level may come out. Not where a higher level
 * of the skill is queued (QueueCannotRemoveSkillsWithHigherLevelsStillInQueue), nor where a skill queued needs this
 * one at this level or higher (GetDependentSkills: the pilot's skills' own needs, and a queued skill is one of them;
 * QueueCannotRemoveSkillsWithDependentSkillsInQueue). Nothing is refused for a skill not queued at all.
 */
export function queueRemovalRefusal(skill: number, level: number, queue: readonly QueuedLevel[], required: RequiredSkills): string | null {
  if (!queue.some((entry) => entry.typeID === skill)) return null;
  if (queue.some((entry) => entry.typeID === skill && entry.toLevel > level)) return "QueueCannotRemoveSkillsWithHigherLevelsStillInQueue";
  const dependentQueued = queue.some((entry) =>
    (required[entry.typeID] ?? []).some(([need, needLevel]) => need === skill && level <= needLevel));
  return dependentQueued ? "QueueCannotRemoveSkillsWithDependentSkillsInQueue" : null;
}

/** FindNextLevel: the first level above the trained one (lapsed counted) that is not queued; 6 past the last. */
export function nextLevelToQueue(skill: number, includingLapsed: PilotSkills, queue: readonly QueuedLevel[]): number {
  const current = includingLapsed.get(skill)?.trainedSkillLevel ?? 0;
  for (let level = 1; level < 7; level += 1) {
    if (level <= current) continue;
    if (!queue.some((entry) => entry.typeID === skill && entry.toLevel === level)) return level;
  }
  return 7;
}

/**
 * AddSkillAndRequirementsToQueue(skill, level)'s levels. What the skill needs and lacks (missing:
 * GetSkillsMissingToUseItemRecursive, an OrderedDict, its own needs first) with the skill itself set to the level; of
 * those, each held (lapsed counted) whose trained level, and whose last level in the queue (GetMaxSkillLevelsInQueue:
 * the queue's last place for it), are under the level wanted (already_trained_or_queued, which passes over a book not
 * held); each put after the rest that it needs however deep (requiredRecursive); each from its next level
 * (FindNextLevel, the queue as it was) to the level wanted. Then AddSkillsToQueue: each put at the end in turn, and
 * where one is in the queue already the adding stops there (QueueSkillAlreadyPresent, which it logs and does not
 * commit): stopped is then true, and levels holds those before it.
 */
export function levelsForSkillAndRequirements(
  skill: number,
  level: number,
  missing: readonly (readonly [number, number])[],
  includingLapsed: PilotSkills,
  queue: readonly QueuedLevel[],
  requiredRecursive: (typeID: number) => ReadonlyMap<number, number>,
): { readonly levels: readonly (readonly [number, number])[]; readonly stopped: boolean } {
  if (level > SKILL_MAX_LEVEL) return { levels: [], stopped: false };
  const required = new Map<number, number>(missing);
  required.set(skill, level);
  const lastQueued = new Map<number, number>();
  for (const entry of queue) lastQueued.set(entry.typeID, entry.toLevel);
  const pending = [...required].filter(([id, wanted]) => {
    const held = includingLapsed.get(id);
    if (held === undefined || held.trainedSkillLevel >= wanted) return false;
    return (lastQueued.get(id) ?? 0) < wanted;
  });
  const ordered: [number, number][] = [];
  // The client goes round for as long as one waits on another; a ring of needs (none in the client's data) would
  // keep it going, so the page stops after every order has been tried.
  let turns = 0;
  while (pending.length > 0 && turns < pending.length * pending.length + 1) {
    const [id, wanted] = pending.shift()!;
    const needs = requiredRecursive(id);
    if (pending.some(([other]) => needs.has(other))) {
      pending.push([id, wanted]);
      turns += 1;
      continue;
    }
    for (let at = nextLevelToQueue(id, includingLapsed, queue); at <= wanted; at += 1) ordered.push([id, at]);
  }
  const added: [number, number][] = [];
  for (const [id, at] of ordered) {
    if (queue.some((entry) => entry.typeID === id && entry.toLevel === at)) return { levels: added, stopped: true };
    added.push([id, at]);
  }
  return { levels: added, stopped: false };
}
