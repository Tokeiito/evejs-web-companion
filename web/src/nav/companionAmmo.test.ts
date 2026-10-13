// Ammo by target in the companion ladder: the swap step and the empty-gun
// ranking, mostly END TO END through `decideCompanionAction`, because the
// wiring (rung 7 standing, the lock-ahead's next target, the reload rung above
// rung 7) is what this file exists to pin. The ranking's own rules are pinned
// in ammoRanking.test.ts; the reach arithmetic in ammoReach.test.ts.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decideCompanionAction,
  freshLadderMemory,
  type CompanionDecision,
  type CompanionLadderMemory,
  type FleetCompanionObservation,
  type FleetCompanionRequest,
} from "./fleetCompanionLoop.ts";
import {
  FRESH_COMPANION_AMMO,
  decideAmmoSwap,
  firingUnits,
  ratResonancesFromAttributes,
  weaponCycleFromAttributes,
  type AmmoLadder,
} from "./companionAmmo.ts";
import { chargeFactsFromAttributes } from "./ammoReach.ts";
import type { CombatWeapon } from "./combatWeapons.ts";
import {
  FIGHT_GUN_1,
  FIGHT_GUN_2,
  RAT,
  RAT_2,
  TWO_GUNS,
  TYPE_LONG_RAT,
  TYPE_SHORT_RAT,
  fightGrid,
  fightObs,
} from "./fightFixtures.test-util.ts";
import type { SpaceSnapshot } from "../store/types.ts";

// ─── Fixtures (synthetic ids throughout) ─────────────────────────────────────

const ONE_GUN: FleetCompanionRequest = { ...TWO_GUNS, weaponModuleIDs: [FIGHT_GUN_1] };
const GUN_TYPE = 3001;
const HYBRID = 85;
/** Short range, the most raw damage: 12 a shot. Loaded, it reaches 20 km. */
const A = 9101;
/** Long range, little damage: 5 a shot. In the same gun it reaches 29 km. */
const B = 9102;
/** Short range like A, all thermal: 12 a shot. */
const C = 9103;
const STACK_A = 7001;
const STACK_B = 7002;
const STACK_C = 7003;

const CHARGES = {
  [A]: chargeFactsFromAttributes({ 117: 7, 118: 5, 120: 0.5, 128: 1 }, "Charge A"),
  [B]: chargeFactsFromAttributes({ 117: 3, 118: 2, 120: 0.8, 128: 1 }, "Charge B"),
  [C]: chargeFactsFromAttributes({ 118: 12, 120: 0.5, 128: 1 }, "Charge C"),
};

/** A gun loaded with `chargeTypeID`: measured optimal 15 km, reach 20 km (base optimal 30 km, falloff 5 km). */
function loadedGun(itemID: number, chargeTypeID: number | null = A): CombatWeapon {
  return {
    itemID, typeID: GUN_TYPE, chargeTypeID, chargeQuantity: chargeTypeID === null ? 0 : 40,
    acceptedGroups: [HYBRID], chargeSize: 1,
    reachM: chargeTypeID === null ? null : 20_000, optimalM: chargeTypeID === null ? null : 15_000, tracking: 0.1,
  };
}

function stack(itemID: number, typeID: number, quantity: number) {
  return { itemID, typeID, groupID: HYBRID, quantity };
}

const ALL_THREE = [stack(STACK_A, A, 1_000), stack(STACK_B, B, 500), stack(STACK_C, C, 500)];

/** Kinetic-resistant on every layer: C does 12, A does 7 x 0.2 + 5 = 6.4. */
const KINETIC_TANK = ratResonancesFromAttributes({ 273: 0.2, 269: 0.2, 109: 0.2 })!;

/** A grid with the rat (and optionally a second) at `x`, our guns cycling, banks as given. */
function grid(
  x: number,
  options: {
    readonly rats?: readonly { readonly itemID: number; readonly typeID: number; readonly x: number }[];
    readonly active?: readonly number[];
    readonly banks?: Readonly<Record<number, readonly number[]>>;
    readonly ratios?: Readonly<Record<number, { shieldRatio: number; armorRatio: number; hullRatio: number }>>;
  } = {},
): SpaceSnapshot {
  const base = fightGrid({
    rats: options.rats ?? [{ itemID: RAT, typeID: TYPE_LONG_RAT, x }],
    activeModuleIDs: options.active ?? [FIGHT_GUN_1],
  });
  return {
    ...base,
    ship: { ...base.ship!, weaponBanks: options.banks ?? {} },
    entities: base.entities.map((entity) =>
      options.ratios?.[entity.itemID] === undefined ? entity : { ...entity, ...options.ratios[entity.itemID] }),
  } as SpaceSnapshot;
}

