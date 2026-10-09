"use strict";

// A type's average price over a week, and how far a price is from it, as the retail client works them out for the
// entry of a sale (src/gamePort/priceHistory.js). Held to the client's own Python for the same sums in the same
// order (test/fixtures/averagePriceOracle.json).

const test = require("node:test");
const assert = require("node:assert/strict");

const { averagePrice, deltaOf, historyRows, joinedHistory } = require("../src/gamePort/priceHistory");
const oracle = require("./fixtures/averagePriceOracle.json");

const NOW = BigInt(oracle.now);
const DAY = 864000000000n;
const rows = (half) => half.map(([day, ...rest]) => [BigInt(day), ...rest]);

test("the average over a week is the client's own, to the last digit, for every history its Python was asked", () => {
  assert.equal(oracle.cases.length, 10);
  for (const each of oracle.cases) {
    assert.equal(averagePrice(rows(each.old), rows(each.fresh), NOW, { basePrice: each.basePrice, portionSize: each.portionSize }), each.average, each.name);
  }
  // The cases tell the parts apart: the days filled in, the week's edge, the base price, the rounding.
  const by = Object.fromEntries(oracle.cases.map((each) => [each.name, each.average]));
  assert.deepEqual([by["a history that ends a month ago"], by["nothing at all, by the base price"], by["nothing at all, and no base price"], by["a price at a tie of the hundredths"], by["a cheap thing"]], [100, 125, 1, 2.67, 0]);
});

test("how far a price is from the average is the client's own too; from an average of nothing there is no saying", () => {
  for (const each of oracle.cases) {
    assert.deepEqual(oracle.prices.map((price) => deltaOf(price, each.average)), each.deltas, each.name);
  }
  assert.deepEqual([deltaOf(5, 0), deltaOf(5, null), deltaOf(null, 5), deltaOf("5", 5)], [null, null, null, null]);
  assert.equal(deltaOf(100, 100), 0);
});

test("the two halves are joined as the client joins them: days with no trade carried at the average before, with its two and two", () => {
  const midnight = NOW / DAY * DAY;
  const traded = (daysAgo, average, quantity = 100) => [midnight - BigInt(daysAgo) * DAY, 1, 9, average, quantity, 7];
  const carried = (daysAgo, price) => [midnight - BigInt(daysAgo) * DAY, price, price, price, 2, 2];
  assert.deepEqual(joinedHistory([traded(5, 5), traded(3, 6)], [traded(1, 7)], NOW), [traded(5, 5), carried(4, 5), traded(3, 6), carried(2, 6), carried(1, 6), traded(1, 7)]);
  // No new half: a row for now, at the last average, nothing traded.
  assert.deepEqual(joinedHistory([traded(1, 6)], [], NOW), [traded(1, 6), [NOW, 6, 6, 6, 0, 0]]);
  assert.deepEqual(joinedHistory([], [], NOW), [[NOW, 0, 0, 0, 0, 0]]);
  // Nothing is filled in before the first day; a new half older than the days filled in goes last all the same.
  assert.equal(joinedHistory([traded(40, 5)], [traded(0, 7)], NOW).length, 1 + 39 + 1);
  assert.deepEqual(joinedHistory([traded(3, 5)], [traded(2, 6)], NOW).map((row) => row[4]), [100, 2, 2, 100]);
});

// The history's Rowset as this server answers it off a game-port session, in shape and in kinds of value: the
// names some text and some bytes, a line a tuple whose day is a long. The numbers are made up.
const historyRowset = (...lines) => ({
  type: "object",
  name: Buffer.from("eve.common.script.sys.rowset.Rowset"),
  args: { type: "dict", entries: [
    ["header", { type: "objectex1", header: [{ type: "token", value: "blue.DBRowDescriptor" }, [[[Buffer.from("historyDate"), 64], [Buffer.from("lowPrice"), 5], [Buffer.from("highPrice"), 5], [Buffer.from("avgPrice"), 5], [Buffer.from("volume"), 20], [Buffer.from("orders"), 3]]]], list: [], dict: [] }],
    [Buffer.from("columns"), { type: "list", items: ["historyDate", "lowPrice", "highPrice", "avgPrice", "volume", "orders"].map((name) => Buffer.from(name)) }],
    ["RowClass", { type: "token", value: "blue.DBRow" }],
    ["lines", { type: "list", items: lines }],
  ] },
});

test("a history's rows are read off the server's Rowset by its columns' names", () => {
  assert.deepEqual(historyRows(historyRowset([134307936000000000n, 98.5, 101.5, 100, 134, 24], [134308800000000000n, 98.5, 101.5, 100.5, 137n, 24])), [
    [134307936000000000n, 98.5, 101.5, 100, 134, 24],
    [134308800000000000n, 98.5, 101.5, 100.5, 137, 24],
  ]);
  // The columns in another order are still read by name.
  const swapped = historyRowset([7, 134307936000000000n, 100, 101.5, 98.5, 3]);
  swapped.args.entries[1][1].items = ["volume", "historyDate", "avgPrice", "highPrice", "lowPrice", "orders"];
  assert.deepEqual(historyRows(swapped), [[134307936000000000n, 98.5, 101.5, 100, 7, 3]]);
  // A line with no day, or what is no number for its average or quantity, is no row; nor is anything that is no Rowset.
  assert.deepEqual(historyRows(historyRowset([null, 1, 2, 3, 4, 5], [134307936000000000n, 1, 2, "x", 4, 5], [134307936000000000n, 1, 2, 3, null, 5])), []);
  for (const none of [null, undefined, 5, [], {}, { type: "list", items: [] }, { type: "object", args: { type: "dict", entries: [] } }]) assert.deepEqual(historyRows(none), [], JSON.stringify(none));
  assert.deepEqual(historyRows(historyRowset()), []);
});
