// R62 market corp/PLEX decoders against REAL captured bytes.
//
// The fixtures below are the EXACT retail shapes captured live from Farmer
// (char 140000005, corp 98000001, region 10000002) through
// GET /api/bridge/market-trading on 2026-07-22, trimmed to a few rows but
// otherwise verbatim wire bytes.
//
//   • GetPlexOrders          -> POPULATED: the PLEX order book, sells + buys,
//     each order's orderID a >2^53 int64 ({type:"long"} string), bid 0 = sell.
//   • GetPlexBest            -> POPULATED: best PLEX ask per typeID.
//   • GetPlexOldPriceHistory / GetPlexNewPriceHistory / GetPlexHistory
//     -> POPULATED: daily price rows whose historyDate is a BARE decimal string.
//   • GetCorporationOrders   -> EMPTY (Farmer's corp has no open orders).
//   • CorpGetTransactions    -> EMPTY (no corp trades) — and CACHED, unlike the
//     char read, so the decoder must unwrap the CachedMethodCallResult first.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorporationOrders,
  decodeCorpTransactions,
  decodePlexBest,
  decodePlexHistory,
  decodePlexOrders,
  decodePlexPriceHistory,
} from "./marketTrading.ts";
import type { JsonValue } from "./wire.ts";

// --- Real captured bytes (verbatim, trimmed to a couple of rows) ------------

const PLEX_ORDERS = {"type":"object","name":{"type":"rawstr","value":"carbon.common.script.net.objectCaching.CachedMethodCallResult"},"args":[{"type":"dict","entries":[[{"type":"rawstr","value":"versionCheck"},{"type":"rawstr","value":"run"}],[{"type":"rawstr","value":"sessionInfo"},{"type":"rawstr","value":"regionid"}]]},{"type":"substream","value":[{"type":"object","name":"eve.common.script.sys.rowset.Rowset","args":{"type":"dict","entries":[["header",{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["price",5],["volRemaining",3],["typeID",3],["range",3],["orderID",20],["volEntered",3],["minVolume",3],["bid",3],["issueDate",64],["duration",3],["stationID",3],["regionID",3],["solarSystemID",3],["constellationID",3],["jumps",3]]]],"list":[],"dict":[]}],["columns",{"type":"list","items":["price","volRemaining","typeID","range","orderID","volEntered","minVolume","bid","issueDate","duration","stationID","regionID","solarSystemID","constellationID","jumps"]}],["RowClass",{"type":"token","value":"blue.DBRow"}],["lines",{"type":"list","items":[[76357.85,5000,44992,32767,{"type":"long","value":"2257700966927740864"},5000,1,0,{"type":"long","value":"134285415464300000"},3650,60000682,10000002,30000145,20000020,32767],[76414.95,5000,44992,32767,{"type":"long","value":"2257699588243238848"},5000,1,0,{"type":"long","value":"134285415464300000"},3650,60000361,10000002,30000142,20000020,32767]]}]]}},{"type":"object","name":"eve.common.script.sys.rowset.Rowset","args":{"type":"dict","entries":[["header",{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["price",5],["volRemaining",3],["typeID",3],["range",3],["orderID",20],["volEntered",3],["minVolume",3],["bid",3],["issueDate",64],["duration",3],["stationID",3],["regionID",3],["solarSystemID",3],["constellationID",3],["jumps",3]]]],"list":[],"dict":[]}],["columns",{"type":"list","items":["price","volRemaining","typeID","range","orderID","volEntered","minVolume","bid","issueDate","duration","stationID","regionID","solarSystemID","constellationID","jumps"]}],["RowClass",{"type":"token","value":"blue.DBRow"}],["lines",{"type":"list","items":[[64625.94,5000,44992,32767,{"type":"long","value":"4257762183096610752"},5000,1,1,{"type":"long","value":"134285415471220000"},3650,60014935,10000002,30000145,20000020,32767],[64537.11,5000,44992,32767,{"type":"long","value":"4257712898346889152"},5000,1,1,{"type":"long","value":"134285415471220000"},3650,60003460,10000002,30000142,20000020,32767]]}]]}}]},{"type":"list","items":[{"type":"long","value":"134291958604560000"},-529801159]}]} as unknown as JsonValue;

