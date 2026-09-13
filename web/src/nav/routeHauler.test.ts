import test from "node:test";
import assert from "node:assert/strict";

import type { MacroStep } from "../bots/botScript.ts";
import type { InventoryItemRow } from "../store/types.ts";
import type { ScriptObservation } from "./scriptConditions.ts";
import { SCRIPT_MACROS } from "./scriptMacros.ts";

const STATION_A = 60000001;
const STATION_B = 60000002;
const route = SCRIPT_MACROS["route-hauler"]!;

const baseStep: MacroStep = {
  id: "route",
  kind: "macro",
  macro: "route-hauler",
  args: {
    transportBay: { kind: "place", place: "cargo" },
    stationA: { kind: "station", ref: { entity: "station", id: STATION_A, name: "Station A", systemName: null } },
    stationB: { kind: "station", ref: { entity: "station", id: STATION_B, name: "Station B", systemName: null } },
    pickupDivisionA: { kind: "corpDivision", division: 1 },
    deliveryDivisionB: { kind: "corpDivision", division: 2 },
    returnCargo: { kind: "toggle", enabled: false },
  },
};

const returnStep: MacroStep = {
  ...baseStep,
  args: {
    ...baseStep.args,
    returnCargo: { kind: "toggle", enabled: true },
    pickupDivisionB: { kind: "corpDivision", division: 3 },
    deliveryDivisionA: { kind: "corpDivision", division: 4 },
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

function oreRow(itemID: number, quantity: number): InventoryItemRow {
  return { ...row(itemID, quantity, 1230), groupID: 462, categoryID: 25 };
}

function moduleRow(itemID: number, quantity: number): InventoryItemRow {
  return { ...row(itemID, quantity, 9999), groupID: 53, categoryID: 7 };
}

function at(
  stationID: number,
  transport: readonly InventoryItemRow[],
  divisions: readonly { division: number; rows: readonly InventoryItemRow[]; error?: string | null }[],
  used: number,
  readError: string | null = null,
): ScriptObservation {
  return {
    flightStatus: { docked: true, inSpace: false, stationID } as never,
    routeHauler: {
      transport: { rows: transport, capacity: { capacity: 10, used } },
      corpDivisions: divisions.map((division) => ({ ...division, error: division.error ?? null })),
      readError,
    },
  } as unknown as ScriptObservation;
}

function state(
  phase: "loadA" | "travelToB" | "unloadB" | "loadB" | "travelToA" | "unloadA",
  aToB: Readonly<Record<string, number>> = {},
  bToA: Readonly<Record<string, number>> = {},
  pending: unknown = null,
): Record<string, unknown> {
  return {
    routeHauler: {
      trusted: true,
      phase,
      manifests: { aToB, bToA },
      pending,
    },
  };
}

test("route-hauler loads all A-to-B cargo and unloads it directly into B", () => {
  const loaded = route(baseStep, at(STATION_A, [], [{ division: 1, rows: [row(100, 3)] }], 0), {}, {});
  assert.deepEqual(loaded.action, {
    kind: "haulTransfer",
    itemID: 100,
    typeID: 34,
    quantity: 3,
    from: { kind: "corp", division: 1 },
    to: { kind: "cargo" },
    expectedStationID: STATION_A,
  });

  const depart = route(baseStep, at(STATION_A, [row(200, 3)], [{ division: 1, rows: [] }], 6), loaded.nextMem, {});
  assert.deepEqual(depart.action, { kind: "startRoute", stationID: STATION_B });

  const unloaded = route(
    baseStep,
    at(STATION_B, [row(200, 3)], [{ division: 2, rows: [] }], 6),
    depart.nextMem,
    {},
  );
  assert.deepEqual(unloaded.action, {
    kind: "haulTransfer",
    itemID: 200,
    typeID: 34,
    quantity: 3,
    from: { kind: "cargo" },
    to: { kind: "corp", division: 2 },
    expectedStationID: STATION_B,
  });
});

test("route-hauler loads and unloads enabled B-to-A return cargo", () => {
  const loaded = route(returnStep, at(STATION_B, [], [{ division: 3, rows: [row(300, 2, 35)] }], 0), state("loadB"), {});
  assert.deepEqual(loaded.action, {
    kind: "haulTransfer",
    itemID: 300,
    typeID: 35,
    quantity: 2,
    from: { kind: "corp", division: 3 },
    to: { kind: "cargo" },
    expectedStationID: STATION_B,
  });

  const depart = route(returnStep, at(STATION_B, [row(400, 2, 35)], [{ division: 3, rows: [] }], 4), loaded.nextMem, {});
  assert.deepEqual(depart.action, { kind: "startRoute", stationID: STATION_A });
  const unloaded = route(
    returnStep,
    at(STATION_A, [row(400, 2, 35)], [{ division: 4, rows: [] }, { division: 1, rows: [] }], 4),
    depart.nextMem,
    {},
  );
  assert.deepEqual(unloaded.action, {
    kind: "haulTransfer",
    itemID: 400,
    typeID: 35,
    quantity: 2,
    from: { kind: "cargo" },
    to: { kind: "corp", division: 4 },
    expectedStationID: STATION_A,
  });
});

test("route-hauler with return cargo disabled travels B-to-A empty after unloading", () => {
  const pending = {
    phase: "unloadB",
    direction: "aToB",
    movement: "unload",
    typeID: 34,
    quantity: 2,
    sourceBefore: 2,
    destinationBefore: 0,
  };
  const decision = route(
    baseStep,
    at(STATION_B, [], [{ division: 2, rows: [row(500, 2)] }], 0),
    state("unloadB", { "34": 2 }, {}, pending),
    {},
  );
  assert.deepEqual(decision.action, { kind: "startRoute", stationID: STATION_A });
  assert.equal((decision.nextMem["routeHauler"] as { phase: string }).phase, "travelToA");
});

test("route-hauler travels to B even when the A source is empty", () => {
  const decision = route(baseStep, at(STATION_A, [], [{ division: 1, rows: [] }], 0), {}, {});
  assert.deepEqual(decision.action, { kind: "startRoute", stationID: STATION_B });
  assert.equal(decision.outcome.kind, "acting");
});

test("route-hauler travels back to A when enabled return cargo has no matches", () => {
  const decision = route(returnStep, at(STATION_B, [], [{ division: 3, rows: [] }], 0), state("loadB"), {});
  assert.deepEqual(decision.action, { kind: "startRoute", stationID: STATION_A });
  assert.equal(decision.outcome.kind, "acting");
});

test("route-hauler multi-select loads matching typeIDs and leaves other types untouched", () => {
  const selected: MacroStep = {
    ...baseStep,
    args: {
      ...baseStep.args,
      itemsAToB: {
        kind: "itemList",
        items: [
          { match: "type", typeID: 34, name: "Tritanium" },
          { match: "type", typeID: 35, name: "Pyerite" },
        ],
      },
    },
  };
  const first = route(
    selected,
    at(STATION_A, [], [{ division: 1, rows: [row(100, 1, 36), row(101, 2, 34), row(102, 2, 35)] }], 0),
    {},
    {},
  );
  assert.equal(first.action.kind === "haulTransfer" ? first.action.typeID : null, 34);
  const second = route(
    selected,
    at(STATION_A, [row(201, 2, 34)], [{ division: 1, rows: [row(100, 1, 36), row(102, 2, 35)] }], 4),
    first.nextMem,
    {},
  );
  assert.equal(second.action.kind === "haulTransfer" ? second.action.typeID : null, 35);
  assert.equal(JSON.stringify(second.action).includes("36"), false);
});

test("route-hauler uses the selected Ore Hold without Cargo Hold fallback", () => {
  const oreStep: MacroStep = {
    ...baseStep,
    args: { ...baseStep.args, transportBay: { kind: "place", place: "ore-hold" } },
  };
  const decision = route(oreStep, at(STATION_A, [], [{ division: 1, rows: [oreRow(100, 2)] }], 0), {}, {});
  assert.equal(decision.action.kind, "haulTransfer");
  assert.deepEqual(decision.action.kind === "haulTransfer" ? decision.action.to : null, { kind: "shipBay", bay: "ore" });
});

test("route-hauler All mode loads only Ore Hold-compatible rows and travels past incompatible cargo", () => {
  const oreStep: MacroStep = {
    ...baseStep,
    args: { ...baseStep.args, transportBay: { kind: "place", place: "ore-hold" } },
  };
  const first = route(
    oreStep,
    at(STATION_A, [], [{ division: 1, rows: [oreRow(100, 2), moduleRow(101, 1)] }], 0),
    {},
    {},
  );
  assert.equal(first.action.kind === "haulTransfer" ? first.action.typeID : null, 1230);

  const depart = route(
    oreStep,
    at(STATION_A, [oreRow(200, 2)], [{ division: 1, rows: [moduleRow(101, 1)] }], 4),
    first.nextMem,
    {},
  );
  assert.deepEqual(depart.action, { kind: "startRoute", stationID: STATION_B });
  assert.equal(JSON.stringify([first.action, depart.action]).includes("9999"), false);
  assert.equal(JSON.stringify([first.action, depart.action]).includes('"kind":"cargo"'), false);
});

test("route-hauler blocks an explicitly selected incompatible Ore Hold item without fallback", () => {
  const selected: MacroStep = {
    ...baseStep,
    args: {
      ...baseStep.args,
      transportBay: { kind: "place", place: "ore-hold" },
      itemsAToB: { kind: "itemList", items: [{ match: "type", typeID: 9999, name: "Test Module" }] },
    },
  };
  const decision = route(selected, at(STATION_A, [], [{ division: 1, rows: [moduleRow(101, 1)] }], 0), {}, {});
  assert.equal(decision.outcome.kind, "blocked");
  assert.equal(decision.action.kind, "wait");
  assert.match(decision.outcome.kind === "blocked" ? decision.outcome.reason : "", /not classified.*Ore Hold/i);
  assert.equal(JSON.stringify(decision).includes('"kind":"cargo"'), false);
});

test("route-hauler blocks inventory refusal without a Personal Hangar fallback", () => {
  const decision = route(baseStep, at(STATION_A, [], [], 0, "CALL_REFUSED"), {}, {});
  assert.equal(decision.outcome.kind, "blocked");
  assert.equal(decision.action.kind, "wait");
  assert.equal(JSON.stringify(decision).includes('"kind":"hangar"'), false);
});

test("route-hauler blocks a fresh run with ambiguous selected-bay cargo", () => {
  const decision = route(baseStep, at(STATION_A, [row(900, 1)], [{ division: 1, rows: [] }], 2), {}, {});
  assert.equal(decision.outcome.kind, "blocked");
  assert.equal(decision.action.kind, "wait");
  assert.match(decision.outcome.kind === "blocked" ? decision.outcome.reason : "", /cannot adopt cargo/i);
});
