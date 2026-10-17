// Simulate Fitting of the pilot's own ship (eve/client/script/ui/shared/fittingScreen/ghostFittingSvc.py
// LoadCurrentShip and _LoadSimulatedShipFromData; shipfitting/droneUtil.py SelectedDroneTracker), on the page's own
// dogma location (location.ts):
//
//   the ship             a ghost of its hull with the pilot's brain (LoadMyShip: loadSimulatedShip), no instance rows
//   its modules          fitted in their slots, the highest slot first (fitData.sort), then the rigs activated, every
//                        module online, then every module activated (_ActivateOnLoading: moduleStates.ts)
//   its drones           each one fitted alone while the drone bay has room for it (FitADroneToShip,
//                        FitItemOrDroneToShip: GetCapacity, each drone's volume), then selected the most damage
//                        first (RegisterTopDpsDrones, GetDronesInDamgeAmountOrder: the damage multiplier times the sum
//                        of its distinct damages) while fewer than max(5, the pilot's maxActiveDrones) are and the
//                        bandwidth lasts (RegisterDroneAsActive)
//   its charges          loaded in their modules' slots after (FitAmmoList)
//
// The drones' figures are droneUtil's with the selected drones (the Fitting window's GetActiveDrones), and the most
// that may be active is max(5, the pilot's maxActiveDrones) (FittingDogmaLocation.GetMaxActiveDrones).

import { activeDroneBandwidth, activeDroneDps, type DroneReading } from "./drones.ts";
import { loadSimulatedShip, type Brain, type DogmaItem, type DogmaLocation, type DogmaStatic, type SimulatedCharge } from "./location.ts";
import { activateOnLoading } from "./moduleStates.ts";

const ATTRIBUTE_VOLUME = 161;
const ATTRIBUTE_DRONE_CAPACITY = 283;
const ATTRIBUTE_DRONE_BANDWIDTH_USED = 1272;
const ATTRIBUTE_MAX_ACTIVE_DRONES = 352;
const ATTRIBUTE_DAMAGE_MULTIPLIER = 64;
/** EM, thermal, kinetic, explosive. */
const DAMAGE_ATTRIBUTES = [114, 118, 117, 116] as const;

/** A simulated ship: its location, hull and pilot, and the drones selected (SelectedDroneTracker), each with how many. */
export interface SimulatedShip {
  readonly location: DogmaLocation;
  readonly ship: DogmaItem;
  readonly pilot: DogmaItem;
  readonly selectedDrones: Map<DogmaItem, number>;
}

/** A module of the ship as it is fitted: its key, type and slot. */
export interface CurrentModule {
  readonly key: string;
  readonly typeID: number;
  readonly flagID: number;
}

/** FittingDogmaLocation.GetMaxActiveDrones: max(5, the pilot's maxActiveDrones). */
export function simulatedMaxActiveDrones(simulation: SimulatedShip): number {
  return Math.max(5, simulation.location.value(simulation.pilot, ATTRIBUTE_MAX_ACTIVE_DRONES));
}

/**
 * SelectedDroneTracker.RegisterDroneAsActive, its errors not raised: the drone selected where fewer than the most that
 * may be active are, and the bandwidth it takes is left.
 */
function registerDrone(simulation: SimulatedShip, drone: DogmaItem, quantity = 1): boolean {
  let selected = 0;
  for (const count of simulation.selectedDrones.values()) selected += count;
  if (selected >= Math.max(simulatedMaxActiveDrones(simulation), 5)) return false;
  const value = (item: DogmaItem, attributeID: number): number => simulation.location.value(item, attributeID);
  const { used, ship } = activeDroneBandwidth(simulation.ship, { accurate: value, value }, simulation.selectedDrones);
  if (quantity * value(drone, ATTRIBUTE_DRONE_BANDWIDTH_USED) + used > ship) return false;
  simulation.selectedDrones.set(drone, (simulation.selectedDrones.get(drone) ?? 0) + quantity);
  return true;
}

/** GetDronesInDamgeAmountOrder: the damage multiplier times the sum of the drone's distinct damages, the most first. */
function dronesByDamage(location: DogmaLocation, drones: readonly DogmaItem[]): DogmaItem[] {
  const ranked = drones.map((drone) => {
    const damages = new Set(DAMAGE_ATTRIBUTES.map((attributeID) => location.value(drone, attributeID)));
    let sum = 0;
    for (const damage of damages) sum += damage;
    return { drone, total: location.value(drone, ATTRIBUTE_DAMAGE_MULTIPLIER) * sum };
  });
  // sorted(..., key=data[0], reverse=True): a stable sort, the most first.
  return ranked.sort((left, right) => right.total - left.total).map((entry) => entry.drone);
}

/** LoadCurrentShip: the pilot's own ship simulated as the Fitting window loads it. */
export function simulateCurrentShip(
  staticData: DogmaStatic,
  shipTypeID: number,
  pilot: { readonly characterID: number; readonly typeID: number; readonly securityStatus: number },
  brain: Brain | null,
  modules: readonly CurrentModule[],
  charges: readonly SimulatedCharge[],
  drones: readonly { readonly typeID: number; readonly quantity: number }[],
  clock: () => number,
): SimulatedShip {
  const loaded = loadSimulatedShip(staticData, shipTypeID, pilot, brain, { clock });
  const simulation: SimulatedShip = { ...loaded, selectedDrones: new Map() };
  const { location, ship } = simulation;
  for (const module of [...modules].sort((left, right) => right.flagID - left.flagID)) {
    location.fitModule(ship, module.key, module.typeID, module.flagID);
  }
  activateOnLoading(location, ship);
  // FitDrones: each one alone, while the drone bay has room for it.
  const fitted: DogmaItem[] = [];
  let ghost = 0;
  for (const stack of drones) {
    for (let at = 0; at < stack.quantity; at += 1) {
      let used = 0;
      for (const drone of ship.drones.values()) used += location.value(drone, ATTRIBUTE_VOLUME);
      const volume = staticData.types[stack.typeID]?.attributes.find(([id]) => id === ATTRIBUTE_VOLUME)?.[1] ?? 0;
      if (used + volume > location.value(ship, ATTRIBUTE_DRONE_CAPACITY)) break;
      ghost += 1;
      fitted.push(location.loadDrone(ship, `${ship.key}|drone|${ghost}`, stack.typeID, 1));
    }
  }
  for (const drone of dronesByDamage(location, fitted)) registerDrone(simulation, drone);
  for (const charge of charges) location.loadCharge(ship, charge.flagID, charge.typeID);
  return simulation;
}

/** The drone panel of a simulated ship: the drones selected, the bandwidth they take, their damage a second. */
export function simulatedDrones(simulation: SimulatedShip): DroneReading {
  const value = (item: DogmaItem, attributeID: number): number => simulation.location.value(item, attributeID);
  const readings = { accurate: value, value };
  let count = 0;
  for (const quantity of simulation.selectedDrones.values()) count += quantity;
  return {
    activeDrones: count,
    bandwidthUsed: activeDroneBandwidth(simulation.ship, readings, simulation.selectedDrones).used,
    dps: activeDroneDps(simulation.ship, readings, simulation.selectedDrones, simulatedMaxActiveDrones(simulation)),
  };
}
