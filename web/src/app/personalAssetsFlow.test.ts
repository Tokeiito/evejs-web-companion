// R37 — the Personal Assets flow, against the REAL BFF envelopes.
//
// The payloads below are the verbatim bodies of live reads against the running
// emulator (account `test2`, character GM Elysian docked-list at Jita IV-4).
//
// The three facts this suite exists to keep apart:
//   * nothing loaded yet
//   * the read FAILED
//   * the read SUCCEEDED and the character genuinely owns nothing
// Every previous panel in this codebase that conflated the last two rendered a
// broken read as an empty world, which is why `ownsNothing` is a fact carried
// from the BFF rather than inferred from an empty array here.
//
// Since 2026-10-11 the list of stations is the page's own read (bridge/assetReads.ts): charMgr.ListStations by
// the generic call, as the client's assets window asks it. "Owns nothing" is said there of a rowset read and
// empty, and of nothing else. What is at a station is its route's still.

import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "../store/clientStore.ts";
import { createAppFlow } from "./flow.ts";

const STATION_ID = 60003760;
const SYSTEM_ID = 30000142;
const STATION_TYPE_ID = 52678;

const STATION_COLUMNS = [
  ["stationID", 20],
  ["solarSystemID", 20],
  ["typeID", 3],
  ["itemCount", 3],
  ["upkeepState", 17],
];

const ITEM_COLUMNS = [
  ["itemID", 20],
  ["typeID", 3],
  ["ownerID", 3],
  ["locationID", 20],
  ["flagID", 2],
  ["quantity", 3],
  ["groupID", 3],
  ["categoryID", 3],
  ["customInfo", 129],
  ["singleton", 2],
  ["stacksize", 3],
];

/** charMgr.ListStations' CRowset — rows on `list`, positional packedrows. */
function stationsCrowset(rows: unknown[][]): unknown {
  return {
    type: "objectex2",
    header: [
      [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
      { type: "dict", entries: [["header", { type: "objectex1", header: [], list: [], dict: [] }]] },
    ],
    list: rows.map((values) => ({
      type: "packedrow",
      header: { type: "objectex1", header: [], list: [], dict: [] },
      columns: STATION_COLUMNS,
      values,
    })),
    dict: [],
  };
}

/** charMgr.ListStationItems' list — a DIFFERENT shape: name-keyed packedrows. */
function stationItems(rows: Record<string, unknown>[]): unknown {
  return {
    type: "list",
    items: rows.map((fields) => ({
      type: "packedrow",
      header: { type: "objectex1", header: [], list: [], dict: [] },
      columns: ITEM_COLUMNS,
      fields,
    })),
  };
}

/** The live rows GM Elysian's read returned, verbatim (quantity -1 and all). */
const LIVE_ITEM_ROWS: Record<string, unknown>[] = [
  {
    itemID: 9988400022135, typeID: 9854, ownerID: 140000004, locationID: STATION_ID,
    flagID: 4, quantity: -1, groupID: 237, categoryID: 6, customInfo: "",
    singleton: 1, stacksize: 1,
  },
  {
    itemID: 9988400022136, typeID: 40340, ownerID: 140000004, locationID: STATION_ID,
    flagID: 4, quantity: 12, groupID: 1657, categoryID: 65, customInfo: "",
    singleton: 0, stacksize: 12,
  },
];

const LIVE_VOLUMES = { "9854": 20400, "40340": 800000 };

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function makeFakeFetch(
  responder: (path: string, body: Record<string, unknown>) => { status: number; body: unknown },
): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    requests.push({
      path,
      method: (init && init.method) || "GET",
      body: init && typeof init.body === "string" ? JSON.parse(init.body) : {},
    });
    const outcome = responder(path, init && typeof init.body === "string" ? JSON.parse(init.body) : {});
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

/** The BFF's own successful envelope, exactly as GET /api/bridge/assets sends it. */
function assetsPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    characterID: 140000004,
    stations: stationsCrowset([[STATION_ID, SYSTEM_ID, STATION_TYPE_ID, 9, null]]),
    ownsNothing: false,
    error: null,
    ...overrides,
  };
}

function stationPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    stationID: STATION_ID,
    items: stationItems(LIVE_ITEM_ROWS),
    volumes: LIVE_VOLUMES,
    hasNoItems: false,
    error: null,
    ...overrides,
  };
}

/** The page's own read of where the pilot's things are: charMgr.ListStations by the generic call. */
const isStationsCall = (path: string, body: Record<string, unknown>): boolean =>
  path === "/api/bridge/call" && body.service === "charMgr" && body.method === "ListStations";
const stationsAnswer = (rows: unknown[][]) => ({ status: 200, body: { ok: true, service: "charMgr", method: "ListStations", result: stationsCrowset(rows), notifications: [] } });
// assetsWindow.py 923, invCache.py 833: self.moniker.ListStations(), nothing sent, on the pilot's own object.
const THE_STATIONS_READ = { service: "charMgr", method: "ListStations", args: [], kwargs: null, pilot: true };
/** Another station than the one the page's own read answers: what the route says, which nothing is to ask. */
const THE_ROUTES_STATION = 60008494;

function respondOk(extra: (path: string, body: Record<string, unknown>) => unknown = () => null) {
  return (path: string, body: Record<string, unknown> = {}) => {
    const custom = extra(path, body);
    if (custom !== null && custom !== undefined) {
      return custom as { status: number; body: unknown };
    }
    if (path.startsWith("/api/bridge/assets/station")) {
      return { status: 200, body: stationPayload() };
    }
    if (path.startsWith("/api/bridge/assets")) {
      return { status: 200, body: assetsPayload({ stations: stationsCrowset([[THE_ROUTES_STATION, 30002187, 1529, 1, null]]) }) };
    }
    if (isStationsCall(path, body)) {
      return stationsAnswer([[STATION_ID, SYSTEM_ID, STATION_TYPE_ID, 9, null]]);
    }
    if (path === "/api/names") {
      return { status: 200, body: { ok: true, names: {} } };
    }
    return { status: 200, body: { ok: true } };
  };
}

function makeFlow(responder: ReturnType<typeof respondOk>) {
  const store = createClientStore();
  const { fetch: fakeFetch, requests } = makeFakeFetch(responder);
  const flow = createAppFlow(store, { fetch: fakeFetch });
  return { store, flow, requests };
}

async function settleNames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// --- the happy path ---------------------------------------------------------

test("a live read lands the character's stations in the store, by the page's own call and never by the route", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadPersonalAssets();
  assert.deepEqual(requests.filter((entry) => entry.path === "/api/bridge/call").map((entry) => entry.body), [THE_STATIONS_READ]);
  assert.deepEqual(requests.filter((entry) => entry.path.startsWith("/api/bridge/assets")), []);

  const assets = store.get().assets;
  assert.equal(assets.loaded, true);
  assert.equal(assets.error, null);
  assert.equal(assets.ownsNothing, false);
  assert.equal(assets.stations.length, 1);
  assert.equal(assets.stations[0]!.stationID, STATION_ID);
  assert.equal(assets.stations[0]!.itemCount, 9);
});

test("expanding a station reads it and keeps its contents under that station", async () => {
  const { store, flow } = makeFlow(respondOk());
  await flow.loadPersonalAssets();
  await flow.openAssetStation(STATION_ID);

  const assets = store.get().assets;
  assert.equal(assets.expandedStationID, STATION_ID);
  const contents = assets.contents[STATION_ID]!;
  assert.equal(contents.error, null);
  assert.equal(contents.items.length, 2);
  // The assembled ship counts as one, not as the -1 the wire carries.
  assert.equal(contents.items.find((item) => item.typeID === 9854)!.units, 1);
  assert.equal(contents.items.find((item) => item.typeID === 40340)!.units, 12);
  // Volume arrived from the BFF's static map.
  assert.equal(contents.items.find((item) => item.typeID === 40340)!.volume, 800000);
});

