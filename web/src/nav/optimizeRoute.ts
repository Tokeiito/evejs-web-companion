// The route panel's Optimize Route, as the client's autopilot does it (autopilot.py OptimizeRoute, 644 to 755):
//
//   the waypoints, the last of them that is the pilot's own system taken off (a return trip, put back at the end
//   after); each station or structure stood for by its system, its stations kept by system in their order; the
//   systems made a set (Python's own order, which decides between routes of the same length) and the pilot's system
//   taken out of it; nothing to do where none is left. Over ten of them, the pilot is asked first. Then every order
//   of them is tried from the pilot's system, depth first in the set's order, a route kept only where it is shorter
//   than the best so far (the jumps between two systems the autopilot's own count, asked "to" before "from"), and the
//   systems given back their stations.
//
// The set's order is CPython 2.7's for whole numbers (setobject.c: an 8-slot table that grows to four times its
// entries when two thirds full, each number at its hash, which is itself, probed on with the perturbation), checked
// against the client's own Python.

/** pathfinderconst.UNREACHABLE_JUMP_COUNT: the autopilot's count where no route reaches. */
export const UNREACHABLE_JUMP_COUNT = 2147483647;

const MASK_64 = (1n << 64n) - 1n;

/** CPython 2.7's set(list) of whole numbers, as list() reads it back: the order of its table. */
export function py27IntSetOrder(values: readonly number[]): number[] {
  let mask = 7n;
  let table: (bigint | null)[] = new Array(8).fill(null);
  let fill = 0;
  const slotOf = (key: bigint, keys: (bigint | null)[], m: bigint, clean: boolean): number => {
    // (set_lookkey and set_insert_clean: i = hash & mask, then i = (i << 2) + i + perturb + 1, perturb >>= 5.)
    let i = key & m;
    let index = Number(i);
    if (keys[index] === null || (!clean && keys[index] === key)) return index;
    for (let perturb = key & MASK_64; ; perturb >>= 5n) {
      i = ((i << 2n) + i + perturb + 1n) & MASK_64;
      index = Number(i & m);
      if (keys[index] === null || (!clean && keys[index] === key)) return index;
    }
  };
  for (const value of values) {
    const key = BigInt(value);
    const index = slotOf(key, table, mask, false);
    if (table[index] === key) continue;
    table[index] = key;
    fill += 1;
    // set_insert_key, then: used > n_used and fill*3 >= (mask+1)*2 grows the table to the least power of two above
    // used*4 (no deletions here, so used is fill).
    if (fill * 3 >= Number(mask + 1n) * 2) {
      let size = 8;
      while (size <= fill * 4) size *= 2;
      const grown: (bigint | null)[] = new Array(size).fill(null);
      const grownMask = BigInt(size - 1);
      for (const kept of table) {
        if (kept !== null) grown[slotOf(kept, grown, grownMask, true)] = kept;
      }
      table = grown;
      mask = grownMask;
    }
  }
  return table.filter((key): key is bigint => key !== null).map((key) => Number(key));
}

/** What Optimize Route needs of the waypoints before asking: the systems to order, and how to give them back. */
export interface RouteToOptimize {
  readonly systems: readonly number[];
  readonly stationsBySystem: ReadonlyMap<number, readonly number[]>;
  readonly isReturnTrip: boolean;
  readonly originalCount: number;
}

const isSolarSystem = (id: number): boolean => id >= 30_000_000 && id < 33_000_000;

/** OptimizeRoute's preparation (650 to 674); null where nothing is left to order. */
export function routeToOptimize(waypoints: readonly number[], currentSystemID: number, systemOf: (id: number) => number | null): RouteToOptimize | null {
  const list = [...waypoints];
  let isReturnTrip = false;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index] === currentSystemID) {
      list.splice(index, 1);
      isReturnTrip = true;
      break;
    }
  }
  const stationsBySystem = new Map<number, number[]>();
  for (let index = 0; index < list.length; index += 1) {
    const waypoint = list[index]!;
    if (!isSolarSystem(waypoint)) {
      const system = systemOf(waypoint);
      if (system === null) return null;
      stationsBySystem.set(system, [...(stationsBySystem.get(system) ?? []), waypoint]);
      list[index] = system;
    }
  }
  const systems = py27IntSetOrder(list).filter((id) => id !== currentSystemID);
  if (systems.length === 0) return null;
  return { systems, stationsBySystem, isReturnTrip, originalCount: waypoints.length };
}

/**
 * OptimizeRoute's search and its giving back (684 to 753): the waypoints in their new order, or "unreachable" where
 * no order is shorter than the search's first bound (UserError AutoPilotDisabledUnreachable).
 */
export function optimizedWaypoints(
  route: RouteToOptimize,
  currentSystemID: number,
  jumpCount: (fromID: number, toID: number) => number,
): readonly number[] | "unreachable" {
  const waypoints: (number | null)[] = [...route.systems];
  const numWaypoints = waypoints.length;
  const distance = new Map<number, Map<number, number>>();
  const all = [...route.systems, currentSystemID];
  for (const fromID of all) {
    const row = new Map<number, number>();
    for (const toID of all) {
      if (fromID !== toID) row.set(toID, jumpCount(toID, fromID));
    }
    distance.set(fromID, row);
  }
  const prefix: (number | null)[] = [null];
  let shortest: { dist: number; prefix: (number | null)[] | null; last: number | null } = { dist: 999999999, prefix: null, last: null };
  const indexes = waypoints.map((_, index) => index);
  const find = (distanceSoFar: number, toID: number): void => {
    const distanceTo = distance.get(toID)!;
    prefix[prefix.length - 1] = toID;
    let shortestDist = shortest.dist;
    if (prefix.length < numWaypoints) {
      prefix.push(null);
      for (const index of indexes) {
        const next = waypoints[index];
        if (!next) continue;
        const candidate = distanceSoFar + distanceTo.get(next)!;
        if (candidate >= shortestDist) continue;
        waypoints[index] = null;
        find(candidate, next);
        waypoints[index] = next;
      }
      prefix.pop();
    } else {
      for (const index of indexes) {
        const next = waypoints[index];
        if (!next) continue;
        const candidate = distanceSoFar + distanceTo.get(next)!;
        if (candidate < shortestDist) {
          shortest = { dist: candidate, prefix: [...prefix], last: next };
          shortestDist = candidate;
        }
      }
    }
  };
  find(0, currentSystemID);
  if (shortest.prefix === null || shortest.last === null) return "unreachable";
  let ordered = shortest.prefix as number[];
  if (ordered[0] === currentSystemID) ordered = ordered.slice(1);
  ordered = [...ordered, shortest.last];
  const withStations: number[] = [];
  for (const waypoint of ordered) {
    const stations = route.stationsBySystem.get(waypoint);
    if (stations !== undefined) withStations.push(...stations);
    else withStations.push(waypoint);
  }
  return route.isReturnTrip ? [...withStations, currentSystemID] : withStations;
}
