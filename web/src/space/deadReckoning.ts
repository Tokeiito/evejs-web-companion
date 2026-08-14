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

// ---------------------------------------------------------------------------
// R90 — INTERPOLATION, AND WHY IT REPLACED EXTRAPOLATION AS THE NORMAL PATH
//
// Extrapolating past the newest sample is what made the picture jitter. Every
// snapshot describes where things were when the SERVER sampled them, and reads
// do not take a constant time — so arrivals are irregular even though the timer
// is not. Each new snapshot therefore disagreed with the position we had
// predicted, and the bracket SNAPPED to the correction.
//
// Modelled at 300 m/s with reads varying 120-300 ms, the snap was ±27 to ±51 m
// per poll — and IDENTICAL at 1 Hz, 3 Hz and 5 Hz, because its size comes from
// the variance in read time, not from the interval. Polling slower only made the
// corrections less frequent, never smaller. That is why the rate change alone
// could not fix this.
//
// So the picture is drawn a little in the PAST — far enough back that the two
// snapshots either side of the render time have both already arrived — and each
// object is placed BETWEEN its two measured positions. Nothing is predicted:
// every drawn position lies between two things the server actually said, which
// is both smoother and more honest than extrapolation ever was.
//
// The cost is latency: the picture is one render delay behind live. For an
// overview whose job is "what is around me and roughly where", that is a trade
// worth making — and the alternative was a picture that twitched several times a
// second.
//
// Extrapolation survives as the FALLBACK for when there is no older sample yet,
// or when a poll is late enough that the render time has caught up with the
// newest one. Freezing or stuttering during a hiccup would be worse than briefly
// predicting, and the cap above still bounds how far a prediction can run.

/** One snapshot, as this module needs to see it. */
export interface Sample {
  readonly entities: readonly SpaceEntity[];
  readonly shipPosition: SpaceVector | null;
  readonly shipVelocity: SpaceVector | null;
  /** When it ARRIVED here, on the browser's clock. */
  readonly atMs: number;
}

/** How the drawn grid was produced — for tests, and for an honest readout. */
export type GridMode = "interpolated" | "extrapolated" | "measured";

export interface RenderedGrid {
  readonly entities: readonly SpaceEntity[];
  readonly origin: SpaceVector;
  readonly mode: GridMode;
}

const NO_ORIGIN: SpaceVector = { x: 0, y: 0, z: 0 };

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function lerpVector(from: SpaceVector, to: SpaceVector, alpha: number): SpaceVector {
  return {
    x: lerp(from.x, to.x, alpha),
    y: lerp(from.y, to.y, alpha),
    z: lerp(from.z, to.z, alpha),
  };
}

/**
 * The grid as it should be DRAWN at `renderAtMs`.
 *
 * `renderAtMs` is deliberately behind the current clock (see RENDER_DELAY_MS in
 * the viewport), so it normally falls between the two samples and every position
 * is an interpolation.
 */
export function gridAt(
  older: Sample | null,
  newer: Sample | null,
  renderAtMs: number,
): RenderedGrid | null {
  if (newer === null) {
    return null;
  }
  const newestOrigin = newer.shipPosition ?? NO_ORIGIN;

  // Caught up with, or past, the newest sample: predict forward, capped.
  if (older === null || renderAtMs >= newer.atMs) {
    const elapsed = renderAtMs - newer.atMs;
    if (elapsed <= 0) {
      return { entities: newer.entities, origin: newestOrigin, mode: "measured" };
    }
    return {
      entities: extrapolateEntities(newer.entities, elapsed),
      origin: extrapolate(newestOrigin, newer.shipVelocity, elapsed),
      mode: "extrapolated",
    };
  }

  // Behind both samples (a very late frame): the older one is the truth we have.
  if (renderAtMs <= older.atMs) {
    return {
      entities: older.entities,
      origin: older.shipPosition ?? newestOrigin,
      mode: "measured",
    };
  }

  const span = newer.atMs - older.atMs;
  // Two samples stamped identically cannot define a blend; take the newer.
  if (!(span > 0)) {
    return { entities: newer.entities, origin: newestOrigin, mode: "measured" };
  }
  const alpha = (renderAtMs - older.atMs) / span;

  const before = new Map<number, SpaceEntity>();
  for (const entity of older.entities) {
    before.set(entity.itemID, entity);
  }

  /**
   * ⚠ THE LIST COMES FROM THE NEWER SAMPLE, ALWAYS. It is the current truth
   * about WHAT EXISTS; the older one only supplies a starting point. Driving the
   * list from the older sample would keep drawing things that have since been
   * destroyed or warped off, and would never show anything that just arrived.
   */
  const entities = newer.entities.map((entity) => {
    const from = before.get(entity.itemID);
    if (!from) {
      // No history: it appeared between samples, so its measured position is
      // the only thing we know about it.
      return entity;
    }
    return { ...entity, position: lerpVector(from.position, entity.position, alpha) };
  });

  const origin =
    older.shipPosition && newer.shipPosition
      ? lerpVector(older.shipPosition, newer.shipPosition, alpha)
      : newestOrigin;

  return { entities, origin, mode: "interpolated" };
}
