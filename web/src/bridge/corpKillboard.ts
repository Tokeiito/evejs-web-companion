// R82 — decoding the corpRegistry KILLBOARD reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-killboard carries GetRecentKills + GetRecentLosses. Both are
// SESSION-CORP-SCOPED (corp = resolveCorporationID(session); args[0]/args[1] are a
// paging LIMIT + start-kill cursor, NOT a corpID) — a browser can only ever read the
// SESSION corp's own board, never a foreign corp's. Captured live from Farmer (corp
// 98000001) on 2026-07-22: GetRecentKills returned 127 rows, GetRecentLosses 0 (a real
// EMPTY board — a corp with no recorded losses).
//
// WIRE SHAPE (verified against bytes): each read returns a CachedMethodCallResult whose
// args[1] is a {type:"substream"} wrapping an objectex2 CRowset. The cache wrapper is
// versioning bookkeeping; the rows live on the CRowset's `list` as POSITIONAL packedrows
// (columns + values), read here through readRowField.
//
// ⚠ VALUE ENCODING (verified against bytes):
//   • killTime is a {type:"long"} FILETIME WRAPPER (value:"134291482594690000") — kept as
//     a raw decimal STRING (it exceeds 2^53).
//   • victim*/final* ids, solarSystemID, moonID, warID, killRightSupplied cross as PLAIN
//     numbers or null — kept as data (R7d), never forced into labels.
//   • killBlob is a string (attacker/item XML fragment).
//   • finalSecurityStatus is a float; victimDamageTaken / finalDamageDone / loyaltyPoints
//     are ints; iskLost / bountyClaimed / iskDestroyed cross as PLAIN numbers (the server
//     builds them with Number(), so they are never {type:"long"} here) — kept numeric.

import { readRowField, unwrapLong, type JsonValue } from "./wire.ts";

/** One killmail row (GetRecentKills / GetRecentLosses). */
export interface CorpKillmailRow {
  readonly killID: number;
  readonly solarSystemID: number | null;
  readonly victimCharacterID: number | null;
  readonly victimCorporationID: number | null;
  readonly victimAllianceID: number | null;
  readonly victimFactionID: number | null;
  readonly victimShipTypeID: number | null;
  readonly finalCharacterID: number | null;
  readonly finalCorporationID: number | null;
  readonly finalAllianceID: number | null;
  readonly finalFactionID: number | null;
  readonly finalShipTypeID: number | null;
  readonly finalWeaponTypeID: number | null;
  readonly killBlob: string;
  /** FILETIME of the kill, decimal string (exceeds 2^53); null if absent. */
  readonly killTime: string | null;
  readonly victimDamageTaken: number;
  readonly finalSecurityStatus: number;
  readonly finalDamageDone: number;
  readonly moonID: number | null;
  readonly warID: number | null;
  readonly iskLost: number;
  readonly bountyClaimed: number;
  readonly loyaltyPoints: number;
  readonly iskDestroyed: number;
  readonly killRightSupplied: number | null;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A token / rawstr wrapper's text, or a bare string; "" otherwise. */
function tokenText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof (value as { value?: unknown }).value === "string") {
    return (value as { value: string }).value;
  }
  return "";
}

function toNumOrNull(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : null;
}

function toNum(value: JsonValue | undefined): number {
  return toNumOrNull(value) ?? 0;
}

/** FILETIME/long as a raw decimal string (can exceed 2^53); null when absent. */
function toBigDecimalString(value: JsonValue | undefined): string | null {
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }
  const long = unwrapLong(value);
  return long !== null ? long.toString() : null;
}

/**
 * Peel a CachedMethodCallResult to the payload it wraps: the substream's value.
 * A non-cached value passes through unchanged. null for a cached-OBJECT reference
 * the browser cannot decode.
 */
export function unwrapCachedResult(result: JsonValue | null | undefined): JsonValue | null {
  if (!isRecord(result) || result.type !== "object") {
    return (result ?? null) as JsonValue | null;
  }
  if (!tokenText(result.name).endsWith("objectCaching.CachedMethodCallResult")) {
    return result;
  }
  const args = result.args;
  if (!Array.isArray(args) || args.length < 2) {
    return null;
  }
  const carrier = args[1];
  if (isRecord(carrier) && carrier.type === "substream") {
    return (carrier.value ?? null) as JsonValue | null;
  }
  return null;
}

/** The rows of an objectex2 CRowset: they live on `list`. `[]` otherwise. */
function crowsetRows(rowset: JsonValue | null | undefined): readonly JsonValue[] {
  if (isRecord(rowset) && Array.isArray((rowset as { list?: unknown }).list)) {
    return (rowset as { list: readonly JsonValue[] }).list;
  }
  return [];
}

function decodeKillmailRow(row: JsonValue): CorpKillmailRow {
  const blob = readRowField(row, "killBlob");
  return {
    killID: toNum(readRowField(row, "killID")),
    solarSystemID: toNumOrNull(readRowField(row, "solarSystemID")),
    victimCharacterID: toNumOrNull(readRowField(row, "victimCharacterID")),
    victimCorporationID: toNumOrNull(readRowField(row, "victimCorporationID")),
    victimAllianceID: toNumOrNull(readRowField(row, "victimAllianceID")),
    victimFactionID: toNumOrNull(readRowField(row, "victimFactionID")),
    victimShipTypeID: toNumOrNull(readRowField(row, "victimShipTypeID")),
    finalCharacterID: toNumOrNull(readRowField(row, "finalCharacterID")),
    finalCorporationID: toNumOrNull(readRowField(row, "finalCorporationID")),
    finalAllianceID: toNumOrNull(readRowField(row, "finalAllianceID")),
    finalFactionID: toNumOrNull(readRowField(row, "finalFactionID")),
    finalShipTypeID: toNumOrNull(readRowField(row, "finalShipTypeID")),
    finalWeaponTypeID: toNumOrNull(readRowField(row, "finalWeaponTypeID")),
    killBlob: typeof blob === "string" ? blob : "",
    killTime: toBigDecimalString(readRowField(row, "killTime")),
    victimDamageTaken: toNum(readRowField(row, "victimDamageTaken")),
    finalSecurityStatus: toNum(readRowField(row, "finalSecurityStatus")),
    finalDamageDone: toNum(readRowField(row, "finalDamageDone")),
    moonID: toNumOrNull(readRowField(row, "moonID")),
    warID: toNumOrNull(readRowField(row, "warID")),
    iskLost: toNum(readRowField(row, "iskLost")),
    bountyClaimed: toNum(readRowField(row, "bountyClaimed")),
    loyaltyPoints: toNum(readRowField(row, "loyaltyPoints")),
    iskDestroyed: toNum(readRowField(row, "iskDestroyed")),
    killRightSupplied: toNumOrNull(readRowField(row, "killRightSupplied")),
  };
}

/**
 * Decode corpRegistry.GetRecentKills / GetRecentLosses -> the session corp's killboard
 * rows, in wire order. The CachedMethodCallResult wrapper is peeled first (a bare CRowset
 * passes through). `[]` is a real "no recorded kills/losses" answer (GetRecentLosses was
 * empty live for Farmer's corp).
 */
export function decodeCorpKillboard(
  result: JsonValue | null | undefined,
): CorpKillmailRow[] {
  const rowset = unwrapCachedResult(result);
  return crowsetRows(rowset).map((row) => decodeKillmailRow(row));
}
