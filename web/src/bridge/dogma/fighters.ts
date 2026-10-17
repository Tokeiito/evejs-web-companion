// Fighters as the client reckons them in its Fitting window: their classes, squadron sizes and the ship's tubes for
// each class (fighters/__init__.py, fighters/client/__init__.py), and the damage of the squadrons in the tubes
// (shipfitting/fittingDogmaLocationUtil.py GetFighterDamage and the functions under it; fighters/abilityAttributes.py).
// The tables below are the client's, as its compiled abilityAttributes and dogma const give them (run through the
// python27 oracle); each fighter type's ability slots are its data's (fighterAbilitiesByType.static, the BFF's
// /api/client-data/fighter-abilities).

import { intDictOrder } from "../py27DictOrder.ts";
import type { DogmaItem, DogmaLocation } from "./location.ts";

/** inventorycommon/const.py fighterTubeFlags, and the fighter bay's flag. */
export const FIGHTER_TUBE_FLAGS: readonly number[] = [159, 160, 161, 162, 163];
export const FLAG_FIGHTER_BAY = 158;

/** dogma/const.py: a fighter type's squadron size, the ship's tubes and its fighter bay's capacity. */
export const ATTRIBUTE_FIGHTER_SQUADRON_MAX_SIZE = 2215;
export const ATTRIBUTE_FIGHTER_TUBES = 2216;
export const ATTRIBUTE_FIGHTER_CAPACITY = 2055;

/**
 * fighters/__init__.py fighterClassByDogmaAttribute (a fighter's class by the attribute that marks it, in the dict's
 * order) and shipTubeCountAttributeByFighterClass (the ship's attribute that says how many of the class it may have in
 * its tubes).
 */
const CLASS_BY_ATTRIBUTE: ReadonlyMap<number, string> = new Map([
  [2212, "light"], [2213, "support"], [2214, "heavy"], [2740, "standupLight"], [2741, "standupSupport"], [2742, "standupHeavy"],
]);
export const TUBE_COUNT_ATTRIBUTE_BY_CLASS: Readonly<Record<string, number>> = {
  light: 2217, support: 2218, heavy: 2219, standupLight: 2737, standupSupport: 2738, standupHeavy: 2739,
};

/** fighters/abilityAttributes.py dogmaEffectByAbilityID: each ability's dogma effect. */
const EFFECT_BY_ABILITY: Readonly<Record<number, number>> = {
  1: 6430, 2: 6435, 3: 6419, 4: 6441, 5: 6442, 6: 6420, 7: 6485, 9: 6440, 10: 6436, 11: 6434, 12: 6437, 13: 6439, 14: 6431,
  16: 6464, 17: 6465, 18: 6431, 19: 6431, 20: 6431, 21: 6431, 22: 6465, 23: 6465, 24: 6465, 25: 6465, 26: 6465, 27: 6465,
  29: 6431, 30: 6431, 31: 6431, 32: 6431, 33: 6431, 34: 6431, 35: 6431, 36: 6431, 38: 6554, 44: 6465, 45: 6465,
};
/** infoAttributesByDogmaEffect: each effect's attributes, in the list's order (its damage attributes among them). */
const INFO_ATTRIBUTES_BY_EFFECT: Readonly<Record<number, readonly number[]>> = {
  6419: [], 6420: [], 6421: [], 6430: [2179, 2171, 2174, 2173, 2172], 6431: [2125, 2126, 2127, 2128, 2131, 2134, 2133, 2132],
  6434: [2211], 6435: [2184], 6436: [2205], 6437: [2246, 2247, 2248, 2249], 6439: [2225, 2224, 2118, 2119, 2120, 2121], 6440: [2151],
  6441: [2152, 2153], 6464: [2242], 6465: [2234, 2235, 2231, 2232, 2227, 2230, 2229, 2228],
};
/** damageMultiplierByAbilityID: the attribute each damaging ability's damage is multiplied by. */
const DAMAGE_MULTIPLIER_BY_ABILITY: Readonly<Record<number, number>> = {
  1: 2178, 14: 2130, 17: 2226, 18: 2130, 19: 2130, 20: 2130, 21: 2130, 22: 2226, 23: 2226, 24: 2226, 25: 2226, 26: 2226, 27: 2226,
  29: 2130, 30: 2130, 31: 2130, 32: 2130, 33: 2130, 34: 2130, 35: 2130, 36: 2130, 44: 2226, 45: 2226,
};
/** FIGHTER_DAMAGE_ATTRIBUTES: the turret's, the attack missile's and the missiles' four kinds of damage. */
const FIGHTER_DAMAGE_ATTRIBUTES: ReadonlySet<number> = new Set([2171, 2174, 2173, 2172, 2227, 2230, 2229, 2228, 2131, 2134, 2133, 2132]);
/** fittingDogmaLocationUtil.DURATION_ATTRIBUTES: the attack missile's, the missiles' and the attack turret's durations. */
const DURATION_ATTRIBUTES: ReadonlySet<number> = new Set([2233, 2182, 2177]);
/** fighters ABILITY_SLOT_0 and ABILITY_SLOT_2: the primary and secondary attack. */
const ABILITY_SLOT_PRIMARY = 0;
const ABILITY_SLOT_SECONDARY = 2;

