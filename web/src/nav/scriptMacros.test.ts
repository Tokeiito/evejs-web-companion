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

// ── Named board slots ────────────────────────────────────────────────────────

test("a station arg can point at a BOARD SLOT an earlier block filled in", () => {
  const travel = SCRIPT_MACROS["travel-to-station"]!;
  const slotStep: MacroStep = {
    id: "t",
    kind: "macro",
    macro: "travel-to-station",
    args: { station: { kind: "station", ref: { entity: "station", id: null, name: null, systemName: null, slot: "agent-station" } } },
  };
  // The board says the agent's station is 60009999 — and we are docked there, so
  // the block resolves the slot and reports arrival rather than "no station".
  const docked = obs({ flightStatus: flight({ docked: true, inSpace: false, stationID: 60009999 }) });
  const done = travel(slotStep, docked, {}, { agentStationID: 60009999 });
  assert.equal(done.outcome.kind, "done", "resolved the slot to the board's station");

  // With the slot UNFILLED the block blocks with a plain reason — never a guess.
  const empty = travel(slotStep, docked, {}, {});
  assert.equal(empty.outcome.kind, "blocked");
});

// ── The market set ───────────────────────────────────────────────────────────

function invRow(over: Partial<import("../store/types.ts").InventoryItemRow> & { itemID: number }): import("../store/types.ts").InventoryItemRow {
  return { typeID: 34, groupID: null, categoryID: null, flagID: null, quantity: 100, singleton: false, ...over };
}

const buy = SCRIPT_MACROS["buy-item"]!;
const sell = SCRIPT_MACROS["sell-item"]!;
const buyStep: MacroStep = {
  id: "b", kind: "macro", macro: "buy-item",
  args: { item: { kind: "itemType", typeID: 34, name: "Tritanium" }, quantity: { kind: "qty", value: 5000 }, price: { kind: "isk", value: 6 } },
};
const sellStep: MacroStep = {
  id: "s", kind: "macro", macro: "sell-item",
  args: { item: { kind: "itemType", typeID: 34, name: "Tritanium" }, price: { kind: "isk", value: 5 } },
};

test("buy-item: docked -> places one buy order, then done; not docked -> blocked", () => {
  const first = buy(buyStep, obs({ flightStatus: flight({ docked: true, inSpace: false }) }), {}, {});
  assert.ok(first.action.kind === "placeBuyOrder" && first.action.typeID === 34 && first.action.quantity === 5000 && first.action.price === 6);
  // The mem it returns marks it placed -> the next tick is done (no double buy).
  const second = buy(buyStep, obs({ flightStatus: flight({ docked: true, inSpace: false }) }), first.nextMem, {});
  assert.equal(second.outcome.kind, "done");
  assert.equal(buy(buyStep, obs({ flightStatus: flight({ docked: false }) }), {}, {}).outcome.kind, "blocked");
});

test("buy-item: an unfilled item/price/quantity -> blocked, never a bad order", () => {
  const bad: MacroStep = { id: "b", kind: "macro", macro: "buy-item", args: { item: { kind: "itemType", typeID: null, name: null }, quantity: { kind: "qty", value: 1 }, price: { kind: "isk", value: 1 } } };
  assert.equal(buy(bad, obs({ flightStatus: flight({ docked: true, inSpace: false }) }), {}, {}).outcome.kind, "blocked");
});

test("sell-item: lists each hangar stack, done when none left; not docked -> blocked", () => {
  const docked = obs({ flightStatus: flight({ docked: true, inSpace: false }), stationHangar: [invRow({ itemID: 111, quantity: 200 }), invRow({ itemID: 222, typeID: 99, quantity: 5 })] });
  const t = sell(sellStep, docked, {}, {});
  assert.ok(t.action.kind === "placeSellOrder" && t.action.itemID === 111 && t.action.quantity === 200 && t.action.price === 5);
  // Hangar now empty of type 34 -> done (the listed stack left the hangar).
  const empty = obs({ flightStatus: flight({ docked: true, inSpace: false }), stationHangar: [invRow({ itemID: 222, typeID: 99 })] });
  assert.equal(sell(sellStep, empty, {}, {}).outcome.kind, "done");
  // A singleton (an assembled item) of the type is never listed.
  const onlySingleton = obs({ flightStatus: flight({ docked: true, inSpace: false }), stationHangar: [invRow({ itemID: 333, singleton: true })] });
  assert.equal(sell(sellStep, onlySingleton, {}, {}).outcome.kind, "done");
  assert.equal(sell(sellStep, obs({ flightStatus: flight({ docked: false }) }), {}, {}).outcome.kind, "blocked");
});

// ── The fleet-support set ────────────────────────────────────────────────────

const remoteRep = SCRIPT_MACROS["remote-rep"]!;
const orbitBoost = SCRIPT_MACROS["orbit-and-boost"]!;
const repStep: MacroStep = { id: "rr", kind: "macro", macro: "remote-rep", args: {} };
const boostStep: MacroStep = { id: "ob", kind: "macro", macro: "orbit-and-boost", args: {} };

