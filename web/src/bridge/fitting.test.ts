// Goal R12: decoding the fitting reads into slots and resource bars.
//
// Covers the shapes that actually come off the wire: ListByFlags packedrows,
// the python-set-wrapped empty list, the ShipGetInfo attribute dict, and the
// docked-ship capacitor quirk (base capacity null, effective value in charge).

import test from "node:test";
import assert from "node:assert/strict";

import {
  SLOT_FAMILY_LABELS,
  SLOT_FAMILY_ORDER,
  buildSlots,
  decodeOnlineModuleIDs,
  decodeResources,
  decodeShipAttributes,
  isFittableRow,
  slotsOfFamily,
} from "./fitting.ts";
import type { JsonValue } from "./wire.ts";

// --- fixtures ---------------------------------------------------------------

function packedRow(fields: Record<string, JsonValue>): JsonValue {
  return { type: "packedrow", fields } as unknown as JsonValue;
}

function slotList(rows: readonly JsonValue[]): JsonValue {
  return { type: "list", items: rows } as unknown as JsonValue;
}

/** The empty flag-scoped List shape: a python set wrapping an empty list. */
function emptySet(): JsonValue {
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "__builtin__.set" },
      [{ type: "list", items: [] }],
    ],
  } as unknown as JsonValue;
}

/** A dogmaIM.ShipGetInfo result carrying the given attributeID -> value map. */
function shipInfo(attributes: Record<number, number | null>): JsonValue {
  return {
    type: "dict",
    entries: [
      [
        9001,
        {
          type: "object",
          name: "util.KeyVal",
          args: {
            type: "dict",
            entries: [
              ["itemID", 9001],
              [
                "attributes",
                {
                  type: "dict",
                  entries: Object.entries(attributes).map(([id, value]) => [
                    Number(id),
                    value,
                  ]),
                },
              ],
            ],
          },
        },
      ],
    ],
  } as unknown as JsonValue;
}

/** A Punisher-shaped ship: 4 high, 2 mid, 5 low, 3 rig slots. */
const PUNISHER_ATTRIBUTES: Record<number, number | null> = {
  48: 168, // CPU output
  49: 3.6, // CPU load
  11: 88.44, // powergrid output
  15: 6, // powergrid load
  482: null, // capacitor capacity — null while DOCKED
  18: 460, // charge — the effective capacitor a docked ship reports
  1132: 400, // calibration capacity
  1152: 100, // calibration used
  14: 4, // high slots
  13: 2, // mid slots
  12: 5, // low slots
  1137: 3, // rig slots
};

// --- attribute + online reads ----------------------------------------------

test("decodeShipAttributes pulls the ship's attribute map out of ShipGetInfo", () => {
  const attributes = decodeShipAttributes(shipInfo(PUNISHER_ATTRIBUTES));
  assert.equal(attributes.get(48), 168);
  assert.equal(attributes.get(11), 88.44);
  assert.equal(attributes.get(482), null);
});

test("decodeShipAttributes tolerates a malformed or missing result", () => {
  for (const value of [null, 7, "nope", { type: "dict", entries: [] }] as JsonValue[]) {
    assert.equal(decodeShipAttributes(value).size, 0);
  }
});

test("decodeOnlineModuleIDs reads the flat list of online module IDs", () => {
  const online = decodeOnlineModuleIDs({ type: "list", items: [11, 22, 33] } as unknown as JsonValue);
  assert.equal(online.has(22), true);
  assert.equal(online.has(44), false);
  assert.equal(decodeOnlineModuleIDs(null as unknown as JsonValue).size, 0);
});

// --- resource readings ------------------------------------------------------

test("decodeResources reads CPU, powergrid and calibration as used vs total", () => {
  const resources = decodeResources(shipInfo(PUNISHER_ATTRIBUTES));
  assert.deepEqual(
    { used: resources.cpu.used, total: resources.cpu.total, known: resources.cpu.known },
    { used: 3.6, total: 168, known: true },
  );
  assert.deepEqual(
    { used: resources.powergrid.used, total: resources.powergrid.total, known: true },
    { used: 6, total: 88.44, known: true },
  );
  assert.deepEqual(
    { used: resources.calibration.used, total: resources.calibration.total },
    { used: 100, total: 400 },
  );
});

test("a DOCKED ship's capacitor reads from charge when the capacity attribute is null", () => {
  const resources = decodeResources(shipInfo(PUNISHER_ATTRIBUTES));
  assert.equal(resources.capacitor.known, true);
  assert.equal(resources.capacitor.total, 460, "falls back to the charge attribute");
});

test("capacitor prefers the real capacity attribute when the ship reports one", () => {
  const resources = decodeResources(
    shipInfo({ ...PUNISHER_ATTRIBUTES, 482: 375, 18: 200 }),
  );
  assert.equal(resources.capacitor.total, 375);
});

