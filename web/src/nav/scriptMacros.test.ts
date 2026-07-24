// B1 — the macro adapters' key transitions. Pins each block's task loop so a
// wrong turn surfaces here, not on a live ship: undock, the mine state machine
// (warp to belt / orbit / lock / activate), deliver (dock + unload), defend.

import test from "node:test";
import assert from "node:assert/strict";

import type { FlightStatus, MiningHold, SpaceEntity, SpaceShipStatus, SpaceSnapshot, SpaceVector } from "../store/types.ts";
import type { MacroMemory } from "./scriptDecide.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import type { MacroStep } from "../bots/botScript.ts";
import { SCRIPT_MACROS } from "./scriptMacros.ts";

const ORIGIN: SpaceVector = { x: 0, y: 0, z: 0 };

function entity(over: Partial<SpaceEntity> & { itemID: number }): SpaceEntity {
  return {
    kind: "celestial", typeID: 1, groupID: 1, categoryID: 2, name: null, ownerID: null,
    radius: 10, position: ORIGIN, velocity: ORIGIN, isSelf: false,
    shieldRatio: null, armorRatio: null, hullRatio: null, characterID: null, corporationID: null,
    allianceID: null, securityStatus: null, maxVelocity: null, mode: null, capacitorRatio: null,
    remainingQuantity: null, miningYieldTypeID: null, beltID: null, isNpc: false, npcEntityType: null,
    controllerID: null, droneActivity: null, targetEntityID: null,
    ...over,
  };
}

function ship(over: Partial<SpaceShipStatus> = {}): SpaceShipStatus {
  return {
    itemID: 9001, typeID: 17476, name: "Procurer", mode: null, maxVelocity: 100, radius: 100,
    position: ORIGIN, velocity: ORIGIN, shieldRatio: 1, armorRatio: 1, hullRatio: 1, capacitorRatio: 1,
    shieldCapacity: null, armorCapacity: null, hullCapacity: null, activeModuleIDs: [],
    ...over,
  } as SpaceShipStatus;
}

function snapshot(entities: SpaceEntity[], shipOver: Partial<SpaceShipStatus> = {}): SpaceSnapshot {
  return { inSpace: true, solarSystemID: 30000142, shipID: 9001, sampledAtMs: 1, entities, ship: ship(shipOver) };
}

function flight(over: Partial<FlightStatus> = {}): FlightStatus {
  return { inSpace: true, docked: false, solarSystemID: 30000142, stationID: null, structureID: null, shipID: 9001, shipMode: null, shipSpeedFraction: null, ...over };
}

function obs(over: Partial<ScriptObservation> = {}): ScriptObservation {
  return {
    inSpace: true, docked: false, inWarp: false,
    shieldRatio: 1, armorRatio: 1, hullRatio: 1, health: 1,
    oreHoldFraction: 0, holdEmpty: true, hostileOnGrid: false, dronesOut: false,
    flightStatus: flight(), snapshot: null, lockedTargetIDs: [], holds: null, droneBayItemIDs: [],
    miningModuleIDs: [], startingStationID: null,
    ...over,
  };
}

const mineStep: MacroStep = { id: "m", kind: "macro", macro: "mine-at-belt", args: { belt: { kind: "belt", belt: { mode: "nearest" } } }, until: { kind: "ore-hold-at-least", fraction: 0.9 } };
const haulStep: MacroStep = { id: "h", kind: "macro", macro: "deliver-ore", args: { station: { kind: "station", ref: { entity: "station", id: 60000004, name: "Home", systemName: null } } } };
const mine = SCRIPT_MACROS["mine-at-belt"]!;
const deliver = SCRIPT_MACROS["deliver-ore"]!;
const undock = SCRIPT_MACROS["undock"]!;
const defend = SCRIPT_MACROS["defend-with-drones"]!;
const NM: MacroMemory = {};

test("undock: docked -> undock, in space -> done", () => {
  assert.equal(undock({ id: "u", kind: "macro", macro: "undock", args: {} }, obs({ flightStatus: flight({ docked: true, inSpace: false }) }), NM, {}).action.kind, "undock");
  assert.equal(undock({ id: "u", kind: "macro", macro: "undock", args: {} }, obs({ flightStatus: flight({ docked: false }) }), NM, {}).outcome.kind, "done");
});

