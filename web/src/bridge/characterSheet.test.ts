// Character-sheet decoders (goal R56) against REAL captured bytes.
//
// The fixtures below are the retail shapes, Farmer's (character 140000005, corp 98000001):
//   • charMgr.GetPublicInfo          -> a util.KeyVal of Tranquility's seventeen fields (the retail client's
//                                       cached answer of 2026-07-03: no security status among them)
//   • crimewatch.GetMySecurityStatus -> a bare float, the sheet's security status (characterOverviewPanel 153)
//   • charMgr.GetCharacterDescription-> a bare JS string
//   • charMgr.GetHomeStation         -> a single util.KeyVal
//   • charMgr.GetCloneInfo           -> a single util.KeyVal whose clones/implants
//     are {type:"dict", entries:[…]} — EMPTY for Farmer's clean clone
//
// ⚠ R7d: the identity decoder must carry ONLY name-resolvable ids + the security
// float. bloodline / race / ancestry are in the bytes but have no name path, so
// the decoder must NOT surface them; the sweep below proves they never leak, and
// its companion proves the sweep would catch one if it did.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCharacterDescription,
  decodeCharacterIdentity,
  decodeCloneSummary,
  decodeHomeStationID,
  formatSecurityStatus,
} from "./characterSheet.ts";
import type { JsonValue } from "./wire.ts";

function keyval(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: entries as JsonValue },
  };
}
function longVal(value: string): JsonValue {
  return { type: "long", value };
}
function dict(entries: readonly (readonly [JsonValue, JsonValue])[]): JsonValue {
  return { type: "dict", entries: entries as JsonValue };
}

// --- GetPublicInfo (Tranquility's KeyVal) -----------------------------------

// Tranquility's keys (the cached answer of 2026-07-03), Farmer's values.
const PUBLIC_INFO: JsonValue = keyval([
  ["characterID", 140000005],
  ["characterName", "Farmer"],
  ["typeID", 1386],
  ["raceID", 2],
  ["bloodlineID", 14],
  ["ancestryID", 64],
  ["schoolID", 33],
  ["careerID", 21],
  ["careerSpecialityID", 21],
  ["gender", true],
  ["createDateTime", longVal("134274243893290000")],
  ["corporationID", 98000001],
  ["corporationDateTime", longVal("134276026827720000")],
  ["allianceID", null],
  ["warFactionID", null],
  ["age", 0],
  ["description", "Character created via EveJS Elysian"],
]);

test("decodeCharacterIdentity reads the public KeyVal (name, corp) and the security status read beside it", () => {
  const identity = decodeCharacterIdentity(PUBLIC_INFO, 0.1404);
  assert.ok(identity, "Tranquility's GetPublicInfo shape must decode");
  assert.equal(identity!.characterID, 140000005);
  assert.equal(identity!.characterName, "Farmer");
  assert.equal(identity!.corporationID, 98000001);
  // Farmer is in no alliance — allianceID null in the bytes → null here.
  assert.equal(identity!.allianceID, null);
  // A FLOAT security status, shown as-is (not an id).
  assert.equal(identity!.securityStatus, 0.1404);
});

test("decodeCharacterIdentity OMITS bloodline / race / ancestry (no name path, R7d)", () => {
  const identity = decodeCharacterIdentity(PUBLIC_INFO, 0.1404) as unknown as Record<
    string,
    unknown
  >;
  // These ids are in the bytes but have no resolver — the decoder must not carry
  // them, so they can never reach the screen as raw numbers.
  assert.equal("bloodlineID" in identity, false);
  assert.equal("raceID" in identity, false);
  assert.equal("ancestryID" in identity, false);
});

test("decodeCharacterIdentity's security status is its own read's, never a field of the row", () => {
  const bare = keyval([
    ["characterID", 140000005],
    ["characterName", "Farmer"],
    ["corporationID", 98000001],
    ["allianceID", 99000001],
    ["securityStatus", -1.5],
  ]);
  const identity = decodeCharacterIdentity(bare, 2.5);
  assert.ok(identity);
  assert.equal(identity!.characterName, "Farmer");
  // A real alliance id survives as a number for name resolution.
  assert.equal(identity!.allianceID, 99000001);
  assert.equal(identity!.securityStatus, 2.5);
});