function ammoObs(
  snapshot: SpaceSnapshot,
  overrides: Partial<FleetCompanionObservation> = {},
  weapons: readonly CombatWeapon[] = [loadedGun(FIGHT_GUN_1)],
): FleetCompanionObservation {
  return fightObs(weapons, snapshot, RAT, {
    cargoCharges: ALL_THREE,
    weaponChargeGroups: Object.fromEntries(weapons.map((weapon) => [weapon.itemID, [HYBRID]])),
    emptyWeaponModuleIDs: [],
    chargeFactsByTypeID: CHARGES,
    ...overrides,
  });
}

/** Rung 7 already firing the guns at RAT: its decision this tick is a standing readout. */
function firing(guns: readonly number[] = [FIGHT_GUN_1], base: CompanionLadderMemory = freshLadderMemory()): CompanionLadderMemory {
  return { ...base, lastFireTargetID: RAT, lastFireModuleIDs: [...guns] };
}

const T0 = 5_000_000;

function run(
  obsAt: (tick: number) => FleetCompanionObservation,
  ticks: number,
  memory: CompanionLadderMemory = firing(),
  request: FleetCompanionRequest = ONE_GUN,
): { readonly decisions: readonly CompanionDecision[]; readonly memory: CompanionLadderMemory } {
  const decisions: CompanionDecision[] = [];
  let mem = memory;
  for (let tick = 0; tick < ticks; tick++) {
    const decision = decideCompanionAction(request, obsAt(tick), mem, T0 + tick * 2_000);
    decisions.push(decision);
    mem = decision.memory;
  }
  return { decisions, memory: mem };
}

const loads = (decisions: readonly CompanionDecision[]): readonly CompanionDecision[] =>
  decisions.filter((decision) => decision.action.kind === "loadAmmo");

// ─── The swap, end to end ────────────────────────────────────────────────────

test("out of reach and unable to close: the longer charge is loaded after five ticks, once", () => {
  // Follow mode (the default): the ship cannot close. 25 km: past A's 20 km, inside B's 29 km.
  const { decisions } = run(() => ammoObs(grid(25_000)), 12);
  const swaps = loads(decisions);
  assert.equal(swaps.length, 1, "one swap, then the pending latch holds");
  assert.equal(decisions.indexOf(swaps[0]!), 4, "on the fifth tick, not before");
  assert.deepEqual(swaps[0]!.action, { kind: "loadAmmo", moduleIDs: [FIGHT_GUN_1], chargeItemID: STACK_B });
  assert.match(swaps[0]!.why, /^Changing ammo to Charge B -- loading the longer-range charge/);
  assert.equal(swaps[0]!.phase, "Obeying fleet");
  assert.equal(swaps[0]!.followingOrderFrom, "tag");
  for (const decision of decisions.slice(0, 4)) {
    assert.equal(decision.action.kind, "wait", "the standing readout until then");
  }
});

test("an x / x+1 / x wobble across a reach edge issues no loadAmmo in 20 ticks", () => {
  // Across A's sticky edge (20 km + 500 m): A applies on every even tick.
  const acrossLoaded = run((tick) => ammoObs(grid(tick % 2 === 0 ? 20_500 : 20_501)), 20);
  assert.equal(loads(acrossLoaded.decisions).length, 0);
  // Across B's entry edge (29 km - 500 m), with A out of reach throughout.
  const acrossOther = run((tick) => ammoObs(grid(tick % 2 === 0 ? 28_500 : 28_501)), 20);
  assert.equal(loads(acrossOther.decisions).length, 0);
});

test("no swap while the ship can still close; once the closing budget is spent, it swaps", () => {
  const closing: CompanionLadderMemory = {
    ...firing(),
    flightMode: "auto",
    combatPosition: {
      hold: null, reform: false,
      target: { targetID: RAT, farTicks: 3, spentAtM: null, closing: true, leashed: false },
    },
  };
  const ladder: AmmoLadder = { nextTarget: () => null, remainingHitPoints: () => null };
  const obs = ammoObs(grid(25_000));
  let memory = closing;
  for (let tick = 0; tick < 10; tick++) {
    const step = decideAmmoSwap(ONE_GUN, obs, memory, RAT, T0 + tick * 2_000, ladder);
    assert.equal(step.swap, null, `closing beats reloading (tick ${tick})`);
    memory = step.memory;
  }
  const spent = {
    ...memory,
    combatPosition: { ...memory.combatPosition, target: { ...memory.combatPosition.target!, spentAtM: 25_000 } },
  };
  const step = decideAmmoSwap(ONE_GUN, obs, spent, RAT, T0 + 30_000, ladder);
  assert.deepEqual(step.swap?.moduleIDs, [FIGHT_GUN_1]);
  assert.equal(step.swap?.chargeItemID, STACK_B);
});

