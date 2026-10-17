// The pilot's personal skill plans, as the retail client keeps them (skills/skillplan), out of what the public gateway
// answers (eve_public.character.skill.plan: the BFF's POST /api/public-gateway/request).
//
//   the list       skillPlanService._PrimePersonalCache (249 to 264): GetAll, the plans' ids; then each plan by Get
//                  (_CreateAndCachePersonalSkillPlanController), a plan whose Get fails left out
//   the tracked    _GetTrackedSkillPlanID (207 to 222): GetActive; the nought uuid is none
//   a plan         PersonalSkillPlanController: its name, description and skill requirements, [(typeID, level)] in
//                  the order the plan has them
//   its entry      browser/skillPlanEntry.py: the name, the time left to train it (GetTotalTrainingTimeLeftText), or
//                  Completed; the tracked mark; Edit and Delete in its menu; the progress gauge (UpdateProgressGauge:
//                  GetProgressRatio white, GetInTrainingRatio after it cryo blue; characterskills/util.py), redrawn each
//                  second with the time left while the plan has levels queued (_UpdateTrainingTimeThread); the omega
//                  mark (CheckShowOmegaIndicator: IsOmega, and the pilot not omega); its tooltip
//                  (SkillPlanEntryTooltip): Skill Plan, the description, SkillbooksMissing2 with their count where any
//                  is not held, RequireOmega with the count of skills an alpha may not train where the pilot is not omega
//   the order      SkillPlanScroll.ConstructSkillPlanEntries: localization.util.Sort by name
//   a plan opened  selectedPlan/selectedSkillPlanContainer.py; its contents contents/skillPlanContents.py: a row
//                  clicked selected and the others marked by how they stand to it (OnEntryClicked,
//                  skillPlanUtil.GetRequirementStateForEntry); the contents' menu's Copy Skills to Clipboard
//                  (GetRequirementsClipboardText)

import { requiredSkillsRecursive, type QueuedLevel, type RequiredSkills, type SkillLevelBox } from "./missingSkills.ts";
import type { LevelButtonState } from "./skillPlanLevelButton.ts";
import type { SkillMenuFacts } from "./skillMenu.ts";
import { skillPointsForLevel } from "./skillSheet.ts";

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
/**
 * clone_grade_svc.is_restricted_for_alpha: a skill an alpha clone cannot train at all (get_max_skill_level under 1), or
 * one whose own needs, however deep, ask a level above an alpha's (is_requirements_restricted).
 */
export function restrictedForAlpha(skill: number, ceiling: (skill: number) => number, required: RequiredSkills): boolean {
  return ceiling(skill) < 1 || [...requiredSkillsRecursive(skill, required)].some(([need, level]) => ceiling(need) < level);
}

/**
 * A plan's progress as its entry's gauge draws it, read at one moment (at, in ms): GetTotalSkillPoints; and
 * GetTrainedSkillPoints and GetInTrainingSkillPoints without the share of the skill in training, which is reckoned at
 * each moment from its points then, its rate (a millisecond, boosters counted) and the points its queue place takes it
 * to (it trains no further in it).
 */
export interface PlanProgress {
  readonly total: number;
  readonly trained: number;
  readonly inTraining: number;
  readonly training: {
    readonly points: number;
    readonly perMs: number;
    /** The points of the queue place it trains in. */
    readonly cap: number;
    /** spRequiredForLevel: the points of the plan's level of it. */
    readonly wanted: number;
    /** GetInTrainingSkillPoints' level for it: the plan's, or the queue's last for it where that is lower. */
    readonly queuedWanted: number;
    readonly at: number;
  } | null;
}

/**
 * The progress of a plan's levels (GetSkillRequirementsDict): every rank known, else null. pointsNow is
 * GetEstimatedSkillPointsTrained as read; the queue's levels are GetSkillLevelsInQueue's (each skill's last place).
 */
export function planProgressFrom(
  required: ReadonlyMap<number, number>,
  rank: (skill: number) => number | null | undefined,
  pointsNow: (skill: number) => number,
  queue: readonly QueuedLevel[],
  training: { readonly skill: number; readonly perMs: number; readonly toLevel: number } | null,
  at: number,
): PlanProgress | null {
  const queuedLevel = new Map<number, number>();
  for (const entry of queue) queuedLevel.set(entry.typeID, entry.toLevel);
  let total = 0;
  let trained = 0;
  let inTraining = 0;
  let trainingShare: PlanProgress["training"] = null;
  for (const [skill, level] of required) {
    const skillRank = rank(skill);
    if (skillRank === null || skillRank === undefined) return null;
    const wanted = skillPointsForLevel(skillRank, level);
    total += wanted;
    const queued = queuedLevel.get(skill);
    const queuedWanted = queued === undefined ? 0 : skillPointsForLevel(skillRank, Math.min(level, queued));
    const points = pointsNow(skill);
    if (training !== null && training.skill === skill && training.perMs > 0) {
      trainingShare = { points, perMs: training.perMs, cap: skillPointsForLevel(skillRank, training.toLevel), wanted, queuedWanted, at };
      continue;
    }
    trained += Math.min(wanted, points);
    if (queued !== undefined) inTraining += queuedWanted - Math.min(queuedWanted, points);
  }
  return { total, trained, inTraining, training: trainingShare };
}

