// The corporation skill plans, as the retail client keeps them (skills/skillplan/grpc/corpSkillPlanRequest.py,
// CorpSkillPlanController, skillPlanService._PrimeCorpCache) and its Corporation Plans panel
// (skillPlan/browser/corpPlansPanel.py):
//
//   the tab        only for a pilot in a player corporation (skillPlansBrowserPanel: idCheckers.IsPlayerCorporation)
//   reading        GetAll: each plan's id, name, description and category (a career path, the category's uuid as a
//                  whole number, 0 for none); a plan without a category left out (_GetCorpSkillPlanController:
//                  uuid.UUID(bytes=...) raises, and the plan is not kept); its skills read by Get when wanted
//                  (CorpSkillPlanController.skillRequirements), put right by ValidateSkillPlan and SetRequiredSkills
//                  where that changed them
//   saving         Create with the category chosen (the editor's Category: None, 0, or a career path), sent as
//                  uuid.UUID(int=category).bytes; an edited plan sent what differs, SetCategory among it
//   editable       IsEditable: the pilot's corporation's, and the pilot has corpRoleSkillPlanManager
//   trackable      never (IsTrackable): Track saves a copy among the personal plans and tracks that
//                  (_CreateCopySelectAndTrack)
//   the panel      CorpSkillPlansPaginationController: the plans of the category chosen (none chosen: all), whose
//                  name holds the filter text (case aside), by name (localization.util.Sort); twelve to a page;
//                  NumShown; NoCorpSkillPlans with none, NoSkillPlansMatchingFilters with none shown

import { bytesFromUuid, uuidFromBytes } from "./skillPlans.ts";

/** appConst.corpRoleSkillPlanManager */
export const CORP_ROLE_SKILL_PLAN_MANAGER = 4611686018427387904n;
/** skillPlanConst.MAX_CORP_PLANS */
export const MAX_CORP_PLANS = 100;
/** corpPlansPanel.NUM_PER_PAGE */
export const CORP_PLANS_PER_PAGE = 12;
/** inventorycommon/const.py minPlayerCorporation, maxPlayerCorporation */
const MIN_PLAYER_CORPORATION = 98_000_000;
const MAX_PLAYER_CORPORATION = 98_999_999;

/** idCheckers.IsPlayerCorporation, as the client checks it for its own corporation. */
export function inPlayerCorporation(corporationID: number | null): boolean {
  return corporationID !== null && corporationID >= MIN_PLAYER_CORPORATION && corporationID <= MAX_PLAYER_CORPORATION;
}

/** session.corprole & corpRoleSkillPlanManager */
export function hasSkillPlanManagerRole(corpRole: string | null): boolean {
  return corpRole !== null && /^\d+$/.test(corpRole) && (BigInt(corpRole) & CORP_ROLE_SKILL_PLAN_MANAGER) !== 0n;
}

export interface CorpPlanSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** uuid.UUID(bytes=category.uuid).int: a career path, or 0 for none. */
  readonly categoryID: number;
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
function record(value: unknown): Readonly<Record<string, Json>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, Json>) : {};
}

/** uuid.UUID(bytes=...).int, for the small whole numbers a category is. */
export function uuidIntFromBytes(base64: string): number {
  const id = uuidFromBytes(base64);
  if (id === null) return 0;
  const value = BigInt(`0x${id.replace(/-/g, "")}`);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : 0;
}

/** uuid.UUID(int=categoryID).bytes, as the codec takes bytes (corpSkillPlanRequestsMessenger.create, set_category). */
export function categoryBytes(categoryID: number): string {
  return bytesFromUuid(BigInt(Math.max(0, Math.trunc(categoryID))).toString(16).padStart(32, "0"));
}

/** GetAll: each plan's id and summary. */
export function corpPlansFromGetAll(payload: unknown): CorpPlanSummary[] {
  const plans = record(payload).skill_plans;
  return (Array.isArray(plans) ? plans : []).flatMap((entry) => {
    const id = uuidFromBytes(String(record(record(entry).identifier).uuid ?? ""));
    const plan = record(record(entry).skill_plan);
    const category = String(record(plan.category).uuid ?? "");
    if (id === null || category === "" || uuidFromBytes(category) === null) return [];
    return [{
      id,
      name: typeof plan.name === "string" ? plan.name : "",
      description: typeof plan.description === "string" ? plan.description : "",
      categoryID: uuidIntFromBytes(category),
    }];
  });
}

/** Get: the plan's skills, [typeID, level] in its order. */
export function corpPlanRequirements(payload: unknown): (readonly [number, number])[] {
  const plan = record(record(payload).skill_plan);
  return (Array.isArray(plan.skill_requirements) ? plan.skill_requirements : []).map((requirement) => {
    const row = record(requirement);
    return [Number(record(row.skill_type).sequential ?? 0), Number(row.level ?? 0)] as const;
  });
}

/** CorpSkillPlansPaginationController.GetAllData: the category's (or all), the filter's, by name. */
export function corpPlansFiltered<T extends { readonly name: string; readonly categoryID: number }>(
  plans: readonly T[],
  categoryID: number | null,
  filterText: string,
): T[] {
  const filter = filterText.toLowerCase();
  const collator = new Intl.Collator("en");
  return plans
    .filter((plan) => (!categoryID || plan.categoryID === categoryID) && (filter === "" || plan.name.toLowerCase().includes(filter)))
    .sort((left, right) => collator.compare(left.name.toLowerCase(), right.name.toLowerCase()) || collator.compare(right.name, left.name));
}

/** GetNumPages */
export function corpPlanPages(count: number): number {
  return Math.ceil(count / CORP_PLANS_PER_PAGE);
}
