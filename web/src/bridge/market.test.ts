// R16 market decoders and the CLIENT-LOCAL half of the market (`marketQuote`).
//
// Two kinds of test live here, and they are testing different risks:
//
//  - DECODERS. Every market read arrives in a shape that yields NOTHING when
//    read the obvious way: the order book is wrapped in a cached envelope, the
//    two halves of the tuple must not be transposed, and the two rowsets use
//    different row classes. Each of those is pinned by a test that fails if the
//    obvious mistake is made.
//
//  - MONEY. ISK exceeds 2^53 in ordinary play, so everything monetary goes
//    through decimal strings. The comparison, the formatting and the
//    before/after difference are all tested at magnitudes where a JS number
//    would silently lose precision — because that is the failure that would
//    otherwise reach a player as a wrong price.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ORDER_PRICE,
  MINIMUM_BROKER_FEE,
  STANDARD_BROKER_RATE,
  bestPrices,
  checkPrice,
  checkQuantity,
  comparePrice,
  decodeEscrow,
  decodeOrderBook,
  decodeOwnOrders,
  decodePriceHistory,
  decodeTransactions,
  distanceLabel,
  brokerFeeWords,
  estimateBrokerFee,
  historyDayText,
  joinPriceHistory,
  filterByJumps,
  formatIsk,
  iskDelta,
  marketRefusalMessage,
  rangeLabel,
  roundPrice,
  sortOrderBook,
  unwrapCachedResult,
} from "./market.ts";
import type { JsonValue } from "./wire.ts";

const CHARACTER_ID = 140000003;
const TYPE_ID = 34;
const STATION_ID = 60003760;
const SOLAR_SYSTEM_ID = 30000142;

// --- Fixtures in the SERVER's own encodings ---------------------------------

function long(value: string): JsonValue {
  return { type: "long", value } as unknown as JsonValue;
}

function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items } as unknown as JsonValue;
}

function keyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  } as unknown as JsonValue;
}

/** The retail cached envelope, INLINE form (payload in args[1] as a substream). */
function cached(payload: JsonValue): JsonValue {
  return {
    type: "object",
    name: { value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [null, { type: "substream", value: payload }, null],
  } as unknown as JsonValue;
}

const ORDER_COLUMNS = [
  "price",
  "volRemaining",
  "typeID",
  "range",
  "orderID",
  "volEntered",
  "minVolume",
  "bid",
  "issueDate",
  "duration",
  "stationID",
  "regionID",
  "solarSystemID",
  "constellationID",
  "jumps",
];

/** A blue.DBRow order rowset: `lines` are BARE ARRAYS. */
function orderRowset(rows: readonly (readonly JsonValue[])[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", null],
        ["columns", list(ORDER_COLUMNS as unknown as readonly JsonValue[])],
        ["RowClass", { type: "token", value: "blue.DBRow" }],
        ["lines", { type: "list", items: rows }],
      ],
    },
  } as unknown as JsonValue;
}

function orderLine(overrides: Partial<Record<string, JsonValue>> = {}): readonly JsonValue[] {
  const fields: Record<string, JsonValue> = {
    price: 5.51,
    volRemaining: 1200,
    typeID: TYPE_ID,
    range: 0,
    orderID: long("8000000001"),
    volEntered: 2000,
    minVolume: 1,
    bid: 0,
    issueDate: long("133000000000000000"),
    duration: 30,
    stationID: STATION_ID,
    regionID: 10000002,
    solarSystemID: SOLAR_SYSTEM_ID,
    constellationID: 20000020,
    jumps: 0,
    ...overrides,
  };
  return ORDER_COLUMNS.map((column) => fields[column] ?? null);
}

const OWN_ORDER_COLUMNS = [
  "orderID",
  "typeID",
  "charID",
  "regionID",
  "stationID",
  "range",
  "bid",
  "price",
  "volEntered",
  "volRemaining",
  "issueDate",
  "minVolume",
  "contraband",
  "duration",
  "isCorp",
  "solarSystemID",
  "escrow",
  "constellationID",
  "keyID",
  "orderState",
  "lastStateChange",
];

