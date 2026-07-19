// The R3 Inventory & Ship controller against a faked BFF: loadInventory decodes
// the raw hangar/cargo reads into the store; move/stack/board run their BFF
// mutation then reload; failures surface through the store; a lost session
// unwinds to offline.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

function packedRow(fields: Record<string, unknown>): unknown {
  return { type: "packedrow", fields };
}

function inventoryPanel(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    stationID: 60003760,
    activeShipID: 9001,
    hangar: {
      list: {
        type: "list",
        items: [
          packedRow({ itemID: 100, typeID: 34, categoryID: 4, flagID: 4, quantity: 750, singleton: 0 }),
          packedRow({ itemID: 200, typeID: 597, categoryID: 6, flagID: 4, quantity: 1, singleton: 1 }),
        ],
      },
      capacity: { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", 1000000], ["used", 7.5]] } },
      error: null,
    },
    cargo: {
      shipID: 9001,
      list: { type: "object", name: "__builtin__.set", args: [{ type: "list", items: [] }] },
      capacity: { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", 135], ["used", 0]] } },
      error: null,
    },
    ...overrides,
  };
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

test("loadInventory decodes the hangar and cargo reads into the store", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory") {
      return { status: 200, body: inventoryPanel() };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadInventory();

  const inv = store.inventory.get();
  assert.equal(inv.loaded, true);
  assert.equal(inv.stationID, 60003760);
  assert.equal(inv.activeShipID, 9001);
  assert.equal(inv.hangar.rows.length, 2);
  assert.deepEqual(inv.hangar.capacity, { capacity: 1000000, used: 7.5 });
  assert.equal(inv.cargo.rows.length, 0);
  assert.deepEqual(inv.cargo.capacity, { capacity: 135, used: 0 });
});

test("a failed container read is surfaced without blanking the other container", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: inventoryPanel({
      cargo: { shipID: 9001, list: null, capacity: null, error: "NO_ACTIVE_SHIP" },
    }),
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadInventory();

  const inv = store.inventory.get();
  assert.equal(inv.hangar.rows.length, 2, "hangar still shows");
  assert.equal(inv.cargo.error, "NO_ACTIVE_SHIP");
});

test("moveItem posts the move then reloads the panel", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory/move") {
      return { status: 200, body: { ok: true } };
    }
    return { status: 200, body: inventoryPanel() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.moveItem(100, "toCargo", 250);

  const move = requests.find((r) => r.path === "/api/bridge/inventory/move");
  assert.ok(move, "move was posted");
  assert.deepEqual(move!.body, { itemID: 100, direction: "toCargo", qty: 250 });
  // A reload followed the mutation.
  assert.ok(requests.some((r) => r.path === "/api/bridge/inventory" && r.method === "GET"));
  assert.equal(store.inventory.get().loaded, true);
  assert.equal(store.inventory.get().actionError, null);
});

test("stackContainer and boardShip post their BFF mutations then reload", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory/stack") {
      return { status: 200, body: { ok: true } };
    }
    if (path === "/api/bridge/ship/board") {
      return { status: 200, body: { ok: true, activeShipID: 200 } };
    }
    return { status: 200, body: inventoryPanel() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.stackContainer("hangar");
  await flow.boardShip(200);

  const stack = requests.find((r) => r.path === "/api/bridge/inventory/stack");
  assert.deepEqual(stack!.body, { target: "hangar" });
  const board = requests.find((r) => r.path === "/api/bridge/ship/board");
  assert.deepEqual(board!.body, { shipID: 200 });
  assert.equal(requests.filter((r) => r.path === "/api/bridge/inventory").length, 2);
});

test("a refused mutation is surfaced through the store, not thrown", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory/move") {
      return { status: 403, body: { ok: false, error: "CALL_NOT_ALLOWED", message: "nope" } };
    }
    return { status: 200, body: inventoryPanel() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.moveItem(100, "toCargo");

  assert.match(store.inventory.get().actionError ?? "", /CALL_NOT_ALLOWED/);
  // No reload after a failed mutation (only the failed move was requested).
  assert.equal(requests.filter((r) => r.path === "/api/bridge/inventory").length, 0);
});

test("a lost session during a mutation flips the character offline and rethrows", async () => {
  const store = createClientStore();
  store.apply({
    type: "character/online",
    character: {
      characterID: 140000003,
      characterName: "Test Three",
      stationID: 60003760,
      structureID: null,
      solarSystemID: 30000142,
      corporationID: 98000000,
    },
    station: null,
  });
  const { fetch } = makeFakeFetch(() => ({
    status: 404,
    body: { ok: false, error: "SESSION_NOT_FOUND", message: "gone" },
  }));
  const flow = createAppFlow(store, { fetch });

  await assert.rejects(() => flow.boardShip(200));
  assert.equal(store.station.get().online, null, "character flipped offline");
});
