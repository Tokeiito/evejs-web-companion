// R44 — the ladder's identifiers, and whether the fired rung tells the truth.
//
// This file guards the INSTRUMENTATION, not the mining. It asserts three things
// and nothing else:
//
//   1. Every rung has a distinct identifier and a plain-language name, and the
//      catalogue and the loop agree on the set of identifiers — neither can
//      grow a rung the other has never heard of.
//   2. For a representative set of synthetic worlds, the rung the ladder
//      reports is the rung whose row actually describes what it did. This is
//      the claim that makes the readout honest: a fired row that does not match
//      the action is a panel that lies confidently.
//   3. Nothing about a rung is allowed to be a number a player could see.
//
// ⚠ ON THE FOUR RUNGS THAT RESISTED. Two of them (`no-yield-haul`,
// `no-yield-stop`) are marked `unexpressible` in the catalogue, and the tests
// below deliberately do NOT assert that a row-shaped condition reproduces them,
// because it cannot: the real condition counts ticks on which the equipment ran
// AND the hold did not grow. What IS asserted is that those rungs still fire
// from the state the loop actually keeps, and that they are marked honestly.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MINING_LADDER,
  MINING_RUNG_IDS,
  findRung,
  type MiningRungID,
} from "./miningLadder.ts";
import {
  BELT_ARRIVAL_RADIUS_M,
  MAX_NO_YIELD_CYCLES,
  OUT_OF_VIEW,
  decideMiningAction,
  type MiningDecisionMemory,
  type MiningObservation,
  type MiningPlan,
} from "./miningBotLoop.ts";
import { measureSpace } from "./autopilotLoop.ts";
import type {
  FlightStatus,
  MiningHold,
  SpaceEntity,
  SpaceShipStatus,
  SpaceSnapshot,
} from "../store/types.ts";

// --- a world to decide about --------------------------------------------------

const SYSTEM_ID = 30_000_001;
const SHIP_ID = 500;
const BELT_ID = 600;
const STATION_ID = 700;
const ROCK_ID = 800;
const OTHER_ROCK_ID = 801;
const MODULE_ID = 900;
const PIRATE_ID = 1000;
const DRONE_STACK = 1100;
const CHARACTER_ID = 1200;

const PLAN: MiningPlan = {
  beltID: BELT_ID,
  beltName: "Asteroid Belt I",
  stationID: STATION_ID,
  stationName: "Home Station",
  miningModuleIDs: [MODULE_ID],
  healthFloor: 0.5,
  useDrones: true,
  myCharacterID: CHARACTER_ID,
};

// ⚠ NO `as` CASTS IN THESE BUILDERS. The first draft cast them, and the cast
// hid two fixtures that did not match the real shapes at all. A fixture the
// compiler has not checked is a test asserting against a world that cannot
// exist.
function status(overrides: Partial<FlightStatus> = {}): FlightStatus {
  return {
    inSpace: true,
    docked: false,
    solarSystemID: SYSTEM_ID,
    stationID: null,
    structureID: null,
    shipID: SHIP_ID,
    shipMode: "STOP",
    shipSpeedFraction: 0,
    ...overrides,
  };
}

function entity(overrides: Partial<SpaceEntity> & { itemID: number }): SpaceEntity {
  return {
    kind: "asteroid",
    typeID: 1230,
    groupID: null,
    categoryID: null,
    name: "Veldspar",
    ownerID: null,
    radius: 100,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    isSelf: false,
    shieldRatio: null,
    armorRatio: null,
    hullRatio: null,
    characterID: null,
    corporationID: null,
    allianceID: null,
    securityStatus: null,
    maxVelocity: null,
    mode: null,
    capacitorRatio: null,
    remainingQuantity: 5_000,
    miningYieldTypeID: 1230,
    beltID: BELT_ID,
    // ⚠ A ROW IS ONLY A PIRATE IF THE SERVER SAYS IT IS AN NPC. This defaulted
    // to undefined in the first draft of this file and the danger cases fell
    // straight through to "head for the belt" — the fixture, not the loop, was
    // wrong, and the test caught it by failing first.
    isNpc: false,
    npcEntityType: null,
    controllerID: null,
    droneActivity: null,
    targetEntityID: null,
    ...overrides,
  };
}