/** A util.Row owner-order rowset: `lines` are {type:"list"} WRAPPERS. */
function ownOrderRowset(rows: readonly Record<string, JsonValue>[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", list(OWN_ORDER_COLUMNS as unknown as readonly JsonValue[])],
        ["columns", list(OWN_ORDER_COLUMNS as unknown as readonly JsonValue[])],
        ["RowClass", { type: "token", value: "util.Row" }],
        [
          "lines",
          {
            type: "list",
            items: rows.map((row) => ({
              type: "list",
              items: OWN_ORDER_COLUMNS.map((column) => row[column] ?? null),
            })),
          },
        ],
      ],
    },
  } as unknown as JsonValue;
}

function ownOrderFields(overrides: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    orderID: long("8000000101"),
    typeID: TYPE_ID,
    charID: CHARACTER_ID,
    regionID: 10000002,
    stationID: STATION_ID,
    range: 5,
    bid: 1,
    price: 4.9,
    volEntered: 1000,
    volRemaining: 500,
    issueDate: long("133000000000000000"),
    minVolume: 1,
    contraband: 0,
    duration: 30,
    isCorp: 0,
    solarSystemID: SOLAR_SYSTEM_ID,
    escrow: 2450,
    constellationID: 20000020,
    keyID: 1000,
    orderState: 0,
    lastStateChange: null,
    ...overrides,
  };
}

// --- The cached envelope ----------------------------------------------------

test("unwrapCachedResult returns the INLINE payload — the envelope is not the rowset", () => {
  const payload = list([1 as unknown as JsonValue]);
  assert.deepEqual(unwrapCachedResult(cached(payload)), payload);
  // A value that is not an envelope passes straight through.
  assert.deepEqual(unwrapCachedResult(payload), payload);
});

