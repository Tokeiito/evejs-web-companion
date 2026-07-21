// The R14 inventory-depth and corporation-hangar controller against a faked
// BFF: multi-select, split, container navigation, merge, trash, and the
// division picker.
//
// The theme running through these tests is the R12 lesson, applied one layer
// up: the BFF re-reads after every mutation because invbroker declines
// SILENTLY, and the flow reports that re-read rather than an optimistic
// success. A route that answers `applied: false` must surface as a refusal the
// player can see — and when the server gave no reason, the message must say so
// instead of inventing one.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

function packedRow(fields: Record<string, unknown>): unknown {
  return { type: "packedrow", fields };
}

function keyVal(entries: [string, unknown][]): unknown {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

const CONTAINER_ID = 8100;

function inventoryPanel() {
  return {
    ok: true,
    stationID: 60003760,
    activeShipID: 9001,
    hangar: {
      list: {
        type: "list",
        items: [
          packedRow({ itemID: 100, typeID: 34, groupID: 18, categoryID: 4, flagID: 4, quantity: 750, singleton: 0 }),
          packedRow({ itemID: 101, typeID: 35, groupID: 18, categoryID: 4, flagID: 4, quantity: 500, singleton: 0 }),
          // An ASSEMBLED cargo container (group 12) — the client-side test for
          // "this can be opened".
          packedRow({ itemID: CONTAINER_ID, typeID: 3297, groupID: 12, categoryID: 2, flagID: 4, quantity: 1, singleton: 1 }),
        ],
      },
      capacity: keyVal([["capacity", 1000000], ["used", 7.5]]),
      error: null,
    },
    cargo: {
      shipID: 9001,
      list: { type: "list", items: [] },
      capacity: keyVal([["capacity", 135], ["used", 0]]),
      error: null,
    },
  };
}

function corpHangar(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    available: true,
    reason: null,
    divisions: [
      {
        division: 1,
        name: "Ore Bay",
        list: {
          type: "list",
          items: [
            packedRow({ itemID: 400, typeID: 34, groupID: 18, categoryID: 4, flagID: 115, quantity: 900, singleton: 0 }),
          ],
        },
        error: null,
      },
      // A division the character cannot query reads EMPTY — not an error.
      { division: 2, name: "Ammo Locker", list: { type: "list", items: [] }, error: null },
      // A division the corporation never renamed has no name at all.
      { division: 3, name: null, list: { type: "list", items: [] }, error: null },
    ],
    ...overrides,
  };
}

function containerReads(items: unknown[] = []) {
  return {
    ok: true,
    containerID: CONTAINER_ID,
    list: { type: "list", items },
    capacity: keyVal([["capacity", 120], ["used", 4]]),
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

// The standard responder: panel + corp reads succeed, and mutations are
// answered by `mutation` (default: everything applied).
function standardFetch(
  mutation: (path: string, body: Record<string, unknown>) => { status: number; body: unknown } = () => ({
    status: 200,
    body: { ok: true, applied: true, moved: [], declined: [], declinedSilently: false, notFound: [] },
  }),
  containerItems: unknown[] = [],
) {
  return makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/inventory") {
      return { status: 200, body: inventoryPanel() };
    }
    if (path === "/api/bridge/inventory/corp") {
      return { status: 200, body: corpHangar() };
    }
    if (path.startsWith("/api/bridge/inventory/container/")) {
      return { status: 200, body: containerReads(containerItems) };
    }
    return mutation(path, body);
  });
}

// --- multi-select -----------------------------------------------------------

test("toggleSelection ticks and unticks rows; clearSelection drops them all", () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: standardFetch().fetch });

  flow.toggleSelection(100);
  flow.toggleSelection(101);
  assert.deepEqual(store.inventory.get().selection, [100, 101]);

  flow.toggleSelection(100);
  assert.deepEqual(store.inventory.get().selection, [101]);

  flow.clearSelection();
  assert.deepEqual(store.inventory.get().selection, []);
});