test("remote-rep: no remote reps fitted -> blocked", () => {
  const hurt = entity({ itemID: 7001, kind: "ship", characterID: 5001, shieldRatio: 0.4 });
  assert.equal(remoteRep(repStep, obs({ snapshot: snapshot([hurt]), remoteShieldRepairerIDs: [] }), {}, {}).outcome.kind, "blocked");
});

test("remote-rep: hurt friendly -> lock then rep it; everyone full -> done", () => {
  const hurt = entity({ itemID: 7001, kind: "ship", characterID: 5001, shieldRatio: 0.4, armorRatio: 1, hullRatio: 1 });
  const lock = remoteRep(repStep, obs({ snapshot: snapshot([hurt]), remoteShieldRepairerIDs: [600] }), {}, {});
  assert.ok(lock.action.kind === "lock" && lock.action.targetID === 7001);
  const rep = remoteRep(repStep, obs({ snapshot: snapshot([hurt]), remoteShieldRepairerIDs: [600], lockedTargetIDs: [7001] }), lock.nextMem, {});
  assert.ok(rep.action.kind === "activate" && rep.action.moduleID === 600 && rep.action.targetID === 7001);
  const full = entity({ itemID: 7001, kind: "ship", characterID: 5001, shieldRatio: 1, armorRatio: 1, hullRatio: 1 });
  assert.equal(remoteRep(repStep, obs({ snapshot: snapshot([full]), remoteShieldRepairerIDs: [600] }), {}, {}).outcome.kind, "done");
});

test("remote-rep: an NPC or your own hull is never a rep target", () => {
  const npc = entity({ itemID: 7002, kind: "ship", isNpc: true, shieldRatio: 0.2 });
  // No FRIENDLY is hurt (the NPC is skipped), so the block is done — never reps a rat.
  assert.equal(remoteRep(repStep, obs({ snapshot: snapshot([npc]), remoteShieldRepairerIDs: [600] }), {}, {}).outcome.kind, "done");
});

test("orbit-and-boost: no mate -> waits (never done); a mate present -> orbit it", () => {
  const none = orbitBoost(boostStep, obs({ snapshot: snapshot([]), remoteShieldRepairerIDs: [600] }), {}, {});
  assert.equal(none.outcome.kind, "acting");
  assert.equal(none.action.kind, "wait");
  const mate = entity({ itemID: 7003, kind: "ship", characterID: 5002, shieldRatio: 1, armorRatio: 1, hullRatio: 1, position: { x: 5000, y: 0, z: 0 } });
  const orb = orbitBoost(boostStep, obs({ snapshot: snapshot([mate]), remoteShieldRepairerIDs: [600] }), {}, {});
  assert.ok(orb.action.kind === "orbit" && orb.action.targetID === 7003);
});

// ── The fleet-management set ─────────────────────────────────────────────────

const createF = SCRIPT_MACROS["create-fleet"]!;
const inviteF = SCRIPT_MACROS["invite-to-fleet"]!;
const joinF = SCRIPT_MACROS["join-fleet"]!;
const createStep: MacroStep = { id: "cf", kind: "macro", macro: "create-fleet", args: {} };
const inviteStep: MacroStep = { id: "if", kind: "macro", macro: "invite-to-fleet", args: { who: { kind: "character", charID: 90001, name: "Alt" } } };
const joinStep: MacroStep = { id: "jf", kind: "macro", macro: "join-fleet", args: {} };

test("create-fleet: not in a fleet -> form one; already in one -> done; unread -> wait", () => {
  assert.equal(createF(createStep, obs({ inFleet: false }), {}, {}).action.kind, "createFleet");
  assert.equal(createF(createStep, obs({ inFleet: true }), {}, {}).outcome.kind, "done");
  assert.equal(createF(createStep, obs({ inFleet: null }), {}, {}).action.kind, "wait"); // reading, not deciding blind
});

test("invite-to-fleet: in a fleet -> invite once then done; not in a fleet -> blocked; no pilot -> blocked", () => {
  const inv = inviteF(inviteStep, obs({ inFleet: true }), {}, {});
  assert.ok(inv.action.kind === "inviteToFleet" && inv.action.charID === 90001);
  assert.equal(inviteF(inviteStep, obs({ inFleet: true }), inv.nextMem, {}).outcome.kind, "done");
  assert.equal(inviteF(inviteStep, obs({ inFleet: false }), {}, {}).outcome.kind, "blocked");
  const noWho: MacroStep = { id: "if", kind: "macro", macro: "invite-to-fleet", args: { who: { kind: "character", charID: null, name: null } } };
  assert.equal(inviteF(noWho, obs({ inFleet: true }), {}, {}).outcome.kind, "blocked");
});

test("join-fleet: not in a fleet -> keep accepting; in a fleet -> done", () => {
  assert.equal(joinF(joinStep, obs({ inFleet: false }), {}, {}).action.kind, "acceptFleetInvite");
  assert.equal(joinF(joinStep, obs({ inFleet: true }), {}, {}).outcome.kind, "done");
});

// ── The PvP set ──────────────────────────────────────────────────────────────

