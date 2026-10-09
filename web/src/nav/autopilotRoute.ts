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
//   - it is a least-cost flood from the start. Entering a system costs 0.9 inside the limits; outside them
//     it costs the penalty for a system above nought security and twice the penalty for one at nought or
//     below. The start costs nothing;
//   - the sums are kept in single precision, and so is the penalty; the 0.9 is not, and is rounded with
//     each sum it goes into. That matters only where two routes cost the same on paper and differ in
//     jumps, which takes two low-security systems against one null-security system: which of them is
//     the cheaper then goes by how the sums round, and this rounds them as the module does;
//   - where two such routes cost the same after rounding too, the module's answer goes by the order it
//     was told of the map's jumps in (the same map shuffled gives another answer). Nothing here follows
//     that: the answer is then one of the module's own, and which one is not promised;
//   - an avoided system is never entered, unless it is where the route is going. A route that starts in
//     one leaves it as any other;
//   - the answer is the number of jumps on the route found, and none at all where there is no route.
//
// The level a system is given is the one the client works with (pseudoSecurity, bridge/systemSecurity.ts).
//
// Not done: the other route types ("unsafe", "unsafe + zerosec": inside their limits a system's cost was
// measured to vary with its security, and was not followed through; "shortest"), the pilot's own avoided
// systems and its other avoidance lists, jump gates the pilot may use, systems the server has locked, and
// a level the server has changed for a time.

import { pseudoSecurity } from "../bridge/systemSecurity.ts";
import type { SystemGraph } from "./routeSolver.ts";

/** The map the pathfinder is given. */
export interface AutopilotMap {
  /** The systems a jump leads to from this one. */
  neighbors(systemID: number): Iterable<number>;
  /** The level a system has for the pathfinder; null for a system the map does not hold. */
  security(systemID: number): number | null;
}

export interface AutopilotSettings {
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
  penalty: 50,
  avoid: Object.freeze([SOLAR_SYSTEM_JITA, SOLAR_SYSTEM_ZARZAKH]),
});

/** pathfinderconst.SECURITY_PENALTY_FACTOR. */
const SECURITY_PENALTY_FACTOR = 0.15;
/** The lower limit of the "safe" route type (core.ROUTE_TYPES); its upper limit, 1.0, is every system's. */
const SAFE_MINIMUM_SECURITY = 0.45;
/** What the pathfinder charges to enter a system inside the limits: in double precision, unlike the sums it is added to. */
const COST_INSIDE = 0.9;

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
  for (const toID of toIDs) {
    if (toID === fromID) {
      counts.set(toID, 0);
    } else if (!isKnownSpaceSystem(fromID) || !isKnownSpaceSystem(toID)) {
      counts.set(toID, null);
    } else if (avoided.has(toID)) {
      // A route may end in an avoided system, and only that one's flood may enter it.
      counts.set(toID, flood(map, fromID, settings, avoided, toID).get(toID) ?? null);
    } else {
      open ??= flood(map, fromID, settings, avoided, null);
      counts.set(toID, open.get(toID) ?? null);
    }
  }
  return counts;
}

/** The jumps on the autopilot's route between two systems; null where there is no route. */
export function autopilotJumpCount(map: AutopilotMap, fromID: number, toID: number, settings: AutopilotSettings = DEFAULT_AUTOPILOT_SETTINGS): number | null {
  return autopilotJumpCounts(map, fromID, [toID], settings).get(toID) ?? null;
}

/** The jumps to every system the flood reaches from the start. */
function flood(map: AutopilotMap, fromID: number, settings: AutopilotSettings, avoided: ReadonlySet<number>, goalID: number | null): Map<number, number> {
  const penalty = Math.fround(Math.exp(SECURITY_PENALTY_FACTOR * settings.penalty));
  const costOf = (systemID: number): number | null => {
    const security = map.security(systemID);
    if (security === null) return null;
    if (security >= SAFE_MINIMUM_SECURITY) return COST_INSIDE;
    return security > 0 ? penalty : 2 * penalty;
  };
  const jumps = new Map<number, number>([[fromID, 0]]);
  const frontier = new Frontier();
  frontier.push(0, fromID);
  while (frontier.size > 0) {
    const { cost: reached, system } = frontier.pop();
    for (const next of map.neighbors(system)) {
      // A system costs the same to enter from anywhere, and the cheapest reached are followed first: the
      // first way found into a system is a cheapest one, and is the one kept.
      if (jumps.has(next) || (avoided.has(next) && next !== goalID)) {
        continue;
      }
      const entering = costOf(next);
      if (entering === null) {
        continue;
      }
      jumps.set(next, jumps.get(system)! + 1);
      frontier.push(Math.fround(reached + entering), next);
    }
  }
  return jumps;
}