test("a cached-OBJECT reference decodes to null rather than to fabricated rows", () => {
  // The other cached form: the payload lives in the retail object cache, which
  // the browser genuinely cannot read. Answering null is honest; answering an
  // empty book would tell the player nobody is trading.
  const reference = {
    type: "object",
    name: { value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [null, { type: "object", name: "util.CachedObject", args: [] }, null],
  } as unknown as JsonValue;
  assert.equal(unwrapCachedResult(reference), null);
});

// --- The order book ---------------------------------------------------------

test("decodeOrderBook reads the 2-TUPLE: [0] is sells, [1] is buys", () => {
  const book = decodeOrderBook(
    cached([
      orderRowset([orderLine({ bid: 0, price: 5.51 })]),
      orderRowset([orderLine({ bid: 1, price: 4.9, orderID: long("8000000002") })]),
    ] as unknown as JsonValue),
  );
  assert.equal(book.sells.length, 1);
  assert.equal(book.buys.length, 1);
  assert.equal(book.sells[0]?.side, "sell");
  assert.equal(book.sells[0]?.price, "5.51");
  assert.equal(book.buys[0]?.side, "buy");
  assert.equal(book.buys[0]?.price, "4.9");
  // The jumps figure is the SERVER's; the browser never computes a distance.
  assert.equal(book.sells[0]?.jumps, 0);
});

test("a row whose bid flag disagrees with its half is DROPPED, not shown on the wrong side", () => {
  // Transposing the tuple is the plausible bug, and this is what stops it
  // reaching a player as sell prices labelled "wanted".
  const book = decodeOrderBook(
    cached([
      orderRowset([orderLine({ bid: 1 })]),
      orderRowset([orderLine({ bid: 0 })]),
    ] as unknown as JsonValue),
  );
  assert.deepEqual(book.sells, []);
  assert.deepEqual(book.buys, []);
});

test("decodeOrderBook survives an absent book (no item chosen yet)", () => {
  const book = decodeOrderBook(null);
  assert.deepEqual(book.sells, []);
  assert.deepEqual(book.buys, []);
});

test("an orderID beyond 2^53 keeps every digit — it is a string, never a number", () => {
  const huge = "9007199254740993"; // 2^53 + 1: unrepresentable as a JS number.
  const book = decodeOrderBook(
    cached([
      orderRowset([orderLine({ orderID: long(huge) })]),
      orderRowset([]),
    ] as unknown as JsonValue),
  );
  assert.equal(book.sells[0]?.orderID, huge);
});

// --- The player's own orders ------------------------------------------------

test("decodeOwnOrders reads the util.Row rowset (lines are LIST WRAPPERS, not arrays)", () => {
  const rows = decodeOwnOrders(cached(ownOrderRowset([ownOrderFields()])));
  assert.equal(rows.length, 1);
  const order = rows[0];
  assert.equal(order?.side, "buy");
  assert.equal(order?.price, "4.9");
  assert.equal(order?.volumeRemaining, 500);
  assert.equal(order?.escrow, "2450");
  assert.equal(order?.state, "open");
  assert.equal(order?.isCorp, false);
});

test("orderState decodes to what actually became of the order", () => {
  const rows = decodeOwnOrders(
    cached(
      ownOrderRowset([
        ownOrderFields({ orderID: long("1"), orderState: 0 }),
        ownOrderFields({ orderID: long("2"), orderState: 1 }),
        ownOrderFields({ orderID: long("3"), orderState: 2 }),
        ownOrderFields({ orderID: long("4"), orderState: 3 }),
      ]),
    ),
  );
  assert.deepEqual(
    rows.map((row) => row.state),
    ["open", "filled", "expired", "cancelled"],
  );
});

// --- Transactions -----------------------------------------------------------

test("a trade's side is derived from buyer/seller against the character's OWN id", () => {
  const rows = decodeTransactions(
    list([
      keyVal({
        transactionID: 1,
        typeID: TYPE_ID,
        quantity: 100,
        price: 5.5,
        stationID: STATION_ID,
        buyerID: CHARACTER_ID,
        sellerID: 999,
        transactionDate: long("133000000000000000"),
      }),
      keyVal({
        transactionID: 2,
        typeID: TYPE_ID,
        quantity: 50,
        price: 6,
        stationID: STATION_ID,
        buyerID: 999,
        sellerID: CHARACTER_ID,
        transactionDate: long("133000000000000000"),
      }),
    ]),
    CHARACTER_ID,
  );
  assert.deepEqual(
    rows.map((row) => row.side),
    ["bought", "sold"],
  );
});

test("a trade the character was not party to decodes with a NULL side, not a default", () => {
  const rows = decodeTransactions(
    list([
      keyVal({
        transactionID: 3,
        typeID: TYPE_ID,
        quantity: 1,
        price: 1,
        stationID: STATION_ID,
        buyerID: 111,
        sellerID: 222,
        transactionDate: long("133000000000000000"),
      }),
    ]),
    CHARACTER_ID,
  );
  assert.equal(rows[0]?.side, null);
});

// --- Escrow + history -------------------------------------------------------

test("decodeEscrow reads iskEscrow as a decimal string and itemsEscrow as a count", () => {
  const escrow = decodeEscrow(keyVal({ iskEscrow: 2450.5, itemsEscrow: 12 }));
  assert.equal(escrow.isk, "2450.5");
  assert.equal(escrow.items, 12);
});

test("decodePriceHistory reads the day rows", () => {
  const rowset = {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["columns", list(["historyDate", "lowPrice", "highPrice", "avgPrice", "volume", "orders"] as unknown as readonly JsonValue[])],
        ["RowClass", { type: "token", value: "blue.DBRow" }],
        ["lines", { type: "list", items: [[long("133000000000000000"), 5, 6, 5.5, 1000, 12]] }],
      ],
    },
  } as unknown as JsonValue;
  const days = decodePriceHistory(rowset);
  assert.equal(days.length, 1);
  assert.equal(days[0]?.day, 133000000000000000n);
  assert.equal(days[0]?.average, "5.5");
  assert.equal(days[0]?.volume, 1000);
});

