// Decoders for the R2 docked station-panel reads, tested against
// handler-shaped fixtures (eve.js stationService.js / mapService.js shapes).

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeStationGuests,
  decodeStationItemBits,
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