test("mine: no rocks but a distant belt -> warp to the belt", () => {
  const belt = entity({ itemID: 40001, name: "Asteroid Belt 1", position: { x: 500000, y: 0, z: 0 } });
  const t = mine(mineStep, obs({ snapshot: snapshot([belt]) }), NM, {});
  assert.equal(t.action.kind, "warp");
  assert.ok(t.action.kind === "warp" && t.action.targetID === 40001);
});

test("mine: a rock in range -> orbit it at 5km and remember it", () => {
  const rock = entity({ itemID: 50001, name: "Veldspar", miningYieldTypeID: 1230, beltID: 40001, position: { x: 8000, y: 0, z: 0 } });
  const t = mine(mineStep, obs({ snapshot: snapshot([rock]) }), NM, {});
  assert.equal(t.action.kind, "orbit");
  assert.ok(t.action.kind === "orbit" && t.action.targetID === 50001 && t.action.range === 5000);
  assert.equal(t.nextMem["rockID"], 50001);
});

test("mine: rock locked, a miner idle -> activate it on the rock", () => {
  const rock = entity({ itemID: 50001, name: "Veldspar", miningYieldTypeID: 1230, position: { x: 4000, y: 0, z: 0 } });
  const t = mine(
    mineStep,
    obs({ snapshot: snapshot([rock], { activeModuleIDs: [] }), lockedTargetIDs: [50001], miningModuleIDs: [700, 701] }),
    { rockID: 50001, lockIssued: true, waited: 0 },
    {},
  );
  assert.ok(t.action.kind === "activate" && t.action.targetID === 50001 && t.action.moduleID === 700);
});

test("mine: rock locked, all miners running -> wait (mining)", () => {
  const rock = entity({ itemID: 50001, name: "Veldspar", miningYieldTypeID: 1230, position: { x: 4000, y: 0, z: 0 } });
  const t = mine(
    mineStep,
    obs({ snapshot: snapshot([rock], { activeModuleIDs: [700] }), lockedTargetIDs: [50001], miningModuleIDs: [700] }),
    { rockID: 50001, lockIssued: true, waited: 0 },
    {},
  );
  assert.equal(t.action.kind, "wait");
  assert.match(t.phase, /Mining/);
});

test("deliver: docked with ore -> unload; docked empty -> done", () => {
  const withOre: MiningHold[] = [{ key: "ore", label: "Ore Hold", items: [{ itemID: 8, typeID: 1230, quantity: 100 }], capacity: null, present: true, error: null }];
  const unload = deliver(haulStep, obs({ flightStatus: flight({ docked: true, inSpace: false, stationID: 60000004 }), holds: withOre }), NM, {});
  assert.ok(unload.action.kind === "unloadOre" && unload.action.itemIDs.includes(8));

  const done = deliver(haulStep, obs({ flightStatus: flight({ docked: true, inSpace: false, stationID: 60000004 }), holds: [] }), NM, {});
  assert.equal(done.outcome.kind, "done");
});

test("deliver: in space, away from the station -> ride the autopilot there (multi-system)", () => {
  const t = deliver(haulStep, obs({ snapshot: snapshot([]) }), NM, {});
  assert.ok(t.action.kind === "startRoute" && t.action.stationID === 60000004);
});

test("deliver: docked at the WRONG station -> not done, heads for the right one", () => {
  const t = deliver(haulStep, obs({ flightStatus: flight({ docked: true, inSpace: false, stationID: 60000099 }), snapshot: null }), NM, {});
  assert.ok(t.action.kind === "startRoute" && t.action.stationID === 60000004);
});

test("deliver: drones out -> recall them first (never abandon them)", () => {
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });
  const t = deliver(haulStep, obs({ snapshot: snapshot([drone]), dronesOut: true }), NM, {});
  assert.ok(t.action.kind === "recallDrones" && t.action.droneIDs.includes(111));
  assert.equal(t.nextMem["recalled"], true);
});

test("deliver: recalled but still out -> align out toward the station while they come home", () => {
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });
  // The station is ON THIS GRID, so the wait is spent already aligned toward it.
  const station = entity({ itemID: 60000004, kind: "station", position: { x: 900000, y: 0, z: 0 } });
  const t = deliver(haulStep, obs({ snapshot: snapshot([drone, station]), dronesOut: true }), { recalled: true }, {});
  assert.ok(t.action.kind === "align" && t.action.targetID === 60000004);
});

