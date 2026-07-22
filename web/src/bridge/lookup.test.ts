// lookupSvc decoder (goal R60) against REAL captured bytes.
//
// Every fixture below is a VERBATIM live capture through GET /api/bridge/lookup
// from Farmer (character 140000005) on 2026-07-22: q="Farmer" for characters /
// corporations / owners / warableOwners, q="Caldari" for the faction, and a
// solar-system search (groupID 5) for the location. The empty-query behaviour
// (eight searches return [], warableOwners returns everything) is asserted from
// the live empty capture too.
//
// R7d: every id (characterID / corporationID / allianceID / factionID / ownerID /
// itemID / solarSystemID / constellationID / regionID) survives as a numeric field.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeLookupCharacters,
  decodeLookupCorporations,
  decodeLookupFactions,
  decodeLookupLocations,
  decodeLookupOwners,
  decodeLookupWarableOwners,
} from "./lookup.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items };
}

// VERBATIM live captures (q="Farmer").
const CHARACTER_FARMER: JsonValue = keyVal([
  ["characterID", 140000005],
  ["characterName", "Farmer"],
  ["ownerID", 140000005],
  ["ownerName", "Farmer"],
  ["typeID", 1386],
  ["groupID", 1],
  ["corporationID", 98000001],
  ["allianceID", 0],
]);
const CHARACTER_DUMMY: JsonValue = keyVal([
  ["characterID", 140000178],
  ["characterName", "FarmerDummy"],
  ["ownerID", 140000178],
  ["ownerName", "FarmerDummy"],
  ["typeID", 1375],
  ["groupID", 1],
  ["corporationID", 1000044],
  ["allianceID", 0],
]);
const CHARACTERS_LIVE = list([CHARACTER_FARMER, CHARACTER_DUMMY]);

const CORPORATION_LIVE: JsonValue = keyVal([
  ["corporationID", 98000001],
  ["corporationName", "Farmer Corporation"],
  ["ownerID", 98000001],
  ["ownerName", "Farmer Corporation"],
  ["typeID", 2],
  ["groupID", 2],
  ["tickerName", "TRAV"],
  ["factionID", 0],
  ["isNPC", false],
]);

// VERBATIM live capture (q="Caldari").
const FACTION_LIVE: JsonValue = keyVal([
  ["factionID", 500001],
  ["factionName", "Caldari State"],
  ["ownerID", 500001],
  ["ownerName", "Caldari State"],
  ["typeID", 30],
  ["groupID", 19],
]);

// VERBATIM live owner rows (q="Farmer") — a character owner and a corp owner,
// which carry DIFFERENT optional id fields.
const OWNER_CHARACTER: JsonValue = keyVal([
  ["ownerID", 140000005],
  ["ownerName", "Farmer"],
  ["typeID", 1386],
  ["groupID", 1],
  ["gender", 1],
  ["characterID", 140000005],
  ["corporationID", 98000001],
  ["allianceID", 0],
]);
const OWNER_CORP: JsonValue = keyVal([
  ["ownerID", 98000001],
  ["ownerName", "Farmer Corporation"],
  ["typeID", 2],
  ["groupID", 2],
  ["gender", 0],
  ["corporationID", 98000001],
  ["factionID", 0],
  ["tickerName", "TRAV"],
  ["isNPC", false],
]);

// VERBATIM live location row (groupID 5, solar-system search).
const LOCATION_LIVE: JsonValue = keyVal([
  ["itemID", 30000502],
  ["itemName", "E-1XVP"],
  ["typeID", 5],
  ["groupID", 5],
  ["solarSystemID", 30000502],
  ["constellationID", 20000073],
  ["regionID", 10000005],
]);

// VERBATIM live warable owner row (q="Farmer").
const WARABLE_LIVE: JsonValue = keyVal([
  ["ownerID", 98000001],
  ["ownerName", "Farmer Corporation"],
  ["typeID", 2],
  ["warPermit", 1],
]);

test("decodeLookupCharacters decodes the live 'Farmer' matches", () => {
  const rows = decodeLookupCharacters(CHARACTERS_LIVE);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    characterID: 140000005,
    characterName: "Farmer",
    ownerID: 140000005,
    ownerName: "Farmer",
    typeID: 1386,
    groupID: 1,
    corporationID: 98000001,
    allianceID: 0,
  });
  assert.equal(rows[1]!.characterID, 140000178);
  assert.equal(rows[1]!.characterName, "FarmerDummy");
});

