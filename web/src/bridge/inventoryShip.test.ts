import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeCapacity,
  decodeContainer,
  decodeInventoryRows,
  isBoardableShip,
} from "./inventoryShip.ts";
import type { JsonValue } from "./wire.ts";

// Handler-shaped fixtures: invbroker List returns a packed-row list (or, when
// empty and flag-scoped, a python set wrapping an empty list); GetCapacity
// returns a util.KeyVal {capacity, used}.

function packedRow(fields: Record<string, JsonValue>): JsonValue {
  return { type: "packedrow", fields };
}

const HANGAR_LIST: JsonValue = {
  type: "list",
  items: [
    packedRow({ itemID: 100, typeID: 34, groupID: 18, categoryID: 4, flagID: 4, quantity: 750, singleton: 0 }),
    packedRow({ itemID: 200, typeID: 597, groupID: 25, categoryID: 6, flagID: 4, quantity: 1, singleton: 1 }),
  ],
};

const EMPTY_SET: JsonValue = {
  type: "object",
  name: "__builtin__.set",
  args: [{ type: "list", items: [] }],
};

const CAPACITY: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: { type: "dict", entries: [["capacity", 135], ["used", 7.5]] },
};

test("decodeInventoryRows decodes a packed-row list, dropping rows without an itemID", () => {
  const rows = decodeInventoryRows(HANGAR_LIST);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    itemID: 100,
    typeID: 34,
    groupID: 18,
    categoryID: 4,
    flagID: 4,
    quantity: 750,
    singleton: false,
  });
  assert.equal(rows[1]!.itemID, 200);
  assert.equal(rows[1]!.singleton, true);
  assert.equal(rows[1]!.categoryID, 6);
});

test("decodeInventoryRows unwraps an empty python set to no rows", () => {
  assert.deepEqual(decodeInventoryRows(EMPTY_SET), []);
});

test("decodeInventoryRows falls back to stacksize when quantity is absent", () => {
  const rows = decodeInventoryRows({
    type: "list",
    items: [packedRow({ itemID: 5, typeID: 34, flagID: 5, stacksize: 42 })],
  });
  assert.equal(rows[0]!.quantity, 42);
});

test("decodeInventoryRows tolerates malformed input", () => {
  assert.deepEqual(decodeInventoryRows(null), []);
  assert.deepEqual(decodeInventoryRows({ type: "dict", entries: [] } as JsonValue), []);
  assert.deepEqual(decodeInventoryRows([1, 2, 3] as unknown as JsonValue), []);
});

test("decodeCapacity reads the util.KeyVal capacity/used pair", () => {
  assert.deepEqual(decodeCapacity(CAPACITY), { capacity: 135, used: 7.5 });
});

test("decodeCapacity returns null for a non-KeyVal result", () => {
  assert.equal(decodeCapacity(null), null);
  assert.equal(decodeCapacity({ type: "list", items: [] } as JsonValue), null);
});

test("decodeContainer bundles rows, capacity, and a preserved per-container error", () => {
  const container = decodeContainer(HANGAR_LIST, CAPACITY, null);
  assert.equal(container.rows.length, 2);
  assert.deepEqual(container.capacity, { capacity: 135, used: 7.5 });
  assert.equal(container.error, null);

  // A failed read keeps its error and yields no rows/capacity (the other
  // container is unaffected — decoded independently).
  const failed = decodeContainer(null, null, "READ_FAILED");
  assert.deepEqual(failed.rows, []);
  assert.equal(failed.capacity, null);
  assert.equal(failed.error, "READ_FAILED");
});

test("isBoardableShip recognizes hangar ships that are not already active", () => {
  const ship = { itemID: 200, typeID: 597, groupID: 25, categoryID: 6, flagID: 4, quantity: 1, singleton: true };
  const trit = { itemID: 100, typeID: 34, groupID: 18, categoryID: 4, flagID: 4, quantity: 750, singleton: false };
  assert.equal(isBoardableShip(ship, null), true);
  assert.equal(isBoardableShip(ship, 200), false, "the active ship is not boardable");
  assert.equal(isBoardableShip(trit, null), false, "a non-ship is not boardable");
});
