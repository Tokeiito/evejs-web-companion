// The scanner's full state, scanMgr.GetFullState on the system's scan manager (sensorSuiteService.py 718: the
// object GetSystemScanMgr() answers), decoded from real captured bytes: a 4-tuple of bare dicts (anomalies, signatures,
// static sites, structures), each {type:"dict", entries:[[siteID, util.KeyVal], ...]}. A site's KeyVal fields differ by
// slot (structures: typeID/groupID/categoryID/position/targetID; signatures: position/targetID/difficulty/dungeonID/
// archetypeID/deviation; anomalies add siteID/instanceID/factionID/...; static sites: position/dungeonNameID/
// factionID); `position` is a bare 3-array of {type:"real"}. Read by bridge/scanFullState.ts, on the scan manager the
// pilot's transport binds.
//
// (The rest of R79's eight "small-service tail" reads, wars, negotiations, a customs office's tax and a station
// service's standing check, went with their route, GET /api/bridge/bound-small-services, which no screen read; it
// asked GetFullState by name with seven other reads. Taken out in bc181c05.)

import {
  isKeyValValue,
  isListValue,
  readDictPairs,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

// --- local coercions (do NOT import from market*.ts — separate session) -----

function asArray(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? (value as readonly JsonValue[]) : [];
}

/**
 * An EXACT integer as a decimal string — a FILETIME (100ns ticks since 1601) or
 * any long that can exceed 2^53 and must never pass through Number. Accepts a
 * {type:"long"} wrapper, a bare integer, or a bare decimal string; null for a
 * genuinely absent/null field.
 */
function exactInt(value: JsonValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return long.toString();
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return value;
  }
  return null;
}

/**
 * A positive game id as a Number when it is a safe integer, else its exact decimal
 * string (R7d — data, never coerced into a label, never truncated). null when
 * absent/unparseable/zero-as-absent is the caller's choice (kept as 0 here).
 */
function idData(value: JsonValue | undefined): number | string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return long <= BigInt(Number.MAX_SAFE_INTEGER) && long >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(long)
      : long.toString();
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return value;
  }
  return null;
}

// ===========================================================================
// scanMgr.GetFullState
// ===========================================================================

/** A decoded scan-site field value: reals -> number, real-vectors -> number[],
 * longs -> exact string, lists -> arrays, scalars as-is. */
export type ScanFieldValue =
  | number
  | string
  | boolean
  | null
  | readonly ScanFieldValue[];

/** Decode one KeyVal field value from a scan-site row, faithfully and losslessly. */
function decodeScanValue(value: JsonValue | undefined): ScanFieldValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeScanValue(item));
  }
  const obj = value as Record<string, JsonValue>;
  if (obj.type === "real") {
    const numeric = Number(obj.value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (obj.type === "long") {
    return exactInt(value);
  }
  if (isListValue(value)) {
    return value.items.map((item) => decodeScanValue(item as JsonValue));
  }
  // A nested KeyVal / dict is not expected in scan rows; fold it to its pairs so a
  // future field is never silently dropped.
  if (isKeyValValue(value)) {
    return null;
  }
  return null;
}

/** One scannable site (anomaly / signature / static site / structure). */
export interface ScanSite {
  /** ⚠ the site id (the dict key) — DATA, kept as Number when safe else a string. */
  readonly siteID: number | string | null;
  /** targetID (the scan-signature label, e.g. "QEE-288"); null when the slot has none. */
  readonly targetID: string | null;
  /** The 3-vector position [x,y,z] in metres, or null when absent. */
  readonly position: readonly number[] | null;
  /** EVERY KeyVal field of the row, decoded losslessly (slot-specific extras included). */
  readonly fields: Readonly<Record<string, ScanFieldValue>>;
}

/** Decode a bare site dict {type:"dict", entries:[[siteID, KeyVal], …]} to sites. */
export function decodeScanSites(dict: JsonValue | undefined): readonly ScanSite[] {
  const pairs = readDictPairs(dict);
  const sites: ScanSite[] = [];
  for (const [key, keyval] of pairs) {
    const fields: Record<string, ScanFieldValue> = {};
    if (isKeyValValue(keyval)) {
      for (const [field, raw] of keyval.args.entries) {
        fields[field] = decodeScanValue(raw as JsonValue);
      }
    }
    const positionRaw = fields.position;
    const position =
      Array.isArray(positionRaw) && positionRaw.every((n) => typeof n === "number")
        ? (positionRaw as readonly number[])
        : null;
    const targetIDRaw = fields.targetID;
    sites.push({
      siteID: idData(key as JsonValue),
      targetID: typeof targetIDRaw === "string" && targetIDRaw !== "" ? targetIDRaw : null,
      position,
      fields,
    });
  }
  return sites;
}

/** The four scan slots of GetFullState, in server order. */
export interface ScanFullState {
  readonly anomalies: readonly ScanSite[];
  readonly signatures: readonly ScanSite[];
  readonly staticSites: readonly ScanSite[];
  readonly structures: readonly ScanSite[];
}

/** Decode GetFullState — the session's OWN system signal-tracker 4-tuple. */
export function decodeFullState(result: JsonValue | undefined): ScanFullState {
  const tuple = asArray(result);
  return {
    anomalies: decodeScanSites(tuple[0]),
    signatures: decodeScanSites(tuple[1]),
    staticSites: decodeScanSites(tuple[2]),
    structures: decodeScanSites(tuple[3]),
  };
}
