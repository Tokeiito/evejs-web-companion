// The R40 ship-bay decoder, against REAL captured bytes.
//
// Every fixture below is the literal body of `GET /api/bridge/ship/:shipID/bays`
// as the running BFF answered it on 2026-07-21 — Test Two's Badger (one bay)
// and Farmer's Procurer (three bays, ore aboard) — trimmed to the bays under
// test and otherwise untouched, including the `quantity: -1` that an assembled
// drone really does arrive with.
//
// WHAT THIS SUITE IS FOR. The decoder's one job is to keep three states apart:
//
//   the hull HAS this bay          present === true
//   the hull does NOT have it      present === false
//   we could not tell              present === null
//
// and, orthogonally, `items === []` (we looked, it is empty) from `items ===
// null` (we did not manage to look). Every other decoder concern is secondary
// to that, because collapsing any pair of these puts a confident lie on screen:
// a 16,000 m³ ore hold reported as absent, or a hull with no drone bay reported
// as having an empty one.

import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeShipBays,
  presentBays,
  unreadableBays,
} from "./shipBays.ts";
import type { JsonValue } from "./wire.ts";

// --- real captured bytes ----------------------------------------------------

/** Farmer's Procurer: cargo hold (empty), drone bay (6 stacks), ore hold. */
const PROCURER_BAYS = [
  { key: "cargo", label: "Cargo hold", present: true, capacity: { capacity: 350, used: 0 }, items: [], error: null },
  {
    key: "drone",
    label: "Drone bay",
    present: true,
    capacity: { capacity: 100, used: 50 },
    items: [
      { itemID: 9988400023316, typeID: 2488, groupID: 100, categoryID: 18, quantity: 5, singleton: false },
      { itemID: 9988400037367, typeID: 2488, groupID: 100, categoryID: 18, quantity: -1, singleton: true },
    ],
    error: null,
  },
  {
    key: "ore",
    label: "Ore hold",
    present: true,
    capacity: { capacity: 16000, used: 12375.2 },
    items: [
      { itemID: 9988400092033, typeID: 1230, groupID: 462, categoryID: 25, quantity: 123752, singleton: false },
    ],
    error: null,
  },
  // Absent, exactly as the server reports it: a real zero capacity, no items.
  { key: "shipMaintenance", label: "Ship maintenance bay", present: false, capacity: { capacity: 0, used: 0 }, items: null, error: null },
  { key: "fleet", label: "Fleet hangar", present: false, capacity: { capacity: 0, used: 0 }, items: null, error: null },
] as unknown as JsonValue;

/** Test Two's Badger: a cargo hold and nothing else. */
const BADGER_BAYS = [
  { key: "cargo", label: "Cargo hold", present: true, capacity: { capacity: 4095, used: 0 }, items: [], error: null },
  { key: "drone", label: "Drone bay", present: false, capacity: { capacity: 0, used: 0 }, items: null, error: null },
  { key: "ore", label: "Ore hold", present: false, capacity: { capacity: 0, used: 0 }, items: null, error: null },
] as unknown as JsonValue;

/**
 * A ship whose bays could not be read at all — the shape the route really
 * produced when asked about an itemID that is not a ship. Every bay comes back
 * unknown, NOT absent.
 */
const REFUSED_BAYS = [
  { key: "cargo", label: "Cargo hold", present: null, capacity: null, items: null, error: "CALL_REFUSED" },
  { key: "ore", label: "Ore hold", present: null, capacity: null, items: null, error: "CALL_REFUSED" },
] as unknown as JsonValue;

// --- the bay set ------------------------------------------------------------

test("a hull with only a cargo hold decodes to exactly one bay it HAS", () => {
  const bays = decodeShipBays(BADGER_BAYS);
  assert.equal(bays.length, 3, "every bay asked about is reported, present or not");

  const present = presentBays(bays);
  assert.equal(present.length, 1, "the Badger has exactly one bay");
  assert.equal(present[0]?.label, "Cargo hold");
  assert.equal(present[0]?.capacity?.capacity, 4095);
  assert.equal(present[0]?.capacity?.used, 0);
});

test("a hull with an ore hold decodes all three of its bays, with used/capacity", () => {
  const present = presentBays(decodeShipBays(PROCURER_BAYS));
  assert.deepEqual(
    present.map((bay) => bay.label),
    ["Cargo hold", "Drone bay", "Ore hold"],
  );
  const ore = present.find((bay) => bay.key === "ore");
  assert.equal(ore?.capacity?.capacity, 16000);
  assert.equal(ore?.capacity?.used, 12375.2, "a fractional used volume survives intact");
  assert.equal(ore?.items?.length, 1);
  assert.equal(ore?.items?.[0]?.typeID, 1230);
  assert.equal(ore?.items?.[0]?.quantity, 123752);
});

// --- ⚠ absent vs empty vs unknown -------------------------------------------

test("⚠ ABSENT, EMPTY and UNKNOWN are three different decodes", () => {
  const bays = decodeShipBays(PROCURER_BAYS);
  const byKey = new Map(bays.map((bay) => [bay.key, bay]));

  // Empty: the hull HAS a cargo hold, and we looked inside, and it is empty.
  assert.equal(byKey.get("cargo")?.present, true);
  assert.deepEqual(byKey.get("cargo")?.items, [], "[] is 'we looked, and it is empty'");

  // Absent: the hull does NOT have a ship maintenance bay.
  assert.equal(byKey.get("shipMaintenance")?.present, false);
  assert.equal(byKey.get("shipMaintenance")?.items, null, "an absent bay has no contents at all");

  // Unknown: a different read entirely, and it must not look like either.
  const refused = decodeShipBays(REFUSED_BAYS);
  assert.equal(refused[0]?.present, null, "a failed read is not 'absent'");
  assert.equal(refused[0]?.error, "CALL_REFUSED");

  // The three states are genuinely distinct values, not two.
  const states = new Set([
    byKey.get("cargo")?.present,
    byKey.get("shipMaintenance")?.present,
    refused[0]?.present,
  ]);
  assert.equal(states.size, 3, "true, false and null must all be reachable");
});

