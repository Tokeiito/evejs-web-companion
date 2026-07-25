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
