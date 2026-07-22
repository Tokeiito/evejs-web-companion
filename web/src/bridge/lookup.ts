// The lookupSvc name/id SEARCH reads, decoded to plain rows (goal R60, PLUMBING
// ONLY — no UI).
//
// GET /api/bridge/lookup?q=&exact=&groupID= returns nine raw retail-shaped
// results, each a marshaled LIST of util.KeyVal rows. ⚠ THESE TAKE A QUERY: the
// retail signature is Lookup*(searchStr, exact) read positionally by the handler
// (args[0] search, args[1] exact-match flag). Captured live from Farmer
// (character 140000005) on 2026-07-22 with q="Farmer" / q="Caldari" / a
// location search:
//
//   • characters / evePlayerCharacters = LookupCharacters / LookupEvePlayer-
//       Characters -> {type:"list", items:[util.KeyVal{characterID, characterName,
//       ownerID, ownerName, typeID, groupID, corporationID, allianceID}]}. Live
//       "Farmer" -> Farmer (140000005) + FarmerDummy (140000178).
//   • corporations = LookupCorporations -> {type:"list", items:[util.KeyVal{
//       corporationID, corporationName, ownerID, ownerName, typeID, groupID,
//       tickerName, factionID, isNPC}]}. Live -> Farmer Corporation (98000001,
//       ticker "TRAV").
//   • factions = LookupFactions -> {type:"list", items:[util.KeyVal{factionID,
//       factionName, ownerID, ownerName, typeID, groupID}]}. Live "Caldari" ->
//       Caldari State (500001).
//   • owners / pcOwners / nonNPCAccountOwners = the three owner searches ->
//       {type:"list", items:[util.KeyVal{ownerID, ownerName, typeID, groupID,
//       gender, + characterID/corporationID/allianceID (a character) OR
//       corporationID/factionID/tickerName/isNPC (a corp)}]}. The optional id
//       fields VARY by owner kind; a row carries only the ones that apply.
//   • knownLocationsByGroup = LookupKnownLocationsByGroup(groupID, search) ->
//       {type:"list", items:[util.KeyVal{itemID, itemName, typeID, groupID,
//       solarSystemID, constellationID, regionID}]}. Live groupID 5 (solar
//       system) -> systems whose name matches.
//   • warableOwners = LookupWarableCorporationsOrAlliances -> {type:"list",
//       items:[util.KeyVal{ownerID, ownerName, typeID, warPermit}]}. Live "Farmer"
//       -> Farmer Corporation (warPermit 1).
//
// ⚠ EMPTY-QUERY BEHAVIOUR (verified live): the eight name/location searches
// return an EMPTY list for an empty/too-short query (the search filter drops
// every row) — a real "no matches" answer, not a failure. The ONE exception is
// warableOwners: its matcher is a substring test, and every name "includes" the
// empty string, so an empty query returns EVERY warable owner (291 live). Both
// are legitimate server behaviours, decoded the same way.
//
// R7d: every id (characterID / corporationID / allianceID / factionID / ownerID /
// itemID / solarSystemID / constellationID / regionID / typeID / groupID) stays a
// plain numeric field here for a future UI to resolve to a name — none forced
// into a label, none dropped. The ids in this world sit below 2^53, so a plain
// number is lossless; the toNumber path still tolerates a {type:"long"} wrapper
// in case a future id crosses that.

import { isListValue, readRowField, unwrapLong, type JsonValue } from "./wire.ts";

/** A player/NPC character search row (LookupCharacters). */
export interface LookupCharacter {
  readonly characterID: number;
  readonly characterName: string;
  readonly ownerID: number;
  readonly ownerName: string;
  readonly typeID: number;
  readonly groupID: number;
  readonly corporationID: number;
  readonly allianceID: number;
}

/** A corporation search row (LookupCorporations). */
export interface LookupCorporation {
  readonly corporationID: number;
  readonly corporationName: string;
  readonly ownerID: number;
  readonly ownerName: string;
  readonly typeID: number;
  readonly groupID: number;
  /** The corp ticker, or null when absent. */
  readonly tickerName: string | null;
  readonly factionID: number;
  readonly isNPC: boolean;
}

