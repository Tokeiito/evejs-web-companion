// The Fitting window's capacitor (shipfitting/fittingDogmaLocationUtil.py CapacitorSimulator and RunSimulation, and
// ghostControllerMixin._GetCapSimulatorValues): whether what the ship's modules drain is sustainable, and if not, how
// long the capacitor lasts. Reckoned off the page's own dogma (location.ts), as the client reckons it off its own.
//
//   the modules        each fitted module the calculation includes (IsModuleIncludedInCalculation: online, for the
//                      ship itself; active, in a simulation), by its default effect's cycle (durationAttributeID) and
//                      drain (dischargeAttributeID), less what a capacitor booster injects (its charge's
//                      capacitorBonus, averaged over a load and its reload) or an energy nosferatu draws
//                      (powerTransferAmount); none without a cycle, a drain or (a booster) a charge
//   the need           the sum of each module's drain over its cycle and its reactivation delay, in GJ a millisecond
//   peak recharge      2.5 times the capacity over the recharge time: the capacitor's best rate
//   run out            where the need is over the peak, or within 5% of it: RunSimulation, the capacitor taken down
//                      by each module as it cycles and recharged by the capacitor curve between, to an hour; what is
//                      left after an hour is stable
//   stable at          where it does not run out: the share of the capacity the capacitor settles at, the root of
//                      the recharge curve's equilibrium with the need (loadBalance)
//
// The client's own arithmetic is kept as it is, its units and all: a module's cycle is in milliseconds and made 100ns
// ticks (dgmTauConstant), while its reactivation delay and a booster's reload time are made ticks as if they were
// seconds (const.SEC).

import type { DogmaItem, DogmaLocation } from "./location.ts";

/** const.HOUR, const.SEC (100ns ticks), dogma/const.py dgmTauConstant (ms to ticks). */
const HOUR = 36_000_000_000;
const SEC = 10_000_000;
const TAU_CONSTANT = 10_000;
/** CAP_STABLE_TIME: an hour. */
const CAP_STABLE_TIME = HOUR;

const ATTRIBUTE_CAPACITOR_CAPACITY = 482;
const ATTRIBUTE_RECHARGE_RATE = 55;
const ATTRIBUTE_MODULE_REACTIVATION_DELAY = 669;
const ATTRIBUTE_POWER_TRANSFER_AMOUNT = 90;
const ATTRIBUTE_CAPACITOR_BONUS = 67;
const ATTRIBUTE_RELOAD_TIME = 1795;
const ATTRIBUTE_CAPACITY = 38;
const ATTRIBUTE_VOLUME = 161;
const CATEGORY_CHARGE = 8;
const GROUP_CAPACITOR_BOOSTER = 76;
const GROUP_ENERGY_VAMPIRE = 68;

/** A module as the simulation runs it (the KeyVal CapacitorSimulator makes of each). */
export interface CapacitorModule {
  readonly capNeeded: number;
  /** The drain averaged over a booster's load and reload; the drain itself otherwise. */
  readonly avgCapNeed: number;
  /** The cycle, in milliseconds. */
  readonly duration: number;
  readonly reactivationDelay: number;
  /** A booster's reload: its time and how many charges it holds. */
  readonly reloadInfo: { readonly reloadTime: number; readonly maxChargesInModule: number } | null;
}

/** What CapacitorSimulator answers: (peakRechargeRate, totalCapNeed, loadBalance, TTL). */
export interface CapacitorReading {
  /** GJ a millisecond. */
  readonly peakRechargeRate: number;
  /** GJ a millisecond. */
  readonly totalCapNeed: number;
  /** The share of the capacity it settles at; 0 where it runs out. */
  readonly loadBalance: number;
  /** When it runs out, in 100ns ticks from the start; null where it does not. */
  readonly ttl: number | null;
}

/** Python's long(x): toward nought. */
function long(value: number): number {
  return Math.trunc(value);
}

/** Python 2's round(x, places): halves away from nought. */
export function pyRound(value: number, places: number): number {
  const scale = 10 ** places;
  return (Math.sign(value) * Math.floor(Math.abs(value) * scale + 0.5)) / scale;
}