const attack = SCRIPT_MACROS["attack-player"]!;
const hunt = SCRIPT_MACROS["hunt-player"]!;
const say = SCRIPT_MACROS["send-chat"]!;
const attackStep: MacroStep = { id: "ap", kind: "macro", macro: "attack-player", args: {} };
const attackOnlyStep: MacroStep = {
  id: "ap2", kind: "macro", macro: "attack-player",
  args: { only: { kind: "character", charID: 90002, name: "Prey" } },
};
const huntStep: MacroStep = {
  id: "hp", kind: "macro", macro: "hunt-player",
  args: { maxJumps: { kind: "count", value: 3 }, range: { kind: "count", value: 14 } },
};
const sayStep: MacroStep = {
  id: "sc", kind: "macro", macro: "send-chat",
  args: { channel: { kind: "chatChannel", channel: "local" }, message: { kind: "text", text: "o7" } },
};

/** A player's ship on grid: a non-NPC hull with a pilot that is not you. */
function playerShip(itemID: number, characterID: number, x = 20000): SpaceEntity {
  return entity({ itemID, kind: "ship", characterID, isNpc: false, position: { x, y: 0, z: 0 } });
}

test("attack-player: an NPC on grid is NOT prey; an empty grid just watches", () => {
  const rat = entity({ itemID: 600, kind: "ship", isNpc: true, npcEntityType: "npc" });
  const t = attack(attackStep, obs({ snapshot: snapshot([rat]), weaponModuleIDs: [700] }), {}, {});
  assert.equal(t.action.kind, "wait");
  assert.match(t.why, /Watching/);
});

test("attack-player: a player lands on grid -> lock them (nearest first)", () => {
  const near = playerShip(801, 90001, 10000);
  const far = playerShip(802, 90002, 900000);
  const t = attack(attackStep, obs({ snapshot: snapshot([near, far]), weaponModuleIDs: [700] }), {}, {});
  assert.ok(t.action.kind === "lock" && t.action.targetID === 801);
});

test("attack-player: the only-filter spares everyone but the picked pilot", () => {
  const other = playerShip(801, 90001);
  const prey = playerShip(802, 90002);
  const spared = attack(attackOnlyStep, obs({ snapshot: snapshot([other]), weaponModuleIDs: [700] }), {}, {});
  assert.equal(spared.action.kind, "wait");
  const hit = attack(attackOnlyStep, obs({ snapshot: snapshot([other, prey]), weaponModuleIDs: [700] }), {}, {});
  assert.ok(hit.action.kind === "lock" && hit.action.targetID === 802);
});

test("attack-player: locked -> guns onto them; no guns and no drones -> blocked", () => {
  const prey = playerShip(801, 90001);
  const t = attack(
    attackStep,
    obs({ snapshot: snapshot([prey]), lockedTargetIDs: [801], weaponModuleIDs: [700] }),
    { targetID: 801, lockIssued: true, waited: 0, dronesOn: null },
    {},
  );
  assert.ok(t.action.kind === "activate" && t.action.moduleID === 700 && t.action.targetID === 801);
  const unarmed = attack(attackStep, obs({ snapshot: snapshot([prey]), weaponModuleIDs: [], droneBayItemIDs: [] }), {}, {});
  assert.equal(unarmed.outcome.kind, "blocked");
});

test("attack-player: docked -> blocked with an undock hint", () => {
  const t = attack(attackStep, obs({ flightStatus: flight({ docked: true, inSpace: false }) }), {}, {});
  assert.equal(t.outcome.kind, "blocked");
});

test("hunt-player: first tick marks the starting system as home on the board", () => {
  const t = hunt(huntStep, obs({ snapshot: snapshot([]), weaponModuleIDs: [700] }), {}, {});
  assert.equal(t.action.kind, "wait");
  assert.equal(t.boardPatch?.["huntAnchorSystemID"], 30000142);
  assert.equal(t.boardPatch?.["huntRangeAU"], 14);
});

const HUNT_BOARD = { huntAnchorSystemID: 30000142, huntRangeAU: 14 };

test("hunt-player: prey on grid beats searching -> lock them", () => {
  const prey = playerShip(801, 90001);
  const t = hunt(
    huntStep,
    obs({ snapshot: snapshot([prey]), weaponModuleIDs: [700], localPlayers: [{ characterID: 90001, name: "Prey" }] }),
    {},
    HUNT_BOARD,
  );
  assert.ok(t.action.kind === "lock" && t.action.targetID === 801);
});

test("hunt-player: someone in local + an off-grid scanner hit -> warp down the hit", () => {
  const gate = entity({ itemID: 701, kind: "stargate", name: "Gate" });
  const t = hunt(
    huntStep,
    obs({
      snapshot: snapshot([gate]),
      weaponModuleIDs: [700],
      localPlayers: [{ characterID: 90001, name: "Prey" }],
      dscanHitIDs: [701, 555000],
    }),
    {},
    HUNT_BOARD,
  );
  assert.ok(t.action.kind === "warp" && t.action.targetID === 555000, `expected a warp to the off-grid hit, got ${t.action.kind}`);
  assert.equal(t.nextMem["chaseID"], 555000);
});

