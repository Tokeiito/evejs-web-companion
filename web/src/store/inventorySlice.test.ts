import { test } from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "./clientStore.ts";
import type { InventoryContainerState, OnlineCharacterState } from "./types.ts";

const ONLINE: OnlineCharacterState = {
  characterID: 140000003,
  characterName: "Test Three",
  stationID: 60003760,
  structureID: null,
  solarSystemID: 30000142,
  corporationID: 98000000,
};

const HANGAR: InventoryContainerState = {
  rows: [
    { itemID: 100, typeID: 34, groupID: 18, categoryID: 4, flagID: 4, quantity: 750, singleton: false },
  ],
  capacity: { capacity: 1_000_000, used: 7.5 },
  error: null,
};

const CARGO: InventoryContainerState = {
  rows: [],
  capacity: { capacity: 135, used: 0 },
  error: null,
};

test("inventory/loaded populates the slice and marks it loaded", () => {
  const store = createClientStore();
  store.apply({
    type: "inventory/loaded",
    stationID: 60003760,
    activeShipID: 9001,
    hangar: HANGAR,
    cargo: CARGO,
  });
  const inv = store.inventory.get();
  assert.equal(inv.loaded, true);
  assert.equal(inv.stationID, 60003760);
  assert.equal(inv.activeShipID, 9001);
  assert.equal(inv.hangar.rows.length, 1);
  assert.deepEqual(inv.cargo.capacity, { capacity: 135, used: 0 });
});

test("a per-container error is preserved without blanking the other container", () => {
  const store = createClientStore();
  store.apply({
    type: "inventory/loaded",
    stationID: 60003760,
    activeShipID: 9001,
    hangar: HANGAR,
    cargo: { rows: [], capacity: null, error: "READ_FAILED" },
  });
  const inv = store.inventory.get();
  assert.equal(inv.hangar.rows.length, 1, "hangar still shows");
  assert.equal(inv.cargo.error, "READ_FAILED");
});

test("inventory/action-error sets and clears the mutation error", () => {
  const store = createClientStore();
  store.apply({ type: "inventory/action-error", message: "CALL_REFUSED: nope" });
  assert.equal(store.inventory.get().actionError, "CALL_REFUSED: nope");
  store.apply({ type: "inventory/action-error", message: null });
  assert.equal(store.inventory.get().actionError, null);
});

test("a successful load clears a stale action error", () => {
  const store = createClientStore();
  store.apply({ type: "inventory/action-error", message: "boom" });
  store.apply({
    type: "inventory/loaded",
    stationID: 60003760,
    activeShipID: 9001,
    hangar: HANGAR,
    cargo: CARGO,
  });
  assert.equal(store.inventory.get().actionError, null);
});

test("going offline / logging out / a fresh online entry clears the inventory", () => {
  for (const clearing of [
    { type: "character/offline" as const },
    { type: "inventory/cleared" as const },
  ]) {
    const store = createClientStore();
    store.apply({
      type: "inventory/loaded",
      stationID: 60003760,
      activeShipID: 9001,
      hangar: HANGAR,
      cargo: CARGO,
    });
    store.apply(clearing);
    assert.equal(store.inventory.get().loaded, false, JSON.stringify(clearing));
    assert.equal(store.inventory.get().hangar.rows.length, 0, JSON.stringify(clearing));
  }

  // A fresh docked entry resets any prior character's inventory.
  const store = createClientStore();
  store.apply({
    type: "inventory/loaded",
    stationID: 60003760,
    activeShipID: 9001,
    hangar: HANGAR,
    cargo: CARGO,
  });
  store.apply({ type: "character/online", character: ONLINE, station: null });
  assert.equal(store.inventory.get().loaded, false);
});

test("the whole-store subscriber sees one notification per inventory event", () => {
  const store = createClientStore();
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  notifications = 0; // ignore the synchronous initial call
  store.apply({
    type: "inventory/loaded",
    stationID: 60003760,
    activeShipID: 9001,
    hangar: HANGAR,
    cargo: CARGO,
  });
  assert.equal(notifications, 1);
});

// --- R14 inventory depth ----------------------------------------------------

