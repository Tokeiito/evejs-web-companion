// Wallet-read decoders (goal R50) against fixtures built the way the eve.js
// account service actually builds the result: account.GetWalletDivisionsInfo is
// `buildList` of `buildKeyVal([["key", …], ["balance", …]])` (server helper at
// server/src/services/account/accountService.js:77-90). Balances are kept as
// bigint-safe decimal strings; the key (1000..1006) maps to a 1..7 ordinal.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCashBalance,
  decodeCorpDivisions,
  normalizeDivisionNames,
} from "./wallet.ts";
import type { JsonValue } from "./wire.ts";

// Exactly the shape the server helpers emit: buildKeyVal -> util.KeyVal wrapping
// a {type:"dict", entries}; buildList -> {type:"list", items}.
function keyVal(entries: ReadonlyArray<readonly [string, JsonValue]>): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

function divisionsList(rows: ReadonlyArray<readonly [number, JsonValue]>): JsonValue {
  return {
    type: "list",
    items: rows.map(([key, balance]) => keyVal([["key", key], ["balance", balance]])),
  };
}

test("decodeCashBalance keeps a >2^53 personal balance exact (long-aware)", () => {
  assert.equal(decodeCashBalance(1000165000), "1000165000");
  assert.equal(
    decodeCashBalance({ type: "long", value: "9007199254740993" } as JsonValue),
    "9007199254740993",
  );
  assert.equal(decodeCashBalance(null), null);
});

test("decodeCorpDivisions maps key->ordinal, pairs names, keeps ISK exact", () => {
  const raw = divisionsList([
    [1000, 250000000],
    [1001, { type: "long", value: "9007199254740993" }],
    [1006, 0],
  ]);
  const rows = decodeCorpDivisions(raw, { 1: "Master Wallet", 2: "R&D", 7: "" });
  assert.deepEqual(rows, [
    { key: 1000, division: 1, name: "Master Wallet", balance: "250000000" },
    // A >2^53 balance survives BECAUSE it never went through Number.
    { key: 1001, division: 2, name: "R&D", balance: "9007199254740993" },
    // A blank name falls back to null (panel shows "Division 7"); 0 ISK is real.
    { key: 1006, division: 7, name: null, balance: "0" },
  ]);
});

// COMPANION MATCHER PROOF. If the KeyVal reader silently missed the fields, the
// balance would read "0" and the key would read 0 — this pins that it actually
// extracts the real values (the failure mode of a decoder that matches nothing).
test("decodeCorpDivisions actually reads the KeyVal fields, not defaults", () => {
  const rows = decodeCorpDivisions(divisionsList([[1003, 42]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.key, 1003);
  assert.equal(rows[0]!.division, 4);
  assert.equal(rows[0]!.balance, "42");
  assert.notEqual(rows[0]!.balance, "0");
});

test("decodeCorpDivisions: a well-formed empty list -> [] (a real 'no divisions')", () => {
  assert.deepEqual(decodeCorpDivisions({ type: "list", items: [] }), []);
});

test("decodeCorpDivisions tolerates malformed input and drops out-of-range keys", () => {
  assert.deepEqual(decodeCorpDivisions(null as unknown as JsonValue), []);
  assert.deepEqual(decodeCorpDivisions(42 as unknown as JsonValue), []);
  // A key below the corp-wallet range is not a division and is dropped.
  assert.deepEqual(decodeCorpDivisions(divisionsList([[7, 5]])), []);
});

test("normalizeDivisionNames keys by 1..7 ordinal and tolerates string keys", () => {
  assert.deepEqual(normalizeDivisionNames({ "1": "Master Wallet", "3": "Ops" } as JsonValue), {
    1: "Master Wallet",
    3: "Ops",
  });
  assert.deepEqual(normalizeDivisionNames(null as unknown as JsonValue), {});
});
