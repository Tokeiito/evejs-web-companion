// A solar system's security, as the client shows and classes it.

import test from "node:test";
import assert from "node:assert/strict";

import { SECURITY_CLASS, isLowSecOrLower, pseudoSecurity, securityClass, shownSecurity } from "./systemSecurity.ts";

test("the level the client works with is the system's own, but never between nought and 0.05", () => {
  assert.equal(pseudoSecurity(0.708087), 0.708087);
  assert.equal(pseudoSecurity(0.049), 0.05);
  assert.equal(pseudoSecurity(0.0001), 0.05);
  assert.equal(pseudoSecurity(0.05), 0.05);
  assert.equal(pseudoSecurity(0), 0);
  assert.equal(pseudoSecurity(-0.02), -0.02);
  assert.equal(pseudoSecurity(1), 1);
});

test("the rating shown is that level to one decimal place", () => {
  assert.equal(shownSecurity(0.708087), 0.7);
  assert.equal(shownSecurity(0.830855), 0.8);
  assert.equal(shownSecurity(0.95), 0.9);
  assert.equal(shownSecurity(0.96), 1);
  assert.equal(shownSecurity(1), 1);
  // The least a system above nought can show is 0.1.
  assert.equal(shownSecurity(0.0001), 0.1);
  assert.equal(shownSecurity(0.049), 0.1);
  assert.equal(shownSecurity(0.44), 0.4);
  assert.equal(shownSecurity(0.45), 0.5);
  // Below nought, and a "minus nought" that is shown as nought.
  assert.equal(shownSecurity(-0.36), -0.4);
  assert.ok(Object.is(shownSecurity(-0.04), 0));
  assert.ok(Object.is(shownSecurity(0), 0));
});

test("a system's class goes by that level: null at nought, low below 0.45, high below 0.95, safe above", () => {
  assert.deepEqual(SECURITY_CLASS, { zero: 0, low: 1, high: 2, safe: 3 });
  assert.equal(securityClass(-0.5), 0);
  assert.equal(securityClass(0), 0);
  // Anything above nought is at least 0.05, and so low.
  assert.equal(securityClass(0.0001), 1);
  assert.equal(securityClass(0.449), 1);
  assert.equal(securityClass(0.45), 2);
  assert.equal(securityClass(0.708087), 2);
  assert.equal(securityClass(0.949), 2);
  assert.equal(securityClass(0.95), 3);
  assert.equal(securityClass(1), 3);
});

test("low security or lower is where the client warns", () => {
  for (const security of [-1, 0, 0.0001, 0.3, 0.449]) assert.equal(isLowSecOrLower(security), true, String(security));
  for (const security of [0.45, 0.5, 0.95, 1]) assert.equal(isLowSecOrLower(security), false, String(security));
});
