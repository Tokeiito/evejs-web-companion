// Killmail read decoded to a plain row (goal R66, PLUMBING ONLY — no UI).
//
// GET /api/bridge/killmail returns the raw retail-shaped result of
// warStatisticMgr.GetKillMail(killID[, hashValue]). Killmails are PUBLIC EVE data.
// The shape below was built from bytes captured LIVE (killID=1) on 2026-07-22,
// cross-checked against the server builder buildKillmailPayload (eve.js
// .../killmail/killmailState.js). An unknown killID (or a hash mismatch) returns
// null — a REAL "no such killmail" answer, captured live for killID 100000.
//
// ⚠ VERIFY-FIRST BINDING (worklist): warStatisticMgr is a bindable service, but
// Handle_GetKillMail reads killID from args[0] and never touches the bound context,
// so the BFF reaches it by a plain TOP-LEVEL /call — confirmed live, no
// MachoBindObject step. Only GetKillMail is exposed; the bound-only siblings stay
// refused.
//
//   {type:"object", name:"util.KeyVal", args:{type:"dict", entries:[
//     killID (int), killTime (long FILETIME), solarSystemID, moonID,
//     victim{CharacterID,CorporationID,AllianceID,FactionID,ShipTypeID} (ids|null),
//     victimDamageTaken (float),
//     final{CharacterID,CorporationID,AllianceID,FactionID,ShipTypeID,WeaponTypeID}
//       (ids|null), finalSecurityStatus (float|null), finalDamageDone (float),
//     warID (int|null), iskLost/iskDestroyed/bountyClaimed/loyaltyPoints
//       (number|null — bigint-safe ISK), killRightSupplied (int|null),
//     killBlob (string — the attackers/items XML)]}}
//
// R7d: every id (solarSystemID / moonID / victim* / final* / warID /
// killRightSupplied) survives as a numeric field for a future UI to resolve; none
// is forced into a label. killTime is a FILETIME bigint. The four ISK/value fields
// are kept as bigint-safe decimal strings (never zeroed by a `typeof` test), null
// preserved. Damage values are floats kept as numbers. killBlob stays a string.

import { readKeyVal, unwrapLong, type JsonValue } from "./wire.ts";
import { toAmountString } from "./rewards.ts";

/** One public killmail. */
export interface Killmail {
  readonly killID: number;
  /** The FILETIME of the kill (exceeds 2^53, so a bigint); null if absent. */
  readonly killTime: bigint | null;
  readonly solarSystemID: number | null;
  readonly moonID: number | null;
  readonly victimCharacterID: number | null;
  readonly victimCorporationID: number | null;
  readonly victimAllianceID: number | null;
  readonly victimFactionID: number | null;
  readonly victimShipTypeID: number | null;
  readonly victimDamageTaken: number;
  readonly finalCharacterID: number | null;
  readonly finalCorporationID: number | null;
  readonly finalAllianceID: number | null;
  readonly finalFactionID: number | null;
  readonly finalShipTypeID: number | null;
  readonly finalWeaponTypeID: number | null;
  readonly finalSecurityStatus: number | null;
  readonly finalDamageDone: number;
  readonly warID: number | null;
  /** ISK the victim lost, a bigint-safe decimal string; null when absent. */
  readonly iskLost: string | null;
  /** ISK destroyed, a bigint-safe decimal string; null when absent. */
  readonly iskDestroyed: string | null;
  /** Bounty claimed for the kill, a bigint-safe decimal string; null when absent. */
  readonly bountyClaimed: string | null;
  /** Loyalty points awarded, a bigint-safe decimal string; null when absent. */
  readonly loyaltyPoints: string | null;
  readonly killRightSupplied: number | null;
  /** The attackers/items XML blob, a plain string ("" when absent). */
  readonly killBlob: string;
}

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

/** A positive entity id, or null when absent/zero. */
function toOptionalID(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const id = toNumber(value);
  return id > 0 ? id : null;
}

/** A number that keeps null when the field is genuinely absent (not a substituted 0). */
function toNullableNumber(value: JsonValue | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return toNumber(value);
}

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** An ISK/value field as a bigint-safe decimal string; null when absent/null. */
function toIsk(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return toAmountString(value);
}

function readText(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "string") {
      return inner;
    }
  }
  return "";
}

/**
 * Decode warStatisticMgr.GetKillMail into a plain killmail row. null when the
 * value is not a killmail KeyVal or carries no killID — the real "no such
 * killmail" answer.
 */
export function decodeKillmail(value: JsonValue | null | undefined): Killmail | null {
  if (value === null || value === undefined) {
    return null;
  }
  const killID = toNumber(readKeyVal(value, "killID"));
  if (killID <= 0) {
    return null;
  }
  return {
    killID,
    killTime: toFiletime(readKeyVal(value, "killTime")),
    solarSystemID: toOptionalID(readKeyVal(value, "solarSystemID")),
    moonID: toOptionalID(readKeyVal(value, "moonID")),
    victimCharacterID: toOptionalID(readKeyVal(value, "victimCharacterID")),
    victimCorporationID: toOptionalID(readKeyVal(value, "victimCorporationID")),
    victimAllianceID: toOptionalID(readKeyVal(value, "victimAllianceID")),
    victimFactionID: toOptionalID(readKeyVal(value, "victimFactionID")),
    victimShipTypeID: toOptionalID(readKeyVal(value, "victimShipTypeID")),
    victimDamageTaken: toNumber(readKeyVal(value, "victimDamageTaken")),
    finalCharacterID: toOptionalID(readKeyVal(value, "finalCharacterID")),
    finalCorporationID: toOptionalID(readKeyVal(value, "finalCorporationID")),
    finalAllianceID: toOptionalID(readKeyVal(value, "finalAllianceID")),
    finalFactionID: toOptionalID(readKeyVal(value, "finalFactionID")),
    finalShipTypeID: toOptionalID(readKeyVal(value, "finalShipTypeID")),
    finalWeaponTypeID: toOptionalID(readKeyVal(value, "finalWeaponTypeID")),
    finalSecurityStatus: toNullableNumber(readKeyVal(value, "finalSecurityStatus")),
    finalDamageDone: toNumber(readKeyVal(value, "finalDamageDone")),
    warID: toOptionalID(readKeyVal(value, "warID")),
    iskLost: toIsk(readKeyVal(value, "iskLost")),
    iskDestroyed: toIsk(readKeyVal(value, "iskDestroyed")),
    bountyClaimed: toIsk(readKeyVal(value, "bountyClaimed")),
    loyaltyPoints: toIsk(readKeyVal(value, "loyaltyPoints")),
    killRightSupplied: toOptionalID(readKeyVal(value, "killRightSupplied")),
    killBlob: readText(readKeyVal(value, "killBlob")),
  };
}
