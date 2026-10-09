"use strict";

// A type's average price over a week, and how far a price is from it, as the
// retail client works them out for the entry of a sale.
//
// The client's sale window makes an entry for each item, and the entry asks
// the market for the type's average price when it is made
// (buySellItemContainerBase.py 28):
//
//   marketsvc.GetAveragePrice(typeID, days=7)                          (368)
//     GetPriceHistory(typeID)                                          (333)
//         GetMarketProxy().GetOldPriceHistory(typeID)
//         GetMarketProxy().GetNewPriceHistory(typeID)
//         GetHistoryRowList(old, new)                                  (344)
//     of the rows no older than a week: the sum of average x quantity over
//     the sum of quantity; with nothing traded in the week, the type's base
//     price over its portion size, or 1.0 where that is nothing; rounded to
//     the hundredth
//
// and each item of the sale carries how far its price is from that
// (GetDelta, 57): (price - averagePrice) / averagePrice.
//
// A row is [day, low, high, average, quantity, orders], the day in the
// clock's 100 ns ticks as a BigInt. The sums are in the client's order, one
// operation at a time, and the test holds them to the client's own Python.

const DAY = 864000000000n;

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null);
const ticks = (value) => (typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : null);

/**
 * marketsvc.GetHistoryRowList: the two halves of a type's price history, joined. The old half's days in order,
 * with a row for each day between two of them at the average of the day before, 2 for its quantity and 2 for its
 * orders; the same from the last of the old half up to yesterday; then the new half as it came, or one row for
 * now at the last average with nothing traded. It counts from now, so nothing is filled in before the first day.
 */
function joinedHistory(old, fresh, now) {
  const history = [];
  let lastTime = now;
  const midnightToday = (now / DAY) * DAY;
  let lastPrice = 0.0;
  for (const entry of old) {
    while (lastTime + DAY < entry[0]) {
      lastTime += DAY;
      history.push([lastTime, lastPrice, lastPrice, lastPrice, 2, 2]);
    }
    history.push(entry);
    [lastTime, , , lastPrice] = entry;
  }
  while (lastTime < midnightToday - DAY) {
    lastTime += DAY;
    history.push([lastTime, lastPrice, lastPrice, lastPrice, 2, 2]);
  }
  if (fresh.length > 0) history.push(...fresh);
  else history.push([now, lastPrice, lastPrice, lastPrice, 0, 0]);
  return history;
}

/** marketsvc.GetAveragePrice: the type's average price over `days` days of its history, to the hundredth. */
function averagePrice(old, fresh, now, { basePrice = 0, portionSize = 1 } = {}, days = 7) {
  let volume = 0;
  let priceVolume = 0.0;
  for (const entry of joinedHistory(old, fresh, now)) {
    if (entry[0] < now - BigInt(days) * DAY) continue;
    priceVolume += entry[3] * entry[4];
    volume += entry[4];
  }
  let average;
  if (volume > 0) {
    average = priceVolume / volume;
  } else {
    average = basePrice / portionSize;
    if (!(average > 0.0)) average = 1.0;
  }
  // round(float(averagePrice), 2): to the nearest hundredth of the number as it is, a tie going up.
  return Number(average.toFixed(2));
}

/**
 * buySellItemContainerBase.GetDelta: how far a price is from the type's average, as a fraction of the average.
 * Null where there is no saying: an average of nothing (the client's sum fails there), or what is no number.
 */
function deltaOf(price, average) {
  if (typeof price !== "number" || typeof average !== "number" || !Number.isFinite(price) || !(average > 0)) return null;
  return (price - average) / average;
}

/**
 * The rows of a price history as the server answers one: a Rowset whose lines are read by its columns' names.
 * A line with no day, or no number for its average or its quantity, is no row. None for what is no such Rowset.
 */
function historyRows(rowset) {
  const entries = rowset && rowset.type === "object" && rowset.args && Array.isArray(rowset.args.entries) ? rowset.args.entries : [];
  const part = (name) => (entries.find((entry) => Array.isArray(entry) && text(entry[0]) === name) ?? [])[1];
  const columns = items(part("columns")).map(text);
  const at = ["historyDate", "lowPrice", "highPrice", "avgPrice", "volume", "orders"].map((name) => columns.indexOf(name));
  if (at.includes(-1)) return [];
  const rows = [];
  for (const line of items(part("lines")).map(items)) {
    const day = ticks(line[at[0]]);
    const rest = at.slice(1).map((place) => number(line[place]));
    if (day !== null && rest[2] !== null && rest[3] !== null) rows.push([day, ...rest]);
  }
  return rows;
}

module.exports = { averagePrice, deltaOf, historyRows, joinedHistory };
