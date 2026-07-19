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
