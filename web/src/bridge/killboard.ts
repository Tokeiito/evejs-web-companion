// Decoding the charMgr recent ship kills + losses (goal R70, PLUMBING ONLY — no
// UI). The charMgr straggler R56/R58 reserved and R70 wires.
//
// GET /api/bridge/killboard returns the raw retail-shaped result of
// charMgr.GetRecentShipKillsAndLosses — the SESSION character's recent kills and
// losses. ⚠ The call's args are [limit, startKillID] PAGINATION, NOT a charID:
// Handle_GetRecentShipKillsAndLosses derives the character from the session, so a
// caller cannot request another character's killboard.
//
// The result is a marshaled LIST of util.KeyVal killmail rows, each the exact
// output of the server's buildKillmailPayload (eve.js
// server/src/services/killmail/killmailState.js:497):
//
//   {type:"list", items:[util.KeyVal{
//       killID (int), killTime ({type:"long", …} FILETIME),
//       solarSystemID / moonID (int|null),
//       victimCharacterID / victimCorporationID / victimAllianceID /
//         victimFactionID / victimShipTypeID (int|null), victimDamageTaken (int),
//       finalCharacterID / finalCorporationID / finalAllianceID / finalFactionID /
//         finalShipTypeID / finalWeaponTypeID (int|null),
//       finalSecurityStatus (float|null), finalDamageDone (int),
//       warID (int|null), iskLost / iskDestroyed (num|null),
//       bountyClaimed / loyaltyPoints (num|null), killRightSupplied (int|null),
//       killBlob (string)}]}
//
// ⚠ Farmer has no recent kills/losses, so the LIVE capture on 2026-07-22 was the
// empty list {type:"list", items:[]} — a REAL "no recent kills/losses" answer.
// The populated row shape below mirrors buildKillmailPayload so the decoder is
// proven against the shape the handler actually emits, not a guess.
//
// R7d: every victim*/final*/warID/solarSystemID id is kept as a plain numeric
// field for a future UI to resolve to names — never rendered as a number here.
// killTime is a FILETIME bigint; iskLost / iskDestroyed / bountyClaimed /
// loyaltyPoints are ISK/point amounts kept as bigint-safe decimal strings.

import { isListValue, readRowField, unwrapLong, type JsonValue } from "./wire.ts";
import { toAmountString } from "./rewards.ts";

/** One killmail row (a kill the character made or a loss they took). */
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
  /** ISK value of the loss, as a bigint-safe decimal string; null when absent. */
  readonly iskLost: string | null;
  /** ISK value destroyed, as a bigint-safe decimal string; null when absent. */
  readonly iskDestroyed: string | null;
  readonly bountyClaimed: string | null;
  readonly loyaltyPoints: string | null;
  readonly killRightSupplied: number | null;
  readonly killBlob: string;
}

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

/** A positive entity id, or null when absent/zero/negative. */
function toOptionalID(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const id = toNumber(value);
  return id > 0 ? id : null;
}

/** A signed float (security status), tolerant of a decimal string; null when absent. */
function toOptionalFloat(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return null;
}

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** An ISK/point amount as a bigint-safe string; null when absent. */
function toAmountOrNull(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toAmountString(value);
}

/**
 * Decode charMgr.GetRecentShipKillsAndLosses into plain killmail rows. A row with
 * no killID is dropped. `[]` is a real "no recent kills/losses" answer (Farmer).
 */
export function decodeKillmails(result: JsonValue | null | undefined): Killmail[] {
  if (!isListValue(result)) {
    return [];
  }
  const rows: Killmail[] = [];
  for (const item of result.items) {
    const killID = toNumber(readRowField(item, "killID"));
    if (killID <= 0) {
      continue;
    }
    rows.push({
      killID,
      killTime: toFiletime(readRowField(item, "killTime")),
      solarSystemID: toOptionalID(readRowField(item, "solarSystemID")),
      moonID: toOptionalID(readRowField(item, "moonID")),
      victimCharacterID: toOptionalID(readRowField(item, "victimCharacterID")),
      victimCorporationID: toOptionalID(readRowField(item, "victimCorporationID")),
      victimAllianceID: toOptionalID(readRowField(item, "victimAllianceID")),
      victimFactionID: toOptionalID(readRowField(item, "victimFactionID")),
      victimShipTypeID: toOptionalID(readRowField(item, "victimShipTypeID")),
      victimDamageTaken: toNumber(readRowField(item, "victimDamageTaken")),
      finalCharacterID: toOptionalID(readRowField(item, "finalCharacterID")),
      finalCorporationID: toOptionalID(readRowField(item, "finalCorporationID")),
      finalAllianceID: toOptionalID(readRowField(item, "finalAllianceID")),
      finalFactionID: toOptionalID(readRowField(item, "finalFactionID")),
      finalShipTypeID: toOptionalID(readRowField(item, "finalShipTypeID")),
      finalWeaponTypeID: toOptionalID(readRowField(item, "finalWeaponTypeID")),
      finalSecurityStatus: toOptionalFloat(readRowField(item, "finalSecurityStatus")),
      finalDamageDone: toNumber(readRowField(item, "finalDamageDone")),
      warID: toOptionalID(readRowField(item, "warID")),
      iskLost: toAmountOrNull(readRowField(item, "iskLost")),
      iskDestroyed: toAmountOrNull(readRowField(item, "iskDestroyed")),
      bountyClaimed: toAmountOrNull(readRowField(item, "bountyClaimed")),
      loyaltyPoints: toAmountOrNull(readRowField(item, "loyaltyPoints")),
      killRightSupplied: toOptionalID(readRowField(item, "killRightSupplied")),
      killBlob: typeof readRowField(item, "killBlob") === "string" ? (readRowField(item, "killBlob") as string) : "",
    });
  }
  return rows;
}
