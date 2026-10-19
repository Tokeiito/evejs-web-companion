// A personal skill plan's milestones, as the retail client reads them (skills/skillplan/milestone and
// grpc/personalMilestoneRequest.py), out of the public gateway's eve_public.character.skill.plan.milestone answers.
//
//   reading        GetAll(skillPlan): each milestone a type (train_to_type: every skill the type needs) or a skill
//                  at a level (skill); BaseSkillPlanMilestoneService._PrimeCacheForSkillPlan deletes on the server each
//                  that is not valid (IsValid: a type's published; a skill's level 1 to V, a skill, published, not
//                  obsolete) and keeps the rest
//                  EditableSkillPlanController._GetPersistedMilestones then puts in the plan each skill a milestone
//                  needs above the plan's level of it (_AddSkillsMissingForMilestones: the plan's list extended,
//                  ValidateSkillPlan, SetRequiredSkills)
//   what it needs  GetRequiredSkills: get_dogma_required_skills_recursive (a dict of the needs, however deep, at the
//                  highest level asked; a dict(), so in CPython's order), a skill milestone's own level put in it too
//   completed      IsCompleted: some skill needed, and each trained to its level (MySkillLevel)
//   its kind       milestonesUtil.GetMilestoneSubType: a ship, a module, a skill, or another thing, by its category
//
// Where several milestones lack skills, the client walks them in the order of a dict keyed by their controllers
// (Python objects, hashed by where they live); here they are walked in the order the gateway answered them.

import { IntDict, intDictOf } from "./py27DictOrder.ts";
import { uuidFromBytes } from "./skillPlans.ts";
import type { RequiredSkills } from "./missingSkills.ts";

export type Milestone =
  | { readonly id: string; readonly kind: "type"; readonly typeID: number }
  | { readonly id: string; readonly kind: "skill"; readonly typeID: number; readonly level: number };

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
function record(value: unknown): Readonly<Record<string, Json>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, Json>) : {};
}

/** personalMilestoneRequest.GetAll: each milestone of the answer, in its order; one that is neither kind is left out. */
export function milestonesFromGetAll(payload: unknown): Milestone[] {
  const milestones = record(payload).milestones;
  const out: Milestone[] = [];
  for (const entry of Array.isArray(milestones) ? milestones : []) {
    const id = uuidFromBytes(String(record(record(entry).identifier).uuid ?? ""));
    const data = record(record(entry).data);
    if (id === null) continue;
    const trainTo = Number(record(data.train_to_type).sequential ?? 0);
    const skill = record(data.skill);
    if (trainTo) out.push({ id, kind: "type", typeID: trainTo });
    else if (Object.keys(record(skill.skill_type)).length > 0) out.push({ id, kind: "skill", typeID: Number(record(skill.skill_type).sequential ?? 0), level: Number(skill.level ?? 0) });
  }
  return out;
}

/** What validity reads of a type. */
export interface MilestoneTypeFacts {
  readonly published: boolean;
  readonly categoryID: number | null;
  readonly obsolete: boolean;
}

/** inventorycommon/const.py categoryShip, categoryModule, categorySkill */
const CATEGORY_SHIP = 6;
const CATEGORY_MODULE = 7;
const CATEGORY_SKILL = 16;

/** IsValid */
export function milestoneValid(milestone: Milestone, facts: MilestoneTypeFacts | null): boolean {
  if (facts === null || !facts.published) return false;
  if (milestone.kind === "type") return true;
  return milestone.level >= 1 && milestone.level <= 5 && facts.categoryID === CATEGORY_SKILL && !facts.obsolete;
}

/** GetMilestoneSubType */
export function milestoneSubType(categoryID: number | null): "ship" | "module" | "skill" | "other" {
  if (categoryID === CATEGORY_SHIP) return "ship";
  if (categoryID === CATEGORY_MODULE) return "module";
  if (categoryID === CATEGORY_SKILL) return "skill";
  return "other";
}

