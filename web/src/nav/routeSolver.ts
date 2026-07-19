// Client-side route solver (goal R5b, roadmap §7 / G2). Retail's autopilot
// solves the jump route locally from the client's static map DB
// (clientPathfinderService) — there is NO wire call to the game server for a
// route. We mirror that: the browser holds a system-adjacency graph (served as
// read-only static reference data by the BFF from src/staticData.js, exactly
// like station names stay client-local) and runs this pure solver over it.
//
// The adjacency comes from the EveJS gameStore `stargates` table: each stargate
// record is one DIRECTED edge — {solarSystemID (from), destinationSolarSystemID
// (to), itemID (the source gate to warp to and jump through), destinationID
// (the gate on the other side)}. That is exactly the pair
// `beyonce.CmdStargateJump(fromGateID, toGateID, shipID)` wants (R5a): fromGate
// = the source gate itemID, toGate = destinationID. This is the same shape
// autopilot.py derives from `cfg.mapSolarSystemContentCache[sys].stargates`
// (`sg.destination`) in `_GetGateIDToSolarsystem` / `GetGateOrStation`.

/**
 * One hop of a computed route: from `fromSystemID` to the adjacent
 * `toSystemID`. `gateToWarpID` is the source stargate in `fromSystemID` — the
 * autopilot warps to it (`CmdWarpToStuffAutopilot`) and then jumps through it;
 * `jumpToGateID` is the destination stargate in `toSystemID` (the `toGate` of
 * `CmdStargateJump`).
 */
export interface RouteHop {
  readonly fromSystemID: number;
  readonly toSystemID: number;
  readonly gateToWarpID: number;
  readonly jumpToGateID: number;
}

/** One directed stargate edge out of a system (as the graph stores it). */
export interface SystemEdge {
  readonly toSystemID: number;
  /** The stargate in the source system (warp to it, then jump through it). */
  readonly gateID: number;
  /** The stargate on the other side (the CmdStargateJump toGate). */
  readonly destinationGateID: number;
}

/**
 * The wire shape the BFF serves at GET /api/map/graph. Compact on purpose (the
 * full New Eden gate graph is ~14k edges): `edges` is a flat array of
 * `[fromSystemID, toSystemID, fromGateID, toGateID]` tuples, `systems` maps a
 * system ID (as a string key) to its name (for the panel readout only).
 */
export interface SystemGraphData {
  readonly systems: Readonly<Record<string, string>>;
  readonly edges: ReadonlyArray<readonly [number, number, number, number]>;
}

/** A built, queryable system-adjacency graph. */
export interface SystemGraph {
  hasSystem(systemID: number): boolean;
  systemName(systemID: number): string | null;
  neighbors(systemID: number): readonly SystemEdge[];
  readonly systemCount: number;
  readonly edgeCount: number;
}

/**
 * Build the queryable graph from the served payload. A system is "known" if it
 * has a name entry OR appears as the endpoint of any edge, so a route can start
 * or end anywhere the gate network reaches even if a name is missing.
 */
export function buildSystemGraph(data: SystemGraphData): SystemGraph {
  const adjacency = new Map<number, SystemEdge[]>();
  const known = new Set<number>();
  const names = new Map<number, string>();

  for (const [key, name] of Object.entries(data.systems ?? {})) {
    const id = Number(key);
    if (Number.isFinite(id) && id > 0) {
      known.add(id);
      if (typeof name === "string" && name.length > 0) {
        names.set(id, name);
      }
    }
  }

  let edgeCount = 0;
  for (const edge of data.edges ?? []) {
    const fromSystemID = Number(edge[0]);
    const toSystemID = Number(edge[1]);
    const gateID = Number(edge[2]);
    const destinationGateID = Number(edge[3]);
    if (!(fromSystemID > 0) || !(toSystemID > 0) || !(gateID > 0)) {
      continue;
    }
    known.add(fromSystemID);
    known.add(toSystemID);
    let list = adjacency.get(fromSystemID);
    if (!list) {
      list = [];
      adjacency.set(fromSystemID, list);
    }
    list.push({ toSystemID, gateID, destinationGateID });
    edgeCount += 1;
  }

  return {
    hasSystem: (systemID) => known.has(systemID),
    systemName: (systemID) => names.get(systemID) ?? null,
    neighbors: (systemID) => adjacency.get(systemID) ?? [],
    systemCount: known.size,
    edgeCount,
  };
}

