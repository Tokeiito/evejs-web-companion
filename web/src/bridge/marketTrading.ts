// R62 — decoding the market CORP-ORDERS + PLEX reads (PLUMBING ONLY — no UI).
//
// The corp-orders and PLEX reads the R16 market panel deliberately left out.
// GET /api/bridge/market-trading returns seven raw retail-shaped marketProxy
// results, captured live from Farmer (char 140000005, corp 98000001, region
// 10000002) on 2026-07-22. Every read is session-scoped server-side (corpid /
// regionid), so none can be pointed at another owner, corp or region.
//
// ⚠ THREE OF THE SEVEN REUSE R16's OWN DECODERS, because the server builds them
// with the SAME helpers as their char-side siblings:
//   • GetCorporationOrders  == GetCharOrders shape  -> `decodeOwnOrders`
//   • GetPlexOrders         == GetOrders shape      -> `decodeOrderBook`
//   • CorpGetTransactions   == CharGetTransactions shape, BUT WRAPPED IN A
//     CachedMethodCallResult (the char read is a BARE list) -> unwrap, then
//     `decodeTransactions`.
// Reusing them is deliberate: the corp/PLEX order book is byte-for-byte the
// char/regional one, and a second copy would drift. The order/owner-order
// FILETIMEs arrive as {type:"long"} wrappers (buildFiletimeLong), which those
// decoders already handle.
//
// ⚠ PLEX HISTORY DATES ARRIVE AS BARE DECIMAL STRINGS, NOT {type:"long"}. The
// server builds historyDate as a bare BigInt (normalizeBigInt, not
// buildFiletimeLong), and the gateway renders a BigInt as a plain decimal
// string. R16's `decodePriceHistory` reads the date through `unwrapLong`, which
// REJECTS a bare string and silently nulls every day — so this module does NOT
// reuse it; `decodePlexPriceHistory` below reads the date on a string-tolerant
// path instead. (The same latent nulling affects R16's own GetOldPriceHistory /
// GetNewPriceHistory; fixing that is the market panel's call, out of this
// plumbing scope — flagged, not touched.)
//
// R7d: every id (orderID / typeID / stationID / solarSystemID / regionID) is
// kept as a numeric field (or a bigint-safe string for orderID / ISK) for a
// future UI to resolve or render; none is forced into a label, none is lost.
// Empty (no corp orders, no PLEX orders/history) is a legitimate state.

