// The character-creation picker, decoded.
//
// GET /api/bridge/char-creation-info returns two things from two sources, and
// the difference between them matters:
//
//   creationInfo — the RAW retail dict from charUnboundMgr.GetCharCreationInfo:
//     {type:"dict"} of "races" -> {type:"list"} of util.KeyVal, and "bloodlines"
//     -> the same. These are the world's OWN tables and they are AUTHORITATIVE:
//     CreateCharacterWithDoll derives race, character typeID, starter
//     corporation, starting station and rookie ship from the BLOODLINE, so a
//     bloodline this read does not name is one the server will refuse.
//
//   ancestries — plain JSON rows off the SDE. This world has no ancestry table
//     at all; the writer stores ancestryID verbatim and never validates it. So
//     ancestry is pure flavor server-side, and the SDE is the only place its
//     names and descriptions exist.
//
// ⚠ THE SDE IS WIDER THAN THE WORLD. ancestries covers bloodlines EveJS does not
// have (Jove, Drifter). Only the retail read knows which bloodlines are real
// here, so joining the two — and dropping the ancestries that fall outside — is
// this module's job. `decodeCharCreationTables` does it once, at the boundary,
// so nothing downstream can offer a choice the server would reject.
//
// The attribute bonuses on an ancestry are retail's, NOT this character's:
// creation writes all five attributes at a flat 20. They are decoded so the
// picker can show what an ancestry means, and must never be rendered as the
// pilot's actual stats.

import {
  isKeyValValue,
  isListValue,
  readDictEntry,
  readKeyVal,
  readPlainJsonField,
  type JsonValue,
} from "./wire.ts";

/** Retail's per-ancestry attribute bonuses. Not applied by this world. */
export interface AncestryAttributes {
  readonly charisma: number;
  readonly intelligence: number;
  readonly memory: number;
  readonly perception: number;
  readonly willpower: number;
}

/** One playable race, and the corvette a character of it starts in. */
export interface CreationRace {
  readonly raceID: number;
  readonly raceName: string;
  readonly shipTypeID: number;
  readonly shipName: string;
}

/**
 * One bloodline. THE carrier of race on the create call — the write sends a
 * bloodlineID and the server derives the rest, so `raceID` here is what decides
 * which race a pick actually produces.
 */
export interface CreationBloodline {
  readonly bloodlineID: number;
  readonly bloodlineName: string;
  readonly raceID: number;
  readonly corporationID: number;
}

/** One ancestry, off the SDE. Flavor only as far as the server is concerned. */
export interface CreationAncestry {
  readonly ancestryID: number;
  readonly bloodlineID: number;
  readonly name: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly iconID: number | null;
  readonly attributes: AncestryAttributes;
}

/** The whole picker, already narrowed to what this world will accept. */
export interface CharCreationTables {
  readonly races: readonly CreationRace[];
  readonly bloodlines: readonly CreationBloodline[];
  /** Only ancestries whose bloodline this world actually has. */
  readonly ancestries: readonly CreationAncestry[];
}

/** One bloodline with its ancestries, the shape the picker renders. */
export interface BloodlineChoice {
  readonly bloodline: CreationBloodline;
  readonly ancestries: readonly CreationAncestry[];
}

