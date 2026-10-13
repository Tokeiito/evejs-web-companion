// Rung 8a of the fleet companion: the combat utility modules.
//
// The DSL's fight ladder already runs these (`decideCombatUtilities` in
// combatUtilities.ts, docs/combat-utility-framework.md); this is the same policy
// for a companion, which has no single "primary" of its own but a fleet-order
// rung that stands on one target at a time (`CompanionDecision.engagedTargetID`).
//
//   - Stasis webifier, target painter: on the ENGAGED target while it is a locked
//     NPC inside the module's optimal, off when the engagement moves on, the
//     target goes, or it leaves the optimal by more than the sticky margin.
//     A painter only while something is shooting (guns fitted, or combat drones
//     out) -- the framework's rule.
//   - Sensor booster, tracking computer: on while a fight is on (an engaged
//     target or hostiles on grid), off when it ends. A tracking computer only
//     with turrets fitted. Scripts are left as fitted: a module whose loaded
//     script is not one the framework understands (`modeKnown`) stays off.
//   - Omni tracking link: NOT here. The companion already runs it as a drone
//     assist module (`droneAssistModuleIDs`, rung 6).
//   - Capacitor booster: NOT here. The framework's one-cycle injection belongs to
//     a blocked required action, and the companion has no such gate yet.
//
// ⚠ OWNERSHIP IS THE WHOLE SAFETY STORY. This rung switches OFF only what it
// switched ON. A module already running when it first looked (the operator's, a
// previous run's) is never claimed and never stopped.
//
// ⚠ `activeModuleIDs` IS THE AUTHORITY FOR "RUNNING", NOT THE CACHED READ. The
// fit facts (`obs.combatUtilities`) are rebuilt only when the fit changes, so
// their own `active` flags are stale by design; the snapshot's list is read
// every tick. An unreadable list decides nothing.
//
// ⚠ THE CAPACITOR FLOOR GATES STARTING, NEVER STOPPING -- the repairers' rule.
//
// Pure: one call or none per tick, and the memory it hands back.

import type { CombatUtilities, CombatUtility, UtilityFamily } from "./combatUtilities.ts";
import { automaticCombatUtility } from "./combatUtilityPolicy.ts";
import { inReach, REACH_HYSTERESIS_M } from "./combatPosition.ts";
import { measureSpace } from "./autopilotLoop.ts";
import { isHostile } from "../space/overview.ts";
import type {
  CompanionLadderMemory,
  FleetCompanionObservation,
  FleetCompanionRequest,
} from "./fleetCompanionLoop.ts";

/** The families this rung runs. */
export type CompanionUtilityFamily = Extract<UtilityFamily, "web" | "painter" | "sensor" | "tracking">;

/** Start order: the target's own modules first, then the self-buffs. */
const START_ORDER: readonly CompanionUtilityFamily[] = ["web", "painter", "tracking", "sensor"];

const NAMES: Readonly<Record<CompanionUtilityFamily, string>> = {
  web: "stasis webifier",
  painter: "target painter",
  sensor: "sensor booster",
  tracking: "tracking computer",
};

/** A module this rung switched on, and what at (0 for a self-buff). */
export interface OwnedUtility {
  readonly itemID: number;
  readonly typeID: number;
  readonly family: CompanionUtilityFamily;
  readonly targetID: number;
  readonly sinceMs: number;
}

/** A `deactivate` this rung has in flight. */
export interface StoppingUtility {
  readonly itemID: number;
  readonly sinceMs: number;
  readonly attempts: number;
}

/** The sticky in-optimal verdict per targeted module, for one target. */
export interface UtilityReachState {
  readonly targetID: number;
  readonly inReach: readonly number[];
  readonly outOfReach: readonly number[];
}

export interface CompanionUtilityMemory {
  /** The ship the ownership below is about; another ship owns nothing. */
  readonly shipID: number | null;
  readonly owned: readonly OwnedUtility[];
  readonly stopping: readonly StoppingUtility[];
  /** Activations spent this fight, keyed `${itemID}:${targetID}`. Cleared when the fight ends. */
  readonly attempts: Readonly<Record<string, number>>;
  readonly reach: UtilityReachState | null;
}

export const FRESH_COMPANION_UTILITIES: CompanionUtilityMemory = Object.freeze({
  shipID: null,
  owned: [],
  stopping: [],
  attempts: {},
  reach: null,
});

/**
 * How long an activation this rung asked for counts as running before the
 * snapshot shows it. The tick is ~2-4 s and the activate route re-reads the rack
 * before it answers, so a module not running after this was refused, or ran its
 * cycle out on a target that died: either way it is not ours any more.
 */