const PLEX_BEST = {"type":"object","name":{"type":"rawstr","value":"carbon.common.script.net.objectCaching.CachedMethodCallResult"},"args":[{"type":"dict","entries":[[{"type":"rawstr","value":"versionCheck"},{"type":"rawstr","value":"run"}],[{"type":"rawstr","value":"sessionInfo"},{"type":"rawstr","value":"regionid"}]]},{"type":"substream","value":{"type":"dict","entries":[[44992,{"type":"object","name":"util.KeyVal","args":{"type":"dict","entries":[["price",76357.85],["volRemaining",115000],["typeID",44992],["stationID",60000682]]}}]]}},{"type":"list","items":[{"type":"long","value":"134291958605350000"},-152890939]}]} as unknown as JsonValue;

const PLEX_OLD_HISTORY = {"type":"object","name":"eve.common.script.sys.rowset.Rowset","args":{"type":"dict","entries":[["header",{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["historyDate",64],["lowPrice",5],["highPrice",5],["avgPrice",5],["volume",20],["orders",3]]]],"list":[],"dict":[]}],["columns",{"type":"list","items":["historyDate","lowPrice","highPrice","avgPrice","volume","orders"]}],["RowClass",{"type":"token","value":"blue.DBRow"}],["lines",{"type":"list","items":[["134259552000000000",67498.11,69553.89,68526,592,22],["134260416000000000",68400.86,70484.14,69442.5,595,22],["134261280000000000",69303.62,71414.38,70359,598,22]]}]]}} as unknown as JsonValue;

const PLEX_NEW_HISTORY = {"type":"object","name":"eve.common.script.sys.rowset.Rowset","args":{"type":"dict","entries":[["header",{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["historyDate",64],["lowPrice",5],["highPrice",5],["avgPrice",5],["volume",20],["orders",3]]]],"list":[],"dict":[]}],["columns",{"type":"list","items":["historyDate","lowPrice","highPrice","avgPrice","volume","orders"]}],["RowClass",{"type":"token","value":"blue.DBRow"}],["lines",{"type":"list","items":[["134284608000000000",72636.86,74849.14,73743,679,22]]}]]}} as unknown as JsonValue;

const PLEX_HISTORY = {"type":"dict","entries":[[44992,[{"type":"object","name":"eve.common.script.sys.rowset.Rowset","args":{"type":"dict","entries":[["header",{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["historyDate",64],["lowPrice",5],["highPrice",5],["avgPrice",5],["volume",20],["orders",3]]]],"list":[],"dict":[]}],["columns",{"type":"list","items":["historyDate","lowPrice","highPrice","avgPrice","volume","orders"]}],["RowClass",{"type":"token","value":"blue.DBRow"}],["lines",{"type":"list","items":[["134259552000000000",67498.11,69553.89,68526,592,22],["134260416000000000",68400.86,70484.14,69442.5,595,22],["134261280000000000",69303.62,71414.38,70359,598,22]]}]]}},{"type":"object","name":"eve.common.script.sys.rowset.Rowset","args":{"type":"dict","entries":[["header",{"type":"objectex1","header":[{"type":"token","value":"blue.DBRowDescriptor"},[[["historyDate",64],["lowPrice",5],["highPrice",5],["avgPrice",5],["volume",20],["orders",3]]]],"list":[],"dict":[]}],["columns",{"type":"list","items":["historyDate","lowPrice","highPrice","avgPrice","volume","orders"]}],["RowClass",{"type":"token","value":"blue.DBRow"}],["lines",{"type":"list","items":[["134284608000000000",72636.86,74849.14,73743,679,22]]}]]}}]]]} as unknown as JsonValue;

