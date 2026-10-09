// How many jumps away a system is, as the retail client's autopilot counts them.
//
// The client asks its pathfinder service (clientPathfinderService.GetAutopilotJumpCount), which plots a
// route with the pilot's autopilot settings and counts its jumps. Left as they come, those settings are
// (evePathfinder/stateinterface.py, pathfinderconst.py):
//
//   the route type   "safe": systems of security 0.45 to 1.0 are inside its limits
//   the penalty      50 on the settings' slider, which the pathfinder is given as exp(0.15 * 50)
//   avoided systems  Jita and Zarzakh, and avoiding is on
//
// The route itself is plotted by a native module (pyEvePathfinder), whose source is not among the
// client's scripts. What it does was measured by running that module, in the client's own Python, over
// made-up maps (the record is test/fixtures/autopilotRoute.json; scripts/build-autopilot-fixture.js makes
// it again):
//
//   - it is a least-cost flood from the start. Entering a system costs 0.9 inside the "safe" limits;
//     outside any limits it costs the penalty for a system above nought security and twice the penalty
//     for one at nought or below. The start costs nothing;
//   - the client has three more route types (core.ROUTE_TYPES): "shortest", which has no limits and
//     charges every system the same; "unsafe", 0.0 to 0.45, which its route panel offers as "prefer
//     less secure"; and "unsafe + zerosec", -1.0 to 0.45, which the panel does not offer. Inside limits
//     a system costs 0.9 and up to 0.1 more the further its security lies below the upper limit, as a
//     share of the limits' span; and for that a system of 0.45 or above counts as 1.0 and one above
//     nought as 0.45. A system is inside when its security is above the lower limit (as a single-
//     precision number, so that 0.45 itself is inside "safe") and no more than the upper;
//   - the sums are kept in single precision, and so is the penalty; the 0.9 is not, and is rounded with
//     each sum it goes into. That matters only where two routes cost the same on paper and differ in
//     jumps, which takes two low-security systems against one null-security system: which of them is
//     the cheaper then goes by how the sums round, and this rounds them as the module does;
//   - where two such routes cost the same after rounding too, the module's answer goes by the order it
//     was told of the map's jumps in (the same map shuffled gives another answer). Nothing here follows
//     that: the answer is then one of the module's own, and which one is not promised;
//   - an avoided system is never entered, unless it is where the route is going. A route that starts in
//     one leaves it as any other;
//   - the answer is the route found, or the number of jumps on it, and none at all where there is no
//     route. Among routes that cost the same and are as long, which one the module gives goes by the
//     order of the map too; the one given here costs what the module's does and is as long.
//
// The level a system is given is the one the client works with (pseudoSecurity, bridge/systemSecurity.ts).
//
// Not done: the avoidance lists other than the systems named (pod kills, Triglavian and EDENCOM systems),
// jump gates the pilot may use, systems the server has locked, and a level the server has changed for a
// time.

import { pseudoSecurity } from "../bridge/systemSecurity.ts";
import type { SystemGraph } from "./routeSolver.ts";

/** The map the pathfinder is given. */
export interface AutopilotMap {
  /** The systems a jump leads to from this one. */
  neighbors(systemID: number): Iterable<number>;
  /** The level a system has for the pathfinder; null for a system the map does not hold. */
  security(systemID: number): number | null;
}

/** The client's own names for its route types (pathfinderconst.py). */
export type AutopilotRouteType = "safe" | "unsafe" | "unsafe + zerosec" | "shortest";

export interface AutopilotSettings {
  /** pfRouteType. */
  readonly routeType: AutopilotRouteType;
  /** The security penalty as the settings' slider has it (pfPenalty): nought to a hundred. */
  readonly penalty: number;
  /** The systems the route may not pass through (autopilot_avoidance2, with avoiding on). */
  readonly avoid: readonly number[];
}

/**
 * The pathfinder's map from the page's own: every jump there is, and each system at the level the client
 * works with (clientPathfinderService.CreatePathfinderCore gives it securitySvc's level, which is
 * pseudoSecurity for a system the server has not changed).
 */
export function autopilotMap(graph: Pick<SystemGraph, "neighbors" | "security">): AutopilotMap {
  return {
    neighbors: (systemID) => graph.neighbors(systemID).map((edge) => edge.toSystemID),
    security: (systemID) => {
      const level = graph.security(systemID);
      return level === null ? null : pseudoSecurity(level);
    },
  };
}

