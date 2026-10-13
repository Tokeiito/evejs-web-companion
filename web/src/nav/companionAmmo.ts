// Ammo by target in the companion ladder (plan §3, §5.2): the call sites of
// `ammoRanking.ts`, kept out of fleetCompanionLoop.ts so the upstream file
// carries only the hooks. Pure: it reads the observation and the ladder memory
// and returns an action, a sentence and the memory; `nowMs` is passed in.
//
// Two halves, at two places in the ladder:
//
//   EMPTY GUNS (`emptyGunAmmo`, from `decideReload`, above rung 7). The reload
//   rung keeps its budget, banking and fallback; only WHICH stack it loads
//   changes, and only when the target is known: the ranked stack
//   (`rankCharges`) against the target rung 7 was last engaged on. With no
//   target, or nothing compatible to rank, today's largest-stack rule stands.
//
//   LOADED GUNS (`decideAmmoSwap`, right after the lock-ahead, below rung 7).
//   ⚠ BELOW RUNG 7 BECAUSE "THE ENGAGED TARGET" IS RUNG 7'S ANSWER. The reload
//   rung sits above it (an empty rack must be filled before a call is obeyed),
//   so it cannot know which ship the guns are on this tick. The swap runs only
//   while rung 7 is STANDING on a target -- locked, every gun that reaches it
//   running -- which is exactly "a loaded gun on the engaged target", and it
//   costs rung 7 nothing: a tick on which rung 7 has a real call is simply not
//   counted towards the swap's persistence.
//
// ⚠ BANKED GUNS ARE ONE UNIT. The server expands a bank master to every linked
// module (`_expandGroupedModuleIDs`), and a bank shares one charge type, so a
// bank is ranked once, remembered once (keyed by its master) and loaded with
// one call naming all its members. Unbanked guns that pick the same stack on
// the same tick ride along in the same call, as the empty-gun path does.
//
// ⚠ THE NEXT-TARGET MOMENT. When the lock-ahead has another hostile locked and
// the current target is down to AMMO_NEXT_TARGET_HP_FRACTION of its full hit
// points (all three layers), the ranking is run against the NEXT target -- its
// distance, its resists, its id -- so the gun comes up already loaded for it.
// 25 %: a reload is 5-10 s, about what the last quarter of a frigate or cruiser
// rat takes under a few guns, so the swap lands as the kill does; much earlier
// and the reload's silence is spent on the target still alive, much later and
// the next fight starts on the wrong charge. The "next" is the lock-ahead's own
// order (fleet tags, then the kill order), handed in by the ladder.
//
// ⚠ CAN THE SHIP CLOSE? Only in `flight auto`, not held by `stop`, and only
// while rung 8 is positioning on THIS target, not leashed and with its closing
// budget unspent. Every other case -- follow mode, leashed, a fit rung 8 does
// not position, a budget spent -- is "cannot close", which is what lets an
// out-of-reach charge be swapped. Closing beats reloading (operator).
//
// ⚠ SWAPS ARE STRICT ABOUT COMPATIBILITY; LOADS ARE NOT. A swap throws away a
// working charge, so it only ever considers a stack whose group the gun accepts
// AND whose size matches the gun's when the gun's size is known. An empty gun
// keeps the reload rung's advisory rule (`pickChargeFor`): an unknown never
// suppresses a load, it only fails to rank one.
//
// Attribute ids (checked against the server's SDE, dogmaAttributes.jsonl):
//   resonances  shield 271 em, 274 thermal, 273 kinetic, 272 explosive
//               armour 267 em, 270 thermal, 269 kinetic, 268 explosive
//               hull   113 em, 110 thermal, 109 kinetic, 111 explosive
//   gun cycle   51 speed (ms), 64 damageMultiplier, 1795 reloadTime (ms)
// All resonances, 64 and 1795 default to 1, 1 and 10 000 in the SDE; a type
// row the tables answered applies those defaults, an empty or missing row is
// unknown (null). 51 has no usable default.

