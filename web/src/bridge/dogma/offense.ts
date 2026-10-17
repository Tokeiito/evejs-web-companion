// The Fitting window's offense (shipfitting/fittingDogmaLocationUtil.py GetFittedItemsByFlag, GetTurretMissileAndAoeDps,
// GetAlphaStrike and their helpers): the damage the ship's weapons do a second, with and without reloading, and in
// one volley.
//
//   the weapons      each fitted item: a turret (effectTurretFitted), a launcher (effectLauncherFitted or
//                    effectUseMissiles; a damage-over-time one of its own group), a charge, or an area weapon
//                    (empFieldRange); those the calculation includes (IsModuleIncludedInCalculation)
//   per shot         a turret: its charge's damage (or its own, with none) times its damageMultiplier, and at most
//                    its spool's top (GetMaxDamageMultiplier); a launcher: its charge's damage times the pilot's
//                    missileDamageMultiplier (1 for a bomb launcher), nothing without a charge; a damage-over-time
//                    launcher: its charge's top damage a tick times its multiplier; an area weapon: its own damage
//   a second         per shot over the rate of fire; with reloading, the shots a load holds over their time and the
//                    reload (or a shot over its cycle and reactivation delay, where the delay is the longer); an
//                    area weapon's damage over its duration
//   the total        turrets (at the top of their spool, where it differs) + missiles + area + damage over time
//
// The client reads the rate of fire, multipliers and reload of its own ship from godma
// (GetTurretMissileAndAoeDps: GetGodmaAttributeValue where godma holds the ship), and each damage from its dogma
// location (GetDamageFromItem: GetAccurateAttributeValue). The caller gives both readings.

import type { DogmaItem, DogmaLocation } from "./location.ts";

const EFFECT_TURRET_FITTED = 42;
const EFFECT_LAUNCHER_FITTED = 40;
const EFFECT_USE_MISSILES = 101;
const ATTRIBUTE_EMP_FIELD_RANGE = 99;
const ATTRIBUTE_RATE_OF_FIRE = 51;
const ATTRIBUTE_DAMAGE_MULTIPLIER = 64;
const ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER = 212;
const ATTRIBUTE_DOT_MAX_DAMAGE_PER_TICK = 5736;
const ATTRIBUTE_DURATION = 73;
const ATTRIBUTE_RELOAD_TIME = 1795;
const ATTRIBUTE_MODULE_REACTIVATION_DELAY = 669;
const ATTRIBUTE_CAPACITY = 38;
const ATTRIBUTE_VOLUME = 161;
/** DAMAGE_ATTRIBUTES: EM, explosive, kinetic, thermal. */
const DAMAGE_ATTRIBUTES = [114, 116, 117, 118] as const;
const CATEGORY_CHARGE = 8;
const GROUP_MISSILE_LAUNCHER_DOT = 4807;
const GROUP_MISSILE_LAUNCHER_BOMB = 862;
/** carbon/common/lib/const.py FLOAT_TOLERANCE, which FloatCloseEnough goes by. */
const FLOAT_TOLERANCE = 0.001;

/** How the client reads what the offense is reckoned from. */
export interface OffenseReadings {
  /** GetAccurateAttributeValue: the dogma location's own value (docked), or godma's (the client's ship in space). */
  readonly accurate: (item: DogmaItem, attributeID: number) => number;
  /** GetTurretMissileAndAoeDps' GAV: godma's value where godma holds the ship, the dogma location's otherwise. */
  readonly gav: (item: DogmaItem, attributeID: number) => number;
  /** IsModuleIncludedInCalculation: online for the ship itself, active in a simulation. */
  readonly included: (item: DogmaItem) => boolean;
  /** GetMaxDamageMultiplier: 1 for the ship itself; 1 + damageMultiplierBonusMax in a simulation. */
  readonly maxDamageMultiplier: (item: DogmaItem) => number;
}

/** GetTurretMissileAndAoeDps' KeyVal, and GetAlphaStrike. */
export interface OffenseReading {
  readonly turretDps: number;
  readonly turretDpsWithReload: number;
  /** null where it is the same as turretDps (FloatCloseEnough). */
  readonly maxTurretDps: number | null;
  readonly maxTurretDpsWithReload: number | null;
  readonly missileDps: number;
  readonly missileDpsWithReload: number;
  readonly aoeDps: number;
  readonly dotDps: number;
  readonly totalDps: number;
  readonly totalDpsWithReload: number;
  readonly alphaStrike: number;
}

