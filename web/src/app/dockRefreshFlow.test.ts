// Goal R6b — the docked-station-change refresh. When the character's docked
// station changes on the SAME live session (autopilot arrival / manual dock),
// the flow learns it from a flight-status snapshot and re-fetches the
// station-scoped context (Station panel identity + reads, Agents list,
// Inventory) without a page reload. Opening the Agents tab (its onMount calls
// loadAgents) always shows the current station. Against a faked BFF whose
// "current station" is mutable so every station-scoped read reflects it.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const STATION_A = 60003760; // Jita 4-4 (select landing)
const SYSTEM_A = 30000142; // Jita
const STATION_B = 60003454; // a different station (autopilot dropoff)
const SYSTEM_B = 30000140;
const SHIP_ID = 9001;

// The fake BFF's mutable location: every station-scoped read answers for this.
const current = { stationID: STATION_A, solarSystemID: SYSTEM_A, inSpace: false };

function dockedSnapshot() {
  return {
    inSpace: current.inSpace,
    docked: !current.inSpace,
    solarSystemID: current.solarSystemID,
    stationID: current.inSpace ? null : current.stationID,
    structureID: null,
    shipID: SHIP_ID,
    shipMode: null,
    shipSpeedFraction: null,
  };
}

function stationStaticFor(id: number) {
  return {
    stationID: id,
    stationName: `Station ${id} name`,
    solarSystemName: id === STATION_A ? "Jita" : "Kisogo",
    regionName: "The Forge",
    stationTypeID: 1529,
    stationTypeName: "Caldari Administrative Station",
    operationID: 26,
    security: 0.9,
  };
}

// One agent per station, its agentID derived from the station so the test can
// prove the re-fetch targeted the NEW station.
function agentsFor(stationID: number) {
  return [
    {
      agentID: stationID + 1,
      agentTypeID: 2,
      divisionID: 22,
      level: 1,
      stationID,
      corporationID: 1000001,
      missionKind: "courier",
      missionTypeLabel: "UI/Agents/MissionTypes/Courier",
    },
  ];
}

function makeFakeFetch(): { fetch: typeof fetch; paths: string[] } {
  const paths: string[] = [];
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    paths.push(path);
    const outcome = respond(path, method, body);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, paths };
}

function respond(path: string, _method: string, body: Record<string, unknown>): { status: number; body: unknown } {
  if (path === "/api/login") {
    return { status: 200, body: { ok: true, account: { accountID: 2, username: "pilot" } } };
  }
  if (path === "/api/bridge/select") {
    return {
      status: 200,
      body: {
        ok: true,
        character: {
          characterID: 140000003,
          characterName: "Test Pilot",
          stationID: STATION_A,
          structureID: null,
          solarSystemID: SYSTEM_A,
          corporationID: 98000000,
        },
        station: stationStaticFor(STATION_A),
        notifications: [],
      },
    };
  }
  if (path === "/api/bridge/call") {
    const m = String(body.method || "");
    if (m === "GetCharacterSelectionData") {
      const characterRow = {
        type: "object",
        name: "util.KeyVal",
        args: { type: "dict", entries: [["characterID", 140000003], ["characterName", "Test Pilot"], ["stationID", STATION_A]] },
      };
      return {
        status: 200,
        body: {
          ok: true,
          service: "charUnboundMgr",
          method: m,
          result: [{ type: "list", items: [] }, [null, null], { type: "list", items: [characterRow] }, { type: "list", items: [] }],
          notifications: [],
        },
      };
    }
    if (m === "GetStationItemBits") {
      return { status: 200, body: { ok: true, service: "stationSvc", method: m, result: [1000035, current.stationID, 26, 1529], notifications: [] } };
    }
    if (m === "GetGuests") {
      return { status: 200, body: { ok: true, service: "station", method: m, result: { type: "list", items: [[140000003, 98000000, null, null]] }, notifications: [] } };
    }
    if (m === "GetStationInfo") {
      return {
        status: 200,
        body: {
          ok: true,
          service: "map",
          method: m,
          result: { type: "object", name: { value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" }, args: [] },
          notifications: [],
        },
      };
    }
  }
  if (path === "/api/bridge/flight/status") {
    return { status: 200, body: { ok: true, flight: dockedSnapshot(), notifications: [] } };
  }
  if (path === "/api/bridge/flight/dock") {
    // The dock advances the live location to station B (as the sim would).
    current.stationID = STATION_B;
    current.solarSystemID = SYSTEM_B;
    current.inSpace = false;
    return { status: 200, body: { ok: true, result: null, flight: dockedSnapshot(), notifications: [] } };
  }
  if (path === "/api/bridge/agents") {
    return { status: 200, body: { ok: true, stationID: current.stationID, agents: agentsFor(current.stationID) } };
  }
  if (path === "/api/bridge/inventory") {
    return {
      status: 200,
      body: {
        ok: true,
        stationID: current.stationID,
        activeShipID: SHIP_ID,
        hangar: { list: null, capacity: null, error: null },
        cargo: { list: null, capacity: null, error: null, shipID: SHIP_ID },
      },
    };
  }
  if (path.startsWith("/api/map/station/")) {
    const id = Number(path.split("/").pop());
    return { status: 200, body: { ok: true, source: "static-data", station: stationStaticFor(id) } };
  }
  return { status: 500, body: { ok: false, error: "UNEXPECTED", message: path } };
}

test.beforeEach(() => {
  current.stationID = STATION_A;
  current.solarSystemID = SYSTEM_A;
  current.inSpace = false;
});

async function onlineFlow() {
  const { fetch, paths } = makeFakeFetch();
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch });
  await flow.login("pilot", "");
  await flow.selectCharacter(140000003);
  return { store, flow, paths };
}

