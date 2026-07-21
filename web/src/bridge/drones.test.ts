// R25 slice A: the drone decoders.
//
// The whole file is about ONE distinction: null means "we could not look", and
// an empty array means "there is nothing there". For every other panel in this
// client that difference is a nicety; for drones it decides whether a player
// launches a second flight on top of the one already flying, or believes their
// drones are idle when nobody actually asked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeDroneBay,
  decodeDroneLimits,
  decodeDronesInSpace,
  droneActivityLabel,
  droneIsBusy,
} from "./drones.ts";
import type { JsonValue } from "./wire.ts";

/**
 * A dogmaIM.ShipGetInfo result carrying an attribute map, in the exact shape
 * the wire has it — a dict whose first entry holds a util.KeyVal whose
 * "attributes" key is the attributeID -> value dict. Deliberately built here
 * rather than hand-waved, because this is the shape the FITTING panel's decoder
 * already reads and R25 reuses it byte for byte instead of adding a call.
 */
function shipInfo(entries: readonly (readonly [number, number])[]): JsonValue {
  return {
    type: "dict",
    entries: [
      [
        "shipInfo",
        {
          args: {
            entries: [
              ["attributes", { type: "dict", entries: entries.map((pair) => [...pair]) }],
            ],
          },
        },
      ],
    ],
  } as unknown as JsonValue;
}

// --- The bay ----------------------------------------------------------------

test("an absent bay decodes to null, not an empty bay", () => {
  assert.equal(decodeDroneBay(undefined), null);
  assert.equal(decodeDroneBay(null), null);
  // ⚠ The two facts that must never collapse into one another.
  assert.deepEqual(decodeDroneBay([]), [], "an EMPTY array is a real, empty bay");
});

test("bay stacks decode itemID / typeID / quantity, long-wrapped or plain", () => {
  const bay = decodeDroneBay([
    { itemID: { type: "long", value: "7800001" }, typeID: 2456, quantity: 3 },
    { itemID: 7800002, typeID: 2486, quantity: 1 },
    // No usable identity — dropped rather than kept with a zero id.
    { typeID: 2456, quantity: 5 },
  ] as unknown as JsonValue);
  assert.deepEqual(bay, [
    { itemID: 7800001, typeID: 2456, quantity: 3 },
    { itemID: 7800002, typeID: 2486, quantity: 1 },
  ]);
});

// --- What is in space -------------------------------------------------------

test("an absent in-space list decodes to null — NEVER 'no drones out'", () => {
  assert.equal(decodeDronesInSpace(undefined), null);
  assert.equal(decodeDronesInSpace(null), null);
  assert.deepEqual(decodeDronesInSpace([]), []);
});

test("a drone's activity stays a WORD, and an unknown one stays null", () => {
  const drones = decodeDronesInSpace([
    { itemID: 9500001, typeID: 2456, name: "Hobgoblin I", activity: "fighting", targetID: 50002001 },
    // The gateway could not tell. This must NOT become "idle".
    { itemID: 9500002, typeID: 2456, name: "Hobgoblin I", activity: null, targetID: null },
    { itemID: 9500003, typeID: 2456, name: "Hobgoblin I", activity: "", targetID: null },
  ] as unknown as JsonValue);
  assert.equal(drones?.length, 3);
  assert.equal(drones?.[0]?.activity, "fighting");
  assert.equal(drones?.[0]?.targetID, 50002001);
  assert.equal(drones?.[1]?.activity, null);
  assert.equal(drones?.[2]?.activity, null, "an empty string is not an activity either");
});

test("health ratios clamp to 0-1 and an absent layer stays null", () => {
  const drones = decodeDronesInSpace([
    { itemID: 9500001, shieldRatio: 1.4, armorRatio: -0.2, hullRatio: 0.5 },
    { itemID: 9500002 },
  ] as unknown as JsonValue);
  assert.equal(drones?.length, 2);
  assert.equal(drones?.[0]?.shieldRatio, 1);
  assert.equal(drones?.[0]?.armorRatio, 0);
  assert.equal(drones?.[0]?.hullRatio, 0.5);
  assert.equal(drones?.[1]?.shieldRatio, null);
});

// --- The limits -------------------------------------------------------------

test("the launch limits come out of the ship's ORDINARY attribute map", () => {
  // ⚠ No new server call: 352 (maxActiveDrones) and 1271 (droneBandwidth) ride
  // back in dogmaIM.ShipGetInfo, allowlisted since the fitting panel.
  const limits = decodeDroneLimits(shipInfo([[352, 5], [1271, 50]]));
  assert.deepEqual(limits, { maxActiveDrones: 5, droneBandwidth: 50 });
});

test("a hull with no drone dogma reports UNKNOWN, not zero", () => {
  // A confident 0 reads as "this ship may carry no drones", which is
  // indistinguishable from a read that simply did not answer.
  assert.deepEqual(decodeDroneLimits(shipInfo([[263, 300]])), {
    maxActiveDrones: null,
    droneBandwidth: null,
  });
  assert.deepEqual(decodeDroneLimits(undefined), {
    maxActiveDrones: null,
    droneBandwidth: null,
  });
  assert.deepEqual(decodeDroneLimits(null), {
    maxActiveDrones: null,
    droneBandwidth: null,
  });
});

// --- Player-facing wording (R9a) --------------------------------------------

test("every activity has plain player wording, and unknown says Unknown", () => {
  assert.equal(droneActivityLabel("idle"), "Waiting");
  assert.equal(droneActivityLabel("fighting"), "Attacking");
  assert.equal(droneActivityLabel("mining"), "Mining");
  assert.equal(droneActivityLabel("approaching"), "Closing in");
  assert.equal(droneActivityLabel("returning"), "Coming home");
  assert.equal(droneActivityLabel("chasing"), "Chasing");
  assert.equal(droneActivityLabel("salvaging"), "Salvaging");
  // ⚠ NOT "Waiting". A player told their drones are idle when nobody looked
  // will not launch the ones that would have saved them.
  assert.equal(droneActivityLabel(null), "Unknown");
  assert.equal(droneActivityLabel("something-new"), "Unknown");
});

test("nothing in the wording is a raw enum or an id", () => {
  for (const activity of [
    "idle",
    "fighting",
    "mining",
    "approaching",
    "returning",
    "chasing",
    "salvaging",
    null,
  ]) {
    const label = droneActivityLabel(activity);
    assert.doesNotMatch(label, /\d/, `"${label}" must contain no number (R7d)`);
  }
});

test("an unknown activity sorts with the drones you might give a job to", () => {
  assert.equal(droneIsBusy("fighting"), true);
  assert.equal(droneIsBusy("mining"), true);
  assert.equal(droneIsBusy("approaching"), true);
  assert.equal(droneIsBusy("idle"), false);
  assert.equal(droneIsBusy(null), false);
});