// marketsvc.GetHistoryRowList (344): the two halves of a type's history joined. The dates below are whole days;
// DAY is a day of the clock's 100 ns ticks.
const DAY = 864000000000n;
const NOON = 133000000000000000n / DAY * DAY + DAY / 2n;
const MIDNIGHT = NOON - DAY / 2n;
const traded = (daysAgo: number, average: string, volume = 100, orders = 7) => ({ day: MIDNIGHT - BigInt(daysAgo) * DAY, low: "1", high: "9", average, volume, orders });
const carried = (daysAgo: number, price: string) => ({ day: MIDNIGHT - BigInt(daysAgo) * DAY, low: price, high: price, average: price, volume: 2, orders: 2 });

test("a type's history is its old half, the days with no trade filled with the price before them, and then its new half", () => {
  // Days 6, 5 and 3 ago traded; the new half is yesterday's.
  const old = [traded(6, "5"), traded(5, "5.5"), traded(3, "6")];
  const fresh = [traded(1, "7")];
  assert.deepEqual(joinPriceHistory(old, fresh, NOON), [
    traded(6, "5"),
    traded(5, "5.5"),
    // The day between two that traded, at the average before it, with the client's two and two for what was traded.
    carried(4, "5.5"),
    traded(3, "6"),
    // From the last of the old half up to yesterday's midnight.
    carried(2, "6"),
    carried(1, "6"),
    traded(1, "7"),
  ]);
  // The halves are not changed by it.
  assert.equal(old.length, 3);
  assert.equal(fresh.length, 1);
});

test("with no new half the history ends in a row for now at the last price, nothing traded", () => {
  const joined = joinPriceHistory([traded(1, "6")], [], NOON);
  assert.deepEqual(joined, [traded(1, "6"), { day: NOON, low: "6", high: "6", average: "6", volume: 0, orders: 0 }]);
  // Nothing at all: one row for now, at nothing.
  assert.deepEqual(joinPriceHistory([], [], NOON), [{ day: NOON, low: "0", high: "0", average: "0", volume: 0, orders: 0 }]);
});

test("nothing is filled in before the first day of the old half, and a new half alone is the history", () => {
  // The first day is long ago: the client begins counting from now, so no day before it is made up.
  assert.deepEqual(joinPriceHistory([traded(40, "5")], [traded(0, "7")], NOON).slice(0, 2), [traded(40, "5"), carried(39, "5")]);
  assert.equal(joinPriceHistory([traded(40, "5")], [traded(0, "7")], NOON).length, 1 + 39 + 1);
  assert.deepEqual(joinPriceHistory([], [traded(0, "7"), traded(0, "8")], NOON), [traded(0, "7"), traded(0, "8")]);
  // A new half that is older than the days filled in after the old one goes last all the same, as the client has it.
  const stale = joinPriceHistory([traded(5, "5")], [traded(4, "6")], NOON);
  assert.deepEqual(stale.map((row) => [Number((MIDNIGHT - (row.day ?? 0n)) / DAY), row.volume]), [[5, 100], [4, 2], [3, 2], [2, 2], [1, 2], [4, 100]]);
  // A day of the old half that has no date is kept where it stands and counts for nothing.
  assert.deepEqual(joinPriceHistory([traded(3, "5"), { ...traded(0, "9"), day: null }, traded(2, "6")], [traded(0, "7")], NOON).map((row) => row.average), ["5", "9", "6", "6", "7"]);
});

test("a day of the history is named by the game's own calendar, whatever the hour and wherever the reader is", () => {
  // A history's day begins at midnight by the game's clock, which is UTC. Read by a local clock west of it, that
  // midnight is the evening before: every day of the page's history was named a day early.
  const start = historyDayText(MIDNIGHT);
  assert.equal(start, new Date(Number(MIDNIGHT / 10000n - 11644473600000n)).toLocaleDateString(undefined, { timeZone: "UTC" }));
  assert.equal(historyDayText(MIDNIGHT + DAY - 1n), start, "the last tick of the day is the same day");
  assert.notEqual(historyDayText(MIDNIGHT + DAY), start);
  assert.notEqual(historyDayText(MIDNIGHT - 1n), start);
  assert.deepEqual([historyDayText(null), historyDayText(0n)], ["—", "—"]);
});