import type { CombatWeapon } from "./combatWeapons.ts";
import type {
  CompanionCargoCharge,
  CompanionLadderMemory,
  FleetCompanionObservation,
  FleetCompanionRequest,
} from "./fleetCompanionLoop.ts";
import type { SpaceEntity } from "../store/types.ts";
import { measureSpace } from "./autopilotLoop.ts";
import {
  FRESH_SWAP_MEMORY,
  appliedDamage,
  decideSwap,
  layerUnderFire,
  rankCharges,
  type ChargeOption,
  type Resonances,
  type SwapMemory,
} from "./ammoRanking.ts";
import { candidateReachM, type ChargeFacts, type LoadedGunReach } from "./ammoReach.ts";
import type { AmmoCode, AmmoSkip, AmmoTrace, AmmoUnitTrace } from "./companionTrace.ts";

/** See the header: the share of full hit points below which the next target is loaded for. */
export const AMMO_NEXT_TARGET_HP_FRACTION = 0.25;

// ─── Static facts ────────────────────────────────────────────────────────────

/** Shield, armour and hull resonances, em/thermal/kinetic/explosive each. */
export const RAT_RESONANCE_ATTRIBUTE_IDS: readonly number[] = Object.freeze([
  271, 274, 273, 272,
  267, 270, 269, 268,
  113, 110, 109, 111,
]);

