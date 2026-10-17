// The Fitting window's drones (shipfitting/droneUtil.py, and clientDogmaLocation's GatherDroneInfo,
// SimpleGetDroneDamageOutput, GetOptimalDroneDamage and _FindDronesInBayForActive): which drones count as active, the
// damage they do a second, and the bandwidth they use.
//
//   the active drones     the client's own ship: those out in space; with none out, the best set from the drone bay
//                         (_FindDronesInBayForActive): the bay's drones by type, each type's bandwidth (a whole
//                         number), damage a second and count, the largest bandwidth first and within one the most
//                         damage first, as many as the bandwidth and the pilot's maxActiveDrones allow
//                         (SimpleGetDroneDamageOutput), and those types' stacks taken in turn. A simulation: those
//                         the pilot has selected (SelectedDroneTracker).
//   their damage          droneUtil.GetOptimalDroneDamage: each active stack's damage times its count, times its
//                         damageMultiplier, over its rate of fire; taken a stack at a time while the bandwidth and
//                         the active drones last (GetSimpleGetDroneDamageOutput)
//   their bandwidth       each stack's droneBandwidthUsed times its count, and the ship's droneBandwidth
//
// Python 2's division of whole numbers is the floor (int(bwLeft) / int(bwNeeded)).

import type { DogmaItem, DogmaLocation } from "./location.ts";

const ATTRIBUTE_DAMAGE_MULTIPLIER = 64;
const ATTRIBUTE_RATE_OF_FIRE = 51;
const ATTRIBUTE_DRONE_BANDWIDTH = 1271;
const ATTRIBUTE_DRONE_BANDWIDTH_USED = 1272;
const ATTRIBUTE_MAX_ACTIVE_DRONES = 352;
/** DAMAGE_ATTRIBUTES: EM, explosive, kinetic, thermal. */
const DAMAGE_ATTRIBUTES = [114, 116, 117, 118] as const;

/** How the client reads what the drones are reckoned from. */
export interface DroneReadings {
  /** GetAccurateAttributeValue: docked, the location's own. */
  readonly accurate: (item: DogmaItem, attributeID: number) => number;
  /** The location's GetAttributeValue. */
  readonly value: (item: DogmaItem, attributeID: number) => number;
}

/** Python 2's int(a) / int(b) for whole numbers: the floor. */
function pyIntDivide(left: number, right: number): number {
  return Math.floor(Math.trunc(left) / Math.trunc(right));
}

/** GetDamageFromItem */
function damageFrom(readings: DroneReadings, item: DogmaItem): number {
  let damage = 0;
  for (const attributeID of DAMAGE_ATTRIBUTES) damage += readings.accurate(item, attributeID);
  return damage;
}

/** clientDogmaLocation.GatherDroneInfo: the bay's drones by bandwidth, each list the most damage first. */
function bayDronesByBandwidth(ship: DogmaItem, readings: DroneReadings): Map<number, [number, number, number, number][]> {
  const byType = new Map<number, [number, number, number]>();
  for (const drone of ship.drones.values()) {
    const damage = damageFrom(readings, drone);
    if (damage === 0) continue;
    const multiplier = readings.value(drone, ATTRIBUTE_DAMAGE_MULTIPLIER);
    if (multiplier === 0) continue;
    const duration = readings.value(drone, ATTRIBUTE_RATE_OF_FIRE);
    const dps = (damage * multiplier) / duration;
    const bandwidth = readings.value(drone, ATTRIBUTE_DRONE_BANDWIDTH_USED);
    const held = byType.get(drone.typeID);
    if (!held) byType.set(drone.typeID, [bandwidth, dps, drone.stacksize]);
    else held[2] += drone.stacksize;
  }
  const byBandwidth = new Map<number, [number, number, number, number][]>();
  for (const [typeID, [bandwidth, dps, quantity]] of byType) {
    const whole = Math.trunc(bandwidth);
    const list = byBandwidth.get(whole) ?? [];
    list.push([typeID, whole, quantity, dps]);
    byBandwidth.set(whole, list);
  }
  for (const list of byBandwidth.values()) list.sort((left, right) => right[3] - left[3]);
  return byBandwidth;
}

/** clientDogmaLocation.SimpleGetDroneDamageOutput: (total dps, drones used by type). */
function simpleDroneDamageOutput(drones: Map<number, [number, number, number, number][]>, bandwidthLeft: number, dronesLeft: number): [number, Map<number, number>] {
  const used = new Map<number, number>();
  let total = 0;
  let left = bandwidthLeft;
  let count = dronesLeft;
  for (const bandwidth of [...drones.keys()].sort((a, b) => b - a)) {
    if (bandwidth > left) continue;
    for (const [typeID, needed, quantity, dps] of drones.get(bandwidth) ?? []) {
      const drones = Math.min(pyIntDivide(left, needed), quantity, count);
      if (drones === 0) break;
      used.set(typeID, drones);
      total += dps * drones;
      count -= drones;
      left -= drones * needed;
    }
  }
  return [total, used];
}

