// R80 — decoding the corpRegistry MEMBER-ROSTER reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-members returns the raw retail-shaped corpRegistry results,
// captured live from Farmer (corp 98000001) on 2026-07-22. corpRegistry is retail-
// bound per corp (eveMoniker.GetCorpRegistry(corpID)), but the gateway dispatches
// these TOP-LEVEL: every handler resolves its corp from the SESSION
// (resolveCorporationID), so a browser cannot point one at a foreign corp, and a
// foreign memberID simply misses the session corp's member table. corpRegistry.
// MachoBindObject is NOT allowlisted, so no bind can redirect the corp.
//
// FIVE reads decode here — the wire shapes, verified against captured bytes:
//   • GetMember(memberID)        -> a single blue.DBRow packedrow (name-keyed
//     `fields`), or null when the id is not a member of the session corp.
//   • GetMembersByIds([ids])     -> {type:"list", items:[packedrow,…]}; foreign ids
//     drop out (empty list is a real "none of these are members" answer).
//   • GetMembersPaged(page)      -> a PagedResultSet objectex1 whose header[1] is
//     [ {list of packedrows}, totalCount, page, perPage ].
//   • GetEveOwners()             -> {type:"list", items:[util.Row,…]} name-resolution
//     rows (ownerID/ownerName/typeID/gender/ownerNameID) for the session corp members.
//   • (member tracking lives in corpMemberTracking.ts — a different rowset shape.)
//
// ⚠ VALUE ENCODING, verified against bytes: in the MEMBER packedrow the ROLE BITMASKS
// (roles/grantableRoles/rolesAtHQ/…) and the FILETIMEs (startDateTime/rowDate) cross
// as BARE DECIMAL STRINGS (e.g. "1212031284210036097", "134276026827720000") — BOTH
// exceed 2^53, so they are kept as raw decimal STRINGS (never Number()-coerced, which
// would round). characterID/corporationID/baseID/accountKey/titleMask are plain ints.
// R7d: every id and every bitmask survives as data for a future UI to resolve; nothing
// is forced into a label here.

