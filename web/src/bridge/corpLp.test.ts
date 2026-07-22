// R61 corp LP decoders against REAL captured bytes.
//
// The fixtures are the EXACT retail shapes captured live from Farmer (corp
// 98000001) through GET /api/bridge/corp-lp on 2026-07-22:
//   • GetAllMyCorporationWalletLPBalances -> a CRowset[issuerCorpID, loyaltyPoints]
//     — EMPTY for Farmer's corp (no corp LP), a legitimate empty state. The
//     CRowset shape is IDENTICAL to the R6 character balances read, so the corp
//     balances reuse the proven decodeLpBalances decoder.
//   • LPStoreMgr.GetAvailableOffersFromCorp -> a {type:"list"} of 818 offer
//     KeyVals (the Heraldry emblem store — every one LP-only: iskCost 0, empty
//     reqItems/lootItems, requiredStandings null). Three real offers below.
//
// R7d: issuerCorpID / offer typeID / corpID survive as numeric fields; LP and ISK
// costs stay bigint-safe decimal strings.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeCorpLoyaltyPoints, decodeCorpLpOffers } from "./corpLp.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } } as unknown as JsonValue;
}
function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items } as unknown as JsonValue;
}

// A CRowset (objectex2) whose rows are `valueRows` positioned against the
// [issuerCorpID, loyaltyPoints] columns (buildWalletBalanceRowset feeds arrays ->
// POSITIONAL packedrows). The decoder reads only `list`, so the descriptor is
// elided as the wire permits.
const BALANCE_COLUMNS = [["issuerCorpID", 3], ["loyaltyPoints", 3]] as const;
function balanceCrowset(valueRows: readonly (readonly number[])[]): JsonValue {
  return {
    type: "objectex2",
    header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [] }],
    list: valueRows.map((values) => ({ type: "packedrow", columns: BALANCE_COLUMNS, values })),
    dict: [],
  } as unknown as JsonValue;
}

// The real EMPTY corp balances CRowset (Farmer's corp has no corp LP).
const REAL_CORP_BALANCES_EMPTY: JsonValue = balanceCrowset([]);

// A populated corp balances CRowset, built from the real column shape.
const POPULATED_CORP_BALANCES: JsonValue = balanceCrowset([[1000419, 250000]]);

// Three real LPStoreMgr offers, verbatim.
const REAL_OFFERS: JsonValue = list([
  keyVal([["typeID", 74974], ["iskCost", 0], ["akCost", 0], ["reqItems", list([])], ["offerID", 17509], ["qty", 1], ["requiredStandings", null], ["corpID", 1000419], ["lootItems", list([])], ["lpCost", 11500]]),
  keyVal([["typeID", 73584], ["iskCost", 0], ["akCost", 0], ["reqItems", list([])], ["offerID", 17510], ["qty", 1], ["requiredStandings", null], ["corpID", 1000419], ["lootItems", list([])], ["lpCost", 7500]]),
  keyVal([["typeID", 75197], ["iskCost", 0], ["akCost", 0], ["reqItems", list([])], ["offerID", 17511], ["qty", 1], ["requiredStandings", null], ["corpID", 1000419], ["lootItems", list([])], ["lpCost", 9000]]),
]);

test("decodeCorpLoyaltyPoints on the real empty corp CRowset is [] (a real 'no corp LP')", () => {
  assert.deepEqual(decodeCorpLoyaltyPoints(REAL_CORP_BALANCES_EMPTY), []);
});

test("decodeCorpLoyaltyPoints decodes a populated corp balance CRowset (real column shape)", () => {
  assert.deepEqual(decodeCorpLoyaltyPoints(POPULATED_CORP_BALANCES), [
    { issuerCorpID: 1000419, loyaltyPoints: "250000" },
  ]);
});

test("decodeCorpLpOffers decodes the three real Heraldry offers, costs bigint-safe", () => {
  assert.deepEqual(decodeCorpLpOffers(REAL_OFFERS), [
    { offerID: 17509, typeID: 74974, qty: 1, lpCost: "11500", iskCost: "0", akCost: "0", corpID: 1000419, requiredStandings: null, reqItems: [], lootItems: [] },
    { offerID: 17510, typeID: 73584, qty: 1, lpCost: "7500", iskCost: "0", akCost: "0", corpID: 1000419, requiredStandings: null, reqItems: [], lootItems: [] },
    { offerID: 17511, typeID: 75197, qty: 1, lpCost: "9000", iskCost: "0", akCost: "0", corpID: 1000419, requiredStandings: null, reqItems: [], lootItems: [] },
  ]);
});

test("decodeCorpLpOffers keeps a >2^53 lpCost bigint-safe (never zeroed or rounded)", () => {
  const big = list([keyVal([["typeID", 1], ["offerID", 99], ["qty", 1], ["lpCost", { type: "long", value: "9007199254740993" }], ["iskCost", 0], ["akCost", 0], ["corpID", 5], ["requiredStandings", null], ["reqItems", list([])], ["lootItems", list([])]])]);
  assert.equal(decodeCorpLpOffers(big)[0]?.lpCost, "9007199254740993");
});

test("decodeCorpLpOffers decodes reqItems / lootItems as [typeID, quantity] pairs", () => {
  // Built from the real reqItems list-of-lists shape (buildRequirementPairs); the
  // 818 Farmer offers are all empty, so this proves the pair path when data lands.
  const offers = list([keyVal([
    ["typeID", 2], ["offerID", 5], ["qty", 3], ["lpCost", 100], ["iskCost", 5000], ["akCost", 0], ["corpID", 1000419], ["requiredStandings", 5],
    ["reqItems", list([list([34, 100]), list([35, 200])])],
    ["lootItems", list([list([36, 1])])],
  ])]);
  assert.deepEqual(decodeCorpLpOffers(offers), [
    {
      offerID: 5, typeID: 2, qty: 3, lpCost: "100", iskCost: "5000", akCost: "0", corpID: 1000419,
      requiredStandings: 5,
      reqItems: [{ typeID: 34, quantity: 100 }, { typeID: 35, quantity: 200 }],
      lootItems: [{ typeID: 36, quantity: 1 }],
    },
  ]);
});

test("decodeCorpLpOffers on an empty / malformed value is []", () => {
  assert.deepEqual(decodeCorpLpOffers(list([])), []);
  assert.deepEqual(decodeCorpLpOffers(null), []);
  assert.deepEqual(decodeCorpLpOffers(42), []);
});
