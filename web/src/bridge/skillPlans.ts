// The pilot's personal skill plans, as the retail client keeps them (skills/skillplan), out of what the public gateway
// answers (eve_public.character.skill.plan: the BFF's POST /api/public-gateway/request).
//
//   the list       skillPlanService._PrimePersonalCache (249 to 264): GetAll, the plans' ids; then each plan by Get
//                  (_CreateAndCachePersonalSkillPlanController), a plan whose Get fails left out
//   the tracked    _GetTrackedSkillPlanID (207 to 222): GetActive; the nought uuid is none
//   a plan         PersonalSkillPlanController: its name, description and skill requirements, [(typeID, level)] in
//                  the order the plan has them
//   its entry      browser/skillPlanEntry.py: the name, the time left to train it (GetTotalTrainingTimeLeftText), or
//                  Completed; the tracked mark; Edit and Delete in its menu
//   the order      SkillPlanScroll.ConstructSkillPlanEntries: localization.util.Sort by name
//   a plan opened  selectedPlan/selectedSkillPlanContainer.py; its contents contents/skillPlanContents.py

import type { SkillLevelBox } from "./missingSkills.ts";
import type { LevelButtonState } from "./skillPlanLevelButton.ts";

/** The nought uuid: SetActive's "none" (skillPlanRequestsMessenger.set_active), GetActive's answer with none tracked. */
export const NO_SKILL_PLAN = "00000000-0000-0000-0000-000000000000";
/** skillPlanConst.MAX_PERSONAL_PLANS */
export const MAX_PERSONAL_PLANS = 10;

/** A personal plan as its controller holds it. */
export interface PersonalSkillPlan {
  /** Its uuid, as Python writes one (str(uuid.UUID)). */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** GetSkillRequirements: [typeID, level], in the plan's order. */
  readonly requirements: readonly (readonly [number, number])[];
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

function record(value: unknown): Readonly<Record<string, Json>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, Json>) : {};
}

/** A uuid's sixteen bytes, as the codec gives bytes (base64), written as Python's str(uuid.UUID(bytes=...)) does. */
export function uuidFromBytes(base64: string): string | null {
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length !== 16) return binary.length === 0 ? NO_SKILL_PLAN : null;
  const hex = [...binary].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** uuid.bytes, as the codec takes bytes (base64). */
export function bytesFromUuid(id: string): string {
  const hex = id.replace(/-/g, "");
  let binary = "";
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary);
}

/** GetAll's answer: the plans' ids, in its order. */
export function planIDsFromGetAll(payload: unknown): readonly string[] {
  const plans = record(payload).skill_plans;
  return (Array.isArray(plans) ? plans : [])
    .map((plan) => uuidFromBytes(String(record(plan).uuid ?? "")))
    .filter((id): id is string => id !== null);
}

/** GetActive's answer: the tracked plan's id, or null where none is tracked (the nought uuid). */
export function trackedPlanFromGetActive(payload: unknown): string | null {
  const id = uuidFromBytes(String(record(record(payload).skill_plan).uuid ?? ""));
  return id === null || id === NO_SKILL_PLAN ? null : id;
}

/** Get's answer for a plan: _GetPersonalSkillPlanController's reading of it (each requirement's skill and level). */
export function planFromGet(id: string, payload: unknown): PersonalSkillPlan {
  const plan = record(record(payload).skill_plan);
  const requirements = (Array.isArray(plan.skill_requirements) ? plan.skill_requirements : []).map((requirement) => {
    const row = record(requirement);
    return [Number(record(row.skill_type).sequential ?? 0), Number(row.level ?? 0)] as const;
  });
  return { id, name: typeof plan.name === "string" ? plan.name : "", description: typeof plan.description === "string" ? plan.description : "", requirements };
}

/** GetSkillRequirementsDict: each skill once, at the highest level the plan asks of it, in the order first asked. */
export function skillRequirementsDict(plan: PersonalSkillPlan): ReadonlyMap<number, number> {
  const levels = new Map<number, number>();
  for (const [typeID, level] of plan.requirements) levels.set(typeID, Math.max(levels.get(typeID) ?? 0, level));
  return levels;
}

/** IsCompleted: some skill asked, and each trained to its level (MySkillLevel: the trained level, nought unheld). */
export function planCompleted(plan: PersonalSkillPlan, trainedLevel: (typeID: number) => number): boolean {
  const required = skillRequirementsDict(plan);
  if (required.size === 0) return false;
  for (const [typeID, level] of required) if (trainedLevel(typeID) < level) return false;
  return true;
}