/** inventorycommon.const: solarSystemJita and solarSystemZarzakh. */
export const SOLAR_SYSTEM_JITA = 30000142;
export const SOLAR_SYSTEM_ZARZAKH = 30100000;

/** The settings as the client has them before a pilot changes any. */
export const DEFAULT_AUTOPILOT_SETTINGS: AutopilotSettings = Object.freeze({
  routeType: "safe",
  penalty: 50,
  avoid: Object.freeze([SOLAR_SYSTEM_JITA, SOLAR_SYSTEM_ZARZAKH]),
});

/** pathfinderconst.SECURITY_PENALTY_FACTOR. */
const SECURITY_PENALTY_FACTOR = 0.15;
/** The security limits of each route type that has them (core.ROUTE_TYPES): lowest and highest. */
const LIMITS: Readonly<Record<Exclude<AutopilotRouteType, "shortest">, readonly [number, number]>> = Object.freeze({
  safe: [0.45, 1.0],
  unsafe: [0.0, 0.45],
  "unsafe + zerosec": [-1.0, 0.45],
});
/** What the pathfinder charges to enter a system at the top of the limits: in double precision, unlike the sums it is added to. */
const COST_INSIDE = 0.9;
/** How much more a system at the bottom of the limits costs. */
const COST_SPREAD = 0.1;

/** What it costs to enter a system of this security, with these settings. */
function costOfEntering(settings: AutopilotSettings): (security: number) => number {
  if (settings.routeType === "shortest") {
    return () => COST_INSIDE;
  }
  const [lowest, highest] = LIMITS[settings.routeType];
  const penalty = Math.fround(Math.exp(SECURITY_PENALTY_FACTOR * settings.penalty));
  return (security) => {
    if (Math.fround(lowest) < security && security <= highest) {
      const counted = security >= 0.45 ? 1.0 : security > 0 ? 0.45 : security;
      return COST_INSIDE + (COST_SPREAD * (highest - counted)) / (highest - lowest);
    }
    return security > 0 ? penalty : 2 * penalty;
  };
}

/** idCheckers.IsKnownSpaceSystem. */
export function isKnownSpaceSystem(systemID: number): boolean {
  return systemID >= 30_000_000 && systemID <= 30_999_999;
}

/** A least-first heap of systems by what it cost to reach them. */
class Frontier {
  private readonly costs: number[] = [];
  private readonly systems: number[] = [];

  get size(): number {
    return this.costs.length;
  }

  private before(a: number, b: number): boolean {
    return this.costs[a]! < this.costs[b]!;
  }

  private swap(a: number, b: number): void {
    for (const list of [this.costs, this.systems]) {
      const held = list[a]!;
      list[a] = list[b]!;
      list[b] = held;
    }
  }

  push(cost: number, system: number): void {
    let at = this.costs.length;
    this.costs.push(cost);
    this.systems.push(system);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.before(at, parent)) break;
      this.swap(at, parent);
      at = parent;
    }
  }

  pop(): { cost: number; system: number } {
    const least = { cost: this.costs[0]!, system: this.systems[0]! };
    const last = this.costs.length - 1;
    this.swap(0, last);
    this.costs.pop();
    this.systems.pop();
    let at = 0;
    for (;;) {
      const left = 2 * at + 1;
      const right = left + 1;
      let least = at;
      if (left < last && this.before(left, least)) least = left;
      if (right < last && this.before(right, least)) least = right;
      if (least === at) break;
      this.swap(at, least);
      at = least;
    }
    return least;
  }
}

/**
 * The jumps on the autopilot's route from one system to each of the others asked about: a number, or null
 * where there is no route (the client's UNREACHABLE_JUMP_COUNT). A system is nought jumps from itself; a
 * system outside known space, either end, has no route (ClientPathfinder._GetJumpCount).
 */