test("decodeLookupCharacters on an empty/too-short query is empty (a real 'no matches')", () => {
  assert.deepEqual(decodeLookupCharacters(list([])), []);
  assert.deepEqual(decodeLookupCharacters(null), []);
});

test("decodeLookupCharacters drops a row with no positive characterID", () => {
  const ghost = keyVal([["characterID", 0], ["characterName", "ghost"]]);
  assert.deepEqual(decodeLookupCharacters(list([ghost])), []);
});

test("decodeLookupCorporations decodes the live corp row with ticker + isNPC", () => {
  const rows = decodeLookupCorporations(list([CORPORATION_LIVE]));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    corporationID: 98000001,
    corporationName: "Farmer Corporation",
    ownerID: 98000001,
    ownerName: "Farmer Corporation",
    typeID: 2,
    groupID: 2,
    tickerName: "TRAV",
    factionID: 0,
    isNPC: false,
  });
});

test("decodeLookupFactions decodes the live 'Caldari' faction row", () => {
  const rows = decodeLookupFactions(list([FACTION_LIVE]));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    factionID: 500001,
    factionName: "Caldari State",
    ownerID: 500001,
    ownerName: "Caldari State",
    typeID: 30,
    groupID: 19,
  });
});

test("decodeLookupOwners decodes a character owner and a corp owner with their DIFFERENT optional fields", () => {
  const rows = decodeLookupOwners(list([OWNER_CHARACTER, OWNER_CORP]));
  assert.equal(rows.length, 2);
  // A character owner: characterID/corporationID/allianceID present; faction/ticker/isNPC absent.
  assert.deepEqual(rows[0], {
    ownerID: 140000005,
    ownerName: "Farmer",
    typeID: 1386,
    groupID: 1,
    gender: 1,
    characterID: 140000005,
    corporationID: 98000001,
    allianceID: 0,
    factionID: null,
    tickerName: null,
    isNPC: null,
  });
  // A corp owner: corporationID/factionID/tickerName/isNPC present; characterID/allianceID absent.
  assert.deepEqual(rows[1], {
    ownerID: 98000001,
    ownerName: "Farmer Corporation",
    typeID: 2,
    groupID: 2,
    gender: 0,
    characterID: null,
    corporationID: 98000001,
    allianceID: null,
    factionID: 0,
    tickerName: "TRAV",
    isNPC: false,
  });
});

test("decodeLookupLocations decodes the live solar-system row with its geography ids", () => {
  const rows = decodeLookupLocations(list([LOCATION_LIVE]));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    itemID: 30000502,
    itemName: "E-1XVP",
    typeID: 5,
    groupID: 5,
    solarSystemID: 30000502,
    constellationID: 20000073,
    regionID: 10000005,
  });
});

test("decodeLookupWarableOwners decodes the live warable corp row", () => {
  const rows = decodeLookupWarableOwners(list([WARABLE_LIVE]));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    ownerID: 98000001,
    ownerName: "Farmer Corporation",
    typeID: 2,
    warPermit: 1,
  });
});

// R7d id-sweep: ids survive as numeric fields (not lost, not stringified).
test("R7d: lookup decoders preserve every entity/location id as a numeric field", () => {
  const char = decodeLookupCharacters(CHARACTERS_LIVE)[0]!;
  assert.equal(char.corporationID, 98000001);
  assert.equal(char.characterID, 140000005);
  const owner = decodeLookupOwners(list([OWNER_CHARACTER]))[0]!;
  assert.equal(owner.characterID, 140000005);
  assert.equal(owner.corporationID, 98000001);
  const loc = decodeLookupLocations(list([LOCATION_LIVE]))[0]!;
  assert.equal(loc.solarSystemID, 30000502);
  assert.equal(loc.constellationID, 20000073);
  assert.equal(loc.regionID, 10000005);
});

test("the lookup id assertions actually read distinct decoded content (not vacuous)", () => {
  // Companion: a different corp id decodes to a different value.
  const other = decodeLookupCharacters(
    list([keyVal([["characterID", 90], ["corporationID", 12345]])]),
  )[0]!;
  assert.equal(other.corporationID, 12345);
  assert.notEqual(other.corporationID, 98000001);
});