test("hunt-player: a chased hit that came up empty is not chased twice", () => {
  const gate = entity({ itemID: 701, kind: "stargate", name: "Gate" });
  const t = hunt(
    huntStep,
    obs({
      snapshot: snapshot([gate]),
      weaponModuleIDs: [700],
      localPlayers: [{ characterID: 90001, name: "Prey" }],
      dscanHitIDs: [555000],
    }),
    { chaseID: 555000, chaseIssued: true, chaseSawWarp: true },
    HUNT_BOARD,
  );
  // The only hit is now visited: the hunt moves to a fresh vantage point instead.
  assert.ok(t.action.kind === "warp" && t.action.targetID === 701);
});

test("hunt-player: local empty -> roam one system over, inside the leash", () => {
  const t = hunt(
    huntStep,
    obs({
      snapshot: snapshot([]),
      weaponModuleIDs: [700],
      localPlayers: [],
      huntRoam: {
        jumpsFromAnchor: 0,
        neighbors: [
          { systemID: 30000144, jumpsFromAnchor: 1 },
          { systemID: 30000200, jumpsFromAnchor: 9 },
        ],
      },
    }),
    {},
    HUNT_BOARD,
  );
  assert.ok(t.action.kind === "startSystemRoute" && t.action.systemID === 30000144, "must pick the in-leash neighbor");
  assert.equal(t.nextMem["roamSystemID"], 30000144);
});

test("hunt-player: boxed in past the leash -> head back toward home, never sit", () => {
  const t = hunt(
    huntStep,
    obs({
      snapshot: snapshot([]),
      weaponModuleIDs: [700],
      localPlayers: [],
      huntRoam: {
        jumpsFromAnchor: 4,
        neighbors: [
          { systemID: 30000300, jumpsFromAnchor: 5 },
          { systemID: 30000301, jumpsFromAnchor: 4 },
        ],
      },
    }),
    {},
    HUNT_BOARD,
  );
  assert.ok(t.action.kind === "startSystemRoute" && t.action.systemID === 30000301);
});

test("hunt-player: riding the autopilot to the roam target -> wait, do not re-issue", () => {
  const t = hunt(
    huntStep,
    obs({
      snapshot: snapshot([]),
      weaponModuleIDs: [700],
      localPlayers: [],
      travel: { status: "running", destinationStationID: null, destinationSystemID: 30000144, remainingJumps: 1, failureReason: null },
    }),
    { roamSystemID: 30000144 },
    HUNT_BOARD,
  );
  assert.equal(t.action.kind, "wait");
  assert.match(t.why, /Riding/);
});

test("send-chat: says it once, then done; a blank message is blocked", () => {
  const first = say(sayStep, obs({}), {}, {});
  assert.ok(first.action.kind === "sendChat" && first.action.channel === "local" && first.action.message === "o7");
  assert.equal(say(sayStep, obs({}), first.nextMem, {}).outcome.kind, "done");
  const blank: MacroStep = {
    id: "sc2", kind: "macro", macro: "send-chat",
    args: { channel: { kind: "chatChannel", channel: "corp" }, message: { kind: "text", text: "  " } },
  };
  assert.equal(say(blank, obs({}), {}, {}).outcome.kind, "blocked");
});

// ── Tackle before guns ───────────────────────────────────────────────────────

test("attack-player: locked -> the POINT goes on before the guns", () => {
  const prey = playerShip(801, 90001);
  const t = attack(
    attackStep,
    obs({ snapshot: snapshot([prey]), lockedTargetIDs: [801], weaponModuleIDs: [700], tackleModuleIDs: [650], webModuleIDs: [660] }),
    { targetID: 801, lockIssued: true, waited: 0, dronesOn: null },
    {},
  );
  assert.ok(t.action.kind === "activate" && t.action.moduleID === 650, "the point must be first, not the gun");
  assert.match(t.why, /warp off/);
});

test("attack-player: point running -> the WEB is next, then the guns", () => {
  const prey = playerShip(801, 90001);
  const base = { targetID: 801, lockIssued: true, waited: 0, dronesOn: null };
  const withPoint = obs({
    snapshot: snapshot([prey], { activeModuleIDs: [650] }),
    lockedTargetIDs: [801], weaponModuleIDs: [700], tackleModuleIDs: [650], webModuleIDs: [660],
  });
  const web = attack(attackStep, withPoint, base, {});
  assert.ok(web.action.kind === "activate" && web.action.moduleID === 660);

  const withBoth = obs({
    snapshot: snapshot([prey], { activeModuleIDs: [650, 660] }),
    lockedTargetIDs: [801], weaponModuleIDs: [700], tackleModuleIDs: [650], webModuleIDs: [660],
  });
  const gun = attack(attackStep, withBoth, base, {});
  assert.ok(gun.action.kind === "activate" && gun.action.moduleID === 700, "with tackle up, the guns fire");
});

