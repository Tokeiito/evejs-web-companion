// A4c (pure part) — belt rotation and the arming guard. The still-warping
// fixture is the load-bearing one: mine-at-belt must NOT be armed while the ship
// is in warp, or a player's "until the ore hold is full" reads true against an
// empty hold before the belt is even on the grid.

import test from "node:test";
import assert from "node:assert/strict";

import { BELT_ARRIVAL_RADIUS_M } from "./miningBotLoop.ts";
import {
  EMPTY_ROTATION,
  chooseBelt,
  emptyCurrent,
  mineArmed,
  nearestUnworkedBelt,
  workBelt,
  type BeltOption,
} from "./beltRotation.ts";

const belts: BeltOption[] = [
  { id: 101, name: "Belt I", distance: 30000 },
  { id: 102, name: "Belt II", distance: 12000 },
  { id: 103, name: "Belt III", distance: 55000 },
];

test("nearestUnworkedBelt picks the closest belt not yet emptied", () => {
  assert.equal(nearestUnworkedBelt(belts, new Set())?.id, 102);
  assert.equal(nearestUnworkedBelt(belts, new Set([102]))?.id, 101);
  assert.equal(nearestUnworkedBelt(belts, new Set([101, 102]))?.id, 103);
  assert.equal(nearestUnworkedBelt(belts, new Set([101, 102, 103])), null);
});

test("an unknown distance sorts after every measured belt", () => {
  const withUnknown: BeltOption[] = [
    { id: 201, name: "Far", distance: 90000 },
    { id: 202, name: "Unmeasured", distance: null },
  ];
  assert.equal(nearestUnworkedBelt(withUnknown, new Set())?.id, 201);
});

test("chooseBelt keeps the current belt while it is still on the grid", () => {
  const rot = workBelt(EMPTY_ROTATION, 101);
  const choice = chooseBelt(belts, rot);
  assert.equal(choice.kind, "work");
  assert.ok(choice.kind === "work");
  assert.equal(choice.belt.id, 101, "does not abandon the belt it is already working");
});

test("chooseBelt rotates to the next belt once the current one is emptied", () => {
  let rot = workBelt(EMPTY_ROTATION, 102);
  rot = emptyCurrent(rot); // 102 mined dry
  const choice = chooseBelt(belts, rot);
  assert.ok(choice.kind === "work");
  assert.equal(choice.belt.id, 101, "the next nearest after 102");
  assert.deepEqual([...rot.emptied], [102]);
  assert.equal(rot.current, null);
});

test("chooseBelt reports exhausted once every belt has been emptied", () => {
  let rot = EMPTY_ROTATION;
  for (const b of belts) {
    rot = workBelt(rot, b.id);
    rot = emptyCurrent(rot);
  }
  assert.equal(chooseBelt(belts, rot).kind, "exhausted");
  assert.equal(rot.emptied.length, 3);
});

test("a belt that vanishes from the grid is rotated past, not clung to", () => {
  const rot = workBelt(EMPTY_ROTATION, 999); // a belt no longer present
  const choice = chooseBelt(belts, rot);
  assert.ok(choice.kind === "work");
  assert.equal(choice.belt.id, 102, "falls back to the nearest present belt");
});

test("emptyCurrent is idempotent and a no-op with no current belt", () => {
  assert.deepEqual(emptyCurrent(EMPTY_ROTATION), EMPTY_ROTATION);
  const rot = emptyCurrent(workBelt(EMPTY_ROTATION, 101));
  assert.deepEqual(emptyCurrent(rot), rot);
});

// ─── Arming — the belt-empty-on-tick-one guard ───────────────────────────────

test("mine-at-belt is armed only once the ship has arrived", () => {
  assert.equal(
    mineArmed({ inSpace: true, inWarp: false, distanceToBeltM: BELT_ARRIVAL_RADIUS_M - 1 }),
    true,
  );
});

test("mine-at-belt is NOT armed while still in warp (the still-warping fixture)", () => {
  // Distance already inside the radius, but the ship is warping — must not arm,
  // or "hold is full" reads true against an empty hold mid-warp.
  assert.equal(mineArmed({ inSpace: true, inWarp: true, distanceToBeltM: 5000 }), false);
});

test("any unknown read leaves mine-at-belt unarmed", () => {
  assert.equal(mineArmed({ inSpace: null, inWarp: false, distanceToBeltM: 100 }), false);
  assert.equal(mineArmed({ inSpace: true, inWarp: null, distanceToBeltM: 100 }), false);
  assert.equal(mineArmed({ inSpace: true, inWarp: false, distanceToBeltM: null }), false);
});

test("mine-at-belt is not armed while still far from the belt", () => {
  assert.equal(
    mineArmed({ inSpace: true, inWarp: false, distanceToBeltM: BELT_ARRIVAL_RADIUS_M + 100000 }),
    false,
  );
});