test("decodePriceHistory reads a day the gateway prints as bare digits", () => {
  // What the gateway really sends for marketProxy.GetNewPriceHistory (parity
  // report, 2026-10-08): the day is a bare string of digits, not {type:"long"}.
  // The game port sends the wrapper. Both must give the same day.
  const rowsetWithDay = (day: unknown) =>
    ({
      type: "object",
      name: "eve.common.script.sys.rowset.Rowset",
      args: {
        type: "dict",
        entries: [
          ["columns", list(["historyDate", "lowPrice", "highPrice", "avgPrice", "volume", "orders"] as unknown as readonly JsonValue[])],
          ["RowClass", { type: "token", value: "blue.DBRow" }],
          ["lines", { type: "list", items: [[day, 5, 6, 5.5, 1000, 12]] }],
        ],
      },
    }) as unknown as JsonValue;
  const fromGateway = decodePriceHistory(rowsetWithDay("134332992000000000"));
  const fromGamePort = decodePriceHistory(rowsetWithDay({ type: "long", value: "134332992000000000" }));
  assert.equal(fromGateway[0]?.day, 134332992000000000n);
  assert.deepEqual(fromGateway, fromGamePort);
});

// =============================================================================
// marketQuote, client-side
// =============================================================================

test("sortOrderBook: sells cheapest first, buys highest first", () => {
  const sells = decodeOrderBook(
    cached([
      orderRowset([
        orderLine({ orderID: long("1"), price: 7 }),
        orderLine({ orderID: long("2"), price: 5 }),
        orderLine({ orderID: long("3"), price: 6 }),
      ]),
      orderRowset([]),
    ] as unknown as JsonValue),
  ).sells;
  assert.deepEqual(
    sortOrderBook(sells, "sell").map((row) => row.price),
    ["5", "6", "7"],
  );
  // The same rows read as buys sort the other way — this is not symmetric, and
  // getting it backwards shows a player the worst offer at the top.
  assert.deepEqual(
    sortOrderBook(sells, "buy").map((row) => row.price),
    ["7", "6", "5"],
  );
});

test("sortOrderBook does NOT mutate its input", () => {
  const rows = decodeOrderBook(
    cached([
      orderRowset([
        orderLine({ orderID: long("1"), price: 7 }),
        orderLine({ orderID: long("2"), price: 5 }),
      ]),
      orderRowset([]),
    ] as unknown as JsonValue),
  ).sells;
  const before = rows.map((row) => row.price);
  sortOrderBook(rows, "sell");
  assert.deepEqual(
    rows.map((row) => row.price),
    before,
  );
});

test("equally-priced orders break the tie on DISTANCE — the nearer one wins", () => {
  const rows = decodeOrderBook(
    cached([
      orderRowset([
        orderLine({ orderID: long("1"), price: 5, jumps: 9 }),
        orderLine({ orderID: long("2"), price: 5, jumps: 2 }),
      ]),
      orderRowset([]),
    ] as unknown as JsonValue),
  ).sells;
  assert.deepEqual(
    sortOrderBook(rows, "sell").map((row) => row.jumps),
    [2, 9],
  );
});

test("filterByJumps caps distance, and a negative limit means NO limit", () => {
  const rows = decodeOrderBook(
    cached([
      orderRowset([
        orderLine({ orderID: long("1"), jumps: 0 }),
        orderLine({ orderID: long("2"), jumps: 4 }),
        orderLine({ orderID: long("3"), jumps: 20 }),
      ]),
      orderRowset([]),
    ] as unknown as JsonValue),
  ).sells;
  assert.equal(filterByJumps(rows, 5).length, 2);
  assert.equal(filterByJumps(rows, 0).length, 1);
  // ⚠ A filter that hid everything would look exactly like an empty market.
  assert.equal(filterByJumps(rows, -1).length, 3);
});

