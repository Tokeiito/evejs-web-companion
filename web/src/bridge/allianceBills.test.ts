// R84 allianceRegistry financial decoders (bills / bill balance) against REAL captured
// bytes.
//
// The EMPTY bill list and the two bill-balance scalars are the EXACT retail values captured
// live through /api/bridge/call on 2026-07-22: Test Two (Elysian member) -> empty bills,
// balance 0; Farmer -> empty bills, balance 80000. The POPULATED bill fixture mirrors the
// server builder (buildBillPayload) exactly, since the world seeds no bills to capture live.
// ISK amounts and FILETIMEs are asserted to survive as raw decimal STRINGS (bigint-safe).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeAllianceBills, decodeBillBalance } from "./allianceBills.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: entries.map((e) => [e[0], e[1]]) },
  };
}

// --- GetBills --------------------------------------------------------------

// Test Two / Farmer REAL empty bills list, verbatim.
const REAL_BILLS_EMPTY: JsonValue = { type: "list", items: [] };

// Builder-mirrored populated bill (buildBillPayload). amount is large ISK; dueDateTime is a
// FILETIME long; unpaid -> paid 0 / paidDateTime null; absent external ids come as -1.
const BILLS_POPULATED: JsonValue = {
  type: "list",
  items: [
    keyVal([
      ["billID", 42],
      ["billTypeID", 2],
      ["amount", 100000000],
      ["interest", 0],
      ["debtorID", 99000000],
      ["creditorID", 1000125],
      ["dueDateTime", { type: "long", value: "134274243506850000" }],
      ["paid", 0],
      ["paidDateTime", null],
      ["paidByOwnerID", 0],
      ["externalID", -1],
      ["externalID2", -1],
    ]),
  ],
};

test("decodeAllianceBills returns [] for the real empty bills list", () => {
  assert.deepEqual(decodeAllianceBills(REAL_BILLS_EMPTY), []);
  assert.deepEqual(decodeAllianceBills(null), []);
});

test("decodeAllianceBills reads a bill, keeping ISK + FILETIME as raw strings", () => {
  const bills = decodeAllianceBills(BILLS_POPULATED);
  assert.equal(bills.length, 1);
  const b = bills[0]!;
  assert.equal(b.billID, 42);
  assert.equal(b.billTypeID, 2);
  assert.equal(b.amount, "100000000");
  assert.equal(typeof b.amount, "string");
  assert.equal(b.interest, "0");
  assert.equal(b.debtorID, 99000000);
  assert.equal(b.creditorID, 1000125);
  assert.equal(b.dueDateTime, "134274243506850000");
  assert.equal(typeof b.dueDateTime, "string");
  assert.equal(b.paid, false);
  assert.equal(b.paidDateTime, null);
  assert.equal(b.externalID, -1);
  assert.equal(b.externalID2, -1);
});

// --- GetBillBalance --------------------------------------------------------

test("decodeBillBalance reads the bare-number balance as a bigint-safe string", () => {
  // The two REAL live values: Test Two's corp 0, Farmer's corp 80000.
  assert.equal(decodeBillBalance(0), "0");
  assert.equal(decodeBillBalance(80000), "80000");
  assert.equal(typeof decodeBillBalance(80000), "string");
});

test("decodeBillBalance tolerates a {type:'long'} balance beyond 2^53", () => {
  assert.equal(
    decodeBillBalance({ type: "long", value: "9007199254740993000" }),
    "9007199254740993000",
  );
  assert.equal(decodeBillBalance(null), null);
});
