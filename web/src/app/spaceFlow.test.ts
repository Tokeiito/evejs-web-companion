// The R11 Overview controller against a faked BFF: the snapshot read lands in
// the space slice, the row actions reuse the EXISTING atomic moves (warp /
// approach), and the ~1s poll starts with the panel, stops when the ship docks
// or the panel closes, and never queues a slow read behind itself.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { createSpacePoller, SPACE_POLL_INTERVAL_MS } from "./spacePoll.ts";

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

const GATE_ID = 50001248;
const SHIP_ID = 9001;

const SNAPSHOT = {
  inSpace: true,
  solarSystemID: 30000142,
  shipID: SHIP_ID,
  sampledAtMs: 1_700_000_000_000,
  entities: [
    {
      kind: "ship",
      itemID: SHIP_ID,
      typeID: 670,
      groupID: 29,
      categoryID: 6,
      name: "My Capsule",
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      isSelf: true,
    },
    {
      kind: "celestial",
      itemID: GATE_ID,
      typeID: 16,
      groupID: 10,
      categoryID: 2,
      name: "Stargate (Maurasi)",
      position: { x: 1_000, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      isSelf: false,
    },
  ],
  ship: {
    itemID: SHIP_ID,
    typeID: 670,
    name: "My Capsule",
    mode: "STOP",
    shieldRatio: 0.5,
    armorRatio: 0.75,
    hullRatio: 1,
    capacitorRatio: 0.25,
    shieldCapacity: 400,
    armorCapacity: 300,
    hullCapacity: 600,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  },
};

const DOCKED_SNAPSHOT = {
  inSpace: false,
  solarSystemID: 30000142,
  shipID: SHIP_ID,
  entities: [],
  ship: null,
};

const IN_SPACE_FLIGHT = {
  inSpace: true,
  docked: false,
  solarSystemID: 30000142,
  stationID: null,
  structureID: null,
  shipID: SHIP_ID,
  shipMode: "STOP",
  shipSpeedFraction: 0,
};

test("loadSpaceSnapshot reads the surroundings and ship condition into the store", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/space/snapshot") {
      return { status: 200, body: { ok: true, space: SNAPSHOT, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadSpaceSnapshot();

  assert.equal(requests[0]?.path, "/api/bridge/space/snapshot");
  assert.equal(requests[0]?.method, "GET", "the snapshot is a read, never a mutation");

  const space = store.space.get();
  assert.equal(space.loaded, true);
  assert.equal(space.error, null);
  assert.equal(space.snapshot?.inSpace, true);
  assert.equal(space.snapshot?.entities.length, 2);
  // The HUD ratios arrive from the ship readout, not from the ballpark rows.
  assert.equal(space.snapshot?.ship?.shieldRatio, 0.5);
  assert.equal(space.snapshot?.ship?.armorRatio, 0.75);
  assert.equal(space.snapshot?.ship?.hullRatio, 1);
  assert.equal(space.snapshot?.ship?.capacitorRatio, 0.25);
});

test("a failed snapshot read surfaces a reason instead of throwing at the poll", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 502,
    body: { ok: false, error: "CALL_FAILED", message: "space read failed" },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadSpaceSnapshot();

  const space = store.space.get();
  assert.equal(space.loaded, false);
  assert.ok(space.error && space.error.length > 0, "the panel gets a visible reason");
  assert.match(space.error ?? "", /could not be read/);
});

test("a snapshot that says the ship is docked clears the overview", async () => {
  const store = createClientStore();
  let payload: unknown = SNAPSHOT;
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, space: payload, notifications: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadSpaceSnapshot();
  assert.equal(store.space.get().snapshot?.entities.length, 2);

  payload = DOCKED_SNAPSHOT;
  await flow.loadSpaceSnapshot();

  const space = store.space.get();
  assert.equal(space.snapshot, null, "docking drops the stale grid");
  assert.equal(space.loaded, false);
});

test("Warp to and Approach on a row reuse the existing atomic moves", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/warp" || path === "/api/bridge/flight/approach") {
      return { status: 200, body: { ok: true, flight: IN_SPACE_FLIGHT, notifications: [] } };
    }
    if (path === "/api/bridge/flight/status") {
      return { status: 200, body: { ok: true, flight: IN_SPACE_FLIGHT, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  // The row hands the object's own id straight to the R5a moves — no new
  // movement surface is introduced by the overview.
  await flow.warpTo(GATE_ID);
  await flow.approach(GATE_ID);

  const warp = requests.find((entry) => entry.path === "/api/bridge/flight/warp");
  assert.ok(warp, "Warp to issues the existing warp move");
  assert.equal(warp?.method, "POST");
  assert.deepEqual(warp?.body, { destinationID: GATE_ID });

  const approach = requests.find((entry) => entry.path === "/api/bridge/flight/approach");
  assert.ok(approach, "Approach issues the existing approach move");
  assert.equal(approach?.method, "POST");
  assert.deepEqual(approach?.body, { destinationID: GATE_ID });

  assert.equal(store.flight.get().lastAction, "Approach");
});

test("a refused move from a row is shown as a reason, not a silent no-op", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/flight/warp") {
      return {
        status: 409,
        body: { ok: false, error: "CALL_REFUSED", message: "You are warp scrambled." },
      };
    }
    if (path === "/api/bridge/flight/status") {
      return { status: 200, body: { ok: true, flight: IN_SPACE_FLIGHT, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.warpTo(GATE_ID);

  assert.match(store.flight.get().actionError ?? "", /Warp refused: .*You are warp scrambled\./);
});

test("the overview poll runs at the retail overview cadence", () => {
  assert.equal(SPACE_POLL_INTERVAL_MS, 1_000);
});

test("the poll starts with the panel and stops when the ship is no longer in space", async () => {
  let armedMs: number | null = null;
  // Held in an object: assigning inside a callback would otherwise let TS narrow
  // the local to `null` and reject the call below.
  const timer: { fire: (() => void) | null } = { fire: null };
  let cleared = 0;
  let inSpace = true;
  let reads = 0;

  const poller = createSpacePoller({
    refresh: () => {
      reads += 1;
    },
    shouldPoll: () => inSpace,
    setInterval: (handler, ms) => {
      armedMs = ms;
      timer.fire = handler;
      return "handle";
    },
    clearInterval: () => {
      cleared += 1;
      armedMs = null;
    },
  });

  poller.start();
  assert.equal(poller.running(), true);
  assert.equal(armedMs, SPACE_POLL_INTERVAL_MS);

  timer.fire?.();
  await Promise.resolve();
  assert.equal(reads, 1);

  // Starting twice must not arm a second timer (no doubled cadence).
  poller.start();
  assert.equal(cleared, 0);

  // The ship docks: the very next beat stops the poll instead of reading.
  inSpace = false;
  await poller.tick();
  assert.equal(reads, 1, "a docked ship stops polling rather than reading again");
  assert.equal(poller.running(), false);
  assert.equal(cleared, 1);
});

test("a slow snapshot read is skipped, never queued behind itself", async () => {
  let started = 0;
  const pending: { release: (() => void) | null } = { release: null };
  const poller = createSpacePoller({
    refresh: () => {
      started += 1;
      return new Promise<void>((resolve) => {
        pending.release = resolve;
      });
    },
    shouldPoll: () => true,
    setInterval: () => "handle",
    clearInterval: () => {},
  });

  const first = poller.tick();
  assert.equal(started, 1);

  // A beat that lands while the first read is still in flight does nothing —
  // so a slow read can never pile up work behind the autopilot's own calls.
  await poller.tick();
  assert.equal(started, 1);

  pending.release?.();
  await first;

  // Once the read completes the next beat proceeds normally.
  const second = poller.tick();
  assert.equal(started, 2, "the beat after a completed read reads again");
  pending.release?.();
  await second;
});

test("a failing read keeps the poller alive for the next beat", async () => {
  let attempts = 0;
  const poller = createSpacePoller({
    refresh: () => {
      attempts += 1;
      return Promise.reject(new Error("transient"));
    },
    shouldPoll: () => true,
    setInterval: () => "handle",
    clearInterval: () => {},
  });

  await poller.tick();
  await poller.tick();

  assert.equal(attempts, 2, "a failed read must not tear the poller down");
});

test("stopSpacePolling ends the poll when the panel closes", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, space: SNAPSHOT, notifications: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  flow.startSpacePolling();
  flow.stopSpacePolling();

  // Give any armed timer a chance to fire; nothing should have been read.
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    requests.filter((entry) => entry.path === "/api/bridge/space/snapshot").length,
    0,
    "closing the panel leaves no poll running",
  );
});