test("bestPrices reads the book: cheapest sell, highest buy", () => {
  const book = decodeOrderBook(
    cached([
      orderRowset([
        orderLine({ orderID: long("1"), price: 7 }),
        orderLine({ orderID: long("2"), price: 5 }),
      ]),
      orderRowset([
        orderLine({ orderID: long("3"), price: 4, bid: 1 }),
        orderLine({ orderID: long("4"), price: 4.5, bid: 1 }),
      ]),
    ] as unknown as JsonValue),
  );
  assert.deepEqual(bestPrices(book), { bestSell: "5", bestBuy: "4.5" });
  assert.deepEqual(bestPrices({ sells: [], buys: [] }), { bestSell: null, bestBuy: null });
});

test("comparePrice is exact at magnitudes where a JS number is not", () => {
  // Both of these are the same JS number; they are not the same price.
  assert.ok(comparePrice("9007199254740993.00", "9007199254740992.00") > 0);
  assert.equal(comparePrice("5.50", "5.5"), 0);
  assert.ok(comparePrice("5.51", "5.5") > 0);
  assert.ok(comparePrice("10", "9") > 0);
  assert.ok(comparePrice("-1", "1") < 0);
});

test("rangeLabel and distanceLabel never print a sentinel as a number", () => {
  assert.equal(rangeLabel(-1), "This station only");
  assert.equal(rangeLabel(0), "This system only");
  assert.equal(rangeLabel(32767), "Anywhere in the region");
  assert.equal(rangeLabel(1), "Up to 1 jump away");
  assert.equal(rangeLabel(5), "Up to 5 jumps away");
  assert.equal(distanceLabel(0), "Where you are");
  assert.equal(distanceLabel(1), "1 jump away");
  assert.equal(distanceLabel(7), "7 jumps away");
});

// --- The guards retail applies BEFORE dispatch ------------------------------

test("roundPrice rounds to 2dp exactly as the server's roundIsk does", () => {
  assert.equal(roundPrice(5.555), 5.56);
  assert.equal(roundPrice(5.554), 5.55);
  assert.equal(roundPrice(0.001), 0);
});

test("checkPrice rejects a price over MAX_ORDER_PRICE before anything is sent", () => {
  const over = checkPrice(MAX_ORDER_PRICE + 1);
  assert.equal(over.ok, false);
  assert.match(String(over.message), /higher than the market allows/);
  // The ceiling itself is allowed.
  assert.equal(checkPrice(MAX_ORDER_PRICE).ok, true);
});

test("checkPrice rejects zero, negatives, and anything that rounds down to nothing", () => {
  assert.equal(checkPrice(0).ok, false);
  assert.equal(checkPrice(-5).ok, false);
  assert.equal(checkPrice(Number.NaN).ok, false);
  const dust = checkPrice(0.001);
  assert.equal(dust.ok, false);
  assert.match(String(dust.message), /rounds down to nothing/);
});

test("checkPrice hands back the ROUNDED price — what is confirmed is what is sent", () => {
  const check = checkPrice(5.555);
  assert.equal(check.ok, true);
  assert.equal(check.price, 5.56);
});

test("checkQuantity requires a whole number above zero", () => {
  assert.equal(checkQuantity(1).ok, true);
  assert.equal(checkQuantity(0).ok, false);
  assert.equal(checkQuantity(-1).ok, false);
  assert.equal(checkQuantity(1.5).ok, false);
});

// --- The broker's fee -------------------------------------------------------

test("estimateBrokerFee is the STANDARD rate applied to price x quantity", () => {
  const estimate = estimateBrokerFee(1000, 100);
  // 1000 x 100 x 3% = 3000.
  assert.equal(estimate.amount, "3000.00");
  assert.equal(estimate.atMinimum, false);
  assert.equal(estimate.rate, STANDARD_BROKER_RATE);
});