interface WeaponsByFlag {
  readonly charges: Map<number, DogmaItem>;
  readonly launchers: Map<number, DogmaItem>;
  readonly turrets: Map<number, DogmaItem>;
  readonly aoe: Map<number, DogmaItem>;
  readonly dotLaunchers: Map<number, DogmaItem>;
}

/** GetFittedItemsByFlag */
function fittedItemsByFlag(location: DogmaLocation, ship: DogmaItem, readings: OffenseReadings): WeaponsByFlag {
  const has = (item: DogmaItem, effectID: number): boolean => (location.static.types[item.typeID]?.effects ?? []).includes(effectID);
  const found: WeaponsByFlag = { charges: new Map(), launchers: new Map(), turrets: new Map(), aoe: new Map(), dotLaunchers: new Map() };
  for (const item of ship.fitted.values()) {
    const flagID = item.flagID ?? -1;
    if (has(item, EFFECT_TURRET_FITTED)) {
      if (readings.included(item)) found.turrets.set(flagID, item);
    } else if (has(item, EFFECT_LAUNCHER_FITTED) || has(item, EFFECT_USE_MISSILES)) {
      if (!readings.included(item)) continue;
      if (item.groupID === GROUP_MISSILE_LAUNCHER_DOT) found.dotLaunchers.set(flagID, item);
      else found.launchers.set(flagID, item);
    } else if (item.categoryID === CATEGORY_CHARGE) {
      found.charges.set(flagID, item);
    } else if (readings.accurate(item, ATTRIBUTE_EMP_FIELD_RANGE)) {
      if (readings.included(item)) found.aoe.set(flagID, item);
    }
  }
  return found;
}

/** GetDamageFromItem: the item's four damages added. */
function damageFrom(readings: OffenseReadings, item: DogmaItem): number {
  let damage = 0;
  for (const attributeID of DAMAGE_ATTRIBUTES) damage += readings.accurate(item, attributeID);
  return damage;
}

/** GetNumChargesFullyLoaded */
function chargesFullyLoaded(readings: OffenseReadings, gav: OffenseReadings["gav"], charge: DogmaItem, weapon: DogmaItem): number {
  const capacity = gav(weapon, ATTRIBUTE_CAPACITY);
  const volume = gav(charge, ATTRIBUTE_VOLUME);
  return volume ? Math.trunc(capacity / volume) : 0;
}

/** _GetDpsWithReload */
function dpsWithReload(readings: OffenseReadings, gav: OffenseReadings["gav"], charge: DogmaItem | null, weapon: DogmaItem, damagePerShot: number, duration: number): number {
  if (charge === null) return damagePerShot / duration;
  const reloadTime = gav(weapon, ATTRIBUTE_RELOAD_TIME);
  const reactivationDelay = gav(weapon, ATTRIBUTE_MODULE_REACTIVATION_DELAY);
  const shots = chargesFullyLoaded(readings, gav, charge, weapon);
  if (reactivationDelay > reloadTime) return damagePerShot / (reactivationDelay + duration);
  if (shots) return (shots * damagePerShot) / (shots * duration + reloadTime);
  return 0;
}

/** _GetTurretDamagePerShot */
function turretDamagePerShot(readings: OffenseReadings, gav: OffenseReadings["gav"], charge: DogmaItem | null, turret: DogmaItem, getMaxValue: boolean): number {
  let damage = damageFrom(readings, charge ?? turret);
  if (damage > 0) {
    let multiplier = gav(turret, ATTRIBUTE_DAMAGE_MULTIPLIER);
    if (getMaxValue) multiplier *= readings.maxDamageMultiplier(turret);
    damage *= multiplier;
  }
  return damage;
}

/** GetTurretDps: (dps, dps with reload), a second. */
function turretDps(readings: OffenseReadings, gav: OffenseReadings["gav"], charge: DogmaItem | null, turret: DogmaItem, getMaxValue: boolean): [number, number] {
  let dps = 0;
  let withReload = 0;
  const damagePerShot = turretDamagePerShot(readings, gav, charge, turret, getMaxValue);
  if (Math.abs(damagePerShot) > 0) {
    const duration = gav(turret, ATTRIBUTE_RATE_OF_FIRE);
    if (Math.abs(duration) > 0) {
      dps = damagePerShot / duration;
      withReload = dpsWithReload(readings, gav, charge, turret, damagePerShot, duration);
    }
  }
  return [dps * 1000, withReload * 1000];
}

