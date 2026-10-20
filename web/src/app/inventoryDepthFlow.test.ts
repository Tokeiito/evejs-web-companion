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

// The pilot's own moves between the hangar, the ship's hold and a container are the client's calls since 2026-10-14
// (bridge/inventoryWrites.ts, moveItems), held to its lines: invControllers.AddItems (489 to 562) for many things,
// one MultiAdd(itemIDs, where they lie, flag=the window's), and _AddItem (229 to 262) for one, Add(itemID, where it
// lies, qty=its stack or the number asked, flag=the window's). The verdict is the page's own, by the source's rows
// refreshed.

/** The hangar's read until a move is made, and then as `afterMove` leaves its rows. */
function hangarMoving(afterMove: (rows: { fields: { itemID: number; quantity: number } }[]) => unknown[]) {
  let moved = false;
  return makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/call") {
      moved = true;
      return { status: 200, body: { ok: true, service: body.service, method: body.method, result: null, notifications: [] } };
    }
    if (path === "/api/bridge/inventory") {
      const panel = inventoryPanel();
      if (!moved) return { status: 200, body: panel };
      const items = afterMove(panel.hangar.list.items as { fields: { itemID: number; quantity: number } }[]);
      return { status: 200, body: { ...panel, hangar: { ...panel.hangar, list: { type: "list", items } } } };
    }
    return { status: 200, body: { ok: true } };
  });
}

const without = (...gone: number[]) => (rows: { fields: { itemID: number } }[]) => rows.filter((row) => !gone.includes(row.fields.itemID));

test("many things moved from the hangar to the hold are the client's one MultiAdd on the ship's own inventory, from the station", async () => {
  const store = createClientStore();
  dockedAtJita(store);
  const { fetch, requests } = hangarMoving(without(100, 101));
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();

  await flow.transferItems([100, 101], { kind: "hangar" }, { kind: "cargo" });

  // AddItems (557 to 558): invCacheCont.MultiAdd(itemIDs, sourceLocation, flag=self.locationFlag), the hold's
  // flagCargo, sorted smallest first (neither row says its volume here, so they stay as they are).
  assert.deepEqual(requests.filter((r) => r.path === "/api/bridge/call").map((r) => r.body), [
    { service: "invbroker", method: "MultiAdd", args: [[100, 101], 60003760], kwargs: { flag: 5 }, pilot: true, confirm: true, of: 9001 },
  ]);
  assert.equal(requests.some((r) => r.path === "/api/bridge/inventory/transfer"), false);
  assert.equal(store.inventory.get().lastOutcome?.applied, true);
  // A successful action clears the ticks, so the next click cannot re-apply it.
  assert.deepEqual(store.inventory.get().selection, []);
});

// --- split ------------------------------------------------------------------

test("a split is the client's Add with the number asked, and is reported as a split, not a move", async () => {
  const store = createClientStore();
  dockedAtJita(store);
  // The source keeps its number and shrinks: that is what says a split landed.
  const { fetch, requests } = hangarMoving((rows) => rows.map((row) => (row.fields.itemID === 100 ? packedRow({ ...row.fields, quantity: 450 }) : row)));
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();

  await flow.transferItems([100], { kind: "hangar" }, { kind: "cargo" }, 300);

  // __AddItem (213): Add(itemID, sourceLocationID, qty=quantity, flag=self.locationFlag).
  assert.deepEqual(requests.filter((r) => r.path === "/api/bridge/call").map((r) => r.body), [
    { service: "invbroker", method: "Add", args: [100, 60003760], kwargs: { qty: 300, flag: 5 }, pilot: true, confirm: true, of: 9001 },
  ]);
  assert.equal(store.inventory.get().lastOutcome?.applied, true);
  assert.match(String(store.inventory.get().lastOutcome?.message), /Split 300/);
});

// --- the silent-decline discipline -----------------------------------------

test("a silently declined move is reported AS a decline with no reason given", async () => {
  const store = createClientStore();
  dockedAtJita(store);
  const { fetch } = hangarMoving((rows) => rows);
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();

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
  dockedAtJita(store);
  const { fetch } = hangarMoving(without(100));
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();

  await flow.transferItems([100, 101], { kind: "hangar" }, { kind: "cargo" });

  assert.match(String(store.inventory.get().lastOutcome?.message), /Moved 1 of 2/);
  assert.match(String(store.inventory.get().lastOutcome?.message), /without giving a reason/);
});