test("attack-player: a point that never comes on cannot starve the guns (the bound)", () => {
  // The out-of-range case: the server refuses the activate, so the point never
  // appears in activeModuleIDs. Drive the loop and prove it reaches the gun.
  const prey = playerShip(801, 90001);
  const world = obs({
    snapshot: snapshot([prey], { activeModuleIDs: [] }),
    lockedTargetIDs: [801], weaponModuleIDs: [700], tackleModuleIDs: [650],
  });
  let mem: MacroMemory = { targetID: 801, lockIssued: true, waited: 0, dronesOn: null };
  const picked: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = attack(attackStep, world, mem, {});
    if (t.action.kind === "activate") picked.push(t.action.moduleID);
    mem = t.nextMem;
  }
  assert.ok(picked.includes(700), `the guns must eventually fire; picked ${picked.join(",")}`);
  assert.equal(picked.filter((m) => m === 650).length, 3, "the point is tried exactly MAX_TACKLE_ATTEMPTS times");
});

test("attack-player: no tackle fitted -> straight to the guns, no wasted tick", () => {
  const prey = playerShip(801, 90001);
  const t = attack(
    attackStep,
    obs({ snapshot: snapshot([prey]), lockedTargetIDs: [801], weaponModuleIDs: [700] }),
    { targetID: 801, lockIssued: true, waited: 0, dronesOn: null },
    {},
  );
  assert.ok(t.action.kind === "activate" && t.action.moduleID === 700);
});

test("attack-player: a NEW target gets a fresh tackle try (the bound resets)", () => {
  const first = playerShip(801, 90001);
  const second = playerShip(802, 90002);
  const world = obs({ snapshot: snapshot([second]), lockedTargetIDs: [802], weaponModuleIDs: [700], tackleModuleIDs: [650] });
  // Memory is from a spent fight with 801, which has left the grid.
  const t = attack(attackStep, world, { targetID: 801, lockIssued: true, waited: 0, dronesOn: null, tackleTries: 3 }, {});
  assert.ok(t.action.kind === "lock" && t.action.targetID === 802);
  assert.equal(t.nextMem["tackleTries"], undefined, "a re-pick clears the spent tackle counter");
  assert.ok(first.itemID === 801);
});

test("hunt-player: the tackle counter survives ticks mid-fight", () => {
  const prey = playerShip(801, 90001);
  const world = obs({
    snapshot: snapshot([prey], { activeModuleIDs: [] }),
    lockedTargetIDs: [801], weaponModuleIDs: [700], tackleModuleIDs: [650],
    localPlayers: [{ characterID: 90001, name: "Prey" }],
  });
  let mem: MacroMemory = { targetID: 801, lockIssued: true, waited: 0, dronesOn: null, visitedHits: "999" };
  const picked: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = hunt(huntStep, world, mem, HUNT_BOARD);
    if (t.action.kind === "activate") picked.push(t.action.moduleID);
    mem = t.nextMem;
  }
  assert.equal(picked.filter((m) => m === 650).length, 3, "the bound counts across ticks inside the hunt too");
  assert.ok(picked.includes(700));
});

// ── Movement extras, cargo extras, cap chain ─────────────────────────────────

const setDest = SCRIPT_MACROS["set-destination"]!;
const dockNearest = SCRIPT_MACROS["dock-at-nearest"]!;
const remoteCapBlock = SCRIPT_MACROS["remote-cap"]!;
const jettison = SCRIPT_MACROS["jettison-cargo"]!;
const tidy = SCRIPT_MACROS["tidy-hangar"]!;

const toStationStep: MacroStep = {
  id: "sd", kind: "macro", macro: "set-destination",
  args: { destination: { kind: "destination", ref: { entity: "station", id: 60008143, name: "Home", systemName: null } } },
};
const toSystemStep: MacroStep = {
  id: "sd2", kind: "macro", macro: "set-destination",
  args: { destination: { kind: "destination", ref: { entity: "system", id: 30005239, name: "Aring", systemName: null } } },
};

test("set-destination: a STATION destination starts a station route; a SYSTEM one a system route", () => {
  const st = setDest(toStationStep, obs({}), {}, {});
  assert.ok(st.action.kind === "startRoute" && st.action.stationID === 60008143);
  const sys = setDest(toSystemStep, obs({}), {}, {});
  assert.ok(sys.action.kind === "startSystemRoute" && sys.action.systemID === 30005239);
});

test("set-destination: done once the trip is under way, NOT on arrival", () => {
  const t = setDest(
    toStationStep,
    obs({ travel: { status: "running", destinationStationID: 60008143, destinationSystemID: null, remainingJumps: 4, failureReason: null } }),
    { issued: true },
    {},
  );
  assert.equal(t.outcome.kind, "done", "the block finishes with the ship still flying");
});

test("set-destination: a failure on THIS destination blocks; an unset destination blocks", () => {
  const failed = setDest(
    toStationStep,
    obs({ travel: { status: "paused", destinationStationID: 60008143, destinationSystemID: null, remainingJumps: 0, failureReason: "No gate route." } }),
    {},
    {},
  );
  assert.equal(failed.outcome.kind, "blocked");
  const unset: MacroStep = {
    id: "sd3", kind: "macro", macro: "set-destination",
    args: { destination: { kind: "destination", ref: { entity: "station", id: null, name: null, systemName: null } } },
  };
  assert.equal(setDest(unset, obs({}), {}, {}).outcome.kind, "blocked");
});