function ship(overrides: Partial<SpaceShipStatus> = {}): SpaceShipStatus {
  return {
    itemID: SHIP_ID,
    typeID: 17_478,
    name: "Procurer",
    mode: "STOP",
    maxVelocity: 200,
    radius: 50,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    shieldRatio: 1,
    armorRatio: 1,
    hullRatio: 1,
    capacitorRatio: 1,
    shieldCapacity: 1_000,
    armorCapacity: 1_000,
    hullCapacity: 1_000,
    activeModuleIDs: [],
    ...overrides,
  };
}

function snapshot(
  rows: readonly SpaceEntity[],
  shipOverrides: Partial<SpaceShipStatus> = {},
): SpaceSnapshot {
  return {
    inSpace: true,
    solarSystemID: SYSTEM_ID,
    shipID: SHIP_ID,
    sampledAtMs: 0,
    ship: ship(shipOverrides),
    entities: [...rows],
  };
}

function oreHold(used: number, capacity = 5_000, items: readonly number[] = []): MiningHold {
  return {
    key: "ore",
    label: "Ore hold",
    items: items.map((quantity, index) => ({
      itemID: 90_000 + index,
      typeID: 1230,
      quantity,
    })),
    capacity: { capacity, used },
    present: true,
    error: null,
  };
}

const EMPTY_MEMORY: MiningDecisionMemory = {
  currentRockID: null,
  exhaustedRockIDs: new Set<number>(),
  approachingTargetID: null,
  headingHome: null,
  launchGaveUp: false,
  noYieldCycles: 0,
};

function observe(overrides: Partial<MiningObservation> = {}): MiningObservation {
  const space = overrides.snapshot === undefined ? snapshot([]) : overrides.snapshot;
  return {
    status: status(),
    snapshot: space,
    measurement: measureSpace(space),
    lockedTargetIDs: [],
    holds: [oreHold(0)],
    droneBayItemIDs: null,
    ...overrides,
    ...(overrides.measurement === undefined ? { measurement: measureSpace(space) } : {}),
  };
}

function decide(
  overrides: Partial<MiningObservation>,
  mem: Partial<MiningDecisionMemory> = {},
) {
  return decideMiningAction(observe(overrides), PLAN, { ...EMPTY_MEMORY, ...mem });
}

// --- 1. The catalogue ---------------------------------------------------------

test("every rung has a DISTINCT identifier", () => {
  const seen = new Set<string>();
  for (const id of MINING_RUNG_IDS) {
    assert.ok(!seen.has(id), `two rungs share the identifier ${id}`);
    seen.add(id);
  }
  assert.equal(seen.size, MINING_LADDER.length);
  // A ladder that lost its rows would pass every "all of them are distinct"
  // check trivially, so the size is pinned too.
  assert.ok(MINING_LADDER.length >= 20, "the ladder has lost rungs");
});

test("every rung has a plain-language name, and no name is a code or a number", () => {
  for (const rung of MINING_LADDER) {
    // R9a — a sentence a player reads, not a token.
    assert.ok(rung.name.length > 12, `${rung.id} has no real name`);
    assert.match(rung.name, /^[A-Z]/, `${rung.id}'s name does not read as a sentence`);
    // R7d — the name must not be, or contain, the identifier.
    assert.ok(
      !rung.name.toLowerCase().includes(rung.id),
      `${rung.id}'s name leaks its identifier`,
    );
    assert.doesNotMatch(rung.name, /\d/, `${rung.id}'s name contains a number`);
    // Nothing that is not clean may go unexplained: the whole point of marking
    // a distortion is saying what it is.
    if (rung.fit !== "clean") {
      assert.ok(rung.caveat && rung.caveat.length > 20, `${rung.id} is unclean but silent`);
    }
  }
});

test("NO RUNG IDENTIFIER IS AN ORDINARY ENGLISH WORD", () => {
  // ⚠ THIS TEST IS A SCAR. Two rungs were first called `unload` and `undock`,
  // and the panel's own intro sentence ("...hauls a full hold back and unloads
  // it...") contains the first of them — so the R7d sweep that checks no
  // identifier reaches the player could never have meant anything for those
  // two. An identifier that can occur in prose makes its own sweep untestable.
  // Every id must therefore be a hyphenated compound no sentence produces.
  for (const id of MINING_RUNG_IDS) {
    assert.match(id, /^[a-z]+(-[a-z]+)+$/, `${id} is not a hyphenated compound`);
    assert.ok(id.includes("-"), `${id} is a bare word and cannot be swept for`);
  }
});