/** GetTimeLeftFormattedText: to the hour above a day, to the minute above an hour, else to the second. */
export function timeLeftShowTo(ticks: number): "hour" | "minute" | "second" {
  /** appConst DAY and HOUR, in ticks. */
  if (ticks > 864_000_000_000) return "hour";
  if (ticks > 36_000_000_000) return "minute";
  return "second";
}

/**
 * localization.util.Sort by name (GetSortFunc): by the collator on the names in lower case, and where those are the
 * same, by the names as they are, the other way about.
 */
export function sortPlansByName<T extends { readonly name: string }>(plans: readonly T[]): T[] {
  const collator = new Intl.Collator("en");
  return [...plans].sort((left, right) => collator.compare(left.name.toLowerCase(), right.name.toLowerCase()) || collator.compare(right.name, left.name));
}

/** A plan as its entry shows it (SkillPlanEntry). */
export interface PersonalSkillPlanEntry extends PersonalSkillPlan {
  /** IsCompleted */
  readonly completed: boolean;
  /** GetTotalTrainingTimeLeft, in ticks; null where a skill's rank or the pilot's rate for it was not had. */
  readonly trainingTicks: number | null;
}

/** The personal plans, and the tracked plan's id (null for none). */
export interface PersonalSkillPlansRead {
  readonly plans: readonly PersonalSkillPlanEntry[];
  readonly trackedID: string | null;
}

/** One of a plan's skill levels as its contents list it (SkillPlanContentsSkillEntry). */
export interface SkillPlanContentRow {
  readonly skill: number;
  readonly level: number;
  /** skillsvc.GetMyLevel(skill) >= level: the trained level, the skill held (a lapsed one is not). */
  readonly trained: boolean;
  /** The skill bar's five boxes for the level (SkillBar with requiredLevel). */
  readonly boxes: readonly { readonly box: SkillLevelBox; readonly partial: boolean }[];
  /** GetTrainingTimeForLevelText's time: the level alone (GetRawTrainingTimeForSkillLevel, no boosters); null unknown. */
  readonly ticks: number | null;
  /** Its button's state (SkillLevelEntryPrimaryButton, bridge/skillPlanLevelButton.ts). */
  readonly button: LevelButtonState;
  /** The add state's tooltip: GetSkillPointsMissingForLevel(level); null unknown. */
  readonly pointsMissing: number | null;
  /** The add state's tooltip: GetSkillpointsPerMinute(skill), boosters counted; null unknown. */
  readonly pointsPerMinute: number | null;
}

/**
 * SkillPlanContents.IsSkillVisible: with Hide Trained Skills on (its setting's default), a level trained is not shown;
 * with a filter, a skill whose name does not hold it, case aside, is not.
 */
export function skillPlanRowVisible(row: SkillPlanContentRow, hideTrained: boolean, filter: string, name: string): boolean {
  if (hideTrained && row.trained) return false;
  return filter === "" || name.toLowerCase().includes(filter.toLowerCase());
}

/** What the opened plan's buttons and locks go by, with its contents' rows. */
export interface SkillPlanDetail {
  readonly rows: readonly SkillPlanContentRow[];
  /** GetMissingSkillbooks: the plan's skills not held, lapsed ones counted held, in GetSkillRequirementsDict's order. */
  readonly missingBooks: readonly number[];
  /** IsOmegaLocked: a skill of the plan restricted for an alpha clone, and the pilot not omega. */
  readonly omegaLocked: boolean;
  /** GetNumOmegaSkills, where it is reckoned (an alpha clone's plan); nought otherwise. */
  readonly numOmegaSkills: number;
  /** GetUntrainedSkills: the plan's levels above the skill's level, its queue counted, in the plan's order. */
  readonly untrained: readonly (readonly [number, number])[];
}

/**
 * GetUntrainedSkills: each of the plan's levels where MySkillLevelIncludingQueued is under it (the trained level, the
 * lapsed counted, or the highest the queue takes it to, whichever is more; nought where the skill is not held at all).
 */
export function untrainedSkills(
  plan: PersonalSkillPlan,
  trainedIncludingLapsed: (typeID: number) => number | null,
  maxQueued: (typeID: number) => number,
): readonly (readonly [number, number])[] {
  return plan.requirements.filter(([typeID, level]) => {
    const trained = trainedIncludingLapsed(typeID);
    return (trained === null ? 0 : Math.max(trained, maxQueued(typeID))) < level;
  });
}

/**
 * UpdateStartTrainingButton: locked where the plan is not trainable (IsTrainable: omega locked, or books missing),
 * nothing to train where every level is trained or queued (IsQueuedOrTrained), else ready.
 */
export function startTrainingState(detail: SkillPlanDetail): "locked" | "nothing" | "ready" {
  if (detail.omegaLocked || detail.missingBooks.length > 0) return "locked";
  return detail.untrained.length === 0 ? "nothing" : "ready";
}
