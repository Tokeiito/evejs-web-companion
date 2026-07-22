// R61 — decoding the corpmgr identity / settings / audit reads (PLUMBING ONLY —
// no UI).
//
// GET /api/bridge/corp returns six raw retail-shaped corpmgr results, captured
// live from Farmer (corp 98000001) on 2026-07-22 — every shape below is pinned to
// those bytes, not assumed:
//
//   • publicInfo   = GetPublicInfo(corpID)  -> a util.KeyVal (public corp identity).
//   • corporations = GetCorporations(corpID) -> a SINGLE util.Row (header + line,
//     51 columns) — NOT a rowset. Read by zipping header names to line values.
//   • corpIDForChar = GetCorporationIDForCharacter(charID) -> a bare INT.
//   • aggression   = GetAggressionSettings(corpID) -> a named object
//     crimewatch.corp_aggression.settings.AggressionSettings whose BARE dict args
//     carry {_enableAfter, _disableAfter} — each a {type:"long"} FILETIME or null.
//   • aggressionForCorps = GetAggressionSettingsForCorps([corpID]) -> a
//     {type:"dict"} keyed by corpID -> the same AggressionSettings object.
//   • auditMember  = AuditMember(memberID) -> a 2-TUPLE of CRowsets [eventLog,
//     roleHistory]. ⚠ EMPTY for Farmer (no seeded events; the pair is also empty
//     when the session lacks the DIRECTOR/AUDITOR role) — a legitimate state.
//
// R7d: every id survives as a numeric field for a future UI to resolve
// (corporationID / ceoID / creatorID / allianceID / factionID / stationID /
// issuerID / characterID) — none forced into a label, none lost. FILETIMEs
// (createDate, the aggression schedule, audit times) are bigint; role masks are
// bigint-safe decimal strings.

