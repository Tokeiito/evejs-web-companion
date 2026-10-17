// The client's skill plan editor (eve/client/script/ui/skillPlan/skillPlanEditor), as rules on the plan being edited:
//
//   the catalogue    skillsvc._ConstructSkillControllers: the skill category's types, published or held, by group;
//                    SkillGroupBrowser: the groups of skillConst.skill_group_ids sorted by name; a group's skills by
//                    name (SkillsCataloguePanel.GetSkillsFilteredAndSorted); with a text, every group's skills holding
//                    it (FilterSkillByText, case aside), by name
//   a level added    EditorSkillEntryPrimaryButton: the skill's next level (GetNextLevel: one above the plan's highest;
//                    none past V), appended (AppendSkillRequirement) and the plan put right (ValidateSkillPlan)
//   a level removed  EditorSkillLevelEntryPrimaryButton: only the skill's highest level, and only where no skill after
//                    it in the plan needs the skill at that level (CanRemoveSkillRequirement, GetSkillsRequiring);
//                    removed (RemoveSkillRequirement) and the plan put right
//   leaving          IsEditedPlanDifferentFromOriginal (skillPlanDiff.py): a new plan with a name, a description or a
//                    skill; a plan edited whose name, description or skills differ from the saved one
//   saving           skillPlanService.Save: a new plan created; an edited one sent what differs
//                    (_GetCallsToUpdate: SetName, SetDescription, SetRequiredSkills)
//   the save button  SkillPlanEditorSaveButton.UpdateState: off with no skill or no name
//   a level moved    MoveSkillRequirement: above another level, or to the end, only where the plan stays valid
//                    (IsSkillRequirementMoveValid: IsPlanValid of the list moved)
//   a level put in   InsertSkillRequirement: at the place of a level, then the plan put right (a skill dropped from the
//                    catalogue on a level; a level shift-dragged on one, where IsSkillInsertionValid)
//   levels appended  AppendSkillRequirements: a list imported from the clipboard, then the plan put right
//
// The milestones' rules are skillPlanEditorMilestones.ts.

import { validateSkillPlan, type SkillLevel, type SkillPlanValidationFacts } from "./skillPlanValidation.ts";

/** skillConst.skill_group_ids (inventorycommon/const.py): the skill groups the catalogue lists. */
export const SKILL_GROUP_IDS: readonly number[] = [
  257, 275, 1216, 1240, 1210, 1209, 1213, 255, 256, 273, 272, 1217, 269, 278, 258, 266, 274, 1220, 268, 270, 1218, 1241, 1545, 4734,
];
/** skillConst.skill_max_level */
const MAX_LEVEL = 5;
/** skillPlanConst MAX_LEN_NAME and MAX_LEN_DESC */
export const MAX_PLAN_NAME_LENGTH = 50;
export const MAX_PLAN_DESCRIPTION_LENGTH = 1000;

export interface CatalogueEntry {
  readonly typeID: number;
  readonly name: string;
  readonly groupID: number;
  readonly groupName: string;
  readonly published: boolean;
}

export interface CatalogueGroup {
  readonly groupID: number;
  readonly name: string;
  readonly skills: readonly CatalogueEntry[];
}

/** Python 2's sort of text: by code point (here by UTF-16 unit, the same for the skills' names). */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The catalogue's groups, each with its skills: published or held, by name; the groups by name. */
export function catalogueGroups(skills: readonly CatalogueEntry[], held: (typeID: number) => boolean): CatalogueGroup[] {
  const listed = skills.filter((skill) => skill.published || held(skill.typeID));
  return SKILL_GROUP_IDS
    .map((groupID) => {
      const inGroup = listed.filter((skill) => skill.groupID === groupID).sort((a, b) => byText(a.name, b.name));
      return { groupID, name: inGroup[0]?.groupName ?? skills.find((skill) => skill.groupID === groupID)?.groupName ?? "", skills: inGroup };
    })
    .sort((a, b) => byText(a.name, b.name));
}