/** A hostile type's damage multipliers by layer (1 = no resist). */
export interface RatResonances {
  readonly shield: Resonances;
  readonly armor: Resonances;
  readonly hull: Resonances;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A type's resonances from its dogma row; null for a row the tables did not know. */
export function ratResonancesFromAttributes(
  row: Readonly<Record<number, number>> | undefined,
): RatResonances | null {
  if (row === undefined || Object.keys(row).length === 0) {
    return null;
  }
  // Absent is the SDE default, 1.0 (no resist); a nonsense value is clamped.
  const r = (id: number): number => {
    const value = finite(row[id]);
    return value === null ? 1 : Math.max(0, value);
  };
  return {
    shield: { em: r(271), thermal: r(274), kinetic: r(273), explosive: r(272) },
    armor: { em: r(267), thermal: r(270), kinetic: r(269), explosive: r(268) },
    hull: { em: r(113), thermal: r(110), kinetic: r(109), explosive: r(111) },
  };
}

/** Rate of fire, damage multiplier and reload time of a weapon type. */
export const WEAPON_CYCLE_ATTRIBUTE_IDS: readonly number[] = Object.freeze([51, 64, 1795]);

/**
 * A weapon TYPE's base cycle, for "what the gun would deal during the reload".
 * ⚠ BASE, NOT SKILLED: static dogma has no skills, so the rate of fire is the
 * slowest it can be and the loss is under-stated. That errs towards swapping,
 * and only inside the remaining-HP veto, which the gain test has already
 * cleared.
 */
export interface WeaponCycleFacts {
  readonly speedMs: number | null;
  readonly damageMultiplier: number;
  readonly reloadTimeMs: number | null;
}

export function weaponCycleFromAttributes(
  row: Readonly<Record<number, number>> | undefined,
): WeaponCycleFacts | null {
  if (row === undefined || Object.keys(row).length === 0) {
    return null;
  }
  const speed = finite(row[51]);
  const multiplier = finite(row[64]);
  const reload = row[1795] === undefined ? 10_000 : finite(row[1795]);
  return {
    speedMs: speed !== null && speed > 0 ? speed : null,
    damageMultiplier: multiplier !== null && multiplier > 0 ? multiplier : 1,
    reloadTimeMs: reload !== null && reload >= 0 ? reload : null,
  };
}

// ─── Memory ──────────────────────────────────────────────────────────────────

/** What a gun last measured with a charge in it, so it can still rank by reach once empty. */
export interface LoadedReachRecord {
  readonly chargeTypeID: number;
  readonly reachM: number;
  readonly optimalM: number | null;
  readonly turret: boolean;
}

export interface CompanionAmmoMemory {
  /** The swap gate's memory per firing unit, keyed by the unit's lead gun (a bank's master). */
  readonly swap: Readonly<Record<number, SwapMemory>>;
  /**
   * The target rung 7 was standing on when the swap step last ran. The empty
   * gun's ranking reads it a tick later, from above rung 7; a target that has
   * left the grid is not used.
   */
  readonly targetID: number | null;
  /** Per gun, its last measured loaded reach. Bounded by the rack. */
  readonly lastLoaded: Readonly<Record<number, LoadedReachRecord>>;
}

export const FRESH_COMPANION_AMMO: CompanionAmmoMemory = Object.freeze({ swap: {}, targetID: null, lastLoaded: {} });

function ammoOf(memory: CompanionLadderMemory): CompanionAmmoMemory {
  // Defensive: a memory built before this field existed reads as fresh.
  return memory.ammo ?? FRESH_COMPANION_AMMO;
}

// ─── Shared reading ──────────────────────────────────────────────────────────

function isTurret(weapon: CombatWeapon): boolean {
  return weapon.tracking !== null && weapon.tracking > 0;
}

function chargeFactsOf(obs: FleetCompanionObservation, typeID: number | null): ChargeFacts | null {
  return typeID === null ? null : (obs.chargeFactsByTypeID?.[typeID] ?? null);
}

/** The resonances of the layer this entity is losing, or null when its type is unread. */
export function resonancesUnderFire(entity: SpaceEntity, obs: FleetCompanionObservation): Resonances | null {
  const typeID = entity.typeID ?? null;
  const all = typeID === null ? null : (obs.ratResonancesByTypeID?.[typeID] ?? null);
  if (all === null) {
    return null;
  }
  return all[layerUnderFire(entity.shieldRatio ?? null, entity.armorRatio ?? null, entity.hullRatio ?? null)];
}

/** Full hit points across the three layers, or null when any is unread. */
function fullHitPoints(entity: SpaceEntity, obs: FleetCompanionObservation): number | null {
  const full = entity.typeID === null ? null : (obs.hitPointsByTypeID?.[entity.typeID] ?? null);
  if (full === null || full.shield === null || full.armor === null || full.hull === null) {
    return null;
  }
  return full.shield + full.armor + full.hull;
}

/**
 * Cargo stacks a gun can certainly take: its group, and its size when the gun
 * has one. A gun with no known group list takes nothing here.
 */
function strictlyCompatible(
  moduleID: number,
  weapon: CombatWeapon | null,
  charges: readonly CompanionCargoCharge[],
  obs: FleetCompanionObservation,
): readonly CompanionCargoCharge[] {
  const accepted = obs.weaponChargeGroups?.[moduleID] ?? weapon?.acceptedGroups ?? null;
  if (accepted === null || accepted.length === 0) {
    return [];
  }
  const gunSize = weapon?.chargeSize ?? null;
  return charges.filter((charge) => {
    if (charge.quantity <= 0 || charge.groupID === null || !accepted.includes(charge.groupID)) {
      return false;
    }
    if (gunSize === null) {
      return true;
    }
    return chargeFactsOf(obs, charge.typeID)?.size === gunSize;
  });
}

/** A cargo stack as a ranked option for a gun that measured `gun` with `loadedTypeID` in it. */
function optionFor(
  charge: CompanionCargoCharge,
  gun: LoadedGunReach,
  loadedTypeID: number | null,
  obs: FleetCompanionObservation,
): ChargeOption {
  const facts = chargeFactsOf(obs, charge.typeID);
  return {
    itemID: charge.itemID,
    typeID: charge.typeID,
    quantity: charge.quantity,
    reachM: candidateReachM(gun, loadedTypeID, chargeFactsOf(obs, loadedTypeID), charge.typeID, facts),
    damage: facts?.damage ?? null,
  };
}

function entityOnGrid(obs: FleetCompanionObservation, itemID: number | null): SpaceEntity | null {
  if (itemID === null) {
    return null;
  }
  return obs.snapshot?.entities.find((entity) => entity.itemID === itemID) ?? null;
}

// ─── Empty guns ──────────────────────────────────────────────────────────────

/**
 * Which rule chose the stack for an empty gun: "ranked" (`rankCharges` against
 * the target rung 7 was last on) or "largest" (the reload rung's own
 * largest-stack rule, because there was no known target or nothing to rank).
 */
export type EmptyGunRule = "ranked" | "largest";

export interface EmptyGunAmmo {
  /** The memory with every loaded gun's measured reach recorded. */
  readonly memory: CompanionLadderMemory;
  /** The ranked stack for this empty gun, or null: use the reload rung's own rule. */
  readonly pick: (moduleID: number, charges: readonly CompanionCargoCharge[]) => CompanionCargoCharge | null;
  /**
   * `pick`, with the rule that applies: `rule` is "ranked" exactly when `charge`
   * is non-null, and "largest" when it is null (the caller then falls back to
   * its largest-stack rule). The same stack `pick` returns, never another.
   */
  readonly pickWithRule: (
    moduleID: number,
    charges: readonly CompanionCargoCharge[],
  ) => { readonly charge: CompanionCargoCharge | null; readonly rule: EmptyGunRule };
}

/**
 * The reload rung's hook: record what each loaded gun measures (an empty gun
 * has no reach of its own, so its last loaded one is what ranks by range), and
 * rank compatible stacks for an empty gun against the target rung 7 was last
 * standing on.
 */
export function emptyGunAmmo(obs: FleetCompanionObservation, memory: CompanionLadderMemory): EmptyGunAmmo {
  const ammo = ammoOf(memory);
  const weapons = obs.combatWeapons?.weapons ?? null;
  let lastLoaded = ammo.lastLoaded;
  for (const weapon of weapons ?? []) {
    if (weapon.chargeTypeID === null || weapon.reachM === null || !(weapon.reachM > 0)) {
      continue;
    }
    const was = lastLoaded[weapon.itemID];
    const record: LoadedReachRecord = {
      chargeTypeID: weapon.chargeTypeID, reachM: weapon.reachM,
      optimalM: weapon.optimalM ?? null, turret: isTurret(weapon),
    };
    if (was === undefined || was.chargeTypeID !== record.chargeTypeID || was.reachM !== record.reachM ||
      was.optimalM !== record.optimalM || was.turret !== record.turret) {
      lastLoaded = { ...lastLoaded, [weapon.itemID]: record };
    }
  }
  const next = lastLoaded === ammo.lastLoaded ? memory : { ...memory, ammo: { ...ammo, lastLoaded } };

  const target = entityOnGrid(obs, ammo.targetID);
  const snapshot = obs.snapshot ?? null;
  if (target === null || snapshot === null) {
    return { memory: next, pick: () => null, pickWithRule: () => ({ charge: null, rule: "largest" }) };
  }
  const distanceM = measureSpace(snapshot)?.distances.get(target.itemID) ?? null;
  const resonances = resonancesUnderFire(target, obs);
  const pick = (moduleID: number, charges: readonly CompanionCargoCharge[]): CompanionCargoCharge | null => {
      const weapon = weapons?.find((row) => row.itemID === moduleID) ?? null;
      const compatible = strictlyCompatible(moduleID, weapon, charges, obs);
      if (compatible.length === 0) {
        return null;
      }
      const last = lastLoaded[moduleID] ?? null;
      const gun: LoadedGunReach = last === null
        ? { reachM: null, optimalM: null, turret: null }
        : { reachM: last.reachM, optimalM: last.optimalM, turret: last.turret };
      const options = compatible.map((charge) => optionFor(charge, gun, last?.chargeTypeID ?? null, obs));
      const best = rankCharges(options, distanceM, resonances, null)[0];
      return best === undefined ? null : (compatible.find((charge) => charge.itemID === best.itemID) ?? null);
  };
  return {
    memory: next,
    pick,
    pickWithRule: (moduleID, charges) => {
      const charge = pick(moduleID, charges);
      return { charge, rule: charge === null ? "largest" : "ranked" };
    },
  };
}

// ─── Loaded guns ─────────────────────────────────────────────────────────────

/** What the swap step needs from the ladder that owns it. */
export interface AmmoLadder {
  /** The lock-ahead's next target: a hostile other than `engagedID` already locked, best first. */
  readonly nextTarget: (obs: FleetCompanionObservation, engagedID: number) => SpaceEntity | null;
  /** What is left of a ship across its three layers, or null. */
  readonly remainingHitPoints: (entity: SpaceEntity, obs: FleetCompanionObservation) => number | null;
}

export interface AmmoSwapStep {
  /** A swap to issue, or null. */
  readonly swap: {
    readonly moduleIDs: readonly number[];
    readonly chargeItemID: number;
    readonly why: string;
  } | null;
  readonly memory: CompanionLadderMemory;
  /** Every tick, on every path: why the step did or did not act (companionTrace.ts). */
  readonly trace: AmmoTrace;
}

/**
 * A trace for a tick on which the step looked at no gun. `decideAmmoSwap` uses
 * it for its own early returns; the caller uses it for "not-engaged", the one
 * skip that happens before `decideAmmoSwap` is reached.
 */
export function ammoSkipTrace(skipped: AmmoSkip, targetID: number | null = null, canClose = false): AmmoTrace {
  return { skipped, targetID, distanceM: null, nextTargetMoment: false, canClose, units: [] };
}

/** The firing units: each bank (master first) and each unbanked gun, in the request's order. */
export function firingUnits(
  weaponModuleIDs: readonly number[],
  banks: Readonly<Record<number, readonly number[]>> | null | undefined,
): readonly (readonly number[])[] {
  const picked = new Set(weaponModuleIDs);
  const unitOf = new Map<number, number[]>();
  for (const [masterKey, slaves] of Object.entries(banks ?? {})) {
    const members = [Number(masterKey), ...slaves].filter((id) => picked.has(id));
    if (members.length === 0) {
      continue;
    }
    for (const id of members) {
      unitOf.set(id, members);
    }
  }
  const units: number[][] = [];
  const seen = new Set<number[]>();
  for (const id of weaponModuleIDs) {
    const unit = unitOf.get(id) ?? [id];
    if (!seen.has(unit)) {
      seen.add(unit);
      units.push(unit);
    }
  }
  return units;
}

/** Can rung 8 still close on `targetID`? See the header. */
export function canCloseOn(memory: CompanionLadderMemory, targetID: number): boolean {
  const state = memory.combatPosition.target;
  return memory.flightMode === "auto" && !memory.followHeld && state !== null && state.targetID === targetID &&
    !state.leashed && state.spentAtM === null;
}

/** The readout for a swap: the module's reason, with the charge's name when it is known. */
function swapWords(why: string, name: string | null, guns: number): string {
  const what = name === null ? "Changing ammo" : `Changing ammo to ${name}`;
  const count = guns > 1 ? ` (${guns} guns)` : "";
  return `${what}${count} -- ${why}.`;
}

/**
 * One tick of ammo by target for the LOADED guns, while rung 7 stands on
 * `engagedID`. At most one call: the first unit whose gate says "swap", plus
 * every other unit swapping to the same stack this tick. Units that would swap
 * to something else keep last tick's memory and get their turn next tick.
 */
export function decideAmmoSwap(
  request: FleetCompanionRequest,
  obs: FleetCompanionObservation,
  memory: CompanionLadderMemory,
  engagedID: number,
  nowMs: number,
  ladder: AmmoLadder,
): AmmoSwapStep {
  const before = ammoOf(memory);
  // A new target: whatever verdict was counting was about the old one.
  const swapMemory: Record<number, SwapMemory> = {};
  for (const [key, entry] of Object.entries(before.swap)) {
    swapMemory[Number(key)] = before.targetID === engagedID || (entry.wantedTypeID === null && entry.wantedTicks === 0)
      ? entry : { ...entry, wantedTypeID: null, wantedTicks: 0 };
  }
  const settle = (swap: Record<number, SwapMemory>, keys: readonly number[]): CompanionLadderMemory => {
    const kept: Record<number, SwapMemory> = {};
    for (const key of keys) {
      if (swap[key] !== undefined) kept[key] = swap[key];
    }
    return { ...memory, ammo: { ...before, swap: kept, targetID: engagedID } };
  };

  const snapshot = obs.snapshot ?? null;
  const weapons = obs.combatWeapons?.weapons ?? null;
  const cargo = obs.cargoCharges ?? null;
  const target = entityOnGrid(obs, engagedID);
  const units = firingUnits(request.weaponModuleIDs, snapshot?.ship?.weaponBanks ?? null);
  const leads = units.map((unit) => unit[0]!);
  const canClose = canCloseOn(memory, engagedID);
  // One skip per early return, in the order the conditions are tested.
  const skipped: AmmoSkip | null =
    obs.inSpace !== true || obs.inWarp === true || snapshot === null ? "no-snapshot"
      : weapons === null || units.length === 0 ? "no-weapons"
        : cargo === null ? "no-cargo"
          : target === null ? "no-target"
            : null;
  if (skipped !== null || snapshot === null || weapons === null || cargo === null || target === null) {
    return {
      swap: null,
      memory: settle(swapMemory, leads),
      trace: ammoSkipTrace(skipped ?? "no-snapshot", engagedID, canClose),
    };
  }

  const measurement = measureSpace(snapshot);
  const distanceOf = (entity: SpaceEntity): number | null => measurement?.distances.get(entity.itemID) ?? null;
  const currentResonances = resonancesUnderFire(target, obs);
  const remainingHp = ladder.remainingHitPoints(target, obs);
  const fullHp = fullHitPoints(target, obs);
  const nearlyDead = remainingHp !== null && fullHp !== null && fullHp > 0 &&
    remainingHp <= AMMO_NEXT_TARGET_HP_FRACTION * fullHp;
  const next = nearlyDead ? ladder.nextTarget(obs, engagedID) : null;
  const nextTargetMoment = next !== null;
  const rankedFor = next ?? target;
  const distanceM = distanceOf(rankedFor);
  const resonances = next === null ? currentResonances : resonancesUnderFire(next, obs);
  const empty = new Set(obs.emptyWeaponModuleIDs ?? []);

  // One entry per unit considered, in the units' order. `pending` is the swap
  // memory as the gate left it: a swap or load issued this tick reads pending.
  const unitTraces: AmmoUnitTrace[] = [];
  const traceOf = (
    leadID: number, code: AmmoCode, loadedTypeID: number | null, wantedTypeID: number | null, wantedTicks: number,
    pending: boolean,
  ): void => {
    unitTraces.push({ leadID, code, loadedTypeID, wantedTypeID, wantedTicks, pending });
  };
  const inFlight = (entry: SwapMemory | undefined): boolean => (entry?.pendingTypeID ?? null) !== null;
  // How many ticks the verdict for `typeID` has held, counting this one.
  const heldTicks = (entry: SwapMemory | undefined, typeID: number): number =>
    entry !== undefined && entry.wantedTypeID === typeID ? entry.wantedTicks + 1 : 1;

  let chosen: { itemID: number; typeID: number; why: string; moduleIDs: number[] } | null = null;
  for (const unit of units) {
    const lead = unit[0]!;
    const weapon = weapons.find((row) => row.itemID === lead) ?? null;
    // Empty guns are the reload rung's; an unread gun is nobody's.
    if (weapon === null || weapon.chargeTypeID === null || !((weapon.chargeQuantity ?? 0) > 0) ||
      unit.some((id) => empty.has(id))) {
      const stored = swapMemory[lead];
      const isEmpty = unit.some((id) => empty.has(id)) || (weapon !== null && weapon.chargeQuantity === 0);
      traceOf(
        lead, isEmpty ? "gun-empty" : "gun-unread", weapon?.chargeTypeID ?? null,
        stored?.wantedTypeID ?? null, stored?.wantedTicks ?? 0, inFlight(stored),
      );
      continue;
    }
    const loadedFacts = chargeFactsOf(obs, weapon.chargeTypeID);
    const loaded: ChargeOption = {
      itemID: 0,
      typeID: weapon.chargeTypeID,
      quantity: weapon.chargeQuantity ?? 1,
      reachM: weapon.reachM,
      damage: loadedFacts?.damage ?? null,
    };
    const gun: LoadedGunReach = { reachM: weapon.reachM, optimalM: weapon.optimalM ?? null, turret: isTurret(weapon) };
    const options = [
      loaded,
      ...strictlyCompatible(lead, weapon, cargo, obs).map((charge) => optionFor(charge, gun, weapon.chargeTypeID, obs)),
    ];
    const ranked = rankCharges(options, distanceM, resonances, weapon.chargeTypeID);
    const perShot = appliedDamage(loaded, currentResonances);
    const cycle = obs.weaponCycleByTypeID?.[weapon.typeID] ?? null;
    const damageLostToReload = perShot === null || cycle === null || cycle.speedMs === null || cycle.reloadTimeMs === null
      ? null
      : perShot * cycle.damageMultiplier * (cycle.reloadTimeMs / cycle.speedMs) * unit.length;
    const stored = swapMemory[lead];
    const decision = decideSwap({
      ranked,
      loaded,
      targetDistanceM: distanceM,
      resonances,
      targetID: rankedFor.itemID,
      targetRemainingHp: remainingHp,
      damageLostToReload,
      canClose,
      nextTargetMoment,
      nowMs,
      memory: swapMemory[lead] ?? FRESH_SWAP_MEMORY,
    });
    if (decision.kind !== "swap") {
      // The keep reasons land in the trace; the behaviour is unchanged.
      swapMemory[lead] = decision.memory;
      const wanted = decision.kind === "load" ? decision.charge.typeID : decision.memory.wantedTypeID;
      traceOf(lead, decision.code, weapon.chargeTypeID, wanted, decision.memory.wantedTicks, inFlight(decision.memory));
      continue;
    }
    const held = heldTicks(stored, decision.charge.typeID);
    if (chosen === null) {
      chosen = { itemID: decision.charge.itemID, typeID: decision.charge.typeID, why: decision.why, moduleIDs: [...unit] };
      swapMemory[lead] = decision.memory;
      traceOf(lead, decision.code, weapon.chargeTypeID, decision.charge.typeID, held, true);
    } else if (decision.charge.itemID === chosen.itemID) {
      chosen.moduleIDs.push(...unit);
      swapMemory[lead] = decision.memory;
      traceOf(lead, decision.code, weapon.chargeTypeID, decision.charge.typeID, held, true);
    } else {
      // A swap to another stack waits for its own tick, with last tick's memory.
      traceOf(lead, "other-stack-chosen", weapon.chargeTypeID, decision.charge.typeID, held, inFlight(stored));
    }
  }

  const trace: AmmoTrace = {
    skipped: null,
    targetID: rankedFor.itemID,
    distanceM,
    nextTargetMoment,
    canClose,
    units: unitTraces,
  };

  const settled = settle(swapMemory, leads);
  if (chosen === null) {
    return { swap: null, memory: settled, trace };
  }
  const name = chargeFactsOf(obs, chosen.typeID)?.name ?? null;
  return {
    swap: { moduleIDs: chosen.moduleIDs, chargeItemID: chosen.itemID, why: swapWords(chosen.why, name, chosen.moduleIDs.length) },
    memory: settled,
    trace,
  };
}