/** GetMissleDamageMultiplier */
function missileDamageMultiplier(gav: OffenseReadings["gav"], launcher: DogmaItem, pilot: DogmaItem): number {
  return launcher.groupID === GROUP_MISSILE_LAUNCHER_BOMB ? 1 : gav(pilot, ATTRIBUTE_MISSILE_DAMAGE_MULTIPLIER);
}

/** _GetLauncherDamagePerShot */
function launcherDamagePerShot(readings: OffenseReadings, gav: OffenseReadings["gav"], charge: DogmaItem | null, launcher: DogmaItem, pilot: DogmaItem): number {
  if (charge === null) return 0;
  return damageFrom(readings, charge) * missileDamageMultiplier(gav, launcher, pilot);
}

/** GetDotDps */
function dotDps(gav: OffenseReadings["gav"], charge: DogmaItem | null, launcher: DogmaItem): number {
  if (charge === null) return 0;
  return gav(charge, ATTRIBUTE_DOT_MAX_DAMAGE_PER_TICK) * gav(launcher, ATTRIBUTE_DAMAGE_MULTIPLIER);
}

/** GetTurretMissileAndAoeDps and GetAlphaStrike, off the dogma location. */
export function offense(location: DogmaLocation, ship: DogmaItem, pilot: DogmaItem, readings: OffenseReadings): OffenseReading {
  const weapons = fittedItemsByFlag(location, ship, readings);
  const gav = readings.gav;
  const turretSums = (getMaxValue: boolean): [number, number] => {
    let dps = 0;
    let withReload = 0;
    for (const [flagID, turret] of weapons.turrets) {
      const [one, oneWithReload] = turretDps(readings, gav, weapons.charges.get(flagID) ?? null, turret, getMaxValue);
      dps += one;
      withReload += oneWithReload;
    }
    return [dps, withReload];
  };
  const [turret, turretWithReload] = turretSums(false);
  let [maxTurret, maxTurretWithReload]: [number | null, number | null] = turretSums(true);
  if (maxTurret && Math.abs(turret - maxTurret) < FLOAT_TOLERANCE) {
    maxTurret = null;
    maxTurretWithReload = null;
  }
  let missile = 0;
  let missileWithReload = 0;
  for (const [flagID, launcher] of weapons.launchers) {
    const charge = weapons.charges.get(flagID) ?? null;
    if (charge === null) continue;
    const damagePerShot = launcherDamagePerShot(readings, gav, charge, launcher, pilot);
    const duration = gav(launcher, ATTRIBUTE_RATE_OF_FIRE);
    missile += (damagePerShot / duration) * 1000;
    missileWithReload += dpsWithReload(readings, gav, charge, launcher, damagePerShot, duration) * 1000;
  }
  let dot = 0;
  for (const [flagID, launcher] of weapons.dotLaunchers) {
    const charge = weapons.charges.get(flagID) ?? null;
    if (charge === null) continue;
    dot += dotDps(gav, charge, launcher);
  }
  let aoe = 0;
  for (const weapon of weapons.aoe.values()) {
    const duration = gav(weapon, ATTRIBUTE_DURATION);
    if (!duration) continue;
    aoe += damageFrom(readings, weapon) / duration;
  }
  aoe *= 1000;
  // GetAlphaStrike: every weapon's shot, read off the dogma location (GetAccurateAttributeValue throughout).
  const accurate = readings.accurate;
  let alpha = 0;
  for (const [flagID, launcher] of weapons.launchers) alpha += launcherDamagePerShot(readings, accurate, weapons.charges.get(flagID) ?? null, launcher, pilot);
  for (const [flagID, turretItem] of weapons.turrets) alpha += turretDamagePerShot(readings, accurate, weapons.charges.get(flagID) ?? null, turretItem, false);
  for (const [flagID, launcher] of weapons.dotLaunchers) alpha += dotDps(accurate, weapons.charges.get(flagID) ?? null, launcher);
  for (const weapon of weapons.aoe.values()) alpha += damageFrom(readings, weapon);
  return {
    turretDps: turret,
    turretDpsWithReload: turretWithReload,
    maxTurretDps: maxTurret,
    maxTurretDpsWithReload: maxTurretWithReload,
    missileDps: missile,
    missileDpsWithReload: missileWithReload,
    aoeDps: aoe,
    dotDps: dot,
    totalDps: (maxTurret || turret) + missile + aoe + dot,
    totalDpsWithReload: (maxTurretWithReload || turretWithReload) + missileWithReload + aoe + dot,
    alphaStrike: alpha,
  };
}