/** GetSkillsFilteredAndSorted with a text: every group's skills whose name holds it, case aside, by name. */
export function catalogueSearch(groups: readonly CatalogueGroup[], text: string): CatalogueEntry[] {
  const wanted = text.toLowerCase();
  return groups.flatMap((group) => group.skills.filter((skill) => skill.name.toLowerCase().includes(wanted))).sort((a, b) => byText(a.name, b.name));
}

/** GetHighestLevel: the plan's highest level of the skill, null where the plan has none. */
export function highestPlanLevel(list: readonly SkillLevel[], typeID: number): number | null {
  let highest: number | null = null;
  for (const [skill, level] of list) if (skill === typeID) highest = Math.max(highest ?? 0, level);
  return highest;
}

/** GetNextLevel: one above the plan's highest of the skill (I where none); null past V. */
export function nextPlanLevel(list: readonly SkillLevel[], typeID: number): number | null {
  const level = (highestPlanLevel(list, typeID) ?? 0) + 1;
  return level <= MAX_LEVEL ? level : null;
}

/** AppendSkillRequirement(typeID): the next level appended, the plan put right. The list unchanged past V. */
export function withLevelAppended(list: readonly SkillLevel[], typeID: number, facts: SkillPlanValidationFacts): SkillLevel[] {
  const level = nextPlanLevel(list, typeID);
  const next: SkillLevel[] = [...list];
  if (level === null) return next;
  next.push([typeID, level]);
  validateSkillPlan(next, facts);
  return next;
}

/**
 * CanRemoveSkillRequirement: the skill's highest level in the plan, and no skill from it on in the plan among those
 * that need the skill at that level (GetSkillsRequiring).
 */
export function canRemoveLevel(list: readonly SkillLevel[], typeID: number, level: number, requiring: (typeID: number, level: number) => readonly number[]): boolean {
  if (level !== highestPlanLevel(list, typeID)) return false;
  const needing = new Set(requiring(typeID, level));
  const at = list.findIndex(([skill, l]) => skill === typeID && l === level);
  return !list.slice(at).some(([skill]) => needing.has(skill));
}

/** RemoveSkillRequirement: the level taken out, the plan put right. */
export function withLevelRemoved(list: readonly SkillLevel[], typeID: number, level: number, facts: SkillPlanValidationFacts): SkillLevel[] {
  const next: SkillLevel[] = [...list];
  const at = next.findIndex(([skill, l]) => skill === typeID && l === level);
  if (at < 0) return next;
  next.splice(at, 1);
  validateSkillPlan(next, facts);
  return next;
}

/** A plan as the editor holds it. */
export interface EditedPlan {
  readonly name: string;
  readonly description: string;
  readonly requirements: readonly SkillLevel[];
}

function sameRequirements(a: readonly SkillLevel[], b: readonly SkillLevel[]): boolean {
  return a.length === b.length && a.every(([skill, level], at) => b[at]![0] === skill && b[at]![1] === level);
}

/** IsEditedPlanDifferentFromOriginal, milestones aside: null for a new plan. */
export function editedPlanDiffers(saved: EditedPlan | null, edited: EditedPlan): boolean {
  if (saved === null) return edited.name !== "" || edited.description !== "" || edited.requirements.length > 0;
  return saved.name !== edited.name || saved.description !== edited.description || !sameRequirements(saved.requirements, edited.requirements);
}

/** _GetCallsToUpdate, the category aside: what an edited plan sends. */
export function planUpdates(saved: EditedPlan, edited: EditedPlan): ("name" | "description" | "requirements")[] {
  const out: ("name" | "description" | "requirements")[] = [];
  if (saved.name !== edited.name) out.push("name");
  if (saved.description !== edited.description) out.push("description");
  if (!sameRequirements(saved.requirements, edited.requirements)) out.push("requirements");
  return out;
}

/** SkillPlanEditorSaveButton.UpdateState: a skill and a name. */
export function canSavePlan(edited: EditedPlan): boolean {
  return edited.requirements.length > 0 && edited.name.length > 0;
}

/**
 * skillPlanValidation.IsPlanValid: no invalid skill, no level missing or twice, no prerequisite missing, nothing out of
 * order. Each of those fails exactly where ValidateSkillPlan's fix for it would change the list, so a list is valid
 * where putting a copy right changes nothing.
 */
