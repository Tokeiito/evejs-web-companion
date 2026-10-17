// The Fitting window's warnings as the client evaluates them (shipfitting/fittingWarnings.py EvaluateFit,
// shipfitting/fittingWarningConst.py) and as its warnings tooltip lists them
// (ui/shared/fittingScreen/warningIconTooltip.py EvaluateFitAndPopulateTooltip): which warnings a fitting has, each
// its level, the slots it is shown on and the rows under it, in the tooltip's order.
//
// Reckoned so far: the missing subsystems, modules in slots the hull has not, the CPU, powergrid and calibration
// overloaded, the cargo hold overloaded, the tanking warnings (dual tanked, a shield hull armour tanked and the other
// way round), mixed turret groups, launcher groups and turret sizes, polarized weapons, offline modules, undersized and
// inefficient propulsion modules, bubble immunity disabled, and the modules missing their charges. Not yet: the
// modules giving no bonus and the stacking penalties.

import type { DogmaStatic } from "./location.ts";
import { intDictOrder } from "../py27DictOrder.ts";

/** fittingWarningConst's levels. */
export const WARNING_LEVEL_LOW = 1;
export const WARNING_LEVEL_MEDIUM = 2;
export const WARNING_LEVEL_HIGH = 3;
export const WARNING_LEVEL_SKILL = 4;

/** colorByWarningLevel: WHITE, YELLOW, RED, ORANGE, as the client's RGBA fractions. */
export const COLOR_BY_LEVEL: Readonly<Record<number, string>> = {
  [WARNING_LEVEL_LOW]: "rgb(90% 90% 90%)",
  [WARNING_LEVEL_MEDIUM]: "rgb(100% 78% 0%)",
  [WARNING_LEVEL_HIGH]: "rgb(80% 0% 0%)",
  [WARNING_LEVEL_SKILL]: "rgb(100% 50% 0%)",
};

/** headerByWarningLevel. */
export const HEADER_BY_LEVEL: Readonly<Record<number, string>> = {
  [WARNING_LEVEL_LOW]: "UI/Fitting/FittingWindow/Warnings/HeaderLow",
  [WARNING_LEVEL_MEDIUM]: "UI/Fitting/FittingWindow/Warnings/HeaderMedium",
  [WARNING_LEVEL_HIGH]: "UI/Fitting/FittingWindow/Warnings/HeaderHigh",
  [WARNING_LEVEL_SKILL]: "UI/Fitting/FittingWindow/Warnings/HeaderSkills",
};

/** fittingWarningConst's warning IDs. */
export const WARNING = Object.freeze({
  MISSING_SUBSYSTEMS: 1,
  MODULES_IN_INVALID_FLAGS: 2,
  ARMOR_TANKED_SHIELD_SHIP: 3,
  SHIELD_TANKED_ARMOR_SHIP: 4,
  WRONG_TANKING: 5,
  NOT_PROVIDING_BONUS: 6,
  MIXING_TURRET_GROUPS: 7,
  MIXING_LAUNCHER_GROUPS: 8,
  MIXING_TURRET_SIZES: 9,
  POLARIZED_WEAPONS: 10,
  DUAL_TANKED: 11,
  MULTI_TANKED: 12,
  OVER_CPU_POWER: 13,
  OVER_CPU: 14,
  OVER_POWERGRID: 15,
  OVERLOADED_CARGO: 16,
  OFFLINE_MODULES: 17,
  OVER_CALIBRATION: 18,
  MISSING_REQ_CHARGES: 19,
  MISSING_OPTIONAL_CHARGES: 20,
  STACKING_PENALTY_MED: 21,
  STACKING_PENALTY_LOW: 22,
  STACKING_PENALTY_TARGETED_LOW: 23,
  UNDERSIZED_PROP_MOD: 24,
  DISABLED_BUBBLE_IMMUNITY: 25,
  INEFFICIENT_PROP_MOD: 26,
});

