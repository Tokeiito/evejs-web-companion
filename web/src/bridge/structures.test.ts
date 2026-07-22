// R63 — decoder tests for the structureDirectory session/access-scoped reads.
// Fixtures are bytes captured LIVE from Farmer (char 140000005, corp 98000001) on
// 2026-07-22 through GET /api/bridge/structures, trimmed but shape-faithful. The
// two skipped reads (GetStructures / GetMyCharacterStructures) have no decoder.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorporationStructures,
  decodeIDList,
  decodeStructureMapData,
  decodeStructureDescription,
  decodeCynoBeacons,
  decodeValidWarHQs,
  decodeJumpBridgesWithMyAccess,
} from "./structures.ts";
import type { JsonValue } from "./wire.ts";

// --- real captured bytes ----------------------------------------------------

// GetMyCorporationStructures / GetCorporationStructures: dict[structureID -> KeyVal].
// The session corp's OWN structure (ownerID 98000001) — operational fields are the
// corp's own, role-gated. Captured verbatim (services trimmed to 3 entries).
const CORP_STRUCTURES: JsonValue = {
  type: "dict",
  entries: [
    [
      1030000000001,
      {
        type: "object",
        name: "util.KeyVal",
        args: {
          type: "dict",
          entries: [
            ["itemID", 1030000000001],
            ["structureID", 1030000000001],
            ["itemName", "Perimeter - asdf"],
            ["solarSystemID", 30000144],
            ["locationID", 30000144],
            ["ownerID", 98000001],
            ["allianceID", null],
            ["typeID", 35832],
            ["groupID", 1657],
            ["categoryID", 65],
            ["x", 800382013408.2244],
            ["y", 54164076845.46208],
            ["z", 1112590660754.3835],
            ["inSpace", true],
            ["profileID", 2],
            ["services", { type: "dict", entries: [[1, 1], [4, 2], [11, 2]] }],
            ["fuelExpires", null],
            ["upkeepState", 1],
            ["state", 110],
            ["timerEnd", null],
            ["reinforce_weekday", 255],
            ["reinforce_hour", 20],
            ["next_reinforce_weekday", null],
            ["next_reinforce_hour", null],
            ["next_reinforce_apply", null],
            ["unanchoring", null],
            ["liquidOzoneQty", 0],
            ["wars", { type: "list", items: [] }],
          ],
        },
      },
    ],
  ],
};

// GetMyDockableStructures -> a bare id list (the corp structure, in the current system).
const DOCKABLE_IDS: JsonValue = { type: "list", items: [1030000000001] };

// CheckMyDockingAccessToStructures([1030000000001, 1030000000000, 1234]) — Farmer
// can dock at both real structures; the nonexistent 1234 was filtered server-side.
const DOCKING_ACCESS: JsonValue = { type: "list", items: [1030000000000, 1030000000001] };

// GetStructureMapData -> CachedMethodCallResult wrapping a CRowset (objectex2). The
// single row is the corp structure; itemID is the structureID, locationID the
// solarSystemID, orbitID the ownerID. NO fuel/reinforce column exists.
const STRUCTURE_MAP_DATA: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "5 minutes" }]] },
    {
      type: "substream",
      value: {
        type: "objectex2",
        header: [[{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }], { type: "dict", entries: [] }],
        list: [
          {
            type: "packedrow",
            columns: [
              ["groupID", 3], ["typeID", 3], ["itemID", 20], ["itemName", 130],
              ["locationID", 3], ["orbitID", 3], ["connector", 11],
              ["x", 5], ["y", 5], ["z", 5], ["celestialIndex", 3], ["orbitIndex", 3],
            ],
            fields: {
              groupID: 1657,
              typeID: 35832,
              itemID: 1030000000001,
              itemName: { type: "wstring", value: "Perimeter - asdf" },
              locationID: 30000144,
              orbitID: 98000001,
              connector: false,
              x: 800382013408.2244,
              y: 54164076845.46208,
              z: 1112590660754.3835,
              celestialIndex: null,
              orbitIndex: null,
            },
          },
        ],
        dict: [],
      },
    },
  ],
};

// GetValidWarHQs(98000001) -> a list of war-HQ KeyVals (access-gated to own corp).
const VALID_WAR_HQS: JsonValue = {
  type: "list",
  items: [
    {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["typeID", 35832],
          ["structureID", 1030000000001],
          ["upkeepState", 1],
          ["wars", { type: "list", items: [] }],
          ["ownerID", 98000001],
          ["solarSystemID", 30000144],
          ["itemName", "Perimeter - asdf"],
          ["inSpace", 1],
        ],
      },
    },
  ],
};

const EMPTY_LIST: JsonValue = { type: "list", items: [] };
// GetJumpBridgesWithMyAccess -> a bare 3-element ARRAY, all empty live.
const JUMP_BRIDGES_EMPTY: JsonValue = [EMPTY_LIST, EMPTY_LIST, EMPTY_LIST];

// --- GetMyCorporationStructures / GetCorporationStructures -------------------