test("inventory/selection replaces the whole tick-selection", () => {
  const store = createClientStore();
  store.apply({ type: "inventory/selection", itemIDs: [100, 101] });
  assert.deepEqual(store.inventory.get().selection, [100, 101]);
  store.apply({ type: "inventory/selection", itemIDs: [] });
  assert.deepEqual(store.inventory.get().selection, []);
});

test("a reload keeps only the ticks whose item is still visible somewhere", () => {
  const store = createClientStore();
  store.apply({ type: "inventory/selection", itemIDs: [100, 999] });
  store.apply({
    type: "inventory/loaded",
    stationID: 60003760,
    activeShipID: 9001,
    hangar: HANGAR,
    cargo: CARGO,
  });
  // Acting on a tick whose row has vanished would move something the player can
  // no longer see, so it is dropped.
  assert.deepEqual(store.inventory.get().selection, [100]);
});

test("inventory/container opens and closes a container, clearing the selection", () => {
  const store = createClientStore();
  store.apply({ type: "inventory/selection", itemIDs: [100] });
  store.apply({
    type: "inventory/container",
    container: { itemID: 8100, typeID: 3297, rows: [], capacity: null, error: null },
  });
  assert.equal(store.inventory.get().container?.itemID, 8100);
  assert.deepEqual(
    store.inventory.get().selection,
    [],
    "a tick made outside a container must not follow you into it",
  );

  store.apply({ type: "inventory/container", container: null });
  assert.equal(store.inventory.get().container, null);
});

test("inventory/corp-loaded stores the divisions with their NAMES", () => {
  const store = createClientStore();
  store.apply({
    type: "inventory/corp-loaded",
    available: true,
    reason: null,
    divisions: [
      { division: 1, name: "Ore Bay", rows: [], error: null },
      { division: 2, name: null, rows: [], error: null },
    ],
  });
  const corp = store.inventory.get().corp;
  assert.equal(corp.loaded, true);
  assert.equal(corp.available, true);
  assert.equal(corp.divisions[0]!.name, "Ore Bay");
  assert.equal(corp.divisions[1]!.name, null, "an unnamed division carries no name");
  assert.equal(corp.selectedDivision, 1, "the first division is shown by default");
});

test("a corporation with no office here is unavailable, with a reason and no divisions", () => {
  const store = createClientStore();
  store.apply({
    type: "inventory/corp-loaded",
    available: false,
    reason: "NO_CORP_OFFICE",
    divisions: [],
  });
  const corp = store.inventory.get().corp;
  assert.equal(corp.available, false);
  assert.equal(corp.reason, "NO_CORP_OFFICE");
  assert.deepEqual(corp.divisions, []);
  assert.equal(corp.loaded, true, "the read still completed");
});

test("inventory/corp-division switches divisions and clears the selection", () => {
  const store = createClientStore();
  store.apply({ type: "inventory/selection", itemIDs: [400] });
  store.apply({ type: "inventory/corp-division", division: 4 });
  assert.equal(store.inventory.get().corp.selectedDivision, 4);
  assert.deepEqual(store.inventory.get().selection, []);
});

test("inventory/outcome records what the server actually did, and clears", () => {
  const store = createClientStore();
  store.apply({
    type: "inventory/outcome",
    outcome: {
      applied: false,
      declinedSilently: true,
      message: "The server did not move anything, and gave no reason.",
    },
  });
  const outcome = store.inventory.get().lastOutcome;
  assert.equal(outcome?.applied, false);
  assert.equal(outcome?.declinedSilently, true);

  store.apply({ type: "inventory/outcome", outcome: null });
  assert.equal(store.inventory.get().lastOutcome, null);
});

test("inventory/cleared drops the R14 state too", () => {
  const store = createClientStore();
  store.apply({ type: "inventory/selection", itemIDs: [100] });
  store.apply({
    type: "inventory/container",
    container: { itemID: 8100, typeID: 3297, rows: [], capacity: null, error: null },
  });
  store.apply({
    type: "inventory/corp-loaded",
    available: true,
    reason: null,
    divisions: [{ division: 1, name: "Ore Bay", rows: [], error: null }],
  });
  store.apply({ type: "inventory/cleared" });

  const inv = store.inventory.get();
  assert.deepEqual(inv.selection, []);
  assert.equal(inv.container, null);
  assert.equal(inv.corp.available, false);
  assert.equal(inv.corp.loaded, false);
  assert.equal(inv.lastOutcome, null);
});
