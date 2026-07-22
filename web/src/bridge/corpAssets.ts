// R61 — decoding the corpmgr ASSET reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-assets returns three raw retail-shaped corpmgr results,
// captured live from Farmer (corp 98000001) on 2026-07-22. ⚠ ALL THREE WRAP A
// CRowset IN A CachedMethodCallResult, so the decoder unwraps BOTH layers —
// exactly the double-unwrap R55 GetStandingCompositions uses: `unwrapCachedResult`
// (market.ts) peels the cache wrapper's substream, then the rows live on the
// objectex2 CRowset's `list` (an objectex2's rows are NOT on `items`), and each
// field is read through `readRowField` (name-keyed packedrows here; positional is
// tolerated too). The cache wrapper is versioning bookkeeping, not data.
//
//   • GetAssetInventory(corpID, which)        -> asset LOCATIONS for a bucket.
//     Columns [locationID, solarsystemID, typeID] (deliveries buckets add an
//     itemCount column). ⚠ THE COLUMN IS `solarsystemID` (lowercase s), not
//     solarSystemID — the decoder reads the wire name and exposes solarSystemID.
//   • GetAssetInventoryForLocation(corpID, locationID, which) -> the ITEMS at one
//     location. Columns [itemID, typeID, ownerID, locationID, flagID, quantity,
//     groupID, categoryID, customInfo, stacksize, singleton].
//   • SearchAssets(which, category/group/type/minQuantity) -> matching LOCATIONS
//     (rows carry just [locationID]).
//
// ⚠ VALUE ENCODING, verified against bytes: itemID / locationID are int64
// (type code 20) but corpAssetState builds them with toInt(), so they cross as
// PLAIN NUMBERS (measured: itemID 9988400029054 > 2^32, still < 2^53). `toNumber`
// still accepts a {type:"long"} wrapper and a bare decimal string, because the
// gateway renders any genuine BigInt as a decimal string and a future handler
// change must not silently zero the field.
//
// ⚠ `quantity` IS -1 FOR AN ASSEMBLED SINGLETON, not a count (measured live:
// quantity -1, singleton 1, stacksize 1). `units` below is the render-safe rule
// (a singleton is 1, everything else its stacksize) — the same rule R37
// personalAssets applies — so a UI never shows "-1" of a ship.
//
// R7d: every id (locationID / solarSystemID / typeID / itemID / ownerID) survives
// as a numeric field for a future UI to resolve to a name; none is forced into a
// label here, none is lost. Sparse corp assets (an empty CRowset) are a legitimate
// state, not a failure.

import { readRowField, unwrapLong, type JsonValue } from "./wire.ts";
import { unwrapCachedResult } from "./market.ts";

/** One asset LOCATION row (GetAssetInventory). */
export interface CorpAssetLocation {
  readonly locationID: number;
  /** 0/absent means unknown; carried as null (never a fake system). */
  readonly solarSystemID: number | null;
  /** The location's own typeID (station/structure); null when unknown. */
  readonly typeID: number | null;
  /** Only the deliveries buckets carry an itemCount column; null otherwise. */
  readonly itemCount: number | null;
}

/** One ITEM row at a location (GetAssetInventoryForLocation). */
export interface CorpAssetItem {
  readonly itemID: number;
  readonly typeID: number;
  readonly ownerID: number;
  readonly locationID: number;
  readonly flagID: number;
  /** The raw wire quantity: -1 for an assembled singleton. Prefer `units`. */
  readonly quantity: number;
  /** Render-safe count: 1 for a singleton, else the stacksize. */
  readonly units: number;
  readonly singleton: boolean;
  readonly groupID: number;
  readonly categoryID: number;
  readonly customInfo: string;
  readonly stacksize: number;
}

/** One matching LOCATION (SearchAssets). */
export interface CorpAssetSearchLocation {
  readonly locationID: number;
}

/**
 * A number from a row field, whatever encoding it arrived in: a plain number,
 * a {type:"long"} wrapper, or a bare decimal string. 0 when absent.
 */
