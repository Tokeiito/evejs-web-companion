// The Fitting window's defense (eve/client/script/ui/shared/fitting/fittingUtil.py GetDefensiveLayersInfo and
// GetEffectiveHp, ghostControllerMixin.GetPassiveRechargeRate, fittingPanels/defensePanel.py): each layer's hit points
// and resistances, the effective hit points, and what the ship repairs a second.
//
//   the layers          shield, armor and structure: each layer's hit points and its four resonances, as
//                       GetStatsInfo reads them (rounded to ten places)
//   effective hp        each layer's hit points over the mean of its four resonances (a layer whose mean is
//                       nought adds nothing), summed; the panel shows its whole part
//   a resistance        100 less the whole part of the resonance a hundredfold (defensePanel.UpdateGaugesForLayer)
//   shield recharge     its time in whole seconds (SetDefenseLayerText)
//   passive recharge    the whole part of 2.5 times the shield's hit points over its recharge time in seconds
//   the repairers       the shield boosters, the armor and the hull repairers (DATASET_FOR_REPAIRERS), in the order
//                       of the fitting slots (FindModulesAndChargesByGroups), each its repair over its cycle in
//                       seconds, a fueled armor repairer with a charge loaded times its chargedArmorDamageMultiplier
//                       (GetTotalHpPerSec); every one fitted counts on the ship itself (IncludeModuleInHpCalculation),
//                       only an active one in a simulation

import type { DogmaItem, DogmaLocation } from "./location.ts";

export type DefenseLayer = "shield" | "armor" | "structure";

/** The layers' hit points and resonances (em, thermal, kinetic, explosive), by attribute. */
const LAYER_ATTRIBUTES: Readonly<Record<DefenseLayer, { readonly hp: number; readonly em: number; readonly thermal: number; readonly kinetic: number; readonly explosive: number }>> = {
  shield: { hp: 263, em: 271, thermal: 274, kinetic: 273, explosive: 272 },
  armor: { hp: 265, em: 267, thermal: 270, kinetic: 269, explosive: 268 },
  structure: { hp: 9, em: 113, thermal: 110, kinetic: 109, explosive: 111 },
};
const ATTRIBUTE_SHIELD_RECHARGE_RATE = 479;
const ATTRIBUTE_DURATION = 73;
const ATTRIBUTE_CHARGED_ARMOR_DAMAGE_MULTIPLIER = 1886;
const CATEGORY_CHARGE = 8;

/** DATASET_FOR_REPAIRERS: what each kind repairs by, and with a charge, what multiplies it. */
const REPAIRERS = {
  shieldBoost: { groups: [40, 1156], attributeID: 68, chargeMultiplierAttributeID: null },
  armorRepair: { groups: [62, 1199], attributeID: 84, chargeMultiplierAttributeID: ATTRIBUTE_CHARGED_ARMOR_DAMAGE_MULTIPLIER },
  hullRepair: { groups: [63], attributeID: 83, chargeMultiplierAttributeID: null },
} as const;
export type RepairKind = keyof typeof REPAIRERS;

/** inventorycommon/const.py fittingFlags, in its order: the low, medium and high slots, subsystems, rigs, services. */
const FITTING_FLAGS: readonly number[] = [
  ...range(11, 18), ...range(19, 26), ...range(27, 34), ...range(125, 128), ...range(92, 94), ...range(164, 171),
];

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, at) => first + at);
}

/** A kind of repairer's figure: hit points a second and how many there are; null where none is fitted (NoModule). */
export interface RepairRate {
  readonly hpPerSec: number;
  readonly modules: number;
}

export interface DefenseReading {
  /** GetEffectiveHp. */
  readonly effectiveHp: number;
  readonly layers: Readonly<Record<DefenseLayer, {
    readonly hp: number;
    /** The resonances, as read (0 to 1). */
    readonly resonances: { readonly em: number; readonly thermal: number; readonly kinetic: number; readonly explosive: number };
    /** As the panel shows them: 100 - int(resonance * 100). */
    readonly resistances: { readonly em: number; readonly thermal: number; readonly kinetic: number; readonly explosive: number };
  }>>;
  /** The shield's recharge time in whole seconds. */
  readonly shieldRechargeSeconds: number;
  /** GetPassiveRechargeRate. */
  readonly passiveShieldRecharge: number;
  readonly repairs: Readonly<Record<RepairKind, RepairRate | null>>;
}

