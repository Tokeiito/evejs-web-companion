// A bot's warp to its mission's marked spot, made as the client makes it: by asking the agent (the plan's Phase
// 6b), through the real flow over a faked BFF.
//
// Until 2026-10-11 the block read this server's "Agent Missions" bookmark folder and warped by the ballpark's call
// to a bookmark (CmdWarpToStuff('bookmark', id)). A client's bookmark service takes a mission's spots from the
// journal (bookmarkSvc.GetAgentBookmarks, 121 to 136), and its menu warps to one by asking the agent:
// GetAgentMoniker(agentID).WarpToLocation(locationType, locationNumber, warpRange, fleet, referringAgentID,
// formation settings) (movementFunctions.py 414 to 416). Tranquility has that call recorded 23 times.

import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { BotScript } from "../bots/botScript.ts";
import { fittingBody, flightBody, holdsBody, namesBody, SHIP_ID, SOLAR_SYSTEM_ID } from "./botFixtures.ts";

const PILOT = 140000005;
const AGENT = 3018920;

// The server's forms (eve.js agentMissionRuntime.js, buildMissionBookmarkPayload: a KeyVal for each spot).
const keyVal = (entries: readonly (readonly [string, unknown])[]): unknown => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries } });
const spot = (locationType: string, locationNumber: number, isAgentBase: 0 | 1, solarsystemID = SOLAR_SYSTEM_ID): unknown => keyVal([
  ["itemID", null], ["typeID", 5], ["agentID", AGENT], ["hint", "a spot"], ["locationType", locationType], ["memo", ""],
  ["isAgentBase", isAgentBase], ["locationNumber", locationNumber], ["created", { type: "long", value: "134360000000000000" }], ["flag", null],
  ["locationID", solarsystemID], ["ownerID", PILOT], ["y", 2000.5], ["x", 1000.5], ["solarsystemID", solarsystemID], ["z", 3000.5],
]);
/** agentMgr.GetMyJournalDetails: one mission accepted (state 2) with the agent's base and the mission's own site marked, and no research. */
const journalOf = (spots: readonly unknown[]): unknown => [
  { type: "list", items: [[2, 0, "UI/Agents/MissionTypes/Encounter", 58607, AGENT, { type: "long", value: "134295222004640000" }, { type: "list", items: spots }, 0, 0, 1382]] },
  { type: "list", items: [] },
];

type Answer = { readonly status: number; readonly body: unknown };
const answered = (service: string, method: string, result: unknown): Answer => ({ status: 200, body: { ok: true, service, method, result, notifications: [] } });

// movementFunctions.py 416, as the recordings have it: ('dungeon', 0, 0, False, None, {formationType: 0,
// formationSpacing: 1000, formationSize: 10000}), on the agent's own object: a pilot's write, of that agent.
const THE_WARP = {
  service: "agentMgr", method: "WarpToLocation",
  args: ["dungeon", 0, 0, false, null, { formationType: 0, formationSpacing: 1000, formationSize: 10000 }],
  kwargs: null, pilot: true, confirm: true, of: AGENT,
};

