// The charMgr profile/identity cluster, decoded to plain records (goal R58,
// PLUMBING ONLY — no UI).
//
// GET /api/bridge/character-profile returns seven raw retail-shaped charMgr
// results, captured live from Farmer (character 140000005) on 2026-07-22 — every
// shape below is pinned to those bytes, not assumed:
//
//   • publicInfo   = GetPublicInfo()  -> a BARE util.KeyVal (the OLDER public-info
//     shape; GetPublicInfo3 wraps this same KeyVal in a list). Public identity.
//   • homeStationRow = GetHomeStationRow() -> a util.KeyVal (the home station as a
//     "row"; the handler delegates to GetHomeStation, so the same payload).
//   • creationDate = GetCharacterCreationDate() -> {type:"long"} FILETIME.
//   • settingsInfo = GetSettingsInfo() -> [<Buffer>, 0]: an opaque py2 codeobject
//     buffer + a trailing flag. The bytes are CARRIED, never interpreted (a
//     client-side artifact, not data).
//   • paperdollState = GetPaperdollState() -> a bare INT (0..4).
//   • cohorts      = GetCohortsForCharacter() -> {type:"list", items:[]} —
//     EMPTY-BY-DESIGN in this world; the raw items pass through without a schema.
//   • corpChange   = GetPrivateInfoOnCorpChange() -> a CachedMethodCallResult.
//     ⚠ THE KeyVal{corporationID, corporationDateTime(long)} IS NESTED inside the
//     cache wrapper's substream (args[1].value), NOT at the top level, and the
//     wrapper's `name` is a {type:"rawstr"} — so isKeyValValue FAILS on the
//     wrapper; the decoder unwraps the substream first.
//
// R7d: every id survives AS A NUMERIC FIELD for a future UI to resolve —
// corporationID / allianceID / factionID / stationID / solarSystemID /
// typeID / raceID / bloodlineID / ancestryID — none forced into a label, none
// lost. Longs (FILETIMEs) are bigint; ISK (bounty) is a bigint-safe string.

