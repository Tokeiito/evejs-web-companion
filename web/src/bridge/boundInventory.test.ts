// R75 — decoder tests for the 8 RB-INV bound reads, built from REAL captured bytes
// (Farmer 140000005, docked Perimeter 60000358, 2026-07-22) plus the live arg-
// injection leak row (Farmer reading Test Two's Capsule). PLUMBING ONLY.

import test from "node:test";
import assert from "node:assert/strict";
import {
  intData,
  decodeContainerContents,
  decodeGetItem,
  decodeGetItems,
  decodeBayList,
  decodeItemDescriptor,
  decodeTurretSlots,
  decodeCrystalDamage,
  decodeBoundInventory,
} from "./boundInventory.ts";
import type { JsonValue } from "./wire.ts";

const HEADER = [
  "itemID",
  "typeID",
  "ownerID",
  "locationID",
  "flagID",
  "quantity",
  "groupID",
  "categoryID",
  "customInfo",
  "stacksize",
  "singleton",
];

// A util.Row exactly as invbroker builds it: header/line are BARE ARRAYS.
function utilRow(cells: JsonValue[]): JsonValue {
  return {
    type: "object",
    name: "util.Row",
    args: { type: "dict", entries: [["header", HEADER], ["line", cells]] },
  };
}

// A Rowset exactly as GetContainerContents builds it: header is a {type:"list"}
// wrapper, lines are BARE-ARRAY cells.
function rowset(lines: JsonValue[][]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: HEADER }],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: lines }],
      ],
    },
  };
}

// A packedrow exactly as _buildInventoryPackedRow builds it (fields name-keyed).
function packedRow(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "packedrow",
    columns: [
      ["itemID", 20],
      ["typeID", 3],
      ["ownerID", 3],
      ["locationID", 20],
      ["flagID", 2],
      ["quantity", 3],
      ["groupID", 3],
      ["categoryID", 3],
      ["customInfo", 129],
    ],
    fields,
  };
}

// A blue.DBRowDescriptor exactly as buildPackedRowDescriptor builds it.
function descriptorResult(
  columns: readonly (readonly [string, number])[],
  virtualColumns: readonly string[],
): JsonValue {
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "blue.DBRowDescriptor" },
      [columns.map(([name, code]) => [name, code])],
      {
        type: "list",
        items: virtualColumns.map((name) => [
          name,
          { type: "token", value: `eve.common.script.sys.eveCfg.${name}` },
        ]),
      },
    ],
    list: [],
    dict: [],
  };
}

// --- intData (R7d) ----------------------------------------------------------

test("intData keeps a safe-int id a Number, a >2^53 id an EXACT string, 0 survives, absent is null", () => {
  assert.equal(intData(9988400023309), 9988400023309); // real Farmer ship itemID, safe int
  assert.equal(intData(0), 0); // flagID 0 is a real container flag, not absent
  assert.equal(intData(-1), -1); // the assembled-singleton quantity marker survives
  // A long-wrapped id beyond 2^53 must NOT pass through Number.
  assert.equal(intData({ type: "long", value: "9223372036854775807" }), "9223372036854775807");
  assert.equal(intData(null), null);
  assert.equal(intData(undefined), null);
});

// --- GetContainerContents (Rowset of bare-array lines) ----------------------

test("decodeContainerContents folds a Rowset's bare-array lines into inventory rows", () => {
  // Two REAL fitted-module lines from Farmer's docked-ship contents + the real
  // 468937-unit station stack (a non-singleton with a large quantity/stacksize).
  const result = rowset([
    [9988400023306, 448, 140000005, 9988400023309, 20, -1, 52, 7, "", 1, 1],
    [9988400023307, 28578, 140000005, 9988400023309, 11, -1, 546, 7, "", 1, 1],
    [9988400037372, 1230, 140000005, 60000358, 4, 468937, 462, 25, "", 468937, 0],
  ]);
  const rows = decodeContainerContents(result);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    itemID: 9988400023306,
    typeID: 448,
    ownerID: 140000005,
    locationID: 9988400023309,
    flagID: 20,
    quantity: -1,
    groupID: 52,
    categoryID: 7,
    customInfo: "",
    stacksize: 1,
    singleton: true,
  });
  // The big stack: quantity + stacksize preserved, singleton false.
  assert.equal(rows[2]?.quantity, 468937);
  assert.equal(rows[2]?.stacksize, 468937);
  assert.equal(rows[2]?.singleton, false);
});