function toNumber(value: JsonValue | undefined): number {
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
 * The rows of the CRowset a corpmgr asset read carries: unwrap the
 * CachedMethodCallResult (substream), then read the objectex2's `list`. `[]` for
 * a non-cached / malformed value or a genuinely empty bucket.
 */
function crowsetRows(result: JsonValue | null | undefined): readonly JsonValue[] {
  const rowset = unwrapCachedResult((result ?? null) as JsonValue);
  if (
    typeof rowset === "object" &&
    rowset !== null &&
    !Array.isArray(rowset) &&
    Array.isArray((rowset as { list?: unknown }).list)
  ) {
    return (rowset as { list: readonly JsonValue[] }).list;
  }
  return [];
}

/**
 * Decode corpmgr.GetAssetInventory -> the corp's asset locations for a bucket.
 * A row with no positive locationID is dropped. `[]` is a real "no corp assets
 * in this bucket" answer (Farmer's corp is sparse in most buckets).
 */
export function decodeCorpAssetLocations(
  result: JsonValue | null | undefined,
): CorpAssetLocation[] {
  const rows: CorpAssetLocation[] = [];
  for (const row of crowsetRows(result)) {
    const locationID = toNumber(readRowField(row, "locationID"));
    if (locationID <= 0) {
      continue;
    }
    const solarSystemID = toNumber(readRowField(row, "solarsystemID"));
    const typeID = toNumber(readRowField(row, "typeID"));
    // itemCount only exists in the deliveries buckets; null when the column is
    // absent so a caller can tell "no such column" from "count is zero".
    const itemCountField = readRowField(row, "itemCount");
    rows.push({
      locationID,
      solarSystemID: solarSystemID > 0 ? solarSystemID : null,
      typeID: typeID > 0 ? typeID : null,
      itemCount: itemCountField === undefined || itemCountField === null ? null : toNumber(itemCountField),
    });
  }
  return rows;
}

/**
 * Decode corpmgr.GetAssetInventoryForLocation -> the items at one location. A row
 * with no positive itemID is dropped. `[]` is a real "nothing here" answer.
 */
export function decodeCorpAssetItems(
  result: JsonValue | null | undefined,
): CorpAssetItem[] {
  const rows: CorpAssetItem[] = [];
  for (const row of crowsetRows(result)) {
    const itemID = toNumber(readRowField(row, "itemID"));
    if (itemID <= 0) {
      continue;
    }
    const singleton = toNumber(readRowField(row, "singleton")) === 1;
    const stacksize = toNumber(readRowField(row, "stacksize"));
    const quantity = toNumber(readRowField(row, "quantity"));
    rows.push({
      itemID,
      typeID: toNumber(readRowField(row, "typeID")),
      ownerID: toNumber(readRowField(row, "ownerID")),
      locationID: toNumber(readRowField(row, "locationID")),
      flagID: toNumber(readRowField(row, "flagID")),
      quantity,
      // ⚠ NOT the raw quantity (which is -1 for an assembled singleton).
      units: singleton ? 1 : Math.max(0, stacksize || quantity || 0),
      singleton,
      groupID: toNumber(readRowField(row, "groupID")),
      categoryID: toNumber(readRowField(row, "categoryID")),
      customInfo: typeof readRowField(row, "customInfo") === "string"
        ? (readRowField(row, "customInfo") as string)
        : "",
      stacksize,
    });
  }
  return rows;
}

/**
 * Decode corpmgr.SearchAssets -> the matching locations (a bare [locationID] per
 * row). A row with no positive locationID is dropped. `[]` is a real "no matches".
 */
export function decodeCorpAssetSearch(
  result: JsonValue | null | undefined,
): CorpAssetSearchLocation[] {
  const rows: CorpAssetSearchLocation[] = [];
  for (const row of crowsetRows(result)) {
    const locationID = toNumber(readRowField(row, "locationID"));
    if (locationID > 0) {
      rows.push({ locationID });
    }
  }
  return rows;
}
