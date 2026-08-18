// The flow.ts DISPATCH layer for lootWreck / lootContainer, against a faked
// BFF — the layer scriptMacros.test.ts cannot see, because it only pins the
// DECIDER (which action gets chosen), not what that action does once
// `makeScriptRunnerDeps().issue` picks it up and calls the real API.
//
// Drives a real `startCustomBot` script (the general MacroID/BotScript
// runner, NOT the fixed mining ladder `startMiningBot` drives — that one
// never issues lootWreck/lootContainer at all) over a fake fetch, and asserts
// on the actual `openContainer`/`transferItems` request bodies that come out
// the other side.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import type { BotScript } from "../bots/botScript.ts";
import { fittingBody, flightBody, holdsBody, namesBody } from "./botFixtures.ts";

const CHARACTER_ID = 140000005;
const STATION_ID = 60000358;
const SOLAR_SYSTEM_ID = 30000144;
const SHIP_ID = 9988400023309;

function packedRow(fields: Record<string, unknown>): unknown {
  return { type: "packedrow", fields };
}

function keyVal(entries: [string, unknown][]): unknown {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

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

/** A space snapshot with the ship at the origin and ONE lootable entity in range. */
function spaceBodyWith(entity: Record<string, unknown>): unknown {
  return {
    ok: true,
    space: {
      inSpace: true,
      solarSystemID: SOLAR_SYSTEM_ID,
      shipID: SHIP_ID,
      sampledAtMs: 0,
      ship: {
        itemID: SHIP_ID,
        typeID: 17480,
        name: "Ship",
        mode: "STOP",
        radius: 60,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        shieldRatio: 1,
        armorRatio: 1,
        hullRatio: 1,
        capacitorRatio: 1,
        activeModuleIDs: [],
      },
      entities: [entity],
    },
    notifications: [],
  };
}

function containerReads(containerID: number, items: unknown[]): unknown {
  return {
    ok: true,
    containerID,
    list: { type: "list", items },
    capacity: keyVal([["capacity", 120], ["used", 4]]),
  };
}

function script(step: BotScript["program"][number]): BotScript {
  return {
    format: "evejs-bot-script",
    version: 1,
    name: "t",
    notes: "",
    home: { entity: "station", id: STATION_ID, name: "Home", systemName: null },
    interrupts: [],
    program: [step],
  };
}

test("a custom bot's loot-containers step dispatches openContainer + transferItems for ANY container, no ownership needed", async () => {
  const CONTAINER_ID = 80001;
  const store = createClientStore();
  store.apply({
    type: "character/online",
    character: {
      characterID: CHARACTER_ID,
      characterName: "Test",
      stationID: null,
      structureID: null,
      solarSystemID: SOLAR_SYSTEM_ID,
      corporationID: 98000000,
    },
    station: null,
  });

  const { fetch, requests } = makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/flight/status") return { status: 200, body: flightBody(false) };
    if (path === "/api/bridge/space/snapshot") {
      return {
        status: 200,
        body: spaceBodyWith({
          itemID: CONTAINER_ID,
          kind: "container",
          name: "Jetcan",
          // Not owned by us, not owned by anyone knowable — loot-containers
          // does not care, unlike loot-wrecks.
          ownerID: 555,
          radius: 5,
          position: { x: 1000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        }),
      };
    }
    if (path === "/api/bridge/fitting") return { status: 200, body: fittingBody() };
    if (path === "/api/names") return { status: 200, body: namesBody(body) };
    if (path === "/api/bridge/targets") return { status: 200, body: { ok: true, targetIDs: [], notifications: [] } };
    if (path === "/api/bridge/ship/ore-hold") return { status: 200, body: holdsBody(0, []) };
    if (path.startsWith("/api/bridge/inventory/container/")) {
      return {
        status: 200,
        body: containerReads(CONTAINER_ID, [
          packedRow({ itemID: 90001, typeID: 34, groupID: 18, categoryID: 4, flagID: null, quantity: 100, singleton: 0 }),
        ]),
      };
    }
    if (path === "/api/bridge/inventory/transfer") {
      return { status: 200, body: { ok: true, applied: true, moved: [90001], declined: [], declinedSilently: false, notFound: [] } };
    }
    return { status: 200, body: { ok: true } };
  });

  const flow = createAppFlow(store, { fetch });
  await flow.startCustomBot(script({ id: "loot", kind: "macro", macro: "loot-containers", args: {} }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  flow.stopCustomBot();

  const opened = requests.find((r) => r.path === `/api/bridge/inventory/container/${CONTAINER_ID}`);
  assert.ok(opened, "it read the container's contents");
  assert.equal(opened.method, "GET");

  const transfer = requests.find((r) => r.path === "/api/bridge/inventory/transfer");
  assert.ok(transfer, "it moved the loot into cargo");
  assert.deepEqual(transfer.body, {
    itemIDs: [90001],
    from: { kind: "container", itemID: CONTAINER_ID },
    to: { kind: "cargo" },
  });
});

test("a custom bot's loot-containers step splits ore-category loot into the ore hold, everything else into cargo", async () => {
  const CONTAINER_ID = 80002;
  const store = createClientStore();
  store.apply({
    type: "character/online",
    character: {
      characterID: CHARACTER_ID,
      characterName: "Test",
      stationID: null,
      structureID: null,
      solarSystemID: SOLAR_SYSTEM_ID,
      corporationID: 98000000,
    },
    station: null,
  });

  const { fetch, requests } = makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/flight/status") return { status: 200, body: flightBody(false) };
    if (path === "/api/bridge/space/snapshot") {
      return {
        status: 200,
        body: spaceBodyWith({
          itemID: CONTAINER_ID,
          kind: "container",
          name: "Jetcan",
          ownerID: 555,
          radius: 5,
          position: { x: 1000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        }),
      };
    }
    if (path === "/api/bridge/fitting") return { status: 200, body: fittingBody() };
    if (path === "/api/names") return { status: 200, body: namesBody(body) };
    if (path === "/api/bridge/targets") return { status: 200, body: { ok: true, targetIDs: [], notifications: [] } };
    if (path === "/api/bridge/ship/ore-hold") return { status: 200, body: holdsBody(0, []) };
    if (path.startsWith("/api/bridge/inventory/container/")) {
      return {
        status: 200,
        body: containerReads(CONTAINER_ID, [
          // Veldspar — category 25 (Asteroid) — belongs in the ore hold.
          packedRow({ itemID: 90010, typeID: 1230, groupID: 18, categoryID: 25, flagID: null, quantity: 500, singleton: 0 }),
          // A non-ore stack in the same can — still goes to cargo, same as before.
          packedRow({ itemID: 90011, typeID: 34, groupID: 18, categoryID: 4, flagID: null, quantity: 100, singleton: 0 }),
        ]),
      };
    }
    if (path === "/api/bridge/inventory/transfer") {
      return { status: 200, body: { ok: true, applied: true, moved: [], declined: [], declinedSilently: false, notFound: [] } };
    }
    return { status: 200, body: { ok: true } };
  });

  const flow = createAppFlow(store, { fetch });
  await flow.startCustomBot(script({ id: "loot", kind: "macro", macro: "loot-containers", args: {} }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  flow.stopCustomBot();

  const transfers = requests.filter((r) => r.path === "/api/bridge/inventory/transfer");
  assert.ok(
    transfers.some((r) => JSON.stringify(r.body) === JSON.stringify({
      itemIDs: [90010],
      from: { kind: "container", itemID: CONTAINER_ID },
      to: { kind: "shipBay", bay: "ore" },
    })),
    "the ore stack went to the ore hold, not cargo",
  );
  assert.ok(
    transfers.some((r) => JSON.stringify(r.body) === JSON.stringify({
      itemIDs: [90011],
      from: { kind: "container", itemID: CONTAINER_ID },
      to: { kind: "cargo" },
    })),
    "the non-ore stack still went to cargo",
  );
});

test("a custom bot's loot-wrecks step dispatches openContainer + transferItems for an owned wreck (closes the pre-existing dispatch-test gap)", async () => {
  const WRECK_ID = 70001;
  const store = createClientStore();
  store.apply({
    type: "character/online",
    character: {
      characterID: CHARACTER_ID,
      characterName: "Test",
      stationID: null,
      structureID: null,
      solarSystemID: SOLAR_SYSTEM_ID,
      corporationID: 98000000,
    },
    station: null,
  });

  const { fetch, requests } = makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/flight/status") return { status: 200, body: flightBody(false) };
    if (path === "/api/bridge/space/snapshot") {
      return {
        status: 200,
        body: spaceBodyWith({
          itemID: WRECK_ID,
          kind: "wreck",
          name: "Wreck",
          ownerID: CHARACTER_ID, // must be OURS — loot-wrecks refuses anything else
          radius: 5,
          position: { x: 1000, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        }),
      };
    }
    if (path === "/api/bridge/fitting") return { status: 200, body: fittingBody() };
    if (path === "/api/names") return { status: 200, body: namesBody(body) };
    if (path === "/api/bridge/targets") return { status: 200, body: { ok: true, targetIDs: [], notifications: [] } };
    if (path === "/api/bridge/ship/ore-hold") return { status: 200, body: holdsBody(0, []) };
    if (path.startsWith("/api/bridge/inventory/container/")) {
      return {
        status: 200,
        body: containerReads(WRECK_ID, [
          packedRow({ itemID: 90002, typeID: 34, groupID: 18, categoryID: 4, flagID: null, quantity: 50, singleton: 0 }),
        ]),
      };
    }
    if (path === "/api/bridge/inventory/transfer") {
      return { status: 200, body: { ok: true, applied: true, moved: [90002], declined: [], declinedSilently: false, notFound: [] } };
    }
    return { status: 200, body: { ok: true } };
  });

  const flow = createAppFlow(store, { fetch });
  await flow.startCustomBot(script({ id: "loot", kind: "macro", macro: "loot-wrecks", args: {} }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  flow.stopCustomBot();

  const opened = requests.find((r) => r.path === `/api/bridge/inventory/container/${WRECK_ID}`);
  assert.ok(opened, "it read the wreck's contents");
  assert.equal(opened.method, "GET");

  const transfer = requests.find((r) => r.path === "/api/bridge/inventory/transfer");
  assert.ok(transfer, "it moved the loot into cargo");
  assert.deepEqual(transfer.body, {
    itemIDs: [90002],
    from: { kind: "container", itemID: WRECK_ID },
    to: { kind: "cargo" },
  });
});
