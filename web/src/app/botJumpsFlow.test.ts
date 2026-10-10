// What a bot counts as the jumps to somewhere is what its pilot's autopilot would fly: the client's route,
// with the pilot's own settings (nav/autopilotRoute.ts, nav/autopilotSettings.ts). The map is made up.

import test from "node:test";
import assert from "node:assert/strict";
import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { BotScript } from "../bots/botScript.ts";
import { fittingBody, flightBody, namesBody, SHIP_ID, SOLAR_SYSTEM_ID, STATION_ID } from "./botFixtures.ts";

const AGENT = 3008416;
const PILOT = 42;
const JITA = 30000142;
const FAR = 30000160;
const ROUND_ONE = 30000161;
const ROUND_TWO = 30000162;
const list = (items: unknown[]) => ({ type: "list", items });
const tuple = (items: unknown[]) => ({ type: "tuple", items });

/** From where the pilot is to the agent's system: two jumps through Jita, or three round it. */
const GRAPH = {
  ok: true,
  systems: { [SOLAR_SYSTEM_ID]: "Here", [JITA]: "Jita", [FAR]: "Far", [ROUND_ONE]: "Round One", [ROUND_TWO]: "Round Two" },
  security: { [SOLAR_SYSTEM_ID]: 0.9, [JITA]: 0.9, [FAR]: 0.9, [ROUND_ONE]: 0.9, [ROUND_TWO]: 0.9 },
  edges: [[SOLAR_SYSTEM_ID, JITA], [JITA, FAR], [SOLAR_SYSTEM_ID, ROUND_ONE], [ROUND_ONE, ROUND_TWO], [ROUND_TWO, FAR]]
    .flatMap(([a, b], at) => [[a, b, 700 + at * 2, 701 + at * 2], [b, a, 701 + at * 2, 700 + at * 2]]),
};

/** Runs a bot that looks for a courier agent within two jumps, and says what the bot made of it. */
async function findWithinTwoJumps(t: { mock: { timers: { enable(options: unknown): void; tick(ms: number): void; reset(): void } } }, kept: Record<string, string>): Promise<string> {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = createClientStore();
  store.apply({ type: "session/logged-in", accountID: 4001, username: "pilot", accountCreated: false });
  store.apply({ type: "character/online", character: { characterID: PILOT, characterName: "Pilot", stationID: STATION_ID, structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 1000002 }, station: null });
  const flow = createAppFlow(store, {
    livePush: false,
    storage: { getItem: (key) => kept[key] ?? null, setItem: (key, value) => { kept[key] = value; } },
    fetch: async (input, init) => {
      const path = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      let result: unknown = { ok: true };
      if (path === "/api/bridge/flight/status") result = flightBody(true);
      if (path === "/api/bridge/fitting") result = fittingBody();
      if (path === "/api/names") result = namesBody(body);
      if (path === "/api/bridge/call") result = { ok: true, service: body.service, method: body.method, result: body.method === "GetStationItemBits" ? [1, STATION_ID, 26, 1529] : body.method === "GetGuests" ? list([]) : null };
      if (path === "/api/bridge/targets") result = { ok: true, targetIDs: [] };
      if (path === "/api/bridge/ship/ore-hold") result = { ok: true, activeShipID: SHIP_ID, holds: [] };
      if (path === "/api/bridge/script/observation") result = { ok: true, bay: [], inSpace: [], space: { inSpace: false, solarSystemID: SOLAR_SYSTEM_ID, shipID: SHIP_ID, ship: null, entities: [] } };
      if (path === "/api/map/graph") result = GRAPH;
      if (path.startsWith("/api/agents/find")) result = { ok: true, kind: "courier", level: 1, total: 1, capped: false, agents: [{ agentID: AGENT, name: "Courier Agent", agentTypeID: 2, divisionID: 22, level: 1, corporationID: 1000002, stationID: 60000999, stationName: "Far Station", solarSystemID: FAR }] };
      // The journal, read by the page's own call (bridge/journalReads.ts).
      if (path === "/api/bridge/call" && body.service === "agentMgr" && body.method === "GetMyJournalDetails") result = { ok: true, service: body.service, method: body.method, result: tuple([list([]), list([])]), notifications: [] };
      return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
    },
  });
  const doc: BotScript = {
    format: "evejs-bot-script", version: 1, name: "Find within two", notes: "",
    home: { entity: "station", id: STATION_ID, name: "Home", systemName: null }, interrupts: [],
    program: [{ id: "find", kind: "macro", macro: "find-distribution-agent", args: { level: { kind: "count", value: 1 }, maxJumps: { kind: "count", value: 2 } } }],
  };
  try {
    await flow.startCustomBot(doc);
    for (let turn = 0; turn < 12; turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      t.mock.timers.tick(2000);
    }
    return JSON.stringify(store.customBot.get());
  } finally {
    flow.stopCustomBot();
    t.mock.timers.reset();
  }
}

test("an agent two jumps off through Jita is three by the autopilot's route, and a bot looking within two does not find it", async (t) => {
  const said = await findWithinTwoJumps(t, {});
  assert.match(said, /No eligible level 1 Distribution agent/);
});

test("with the pilot's avoiding turned off the same agent is two jumps off, and the bot goes on to ask it", async (t) => {
  const said = await findWithinTwoJumps(t, { [`evejs.autopilot.settings.${PILOT}`]: JSON.stringify({ pfAvoidSystems: false }) });
  // Near enough now: the bot got as far as asking whether the agent will have this pilot, which nothing here answers.
  assert.doesNotMatch(said, /No eligible/);
  assert.match(said, /agent access could not be confirmed/);
});
