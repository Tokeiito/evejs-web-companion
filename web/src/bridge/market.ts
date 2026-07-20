// Market reads decoded to named order books, and the CLIENT-LOCAL half of the
// market that retail calls `marketQuote` (goal R16).
//
// ⚠ THREE THINGS THIS MODULE EXISTS TO GET RIGHT, each of which fails silently
// if you get it wrong:
//
// 1. THE SERVICE IS `marketProxy`, NOT `market`. EveJS registers two market
//    services. `market` is a DEAD STUB — every method answers an empty rowset.
//    `marketProxy` is the real one. Nothing in the browser names a service
//    (the BFF does), but the trap is recorded here because a "silently empty
//    market page" is the symptom and this is the file you would come to first.
//
// 2. `marketQuote` IS CLIENT-LOCAL AND HAS NO SERVER HANDLER. In retail,
//    sorting an order book, filtering it by jump distance, deciding which bid
//    is the best one, and knowing how many orders a character may keep open all
//    live in the CLIENT. There is nothing to call. Everything under
//    "marketQuote, client-side" below is that logic, reimplemented here.
//
// 3. THE ORDER BOOK ARRIVES INSIDE A CACHED ENVELOPE. GetOrders / GetCharOrders
//    / GetMarketOrderHistory answer a retail `CachedMethodCallResult`; the real
//    payload rides `args[1]` as `{type:"substream", value:…}`. Reading the
//    envelope as a rowset finds nothing. (Unlike map.GetStationInfo in R2,
//    whose payload is a cached-OBJECT reference that genuinely cannot be
//    decoded — this one can, once unwrapped.)
//
// THE ID BOUNDARY (R7d). Every identifier the market speaks in — the typeID of
// the item, the stationID an order sits at, the solarSystemID, the orderID
// itself — is a number on the wire and a NAME (or a hidden handle) past this
// module. An orderID is never rendered: an order is identified to the player by
// what it is for, where it is, and at what price.
//
// MONEY (R7d). Prices are decimal strings end to end. ISK amounts in EveJS
// routinely exceed 2^53, so a balance is never a JS number in rendered text;
// the panel formats the decimal string itself.

import { isListValue, readKeyVal, unwrapLong, type JsonValue } from "./wire.ts";
import type {
  MarketEscrow,
  MarketOrderRow,
  MarketOwnFillState,
  MarketOwnOrderRow,
  MarketPriceHistoryRow,
  MarketSide,
  MarketTransactionRow,
} from "../store/types.ts";

// --- Envelope + rowset plumbing --------------------------------------------

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenText(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value) && typeof value.value === "string") {
    return value.value;
  }
  return "";
}

/**
 * Unwrap the retail cached envelope, if that is what arrived.
 *
 * ⚠ TRAP 3. `args[1]` is the payload. A caller that treats the envelope itself
 * as a rowset reads zero rows and shows an empty market.
 */
export function unwrapCachedResult(result: JsonValue): JsonValue {
  if (!isRecord(result) || result.type !== "object") {
    return result;
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
    return carrier.value ?? null;
  }
  // A cached-OBJECT reference: the payload lives in the retail object cache and
  // the browser genuinely cannot decode it. Answer null rather than pretending.
  return null;
}

function rowsetEntries(rowset: JsonValue): Map<string, JsonValue> {
  const map = new Map<string, JsonValue>();
  if (!isRecord(rowset) || rowset.type !== "object") {
    return map;
  }
  const args = rowset.args;
  if (!isRecord(args) || !Array.isArray(args.entries)) {
    return map;
  }
  for (const entry of args.entries as readonly JsonValue[]) {
    if (Array.isArray(entry) && entry.length >= 2) {
      map.set(tokenText(entry[0]), entry[1] ?? null);
    }
  }
  return map;
}

function rowsetColumns(rowset: JsonValue): readonly string[] {
  const columns = rowsetEntries(rowset).get("columns");
  if (!isListValue(columns)) {
    return [];
  }
  return columns.items.map((column) => tokenText(column));
}

function rowsetLines(rowset: JsonValue): readonly JsonValue[] {
  const lines = rowsetEntries(rowset).get("lines");
  return isListValue(lines) ? lines.items : [];
}