/** A faction search row (LookupFactions). */
export interface LookupFaction {
  readonly factionID: number;
  readonly factionName: string;
  readonly ownerID: number;
  readonly ownerName: string;
  readonly typeID: number;
  readonly groupID: number;
}

/**
 * An owner search row (LookupOwners / LookupPCOwners / LookupNoneNPCAccount-
 * Owners). The optional id fields vary by owner kind; each is null when the row
 * does not carry it. Every id stays as data for later resolution (R7d).
 */
export interface LookupOwner {
  readonly ownerID: number;
  readonly ownerName: string;
  readonly typeID: number;
  readonly groupID: number;
  readonly gender: number;
  readonly characterID: number | null;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
  readonly factionID: number | null;
  readonly tickerName: string | null;
  readonly isNPC: boolean | null;
}

/** A location search row (LookupKnownLocationsByGroup). */
export interface LookupLocation {
  readonly itemID: number;
  readonly itemName: string;
  readonly typeID: number;
  readonly groupID: number;
  readonly solarSystemID: number | null;
  readonly constellationID: number | null;
  readonly regionID: number | null;
}

/** A warable owner search row (LookupWarableCorporationsOrAlliances). */
export interface LookupWarableOwner {
  readonly ownerID: number;
  readonly ownerName: string;
  readonly typeID: number;
  /** War-permit status flag, kept as the raw server value. */
  readonly warPermit: number;
}

/** An integer tolerant of a {type:"long"} wrapper and a numeric string; 0 otherwise. */
function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

/** An integer that stays null when the field is genuinely absent/null. */
function toNullableNumber(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return toNumber(value);
}