const dockNearStep: MacroStep = { id: "dn", kind: "macro", macro: "dock-at-nearest", args: {} };

test("dock-at-nearest: picks the CLOSEST dockable and docks when in range", () => {
  const near = entity({ itemID: 60001, kind: "station", name: "Near", radius: 1000, position: { x: 1500, y: 0, z: 0 } });
  const far = entity({ itemID: 60002, kind: "station", name: "Far", radius: 1000, position: { x: 9_000_000, y: 0, z: 0 } });
  const t = dockNearest(dockNearStep, obs({ snapshot: snapshot([near, far]) }), {}, {});
  assert.ok(t.action.kind === "dock" && t.action.stationID === 60001);
});

test("dock-at-nearest: far away warps; docked is done; nothing in view is blocked", () => {
  const far = entity({ itemID: 60002, kind: "station", name: "Far", radius: 1000, position: { x: 900_000_000, y: 0, z: 0 } });
  const warp = dockNearest(dockNearStep, obs({ snapshot: snapshot([far]) }), {}, {});
  assert.ok(warp.action.kind === "warp" && warp.action.targetID === 60002);

  const done = dockNearest(
    dockNearStep,
    obs({ flightStatus: flight({ docked: true, inSpace: false, stationID: 60002 }) }),
    {},
    {},
  );
  assert.equal(done.outcome.kind, "done");

  const empty = dockNearest(dockNearStep, obs({ snapshot: snapshot([]) }), {}, {});
  assert.equal(empty.outcome.kind, "blocked");
});

test("dock-at-nearest: drones out means call them home before warping off", () => {
  const station = entity({ itemID: 60002, kind: "station", radius: 1000, position: { x: 900_000_000, y: 0, z: 0 } });
  const drone = entity({ itemID: 111, kind: "drone", controllerID: 9001, position: { x: 200, y: 0, z: 0 } });
  const t = dockNearest(dockNearStep, obs({ snapshot: snapshot([station, drone]), dronesOut: true }), {}, {});
  assert.ok(t.action.kind === "recallDrones" && t.action.droneIDs.includes(111));
});

test("remote-cap: feeds the EMPTIEST mate; all healthy is done; none fitted is blocked", () => {
  const capStep: MacroStep = { id: "rc", kind: "macro", macro: "remote-cap", args: {} };
  const thirsty = entity({ itemID: 801, kind: "ship", characterID: 90001, isNpc: false, capacitorRatio: 0.2, position: { x: 1000, y: 0, z: 0 } });
  const fine = entity({ itemID: 802, kind: "ship", characterID: 90002, isNpc: false, capacitorRatio: 0.99, position: { x: 900, y: 0, z: 0 } });

  const lock = remoteCapBlock(capStep, obs({ snapshot: snapshot([thirsty, fine]), remoteCapModuleIDs: [640] }), {}, {});
  assert.ok(lock.action.kind === "lock" && lock.action.targetID === 801, "the emptiest one, not the nearest");

  const run = remoteCapBlock(
    capStep,
    obs({ snapshot: snapshot([thirsty], { activeModuleIDs: [] }), lockedTargetIDs: [801], remoteCapModuleIDs: [640] }),
    { capLockOn: 801 },
    {},
  );
  assert.ok(run.action.kind === "activate" && run.action.moduleID === 640 && run.action.targetID === 801);

  const allFine = remoteCapBlock(capStep, obs({ snapshot: snapshot([fine]), remoteCapModuleIDs: [640] }), {}, {});
  assert.equal(allFine.outcome.kind, "done");

  const noModule = remoteCapBlock(capStep, obs({ snapshot: snapshot([thirsty]), remoteCapModuleIDs: [] }), {}, {});
  assert.equal(noModule.outcome.kind, "blocked");
});

const jettisonStep: MacroStep = { id: "jc", kind: "macro", macro: "jettison-cargo", args: {} };

test("jettison-cargo: dumps the whole hold, or only the picked item; empty is done", () => {
  const rows = [
    { itemID: 11, typeID: 34, quantity: 100, singleton: false },
    { itemID: 12, typeID: 1230, quantity: 50, singleton: false },
  ];
  const cargo = { rows, capacity: null } as unknown as ScriptObservation["cargo"];
  const all = jettison(jettisonStep, obs({ cargo }), {}, {});
  assert.ok(all.action.kind === "jettison" && all.action.itemIDs.length === 2);

  const onlyOre: MacroStep = {
    id: "jc2", kind: "macro", macro: "jettison-cargo",
    args: { item: { kind: "itemType", typeID: 1230, name: "Veldspar" } },
  };
  const one = jettison(onlyOre, obs({ cargo }), {}, {});
  assert.ok(one.action.kind === "jettison" && one.action.itemIDs.length === 1 && one.action.itemIDs[0] === 12);

  const emptied = jettison(
    jettisonStep,
    obs({ cargo: { rows: [], capacity: null } as unknown as ScriptObservation["cargo"] }),
    {},
    {},
  );
  assert.equal(emptied.outcome.kind, "done", "the hold emptying IS the confirmation");
});

