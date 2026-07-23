// R84 — decoding the allianceRegistry SOVEREIGNTY-CONFIG reads (capital system / prime
// time; PLUMBING ONLY — no UI). Captured live on 2026-07-22. Both reads are STRICTLY
// SESSION-SCOPED and ignore args (the alliance comes from the session only). Verified
// live: as Test Two (a member of Elysian 99000000) GetPrimeTimeInfo returns currentPrimeHour
// 2 (a real populated value) and GetCapitalSystemInfo returns nulls (no capital set); as
// Farmer INJECTING allianceID 99000000 GetPrimeTimeInfo returns 0 — the injected id is
// ignored, so no foreign alliance's sovereignty config leaks.
//
//   • GetCapitalSystemInfo -> util.KeyVal(currentCapitalSystem / newCapitalSystem /
//       newCapitalSystemValidAfter FILETIME) — the capital-system transition state.
//   • GetPrimeTimeInfo -> util.KeyVal(currentPrimeHour / newPrimeHour /
//       newPrimeHourValidAfter FILETIME) — the sovereignty prime hour.
//
// ⚠ VALUE ENCODING: solar-system ids stay as data (R7d), plain numbers or null. The
// "validAfter" FILETIMEs cross as {type:"long"} and are kept as raw decimal STRINGS. The
// prime hours are small ints (0-23).

import { readKeyVal, type JsonValue } from "./wire.ts";
import { isRecord, longToDecimalString, toNum, toNumOrNull } from "./allianceInfo.ts";

/** The alliance's capital-system transition state (GetCapitalSystemInfo). */
export interface AllianceCapitalSystemInfo {
  readonly currentCapitalSystem: number | null;
  readonly newCapitalSystem: number | null;
  /** FILETIME — raw decimal string. */
  readonly newCapitalSystemValidAfter: string | null;
}

/** The alliance's sovereignty prime-hour state (GetPrimeTimeInfo). */
export interface AlliancePrimeTimeInfo {
  readonly currentPrimeHour: number;
  readonly newPrimeHour: number;
  /** FILETIME — raw decimal string. */
  readonly newPrimeHourValidAfter: string | null;
}

function isKeyValObject(value: JsonValue | null | undefined): boolean {
  return isRecord(value) && value.type === "object" && value.name === "util.KeyVal";
}

/**
 * Decode allianceRegistry.GetCapitalSystemInfo. `null` when the value is not a KeyVal
 * (a real "no alliance / alliance-less session" answer). currentCapitalSystem /
 * newCapitalSystem are null when unset (verified live for Elysian).
 */
export function decodeCapitalSystemInfo(
  result: JsonValue | null | undefined,
): AllianceCapitalSystemInfo | null {
  if (!isKeyValObject(result)) {
    return null;
  }
  return {
    currentCapitalSystem: toNumOrNull(readKeyVal(result, "currentCapitalSystem")),
    newCapitalSystem: toNumOrNull(readKeyVal(result, "newCapitalSystem")),
    newCapitalSystemValidAfter: longToDecimalString(
      readKeyVal(result, "newCapitalSystemValidAfter"),
    ),
  };
}

/**
 * Decode allianceRegistry.GetPrimeTimeInfo. `null` when the value is not a KeyVal.
 * currentPrimeHour is a small int (0-23); 0 is a real answer (alliance-less session, or
 * an alliance with the default prime hour).
 */
export function decodePrimeTimeInfo(
  result: JsonValue | null | undefined,
): AlliancePrimeTimeInfo | null {
  if (!isKeyValObject(result)) {
    return null;
  }
  return {
    currentPrimeHour: toNum(readKeyVal(result, "currentPrimeHour")),
    newPrimeHour: toNum(readKeyVal(result, "newPrimeHour")),
    newPrimeHourValidAfter: longToDecimalString(
      readKeyVal(result, "newPrimeHourValidAfter"),
    ),
  };
}
