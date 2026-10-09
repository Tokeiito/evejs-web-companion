// The pilot's standings, kept as the server changes them.
//
// The retail client reads the pilot's standings once (standingsvc.__RefreshStandings) and after that
// changes what it holds from what the server says, without asking again (standingsvc.py 41 to 90):
//
//   OnStandingSet(fromID, toID, standing)   the standing an NPC owner has towards the pilot is this now;
//                                           nothing, or nought, and the owner is dropped from the list
//   OnStandingsModified(modifications)      each (fromID, toID, rawChange, minAbs, maxAbs) moves the standing
//                                           the pilot holds with that owner by a share of what is left to
//                                           the end of the scale (standingUtil.CalculateStandingsByRawChange),
//                                           or starts one at ten times the change for an owner not yet listed
//
// Only the pilot's own standings are kept here. The client keeps its corporation's the same way.

import type { CharStanding } from "../store/types.ts";
import { unwrapLong, unwrapReal } from "./wire.ts";

const MAX_STANDING = 10;
const MIN_STANDING = -10;

/** idCheckers.IsNPC: above the system's own items and below the first player owner. */
const isNPC = (ownerID: number): boolean => ownerID > 9999 && ownerID < 90_000_000;

const whole = (value: unknown): number | null => {
  const long = unwrapLong(value);
  return long === null ? null : Number(long);
};
/** The items of a tuple or a list, wrapped or bare; [] for anything else. */
const items = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown }).items) ? (value as { items: unknown[] }).items : [];

/**
 * standingUtil.CalculateStandingsByRawChange. The client first asks whether the standing is already at the
 * end it is moving towards, and leaves it if so; the sums below give that same answer there, so they stand alone.
 */
export function standingByRawChange(current: number, rawChange: number): number {
  return rawChange > 0
    ? Math.min(MAX_STANDING, 10 * (1 - (1 - current / 10) * (1 - rawChange)))
    : Math.max(MIN_STANDING, 10 * (current / 10 + (1 + current / 10) * rawChange));
}

/** standingUtil.CalculateNewStandings: a first standing, from the change alone. */
export function newStanding(rawChange: number): number {
  return Math.max(Math.min(10 * rawChange, MAX_STANDING), MIN_STANDING);
}

const withStanding = (held: readonly CharStanding[], fromID: number, standing: number): CharStanding[] =>
  held.some((row) => row.fromID === fromID) ? held.map((row) => (row.fromID === fromID ? { fromID, standing } : row)) : [...held, { fromID, standing }];

/**
 * The pilot's standings after one of the two notifications; `held` itself when the notification is not
 * about them (another notification, another pilot, the corporation, or an owner that is not an NPC).
 */
export function standingsAfter(held: readonly CharStanding[], method: string | null, args: readonly unknown[], characterID: number | null): readonly CharStanding[] {
  if (characterID === null) {
    return held;
  }
  if (method === "OnStandingSet") {
    const fromID = whole(args[0]);
    if (fromID === null || !isNPC(fromID) || whole(args[1]) !== characterID) {
      return held;
    }
    const standing = unwrapReal(args[2]);
    // The client's "not standing": none sent, or nought.
    return standing === null || standing === 0 ? held.filter((row) => row.fromID !== fromID) : withStanding(held, fromID, standing);
  }
  if (method === "OnStandingsModified") {
    let next = held;
    for (const modification of items(args[0])) {
      const [from, to, change] = items(modification);
      const fromID = whole(from);
      const rawChange = unwrapReal(change);
      if (fromID === null || rawChange === null || whole(to) !== characterID) {
        continue;
      }
      const current = next.find((row) => row.fromID === fromID);
      next = withStanding(next, fromID, current === undefined ? newStanding(rawChange) : standingByRawChange(current.standing, rawChange));
    }
    return next;
  }
  return held;
}