import {
  isKeyValValue,
  isListValue,
  readKeyVal,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";
import { toAmountString } from "./rewards.ts";

/** The older public-info identity record (GetPublicInfo). */
export interface PublicInfo {
  readonly characterID: number;
  readonly characterName: string;
  readonly typeID: number;
  readonly raceID: number;
  readonly bloodlineID: number;
  readonly ancestryID: number;
  readonly corporationID: number;
  /** 0/absent means no alliance; carried as null. */
  readonly allianceID: number | null;
  /** 0/absent means no militia faction; carried as null. */
  readonly factionID: number | null;
  readonly gender: number;
  /** FILETIME the character was created (exceeds 2^53, so a bigint); null if absent. */
  readonly createDateTime: bigint | null;
  readonly startDateTime: bigint | null;
  readonly description: string;
  /** Security status is a signed FLOAT, shown as-is. */
  readonly securityStatus: number;
  /** Bounty is ISK — a bigint-safe decimal string. */
  readonly bounty: string;
  readonly title: string;
  readonly stationID: number;
  readonly solarSystemID: number;
}

/** The home station reduced to its resolvable ids (name comes from /api/names). */
export interface HomeStationRow {
  readonly stationID: number;
  readonly stationTypeID: number;
  readonly solarSystemID: number;
}

/** The opaque client-settings codeobject, carried but not interpreted. */
export interface SettingsInfo {
  readonly codeObjectBytes: readonly number[] | null;
  readonly trailingValue: number;
}

/** The corp-change info: which corp the character is in and when they joined. */
export interface CorpChangeInfo {
  readonly corporationID: number;
  /** FILETIME the character joined the corp (bigint); null if absent. */
  readonly corporationDateTime: bigint | null;
}

function toInt(value: JsonValue | undefined): number {
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

function toFloat(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return 0;
}

function toStringOrEmpty(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** A positive id, or null when absent/zero. */
function toOptionalID(value: JsonValue | undefined): number | null {
  const id = toInt(value);
  return id > 0 ? id : null;
}

/**
 * Tolerate the bare-KeyVal (GetPublicInfo) shape AND a list-wrapped KeyVal
 * (GetPublicInfo3's shape), so this decoder does not silently blank if pointed
 * at either. null for any other shape.
 */
function keyValRow(result: JsonValue | null | undefined): JsonValue | null {
  if (isKeyValValue(result)) {
    return result;
  }
  if (isListValue(result)) {
    const first = result.items[0];
    return first !== undefined && isKeyValValue(first) ? first : null;
  }
  return null;
}

/**
 * Decode charMgr.GetPublicInfo -> the older public-identity record. Every id is
 * preserved as a numeric field (R7d — a future UI resolves them). null when the
 * read did not produce a KeyVal row.
 */
export function decodePublicInfo(
  result: JsonValue | null | undefined,
): PublicInfo | null {
  const row = keyValRow(result);
  if (row === null) {
    return null;
  }
  const characterID = toInt(readKeyVal(row, "characterID"));
  const characterName = toStringOrEmpty(readKeyVal(row, "characterName"));
  if (characterID <= 0 && characterName === "") {
    return null;
  }
  return {
    characterID,
    characterName,
    typeID: toInt(readKeyVal(row, "typeID")),
    raceID: toInt(readKeyVal(row, "raceID")),
    bloodlineID: toInt(readKeyVal(row, "bloodlineID")),
    ancestryID: toInt(readKeyVal(row, "ancestryID")),
    corporationID: toInt(readKeyVal(row, "corporationID")),
    allianceID: toOptionalID(readKeyVal(row, "allianceID")),
    factionID: toOptionalID(readKeyVal(row, "factionID")),
    gender: toInt(readKeyVal(row, "gender")),
    createDateTime: toFiletime(readKeyVal(row, "createDateTime")),
    startDateTime: toFiletime(readKeyVal(row, "startDateTime")),
    description: toStringOrEmpty(readKeyVal(row, "description")),
    securityStatus: toFloat(readKeyVal(row, "securityStatus")),
    bounty: toAmountString(readKeyVal(row, "bounty")) ?? "0",
    title: toStringOrEmpty(readKeyVal(row, "title")),
    stationID: toInt(readKeyVal(row, "stationID")),
    solarSystemID: toInt(readKeyVal(row, "solarSystemID")),
  };
}

/**
 * Decode charMgr.GetHomeStationRow -> the home station's resolvable ids. The
 * redundant name/type strings in the payload are ignored; the NAME is resolved
 * through /api/names (R7d). null when the KeyVal is absent or carries no station.
 */
export function decodeHomeStationRow(
  result: JsonValue | null | undefined,
): HomeStationRow | null {
  if (!isKeyValValue(result)) {
    return null;
  }
  const stationID = toInt(readKeyVal(result, "stationID"));
  if (stationID <= 0) {
    return null;
  }
  return {
    stationID,
    stationTypeID: toInt(readKeyVal(result, "stationTypeID")),
    solarSystemID: toInt(readKeyVal(result, "solarSystemID")),
  };
}

/**
 * Decode charMgr.GetCharacterCreationDate -> a FILETIME bigint. null when absent
 * or a zero sentinel.
 */
export function decodeCreationDate(result: JsonValue | null | undefined): bigint | null {
  return toFiletime(result);
}

/**
 * Decode charMgr.GetSettingsInfo -> the opaque codeobject bytes + trailing flag.
 * The bytes are carried (a {type:"Buffer", data:[…]} crosses the gateway as
 * such), NEVER interpreted — the py2 codeobject is a client-side artifact. null
 * when the [buffer, flag] tuple shape is absent.
 */
export function decodeSettingsInfo(
  result: JsonValue | null | undefined,
): SettingsInfo | null {
  if (!Array.isArray(result) || result.length < 1) {
    return null;
  }
  const buffer = result[0];
  let codeObjectBytes: readonly number[] | null = null;
  if (
    typeof buffer === "object" &&
    buffer !== null &&
    !Array.isArray(buffer) &&
    (buffer as { type?: unknown }).type === "Buffer" &&
    Array.isArray((buffer as { data?: unknown }).data)
  ) {
    codeObjectBytes = ((buffer as { data: unknown[] }).data).map((byte) =>
      typeof byte === "number" ? byte : 0,
    );
  } else if (Array.isArray(buffer)) {
    codeObjectBytes = buffer.map((byte) => (typeof byte === "number" ? byte : 0));
  }
  return { codeObjectBytes, trailingValue: toInt(result[1]) };
}

/**
 * Decode charMgr.GetPaperdollState -> the recustomization state int (0..4). null
 * when the value was not a number.
 */
export function decodePaperdollState(result: JsonValue | null | undefined): number | null {
  return typeof result === "number" && Number.isFinite(result) ? Math.trunc(result) : null;
}

/**
 * Decode charMgr.GetCohortsForCharacter -> the raw list items. EMPTY-BY-DESIGN in
 * this world (the handler always returns buildList([])); the raw items pass
 * through so no data is lost when cohort data eventually lands. The populated
 * shape is unknown, so no schema is imposed. Today this always returns [].
 */
export function decodeCohorts(result: JsonValue | null | undefined): readonly JsonValue[] {
  return isListValue(result) ? result.items : [];
}

/**
 * Unwrap a CachedMethodCallResult to the value it carries. The wrapper is
 * {type:"object", name:<rawstr …CachedMethodCallResult>, args:[details,
 * {type:"substream", value:<payload>}, version]}; the payload lives in the
 * substream member of the args array. A value that is already the payload
 * (a bare KeyVal) is returned as-is. null otherwise.
 */
function unwrapCachedMethodCallResult(result: JsonValue | null | undefined): JsonValue | null {
  if (isKeyValValue(result)) {
    return result;
  }
  if (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    (result as { type?: unknown }).type === "object" &&
    Array.isArray((result as { args?: unknown }).args)
  ) {
    const args = (result as { args: readonly JsonValue[] }).args;
    for (const member of args) {
      if (
        typeof member === "object" &&
        member !== null &&
        !Array.isArray(member) &&
        (member as { type?: unknown }).type === "substream"
      ) {
        return ((member as { value?: JsonValue }).value ?? null) as JsonValue | null;
      }
    }
  }
  return null;
}

/**
 * Decode charMgr.GetPrivateInfoOnCorpChange -> which corp the character is in and
 * when they joined. Unwraps the CachedMethodCallResult substream to reach the
 * inner KeyVal. corporationID is kept as a numeric field (R7d). null when the
 * wrapper carries no KeyVal.
 */
export function decodeCorpChange(
  result: JsonValue | null | undefined,
): CorpChangeInfo | null {
  const inner = unwrapCachedMethodCallResult(result);
  if (!isKeyValValue(inner)) {
    return null;
  }
  const corporationID = toInt(readKeyVal(inner, "corporationID"));
  if (corporationID <= 0) {
    return null;
  }
  return {
    corporationID,
    corporationDateTime: toFiletime(readKeyVal(inner, "corporationDateTime")),
  };
}
