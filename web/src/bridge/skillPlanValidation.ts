// The client's skill plan validation (skills/skillplan/skillPlanValidation.py), as the client runs it: on every edit
// of a plan in its editor (EditableSkillPlanController._ValidateSkillRequirements), on every plan it reads
// (skillPlanService._GetPersonalSkillPlanController: SetRequiredSkills where it changed one) and on every plan it
// saves new (_CreateAndCachePersonalController).
//
// ValidateSkillPlan changes the list in place, in four passes, and says whether any of the first three changed it:
//   _RemoveInvalidSkills                     a skill that is no skill type, not published, or obsolete
//                                            (attributeSkillIsObsolete), every level of it
//   _AddMissingAndRemoveDuplicateSkillLevels each level under a skill's highest put in where missing; a level more
//                                            than once taken out (last first), but only where the skill has more
//                                            levels in the list than its highest
//   _AddMissingPrerequisites                 each skill's needs (get_dogma_required_skills, in the client's table's
//                                            order) put in before its level I, their needs in turn
//   _VerifySkillOrdering                     a need moved before what needs it, a level after the one below it
//
// What it says is the client's own, quirks and all: the ordering pass's prerequisite half never says it changed the
// list (_FixIncorrectPrerequisiteOrdersForOneSkill hands back the list of needs after its own call has emptied it),
// and the dicts it walks are Python 2.7 dicts of whole numbers, whose order is CPython's (py27DictOrder.ts). A list
// the passes cannot make sense of (list.index of a pair not in it) throws, as the client's raises ValueError.
//
// This was run against the client's own module, its source as decompiled, inside the client's python27.dll
// (scripts/skill-plan-validation-oracle.js).

import { intDictOrder } from "./py27DictOrder.ts";

export type SkillLevel = readonly [number, number];

/** What the validation reads of the client's data. */
export interface SkillPlanValidationFacts {
  /** _IsSkillInvalid, negated: among the skill types (evetypes.GetTypeIDsByCategory), published, not obsolete. */
  isValidSkill(typeID: number): boolean;
  /** get_dogma_required_skills(typeID): [skill, level], in the order the client's table iterates them. */
  prerequisites(typeID: number): readonly SkillLevel[];
}

/** list.index((typeID, level)), ValueError as a throw. */
function indexOf(list: readonly SkillLevel[], typeID: number, level: number): number {
  const at = list.findIndex(([t, l]) => t === typeID && l === level);
  if (at < 0) throw new Error(`(${typeID}, ${level}) is not in the plan's list.`);
  return at;
}

/** list.insert(index, item), Python's: a negative index from the end, then clamped. */
function insertAt(list: SkillLevel[], index: number, item: SkillLevel): void {
  let at = index < 0 ? index + list.length : index;
  if (at < 0) at = 0;
  if (at > list.length) at = list.length;
  list.splice(at, 0, item);
}

/** list.remove(item): the first equal one; ValueError where none. */
function removeFirst(list: SkillLevel[], typeID: number, level: number): void {
  list.splice(indexOf(list, typeID, level), 1);
}

/** _GetSkillIDs: each skill once, in the order first seen. */
function skillIDs(list: readonly SkillLevel[]): number[] {
  const out: number[] = [];
  for (const [typeID] of list) if (!out.includes(typeID)) out.push(typeID);
  return out;
}

/** _GetAsOrderedDictWithTargetLevels: an OrderedDict, so the order first seen. */
function targetLevels(list: readonly SkillLevel[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const [typeID, level] of list) out.set(typeID, Math.max(out.get(typeID) ?? 0, level));
  return out;
}

/** A plain dict built by setting keys in this order, iterated as CPython iterates it. */
function dictOrder<V>(entries: Map<number, V>): [number, V][] {
  return intDictOrder([...entries.keys()]).map((key) => [key, entries.get(key) as V]);
}

function removeInvalidSkills(list: SkillLevel[], facts: SkillPlanValidationFacts): boolean {
  const toRemove = list.filter(([typeID]) => !facts.isValidSkill(typeID));
  for (const [typeID, level] of toRemove) removeFirst(list, typeID, level);
  return toRemove.length > 0;
}

function duplicateAndMissingLevels(list: readonly SkillLevel[]): [Map<number, number[]>, Map<number, number[]>] {
  // levelsPerSkill = {}: set in the order each skill is first seen.
  const levelsPerSkill = new Map<number, number[]>();
  for (const [typeID, level] of list) {
    if (!levelsPerSkill.has(typeID)) levelsPerSkill.set(typeID, []);
    levelsPerSkill.get(typeID)!.push(level);
  }
  const missingLevels = new Map<number, number[]>();
  const duplicateLevels = new Map<number, number[]>();
  for (const [typeID, levels] of dictOrder(levelsPerSkill)) {
    const target = Math.max(...levels);
    if (levels.length > target) {
      // Counter(levels).items(): a dict of the levels, set in the order first seen.
      const counts = new Map<number, number>();
      for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
      for (const [level, count] of dictOrder(counts)) {
        if (count > 1) {
          if (!duplicateLevels.has(typeID)) duplicateLevels.set(typeID, []);
          for (let n = 0; n < count - 1; n += 1) duplicateLevels.get(typeID)!.push(level);
        }
      }
    }
    for (let level = 1; level < target; level += 1) {
      if (!levels.includes(level)) {
        if (!missingLevels.has(typeID)) missingLevels.set(typeID, []);
        missingLevels.get(typeID)!.push(level);
      }
    }
  }
  return [duplicateLevels, missingLevels];
}

