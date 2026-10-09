// The autopilot's jump counts, against the retail client's own pathfinder. The fixture is that module's
// answers over made-up maps (scripts/build-autopilot-fixture.js); nothing in it is worked out here.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_AUTOPILOT_SETTINGS, SOLAR_SYSTEM_JITA, SOLAR_SYSTEM_ZARZAKH, autopilotJumpCount, autopilotJumpCounts, autopilotMap, isKnownSpaceSystem,
  type AutopilotMap, type AutopilotSettings,
} from "./autopilotRoute.ts";
import { buildSystemGraph } from "./routeSolver.ts";

interface RecordedCase {
  readonly name: string;
  readonly penalty: number;
  readonly avoid: readonly number[];
  readonly systems: ReadonlyArray<readonly [number, number]>;
  readonly jumps: ReadonlyArray<readonly [number, number]>;
  readonly pairs: ReadonlyArray<readonly [number, number, number | null]>;
}
const FIXTURE = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/autopilotRoute.json"), "utf8")) as {
  readonly routeType: string;
  readonly cases: readonly RecordedCase[];
};

/** A map from systems as [id, security] and jumps that go both ways. */
function mapOf(systems: ReadonlyArray<readonly [number, number]>, jumps: ReadonlyArray<readonly [number, number]>): AutopilotMap {
  const security = new Map(systems);
  const neighbours = new Map<number, number[]>(systems.map(([id]) => [id, []]));
  for (const [a, b] of jumps) {
    neighbours.get(a)!.push(b);
    neighbours.get(b)!.push(a);
  }
  return { neighbors: (id) => neighbours.get(id) ?? [], security: (id) => security.get(id) ?? null };
}
const settingsOf = (recorded: RecordedCase): AutopilotSettings => ({ penalty: recorded.penalty, avoid: recorded.avoid });

test("the fixture is the client's safe route, and is not a small one", () => {
  assert.equal(FIXTURE.routeType, "safe");
  assert.ok(FIXTURE.cases.length >= 100);
  assert.ok(FIXTURE.cases.reduce((sum, each) => sum + each.pairs.length, 0) >= 2000);
  // It has routes that are not there, routes of one jump, and long ones.
  const counts = FIXTURE.cases.flatMap((each) => each.pairs.map(([, , count]) => count));
  assert.ok(counts.includes(null) && counts.includes(0) && counts.includes(1) && counts.some((count) => count !== null && count > 20));
});