export function isPlanValid(list: readonly SkillLevel[], facts: SkillPlanValidationFacts): boolean {
  return !validateSkillPlan([...list], facts);
}

/** The list as IsSkillRequirementMoveValid and MoveSkillRequirement move a level: popped from one place, put at another. */
export function listWithMove(list: readonly SkillLevel[], originalIndex: number, targetIndex: number): SkillLevel[] {
  const next: SkillLevel[] = [...list];
  if (originalIndex > targetIndex) {
    const [moved] = next.splice(originalIndex, 1);
    next.splice(targetIndex, 0, moved!);
  } else if (targetIndex > originalIndex) {
    next.splice(targetIndex, 0, next[originalIndex]!);
    next.splice(originalIndex, 1);
  }
  return next;
}

/** IsSkillRequirementMoveValid(originalIndex, targetIndex): the plan valid with the level moved there. */
export function moveIsValid(list: readonly SkillLevel[], originalIndex: number, targetIndex: number, facts: SkillPlanValidationFacts): boolean {
  return isPlanValid(listWithMove(list, originalIndex, targetIndex), facts);
}

/** GetSkillRequirementIndex: the level's place in the plan, -1 where it is not in it. */
export function planLevelIndex(list: readonly SkillLevel[], typeID: number, level: number): number {
  return list.findIndex(([skill, l]) => skill === typeID && l === level);
}

/**
 * MoveSkillRequirement(typeID, level, above): the level put above another (at the end where none), where the move
 * leaves the plan valid (IsSkillRequirementMoveValid); null where it would not, and nothing moves. The plan is not put
 * right after: a valid move needs nothing.
 */
export function withLevelMoved(
  list: readonly SkillLevel[],
  typeID: number,
  level: number,
  above: SkillLevel | null,
  facts: SkillPlanValidationFacts,
): SkillLevel[] | null {
  const originIndex = planLevelIndex(list, typeID, level);
  const dropIndex = above === null ? list.length : planLevelIndex(list, above[0], above[1]);
  return originIndex < 0 || !moveIsValid(list, originIndex, dropIndex, facts) ? null : listWithMove(list, originIndex, dropIndex);
}

/** IsSkillInsertionValid(typeID, level, targetIndex): the plan valid with the level put in there. */
export function insertionIsValid(list: readonly SkillLevel[], typeID: number, level: number, targetIndex: number, facts: SkillPlanValidationFacts): boolean {
  const next: SkillLevel[] = [...list];
  next.splice(pythonInsertIndex(next.length, targetIndex), 0, [typeID, level]);
  return isPlanValid(next, facts);
}

/** Where Python's list.insert(index, item) puts it: a negative index from the end, then clamped. */
function pythonInsertIndex(length: number, index: number): number {
  const at = index < 0 ? index + length : index;
  return Math.min(length, Math.max(0, at));
}

/**
 * InsertSkillRequirement(typeID, level, aboveTypeID, aboveLevel): the level (the skill's next where none is given;
 * nothing past V) put in at the place of the level above (list.insert at its index: before the last where that level
 * is not in the plan), then the plan put right.
 */
export function withLevelInserted(
  list: readonly SkillLevel[],
  typeID: number,
  level: number | null,
  above: SkillLevel,
  facts: SkillPlanValidationFacts,
): SkillLevel[] {
  const next: SkillLevel[] = [...list];
  const inserted = level ?? nextPlanLevel(list, typeID);
  if (inserted === null) return next;
  next.splice(pythonInsertIndex(next.length, planLevelIndex(list, above[0], above[1])), 0, [typeID, inserted]);
  validateSkillPlan(next, facts);
  return next;
}

/** AppendSkillRequirements: each level appended (none without a skill or a level), then the plan put right. */
export function withLevelsAppended(list: readonly SkillLevel[], levels: readonly SkillLevel[], facts: SkillPlanValidationFacts): SkillLevel[] {
  const next: SkillLevel[] = [...list, ...levels.filter(([typeID, level]) => typeID > 0 && level > 0)];
  validateSkillPlan(next, facts);
  return next;
}
