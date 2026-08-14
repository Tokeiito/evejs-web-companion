// Dead reckoning between snapshots (goal R89).
//
// This module draws PREDICTED positions, so its tests are mostly about the
// bounds on that prediction: it must never run backwards, never outlive the
// evidence for it, and never touch anything that is not moving.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_EXTRAPOLATION_MS,
  anythingMoving,
  elapsedSinceArrival,
  extrapolate,
  extrapolateEntities,
  gridAt,
  isMoving,
  usableElapsedSeconds,
} from "./deadReckoning.ts";
import type { SpaceEntity, SpaceVector } from "../store/types.ts";

const ORIGIN: SpaceVector = { x: 0, y: 0, z: 0 };

function entity(over: Partial<SpaceEntity> & { itemID: number }): SpaceEntity {
  return {
    kind: "celestial",
    typeID: 16,
    groupID: 500,
    categoryID: 2,
    name: null,
    ownerID: null,
    radius: 100,
    position: ORIGIN,
    velocity: ORIGIN,
    isSelf: false,
    shieldRatio: null,
    armorRatio: null,
    hullRatio: null,
    characterID: null,
    corporationID: null,
    allianceID: null,
    securityStatus: null,
    maxVelocity: null,
    mode: null,
    capacitorRatio: null,
    remainingQuantity: null,
    miningYieldTypeID: null,
    beltID: null,
    isNpc: false,
    npcEntityType: null,
    controllerID: null,
    droneActivity: null,
    targetEntityID: null,
    ...over,
  };
}

// --- what counts as moving ---------------------------------------------------

test("a parked object is not moving", () => {
  assert.equal(isMoving(ORIGIN), false);
  assert.equal(isMoving(null), false);
  assert.equal(isMoving(undefined), false);
});

test("a drifting object below the threshold is not moving", () => {
  // Numerical noise on a stationary rock must not make the whole grid animate.
  assert.equal(isMoving({ x: 0.1, y: 0, z: 0 }), false);
});

test("a ship under way is moving", () => {
  assert.equal(isMoving({ x: 300, y: 0, z: 0 }), true);
  assert.equal(isMoving({ x: 0, y: 0, z: -300 }), true);
});

test("a non-finite velocity is not moving, rather than moving by NaN", () => {
  // A NaN would propagate into the position and a canvas silently declines to
  // draw NaN — the bracket would simply disappear.
  assert.equal(isMoving({ x: Number.NaN, y: 0, z: 0 }), false);
  assert.equal(isMoving({ x: Infinity, y: 0, z: 0 }), false);
});

// --- the prediction window ---------------------------------------------------

test("elapsed time converts to seconds", () => {
  assert.equal(usableElapsedSeconds(200), 0.2);
  assert.equal(usableElapsedSeconds(1_000), 0.6, "…but only up to the cap");
});

test("the prediction is CAPPED, so a dead server freezes rather than drifts", () => {
  // ⚠ The failure this prevents: a snapshot stops arriving and every moving
  // bracket sails off the plot on stale velocity, confidently wrong. A frozen
  // picture is obviously stale; a drifting one is not.
  assert.equal(usableElapsedSeconds(60_000), MAX_EXTRAPOLATION_MS / 1000);
  const far = extrapolate({ x: 0, y: 0, z: 0 }, { x: 1_000, y: 0, z: 0 }, 60_000);
  assert.equal(far.x, 1_000 * (MAX_EXTRAPOLATION_MS / 1000));
});

test("NEGATIVE elapsed time never walks an object backwards", () => {
  // ⚠ The sample stamp and the frame clock are different clocks, so a snapshot
  // can arrive stamped fractionally "after" the frame drawing it. Running the
  // extrapolation backwards would slide every mover the wrong way down its own
  // course — plausible-looking and far harder to spot than a jump.
  assert.equal(usableElapsedSeconds(-50), 0);
  const back = extrapolate({ x: 100, y: 0, z: 0 }, { x: 300, y: 0, z: 0 }, -50);
  assert.deepEqual(back, { x: 100, y: 0, z: 0 });
});

test("a nonsensical elapsed time predicts nothing", () => {
  // ⚠ Infinity is NOT clamped to the cap — it is refused outright. A cap is for
  // a real elapsed time that has run long; a non-finite one is a broken clock,
  // and the safe reading of a broken clock is "I know nothing since the last
  // sample", which means freeze. (The first draft of this test asserted the
  // clamp, contradicting its own name.)
  assert.equal(usableElapsedSeconds(Number.NaN), 0);
  assert.equal(usableElapsedSeconds(Infinity), 0);
  assert.equal(usableElapsedSeconds(-Infinity), 0);
});

// --- extrapolating one position ----------------------------------------------

