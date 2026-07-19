// The R6a Agent Finder flow against a faked BFF: findAgents fetches the static
// agent list, annotates each row with jumps from the docked system (one BFS
// over the map graph), and sorts nearest-first (unreachable last). Set
// destination records the target agent and reuses the R5b autopilot
// (startRoute to the agent's station). The distancesFrom BFS itself is covered
// in nav/routeSolver.test.ts; here we cover the flow wiring + sort.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { OnlineCharacterState } from "../store/types.ts";

// A 3-system line: Alpha(1) <-> Bravo(2) <-> Charlie(3). System 50 is isolated.
const GRAPH = {
  ok: true,
  systems: { "1": "Alpha", "2": "Bravo", "3": "Charlie" },
  edges: [
    [1, 2, 112, 211],
    [2, 1, 211, 112],
    [2, 3, 223, 322],
    [3, 2, 322, 223],
  ],
};

// Four agents: system 1 (0 jumps), system 3 (2 jumps), system 2 (1 jump), and
// an unreachable system 50 (jumps null). Returned in a NON-sorted order so the
// flow's nearest-first sort is actually exercised.
const AGENTS = [
  { agentID: 3003, name: "Charlie Agent", level: 2, missionKind: "courier", missionTypeLabel: "x", corporationID: 1000003, factionID: 500003, stationID: 60000003, stationName: "Charlie Station", solarSystemID: 3, solarSystemName: "Charlie" },
  { agentID: 3050, name: "Island Agent", level: 1, missionKind: "courier", missionTypeLabel: "x", corporationID: 1000050, factionID: 500050, stationID: 60000050, stationName: "Island Station", solarSystemID: 50, solarSystemName: "Island" },
  { agentID: 3001, name: "Alpha Agent", level: 1, missionKind: "courier", missionTypeLabel: "x", corporationID: 1000001, factionID: 500001, stationID: 60000001, stationName: "Alpha Station", solarSystemID: 1, solarSystemName: "Alpha" },
  { agentID: 3002, name: "Bravo Agent", level: 1, missionKind: "courier", missionTypeLabel: "x", corporationID: 1000002, factionID: 500002, stationID: 60000002, stationName: "Bravo Station", solarSystemID: 2, solarSystemName: "Bravo" },
];

const DOCKED_ALPHA = {
  inSpace: false,
  docked: true,
  solarSystemID: 1,
  stationID: 60000001,
  structureID: null,
  shipID: 9001,
  shipMode: null,
  shipSpeedFraction: null,
};

const ONLINE_IN_ALPHA: OnlineCharacterState = {
  characterID: 140000001,
  characterName: "Pilot",
  stationID: 60000001,
  structureID: null,
  solarSystemID: 1, // the finder's distance origin
  corporationID: 1000001,
};

function makeFakeFetch(
  responder: (path: string, method: string, body: Record<string, unknown>) => { status: number; body: unknown },
): typeof fetch {
  return (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    const outcome = responder(path, method, body);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
}

function defaultResponder(path: string): { status: number; body: unknown } {
  if (path.startsWith("/api/agents/find")) {
    return { status: 200, body: { ok: true, source: "static-data", kind: "courier", level: null, total: AGENTS.length, capped: false, agents: AGENTS } };
  }
  if (path === "/api/map/graph") {
    return { status: 200, body: GRAPH };
  }
  if (path.startsWith("/api/map/resolve/")) {
    const id = Number(path.split("/").pop());
    if (id === 60000003) {
      return { status: 200, body: { ok: true, id, kind: "station", stationID: id, stationName: "Charlie Station", solarSystemID: 3, systemName: "Charlie" } };
    }
    return { status: 200, body: { ok: true, id, kind: "system", solarSystemID: id, systemName: `System ${id}` } };
  }
  if (path === "/api/bridge/flight/status") {
    return { status: 200, body: { ok: true, flight: DOCKED_ALPHA, notifications: [] } };
  }
  if (path.startsWith("/api/bridge/flight/")) {
    return { status: 200, body: { ok: true, result: null, flight: DOCKED_ALPHA, notifications: [] } };
  }
  throw new Error(`unexpected ${path}`);
}

function onlineStore() {
  const store = createClientStore();
  store.apply({ type: "character/online", character: ONLINE_IN_ALPHA, station: null });
  return store;
}

test("findAgents annotates jumps and sorts nearest-first, unreachable last", async () => {
  const store = onlineStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.findAgents({ kind: "courier" });

  const finder = store.finder.get();
  assert.equal(finder.loaded, true);
  assert.equal(finder.total, 4);
  assert.equal(finder.capped, false);
  assert.equal(finder.originSystemID, 1);
  // Sorted by jumps: Alpha(0), Bravo(1), Charlie(2), Island(null -> last).
  assert.deepEqual(
    finder.agents.map((a) => [a.agentID, a.jumps]),
    [
      [3001, 0],
      [3002, 1],
      [3003, 2],
      [3050, null],
    ],
  );
});

test("findAgents lists agents with null jumps when the origin is unknown", async () => {
  // No character online: origin is null, so every agent reads as unreachable
  // but the list still populates (no throw).
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.findAgents({ kind: "courier" });

  const finder = store.finder.get();
  assert.equal(finder.loaded, true);
  assert.equal(finder.originSystemID, null);
  assert.ok(finder.agents.every((a) => a.jumps === null));
});

test("findAgents surfaces a read failure through the finder slice (not a throw)", async () => {
  const store = onlineStore();
  const responder = (path: string) => {
    if (path.startsWith("/api/agents/find")) {
      return { status: 502, body: { ok: false, error: "EVE_GATEWAY_UNREACHABLE", message: "down" } };
    }
    return defaultResponder(path);
  };
  const flow = createAppFlow(store, { fetch: makeFakeFetch(responder) });

  await flow.findAgents({ kind: "courier" });

  const finder = store.finder.get();
  assert.equal(finder.loaded, false);
  assert.match(finder.error ?? "", /Could not find agents/i);
});

test("setDestinationToAgent records the target and starts the autopilot route", async () => {
  const store = onlineStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.findAgents({ kind: "courier" });
  await flow.setDestinationToAgent(3003); // Charlie Agent, station 60000003 in system 3
  flow.abortRoute(); // stop the background loop

  const target = store.finder.get().target;
  assert.equal(target?.agentID, 3003);
  assert.equal(target?.name, "Charlie Agent");
  assert.equal(target?.stationID, 60000003);
  assert.equal(target?.jumps, 2);

  const travel = store.travel.get();
  assert.equal(travel.destinationStationID, 60000003);
  assert.equal(travel.destinationSystemID, 3);
  assert.equal(travel.totalJumps, 2);
});

test("setDestinationToAgent on an unknown agent surfaces a finder error", async () => {
  const store = onlineStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.findAgents({ kind: "courier" });
  await flow.setDestinationToAgent(999999); // not in the results

  assert.equal(store.finder.get().target, null);
  assert.match(store.finder.get().error ?? "", /not in the current results/i);
});

test("the finder slice is cleared when the character goes offline", async () => {
  const store = onlineStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.findAgents({ kind: "courier" });
  assert.ok(store.finder.get().agents.length > 0);

  // A lost/released session unwinds like the other held-session pages.
  store.apply({ type: "character/offline" });
  const finder = store.finder.get();
  assert.equal(finder.loaded, false);
  assert.equal(finder.agents.length, 0);
  assert.equal(finder.target, null);
});
