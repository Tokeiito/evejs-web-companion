// The skill plan editor's milestones, as EditableSkillPlanController keeps them (skills/skillplan/controllers):
//
//   an edited plan   GetCopy: every milestone of the plan copied under a new id (to add), and every one of the plan's
//                    ids to delete; a new plan has none
//   shown            GetMilestones: the milestones to add (once any is to add or to delete)
//   a drop           skillPlanUtil.GetDragDataTypeIDAndLevel: a skill level dragged is its skill and level; a type
//                    dragged its type, a skill at level I; IsTypeValidMilestone: a skill, or a type with needs that is
//                    no asteroid (else CantAddAsMilestone); dropped on a milestone, ReplaceMilestoneWithNewMilestone
//                    asks first (SkillPlanEditorOverview.OnMilestoneDataDropped)
//   added            AddSkillRequirementMilestone / AddTypeIDMilestone: not where one is the same already, not past
//                    MAX_NUM_MILESTONES; every skill it needs appended to the plan (AddAllSkillsRequiredFor, in the
//                    order of the client's dict of them) and the plan put right
//   removed          RemoveMilestone: out of those to add, or its id to delete; a level taken out of the plan takes
//                    out the milestones that then lack a skill (_CheckRemoveMilestones)
//   saved            AdjustMilestonesToAddAndDeletedIDs (GetMilestonesToAddAndDeletedIDs): one to add the same as one
//                    to delete keeps the old and adds nothing; then SaveMilestones: the ids deleted, the rest created
//   changed          skillPlanDiff: a new plan with any to add; an edited one whose milestones' data differ
//   a type dropped   SkillPlanEditorContents._AddRequirementsForType: on the plan's skills, a type made a milestone
//                    where one may be added, else only its needs appended

import type { Milestone } from "./skillPlanMilestones.ts";
import { milestoneRequiredSkills, requiredSkillsRecursiveAsDict } from "./skillPlanMilestones.ts";
import type { RequiredSkills } from "./missingSkills.ts";
import type { SkillLevel } from "./skillPlanValidation.ts";

/** skillPlanConst.MAX_NUM_MILESTONES */
export const MAX_NUM_MILESTONES = 5;

/** inventorycommon/const.py categorySkill and categoryAsteroid */
const CATEGORY_SKILL = 16;
const CATEGORY_ASTEROID = 25;

/** The editor's milestones: those to add (shown) and the plan's ids to delete. */
export interface EditorMilestones {
  readonly toAdd: readonly Milestone[];
  readonly toDelete: readonly string[];
}

/** GetCopy: the plan's milestones under new ids (newID makes one), and all their ids to delete. */
export function copiedMilestones(persisted: readonly Milestone[], newID: () => string): EditorMilestones {
  return { toAdd: persisted.map((milestone) => ({ ...milestone, id: newID() })), toDelete: persisted.map((milestone) => milestone.id) };
}

/** GetData: what a milestone is, to tell two apart. */
export function milestoneData(milestone: Milestone): string {
  return milestone.kind === "type" ? `type:${milestone.typeID}` : `skill:${milestone.typeID}:${milestone.level}`;
}

/** GetDragDataTypeIDAndLevel: a skill at the level given or I; another type with none. */
export function dropped(typeID: number, level: number | null, categoryID: number | null): { readonly typeID: number; readonly level: number | null } {
  return { typeID, level: categoryID === CATEGORY_SKILL ? level ?? 1 : level };
}

/** IsTypeValidMilestone: a skill; else no asteroid, with skills it needs. */
export function typeValidAsMilestone(categoryID: number | null, hasNeeds: boolean): boolean {
  if (categoryID === CATEGORY_SKILL) return true;
  if (categoryID === CATEGORY_ASTEROID) return false;
  return hasNeeds;
}

/**
 * AddSkillRequirementMilestone (level given) or AddTypeIDMilestone: the milestones with it added and the plan's list
 * with what it needs appended (to be put right by the caller), or null where it is not added (one the same, or the
 * five taken). A skill milestone whose needs come to nothing is not added (AddAllSkillsRequiredFor said False).
 */
export function withMilestoneAdded(
  milestones: EditorMilestones,
  list: readonly SkillLevel[],
  typeID: number,
  level: number | null,
  required: RequiredSkills,
  newID: () => string,
): { readonly milestones: EditorMilestones; readonly list: SkillLevel[] } | null {
  const milestone: Milestone = level === null ? { id: newID(), kind: "type", typeID } : { id: newID(), kind: "skill", typeID, level };
  if (milestones.toAdd.some((each) => milestoneData(each) === milestoneData(milestone))) return null;
  if (milestones.toAdd.length === MAX_NUM_MILESTONES) return null;
  const needs = milestoneRequiredSkills(milestone, required);
  if (milestone.kind === "skill" && needs.length === 0) return null;
  return { milestones: { ...milestones, toAdd: [...milestones.toAdd, milestone] }, list: [...list, ...needs] };
}

