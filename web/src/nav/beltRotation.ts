// A4c (pure part) — the mine-at-belt macro's two pieces the existing loops do
// NOT already have: rotating to the next belt when one is mined dry (decision 2),
// and the arming predicate that keeps a player `until` from reading true before
// the ship has arrived (the belt-empty-on-tick-one guard).
//
// The rest of mine-at-belt — lock a rock, run the lasers, defend, haul — is the
// proven `decideMiningAction` ladder, wrapped by the macro adapter in slice B.
// What lives HERE is only the new logic, pure and testable on its own.

import { BELT_ARRIVAL_RADIUS_M } from "./miningBotLoop.ts";

// ─── Belt rotation (decision 2) ──────────────────────────────────────────────
//
// The hand-written mining bot works ONE chosen belt and pauses when it runs dry
// ("do not wander"). A player bot handed "the nearest belt" should keep working
// the field: when a belt is mined out, move to the next one, and pause only when
// EVERY belt in the system has been visited and found empty — a finite, bounded
// rotation.

/** One belt the ship could work, as the runtime sees it on the grid. */
export interface BeltOption {
  readonly id: number;
  readonly name: string | null;
  /** Surface distance in metres, or null when it could not be measured. */
  readonly distance: number | null;
}

/**
 * What the macro remembers about the rotation, across ticks.
 *
 * `current` is the belt being worked now; `emptied` are the belts already found
 * dry this run, in the order they were emptied. Both reset when a fresh run
 * starts. Belt ids never reach a screen (R7d) — they are handles for the macro.
 */
export interface BeltRotation {
  readonly current: number | null;
  readonly emptied: readonly number[];
}

export const EMPTY_ROTATION: BeltRotation = Object.freeze({ current: null, emptied: [] });

function rank(belt: BeltOption): number {
  return belt.distance ?? Number.POSITIVE_INFINITY;
}

/**
 * The nearest belt not already emptied this run, or null when there is none.
 * Unknown distances sort last; ties break by id so the choice is deterministic.
 */
export function nearestUnworkedBelt(
  belts: readonly BeltOption[],
  emptied: ReadonlySet<number>,
): BeltOption | null {
  const candidates = belts.filter((belt) => !emptied.has(belt.id));
  if (candidates.length === 0) {
    return null;
  }
  return (
    candidates.slice().sort((a, b) => rank(a) - rank(b) || a.id - b.id)[0] ?? null
  );
}

/** What the macro should do about belts this tick. */
export type BeltChoice =
  | { readonly kind: "work"; readonly belt: BeltOption }
  | { readonly kind: "exhausted" };

/**
 * Choose the belt to work: keep the current one while it is still on the grid and
 * not yet emptied, otherwise rotate to the nearest unworked belt. `exhausted`
 * when every belt has been emptied — the runner pauses on it with a plain reason.
 */
export function chooseBelt(belts: readonly BeltOption[], rotation: BeltRotation): BeltChoice {
  const emptied = new Set(rotation.emptied);
  if (rotation.current !== null && !emptied.has(rotation.current)) {
    const current = belts.find((belt) => belt.id === rotation.current);
    if (current !== undefined) {
      return { kind: "work", belt: current };
    }
  }
  const next = nearestUnworkedBelt(belts, emptied);
  return next !== null ? { kind: "work", belt: next } : { kind: "exhausted" };
}

/** Record that the ship has settled on working a belt. */
export function workBelt(rotation: BeltRotation, beltID: number): BeltRotation {
  return rotation.current === beltID ? rotation : { ...rotation, current: beltID };
}

/** Record that the current belt is mined out, and stop pointing at it. */
export function emptyCurrent(rotation: BeltRotation): BeltRotation {
  if (rotation.current === null) {
    return rotation;
  }
  const emptied = rotation.emptied.includes(rotation.current)
    ? rotation.emptied
    : [...rotation.emptied, rotation.current];
  return { current: null, emptied };
}

// ─── Arming (the belt-empty-on-tick-one guard) ───────────────────────────────

/** What the arming check needs to know — a slice of the world, all nullable. */
export interface ArrivalReads {
  readonly inSpace: boolean | null;
  readonly inWarp: boolean | null;
  /** Surface distance to the belt being worked, in metres. */
  readonly distanceToBeltM: number | null;
}

/**
 * Is mine-at-belt ARMED — i.e. has the ship actually arrived, so a player `until`
 * ("the ore hold is full") may be trusted?
 *
 * ⚠ ANY UNKNOWN IS NOT ARMED. The ship must be definitely in space, definitely
 * not in warp, and definitely inside the belt-arrival radius. This is the guard
 * that stops "no rocks here / hold not filling" from reading as a finished step
 * while the belt is not even on the grid yet — the tick-one trap the whole
 * sub-ladder investigation exists to prevent.
 */
export function mineArmed(reads: ArrivalReads): boolean {
  if (reads.inSpace !== true) {
    return false;
  }
  if (reads.inWarp !== false) {
    return false;
  }
  if (reads.distanceToBeltM === null) {
    return false;
  }
  return reads.distanceToBeltM <= BELT_ARRIVAL_RADIUS_M;
}
