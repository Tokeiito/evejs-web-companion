// R71 — decoding planetMgr's two PI reads, against REAL CAPTURED BYTES.
//
// The colonies CRowset (one row) and the empty launches CRowset are verbatim from a
// live read against the running emulator (rrfarmer → Farmer 140000005) on 2026-07-22.
// The POPULATED launches fixture is synthesized from the server's buildDbRowset CRowset
// encoding (Farmer has no launches to capture) — the same objectex2/positional-packedrow
// shape the live colonies row proves.

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import { decodePlanetColonies, decodeLaunchDetails } from "./piColonies.ts";

// --- Real bytes -------------------------------------------------------------

const COLONY_DESCRIPTOR = {
  type: "objectex1",
  header: [
    { type: "token", value: "blue.DBRowDescriptor" },
    [
      [
        ["solarSystemID", 3],
        ["planetID", 3],
        ["typeID", 3],
        ["numberOfPins", 3],
        ["celestialIndex", 3],
      ],
    ],
  ],
  list: [],
  dict: [],
} as const;

/** GET /api/bridge/pi-colonies → `colonies`, verbatim: Farmer's ONE colony. */
const LIVE_COLONIES: JsonValue = {
  type: "objectex2",
  header: [
    [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
    { type: "dict", entries: [["header", COLONY_DESCRIPTOR]] },
  ],
  list: [
    {
      type: "packedrow",
      header: COLONY_DESCRIPTOR,
      columns: [
        ["solarSystemID", 3],
        ["planetID", 3],
        ["typeID", 3],
        ["numberOfPins", 3],
        ["celestialIndex", 3],
      ],
      values: [30000142, 40009077, 2016, 4, 1],
    },
  ],
  dict: [],
};

const LAUNCH_COLUMNS = [
  ["launchID", 3],
  ["solarSystemID", 3],
  ["itemID", 20],
  ["ownerID", 3],
  ["planetID", 3],
  ["status", 17],
  ["launchTime", 64],
  ["x", 5],
  ["y", 5],
  ["z", 5],
] as const;

const LAUNCH_DESCRIPTOR = {
  type: "objectex1",
  header: [{ type: "token", value: "blue.DBRowDescriptor" }, [LAUNCH_COLUMNS]],
  list: [],
  dict: [],
} as const;

/** GET /api/bridge/pi-colonies → `launches`, verbatim: Farmer's EMPTY launches CRowset. */
const LIVE_LAUNCHES_EMPTY: JsonValue = {
  type: "objectex2",
  header: [
    [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
    { type: "dict", entries: [["header", LAUNCH_DESCRIPTOR]] },
  ],
  list: [],
  dict: [],
};

/**
 * A POPULATED launches CRowset, synthesized from buildDbRowset's positional-packedrow
 * encoding: launchTime crosses the wire as a bare decimal string (a BigInt FILETIME),
 * itemID as a plain number.
 */
const SYNTH_LAUNCHES: JsonValue = {
  type: "objectex2",
  header: [
    [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
    { type: "dict", entries: [["header", LAUNCH_DESCRIPTOR]] },
  ],
  list: [
    {
      type: "packedrow",
      header: LAUNCH_DESCRIPTOR,
      columns: LAUNCH_COLUMNS,
      values: [500002, 30000142, 1028000000002, 140000005, 40009077, 1, "134292142874570000", 1.5, -2.5, 3.5],
      // deliberately out of order vs the row below to prove the decoder sorts.
    },
    {
      type: "packedrow",
      header: LAUNCH_DESCRIPTOR,
      columns: LAUNCH_COLUMNS,
      values: [500001, 30000142, 1028000000001, 140000005, 40009077, 3, "134292142874570000", 0, 0, 0],
    },
  ],
  dict: [],
};

// --- decodePlanetColonies ---------------------------------------------------

test("decodePlanetColonies reads Farmer's live colony row", () => {
  const colonies = decodePlanetColonies(LIVE_COLONIES);
  assert.equal(colonies.length, 1);
  assert.deepEqual(colonies[0], {
    solarSystemID: 30000142,
    planetID: 40009077,
    typeID: 2016,
    numberOfPins: 4,
    celestialIndex: 1,
  });
});

test("decodePlanetColonies returns [] for an empty CRowset and for non-CRowset input", () => {
  const emptyColonies: JsonValue = {
    type: "objectex2",
    header: [
      [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
      { type: "dict", entries: [["header", COLONY_DESCRIPTOR]] },
    ],
    list: [],
    dict: [],
  };
  assert.deepEqual(decodePlanetColonies(emptyColonies), []);
  assert.deepEqual(decodePlanetColonies(null), []);
  // ⚠ rows live on `list`, NOT `items`: an items-only object must decode to nothing.
  assert.deepEqual(decodePlanetColonies({ type: "list", items: [1, 2] } as JsonValue), []);
});

// --- decodeLaunchDetails ----------------------------------------------------

test("decodeLaunchDetails returns [] for Farmer's live empty launches", () => {
  assert.deepEqual(decodeLaunchDetails(LIVE_LAUNCHES_EMPTY), []);
});

test("decodeLaunchDetails decodes populated rows, sorts by launchID, keeps launchTime bigint", () => {
  const launches = decodeLaunchDetails(SYNTH_LAUNCHES);
  assert.equal(launches.length, 2);
  // sorted: 500001 first.
  assert.equal(launches[0]!.launchID, 500001);
  assert.equal(launches[1]!.launchID, 500002);
  assert.deepEqual(launches[1], {
    launchID: 500002,
    solarSystemID: 30000142,
    itemID: 1028000000002,
    ownerID: 140000005,
    planetID: 40009077,
    status: 1,
    launchTime: 134292142874570000n,
    x: 1.5,
    y: -2.5,
    z: 3.5,
  });
  assert.equal(typeof launches[0]!.launchTime, "bigint");
});