test("deliver: recalled, station OFF-grid -> no align (nothing to align to), just hold", () => {
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });
  const t = deliver(haulStep, obs({ snapshot: snapshot([drone]), dronesOut: true }), { recalled: true }, {});
  assert.equal(t.action.kind, "wait");
});

test("deliver: recalled + aligned, still out -> hold until they're all in", () => {
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });
  const t = deliver(haulStep, obs({ snapshot: snapshot([drone]), dronesOut: true }), { recalled: true, aligned: true, recallWaited: 1 }, {});
  assert.equal(t.action.kind, "wait");
});

test("deliver: 0 drones in space -> head out", () => {
  const t = deliver(haulStep, obs({ snapshot: snapshot([]), dronesOut: false }), { recalled: true, aligned: true, recallWaited: 3 }, {});
  assert.ok(t.action.kind === "startRoute" && t.action.stationID === 60000004);
});

test("deliver: drones never make it home -> leave anyway once the wait is spent", () => {
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });
  const t = deliver(haulStep, obs({ snapshot: snapshot([drone]), dronesOut: true }), { recalled: true, aligned: true, recallWaited: 999 }, {});
  assert.ok(t.action.kind === "startRoute" && t.action.stationID === 60000004);
});

test("defend: drones in the bay, none out -> launch them", () => {
  const t = defend({ id: "d", kind: "macro", macro: "defend-with-drones", args: {} }, obs({ snapshot: snapshot([]), dronesOut: false, droneBayItemIDs: [111, 112] }), NM, {});
  assert.ok(t.action.kind === "launchDrones" && t.action.droneItemIDs.length === 2);
});

test("defend: pirate dead but drones still out -> recall them, not done yet", () => {
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });
  const t = defend({ id: "d", kind: "macro", macro: "defend-with-drones", args: {} }, obs({ snapshot: snapshot([drone]), dronesOut: true }), NM, {});
  assert.ok(t.action.kind === "recallDrones" && t.action.droneIDs.includes(111));
  assert.notEqual(t.outcome.kind, "done");
});

test("travel-to-station: rides the shared autopilot (multi-system) and is done only at the TARGET", () => {
  const travelTo = SCRIPT_MACROS["travel-to-station"]!;
  const s: MacroStep = { id: "t", kind: "macro", macro: "travel-to-station", args: { station: { kind: "station", ref: { entity: "station", id: 60000007, name: "Far", systemName: null } } } };

  // In space, target off-grid -> hand the trip to the autopilot.
  const go = travelTo(s, obs({ snapshot: snapshot([]) }), {}, {});
  assert.ok(go.action.kind === "startRoute" && go.action.stationID === 60000007);

  // The autopilot flying it -> wait, don't re-issue.
  const riding = travelTo(
    s,
    obs({ snapshot: snapshot([]), travel: { status: "running", destinationStationID: 60000007, remainingJumps: 3, failureReason: null } }),
    {},
    {},
  );
  assert.equal(riding.action.kind, "wait");

  // Docked SOMEWHERE ELSE is not arrived — it heads out again.
  const wrongStation = travelTo(s, obs({ flightStatus: flight({ docked: true, inSpace: false, stationID: 60000004 }), snapshot: null }), {}, {});
  assert.ok(wrongStation.action.kind === "startRoute");

  // Docked at the target -> done.
  const arrived = travelTo(s, obs({ flightStatus: flight({ docked: true, inSpace: false, stationID: 60000007 }), snapshot: null }), {}, {});
  assert.equal(arrived.outcome.kind, "done");

  // A STALE failure from an old route does not block a fresh trip.
  const staleFailure = travelTo(
    s,
    obs({ snapshot: snapshot([]), travel: { status: "idle", destinationStationID: 60000099, remainingJumps: 0, failureReason: "old news" } }),
    {},
    {},
  );
  assert.ok(staleFailure.action.kind === "startRoute", "a failure on ANOTHER destination is ignored");
});

test("salvage: wrecks + drones out -> set them salvaging (auto-pick); grid clean -> recall, then done", () => {
  const salvage = SCRIPT_MACROS["salvage-wrecks"]!;
  const s = { id: "sv", kind: "macro", macro: "salvage-wrecks", args: {} } as const;
  const wreck = entity({ itemID: 70001, kind: "wreck", name: "Wreck", position: { x: 3000, y: 0, z: 0 } });
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });

  const sweep = salvage(s, obs({ snapshot: snapshot([wreck, drone]), dronesOut: true }), {}, {});
  assert.ok(sweep.action.kind === "salvageDrones" && sweep.action.targetID === 0 && sweep.action.droneIDs.includes(111));

  const recall = salvage(s, obs({ snapshot: snapshot([drone]), dronesOut: true }), {}, {});
  assert.ok(recall.action.kind === "recallDrones");

  const done = salvage(s, obs({ snapshot: snapshot([]) }), {}, {});
  assert.equal(done.outcome.kind, "done");
});

