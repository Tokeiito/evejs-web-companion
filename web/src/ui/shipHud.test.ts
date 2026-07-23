// The ship-readout model (shipHud.ts): the resource gauge list and the discrete
// capacitor segment maths.

import test from "node:test";
import assert from "node:assert/strict";

import { resourceGauges, capacitorSegments } from "./shipHud.ts";

test("resourceGauges is shield/armor/hull, outer to inner, carrying the ratios", () => {
  const gauges = resourceGauges({ shieldRatio: 1, armorRatio: 0.5, hullRatio: 0.2 });
  assert.deepEqual(gauges.map((g) => g.key), ["shield", "armor", "hull"]);
  assert.deepEqual(gauges.map((g) => g.ratio), [1, 0.5, 0.2]);
});

test("a null ship yields three null gauges (no reading, not zero)", () => {
  const gauges = resourceGauges(null);
  assert.deepEqual(gauges.map((g) => g.ratio), [null, null, null]);
});

test("capacitorSegments rounds a clamped ratio to the nearest segment", () => {
  assert.equal(capacitorSegments(1, 12), 12);
  assert.equal(capacitorSegments(0, 12), 0);
  assert.equal(capacitorSegments(0.5, 12), 6);
  // 0.75 * 12 = 9.
  assert.equal(capacitorSegments(0.75, 12), 9);
});

test("capacitorSegments treats null as empty and clamps out-of-range ratios", () => {
  assert.equal(capacitorSegments(null, 12), 0);
  assert.equal(capacitorSegments(1.4, 12), 12);
  assert.equal(capacitorSegments(-0.2, 12), 0);
  assert.equal(capacitorSegments(0.5, 0), 0);
});