/**
 * clientDogmaLocation.GetActiveDrones for the client's own ship docked, which has none out: the best set from the bay
 * (_FindDronesInBayForActive over GetOptimalDroneDamage), each stack and how many of it.
 */
export function bayActiveDrones(ship: DogmaItem, pilot: DogmaItem, readings: DroneReadings): Map<DogmaItem, number> {
  const [, typesToUse] = simpleDroneDamageOutput(
    bayDronesByBandwidth(ship, readings),
    readings.value(ship, ATTRIBUTE_DRONE_BANDWIDTH),
    readings.value(pilot, ATTRIBUTE_MAX_ACTIVE_DRONES),
  );
  const byType = new Map<number, DogmaItem[]>();
  for (const drone of ship.drones.values()) {
    const list = byType.get(drone.typeID) ?? [];
    list.push(drone);
    byType.set(drone.typeID, list);
  }
  const active = new Map<DogmaItem, number>();
  for (const [typeID, needed] of typesToUse) {
    let current = 0;
    for (const drone of byType.get(typeID) ?? []) {
      const take = Math.min(needed - current, drone.stacksize);
      active.set(drone, take);
      current += take;
      if (current >= needed) break;
    }
  }
  return active;
}

/** droneUtil.GetOptimalDroneDamage: the active drones' damage a second. */
export function activeDroneDps(ship: DogmaItem, readings: DroneReadings, active: ReadonlyMap<DogmaItem, number>, maxActiveDrones: number): number {
  const info: [number, number][] = [];
  for (const [drone, quantity] of active) {
    let damage = damageFrom(readings, drone);
    if (damage === 0) continue;
    damage *= quantity;
    const multiplier = readings.accurate(drone, ATTRIBUTE_DAMAGE_MULTIPLIER);
    if (multiplier === 0) continue;
    const duration = readings.accurate(drone, ATTRIBUTE_RATE_OF_FIRE);
    const dps = (damage * multiplier) / duration;
    const bandwidth = readings.accurate(drone, ATTRIBUTE_DRONE_BANDWIDTH_USED) * quantity;
    info.push([bandwidth, dps]);
  }
  // GetSimpleGetDroneDamageOutput: a stack at a time, one apiece.
  let left = readings.value(ship, ATTRIBUTE_DRONE_BANDWIDTH);
  let count = maxActiveDrones;
  let total = 0;
  for (const [needed, dps] of info) {
    const drones = Math.min(pyIntDivide(left, needed), 1, count);
    if (drones === 0) break;
    total += dps;
    count -= 1;
    left -= needed;
  }
  return total * 1000;
}

/** droneUtil.GetDroneBandwidth: (the bandwidth the active drones use, the ship's). */
export function activeDroneBandwidth(ship: DogmaItem, readings: DroneReadings, active: ReadonlyMap<DogmaItem, number>): { readonly used: number; readonly ship: number } {
  let used = 0;
  for (const [drone, quantity] of active) used += quantity * readings.value(drone, ATTRIBUTE_DRONE_BANDWIDTH_USED);
  return { used, ship: readings.value(ship, ATTRIBUTE_DRONE_BANDWIDTH) };
}

/** The drone panel's figures, and the drones' share of the offense's total. */
export interface DroneReading {
  /** controller._GetActiveDronesNum. */
  readonly activeDrones: number;
  readonly bandwidthUsed: number;
  /** GetDroneDps. */
  readonly dps: number;
}

/**
 * The drone panel for the client's own ship (clientDogmaLocation.GetActiveDrones): its drones out in space, one each;
 * with none out, the bay's best set; their damage and bandwidth.
 */
export function ownShipDrones(location: DogmaLocation, ship: DogmaItem, pilot: DogmaItem, readings: DroneReadings, inSpace: readonly DogmaItem[]): DroneReading {
  void location;
  const active = inSpace.length > 0 ? new Map<DogmaItem, number>(inSpace.map((drone) => [drone, 1])) : bayActiveDrones(ship, pilot, readings);
  let count = 0;
  for (const quantity of active.values()) count += quantity;
  return {
    activeDrones: count,
    bandwidthUsed: activeDroneBandwidth(ship, readings, active).used,
    dps: activeDroneDps(ship, readings, active, readings.value(pilot, ATTRIBUTE_MAX_ACTIVE_DRONES)),
  };
}
