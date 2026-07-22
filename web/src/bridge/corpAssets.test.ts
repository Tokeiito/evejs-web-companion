// R61 corp asset decoders against REAL captured bytes.
//
// The fixtures below are the EXACT retail shapes captured live from Farmer
// (character 140000005, corp 98000001) through GET /api/bridge/corp-assets on
// 2026-07-22. Each asset read is a CRowset (objectex2) wrapped in a
// CachedMethodCallResult — the decoder unwraps BOTH layers, so these fixtures
// carry the wrapper verbatim, not a pre-unwrapped rowset.
//
//   • GetAssetInventory("offices")            -> POPULATED: one office location
//     [locationID 60003760, solarsystemID 30000142, typeID 52678].
//   • GetAssetInventoryForLocation(property)  -> POPULATED: three items at the
//     corp's structure 1030000000001, incl. an assembled singleton (quantity -1)
//     and a 2403-stack. itemID 9988400029054 exceeds 2^32 (bigint-safe path).
//   • SearchAssets("offices")                 -> POPULATED: one [locationID] row.
//   • GetAllMyCorporationWalletLPBalances-adjacent empties: the offices
//     per-location items read and the deliveries inventory are EMPTY for Farmer
//     — a legitimate "no corp assets in this bucket" state, not a bug.
//
// ⚠ The location column is `solarsystemID` (lowercase s), NOT `solarSystemID`;
// reading the wrong case silently blanks the field. R7d: every id survives as a
// numeric field for a future UI to resolve.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpAssetLocations,
  decodeCorpAssetItems,
  decodeCorpAssetSearch,
} from "./corpAssets.ts";
import type { JsonValue } from "./wire.ts";

// A CachedMethodCallResult wrapping a CRowset whose rows are `fieldRows`
// (name-keyed packedrows), over `columns`. Mirrors buildCachedMethodCallResult +
// buildDbRowset(..., "carbon...CRowset") exactly as captured.
function cachedCrowset(
  columns: readonly (readonly [string, number])[],
  fieldRows: readonly Record<string, JsonValue>[],
): JsonValue {
  const descriptor = {
    type: "objectex1",
    header: [{ type: "token", value: "blue.DBRowDescriptor" }, [[columns]]],
    list: [],
    dict: [],
  };
  return {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      { type: "dict", entries: [] },
      {
        type: "substream",
        value: {
          type: "objectex2",
          header: [
            [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
            { type: "dict", entries: [["header", descriptor]] },
          ],
          list: fieldRows.map((fields) => ({
            type: "packedrow",
            header: descriptor,
            columns,
            fields,
          })),
          dict: [],
        },
      },
      { type: "list", items: [{ type: "long", value: "134291934883450000" }, -154191958] },
    ],
  } as unknown as JsonValue;
}

const LOCATION_COLUMNS = [
  ["locationID", 20],
  ["solarsystemID", 20],
  ["typeID", 3],
] as const;
const DELIVERY_COLUMNS = [
  ["locationID", 20],
  ["itemCount", 20],
  ["solarsystemID", 20],
  ["typeID", 3],
] as const;
const ITEM_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["stacksize", 3],
  ["singleton", 3],
] as const;

// GetAssetInventory("offices") — the exact single office location captured.
const REAL_OFFICES_INVENTORY = cachedCrowset(LOCATION_COLUMNS, [
  { locationID: 60003760, solarsystemID: 30000142, typeID: 52678 },
]);

// GetAssetInventoryForLocation(property, 1030000000001) — the three real items.
const REAL_PROPERTY_ITEMS = cachedCrowset(ITEM_COLUMNS, [
  { itemID: 9988400029054, typeID: 56201, ownerID: 98000001, locationID: 1030000000001, flagID: 4, quantity: -1, groupID: 4086, categoryID: 66, customInfo: "", stacksize: 1, singleton: 1 },
  { itemID: 9988400029817, typeID: 35894, ownerID: 98000001, locationID: 1030000000001, flagID: 164, quantity: -1, groupID: 1321, categoryID: 66, customInfo: "", stacksize: 1, singleton: 1 },
  { itemID: 9988400029056, typeID: 4247, ownerID: 98000001, locationID: 1030000000001, flagID: 172, quantity: 2403, groupID: 1136, categoryID: 4, customInfo: "", stacksize: 2403, singleton: 0 },
]);