/**
 * GetProgressRatio and GetInTrainingRatio at a moment (now, in ms), nought where the plan has no points; and the ticks
 * the time left has gone down since it was read (the skill in training's, while it trains towards the plan's level).
 */
export function planProgressAt(progress: PlanProgress, now: number): { readonly progress: number; readonly inTraining: number; readonly ticksGone: number } {
  if (progress.total <= 0) return { progress: 0, inTraining: 0, ticksGone: 0 };
  let trained = progress.trained;
  let inTraining = progress.inTraining;
  let ticksGone = 0;
  const training = progress.training;
  if (training !== null) {
    const elapsed = Math.max(0, now - training.at);
    const points = Math.min(Math.max(training.cap, training.points), training.points + elapsed * training.perMs);
    trained += Math.min(training.wanted, points);
    inTraining += training.queuedWanted - Math.min(training.queuedWanted, points);
    const until = Math.max(0, (Math.min(training.wanted, training.cap) - training.points) / training.perMs);
    ticksGone = Math.min(elapsed, until) * 10_000;
  }
  return { progress: trained / progress.total, inTraining: inTraining / progress.total, ticksGone };
}

/** How a contents row stands to the row clicked (skillPlanConst IS_PREREQ, REQUIRED_FOR; NO_REQ is null). */
export type PlanRowRequirement = "prereq" | "required-for" | null;

/**
 * skillPlanUtil.GetRequirementStateForEntry: a row's standing to the level clicked (skill, level). prereqs is
 * get_dogma_required_skills of the clicked skill (its own needs, not deeper); requiredFor GetSkillsRequiring(skill,
 * level): the skills (marketCategorySkills) that need it at that very level. Level I of one of those is required for it;
 * a lower level of the same skill a prerequisite and a higher one required for it; the level a need asks of a skill a
 * prerequisite; anything else nothing.
 */
export function planRowRequirement(
  clicked: { readonly skill: number; readonly level: number },
  row: { readonly skill: number; readonly level: number },
  prereqs: ReadonlyMap<number, number>,
  requiredFor: ReadonlySet<number>,
): PlanRowRequirement {
  if (requiredFor.has(row.skill) && row.level === 1) return "required-for";
  if (row.skill === clicked.skill) {
    if (row.level < clicked.level) return "prereq";
    if (row.level > clicked.level) return "required-for";
    return null;
  }
  const needLevel = prereqs.get(row.skill);
  return needLevel !== undefined && row.level === needLevel ? "prereq" : null;
}

/** GetRequirementsClipboardText: each of the plan's levels in its order, "name level" and a new line. */
export function requirementsClipboardText(plan: PersonalSkillPlan, nameOf: (typeID: number) => string): string {
  return plan.requirements.map(([typeID, level]) => `${nameOf(typeID)} ${level}\n`).join("");
}

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
  /** The gauge's progress as read; null where it could not be reckoned. */
  readonly progress?: PlanProgress | null;
  /** CheckShowOmegaIndicator: the plan has a skill an alpha may not train, and the pilot is not omega. */
  readonly omegaMark?: boolean;
  /** GetMissingSkillbooks' count: the plan's skills not held, lapsed ones counted held (the entry's tooltip). */
  readonly missingBooks?: number;
  /** GetNumOmegaSkills where the pilot is not omega, else nought (the entry's tooltip). */
  readonly numOmegaSkills?: number;
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
  /** Each of the plan's skills' tooltip and menu (SkillPlanContentsSkillEntry: LoadTooltipPanel, GetMenu); none unread. */
  readonly skillInfo?: ReadonlyMap<number, SkillRowInfo>;
}

/**
 * What a contents row's tooltip (LoadSkillEntryTooltipInfoOnly: the skill tooltip controller's information) and menu
 * (GetMenuForSkill, bridge/skillMenu.ts) are made from, for its skill.
 */
export interface SkillRowInfo {
  /** evetypes.GetDescriptionID: its description, as the tooltip's first words; null where it has none. */
  readonly descriptionID: number | null;
  /** The controller's level: GetSkillIncludingLapsed's trainedSkillLevel, nought where not had. */
  readonly level: number;
  /** The controller's points: GetSkillIncludingLapsed's trainedSkillPoints, nought where not had. */
  readonly points: number;
  /** get_skill_points_text's total: GetSPForLevelRaw(rank, 5); null where the rank is not known. */
  readonly totalPoints: number | null;
  /** is_queued: level_including_queued (MySkillLevelIncludingQueued), the time until it is trained (GetTrainingLengthOfSkill
   * at that level, in ticks; null unknown) and the training rate (GetSkillpointsPerMinute); null where it is not queued. */
  readonly queued: { readonly level: number; readonly ticks: number | null; readonly rate: number | null } | null;
  readonly menu: SkillMenuFacts;
  /** SkillTooltipController.virtual_level: the level an expert system gives it, nought where none. */
  readonly virtualLevel: number;
  /**
   * get_active_expert_systems_providing_skill: the pilot's expert systems (GetMyExpertSystems) that give the skill, as
   * that dict iterates; none where it has no virtual level (the notice is not shown then).
   */
  readonly expertSystems: readonly number[];
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