const CORP_ORDERS_EMPTY = {"type":"object","name":{"type":"rawstr","value":"carbon.common.script.net.objectCaching.CachedMethodCallResult"},"args":[{"type":"dict","entries":[[{"type":"rawstr","value":"versionCheck"},{"type":"rawstr","value":"run"}],[{"type":"rawstr","value":"sessionInfo"},{"type":"rawstr","value":"corpid"}]]},{"type":"substream","value":{"type":"object","name":"eve.common.script.sys.rowset.Rowset","args":{"type":"dict","entries":[["header",{"type":"list","items":["orderID","typeID","charID","regionID","stationID","range","bid","price","volEntered","volRemaining","issueDate","minVolume","contraband","duration","isCorp","solarSystemID","escrow","constellationID","keyID","orderState","lastStateChange"]}],["columns",{"type":"list","items":["orderID","typeID","charID","regionID","stationID","range","bid","price","volEntered","volRemaining","issueDate","minVolume","contraband","duration","isCorp","solarSystemID","escrow","constellationID","keyID","orderState","lastStateChange"]}],["RowClass",{"type":"token","value":"util.Row"}],["lines",{"type":"list","items":[]}]]}}},{"type":"list","items":[{"type":"long","value":"134291958604360000"},-915121159]}]} as unknown as JsonValue;

const CORP_TXNS_EMPTY = {"type":"object","name":{"type":"rawstr","value":"carbon.common.script.net.objectCaching.CachedMethodCallResult"},"args":[{"type":"dict","entries":[[{"type":"rawstr","value":"versionCheck"},{"type":"rawstr","value":"run"}],[{"type":"rawstr","value":"sessionInfo"},{"type":"rawstr","value":"corpid"}]]},{"type":"substream","value":{"type":"list","items":[]}},{"type":"list","items":[{"type":"long","value":"134291958604410000"},52428965]}]} as unknown as JsonValue;

// --- Builder-shaped POPULATED fixtures (the empty live reads' populated form) -

// buildOwnerOrdersRowset: util.Row lines over OWNER_ORDER_HEADER; a corp order
// carries isCorp 1 and orderID as a signed long.
function ownerOrdersRowset(lines: readonly JsonValue[][]): JsonValue {
  const header = ["orderID","typeID","charID","regionID","stationID","range","bid","price","volEntered","volRemaining","issueDate","minVolume","contraband","duration","isCorp","solarSystemID","escrow","constellationID","keyID","orderState","lastStateChange"];
  const rowset = {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: { type: "dict", entries: [
      ["header", { type: "list", items: header }],
      ["columns", { type: "list", items: header }],
      ["RowClass", { type: "token", value: "util.Row" }],
      ["lines", { type: "list", items: lines.map((l) => ({ type: "list", items: l })) }],
    ] },
  };
  return { type: "object", name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [{ type: "dict", entries: [] }, { type: "substream", value: rowset }, { type: "list", items: [{ type: "long", value: "1" }, 0] }] } as unknown as JsonValue;
}

// A single real-shaped corp SELL order (isCorp 1), orderID a signed long.
const CORP_ORDERS_POPULATED = ownerOrdersRowset([[
  { type: "long", value: "2257700966927740864" } as unknown as JsonValue, // orderID
  34, 0, 10000002, 60003760, 32767, 0, 5.5, 1000, 400,
  { type: "long", value: "134285415464300000" } as unknown as JsonValue, // issueDate
  1, 0, 90, 1, 30000142, 0, 20000020, 1000, 0, null,
]]);

// A cached list of one transaction KeyVal (CorpGetTransactions is CACHED).
function cachedTxnList(entries: readonly JsonValue[]): JsonValue {
  return { type: "object", name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [{ type: "dict", entries: [] }, { type: "substream", value: { type: "list", items: entries } }, { type: "list", items: [{ type: "long", value: "1" }, 0] }] } as unknown as JsonValue;
}
function txnKeyVal(fields: readonly [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries: fields } } as unknown as JsonValue;
}
// A corp trade where the corp (98000001) was the BUYER.
const CORP_TXNS_POPULATED = cachedTxnList([txnKeyVal([
  ["transactionID", { type: "long", value: "9007199254999999" } as unknown as JsonValue],
  ["transactionDate", { type: "long", value: "134290000000000000" } as unknown as JsonValue],
  ["typeID", 34], ["quantity", 250], ["price", 6.75], ["stationID", 60003760],
  ["buyerID", 98000001], ["sellerID", 140000178],
])]);

// --- Tests ------------------------------------------------------------------