/** A pilot in space with a mission accepted, and a BFF that says what it was asked. */
function harness(spots: readonly unknown[] = [spot("agenthomebase", -1, 1), spot("dungeon", 0, 0)]) {
  const store = createClientStore();
  store.apply({ type: "character/online", character: {
    characterID: PILOT, characterName: "Test", stationID: null,
    structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000,
  }, station: null } as never);
  const warps: Record<string, unknown>[] = [];
  const others: string[] = [];
  const flow = createAppFlow(store, { livePush: false, fetch: async (input, init) => {
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let answer: Answer = { status: 200, body: { ok: true } };
    if (path === "/api/bridge/flight/status") answer = { status: 200, body: flightBody(false) };
    if (path === "/api/bridge/fitting") answer = { status: 200, body: fittingBody() };
    if (path === "/api/names") answer = { status: 200, body: namesBody(body) };
    if (path === "/api/bridge/script/observation") answer = { status: 200, body: { ok: true, inSpace: [], bay: [], space: {
      inSpace: true, solarSystemID: SOLAR_SYSTEM_ID, shipID: SHIP_ID, sampledAtMs: Date.now(),
      ship: { itemID: SHIP_ID, typeID: 17480, radius: 100, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, mode: "STOP" },
      entities: [],
    } } };
    if (path === "/api/bridge/targets") answer = { status: 200, body: { ok: true, targetIDs: [] } };
    if (path === "/api/bridge/ship/ore-hold") answer = { status: 200, body: holdsBody(0, []) };
    // What the block is to ask no more: the bookmarks' read, a bookmark's warp by the ballpark, and the routes.
    if (path.startsWith("/api/bridge/flight/warp") || path.startsWith("/api/bridge/agent/") || path.startsWith("/api/bridge/bookmarks")) others.push(path);
    if (path === "/api/bridge/call" && body.service === "accessGroupBookmarkMgr") others.push("the bookmarks' read");
    if (path === "/api/bridge/call" && body.service === "beyonce") others.push(`beyonce.${body.method}`);
    if (path === "/api/bridge/call" && body.service === "agentMgr" && body.method === "GetMyJournalDetails") answer = answered("agentMgr", "GetMyJournalDetails", journalOf(spots));
    if (path === "/api/bridge/call" && body.service === "agentMgr" && body.method === "WarpToLocation") {
      warps.push(body);
      answer = answered("agentMgr", "WarpToLocation", null);
    }
    return Response.json(answer.body, { status: answer.status });
  } });
  return { store, flow, warps, others };
}

const script: BotScript = {
  format: "evejs-bot-script", version: 1, name: "To the site", notes: "",
  home: { entity: "station", id: null, name: null, systemName: null },
  interrupts: [],
  program: [{ id: "site", kind: "macro", macro: "fly-to-mission-site", args: {} }],
};

/** The bot started and its clock turned until the test's condition holds, or the bot stops, or twelve looks have passed. */
async function run(context: TestContext, made: ReturnType<typeof harness>, until: () => boolean) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const said: string[] = [];
  const unsubscribe = made.store.customBot.subscribe((state) => {
    const line = `${state.status}: ${state.why ?? ""}`;
    if (said.at(-1) !== line) said.push(line);
  });
  try {
    await made.flow.startCustomBot(script);
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (let look = 0; look < 12 && !until() && made.store.customBot.get().status === "running"; look += 1) {
      context.mock.timers.tick(2000);
      for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    unsubscribe();
    made.flow.stopCustomBot();
  }
  return said;
}

test("a bot's warp to its mission's site asks the agent, as the client's menu does: the site's type and number, nought, no fleet, no other agent, and the formation's settings", { timeout: 10_000 }, async (context) => {
  const made = harness();
  await run(context, made, () => made.warps.length > 0);
  assert.deepEqual(made.warps, [THE_WARP]);
  // Nothing was read of the bookmarks' folders, and nothing asked of the ballpark or of a route.
  assert.deepEqual(made.others, []);
});

test("with the agent's base alone marked, the warp is to the agent's base: its own type, and the number the server gives it", { timeout: 10_000 }, async (context) => {
  const made = harness([spot("agenthomebase", -1, 1)]);
  await run(context, made, () => made.warps.length > 0);
  assert.deepEqual(made.warps, [{ ...THE_WARP, args: ["agenthomebase", -1, ...THE_WARP.args.slice(2)] }]);
  assert.deepEqual(made.others, []);
});

test("a mission whose spots are all in another system is not warped to: the block is given up, and no agent is asked", { timeout: 10_000 }, async (context) => {
  const made = harness([spot("dungeon", 0, 0, SOLAR_SYSTEM_ID + 1)]);
  const said = await run(context, made, () => false);
  assert.deepEqual(made.warps, []);
  assert.deepEqual(made.others, []);
  // (The block's own words for it are the block's test's: nav/scriptMissionMacros.test.ts. The bot's line is of what
  // it did next, which with no home to go to is to stop.)
  assert.match(said.at(-1) ?? "", /^paused: /, said.join(" | "));
});
