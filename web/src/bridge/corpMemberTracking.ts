// R80 — decoding the corpRegistry MEMBER-TRACKING reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-members carries these two alongside the roster reads.
// Captured live from Farmer (corp 98000001) on 2026-07-22. Both are session-corp-
// scoped (resolveCorporationID(session), args ignored) — a browser cannot point
// them at a foreign corp. ⚠ In eve.js these are NOT role-gated (retail gates member
// tracking to directors); they return the OWN corp's tracking regardless, so there
// is still no foreign-corp leak.
//
//   • GetMemberTrackingInfo()       -> a CachedMethodCallResult wrapping (substream)
//     a CRowset. The cache wrapper is versioning bookkeeping; the rows live on the
//     objectex2 CRowset's `list`.
//   • GetMemberTrackingInfoSimple() -> the SAME CRowset directly (no cache wrapper).
//
// ⚠ VALUE ENCODING, verified against bytes: this rowset's rows are the POSITIONAL
// `values` packedrow variant, and its role masks + FILETIMEs cross as {type:"long"}
// WRAPPERS (not the bare decimal strings the member roster uses) — e.g. logonDateTime
// {type:"long", value:"134292376406920000"}. locationID is column-type 20 (int64) but
// crosses as a PLAIN NUMBER (measured 60003760). lastOnline is -1 when the member is
// ONLINE, else an hours-since count. logonDateTime / logoffDateTime are null when the
// member has never logged on / is still online. Role masks + FILETIMEs are kept as
// raw decimal STRINGS (they can exceed 2^53); ids stay numeric (R7d).

import { readRowField, type JsonValue } from "./wire.ts";
import { toBigDecimalString } from "./corpMembers.ts";

/** One member-tracking row (GetMemberTrackingInfo / …Simple). */
export interface CorpMemberTrackingRow {
  readonly characterID: number;
  readonly corporationID: number;
  readonly title: string;
  readonly roles: string | null;
  readonly grantableRoles: string | null;
  readonly baseID: number | null;
  readonly startDateTime: string | null;
  /** Last logon, FILETIME decimal string; null when never / still online. */
  readonly logonDateTime: string | null;
  readonly logoffDateTime: string | null;
  /** -1 when the member is currently online, else hours since last online. */
  readonly lastOnline: number;
  readonly locationID: number | null;
  readonly shipTypeID: number | null;
  readonly rolesAtHQ: string | null;
  readonly grantableRolesAtHQ: string | null;
  readonly rolesAtBase: string | null;
  readonly grantableRolesAtBase: string | null;
  readonly rolesAtOther: string | null;
  readonly grantableRolesAtOther: string | null;
  readonly factionID: number | null;
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
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  // A {type:"long"} wrapper (locationID never uses one live, but tolerate it).
  if (isRecord(value) && value.type === "long") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "number") return inner;
    if (typeof inner === "string" && /^-?\d+$/.test(inner)) return Number(inner);
  }
  return null;
}

/**
 * Peel a CachedMethodCallResult to the payload it wraps: the substream's value.
 * A non-cached value passes through unchanged, so this is safe to call on
 * GetMemberTrackingInfoSimple (which is already the bare CRowset). null for a
 * cached-OBJECT reference the browser cannot decode.
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

/**
 * The rows of an objectex2 CRowset: they live on `list`, not `items`/`lines`.
 * `[]` for a non-CRowset or an empty rowset.
 */
function crowsetRows(rowset: JsonValue | null | undefined): readonly JsonValue[] {
  if (isRecord(rowset) && Array.isArray((rowset as { list?: unknown }).list)) {
    return (rowset as { list: readonly JsonValue[] }).list;
  }
  return [];
}

function decodeTrackingRow(row: JsonValue): CorpMemberTrackingRow {
  return {
    characterID: toNumOrNull(readRowField(row, "characterID")) ?? 0,
    corporationID: toNumOrNull(readRowField(row, "corporationID")) ?? 0,
    title: typeof readRowField(row, "title") === "string" ? (readRowField(row, "title") as string) : "",
    roles: toBigDecimalString(readRowField(row, "roles")),
    grantableRoles: toBigDecimalString(readRowField(row, "grantableRoles")),
    baseID: toNumOrNull(readRowField(row, "baseID")),
    startDateTime: toBigDecimalString(readRowField(row, "startDateTime")),
    logonDateTime: toBigDecimalString(readRowField(row, "logonDateTime")),
    logoffDateTime: toBigDecimalString(readRowField(row, "logoffDateTime")),
    lastOnline: toNumOrNull(readRowField(row, "lastOnline")) ?? 0,
    locationID: toNumOrNull(readRowField(row, "locationID")),
    shipTypeID: toNumOrNull(readRowField(row, "shipTypeID")),
    rolesAtHQ: toBigDecimalString(readRowField(row, "rolesAtHQ")),
    grantableRolesAtHQ: toBigDecimalString(readRowField(row, "grantableRolesAtHQ")),
    rolesAtBase: toBigDecimalString(readRowField(row, "rolesAtBase")),
    grantableRolesAtBase: toBigDecimalString(readRowField(row, "grantableRolesAtBase")),
    rolesAtOther: toBigDecimalString(readRowField(row, "rolesAtOther")),
    grantableRolesAtOther: toBigDecimalString(readRowField(row, "grantableRolesAtOther")),
    factionID: toNumOrNull(readRowField(row, "factionID")),
  };
}

/**
 * Decode corpRegistry.GetMemberTrackingInfo (cached) OR GetMemberTrackingInfoSimple
 * (bare) -> the session corp's member-tracking rows. Handles both because the cache
 * wrapper is peeled first (a bare CRowset passes through unwrapCachedResult). `[]`
 * when the corp has no members.
 */
export function decodeCorpMemberTracking(
  result: JsonValue | null | undefined,
): CorpMemberTrackingRow[] {
  const rowset = unwrapCachedResult(result);
  return crowsetRows(rowset).map((row) => decodeTrackingRow(row));
}