/** A non-empty string, or null when absent/empty. */
function toNullableString(value: JsonValue | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

/** The `items` of a {type:"list"} wrapper; [] for anything else (a real "no matches"). */
function listItems(value: JsonValue | null | undefined): readonly JsonValue[] {
  return isListValue(value) ? value.items : [];
}

/**
 * Decode LookupCharacters / LookupEvePlayerCharacters. Rows without a positive
 * characterID are dropped. `[]` is a real "no matches" answer.
 */
export function decodeLookupCharacters(
  result: JsonValue | null | undefined,
): readonly LookupCharacter[] {
  const rows: LookupCharacter[] = [];
  for (const item of listItems(result)) {
    const characterID = toNumber(readRowField(item, "characterID"));
    if (characterID <= 0) {
      continue;
    }
    rows.push({
      characterID,
      characterName: String(readRowField(item, "characterName") ?? ""),
      ownerID: toNumber(readRowField(item, "ownerID")),
      ownerName: String(readRowField(item, "ownerName") ?? ""),
      typeID: toNumber(readRowField(item, "typeID")),
      groupID: toNumber(readRowField(item, "groupID")),
      corporationID: toNumber(readRowField(item, "corporationID")),
      allianceID: toNumber(readRowField(item, "allianceID")),
    });
  }
  return rows;
}

/** Decode LookupCorporations. Rows without a positive corporationID are dropped. */
export function decodeLookupCorporations(
  result: JsonValue | null | undefined,
): readonly LookupCorporation[] {
  const rows: LookupCorporation[] = [];
  for (const item of listItems(result)) {
    const corporationID = toNumber(readRowField(item, "corporationID"));
    if (corporationID <= 0) {
      continue;
    }
    rows.push({
      corporationID,
      corporationName: String(readRowField(item, "corporationName") ?? ""),
      ownerID: toNumber(readRowField(item, "ownerID")),
      ownerName: String(readRowField(item, "ownerName") ?? ""),
      typeID: toNumber(readRowField(item, "typeID")),
      groupID: toNumber(readRowField(item, "groupID")),
      tickerName: toNullableString(readRowField(item, "tickerName")),
      factionID: toNumber(readRowField(item, "factionID")),
      isNPC: readRowField(item, "isNPC") === true,
    });
  }
  return rows;
}

/** Decode LookupFactions. Rows without a positive factionID are dropped. */
export function decodeLookupFactions(
  result: JsonValue | null | undefined,
): readonly LookupFaction[] {
  const rows: LookupFaction[] = [];
  for (const item of listItems(result)) {
    const factionID = toNumber(readRowField(item, "factionID"));
    if (factionID <= 0) {
      continue;
    }
    rows.push({
      factionID,
      factionName: String(readRowField(item, "factionName") ?? ""),
      ownerID: toNumber(readRowField(item, "ownerID")),
      ownerName: String(readRowField(item, "ownerName") ?? ""),
      typeID: toNumber(readRowField(item, "typeID")),
      groupID: toNumber(readRowField(item, "groupID")),
    });
  }
  return rows;
}

/**
 * Decode LookupOwners / LookupPCOwners / LookupNoneNPCAccountOwners. Rows without
 * a positive ownerID are dropped. The optional id fields are null when the row
 * does not carry them (a character row omits factionID/tickerName/isNPC; a corp
 * row omits characterID/allianceID).
 */
export function decodeLookupOwners(
  result: JsonValue | null | undefined,
): readonly LookupOwner[] {
  const rows: LookupOwner[] = [];
  for (const item of listItems(result)) {
    const ownerID = toNumber(readRowField(item, "ownerID"));
    if (ownerID <= 0) {
      continue;
    }
    const isNPC = readRowField(item, "isNPC");
    rows.push({
      ownerID,
      ownerName: String(readRowField(item, "ownerName") ?? ""),
      typeID: toNumber(readRowField(item, "typeID")),
      groupID: toNumber(readRowField(item, "groupID")),
      gender: toNumber(readRowField(item, "gender")),
      characterID: toNullableNumber(readRowField(item, "characterID")),
      corporationID: toNullableNumber(readRowField(item, "corporationID")),
      allianceID: toNullableNumber(readRowField(item, "allianceID")),
      factionID: toNullableNumber(readRowField(item, "factionID")),
      tickerName: toNullableString(readRowField(item, "tickerName")),
      isNPC: isNPC === undefined ? null : isNPC === true,
    });
  }
  return rows;
}

/**
 * Decode LookupKnownLocationsByGroup. Rows without a positive itemID are dropped.
 * solarSystemID / constellationID / regionID are null when the row omits them
 * (a region row carries only regionID).
 */
export function decodeLookupLocations(
  result: JsonValue | null | undefined,
): readonly LookupLocation[] {
  const rows: LookupLocation[] = [];
  for (const item of listItems(result)) {
    const itemID = toNumber(readRowField(item, "itemID"));
    if (itemID <= 0) {
      continue;
    }
    rows.push({
      itemID,
      itemName: String(readRowField(item, "itemName") ?? ""),
      typeID: toNumber(readRowField(item, "typeID")),
      groupID: toNumber(readRowField(item, "groupID")),
      solarSystemID: toNullableNumber(readRowField(item, "solarSystemID")),
      constellationID: toNullableNumber(readRowField(item, "constellationID")),
      regionID: toNullableNumber(readRowField(item, "regionID")),
    });
  }
  return rows;
}

/**
 * Decode LookupWarableCorporationsOrAlliances. Rows without a positive ownerID are
 * dropped. ⚠ An empty query returns EVERY warable owner (the matcher is a
 * substring test) — a large but legitimate result, decoded the same way.
 */
export function decodeLookupWarableOwners(
  result: JsonValue | null | undefined,
): readonly LookupWarableOwner[] {
  const rows: LookupWarableOwner[] = [];
  for (const item of listItems(result)) {
    const ownerID = toNumber(readRowField(item, "ownerID"));
    if (ownerID <= 0) {
      continue;
    }
    rows.push({
      ownerID,
      ownerName: String(readRowField(item, "ownerName") ?? ""),
      typeID: toNumber(readRowField(item, "typeID")),
      warPermit: toNumber(readRowField(item, "warPermit")),
    });
  }
  return rows;
}