test("jettison-cargo: docked is blocked, since a can needs space to float in", () => {
  const t = jettison(
    jettisonStep,
    obs({ inSpace: false, flightStatus: flight({ docked: true, inSpace: false }) }),
    {},
    {},
  );
  assert.equal(t.outcome.kind, "blocked");
});

test("tidy-hangar: stacks once then done; undocked is blocked", () => {
  const step: MacroStep = { id: "th", kind: "macro", macro: "tidy-hangar", args: {} };
  const docked = obs({ flightStatus: flight({ docked: true, inSpace: false, stationID: 60008143 }) });
  const first = tidy(step, docked, {}, {});
  assert.equal(first.action.kind, "stackHangar");
  assert.equal(tidy(step, docked, first.nextMem, {}).outcome.kind, "done");
  assert.equal(tidy(step, obs({}), {}, {}).outcome.kind, "blocked");
});

test("mine: the biggest-rock order prefers the most ore left; the default stays nearest", () => {
  const small = entity({ itemID: 50001, name: "Veldspar", miningYieldTypeID: 1230, remainingQuantity: 100, position: { x: 3000, y: 0, z: 0 } });
  const big = entity({ itemID: 50002, name: "Veldspar", miningYieldTypeID: 1230, remainingQuantity: 9000, position: { x: 9000, y: 0, z: 0 } });
  const unknown = entity({ itemID: 50003, name: "Veldspar", miningYieldTypeID: 1230, remainingQuantity: null, position: { x: 1000, y: 0, z: 0 } });
  const biggestStep: MacroStep = {
    ...mineStep, id: "mb",
    args: { ...mineStep.args, pick: { kind: "rockPick", pick: "biggest" } },
  };
  const t = mine(biggestStep, obs({ snapshot: snapshot([small, big, unknown]) }), NM, {});
  assert.ok(t.action.kind === "orbit" && t.action.targetID === 50002, "the big one, though it is furthest");

  const near = mine(mineStep, obs({ snapshot: snapshot([small, big, unknown]) }), NM, {});
  assert.ok(near.action.kind === "orbit" && near.action.targetID === 50003, "default still picks the nearest");
});

// ── compress-ore (the fleet mechanic) ────────────────────────────────────────

const compress = SCRIPT_MACROS["compress-ore"]!;
const compressStep: MacroStep = { id: "co", kind: "macro", macro: "compress-ore", args: {} };

/** A hold with these stacks in it. */
function oreHold(items: { itemID: number; typeID: number; quantity: number }[]): MiningHold[] {
  return [{ key: "ore", label: "Ore Hold", items, capacity: null, present: true, error: null }];
}

/** A support ship that IS running its compression gear. */
function facilityShip(itemID: number, characterID: number, x: number, rangeMeters = 60_000): SpaceEntity {
  return entity({
    itemID, kind: "ship", characterID, isNpc: false, radius: 3000,
    position: { x, y: 0, z: 0 },
    compressionFacility: { rangeMeters, typeListIDs: [1] },
  });
}

test("compress-ore: an in-range support ship on grid -> compress the first stack", () => {
  const orca = facilityShip(7001, 90002, 20_000);
  const t = compress(compressStep, obs({ snapshot: snapshot([orca]), holds: oreHold([{ itemID: 11, typeID: 1230, quantity: 5000 }]) }), {}, {});
  assert.ok(t.action.kind === "compressOre" && t.action.itemID === 11 && t.action.facilityID === 7001);
});

test("compress-ore: no support ship running its gear -> blocked, and says so", () => {
  // An ordinary ship on grid is NOT a facility, and neither is one whose modules
  // are off (compressionFacility null).
  const plain = entity({ itemID: 7002, kind: "ship", characterID: 90003, isNpc: false, position: { x: 1000, y: 0, z: 0 } });
  const off = entity({ itemID: 7003, kind: "ship", characterID: 90004, isNpc: false, compressionFacility: null, position: { x: 1200, y: 0, z: 0 } });
  const t = compress(compressStep, obs({ snapshot: snapshot([plain, off]), holds: oreHold([{ itemID: 11, typeID: 1230, quantity: 5000 }]) }), {}, {});
  assert.equal(t.outcome.kind, "blocked");
  assert.match(t.outcome.kind === "blocked" ? t.outcome.reason : "", /compression gear/i);
});

test("compress-ore: an ABSENT facility reading is not a facility (no hopeful firing)", () => {
  // An older server, or a row the gateway did not project: the field is missing
  // entirely. That must read as "not a facility", not as an unknown worth trying.
  const unknown = entity({ itemID: 7004, kind: "ship", characterID: 90005, isNpc: false, position: { x: 900, y: 0, z: 0 } });
  delete (unknown as { compressionFacility?: unknown }).compressionFacility;
  const t = compress(compressStep, obs({ snapshot: snapshot([unknown]), holds: oreHold([{ itemID: 11, typeID: 1230, quantity: 5000 }]) }), {}, {});
  assert.equal(t.outcome.kind, "blocked");
});

