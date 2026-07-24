import test from "node:test";
import assert from "node:assert/strict";

import { holdFreeM3, unitsThatFit } from "./holdFit.ts";

test("holdFreeM3 is capacity minus used, floored at zero, null when unread", () => {
  assert.equal(holdFreeM3({ capacity: 5000, used: 2000 }), 3000);
  assert.equal(holdFreeM3({ capacity: 5000, used: 5200 }), 0, "an over-full hold reads as 0 free, never negative");
  assert.equal(holdFreeM3(null), null);
  assert.equal(holdFreeM3(undefined), null);
});

test("unitsThatFit moves the whole stack when it all fits", () => {
  // 100 Veldspar at 0.1 m³ = 10 m³ into a hold with 3000 free.
  assert.equal(unitsThatFit(100, 0.1, 3000), 100);
});

test("unitsThatFit moves only what fits when the stack is too big", () => {
  // 100000 Veldspar at 0.1 m³ into 3000 free → floor(3000 / 0.1) = 30000.
  assert.equal(unitsThatFit(100000, 0.1, 3000), 30000);
});

test("unitsThatFit floors partial units (no half-unit moves)", () => {
  // 25 free, 0.1 each → 250 fit, but only 40 in the stack.
  assert.equal(unitsThatFit(40, 0.1, 25), 40);
  // 7 free, 2 m³ each → 3 fit (3.5 floored).
  assert.equal(unitsThatFit(10, 2, 7), 3);
});

test("unitsThatFit returns 0 when nothing fits (full hold)", () => {
  assert.equal(unitsThatFit(100, 0.1, 0), 0);
  assert.equal(unitsThatFit(100, 5, 4), 0, "a unit bigger than the free space fits zero");
});

test("unitsThatFit hands the whole stack to the server when volume is unknown", () => {
  assert.equal(unitsThatFit(100, null, 3000), 100);
  assert.equal(unitsThatFit(100, undefined, 3000), 100);
  assert.equal(unitsThatFit(100, 0, 3000), 100, "a zero/garbage volume is 'unknown', not 'infinite'");
});

test("unitsThatFit hands the whole stack to the server when free space is unknown", () => {
  assert.equal(unitsThatFit(100, 0.1, null), 100);
});

test("unitsThatFit is 0 for an empty stack", () => {
  assert.equal(unitsThatFit(0, 0.1, 3000), 0);
});