test("decodeCorporationStructures decodes the session corp's own structure from real bytes", () => {
  const rows = decodeCorporationStructures(CORP_STRUCTURES);
  assert.equal(rows.length, 1);
  const s = rows[0]!;
  assert.equal(s.structureID, 1030000000001);
  assert.equal(s.itemName, "Perimeter - asdf");
  assert.equal(s.solarSystemID, 30000144);
  assert.equal(s.ownerID, 98000001);
  assert.equal(s.allianceID, null);
  assert.equal(s.typeID, 35832);
  assert.equal(s.groupID, 1657);
  assert.equal(s.categoryID, 65);
  assert.equal(s.inSpace, true);
  assert.equal(s.profileID, 2);
  assert.equal(s.upkeepState, 1);
  assert.equal(s.state, 110);
  assert.equal(s.reinforceWeekday, 255);
  assert.equal(s.reinforceHour, 20);
  assert.equal(s.liquidOzoneQty, 0);
  assert.equal(s.warsCount, 0);
  // position is a float triple, kept as-is (not an id)
  assert.equal(s.x, 800382013408.2244);
  // services -> [{serviceID, value}], sorted from the dict
  assert.deepEqual(s.services, [
    { serviceID: 1, value: 1 },
    { serviceID: 4, value: 2 },
    { serviceID: 11, value: 2 },
  ]);
});

test("decodeCorporationStructures keeps the structureID exact (> 2^32) — R7d id survives", () => {
  const rows = decodeCorporationStructures(CORP_STRUCTURES);
  const first = rows[0]!;
  // 1030000000001 > 2^32 (4294967296); it must not be truncated to a 32-bit int.
  assert.ok(first.structureID > 4294967296);
  assert.equal(first.structureID, 1030000000001);
});

test("decodeCorporationStructures reads FILETIME fields bigint-safe (null live, exact when present)", () => {
  const live = decodeCorporationStructures(CORP_STRUCTURES)[0]!;
  // All FILETIMEs are null in the live capture — a real "not set" state.
  assert.equal(live.fuelExpires, null);
  assert.equal(live.timerEnd, null);
  assert.equal(live.nextReinforceApply, null);
  assert.equal(live.unanchoring, null);
  // With a real {type:"long"} FILETIME > 2^53, it must survive as an exact bigint
  // (never through Number). Perturb one entry's fuelExpires.
  const withLong = JSON.parse(JSON.stringify(CORP_STRUCTURES)) as {
    entries: [number, { args: { entries: [string, JsonValue][] } }][];
  };
  const kvEntries = withLong.entries[0]![1].args.entries;
  const fuel = kvEntries.find((e) => e[0] === "fuelExpires");
  (fuel as [string, JsonValue])[1] = { type: "long", value: "133900000000000001" };
  const decoded = decodeCorporationStructures(withLong as unknown as JsonValue)[0]!;
  assert.equal(decoded.fuelExpires, 133900000000000001n);
});

test("decodeCorporationStructures returns [] for an empty dict (no structures / role-denied is a route error)", () => {
  assert.deepEqual(decodeCorporationStructures({ type: "dict", entries: [] }), []);
  assert.deepEqual(decodeCorporationStructures(null), []);
});

// --- id lists ---------------------------------------------------------------

test("decodeIDList decodes dockable structures, docking access, and empty beacons", () => {
  assert.deepEqual(decodeIDList(DOCKABLE_IDS), [1030000000001]);
  assert.deepEqual(decodeIDList(DOCKING_ACCESS), [1030000000000, 1030000000001]);
  assert.deepEqual(decodeIDList(EMPTY_LIST), []);
  assert.deepEqual(decodeIDList(null), []);
});

test("decodeIDList keeps large structure ids exact (R7d) and drops non-positive", () => {
  const ids = decodeIDList({ type: "list", items: [1030000000000, 0, -5, 1030000000001] });
  assert.deepEqual(ids, [1030000000000, 1030000000001]);
  assert.ok(ids.every((id) => id > 4294967296));
});

// --- GetStructureMapData ----------------------------------------------------

