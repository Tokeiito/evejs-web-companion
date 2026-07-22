// Decoding the charUnboundMgr character / account reads (goal R70, PLUMBING ONLY
// — no UI).
//
// GET /api/bridge/char-account returns the raw retail-shaped results of seven
// TOP-LEVEL charUnboundMgr reads. Every shape below was read from the eve.js
// handler (server/src/services/character/charService.js) and pinned against the
// LIVE capture (Farmer 140000005, read through the BFF, 2026-07-22):
//
//   GetNumCharacters()      -> a BARE INT (count of the account's characters).
//   GetCharacterInfo(charID)-> Handle_GetCharacterToSelect's util.KeyVal char-
//                              selection data, or NULL. ⚠ ACCOUNT-SCOPED, not
//                              public: the handler returns null for a charID that
//                              is not on the requesting account, so this answers
//                              the account's OWN character's sheet (balance
//                              included — the account's own) or null. A FOREIGN
//                              charID returns null, never that character's data.
//   GetCharacterLockType()  -> NULL in this world (a stub); decoded as a nullable
//                              int for when a lock type lands.
//   GetCohortsForUser()     -> {type:"list", items:[]} (an empty-by-design stub).
//   GetValidRandomName(race)-> a BARE STRING (a random valid character name).
//   ValidateNameEx(name)    -> a BARE INT validation code (1 = VALID; negative
//                              codes are the retail rejection reasons, e.g. -1
//                              TOO_SHORT, -2 TOO_LONG, -101 UNAVAILABLE — captured
//                              live: an empty name returned -1, "Zaphod Beeblebrox"
//                              returned 1).
//   GetQAStarterSystemIDs() -> a BARE ARRAY of starter solar-system ids.
//
// R7d: GetCharacterInfo carries many ENTITY ids (corporationID / allianceID /
// stationID / solarSystemID / regionID / shipTypeID …). They are kept here as
// plain numeric fields for a future UI to resolve to names — never rendered as
// numbers, never forced into a label in this file. balance / bounty are ISK
// amounts kept as bigint-safe decimal strings; the three FILETIME longs
// (createDateTime / startDateTime / skillQueueEndTime) are kept as bigints.

