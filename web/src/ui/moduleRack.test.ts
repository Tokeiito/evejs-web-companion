// The module-rack model (moduleRack.ts): grouping into high/mid/low, the
// activation overlay from the snapshot, and the empty-fit signal.

import test from "node:test";
import assert from "node:assert/strict";

import { buildModuleRack, rackIsEmpty } from "./moduleRack.ts";
import type { FittingSlot } from "../store/types.ts";

function slot(family: FittingSlot["family"], index: number, mod: { itemID: number; typeID: number; online?: boolean } | null): FittingSlot {
  return {
    family,
    index,
    module: mod ? { itemID: mod.itemID, typeID: mod.typeID, groupID: null, online: mod.online ?? true } : null,
  };
}

test("groups slots into high/mid/low in order, skipping rigs/subsystems", () => {
  const slots: FittingSlot[] = [
    slot("high", 0, { itemID: 1, typeID: 3634 }),
    slot("mid", 0, { itemID: 2, typeID: 5001 }),
    slot("low", 0, null),
    slot("rig", 0, { itemID: 9, typeID: 31358 }),
    slot("subsystem", 0, { itemID: 10, typeID: 30000 }),
  ];
  const rows = buildModuleRack(slots, null);
  assert.deepEqual(rows.map((r) => r.family), ["high", "mid", "low"]);
  assert.equal(rows[0]!.slots.length, 1);
  assert.equal(rows[1]!.slots.length, 1);
  assert.equal(rows[2]!.slots.length, 1);
  // The low slot is present but empty.
  assert.equal(rows[2]!.slots[0]!.module, null);
});

test("marks a module active when the snapshot lists its itemID", () => {
  const slots: FittingSlot[] = [
    slot("high", 0, { itemID: 1, typeID: 3634 }),
    slot("high", 1, { itemID: 2, typeID: 3634 }),
  ];
  const rows = buildModuleRack(slots, [1]);
  assert.equal(rows[0]!.slots[0]!.module?.active, true, "module 1 should be active");
  assert.equal(rows[0]!.slots[1]!.module?.active, false, "module 2 should be idle");
});

test("no snapshot means nothing glows", () => {
  const slots: FittingSlot[] = [slot("high", 0, { itemID: 1, typeID: 3634 })];
  assert.equal(buildModuleRack(slots, null)[0]!.slots[0]!.module?.active, false);
});

test("an offline module carries its offline flag through", () => {
  const slots: FittingSlot[] = [slot("mid", 0, { itemID: 7, typeID: 5001, online: false })];
  assert.equal(buildModuleRack(slots, [])[1]!.slots[0]!.module?.online, false);
});

test("rackIsEmpty is true only when no slots exist at all", () => {
  assert.equal(rackIsEmpty(buildModuleRack([], null)), true);
  assert.equal(rackIsEmpty(buildModuleRack([slot("high", 0, null)], null)), false);
});