test("a typed refusal surfaces the SERVER's own message, not a guess", async () => {
  // A move out of the corporation's hangar is the page's own call since 2026-10-14: the office's number read of the
  // office manager as the client's GetCorpOfficeAtLocation reads it (GetMyCorporationsOffices, the office at the
  // station docked in), and the move refused.
  const store = createClientStore();
  dockedAtJita(store);
  const { fetch } = standardFetch((path, body) => {
    if (path === "/api/bridge/call" && body.method === "GetMyCorporationsOffices") {
      return { status: 200, body: { ok: true, service: body.service, method: body.method, result: { type: "objectex2", list: [packedRow({ officeID: 272, stationID: 60003760 })] }, notifications: [] } };
    }
    return { status: 409, body: { ok: false, error: "CALL_REFUSED", message: "You do not have the required roles." } };
  });
  const flow = createAppFlow(store, { fetch });
  await flow.loadCorpHangar();

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

  // The retail client knows the type of what it opens, and works the container's capacity out from that. The
  // page says the type its row has, so that the bridge can do the same and not ask the server.
  assert.deepEqual(
    requests.filter((r) => r.path.startsWith("/api/bridge/inventory/container/")).map((r) => r.path),
    [`/api/bridge/inventory/container/${CONTAINER_ID}?typeID=3297`],
    "the container was read by its own itemID, and said to be what its row says it is",
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

// A stack is merged into another by the page's own call since 2026-10-13 where it holds the place's rows
// (bridge/inventoryWrites.ts), the corporation's hangar's too since 2026-10-14, and the route is gone. The call
// is held to the client's: item.py's drop (958 on, the source `node.rec.locationID` at 1004), invControllers.py
// 327 to 335 and invCache.py 1124, MultiMerge([(source, destination, qty)], the source's place) on the inventory the
// target is in.

/** A pilot docked at Jita (60003760), as the store has it once a character is chosen. */
function dockedAtJita(store: ReturnType<typeof createClientStore>): void {
  store.apply({
    type: "character/online",
    character: { characterID: 90000001, characterName: "Synthetic Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 98000001 },
    station: null,
  });
}

/** The hangar's read until a merge is made, and then the two stacks as one where `merges`. */
function hangarMerging(merges: boolean) {
  let merged = false;
  return makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/call") {
      merged = merges;
      return { status: 200, body: { ok: true, service: body.service, method: body.method, result: null, notifications: [] } };
    }
    if (path === "/api/bridge/inventory") {
      const panel = inventoryPanel();
      if (!merged) return { status: 200, body: panel };
      const items = (panel.hangar.list.items as { fields: { itemID: number; quantity: number } }[])
        .filter((row) => row.fields.itemID !== 101)
        .map((row) => (row.fields.itemID === 100 ? packedRow({ ...row.fields, quantity: 1250 }) : row));
      return { status: 200, body: { ...panel, hangar: { ...panel.hangar, list: { type: "list", items } } } };
    }
    return { status: 200, body: { ok: true } };
  });
}

test("a stack dropped on a stack in the hangar is the client's MultiMerge on the hangar's own inventory: the whole stack, and the station it lies in", async () => {
  const store = createClientStore();
  dockedAtJita(store);
  const { fetch, requests } = hangarMerging(true);
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();

  await flow.mergeStacks(101, 100, { kind: "hangar" });

  const calls = requests.filter((r) => r.path === "/api/bridge/call").map((r) => r.body);
  assert.deepEqual(calls, [
    { service: "invbroker", method: "MultiMerge", args: [[[101, 100, 500]], 60003760], kwargs: null, pilot: true, confirm: true, of: "hangar" },
  ]);
  assert.equal(requests.some((r) => r.path === "/api/bridge/inventory/merge"), false);
  assert.match(String(store.inventory.get().lastOutcome?.message), /Merged 500/);
});

test("a merge the server declines says so without inventing a cause", async () => {
  const store = createClientStore();
  dockedAtJita(store);
  const { fetch } = hangarMerging(false);
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();

  await flow.mergeStacks(101, 100, { kind: "hangar" });

  const outcome = store.inventory.get().lastOutcome;
  assert.equal(outcome?.applied, false);
  assert.match(String(outcome?.message), /did not merge those stacks, and gave no reason/);
});

// --- trash ------------------------------------------------------------------

// Items are trashed by the page's own call since 2026-10-13 (bridge/inventoryWrites.ts), held to the client's:
// invItemFunctions.TrashInvItems (602 to 626), GetInventoryMgr().TrashItems(itemsToTrash, locationID), on the
// inventory manager of where the pilot is, the place the station the items lie in (invCache.py 660 to 691).

/** The hangar's read until a trash is made, and then without `gone`. */
function hangarTrashing(gone: readonly number[]) {
  let trashed = false;
  return makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/call") {
      trashed = true;
      return { status: 200, body: { ok: true, service: body.service, method: body.method, result: null, notifications: [] } };
    }
    if (path === "/api/bridge/inventory") {
      const panel = inventoryPanel();
      if (!trashed) return { status: 200, body: panel };
      const items = (panel.hangar.list.items as { fields: { itemID: number } }[]).filter((row) => !gone.includes(row.fields.itemID));
      return { status: 200, body: { ...panel, hangar: { ...panel.hangar, list: { type: "list", items } } } };
    }
    return { status: 200, body: { ok: true } };
  });
}

