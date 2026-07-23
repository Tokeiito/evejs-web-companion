// The ship-hangar summary model (shipHangar.ts): active vs. other hulls, and
// the category-6 filter that keeps non-ship items out.

import test from "node:test";
import assert from "node:assert/strict";

import { buildShipHangar } from "./shipHangar.ts";
import type { InventoryItemRow } from "../store/types.ts";

function row(over: Partial<InventoryItemRow> & { itemID: number }): InventoryItemRow {
  return {
    typeID: 587,
    groupID: null,
    categoryID: 6,
    flagID: null,
    quantity: 1,
    singleton: true,
    ...over,
  };
}

test("splits the active hull from the others", () => {
  const rows = [row({ itemID: 1 }), row({ itemID: 2 }), row({ itemID: 3 })];
  const view = buildShipHangar(2, rows);
  assert.equal(view.active?.itemID, 2);
  assert.deepEqual(view.others.map((r) => r.itemID), [1, 3]);
  assert.equal(view.total, 3);
});

test("non-ship rows (not category 6) are excluded from the hull list", () => {
  const rows = [
    row({ itemID: 1 }),
    row({ itemID: 2, categoryID: 7 }), // a module, say
  ];
  const view = buildShipHangar(1, rows);
  assert.equal(view.active?.itemID, 1);
  assert.deepEqual(view.others.map((r) => r.itemID), []);
  assert.equal(view.total, 1);
});

test("the active ship is kept even if its category has not resolved", () => {
  const rows = [row({ itemID: 9, categoryID: null })];
  const view = buildShipHangar(9, rows);
  assert.equal(view.active?.itemID, 9);
  assert.equal(view.total, 1);
});

test("no active ship id -> only the category-6 hulls, none active", () => {
  const rows = [row({ itemID: 1 }), row({ itemID: 2, categoryID: 7 })];
  const view = buildShipHangar(null, rows);
  assert.equal(view.active, null);
  assert.deepEqual(view.others.map((r) => r.itemID), [1]);
  assert.equal(view.total, 1);
});