test("decodeStructureMapData unwraps the cache result + CRowset; no operational fields", () => {
  const rows = decodeStructureMapData(STRUCTURE_MAP_DATA);
  assert.equal(rows.length, 1);
  const m = rows[0]!;
  // itemID is the structureID, locationID the solarSystemID, orbitID the ownerID.
  assert.equal(m.structureID, 1030000000001);
  assert.equal(m.solarSystemID, 30000144);
  assert.equal(m.ownerID, 98000001);
  assert.equal(m.typeID, 35832);
  assert.equal(m.groupID, 1657);
  assert.equal(m.itemName, "Perimeter - asdf"); // wstring unwrapped
  assert.equal(m.connector, false);
  assert.equal(m.x, 800382013408.2244);
  // The map shape carries NO operational fields — prove none leaked in.
  assert.equal(Object.prototype.hasOwnProperty.call(m, "fuelExpires"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(m, "reinforceWeekday"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(m, "state"), false);
});

test("decodeStructureMapData returns [] for an empty / non-cached value", () => {
  assert.deepEqual(decodeStructureMapData(null), []);
  assert.deepEqual(decodeStructureMapData({ type: "list", items: [] }), []);
});

// --- GetStructureDescription ------------------------------------------------

test("decodeStructureDescription reads the plain string; '' for empty/absent", () => {
  assert.equal(decodeStructureDescription(""), ""); // captured live
  assert.equal(decodeStructureDescription("A tower on the edge."), "A tower on the edge.");
  assert.equal(decodeStructureDescription(null), "");
  assert.equal(decodeStructureDescription({ type: "list", items: [] }), "");
});

// --- GetMyAccessibleOnlineCynoBeaconStructures ------------------------------

test("decodeCynoBeacons decodes positional entries; [] for the empty live capture", () => {
  // Live: Farmer has access to none.
  assert.deepEqual(decodeCynoBeacons(EMPTY_LIST), []);
  // Populated fixture — buildCynoBeaconEntry field order:
  // [structureID, typeID, ownerID, solarSystemID, state, itemName].
  const populated: JsonValue = {
    type: "list",
    items: [
      { type: "list", items: [1030000000005, 35840, 98000001, 30000142, 1, "Beacon Alpha"] },
    ],
  };
  assert.deepEqual(decodeCynoBeacons(populated), [
    {
      structureID: 1030000000005,
      typeID: 35840,
      ownerID: 98000001,
      solarSystemID: 30000142,
      state: 1,
      itemName: "Beacon Alpha",
    },
  ]);
});

// --- GetValidWarHQs ---------------------------------------------------------

test("decodeValidWarHQs decodes the access-gated HQ from real bytes (no fuel/reinforce)", () => {
  const hqs = decodeValidWarHQs(VALID_WAR_HQS);
  assert.equal(hqs.length, 1);
  const hq = hqs[0]!;
  assert.equal(hq.structureID, 1030000000001);
  assert.equal(hq.typeID, 35832);
  assert.equal(hq.ownerID, 98000001);
  assert.equal(hq.solarSystemID, 30000144);
  assert.equal(hq.itemName, "Perimeter - asdf");
  assert.equal(hq.upkeepState, 1);
  assert.equal(hq.inSpace, true);
  assert.equal(hq.warsCount, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(hq, "fuelExpires"), false);
});

test("decodeValidWarHQs returns [] for the empty (not-my-owner / none) state", () => {
  assert.deepEqual(decodeValidWarHQs(EMPTY_LIST), []);
  assert.deepEqual(decodeValidWarHQs(null), []);
});

// --- GetJumpBridgesWithMyAccess ---------------------------------------------

test("decodeJumpBridgesWithMyAccess splits the 3-tuple; all empty for the live capture", () => {
  const decoded = decodeJumpBridgesWithMyAccess(JUMP_BRIDGES_EMPTY);
  assert.deepEqual(decoded, { pairs: [], hasAccess: [], hasNoAccess: [] });
});

test("decodeJumpBridgesWithMyAccess decodes a bridge pair + access split (builder-shaped fixture)", () => {
  const end = (structureID: number, dest: number): JsonValue => ({
    type: "object",
    name: "util.KeyVal",
    args: {
      type: "dict",
      entries: [
        ["structureID", structureID],
        ["itemID", structureID],
        ["typeID", 35841],
        ["solarSystemID", 30000142],
        ["ownerID", 98000001],
        ["allianceID", null],
        ["itemName", `Ansiblex ${structureID}`],
        ["destinationSolarsystemID", dest],
      ],
    },
  });
  const raw: JsonValue = [
    { type: "list", items: [{ type: "list", items: [end(1030000000010, 30000144), end(1030000000011, 30000142)] }] },
    { type: "list", items: [1030000000010] },
    { type: "list", items: [1030000000011] },
  ];
  const decoded = decodeJumpBridgesWithMyAccess(raw);
  assert.equal(decoded.pairs.length, 1);
  const pair = decoded.pairs[0]!;
  assert.equal(pair.source?.structureID, 1030000000010);
  assert.equal(pair.source?.destinationSolarSystemID, 30000144);
  assert.equal(pair.destination?.structureID, 1030000000011);
  assert.equal(pair.source?.itemName, "Ansiblex 1030000000010");
  assert.deepEqual(decoded.hasAccess, [1030000000010]);
  assert.deepEqual(decoded.hasNoAccess, [1030000000011]);
});

// --- matcher-proof companion ------------------------------------------------
// Proves the "no operational fields" assertions in the map/warHQ tests actually
// inspect the decoded object: a decoder that DID surface an operational key would
// make hasOwnProperty return true, failing those tests. Here we assert the inverse
// directly against a hand-built object so the matcher itself is proven honest.
test("the 'no operational fields' matcher would catch a leaked key", () => {
  const withLeak = { structureID: 1, state: 102 } as Record<string, unknown>;
  const withoutLeak = { structureID: 1 } as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(withLeak, "state"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(withoutLeak, "state"), false);
});