function asInt(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

function asText(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function listItems(dict: JsonValue | null | undefined, key: string): readonly JsonValue[] {
  const value = readDictEntry(dict, key);
  return isListValue(value) ? value.items : [];
}

function decodeRace(row: JsonValue): CreationRace | null {
  if (!isKeyValValue(row)) {
    return null;
  }
  const raceID = asInt(readKeyVal(row, "raceID"));
  if (raceID <= 0) {
    return null;
  }
  return {
    raceID,
    raceName: asText(readKeyVal(row, "raceName")),
    shipTypeID: asInt(readKeyVal(row, "shipTypeID")),
    shipName: asText(readKeyVal(row, "shipName")),
  };
}

function decodeBloodline(row: JsonValue): CreationBloodline | null {
  if (!isKeyValValue(row)) {
    return null;
  }
  const bloodlineID = asInt(readKeyVal(row, "bloodlineID"));
  if (bloodlineID <= 0) {
    return null;
  }
  return {
    bloodlineID,
    bloodlineName: asText(readKeyVal(row, "bloodlineName")),
    raceID: asInt(readKeyVal(row, "raceID")),
    corporationID: asInt(readKeyVal(row, "corporationID")),
  };
}

function decodeAncestry(row: JsonValue): CreationAncestry | null {
  const ancestryID = asInt(readPlainJsonField(row, "ancestryID"));
  const bloodlineID = asInt(readPlainJsonField(row, "bloodlineID"));
  if (ancestryID <= 0 || bloodlineID <= 0) {
    return null;
  }
  const attributes = readPlainJsonField(row, "attributes");
  const bonus = (key: string): number => asInt(readPlainJsonField(attributes, key));
  const iconID = asInt(readPlainJsonField(row, "iconID"));
  return {
    ancestryID,
    bloodlineID,
    name: asText(readPlainJsonField(row, "name")),
    shortDescription: asText(readPlainJsonField(row, "shortDescription")),
    description: asText(readPlainJsonField(row, "description")),
    iconID: iconID > 0 ? iconID : null,
    attributes: {
      charisma: bonus("charisma"),
      intelligence: bonus("intelligence"),
      memory: bonus("memory"),
      perception: bonus("perception"),
      willpower: bonus("willpower"),
    },
  };
}

/**
 * Decode the char-creation-info envelope into the picker's tables.
 *
 * The join is the point: ancestries are kept only when the retail bloodline list
 * names their bloodline, so the SDE's Jove and Drifter rows never reach a
 * player. An empty result is a real answer (a world with no creation tables),
 * not an error — the screen says so rather than offering a broken picker.
 */
export function decodeCharCreationTables(response: JsonValue): CharCreationTables {
  const creationInfo = readPlainJsonField(response, "creationInfo") ?? null;
  const races = listItems(creationInfo, "races")
    .map(decodeRace)
    .filter((race): race is CreationRace => race !== null);
  const bloodlines = listItems(creationInfo, "bloodlines")
    .map(decodeBloodline)
    .filter((bloodline): bloodline is CreationBloodline => bloodline !== null);

  const worldBloodlineIDs = new Set(bloodlines.map((bloodline) => bloodline.bloodlineID));
  const rawAncestries = readPlainJsonField(response, "ancestries");
  const ancestries = (Array.isArray(rawAncestries) ? rawAncestries : [])
    .map(decodeAncestry)
    .filter((ancestry): ancestry is CreationAncestry => ancestry !== null)
    .filter((ancestry) => worldBloodlineIDs.has(ancestry.bloodlineID));

  return { races, bloodlines, ancestries };
}

/** The bloodlines of one race, in table order. */
export function bloodlinesForRace(
  tables: CharCreationTables,
  raceID: number,
): readonly CreationBloodline[] {
  return tables.bloodlines.filter((bloodline) => bloodline.raceID === raceID);
}

/**
 * One race's bloodlines, each with its ancestries — what the picker draws.
 *
 * A bloodline with NO ancestries is kept, not dropped: it is still a legal
 * choice (the server rolls ancestry 0 for it), and hiding it would silently
 * shrink the player's options because of a gap in the SDE.
 */
export function bloodlineChoicesForRace(
  tables: CharCreationTables,
  raceID: number,
): readonly BloodlineChoice[] {
  return bloodlinesForRace(tables, raceID).map((bloodline) => ({
    bloodline,
    ancestries: tables.ancestries.filter(
      (ancestry) => ancestry.bloodlineID === bloodline.bloodlineID,
    ),
  }));
}

/**
 * A ValidateNameEx code as something a player can act on.
 *
 * The codes are charService's VALIDATION_CODE (characterNameRuntime.js:5) and
 * the rules behind them are the server's, restated here only as prose: 3–37
 * characters, letters/digits/apostrophe/hyphen/space, at most two spaces and
 * never two in a row, no ccp-/gm-/isd- prefix, and not already taken.
 *
 * ⚠ null is NOT a verdict. It means the read did not answer (offline, refused,
 * in flight), and a screen that showed it as a rejection would be inventing one.
 * Callers get null back so they can stay quiet instead.
 */
export function nameValidationMessage(code: number | null): string | null {
  switch (code) {
    case 1:
      return null;
    case -1:
      return "That name is too short — three characters at least.";
    case -2:
      return "That name is too long — thirty-seven characters at most.";
    case -5:
      return "Letters, digits, apostrophes and hyphens only.";
    case -6:
      return "Two spaces at most — a first, middle and last name.";
    case -7:
      return "Two spaces in a row is not allowed.";
    case -101:
      return "That name is already taken.";
    case -102:
      return "That name is reserved.";
    default:
      return code === null ? null : "The server would not accept that name.";
  }
}

/** The bloodline an ancestry belongs to, or null when it names none of them. */
export function bloodlineForAncestry(
  tables: CharCreationTables,
  ancestryID: number,
): CreationBloodline | null {
  const ancestry = tables.ancestries.find((row) => row.ancestryID === ancestryID);
  if (!ancestry) {
    return null;
  }
  return (
    tables.bloodlines.find((row) => row.bloodlineID === ancestry.bloodlineID) ?? null
  );
}