/** How the client reads what the defense is reckoned from. */
export interface DefenseReadings {
  /** GetStatsInfo: a ship attribute as the location gives it, rounded to ten places. */
  readonly stat: (attributeID: number) => number;
  /** The controller's GetAttribute: a ship attribute as the location gives it. */
  readonly attribute: (attributeID: number) => number;
  /** GetAccurateAttributeValue. */
  readonly accurate: (item: DogmaItem, attributeID: number) => number;
  /** IncludeModuleInHpCalculation: every one on the ship itself; an active one in a simulation. */
  readonly included: (item: DogmaItem) => boolean;
}

/** Python's int(): toward nought. */
function int(value: number): number {
  return Math.trunc(value);
}

/** GetTotalHpPerSec over the repairers of a kind (FindModulesAndChargesByGroups). */
function repairRate(ship: DogmaItem, readings: DefenseReadings, kind: RepairKind): RepairRate | null {
  const repairer = REPAIRERS[kind];
  const modulesByFlag = new Map<number, DogmaItem>();
  const chargesByFlag = new Map<number, DogmaItem>();
  for (const item of ship.fitted.values()) {
    if (item.flagID === null || item === ship) continue;
    if (item.categoryID === CATEGORY_CHARGE) chargesByFlag.set(item.flagID, item);
    else modulesByFlag.set(item.flagID, item);
  }
  const found: [DogmaItem, DogmaItem | null][] = [];
  for (const flagID of FITTING_FLAGS) {
    const module = modulesByFlag.get(flagID);
    if (!module || module.groupID === null || !(repairer.groups as readonly number[]).includes(module.groupID)) continue;
    found.push([module, chargesByFlag.get(flagID) ?? null]);
  }
  if (found.length === 0) return null;
  let total = 0;
  for (const [module, charge] of found) {
    if (!readings.included(module)) continue;
    const duration = readings.accurate(module, ATTRIBUTE_DURATION);
    let hp = readings.accurate(module, repairer.attributeID);
    let multiplier = 1.0;
    if (charge && repairer.chargeMultiplierAttributeID !== null) multiplier = readings.accurate(module, repairer.chargeMultiplierAttributeID);
    hp *= multiplier;
    total += hp / (duration / 1000.0);
  }
  return { hpPerSec: total, modules: found.length };
}

/** The defense panel's figures, off the dogma location. */
export function defense(location: DogmaLocation, ship: DogmaItem, readings: DefenseReadings): DefenseReading {
  void location;
  const layers = {} as Record<DefenseLayer, DefenseReading["layers"][DefenseLayer]>;
  let effectiveHp = 0;
  for (const layer of ["shield", "armor", "structure"] as const) {
    const ids = LAYER_ATTRIBUTES[layer];
    const resonances = {
      em: readings.stat(ids.em),
      thermal: readings.stat(ids.thermal),
      kinetic: readings.stat(ids.kinetic),
      explosive: readings.stat(ids.explosive),
    };
    const hp = readings.stat(ids.hp);
    const average = (resonances.em + resonances.explosive + resonances.kinetic + resonances.thermal) / 4;
    if (average) effectiveHp += hp / average;
    layers[layer] = {
      hp,
      resonances,
      resistances: {
        em: 100 - int(resonances.em * 100),
        thermal: 100 - int(resonances.thermal * 100),
        kinetic: 100 - int(resonances.kinetic * 100),
        explosive: 100 - int(resonances.explosive * 100),
      },
    };
  }
  const shieldCapacity = readings.attribute(LAYER_ATTRIBUTES.shield.hp);
  const shieldRechargeRate = readings.attribute(ATTRIBUTE_SHIELD_RECHARGE_RATE);
  return {
    effectiveHp,
    layers,
    shieldRechargeSeconds: int(readings.stat(ATTRIBUTE_SHIELD_RECHARGE_RATE) * 0.001),
    passiveShieldRecharge: int((2.5 * shieldCapacity) / (shieldRechargeRate / 1000.0)),
    repairs: {
      shieldBoost: repairRate(ship, readings, "shieldBoost"),
      armorRepair: repairRate(ship, readings, "armorRepair"),
      hullRepair: repairRate(ship, readings, "hullRepair"),
    },
  };
}