test("a moving object advances along its own velocity", () => {
  const moved = extrapolate({ x: 0, y: 0, z: 0 }, { x: 300, y: 0, z: -100 }, 200);
  assert.ok(Math.abs(moved.x - 60) < 1e-9, `x: ${moved.x}`);
  assert.equal(moved.y, 0);
  assert.ok(Math.abs(moved.z - -20) < 1e-9, `z: ${moved.z}`);
});

test("a parked object is returned UNCHANGED, by identity", () => {
  // Identity matters: the viewport re-derives from this every animation frame,
  // and a fresh object each time would invalidate downstream work 60x a second
  // for an object that did not move.
  const position = { x: 5, y: 6, z: 7 };
  assert.equal(extrapolate(position, ORIGIN, 200), position);
  assert.equal(extrapolate(position, null, 200), position);
});

test("prediction is always from the LAST SAMPLE, so error cannot compound", () => {
  // Two frames at 100 ms and 200 ms after the same sample must give 30 m and
  // 60 m — not 30 m and 30+60. This is what makes every snapshot a hard reset.
  const from = { x: 0, y: 0, z: 0 };
  const velocity = { x: 300, y: 0, z: 0 };
  assert.ok(Math.abs(extrapolate(from, velocity, 100).x - 30) < 1e-9);
  assert.ok(Math.abs(extrapolate(from, velocity, 200).x - 60) < 1e-9);
});

// --- extrapolating a grid ----------------------------------------------------

test("only the movers move", () => {
  const rock = entity({ itemID: 1, position: { x: 10_000, y: 0, z: 0 } });
  const ship = entity({
    itemID: 2,
    kind: "ship",
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 300, y: 0, z: 0 },
  });
  const [outRock, outShip] = extrapolateEntities([rock, ship], 200);
  assert.equal(outRock, rock, "a parked rock must keep its identity");
  assert.ok(Math.abs((outShip?.position.x ?? 0) - 60) < 1e-9);
});

test("a grid with nothing moving is returned as the SAME array", () => {
  // The cheap path, and the common one: a belt is two hundred parked rocks.
  const rocks = [entity({ itemID: 1 }), entity({ itemID: 2 })];
  assert.equal(extrapolateEntities(rocks, 200), rocks);
});

test("a zero elapsed time is the same array too", () => {
  const grid = [entity({ itemID: 1, velocity: { x: 300, y: 0, z: 0 } })];
  assert.equal(extrapolateEntities(grid, 0), grid);
});

test("extrapolating carries every other field through untouched", () => {
  const rat = entity({
    itemID: 9,
    kind: "ship",
    name: "Serpentis Scout",
    isNpc: true,
    npcEntityType: "npc",
    shieldRatio: 0.5,
    velocity: { x: 300, y: 0, z: 0 },
  });
  const [moved] = extrapolateEntities([rat], 200);
  assert.equal(moved?.name, "Serpentis Scout");
  assert.equal(moved?.isNpc, true);
  assert.equal(moved?.npcEntityType, "npc", "hostility must survive prediction");
  assert.equal(moved?.shieldRatio, 0.5);
  assert.equal(moved?.itemID, 9);
});

// --- the arrival clock -------------------------------------------------------

test("elapsed is measured from when the snapshot ARRIVED here", () => {
  assert.equal(elapsedSinceArrival(1_000, 1_200), 200);
});

test("with no arrival stamp nothing is predicted", () => {
  assert.equal(elapsedSinceArrival(null, 1_200), 0);
  assert.equal(elapsedSinceArrival(Number.NaN, 1_200), 0);
});

// --- when to bother animating ------------------------------------------------

test("a still grid with a still ship needs no animation", () => {
  // An animation frame that redraws an unchanged picture is pure waste, and the
  // kind that never shows up in a profile anyone runs.
  assert.equal(anythingMoving([entity({ itemID: 1 })], ORIGIN), false);
  assert.equal(anythingMoving([], null), false);
});

test("your OWN movement is enough to animate a still grid", () => {
  // ⚠ Closing on a stationary rock at 300 m/s is your movement, not the rock's.
  // A plot that advanced everything except the observer would show a belt
  // sliding backwards past a ship that never moved.
  assert.equal(anythingMoving([entity({ itemID: 1 })], { x: 300, y: 0, z: 0 }), true);
});

test("one mover anywhere on the grid is enough", () => {
  const grid = [entity({ itemID: 1 }), entity({ itemID: 2, velocity: { x: 300, y: 0, z: 0 } })];
  assert.equal(anythingMoving(grid, ORIGIN), true);
});

// --- R90: interpolation, the normal path -------------------------------------
//
// Extrapolating past the newest sample is what made the picture jitter: reads do
// not take a constant time, so every snapshot disagreed with the prediction and
// the bracket snapped. Drawing slightly in the past and blending between two
// MEASURED samples removes the snap entirely — nothing is predicted, so there is
// nothing to be corrected.