test("a reload drops ticks whose item is no longer anywhere on the panel", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: standardFetch().fetch });

  flow.toggleSelection(100);
  flow.toggleSelection(999); // never existed
  await flow.loadInventory();

  assert.deepEqual(
    store.inventory.get().selection,
    [100],
    "a tick on an item the panel no longer shows is dropped",
  );
});

test("transferItems posts every ticked item in ONE request", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch(() => ({
    status: 200,
    body: { ok: true, applied: true, moved: [100, 101], declined: [], declinedSilently: false, notFound: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.transferItems([100, 101], { kind: "hangar" }, { kind: "cargo" });

  const transfers = requests.filter((r) => r.path === "/api/bridge/inventory/transfer");
  assert.equal(transfers.length, 1, "one request carries the whole selection");
  assert.deepEqual(transfers[0]!.body, {
    itemIDs: [100, 101],
    from: { kind: "hangar" },
    to: { kind: "cargo" },
  });
  assert.equal(store.inventory.get().lastOutcome?.applied, true);
  // A successful action clears the ticks, so the next click cannot re-apply it.
  assert.deepEqual(store.inventory.get().selection, []);
});

// --- split ------------------------------------------------------------------

test("a split sends the quantity and is reported as a split, not a move", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch(() => ({
    // A split mints a NEW stack at the destination, so the requested itemID
    // never appears in `moved` — the BFF judges it by the source shrinking.
    status: 200,
    body: { ok: true, applied: true, moved: [], declined: [], declinedSilently: false, notFound: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.transferItems([100], { kind: "hangar" }, { kind: "cargo" }, 300);

  const transfer = requests.find((r) => r.path === "/api/bridge/inventory/transfer");
  assert.equal(transfer!.body.qty, 300);
  assert.equal(store.inventory.get().lastOutcome?.applied, true);
  assert.match(String(store.inventory.get().lastOutcome?.message), /Split 300/);
});

// --- the silent-decline discipline -----------------------------------------

test("a silently declined move is reported AS a decline with no reason given", async () => {
  const store = createClientStore();
  const { fetch } = standardFetch(() => ({
    status: 200,
    body: {
      ok: true,
      applied: false,
      moved: [],
      declined: [100],
      declinedSilently: true,
      notFound: [],
    },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.transferItems([100], { kind: "hangar" }, { kind: "cargo" });

  const outcome = store.inventory.get().lastOutcome;
  assert.equal(outcome?.applied, false, "a 200 is not treated as proof");
  assert.equal(outcome?.declinedSilently, true);
  // The message states the absence of a reason rather than inventing one.
  assert.match(String(outcome?.message), /did not move anything, and gave no reason/);
  // And it is NOT dressed up as an error the player caused.
  assert.equal(store.inventory.get().actionError, null);
});

test("a partial move reports how many of the selection actually landed", async () => {
  const store = createClientStore();
  const { fetch } = standardFetch(() => ({
    status: 200,
    body: {
      ok: true,
      applied: true,
      moved: [100],
      declined: [101],
      declinedSilently: false,
      notFound: [],
    },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.transferItems([100, 101], { kind: "hangar" }, { kind: "cargo" });

  assert.match(String(store.inventory.get().lastOutcome?.message), /Moved 1 of 2/);
  assert.match(String(store.inventory.get().lastOutcome?.message), /without giving a reason/);
});

test("a typed refusal surfaces the SERVER's own message, not a guess", async () => {
  const store = createClientStore();
  const { fetch } = standardFetch(() => ({
    status: 409,
    body: { ok: false, error: "CALL_REFUSED", message: "You do not have the required roles." },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.transferItems([400], { kind: "corp", division: 1 }, { kind: "hangar" });

  assert.match(
    String(store.inventory.get().actionError),
    /You do not have the required roles/,
    "the handler's own reason reaches the player verbatim",
  );
});

// --- containers -------------------------------------------------------------

test("openContainer reads the contents into the store and closing clears them", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch(undefined, [
    packedRow({ itemID: 200, typeID: 34, groupID: 18, categoryID: 4, flagID: 0, quantity: 40, singleton: 0 }),
  ]);
  const flow = createAppFlow(store, { fetch });

  await flow.loadInventory();
  await flow.openContainer(CONTAINER_ID);

  assert.ok(
    requests.some((r) => r.path === `/api/bridge/inventory/container/${CONTAINER_ID}`),
    "the container was read by its own itemID",
  );
  const container = store.inventory.get().container;
  assert.equal(container?.itemID, CONTAINER_ID);
  assert.equal(container?.rows.length, 1);
  assert.equal(container?.rows[0]!.itemID, 200);
  // The container's own typeID comes from the hangar row, so the panel can name
  // it rather than showing an id.
  assert.equal(container?.typeID, 3297);
  assert.deepEqual(container?.capacity, { capacity: 120, used: 4 });

  await flow.openContainer(null);
  assert.equal(store.inventory.get().container, null);
});

test("opening or closing a container clears the selection", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: standardFetch().fetch });

  await flow.loadInventory();
  flow.toggleSelection(100);
  await flow.openContainer(CONTAINER_ID);

  assert.deepEqual(
    store.inventory.get().selection,
    [],
    "a tick made in the hangar must not follow you into a container",
  );
});

test("a container that fails to open shows its reason and stays open in the panel", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory") {
      return { status: 200, body: inventoryPanel() };
    }
    if (path.startsWith("/api/bridge/inventory/container/")) {
      return { status: 502, body: { ok: false, error: "CALL_FAILED", message: "bind failed" } };
    }
    return { status: 200, body: corpHangar() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadInventory();
  await flow.openContainer(CONTAINER_ID);

  const container = store.inventory.get().container;
  assert.equal(container?.itemID, CONTAINER_ID);
  // R31 — "bind failed" is the BFF's own diagnostic, not something a player
  // can act on, so the panel now says what happened in words. The container
  // still stays open carrying its reason, which is what this test guards.
  assert.equal(container?.error, "The game server hit an error carrying that out.");
  assert.deepEqual(container?.rows, []);
});

test("a move out of a container names the container as the source place", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch();
  const flow = createAppFlow(store, { fetch });

  await flow.transferItems([200], { kind: "container", itemID: CONTAINER_ID }, { kind: "hangar" });

  const transfer = requests.find((r) => r.path === "/api/bridge/inventory/transfer");
  assert.deepEqual(transfer!.body.from, { kind: "container", itemID: CONTAINER_ID });
});

// --- merge ------------------------------------------------------------------

test("mergeStacks posts the two stacks and reports the quantity that moved", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch((path) => {
    if (path === "/api/bridge/inventory/merge") {
      return { status: 200, body: { ok: true, applied: true, merged: 250, declinedSilently: false } };
    }
    return { status: 200, body: { ok: true } };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.mergeStacks(101, 100, { kind: "hangar" });

  const merge = requests.find((r) => r.path === "/api/bridge/inventory/merge");
  assert.deepEqual(merge!.body, {
    sourceItemID: 101,
    destinationItemID: 100,
    place: { kind: "hangar" },
  });
  assert.match(String(store.inventory.get().lastOutcome?.message), /Merged 250/);
});

test("a merge the server declines says so without inventing a cause", async () => {
  const store = createClientStore();
  const { fetch } = standardFetch((path) => {
    if (path === "/api/bridge/inventory/merge") {
      return { status: 200, body: { ok: true, applied: false, merged: 0, declinedSilently: true } };
    }
    return { status: 200, body: { ok: true } };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.mergeStacks(101, 100, { kind: "hangar" });

  const outcome = store.inventory.get().lastOutcome;
  assert.equal(outcome?.applied, false);
  assert.match(String(outcome?.message), /did not merge those stacks, and gave no reason/);
});

// --- trash ------------------------------------------------------------------

test("trashItems always sends confirm and reports what was destroyed", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch((path) => {
    if (path === "/api/bridge/inventory/trash") {
      return {
        status: 200,
        body: { ok: true, applied: true, destroyed: [100, 101], survived: [], declinedSilently: false },
      };
    }
    return { status: 200, body: { ok: true } };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.trashItems([100, 101], { kind: "hangar" });

  const trash = requests.find((r) => r.path === "/api/bridge/inventory/trash");
  assert.equal(trash!.body.confirm, true, "the BFF's confirm gate is always satisfied explicitly");
  assert.deepEqual(trash!.body.itemIDs, [100, 101]);
  assert.match(String(store.inventory.get().lastOutcome?.message), /Destroyed 2 items/);
});

test("trash reports items the server refused to destroy alongside those it did", async () => {
  const store = createClientStore();
  const { fetch } = standardFetch((path) => {
    if (path === "/api/bridge/inventory/trash") {
      return {
        status: 200,
        body: { ok: true, applied: true, destroyed: [100], survived: [9001], declinedSilently: true },
      };
    }
    return { status: 200, body: { ok: true } };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.trashItems([100, 9001], { kind: "hangar" });

  const message = String(store.inventory.get().lastOutcome?.message);
  assert.match(message, /Destroyed 1/);
  assert.match(message, /refused to destroy 1, and gave no reason/);
});

// --- corporation hangars ----------------------------------------------------

test("loadCorpHangar decodes every division with its NAME and rows", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: standardFetch().fetch });

  await flow.loadCorpHangar();

  const corp = store.inventory.get().corp;
  assert.equal(corp.loaded, true);
  assert.equal(corp.available, true);
  assert.equal(corp.divisions.length, 3);
  assert.equal(corp.divisions[0]!.name, "Ore Bay");
  assert.equal(corp.divisions[0]!.rows.length, 1);
  assert.equal(corp.divisions[0]!.rows[0]!.itemID, 400);
  // A division the character cannot query answers EMPTY — not an error.
  assert.equal(corp.divisions[1]!.rows.length, 0);
  assert.equal(corp.divisions[1]!.error, null);
  // A division the corporation never renamed carries no name; the UI supplies
  // "Division N" rather than a flag number.
  assert.equal(corp.divisions[2]!.name, null);
});

test("no corp office is an ordinary unavailable state, not an error", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory/corp") {
      return {
        status: 200,
        body: { ok: true, available: false, reason: "NO_CORP_OFFICE", divisions: [] },
      };
    }
    return { status: 200, body: inventoryPanel() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadCorpHangar();

  const corp = store.inventory.get().corp;
  assert.equal(corp.loaded, true, "the read completed");
  assert.equal(corp.available, false);
  assert.equal(corp.reason, "NO_CORP_OFFICE");
  assert.equal(store.inventory.get().actionError, null, "and it is not an action failure");
});

test("selectCorpDivision switches the shown division and clears the selection", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, { fetch: standardFetch().fetch });

  await flow.loadCorpHangar();
  flow.toggleSelection(400);
  flow.selectCorpDivision(2);

  assert.equal(store.inventory.get().corp.selectedDivision, 2);
  assert.deepEqual(
    store.inventory.get().selection,
    [],
    "a tick in one division must not carry into another",
  );
});

test("a corp move names the division by ORDINAL — never by a flag number", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch();
  const flow = createAppFlow(store, { fetch });

  await flow.transferItems([100], { kind: "hangar" }, { kind: "corp", division: 2 });

  const transfer = requests.find((r) => r.path === "/api/bridge/inventory/transfer");
  assert.deepEqual(transfer!.body.to, { kind: "corp", division: 2 });
  // 116 is flagCorpSAG2 — the mapping lives on the BFF and must never appear
  // in a request the browser builds.
  assert.equal(JSON.stringify(transfer!.body).includes("116"), false);
});

test("after a mutation every open place is re-read, not just the hangar", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch();
  const flow = createAppFlow(store, { fetch });

  await flow.loadInventory();
  await flow.openContainer(CONTAINER_ID);
  await flow.loadCorpHangar();
  const before = requests.length;

  await flow.transferItems([100], { kind: "hangar" }, { kind: "cargo" });

  const after = requests.slice(before);
  // A move out of the hangar into cargo can change what a container or a
  // division shows too, so every open view is refreshed rather than guessed at.
  assert.ok(after.some((r) => r.path === "/api/bridge/inventory"));
  assert.ok(after.some((r) => r.path === `/api/bridge/inventory/container/${CONTAINER_ID}`));
  assert.ok(after.some((r) => r.path === "/api/bridge/inventory/corp"));
});