export const UTILITY_ACTIVATION_GRACE_MS = 6_000;
/** A deactivate still cycling after this is asked again (the route waits out one cycle itself). */
export const UTILITY_STOP_RETRY_MS = 20_000;
export const MAX_UTILITY_STOP_ATTEMPTS = 3;
/** Activations of one module at one target per fight: a refusal is not retried for ever. */
export const MAX_UTILITY_START_ATTEMPTS = 3;

export interface CompanionUtilityInputs {
  /** The fit's utility facts (cached; their `active` flags are not read). */
  readonly facts: CombatUtilities | null;
  /** The ship in the snapshot. Facts about another ship are not used. */
  readonly shipID: number | null;
  /** What is running now. Null: cannot say, and nothing is decided. */
  readonly activeModuleIDs: readonly number[] | null;
  /** The target the fleet-order rung stands on; null when there is none. */
  readonly engagedTargetID: number | null;
  /** The engaged target is an NPC on this grid and is locked. */
  readonly targetLocked: boolean;
  /** Surface distance to the engaged target; null when unmeasured. */
  readonly targetDistanceM: number | null;
  /** An engaged target, or hostiles on grid. */
  readonly fightOn: boolean;
  /** Turrets fitted (a weapon with a tracking speed). */
  readonly hasTurrets: boolean;
  /** Guns or launchers fitted, or combat drones out. */
  readonly hasDamage: boolean;
  readonly capacitorRatio: number | null;
  readonly capacitorFloor: number;
  readonly nowMs: number;
}

export type CompanionUtilityCall =
  | { readonly kind: "activate"; readonly moduleID: number; readonly targetID: number }
  | { readonly kind: "deactivate"; readonly moduleID: number; readonly typeID: number };

export interface CompanionUtilityStep {
  readonly call: CompanionUtilityCall | null;
  readonly why: string;
  readonly memory: CompanionUtilityMemory;
}

const isTargeted = (family: CompanionUtilityFamily): boolean => family === "web" || family === "painter";

function companionFamily(module: CombatUtility): CompanionUtilityFamily | null {
  return module.family === "web" || module.family === "painter" || module.family === "sensor" ||
    module.family === "tracking" ? module.family : null;
}

/**
 * Sticky "inside optimal" for a web or painter. Unlike the guns' gate this FAILS
 * CLOSED: no known optimal, or no measurement and no history, is "out". The
 * framework applies a targeted utility only inside a proven optimal.
 */
function utilityInReach(distanceM: number | null, rangeM: number | null, was: boolean | null): boolean {
  if (rangeM === null || !Number.isFinite(rangeM) || rangeM <= 0) return false;
  if (distanceM === null || !Number.isFinite(distanceM)) return was ?? false;
  return inReach(distanceM, rangeM, was, REACH_HYSTERESIS_M);
}

/** The capacitor now: the fit read's capacity times this tick's ratio. */
function capacitorNow(facts: CombatUtilities, ratio: number | null): number | null {
  if (facts.capacitor === null || facts.capacitorRatio === null || !(facts.capacitorRatio > 0) || ratio === null) {
    return null;
  }
  return (facts.capacitor / facts.capacitorRatio) * ratio;
}

const none = (memory: CompanionUtilityMemory): CompanionUtilityStep => ({ call: null, why: "", memory });

