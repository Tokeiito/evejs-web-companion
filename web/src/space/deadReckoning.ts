// DEAD RECKONING BETWEEN SNAPSHOTS (goal R89) — pure, framework-free, testable.
//
// The tactical viewport redraws exactly when a snapshot lands, so its motion has
// always been the poll rate: objects teleported from one measured position to the
// next. At one snapshot a second that read as a slideshow; at five it is better
// but still visibly stepped, because 5 fps is 5 fps.
//
// So the picture is now drawn every animation frame, and between snapshots each
// object is advanced along the velocity the SERVER reported for it. That is what
// the retail client does — `spacePoll.ts` has always described its own cadence as
// "a locally dead-reckoned ballpark" — and it is the only way to get smooth
// motion out of a polled position without lying about where things are for
// longer than a moment.
//
// ---------------------------------------------------------------------------
// ⚠ THIS DRAWS PREDICTED POSITIONS, AND THAT IS A REAL COST
//
// Between snapshots the picture shows where an object WOULD be if it kept doing
// exactly what it was last measured doing. A ship that stops, turns, or warps is
// drawn wrong until the next snapshot corrects it. Three things keep that
// bounded and honest:
//
//   1. EVERY SNAPSHOT SNAPS BACK TO TRUTH. Extrapolation is always measured from
//      the latest sample, never accumulated — errors cannot compound, and the
//      longest a prediction can survive is one poll interval.
//   2. IT IS CAPPED. Past `MAX_EXTRAPOLATION_MS` an object FREEZES rather than
//      flying on. If the server stops answering, brackets stop where they were
//      last seen instead of sailing off the plot on stale velocity — a frozen
//      picture is obviously stale, a drifting one is confidently wrong.
//   3. NOTHING THAT IS NOT MOVING IS TOUCHED. Rocks, stations and gates report
//      zero velocity and are passed through unchanged, so the overwhelming
//      majority of a grid is exactly where it was measured.
//
// The ship's OWN position is extrapolated too, and that is not optional: closing
// on a stationary rock at 300 m/s is your movement, not the rock's, and a plot
// that advanced everything except the observer would show a belt sliding
// backwards past a ship that never moved.

import type { SpaceEntity, SpaceVector } from "../store/types.ts";

/**
 * How far past the last sample a position may be predicted, in milliseconds.
 *
 * Sized against the poll, with headroom: at a 200 ms cadence this is three
 * beats, so an ordinary late snapshot glides through instead of stuttering,
 * while a server that has genuinely stopped answering freezes the picture inside
 * a second. Raising it buys smoothness through longer outages at the price of
 * drawing positions nothing has confirmed for longer.
 */
export const MAX_EXTRAPOLATION_MS = 600;

/** Metres per second below which an object is treated as parked. */
const MOVING_THRESHOLD_MPS = 0.5;

/** Is this thing moving enough to be worth predicting? */
export function isMoving(velocity: SpaceVector | null | undefined): boolean {
  if (!velocity) {
    return false;
  }
  const { x, y, z } = velocity;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return false;
  }
  return Math.sqrt(x * x + y * y + z * z) >= MOVING_THRESHOLD_MPS;
}

/**
 * How much of the elapsed time may actually be used, in seconds.
 *
 * ⚠ NEGATIVE ELAPSED IS CLAMPED TO ZERO, NOT ALLOWED TO RUN BACKWARDS. The
 * sample stamp comes from the server and the frame clock from the browser; they
 * are not the same clock, so a snapshot can legitimately arrive stamped a few
 * milliseconds "after" the frame that draws it. Extrapolating by a negative time
 * would walk every moving object backwards along its own course — a subtle,
 * plausible-looking wrongness that is much harder to spot than a jump.
 */
export function usableElapsedSeconds(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 0;
  }
  return Math.min(elapsedMs, MAX_EXTRAPOLATION_MS) / 1000;
}

/** Advance a position along a velocity. Returns the SAME object when it cannot move. */
export function extrapolate(
  position: SpaceVector,
  velocity: SpaceVector | null | undefined,
  elapsedMs: number,
): SpaceVector {
  const seconds = usableElapsedSeconds(elapsedMs);
  if (seconds <= 0 || !isMoving(velocity)) {
    return position;
  }
  const move = velocity as SpaceVector;
  return {
    x: position.x + move.x * seconds,
    y: position.y + move.y * seconds,
    z: position.z + move.z * seconds,
  };
}

/**
 * The grid as it would look `elapsedMs` after it was measured.
 *
 * ⚠ RETURNS THE SAME ARRAY WHEN NOTHING WOULD MOVE. The viewport re-derives from
 * this every animation frame, and a fresh array of fresh objects each time would
 * invalidate every downstream `$derived` sixty times a second on a grid of two
 * hundred parked rocks — the exact cost this is supposed to be cheap enough to
 * avoid. Unmoved entities keep their identity too, so only the movers churn.
 */
export function extrapolateEntities(
  entities: readonly SpaceEntity[],
  elapsedMs: number,
): readonly SpaceEntity[] {
  const seconds = usableElapsedSeconds(elapsedMs);
  if (seconds <= 0) {
    return entities;
  }
  let changed = false;
  const out = entities.map((entity) => {
    if (!isMoving(entity.velocity)) {
      return entity;
    }
    changed = true;
    return { ...entity, position: extrapolate(entity.position, entity.velocity, elapsedMs) };
  });
  return changed ? out : entities;
}

/**
 * How long to predict for, given the sample's own stamp and the frame clock.
 *
 * ⚠ `sampledAtMs` IS THE SERVER'S SIM CLOCK, NOT THE BROWSER'S. Subtracting one
 * from the other would produce whatever the difference between two machines'
 * clocks happens to be — minutes, in the wrong direction, on a badly-set box —
 * so the caller passes the browser time at which the snapshot ARRIVED, and this
 * measures against that. The server stamp is still useful for telling two
 * snapshots apart; it is simply not a clock this side can subtract from.
 */
export function elapsedSinceArrival(arrivedAtMs: number | null, nowMs: number): number {
  if (arrivedAtMs === null || !Number.isFinite(arrivedAtMs)) {
    return 0;
  }
  return nowMs - arrivedAtMs;
}

/** True when anything on this grid is worth running an animation frame for. */
export function anythingMoving(
  entities: readonly SpaceEntity[],
  shipVelocity: SpaceVector | null | undefined,
): boolean {
  if (isMoving(shipVelocity)) {
    return true;
  }
  for (const entity of entities) {
    if (isMoving(entity.velocity)) {
      return true;
    }
  }
  return false;
}