import {
  isKeyValValue,
  isListValue,
  readDictEntry,
  readDictPairs,
  readKeyVal,
  readRowField,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

export interface CorpPublicInfo {
  readonly corporationID: number;
  readonly corporationName: string;
  readonly ticker: string;
  readonly tickerName: string;
  readonly ceoID: number;
  readonly creatorID: number;
  /** 0/absent means no alliance; carried as null. */
  readonly allianceID: number | null;
  /** 0/absent means no militia; carried as null. */
  readonly warFactionID: number | null;
  readonly description: string;
  readonly stationID: number;
  readonly shares: number;
  readonly url: string;
  readonly taxRate: number;
  readonly loyaltyPointTaxRate: number;
  readonly friendlyFire: number;
  readonly allowWar: number;
  readonly memberCount: number;
  readonly applicationsEnabled: number;
  readonly isRecruiting: boolean;
}

export interface CorporationRow {
  readonly corporationID: number;
  readonly corporationName: string;
  readonly ticker: string;
  readonly tickerName: string;
  readonly ceoID: number;
  readonly creatorID: number;
  readonly allianceID: number | null;
  readonly factionID: number | null;
  readonly warFactionID: number | null;
  readonly memberCount: number;
  readonly memberLimit: number;
  readonly shares: number;
  readonly taxRate: number;
  readonly url: string;
  readonly description: string;
  readonly stationID: number | null;
  readonly createDate: bigint | null;
  readonly aggressionEnableAfter: bigint | null;
  readonly aggressionDisableAfter: bigint | null;
  readonly divisionNames: string[];
  readonly walletDivisionNames: string[];
  readonly isRecruiting: boolean;
}

export interface AggressionSettings {
  /** FILETIME after which friendly fire becomes legal; null when unset. 0n is data. */
  readonly enableAfter: bigint | null;
  readonly disableAfter: bigint | null;
}

export interface CorpAggressionSettings extends AggressionSettings {
  readonly corporationID: number;
}

export interface AuditEvent {
  readonly eventID: number;
  readonly eventDateTime: bigint | null;
  readonly eventTypeID: number;
  readonly characterID: number;
  readonly corporationID: number;
}

export interface AuditRoleChange {
  readonly characterID: number;
  readonly corporationID: number;
  readonly changeTime: bigint | null;
  readonly grantable: boolean;
  /** Role masks are int64 — kept as bigint-safe decimal strings, never numbers. */
  readonly oldRoles: string;
  readonly newRoles: string;
  readonly issuerID: number;
}

export interface AuditMemberResult {
  readonly events: AuditEvent[];
  readonly roleHistory: AuditRoleChange[];
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
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return 0;
}

function toOptionalID(value: JsonValue | undefined): number | null {
  const id = toInt(value);
  return id > 0 ? id : null;
}

function toStringOrEmpty(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** A long/number/decimal-string as bigint (0n IS data); null only when absent/non-numeric. */
function toLong(value: JsonValue | undefined): bigint | null {
  if (value === undefined || value === null) {
    return null;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return long;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

/** A role mask (int64) as a bigint-safe decimal string; "0" when absent. */
function toRoleString(value: JsonValue | undefined): string {
  const long = toLong(value);
  return long === null ? "0" : long.toString();
}

function toBool(value: JsonValue | undefined): boolean {
  return value === true || toInt(value) === 1;
}

/**
 * Decode corpmgr.GetPublicInfo -> the public corp identity record. Every id is a
 * numeric field (R7d). null when the read did not produce a KeyVal.
 */
export function decodeCorpPublicInfo(
  result: JsonValue | null | undefined,
): CorpPublicInfo | null {
  if (!isKeyValValue(result)) {
    return null;
  }
  const corporationID = toInt(readKeyVal(result, "corporationID"));
  const corporationName = toStringOrEmpty(readKeyVal(result, "corporationName"));
  if (corporationID <= 0 && corporationName === "") {
    return null;
  }
  return {
    corporationID,
    corporationName,
    ticker: toStringOrEmpty(readKeyVal(result, "ticker")),
    tickerName: toStringOrEmpty(readKeyVal(result, "tickerName")) || toStringOrEmpty(readKeyVal(result, "ticker")),
    ceoID: toInt(readKeyVal(result, "ceoID")),
    creatorID: toInt(readKeyVal(result, "creatorID")),
    allianceID: toOptionalID(readKeyVal(result, "allianceID")),
    warFactionID: toOptionalID(readKeyVal(result, "warFactionID")),
    description: toStringOrEmpty(readKeyVal(result, "description")),
    stationID: toInt(readKeyVal(result, "stationID")),
    shares: toInt(readKeyVal(result, "shares")),
    url: toStringOrEmpty(readKeyVal(result, "url")),
    taxRate: toFloat(readKeyVal(result, "taxRate")),
    loyaltyPointTaxRate: toFloat(readKeyVal(result, "loyaltyPointTaxRate")),
    friendlyFire: toInt(readKeyVal(result, "friendlyFire")),
    allowWar: toInt(readKeyVal(result, "allowWar")),
    memberCount: toInt(readKeyVal(result, "memberCount")),
    applicationsEnabled: toInt(readKeyVal(result, "applicationsEnabled")),
    isRecruiting: toBool(readKeyVal(result, "isRecruiting")),
  };
}

/**
 * Read a util.Row -> a name-keyed record. A util.Row is {type:"object",
 * name:"util.Row", args:{dict[["header", list], ["line", list]]}}; the header
 * names index the parallel line values. Empty map for any other shape.
 */
function readUtilRow(result: JsonValue | null | undefined): Map<string, JsonValue> {
  const map = new Map<string, JsonValue>();
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return map;
  }
  const args = (result as { args?: unknown }).args;
  if (typeof args !== "object" || args === null) {
    return map;
  }
  const entries = (args as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return map;
  }
  const byKey = (key: string): JsonValue | undefined => {
    const entry = entries.find((e) => Array.isArray(e) && e[0] === key);
    return Array.isArray(entry) ? (entry[1] as JsonValue) : undefined;
  };
  const header = byKey("header");
  const line = byKey("line");
  const names = isListValue(header) ? header.items : [];
  const values = isListValue(line) ? line.items : [];
  names.forEach((name, index) => {
    if (typeof name === "string") {
      map.set(name, (values[index] ?? null) as JsonValue);
    }
  });
  return map;
}

/**
 * Decode corpmgr.GetCorporations -> the single corporation row. ids stay data
 * (R7d), FILETIMEs are bigint, division names are carried as labels. null when
 * the util.Row is absent or carries no corporationID.
 */
export function decodeCorporationRow(
  result: JsonValue | null | undefined,
): CorporationRow | null {
  const row = readUtilRow(result);
  const corporationID = toInt(row.get("corporationID"));
  if (corporationID <= 0) {
    return null;
  }
  const divisionNames = [1, 2, 3, 4, 5, 6, 7].map((n) => toStringOrEmpty(row.get(`division${n}`)));
  const walletDivisionNames = [1, 2, 3, 4, 5, 6, 7].map((n) => toStringOrEmpty(row.get(`walletDivision${n}`)));
  return {
    corporationID,
    corporationName: toStringOrEmpty(row.get("corporationName")),
    ticker: toStringOrEmpty(row.get("ticker")),
    tickerName: toStringOrEmpty(row.get("tickerName")),
    ceoID: toInt(row.get("ceoID")),
    creatorID: toInt(row.get("creatorID")),
    allianceID: toOptionalID(row.get("allianceID")),
    factionID: toOptionalID(row.get("factionID")),
    warFactionID: toOptionalID(row.get("warFactionID")),
    memberCount: toInt(row.get("memberCount")),
    memberLimit: toInt(row.get("memberLimit")),
    shares: toInt(row.get("shares")),
    taxRate: toFloat(row.get("taxRate")),
    url: toStringOrEmpty(row.get("url")),
    description: toStringOrEmpty(row.get("description")),
    stationID: toOptionalID(row.get("stationID")),
    createDate: toLong(row.get("createDate")),
    aggressionEnableAfter: toLong(row.get("aggressionEnableAfter")),
    aggressionDisableAfter: toLong(row.get("aggressionDisableAfter")),
    divisionNames,
    walletDivisionNames,
    isRecruiting: toBool(row.get("isRecruiting")),
  };
}

/**
 * Decode corpmgr.GetCorporationIDForCharacter -> the character's corp id. null
 * when absent/zero (the id stays data; a future UI resolves it to a name).
 */
export function decodeCorporationIDForCharacter(
  result: JsonValue | null | undefined,
): number | null {
  return toOptionalID(result ?? undefined);
}

/** The bare dict args of the AggressionSettings named object, or null. */
function aggressionArgs(result: JsonValue | null | undefined): JsonValue | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return null;
  }
  const args = (result as { args?: unknown }).args;
  if (typeof args === "object" && args !== null && (args as { type?: unknown }).type === "dict") {
    return args as JsonValue;
  }
  return null;
}

/**
 * Decode corpmgr.GetAggressionSettings -> the friendly-fire schedule. Each side
 * is a FILETIME bigint (0n is data — "enabled since epoch") or null when unset.
 * null when the named object is absent.
 */
export function decodeAggressionSettings(
  result: JsonValue | null | undefined,
): AggressionSettings | null {
  const args = aggressionArgs(result);
  if (args === null) {
    return null;
  }
  return {
    enableAfter: toLong(readDictEntry(args, "_enableAfter")),
    disableAfter: toLong(readDictEntry(args, "_disableAfter")),
  };
}

/**
 * Decode corpmgr.GetAggressionSettingsForCorps -> per-corp aggression settings.
 * `[]` when the value is not a dict. Each entry keeps corporationID as data (R7d).
 */
export function decodeAggressionSettingsForCorps(
  result: JsonValue | null | undefined,
): CorpAggressionSettings[] {
  const rows: CorpAggressionSettings[] = [];
  for (const [corpKey, settings] of readDictPairs(result ?? null)) {
    const corporationID = toInt(corpKey as JsonValue);
    const decoded = decodeAggressionSettings(settings);
    if (corporationID > 0 && decoded !== null) {
      rows.push({ corporationID, enableAfter: decoded.enableAfter, disableAfter: decoded.disableAfter });
    }
  }
  return rows;
}

/** The rows of a bare (non-cached) CRowset objectex2: they live on `list`. */
function crowsetList(value: JsonValue | undefined): readonly JsonValue[] {
  if (typeof value === "object" && value !== null && !Array.isArray(value) && Array.isArray((value as { list?: unknown }).list)) {
    return (value as { list: readonly JsonValue[] }).list;
  }
  return [];
}

/**
 * Decode corpmgr.AuditMember -> the member event log + role-change history. The
 * result is a 2-tuple of CRowsets; each is read from its `list` via readRowField
 * (the rows are positional packedrows when populated). Both empty is a legitimate
 * "no audit access / no events" state. Role masks stay bigint-safe strings.
 */
export function decodeAuditMember(
  result: JsonValue | null | undefined,
): AuditMemberResult {
  const tuple = Array.isArray(result) ? (result as readonly JsonValue[]) : [];
  const events: AuditEvent[] = [];
  for (const row of crowsetList(tuple[0])) {
    events.push({
      eventID: toInt(readRowField(row, "eventID")),
      eventDateTime: toLong(readRowField(row, "eventDateTime")),
      eventTypeID: toInt(readRowField(row, "eventTypeID")),
      characterID: toInt(readRowField(row, "characterID")),
      corporationID: toInt(readRowField(row, "corporationID")),
    });
  }
  const roleHistory: AuditRoleChange[] = [];
  for (const row of crowsetList(tuple[1])) {
    roleHistory.push({
      characterID: toInt(readRowField(row, "characterID")),
      corporationID: toInt(readRowField(row, "corporationID")),
      changeTime: toLong(readRowField(row, "changeTime")),
      grantable: toBool(readRowField(row, "grantable")),
      oldRoles: toRoleString(readRowField(row, "oldRoles")),
      newRoles: toRoleString(readRowField(row, "newRoles")),
      issuerID: toInt(readRowField(row, "issuerID")),
    });
  }
  return { events, roleHistory };
}