/**
 * One rowset line as a {column: value} record.
 *
 * ⚠ The two market rowsets use DIFFERENT row classes: the order book is
 * `blue.DBRow` (a line is a bare JSON array) and the owner-orders rowset is
 * `util.Row` (a line is a `{type:"list"}` wrapper). Both are handled, because a
 * decoder that assumes one shape silently reads zero rows of the other.
 */
function lineCells(line: JsonValue): readonly JsonValue[] {
  if (Array.isArray(line)) {
    return line;
  }
  return isListValue(line) ? line.items : [];
}

function rowRecords(rowset: JsonValue): readonly Readonly<Record<string, JsonValue>>[] {
  const columns = rowsetColumns(rowset);
  if (columns.length === 0) {
    return [];
  }
  return rowsetLines(rowset).map((line) => {
    const cells = lineCells(line);
    const record: Record<string, JsonValue> = {};
    columns.forEach((column, index) => {
      record[column] = cells[index] ?? null;
    });
    return record;
  });
}

function toNumber(value: JsonValue | undefined): number {
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

/**
 * An amount as a bigint-safe DECIMAL STRING. ISK in EveJS exceeds 2^53 in
 * ordinary play, so a balance never becomes a JS number on its way to the
 * screen (R7d: "ISK as decimal strings, never raw longs").
 */
export function toAmountString(value: JsonValue | undefined): string | null {
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

/** A FILETIME instant, kept as a bigint (it exceeds 2^53); null when absent. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long = unwrapLong(value);
  if (long !== null && long > 0n) {
    return long;
  }
  return null;
}

// --- Order book (marketProxy.GetOrders) -------------------------------------

/**
 * Decode `GetOrders(typeID)` — the 2-TUPLE `[sellsRowset, buysRowset]`.
 *
 * ⚠ ORDER MATTERS AND IS NOT SYMMETRIC. `[0]` is sells (what you can BUY from),
 * `[1]` is buys (what you can SELL to). Transposing them is not a cosmetic bug:
 * it shows a player the wrong prices for the direction they are trading in.
 * Every row already carries `bid`, so the tuple position is cross-checked
 * against it rather than trusted.
 */
export function decodeOrderBook(result: JsonValue): {
  readonly sells: readonly MarketOrderRow[];
  readonly buys: readonly MarketOrderRow[];
} {
  const payload = unwrapCachedResult(result);
  const tuple = Array.isArray(payload) ? (payload as readonly JsonValue[]) : [];
  return {
    sells: decodeOrderRows(tuple[0] ?? null, "sell"),
    buys: decodeOrderRows(tuple[1] ?? null, "buy"),
  };
}

function decodeOrderRows(rowset: JsonValue, expected: MarketSide): readonly MarketOrderRow[] {
  const rows: MarketOrderRow[] = [];
  for (const record of rowRecords(rowset)) {
    const orderID = toAmountString(record.orderID);
    if (orderID === null || orderID === "0") {
      continue;
    }
    // The row's own `bid` flag is authoritative; the tuple position is only a
    // hint. A row that disagrees with its half is dropped rather than rendered
    // on the wrong side of the book.
    const side: MarketSide = toNumber(record.bid) === 1 ? "buy" : "sell";
    if (side !== expected) {
      continue;
    }
    rows.push({
      orderID,
      side,
      typeID: toNumber(record.typeID),
      stationID: toNumber(record.stationID),
      solarSystemID: toNumber(record.solarSystemID),
      regionID: toNumber(record.regionID),
      price: toAmountString(record.price) ?? "0",
      volumeRemaining: toNumber(record.volRemaining),
      volumeEntered: toNumber(record.volEntered),
      minimumVolume: toNumber(record.minVolume),
      // How far this order REACHES, in jumps. -1 means "this station only",
      // 32767 means "anywhere in the region" — decoded to words, never shown
      // as either number.
      range: toNumber(record.range),
      // How far AWAY the order is from where the player is standing. The
      // SERVER computed this from the session's own position; the browser
      // never works out a distance itself.
      jumps: toNumber(record.jumps),
      durationDays: toNumber(record.duration),
      issuedAt: toFiletime(record.issueDate),
    });
  }
  return rows;
}

// --- The player's own orders (marketProxy.GetCharOrders / …OrderHistory) ----

/** orderState code -> what actually became of the order. */
const FILL_STATE_BY_CODE: Readonly<Record<number, MarketOwnFillState>> = {
  0: "open",
  1: "filled",
  2: "expired",
  3: "cancelled",
};

/** Player-facing wording for an order's fate (R9a: plain, not a code). */
export const FILL_STATE_LABELS: Readonly<Record<MarketOwnFillState, string>> = {
  open: "Still open",
  filled: "Completed",
  expired: "Ran out of time",
  cancelled: "You cancelled it",
};

export function decodeOwnOrders(result: JsonValue): readonly MarketOwnOrderRow[] {
  const rows: MarketOwnOrderRow[] = [];
  for (const record of rowRecords(unwrapCachedResult(result))) {
    const orderID = toAmountString(record.orderID);
    if (orderID === null || orderID === "0") {
      continue;
    }
    const stateCode = toNumber(record.orderState);
    rows.push({
      orderID,
      side: toNumber(record.bid) === 1 ? "buy" : "sell",
      typeID: toNumber(record.typeID),
      stationID: toNumber(record.stationID),
      solarSystemID: toNumber(record.solarSystemID),
      price: toAmountString(record.price) ?? "0",
      volumeRemaining: toNumber(record.volRemaining),
      volumeEntered: toNumber(record.volEntered),
      minimumVolume: toNumber(record.minVolume),
      range: toNumber(record.range),
      durationDays: toNumber(record.duration),
      // ISK locked behind a buy order. The SERVER computed it; the panel never
      // multiplies price by volume to guess at it.
      escrow: toAmountString(record.escrow) ?? "0",
      state: FILL_STATE_BY_CODE[stateCode] ?? "open",
      issuedAt: toFiletime(record.issueDate),
      // Corp orders are out of scope; a row flagged corp is kept and labelled
      // rather than hidden, so a player is never shown a partial picture.
      isCorp: toNumber(record.isCorp) === 1,
    });
  }
  return rows;
}

// --- Transactions (marketProxy.CharGetTransactions) -------------------------

/**
 * Decode the transaction list — a plain `list<util.KeyVal>`, NOT a rowset and
 * NOT cached.
 *
 * ⚠ WHICH SIDE A TRADE WAS. There is no "isBuy" column. A transaction names a
 * buyerID and a sellerID, and the character is one of them; the direction is
 * derived by comparing against the character's own id, which is why
 * `decodeTransactions` takes it. Guessing from the sign of anything would be
 * wrong.
 */
export function decodeTransactions(
  result: JsonValue,
  characterID: number,
): readonly MarketTransactionRow[] {
  if (!isListValue(result)) {
    return [];
  }
  const rows: MarketTransactionRow[] = [];
  for (const entry of result.items) {
    const typeID = toNumber(readKeyVal(entry, "typeID"));
    if (typeID <= 0) {
      continue;
    }
    const buyerID = toNumber(readKeyVal(entry, "buyerID"));
    const sellerID = toNumber(readKeyVal(entry, "sellerID"));
    rows.push({
      transactionID: toAmountString(readKeyVal(entry, "transactionID")) ?? "0",
      typeID,
      quantity: toNumber(readKeyVal(entry, "quantity")),
      price: toAmountString(readKeyVal(entry, "price")) ?? "0",
      stationID: toNumber(readKeyVal(entry, "stationID")),
      // "bought" when the character was the BUYER. A row where the character is
      // neither party should not exist, and decodes as null rather than a
      // default that would mislabel it.
      side: buyerID === characterID ? "bought" : sellerID === characterID ? "sold" : null,
      transactedAt: toFiletime(readKeyVal(entry, "transactionDate")),
    });
  }
  return rows;
}

// --- Escrow (marketProxy.GetCharEscrow) -------------------------------------

export function decodeEscrow(result: JsonValue): MarketEscrow {
  return {
    isk: toAmountString(readKeyVal(result, "iskEscrow")) ?? "0",
    items: toNumber(readKeyVal(result, "itemsEscrow")),
  };
}

// --- Price history ----------------------------------------------------------

export function decodePriceHistory(result: JsonValue): readonly MarketPriceHistoryRow[] {
  const rows: MarketPriceHistoryRow[] = [];
  for (const record of rowRecords(unwrapCachedResult(result))) {
    rows.push({
      day: toFiletime(record.historyDate),
      low: toAmountString(record.lowPrice) ?? "0",
      high: toAmountString(record.highPrice) ?? "0",
      average: toAmountString(record.avgPrice) ?? "0",
      volume: toNumber(record.volume),
      orders: toNumber(record.orders),
    });
  }
  return rows;
}

// =============================================================================
// marketQuote, client-side
// =============================================================================
// Everything below is the half of the market retail implements in the CLIENT.
// There is no server call for any of it — see trap 2 at the top of this file.

/** The range sentinels the server speaks in. Never rendered as numbers. */
export const RANGE_STATION = -1;
export const RANGE_SOLAR_SYSTEM = 0;
export const RANGE_REGION = 32767;

/**
 * How far an order reaches, in words (R7d/R9a). `range` is a jump count with
 * two sentinel values at the ends, and printing either of them raw ("-1
 * jumps", "32767 jumps") would be nonsense.
 */
export function rangeLabel(range: number): string {
  if (range === RANGE_STATION) {
    return "This station only";
  }
  if (range === RANGE_SOLAR_SYSTEM) {
    return "This system only";
  }
  if (range === RANGE_REGION) {
    return "Anywhere in the region";
  }
  if (range === 1) {
    return "Up to 1 jump away";
  }
  return `Up to ${range} jumps away`;
}

/** How far away an order is, in words. */
export function distanceLabel(jumps: number): string {
  if (jumps <= 0) {
    return "Where you are";
  }
  return jumps === 1 ? "1 jump away" : `${jumps} jumps away`;
}

/** The order durations the server accepts, as the player picks them. */
export const DURATION_CHOICES: readonly { readonly days: number; readonly label: string }[] = [
  { days: 0, label: "Fill it right now or not at all" },
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
];

/**
 * Compare two prices held as decimal STRINGS, without going through a JS
 * number. ISK exceeds 2^53, so `Number(a) - Number(b)` can compare two
 * different prices as equal. Returns <0, 0 or >0 like a comparator.
 */
export function comparePrice(left: string, right: string): number {
  const parse = (text: string): { neg: boolean; whole: string; frac: string } => {
    const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
    if (!match) {
      return { neg: false, whole: "0", frac: "" };
    }
    return { neg: match[1] === "-", whole: match[2] || "0", frac: match[3] ?? "" };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.neg !== b.neg) {
    return a.neg ? -1 : 1;
  }
  const sign = a.neg ? -1 : 1;
  const aWhole = a.whole.replace(/^0+(?=\d)/, "");
  const bWhole = b.whole.replace(/^0+(?=\d)/, "");
  if (aWhole.length !== bWhole.length) {
    return aWhole.length < bWhole.length ? -sign : sign;
  }
  if (aWhole !== bWhole) {
    return aWhole < bWhole ? -sign : sign;
  }
  const width = Math.max(a.frac.length, b.frac.length);
  const aFrac = a.frac.padEnd(width, "0");
  const bFrac = b.frac.padEnd(width, "0");
  if (aFrac === bFrac) {
    return 0;
  }
  return aFrac < bFrac ? -sign : sign;
}

/**
 * Sort an order book the way a market window does: SELLS cheapest first (the
 * best thing to buy is at the top), BUYS highest first (the best thing to sell
 * into is at the top). Ties break on distance, so of two equally-priced orders
 * the nearer one is preferred — which is what a player would pick.
 *
 * Pure and non-mutating: the caller's array is never reordered in place.
 */
export function sortOrderBook(
  rows: readonly MarketOrderRow[],
  side: MarketSide,
): readonly MarketOrderRow[] {
  return [...rows].sort((left, right) => {
    const byPrice = comparePrice(left.price, right.price);
    if (byPrice !== 0) {
      return side === "sell" ? byPrice : -byPrice;
    }
    return left.jumps - right.jumps;
  });
}

/**
 * Keep only the orders within `maxJumps` of where the player is.
 *
 * A negative or non-finite limit means "no limit" — a filter that silently
 * hid every order would look exactly like an empty market.
 */
export function filterByJumps(
  rows: readonly MarketOrderRow[],
  maxJumps: number,
): readonly MarketOrderRow[] {
  if (!Number.isFinite(maxJumps) || maxJumps < 0) {
    return rows;
  }
  return rows.filter((row) => row.jumps <= maxJumps);
}

/**
 * The best price on each side: the cheapest sell and the highest buy.
 *
 * ⚠ THIS IS A READING OF THE BOOK, NOT A QUOTE. It says what is on offer right
 * now, in this region, as of the last read. It is not a promise about what a
 * trade will cost — the server matches orders itself, and it is authoritative.
 */
export function bestPrices(book: {
  readonly sells: readonly MarketOrderRow[];
  readonly buys: readonly MarketOrderRow[];
}): { readonly bestSell: string | null; readonly bestBuy: string | null } {
  const sells = sortOrderBook(book.sells, "sell");
  const buys = sortOrderBook(book.buys, "buy");
  return {
    bestSell: sells[0]?.price ?? null,
    bestBuy: buys[0]?.price ?? null,
  };
}

// --- Client-side guards the retail client enforces BEFORE dispatch ----------

/**
 * The server's own ceiling on an order price (marketRules.MARKET_MAX_ORDER_PRICE
 * = 9_223_372_036_854.0 — the ISK value at which the underlying signed 64-bit
 * scaled representation overflows). Retail rejects a price above it in the
 * client rather than sending it, and so do we: a rejection here is a clear
 * message, where a rejection there is an opaque refusal.
 */
export const MAX_ORDER_PRICE = 9_223_372_036_854;

/**
 * Round a price to 2 decimal places, exactly as the server's `roundIsk` does
 * (`Math.round(value * 100) / 100`).
 *
 * ⚠ WHY THE CLIENT ROUNDS TOO. The server rounds whatever it is sent, so an
 * unrounded price is not rejected — it is silently CHANGED. Rounding here means
 * the number in the confirm dialog is the number that gets used, instead of the
 * player agreeing to 5.555 and getting 5.56.
 */
export function roundPrice(price: number): number {
  if (!Number.isFinite(price)) {
    return 0;
  }
  return Math.round(price * 100) / 100;
}

export interface PriceCheck {
  readonly ok: boolean;
  /** The rounded price actually to be sent; 0 when the check failed. */
  readonly price: number;
  /** Plain-language reason, when the check failed. */
  readonly message: string | null;
}

/** The guards retail applies before it will even send an order. */
export function checkPrice(raw: number): PriceCheck {
  if (!Number.isFinite(raw) || raw <= 0) {
    return { ok: false, price: 0, message: "Enter a price above zero." };
  }
  const price = roundPrice(raw);
  if (price > MAX_ORDER_PRICE) {
    return {
      ok: false,
      price: 0,
      message: "That price is higher than the market allows. Try a smaller number.",
    };
  }
  if (price <= 0) {
    return {
      ok: false,
      price: 0,
      message: "That price rounds down to nothing. Enter at least 0.01 ISK.",
    };
  }
  return { ok: true, price, message: null };
}

export function checkQuantity(raw: number): { readonly ok: boolean; readonly message: string | null } {
  if (!Number.isSafeInteger(raw) || raw <= 0) {
    return { ok: false, message: "Enter how many you want, as a whole number above zero." };
  }
  return { ok: true, message: null };
}

// --- The broker's fee: an ESTIMATE, and labelled as one ---------------------

/**
 * The standard broker's commission before any of the things that change it.
 * (marketRules.MARKET_BROKER_COMMISSION_PERCENT = 3.0.)
 */
export const STANDARD_BROKER_RATE = 0.03;
/** The server's floor on a broker fee (marketRules.MARKET_MINIMUM_BROKER_FEE). */
export const MINIMUM_BROKER_FEE = 100;

export interface BrokerFeeEstimate {
  /** The estimated fee in ISK, as a decimal string. */
  readonly amount: string;
  /** True when the estimate is the server's floor rather than a percentage. */
  readonly atMinimum: boolean;
  /** The rate the estimate assumed, as a fraction. */
  readonly rate: number;
}

/**
 * ⚠ AN ESTIMATE. NOT THE COST. Read this before using the number.
 *
 * The broker's fee the server actually charges is
 *   3% - (Broker Relations level x 0.3%) - (faction standing x 0.03%)
 *        - (corporation standing x 0.02%)
 * with a floor of 100 ISK, and at a player-owned structure it is whatever that
 * structure's owner set instead. NONE of those inputs is reachable from the
 * browser: no allowlisted read answers the character's Broker Relations level
 * or their standings toward this station's owner. So this function computes the
 * fee at the STANDARD 3% rate and nothing more.
 *
 * What that means in practice, and what the panel must say:
 *  - trained skills and good standings make the real fee LOWER than this;
 *  - poor standings can make it slightly HIGHER (up to about 3.5%);
 *  - a player-owned structure can set it anywhere.
 *
 * So this is never presented as the cost. It is labelled an estimate, and the
 * ACTUAL charge is reported afterwards by re-reading the wallet — the only
 * authoritative source there is.
 */
export function estimateBrokerFee(price: number, quantity: number): BrokerFeeEstimate {
  const value = roundPrice(price) * Math.max(0, Math.trunc(quantity));
  const raw = roundPrice(value * STANDARD_BROKER_RATE);
  const atMinimum = raw <= MINIMUM_BROKER_FEE;
  return {
    amount: formatIskNumber(atMinimum ? MINIMUM_BROKER_FEE : raw),
    atMinimum,
    rate: STANDARD_BROKER_RATE,
  };
}

// --- Money formatting -------------------------------------------------------

/**
 * Format an ISK amount held as a DECIMAL STRING, with thousands separators and
 * exactly two decimal places — never via a JS number, so a balance beyond 2^53
 * is not rounded on its way to the screen (R7d).
 */
export function formatIsk(amount: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") {
    return "—";
  }
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(String(amount).trim());
  if (!match) {
    return "—";
  }
  const sign = match[1];
  const whole = (match[2] || "0").replace(/^0+(?=\d)/, "");
  const frac = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${frac} ISK`;
}

/** A JS number as the decimal string the rest of this module works in. */
export function formatIskNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toFixed(2);
}

/**
 * The difference between two ISK balances held as decimal strings, as a decimal
 * string. This is how the ACTUAL cost of an order is worked out: wallet before
 * minus wallet after. Exact — it goes through BigInt hundredths, not floats.
 */
export function iskDelta(before: string | null, after: string | null): string | null {
  if (before === null || after === null) {
    return null;
  }
  const toHundredths = (text: string): bigint | null => {
    const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
    if (!match) {
      return null;
    }
    const frac = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
    const value = BigInt(`${match[2] || "0"}${frac}`);
    return match[1] === "-" ? -value : value;
  };
  const left = toHundredths(before);
  const right = toHundredths(after);
  if (left === null || right === null) {
    return null;
  }
  const diff = left - right;
  const negative = diff < 0n;
  const magnitude = negative ? -diff : diff;
  const whole = magnitude / 100n;
  const frac = (magnitude % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

// --- Refusals ---------------------------------------------------------------

/**
 * Plain-language sentences for the refusals the market raises.
 *
 * These are NOT invented causes. Every key is an error name the SERVER chose;
 * turning it into a sentence is presentation, exactly as the industry panel
 * does. A refusal with no entry here is passed through as the server worded it,
 * and a refusal with no wording at all is reported as exactly that — no reason
 * is ever invented.
 */
const REFUSAL_SENTENCES: Readonly<Record<string, string>> = {
  MktBrokersFeeUnexpected2:
    "The broker's fee here is not what you were shown, so the order was not placed. Open the order again to see the current fee.",
  MktOrderDidNotMatch: "Nothing on the market matched that order at that price.",
  MktNotEnoughMoney: "You do not have enough ISK for that order and its fees.",
  MktInvalidPrice: "That price is not one the market will accept.",
  MktInvalidQuantity: "That quantity is not one the market will accept.",
  MktOrderLimitReached: "You already have as many orders open as your trade skills allow.",
  MktOrderDoesNotExist: "That order no longer exists.",
  MktNotYourOrder: "That order does not belong to you.",
  MarketUnavailable:
    "The market is not answering right now, so nothing was changed. Try again in a moment.",
};

/** Turn a bridge refusal into something a player can read. */
export function marketRefusalMessage(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  if (!raw) {
    return "The server did not apply that change, and gave no reason.";
  }
  for (const [name, sentence] of Object.entries(REFUSAL_SENTENCES)) {
    if (raw.includes(name)) {
      return sentence;
    }
  }
  // The handler's OWN sentence ("No matching sell orders were available at the
  // requested price."). Never reworded.
  return raw;
}
