import test from "node:test";
import assert from "node:assert/strict";

import type { MacroStep } from "../bots/botScript.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import { SCRIPT_MACROS } from "./scriptMacros.ts";
import type { InventoryItemRow } from "../store/types.ts";

const PICKUP = 60000001;
const DELIVERY = 60000002;
const haul = SCRIPT_MACROS["haul-all"]!;
const step: MacroStep = {
  id: "haul",
  kind: "macro",
  macro: "haul-all",
  args: {
    pickupStation: { kind: "station", ref: { entity: "station", id: PICKUP, name: "Pickup", systemName: null } },
    pickupCorpDivision: { kind: "corpDivision", division: 1 },
    deliveryStation: { kind: "station", ref: { entity: "station", id: DELIVERY, name: "Delivery", systemName: null } },
    deliveryCorpDivision: { kind: "corpDivision", division: 7 },
  },
};

const filteredStep: MacroStep = {
  ...step,
  args: {
    ...step.args,
    item: { kind: "itemType", typeID: 35, name: "Pyerite" },
  },
};

function row(itemID: number, quantity: number, typeID = 34): InventoryItemRow {
  return {
    itemID,
    typeID,
    groupID: null,
    categoryID: null,
    flagID: null,
    quantity,
    singleton: false,
    volume: 2,
  };
}

function at(
  stationID: number,
  cargo: readonly InventoryItemRow[],
  division: number,
  corp: readonly InventoryItemRow[],
  used: number,
  readError: string | null = null,
): ScriptObservation {
  return {
    flightStatus: { docked: true, inSpace: false, stationID } as never,
    haulAll: {
      cargo: { rows: cargo, capacity: { capacity: 10, used } },
      corpDivisions: [{ division, rows: corp, error: null }],
      readError,
    },
  } as unknown as ScriptObservation;
}

test("haul-all loads a capacity-sized source slice directly from corp into Cargo Hold", () => {
  const decision = haul(step, at(PICKUP, [], 1, [row(100, 10)], 0), {}, {});
  assert.deepEqual(decision.action, {
    kind: "haulTransfer",
    itemID: 100,
    typeID: 34,
    quantity: 5,
    from: { kind: "corp", division: 1 },
    to: { kind: "cargo" },
    expectedStationID: PICKUP,
  });
});

test("haul-all without an item selection continues across every source item type", () => {
  const first = haul(step, at(PICKUP, [], 1, [row(100, 2, 34), row(101, 3, 35)], 0), {}, {});
  assert.equal(first.action.kind, "haulTransfer");
  assert.equal(first.action.kind === "haulTransfer" ? first.action.typeID : null, 34);

  const second = haul(
    step,
    at(PICKUP, [row(200, 2, 34)], 1, [row(101, 3, 35)], 4),
    first.nextMem,
    {},
  );
  assert.equal(second.action.kind, "haulTransfer");
  assert.equal(second.action.kind === "haulTransfer" ? second.action.typeID : null, 35);
  assert.equal(second.action.kind === "haulTransfer" ? second.action.quantity : null, 3);
});

test("haul-all with an item selection loads only the matching typeID", () => {
  const decision = haul(filteredStep, at(PICKUP, [], 1, [row(100, 4, 34), row(101, 3, 35)], 0), {}, {});
  assert.deepEqual(decision.action, {
    kind: "haulTransfer",
    itemID: 101,
    typeID: 35,
    quantity: 3,
    from: { kind: "corp", division: 1 },
    to: { kind: "cargo" },
    expectedStationID: PICKUP,
  });
});

test("filtered haul-all leaves mixed non-selected source stacks untouched", () => {
  const first = haul(filteredStep, at(PICKUP, [], 1, [row(100, 4, 34), row(101, 3, 35)], 0), {}, {});
  const afterLoad = haul(
    filteredStep,
    at(PICKUP, [row(201, 3, 35)], 1, [row(100, 4, 34)], 6),
    first.nextMem,
    {},
  );
  assert.equal(afterLoad.action.kind, "wait");
  assert.equal(afterLoad.outcome.kind, "acting");
  assert.equal((afterLoad.nextMem["haulAll"] as { leg: string }).leg, "delivery");
  assert.equal((afterLoad.nextMem["haulAll"] as { sourceEmptyAtDeparture: boolean }).sourceEmptyAtDeparture, true);
});