/** RunSimulation: the capacitor's time to empty, in ticks; CAP_STABLE_TIME where it lasts the hour. */
export function runSimulation(capacitorCapacity: number, rechargeRate: number, modules: readonly CapacitorModule[]): number {
  let capacitor = capacitorCapacity;
  const tauThingy = TAU_CONSTANT * (rechargeRate / 5.0);
  let currentTime = 0;
  let nextTime = 0;
  const running = modules.map((module) => ({
    capNeeded: module.capNeeded,
    durationValue: long(module.duration * TAU_CONSTANT),
    reactivationDelay: module.reactivationDelay,
    reloadInfo: module.reloadInfo,
    nextRun: 0,
    cyclesSinceReload: 0,
  }));
  while (capacitor > 0.0 && nextTime < CAP_STABLE_TIME) {
    capacitor = (1.0 + (Math.sqrt(capacitor / capacitorCapacity) - 1.0) * Math.exp((currentTime - nextTime) / tauThingy)) ** 2 * capacitorCapacity;
    currentTime = nextTime;
    nextTime = CAP_STABLE_TIME;
    for (const data of running) {
      if (data.nextRun === currentTime) {
        capacitor -= data.capNeeded;
        data.cyclesSinceReload += 1;
        if (data.reloadInfo && data.cyclesSinceReload >= data.reloadInfo.maxChargesInModule) {
          data.nextRun += data.reloadInfo.reloadTime * SEC;
          data.cyclesSinceReload = 0;
        }
        if (data.reactivationDelay) data.nextRun += data.reactivationDelay * SEC;
        data.nextRun += data.durationValue;
      }
      nextTime = Math.min(nextTime, data.nextRun);
    }
  }
  return capacitor > 0.0 ? CAP_STABLE_TIME : currentTime;
}

/** CapacitorSimulator's reckoning, from the capacity, the recharge time (ms) and the modules. */
export function simulateCapacitor(capacitorCapacity: number, rechargeTime: number, modules: readonly CapacitorModule[]): CapacitorReading {
  let totalCapNeed = 0;
  for (const module of modules) totalCapNeed += module.avgCapNeed / (module.duration + module.reactivationDelay);
  const rechargeRateAverage = capacitorCapacity / rechargeTime;
  const peakRechargeRate = 2.5 * rechargeRateAverage;
  const tau = rechargeTime / 5;
  const totalPositiveCapNeeded = Math.max(0, totalCapNeed);
  let ttl: number | null = null;
  if (totalCapNeed > peakRechargeRate || totalCapNeed / peakRechargeRate > 0.95) {
    ttl = runSimulation(capacitorCapacity, rechargeTime, modules);
    if (ttl >= CAP_STABLE_TIME) ttl = null;
  }
  let loadBalance: number;
  if (ttl !== null) {
    loadBalance = 0;
  } else {
    const c = (2 * capacitorCapacity) / tau;
    const k = totalPositiveCapNeeded / c;
    const fourK = Math.min(1, 4 * k);
    const exponent = (1 - Math.sqrt(1 - fourK)) / 2;
    if (exponent === 0) {
      loadBalance = 1;
    } else {
      const t = -Math.log(exponent) * tau;
      loadBalance = (1 - Math.exp(-t / tau)) ** 2;
    }
  }
  return { peakRechargeRate, totalCapNeed, loadBalance, ttl };
}

/** GetAccurateAttributeValue: the location's own docked and for a ghost, godma's for the client's own ship in space. */
type Accurate = (item: DogmaItem, attributeID: number) => number;

/**
 * The modules CapacitorSimulator runs: each fitted item of the ship but its charges, that the calculation includes, by
 * its default effect, each figure read as GetAccurateAttributeValue gives it (`accurate`).
 */