/** The pure decision: at most one call, and the memory either way. */
export function decideCompanionUtilities(
  inputs: CompanionUtilityInputs,
  memory: CompanionUtilityMemory,
): CompanionUtilityStep {
  let mem = memory;
  // Another ship (a reship, a pod) owns nothing this one switched on.
  if (inputs.shipID !== null && mem.shipID !== null && mem.shipID !== inputs.shipID) {
    mem = FRESH_COMPANION_UTILITIES;
  }
  const active = inputs.activeModuleIDs;
  if (active === null) {
    return none(mem);
  }
  const running = new Set(active);
  const now = inputs.nowMs;

  // Settle: a stop seen through is done; an owned module not running past its
  // grace is not ours any more (the cycle ran out, or it was refused).
  const stopping = mem.stopping.filter((stop) => running.has(stop.itemID));
  let owned = mem.owned.filter((own) => running.has(own.itemID) || now - own.sinceMs < UTILITY_ACTIVATION_GRACE_MS);
  const attempts = inputs.fightOn ? mem.attempts : {};

  const facts = inputs.facts !== null && inputs.shipID !== null && inputs.facts.shipID === inputs.shipID
    ? inputs.facts : null;
  const modules = (facts?.modules ?? []).filter((module) =>
    companionFamily(module) !== null && automaticCombatUtility(module));

  // The sticky reach verdict for each targeted module on the engaged target.
  const engaged = inputs.engagedTargetID;
  const previous = engaged !== null && mem.reach?.targetID === engaged ? mem.reach : null;
  const verdicts = new Map<number, boolean>();
  let reach: UtilityReachState | null = null;
  if (engaged !== null) {
    const nowIn: number[] = [];
    const nowOut: number[] = [];
    for (const module of modules) {
      const family = companionFamily(module)!;
      if (!isTargeted(family)) continue;
      const was = previous === null ? null
        : previous.inReach.includes(module.itemID) ? true
          : previous.outOfReach.includes(module.itemID) ? false : null;
      const ok = utilityInReach(inputs.targetDistanceM, module.rangeM, was);
      verdicts.set(module.itemID, ok);
      // Recorded only from a measurement; otherwise the previous state stands.
      const measured = inputs.targetDistanceM !== null && module.rangeM !== null && module.rangeM > 0;
      const state = measured ? ok : was;
      if (state === true) nowIn.push(module.itemID);
      if (state === false) nowOut.push(module.itemID);
    }
    reach = { targetID: engaged, inReach: nowIn, outOfReach: nowOut };
  }

  mem = { ...mem, owned, stopping, attempts, reach };

  // Stops first: a module running on the wrong thing costs capacitor every cycle.
  for (const own of owned) {
    if (!running.has(own.itemID)) continue; // asked for, not seen yet
    const why = stopWhy(own, inputs, verdicts);
    if (why === null) continue;
    const pending = stopping.find((stop) => stop.itemID === own.itemID);
    if (pending !== undefined && now - pending.sinceMs < UTILITY_STOP_RETRY_MS) continue;
    if (pending !== undefined && pending.attempts >= MAX_UTILITY_STOP_ATTEMPTS) {
      // Given up: no longer ours, so no longer asked.
      owned = owned.filter((entry) => entry.itemID !== own.itemID);
      mem = { ...mem, owned, stopping: mem.stopping.filter((stop) => stop.itemID !== own.itemID) };
      continue;
    }
    return {
      // ⚠ THE typeID RIDES ALONG AS THE PROP MOD'S DOES. For these families the BFF
      // resolves no effect name from it (`getPropulsionEffectName` answers only
      // for prop mods) and the server's generic Deactivate path stops them; it is
      // sent so the call is the same shape whatever the module.
      call: { kind: "deactivate", moduleID: own.itemID, typeID: own.typeID },
      why,
      memory: {
        ...mem,
        stopping: [
          ...mem.stopping.filter((stop) => stop.itemID !== own.itemID),
          { itemID: own.itemID, sinceMs: now, attempts: (pending?.attempts ?? 0) + 1 },
        ],
      },
    };
  }

  // Starts: never below the capacitor floor, never without facts for this ship.
  if (facts === null) {
    return none(mem);
  }
  if (inputs.capacitorRatio !== null && inputs.capacitorRatio < inputs.capacitorFloor) {
    return none(mem);
  }
  const capacitor = capacitorNow(facts, inputs.capacitorRatio);
  for (const family of START_ORDER) {
    for (const module of modules) {
      if (companionFamily(module) !== family) continue;
      if (running.has(module.itemID) || owned.some((own) => own.itemID === module.itemID) ||
        mem.stopping.some((stop) => stop.itemID === module.itemID)) continue;
      if (!module.modeKnown) continue;
      if (capacitor !== null && module.capNeed !== null && capacitor < module.capNeed) continue;
      let targetID = 0;
      if (isTargeted(family)) {
        if (engaged === null || !inputs.targetLocked || verdicts.get(module.itemID) !== true) continue;
        if (family === "painter" && !inputs.hasDamage) continue;
        targetID = engaged;
      } else {
        if (!inputs.fightOn) continue;
        if (family === "tracking" && !inputs.hasTurrets) continue;
      }
      const key = `${module.itemID}:${targetID}`;
      const spent = mem.attempts[key] ?? 0;
      if (spent >= MAX_UTILITY_START_ATTEMPTS) continue;
      return {
        call: { kind: "activate", moduleID: module.itemID, targetID },
        why: startWhy(family),
        memory: {
          ...mem,
          shipID: facts.shipID,
          owned: [...owned, { itemID: module.itemID, typeID: module.typeID, family, targetID, sinceMs: now }],
          attempts: { ...mem.attempts, [key]: spent + 1 },
        },
      };
    }
  }
  return none(mem);
}

function startWhy(family: CompanionUtilityFamily): string {
  switch (family) {
    case "web": return "Webbing the target.";
    case "painter": return "Painting the target.";
    default: return `In a fight: switching the ${NAMES[family]} on.`;
  }
}

