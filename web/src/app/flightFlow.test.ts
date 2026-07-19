// The R5a Flight controller against a faked BFF: undock/warp/jump/dock issue
// their BFF step and refresh the flight snapshot in the store; a movement
// refusal is surfaced as a visible reason (never a silent no-op) with the true
// state re-read; a lost session unwinds to offline.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function makeFakeFetch(
  responder: (path: string, method: string, body: Record<string, unknown>) => { status: number; body: unknown },
): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, method, body });
    const outcome = responder(path, method, body);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, requests };
}

async function waitFor(cond: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries && !cond(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const DOCKED = { inSpace: false, docked: true, solarSystemID: 30000142, stationID: 60003760, structureID: null, shipID: 9001, shipMode: null, shipSpeedFraction: null };
const IN_SPACE = { inSpace: true, docked: false, solarSystemID: 30000142, stationID: null, structureID: null, shipID: 9001, shipMode: "WARP", shipSpeedFraction: 1 };
const JUMPED = { ...IN_SPACE, solarSystemID: 30000140, shipMode: "STOP", shipSpeedFraction: 0 };

test("loadFlightStatus reads the current status into the store", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/status") {
      return { status: 200, body: { ok: true, flight: DOCKED, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadFlightStatus();

  const flight = store.flight.get();
  assert.equal(flight.loaded, true);
  assert.equal(flight.status?.docked, true);
  assert.equal(flight.status?.stationID, 60003760);
});

test("undock issues ship.Undock and refreshes the in-space snapshot", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/undock") {
      return { status: 200, body: { ok: true, flight: IN_SPACE, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.undock();

  assert.equal(requests[0]?.path, "/api/bridge/flight/undock");
  assert.equal(requests[0]?.method, "POST");
  const flight = store.flight.get();
  assert.equal(flight.status?.inSpace, true);
  assert.equal(flight.lastAction, "Undock");
  assert.equal(flight.actionError, null);
});

test("warp posts the chosen destination and records the step", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/warp") {
      return { status: 200, body: { ok: true, result: null, flight: IN_SPACE, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.warpTo(50001248);

  assert.deepEqual(requests[0]?.body, { destinationID: 50001248 });
  assert.equal(store.flight.get().lastAction, "Warp");
});

test("jump posts both gate IDs; a follow-up status shows the new system", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/jump") {
      return { status: 200, body: { ok: true, result: null, flight: JUMPED, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.jump(50001248, 50000802);

  assert.deepEqual(requests[0]?.body, { fromGateID: 50001248, toGateID: 50000802 });
  const flight = store.flight.get();
  assert.equal(flight.status?.solarSystemID, 30000140);
  assert.equal(flight.lastAction, "Jump");
});

test("dock returns the character to a station", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/dock") {
      return { status: 200, body: { ok: true, result: null, flight: DOCKED, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.dock(60003760);

  assert.deepEqual(requests[0]?.body, { stationID: 60003760 });
  assert.equal(store.flight.get().status?.docked, true);
  assert.equal(store.flight.get().lastAction, "Dock");
});

test("a movement refusal is surfaced as a visible reason and the true state re-read", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/warp") {
      // The handler's own refusal (e.g. warp scrambled) passes through as a
      // CALL_REFUSED with the handler text.
      return { status: 409, body: { ok: false, error: "CALL_REFUSED", message: "You are warp scrambled." } };
    }
    if (path === "/api/bridge/flight/status") {
      return { status: 200, body: { ok: true, flight: IN_SPACE, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.warpTo(50001248);

  const flight = store.flight.get();
  assert.match(flight.actionError ?? "", /Warp refused/);
  assert.match(flight.actionError ?? "", /warp scrambled/i);
  // The true state was re-read after the refusal (never a fake success).
  assert.equal(flight.status?.inSpace, true);
  assert.ok(requests.some((r) => r.path === "/api/bridge/flight/status"));
});

test("the flight status resolves system + station NAMES, cached across polls (R7a)", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/status") {
      return { status: 200, body: { ok: true, flight: DOCKED, notifications: [] } };
    }
    if (path === "/api/map/resolve/30000142") {
      return { status: 200, body: { ok: true, id: 30000142, kind: "system", solarSystemID: 30000142, systemName: "Jita" } };
    }
    if (path === "/api/map/resolve/60003760") {
      return { status: 200, body: { ok: true, id: 60003760, kind: "station", stationID: 60003760, stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant", solarSystemID: 30000142, systemName: "Jita" } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadFlightStatus();
  await waitFor(() => store.flight.get().solarSystemName !== null && store.flight.get().stationName !== null);

  const flight = store.flight.get();
  assert.equal(flight.solarSystemName, "Jita");
  assert.equal(flight.stationName, "Jita IV - Moon 4 - Caldari Navy Assembly Plant");

  // A second poll of the same location does NOT refetch the names (cached).
  const resolveBefore = requests.filter((r) => r.path.startsWith("/api/map/resolve/")).length;
  assert.equal(resolveBefore, 2);
  await flow.loadFlightStatus();
  await waitFor(() => true);
  const resolveAfter = requests.filter((r) => r.path.startsWith("/api/map/resolve/")).length;
  assert.equal(resolveAfter, resolveBefore, "names are cached; the second poll issues no resolve calls");
});

test("a lost session during a movement step unwinds to offline", async () => {
  const store = createClientStore();
  store.apply({
    type: "character/online",
    character: { characterID: 140000003, characterName: "Test", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 98000000 },
    station: null,
  });
  const { fetch } = makeFakeFetch(() => ({
    status: 404,
    body: { ok: false, error: "SESSION_NOT_FOUND", message: "Bridge session gone." },
  }));
  const flow = createAppFlow(store, { fetch });

  await assert.rejects(
    () => flow.undock(),
    (error: unknown) => (error as { code?: string }).code === "SESSION_NOT_FOUND",
  );
  // The station slice was cleared (character/offline), unwinding to select.
  assert.equal(store.station.get().online, null);
});