test("every pair the client's pathfinder answered is answered the same, one pair at a time", () => {
  let checked = 0;
  for (const recorded of FIXTURE.cases) {
    const map = mapOf(recorded.systems, recorded.jumps);
    for (const [from, to, count] of recorded.pairs) {
      assert.equal(autopilotJumpCount(map, from, to, settingsOf(recorded)), count, `${recorded.name}: ${from} to ${to}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 2000);
});

test("and the same when all that is wanted from one system is asked together", () => {
  for (const recorded of FIXTURE.cases) {
    const map = mapOf(recorded.systems, recorded.jumps);
    const wanted = new Map<number, number[]>();
    for (const [from, to] of recorded.pairs) wanted.set(from, [...(wanted.get(from) ?? []), to]);
    for (const [from, tos] of wanted) {
      const counts = autopilotJumpCounts(map, from, tos, settingsOf(recorded));
      for (const [pairFrom, to, count] of recorded.pairs) {
        if (pairFrom === from) assert.equal(counts.get(to), count, `${recorded.name}: ${from} to ${to}`);
      }
    }
  }
});

test("the settings as they come are the client's: penalty 50, Jita and Zarzakh avoided", () => {
  assert.deepEqual(DEFAULT_AUTOPILOT_SETTINGS, { penalty: 50, avoid: [30000142, 30100000] });
  assert.equal(SOLAR_SYSTEM_JITA, 30000142);
  assert.equal(SOLAR_SYSTEM_ZARZAKH, 30100000);
  // Left unsaid, they are what is used: a route goes round Jita, and may end there.
  const A = 30000140;
  const B = 30000141;
  const C = 30000143;
  const D = 30000144;
  const map = mapOf([[A, 1], [SOLAR_SYSTEM_JITA, 1], [B, 1], [C, 1], [D, 1]], [[A, SOLAR_SYSTEM_JITA], [SOLAR_SYSTEM_JITA, B], [A, C], [C, D], [D, B]]);
  assert.equal(autopilotJumpCount(map, A, B), 3);
  assert.equal(autopilotJumpCount(map, A, SOLAR_SYSTEM_JITA), 1);
  assert.equal(autopilotJumpCount(map, SOLAR_SYSTEM_JITA, B), 1);
  assert.equal(autopilotJumpCount(map, A, B, { penalty: 50, avoid: [] }), 2);
  // Asked together, an avoided system gone to does not open the way through it for the others.
  assert.deepEqual([...autopilotJumpCounts(map, A, [SOLAR_SYSTEM_JITA, B, SOLAR_SYSTEM_JITA, A])], [[SOLAR_SYSTEM_JITA, 1], [B, 3], [A, 0]]);
  assert.deepEqual([...autopilotJumpCounts(map, A, [B, SOLAR_SYSTEM_JITA])], [[B, 3], [SOLAR_SYSTEM_JITA, 1]]);
});

test("a system is no jumps from itself, and there is no route to or from anywhere outside known space", () => {
  const map = mapOf([[30000001, 1], [30000002, 1], [31000005, 1], [30999999, 1]], [[30000001, 30000002], [30000002, 31000005], [30000002, 30999999]]);
  assert.equal(autopilotJumpCount(map, 30000001, 30000001), 0);
  // Itself comes first: a system outside known space is nought jumps from itself too.
  assert.equal(autopilotJumpCount(map, 31000005, 31000005), 0);
  assert.equal(autopilotJumpCount(map, 30000001, 31000005), null);
  assert.equal(autopilotJumpCount(map, 31000005, 30000001), null);
  assert.equal(autopilotJumpCount(map, 30000001, 30999999), 2);
  for (const [id, known] of [[30000000, true], [30999999, true], [29999999, false], [31000000, false], [32000001, false]] as const) {
    assert.equal(isKnownSpaceSystem(id), known, String(id));
  }
});

test("a system the map does not hold is not gone through, nor to, nor from", () => {
  const security = new Map([[30000001, 1], [30000003, 1], [30000004, 1]]);
  const jumps: Record<number, number[]> = { 30000001: [30000002, 30000004], 30000002: [30000001, 30000003], 30000003: [30000002, 30000004], 30000004: [30000001, 30000003] };
  const map: AutopilotMap = { neighbors: (id) => jumps[id] ?? [], security: (id) => security.get(id) ?? null };
  // Round by the system it holds, not through the one it does not.
  assert.equal(autopilotJumpCount(map, 30000001, 30000003), 2);
  assert.equal(autopilotJumpCount(map, 30000001, 30000002), null);
  assert.equal(autopilotJumpCount(map, 30000009, 30000001), null);
});

test("the pathfinder's map is the page's own: every jump, and each system at the level the client works with", () => {
  const graph = buildSystemGraph({
    systems: { 30000001: "A", 30000002: "B", 30000003: "C", 30000004: "D" },
    edges: [[30000001, 30000002, 50000001, 50000002], [30000002, 30000001, 50000002, 50000001], [30000002, 30000003, 50000003, 50000004], [30000001, 30000004, 50000005, 50000006]],
    security: { 30000001: 0.9, 30000002: 0.02, 30000003: -0.4 },
  });
  assert.equal(graph.security(30000002), 0.02);
  assert.equal(graph.security(30000004), null);
  const map = autopilotMap(graph);
  assert.deepEqual([...map.neighbors(30000001)], [30000002, 30000004]);
  assert.deepEqual([...map.neighbors(30000003)], []);
  // Above nought and below 0.05 counts as 0.05; the rest as they are; none where the map has none.
  assert.deepEqual([30000001, 30000002, 30000003, 30000004].map((id) => map.security(id)), [0.9, 0.05, -0.4, null]);
  // And a map served without any security has none for any system.
  assert.equal(buildSystemGraph({ systems: { 30000001: "A" }, edges: [] }).security(30000001), null);
  assert.equal(buildSystemGraph({ systems: { 30000001: "A" }, edges: [], security: { 30000001: "0.5" as never } }).security(30000001), null);
});