function removeSkillLevels(toRemove: Map<number, number[]>, list: SkillLevel[]): void {
  if (toRemove.size === 0) return;
  list.reverse();
  for (const [typeID, levels] of dictOrder(toRemove)) {
    for (const level of levels) {
      if (list.some(([t, l]) => t === typeID && l === level)) removeFirst(list, typeID, level);
    }
  }
  list.reverse();
}

function insertMissingSkillLevels(missing: Map<number, number[]>, list: SkillLevel[]): void {
  for (const [typeID, levels] of dictOrder(missing)) {
    for (const level of [...levels].sort((a, b) => b - a)) {
      const above = list.findIndex(([t, l]) => t === typeID && l === level + 1);
      insertAt(list, above >= 0 ? above : list.length - 1, [typeID, level]);
    }
  }
}

function addMissingAndRemoveDuplicateSkillLevels(list: SkillLevel[]): boolean {
  const [duplicateLevels, missingLevels] = duplicateAndMissingLevels(list);
  removeSkillLevels(duplicateLevels, list);
  insertMissingSkillLevels(missingLevels, list);
  return duplicateLevels.size > 0 || missingLevels.size > 0;
}

function addMissingPrerequisites(list: SkillLevel[], facts: SkillPlanValidationFacts): boolean {
  const toProcess = skillIDs(list);
  let changed = false;
  while (toProcess.length > 0) {
    const target = toProcess.shift()!;
    const planLevels = targetLevels(list);
    const prerequisites = facts.prerequisites(target);
    // missingPrereqs = {}: set in the order the needs iterate.
    const missing = new Map<number, number[]>();
    for (const [typeID, level] of prerequisites) {
      const had = planLevels.get(typeID);
      if (had === undefined) missing.set(typeID, range(1, level + 1));
      else if (had < level) missing.set(typeID, range(had + 1, level + 1));
    }
    if (missing.size > 0) changed = true;
    // _InsertMissingSkillLevelsBefore: before the target's level I.
    for (const [typeID, levels] of dictOrder(missing)) {
      const at = indexOf(list, target, 1);
      for (const level of [...levels].sort((a, b) => b - a)) insertAt(list, at, [typeID, level]);
    }
    for (const [typeID] of prerequisites) toProcess.push(typeID);
  }
  return changed;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n < to; n += 1) out.push(n);
  return out;
}

function insertBeforeIfIncorrectOrder(first: SkillLevel, second: SkillLevel, list: SkillLevel[]): boolean {
  const firstIndex = indexOf(list, first[0], first[1]);
  const secondIndex = indexOf(list, second[0], second[1]);
  if (secondIndex < firstIndex) {
    list.splice(firstIndex, 1);
    insertAt(list, secondIndex, first);
    return true;
  }
  return false;
}

function insertAfterIfIncorrectOrder(first: SkillLevel, second: SkillLevel, list: SkillLevel[]): boolean {
  const firstIndex = indexOf(list, first[0], first[1]);
  const secondIndex = indexOf(list, second[0], second[1]);
  if (secondIndex < firstIndex) {
    insertAt(list, firstIndex + 1, second);
    list.splice(secondIndex, 1);
    return true;
  }
  return false;
}

function fixPrerequisiteOrdersForList(list: SkillLevel[], toProcess: number[], facts: SkillPlanValidationFacts): boolean {
  let changed = false;
  while (toProcess.length > 0) {
    const typeID = toProcess.shift()!;
    const fixed = fixPrerequisiteOrdersForOneSkill(list, typeID, facts);
    for (const prerequisite of fixed) {
      const at = toProcess.indexOf(prerequisite);
      if (at >= 0) toProcess.splice(at, 1);
    }
    if (fixed.length > 0) changed = true;
  }
  return changed;
}

function fixPrerequisiteOrdersForOneSkill(list: SkillLevel[], typeID: number, facts: SkillPlanValidationFacts): number[] {
  // prereqs = allPrereqsDict[skillID].keys(): a new list, which the call below empties before it is handed back.
  const prerequisites = facts.prerequisites(typeID).map(([need]) => need);
  for (const [need, level] of facts.prerequisites(typeID)) {
    insertBeforeIfIncorrectOrder([need, level], [typeID, 1], list);
    for (let below = level - 1; below > 0; below -= 1) insertBeforeIfIncorrectOrder([need, below], [need, below + 1], list);
  }
  fixPrerequisiteOrdersForList(list, prerequisites, facts);
  return prerequisites;
}

function fixIncorrectLevelOrders(list: SkillLevel[]): boolean {
  let changed = false;
  for (const [typeID, target] of targetLevels(list)) {
    for (let level = 2; level <= target; level += 1) {
      changed = insertAfterIfIncorrectOrder([typeID, level - 1], [typeID, level], list) || changed;
    }
  }
  return changed;
}

function verifySkillOrdering(list: SkillLevel[], facts: SkillPlanValidationFacts): boolean {
  let changed = fixPrerequisiteOrdersForList(list, skillIDs(list), facts);
  changed = fixIncorrectLevelOrders(list) || changed;
  return changed;
}

/** ValidateSkillPlan: the list changed in place; whether a pass changed it, as the client reckons that. */
export function validateSkillPlan(list: SkillLevel[], facts: SkillPlanValidationFacts): boolean {
  const changedInvalid = removeInvalidSkills(list, facts);
  const changedMissingOrDuplicate = addMissingAndRemoveDuplicateSkillLevels(list);
  const changedMissingPrereqs = addMissingPrerequisites(list, facts);
  const changedOrder = verifySkillOrdering(list, facts);
  return changedInvalid || changedMissingOrDuplicate || changedMissingPrereqs || changedOrder;
}