test("salvage: no drones, salvager fitted -> approach, lock, run it on the wreck", () => {
  const salvage = SCRIPT_MACROS["salvage-wrecks"]!;
  const s = { id: "sv", kind: "macro", macro: "salvage-wrecks", args: {} } as const;
  const wreck = entity({ itemID: 70001, kind: "wreck", position: { x: 3000, y: 0, z: 0 } });

  const go = salvage(s, obs({ snapshot: snapshot([wreck]), salvageModuleIDs: [800] }), {}, {});
  assert.ok(go.action.kind === "approach" && go.action.targetID === 70001);

  const run = salvage(
    s,
    obs({ snapshot: snapshot([wreck]), salvageModuleIDs: [800], lockedTargetIDs: [70001] }),
    { wreckID: 70001, lockIssued: true, waited: 0 },
    {},
  );
  assert.ok(run.action.kind === "activate" && run.action.moduleID === 800 && run.action.targetID === 70001);
});

test("salvage: nothing to salvage with -> blocked with a plain reason", () => {
  const salvage = SCRIPT_MACROS["salvage-wrecks"]!;
  const s = { id: "sv", kind: "macro", macro: "salvage-wrecks", args: {} } as const;
  const wreck = entity({ itemID: 70001, kind: "wreck", position: { x: 3000, y: 0, z: 0 } });
  const t = salvage(s, obs({ snapshot: snapshot([wreck]), salvageModuleIDs: [], droneBayItemIDs: [] }), {}, {});
  assert.equal(t.outcome.kind, "blocked");
});

test("loot: only YOUR wrecks are ever opened — others' and unknown-owner wrecks never", () => {
  const loot = SCRIPT_MACROS["loot-wrecks"]!;
  const s = { id: "lw", kind: "macro", macro: "loot-wrecks", args: {} } as const;
  const mine = entity({ itemID: 70001, kind: "wreck", ownerID: 90000001, position: { x: 1000, y: 0, z: 0 } });
  const theirs = entity({ itemID: 70002, kind: "wreck", ownerID: 555, position: { x: 500, y: 0, z: 0 } });
  const unknown = entity({ itemID: 70003, kind: "wreck", ownerID: null, position: { x: 200, y: 0, z: 0 } });

  // Mine is FARTHEST, yet it is the only one this block will ever touch.
  const t = loot(s, obs({ snapshot: snapshot([mine, theirs, unknown]), myCharacterID: 90000001 }), {}, {});
  assert.ok(t.action.kind === "lootWreck" && t.action.wreckID === 70001);

  // Nothing of ours left -> done, with the other wrecks still on grid untouched.
  const done = loot(s, obs({ snapshot: snapshot([theirs, unknown]), myCharacterID: 90000001 }), {}, {});
  assert.equal(done.outcome.kind, "done");
});

test("loot: far from your wreck -> approach first; looted wrecks are not reopened", () => {
  const loot = SCRIPT_MACROS["loot-wrecks"]!;
  const s = { id: "lw", kind: "macro", macro: "loot-wrecks", args: {} } as const;
  const far = entity({ itemID: 70001, kind: "wreck", ownerID: 90000001, position: { x: 90000, y: 0, z: 0 } });

  const go = loot(s, obs({ snapshot: snapshot([far]), myCharacterID: 90000001 }), {}, {});
  assert.ok(go.action.kind === "approach" && go.action.targetID === 70001);

  const skip = loot(s, obs({ snapshot: snapshot([far]), myCharacterID: 90000001 }), { looted: [70001] }, {});
  assert.equal(skip.outcome.kind, "done", "an already-looted wreck is never reopened");
});

