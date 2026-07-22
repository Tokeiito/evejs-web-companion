// Sovereignty (sovMgr) reads decoder (goal R69) against real captured / builder-mirrored
// bytes. Farmer's highsec live captures are the EMPTY paths (no structures, null claim/hub,
// null fuel group). The POPULATED fixtures reproduce the server's payload builders exactly
// (sovPayloads.js: buildSovStructuresPayload KeyVal rows with bare-array campaign/
// vulnerability tuples; buildSovClaimInfoPayload / buildSovHubInfoPayload objectex1s).
// R7d: every id stays numeric; claim/campaign/vulnerability times are bigint FILETIMEs.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeSovStructures,
  decodeSovClaimInfo,
  decodeSovHubInfo,
  decodeFuelAccessGroup,
  decodeIsOnLocalFuelAccessGroup,
} from "./sov.ts";
import type { JsonValue } from "./wire.ts";

// --- wire-shape helpers (exact serviceHelpers output) ----------------------

function list(items: JsonValue[]): JsonValue {
  return { type: "list", items };
}
function dict(entries: [JsonValue, JsonValue][]): JsonValue {
  return { type: "dict", entries };
}
function keyval(entries: [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function long(value: string): JsonValue {
  return { type: "long", value };
}
/** buildObjectEx1: {type:"objectex1", header:[{token name}, [args]], list:[], dict:[]}. */
function objectex1(name: string, args: JsonValue[]): JsonValue {
  return {
    type: "objectex1",
    header: [{ type: "token", value: name }, args],
    list: [],
    dict: [],
  };
}

// --- GetSovStructuresInfoFor{Local,}SolarSystem -----------------------------

const SOV_STRUCT_PLAIN = keyval([
  ["itemID", 1030000000001],
  ["typeID", 32458],
  ["ownerID", 99000001],
  ["corporationID", 98000001],
  ["allianceID", 99000001],
  ["solarSystemID", 30004759],
  ["campaignState", null],
  ["vulnerabilityState", null],
  ["defenseMultiplier", 1],
  ["isCapital", false],
]);

// A structure mid-campaign, inside its vulnerability window (bare-array tuples, as the
// server's buildCampaignStatePayload / buildVulnerabilityStatePayload emit).
const SOV_STRUCT_ACTIVE = keyval([
  ["itemID", 1030000000002],
  ["typeID", 32226],
  ["ownerID", 99000002],
  ["corporationID", 98000002],
  ["allianceID", 99000002],
  ["solarSystemID", 30004760],
  // ⚠ campaignState / vulnerabilityState are BARE arrays on the wire (the server's
  // buildCampaignStatePayload / buildVulnerabilityStatePayload return `[...]`, not
  // buildList) — nested inside the KeyVal row, they cross as plain JSON arrays.
  ["campaignState", [7, 99000002, long("133500000000000000"), dict([[1, 40], [2, 15]])]],
  ["vulnerabilityState", [long("133500000000000000"), long("133500001000000000")]],
  ["defenseMultiplier", 6],
  ["isCapital", true],
]);

test("decodeSovStructures returns [] in highsec (real empty) and reads populated rows", () => {
  assert.deepEqual(decodeSovStructures(list([])), []);

  const rows = decodeSovStructures(list([SOV_STRUCT_PLAIN, SOV_STRUCT_ACTIVE]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    itemID: 1030000000001,
    typeID: 32458,
    ownerID: 99000001,
    corporationID: 98000001,
    allianceID: 99000001,
    solarSystemID: 30004759,
    campaignState: null,
    vulnerabilityState: null,
    defenseMultiplier: 1,
    isCapital: false,
  });
  // The active structure keeps its campaign + vulnerability detail, bigint times.
  assert.equal(rows[1]!.isCapital, true);
  assert.equal(rows[1]!.defenseMultiplier, 6);
  assert.equal(rows[1]!.campaignState!.campaignEventType, 7);
  assert.equal(rows[1]!.campaignState!.allianceID, 99000002);
  assert.equal(rows[1]!.campaignState!.campaignStartTime, 133500000000000000n);
  assert.deepEqual(rows[1]!.campaignState!.scoresByTeam, [
    { teamID: 1, score: 40 },
    { teamID: 2, score: 15 },
  ]);
  assert.equal(rows[1]!.vulnerabilityState!.vulnerableStartTime, 133500000000000000n);
  assert.equal(rows[1]!.vulnerabilityState!.vulnerableEndTime, 133500001000000000n);
});

test("decodeSovStructures drops a row with neither itemID nor typeID, and non-list input", () => {
  assert.deepEqual(decodeSovStructures(null), []);
  const rows = decodeSovStructures(list([keyval([["ownerID", 99000001]])]));
  assert.deepEqual(rows, []);
});

// --- GetSystemSovereigntyInfo (objectex1 SovClaimInfo | null) ---------------

// ⚠ The REAL highsec empty answer is the sovMgr.callMethod fallback `{type:"list",items:[]}`
// (a null handler return rewritten to an empty list), captured live — NOT a bare null. The
// objectex1 decoders must read null for both.
const SOV_EMPTY_FALLBACK: JsonValue = { type: "list", items: [] };

test("decodeSovClaimInfo returns null in highsec (real) and reads the objectex1 claim", () => {
  assert.equal(decodeSovClaimInfo(null), null);
  assert.equal(decodeSovClaimInfo(SOV_EMPTY_FALLBACK), null);
  const claim = decodeSovClaimInfo(
    objectex1("sovereignty.data_types.SovClaimInfo", [1030000000009, 98000001, 99000001]),
  );
  assert.deepEqual(claim, {
    claimStructureID: 1030000000009,
    corporationID: 98000001,
    allianceID: 99000001,
  });
});

// --- GetInfrastructureHubInfo (objectex1 SovHubInfo | null) ------------------

test("decodeSovHubInfo returns null in highsec (real) and reads the hub with bigint claimTime", () => {
  assert.equal(decodeSovHubInfo(null), null);
  assert.equal(decodeSovHubInfo(SOV_EMPTY_FALLBACK), null);
  const hub = decodeSovHubInfo(
    objectex1("sovereignty.data_types.SovHubInfo", [
      1030000000010,
      98000001,
      99000001,
      long("133000000000000000"),
    ]),
  );
  assert.equal(hub!.hubID, 1030000000010);
  assert.equal(hub!.corporationID, 98000001);
  assert.equal(hub!.allianceID, 99000001);
  assert.equal(hub!.claimTime, 133000000000000000n);
});

// --- GetSovHubFuelAccessGroup / IsOnLocalSovHubFuelAccessGroup ---------------

test("decodeFuelAccessGroup returns null (real, no hub) and reads a group id", () => {
  assert.equal(decodeFuelAccessGroup(null), null);
  assert.equal(decodeFuelAccessGroup(0), null);
  // The real highsec answer is the empty-list fallback, not null — also decodes to null.
  assert.equal(decodeFuelAccessGroup(SOV_EMPTY_FALLBACK), null);
  assert.equal(decodeFuelAccessGroup(140000042), 140000042);
});

test("decodeIsOnLocalFuelAccessGroup reads the boolean", () => {
  assert.equal(decodeIsOnLocalFuelAccessGroup(false), false);
  assert.equal(decodeIsOnLocalFuelAccessGroup(true), true);
  assert.equal(decodeIsOnLocalFuelAccessGroup(1), true);
});

// --- R7d sweep --------------------------------------------------------------

test("R7d: sov decoders keep numeric ids as data", () => {
  const rows = decodeSovStructures(list([SOV_STRUCT_PLAIN]));
  assert.equal(typeof rows[0]!.itemID, "number");
  assert.equal(typeof rows[0]!.ownerID, "number");
  const claim = decodeSovClaimInfo(
    objectex1("sovereignty.data_types.SovClaimInfo", [1030000000009, 98000001, 99000001]),
  );
  assert.equal(typeof claim!.corporationID, "number");
});