/** A fighter type's ability slot (fighterAbilitiesByType): its ability. */
export interface FighterAbilitySlot {
  readonly abilityID: number;
  readonly cooldownSeconds: number | null;
  readonly chargeCount: number | null;
  readonly rearmTimeSeconds: number | null;
}
/** Each fighter type's three slots, null where a slot or the type has none. */
export type FighterAbilities = (typeID: number) => readonly (FighterAbilitySlot | null)[] | null;

function typeAttribute(location: DogmaLocation, typeID: number, attributeID: number): number {
  return location.static.types[typeID]?.attributes.find(([id]) => id === attributeID)?.[1] ?? 0;
}

/** fighters.GetMaxSquadronSize: int of the type's fighterSquadronMaxSize. */
export function maxSquadronSize(location: DogmaLocation, typeID: number): number {
  return Math.trunc(typeAttribute(location, typeID, ATTRIBUTE_FIGHTER_SQUADRON_MAX_SIZE));
}

/** fighters.client.GetFighterClass: the class of the first of the marking attributes the type has set; null with none. */
export function fighterClass(location: DogmaLocation, typeID: number): string | null {
  for (const attributeID of intDictOrder([...CLASS_BY_ATTRIBUTE.keys()])) {
    if (typeAttribute(location, typeID, attributeID)) return CLASS_BY_ATTRIBUTE.get(attributeID) ?? null;
  }
  return null;
}

/** The squadrons in the tubes (fighters_util.GetFightersInTubes: GetFightersForTube of each tube flag, in their order). */
export function fightersInTubes(ship: DogmaItem): DogmaItem[] {
  const byFlag = new Map<number, DogmaItem>();
  for (const fighter of ship.fighters.values()) if (fighter.flagID !== null && FIGHTER_TUBE_FLAGS.includes(fighter.flagID)) byFlag.set(fighter.flagID, fighter);
  return FIGHTER_TUBE_FLAGS.flatMap((flag) => byFlag.get(flag) ?? []);
}

/**
 * GetDamageFromFighter (534 to 557): the ability's damage multiplier (none: no damage); its damage attributes added up,
 * each times the multiplier, a duration attribute among its attributes taken for the duration, else its effect's
 * duration attribute (GetAbilityDurationAttributeID); the damage, and a second's of it (1000 over the duration in ms).
 */
function damageFromFighter(location: DogmaLocation, fighter: DogmaItem, abilityID: number, accurate: (item: DogmaItem, attributeID: number) => number): { readonly damage: number; readonly dps: number } {
  const multiplierAttributeID = DAMAGE_MULTIPLIER_BY_ABILITY[abilityID];
  if (multiplierAttributeID === undefined) return { damage: 0, dps: 0 };
  const multiplier = accurate(fighter, multiplierAttributeID);
  const effectID = EFFECT_BY_ABILITY[abilityID];
  const abilityAttributeIDs = effectID === undefined ? [] : INFO_ATTRIBUTES_BY_EFFECT[effectID] ?? [];
  let durationAttributeID = effectID === undefined ? null : location.static.effects[effectID]?.durationAttributeID ?? null;
  let damage = 0;
  for (const attributeID of abilityAttributeIDs) {
    if (!FIGHTER_DAMAGE_ATTRIBUTES.has(attributeID)) {
      if (DURATION_ATTRIBUTES.has(attributeID)) durationAttributeID = attributeID;
      continue;
    }
    damage += accurate(fighter, attributeID) * multiplier;
  }
  let dps = 0;
  if (durationAttributeID) {
    const duration = accurate(fighter, durationAttributeID);
    if (duration) dps = damage / duration;
  }
  return { damage, dps: dps * 1000 };
}

/**
 * GetFighterDamage and GetTotalFighterDps (fittingDogmaLocationUtil.py 170 to 173, 480 to 531): each squadron in the
 * tubes, its primary and secondary abilities' damage a second (GetDamageForAbilitySlot), each times its squadron size,
 * added for the tube (dpsByTubeID); the tubes' added up as sum() takes the dict's values, in its order.
 */
export function totalFighterDps(location: DogmaLocation, ship: DogmaItem, abilities: FighterAbilities, accurate: (item: DogmaItem, attributeID: number) => number): number {
  const byTube = new Map<number, number>();
  for (const fighter of fightersInTubes(ship)) {
    const slots = abilities(fighter.typeID) ?? [];
    const dpsOf = (slotID: number): number => {
      const abilityID = slots[slotID]?.abilityID ?? null;
      return abilityID === null ? 0 : fighter.stacksize * damageFromFighter(location, fighter, abilityID, accurate).dps;
    };
    byTube.set(fighter.flagID as number, (byTube.get(fighter.flagID as number) ?? 0) + (dpsOf(ABILITY_SLOT_PRIMARY) + dpsOf(ABILITY_SLOT_SECONDARY)));
  }
  let total = 0;
  for (const flagID of intDictOrder([...byTube.keys()])) total += byTube.get(flagID) ?? 0;
  return total;
}

/** GetFullAndPartialSquadrons (581 to 597): the squadrons in the tubes at their full size, and those short of it. */
export function fullAndPartialSquadrons(location: DogmaLocation, ship: DogmaItem): { readonly full: number; readonly partial: number } {
  let full = 0;
  let partial = 0;
  for (const fighter of fightersInTubes(ship)) {
    if (!fighter.stacksize) continue;
    if (fighter.stacksize < maxSquadronSize(location, fighter.typeID)) partial += 1;
    else full += 1;
  }
  return { full, partial };
}