export function autopilotJumpCounts(map: AutopilotMap, fromID: number, toIDs: readonly number[], settings: AutopilotSettings = DEFAULT_AUTOPILOT_SETTINGS): Map<number, number | null> {
  const counts = new Map<number, number | null>();
  const avoided = new Set(settings.avoid);
  let open: Map<number, number> | null = null;
  const jumpsOf = (path: readonly number[] | null): number | null => (path === null ? null : path.length - 1);
  for (const toID of toIDs) {
    if (toID === fromID) {
      counts.set(toID, 0);
    } else if (!isKnownSpaceSystem(fromID) || !isKnownSpaceSystem(toID)) {
      counts.set(toID, null);
    } else if (avoided.has(toID)) {
      // A route may end in an avoided system, and only that one's flood may enter it.
      counts.set(toID, jumpsOf(pathBack(flood(map, fromID, settings, avoided, toID), fromID, toID)));
    } else {
      open ??= flood(map, fromID, settings, avoided, null);
      counts.set(toID, jumpsOf(pathBack(open, fromID, toID)));
    }
  }
  return counts;
}

/**
 * The systems on the autopilot's route from one system to another, both ends with them
 * (clientPathfinderService.GetAutopilotPathBetween); null where there is no route. A route from a system to
 * itself is that system alone.
 */
export function autopilotPath(map: AutopilotMap, fromID: number, toID: number, settings: AutopilotSettings = DEFAULT_AUTOPILOT_SETTINGS): number[] | null {
  if (toID === fromID) {
    return [fromID];
  }
  if (!isKnownSpaceSystem(fromID) || !isKnownSpaceSystem(toID)) {
    return null;
  }
  const avoided = new Set(settings.avoid);
  return pathBack(flood(map, fromID, settings, avoided, avoided.has(toID) ? toID : null), fromID, toID);
}

/** The way from the start to another system, read back along the systems each was entered from; null for one the flood did not enter. */
function pathBack(reachedFrom: ReadonlyMap<number, number>, fromID: number, toID: number): number[] | null {
  if (!reachedFrom.has(toID)) {
    return null;
  }
  const path = [toID];
  for (let at = toID; at !== fromID; ) {
    at = reachedFrom.get(at)!;
    path.push(at);
  }
  return path.reverse();
}

/**
 * The jumps on the autopilot's route from one system to every system it can reach, itself among them at
 * nought. A system that is not there has no route. An avoided system is there when a route may end in it.
 */
export function autopilotDistances(map: AutopilotMap, fromID: number, settings: AutopilotSettings = DEFAULT_AUTOPILOT_SETTINGS): Map<number, number> {
  const distances = new Map<number, number>([[fromID, 0]]);
  if (!isKnownSpaceSystem(fromID)) {
    return distances;
  }
  const avoided = new Set(settings.avoid);
  const open = flood(map, fromID, settings, avoided, null);
  for (const toID of open.keys()) {
    if (isKnownSpaceSystem(toID)) {
      distances.set(toID, pathBack(open, fromID, toID)!.length - 1);
    }
  }
  // Each avoided system is gone to by a flood of its own: only that one may enter it.
  for (const toID of avoided) {
    const path = !isKnownSpaceSystem(toID) ? null : pathBack(flood(map, fromID, settings, avoided, toID), fromID, toID);
    if (path !== null) {
      distances.set(toID, path.length - 1);
    }
  }
  return distances;
}

/** The jumps on the autopilot's route between two systems; null where there is no route. */
export function autopilotJumpCount(map: AutopilotMap, fromID: number, toID: number, settings: AutopilotSettings = DEFAULT_AUTOPILOT_SETTINGS): number | null {
  return autopilotJumpCounts(map, fromID, [toID], settings).get(toID) ?? null;
}

/** Every system the flood enters, each with the system it was entered from. */
function flood(map: AutopilotMap, fromID: number, settings: AutopilotSettings, avoided: ReadonlySet<number>, goalID: number | null): Map<number, number> {
  const entering = costOfEntering(settings);
  const reachedFrom = new Map<number, number>();
  const frontier = new Frontier();
  frontier.push(0, fromID);
  while (frontier.size > 0) {
    const { cost: reached, system } = frontier.pop();
    for (const next of map.neighbors(system)) {
      // A system costs the same to enter from anywhere, and the cheapest reached are followed first: the
      // first way found into a system is a cheapest one, and is the one kept.
      if (reachedFrom.has(next) || (avoided.has(next) && next !== goalID)) {
        continue;
      }
      const security = map.security(next);
      if (security === null) {
        continue;
      }
      reachedFrom.set(next, system);
      frontier.push(Math.fround(reached + entering(security)), next);
    }
  }
  return reachedFrom;
}
