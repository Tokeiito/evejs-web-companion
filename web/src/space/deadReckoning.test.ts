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