test("items are trashed as the client trashes them: TrashItems on the inventory manager, naming the station, and the verdict by the hangar read again", async () => {
  const store = createClientStore();
  dockedAtJita(store);
  const { fetch, requests } = hangarTrashing([100, 101]);
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();

  await flow.trashItems([100, 101], { kind: "hangar" });

  const calls = requests.filter((r) => r.path === "/api/bridge/call").map((r) => r.body);
  assert.deepEqual(calls, [{ service: "invbroker", method: "TrashItems", args: [[100, 101], 60003760], kwargs: null, pilot: true, confirm: true }]);
  assert.equal(requests.some((r) => r.path === "/api/bridge/inventory/trash"), false);
  assert.match(String(store.inventory.get().lastOutcome?.message), /Destroyed 2 items/);
});

test("trash reports items the server left alongside those it destroyed", async () => {
  const store = createClientStore();
  dockedAtJita(store);
  const { fetch } = hangarTrashing([100]);
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();

  await flow.trashItems([100, 101], { kind: "hangar" });

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

test("an ordinary hangar move asks the client's one-way question before moving, and Cancel moves nothing", async () => {
  // invControllers BaseCorpContainer.oneWay (820) and PromptOneWayMove (595 and 596): ConfirmOneWayItemMove, OK and
  // Cancel, before anything from elsewhere is put into the corporation's hangar (__AddItem 197 to 202, AddItems 529).
  // (Until 2026-10-18 this test named the division by ordinal on /api/bridge/inventory/transfer, a route the page no
  // longer moves by: it makes the client's own call, bridge/inventoryWrites.ts, the division's flag its own.)
  const store = createClientStore();
  const { fetch, requests } = standardFetch();
  const flow = createAppFlow(store, { fetch });
  // AddItems verifies the actual source rows before its one-way question. Asset Safety
  // sources ask their recovery question first (invControllers.AddItems506-529).
  await flow.loadInventory();
  const before = requests.length;

  const moving = flow.transferItems([100], { kind: "hangar" }, { kind: "corp", division: 2 });
  for (let tries = 0; tries < 5 && flow.dialogsSaid.get().length === 0; tries += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  const asked = flow.dialogsSaid.get();
  assert.deepEqual(asked.map((one) => [one.dialog, one.answers]), [["ConfirmOneWayItemMove", "okcancel"]]);
  flow.answerDialog(asked[0]!.n, false);
  await moving;

  assert.deepEqual(requests.slice(before).map((r) => r.path).filter((path) => path.startsWith("/api/bridge/call") || path.startsWith("/api/bridge/inventory/transfer")), []);
  assert.equal(store.inventory.get().actionError, null, "Cancel is no failure");
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
  assert.ok(after.some((r) => r.path === `/api/bridge/inventory/container/${CONTAINER_ID}?typeID=3297`));
  assert.ok(after.some((r) => r.path === "/api/bridge/inventory/corp"));
});

test("a container that is in no list the page holds is opened by its ID alone, and one open already keeps its type", async () => {
  const store = createClientStore();
  const { fetch, requests } = standardFetch();
  const flow = createAppFlow(store, { fetch });
  const opened = () => requests.filter((r) => r.path.startsWith("/api/bridge/inventory/container/")).map((r) => r.path);

  // Nothing loaded: the page has no row for it, and does not guess a type.
  await flow.openContainer(CONTAINER_ID);
  assert.deepEqual(opened(), [`/api/bridge/inventory/container/${CONTAINER_ID}`]);
  // Another container altogether, with that one open: its type is not the open one's.
  await flow.loadInventory();
  await flow.openContainer(CONTAINER_ID);
  await flow.openContainer(8200);
  assert.deepEqual(opened().slice(1), [`/api/bridge/inventory/container/${CONTAINER_ID}?typeID=3297`, "/api/bridge/inventory/container/8200"]);
});

test("a container read again after its row has gone from the lists is still said to be what it was opened as", async () => {
  const store = createClientStore();
  let gone = false;
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory") {
      const panel = inventoryPanel();
      if (gone) panel.hangar.list.items = panel.hangar.list.items.slice(0, 2);
      return { status: 200, body: panel };
    }
    if (path.startsWith("/api/bridge/inventory/container/")) return { status: 200, body: containerReads([]) };
    return { status: 200, body: corpHangar() };
  });
  const flow = createAppFlow(store, { fetch });
  await flow.loadInventory();
  await flow.openContainer(CONTAINER_ID);
  // The container is put into another: the hangar no longer lists it, and it is open still.
  gone = true;
  await flow.loadInventory();
  await flow.openContainer(CONTAINER_ID);
  assert.deepEqual(requests.filter((r) => r.path.startsWith("/api/bridge/inventory/container/")).map((r) => r.path),
    [`/api/bridge/inventory/container/${CONTAINER_ID}?typeID=3297`, `/api/bridge/inventory/container/${CONTAINER_ID}?typeID=3297`]);
});