import {
  isListValue,
  readRowField,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

/** One corp member row (GetMember / GetMembersByIds / GetMembersPaged). */
export interface CorpMemberRow {
  readonly characterID: number;
  readonly corporationID: number;
  readonly divisionID: number;
  readonly squadronID: number;
  readonly title: string;
  /** Role bitmask (may exceed 2^53) — raw decimal string; null when absent. */
  readonly roles: string | null;
  readonly grantableRoles: string | null;
  /** Membership start, FILETIME decimal string; null when absent. */
  readonly startDateTime: string | null;
  readonly baseID: number | null;
  readonly rolesAtHQ: string | null;
  readonly grantableRolesAtHQ: string | null;
  readonly rolesAtBase: string | null;
  readonly grantableRolesAtBase: string | null;
  readonly rolesAtOther: string | null;
  readonly grantableRolesAtOther: string | null;
  readonly titleMask: number;
  readonly accountKey: number;
  readonly rowDate: string | null;
  readonly blockRoles: number;
  readonly ownerName: string;
}

/** One name-resolution owner row (GetEveOwners). */
export interface CorpEveOwner {
  readonly ownerID: number;
  readonly ownerName: string;
  readonly typeID: number | null;
  readonly gender: number | null;
  readonly ownerNameID: number | null;
}

/** A page of members (GetMembersPaged). */
export interface CorpMembersPage {
  readonly members: readonly CorpMemberRow[];
  readonly totalCount: number;
  readonly page: number;
  readonly perPage: number;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A number from a field, whatever encoding it arrived in (plain int, decimal
 * string, or {type:"long"}). null when absent/malformed so a caller can tell
 * "no such column" from a real zero.
 */
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

function toNum(value: JsonValue | undefined): number {
  return toNumOrNull(value) ?? 0;
}

/**
 * A full-precision decimal STRING from a field: a bare decimal string (the member
 * packedrow's roles/FILETIMEs), a plain int, or a {type:"long"} wrapper (the
 * tracking rowset). null when absent — never a rounded number.
 */
export function toBigDecimalString(value: JsonValue | undefined): string | null {
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

/**
 * Decode one member packedrow (either the name-keyed `fields` variant these
 * reads emit or the positional `values` variant — readRowField reads both).
 */
export function decodeCorpMemberRow(row: JsonValue | null | undefined): CorpMemberRow {
  return {
    characterID: toNum(readRowField(row, "characterID")),
    corporationID: toNum(readRowField(row, "corporationID")),
    divisionID: toNum(readRowField(row, "divisionID")),
    squadronID: toNum(readRowField(row, "squadronID")),
    title: toStr(readRowField(row, "title")),
    roles: toBigDecimalString(readRowField(row, "roles")),
    grantableRoles: toBigDecimalString(readRowField(row, "grantableRoles")),
    startDateTime: toBigDecimalString(readRowField(row, "startDateTime")),
    baseID: toNumOrNull(readRowField(row, "baseID")),
    rolesAtHQ: toBigDecimalString(readRowField(row, "rolesAtHQ")),
    grantableRolesAtHQ: toBigDecimalString(readRowField(row, "grantableRolesAtHQ")),
    rolesAtBase: toBigDecimalString(readRowField(row, "rolesAtBase")),
    grantableRolesAtBase: toBigDecimalString(readRowField(row, "grantableRolesAtBase")),
    rolesAtOther: toBigDecimalString(readRowField(row, "rolesAtOther")),
    grantableRolesAtOther: toBigDecimalString(readRowField(row, "grantableRolesAtOther")),
    titleMask: toNum(readRowField(row, "titleMask")),
    accountKey: toNum(readRowField(row, "accountKey")),
    rowDate: toBigDecimalString(readRowField(row, "rowDate")),
    blockRoles: toNum(readRowField(row, "blockRoles")),
    ownerName: toStr(readRowField(row, "ownerName")),
  };
}

/**
 * Decode corpRegistry.GetMember -> one member, or null when the id is not a member
 * of the session corp (a foreign memberID returns null — verified live).
 */
export function decodeCorpMember(
  result: JsonValue | null | undefined,
): CorpMemberRow | null {
  if (result === null || result === undefined) {
    return null;
  }
  // A packedrow is an object with type "packedrow"; anything else (e.g. a stray
  // list) is not a member row.
  if (!isRecord(result) || result.type !== "packedrow") {
    return null;
  }
  return decodeCorpMemberRow(result);
}

/**
 * Decode corpRegistry.GetMembersByIds -> the members among the requested ids that
 * belong to the session corp. `[]` is a real "none of these are members" answer.
 */
export function decodeCorpMembersByIds(
  result: JsonValue | null | undefined,
): CorpMemberRow[] {
  if (!isListValue(result)) {
    return [];
  }
  return result.items.map((row) => decodeCorpMemberRow(row));
}

/**
 * Decode corpRegistry.GetMembersPaged -> one page of the session corp's members
 * plus the paging counters. The PagedResultSet is an objectex1 whose header[1] is
 * [ {list of rows}, totalCount, page, perPage ]. An out-of-range page yields an
 * empty `members` with the true `totalCount` (verified live).
 */
export function decodeCorpMembersPaged(
  result: JsonValue | null | undefined,
): CorpMembersPage {
  const empty: CorpMembersPage = { members: [], totalCount: 0, page: 0, perPage: 0 };
  if (!isRecord(result) || result.type !== "objectex1" || !Array.isArray(result.header)) {
    return empty;
  }
  const payload = result.header[1];
  if (!Array.isArray(payload)) {
    return empty;
  }
  const [collection, totalCount, page, perPage] = payload;
  const members = isListValue(collection)
    ? collection.items.map((row) => decodeCorpMemberRow(row))
    : [];
  return {
    members,
    totalCount: toNum(totalCount as JsonValue),
    page: toNum(page as JsonValue),
    perPage: toNum(perPage as JsonValue),
  };
}

/**
 * Decode one util.Row (a {header,line} pair) into a {column: value} record.
 * GetEveOwners emits a LIST of these (not a Rowset), so the shared readRowsetRows
 * does not apply — the header/line are zipped here.
 */
function decodeUtilRow(row: JsonValue): Record<string, JsonValue> {
  const record: Record<string, JsonValue> = {};
  if (!isRecord(row) || row.type !== "object" || !isRecord(row.args)) {
    return record;
  }
  const entries = Array.isArray((row.args as { entries?: unknown }).entries)
    ? ((row.args as { entries: readonly JsonValue[] }).entries)
    : [];
  const byKey = (key: string): JsonValue | undefined => {
    const entry = entries.find((e) => Array.isArray(e) && e[0] === key);
    return Array.isArray(entry) ? (entry[1] as JsonValue) : undefined;
  };
  const header = byKey("header");
  const line = byKey("line");
  const columns = isListValue(header) ? header.items : [];
  const cells = isListValue(line) ? line.items : [];
  columns.forEach((column, index) => {
    if (typeof column === "string") {
      record[column] = (cells[index] ?? null) as JsonValue;
    }
  });
  return record;
}

/**
 * Decode corpRegistry.GetEveOwners -> the session corp members' name-resolution
 * rows. A row with no positive ownerID is dropped. `[]` when empty.
 */
export function decodeCorpEveOwners(
  result: JsonValue | null | undefined,
): CorpEveOwner[] {
  if (!isListValue(result)) {
    return [];
  }
  const owners: CorpEveOwner[] = [];
  for (const row of result.items) {
    const record = decodeUtilRow(row);
    const ownerID = toNum(record.ownerID);
    if (ownerID <= 0) {
      continue;
    }
    owners.push({
      ownerID,
      ownerName: toStr(record.ownerName),
      typeID: toNumOrNull(record.typeID),
      gender: toNumOrNull(record.gender),
      ownerNameID: toNumOrNull(record.ownerNameID),
    });
  }
  return owners;
}
