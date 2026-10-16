// Decoding the scanner's full state (scanMgr.GetFullState) against real captured bytes: verbatim from a live capture
// on 2026-07-22 (Farmer 140000005 in system 30000144: one structure scan site), and a live anomaly's and signature's
// slot fields. (The tests of the war, negotiation, tax and standing-check reads went with their decoders.)

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import { decodeFullState, decodeScanSites } from "./boundSmallServices.ts";

// --- helpers ----------------------------------------------------------------

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: entries.map(([k, v]) => [k, v]) },
  };
}
function dict(entries: readonly (readonly [JsonValue, JsonValue])[]): JsonValue {
  return { type: "dict", entries: entries.map(([k, v]) => [k, v]) };
}
function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items: [...items] };
}
function long(value: string): JsonValue {
  return { type: "long", value };
}
function real(value: number): JsonValue {
  return { type: "real", value };
}

// ===========================================================================
// scanMgr.GetFullState — Farmer's live 4-tuple (one structure site)
// ===========================================================================

// VERBATIM from the live capture: [anomalies{}, signatures{}, staticSites{},
// structures{ 1030000000001 -> {typeID,groupID,categoryID,position,targetID} }].
const LIVE_FULL_STATE: JsonValue = [
  dict([]),
  dict([]),
  dict([]),
  dict([
    [
      1030000000001,
      keyVal([
        ["typeID", 35832],
        ["groupID", 1657],
        ["categoryID", 65],
        ["position", [real(800382013408.2244), real(54164076845.46208), real(1112590660754.3835)]],
        ["targetID", "QEE-288"],
      ]),
    ],
  ]),
];

test("decodeFullState reads Farmer's live system scan (empty anomalies/sigs/static, one structure)", () => {
  const fs = decodeFullState(LIVE_FULL_STATE);
  assert.deepEqual(fs.anomalies, []);
  assert.deepEqual(fs.signatures, []);
  assert.deepEqual(fs.staticSites, []);
  assert.equal(fs.structures.length, 1);
  const site = fs.structures[0];
  assert.ok(site);
  assert.equal(site.siteID, 1030000000001);
  assert.equal(site.targetID, "QEE-288");
  assert.deepEqual(site.position, [800382013408.2244, 54164076845.46208, 1112590660754.3835]);
  assert.equal(site.fields.typeID, 35832);
  assert.equal(site.fields.groupID, 1657);
  assert.equal(site.fields.categoryID, 65);
});

// VERBATIM from a live capture (GM Elysian 140000004 in system 30000140): the
// anomalies slot [0] carries buildAnomalySiteInfo's full field set — Farmer's own
// system had only a structure, so this second live capture exercises the anomaly slot.
const LIVE_ANOMALY_STATE: JsonValue = [
  dict([
    [
      5380000140001,
      keyVal([
        ["position", [real(-883788607652.584), real(-123058495852.71881), real(497031258348.9413)]],
        ["targetID", "FTW-038"],
        ["difficulty", 1],
        ["dungeonID", 2154],
        ["archetypeID", 24],
        ["siteID", 5256],
        ["instanceID", 5256],
        ["dungeonNameID", 110922],
        ["factionID", 500010],
        ["scanStrengthAttribute", 1136],
        ["allowedTypes", []],
        ["entryObjectTypeID", 28356],
        ["solarSystemID", 30000140],
      ]),
    ],
  ]),
  dict([]),
  dict([]),
  dict([]),
];

test("decodeFullState reads a live ANOMALY with its full slot field set (no field dropped)", () => {
  const fs = decodeFullState(LIVE_ANOMALY_STATE);
  assert.equal(fs.anomalies.length, 1);
  assert.deepEqual(fs.signatures, []);
  assert.deepEqual(fs.structures, []);
  const anom = fs.anomalies[0];
  assert.ok(anom);
  assert.equal(anom.siteID, 5380000140001);
  assert.equal(anom.targetID, "FTW-038");
  assert.deepEqual(anom.position, [-883788607652.584, -123058495852.71881, 497031258348.9413]);
  // Every anomaly-specific field must survive in `fields`, decoded losslessly.
  assert.equal(anom.fields.difficulty, 1);
  assert.equal(anom.fields.dungeonID, 2154);
  assert.equal(anom.fields.archetypeID, 24);
  assert.equal(anom.fields.instanceID, 5256);
  assert.equal(anom.fields.dungeonNameID, 110922);
  assert.equal(anom.fields.factionID, 500010);
  assert.equal(anom.fields.scanStrengthAttribute, 1136);
  assert.equal(anom.fields.entryObjectTypeID, 28356);
  assert.equal(anom.fields.solarSystemID, 30000140);
  assert.deepEqual(anom.fields.allowedTypes, []);
});

test("decodeFullState preserves SLOT-SPECIFIC signature fields (difficulty/dungeon/deviation)", () => {
  // Builder-mirrored signature row (buildSignatureSiteInfo): position, targetID,
  // difficulty, dungeonID, archetypeID, deviation. A > 2^53 siteID stays an exact
  // string (R7d), and slot-specific fields must survive in `fields`.
  const bigSiteID = "9223372036854775001"; // > 2^53
  const fs = decodeFullState([
    dict([]),
    dict([
      [
        bigSiteID,
        keyVal([
          ["position", [real(1), real(2), real(3)]],
          ["targetID", "ABC-123"],
          ["difficulty", 4],
          ["dungeonID", null],
          ["archetypeID", null],
          ["deviation", real(1500)],
        ]),
      ],
    ]),
    dict([]),
    dict([]),
  ]);
  assert.equal(fs.signatures.length, 1);
  const sig = fs.signatures[0];
  assert.ok(sig);
  assert.equal(sig.siteID, bigSiteID, "a > 2^53 siteID must stay an EXACT string, not Number");
  assert.equal(sig.targetID, "ABC-123");
  assert.deepEqual(sig.position, [1, 2, 3]);
  assert.equal(sig.fields.difficulty, 4);
  assert.equal(sig.fields.dungeonID, null);
  assert.equal(sig.fields.deviation, 1500);
});

test("decodeScanSites returns [] for an empty dict (a legitimately unscanned slot)", () => {
  assert.deepEqual(decodeScanSites(dict([])), []);
  assert.deepEqual(decodeScanSites(undefined), []);
});