test("compress-ore: an NPC hull is never a facility", () => {
  const rat = entity({
    itemID: 7005, kind: "ship", isNpc: true, npcEntityType: "npc",
    position: { x: 500, y: 0, z: 0 },
    compressionFacility: { rangeMeters: 60_000, typeListIDs: [1] },
  });
  const t = compress(compressStep, obs({ snapshot: snapshot([rat]), holds: oreHold([{ itemID: 11, typeID: 1230, quantity: 1 }]) }), {}, {});
  assert.equal(t.outcome.kind, "blocked");
});

test("compress-ore: out of the facility's range -> close in first, then compress", () => {
  // 200 km away with a 60 km reach: too far for the server to accept.
  const far = facilityShip(7001, 90002, 200_000, 60_000);
  const holds = oreHold([{ itemID: 11, typeID: 1230, quantity: 5000 }]);
  const closing = compress(compressStep, obs({ snapshot: snapshot([far]), holds }), {}, {});
  assert.ok(
    closing.action.kind === "approach" || closing.action.kind === "warp",
    `expected to close the gap, got ${closing.action.kind}`,
  );

  // Inside its reach, it compresses.
  const near = facilityShip(7001, 90002, 30_000, 60_000);
  const inRange = compress(compressStep, obs({ snapshot: snapshot([near]), holds }), {}, {});
  assert.equal(inRange.action.kind, "compressOre");
});

test("compress-ore: OWN ship as the facility needs no closing in", () => {
  // The ego ship itself is running the gear (a Rorqual compressing its own ore).
  const self = entity({
    itemID: 9001, kind: "ship", isSelf: true, isNpc: false, characterID: 90001,
    position: { x: 0, y: 0, z: 0 },
    compressionFacility: { rangeMeters: 1, typeListIDs: [1] },
  });
  const t = compress(compressStep, obs({ snapshot: snapshot([self]), holds: oreHold([{ itemID: 11, typeID: 1230, quantity: 5000 }]) }), {}, {});
  assert.ok(t.action.kind === "compressOre" && t.action.facilityID === 9001);
});

test("compress-ore: own ship is preferred over a fleet-mate's facility", () => {
  const self = entity({
    itemID: 9001, kind: "ship", isSelf: true, isNpc: false, characterID: 90001,
    position: { x: 0, y: 0, z: 0 },
    compressionFacility: { rangeMeters: 1, typeListIDs: [1] },
  });
  const mate = facilityShip(7001, 90002, 5000);
  const t = compress(compressStep, obs({ snapshot: snapshot([self, mate]), holds: oreHold([{ itemID: 11, typeID: 1230, quantity: 1 }]) }), {}, {});
  assert.ok(t.action.kind === "compressOre" && t.action.facilityID === 9001);
});

test("compress-ore: each stack gets ONE attempt, then the block finishes", () => {
  const orca = facilityShip(7001, 90002, 20_000);
  const holds = oreHold([
    { itemID: 11, typeID: 1230, quantity: 5000 },
    { itemID: 12, typeID: 1228, quantity: 3000 },
  ]);
  let mem: MacroMemory = {};
  const attempted: number[] = [];
  let finishedOnTick = -1;
  for (let i = 0; i < 5; i++) {
    const t = compress(compressStep, obs({ snapshot: snapshot([orca]), holds }), mem, {});
    if (t.action.kind === "compressOre") attempted.push(t.action.itemID);
    mem = t.nextMem;
    if (t.outcome.kind === "done") {
      finishedOnTick = i;
      break;
    }
  }
  assert.deepEqual(attempted, [11, 12], "each stack once, in order — an ore with no compressed form is not retried forever");
  assert.equal(finishedOnTick, 2, "it finishes the tick after the last stack, never looping on a stubborn one");
  // ⚠ The memory it finishes with is CLEARED, on purpose: the runner resets
  // per-step memory at a step boundary anyway, and inside a Repeat loop the next
  // lap must reconsider ore mined since rather than remember an empty hold.
  assert.equal(mem["triedItemIDs"], undefined);
});

test("compress-ore: an EMPTY hold is done; an UNREADABLE hold waits", () => {
  const orca = facilityShip(7001, 90002, 20_000);
  const empty = compress(compressStep, obs({ snapshot: snapshot([orca]), holds: oreHold([]) }), {}, {});
  assert.equal(empty.outcome.kind, "done");

  // items:null is "we could not look", NOT "it is empty" — it must not finish.
  const blind: MiningHold[] = [{ key: "ore", label: "Ore Hold", items: null, capacity: null, present: true, error: "read failed" }];
  const waiting = compress(compressStep, obs({ snapshot: snapshot([orca]), holds: blind }), {}, {});
  assert.equal(waiting.action.kind, "wait");
  assert.notEqual(waiting.outcome.kind, "done", "a failed read must never look like an empty hold");
});

test("compress-ore: docked -> blocked; mid-warp -> waits", () => {
  const docked = compress(compressStep, obs({ inSpace: false, flightStatus: flight({ docked: true, inSpace: false }) }), {}, {});
  assert.equal(docked.outcome.kind, "blocked");
  const warping = compress(compressStep, obs({ inWarp: true, snapshot: snapshot([]) }), {}, {});
  assert.equal(warping.action.kind, "wait");
  assert.equal(warping.outcome.kind, "acting");
});