test("lock-ahead moment: the gun is loaded for the next target at once, then left alone", () => {
  const snapshot = grid(10_000, {
    rats: [{ itemID: RAT, typeID: TYPE_LONG_RAT, x: 10_000 }, { itemID: RAT_2, typeID: TYPE_SHORT_RAT, x: 12_000 }],
    ratios: { [RAT]: { shieldRatio: 0, armorRatio: 0, hullRatio: 0.5 } },
  });
  const obs = ammoObs(snapshot, {
    lockedTargetIDs: [RAT, RAT_2],
    hitPointsByTypeID: { [TYPE_LONG_RAT]: { shield: 1_000, armor: 1_000, hull: 1_000 } },
    ratResonancesByTypeID: { [TYPE_SHORT_RAT]: KINETIC_TANK },
  });
  const { decisions } = run(() => obs, 6);
  assert.deepEqual(decisions[0]!.action, { kind: "loadAmmo", moduleIDs: [FIGHT_GUN_1], chargeItemID: STACK_C },
    "no persistence on the lock-ahead tick");
  assert.match(decisions[0]!.why, /Charge C -- loading the better charge for the next target/);
  assert.equal(loads(decisions).length, 1, "the pending latch holds after it");

  // The same grid with the current target healthy: nothing is loaded for the next one.
  const healthy = grid(10_000, {
    rats: [{ itemID: RAT, typeID: TYPE_LONG_RAT, x: 10_000 }, { itemID: RAT_2, typeID: TYPE_SHORT_RAT, x: 12_000 }],
    ratios: { [RAT]: { shieldRatio: 1, armorRatio: 1, hullRatio: 1 } },
  });
  const calm = run(() => ammoObs(healthy, {
    lockedTargetIDs: [RAT, RAT_2],
    hitPointsByTypeID: { [TYPE_LONG_RAT]: { shield: 1_000, armor: 1_000, hull: 1_000 } },
    ratResonancesByTypeID: { [TYPE_SHORT_RAT]: KINETIC_TANK },
  }), 8);
  assert.equal(loads(calm.decisions).length, 0, "A and C are equal against the current target");
});

test("one ammo type aboard never swaps, however long the target sits out of reach", () => {
  const { decisions } = run(() => ammoObs(grid(25_000), { cargoCharges: [stack(STACK_A, A, 1_000)] }), 20);
  assert.equal(loads(decisions).length, 0);
});

test("a charge that is clearly better against the target is swapped in mid-fight after persistence", () => {
  const snapshot = grid(10_000, { ratios: { [RAT]: { shieldRatio: 1, armorRatio: 1, hullRatio: 1 } } });
  const { decisions } = run(() => ammoObs(snapshot, {
    hitPointsByTypeID: { [TYPE_LONG_RAT]: { shield: 50_000, armor: 50_000, hull: 50_000 } },
    ratResonancesByTypeID: { [TYPE_LONG_RAT]: KINETIC_TANK },
    weaponCycleByTypeID: { [GUN_TYPE]: weaponCycleFromAttributes({ 51: 4_000, 64: 2 })! },
  }), 8);
  const swaps = loads(decisions);
  assert.equal(swaps.length, 1);
  assert.equal(decisions.indexOf(swaps[0]!), 4);
  assert.equal((swaps[0]!.action as { chargeItemID: number }).chargeItemID, STACK_C);

  // A target that dies before the reload pays off is not swapped for.
  const fragile = run(() => ammoObs(snapshot, {
    // 30 HP left; the reload's silence costs 6.4 x 2 x (10 s / 4 s) = 32.
    hitPointsByTypeID: { [TYPE_LONG_RAT]: { shield: 10, armor: 10, hull: 10 } },
    ratResonancesByTypeID: { [TYPE_LONG_RAT]: KINETIC_TANK },
    weaponCycleByTypeID: { [GUN_TYPE]: weaponCycleFromAttributes({ 51: 4_000, 64: 2 })! },
  }), 8);
  assert.equal(loads(fragile.decisions).length, 0);
});