const LABELS = "UI/Fitting/FittingWindow/Warnings/";
/** warningsByWarningID: each warning's level, its line's label and its hint's. */
export const WARNINGS_BY_ID: Readonly<Record<number, { readonly level: number; readonly short: string; readonly hint: string }>> = {
  [WARNING.MISSING_SUBSYSTEMS]: { level: WARNING_LEVEL_HIGH, short: `${LABELS}SubsystemShort`, hint: `${LABELS}SubsystemHint` },
  [WARNING.OVER_CPU]: { level: WARNING_LEVEL_HIGH, short: `${LABELS}CpuOverloadedShort`, hint: `${LABELS}CpuOverloadedHint` },
  [WARNING.OVER_POWERGRID]: { level: WARNING_LEVEL_HIGH, short: `${LABELS}PowergridOverloadedShort`, hint: `${LABELS}PowergridOverloadedHint` },
  [WARNING.OVER_CPU_POWER]: { level: WARNING_LEVEL_HIGH, short: `${LABELS}CpuPowergridOverloadedShort`, hint: `${LABELS}CpuPowergridOverloadedHint` },
  [WARNING.OVER_CALIBRATION]: { level: WARNING_LEVEL_HIGH, short: `${LABELS}CalibrationOverloadedShort`, hint: `${LABELS}CalibrationOverloadedHint` },
  [WARNING.OVERLOADED_CARGO]: { level: WARNING_LEVEL_HIGH, short: `${LABELS}CargoOverloadedShort`, hint: `${LABELS}CargoOverloadedHint` },
  [WARNING.MODULES_IN_INVALID_FLAGS]: { level: WARNING_LEVEL_HIGH, short: `${LABELS}ModulesInInvalidSlotsShort`, hint: `${LABELS}ModulesInInvalidSlotsHint` },
  [WARNING.WRONG_TANKING]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}IncorrectTankingShort`, hint: `${LABELS}IncorrectTankingHint` },
  [WARNING.NOT_PROVIDING_BONUS]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}NotProvidingBonusShort`, hint: `${LABELS}NotProvidingBonusHint` },
  [WARNING.MIXING_TURRET_GROUPS]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}MixingTurretGroupsShort`, hint: `${LABELS}MixingTurretGroupsHint` },
  [WARNING.MIXING_LAUNCHER_GROUPS]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}MixingLauncherGroupsShort`, hint: `${LABELS}MixingLauncherGroupsHint` },
  [WARNING.MIXING_TURRET_SIZES]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}MixingTurretSizesShort`, hint: `${LABELS}MixingTurretSizesHint` },
  [WARNING.DUAL_TANKED]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}ShipIsDualTankedShort`, hint: `${LABELS}ShipIsDualTankedHint` },
  [WARNING.MULTI_TANKED]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}ShipIsMultiTankedShort`, hint: `${LABELS}ShipIsMultiTankedHint` },
  [WARNING.OFFLINE_MODULES]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}OfflineModulesShort`, hint: `${LABELS}OfflineModulesHint` },
  [WARNING.STACKING_PENALTY_MED]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}StackingPenaltyMedShort`, hint: `${LABELS}StackingPenaltyMedHint` },
  [WARNING.UNDERSIZED_PROP_MOD]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}UndersizedPropModShort`, hint: `${LABELS}UndersizedPropModHint` },
  [WARNING.DISABLED_BUBBLE_IMMUNITY]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}BubbleImmunityDisabledShort`, hint: `${LABELS}BubbleImmunityDisabledHint` },
  [WARNING.INEFFICIENT_PROP_MOD]: { level: WARNING_LEVEL_MEDIUM, short: `${LABELS}InefficientPropModShort`, hint: `${LABELS}InefficientPropModHint` },
  [WARNING.POLARIZED_WEAPONS]: { level: WARNING_LEVEL_LOW, short: `${LABELS}PolarizedWeaponsFittedShort`, hint: `${LABELS}PolarizedWeaponsFittedHint` },
  [WARNING.ARMOR_TANKED_SHIELD_SHIP]: { level: WARNING_LEVEL_LOW, short: `${LABELS}ArmorTankingShieldShipShort`, hint: `${LABELS}ArmorTankingShieldShipHint` },
  [WARNING.SHIELD_TANKED_ARMOR_SHIP]: { level: WARNING_LEVEL_LOW, short: `${LABELS}ShieldTankingArmorShipShort`, hint: `${LABELS}ShieldTankingArmorShipHint` },
  [WARNING.MISSING_REQ_CHARGES]: { level: WARNING_LEVEL_LOW, short: `${LABELS}MissingChargesForRequiredShort`, hint: `${LABELS}MissingChargesForRequiredHint` },
  [WARNING.MISSING_OPTIONAL_CHARGES]: { level: WARNING_LEVEL_LOW, short: `${LABELS}MissingChargesForOptionalShort`, hint: `${LABELS}MissingChargesForOptionalHint` },
  [WARNING.STACKING_PENALTY_LOW]: { level: WARNING_LEVEL_LOW, short: `${LABELS}StackingPenaltyLowShort`, hint: `${LABELS}StackingPenaltyLowHint` },
  [WARNING.STACKING_PENALTY_TARGETED_LOW]: { level: WARNING_LEVEL_LOW, short: `${LABELS}StackingPenaltyTargetedLowShort`, hint: `${LABELS}StackingPenaltyTargetedLowHint` },
};

/** warningIconTooltip: the warnings' lines in the tooltip's order (EvaluateFitAndPopulateTooltip). */
const TOOLTIP_ORDER: readonly number[] = [
  WARNING.MISSING_SUBSYSTEMS, WARNING.MODULES_IN_INVALID_FLAGS, WARNING.OVER_CPU, WARNING.OVER_POWERGRID, WARNING.OVER_CALIBRATION,
  WARNING.OVERLOADED_CARGO, WARNING.DUAL_TANKED, WARNING.MULTI_TANKED, WARNING.ARMOR_TANKED_SHIELD_SHIP, WARNING.SHIELD_TANKED_ARMOR_SHIP,
  WARNING.NOT_PROVIDING_BONUS, WARNING.MIXING_TURRET_GROUPS, WARNING.MIXING_LAUNCHER_GROUPS, WARNING.MIXING_TURRET_SIZES,
  WARNING.OFFLINE_MODULES, WARNING.POLARIZED_WEAPONS, WARNING.MISSING_REQ_CHARGES, WARNING.MISSING_OPTIONAL_CHARGES,
  WARNING.UNDERSIZED_PROP_MOD, WARNING.INEFFICIENT_PROP_MOD, WARNING.STACKING_PENALTY_MED, WARNING.STACKING_PENALTY_LOW,
  WARNING.STACKING_PENALTY_TARGETED_LOW, WARNING.DISABLED_BUBBLE_IMMUNITY,
];

/** The semiflags a warning on the CPU's and the powergrid's gauges is shown on (-WARNING_OVER_CPU, -WARNING_OVER_POWERGRID). */
export const FLAG_CPU_GAUGE = -WARNING.OVER_CPU;
export const FLAG_POWERGRID_GAUGE = -WARNING.OVER_POWERGRID;
const FLAG_CARGO = 5;

/** inventorycommon const: the slots' flags. */
const MODULE_SLOT_FLAGS: readonly number[] = Array.from({ length: 24 }, (_, at) => 11 + at);
const HI_SLOT_FLAGS: readonly number[] = [27, 28, 29, 30, 31, 32, 33, 34];
const SUBSYSTEM_SLOT_FLAGS: readonly number[] = [125, 126, 127, 128];
const RIG_SLOT_FLAGS: readonly number[] = [92, 93, 94];
const FITTING_FLAGS: ReadonlySet<number> = new Set([...MODULE_SLOT_FLAGS, ...SUBSYSTEM_SLOT_FLAGS, ...RIG_SLOT_FLAGS, 164, 165, 166, 167, 168, 169, 170, 171]);

const GROUP_STRATEGIC_CRUISER = 963;
const CATEGORY_MODULE = 7;
const CATEGORY_STRUCTURE = 65;
const CATEGORY_STRUCTURE_MODULE = 66;
const ATTRIBUTE_CHARGE_SIZE = 128;
const ATTRIBUTE_TECH_LEVEL = 422;
const EFFECT_LAUNCHER_FITTED = 40;
const EFFECT_RESISTANCE_KILLER_HULL_ALL = 5994;
const EFFECT_RESISTANCE_KILLER_SHIELD_ARMOR_ALL = 5995;
/** carbon const FLOAT_TOLERANCE. */
const FLOAT_TOLERANCE = 0.001;

/** TURRET_GROUPS: projectile, hybrid, energy and precursor weapons; and iconPathsByTurretGroup. */
const TURRET_GROUPS: readonly number[] = [55, 74, 53, 1986];
const ICON_BY_TURRET_GROUP: Readonly<Record<number, string>> = {
  55: "res:/UI/Texture/Icons/12_64_9.png",
  74: "res:/UI/Texture/Icons/13_64_1.png",
  53: "res:/UI/Texture/Icons/13_64_9.png",
  1986: "res:/UI/Texture/Icons/Modules/disintegratorCannonS.png",
};
/** HARD_CODED_GROUPIDS: the civilian turrets, each taken for its weapon group. */
const HARD_CODED_GROUP_IDS: Readonly<Record<number, number>> = { 3636: 55, 3638: 74, 3640: 74, 3634: 53 };
/** iconPathForSizes. */
const ICON_BY_SIZE: Readonly<Record<number, string>> = {
  1: "res:/UI/Texture/classes/Fitting/Small.png",
  2: "res:/UI/Texture/classes/Fitting/Medium.png",
  3: "res:/UI/Texture/classes/Fitting/Large.png",
  4: "res:/UI/Texture/classes/Fitting/XLarge.png",
};
/** SUBSYSTEM_INFO_BY_SLOT: each subsystem slot's group and icon. */
const SUBSYSTEM_INFO_BY_SLOT: Readonly<Record<number, { readonly groupID: number; readonly icon: string }>> = {
  125: { groupID: 958, icon: "res:/UI/Texture/Icons/81_64_11.png" },
  126: { groupID: 954, icon: "res:/UI/Texture/Icons/81_64_10.png" },
  127: { groupID: 956, icon: "res:/UI/Texture/Icons/81_64_12.png" },
  128: { groupID: 957, icon: "res:/UI/Texture/Icons/81_64_13.png" },
};
/** evetypes TYPE_LIST_FITTING_WARNINGS_SHIELD, ARMOR, HULL: the tanking modules of each layer. */
export const TYPE_LIST_FITTING_WARNINGS_SHIELD = 145;
export const TYPE_LIST_FITTING_WARNINGS_ARMOR = 146;
export const TYPE_LIST_FITTING_WARNINGS_HULL = 147;
/** evetypes TYPE_LIST_FITTING_WARNINGS_USE_OPTIONAL_CHARGES and _NEED_CHARGES. */
export const TYPE_LIST_FITTING_WARNINGS_USE_OPTIONAL_CHARGES = 216;
export const TYPE_LIST_FITTING_WARNINGS_NEED_CHARGES = 217;
/** The type lists the warnings go by, to read for the fitted types. */
export const WARNING_TYPE_LISTS: readonly number[] = [
  TYPE_LIST_FITTING_WARNINGS_SHIELD, TYPE_LIST_FITTING_WARNINGS_ARMOR, TYPE_LIST_FITTING_WARNINGS_HULL,
  TYPE_LIST_FITTING_WARNINGS_USE_OPTIONAL_CHARGES, TYPE_LIST_FITTING_WARNINGS_NEED_CHARGES,
];
/** appConst categoryCharge, flagCargo, flagSpecializedAmmoHold; attributeCapacity, attributeVolume. */
const CATEGORY_CHARGE = 8;
const FLAG_SPECIALIZED_AMMO_HOLD = 143;
const ATTRIBUTE_CAPACITY = 38;
const ATTRIBUTE_VOLUME = 161;
/** fittingWarningsCharges TREAT_AS_FULL: a scan probe launcher full at eight. */
const TREAT_AS_FULL: Readonly<Record<number, number>> = { 481: 8 };
/** fittingWarningConst INFO_BUBBLE_SHIELD, INFO_BUBBLE_ARMOR, INFO_BUBBLE_SHIELD_OR_ARMOR: a hull's tanking elements. */
const INFO_BUBBLE_SHIELD = 20;
const INFO_BUBBLE_ARMOR = 7;
const INFO_BUBBLE_SHIELD_OR_ARMOR = 2046;
/** NON_PROP_MOD_GROUPS (groupFreighter), groupPropulsionModule, groupInterdictionNullifier. */
const GROUP_FREIGHTER = 513;
const GROUP_PROPULSION_MODULE = 46;
const GROUP_INTERDICTION_NULLIFIER = 4117;
/** dogma const attributeMass, attributeSpeedBoostFactor, attributeWarpBubbleImmune, attributeWarpBubbleImmuneModifier. */
const ATTRIBUTE_MASS = 4;
const ATTRIBUTE_SPEED_BOOST_FACTOR = 567;
const ATTRIBUTE_WARP_BUBBLE_IMMUNE = 1538;
const ATTRIBUTE_WARP_BUBBLE_IMMUNE_MODIFIER = 1539;
/** MASS_SPEEDBOOST_MAX_RATIO. */
const MASS_SPEEDBOOST_MAX_RATIO = 2.0;

/** shipmode/data.py _DATA: the hulls that have stances (ship_has_stances). */
const HULLS_WITH_STANCES: ReadonlySet<number> = new Set([34317, 34562, 34828, 35683, 89808, 89807]);

/** A row under a warning's line in the tooltip (its fullVersion), with the slots it is shown on. */
export type FitWarningRow =
  | { readonly kind: "subsystem"; readonly flagID: number; readonly groupID: number; readonly icon: string }
  | { readonly kind: "module"; readonly typeID: number; readonly flagID: number }
  | { readonly kind: "group"; readonly groupID: number; readonly icon: string | null; readonly flags: readonly number[] }
  | { readonly kind: "size"; readonly size: number; readonly icon: string | null; readonly flags: readonly number[] };

/** A warning the fitting has: its level, the slots it is shown on, the rows under its line. */
export interface FitWarning {
  readonly warningID: number;
  readonly level: number;
  readonly flags: readonly number[];
  readonly rows: readonly FitWarningRow[];
}

/** What EvaluateFit goes by, as the window's controller and the current fitting give it. */
export interface FitWarningInputs {
  readonly static: DogmaStatic;
  readonly shipTypeID: number;
  /** GetFittingDictForCurrentFittingWindowShip's fitting (CreateFittingData): each (typeID, flagID, qty). */
  readonly fit: readonly (readonly [number, number, number])[];
  /** The controller's dogma location's SlotExists of the ship. */
  readonly slotExists: (flagID: number) => boolean;
  /** GetCPULoad/Output, GetPowerLoad/Output, GetCalibrationLoad/Output (GetStatsInfo), where known. */
  readonly resources: Readonly<Record<"cpu" | "powergrid" | "calibration", { readonly load: number; readonly output: number } | null>>;
  /** The cargo hold's capacity and use (GetCapacity(flagCargo)); null where it is not read. */
  readonly cargo: { readonly capacity: number; readonly used: number } | null;
  /** FindOfflineModules: the ship's offline modules, (typeID, flagID); none while simulating. */
  readonly offlineModules: readonly (readonly [number, number])[];
  /** The dogma location's GetFittedItemsToShip: each item fitted to the ship, (typeID, flagID). */
  readonly fittedItems: readonly (readonly [number, number])[];
  /** The type lists a type is on, of the warnings' (WARNING_TYPE_LISTS). */
  readonly typeLists: (typeID: number) => ReadonlySet<number>;
  /** cfg.infoBubbleTypeElements of the ship's type: its elements; null where it has none. */
  readonly shipElements: readonly number[] | null;
  /**
   * FindModulesWithMissingCharges' fitting: each item fitted in a module slot (a module one, a charge its quantity:
   * GetQuantity) and each stack in the cargo hold and the specialized ammo hold (GetHoldItems), (typeID, flagID, qty);
   * null where the ship's item is no ship.
   */
  readonly chargesFit: readonly (readonly [number, number, number])[] | null;
}

/**
 * infoSvc.GetUsedWithTypeIDs of a module, of the charges named (_GetUsedWithTuple keeps only those): a published charge
 * in one of the module's charge groups, its volume within the module's capacity, its size the module's where the module
 * has one (_AddUsedWithTypeIDs). Null for a module the table has nothing for: one not published or with no charge
 * groups. (The table is the client's of every type; a module whose groups hold no charge it may use at all, which the
 * table would leave out, is not told apart here.)
 */
function usedWithOf(staticData: DogmaStatic, moduleTypeID: number, chargeTypeIDs: readonly number[]): number[] | null {
  const module = staticData.types[moduleTypeID];
  const chargeGroups = (module?.chargeGroups ?? []).filter((groupID) => groupID > 0).map(Math.trunc);
  if (!module || module.published === false || chargeGroups.length === 0) return null;
  const capacity = typeAttribute(staticData, moduleTypeID, ATTRIBUTE_CAPACITY);
  const size = typeAttribute(staticData, moduleTypeID, ATTRIBUTE_CHARGE_SIZE) ?? 0;
  return chargeTypeIDs.filter((chargeTypeID) => {
    const charge = staticData.types[chargeTypeID];
    if (!charge || charge.published === false || charge.groupID === null || !chargeGroups.includes(charge.groupID)) return false;
    if (capacity !== null && capacity < (typeAttribute(staticData, chargeTypeID, ATTRIBUTE_VOLUME) ?? 0)) return false;
    return !size || (typeAttribute(staticData, chargeTypeID, ATTRIBUTE_CHARGE_SIZE) ?? 0) === size;
  });
}

/**
 * fittingWarningsCharges.FindModulesMissingCharges: the modules that need charges (list 217) and those that take
 * optional ones (list 216), each with no charge, or short by more than one of full (its capacity over the charge's
 * volume, a scan probe launcher's eight), that the charges in the cargo and ammo holds cannot fill
 * (FindModulesThatCannotBeFilled: the modules of the same usable charges and capacity together, each charge's full
 * rounds taken off them in turn).
 */
function findModulesMissingCharges(staticData: DogmaStatic, currentFit: readonly (readonly [number, number, number])[], lists: (typeID: number) => ReadonlySet<number>): { readonly required: [number, number][]; readonly optional: [number, number][] } {
  const chargesInFlags = new Map<number, [number, number][]>();
  for (const [typeID, flagID, qty] of currentFit) {
    if (staticData.types[typeID]?.categoryID !== CATEGORY_CHARGE) continue;
    const list = chargesInFlags.get(flagID) ?? [];
    list.push([typeID, qty]);
    chargesInFlags.set(flagID, list);
  }
  // _GetAllChargesInHolds: the cargo hold's and the ammo hold's charges by type.
  const chargesLeft = new Map<number, number>();
  for (const flagID of intDictOrder([...chargesInFlags.keys()])) {
    if (flagID !== FLAG_CARGO && flagID !== FLAG_SPECIALIZED_AMMO_HOLD) continue;
    for (const [chargeTypeID, qty] of chargesInFlags.get(flagID) ?? []) chargesLeft.set(chargeTypeID, (chargesLeft.get(chargeTypeID) ?? 0) + qty);
  }
  const needing: [number, number][] = currentFit.filter(([typeID]) => lists(typeID).has(TYPE_LIST_FITTING_WARNINGS_NEED_CHARGES)).map(([typeID, flagID]) => [typeID, flagID]);
  const optional: [number, number][] = currentFit.filter(([typeID]) => lists(typeID).has(TYPE_LIST_FITTING_WARNINGS_USE_OPTIONAL_CHARGES)).map(([typeID, flagID]) => [typeID, flagID]);
  const withoutCharges: [number, number][] = [];
  const partiallyFull = new Map<number, [number, number, number][]>();
  for (const [moduleTypeID, flagID] of [...needing, ...optional]) {
    const loaded = chargesInFlags.get(flagID);
    if (!loaded) {
      withoutCharges.push([moduleTypeID, flagID]);
      continue;
    }
    const [chargeTypeID, chargeQty] = loaded[0]!;
    let qtyFull = Math.trunc((typeAttribute(staticData, moduleTypeID, ATTRIBUTE_CAPACITY) ?? 0) / (typeAttribute(staticData, chargeTypeID, ATTRIBUTE_VOLUME) ?? 0));
    const overridden = TREAT_AS_FULL[staticData.types[moduleTypeID]?.groupID ?? -1];
    if (overridden && overridden < qtyFull) qtyFull = overridden;
    if (qtyFull - chargeQty > 1) {
      const list = partiallyFull.get(chargeTypeID) ?? [];
      list.push([moduleTypeID, flagID, chargeQty]);
      partiallyFull.set(chargeTypeID, list);
    }
  }
  for (const chargeTypeID of intDictOrder([...partiallyFull.keys()])) {
    for (const [moduleTypeID, flagID, chargeQty] of partiallyFull.get(chargeTypeID) ?? []) {
      withoutCharges.push([moduleTypeID, flagID]);
      chargesLeft.set(chargeTypeID, (chargesLeft.get(chargeTypeID) ?? 0) + chargeQty);
    }
  }
  // GetGroupsDict and FindModulesThatCannotBeFilled.
  const chargeTypesLeft = [...chargesLeft.keys()];
  const groupings = new Map<string, { readonly chargeTypeIDs: readonly number[]; readonly capacity: number; readonly modules: [number, number][] }>();
  for (const [moduleTypeID, flagID] of withoutCharges) {
    const usedWith = usedWithOf(staticData, moduleTypeID, chargeTypesLeft);
    if (usedWith === null) continue;
    const chargeTypeIDs = [...new Set(usedWith)].sort((a, b) => a - b);
    const capacity = typeAttribute(staticData, moduleTypeID, ATTRIBUTE_CAPACITY) ?? 0;
    const key = `${chargeTypeIDs.join(",")}|${capacity}`;
    const group = groupings.get(key) ?? { chargeTypeIDs, capacity, modules: [] };
    group.modules.push([moduleTypeID, flagID]);
    groupings.set(key, group);
  }
  const cannotBeFilled: [number, number][] = [];
  for (const { chargeTypeIDs, capacity, modules } of groupings.values()) {
    let leftToFill = modules.length;
    let filled = false;
    for (const chargeTypeID of chargeTypeIDs) {
      const qtyForFull = Math.trunc(capacity / (typeAttribute(staticData, chargeTypeID, ATTRIBUTE_VOLUME) ?? 0));
      leftToFill -= Math.trunc((chargesLeft.get(chargeTypeID) ?? 0) / qtyForFull);
      if (leftToFill <= 0) {
        filled = true;
        break;
      }
    }
    if (!filled) cannotBeFilled.push(...modules);
  }
  const among = (pairs: readonly [number, number][]) => (pair: [number, number]) => pairs.some(([typeID, flagID]) => typeID === pair[0] && flagID === pair[1]);
  return { required: cannotBeFilled.filter(among(needing)), optional: cannotBeFilled.filter(among(optional)) };
}

function typeAttribute(staticData: DogmaStatic, typeID: number, attributeID: number): number | null {
  return staticData.types[typeID]?.attributes.find(([id]) => id === attributeID)?.[1] ?? null;
}

function hasEffect(staticData: DogmaStatic, typeID: number, effectID: number): boolean {
  return staticData.types[typeID]?.effects.includes(effectID) ?? false;
}

/** _IsOverloaded: a difference below nought by more than the tolerance. */
function isOverloaded(value: number): boolean {
  return !(value > -FLOAT_TOLERANCE);
}

/** Pairs (typeID, flagID) grouped by a key, in the order each key is first met. */
function groupedBy(pairs: readonly (readonly [number, number])[], keyOf: (typeID: number) => number | null): Map<number, [number, number][]> {
  const grouped = new Map<number, [number, number][]>();
  for (const [typeID, flagID] of pairs) {
    const key = keyOf(typeID);
    if (key === null) continue;
    const list = grouped.get(key) ?? [];
    list.push([typeID, flagID]);
    grouped.set(key, list);
  }
  return grouped;
}

/**
 * EvaluateFit, of the warnings reckoned (see the head of this file), as the tooltip lists them: each warning with a
 * truthy result, in the tooltip's order (GetActiveWarningsByLevelFromResults counts the same ones).
 */
export function evaluateFit(inputs: FitWarningInputs): FitWarning[] {
  const { static: staticData, shipTypeID, fit } = inputs;
  const fittedModules = fit.filter(([, flagID]) => MODULE_SLOT_FLAGS.includes(flagID));
  const highSlotModules: [number, number][] = fittedModules.filter(([, flagID]) => HI_SLOT_FLAGS.includes(flagID)).map(([typeID, flagID]) => [typeID, flagID]);
  const shipType = staticData.types[shipTypeID];
  const found = new Map<number, Omit<FitWarning, "warningID" | "level">>();

  // FindMissingSubsystemFlags: a strategic cruiser's subsystem slots with nothing in them.
  if (shipType?.groupID === GROUP_STRATEGIC_CRUISER) {
    const filled = new Set(fit.filter(([, flagID]) => SUBSYSTEM_SLOT_FLAGS.includes(flagID)).map(([, flagID]) => flagID));
    const missing = SUBSYSTEM_SLOT_FLAGS.filter((flagID) => !filled.has(flagID));
    if (missing.length > 0) {
      found.set(WARNING.MISSING_SUBSYSTEMS, {
        flags: missing,
        rows: missing.map((flagID) => ({ kind: "subsystem", flagID, groupID: SUBSYSTEM_INFO_BY_SLOT[flagID]!.groupID, icon: SUBSYSTEM_INFO_BY_SLOT[flagID]!.icon })),
      });
    }
  }
  // FindModulesInNonExisitingSlots: a subsystem where the hull has a stance or no subsystems (HasSubsystems: tech
  // level above two); any other in a slot the hull has not.
  const hasStance = HULLS_WITH_STANCES.has(shipTypeID);
  const hasSubsystems = (typeAttribute(staticData, shipTypeID, ATTRIBUTE_TECH_LEVEL) ?? 0) > 2;
  const invalid: [number, number][] = [];
  for (const [typeID, flagID] of fit) {
    if (!FITTING_FLAGS.has(flagID)) continue;
    if (SUBSYSTEM_SLOT_FLAGS.includes(flagID)) {
      if (hasStance || !hasSubsystems) invalid.push([typeID, flagID]);
    } else if (!inputs.slotExists(flagID)) invalid.push([typeID, flagID]);
  }
  if (invalid.length > 0) found.set(WARNING.MODULES_IN_INVALID_FLAGS, { flags: [...new Set(invalid.map(([, flagID]) => flagID))], rows: [] });
  // IsOverOnPowergrid, IsOverOnCPU, IsOverOnCalibration: the output less the load below nought.
  const over = (resource: { readonly load: number; readonly output: number } | null) => resource !== null && isOverloaded(resource.output - resource.load);
  if (over(inputs.resources.powergrid)) found.set(WARNING.OVER_POWERGRID, { flags: [FLAG_POWERGRID_GAUGE], rows: [] });
  if (over(inputs.resources.cpu)) found.set(WARNING.OVER_CPU, { flags: [FLAG_CPU_GAUGE], rows: [] });
  if (over(inputs.resources.calibration)) found.set(WARNING.OVER_CALIBRATION, { flags: [...RIG_SLOT_FLAGS], rows: [] });
  // GetCargoOverloadedWarningID: the cargo hold's capacity less its use below nought; never a structure's.
  if (shipType?.categoryID !== CATEGORY_STRUCTURE && inputs.cargo !== null && isOverloaded(inputs.cargo.capacity - inputs.cargo.used)) {
    found.set(WARNING.OVERLOADED_CARGO, { flags: [FLAG_CARGO], rows: [] });
  }
  // GetModulesByTankGroup: each fitted module on the armour list, else the shield list, else the hull list.
  const shieldModules: [number, number][] = [];
  const armorModules: [number, number][] = [];
  for (const [typeID, flagID] of fittedModules) {
    const lists = inputs.typeLists(typeID);
    if (lists.has(TYPE_LIST_FITTING_WARNINGS_ARMOR)) armorModules.push([typeID, flagID]);
    else if (lists.has(TYPE_LIST_FITTING_WARNINGS_SHIELD)) shieldModules.push([typeID, flagID]);
  }
  // GetShieldArmorDualTankingModules: shield modules and armour modules both, every one of them.
  if (shieldModules.length > 0 && armorModules.length > 0) {
    found.set(WARNING.DUAL_TANKED, { flags: [...shieldModules, ...armorModules].map(([, flagID]) => flagID), rows: [] });
  }
  // GetProblematicShipAndTankingCombo (GetProblematicCombo): a hull of one tanking kind by its info bubble elements, none
  // where one is shield or armour; a shield hull's armour modules, an armour hull's shield modules.
  const elements = new Set(inputs.shipElements ?? []);
  if (!elements.has(INFO_BUBBLE_SHIELD_OR_ARMOR)) {
    const isShieldShip = elements.has(INFO_BUBBLE_SHIELD);
    const isArmorShip = elements.has(INFO_BUBBLE_ARMOR);
    if (Number(isShieldShip) + Number(isArmorShip) === 1) {
      if (isShieldShip && armorModules.length > 0) {
        found.set(WARNING.ARMOR_TANKED_SHIELD_SHIP, { flags: armorModules.map(([, flagID]) => flagID), rows: [] });
      } else if (isArmorShip && shieldModules.length > 0) {
        found.set(WARNING.SHIELD_TANKED_ARMOR_SHIP, { flags: shieldModules.map(([, flagID]) => flagID), rows: [] });
      }
    }
  }
  // GetMixedTurrets: the high slots' turrets by their weapon group (a civilian turret its HARD_CODED_GROUPIDS group),
  // more than one group.
  const turretsByGroup = groupedBy(highSlotModules, (typeID) => {
    const groupID = HARD_CODED_GROUP_IDS[typeID] ?? staticData.types[typeID]?.groupID ?? null;
    return groupID !== null && TURRET_GROUPS.includes(groupID) ? groupID : null;
  });
  if (turretsByGroup.size > 1) {
    found.set(WARNING.MIXING_TURRET_GROUPS, {
      flags: [...turretsByGroup.values()].flatMap((pairs) => pairs.map(([, flagID]) => flagID)),
      rows: [...turretsByGroup].map(([groupID, pairs]) => ({ kind: "group", groupID, icon: ICON_BY_TURRET_GROUP[groupID] ?? null, flags: pairs.map(([, flagID]) => flagID) })),
    });
  }
  // GetMixedLauncherGroups: the high slots' launchers (effectLauncherFitted) by group, more than one.
  const launchersByGroup = groupedBy(highSlotModules.filter(([typeID]) => hasEffect(staticData, typeID, EFFECT_LAUNCHER_FITTED)), (typeID) => staticData.types[typeID]?.groupID ?? null);
  if (launchersByGroup.size > 1) {
    found.set(WARNING.MIXING_LAUNCHER_GROUPS, {
      flags: [...launchersByGroup.values()].flatMap((pairs) => pairs.map(([, flagID]) => flagID)),
      // GetIconPathForTurretGroup: no launcher group has an icon.
      rows: [...launchersByGroup].map(([groupID, pairs]) => ({ kind: "group", groupID, icon: ICON_BY_TURRET_GROUP[groupID] ?? null, flags: pairs.map(([, flagID]) => flagID) })),
    });
  }
  // GetMixedTurretSizes: the high slots' turrets (their own group) by the chargeSize their type has, more than one
  // size. (A mutated turret's own size is not read yet.)
  const turretsBySize = groupedBy(
    highSlotModules.filter(([typeID]) => TURRET_GROUPS.includes(staticData.types[typeID]?.groupID ?? -1)),
    (typeID) => typeAttribute(staticData, typeID, ATTRIBUTE_CHARGE_SIZE) || null,
  );
  if (turretsBySize.size > 1) {
    found.set(WARNING.MIXING_TURRET_SIZES, {
      flags: [...turretsBySize.values()].flatMap((pairs) => pairs.map(([, flagID]) => flagID)),
      rows: [...turretsBySize].sort(([left], [right]) => left - right)
        .map(([size, pairs]) => ({ kind: "size", size, icon: ICON_BY_SIZE[size] ?? null, flags: pairs.map(([, flagID]) => flagID) })),
    });
  }
  // FindModulesWithMissingCharges: of a ship.
  if (inputs.chargesFit !== null) {
    const missing = findModulesMissingCharges(staticData, inputs.chargesFit, inputs.typeLists);
    if (missing.required.length > 0) found.set(WARNING.MISSING_REQ_CHARGES, { flags: [...new Set(missing.required.map(([, flagID]) => flagID))], rows: [] });
    if (missing.optional.length > 0) found.set(WARNING.MISSING_OPTIONAL_CHARGES, { flags: [...new Set(missing.optional.map(([, flagID]) => flagID))], rows: [] });
  }
  // FindOfflineModules (AddModuleRows: by their slots' order).
  const offline = [...inputs.offlineModules]
    .filter(([typeID, flagID]) => MODULE_SLOT_FLAGS.includes(flagID) && [CATEGORY_MODULE, CATEGORY_STRUCTURE_MODULE].includes(staticData.types[typeID]?.categoryID ?? -1))
    .sort(([, left], [, right]) => MODULE_SLOT_FLAGS.indexOf(left) - MODULE_SLOT_FLAGS.indexOf(right));
  if (offline.length > 0) {
    found.set(WARNING.OFFLINE_MODULES, { flags: offline.map(([, flagID]) => flagID), rows: offline.map(([typeID, flagID]) => ({ kind: "module", typeID, flagID })) });
  }
  // GetPolarizedWeapons: the fitted modules with a resistance killer's effect.
  const polarized = fittedModules.filter(([typeID]) =>
    hasEffect(staticData, typeID, EFFECT_RESISTANCE_KILLER_HULL_ALL) || hasEffect(staticData, typeID, EFFECT_RESISTANCE_KILLER_SHIELD_ARMOR_ALL));
  if (polarized.length > 0) found.set(WARNING.POLARIZED_WEAPONS, { flags: polarized.map(([, flagID]) => flagID), rows: [] });

  // FindUndersizedPropMod: not a freighter; each fitted module with a speedBoostFactor, the hull's mass over it above
  // MASS_SPEEDBOOST_MAX_RATIO (the type's figures).
  if (shipType?.groupID !== GROUP_FREIGHTER) {
    const mass = typeAttribute(staticData, shipTypeID, ATTRIBUTE_MASS);
    const undersized = fittedModules.filter(([typeID]) => {
      const boostFactor = typeAttribute(staticData, typeID, ATTRIBUTE_SPEED_BOOST_FACTOR);
      return boostFactor !== null && mass !== null && mass / boostFactor > MASS_SPEEDBOOST_MAX_RATIO;
    });
    if (undersized.length > 0) found.set(WARNING.UNDERSIZED_PROP_MOD, { flags: undersized.map(([, flagID]) => flagID), rows: [] });
  }
  // FindInefficientPropMod: a freighter's fitted propulsion modules.
  if (shipType?.groupID === GROUP_FREIGHTER) {
    const inefficient = fittedModules.filter(([typeID]) => staticData.types[typeID]?.groupID === GROUP_PROPULSION_MODULE);
    if (inefficient.length > 0) found.set(WARNING.INEFFICIENT_PROP_MOD, { flags: inefficient.map(([, flagID]) => flagID), rows: [] });
  }
  // FindModsDisablingBubbleImmunity: of the items fitted to the ship, those with a warpBubbleImmuneModifier, where the
  // hull is immune; with an interdiction nullifier fitted, those and the nullifiers.
  const nullifiers = inputs.fittedItems.filter(([typeID]) => staticData.types[typeID]?.groupID === GROUP_INTERDICTION_NULLIFIER);
  const disabling = inputs.fittedItems.filter(([typeID]) => typeAttribute(staticData, typeID, ATTRIBUTE_WARP_BUBBLE_IMMUNE_MODIFIER) !== null);
  const immuneHull = typeAttribute(staticData, shipTypeID, ATTRIBUTE_WARP_BUBBLE_IMMUNE);
  const bubbleWarned = immuneHull && disabling.length > 0 ? disabling : nullifiers.length > 0 && disabling.length > 0 ? [...disabling, ...nullifiers] : [];
  if (bubbleWarned.length > 0) found.set(WARNING.DISABLED_BUBBLE_IMMUNITY, { flags: bubbleWarned.map(([, flagID]) => flagID), rows: [] });

  return TOOLTIP_ORDER.flatMap((warningID) => {
    const warning = found.get(warningID);
    return warning ? [{ warningID, level: WARNINGS_BY_ID[warningID]!.level, ...warning }] : [];
  });
}

/** GetActiveWarningsByLevelFromResults: how many warnings at each level. */
export function warningsByLevel(warnings: readonly FitWarning[]): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const warning of warnings) counts.set(warning.level, (counts.get(warning.level) ?? 0) + 1);
  return counts;
}

/** The effects and attributes the warnings ask of a type, to read with the static data. */
export const WARNING_EFFECTS: readonly number[] = [EFFECT_LAUNCHER_FITTED, EFFECT_RESISTANCE_KILLER_HULL_ALL, EFFECT_RESISTANCE_KILLER_SHIELD_ARMOR_ALL];
export const WARNING_ATTRIBUTES: readonly number[] = [ATTRIBUTE_CHARGE_SIZE, ATTRIBUTE_TECH_LEVEL];