// SearchAssets("offices") — one [locationID] row.
const REAL_SEARCH = cachedCrowset([["locationID", 20]], [{ locationID: 60003760 }]);

// The empty deliveries inventory Farmer's corp genuinely returns.
const REAL_EMPTY_DELIVERIES = cachedCrowset(DELIVERY_COLUMNS, []);

test("decodeCorpAssetLocations unwraps the cached CRowset to the real office location", () => {
  assert.deepEqual(decodeCorpAssetLocations(REAL_OFFICES_INVENTORY), [
    { locationID: 60003760, solarSystemID: 30000142, typeID: 52678, itemCount: null },
  ]);
});

test("decodeCorpAssetLocations reads the lowercase solarsystemID column", () => {
  // Guard against the solarSystemID/solarsystemID case trap: a wrong case would
  // blank solarSystemID to null while locationID stays set.
  const rows = decodeCorpAssetLocations(REAL_OFFICES_INVENTORY);
  assert.equal(rows[0]?.solarSystemID, 30000142);
});

test("decodeCorpAssetLocations carries the deliveries itemCount column when present", () => {
  const deliveries = cachedCrowset(DELIVERY_COLUMNS, [
    { locationID: 60003760, itemCount: 4, solarsystemID: 30000142, typeID: 52678 },
  ]);
  assert.deepEqual(decodeCorpAssetLocations(deliveries), [
    { locationID: 60003760, solarSystemID: 30000142, typeID: 52678, itemCount: 4 },
  ]);
});

test("decodeCorpAssetLocations on the real empty deliveries bucket is [] (legitimate empty)", () => {
  assert.deepEqual(decodeCorpAssetLocations(REAL_EMPTY_DELIVERIES), []);
});

test("decodeCorpAssetItems unwraps the cached CRowset to the three real items", () => {
  assert.deepEqual(decodeCorpAssetItems(REAL_PROPERTY_ITEMS), [
    { itemID: 9988400029054, typeID: 56201, ownerID: 98000001, locationID: 1030000000001, flagID: 4, quantity: -1, units: 1, singleton: true, groupID: 4086, categoryID: 66, customInfo: "", stacksize: 1 },
    { itemID: 9988400029817, typeID: 35894, ownerID: 98000001, locationID: 1030000000001, flagID: 164, quantity: -1, units: 1, singleton: true, groupID: 1321, categoryID: 66, customInfo: "", stacksize: 1 },
    { itemID: 9988400029056, typeID: 4247, ownerID: 98000001, locationID: 1030000000001, flagID: 172, quantity: 2403, units: 2403, singleton: false, groupID: 1136, categoryID: 4, customInfo: "", stacksize: 2403 },
  ]);
});

test("decodeCorpAssetItems keeps a >2^32 itemID exact (bigint-safe, under 2^53)", () => {
  const rows = decodeCorpAssetItems(REAL_PROPERTY_ITEMS);
  assert.equal(rows[0]?.itemID, 9988400029054);
  assert.ok((rows[0]?.itemID ?? 0) > 2 ** 32);
});

test("decodeCorpAssetItems computes units as stacksize for a stack, 1 for a singleton", () => {
  const rows = decodeCorpAssetItems(REAL_PROPERTY_ITEMS);
  // The assembled singleton reports quantity -1 on the wire; units must be 1, not -1.
  assert.equal(rows[0]?.units, 1);
  assert.equal(rows[2]?.units, 2403);
});

test("decodeCorpAssetItems on an empty location is [] (a real 'nothing here')", () => {
  assert.deepEqual(decodeCorpAssetItems(cachedCrowset(ITEM_COLUMNS, [])), []);
});

test("decodeCorpAssetSearch unwraps the cached CRowset to the matching location", () => {
  assert.deepEqual(decodeCorpAssetSearch(REAL_SEARCH), [{ locationID: 60003760 }]);
});

test("the asset decoders return [] for a non-cached / malformed value", () => {
  assert.deepEqual(decodeCorpAssetLocations(null), []);
  assert.deepEqual(decodeCorpAssetItems({ type: "list", items: [] }), []);
  assert.deepEqual(decodeCorpAssetSearch(42), []);
});
