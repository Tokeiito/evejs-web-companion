// Route solver (goal R5b): a fixture adjacency -> a known multi-hop route, plus
// the degenerate cases the goal calls out (same-system, unreachable, adjacent).
// The fixture mirrors the real gameStore stargate shape: each edge is
// [fromSystemID, toSystemID, fromGateID (warp+jump source), toGateID].

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSystemGraph,
  distancesFrom,
  solveRoute,
  type SystemGraphData,
} from "./routeSolver.ts";

// A small line-plus-branch map:
//   A(1) <-> B(2) <-> C(3) <-> D(4)
//                      C(3) <-> E(5)          (branch)
//   F(6) is isolated (no gates)
// Gate IDs follow a memorable convention: gate in system X toward Y is X0Y.
const FIXTURE: SystemGraphData = {
  systems: { "1": "Alpha", "2": "Bravo", "3": "Charlie", "4": "Delta", "5": "Echo", "6": "Foxtrot" },
  edges: [
    [1, 2, 102, 201],
    [2, 1, 201, 102],
    [2, 3, 203, 302],
    [3, 2, 302, 203],
    [3, 4, 304, 403],
    [4, 3, 403, 304],
    [3, 5, 305, 503],
    [5, 3, 503, 305],
  ],
};

test("buildSystemGraph indexes systems and directed edges", () => {
  const graph = buildSystemGraph(FIXTURE);
  assert.equal(graph.systemCount, 6);
  assert.equal(graph.edgeCount, 8);
  assert.equal(graph.hasSystem(1), true);
  assert.equal(graph.hasSystem(999), false);
  assert.equal(graph.systemName(3), "Charlie");
  const fromB = graph.neighbors(2).map((e) => e.toSystemID).sort();
  assert.deepEqual(fromB, [1, 3]);
});

test("solveRoute finds a known multi-hop route with the right gates per hop", () => {
  const graph = buildSystemGraph(FIXTURE);
  const route = solveRoute(graph, 1, 4); // Alpha -> Delta, 3 jumps A-B-C-D
  assert.equal(route.reachable, true);
  assert.equal(route.jumps, 3);
  assert.deepEqual(route.systems, [1, 2, 3, 4]);
  assert.deepEqual(
    route.hops.map((h) => [h.fromSystemID, h.toSystemID, h.gateToWarpID, h.jumpToGateID]),
    [
      [1, 2, 102, 201],
      [2, 3, 203, 302],
      [3, 4, 304, 403],
    ],
  );
});

test("solveRoute picks the fewest-jumps branch", () => {
  const graph = buildSystemGraph(FIXTURE);
  const route = solveRoute(graph, 1, 5); // Alpha -> Echo, A-B-C-E
  assert.equal(route.jumps, 3);
  assert.deepEqual(route.systems, [1, 2, 3, 5]);
  assert.equal(route.hops[2]?.toSystemID, 5);
  assert.equal(route.hops[2]?.gateToWarpID, 305);
  assert.equal(route.hops[2]?.jumpToGateID, 503);
});

test("solveRoute: adjacent systems are a single hop", () => {
  const graph = buildSystemGraph(FIXTURE);
  const route = solveRoute(graph, 3, 4);
  assert.equal(route.reachable, true);
  assert.equal(route.jumps, 1);
  assert.deepEqual(route.hops[0], {
    fromSystemID: 3,
    toSystemID: 4,
    gateToWarpID: 304,
    jumpToGateID: 403,
  });
});

test("solveRoute: same-system destination is reachable with zero hops", () => {
  const graph = buildSystemGraph(FIXTURE);
  const route = solveRoute(graph, 3, 3);
  assert.equal(route.reachable, true);
  assert.equal(route.jumps, 0);
  assert.deepEqual(route.hops, []);
  assert.deepEqual(route.systems, [3]);
});

test("solveRoute: unreachable destination reports reachable:false", () => {
  const graph = buildSystemGraph(FIXTURE);
  const isolated = solveRoute(graph, 1, 6); // Foxtrot has no gates
  assert.equal(isolated.reachable, false);
  assert.equal(isolated.jumps, 0);
  const unknown = solveRoute(graph, 1, 12345); // system not in the graph
  assert.equal(unknown.reachable, false);
});

test("solveRoute: invalid endpoints are unreachable, not a throw", () => {
  const graph = buildSystemGraph(FIXTURE);
  assert.equal(solveRoute(graph, 0, 4).reachable, false);
  assert.equal(solveRoute(graph, 1, 0).reachable, false);
});

// --- distancesFrom (goal R6a): single BFS -> jumps to every system ----------

test("distancesFrom returns the jump distance to every reachable system, origin = 0", () => {
  const graph = buildSystemGraph(FIXTURE);
  const distances = distancesFrom(graph, 1); // from Alpha
  assert.equal(distances.get(1), 0); // origin is zero jumps
  assert.equal(distances.get(2), 1); // Bravo
  assert.equal(distances.get(3), 2); // Charlie
  assert.equal(distances.get(4), 3); // Delta (via C)
  assert.equal(distances.get(5), 3); // Echo (via C) — the branch
});

test("distancesFrom picks the fewest-jumps distance on a branch", () => {
  const graph = buildSystemGraph(FIXTURE);
  const distances = distancesFrom(graph, 3); // from Charlie (the branch point)
  assert.equal(distances.get(3), 0);
  assert.equal(distances.get(2), 1);
  assert.equal(distances.get(4), 1);
  assert.equal(distances.get(5), 1);
  assert.equal(distances.get(1), 2);
});

test("distancesFrom omits unreachable systems from the map", () => {
  const graph = buildSystemGraph(FIXTURE);
  const distances = distancesFrom(graph, 1);
  // Foxtrot(6) is isolated (no gates): not reachable, so absent from the map.
  assert.equal(distances.has(6), false);
  assert.equal(distances.get(6), undefined);
});

test("distancesFrom on an invalid/unknown origin yields an empty map, not a throw", () => {
  const graph = buildSystemGraph(FIXTURE);
  assert.equal(distancesFrom(graph, 0).size, 0);
  assert.equal(distancesFrom(graph, 999).size, 0); // system not in the graph
  // The isolated system is a "known" system but reaches nothing but itself.
  const fromIsolated = distancesFrom(graph, 6);
  assert.equal(fromIsolated.get(6), 0);
  assert.equal(fromIsolated.size, 1);
});

test("buildSystemGraph tolerates malformed edges and keeps endpoint-only systems", () => {
  const graph = buildSystemGraph({
    systems: {},
    edges: [
      [10, 20, 1020, 2010],
      // malformed rows are skipped, not fatal:
      [0, 20, 1, 2] as unknown as readonly [number, number, number, number],
      [10, 0, 1, 2] as unknown as readonly [number, number, number, number],
    ],
  });
  // A system known only via an edge endpoint (no name row) is still routable.
  assert.equal(graph.hasSystem(10), true);
  assert.equal(graph.hasSystem(20), true);
  assert.equal(graph.systemName(10), null);
  assert.equal(graph.edgeCount, 1);
  assert.equal(solveRoute(graph, 10, 20).jumps, 1);
});