test("decodeCharacterIdentity returns null for a shape it did not get", () => {
  assert.equal(decodeCharacterIdentity(null), null);
  assert.equal(decodeCharacterIdentity({}), null);
  assert.equal(decodeCharacterIdentity("not a keyval"), null);
  // A list whose row carries neither id nor name is not a public-info row.
  assert.equal(decodeCharacterIdentity({ type: "list", items: [keyval([["bounty", 0]])] }), null);
});

// --- GetCharacterDescription (a bare string) --------------------------------

test("decodeCharacterDescription returns the bio, keeps '' as a real empty bio", () => {
  assert.equal(
    decodeCharacterDescription("Character created via EveJS Elysian"),
    "Character created via EveJS Elysian",
  );
  // "" is a REAL empty bio — distinct from a failed read.
  assert.equal(decodeCharacterDescription(""), "");
  // A non-string means the value was absent / the read failed.
  assert.equal(decodeCharacterDescription(null), null);
  assert.equal(decodeCharacterDescription({ type: "list", items: [] }), null);
});

// --- GetHomeStation (a single KeyVal) ---------------------------------------

const HOME_STATION: JsonValue = keyval([
  ["id", 60015249],
  ["stationID", 60015249],
  ["typeID", 92885],
  ["name", "Manifest V - AIR Laboratories Trade Center"],
  ["solarSystemID", 30100032],
  ["ownerID", 1000413],
  ["stationTypeID", 92885],
]);

test("decodeHomeStationID reads only the station id (name comes from /api/names)", () => {
  assert.equal(decodeHomeStationID(HOME_STATION), 60015249);
  assert.equal(decodeHomeStationID(null), null);
  assert.equal(decodeHomeStationID(keyval([["typeID", 92885]])), null);
  // homestation.types.StationData, as the home station service answers (recorded on Tranquility; this server's
  // answer through the generic call, 2026-10-10): the station is its `id`.
  const stationData = (name: string, fields: readonly (readonly [string, JsonValue])[]): JsonValue =>
    ({ type: "objectex2", header: [[{ type: "token", value: name }], { type: "dict", entries: fields as unknown as JsonValue }], list: [], dict: [] });
  const fields: readonly (readonly [string, JsonValue])[] = [["is_fallback", false], ["solar_system_id", 30000142], ["id", 60003760], ["type_id", 52678]];
  assert.equal(decodeHomeStationID(stationData("homestation.types.StationData", fields)), 60003760);
  // A station of none, or an object of another class with the same fields, is no home station.
  assert.equal(decodeHomeStationID(stationData("homestation.types.StationData", [["id", 0], ["type_id", 52678]])), null);
  assert.equal(decodeHomeStationID(stationData("homestation.types.StationData", [["type_id", 52678]])), null);
  assert.equal(decodeHomeStationID(stationData("homestation.types.StationCandidateData", fields)), null);
  assert.equal(decodeHomeStationID({ type: "objectex1", header: [[{ type: "token", value: "homestation.types.StationData" }], { type: "dict", entries: fields as unknown as JsonValue }], list: [], dict: [] }), null);
  assert.equal(decodeHomeStationID({ type: "objectex2", header: [{ type: "token", value: "homestation.types.StationData" }, { type: "dict", entries: fields as unknown as JsonValue }], list: [], dict: [] }), null);
  assert.equal(decodeHomeStationID({ type: "objectex2", list: [], dict: [] }), null);
  for (const header of [[], [null], [[]], [[null]], [5], ["homestation.types.StationData"]] as JsonValue[]) assert.equal(decodeHomeStationID({ type: "objectex2", header, list: [], dict: [] }), null, JSON.stringify(header));
});

