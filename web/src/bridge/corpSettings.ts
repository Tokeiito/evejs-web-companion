// R82 — decoding the corpRegistry SETTINGS reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-settings carries four session-corp-scoped reads (corp =
// resolveCorporationID(session) / resolveBoundCorporationID(session); args ignored — a
// browser cannot point them at a foreign corp). Captured live from Farmer (corp 98000001)
// on 2026-07-22.
//
// WIRE SHAPES (verified against bytes):
//   • GetAggressionSettings       -> a named object
//     {type:"object", name:"crimewatch.corp_aggression.settings.AggressionSettings",
//      args:{type:"dict", entries:[["_enableAfter",{long}],["_disableAfter",{long}]]}}.
//     The two values are FILETIME longs (friendly-fire enable/disable schedule): live
//     _enableAfter="0" (friendly fire currently ON), _disableAfter="134276026827950000".
//   • GetStructureReinforceDefault -> a bare 2-int array [reinforceWeekday, reinforceHour]:
//     live [255, 20] (255 = NO_REINFORCEMENT_WEEKDAY sentinel; 20 = the reinforce hour).
//   • DoesMyCorpAcceptStructures  -> a bare int flag (0/1): live 0.
//   • DoesCorpRestrictCorpMails   -> a bare int flag (0/1): live 0.
//
// FILETIMEs are kept as raw decimal STRINGS (they exceed 2^53); flags decode to booleans.

import { readDictEntry, unwrapLong, type JsonValue } from "./wire.ts";

/** The friendly-fire aggression schedule (GetAggressionSettings). */
export interface CorpAggressionSettings {
  /** FILETIME after which friendly fire becomes legal; decimal string ("0" = already on). */
  readonly enableAfter: string | null;
  /** FILETIME after which friendly fire becomes illegal again; decimal string. */
  readonly disableAfter: string | null;
}

/** The default structure reinforcement window (GetStructureReinforceDefault). */
export interface StructureReinforceDefault {
  /** 255 (NO_REINFORCEMENT_WEEKDAY sentinel) or a weekday index. */
  readonly reinforceWeekday: number;
  /** The reinforcement hour (0..23). */
  readonly reinforceHour: number;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function toNum(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

/**
 * Decode corpRegistry.GetAggressionSettings -> the OWN corp's friendly-fire schedule.
 * Reads the two FILETIME longs off the named object's args dict. null result -> both null.
 */
export function decodeCorpAggressionSettings(
  result: JsonValue | null | undefined,
): CorpAggressionSettings {
  const args = isRecord(result) ? (result.args as JsonValue | undefined) : undefined;
  return {
    enableAfter: toBigDecimalString(readDictEntry(args, "_enableAfter")),
    disableAfter: toBigDecimalString(readDictEntry(args, "_disableAfter")),
  };
}

/**
 * Decode corpRegistry.GetStructureReinforceDefault -> [reinforceWeekday, reinforceHour].
 * Defaults to {255, 0} when the array is malformed/absent.
 */
export function decodeStructureReinforceDefault(
  result: JsonValue | null | undefined,
): StructureReinforceDefault {
  const arr = Array.isArray(result) ? result : [];
  return {
    reinforceWeekday: arr.length > 0 ? toNum(arr[0]) : 255,
    reinforceHour: arr.length > 1 ? toNum(arr[1]) : 0,
  };
}

/**
 * Decode a bare corpRegistry 0/1 flag (DoesMyCorpAcceptStructures / DoesCorpRestrictCorpMails)
 * -> boolean. Anything non-1 (including null / absent) is false.
 */
export function decodeCorpFlag(result: JsonValue | null | undefined): boolean {
  return toNum(result as JsonValue | undefined) === 1;
}