test("collapsing a station touches no server", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadPersonalAssets();
  const before = requests.length;
  await flow.openAssetStation(null);
  assert.equal(store.get().assets.expandedStationID, null);
  assert.equal(requests.length, before, "collapsing must not issue a read");
});

// --- empty is NOT failed ----------------------------------------------------

test("a SUCCESSFUL empty read says the character owns nothing", async () => {
  const { store, flow } = makeFlow(
    respondOk((path, body) => (isStationsCall(path, body) ? stationsAnswer([]) : null)),
  );
  await flow.loadPersonalAssets();

  const assets = store.get().assets;
  assert.equal(assets.ownsNothing, true, "a successful empty read may say so");
  assert.equal(assets.error, null);
  assert.deepEqual(assets.stations, []);
});

test("a FAILED read never claims the character owns nothing", async () => {
  const { store, flow } = makeFlow(
    respondOk((path, body) =>
      isStationsCall(path, body) ? { status: 502, body: { ok: false, error: "CALL_FAILED", message: "CALL_FAILED" } } : null,
    ),
  );
  await flow.loadPersonalAssets();

  const assets = store.get().assets;
  // THE WHOLE POINT: an empty list here must not be readable as "you own
  // nothing". The panel branches on these two fields, and they disagree.
  // (The call's own code is what the failure is kept as.)
  assert.equal(assets.error, "CALL_FAILED");
  assert.equal(assets.ownsNothing, false, "a failed read may never make that claim");
  assert.equal(assets.loaded, true, "the attempt completed, so the panel stops waiting");
  assert.deepEqual(assets.stations, []);
});

test("a read that reports an error is not rendered, even if it carried rows", async () => {
  // Defence in depth against a PARTIAL answer. If a refusal ever arrives with
  // some rows on it, showing those rows would present a
  // known-incomplete list as if it were the whole truth — the player would see
  // "your things are in 1 place" when the read that would have found the other
  // places failed. The error wins; nothing is decoded.
  const { store, flow } = makeFlow(
    respondOk((path, body) =>
      isStationsCall(path, body)
        ? {
            status: 502,
            body: { ok: false, error: "CALL_FAILED", message: "CALL_FAILED", result: stationsCrowset([[STATION_ID, SYSTEM_ID, STATION_TYPE_ID, 9, null]]) },
          }
        : null,
    ),
  );
  await flow.loadPersonalAssets();

  const assets = store.get().assets;
  assert.equal(assets.error, "CALL_FAILED");
  assert.deepEqual(
    assets.stations,
    [],
    "a partial answer must not be shown as if the read had succeeded",
  );
});

test("a station whose contents fail keeps the failure to itself", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/assets/station")
        ? {
            status: 200,
            body: stationPayload({ items: null, hasNoItems: false, error: "READ_FAILED" }),
          }
        : null,
    ),
  );
  await flow.loadPersonalAssets();
  await flow.openAssetStation(STATION_ID);

  const assets = store.get().assets;
  // The station LIST survived; only the one station's contents are missing.
  assert.equal(assets.stations.length, 1);
  assert.equal(assets.error, null);
  const contents = assets.contents[STATION_ID]!;
  assert.equal(contents.error, "READ_FAILED");
  assert.equal(contents.hasNoItems, false, "a failed read is not an empty station");
  assert.deepEqual(contents.items, []);
});

