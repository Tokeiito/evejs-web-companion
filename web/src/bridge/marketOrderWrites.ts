// A market order taken down by the page itself (the plan's Phase 6b).
//
// Until 2026-10-13 it was one route of the BFF (POST /api/bridge/market/cancel), which read the pilot's orders and
// wallet, made the call, read both again, and answered whether an order had gone and what the wallet had moved by.
//
// THE CALL, as the client makes it, from an order's own menu in the orders window and in the market's own lists
// ("Cancel Order": orders.py 277 and 304 to 306, entries.py 126 and 152 to 153):
//
//   marketutils.CancelOffer(order)                     quote.py 298 to 303
//     sm.GetService('marketQuote').CancelOrder(order.orderID, order.regionID)
//       self.GetMarketProxy().CancelCharOrder(orderID, regionID)      marketsvc.py 281 to 283
//
// the order's number and the region it is in, both off the order's own row in the pilot's orders. The client asks
// its pilot first (CancelMarketOrder, a yes or no, quote.py 300 to 301), and does nothing after: the server tells
// that the pilot's orders changed (OnOwnOrdersChanged), and the client's market service reads them again. No
// Tranquility recording has an order cancelled.
//
// THE PAGE'S WINDOW ASKS ITS PILOT FIRST, as it did, and says that the broker's fee is not returned.
//
// WHAT THE SERVER TAKES FROM THE CALLER: the order's number. It loads the order, which must be the session's own
// character's, and takes the region from the order itself: the region the call names is not read. It answers
// nothing, whether an order was taken down or was closed already.
//
// ⚠ THE ANSWER IS NOTHING, SO THE VERDICT IS READ: the pilot's orders and its wallet, before the call and after.
// An order that was among the pilot's and is no more was taken down; the wallet's difference is what it returned.
// A read that fails leaves its half of the verdict unknown, and is not made up.

import { failsTheReading, type Ask } from "./ask.ts";
import { decodeOwnOrders, iskDelta, toAmountString } from "./market.ts";
import type { JsonValue } from "./wire.ts";

/** What an order's taking down came to, as the pilot's orders and wallet say. */
export interface MarketOrderChange {
  /** The order was among the pilot's before and is not after. */
  readonly applied: boolean;
  /** The server answered, and the order is still there (or the orders could not be read to say). */
  readonly declinedSilently: boolean;
  /** ISK taken (positive) or returned (negative), exact, as a decimal string; null where a balance was not read. */
  readonly charged: string | null;
  readonly balanceAfter: string | null;
}

/** A read that may fail by itself: null then, unless the whole reading failed (no session, no BFF). */
async function quietly<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (reason) {
    if (failsTheReading(reason)) throw reason;
    return null;
  }
}

/**
 * The wallet's balance as an exact decimal string. The server sends it as a real, rounded to cents: where a
 * transport hands the real on in its wrapper, the cents are kept as the route kept them.
 */
function walletAmount(value: JsonValue): string | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (value as { type?: JsonValue }).type === "real") {
    const real = (value as { value?: JsonValue }).value;
    return typeof real === "number" && Number.isFinite(real) ? real.toFixed(2) : null;
  }
  return toAmountString(value);
}

/**
 * Takes down one of the pilot's own orders, named by its number as the pilot's orders have it. `act` makes the
 * write and `ask` the reads. Fails as the call fails.
 */
export async function cancelOrder(act: Ask, ask: Ask, orderID: string): Promise<MarketOrderChange> {
  if (!/^\d+$/.test(orderID)) throw new Error("That order could not be identified.");
  const orders = () => quietly(async () => decodeOwnOrders(await ask("marketProxy", "GetCharOrders", [])));
  const balance = () => quietly(async () => walletAmount(await ask("account", "GetCashBalance", [0])));
  const before = await orders();
  const balanceBefore = await balance();
  // The region off the order's own row, as the client names it (quote.py 302). Where the page's read has not the
  // order, nought goes, as the route sent: the server takes the region from the order it loads.
  const row = before === null ? undefined : before.find((order) => order.orderID === orderID);
  await act("marketProxy", "CancelCharOrder", [orderID, row?.regionID ?? 0]);
  const balanceAfter = await balance();
  const after = await orders();
  const applied = row !== undefined && after !== null && !after.some((order) => order.orderID === orderID);
  return { applied, declinedSilently: !applied, charged: iskDelta(balanceBefore, balanceAfter), balanceAfter };
}