function sample(
  atMs: number,
  entities: readonly SpaceEntity[],
  shipPosition: SpaceVector | null = ORIGIN,
  shipVelocity: SpaceVector | null = ORIGIN,
) {
  return { atMs, entities, shipPosition, shipVelocity };
}

const AT_0 = entity({ itemID: 1, position: { x: 0, y: 0, z: 0 } });
const AT_100 = entity({ itemID: 1, position: { x: 100, y: 0, z: 0 } });

test("a render time between two samples is INTERPOLATED", () => {
  const grid = gridAt(sample(1_000, [AT_0]), sample(1_200, [AT_100]), 1_100);
  assert.equal(grid?.mode, "interpolated");
  assert.equal(grid?.entities[0]?.position.x, 50, "half way between two measured positions");
});

test("interpolation is proportional across the whole span", () => {
  for (const [renderAt, expected] of [
    [1_000, 0],
    [1_050, 25],
    [1_150, 75],
    [1_200, 100],
  ] as const) {
    const grid = gridAt(sample(1_000, [AT_0]), sample(1_200, [AT_100]), renderAt);
    assert.ok(
      Math.abs((grid?.entities[0]?.position.x ?? -1) - expected) < 1e-9,
      `at ${renderAt} expected ${expected}, got ${grid?.entities[0]?.position.x}`,
    );
  }
});

test("NOTHING is ever drawn beyond the two measured positions", () => {
  // ⚠ The property that removes the jitter. Every drawn position lies between
  // two things the server actually said, so a new sample can never contradict
  // what was on screen a frame earlier.
  for (let renderAt = 1_000; renderAt <= 1_200; renderAt += 7) {
    const x = gridAt(sample(1_000, [AT_0]), sample(1_200, [AT_100]), renderAt)?.entities[0]
      ?.position.x;
    assert.ok(x !== undefined && x >= 0 && x <= 100, `drew ${x}, outside the measured pair`);
  }
});

test("your own hull is interpolated too", () => {
  const grid = gridAt(
    sample(1_000, [], { x: 0, y: 0, z: 0 }),
    sample(1_200, [], { x: 200, y: 0, z: 0 }),
    1_100,
  );
  assert.equal(grid?.origin.x, 100);
});

test("with no older sample yet it EXTRAPOLATES rather than showing nothing", () => {
  // The first snapshot of a session has no history to blend against; freezing
  // until a second one lands would make the view look broken on arrival.
  const grid = gridAt(null, sample(1_000, [entity({ itemID: 1, velocity: { x: 300, y: 0, z: 0 } })]), 1_100);
  assert.equal(grid?.mode, "extrapolated");
  assert.ok(Math.abs((grid?.entities[0]?.position.x ?? 0) - 30) < 1e-9);
});

test("a LATE poll extrapolates forward instead of freezing", () => {
  // The render time has caught up with the newest sample. Stuttering through a
  // hiccup would be worse than briefly predicting, and the cap still bounds it.
  const grid = gridAt(
    sample(1_000, [AT_0]),
    sample(1_200, [entity({ itemID: 1, position: { x: 100, y: 0, z: 0 }, velocity: { x: 300, y: 0, z: 0 } })]),
    1_300,
  );
  assert.equal(grid?.mode, "extrapolated");
  assert.ok((grid?.entities[0]?.position.x ?? 0) > 100, "it must keep moving");
});

test("the entity LIST always comes from the newer sample", () => {
  // ⚠ The older one only supplies a starting point. Driving the list from it
  // would keep drawing things that have since been destroyed or warped off, and
  // would never show anything that just arrived.
  const older = sample(1_000, [entity({ itemID: 1 }), entity({ itemID: 2 })]);
  const newer = sample(1_200, [entity({ itemID: 2 }), entity({ itemID: 3 })]);
  const ids = gridAt(older, newer, 1_100)?.entities.map((e) => e.itemID);
  assert.deepEqual(ids, [2, 3], "gone things must go, new things must appear");
});

test("something with no history is drawn where it was measured", () => {
  const older = sample(1_000, []);
  const newer = sample(1_200, [entity({ itemID: 9, position: { x: 500, y: 0, z: 0 } })]);
  assert.equal(gridAt(older, newer, 1_100)?.entities[0]?.position.x, 500);
});

test("two samples stamped identically do not divide by zero", () => {
  const grid = gridAt(sample(1_000, [AT_0]), sample(1_000, [AT_100]), 1_000);
  assert.equal(grid?.mode, "measured");
  assert.equal(grid?.entities[0]?.position.x, 100);
});

test("with no snapshot at all there is nothing to draw", () => {
  assert.equal(gridAt(null, null, 1_000), null);
});

test("a render time before BOTH samples shows the older measured grid", () => {
  const grid = gridAt(sample(1_000, [AT_0]), sample(1_200, [AT_100]), 900);
  assert.equal(grid?.mode, "measured");
  assert.equal(grid?.entities[0]?.position.x, 0);
});
