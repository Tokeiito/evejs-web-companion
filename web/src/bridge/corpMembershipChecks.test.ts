// R82 corpRegistry membership-check decoders against REAL captured values (cross-account
// Farmer 140000005 / corp 98000001 vs Test Two 140000002 / corp 98000000, 2026-07-22).

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCanLeaveCorporation,
  decodeCanBeKickedOut,
  decodeAllyBaseCost,
} from "./corpMembershipChecks.ts";

test("CanLeaveCurrentCorporation decodes the CEO refusal captured live for Farmer", () => {
  // Farmer is the CEO: [0, "CrpCEOCanNotQuit", {}].
  assert.deepEqual(decodeCanLeaveCorporation([0, "CrpCEOCanNotQuit", {}]), {
    canLeave: false,
    errorCode: "CrpCEOCanNotQuit",
  });
});

test("CanLeaveCurrentCorporation decodes the member OK captured live for Test Two", () => {
  // Test Two is an ordinary member: [1, null, {}].
  assert.deepEqual(decodeCanLeaveCorporation([1, null, {}]), {
    canLeave: true,
    errorCode: null,
  });
});

test("CanLeaveCurrentCorporation tolerates a malformed/empty tuple", () => {
  assert.deepEqual(decodeCanLeaveCorporation(null), { canLeave: false, errorCode: null });
  assert.deepEqual(decodeCanLeaveCorporation([]), { canLeave: false, errorCode: null });
});

test("CanBeKickedOut decodes the 0/1 flag captured live", () => {
  // own member 998830009 -> 1; own CEO 140000005 -> 0; foreign 140000002 -> 0; no arg -> 0.
  assert.equal(decodeCanBeKickedOut(1), true);
  assert.equal(decodeCanBeKickedOut(0), false);
  assert.equal(decodeCanBeKickedOut(null), false);
});

test("CharGetAllyBaseCost decodes the ISK cost captured live", () => {
  // Farmer own 7 500 000; foreign chars 10 000 000 (the ⚠ flagged leak differentiates here).
  assert.equal(decodeAllyBaseCost(7500000), 7500000);
  assert.equal(decodeAllyBaseCost(10000000), 10000000);
  // Tolerate a {type:"long"} wrapper defensively (server sends a plain number live).
  assert.equal(decodeAllyBaseCost({ type: "long", value: "7500000" }), 7500000);
  assert.equal(decodeAllyBaseCost(null), 0);
});