test("findRung answers for every id, and null for anything else", () => {
  for (const id of MINING_RUNG_IDS) {
    assert.equal(findRung(id)?.id, id);
  }
  assert.equal(findRung(null), null);
  assert.equal(findRung("not-a-rung"), null);
});

test("the four rungs the row model struggled with are marked, not smoothed over", () => {
  // These four are the R44 experiment. If a later change quietly re-labels one
  // of them "clean", that is the claim this test exists to stop.
  assert.equal(findRung("no-yield-haul")?.fit, "unexpressible");
  assert.equal(findRung("no-yield-stop")?.fit, "unexpressible");
  assert.equal(findRung("heading-home")?.fit, "distorted");
  assert.equal(findRung("health-floor")?.fit, "distorted");
  assert.equal(findRung("rock-already-locked")?.fit, "distorted");
  // The two release rungs are SEPARATE rows and must stay separate — merging
  // them is the bug that empties a full belt by bookkeeping.
  assert.notEqual(findRung("rock-out-of-view")?.id, findRung("rock-mined-out")?.id);
  assert.ok(findRung("rock-out-of-view"));
  assert.ok(findRung("rock-mined-out"));
});

// --- 2. The fired rung matches what the bot actually did ----------------------
//
// Each case: a synthetic world, the rung it must report, and an assertion about
// the ACTION, so a rung that drifts away from its own behaviour is caught.

test("docked: reading the hold, unloading, ending the run, undocking", () => {
  const docked = { status: status({ docked: true, inSpace: false }), snapshot: null };

  const reading = decide({ ...docked, holds: null });
  assert.equal(reading.rung, "reading-hold");
  assert.equal(reading.action.kind, "wait");

  const unload = decide({ ...docked, holds: [oreHold(100, 5_000, [400])] });
  assert.equal(unload.rung, "docked-with-ore");
  // ⚠ THE RUNG ID AND THE ACTION KIND ARE DIFFERENT VOCABULARIES and must stay
  // that way. The action kind is what the loop DOES and other code branches on
  // it; the rung id is only a label for the readout. Renaming one must never
  // rename the other.
  assert.equal(unload.action.kind, "unload");

  const over = decide({ ...docked, holds: [oreHold(0)] }, { headingHome: "Your shield got low." });
  assert.equal(over.rung, "run-over");
  assert.equal(over.action.kind, "pause");

  const out = decide({ ...docked, holds: [oreHold(0)] });
  assert.equal(out.rung, "docked-and-empty");
  assert.equal(out.action.kind, "undock");
});

test("before it can act: no location, and mid-warp", () => {
  const nowhere = decide({ status: status({ docked: false, inSpace: false }) });
  assert.equal(nowhere.rung, "no-location");

  const warping = decide({ status: status({ shipMode: "DSTBALL_WARP" }) });
  assert.equal(warping.rung, "in-warp");
  assert.equal(warping.action.kind, "wait");
});

test("danger: the safety floor, an unreadable ship next to a pirate, and the drones", () => {
  const pirate = entity({
    itemID: PIRATE_ID,
    name: "Serpentis Scout",
    kind: "npc",
    ownerID: 1,
    isNpc: true,
    npcEntityType: "pirate",
    miningYieldTypeID: null,
    beltID: null,
    position: { x: 5_000, y: 0, z: 0 },
  });

  // Below the floor: it heads home AND latches the sentence it heads home on.
  const hurt = decide({ snapshot: snapshot([], { shieldRatio: 0.1 }) });
  assert.equal(hurt.rung, "health-floor");
  assert.ok(hurt.headHome, "the health floor must latch its own reason");
  // ⚠ THE LATCH IS A SENTENCE, NOT A FLAG — this is the R44 finding, asserted.
  assert.equal(typeof hurt.headHome, "string");
  assert.match(hurt.headHome ?? "", /10%/);

  // A pirate and no readable health: stop rather than guess.
  const blind = decide({
    snapshot: snapshot([pirate], { shieldRatio: null, armorRatio: null, hullRatio: null }),
  });
  assert.equal(blind.rung, "pirate-unknown-health");
  assert.equal(blind.action.kind, "pause");

  const looking = decide({ snapshot: snapshot([pirate]), droneBayItemIDs: null });
  assert.equal(looking.rung, "reading-drone-bay");

  const launch = decide({ snapshot: snapshot([pirate]), droneBayItemIDs: [DRONE_STACK] });
  assert.equal(launch.rung, "launch-drones");
  assert.equal(launch.action.kind, "launch");
});