test("⚠ a MISSING `present` field decodes to unknown — never to absent", () => {
  // The dangerous default. If a payload ever omits `present`, reading it as
  // `false` would silently tell the player the hull lacks a bay that nobody
  // ever checked. Unknown is the only honest reading.
  const bays = decodeShipBays([
    { key: "ore", label: "Ore hold", capacity: null, items: null },
  ] as unknown as JsonValue);
  assert.equal(bays[0]?.present, null);
  assert.notEqual(bays[0]?.present, false, "absent is a claim; a missing field makes no claim");
});

test("⚠ a truthy-but-not-true `present` is not treated as present", () => {
  const bays = decodeShipBays([
    { key: "ore", label: "Ore hold", present: 1, capacity: null, items: null },
    { key: "gas", label: "Gas hold", present: "yes", capacity: null, items: null },
  ] as unknown as JsonValue);
  assert.equal(bays[0]?.present, null);
  assert.equal(bays[1]?.present, null);
});

test("unreadableBays names exactly the bays nobody managed to check", () => {
  assert.deepEqual(
    unreadableBays(decodeShipBays(REFUSED_BAYS)).map((bay) => bay.label),
    ["Cargo hold", "Ore hold"],
  );
  assert.deepEqual(
    unreadableBays(decodeShipBays(BADGER_BAYS)).map((bay) => bay.label),
    [],
    "a clean read leaves nothing unchecked",
  );
});

// --- rows -------------------------------------------------------------------

test("an assembled item decodes as ONE object, never as a quantity of -1", () => {
  const drone = presentBays(decodeShipBays(PROCURER_BAYS)).find((bay) => bay.key === "drone");
  const assembled = drone?.items?.find((row) => row.singleton);
  assert.ok(assembled, "the captured bay really does contain an assembled drone");
  assert.equal(assembled.quantity, 1, "-1 is a marker, not an amount");
  assert.equal(assembled.singleton, true);
  // And the loose stack beside it keeps its real count.
  assert.equal(drone?.items?.find((row) => !row.singleton)?.quantity, 5);
});

test("⚠ no bay row carries a flagID — the browser never learns which flag a bay is", () => {
  // ⚠ THE FIXTURE MUST CONTAIN A flagID FOR THIS TO ASSERT ANYTHING. The BFF
  // strips flagID before it sends, so sweeping the captured bytes alone proves
  // nothing — the field is not there to leak. This feeds the decoder the raw
  // flagID the BFF sees internally (134 = the ore hold) and demands it be
  // dropped, so the test fails the moment the decoder starts passing it
  // through. An earlier draft of this test swept the captured payload, passed
  // against a decoder that leaked, and was worthless.
  const bays = decodeShipBays([
    {
      key: "ore",
      label: "Ore hold",
      present: true,
      capacity: { capacity: 16000, used: 1 },
      items: [
        { itemID: 9988400092033, typeID: 1230, flagID: 134, quantity: 7, singleton: false },
      ],
    },
  ] as unknown as JsonValue);
  assert.equal(bays[0]?.items?.length, 1, "the row must survive — only its flagID is dropped");
  assert.equal(bays[0]?.items?.[0]?.flagID, null, "a flagID leaked to the browser");

  // And the captured bytes, for good measure.
  for (const bay of decodeShipBays(PROCURER_BAYS)) {
    for (const row of bay.items ?? []) {
      assert.equal(row.flagID, null, `${bay.label} leaked a flagID to the browser`);
    }
  }
});

test("bay IDs decode long-aware, and a row missing an ID is dropped", () => {
  const bays = decodeShipBays([
    {
      key: "ore",
      label: "Ore hold",
      present: true,
      capacity: { capacity: 16000, used: 1 },
      items: [
        { itemID: { type: "long", value: "9988400092033" }, typeID: 1230, quantity: 7 },
        { typeID: 1230, quantity: 9 },
      ],
    },
  ] as unknown as JsonValue);
  assert.equal(bays[0]?.items?.length, 1, "the unidentifiable row is dropped, not zeroed");
  assert.equal(bays[0]?.items?.[0]?.itemID, 9988400092033);
});

test("a capacity the ship did not report decodes to null, never to 0 / 0", () => {
  const bays = decodeShipBays([
    { key: "cargo", label: "Cargo hold", present: true, capacity: null, items: [] },
  ] as unknown as JsonValue);
  assert.equal(bays[0]?.capacity, null);
});

test("a bay with a real zero capacity keeps the zero — that is an answer", () => {
  const bays = decodeShipBays(BADGER_BAYS);
  const drone = bays.find((bay) => bay.key === "drone");
  assert.deepEqual(drone?.capacity, { capacity: 0, used: 0 });
  assert.equal(drone?.present, false, "and zero capacity is what makes it absent");
});

test("a malformed payload decodes to an empty list rather than throwing", () => {
  assert.deepEqual(decodeShipBays(undefined), []);
  assert.deepEqual(decodeShipBays(null as unknown as JsonValue), []);
  assert.deepEqual(decodeShipBays({ nope: true } as unknown as JsonValue), []);
  // A bay with no key has no identity and is dropped.
  assert.deepEqual(decodeShipBays([{ label: "Ore hold" }] as unknown as JsonValue), []);
});