/**
 * get_dogma_required_skills_recursive(typeID): every skill the type needs, however deep, at the highest level any
 * asks it, as [skill, level] in the order the dict it returns iterates. Its defaultdict is set in the order the walk
 * first meets each skill (ret[skill] read, then set, then the skill's own needs walked), and dict() of it copies that
 * dict's order into a new one (PyDict_Merge).
 */
export function requiredSkillsRecursiveAsDict(typeID: number, required: RequiredSkills): (readonly [number, number])[] {
  const levels = new Map<number, number>();
  const metOrder: number[] = [];
  const walk = (of: number, depth: number): void => {
    if (depth > 50) throw new Error("A type's needs go deeper than the client's would.");
    for (const [skill, level] of required[of] ?? []) {
      if (!levels.has(skill)) metOrder.push(skill);
      levels.set(skill, Math.max(levels.get(skill) ?? 0, level));
      walk(skill, depth + 1);
    }
  };
  walk(typeID, 0);
  const merged = new IntDict();
  merged.update(intDictOf(metOrder));
  return merged.keys().map((skill) => [skill, levels.get(skill)!] as const);
}

/** GetRequiredSkills: a type milestone's type's needs; a skill milestone's skill's needs and the skill at its level. */
export function milestoneRequiredSkills(milestone: Milestone, required: RequiredSkills): (readonly [number, number])[] {
  const needs = requiredSkillsRecursiveAsDict(milestone.typeID, required);
  if (milestone.kind === "type") return needs;
  // requiredSkills[typeID] = max(...): set on the dict returned, so a new key goes where CPython puts it.
  const levels = new Map(needs);
  const dict = new IntDict();
  dict.update(intDictOf(needs.map(([skill]) => skill)));
  dict.set(milestone.typeID);
  levels.set(milestone.typeID, Math.max(levels.get(milestone.typeID) ?? 0, milestone.level));
  return dict.keys().map((skill) => [skill, levels.get(skill)!] as const);
}

/**
 * _GetMilestonesMissingRequirements: for each milestone, the skills it needs above the plan's level of them
 * (GetSkillRequirementsDict), in its needs' order; milestones that lack none are left out.
 */
export function milestonesMissingRequirements(
  milestones: readonly Milestone[],
  planLevels: ReadonlyMap<number, number>,
  required: RequiredSkills,
): { readonly milestone: Milestone; readonly missing: readonly (readonly [number, number])[] }[] {
  return milestones
    .map((milestone) => ({ milestone, missing: milestoneRequiredSkills(milestone, required).filter(([skill, level]) => level > (planLevels.get(skill) ?? 0)) }))
    .filter((each) => each.missing.length > 0);
}

/** IsCompleted */
export function milestoneCompleted(needs: readonly (readonly [number, number])[], trainedLevel: (typeID: number) => number): boolean {
  return needs.length > 0 && needs.every(([skill, level]) => trainedLevel(skill) >= level);
}

/** A milestone as the opened plan shows it. */
export type MilestoneEntry = Milestone & {
  readonly subType: "ship" | "module" | "skill" | "other";
  /** GetRequiredSkills */
  readonly needs: readonly (readonly [number, number])[];
  readonly completed: boolean;
  /** GetSkillTrainingTimeLeftToUseType, in ticks; null where it could not be reckoned. */
  readonly trainingTicks: number | null;
};

/**
 * GetMilestoneLastSkillIndex: where in the plan the last of a milestone's needs falls (its place in the plan's list,
 * the highest of them); -1 where one is not in it. The milestones in that order are the order they are reached.
 */
export function milestoneLastSkillIndex(needs: readonly (readonly [number, number])[], plan: readonly (readonly [number, number])[]): number {
  let last = -1;
  for (const [skill, level] of needs) {
    const at = plan.findIndex(([s, l]) => s === skill && l === level);
    if (at < 0) return -1;
    last = Math.max(last, at);
  }
  return last;
}