/** A computed route: the ordered hops plus the ordered systems it passes through. */
export interface RouteResult {
  /** True when a path exists (empty `hops` with `reachable:true` means same-system). */
  readonly reachable: boolean;
  /** The ordered hops (empty when origin === destination). */
  readonly hops: readonly RouteHop[];
  /** The ordered systems from origin to destination inclusive. */
  readonly systems: readonly number[];
  /** Number of jumps (== hops.length). */
  readonly jumps: number;
}

const UNREACHABLE = (fromSystemID: number): RouteResult =>
  Object.freeze({ reachable: false, hops: [], systems: [fromSystemID], jumps: 0 });

/**
 * Shortest-hop route (breadth-first, so fewest jumps) from `fromSystemID` to
 * `toSystemID` over the gate graph. Degenerate cases are explicit:
 *  - same system: `{ reachable:true, hops:[], systems:[from], jumps:0 }`
 *  - adjacent: one hop
 *  - unreachable (or unknown endpoint): `{ reachable:false, hops:[], ... }`
 *
 * This is hop-count-optimal, not security-weighted — R5b travels a route; the
 * safety/avoidance weighting retail's pathfinder layers on is out of scope.
 */
export function solveRoute(
  graph: SystemGraph,
  fromSystemID: number,
  toSystemID: number,
): RouteResult {
  if (!(fromSystemID > 0) || !(toSystemID > 0)) {
    return UNREACHABLE(fromSystemID);
  }
  if (fromSystemID === toSystemID) {
    return Object.freeze({
      reachable: true,
      hops: [],
      systems: [fromSystemID],
      jumps: 0,
    });
  }
  if (!graph.hasSystem(fromSystemID) || !graph.hasSystem(toSystemID)) {
    return UNREACHABLE(fromSystemID);
  }

  // BFS, recording the edge used to first reach each system.
  const cameFrom = new Map<number, { readonly system: number; readonly edge: SystemEdge }>();
  const visited = new Set<number>([fromSystemID]);
  const queue: number[] = [fromSystemID];
  let found = false;

  while (queue.length > 0) {
    const current = queue.shift() as number;
    if (current === toSystemID) {
      found = true;
      break;
    }
    for (const edge of graph.neighbors(current)) {
      if (!visited.has(edge.toSystemID)) {
        visited.add(edge.toSystemID);
        cameFrom.set(edge.toSystemID, { system: current, edge });
        queue.push(edge.toSystemID);
      }
    }
  }

  if (!found && !cameFrom.has(toSystemID)) {
    return UNREACHABLE(fromSystemID);
  }

  // Walk the predecessor chain back from the destination and reverse it.
  const hops: RouteHop[] = [];
  let cursor = toSystemID;
  while (cursor !== fromSystemID) {
    const step = cameFrom.get(cursor);
    if (!step) {
      return UNREACHABLE(fromSystemID);
    }
    hops.unshift({
      fromSystemID: step.system,
      toSystemID: cursor,
      gateToWarpID: step.edge.gateID,
      jumpToGateID: step.edge.destinationGateID,
    });
    cursor = step.system;
  }

  const systems = [fromSystemID, ...hops.map((hop) => hop.toSystemID)];
  return Object.freeze({ reachable: true, hops, systems, jumps: hops.length });
}

/**
 * Jump distance (fewest hops) from `originSystemID` to every reachable system,
 * computed in a SINGLE breadth-first sweep over the gate graph (goal R6a). The
 * Agent Finder sorts agents by their system's distance from the player's
 * current system; running one `solveRoute` per agent would re-BFS thousands of
 * times, so this does the work once and the finder looks each system up.
 *
 * The returned map holds `origin -> 0` and one entry per reachable system.
 * A system NOT in the map is unreachable (or the graph doesn't reach it) — the
 * finder flags those and sorts them last. An invalid/unknown origin yields an
 * empty map (every agent then reads as unreachable), never a throw.
 */
export function distancesFrom(
  graph: SystemGraph,
  originSystemID: number,
): Map<number, number> {
  const distances = new Map<number, number>();
  if (!(originSystemID > 0) || !graph.hasSystem(originSystemID)) {
    return distances;
  }
  distances.set(originSystemID, 0);
  // A plain array with a moving head index is an O(1) queue (no shift() churn),
  // which matters over the full ~5k-system / ~14k-edge New Eden graph.
  const queue: number[] = [originSystemID];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++] as number;
    const nextDistance = (distances.get(current) as number) + 1;
    for (const edge of graph.neighbors(current)) {
      if (!distances.has(edge.toSystemID)) {
        distances.set(edge.toSystemID, nextDistance);
        queue.push(edge.toSystemID);
      }
    }
  }
  return distances;
}
