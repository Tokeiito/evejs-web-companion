// Character-sheet decoders (goal R56) against REAL captured bytes.
//
// The fixtures below are the exact retail shapes captured live from Farmer
// (character 140000005, corp 98000001) through the BFF on 2026-07-22:
//   • charMgr.GetPublicInfo3         -> {type:"list", items:[util.KeyVal{…}]}
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

// --- GetPublicInfo3 (the real list-wrapped KeyVal) --------------------------

// Verbatim from the live read: a list of ONE util.KeyVal.
const PUBLIC_INFO_3: JsonValue = {
  type: "list",
  items: [
    keyval([
      ["characterID", 140000005],
      ["characterName", "Farmer"],
      ["typeID", 1386],
      ["raceID", 2],
      ["bloodlineID", 14],
      ["ancestryID", 64],
      ["corporationID", 98000001],
      ["allianceID", null],
      ["factionID", 500001],
      ["empireID", 500001],
      ["schoolID", 33],
      ["gender", 1],
      ["createDateTime", longVal("134274243893290000")],
      ["startDateTime", longVal("134276026827720000")],
      ["description", "Character created via EveJS Elysian"],
      ["securityRating", 0.1404],
      ["securityStatus", 0.1404],
      ["bounty", 0],
      ["title", ""],
      ["shortName", "none"],
      ["stationID", 60000358],
      ["solarSystemID", 30000144],
      ["militiaFactionID", null],
      ["medal1GraphicID", null],
    ]),
  ],
};

test("decodeCharacterIdentity reads the list-wrapped KeyVal (name, corp, security)", () => {
  const identity = decodeCharacterIdentity(PUBLIC_INFO_3);
  assert.ok(identity, "the real GetPublicInfo3 shape must decode");
  assert.equal(identity!.characterID, 140000005);
  assert.equal(identity!.characterName, "Farmer");
  assert.equal(identity!.corporationID, 98000001);
  // Farmer is in no alliance — allianceID null in the bytes → null here.
  assert.equal(identity!.allianceID, null);
  // A FLOAT security status, shown as-is (not an id).
  assert.equal(identity!.securityStatus, 0.1404);
});

test("decodeCharacterIdentity OMITS bloodline / race / ancestry (no name path, R7d)", () => {
  const identity = decodeCharacterIdentity(PUBLIC_INFO_3) as unknown as Record<
    string,
    unknown
  >;
  // These ids are in the bytes but have no resolver — the decoder must not carry
  // them, so they can never reach the screen as raw numbers.
  assert.equal("bloodlineID" in identity, false);
  assert.equal("raceID" in identity, false);
  assert.equal("ancestryID" in identity, false);
});

test("decodeCharacterIdentity tolerates a bare KeyVal (the GetPublicInfo sibling)", () => {
  const bare = keyval([
    ["characterID", 140000005],
    ["characterName", "Farmer"],
    ["corporationID", 98000001],
    ["allianceID", 99000001],
    ["securityStatus", -1.5],
  ]);
  const identity = decodeCharacterIdentity(bare);
  assert.ok(identity);
  assert.equal(identity!.characterName, "Farmer");
  // A real alliance id survives as a number for name resolution.
  assert.equal(identity!.allianceID, 99000001);
  assert.equal(identity!.securityStatus, -1.5);
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