/** Why an owned, running module should stop now; null when it should keep running. */
function stopWhy(
  own: OwnedUtility,
  inputs: CompanionUtilityInputs,
  verdicts: ReadonlyMap<number, boolean>,
): string | null {
  const name = NAMES[own.family];
  if (!isTargeted(own.family)) {
    return inputs.fightOn ? null : `Fight over: switching the ${name} off.`;
  }
  if (inputs.engagedTargetID !== null && own.targetID !== inputs.engagedTargetID) {
    return `The target changed: switching the ${name} off.`;
  }
  if (inputs.engagedTargetID === null || !inputs.targetLocked) {
    return `The target is gone: switching the ${name} off.`;
  }
  if (own.family === "painter" && !inputs.hasDamage) {
    return "Nothing is shooting: switching the target painter off.";
  }
  // A module the facts do not describe has no verdict: it keeps running.
  return verdicts.get(own.itemID) === false ? `Target out of range: switching the ${name} off.` : null;
}

/**
 * What a warp leaves of the record. The targeted modules lost their target with
 * the grid, so they are forgotten. The self-buffs are KEPT: nothing says a warp
 * stops a sensor booster, and forgetting one still cycling would leave it
 * running, unowned, on a quiet grid for the rest of the run.
 */
export function utilitiesAfterWarp(memory: CompanionUtilityMemory | undefined): CompanionUtilityMemory {
  const mem = memory ?? FRESH_COMPANION_UTILITIES;
  if (mem.owned.length === 0 && mem.stopping.length === 0 && mem.reach === null &&
    Object.keys(mem.attempts).length === 0) {
    return mem;
  }
  return { ...mem, owned: mem.owned.filter((own) => !isTargeted(own.family)), stopping: [], attempts: {}, reach: null };
}

/** The rung's inputs, off the ladder's own observation. */
export function companionUtilityInputs(
  request: FleetCompanionRequest,
  obs: FleetCompanionObservation,
  engagedTargetID: number | null,
  nowMs: number,
): CompanionUtilityInputs {
  const snapshot = obs.snapshot ?? null;
  const entities = snapshot?.entities ?? [];
  const target = engagedTargetID === null ? null : entities.find((entity) => entity.itemID === engagedTargetID) ?? null;
  const locked = obs.lockedTargetIDs ?? null;
  const measurement = engagedTargetID === null ? null : measureSpace(snapshot);
  return {
    facts: obs.combatUtilities ?? null,
    shipID: snapshot?.ship?.itemID ?? null,
    activeModuleIDs: snapshot?.ship?.activeModuleIDs ?? null,
    engagedTargetID,
    targetLocked: target !== null && isHostile(target) && locked !== null && engagedTargetID !== null &&
      locked.includes(engagedTargetID),
    targetDistanceM: engagedTargetID === null ? null : measurement?.distances.get(engagedTargetID) ?? null,
    fightOn: engagedTargetID !== null || entities.some(isHostile),
    hasTurrets: obs.combatWeapons?.weapons.some((weapon) => weapon.tracking !== null && weapon.tracking > 0) === true,
    hasDamage: request.weaponModuleIDs.length > 0 || (obs.combatDroneIDs?.length ?? 0) > 0,
    capacitorRatio: obs.capacitorRatio ?? null,
    capacitorFloor: request.capacitorFloor,
    nowMs,
  };
}

/**
 * The ladder's call: one call or none, and the ladder memory either way.
 *
 * ⚠ A FLEEING OR UNDOCKED-ELSEWHERE PILOT IS NOT KEPT BUSY HERE. A flee latch,
 * an abandonment, a dock or a warp ends the record and decides nothing; the flee
 * and the abandonment rank above this rung anyway, this is the belt to that.
 */
export function decideUtilityRung(
  request: FleetCompanionRequest,
  obs: FleetCompanionObservation,
  engagedTargetID: number | null,
  memory: CompanionLadderMemory,
  nowMs: number,
): { readonly call: CompanionUtilityCall | null; readonly why: string; readonly memory: CompanionLadderMemory } {
  const current = memory.utilities ?? FRESH_COMPANION_UTILITIES;
  if (memory.flee !== null || memory.abandonment !== null || obs.inSpace !== true || obs.docked === true) {
    return { call: null, why: "", memory: current === FRESH_COMPANION_UTILITIES ? memory : { ...memory, utilities: FRESH_COMPANION_UTILITIES } };
  }
  if (obs.inWarp === true) {
    return { call: null, why: "", memory: { ...memory, utilities: utilitiesAfterWarp(current) } };
  }
  const step = decideCompanionUtilities(companionUtilityInputs(request, obs, engagedTargetID, nowMs), current);
  return { call: step.call, why: step.why, memory: { ...memory, utilities: step.memory } };
}