test("a station's failed read is not rendered, even if it carried rows", async () => {
  // The same defence as above, on the per-station read: a partial list of what
  // is stored somewhere is worse than saying the read failed, because the
  // player would believe they had seen everything.
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/assets/station")
        ? {
            status: 200,
            body: stationPayload({
              items: stationItems(LIVE_ITEM_ROWS),
              hasNoItems: false,
              error: "READ_FAILED",
            }),
          }
        : null,
    ),
  );
  await flow.loadPersonalAssets();
  await flow.openAssetStation(STATION_ID);

  const contents = store.get().assets.contents[STATION_ID]!;
  assert.equal(contents.error, "READ_FAILED");
  assert.deepEqual(contents.items, [], "a partial answer is not shown as the whole truth");
});

test("a station that is genuinely empty says so, distinctly", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/assets/station")
        ? {
            status: 200,
            body: stationPayload({ items: stationItems([]), hasNoItems: true }),
          }
        : null,
    ),
  );
  await flow.loadPersonalAssets();
  await flow.openAssetStation(STATION_ID);

  const contents = store.get().assets.contents[STATION_ID]!;
  assert.equal(contents.hasNoItems, true);
  assert.equal(contents.error, null);
});

// --- R7d --------------------------------------------------------------------

test("every id the panel will show is asked for by NAME in one round-trip", async () => {
  const { flow, requests } = makeFlow(respondOk());
  await flow.loadPersonalAssets();
  await settleNames();

  const nameRequest = requests.find((entry) => entry.path === "/api/names");
  assert.ok(nameRequest, "names resolve in ONE batched round-trip");
  const asked = (nameRequest.body.items as { kind: string; id: number }[]) ?? [];
  const keys = new Set(asked.map((ref) => `${ref.kind}:${ref.id}`));
  // Without these the page reads "an unnamed place" in "an unnamed system".
  assert.ok(keys.has(`station:${STATION_ID}`), "the place itself");
  assert.ok(keys.has(`system:${SYSTEM_ID}`), "and the system it sits in");
  assert.ok(keys.has(`type:${STATION_TYPE_ID}`), "and its type, for the icon");
});

test("expanding a station asks for its item types by name", async () => {
  const { flow, requests } = makeFlow(respondOk());
  await flow.loadPersonalAssets();
  await settleNames();
  const before = requests.filter((entry) => entry.path === "/api/names").length;

  await flow.openAssetStation(STATION_ID);
  await settleNames();

  const nameRequests = requests.filter((entry) => entry.path === "/api/names");
  assert.ok(nameRequests.length > before, "the new types trigger a resolve");
  const asked = nameRequests
    .flatMap((entry) => (entry.body.items as { kind: string; id: number }[]) ?? []);
  const keys = new Set(asked.map((ref) => `${ref.kind}:${ref.id}`));
  assert.ok(keys.has("type:9854"), "the ship");
  assert.ok(keys.has("type:40340"), "and the stack beside it");
});

// --- setting a destination --------------------------------------------------

