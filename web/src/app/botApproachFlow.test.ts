// A script bot's approach, made as a pilot's hand makes one (the plan's Phase 6b), through the real flow over a
// faked BFF.
//
// The client's menu approach is movementFunctions.ShipApproach (290 on): the ballpark's CmdFollowBall(targetID,
// 50), unless the ship follows that thing at fifty already, and no throttle. Tranquility has 118 follows recorded:
// 88 at fifty metres with no throttle before them, in 21 recordings, and two at nought after a throttle, which are
// the autopilot's own (AP_ApproachDestID) in the one recording of an autopilot.
//
// Until 2026-10-11 a script bot's approach, and the mining bot's, were the autopilot's: CmdSetSpeedFraction(1),
// then CmdFollowBall(id, 0). A bot is no autopilot; its blocks are a pilot's own orders.

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { BotScript } from "../bots/botScript.ts";
import { fittingBody, flightBody, holdsBody, namesBody, SHIP_ID, SOLAR_SYSTEM_ID } from "./botFixtures.ts";

const PILOT = 140000005;
const STATION = 60000358;

/** A pilot in space with a station so far off its hull, and a BFF that says what it was asked of the ballpark. */
function harness(metres: number) {
  const store = createClientStore();
  store.apply({ type: "character/online", character: {
    characterID: PILOT, characterName: "Test", stationID: null,
    structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000,
  }, station: null } as never);
  const orders: Record<string, unknown>[] = [];
  const routes: string[] = [];
  const flow = createAppFlow(store, { livePush: false, fetch: async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/flight/status") answer = flightBody(false);
    if (path === "/api/bridge/fitting") answer = fittingBody();
    if (path === "/api/names") answer = namesBody(body);
    if (path === "/api/bridge/script/observation") answer = { ok: true, inSpace: [], bay: [], space: {
      inSpace: true, solarSystemID: SOLAR_SYSTEM_ID, shipID: SHIP_ID, sampledAtMs: Date.now(),
      ship: { itemID: SHIP_ID, typeID: 17480, radius: 100, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mode: "STOP" },
      entities: [{ itemID: STATION, kind: "station", typeID: 1529, name: "A Station", radius: 20000, position: { x: metres + 100 + 20000, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }],
    } };
    if (path === "/api/bridge/targets") answer = { ok: true, targetIDs: [] };
    if (path === "/api/bridge/ship/ore-hold") answer = holdsBody(0, []);
    if (path.startsWith("/api/bridge/flight/") && path !== "/api/bridge/flight/status") routes.push(path);
    if (path === "/api/bridge/call" && body.service === "beyonce") {
      orders.push(body);
      answer = { ok: true, service: "beyonce", method: body.method, result: null, notifications: [] };
    }
    return Response.json(answer, { status: 200 });
  } });
  return { store, flow, orders, routes };
}

const script: BotScript = {
  format: "evejs-bot-script", version: 1, name: "To the station", notes: "",
  home: { entity: "station", id: null, name: null, systemName: null },
  interrupts: [],
  program: [{ id: "dock", kind: "macro", macro: "dock-at-nearest", args: {} }],
};

/** The bot started and its clock turned until an order has been asked of the ballpark, or the bot stops, or twelve looks have passed. */
async function run(context: TestContext, made: ReturnType<typeof harness>) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await made.flow.startCustomBot(script);
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let look = 0; look < 12 && made.orders.length === 0 && made.store.customBot.get().status === "running"; look += 1) {
      context.mock.timers.tick(2000);
      for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    made.flow.stopCustomBot();
  }
}

test("a script bot's approach is the menu's: a follow at the client's fifty metres, and no throttle", { timeout: 10_000 }, async (context) => {
  // 30 km off: nearer than a warp is asked from, further than a dock is.
  const made = harness(30_000);
  await run(context, made);
  assert.deepEqual(made.orders, [{ service: "beyonce", method: "CmdFollowBall", args: [STATION, 50], kwargs: null, pilot: true, confirm: true }]);
  // No route of the bridge's was asked for it.
  assert.deepEqual(made.routes, []);
});