test("decodeContainerContents is [] for a non-rowset", () => {
  assert.deepEqual(decodeContainerContents({ type: "list", items: [] }), []);
  assert.deepEqual(decodeContainerContents(null), []);
});

// --- GetItem (single bare-array util.Row) -----------------------------------

test("decodeGetItem folds a bare-array util.Row (the real Farmer ship row)", () => {
  const result = utilRow([9988400023309, 17480, 140000005, 60000358, 4, -1, 463, 6, "", 1, 1]);
  assert.deepEqual(decodeGetItem(result), {
    itemID: 9988400023309,
    typeID: 17480,
    ownerID: 140000005,
    locationID: 60000358,
    flagID: 4,
    quantity: -1,
    groupID: 463,
    categoryID: 6,
    customInfo: "",
    stacksize: 1,
    singleton: true,
  });
});

test("decodeGetItem surfaces the LIVE arg-injection leak row verbatim (Test Two's Capsule)", () => {
  // Farmer POSTing GetItem(9988400091900 = Test Two's ship) got Test Two's OWN
  // descriptor back — the decoder must not launder that; it carries ownerID/typeID
  // as data so the leak is visible, not hidden. (Handler fix is server-side —
  // docs/arg-injection-leak-handoff.md.)
  const foreign = utilRow([9988400091900, 648, 140000002, 60000004, 4, -1, 28, 6, "", 1, 1]);
  const row = decodeGetItem(foreign);
  assert.equal(row?.ownerID, 140000002);
  assert.equal(row?.typeID, 648);
  assert.equal(row?.locationID, 60000004);
});

test("decodeGetItem is null for a non-row", () => {
  assert.equal(decodeGetItem({ type: "list", items: [] }), null);
  assert.equal(decodeGetItem(null), null);
});

// --- GetItems (list of bare-array util.Rows) --------------------------------

test("decodeGetItems folds each util.Row; the empty list decodes to []", () => {
  const result = {
    type: "list",
    items: [
      utilRow([9988400023309, 17480, 140000005, 60000358, 4, -1, 463, 6, "", 1, 1]),
      utilRow([9988400023316, 2488, 140000005, 9988400023309, 87, 4, 100, 18, "", 4, 0]),
    ],
  };
  const rows = decodeGetItems(result);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.typeID, 17480);
  assert.equal(rows[1]?.itemID, 9988400023316);
  assert.equal(rows[1]?.quantity, 4);
  assert.equal(rows[1]?.singleton, false);
  assert.deepEqual(decodeGetItems({ type: "list", items: [] }), []);
});

// --- ListDroneBay / ListFighterBay (list of packedrows) ---------------------

test("decodeBayList folds packedrow fields (real Farmer drone bay: a stack + an assembled singleton)", () => {
  const result = {
    type: "list",
    items: [
      packedRow({
        itemID: 9988400023316,
        typeID: 2488,
        ownerID: 140000005,
        locationID: 9988400023309,
        flagID: 87,
        quantity: 4,
        groupID: 100,
        categoryID: 18,
        customInfo: "",
        stacksize: 4,
        singleton: 0,
      }),
      packedRow({
        itemID: 9988400037367,
        typeID: 2488,
        ownerID: 140000005,
        locationID: 9988400023309,
        flagID: 87,
        quantity: -1,
        groupID: 100,
        categoryID: 18,
        customInfo: "",
        stacksize: 1,
        singleton: 1,
      }),
    ],
  };
  const rows = decodeBayList(result);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.typeID, 2488);
  assert.equal(rows[0]?.quantity, 4);
  assert.equal(rows[0]?.singleton, false);
  assert.equal(rows[1]?.singleton, true);
  assert.equal(rows[1]?.quantity, -1);
});

test("decodeBayList is [] for the real EMPTY fighter bay", () => {
  assert.deepEqual(decodeBayList({ type: "list", items: [] }), []);
  assert.deepEqual(decodeBayList(null), []);
});

// --- GetItemDescriptor (static schema) --------------------------------------

