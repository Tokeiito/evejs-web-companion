// Decoders for the R2 docked station-panel reads, tested against
// handler-shaped fixtures (eve.js stationService.js / mapService.js shapes).

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeStationGuests,
  decodeStationItemBits,
  decodeStructureGuests,
  isCachedMethodCallResult,
} from "./stationPanel.ts";
import type { JsonValue } from "./wire.ts";

test("decodeStationItemBits decodes the retail 4-tuple (ownerID, itemID, operationID, stationTypeID)", () => {
  assert.deepEqual(decodeStationItemBits([1000035, 60003760, 26, 1529]), {
    ownerID: 1000035,
    stationID: 60003760,
    operationID: 26,
    stationTypeID: 1529,
  });
});

test("decodeStationItemBits tolerates malformed tuples with nulls", () => {
  assert.deepEqual(decodeStationItemBits([null, "x", -5] as unknown as JsonValue), {
    ownerID: null,
    stationID: null,
    operationID: null,
    stationTypeID: null,
  });
  assert.deepEqual(decodeStationItemBits({ not: "a tuple" }), {
    ownerID: null,
    stationID: null,
    operationID: null,
    stationTypeID: null,
  });
});

test("decodeStationGuests decodes the guest tuple list and drops malformed rows", () => {
  const wire: JsonValue = {
    type: "list",
    items: [
      [140000003, 98000000, 99000000, 0],
      [140000002, 98000000, null, null],
      ["not-a-charid", 1, 2, 3],
      "not-a-tuple",
    ],
  };
  assert.deepEqual(decodeStationGuests(wire), [
    {
      characterID: 140000003,
      corporationID: 98000000,
      allianceID: 99000000,
      warFactionID: null,
    },
    {
      characterID: 140000002,
      corporationID: 98000000,
      allianceID: null,
      warFactionID: null,
    },
  ]);
});

test("decodeStationGuests reads a guest's four as Tranquility sends them, a list in the list", () => {
  // station::GetGuests retval=[[2124510715, 1000169, None, None], [2123487805, 98651234, 99001234, None]]
  const wire: JsonValue = {
    type: "list",
    items: [
      { type: "list", items: [140000003, 98000000, 99000000, null] },
      { type: "list", items: [140000002, 98000000, null, null] },
      { type: "list", items: ["not-a-charid", 1, 2, 3] },
      { type: "dict", entries: [] },
    ],
  };
  assert.deepEqual(decodeStationGuests(wire), [
    {
      characterID: 140000003,
      corporationID: 98000000,
      allianceID: 99000000,
      warFactionID: null,
    },
    {
      characterID: 140000002,
      corporationID: 98000000,
      allianceID: null,
      warFactionID: null,
    },
  ]);
});

test("decodeStationGuests returns [] for non-list results", () => {
  assert.deepEqual(decodeStationGuests(null), []);
  assert.deepEqual(decodeStationGuests({ type: "dict", entries: [] }), []);
});

test("isCachedMethodCallResult recognizes the retail cached envelope (rawstring and plain name)", () => {
  assert.equal(
    isCachedMethodCallResult({
      type: "object",
      name: {
        type: "rawstr",
        value: "carbon.common.script.net.objectCaching.CachedMethodCallResult",
      },
      args: [],
    } as unknown as JsonValue),
    true,
  );
  assert.equal(
    isCachedMethodCallResult({
      type: "object",
      name: "carbon.common.script.net.objectCaching.CachedMethodCallResult",
      args: [],
    }),
    true,
  );
  assert.equal(isCachedMethodCallResult({ type: "list", items: [] }), false);
  assert.equal(isCachedMethodCallResult(null), false);
  assert.equal(isCachedMethodCallResult([1, 2, 3]), false);
});

// structureGuests.GetGuests answers a dict: each guest's (corporationID, allianceID, factionID) by its character
// (services/structure/structureGuests.py 25; dockedUI/guests.py 98 to 101). Tranquility's recording of a client
// docked alone in its citadel has a dict of one, the corporation and two Nones. The numbers here are made up.

test("decodeStructureGuests reads each guest's three by its character, and drops entries that name nobody", () => {
  const wire = {
    type: "dict",
    entries: [
      [140000003, [98000000, 99000000, 500001]],
      [140000002, [98000000, null, null]],
      ["not-a-charid", [1, 2, 3]],
      [0, [1, 2, 3]],
      "not-an-entry",
      null,
      // A guest whose three are not there is a guest still, with nothing known of it.
      [140000005, null],
      [140000006, [98000001]],
    ],
  } as unknown as JsonValue;
  assert.deepEqual(decodeStructureGuests(wire), [
    { characterID: 140000003, corporationID: 98000000, allianceID: 99000000, warFactionID: 500001 },
    { characterID: 140000002, corporationID: 98000000, allianceID: null, warFactionID: null },
    { characterID: 140000005, corporationID: null, allianceID: null, warFactionID: null },
    { characterID: 140000006, corporationID: 98000001, allianceID: null, warFactionID: null },
  ]);
});

test("decodeStructureGuests returns [] for what is no dict", () => {
  for (const none of [null, [], "x", 7, { type: "dict" }, { type: "list", items: [[140000003, 98000000, null, null]] }, { entries: [[140000003, [98000000, null, null]]] }]) {
    assert.deepEqual(decodeStructureGuests(none as unknown as JsonValue), [], JSON.stringify(none));
  }
});