test("hardeners-on: switches idle hardeners on one per tick; all running -> done; none fitted -> blocked", () => {
  const hardeners = SCRIPT_MACROS["hardeners-on"]!;
  const s = { id: "hd", kind: "macro", macro: "hardeners-on", args: {} } as const;

  const on = hardeners(s, obs({ snapshot: snapshot([], { activeModuleIDs: [] }), hardenerModuleIDs: [900, 901] }), {}, {});
  assert.ok(on.action.kind === "activate" && on.action.moduleID === 900 && on.action.targetID === 0);

  const done = hardeners(s, obs({ snapshot: snapshot([], { activeModuleIDs: [900, 901] }), hardenerModuleIDs: [900, 901] }), {}, {});
  assert.equal(done.outcome.kind, "done");

  const none = hardeners(s, obs({ snapshot: snapshot([]), hardenerModuleIDs: [] }), {}, {});
  assert.equal(none.outcome.kind, "blocked");
});

test("fight: locks the NEAREST rat, drones on it, then every idle gun on it", () => {
  const fight = SCRIPT_MACROS["fight-the-rats"]!;
  const s = { id: "f", kind: "macro", macro: "fight-the-rats", args: {} } as const;
  const near = entity({ itemID: 6661, kind: "ship", isNpc: true, npcEntityType: "npc", position: { x: 5000, y: 0, z: 0 } });
  const far = entity({ itemID: 6662, kind: "ship", isNpc: true, npcEntityType: "npc", position: { x: 90000, y: 0, z: 0 } });
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });

  // First tick: lock the NEAR one (concentrated fire), remember it.
  const lock = fight(s, obs({ snapshot: snapshot([far, near, drone]), dronesOut: true, weaponModuleIDs: [500] }), {}, {});
  assert.ok(lock.action.kind === "lock" && lock.action.targetID === 6661);

  // Locked: drones onto it first…
  const engage = fight(
    s,
    obs({ snapshot: snapshot([near, drone]), dronesOut: true, lockedTargetIDs: [6661], weaponModuleIDs: [500] }),
    { targetID: 6661, lockIssued: true, waited: 0, dronesOn: null },
    {},
  );
  assert.ok(engage.action.kind === "engageDrones" && engage.action.targetID === 6661);

  // …then the idle gun.
  const guns = fight(
    s,
    obs({ snapshot: snapshot([near, drone]), dronesOut: true, lockedTargetIDs: [6661], weaponModuleIDs: [500] }),
    { targetID: 6661, lockIssued: true, waited: 0, dronesOn: 6661 },
    {},
  );
  assert.ok(guns.action.kind === "activate" && guns.action.moduleID === 500 && guns.action.targetID === 6661);
});

test("fight: target died -> next rat; grid clear -> recall drones, then done", () => {
  const fight = SCRIPT_MACROS["fight-the-rats"]!;
  const s = { id: "f", kind: "macro", macro: "fight-the-rats", args: {} } as const;
  const remaining = entity({ itemID: 6662, kind: "ship", isNpc: true, npcEntityType: "npc", position: { x: 90000, y: 0, z: 0 } });
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });

  // 6661 died: pick + lock 6662.
  const next = fight(s, obs({ snapshot: snapshot([remaining, drone]), dronesOut: true, weaponModuleIDs: [500] }), { targetID: 6661, lockIssued: true, waited: 0, dronesOn: 6661 }, {});
  assert.ok(next.action.kind === "lock" && next.action.targetID === 6662);

  // All dead, drones out -> recall; drones home -> done.
  const recall = fight(s, obs({ snapshot: snapshot([drone]), dronesOut: true }), {}, {});
  assert.ok(recall.action.kind === "recallDrones");
  const done = fight(s, obs({ snapshot: snapshot([]) }), {}, {});
  assert.equal(done.outcome.kind, "done");
});

test("fight: no guns and no drones -> blocked with a plain reason", () => {
  const fight = SCRIPT_MACROS["fight-the-rats"]!;
  const s = { id: "f", kind: "macro", macro: "fight-the-rats", args: {} } as const;
  const rat = entity({ itemID: 6661, kind: "ship", isNpc: true, npcEntityType: "npc", position: { x: 5000, y: 0, z: 0 } });
  const t = fight(s, obs({ snapshot: snapshot([rat]), weaponModuleIDs: [], droneBayItemIDs: [] }), {}, {});
  assert.equal(t.outcome.kind, "blocked");
});

test("defend: pirate dead and drones home -> done", () => {
  const t = defend({ id: "d", kind: "macro", macro: "defend-with-drones", args: {} }, obs({ snapshot: snapshot([]), dronesOut: true }), NM, {});
  assert.equal(t.outcome.kind, "done");
});
