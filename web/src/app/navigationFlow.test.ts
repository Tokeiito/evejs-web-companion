// A pilot's own Dock and Jump from afar, and the autopilot's last leg, made as the client makes them (the plan's
// Phase 6b), through the real flow over a faked BFF.
//
// A client's menu Dock and Jump are its system navigation (menusvc.py DockStation and StargateJump, by
// GetCloseAndTryCommand; autopilot.py NavigateSystemTo, 488 on): further than a warp's least distance it warps to
// the thing at nought (movementFunctions.WarpToItem, the ballpark's CmdWarpToStuff('item', id, minRange=0)); nearer
// it makes the menu's approach (ShipApproach: CmdFollowBall(id, 50), with no throttle); within 2,500 m it docks or
// jumps. Tranquility has 36 docks recorded, in 22 recordings: the client's last order to the ship before each is
// that warp (or another dock), and none follows the autopilot's warp.
//
// A client's autopilot asks that same Dock once it is under 50 km of its last station (autopilot.py 394 to 399),
// and until then approaches as an autopilot does (the throttle, then a follow at nought).
//
// From 2026-10-11 until this was made, the page's Dock and Jump warped by the autopilot's own call, which they
// share a loop with.

import test from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const ALPHA = 30000001;
const BRAVO = 30000002;
const GATE = 50000112;
const FAR_GATE = 50000211;
const STATION = 60000001;
const SHIP = 9001;
const SHIP_RADIUS_M = 50;
const GATE_RADIUS_M = 3000;
const STATION_RADIUS_M = 20000;
const GRAPH = {
  ok: true,
  systems: { [ALPHA]: "Alpha", [BRAVO]: "Bravo" },
  security: { [ALPHA]: 1, [BRAVO]: 0.9 },
  edges: [[ALPHA, BRAVO, GATE, FAR_GATE], [BRAVO, ALPHA, FAR_GATE, GATE]],
};
const IN_SPACE = { inSpace: true, docked: false, solarSystemID: ALPHA, stationID: null, structureID: null, shipID: SHIP, shipMode: "STOP", shipSpeedFraction: 0 };
const LINK = { gateID: GATE, toSystemID: BRAVO, toSystemName: "Bravo", destinationGateID: FAR_GATE };

/** A pilot in space in Alpha, Bravo's gate and Alpha's station each so far from its hull, and a BFF that says what it was asked. */
function harness(off: { readonly gate?: number; readonly station?: number }) {
  const store = createClientStore();
  const asked: Record<string, unknown>[] = [];
  const flow = createAppFlow(store, { livePush: false, fetch: (async (input: unknown, init?: { body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    let answer: unknown = { ok: true, result: null, matches: [], notifications: [] };
    if (path === "/api/map/graph") answer = GRAPH;
    if (path === `/api/map/resolve/${STATION}`) answer = { ok: true, id: STATION, kind: "station", stationID: STATION, stationName: "Alpha Station", solarSystemID: ALPHA, systemName: "Alpha" };
    if (path === `/api/map/resolve/${BRAVO}`) answer = { ok: true, id: BRAVO, kind: "system", solarSystemID: BRAVO, systemName: "Bravo" };
    if (path === "/api/bridge/flight/status") answer = { ok: true, flight: IN_SPACE, notifications: [] };
    if (path === "/api/bridge/space/snapshot") answer = { ok: true, notifications: [], space: {
      inSpace: true, solarSystemID: ALPHA, shipID: SHIP, sampledAtMs: Date.now(),
      ship: { itemID: SHIP, typeID: 670, radius: SHIP_RADIUS_M, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mode: "STOP" },
      entities: [
        { itemID: GATE, kind: "stargate", typeID: 16, name: "Stargate (Bravo)", radius: GATE_RADIUS_M, position: { x: (off.gate ?? 9e9) + SHIP_RADIUS_M + GATE_RADIUS_M, y: 0, z: 0 } },
        { itemID: STATION, kind: "station", typeID: 1529, name: "Alpha Station", radius: STATION_RADIUS_M, position: { x: -((off.station ?? 9e9) + SHIP_RADIUS_M + STATION_RADIUS_M), y: 0, z: 0 } },
      ],
    } };
    if (path === "/api/bridge/call") {
      asked.push(body);
      answer = { ok: true, service: body.service, method: body.method, result: null, notifications: [] };
    }
    return { ok: true, status: 200, async json() { return answer; } };
  }) as unknown as typeof fetch });
  /** A flight begun, and the loop's first order to the ship waited for. */
  const firstOrder = async (begin: (made: typeof flow) => Promise<unknown>) => {
    await begin(flow);
    for (let waited = 0; waited < 1500 && !asked.some((each) => /^Cmd(WarpToStuff|WarpToStuffAutopilot|FollowBall)$/.test(String(each.method))); waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    flow.abortRoute();
    return asked;
  };
  return { firstOrder };
}

const order = (method: string, args: readonly unknown[], kwargs: Record<string, unknown> | null = null) => ({ service: "beyonce", method, args, kwargs, pilot: true, confirm: true });
const dock = (flow: { dockAt(stationID: number): Promise<unknown> }) => flow.dockAt(STATION);
const jump = (flow: { jumpThrough(link: typeof LINK): Promise<unknown> }) => flow.jumpThrough(LINK);
const route = (flow: { startRoute(destinationID: number): Promise<unknown> }) => flow.startRoute(STATION);

test("a pilot's Dock from afar warps to the station by the menu's call at nought, as the client's system navigation does", async () => {
  // 155 km is where this server takes a warp at nought and refuses the autopilot's.
  for (const station of [5_000_000_000, 155_000, 152_500]) {
    assert.deepEqual(await harness({ station }).firstOrder(dock), [order("CmdWarpToStuff", ["item", STATION], { minRange: 0 })], `${station} m off the station`);
  }
});

test("nearer than a warp is asked from, a pilot's Dock is the menu's approach: a follow at the client's fifty metres, and no throttle", async () => {
  for (const station of [3_000, 30_000, 149_000, 152_499]) {
    assert.deepEqual(await harness({ station }).firstOrder(dock), [order("CmdFollowBall", [STATION, 50])], `${station} m off the station`);
  }
});

test("a pilot's Jump from afar is the same navigation: the menu's warp at nought, and nearer the menu's approach", async () => {
  for (const gate of [5_000_000_000, 155_000]) {
    assert.deepEqual(await harness({ gate }).firstOrder(jump), [order("CmdWarpToStuff", ["item", GATE], { minRange: 0 })], `${gate} m off the gate`);
  }
  for (const gate of [3_000, 30_000, 152_499]) {
    assert.deepEqual(await harness({ gate }).firstOrder(jump), [order("CmdFollowBall", [GATE, 50])], `${gate} m off the gate`);
  }
});

test("the autopilot's last leg: its own warp from afar, its own approach down to fifty kilometres, and under that the menu's Dock's approach", async () => {
  assert.deepEqual(await harness({ station: 5_000_000_000 }).firstOrder(route), [order("CmdWarpToStuffAutopilot", [STATION])]);
  for (const station of [155_000, 100_000, 50_000]) {
    assert.deepEqual(await harness({ station }).firstOrder(route), [order("CmdSetSpeedFraction", [1]), order("CmdFollowBall", [STATION, 0])], `${station} m off the station`);
  }
  for (const station of [49_999, 10_000, 3_000]) {
    assert.deepEqual(await harness({ station }).firstOrder(route), [order("CmdFollowBall", [STATION, 50])], `${station} m off the station`);
  }
});