test("filtered haul-all completes with non-selected source items once its manifest is empty", () => {
  const mem = {
    haulAll: {
      trusted: true,
      leg: "pickup",
      manifest: {},
      sourceEmptyAtDeparture: false,
      pending: null,
    },
  };
  const decision = haul(filteredStep, at(PICKUP, [], 1, [row(100, 4, 34)], 0), mem, {});
  assert.equal(decision.outcome.kind, "done");
  assert.equal(decision.action.kind, "wait");
});

test("haul-all unloads only its trusted Cargo Hold manifest directly into destination corp", () => {
  const mem = {
    haulAll: {
      trusted: true,
      leg: "delivery",
      manifest: { "34": 5 },
      sourceEmptyAtDeparture: true,
      pending: null,
    },
  };
  const decision = haul(step, at(DELIVERY, [row(200, 5)], 7, [row(300, 2)], 10), mem, {});
  assert.deepEqual(decision.action, {
    kind: "haulTransfer",
    itemID: 200,
    typeID: 34,
    quantity: 5,
    from: { kind: "cargo" },
    to: { kind: "corp", division: 7 },
    expectedStationID: DELIVERY,
  });
});

test("haul-all returns for another trip, then finishes only after source and cargo are empty", () => {
  const finishingFirstDelivery = {
    haulAll: {
      trusted: true,
      leg: "delivery",
      manifest: { "34": 5 },
      sourceEmptyAtDeparture: false,
      pending: { leg: "delivery", typeID: 34, quantity: 5, sourceBefore: 5, destinationBefore: 0 },
    },
  };
  const returnTrip = haul(step, at(DELIVERY, [], 7, [row(300, 5)], 0), finishingFirstDelivery, {});
  assert.equal(returnTrip.outcome.kind, "acting");
  assert.equal((returnTrip.nextMem["haulAll"] as { leg: string }).leg, "pickup");

  const secondLoad = haul(step, at(PICKUP, [], 1, [row(101, 3)], 0), returnTrip.nextMem, {});
  assert.equal(secondLoad.action.kind, "haulTransfer");
  const lastDeparture = haul(step, at(PICKUP, [row(201, 3)], 1, [], 6), secondLoad.nextMem, {});
  assert.equal((lastDeparture.nextMem["haulAll"] as { leg: string }).leg, "delivery");
  assert.equal((lastDeparture.nextMem["haulAll"] as { sourceEmptyAtDeparture: boolean }).sourceEmptyAtDeparture, true);

  const secondUnload = haul(step, at(DELIVERY, [row(201, 3)], 7, [row(300, 5)], 6), lastDeparture.nextMem, {});
  assert.equal(secondUnload.action.kind, "haulTransfer");
  const done = haul(step, at(DELIVERY, [], 7, [row(300, 8)], 0), secondUnload.nextMem, {});
  assert.equal(done.outcome.kind, "done");
});

test("haul-all blocks a fresh run whose Cargo Hold is not empty", () => {
  const decision = haul(step, at(PICKUP, [row(200, 1)], 1, [row(100, 10)], 2), {}, {});
  assert.equal(decision.outcome.kind, "blocked");
  assert.equal(decision.action.kind, "wait");
  assert.match(decision.outcome.kind === "blocked" ? decision.outcome.reason : "", /cannot adopt cargo/i);
});

test("haul-all blocks invalid or unreadable corp destinations without emitting a fallback move", () => {
  const invalid: MacroStep = {
    ...step,
    args: { ...step.args, deliveryCorpDivision: { kind: "corpDivision", division: 8 } },
  };
  const badConfig = haul(invalid, at(PICKUP, [], 1, [row(100, 1)], 0), {}, {});
  assert.equal(badConfig.outcome.kind, "blocked");
  assert.equal(badConfig.action.kind, "wait");

  const unreadable = haul(step, at(PICKUP, [], 1, [], 0, "CALL_REFUSED"), {}, {});
  assert.equal(unreadable.outcome.kind, "blocked");
  assert.equal(unreadable.action.kind, "wait");
});