test("a missing reading is 'unknown', never a misleading 0 / 0", () => {
  const resources = decodeResources(shipInfo({}));
  for (const reading of [
    resources.cpu,
    resources.powergrid,
    resources.capacitor,
    resources.calibration,
  ]) {
    assert.equal(reading.known, false);
  }
});

// --- slot building ----------------------------------------------------------

test("buildSlots draws one slot per slot the ship HAS, empty slots included", () => {
  const slots = buildSlots(emptySet(), shipInfo(PUNISHER_ATTRIBUTES), null as unknown as JsonValue);
  assert.equal(slotsOfFamily(slots, "high").length, 4);
  assert.equal(slotsOfFamily(slots, "mid").length, 2);
  assert.equal(slotsOfFamily(slots, "low").length, 5);
  assert.equal(slotsOfFamily(slots, "rig").length, 3);
  assert.equal(slotsOfFamily(slots, "subsystem").length, 0, "a frigate has no subsystems");
  // Every one of them is visibly EMPTY rather than absent.
  assert.equal(slots.every((slot) => slot.module === null), true);
});

test("buildSlots places each fitted module in its own slot, by family and index", () => {
  const slots = buildSlots(
    slotList([
      packedRow({ itemID: 5001, typeID: 3634, groupID: 53, flagID: 27 }), // high slot 1
      packedRow({ itemID: 5002, typeID: 3634, groupID: 53, flagID: 29 }), // high slot 3
      packedRow({ itemID: 5003, typeID: 2048, groupID: 60, flagID: 11 }), // low slot 1
      packedRow({ itemID: 5004, typeID: 31358, groupID: 781, flagID: 92 }), // rig 1
    ]),
    shipInfo(PUNISHER_ATTRIBUTES),
    { type: "list", items: [5001] } as unknown as JsonValue,
  );

  const high = slotsOfFamily(slots, "high");
  assert.equal(high[0]!.module?.itemID, 5001);
  assert.equal(high[1]!.module, null, "the second high slot is empty");
  assert.equal(high[2]!.module?.itemID, 5002);
  assert.equal(high[3]!.module, null);

  assert.equal(slotsOfFamily(slots, "low")[0]!.module?.typeID, 2048);
  assert.equal(slotsOfFamily(slots, "rig")[0]!.module?.typeID, 31358);

  // Online state comes from ShipOnlineModules, per module.
  assert.equal(high[0]!.module?.online, true);
  assert.equal(high[2]!.module?.online, false);
});

test("a module fitted beyond the reported slot count is still shown", () => {
  // The server is authoritative about what is FITTED; the slot count only
  // decides how many empty slots to draw, so it must never hide a module.
  const slots = buildSlots(
    slotList([packedRow({ itemID: 5010, typeID: 3634, groupID: 53, flagID: 32 })]),
    shipInfo({ ...PUNISHER_ATTRIBUTES, 14: 2 }),
    null as unknown as JsonValue,
  );
  const high = slotsOfFamily(slots, "high");
  assert.equal(high.length, 6, "grown to reach the occupied slot");
  assert.equal(high[5]!.module?.itemID, 5010);
});

test("a charge's tuple itemID is not mistaken for a module", () => {
  // A loaded charge arrives with an ARRAY itemID (ship, flag, type), not a
  // number. Those rows are dropped: the panel shows modules per slot.
  const slots = buildSlots(
    slotList([
      packedRow({ itemID: [9001, 27, 200] as unknown as JsonValue, typeID: 200, flagID: 27 }),
      packedRow({ itemID: 5001, typeID: 3634, flagID: 28 }),
    ]),
    shipInfo(PUNISHER_ATTRIBUTES),
    null as unknown as JsonValue,
  );
  const high = slotsOfFamily(slots, "high");
  assert.equal(high[0]!.module, null, "the charge did not fill the slot");
  assert.equal(high[1]!.module?.itemID, 5001);
});

test("slots come back in fitting-window order, and every family is labelled", () => {
  const slots = buildSlots(emptySet(), shipInfo(PUNISHER_ATTRIBUTES), null as unknown as JsonValue);
  const families = [...new Set(slots.map((slot) => slot.family))];
  assert.deepEqual(families, ["high", "mid", "low", "rig"]);
  for (const family of SLOT_FAMILY_ORDER) {
    assert.equal(typeof SLOT_FAMILY_LABELS[family], "string");
    assert.ok(SLOT_FAMILY_LABELS[family].length > 0);
  }
});

// --- what can be fitted -----------------------------------------------------

test("only modules and subsystems are offered as fittable", () => {
  assert.equal(isFittableRow(7), true, "a module");
  assert.equal(isFittableRow(32), true, "a subsystem");
  assert.equal(isFittableRow(8), false, "a charge");
  assert.equal(isFittableRow(6), false, "a ship");
  assert.equal(isFittableRow(18), false, "a drone");
  assert.equal(isFittableRow(null), false);
});