// --- GetCloneInfo (KeyVal with dict clones/implants) ------------------------

// The REAL Farmer read: a clean clone — clones + implants are EMPTY dicts.
const CLONE_INFO_CLEAN: JsonValue = keyval([
  ["homeStationID", 60015249],
  ["cloneStationID", 60015249],
  ["clones", dict([])],
  ["implants", dict([])],
  ["timeLastJump", longVal("0")],
]);

test("decodeCloneSummary reads a clean clone honestly (no implants, no jump clones)", () => {
  const clone = decodeCloneSummary(CLONE_INFO_CLEAN);
  assert.ok(clone);
  assert.equal(clone!.homeStationID, 60015249);
  assert.deepEqual(clone!.implants, []);
  assert.equal(clone!.jumpCloneCount, 0);
});

// A synthetic populated clone: the same shape, but with two implants (dict of
// KeyVals keyed by an index) out of slot order, and one jump clone.
const CLONE_INFO_POPULATED: JsonValue = keyval([
  ["homeStationID", 60015249],
  ["cloneStationID", 60015249],
  [
    "clones",
    dict([[9001, keyval([["cloneID", 9001], ["name", "Backup"], ["stationID", 60015249]])]]),
  ],
  [
    "implants",
    dict([
      [2, keyval([["typeID", 9899], ["name", ""], ["slot", 6]])],
      [1, keyval([["typeID", 9941], ["name", ""], ["slot", 1]])],
    ]),
  ],
  ["timeLastJump", longVal("134276026827720000")],
]);

test("decodeCloneSummary reads implants (by typeID + slot, slot-sorted) and counts jump clones", () => {
  const clone = decodeCloneSummary(CLONE_INFO_POPULATED);
  assert.ok(clone);
  // Sorted by slot: slot 1 (typeID 9941) before slot 6 (typeID 9899).
  assert.deepEqual(clone!.implants, [
    { typeID: 9941, slot: 1 },
    { typeID: 9899, slot: 6 },
  ]);
  assert.equal(clone!.jumpCloneCount, 1);
});

test("decodeCloneSummary says what an answer does not carry: the implants alone leave the stations and the jump clones unsaid", () => {
  // On the game port the route answers the implants the client's own sheet lists, and nothing of the clone besides.
  const clone = decodeCloneSummary(keyval([["implants", dict([[1, keyval([["typeID", 9941], ["slot", 2]])]])]]));
  assert.deepEqual(clone, { homeStationID: null, cloneStationID: null, implants: [{ typeID: 9941, slot: 2 }], jumpCloneCount: null });
  // Each is said or not on its own.
  assert.deepEqual(decodeCloneSummary(keyval([["homeStationID", 60015249], ["implants", dict([])]])), { homeStationID: 60015249, cloneStationID: null, implants: [], jumpCloneCount: null });
  assert.deepEqual(decodeCloneSummary(keyval([["cloneStationID", 60015250], ["clones", dict([])]])), { homeStationID: null, cloneStationID: 60015250, implants: [], jumpCloneCount: 0 });
  // An answer that carries them, with none of either, says none.
  assert.deepEqual(decodeCloneSummary(CLONE_INFO_CLEAN), { homeStationID: 60015249, cloneStationID: 60015249, implants: [], jumpCloneCount: 0 });
});

test("decodeCloneSummary returns null when the KeyVal is absent (a failed read)", () => {
  assert.equal(decodeCloneSummary(null), null);
  assert.equal(decodeCloneSummary({ type: "list", items: [] }), null);
});

// --- formatSecurityStatus ----------------------------------------------------

test("formatSecurityStatus signs and rounds to two decimals with a real minus sign", () => {
  assert.equal(formatSecurityStatus(0.1404), "+0.14");
  assert.equal(formatSecurityStatus(-1.3), "−1.30");
  assert.equal(formatSecurityStatus(0), "0.00");
  assert.equal(formatSecurityStatus(5), "+5.00");
});