test("the hold: the latch is CONSUMED by a different rung from the one that set it", () => {
  // ⚠ THE SECOND HALF OF THE LATCH FINDING. Nothing about `heading-home`'s own
  // row says why the ship is going home — it repeats a sentence another rung
  // wrote. Asserted here so the distortion is a measured fact, not a claim.
  const going = decide({}, { headingHome: "Your drones would not launch." });
  assert.equal(going.rung, "heading-home");
  assert.equal(going.why, "Your drones would not launch.");
  // And it did not write a NEW reason of its own.
  assert.equal(going.headHome, undefined);
});

test("the hold: reaching the haul level takes the load home", () => {
  const full = decide({ holds: [oreHold(4_600)] });
  assert.equal(full.rung, "hold-full");
  assert.equal(full.action.kind, "warp");
});

test("the no-yield rungs fire from a counter no row-shaped condition can hold", () => {
  // ⚠ WHAT THIS TEST DOES NOT CLAIM. `noYieldCycles` is not derivable from this
  // observation: it is a count the CONTROLLER keeps, incremented on ticks where
  // the decision was "mining" and zeroed whenever the hold grew. So the test
  // hands the count in directly, which is exactly the admission that the row
  // model cannot state the condition — a row can only read state, and this
  // state is made of a firing row plus an authority NOT changing, over time.
  const spent = MAX_NO_YIELD_CYCLES + 1;

  const haul = decide({ holds: [oreHold(10, 5_000, [50])] }, { noYieldCycles: spent });
  assert.equal(haul.rung, "no-yield-haul");
  assert.ok(haul.headHome, "hauling on a stall must latch its reason too");

  const stop = decide({ holds: [oreHold(0)] }, { noYieldCycles: spent });
  assert.equal(stop.rung, "no-yield-stop");
  assert.equal(stop.action.kind, "pause");
});

test("the rock: targets unreadable means nothing that depends on a lock is decided", () => {
  const blind = decide({ lockedTargetIDs: null });
  assert.equal(blind.rung, "reading-targets");
});

test("THE TWO RELEASE RUNGS ARE DIFFERENT ROWS WITH DIFFERENT VERBS", () => {
  // ⚠ THE BUG THIS GUARDS. A rock is off the grid for the whole trip to the
  // station and back. Treating "not here" as "finished with" empties a belt by
  // bookkeeping alone, so these two must never collapse into one row.
  const gone = decide({ snapshot: snapshot([]) }, { currentRockID: ROCK_ID });
  assert.equal(gone.rung, "rock-out-of-view");
  assert.equal(gone.dropRock, OUT_OF_VIEW);

  const empty = decide(
    { snapshot: snapshot([entity({ itemID: ROCK_ID, remainingQuantity: 0 })]) },
    { currentRockID: ROCK_ID },
  );
  assert.equal(empty.rung, "rock-mined-out");
  assert.ok(empty.dropRock);
  // The RELEASE VERBS differ, and the controller reads that difference by
  // comparing against OUT_OF_VIEW — which is a string, not a field. That is the
  // distortion, and it is asserted rather than described.
  assert.notEqual(empty.dropRock, OUT_OF_VIEW);
  assert.notEqual(gone.rung, empty.rung);
});

test("the rock: the three equipment rungs", () => {
  const rock = entity({ itemID: ROCK_ID });
  const held = { snapshot: snapshot([rock]), lockedTargetIDs: [ROCK_ID] };
  const mem = { currentRockID: ROCK_ID };

  const unknown = decide(
    { ...held, snapshot: snapshot([rock], { activeModuleIDs: null }) },
    mem,
  );
  assert.equal(unknown.rung, "equipment-unknown");

  const on = decide(held, mem);
  assert.equal(on.rung, "equipment-on");
  assert.equal(on.action.kind, "activate");

  const mining = decide(
    { ...held, snapshot: snapshot([rock], { activeModuleIDs: [MODULE_ID] }) },
    mem,
  );
  assert.equal(mining.rung, "mining-running");
  assert.equal(mining.action.kind, "wait");
});

test("the rock: locking the one it already picked, versus picking a new one", () => {
  const rock = entity({ itemID: ROCK_ID });

  const relock = decide({ snapshot: snapshot([rock]) }, { currentRockID: ROCK_ID });
  assert.equal(relock.rung, "lock-current-rock");
  assert.equal(relock.action.kind, "lock");
  // It is already the current rock, so it is not adopted again.
  assert.equal(relock.takeRock, undefined);

  const fresh = decide({ snapshot: snapshot([rock]) });
  assert.equal(fresh.rung, "lock-nearest-rock");
  assert.equal(fresh.takeRock, ROCK_ID);
});