test("decodePlexOrders decodes the real PLEX order book, sells and buys", () => {
  const book = decodePlexOrders(PLEX_ORDERS);
  assert.equal(book.sells.length, 2);
  assert.equal(book.buys.length, 2);
  // bid 0 in the first tuple half = a sell; bid 1 in the second = a buy.
  assert.equal(book.sells[0]?.side, "sell");
  assert.equal(book.buys[0]?.side, "buy");
  assert.equal(book.sells[0]?.typeID, 44992);
  assert.equal(book.sells[0]?.price, "76357.85");
});

test("decodePlexOrders keeps a >2^53 orderID exact as a decimal string (R7d/bigint)", () => {
  const book = decodePlexOrders(PLEX_ORDERS);
  assert.equal(book.sells[0]?.orderID, "2257700966927740864");
  assert.equal(book.buys[0]?.orderID, "4257762183096610752");
  // A JS number would have rounded this — prove it survived as an exact string.
  assert.notEqual(book.sells[0]?.orderID, String(2257700966927740864));
});

test("decodePlexOrders reads the FILETIME issue date as a bigint", () => {
  const book = decodePlexOrders(PLEX_ORDERS);
  assert.equal(book.sells[0]?.issuedAt, 134285415464300000n);
});

test("decodePlexBest decodes the real best-ask dict keyed by typeID", () => {
  assert.deepEqual(decodePlexBest(PLEX_BEST), [
    { typeID: 44992, price: "76357.85", volumeRemaining: 115000, stationID: 60000682 },
  ]);
});

test("decodePlexPriceHistory decodes the real old-history rows with a BARE-STRING date", () => {
  const rows = decodePlexPriceHistory(PLEX_OLD_HISTORY);
  assert.equal(rows.length, 3);
  // The crux: the date arrives as a bare decimal string, NOT {type:"long"};
  // unwrapLong alone would null it. It must decode to the real bigint.
  assert.equal(rows[0]?.day, 134259552000000000n);
  assert.equal(rows[0]?.average, "68526");
  assert.equal(rows[0]?.volume, 592);
});

test("decodePlexPriceHistory decodes the real new-history single row", () => {
  const rows = decodePlexPriceHistory(PLEX_NEW_HISTORY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.day, 134284608000000000n);
  assert.equal(rows[0]?.high, "74849.14");
});

test("decodePlexHistory decodes the dict of [old, new] history per typeID", () => {
  const hist = decodePlexHistory(PLEX_HISTORY);
  assert.equal(hist.length, 1);
  assert.equal(hist[0]?.typeID, 44992);
  assert.equal(hist[0]?.old.length, 3);
  assert.equal(hist[0]?.recent.length, 1);
  assert.equal(hist[0]?.old[0]?.day, 134259552000000000n);
});

test("decodeCorporationOrders on the real EMPTY corp capture is [] (legitimate)", () => {
  assert.deepEqual(decodeCorporationOrders(CORP_ORDERS_EMPTY), []);
});

test("decodeCorporationOrders decodes a populated corp order (isCorp, bigint orderID)", () => {
  const rows = decodeCorporationOrders(CORP_ORDERS_POPULATED);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.orderID, "2257700966927740864");
  assert.equal(rows[0]?.isCorp, true);
  assert.equal(rows[0]?.side, "sell");
});

test("decodeCorpTransactions unwraps the CACHED empty list to [] (legitimate)", () => {
  assert.deepEqual(decodeCorpTransactions(CORP_TXNS_EMPTY, 98000001), []);
});

test("decodeCorpTransactions unwraps the cache and derives side vs the corp id", () => {
  const rows = decodeCorpTransactions(CORP_TXNS_POPULATED, 98000001);
  assert.equal(rows.length, 1);
  // The corp was the buyerID -> "bought".
  assert.equal(rows[0]?.side, "bought");
  assert.equal(rows[0]?.transactionID, "9007199254999999");
  assert.equal(rows[0]?.typeID, 34);
});

test("the market-trading decoders return empty for a malformed / null value", () => {
  assert.deepEqual(decodePlexOrders(null).sells, []);
  assert.deepEqual(decodePlexBest(null), []);
  assert.deepEqual(decodePlexPriceHistory(42 as unknown as JsonValue), []);
  assert.deepEqual(decodePlexHistory({ type: "list", items: [] } as unknown as JsonValue), []);
  assert.deepEqual(decodeCorporationOrders(null), []);
  assert.deepEqual(decodeCorpTransactions(null, 1), []);
});
