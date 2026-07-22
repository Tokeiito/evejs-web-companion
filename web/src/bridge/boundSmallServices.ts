// R79 — the 8 "small-service tail" Phase-2 BOUND reads across FOUR services
// (wars / scan / PI-tax / corp-station), decoded from REAL captured bytes
// (PLUMBING ONLY — no UI, no writes).
//
// Retail addresses each of these on a bound Moniker (warRegistry via
// eveMoniker.GetWar keyed on owner; scanMgr via GetSystemScanMgr; planetOrbital
// RegistryBroker + corpStationMgr via MachoBindObject). But every handler here
// resolves its target from the SESSION or from plain caller args with NO
// bound-state dependency, and each service is a real registered BaseService that
// serviceManager.lookup dispatches directly, so the BFF issues each as
// heldTopLevelCall(<svc>, <method>) on the ORDINARY top-level /call seam (mirrors
// R73 skillHandler / R76 jumpCloneSvc / R78 crimewatch); NO MachoBindObject
// two-step is opened. scanMgr's GetSystemScanMgr bind (R72) is a retail
// prerequisite but is NOT needed by these reads.
//
// ⚠ OWNERSHIP (verified LIVE cross-account 2026-07-22, Farmer 140000005 / corp
// 98000001 in system 30000144 vs Test Two 140000002 / corp 98000000). SPLIT
// VERDICT:
//   SAFE (session-scoped / genuinely public):
//    - scanMgr.GetFullState — args IGNORED; the session's OWN system signal-tracker
//      state (_getSystemID(session)). Live: Farmer's system had one STRUCTURE site.
//    - scanMgr.GetScanTargetID(siteID) — the SYSTEM is session-derived; siteID is a
//      site within the session's OWN system. Live: siteID 1030000000001 -> "QEE-288".
//    - warRegistry.GetWars([ownerID]) — PUBLIC per-owner war declarations (same class
//      as warsInfoMgr.GetWarsByOwnerID, R66). Live: Farmer's corp AND Test Two's corp
//      both empty (neither at war).
//    - warRegistry.GetNegotiations — resolveWarEntityID(SESSION) only; args IGNORED
//      (injecting 98000000 still returned Farmer's own empty list).
//    - warRegistry.IsAllianceOrCorpLocal — a CONSTANT (returns 1).
//    - planetOrbitalRegistryBroker.GetTaxRate(orbitalID) — the PUBLIC per-office
//      customs tax float (Live: 0.05 default for any id; no session, no ownership).
//   ⚠ FLAGGED arg-injection leaks (kept pre-plumbed, docs/arg-injection-leak-handoff.md):
//    - warRegistry.GetWarNegotiation(id) — getNegotiationRecord(id) with NO session
//      check → a negotiation's PRIVATE surrender/ally terms (iskValue, description).
//      No negotiation is seeded in this world (Farmer's corp is in no war) so the leak
//      is a STATIC reading + empty live probe (null for any id).
//    - corpStationMgr.DoStandingCheckForStationService(serviceID[, charID]) — args[1]
//      is a caller-chosen charID → a standing/security gate ORACLE for another char.
//      Live: null (pass) for own AND foreign charID at Farmer's ungated station.
//
// WIRE SHAPES (captured LIVE unless a builder-mirrored fixture is noted in the tests):
//   GetFullState: a 4-tuple ARRAY of bare dicts [anomalies, signatures, staticSites,
//     structures]; each dict is {type:"dict", entries:[[siteID, util.KeyVal], …]}.
//     Site KeyVal fields differ per slot (structures: typeID/groupID/categoryID/
//     position/targetID; signatures: position/targetID/difficulty/dungeonID/
//     archetypeID/deviation; anomalies add siteID/instanceID/factionID/…; staticSites:
//     position/dungeonNameID/factionID). `position` is a BARE 3-array of {type:"real"}.
//   GetScanTargetID: a BARE string ("QEE-288", or "" when the site is unknown).
//   GetWars: {type:"dict", entries:[[warID, warKeyVal], …]} (EMPTY live).
//   GetNegotiations: {type:"list", items:[negotiationKeyVal, …]} (EMPTY live).
//   GetWarNegotiation: a single negotiationKeyVal, or null (null live).
//   IsAllianceOrCorpLocal: a bare int (1).
//   GetTaxRate: a bare float (0.05).
//   DoStandingCheckForStationService: null on PASS (a throw on fail surfaces as an
//     error envelope, never a 200 result) — decoded as a pass/refused signal.
//
// This module decodes the raw reads for GET /api/bridge/bound-small-services; NO UI
// consumes it yet.

