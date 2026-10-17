// The certified skill plans, as the retail client keeps them (skillPlanService._PrimeCertifiedCache, the client's
// skillPlans table; CertifiedSkillPlanController), and the Skill Plans window's Certified Plans panel
// (skillPlan/browser/certifiedPlansPanel.py):
//
//   a plan          its id is uuid.UUID(int=the table's id); its name and description are messages; it is not
//                   editable, but trackable (SetActive with that id); its milestones are the table's (a type, or a
//                   skill at a level)
//   the AIR plan    PLAN_ID_AIR (33): until each of its skills is trained or queued (HasFinishedAIRSkillPlan), the
//                   panel shows it alone, the career paths locked (CareerPathsLockedByAIR)
//   career paths    their buttons in the order the client's table iterates them; SelectCareerPathHint until one is
//                   chosen; the choice kept (settings.char.ui skillPlanCareerPathID)
//   factions        appConst.factionByRace's factions, in the order that dict iterates; the pilot's own chosen when a
//                   career path is (OnCareerPathTabGroup); none for the Industrialist, whose plans are all shown
//   the plans       GetAllCertifiedForCareerPath, the faction's where one is chosen (PopulateScroll)

import { intDictOrder } from "./py27DictOrder.ts";
import type { Milestone } from "./skillPlanMilestones.ts";

/** skillPlanConst.PLAN_ID_AIR: uuid.UUID(int=33). */
export const PLAN_ID_AIR = 33;
/** careerpathconst.career_path_industrialist */
export const CAREER_PATH_INDUSTRIALIST = 5;

/** A certified plan as the client's table has it. */
export interface CertifiedPlanData {
  readonly planID: number;
  readonly nameID: number | null;
  readonly descriptionID: number | null;
  readonly careerPathID: number | null;
  readonly factionID: number | null;
  readonly npcCorporationDivision: number | null;
  readonly requirements: readonly (readonly [number, number])[];
  readonly milestones: readonly { readonly typeID: number; readonly level: number | null }[];
}

export interface CareerPath {
  readonly careerPathID: number;
  readonly nameID: number | null;
  readonly descriptionID: number | null;
}

/** appConst.factionByRace: raceCaldari 1, raceMinmatar 2, raceAmarr 4, raceGallente 8. */
const FACTION_BY_RACE: Readonly<Record<number, number>> = { 1: 500001, 2: 500002, 4: 500003, 8: 500004 };

/** factionByRace.values(), as CPython iterates the dict (race 8 falls in the first slot of its table). */
export function empireFactions(): number[] {
  return intDictOrder([1, 2, 4, 8]).map((raceID) => FACTION_BY_RACE[raceID]!);
}

/** factionByRace[raceID]; null for a race it does not name. */
export function factionOfRace(raceID: number | null): number | null {
  return raceID === null ? null : FACTION_BY_RACE[raceID] ?? null;
}

/** str(uuid.UUID(int=planID)) */
export function certifiedPlanUuid(planID: number): string {
  const hex = BigInt(planID).toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** _ConstructMilestonesControllers: a milestone with a level is a skill's, else a type's (ids made up, as uuid4). */
export function certifiedMilestones(plan: CertifiedPlanData): Milestone[] {
  return plan.milestones.map((milestone, at) => (milestone.level === null
    ? { id: `${certifiedPlanUuid(plan.planID)}:${at}`, kind: "type", typeID: milestone.typeID }
    : { id: `${certifiedPlanUuid(plan.planID)}:${at}`, kind: "skill", typeID: milestone.typeID, level: milestone.level }));
}

/**
 * HasFinishedAIRSkillPlan: each of the AIR plan's skill levels trained (MySkillLevel) or in the queue
 * (GetQueueAsRequirements).
 */
export function airPlanFinished(
  air: CertifiedPlanData | undefined,
  trainedLevel: (typeID: number) => number,
  queued: ReadonlySet<string>,
): boolean {
  if (!air) return true;
  return air.requirements.every(([typeID, level]) => trainedLevel(typeID) >= level || queued.has(`${typeID}:${level}`));
}

/** PopulateScroll: the career path's plans, the faction's where one is chosen. */
export function certifiedPlansShown<T extends { readonly careerPathID: number | null; readonly factionID: number | null }>(
  plans: readonly T[],
  careerPathID: number | null,
  factionID: number | null,
): T[] {
  if (careerPathID === null) return [];
  return plans.filter((plan) => plan.careerPathID === careerPathID && (factionID === null || plan.factionID === factionID));
}