import {
  isKeyValValue,
  isListValue,
  readKeyVal,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";
import { toAmountString } from "./rewards.ts";

/** A number tolerant of a {type:"long"} wrapper and a numeric string; 0 otherwise. */
function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
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

/** A signed float (security status), tolerant of a decimal string; 0 when absent. */
function toFloat(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return 0;
}

/** A positive entity id, or null when absent/zero. */
function toOptionalID(value: JsonValue | undefined): number | null {
  const id = toNumber(value);
  return id > 0 ? id : null;
}

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** The account's own character's selection data (charUnboundMgr.GetCharacterInfo). */
export interface CharacterAccountInfo {
  readonly characterID: number;
  readonly corporationID: number;
  /** null when the character is in no alliance. */
  readonly allianceID: number | null;
  readonly stationID: number;
  readonly solarSystemID: number;
  readonly constellationID: number;
  readonly regionID: number;
  readonly shipTypeID: number;
  readonly shipName: string;
  readonly raceID: number;
  readonly bloodlineID: number;
  readonly ancestryID: number;
  readonly gender: number;
  readonly skillPoints: number;
  readonly securityStatus: number;
  /** ISK balance as a bigint-safe decimal string; null when absent. */
  readonly balance: string | null;
  /** ISK bounty on the character as a bigint-safe decimal string; null when absent. */
  readonly bounty: string | null;
  readonly title: string;
  readonly shortName: string;
  readonly unreadMailCount: number;
  readonly upcomingEventCount: number;
  readonly unprocessedNotifications: number;
  /** FILETIME the character was created; null when absent. */
  readonly createDateTime: bigint | null;
  /** FILETIME the character first entered the game; null when absent. */
  readonly startDateTime: bigint | null;
  /** FILETIME the skill queue finishes; null when nothing training. */
  readonly skillQueueEndTime: bigint | null;
}

/**
 * Decode charUnboundMgr.GetNumCharacters -> the count of characters on the
 * account. A bare int on the wire. 0 is a real "no characters" answer.
 */
export function decodeNumCharacters(result: JsonValue | null | undefined): number {
  return toNumber(result === null ? undefined : (result as JsonValue));
}

/**
 * Decode charUnboundMgr.GetCharacterInfo -> the account's OWN character's
 * selection data. null when the read did not produce the KeyVal row — the real
 * answer for a FOREIGN or unknown charID (the handler rejects it server-side),
 * which is the ownership guarantee this read rests on.
 */
export function decodeCharacterInfo(
  result: JsonValue | null | undefined,
): CharacterAccountInfo | null {
  if (!isKeyValValue(result)) {
    return null;
  }
  const characterID = toNumber(readKeyVal(result, "characterID"));
  if (characterID <= 0) {
    return null;
  }
  return {
    characterID,
    corporationID: toNumber(readKeyVal(result, "corporationID")),
    allianceID: toOptionalID(readKeyVal(result, "allianceID")),
    stationID: toNumber(readKeyVal(result, "stationID")),
    solarSystemID: toNumber(readKeyVal(result, "solarSystemID")),
    constellationID: toNumber(readKeyVal(result, "constellationID")),
    regionID: toNumber(readKeyVal(result, "regionID")),
    shipTypeID: toNumber(readKeyVal(result, "shipTypeID")),
    shipName: typeof readKeyVal(result, "shipName") === "string" ? (readKeyVal(result, "shipName") as string) : "",
    raceID: toNumber(readKeyVal(result, "raceID")),
    bloodlineID: toNumber(readKeyVal(result, "bloodlineID")),
    ancestryID: toNumber(readKeyVal(result, "ancestryID")),
    gender: toNumber(readKeyVal(result, "gender")),
    skillPoints: toNumber(readKeyVal(result, "skillPoints")),
    securityStatus: toFloat(readKeyVal(result, "securityStatus")),
    balance: toAmountString(readKeyVal(result, "balance")),
    bounty: toAmountString(readKeyVal(result, "bounty")),
    title: typeof readKeyVal(result, "title") === "string" ? (readKeyVal(result, "title") as string) : "",
    shortName: typeof readKeyVal(result, "shortName") === "string" ? (readKeyVal(result, "shortName") as string) : "",
    unreadMailCount: toNumber(readKeyVal(result, "unreadMailCount")),
    upcomingEventCount: toNumber(readKeyVal(result, "upcomingEventCount")),
    unprocessedNotifications: toNumber(readKeyVal(result, "unprocessedNotifications")),
    createDateTime: toFiletime(readKeyVal(result, "createDateTime")),
    startDateTime: toFiletime(readKeyVal(result, "startDateTime")),
    skillQueueEndTime: toFiletime(readKeyVal(result, "skillQueueEndTime")),
  };
}

/**
 * Decode charUnboundMgr.GetCharacterLockType -> the lock type, or null. The
 * handler returns null in this world (a stub); a future lock type would be an
 * int. null is the real current answer, not a failure.
 */
export function decodeCharacterLockType(
  result: JsonValue | null | undefined,
): number | null {
  return result === null || result === undefined ? null : toOptionalID(result as JsonValue);
}

/**
 * Decode charUnboundMgr.GetCohortsForUser -> the account's cohorts. Empty-by-
 * design in this world; the raw list items are returned so a future UI has the
 * rows the moment cohort data lands. `[]` for the empty stub (a real state).
 */
export function decodeCohortsForUser(
  result: JsonValue | null | undefined,
): readonly JsonValue[] {
  return isListValue(result) ? result.items : [];
}

/**
 * Decode charUnboundMgr.GetValidRandomName -> a random valid character name. A
 * bare string on the wire; null when the value was not a string (an absent /
 * failed read).
 */
export function decodeValidRandomName(
  result: JsonValue | null | undefined,
): string | null {
  return typeof result === "string" ? result : null;
}

/** The ValidateNameEx code for a valid name (VALIDATION_CODE.VALID on the server). */
export const NAME_VALIDATION_VALID = 1;

/**
 * Decode charUnboundMgr.ValidateNameEx -> the name-validation code. A bare int:
 * 1 (VALID) means the name is acceptable; a negative code is a retail rejection
 * reason (−1 TOO_SHORT, −2 TOO_LONG, −5 ILLEGAL_CHARACTER, −6 TOO_MANY_SPACES,
 * −7 CONSECUTIVE_SPACES, −101 UNAVAILABLE, −102 RESERVED). null when the value was
 * not a number (an absent / failed read).
 */
export function decodeNameValidation(
  result: JsonValue | null | undefined,
): number | null {
  return typeof result === "number" && Number.isFinite(result) ? Math.trunc(result) : null;
}

/** Whether a ValidateNameEx code means the name is acceptable (1 = VALID). */
export function isNameValid(code: number | null): boolean {
  return code === NAME_VALIDATION_VALID;
}

/**
 * Decode charUnboundMgr.GetQAStarterSystemIDs -> the starter solar-system ids. A
 * bare array of ints on the wire; the ids are kept as numbers for a future UI to
 * resolve to names (R7d). `[]` when the value was not an array.
 */
export function decodeStarterSystemIDs(
  result: JsonValue | null | undefined,
): readonly number[] {
  if (!Array.isArray(result)) {
    return [];
  }
  const ids: number[] = [];
  for (const entry of result) {
    const id = toNumber(entry as JsonValue);
    if (id > 0) {
      ids.push(id);
    }
  }
  return ids;
}