import {
  isKeyValValue,
  isListValue,
  readDictPairs,
  readKeyVal,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

// --- local coercions (do NOT import from market*.ts — separate session) -----

function asObject(value: JsonValue | undefined): Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

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

/** A small structural integer (a state/type/count code) as a Number, else fallback. */
function smallInt(value: JsonValue | undefined, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

/**
 * An ISK amount (war reward / negotiation iskValue) or a tax rate. The server
 * builds these with Number(), so they arrive as JSON numbers; a {type:"long"}
 * wrapper is tolerated and kept EXACT (decimal string) so a large amount is never
 * truncated. null when absent/non-finite.
 */
function amountData(value: JsonValue | undefined): number | string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return long <= BigInt(Number.MAX_SAFE_INTEGER) && long >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(long)
      : long.toString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** A bare float (a tax rate). A rate is a measurement, not an id, so Number is right. */
function floatOrNull(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ===========================================================================
// scanMgr.GetFullState / GetScanTargetID
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

/** Decode GetScanTargetID — a bare scan-signature label string ("" -> null). */
export function decodeScanTargetID(result: JsonValue | undefined): string | null {
  return typeof result === "string" && result !== "" ? result : null;
}

// ===========================================================================
// warRegistry.GetWars / GetNegotiations / GetWarNegotiation / IsAllianceOrCorpLocal
// ===========================================================================

/** A war ally row (from a war's `allies` dict). */
export interface WarAlly {
  readonly allyID: number | string | null;
  /** ⚠ EXACT FILETIME decimal string, or null. */
  readonly timeStarted: string | null;
  /** ⚠ EXACT FILETIME decimal string, or null. */
  readonly timeFinished: string | null;
}

/** One war declaration (public per-owner war-report data). */
export interface War {
  readonly warID: number | string | null;
  readonly declaredByID: number | string | null;
  readonly againstID: number | string | null;
  readonly warHQID: number | string | null;
  readonly timeDeclared: string | null;
  readonly timeStarted: string | null;
  readonly timeFinished: string | null;
  readonly retracted: string | null;
  readonly retractedBy: number | string | null;
  readonly billID: number | string | null;
  readonly mutual: number;
  readonly openForAllies: number;
  /** ⚠ ISK reward — Number when it fits, else an exact decimal string. */
  readonly reward: number | string | null;
  readonly allies: readonly WarAlly[];
}

function decodeWarAlly(value: JsonValue | undefined): WarAlly {
  return {
    allyID: idData(readKeyVal(value, "allyID")),
    timeStarted: exactInt(readKeyVal(value, "timeStarted")),
    timeFinished: exactInt(readKeyVal(value, "timeFinished")),
  };
}

/** Decode one war KeyVal row. */
export function decodeWar(row: JsonValue | undefined): War {
  const allies = readDictPairs(readKeyVal(row, "allies")).map(([, ally]) =>
    decodeWarAlly(ally as JsonValue),
  );
  return {
    warID: idData(readKeyVal(row, "warID")),
    declaredByID: idData(readKeyVal(row, "declaredByID")),
    againstID: idData(readKeyVal(row, "againstID")),
    warHQID: idData(readKeyVal(row, "warHQID")),
    timeDeclared: exactInt(readKeyVal(row, "timeDeclared")),
    timeStarted: exactInt(readKeyVal(row, "timeStarted")),
    timeFinished: exactInt(readKeyVal(row, "timeFinished")),
    retracted: exactInt(readKeyVal(row, "retracted")),
    retractedBy: idData(readKeyVal(row, "retractedBy")),
    billID: idData(readKeyVal(row, "billID")),
    mutual: smallInt(readKeyVal(row, "mutual"), 0),
    openForAllies: smallInt(readKeyVal(row, "openForAllies"), 0),
    reward: amountData(readKeyVal(row, "reward")),
    allies,
  };
}

/** Decode GetWars — the warID-keyed dict of public war declarations. */
export function decodeWars(result: JsonValue | undefined): readonly War[] {
  return readDictPairs(result).map(([, war]) => decodeWar(war as JsonValue));
}

/** One war negotiation (surrender / ally offer). ⚠ PRIVATE terms (see ownership). */
export interface WarNegotiation {
  readonly warNegotiationID: number | string | null;
  readonly warID: number | string | null;
  readonly warNegotiationTypeID: number;
  readonly ownerID1: number | string | null;
  readonly ownerID2: number | string | null;
  readonly declaredByID: number | string | null;
  readonly againstID: number | string | null;
  /** ⚠ ISK value of the offer — Number when it fits, else an exact decimal string. */
  readonly iskValue: number | string | null;
  readonly description: string;
  readonly negotiationState: number;
  readonly createdDateTime: string | null;
  readonly timeAccepted: string | null;
  readonly timeDeclined: string | null;
  readonly timeRetracted: string | null;
}

/** Decode one negotiation KeyVal row; null when the row is absent. */
export function decodeWarNegotiation(row: JsonValue | undefined): WarNegotiation | null {
  if (!isKeyValValue(row)) {
    return null;
  }
  const description = readKeyVal(row, "description");
  return {
    warNegotiationID: idData(readKeyVal(row, "warNegotiationID")),
    warID: idData(readKeyVal(row, "warID")),
    warNegotiationTypeID: smallInt(readKeyVal(row, "warNegotiationTypeID"), 0),
    ownerID1: idData(readKeyVal(row, "ownerID1")),
    ownerID2: idData(readKeyVal(row, "ownerID2")),
    declaredByID: idData(readKeyVal(row, "declaredByID")),
    againstID: idData(readKeyVal(row, "againstID")),
    iskValue: amountData(readKeyVal(row, "iskValue")),
    description: typeof description === "string" ? description : "",
    negotiationState: smallInt(readKeyVal(row, "negotiationState"), 0),
    createdDateTime: exactInt(readKeyVal(row, "createdDateTime")),
    timeAccepted: exactInt(readKeyVal(row, "timeAccepted")),
    timeDeclined: exactInt(readKeyVal(row, "timeDeclined")),
    timeRetracted: exactInt(readKeyVal(row, "timeRetracted")),
  };
}

/** Decode GetNegotiations — the session's own list of negotiation rows. */
export function decodeNegotiations(result: JsonValue | undefined): readonly WarNegotiation[] {
  const items = isListValue(result) ? result.items : [];
  const rows: WarNegotiation[] = [];
  for (const item of items) {
    const decoded = decodeWarNegotiation(item as JsonValue);
    if (decoded !== null) {
      rows.push(decoded);
    }
  }
  return rows;
}

/** Decode IsAllianceOrCorpLocal — a bare int flag (the handler is a constant 1). */
export function decodeIsAllianceOrCorpLocal(result: JsonValue | undefined): number {
  return smallInt(result, 0);
}

// ===========================================================================
// planetOrbitalRegistryBroker.GetTaxRate
// ===========================================================================

/** Decode GetTaxRate — the public per-customs-office corporation tax float. */
export function decodeTaxRate(result: JsonValue | undefined): number | null {
  return floatOrNull(result);
}

// ===========================================================================
// corpStationMgr.DoStandingCheckForStationService
// ===========================================================================

/**
 * The standing-gate result. The handler returns null when the check PASSES and
 * throws a typed CustomNotify when it FAILS (which surfaces as an error envelope,
 * never a 200 result), so a successful read means "passed". `passed` is false only
 * when the read carried an error.
 */
export interface StandingCheckResult {
  readonly passed: boolean;
  /** The gate-failure notify message when the read failed, else null. */
  readonly refusedMessage: string | null;
}

// ===========================================================================
// The whole GET /api/bridge/bound-small-services envelope
// ===========================================================================

export interface BoundReadResult<T> {
  readonly value: T;
  /** The failure code when the read did not succeed, else null. */
  readonly error: string | null;
  /** A human message accompanying the failure, else null. */
  readonly message: string | null;
}

export interface BoundSmallServices {
  readonly fullState: BoundReadResult<ScanFullState>;
  readonly scanTargetID: BoundReadResult<string | null>;
  readonly wars: BoundReadResult<readonly War[]>;
  readonly negotiations: BoundReadResult<readonly WarNegotiation[]>;
  readonly warNegotiation: BoundReadResult<WarNegotiation | null>;
  readonly isAllianceOrCorpLocal: BoundReadResult<number>;
  readonly taxRate: BoundReadResult<number | null>;
  readonly standingCheck: BoundReadResult<StandingCheckResult>;
}

function pick(
  reads: Record<string, JsonValue>,
  key: string,
): { result: JsonValue | undefined; error: string | null; message: string | null } {
  const cell = asObject(reads[key]);
  const error = typeof cell.error === "string" && cell.error.length > 0 ? cell.error : null;
  const message = typeof cell.message === "string" && cell.message.length > 0 ? cell.message : null;
  return { result: cell.result, error, message };
}

/** Decode the /api/bridge/bound-small-services envelope (reads keyed by method). */
export function decodeBoundSmallServices(raw: JsonValue | null | undefined): BoundSmallServices {
  const reads = asObject(asObject(raw).reads);
  const map = <T>(
    key: string,
    decode: (r: JsonValue | undefined, error: string | null, message: string | null) => T,
  ): BoundReadResult<T> => {
    const { result, error, message } = pick(reads, key);
    return { value: decode(result, error, message), error, message };
  };
  return {
    fullState: map("GetFullState", decodeFullState),
    scanTargetID: map("GetScanTargetID", decodeScanTargetID),
    wars: map("GetWars", decodeWars),
    negotiations: map("GetNegotiations", decodeNegotiations),
    warNegotiation: map("GetWarNegotiation", decodeWarNegotiation),
    isAllianceOrCorpLocal: map("IsAllianceOrCorpLocal", decodeIsAllianceOrCorpLocal),
    taxRate: map("GetTaxRate", decodeTaxRate),
    // A PASS is a null result with no error; a FAIL carries the gate's notify message.
    standingCheck: map("DoStandingCheckForStationService", (_result, error, message) => ({
      passed: error === null,
      refusedMessage: error !== null ? message : null,
    })),
  };
}