export function capacitorModules(
  location: DogmaLocation,
  ship: DogmaItem,
  included: (module: DogmaItem) => boolean,
  accurate: Accurate = (item, attributeID) => location.value(item, attributeID),
): CapacitorModule[] {
  const modulesByFlag = new Map<number, DogmaItem>();
  const chargesByFlag = new Map<number, DogmaItem>();
  for (const item of ship.fitted.values()) {
    if (item.flagID === null) continue;
    if (item.categoryID === CATEGORY_CHARGE) chargesByFlag.set(item.flagID, item);
    else modulesByFlag.set(item.flagID, item);
  }
  const modules: CapacitorModule[] = [];
  for (const [flagID, module] of modulesByFlag) {
    if (!included(module)) continue;
    const defaultEffectID = location.static.types[module.typeID]?.defaultEffectID ?? null;
    if (defaultEffectID === null) continue;
    const effect = location.static.effects[defaultEffectID];
    const durationAttributeID = effect?.durationAttributeID ?? null;
    const dischargeAttributeID = effect?.dischargeAttributeID ?? null;
    if (durationAttributeID === null) continue;
    const duration = accurate(module, durationAttributeID);
    const reactivationDelay = accurate(module, ATTRIBUTE_MODULE_REACTIVATION_DELAY);
    let reloadInfo: CapacitorModule["reloadInfo"] = null;
    let capNeed: number;
    let avgCapNeed: number;
    if (module.groupID === GROUP_CAPACITOR_BOOSTER) {
      const charges = chargesByFlag.get(flagID);
      if (!charges) continue;
      // _GetAvgInjectedEachCycle, _GetReloadInfo
      const reloadTime = accurate(module, ATTRIBUTE_RELOAD_TIME);
      const maxChargesInModule = long(accurate(module, ATTRIBUTE_CAPACITY) / accurate(charges, ATTRIBUTE_VOLUME));
      reloadInfo = { reloadTime, maxChargesInModule };
      const capInjectedPerCycle = accurate(charges, ATTRIBUTE_CAPACITOR_BONUS);
      const injectedInOneLoad = maxChargesInModule * capInjectedPerCycle;
      const durationOfFullLoad = maxChargesInModule * duration;
      const avgCapInjectedEachCycle = (injectedInOneLoad / (durationOfFullLoad + reloadTime)) * duration;
      avgCapNeed = -avgCapInjectedEachCycle;
      capNeed = -capInjectedPerCycle;
    } else if (module.groupID === GROUP_ENERGY_VAMPIRE) {
      const capInjectedPerCycle = accurate(module, ATTRIBUTE_POWER_TRANSFER_AMOUNT);
      capNeed = -capInjectedPerCycle;
      avgCapNeed = -capInjectedPerCycle;
    } else if (dischargeAttributeID === null) {
      continue;
    } else {
      avgCapNeed = capNeed = accurate(module, dischargeAttributeID);
    }
    modules.push({ capNeeded: capNeed, avgCapNeed, duration, reactivationDelay, reloadInfo });
  }
  return modules;
}

/** CapacitorSimulator(dogmaLocation, shipID), each figure read as GetAccurateAttributeValue gives it. */
export function capacitorSimulator(
  location: DogmaLocation,
  ship: DogmaItem,
  included: (module: DogmaItem) => boolean,
  accurate: Accurate = (item, attributeID) => location.value(item, attributeID),
): CapacitorReading {
  return simulateCapacitor(
    accurate(ship, ATTRIBUTE_CAPACITOR_CAPACITY),
    accurate(ship, ATTRIBUTE_RECHARGE_RATE),
    capacitorModules(location, ship, included, accurate),
  );
}

/** ghostControllerMixin._GetCapSimulatorValues: (delta in GJ/s to two places, its share of the peak to one, loadBalance, TTL). */
export function capSimulatorValues(reading: CapacitorReading): {
  readonly delta: number;
  readonly deltaPercentage: number;
  readonly loadBalance: number;
  readonly ttl: number | null;
} {
  const delta = pyRound((reading.peakRechargeRate - reading.totalCapNeed) * 1000, 2);
  const deltaPercentage = pyRound(((reading.peakRechargeRate - reading.totalCapNeed) / reading.peakRechargeRate) * 100, 1);
  return { delta, deltaPercentage, loadBalance: reading.loadBalance, ttl: reading.ttl };
}

/** clientDogmaLocation.IsModuleIncludedInCalculation: a module online (IsOnline: effectOnline among its active effects). */
export function isOnlineModule(module: DogmaItem): boolean {
  return module.activeEffects.has(16);
}