import {
  decodeOrderBook,
  decodeOwnOrders,
  decodeTransactions,
  unwrapCachedResult,
} from "./market.ts";
import type {
  MarketOrderRow,
  MarketOwnOrderRow,
  MarketPriceHistoryRow,
  MarketTransactionRow,
} from "../store/types.ts";
import {
  isListValue,
  readDictPairs,
  readKeyVal,
  readRowsetRows,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

// --- Reused R16 decoders, named for the corp/PLEX reads they serve ----------

/**
 * marketProxy.GetCorporationOrders() -> the SESSION corp's open market orders.
 * CachedMethodCallResult wrapping the owner-orders Rowset (util.Row over
 * OWNER_ORDER_HEADER) — identical to GetCharOrders, so `decodeOwnOrders` reads
 * it. Rows carry `isCorp: true`. `[]` for a corp with no open orders.
 */
export function decodeCorporationOrders(result: JsonValue): readonly MarketOwnOrderRow[] {
  return decodeOwnOrders(result);
}

/**
 * marketProxy.GetPlexOrders() -> the PLEX order book in the SESSION region.
 * CachedMethodCallResult wrapping the 2-tuple [sellsRowset, buysRowset] of
 * blue.DBRow rows — identical to GetOrders, so `decodeOrderBook` reads it.
 */
export function decodePlexOrders(result: JsonValue): {
  readonly sells: readonly MarketOrderRow[];
  readonly buys: readonly MarketOrderRow[];
} {
  return decodeOrderBook(result);
}

/**
 * marketProxy.CorpGetTransactions(fromDate, accountKey) -> the SESSION corp's
 * completed trades. ⚠ WRAPPED IN A CachedMethodCallResult (unlike the char read,
 * which is a bare list) — unwrap the substream first, then `decodeTransactions`.
 * `ownerID` (the corp id) derives each trade's bought/sold side by comparing it
 * against the row's buyerID / sellerID. `[]` for a corp with no trades.
 */
export function decodeCorpTransactions(
  result: JsonValue,
  ownerID: number,
): readonly MarketTransactionRow[] {
  return decodeTransactions(unwrapCachedResult(result), ownerID);
}

// --- PLEX best ask ----------------------------------------------------------

/** The best PLEX ask near the player, per typeID (marketProxy.GetPlexBest). */
export interface PlexBestRow {
  readonly typeID: number;
  /** ISK per unit, as a decimal string (bigint-safe). */
  readonly price: string;
  /** Total volume available at the best ask. */
  readonly volumeRemaining: number;
  /** Where the best ask sits — a name past this module (R7d), never a number. */
  readonly stationID: number;
}

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

/** An ISK amount as a bigint-safe DECIMAL STRING; null when absent/malformed. */
function toAmount(value: JsonValue | undefined): string | null {
  const long = unwrapLong(value);
  if (long !== null) {
    return long.toString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  return null;
}

/**
 * A FILETIME instant, kept as a bigint; null when absent or zero.
 *
 * ⚠ TOLERANT OF A BARE DECIMAL STRING as well as a {type:"long"} wrapper and a
 * bare integer — the history dates arrive as bare strings (see the header note).
 */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value)
      ? BigInt(value)
      : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/**
 * Decode marketProxy.GetPlexBest() -> the best PLEX ask per typeID. The payload
 * is a CachedMethodCallResult wrapping a dict keyed by typeID -> util.KeyVal
 * {price, volRemaining, typeID, stationID}. `[]` for a region with no PLEX asks.
 */
export function decodePlexBest(result: JsonValue): readonly PlexBestRow[] {
  const dict = unwrapCachedResult(result);
  const rows: PlexBestRow[] = [];
  for (const [key, value] of readDictPairs(dict)) {
    // The typeID is the dict KEY (a JSON number on the wire); the KeyVal repeats
    // it, but the key is authoritative.
    const typeID = toNumber(key as JsonValue) || toNumber(readKeyVal(value, "typeID"));
    if (typeID <= 0) {
      continue;
    }
    rows.push({
      typeID,
      price: toAmount(readKeyVal(value, "price")) ?? "0",
      volumeRemaining: toNumber(readKeyVal(value, "volRemaining")),
      stationID: toNumber(readKeyVal(value, "stationID")),
    });
  }
  return rows;
}

// --- PLEX price history -----------------------------------------------------

/**
 * Decode ONE history Rowset (blue.DBRow over historyDate/lowPrice/highPrice/
 * avgPrice/volume/orders) into day rows. Serves GetPlexOldPriceHistory and
 * GetPlexNewPriceHistory (each a bare Rowset, not cached). The date is read on
 * the string-tolerant path; prices stay decimal strings (bigint-safe).
 */
export function decodePlexPriceHistory(rowset: JsonValue): readonly MarketPriceHistoryRow[] {
  const rows: MarketPriceHistoryRow[] = [];
  for (const record of readRowsetRows(rowset)) {
    rows.push({
      day: toFiletime(record.historyDate),
      low: toAmount(record.lowPrice) ?? "0",
      high: toAmount(record.highPrice) ?? "0",
      average: toAmount(record.avgPrice) ?? "0",
      volume: toNumber(record.volume),
      orders: toNumber(record.orders),
    });
  }
  return rows;
}

/** The full split history for one type (marketProxy.GetPlexHistory). */
export interface PlexHistoryForType {
  readonly typeID: number;
  /** All but the latest day (the "old" half retail graphs). */
  readonly old: readonly MarketPriceHistoryRow[];
  /** The latest day (the "new" half). */
  readonly recent: readonly MarketPriceHistoryRow[];
}

/**
 * Decode marketProxy.GetPlexHistory() -> a plain dict (NOT cached) keyed by
 * typeID -> [oldHistoryRowset, newHistoryRowset]. `[]` for no history.
 */
export function decodePlexHistory(result: JsonValue): readonly PlexHistoryForType[] {
  const out: PlexHistoryForType[] = [];
  for (const [key, pair] of readDictPairs(result)) {
    const typeID = toNumber(key as JsonValue);
    if (typeID <= 0) {
      continue;
    }
    const parts = isListValue(pair)
      ? (pair.items as readonly JsonValue[])
      : Array.isArray(pair)
        ? (pair as readonly JsonValue[])
        : [];
    out.push({
      typeID,
      old: decodePlexPriceHistory(parts[0] ?? null),
      recent: decodePlexPriceHistory(parts[1] ?? null),
    });
  }
  return out;
}
