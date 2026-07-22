// R79 — decoding the 8 small-service tail reads (wars / scan / PI-tax /
// corp-station), against REAL CAPTURED BYTES.
//
// The scan full-state, scan-target string, empty wars/negotiations, null
// GetWarNegotiation, IsAllianceOrCorpLocal, tax rate and (passed) standing check
// are VERBATIM from a live capture on 2026-07-22 (Farmer 140000005 / corp 98000001
// in system 30000144: one STRUCTURE scan site, no war, no negotiation, docked at an
// ungated station). The POPULATED war + negotiation fixtures mirror the SERVER's
// own encoders (warRegistryService.js buildWarPayload / buildWarNegotiationPayload:
// FILETIMEs via buildFiletimeLong -> {type:"long"}; reward/iskValue via Number();
// allies via a nested KeyVal dict) — this world seeds no war, so the populated row
// shape is taken from the real server code path, not guessed.
//
// The bigint fixtures matter: a war FILETIME, a > 2^53 reward and a > 2^53
// negotiation iskValue are asserted as EXACT decimal strings — a decoder that
// routed them through Number would be caught here (R7d).

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import {
  decodeFullState,
  decodeScanSites,
  decodeScanTargetID,
  decodeWars,
  decodeWar,
  decodeNegotiations,
  decodeWarNegotiation,
  decodeIsAllianceOrCorpLocal,
  decodeTaxRate,
  decodeBoundSmallServices,
} from "./boundSmallServices.ts";

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

// ===========================================================================
// scanMgr.GetScanTargetID — a bare signature-label string
// ===========================================================================

test("decodeScanTargetID reads the live signature label, and maps '' to null", () => {
  assert.equal(decodeScanTargetID("QEE-288"), "QEE-288"); // live capture
  assert.equal(decodeScanTargetID(""), null); // live capture for an unknown siteID
  assert.equal(decodeScanTargetID(null), null);
});

// ===========================================================================
// warRegistry.GetWars / GetNegotiations / GetWarNegotiation / IsAllianceOrCorpLocal
// ===========================================================================

test("decodeWars reads Farmer's live EMPTY war dict as [] (in no war — legitimate)", () => {
  assert.deepEqual(decodeWars(dict([])), []); // live capture
  assert.deepEqual(decodeWars(undefined), []);
});

test("decodeWar decodes a populated war with EXACT bigint FILETIMEs + reward + allies (R7d)", () => {
  // buildWarPayload-mirrored: > 2^53 timeDeclared and reward must survive as exact
  // strings; allies is a nested KeyVal dict.
  const war = decodeWar(
    keyVal([
      ["warID", 123],
      ["declaredByID", 98000001],
      ["againstID", 98000000],
      ["warHQID", null],
      ["warHQ", null],
      ["timeDeclared", long("133700000000000001")],
      ["timeStarted", long("133700000086400000")],
      ["timeFinished", null],
      ["retracted", null],
      ["retractedBy", null],
      ["billID", null],
      ["mutual", 0],
      ["openForAllies", 1],
      ["createdFromWarID", null],
      ["reward", long("9007199254740993")], // > 2^53
      [
        "allies",
        dict([
          [
            990091001,
            keyVal([
              ["allyID", 990091001],
              ["timeStarted", long("133700000090000000")],
              ["timeFinished", null],
            ]),
          ],
        ]),
      ],
    ]),
  );
  assert.equal(war.warID, 123);
  assert.equal(war.declaredByID, 98000001);
  assert.equal(war.againstID, 98000000);
  assert.equal(war.timeDeclared, "133700000000000001");
  assert.equal(war.timeStarted, "133700000086400000");
  assert.equal(war.timeFinished, null);
  assert.equal(war.mutual, 0);
  assert.equal(war.openForAllies, 1);
  assert.equal(war.reward, "9007199254740993"); // EXACT, not 9007199254740992
  assert.equal(war.allies.length, 1);
  const ally = war.allies[0];
  assert.ok(ally);
  assert.equal(ally.allyID, 990091001);
  assert.equal(ally.timeStarted, "133700000090000000");
  assert.equal(ally.timeFinished, null);
});

test("decodeWars keys off the dict values (warID-keyed dict -> war rows)", () => {
  const wars = decodeWars(
    dict([[123, keyVal([["warID", 123], ["reward", 500000000]])]]),
  );
  assert.equal(wars.length, 1);
  const war0 = wars[0];
  assert.ok(war0);
  assert.equal(war0.warID, 123);
  assert.equal(war0.reward, 500000000);
});

test("decodeNegotiations reads Farmer's live EMPTY list as [] (no negotiation seeded)", () => {
  assert.deepEqual(decodeNegotiations(list([])), []); // live capture
  assert.deepEqual(decodeNegotiations(undefined), []);
});

