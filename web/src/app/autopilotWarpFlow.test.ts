// The travel autopilot's warp, made as the client's autopilot makes it (the plan's Phase 6b), through the real
// flow over a faked BFF.
//
// Until 2026-10-11 the page's autopilot warped by the menu's call at nought (beyonce.CmdWarpToStuff('item', id,
// minRange=0)). A client's autopilot warps by a call of its own, CmdWarpToStuffAutopilot(destinationID)
// (autopilot.py, AP_WarpToDestID, 462 on), and nearer than a warp's least distance it opens the throttle and
// follows its destination at nought (AP_ApproachDestID, 448 on). Tranquility has the run recorded: the
// autopilot's warp, the throttle, the follow and the jump, gate after gate.
//
// This server stops that warp ten kilometres short and refuses it from nearer than about 160 km (measured on
// 2026-10-11 from a capsule: refused 160.0 km off a gate and taken at 160.5; refused 159.9 km off a station and
// taken at 160.1). So the page approaches from under its floor for that call, which is 162.5 km for a small hull.

import test from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const ALPHA = 30000001;
const BRAVO = 30000002;
const GATE = 50000112;
const FAR_GATE = 50000211;
const SHIP = 9001;
const SHIP_RADIUS_M = 50;
const GATE_RADIUS_M = 3000;
const GRAPH = {
  ok: true,
  systems: { [ALPHA]: "Alpha", [BRAVO]: "Bravo" },
  security: { [ALPHA]: 1, [BRAVO]: 0.9 },
  edges: [[ALPHA, BRAVO, GATE, FAR_GATE], [BRAVO, ALPHA, FAR_GATE, GATE]],
};
const IN_SPACE = { inSpace: true, docked: false, solarSystemID: ALPHA, stationID: null, structureID: null, shipID: SHIP, shipMode: "STOP", shipSpeedFraction: 0 };

/** A pilot in space in Alpha with Bravo's gate `metres` from its hull, and a BFF that says what it was asked. */
function harness(metres: number) {
  const store = createClientStore();
  const asked: Record<string, unknown>[] = [];
  const paths: string[] = [];
  const flow = createAppFlow(store, { livePush: false, fetch: (async (input: unknown, init?: { body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    paths.push(path);
    let answer: unknown = { ok: true, result: null, notifications: [] };
    if (path === "/api/map/graph") answer = GRAPH;
    if (path.startsWith("/api/map/resolve/")) answer = { ok: true, id: BRAVO, kind: "system", solarSystemID: BRAVO, systemName: "Bravo" };
    if (path === "/api/bridge/flight/status") answer = { ok: true, flight: IN_SPACE, notifications: [] };
    if (path === "/api/bridge/space/snapshot") answer = { ok: true, notifications: [], space: {
      inSpace: true, solarSystemID: ALPHA, shipID: SHIP, sampledAtMs: Date.now(),
      ship: { itemID: SHIP, typeID: 670, radius: SHIP_RADIUS_M, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mode: "STOP" },
      entities: [{ itemID: GATE, kind: "stargate", typeID: 16, name: "Stargate (Bravo)", radius: GATE_RADIUS_M, position: { x: metres + SHIP_RADIUS_M + GATE_RADIUS_M, y: 0, z: 0 } }],
    } };
    if (path === "/api/bridge/call") {
      asked.push(body);
      answer = { ok: true, service: body.service, method: body.method, result: null, notifications: [] };
    }
    return { ok: true, status: 200, async json() { return answer; } };
  }) as unknown as typeof fetch });
  /** The route to Bravo begun, and the autopilot's first order to the ship waited for. */
  const firstOrder = async () => {
    const outcome = await flow.startRoute(BRAVO);
    for (let waited = 0; waited < 1500 && !asked.some((each) => each.method === "CmdWarpToStuffAutopilot" || each.method === "CmdWarpToStuff" || each.method === "CmdFollowBall"); waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    flow.abortRoute();
    return outcome;
  };
  return { asked, paths, firstOrder };
}

const order = (method: string, args: readonly unknown[]) => ({ service: "beyonce", method, args, kwargs: null, pilot: true, confirm: true });

test("the autopilot warps to a far gate by the client's autopilot's own call, and by no other", async () => {
  for (const metres of [5_000_000_000, 163_000, 162_500]) {
    const pilot = harness(metres);
    const outcome = await pilot.firstOrder();
    assert.equal(outcome.started, true, JSON.stringify(outcome));
    assert.deepEqual(pilot.asked, [order("CmdWarpToStuffAutopilot", [GATE])], `${metres} m off the gate`);
    // The pilot's flight was read before the order, and no route of a warp's was asked.
    assert.ok(pilot.paths.indexOf("/api/bridge/flight/status") < pilot.paths.indexOf("/api/bridge/call"));
    assert.deepEqual(pilot.paths.filter((path) => path.startsWith("/api/bridge/flight/warp")), []);
  }
});

test("nearer than this server takes that warp from, the autopilot opens the throttle and follows the gate at nought, as the client's does under a warp's least distance", async () => {
  // 155 km and 160 km are where a warp at nought would be taken, and the autopilot's is refused.
  for (const metres of [30_000, 149_000, 155_000, 160_000, 162_499]) {
    const pilot = harness(metres);
    await pilot.firstOrder();
    assert.deepEqual(pilot.asked, [order("CmdSetSpeedFraction", [1]), order("CmdFollowBall", [GATE, 0])], `${metres} m off the gate`);
  }
});
