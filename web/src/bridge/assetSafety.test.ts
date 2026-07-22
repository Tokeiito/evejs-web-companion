// R71 — decoding structureAssetSafety's four reads, against REAL CAPTURED BYTES.
//
// The four EMPTY fixtures are verbatim from a live read (rrfarmer → Farmer 140000005,
// corp 98000001) on 2026-07-22 — Farmer has no asset-safety wraps, so empty is the real
// state. The POPULATED wrap/target/name fixtures are built from the server's KeyVal /
// CachedMethodCallResult / dict encoders (buildWrapPayload / buildStationInfoPayload).

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import {
  decodeCharacterWraps,
  decodeCorpWraps,
  decodeDeliveryTargets,
  decodeWrapNames,
} from "./assetSafety.ts";

// --- helpers to build the marshaled shapes the server emits -----------------

function kv(entries: readonly [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items };
}
const STATION = kv([
  ["itemID", 60003760],
  ["typeID", 52678],
  ["solarSystemID", 30000142],
  ["itemName", "Jita IV - Moon 4 - Caldari Navy Assembly Plant"],
]);
function wrap(id: number, station: JsonValue | null): JsonValue {
  return kv([
    ["solarSystemID", 30000142],
    ["assetWrapID", id],
    ["wrapName", `Asset Safety Wrap ${id}`],
    ["ejectTime", { type: "long", value: "134292142874570000" }],
    ["daysUntilCanDeliverConst", 5],
    ["daysUntilAutoMoveConst", 20],
    ["nearestNPCStationInfo", station],
  ]);
}

// --- Real (live) empty bytes ------------------------------------------------

const LIVE_CHAR_EMPTY: JsonValue = { type: "list", items: [] };

const LIVE_CORP_EMPTY: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "1 minute" }]] },
    { type: "substream", value: { type: "list", items: [] } },
    { type: "list", items: [{ type: "long", value: "134292142874570000" }, 52428965] },
  ],
};

const LIVE_DELIVER_EMPTY: JsonValue = [{ type: "list", items: [] }, null];

const LIVE_WRAPNAMES_EMPTY: JsonValue = { type: "dict", entries: [] };

// --- decodeCharacterWraps ---------------------------------------------------

test("decodeCharacterWraps returns [] for Farmer's live empty list", () => {
  assert.deepEqual(decodeCharacterWraps(LIVE_CHAR_EMPTY), []);
});

test("decodeCharacterWraps decodes wrap KeyVals, keeps ejectTime bigint, sorts by id", () => {
  const wraps = decodeCharacterWraps(list([wrap(7002, null), wrap(7001, STATION)]));
  assert.equal(wraps.length, 2);
  assert.equal(wraps[0]!.assetWrapID, 7001);
  assert.equal(wraps[1]!.assetWrapID, 7002);
  assert.deepEqual(wraps[0], {
    assetWrapID: 7001,
    solarSystemID: 30000142,
    wrapName: "Asset Safety Wrap 7001",
    ejectTime: 134292142874570000n,
    daysUntilCanDeliver: 5,
    daysUntilAutoMove: 20,
    nearestNPCStation: {
      itemID: 60003760,
      typeID: 52678,
      solarSystemID: 30000142,
      itemName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
    },
  });
  assert.equal(wraps[1]!.nearestNPCStation, null);
});

// --- decodeCorpWraps (⚠ nested in the CachedMethodCallResult substream) ------

test("decodeCorpWraps returns [] for the live empty CachedMethodCallResult substream", () => {
  assert.deepEqual(decodeCorpWraps(LIVE_CORP_EMPTY), []);
});

test("decodeCorpWraps unwraps the substream to reach the corp wrap list", () => {
  const populated: JsonValue = {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      { type: "dict", entries: [] },
      { type: "substream", value: list([wrap(9001, STATION)]) },
      { type: "list", items: [{ type: "long", value: "1" }, 1] },
    ],
  };
  const wraps = decodeCorpWraps(populated);
  assert.equal(wraps.length, 1);
  assert.equal(wraps[0]!.assetWrapID, 9001);
  assert.equal(wraps[0]!.nearestNPCStation?.itemID, 60003760);
});

// --- decodeDeliveryTargets --------------------------------------------------

test("decodeDeliveryTargets returns empty structures + null station for the live [emptyList, null]", () => {
  assert.deepEqual(decodeDeliveryTargets(LIVE_DELIVER_EMPTY), {
    structures: [],
    nearestNPCStation: null,
  });
});

test("decodeDeliveryTargets decodes the [structures, station] 2-tuple", () => {
  const structure = kv([
    ["itemID", 1030000000001],
    ["typeID", 35832],
    ["solarSystemID", 30000142],
    ["itemName", "Farmer's Astrahus"],
  ]);
  const targets = decodeDeliveryTargets([list([structure]), STATION]);
  assert.equal(targets.structures.length, 1);
  assert.deepEqual(targets.structures[0], {
    itemID: 1030000000001,
    typeID: 35832,
    solarSystemID: 30000142,
    itemName: "Farmer's Astrahus",
  });
  assert.equal(targets.nearestNPCStation?.itemID, 60003760);
});

// --- decodeWrapNames --------------------------------------------------------

test("decodeWrapNames returns [] for the live empty dict", () => {
  assert.deepEqual(decodeWrapNames(LIVE_WRAPNAMES_EMPTY), []);
});

test("decodeWrapNames decodes the wrapID -> name dict, keeps unknown names null", () => {
  const names = decodeWrapNames({
    type: "dict",
    entries: [
      [7002, "Named Wrap"],
      [7001, null],
    ],
  });
  assert.deepEqual(names, [
    { wrapID: 7001, name: null },
    { wrapID: 7002, name: "Named Wrap" },
  ]);
});
