// Drag and drop (goal R78): a payload that survives a hostile string, and drop
// rules that a target can consult BEFORE it promises the cursor a drop.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DRAG_MIME,
  carriesOurPayload,
  decodeDrag,
  dropOnPlaceVerdict,
  dropOnSocketVerdict,
  encodeDrag,
  samePlace,
  type DragPayload,
} from "./dragDrop.ts";
import type { InventoryPlace } from "../store/types.ts";

const HANGAR: InventoryPlace = { kind: "hangar" };
const CARGO: InventoryPlace = { kind: "cargo" };
const ORE_BAY: InventoryPlace = { kind: "shipBay", bay: "ore" };

const ITEM: DragPayload = {
  kind: "inventoryItem",
  itemID: 1_001,
  typeID: 483,
  from: HANGAR,
};
const FITTED: DragPayload = { kind: "fittedModule", itemID: 7_700_001, typeID: 483 };

// --- the payload survives the round trip -------------------------------------

test("an inventory drag survives encode and decode", () => {
  assert.deepEqual(decodeDrag(encodeDrag(ITEM)), ITEM);
});

test("a fitted-module drag survives encode and decode", () => {
  assert.deepEqual(decodeDrag(encodeDrag(FITTED)), FITTED);
});

test("every kind of source container survives the trip", () => {
  for (const from of [
    HANGAR,
    CARGO,
    ORE_BAY,
    { kind: "container", itemID: 42 } as InventoryPlace,
    { kind: "corp", division: 3 } as InventoryPlace,
  ]) {
    const payload: DragPayload = { kind: "inventoryItem", itemID: 5, typeID: 6, from };
    assert.deepEqual(decodeDrag(encodeDrag(payload)), payload, `${from.kind} did not survive`);
  }
});

// --- and refuses everything else ---------------------------------------------

test("a hostile or foreign string decodes to null rather than throwing", () => {
  // ⚠ A drag can start in another tab, another application, or as a file. A
  // throw inside a drop handler leaves the page stuck mid-drag with no way out.
  for (const raw of [
    null,
    undefined,
    "",
    "not json at all",
    "{",
    "[]",
    "null",
    '"a string"',
    "42",
    JSON.stringify({ kind: "inventoryItem" }),
    JSON.stringify({ kind: "somethingElse", itemID: 1, typeID: 2 }),
    JSON.stringify({ kind: "inventoryItem", itemID: "not a number", typeID: 2, from: HANGAR }),
    JSON.stringify({ kind: "inventoryItem", itemID: 1, typeID: 2, from: { kind: "nowhere" } }),
    JSON.stringify({ kind: "inventoryItem", itemID: 1, typeID: 2 }),
  ]) {
    assert.equal(decodeDrag(raw as string), null, `${String(raw)} should not decode`);
  }
});

test("a malformed shipBay or container source is refused, not half-read", () => {
  assert.equal(
    decodeDrag(JSON.stringify({ kind: "inventoryItem", itemID: 1, typeID: 2, from: { kind: "shipBay" } })),
    null,
    "a bay with no name is not a place",
  );
  assert.equal(
    decodeDrag(JSON.stringify({ kind: "inventoryItem", itemID: 1, typeID: 2, from: { kind: "container" } })),
    null,
    "a container with no id is not a place",
  );
});

// --- what a dragover can see -------------------------------------------------

test("a target can recognise our payload from the types alone", () => {
  // During dragover the CONTENTS are unreadable; only the types are exposed.
  assert.equal(carriesOurPayload([DRAG_MIME, "text/plain"]), true);
});

test("a dragged file or text selection is not ours", () => {
  assert.equal(carriesOurPayload(["Files"]), false);
  assert.equal(carriesOurPayload(["text/plain"]), false);
  assert.equal(carriesOurPayload([]), false);
  assert.equal(carriesOurPayload(undefined), false);
});

// --- dropping on a fitting socket --------------------------------------------

test("an item from a hangar may be fitted", () => {
  assert.equal(dropOnSocketVerdict(ITEM), null);
});

test("an item from the cargo hold may be fitted", () => {
  assert.equal(
    dropOnSocketVerdict({ ...ITEM, from: CARGO } as DragPayload),
    null,
  );
});

test("an ALREADY-FITTED module is refused with a reason, not silently ignored", () => {
  // The fitting flow only accepts a source of hangar or cargo, so a socket
  // cannot honestly take a module that is already on the ship.
  const verdict = dropOnSocketVerdict(FITTED);
  assert.notEqual(verdict, null);
  assert.match(verdict!, /take it off the ship first/i);
});

test("something that is not ours is refused rather than accepted", () => {
  assert.notEqual(dropOnSocketVerdict(null), null);
});

// --- dropping on a container -------------------------------------------------

test("moving an item to a DIFFERENT container is allowed", () => {
  assert.equal(dropOnPlaceVerdict(ITEM, CARGO), null);
  assert.equal(dropOnPlaceVerdict(ITEM, ORE_BAY), null);
});

test("dropping an item back where it came from is refused, WITH a reason", () => {
  // Not an error — nothing to do. Saying so keeps the cursor honest rather than
  // inviting a drop that would be a no-op.
  const verdict = dropOnPlaceVerdict(ITEM, HANGAR);
  assert.notEqual(verdict, null);
  assert.match(verdict!, /already there/i);
});

test("same-place is judged by the container's identity, not just its kind", () => {
  const fromThree: DragPayload = { ...ITEM, from: { kind: "corp", division: 3 } };
  assert.equal(dropOnPlaceVerdict(fromThree, { kind: "corp", division: 3 }), "It is already there.");
  assert.equal(dropOnPlaceVerdict(fromThree, { kind: "corp", division: 4 }), null);
});

test("a fitted module dropped on the hangar is an unfit, and is allowed", () => {
  assert.equal(dropOnPlaceVerdict(FITTED, HANGAR), null);
});

test("a fitted module dropped anywhere ELSE says where modules actually go", () => {
  // Unfitting always lands in the hangar in this client, so offering it on a
  // cargo hold would promise something different from what happens.
  for (const to of [CARGO, ORE_BAY, { kind: "corp", division: 1 } as InventoryPlace]) {
    const verdict = dropOnPlaceVerdict(FITTED, to);
    assert.notEqual(verdict, null, `${to.kind} must refuse`);
    assert.match(verdict!, /into your hangar/i);
  }
});

// --- samePlace ---------------------------------------------------------------

test("samePlace distinguishes every container kind", () => {
  assert.equal(samePlace(HANGAR, HANGAR), true);
  assert.equal(samePlace(HANGAR, CARGO), false);
  assert.equal(samePlace(ORE_BAY, { kind: "shipBay", bay: "ore" }), true);
  assert.equal(samePlace(ORE_BAY, { kind: "shipBay", bay: "drone" }), false);
  assert.equal(samePlace({ kind: "container", itemID: 1 }, { kind: "container", itemID: 1 }), true);
  assert.equal(samePlace({ kind: "container", itemID: 1 }, { kind: "container", itemID: 2 }), false);
});
