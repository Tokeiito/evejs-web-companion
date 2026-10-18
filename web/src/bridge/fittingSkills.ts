// The Fitting window's skill warning as the client reckons it (ui/shared/fittingScreen/skillRequirements.py,
// warningIconCont.py, shipfitting/fittingWarnings.py GetSlotsMissingSkills): how many skills the ship and what it
// holds are missing, the slots and holds showing it, and the skills its tooltip lists for the ship and fit and for the
// cargo hold.

import { isSkillRequirementMet, missingSkillsRecursive, type PilotSkills, type RequiredSkills } from "./missingSkills.ts";

/** inventorycommon const categoryBlueprint: a blueprint's skills are not counted. */
const CATEGORY_BLUEPRINT = 9;
/** moduleSlotFlags, and GetSlotsMissingSkills' extra holds: the cargo hold, drone bay, fighter bay and the tubes. */
const MODULE_SLOT_FLAGS: readonly number[] = Array.from({ length: 24 }, (_, at) => 11 + at);
const EXTRA_HOLDS: readonly number[] = [5, 87, 158, 159, 160, 161, 162, 163];

/** The skill warning of a ship, its fit and its holds. */
export interface FittingSkillWarning {
  /** The skills missing, of every type of the ship, its fit, its bays and its cargo (the icon's counter). */
  readonly count: number;
  /** GetSlotsMissingSkills: each module slot and hold holding a type that misses a skill. */
  readonly flags: readonly number[];
  /** GetSkillTooltip: the ship and fit's skills missing, each at the highest level needed. */
  readonly fit: readonly (readonly [number, number])[];
  /** The cargo hold's, those the ship and fit's list has at that level or above left out. */
  readonly cargo: readonly (readonly [number, number])[];
  /** Whether the cargo hold has types missing skills that the ship and fit has not (its heading shown). */
  readonly cargoListed: boolean;
  /** Whether both have (the Ship and Fit heading shown). */
  readonly shipAndFitHeading: boolean;
}

/** What the warning goes by: the types, the items in their slots and holds, the skills needed and the pilot's. */
export interface FittingSkillInputs {
  /** _GetAllTypesForShipAndFit: the ship's type, the items fitted to it, and the drone bay's, fighter bay's and tubes' types. */
  readonly shipAndFit: readonly number[];
  /** _GetAllTypesForCargoHold. */
  readonly cargo: readonly number[];
  /** The items fitted to the ship and those of its holds, (typeID, flagID). */
  readonly items: readonly (readonly [number, number])[];
  readonly required: RequiredSkills;
  /** The pilot's skills, and with the lapsed ones (GetSkills, GetAllSkills). */
  readonly mine: PilotSkills;
  readonly lapsed: PilotSkills;
  /** evetypes.GetCategoryID, null where the type does not exist. */
  readonly categoryOf: (typeID: number) => number | null;
}

/**
 * GetMissingSkills_HighestLevelByTypeID: of each type (none that does not exist, nor a blueprint), each skill missing
 * to use it however deep (GetSkillsMissingToUseItemRecursive), at the highest level any needs it; and each type's
 * missing skills.
 */
export function missingSkillsHighestLevel(
  typeIDs: Iterable<number>,
  inputs: Pick<FittingSkillInputs, "required" | "mine" | "lapsed" | "categoryOf">,
): { readonly highest: Map<number, number>; readonly byType: Map<number, Set<number>> } {
  const highest = new Map<number, number>();
  const byType = new Map<number, Set<number>>();
  for (const typeID of typeIDs) {
    const categoryID = inputs.categoryOf(typeID);
    if (categoryID === null || categoryID === CATEGORY_BLUEPRINT) continue;
    for (const [skill, level] of missingSkillsRecursive(typeID, inputs.required, inputs.mine, inputs.lapsed)) {
      highest.set(skill, Math.trunc(Math.max(level, highest.get(skill) ?? 0)));
      const skills = byType.get(typeID) ?? new Set<number>();
      skills.add(skill);
      byType.set(typeID, skills);
    }
  }
  return { highest, byType };
}

/**
 * The skill warning: the icon's count and the slots (of every type of the ship and what it holds), and the tooltip's
 * lists (GetSkillTooltip: the types whose own skills are not met, the cargo's those of the ship and fit left out).
 */
export function fittingSkillWarning(inputs: FittingSkillInputs): FittingSkillWarning {
  const all = new Set([...inputs.shipAndFit, ...inputs.cargo]);
  const { highest, byType } = missingSkillsHighestLevel(all, inputs);
  const validFlags = new Set([...MODULE_SLOT_FLAGS, ...EXTRA_HOLDS]);
  const flags = [...new Set(inputs.items.filter(([typeID, flagID]) => validFlags.has(flagID) && byType.has(typeID)).map(([, flagID]) => flagID))];
  // GetMissingSkillsForTypeIDs: the types whose own skills are not met (IsSkillRequirementMet).
  const unmet = (typeIDs: Iterable<number>) => new Set([...typeIDs].filter((typeID) => !isSkillRequirementMet(typeID, inputs.required, inputs.mine)));
  const fitMissing = unmet(new Set(inputs.shipAndFit));
  const fitHighest = missingSkillsHighestLevel(fitMissing, inputs).highest;
  const cargoMissing = new Set([...unmet(new Set(inputs.cargo))].filter((typeID) => !fitMissing.has(typeID)));
  const cargoHighest = missingSkillsHighestLevel(cargoMissing, inputs).highest;
  for (const [skill, level] of [...cargoHighest]) if ((fitHighest.get(skill) ?? 0) >= level) cargoHighest.delete(skill);
  return {
    count: highest.size,
    flags,
    fit: inputs.shipAndFit.length > 0 ? [...fitHighest] : [],
    cargo: [...cargoHighest],
    cargoListed: cargoMissing.size > 0,
    shipAndFitHeading: fitMissing.size > 0 && cargoMissing.size > 0,
  };
}