test("decodeItemDescriptor reads the real blue.DBRowDescriptor columns + virtual columns", () => {
  const result = descriptorResult(
    [
      ["itemID", 20],
      ["typeID", 3],
      ["ownerID", 3],
      ["locationID", 20],
      ["flagID", 2],
      ["quantity", 3],
      ["groupID", 3],
      ["categoryID", 3],
      ["customInfo", 129],
    ],
    ["stacksize", "singleton"],
  );
  const descriptor = decodeItemDescriptor(result);
  assert.equal(descriptor?.columns.length, 9);
  assert.deepEqual(descriptor?.columns[0], { name: "itemID", typeCode: 20 });
  assert.deepEqual(descriptor?.columns[4], { name: "flagID", typeCode: 2 });
  assert.deepEqual(descriptor?.virtualColumns, ["stacksize", "singleton"]);
});

test("decodeItemDescriptor is null for a non-descriptor", () => {
  assert.equal(decodeItemDescriptor({ type: "list", items: [] }), null);
  assert.equal(decodeItemDescriptor(null), null);
});

// --- GetAvailableTurretSlots (bare int) -------------------------------------

test("decodeTurretSlots reads the bare integer (0 for Farmer's docked frigate)", () => {
  assert.equal(decodeTurretSlots(0), 0);
  assert.equal(decodeTurretSlots(3), 3);
  assert.equal(decodeTurretSlots({ type: "long", value: "2" }), 2);
  assert.equal(decodeTurretSlots("nope"), null);
});

// --- GetDamageForCrystals (dict) --------------------------------------------

test("decodeCrystalDamage folds the itemID->ratio dict; empty dict -> []", () => {
  assert.deepEqual(decodeCrystalDamage({ type: "dict", entries: [] }), []);
  // Populated shape mirrors buildDict([[itemID, ratio]]) — the server builder for
  // an owned, damaged crystal (foreign crystals are dropped server-side).
  const populated = {
    type: "dict",
    entries: [
      [9988400050001, 0.25],
      [9988400050002, 1],
    ],
  };
  assert.deepEqual(decodeCrystalDamage(populated), [
    { itemID: 9988400050001, damageRatio: 0.25 },
    { itemID: 9988400050002, damageRatio: 1 },
  ]);
});

// --- whole-envelope fold ----------------------------------------------------

function boundEnvelope(): JsonValue {
  return {
    ok: true,
    characterID: 140000005,
    reads: {
      GetContainerContents: {
        result: rowset([[9988400023309, 17480, 140000005, 60000358, 4, -1, 463, 6, "", 1, 1]]),
      },
      GetItem: { result: utilRow([9988400023309, 17480, 140000005, 60000358, 4, -1, 463, 6, "", 1, 1]) },
      GetItems: { result: { type: "list", items: [] } },
      ListDroneBay: {
        result: {
          type: "list",
          items: [
            packedRow({
              itemID: 9988400023316,
              typeID: 2488,
              ownerID: 140000005,
              locationID: 9988400023309,
              flagID: 87,
              quantity: 4,
              groupID: 100,
              categoryID: 18,
              customInfo: "",
              stacksize: 4,
              singleton: 0,
            }),
          ],
        },
      },
      ListFighterBay: { result: { type: "list", items: [] } },
      GetItemDescriptor: { result: descriptorResult([["itemID", 20], ["typeID", 3]], ["stacksize"]) },
      GetAvailableTurretSlots: { result: 0 },
      // A refused read must be carried as {ok:false}, never blank the rest.
      GetDamageForCrystals: { error: "CALL_REFUSED", message: "no owned crystal" },
    },
  };
}

test("decodeBoundInventory folds the whole route envelope, each read its own outcome", () => {
  const decoded = decodeBoundInventory(boundEnvelope());
  assert.equal(decoded.characterID, 140000005);
  assert.equal(decoded.containerContents.ok, true);
  assert.equal(decoded.containerContents.ok && decoded.containerContents.value.length, 1);
  assert.equal(decoded.item.ok && decoded.item.value?.typeID, 17480);
  assert.equal(decoded.items.ok && decoded.items.value.length, 0);
  assert.equal(decoded.droneBay.ok && decoded.droneBay.value.length, 1);
  assert.equal(decoded.fighterBay.ok && decoded.fighterBay.value.length, 0);
  assert.equal(decoded.descriptor.ok && decoded.descriptor.value?.columns.length, 2);
  assert.equal(decoded.turretSlots.ok && decoded.turretSlots.value, 0);
  // The refused read is an error outcome, not an exception, not an empty success.
  assert.equal(decoded.crystalDamage.ok, false);
  assert.equal(!decoded.crystalDamage.ok && decoded.crystalDamage.error, "CALL_REFUSED");
});