test("a manual dock at a new station re-points the online location + station identity", async () => {
  const { store, flow } = await onlineFlow();
  assert.equal(store.station.get().online?.stationID, STATION_A);
  assert.equal(store.station.get().station?.stationName, stationStaticFor(STATION_A).stationName);

  // Undock so the dock step is legal, then dock at station B.
  current.inSpace = true;
  await flow.dock(STATION_B);

  const slice = store.station.get();
  assert.equal(slice.online?.stationID, STATION_B, "online location re-pointed to the new station");
  assert.equal(slice.online?.solarSystemID, SYSTEM_B, "the finder origin (system) tracks the new station");
  assert.equal(slice.station?.stationName, stationStaticFor(STATION_B).stationName, "static station identity refreshed");
  // The prior station's reads were refreshed for the new station, not left stale.
  assert.equal(slice.bits?.stationID, STATION_B, "the services row reloaded for the new station");
});

test("a station change re-fetches an already-loaded Agents list and Inventory panel", async () => {
  const { store, flow } = await onlineFlow();

  // The player opened both tabs at station A (their onMount loaded them).
  await flow.loadAgents();
  await flow.loadInventory();
  assert.equal(store.agents.get().agents[0]?.agentID, STATION_A + 1, "station A agent loaded first");
  assert.equal(store.inventory.get().stationID, STATION_A);

  // Autopilot/manual arrival docks at station B.
  current.inSpace = true;
  await flow.dock(STATION_B);

  // Both station-scoped panels re-fetched for the new station without a reload.
  assert.equal(store.agents.get().agents[0]?.agentID, STATION_B + 1, "agents re-fetched for the new station");
  assert.equal(store.agents.get().stationID, STATION_B);
  assert.equal(store.inventory.get().stationID, STATION_B, "inventory re-fetched for the new station");
});

test("agents/inventory tabs never opened are NOT force-fetched on a station change", async () => {
  const { store, flow } = await onlineFlow();
  assert.equal(store.agents.get().loaded, false);
  assert.equal(store.inventory.get().loaded, false);

  current.inSpace = true;
  await flow.dock(STATION_B);

  // The station panel re-pointed, but unopened tabs stay unloaded (they load on
  // open via their own onMount) — no wasted reads / hidden-slice errors.
  assert.equal(store.station.get().online?.stationID, STATION_B);
  assert.equal(store.agents.get().loaded, false, "an unopened Agents tab is not force-loaded");
  assert.equal(store.inventory.get().loaded, false, "an unopened Inventory tab is not force-loaded");
});

test("opening the Agents tab after a dock re-fetches the current station's agents", async () => {
  const { store, flow } = await onlineFlow();
  current.inSpace = true;
  await flow.dock(STATION_B);

  // The Agents tab's onMount calls loadAgents — it must show station B's agents.
  await flow.loadAgents();
  assert.equal(store.agents.get().stationID, STATION_B);
  assert.equal(store.agents.get().agents[0]?.agentID, STATION_B + 1);
});

test("re-docking at the SAME station does not redundantly relocate (guarded)", async () => {
  const { store, flow, paths } = await onlineFlow();
  await flow.loadAgents();
  const agentsReadsBefore = paths.filter((p) => p === "/api/bridge/agents").length;

  // A plain flight-status read while still docked at the select station A must
  // NOT trigger a relocate (no new station-scoped reads).
  await flow.loadFlightStatus();

  const agentsReadsAfter = paths.filter((p) => p === "/api/bridge/agents").length;
  assert.equal(agentsReadsAfter, agentsReadsBefore, "no redundant agents re-fetch at the same station");
  assert.equal(store.station.get().online?.stationID, STATION_A);
});
