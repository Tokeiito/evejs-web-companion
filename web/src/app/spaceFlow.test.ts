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
  // ⚠ R89 raised this from 1_000; R90 settled it at 333. It is the rate at which
  // the picture is TRUE; the viewport draws every animation frame and
  // INTERPOLATES between reads (space/deadReckoning.ts), so smoothness is not
  // bought by polling harder.
  assert.equal(SPACE_POLL_INTERVAL_MS, 333);
});

test("a beat is SKIPPED while a read is still in flight", async () => {
  // The safety property that makes 5 Hz sane: a server that cannot answer in
  // 200 ms is throttled to whatever it can actually do, instead of accumulating
  // a queue of overlapping reads.
  let inFlight = 0;
  let peak = 0;
  // Held in an object for the same reason the test above does it: assigning
  // inside a callback lets TS narrow the local to `never` and reject the call.
  const held: { release: (() => void) | null } = { release: null };
  const poller = createSpacePoller({
    refresh: () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<void>((resolve) => {
        held.release = () => {
          inFlight -= 1;
          resolve();
        };
      });
    },
    shouldPoll: () => true,
    intervalMs: 5,
  });
  poller.start();
  await new Promise((resolve) => setTimeout(resolve, 60));
  held.release?.();
  poller.stop();
  assert.equal(peak, 1, "reads must never overlap");
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

// --- R30 slice B: the space feed is CLAIMED, not switched --------------------
//
// These replace a single test that asserted "one start, one stop, no poll".
// That was true, and it was the bug: the Overview panel was the only caller, so
// leaving its tab froze the snapshot, the locks, the gauges, the distances and
// the hostile list for a ship that was still flying. The semantics being pinned
// now are a REFERENCE COUNT — the assertion is not weakened, it is re-pointed at
// the guarantee that actually matters.

function snapshotReads(requests: readonly { readonly path: string }[]): number {
  return requests.filter((entry) => entry.path === "/api/bridge/space/snapshot").length;
}

test("the LAST release ends the poll — releasing one of two viewers does not", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, space: SNAPSHOT, notifications: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  // Two panels are showing live space data (Overview embeds MiningBot; a tab
  // switch mounts the next panel around the previous one's unmount).
  flow.startSpacePolling();
  flow.startSpacePolling();

  // One of them unmounts. The feed must keep running for the other.
  flow.stopSpacePolling();
  await new Promise((resolve) => setTimeout(resolve, SPACE_POLL_INTERVAL_MS + 40));
  const whileOneViewerRemains = snapshotReads(requests);
  assert.ok(
    whileOneViewerRemains > 0,
    "a surviving viewer must keep the space feed alive — this is the whole slice",
  );

  // The last one unmounts: now it stops.
  flow.stopSpacePolling();
  const atRelease = snapshotReads(requests);
  await new Promise((resolve) => setTimeout(resolve, SPACE_POLL_INTERVAL_MS + 40));
  assert.equal(
    snapshotReads(requests),
    atRelease,
    "the last viewer letting go leaves no poll running",
  );
});

test("a single claim released still ends the poll (the old guarantee, kept)", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, space: SNAPSHOT, notifications: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  flow.startSpacePolling();
  flow.stopSpacePolling();

  // Give any armed timer a chance to fire; nothing should have been read.
  await new Promise((resolve) => setTimeout(resolve, SPACE_POLL_INTERVAL_MS + 40));
  assert.equal(snapshotReads(requests), 0, "no viewers means no poll");
});

test("releases never drive the count negative, so a later claim still polls", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, space: SNAPSHOT, notifications: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  // An unbalanced release (a panel unmounting twice, a teardown ordering quirk)
  // must not leave the count at -1, where the NEXT claim would bring it to zero
  // and the cockpit would silently never update again.
  flow.stopSpacePolling();
  flow.stopSpacePolling();
  flow.startSpacePolling();

  await new Promise((resolve) => setTimeout(resolve, SPACE_POLL_INTERVAL_MS + 40));
  assert.ok(snapshotReads(requests) > 0, "one claim after stray releases still polls");
  flow.stopSpacePolling();
});

// --- R30 slice A: the gate links ride with the snapshot ----------------------

// Jita(30000142) <-> Maurasi(30000140). GATE_ID is the gate ON the Jita grid,
// which is exactly the itemID the overview row for that gate carries.
const GATE_GRAPH = {
  ok: true,
  systems: { "30000142": "Jita", "30000140": "Maurasi" },
  edges: [
    [30000142, 30000140, GATE_ID, 50000802],
    [30000140, 30000142, 50000802, GATE_ID],
  ],
};

function gateResponder(path: string): { status: number; body: unknown } {
  if (path === "/api/map/graph") {
    return { status: 200, body: GATE_GRAPH };
  }
  return { status: 200, body: { ok: true, space: SNAPSHOT, notifications: [] } };
}

test("the gate links reach the space slice, keyed to the snapshot's own system", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(gateResponder);
  const flow = createAppFlow(store, { fetch });

  // The FIRST snapshot lands before the star map has been read — the map load
  // is asynchronous and a snapshot must never wait on it.
  await flow.loadSpaceSnapshot();
  assert.deepEqual(store.space.get().gateLinks, [], "no answer yet, and no guess either");

  // Let the one-time map read settle, then take another beat.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flow.loadSpaceSnapshot();

  assert.deepEqual(store.space.get().gateLinks, [
    {
      gateID: GATE_ID,
      toSystemID: 30000140,
      toSystemName: "Maurasi",
      destinationGateID: 50000802,
    },
  ]);
  assert.equal(store.space.get().gateLinksError, null);
});

test("a later snapshot never wipes the links it has no fresh answer for", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(gateResponder);
  const flow = createAppFlow(store, { fetch });

  await flow.loadSpaceSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flow.loadSpaceSnapshot();
  assert.equal(store.space.get().gateLinks.length, 1);

  // A snapshot with no system to key off (the ship is between states) must
  // leave the links alone rather than blanking every Jump button for a beat.
  store.apply({
    type: "space/snapshot",
    snapshot: { ...store.space.get().snapshot!, solarSystemID: null },
  });
  assert.equal(
    store.space.get().gateLinks.length,
    1,
    "an event carrying no answer keeps the last one",
  );
});

test("a star map that cannot be read says so, once, instead of silently offering nothing", async () => {
  const store = createClientStore();
  let graphReads = 0;
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/map/graph") {
      graphReads += 1;
      return { status: 500, body: { ok: false, error: "map unavailable" } };
    }
    return { status: 200, body: { ok: true, space: SNAPSHOT, notifications: [] } };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadSpaceSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flow.loadSpaceSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flow.loadSpaceSnapshot();

  assert.match(String(store.space.get().gateLinksError), /star map/i);
  assert.deepEqual(store.space.get().gateLinks, []);
  // Said ONCE. A standing condition re-reported every second would bury every
  // other error on the panel, and would re-request a map that is not coming.
  assert.equal(graphReads, 1, "a failed map read is not retried every beat");
});