/**
 * _AddRequirementsForType, for a type IsTypeValidMilestone lets be one (the caller asks it, and does nothing where
 * not). Where a milestone may still be added (HasEmptyMilestoneSlots): a skill's needs and its level I appended
 * (AddAllSkillsRequiredFor(typeID, 1)), then that level made a milestone (AddSkillRequirementMilestone(typeID, 1),
 * which appends them again where it adds one); another type made a milestone with its needs appended
 * (AddTypeIDMilestone: nothing at all where it is one already). Where the five are taken: the type's needs appended
 * alone (AddAllSkillsRequiredFor(typeID): a skill's own level is not among them). validate puts the plan right, as
 * each append there does (none where nothing is appended).
 */
export function withTypeRequirementsAdded(
  milestones: EditorMilestones,
  list: readonly SkillLevel[],
  typeID: number,
  isSkill: boolean,
  required: RequiredSkills,
  newID: () => string,
  validate: (list: SkillLevel[]) => void,
): { readonly milestones: EditorMilestones; readonly list: SkillLevel[] } {
  const appended = (to: readonly SkillLevel[], needs: readonly SkillLevel[]): SkillLevel[] => {
    const next = [...to, ...needs];
    if (needs.length > 0) validate(next);
    return next;
  };
  if (milestones.toAdd.length < MAX_NUM_MILESTONES) {
    const before = isSkill ? appended(list, milestoneRequiredSkills({ id: "", kind: "skill", typeID, level: 1 }, required)) : [...list];
    const added = withMilestoneAdded(milestones, before, typeID, isSkill ? 1 : null, required, newID);
    if (added === null) return { milestones, list: before };
    if (added.list.length > before.length) validate(added.list);
    return added;
  }
  return { milestones, list: appended(list, requiredSkillsRecursiveAsDict(typeID, required)) };
}

/** RemoveMilestone */
export function withMilestoneRemoved(milestones: EditorMilestones, id: string): EditorMilestones {
  if (milestones.toAdd.some((each) => each.id === id)) return { ...milestones, toAdd: milestones.toAdd.filter((each) => each.id !== id) };
  return { ...milestones, toDelete: [...milestones.toDelete, id] };
}

/** _CheckRemoveMilestones: each milestone that needs a skill above the plan's level of it, removed. */
export function withMilestonesCheckedAgainst(milestones: EditorMilestones, list: readonly SkillLevel[], required: RequiredSkills): EditorMilestones {
  const levels = new Map<number, number>();
  for (const [skill, level] of list) levels.set(skill, Math.max(levels.get(skill) ?? 0, level));
  let out = milestones;
  for (const milestone of milestones.toAdd) {
    if (milestoneRequiredSkills(milestone, required).some(([skill, level]) => level > (levels.get(skill) ?? 0))) out = withMilestoneRemoved(out, milestone.id);
  }
  return out;
}

/** GetMilestonesToAddAndDeletedIDs: those to add the same as one to delete cancel out with it. */
export function adjustedMilestones(milestones: EditorMilestones, persisted: readonly Milestone[]): EditorMilestones {
  const deleteIDByData = new Map<string, string>();
  for (const old of persisted.filter((each) => milestones.toDelete.includes(each.id))) deleteIDByData.set(milestoneData(old), old.id);
  const toAdd: Milestone[] = [];
  const toDelete = new Set(milestones.toDelete);
  for (const milestone of milestones.toAdd) {
    const oldID = deleteIDByData.get(milestoneData(milestone));
    if (oldID !== undefined) {
      deleteIDByData.delete(milestoneData(milestone));
      toDelete.delete(oldID);
    } else {
      toAdd.push(milestone);
    }
  }
  return { toAdd, toDelete: [...toDelete] };
}

/** _HaveMilestonesChanged (and a new plan's GetMilestonesToAdd): the milestones' data, sorted, differ. */
export function milestonesChanged(milestones: EditorMilestones, persisted: readonly Milestone[] | null): boolean {
  if (persisted === null) return milestones.toAdd.length > 0;
  const now = milestones.toAdd.map(milestoneData).sort();
  const before = persisted.map(milestoneData).sort();
  return now.length !== before.length || now.some((data, at) => data !== before[at]);
}