test("setting a destination from an asset location plans a real route", async () => {
  // The map graph the route solver reads, plus the resolve of the station.
  // Three systems in a line: the character is in 30000140, the assets are in
  // Jita (30000142), and 30000141 sits between them.
  const graph = {
    ok: true,
    source: "static-data",
    systemCount: 3,
    edgeCount: 2,
    systems: [
      { solarSystemID: 30000140, solarSystemName: "Origin", regionID: 10000002, security: 0.9 },
      { solarSystemID: 30000141, solarSystemName: "Middle", regionID: 10000002, security: 0.9 },
      { solarSystemID: SYSTEM_ID, solarSystemName: "Jita", regionID: 10000002, security: 0.9 },
    ],
    edges: [
      [30000140, 30000141, 50001, 50002],
      [30000141, SYSTEM_ID, 50003, 50004],
    ],
    // Each system's security, as the map is served: the route is the client's autopilot's, which goes by it.
    security: { 30000140: 0.9, 30000141: 0.9, [SYSTEM_ID]: 0.9 },
  };

  const { store, flow } = makeFlow((path: string, body: Record<string, unknown> = {}) => {
    if (path === "/api/map/graph") {
      return { status: 200, body: graph };
    }
    if (path.startsWith("/api/map/resolve/")) {
      return {
        status: 200,
        body: {
          ok: true,
          kind: "station",
          stationID: STATION_ID,
          stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
          solarSystemID: SYSTEM_ID,
          systemName: "Jita",
        },
      };
    }
    if (path === "/api/bridge/flight/status") {
      return {
        status: 200,
        body: {
          ok: true,
          flight: { docked: false, solarSystemID: 30000140, stationID: null, shipID: 1 },
        },
      };
    }
    return respondOk()(path, body);
  });

  await flow.loadPersonalAssets();
  await flow.setDestinationToAssetStation(STATION_ID);
  const travel = store.get().travel;
  // ⚠ STOP THE LOOP. startRoute hands the plan to the shared autopilot
  // controller and lets it run on a 2 s cadence; without this the test process
  // never exits. Read the state FIRST, then abort.
  flow.abortRoute();

  // The route was actually SOLVED — the destination is the asset station, and
  // it is two jumps away through the graph above.
  assert.equal(travel.destinationStationID, STATION_ID);
  assert.equal(travel.destinationSystemID, SYSTEM_ID);
  assert.equal(travel.totalJumps, 2);
  assert.equal(travel.failureReason, null);
  // R7d: what the panel shows is the NAME, never the id.
  assert.match(String(travel.destinationName), /Jita/);
});

// --- the list of stations, as the page's own read -----------------------------

test("an answer that is no rowset is a read that failed, and never nothing owned", async () => {
  const answers: Array<[string, unknown]> = [["nothing", null], ["a list", { type: "list", items: [] }], ["a yes", true], ["the route's envelope", assetsPayload({ ownsNothing: true })]];
  for (const [what, result] of answers) {
    const { store, flow } = makeFlow(
      respondOk((path, body) => (isStationsCall(path, body) ? { status: 200, body: { ok: true, service: "charMgr", method: "ListStations", result, notifications: [] } } : null)),
    );
    await flow.loadPersonalAssets();
    const assets = store.get().assets;
    assert.deepEqual([assets.loaded, assets.error, assets.ownsNothing, assets.stations], [true, "READ_FAILED", false, []], what);
  }
});

test("a pilot's session gone, or none held, fails the load itself: it is not kept as the read's failure", async () => {
  for (const [status, error] of [[404, "SESSION_NOT_FOUND"], [409, "NO_LIVE_SESSION"]] as const) {
    const { store, flow } = makeFlow(
      respondOk((path, body) => (isStationsCall(path, body) ? { status, body: { ok: false, error, message: error } } : null)),
    );
    store.apply({ type: "character/online", character: {
      characterID: 140000004, characterName: "Test", stationID: STATION_ID,
      structureID: null, solarSystemID: SYSTEM_ID, corporationID: 98000000,
    }, station: null } as never);
    assert.notEqual(store.get().station.online, null, error);
    await assert.rejects(flow.loadPersonalAssets(), (reason: { code?: string }) => reason.code === error, error);
    assert.deepEqual([store.get().assets.loaded, store.get().assets.error], [false, null], error);
    // And the pilot is offline to the page: its session is the server's no longer.
    assert.equal(store.get().station.online, null, error);
  }
});

test("names are asked for the stations the page's own read answered, and for none of the route's", async () => {
  const { flow, requests } = makeFlow(respondOk());
  await flow.loadPersonalAssets();
  await settleNames();
  const asked = requests.filter((entry) => entry.path === "/api/names").flatMap((entry) => (entry.body.items as { kind: string; id: number }[]) ?? []);
  assert.deepEqual(asked.filter((ref) => ref.kind === "station").map((ref) => ref.id), [STATION_ID]);
  assert.equal(asked.some((ref) => ref.id === THE_ROUTES_STATION), false);
});
