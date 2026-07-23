// R81 — decoding the corpRegistry APPLICATION + WELCOME-MAIL reads (PLUMBING ONLY —
// no UI).
//
// GET /api/bridge/corp-applications returns the raw retail-shaped corpRegistry results.
// Every handler resolves its corp from resolveCorporationID(session) or its char from
// resolveCharacterID(session, []); args are ignored, and corpRegistry.MachoBindObject
// is NOT allowlisted — so all six are session-scoped. Farmer's corp seeds NO pending or
// archived applications and no alliance application, so the empty shapes are the real
// captured state (2026-07-22); the populated-row structure is the same server builder
// (buildCorporationApplicationRow / buildCorporationAllianceApplicationsIndexRowset /
// buildKeyVal) that produced the descriptors, so the columns are identical — only the
// rows differ.
//
// SIX reads decode here — the wire shapes, verified against captured bytes:
//   • GetApplications()        -> a bare dict {applicantCharID -> {type:"list"} of
//     application packedrows} (the session corp's incoming applications).
//   • GetOldApplications()     -> a {type:"list"} of application packedrows (archived).
//   • GetMyApplications()      -> a bare dict {corpID -> {type:"list"} of application
//     packedrows} (the session char's own, across corps).
//   • GetMyOldApplications()   -> a {type:"list"} of application packedrows (own,
//     archived).
//   • GetAllianceApplications() -> an IndexRowset keyed by allianceID; rows carry
//     [allianceID, corporationID, applicationText, state, applicationDateTime].
//   • GetCorpWelcomeMail()     -> a util.KeyVal {characterID, changeDate, welcomeMail}.
//
// ⚠ VALUE ENCODING (verified against bytes): the application packedrow's
// applicationDateTime and the welcome-mail changeDate are FILETIMEs that cross as
// {type:"long"} — kept as raw decimal STRINGS (they exceed 2^53). applicationID /
// corporationID / characterID / status / state are plain ints; deleted is a bool. All
// ids stay data (R7d); nothing is forced into a label here.

import {
  isListValue,
  readDictEntry,
  readDictPairs,
  readKeyVal,
  readRowField,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

/** One corp/char application (GetApplications / …My… / …Old… variants). */
export interface CorpApplicationRow {
  readonly applicationID: number;
  readonly corporationID: number;
  readonly characterID: number;
  readonly applicationText: string;
  readonly status: number;
  /** Applied-at FILETIME, raw decimal string; null when absent. */
  readonly applicationDateTime: string | null;
  readonly deleted: boolean;
  readonly responseText: string | null;
}

/** A dict-keyed group of applications (GetApplications / GetMyApplications). */
export interface CorpApplicationGroup {
  /** Wire dict key — the applicant characterID (GetApplications) or the corpID
   *  (GetMyApplications). */
  readonly key: number;
  readonly applications: readonly CorpApplicationRow[];
}

/** One outgoing alliance application (GetAllianceApplications). */
export interface CorpAllianceApplicationRow {
  readonly allianceID: number;
  readonly corporationID: number;
  readonly applicationText: string;
  readonly state: number;
  /** Applied-at FILETIME, raw decimal string; null when absent. */
  readonly applicationDateTime: string | null;
}

/** The corp welcome mail (GetCorpWelcomeMail). */
export interface CorpWelcomeMail {
  /** The editor's characterID; null when never set. */
  readonly characterID: number | null;
  /** Last-changed FILETIME, raw decimal string; "0" when never set. */
  readonly changeDate: string | null;
  readonly welcomeMail: string;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listItems(value: JsonValue | null | undefined): readonly JsonValue[] {
  return isListValue(value) ? value.items : [];
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

function toNumOrNull(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : null;
}

/** Full-precision FILETIME decimal string (never a rounded number); null when absent. */
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

function toStr(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function toStrOrNull(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/** Decode one application packedrow (name-keyed `fields` variant). */
export function decodeCorpApplicationRow(
  row: JsonValue | null | undefined,
): CorpApplicationRow {
  return {
    applicationID: toNum(readRowField(row, "applicationID")),
    corporationID: toNum(readRowField(row, "corporationID")),
    characterID: toNum(readRowField(row, "characterID")),
    applicationText: toStr(readRowField(row, "applicationText")),
    status: toNum(readRowField(row, "status")),
    applicationDateTime: toBigDecimalString(readRowField(row, "applicationDateTime")),
    deleted: toNum(readRowField(row, "deleted")) !== 0,
    responseText: toStrOrNull(readRowField(row, "responseText")),
  };
}

/**
 * Decode corpRegistry.GetApplications / GetMyApplications -> the dict-keyed application
 * groups, in wire order. For GetApplications the key is the applicant characterID; for
 * GetMyApplications it is the corpID. `[]` is a real "no applications" answer.
 */
export function decodeCorpApplicationGroups(
  result: JsonValue | null | undefined,
): CorpApplicationGroup[] {
  const groups: CorpApplicationGroup[] = [];
  for (const [key, value] of readDictPairs(result)) {
    groups.push({
      key: Number(key) || 0,
      applications: listItems(value).map(decodeCorpApplicationRow),
    });
  }
  return groups;
}

/**
 * Decode corpRegistry.GetOldApplications / GetMyOldApplications -> a flat list of
 * archived application rows, in wire order. `[]` is a real "no history" answer.
 */
export function decodeCorpApplicationList(
  result: JsonValue | null | undefined,
): CorpApplicationRow[] {
  return listItems(result).map(decodeCorpApplicationRow);
}

/**
 * Decode corpRegistry.GetAllianceApplications -> the corp's outgoing alliance
 * applications. The result is an IndexRowset whose `items` dict maps allianceID -> a
 * positional line [allianceID, corporationID, applicationText, state, applicationDateTime].
 * `[]` is a real "no alliance application" answer (Farmer's corp has none live).
 */
export function decodeCorpAllianceApplications(
  result: JsonValue | null | undefined,
): CorpAllianceApplicationRow[] {
  if (!isRecord(result) || result.type !== "object") {
    return [];
  }
  const args = (result as { args?: JsonValue }).args;
  const items = readDictEntry(args, "items");
  const rows: CorpAllianceApplicationRow[] = [];
  for (const [, line] of readDictPairs(items)) {
    const cells = listItems(line);
    rows.push({
      allianceID: toNum(cells[0]),
      corporationID: toNum(cells[1]),
      applicationText: toStr(cells[2]),
      state: toNum(cells[3]),
      applicationDateTime: toBigDecimalString(cells[4]),
    });
  }
  return rows;
}

/**
 * Decode corpRegistry.GetCorpWelcomeMail -> the corp welcome mail, or null when the
 * value is not a KeyVal. An empty `welcomeMail` string with a null editor is the real
 * "never set" state (Farmer's corp seeds no welcome mail live).
 */
export function decodeCorpWelcomeMail(
  result: JsonValue | null | undefined,
): CorpWelcomeMail | null {
  if (
    !isRecord(result) ||
    result.type !== "object" ||
    result.name !== "util.KeyVal"
  ) {
    return null;
  }
  return {
    characterID: toNumOrNull(readKeyVal(result, "characterID")),
    changeDate: toBigDecimalString(readKeyVal(result, "changeDate")),
    welcomeMail: toStr(readKeyVal(result, "welcomeMail")),
  };
}