test("with the pilot's own rate the fee is the fee, not an estimate; with none it is the estimate at the standard rate", () => {
  // The sale seen live: 987,654.32 ISK at the rate worked out for the pilot, 0.0295803, was charged 29,215.11.
  const known = estimateBrokerFee(987654.32, 1, 0.0295803);
  assert.deepEqual([known.amount, known.atMinimum, known.rate, known.estimated], ["29215.11", false, 0.0295803, false]);
  const guessed = estimateBrokerFee(987654.32, 1);
  assert.deepEqual([guessed.amount, guessed.rate, guessed.estimated], ["29629.63", STANDARD_BROKER_RATE, true]);
  // No rate, or what is no rate, is the standard one, and said to be an estimate.
  for (const none of [null, undefined, Number.NaN, -0.01, Number.POSITIVE_INFINITY]) {
    const fee = estimateBrokerFee(1000, 100, none as number | null);
    assert.deepEqual([fee.amount, fee.estimated], ["3000.00", true], String(none));
  }
  // A rate of nought is a rate: the fee is the floor, and known.
  const free = estimateBrokerFee(1000, 100, 0);
  assert.deepEqual([free.amount, free.atMinimum, free.estimated], [MINIMUM_BROKER_FEE.toFixed(2), true, false]);
  // The floor holds with a known rate too.
  assert.deepEqual([estimateBrokerFee(0.01, 1, 0.0295803).amount, estimateBrokerFee(0.01, 1, 0.0295803).atMinimum], [MINIMUM_BROKER_FEE.toFixed(2), true]);
});

test("the words beside the fee say whether it is the fee or an estimate", () => {
  assert.deepEqual(brokerFeeWords(estimateBrokerFee(1000, 100, 0.0251)), { heading: "Broker's fee", before: "", percent: "2.51" });
  assert.deepEqual(brokerFeeWords(estimateBrokerFee(1000, 100)), { heading: "Broker's fee (estimate)", before: "about ", percent: "3.00" });
  assert.deepEqual(brokerFeeWords(null), { heading: "Broker's fee (estimate)", before: "about ", percent: null });
});

test("estimateBrokerFee floors at the server's MINIMUM, and says that it did", () => {
  // 1 x 1 x 3% = 0.03, far below the 100 ISK floor.
  const estimate = estimateBrokerFee(1, 1);
  assert.equal(estimate.amount, String(MINIMUM_BROKER_FEE.toFixed(2)));
  assert.equal(
    estimate.atMinimum,
    true,
    "a fee at the floor must be marked, so the panel can say why it is not a percentage",
  );
});

// --- Money formatting and the ACTUAL charge ---------------------------------

test("formatIsk groups thousands and fixes 2dp, without going through a JS number", () => {
  assert.equal(formatIsk("1234567.5"), "1,234,567.50 ISK");
  assert.equal(formatIsk("0"), "0.00 ISK");
  assert.equal(formatIsk("-250.25"), "-250.25 ISK");
  assert.equal(formatIsk(null), "—");
  // 2^53 + 1: every digit survives, which is the whole point of the string.
  assert.equal(formatIsk("9007199254740993"), "9,007,199,254,740,993.00 ISK");
});

test("iskDelta is the EXACT before-minus-after, which is how a real charge is found", () => {
  assert.equal(iskDelta("1000.00", "900.50"), "99.50");
  // A refund reads as a negative charge.
  assert.equal(iskDelta("900.00", "1000.00"), "-100.00");
  assert.equal(iskDelta("1000", "1000"), "0.00");
  assert.equal(iskDelta(null, "1000"), null);
  // Exact at a magnitude where floating point would drift.
  assert.equal(iskDelta("9007199254740993.00", "9007199254740992.99"), "0.01");
});

// --- Refusals ---------------------------------------------------------------

test("a NAMED server refusal becomes a sentence; an unnamed one is passed through verbatim", () => {
  assert.match(
    marketRefusalMessage(new Error("MktBrokersFeeUnexpected2")),
    /broker's fee here is not what you were shown/,
  );
  // The handler's OWN words are never reworded.
  assert.equal(
    marketRefusalMessage(new Error("No matching sell orders were available at the requested price.")),
    "No matching sell orders were available at the requested price.",
  );
});

test("a refusal with no reason at all says exactly that — no cause is ever invented", () => {
  assert.equal(
    marketRefusalMessage(new Error("")),
    "The server did not apply that change, and gave no reason.",
  );
});