test("banked guns swap together, in one call, remembered once", () => {
  const snapshot = grid(25_000, { active: [FIGHT_GUN_1], banks: { [FIGHT_GUN_1]: [FIGHT_GUN_2] } });
  const weapons = [loadedGun(FIGHT_GUN_1), loadedGun(FIGHT_GUN_2)];
  const { decisions, memory } = run(() => ammoObs(snapshot, {}, weapons), 6, firing([FIGHT_GUN_1, FIGHT_GUN_2]), TWO_GUNS);
  const swaps = loads(decisions);
  assert.equal(swaps.length, 1);
  assert.deepEqual(swaps[0]!.action, { kind: "loadAmmo", moduleIDs: [FIGHT_GUN_1, FIGHT_GUN_2], chargeItemID: STACK_B });
  assert.match(swaps[0]!.why, /\(2 guns\)/);
  assert.deepEqual(Object.keys(memory.ammo.swap), [String(FIGHT_GUN_1)]);

  // Two unbanked guns that pick the same stack on the same tick also share the call.
  const loose = run(() => ammoObs(grid(25_000, { active: [FIGHT_GUN_1, FIGHT_GUN_2] }), {}, weapons), 6,
    firing([FIGHT_GUN_1, FIGHT_GUN_2]), TWO_GUNS);
  assert.deepEqual(loads(loose.decisions).map((decision) => decision.action),
    [{ kind: "loadAmmo", moduleIDs: [FIGHT_GUN_1, FIGHT_GUN_2], chargeItemID: STACK_B }]);
});

test("firing units: a bank is one unit led by its master, in the request's order", () => {
  assert.deepEqual(firingUnits([1, 2, 3, 4], { 2: [4] }), [[1], [2, 4], [3]]);
  assert.deepEqual(firingUnits([1, 2], null), [[1], [2]]);
  assert.deepEqual(firingUnits([4, 2], { 2: [4] }), [[2, 4]], "a slave picked first still names the bank");
});

// ─── Empty guns ──────────────────────────────────────────────────────────────

test("an empty gun takes the ranked stack when the target is known, the largest otherwise", () => {
  const empty = [loadedGun(FIGHT_GUN_1, null)];
  const known = {
    ...FRESH_COMPANION_AMMO,
    targetID: RAT,
    lastLoaded: { [FIGHT_GUN_1]: { chargeTypeID: A, reachM: 20_000, optimalM: 15_000, turret: true } },
  };
  const obs = ammoObs(grid(25_000, { active: [] }), { emptyWeaponModuleIDs: [FIGHT_GUN_1] }, empty);
  const ranked = decideCompanionAction(ONE_GUN, obs, { ...freshLadderMemory(), ammo: known }, T0);
  assert.deepEqual(ranked.action, { kind: "loadAmmo", moduleIDs: [FIGHT_GUN_1], chargeItemID: STACK_B },
    "B reaches the rat at 25 km; the larger A stack does not");

  const unknown = decideCompanionAction(ONE_GUN, obs, freshLadderMemory(), T0);
  assert.deepEqual(unknown.action, { kind: "loadAmmo", moduleIDs: [FIGHT_GUN_1], chargeItemID: STACK_A },
    "no target known: today's largest-stack rule");
});

test("a loaded gun's measured reach is remembered for when it runs dry; the engaged target too", () => {
  const { memory } = run(() => ammoObs(grid(10_000)), 1);
  assert.deepEqual(memory.ammo.lastLoaded[FIGHT_GUN_1], { chargeTypeID: A, reachM: 20_000, optimalM: 15_000, turret: true });
  assert.equal(memory.ammo.targetID, RAT);
});

test("rat resonances: absent attributes are no resist; an unknown type is unknown", () => {
  assert.deepEqual(KINETIC_TANK.shield, { em: 1, thermal: 1, kinetic: 0.2, explosive: 1 });
  assert.equal(ratResonancesFromAttributes({}), null);
  assert.equal(ratResonancesFromAttributes(undefined), null);
  const full = ratResonancesFromAttributes({
    271: 0.1, 274: 0.2, 273: 0.3, 272: 0.4, 267: 0.5, 270: 0.6, 269: 0.7, 268: 0.8, 113: 0.9, 110: 0.11, 109: 0.12, 111: 0.13,
  })!;
  assert.deepEqual(full.shield, { em: 0.1, thermal: 0.2, kinetic: 0.3, explosive: 0.4 });
  assert.deepEqual(full.armor, { em: 0.5, thermal: 0.6, kinetic: 0.7, explosive: 0.8 });
  assert.deepEqual(full.hull, { em: 0.9, thermal: 0.11, kinetic: 0.12, explosive: 0.13 });
});