test("decodeWarNegotiation reads null (live) and a populated PRIVATE surrender offer", () => {
  assert.equal(decodeWarNegotiation(null), null); // live capture (any id -> null)
  const neg = decodeWarNegotiation(
    keyVal([
      ["warNegotiationID", 7],
      ["warID", 123],
      ["warNegotiationTypeID", 2],
      ["ownerID1", 98000001],
      ["ownerID2", 98000000],
      ["declaredByID", 98000001],
      ["againstID", 98000000],
      ["iskValue", long("9007199254740993")], // > 2^53 — EXACT
      ["description", "We surrender."],
      ["negotiationState", 1],
      ["createdDateTime", long("133700000000000005")],
      ["timeAccepted", null],
      ["timeDeclined", null],
      ["timeRetracted", null],
    ]),
  );
  assert.ok(neg);
  assert.equal(neg.warNegotiationID, 7);
  assert.equal(neg.warNegotiationTypeID, 2);
  assert.equal(neg.ownerID1, 98000001);
  assert.equal(neg.iskValue, "9007199254740993"); // EXACT bigint string
  assert.equal(neg.description, "We surrender.");
  assert.equal(neg.negotiationState, 1);
  assert.equal(neg.createdDateTime, "133700000000000005");
  assert.equal(neg.timeAccepted, null);
});

test("decodeNegotiations decodes a populated list of negotiation rows", () => {
  const rows = decodeNegotiations(
    list([keyVal([["warNegotiationID", 7], ["iskValue", 250000000], ["description", "ally"]])]),
  );
  assert.equal(rows.length, 1);
  const row0 = rows[0];
  assert.ok(row0);
  assert.equal(row0.warNegotiationID, 7);
  assert.equal(row0.iskValue, 250000000);
  assert.equal(row0.description, "ally");
});

test("decodeIsAllianceOrCorpLocal reads the constant flag (live 1)", () => {
  assert.equal(decodeIsAllianceOrCorpLocal(1), 1); // live capture
  assert.equal(decodeIsAllianceOrCorpLocal(0), 0);
});

// ===========================================================================
// planetOrbitalRegistryBroker.GetTaxRate
// ===========================================================================

test("decodeTaxRate reads the public per-office corp tax float (live 0.05)", () => {
  assert.equal(decodeTaxRate(0.05), 0.05); // live capture
  assert.equal(decodeTaxRate(0.1), 0.1);
  assert.equal(decodeTaxRate(null), null);
});

// ===========================================================================
// The whole GET /api/bridge/bound-small-services envelope
// ===========================================================================

// A live-shaped envelope: all reads succeed with Farmer's real (mostly empty) data.
const LIVE_ENVELOPE: JsonValue = {
  ok: true,
  characterID: 140000005,
  corporationID: 98000001,
  solarSystemID: 30000144,
  reads: {
    GetFullState: { result: LIVE_FULL_STATE },
    GetScanTargetID: { result: "QEE-288" },
    GetWars: { result: dict([]) },
    GetNegotiations: { result: list([]) },
    GetWarNegotiation: { result: null },
    IsAllianceOrCorpLocal: { result: 1 },
    GetTaxRate: { result: 0.05 },
    DoStandingCheckForStationService: { result: null },
  },
};

test("decodeBoundSmallServices folds the live envelope into typed data with no errors", () => {
  const decoded = decodeBoundSmallServices(LIVE_ENVELOPE);
  assert.equal(decoded.fullState.error, null);
  assert.equal(decoded.fullState.value.structures.length, 1);
  assert.equal(decoded.scanTargetID.value, "QEE-288");
  assert.deepEqual(decoded.wars.value, []);
  assert.deepEqual(decoded.negotiations.value, []);
  assert.equal(decoded.warNegotiation.value, null);
  assert.equal(decoded.isAllianceOrCorpLocal.value, 1);
  assert.equal(decoded.taxRate.value, 0.05);
  // The standing check PASSED: a null result with no error.
  assert.equal(decoded.standingCheck.value.passed, true);
  assert.equal(decoded.standingCheck.value.refusedMessage, null);
});

test("decodeBoundSmallServices reads a FAILED standing check as passed:false + the notify", () => {
  const decoded = decodeBoundSmallServices({
    reads: {
      DoStandingCheckForStationService: {
        error: "CALL_FAILED",
        message: "Your standings are too low to access this service.",
      },
    },
  });
  assert.equal(decoded.standingCheck.value.passed, false);
  assert.equal(
    decoded.standingCheck.value.refusedMessage,
    "Your standings are too low to access this service.",
  );
  assert.equal(decoded.standingCheck.error, "CALL_FAILED");
});

test("decodeBoundSmallServices carries a per-read error through without blanking the rest", () => {
  const decoded = decodeBoundSmallServices({
    reads: {
      GetFullState: { error: "READ_FAILED", message: null },
      GetTaxRate: { result: 0.05 },
    },
  });
  assert.equal(decoded.fullState.error, "READ_FAILED");
  assert.deepEqual(decoded.fullState.value.structures, []); // decoded empty, not thrown
  assert.equal(decoded.taxRate.error, null);
  assert.equal(decoded.taxRate.value, 0.05);
});

test("decodeBoundSmallServices tolerates a missing/empty envelope", () => {
  const decoded = decodeBoundSmallServices(null);
  assert.deepEqual(decoded.wars.value, []);
  assert.equal(decoded.taxRate.value, null);
  assert.equal(decoded.standingCheck.value.passed, true); // no error => treated as passed
});