test("THE ADOPT SHORTCUT: one rung, one action, AND a memory write", () => {
  // ⚠ THE R44 FINDING, ASSERTED. This tick both starts the equipment and
  // remembers the rock. A row model of "one condition, one action" has no place
  // to put the second half, and the row that lights is the SHORTCUT rather than
  // the equipment row whose action it actually borrowed — so `equipment-on`
  // stays dark on a tick that switched the equipment on.
  const rock = entity({ itemID: ROCK_ID });
  const adopted = decide({ snapshot: snapshot([rock]), lockedTargetIDs: [ROCK_ID] });

  assert.equal(adopted.rung, "rock-already-locked");
  assert.equal(adopted.action.kind, "activate");
  assert.equal(adopted.takeRock, ROCK_ID, "the bookkeeping tail the row cannot express");
  assert.notEqual(adopted.rung, "equipment-on");
});

test("the rock: heading for the belt, and arriving to find it empty", () => {
  // Nothing mineable in view and the belt far away: travel. The rung reported
  // is the CALLER, not the travel step — the travel sub-ladder has no rows.
  const belt = entity({
    itemID: BELT_ID,
    name: "Asteroid Belt I",
    kind: "belt",
    miningYieldTypeID: null,
    beltID: null,
    position: { x: BELT_ARRIVAL_RADIUS_M * 40, y: 0, z: 0 },
  });
  const travelling = decide({ snapshot: snapshot([belt]) });
  assert.equal(travelling.rung, "travel-to-belt");
  assert.equal(travelling.action.kind, "warp");

  // Standing at the belt with every rock exhausted: the SAME call site, but a
  // different rule — which is why the arrival is its own rung.
  const rock = entity({ itemID: ROCK_ID });
  const arrived = decide(
    { snapshot: snapshot([entity({ ...belt, position: { x: 100, y: 0, z: 0 } }), rock]) },
    { exhaustedRockIDs: new Set([ROCK_ID]) },
  );
  assert.equal(arrived.rung, "belt-empty");
  assert.equal(arrived.action.kind, "pause");
});

test("the nearest rock with ore is the one picked, and it is the one the rung is about", () => {
  const near = entity({ itemID: ROCK_ID, name: "Veldspar", position: { x: 1_000, y: 0, z: 0 } });
  const far = entity({ itemID: OTHER_ROCK_ID, name: "Scordite", position: { x: 50_000, y: 0, z: 0 } });
  const picked = decide({ snapshot: snapshot([far, near]) });
  assert.equal(picked.rung, "lock-nearest-rock");
  assert.equal(picked.takeRock, ROCK_ID);
});

// --- 3. Every rung the ladder can report is a rung the catalogue knows -------

test("EXHAUSTIVE: every rung the catalogue lists is reachable as a type, and vice versa", () => {
  // The compiler already guarantees `MiningDecision.rung` is a `MiningRungID`,
  // so a rung the loop returns cannot be absent from the union. What it does
  // NOT guarantee is that the CATALOGUE lists every member of that union — a
  // rung could exist in the type and never render. This pins the two together
  // by naming the union's members here, so adding one to the type without
  // adding a row to the ladder fails to compile.
  const every: Record<MiningRungID, true> = {
    "reading-hold": true,
    "docked-with-ore": true,
    "run-over": true,
    "docked-and-empty": true,
    "no-location": true,
    "in-warp": true,
    "health-floor": true,
    "pirate-unknown-health": true,
    "reading-drone-bay": true,
    "launch-drones": true,
    "heading-home": true,
    "hold-full": true,
    "no-yield-haul": true,
    "no-yield-stop": true,
    "reading-targets": true,
    "rock-out-of-view": true,
    "rock-mined-out": true,
    "equipment-unknown": true,
    "equipment-on": true,
    "mining-running": true,
    "lock-current-rock": true,
    "travel-to-belt": true,
    "belt-empty": true,
    "no-rock": true,
    "rock-already-locked": true,
    "lock-nearest-rock": true,
  };
  const declared = Object.keys(every).sort();
  const rendered = [...MINING_RUNG_IDS].sort();
  assert.deepEqual(rendered, declared, "the ladder and the rung type disagree");
});
