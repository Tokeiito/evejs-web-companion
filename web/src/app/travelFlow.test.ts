// The R5b Travel flow against a faked BFF: startRoute loads the client-side
// route graph, reads the origin from flight-status, resolves the destination,
// solves the route, applies travel/planned, and launches the decide-loop.
// Unreachable/unknown destinations surface a plan error (not a throw). Abort
// stops the loop. The decide-loop's own atomic sequencing is covered
// exhaustively in nav/autopilotLoop.test.ts; here we cover the flow wiring.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

// A 3-system line: Alpha(1) <-> Bravo(2) <-> Charlie(3). The origin is Alpha
// (from flight-status), the destination station 60000003 is in Charlie.
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

// A permissive responder: the graph, resolve, flight-status, and movement
// endpoints all answer so the background loop's ticks are harmless.
function defaultResponder(path: string): { status: number; body: unknown } {
  if (path === "/api/map/graph") {
    return { status: 200, body: GRAPH };
  }
  if (path.startsWith("/api/map/resolve/")) {
    const id = Number(path.split("/").pop());
    if (id === 60000003) {
      return { status: 200, body: { ok: true, id, kind: "station", stationID: id, stationName: "Charlie Station", solarSystemID: 3, systemName: "Charlie" } };
    }
    if (id === 99999999) {
      return { status: 200, body: { ok: true, id, kind: "unknown", solarSystemID: null } };
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

test("startRoute solves a multi-hop route and applies travel/planned", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.startRoute(60000003); // station in Charlie(3)
  flow.abortRoute(); // stop the background loop

  const travel = store.travel.get();
  assert.equal(travel.destinationSystemID, 3);
  assert.equal(travel.destinationStationID, 60000003);
  assert.equal(travel.destinationName, "Charlie Station");
  assert.equal(travel.totalJumps, 2);
  assert.deepEqual(
    travel.route.map((h) => [h.fromSystemID, h.toSystemID, h.gateToWarpID, h.jumpToGateID]),
    [
      [1, 2, 112, 211],
      [2, 3, 223, 322],
    ],
  );
  assert.equal(travel.route[0]?.fromSystemName, "Alpha");
  assert.equal(travel.route[1]?.toSystemName, "Charlie");
});

test("startRoute to a same-system destination plans zero jumps", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.startRoute(1); // Alpha, our current system
  flow.abortRoute();

  const travel = store.travel.get();
  assert.equal(travel.totalJumps, 0);
  assert.equal(travel.destinationSystemID, 1);
  assert.equal(travel.route.length, 0);
});

test("startRoute surfaces an unreachable destination as a plan error", async () => {
  const store = createClientStore();
  const responder = (path: string) => {
    if (path === "/api/map/resolve/50") {
      return { status: 200, body: { ok: true, id: 50, kind: "system", solarSystemID: 50, systemName: "Island" } };
    }
    return defaultResponder(path);
  };
  const flow = createAppFlow(store, { fetch: makeFakeFetch(responder) });

  await flow.startRoute(50); // system not in the graph

  const travel = store.travel.get();
  assert.equal(travel.status, "idle");
  assert.match(travel.failureReason ?? "", /No gate route/i);
});

test("startRoute surfaces an unknown destination as a plan error", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.startRoute(99999999);

  const travel = store.travel.get();
  assert.equal(travel.status, "idle");
  assert.match(travel.failureReason ?? "", /Unknown destination/i);
});

test("abortRoute after start marks the travel state aborted", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: makeFakeFetch(defaultResponder) });

  await flow.startRoute(60000003);
  flow.abortRoute();

  assert.equal(store.travel.get().status, "aborted");
});
