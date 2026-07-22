// Saved fitting library decoded to plain rows (goal R57, PLUMBING ONLY — no UI).
//
// GET /api/bridge/fittings returns the raw retail-shaped result of
// charFittingMgr.GetFittings (the CHARACTER service — distinct from corp/alliance
// fitting managers, and distinct from the R12 ACTIVE-ship fit). The wire shape,
// captured live from Farmer (character 140000005) on 2026-07-22, is a marshaled
// DICT keyed by fittingID whose values are util.KeyVal rows:
//
//   {type:"dict", entries:[[<fittingID>, util.KeyVal{
//       description (string),
//       fitData ({type:"list", items:[{type:"tuple", items:[typeID, flagID,
//                quantity]}, …]}),
//       fittingID (int),
//       name (string),
//       ownerID (int),
//       savedDate ({type:"long", value:"<FILETIME>"}),
//       shipTypeID (int)}], …]}
//
// R7d: a fitting's shipTypeID, each module typeID, the slot flagID and the ownerID
// are IDs — kept here as plain numeric fields for a future UI to resolve (typeIDs
// -> item names, flagID -> slot label). They are NOT forced into a label here, and
// no rendering happens in this file. `name`/`description` are the player's own
// free text and pass through as strings. An empty dict is a REAL "no saved
// fittings" answer, not a failure.

import { readRowField, unwrapLong, type JsonValue } from "./wire.ts";

/** One fitted item within a saved fitting: a typeID at a slot flag, in a quantity. */
export interface SavedFittingModule {
  readonly typeID: number;
  readonly flagID: number;
  readonly quantity: number;
}

/** One saved fitting: identity + ship + the modules it fits. */
export interface SavedFitting {
  readonly fittingID: number;
  readonly name: string;
  readonly description: string;
  readonly shipTypeID: number;
  readonly ownerID: number;
  /** The FILETIME the fitting was saved (exceeds 2^53, so a bigint); null if absent. */
  readonly savedDate: bigint | null;
  readonly modules: readonly SavedFittingModule[];
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

/**
 * A FILETIME instant as a bigint (it exceeds 2^53), tolerant of the {type:"long"}
 * wrapper and a bare decimal string (R32); null when absent or a zero sentinel.
 */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value)
      ? BigInt(value)
      : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** The items of a marshaled tuple/list wrapper, or a bare array; [] otherwise. */
function seqItems(value: JsonValue | undefined): readonly JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as { type?: unknown; items?: unknown };
    if (
      (candidate.type === "tuple" || candidate.type === "list") &&
      Array.isArray(candidate.items)
    ) {
      return candidate.items as readonly JsonValue[];
    }
  }
  return [];
}

/** The [key, value] pairs of a marshaled dict wrapper; [] otherwise. */
function dictEntries(value: JsonValue): readonly (readonly JsonValue[])[] {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const candidate = value as { type?: unknown; entries?: unknown };
    if (candidate.type === "dict" && Array.isArray(candidate.entries)) {
      return candidate.entries.filter((entry) => Array.isArray(entry)) as readonly (readonly JsonValue[])[];
    }
  }
  return [];
}

/** Decode one fitData entry ({type:"tuple", items:[typeID, flagID, quantity]}). */
function decodeModule(entry: JsonValue): SavedFittingModule | null {
  const items = seqItems(entry);
  const typeID = toNumber(items[0]);
  const flagID = toNumber(items[1]);
  const quantity = toNumber(items[2]);
  if (typeID <= 0) {
    return null;
  }
  return { typeID, flagID, quantity };
}

/**
 * Decode charFittingMgr.GetFittings into plain rows. The dict key is the
 * fittingID, but the value's own `fittingID` field is read instead (they match;
 * reading the field avoids trusting the marshaled key type). Rows sort by
 * fittingID for a stable order. A malformed row (no fittingID, no shipTypeID) is
 * dropped; `[]` is a real "no saved fittings" answer.
 */
export function decodeFittings(result: JsonValue): SavedFitting[] {
  const rows: SavedFitting[] = [];
  for (const entry of dictEntries(result)) {
    const keyVal = entry[1];
    const fittingID = toNumber(readRowField(keyVal, "fittingID"));
    const shipTypeID = toNumber(readRowField(keyVal, "shipTypeID"));
    if (fittingID <= 0 || shipTypeID <= 0) {
      continue;
    }
    const nameField = readRowField(keyVal, "name");
    const descriptionField = readRowField(keyVal, "description");
    const modules = seqItems(readRowField(keyVal, "fitData"))
      .map(decodeModule)
      .filter((module): module is SavedFittingModule => module !== null);
    rows.push({
      fittingID,
      name: typeof nameField === "string" ? nameField : "",
      description: typeof descriptionField === "string" ? descriptionField : "",
      shipTypeID,
      ownerID: toNumber(readRowField(keyVal, "ownerID")),
      savedDate: toFiletime(readRowField(keyVal, "savedDate")),
      modules,
    });
  }
  rows.sort((left, right) => left.fittingID - right.fittingID);
  return rows;
}
