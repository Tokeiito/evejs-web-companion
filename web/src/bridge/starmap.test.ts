// Map / starmap reads decoder (goal R68) against REAL captured bytes.
//
// Every EMPTY-path and NON-empty fixture below is the wire shape captured LIVE from
// Farmer (char 140000005, system 30000144, corp 98000001) through the generic
// /api/bridge/call on 2026-07-22 — NOT a hand-guess. The `rowset`/`cachedRowset`/
// `dict`/`keyval` helpers reproduce exactly what eve.js's serviceHelpers emit
// (buildRowset bare-array lines; buildCachedMethodCallResult's [details, substream,
// version] args). The few POPULATED sov/incursion/fac-war fixtures (which this
// seeded world does not produce) mirror the server's own payload builders
// (sovPayloads / incursionPayloads), descriptor and all.
//
// Ownership evidence baked into the visit fixture: these 13 rows are FARMER's own;
// a second live session returned a DIFFERENT 2-row set, proving session scope.
// R7d: every id survives as a numeric field; FILETIMEs are bigint-safe.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeStationCounts,
  decodeSolarsystemItems,
  decodeMapHistory,
  decodeSolarSystemVisits,
  decodeBeaconCounts,
  decodeCurrentSovData,
  decodeRecentSovActivity,
  decodeFacWarZoneInfo,
  decodeDeadspaceMap,
  decodeMyExtraMapInfo,
  decodeMyExtraMapInfoAgents,
  decodeConstellationLPData,
  decodeRoamingWeatherSystems,
  decodeSecurityModifiedSystems,
  decodeIncursionGlobalReport,
  decodeSystemsInIncursions,
} from "./starmap.ts";
import type { JsonValue } from "./wire.ts";

// --- wire-shape helpers (exact serviceHelpers output) ----------------------

function list(items: JsonValue[]): JsonValue {
  return { type: "list", items };
}
function dict(entries: [JsonValue, JsonValue][]): JsonValue {
  return { type: "dict", entries };
}
function keyval(entries: [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function long(value: string): JsonValue {
  return { type: "long", value };
}
/** buildRowset: header + columns + RowClass + lines (bare-array lines here). */
function rowset(columns: string[], lines: JsonValue[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", list(columns)],
        ["columns", list(columns)],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", list(lines)],
      ],
    },
  };
}
/** buildCachedMethodCallResult (non-proxyCache): [details, substream, version]. */
function cachedRowset(inner: JsonValue): JsonValue {
  return {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      dict([[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "1 minute" }]]),
      { type: "substream", value: inner },
      [long("134000000000000000"), 12345],
    ],
  };
}

// --- GetStationCount (real: list of 8490 [systemID, count] pairs) -----------

test("decodeStationCounts reads the real [systemID, count] pair list, keeping zero-count systems", () => {
  const real: JsonValue = list([
    [30000001, 2],
    [30000002, 0],
    [30000003, 0],
    [30000004, 0],
  ]);
  const counts = decodeStationCounts(real);
  assert.equal(counts.length, 4);
  assert.deepEqual(counts[0], { solarSystemID: 30000001, stationCount: 2 });
  assert.deepEqual(counts[1], { solarSystemID: 30000002, stationCount: 0 });
});

test("decodeStationCounts drops malformed pairs and non-list input", () => {
  assert.deepEqual(decodeStationCounts(null), []);
  assert.deepEqual(decodeStationCounts(list([[0, 5], [30000001], 42 as unknown as JsonValue])), []);
});

// --- GetSolarsystemItems (real: 48 rows for system 30000144) ----------------

const SSI_COLUMNS = [
  "groupID", "typeID", "itemID", "itemName", "locationID", "orbitID",
  "connector", "x", "y", "z", "celestialIndex", "orbitIndex",
];
// Real captured lines: a star, a planet (celestialIndex 1), a station (group 15).
const SSI_STAR: JsonValue = [6, 3802, 40009228, "Perimeter - Star", 30000144, null, false, 0, 0, 0, null, null];
const SSI_PLANET: JsonValue = [7, 2016, 40009229, "Perimeter I", 30000144, 40009228, false, -73909993862, -5001585427, 28255275694, 1, null];
const SSI_STATION: JsonValue = [15, 1531, 60000358, "Perimeter VI - Ytiri Storage", 30000144, 40009238, false, -501695569920, -33948426240, 96983900160, null, null];
// A stargate would carry connector=true; the wire shape is identical (bare array).
const SSI_GATE: JsonValue = [10, 16, 50001234, "Stargate (Urlen)", 30000144, null, true, 1, 2, 3, null, null];

test("decodeSolarsystemItems reads the real star/planet/station rows with ids kept as data", () => {
  const items = decodeSolarsystemItems(rowset(SSI_COLUMNS, [SSI_STAR, SSI_PLANET, SSI_STATION]));
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    groupID: 6, typeID: 3802, itemID: 40009228, itemName: "Perimeter - Star",
    locationID: 30000144, orbitID: null, connector: false, x: 0, y: 0, z: 0,
    celestialIndex: null, orbitIndex: null,
  });
  // The planet keeps its celestialIndex (1) and orbit parent, positions intact.
  assert.equal(items[1]!.celestialIndex, 1);
  assert.equal(items[1]!.orbitID, 40009228);
  assert.equal(items[1]!.x, -73909993862);
  // The station's itemName survives; itemID kept numeric (not turned into a label).
  assert.equal(items[2]!.groupID, 15);
  assert.equal(items[2]!.itemName, "Perimeter VI - Ytiri Storage");
  assert.equal(items[2]!.itemID, 60000358);
});

test("decodeSolarsystemItems reads connector=true (a gate) and returns [] for an empty system", () => {
  const items = decodeSolarsystemItems(rowset(SSI_COLUMNS, [SSI_GATE]));
  assert.equal(items[0]!.connector, true);
  assert.deepEqual(decodeSolarsystemItems(rowset(SSI_COLUMNS, [])), []);
});

// --- GetHistory (real: cached-wrapped Rowset; jumps=8 rows, kills=0) --------

const HISTORY_COLUMNS = ["solarSystemID", "value1", "value2", "value3"];
const HISTORY_JUMP_LINES: JsonValue[] = [
  [30000142, 8, 0, 0], [30000144, 1, 0, 0], [30001363, 7, 0, 0], [30001368, 7, 0, 0],
  [30001389, 7, 0, 0], [30001399, 3, 0, 0], [30001400, 7, 0, 0], [30002780, 4, 0, 0],
];

test("decodeMapHistory unwraps the CachedMethodCallResult substream and reads the 8 real jump rows", () => {
  const rows = decodeMapHistory(cachedRowset(rowset(HISTORY_COLUMNS, HISTORY_JUMP_LINES)));
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], { solarSystemID: 30000142, value1: 8, value2: 0, value3: 0 });
  assert.equal(rows.at(-1)!.solarSystemID, 30002780);
});

test("decodeMapHistory returns [] for the real empty (kills) capture", () => {
  assert.deepEqual(decodeMapHistory(cachedRowset(rowset(HISTORY_COLUMNS, []))), []);
});

// --- GetSolarSystemVisits (real: 13 own rows, FILETIME lastDateTime) --------

const VISIT_COLUMNS = ["lastDateTime", "solarSystemID", "visits"];
const VISIT_LINES: JsonValue[] = [
  [long("134275993065910000"), 30000119, 1],
  [long("134290686382470000"), 30000139, 1],
  [long("134289254049370000"), 30000140, 3],
  [long("134291245440970000"), 30000142, 25],
];

test("decodeSolarSystemVisits reads own visits with a bigint FILETIME", () => {
  const visits = decodeSolarSystemVisits(rowset(VISIT_COLUMNS, VISIT_LINES));
  assert.equal(visits.length, 4);
  assert.equal(visits[0]!.solarSystemID, 30000119);
  assert.equal(visits[0]!.visits, 1);
  assert.equal(typeof visits[0]!.lastDateTime, "bigint");
  assert.equal(visits[0]!.lastDateTime, 134275993065910000n);
  assert.equal(visits[3]!.visits, 25);
});

test("decodeSolarSystemVisits returns [] for a real no-visits rowset", () => {
  assert.deepEqual(decodeSolarSystemVisits(rowset(VISIT_COLUMNS, [])), []);
});

// --- GetBeaconCount (real: empty dict) --------------------------------------

test("decodeBeaconCounts returns [] for the real empty dict and reads a populated one", () => {
  assert.deepEqual(decodeBeaconCounts(dict([])), []);
  const counts = decodeBeaconCounts(dict([[30000142, 3], [30000144, 1], [0, 9]]));
  assert.deepEqual(counts, [
    { solarSystemID: 30000142, count: 3 },
    { solarSystemID: 30000144, count: 1 },
  ]);
});

// --- GetCurrentSovData (real: empty; populated mirrors buildCurrentSovDataPayload) -

const SOV_COLUMNS = [
  "locationID", "solarSystemID", "constellationID", "regionID", "ownerID",
  "allianceID", "corporationID", "claimStructureID", "infrastructureHubID",
  "stationID", "claimTime",
];

test("decodeCurrentSovData returns [] in highsec (real empty) and reads a claim with bigint claimTime", () => {
  assert.deepEqual(decodeCurrentSovData(rowset(SOV_COLUMNS, [])), []);
  const row: JsonValue = [
    30004759, 30004759, 20000493, 10000060, 99000001, 99000001, 98000001,
    1000000000001, 1000000000002, null, long("133000000000000000"),
  ];
  const rows = decodeCurrentSovData(rowset(SOV_COLUMNS, [row]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.solarSystemID, 30004759);
  assert.equal(rows[0]!.allianceID, 99000001);
  assert.equal(rows[0]!.stationID, null);
  assert.equal(rows[0]!.claimTime, 133000000000000000n);
});

// --- GetRecentSovActivity (real: empty) -------------------------------------

const SOV_ACTIVITY_COLUMNS = ["solarSystemID", "ownerID", "oldOwnerID", "stationID", "changeTime"];

test("decodeRecentSovActivity returns [] (real empty) and reads a change with bigint changeTime", () => {
  assert.deepEqual(decodeRecentSovActivity(rowset(SOV_ACTIVITY_COLUMNS, [])), []);
  const rows = decodeRecentSovActivity(
    rowset(SOV_ACTIVITY_COLUMNS, [[30004759, 99000002, 99000001, null, long("133500000000000000")]]),
  );
  assert.equal(rows[0]!.ownerID, 99000002);
  assert.equal(rows[0]!.oldOwnerID, 99000001);
  assert.equal(rows[0]!.changeTime, 133500000000000000n);
});

// --- GetFacWarZoneInfo (real: KeyVal{factionID:500001, systemUpgradeLevel:{}}) --

test("decodeFacWarZoneInfo reads the real KeyVal (empty upgrade dict) and a populated one", () => {
  const real = keyval([
    ["factionID", 500001],
    ["systemUpgradeLevel", dict([])],
  ]);
  assert.deepEqual(decodeFacWarZoneInfo(real), { factionID: 500001, systemUpgradeLevel: [] });

  const populated = keyval([
    ["factionID", 500001],
    ["systemUpgradeLevel", dict([[30002813, 4], [30003504, 2]])],
  ]);
  const decoded = decodeFacWarZoneInfo(populated);
  assert.equal(decoded.factionID, 500001);
  assert.deepEqual(decoded.systemUpgradeLevel, [
    { solarSystemID: 30002813, level: 4 },
    { solarSystemID: 30003504, level: 2 },
  ]);
});

// --- GetDeadspaceAgentsMap / GetDeadspaceComplexMap (real: null) ------------

test("decodeDeadspaceMap returns [] for the real null overlays", () => {
  assert.deepEqual(decodeDeadspaceMap(null), []);
  assert.deepEqual(decodeDeadspaceMap(undefined), []);
});

// --- GetMyExtraMapInfo / GetMyExtraMapInfoAgents (real: empty rowsets) -------

test("decodeMyExtraMapInfo/Agents return [] for the real hardcoded-empty rowsets", () => {
  assert.deepEqual(decodeMyExtraMapInfo(rowset(["characterID", "locationID"], [])), []);
  assert.deepEqual(decodeMyExtraMapInfoAgents(rowset(["fromID", "rank"], [])), []);
});

test("decodeMyExtraMapInfo would keep ids as data if the server ever populated it", () => {
  const rows = decodeMyExtraMapInfo(rowset(["characterID", "locationID"], [[140000005, 60000358]]));
  assert.deepEqual(rows, [{ characterID: 140000005, locationID: 60000358 }]);
});

// --- GetConstellationLPData / GetAllRoamingWeatherSystems (real: empty) ------

test("decodeConstellationLPData returns [] (real empty) and reads a populated overlay", () => {
  assert.deepEqual(decodeConstellationLPData(rowset(["solarSystemID", "loyaltyPoints"], [])), []);
  const rows = decodeConstellationLPData(
    rowset(["solarSystemID", "loyaltyPoints"], [[30002813, 250], [0, 99]]),
  );
  assert.deepEqual(rows, [{ solarSystemID: 30002813, loyaltyPoints: 250 }]);
});

test("decodeRoamingWeatherSystems returns [] for the real empty rowset", () => {
  assert.deepEqual(decodeRoamingWeatherSystems(rowset(["locationID", "sceneType"], [])), []);
});

// --- GetSecurityModifiedSystems (real: empty rowset[solarSystemID]) ----------

test("decodeSecurityModifiedSystems returns [] (real empty) and a flat id list when populated", () => {
  assert.deepEqual(decodeSecurityModifiedSystems(rowset(["solarSystemID"], [])), []);
  const systems = decodeSecurityModifiedSystems(rowset(["solarSystemID"], [[30002813], [30000142], [0]]));
  assert.deepEqual(systems, [30002813, 30000142]);
});

// --- GetIncursionGlobalReport (real: []; populated mirrors buildIncursionReportEntry) -

test("decodeIncursionGlobalReport returns [] for the real empty world and reads a populated entry", () => {
  assert.deepEqual(decodeIncursionGlobalReport([] as unknown as JsonValue), []);
  assert.deepEqual(decodeIncursionGlobalReport(list([])), []);

  const entry = keyval([
    ["taleID", 12], ["templateClassID", 2], ["templateNameID", 34],
    ["stagingSolarSystemID", 30002813], ["aggressorFactionID", 500019],
    ["state", 2], ["influence", 0.75], ["hasFinalEncounter", false],
    ["effects", list([1, 2, 3])], ["rewardGroupID", 55],
    ["incursedSystems", list([30002813, 30002814])], ["severity", 4],
    ["hasChat", true], ["chatAnnouncementMessageId", 0], ["musicState", null],
  ]);
  const reports = decodeIncursionGlobalReport(list([entry]));
  assert.equal(reports.length, 1);
  assert.equal(reports[0]!.stagingSolarSystemID, 30002813);
  assert.equal(reports[0]!.aggressorFactionID, 500019);
  assert.equal(reports[0]!.influence, 0.75);
  assert.equal(reports[0]!.hasChat, true);
  assert.deepEqual(reports[0]!.effects, [1, 2, 3]);
  assert.deepEqual(reports[0]!.incursedSystems, [30002813, 30002814]);
});

// --- GetSystemsInIncursions (real: empty rowset) ----------------------------

const INCURSION_SYSTEM_COLUMNS = ["locationID", "sceneType", "templateNameID"];

test("decodeSystemsInIncursions returns [] (real empty) and reads populated rows", () => {
  assert.deepEqual(decodeSystemsInIncursions(rowset(INCURSION_SYSTEM_COLUMNS, [])), []);
  const rows = decodeSystemsInIncursions(
    rowset(INCURSION_SYSTEM_COLUMNS, [[30002813, 4, 34], [30002814, 3, 34], [0, 4, 34]]),
  );
  assert.deepEqual(rows, [
    { locationID: 30002813, sceneType: 4, templateNameID: 34 },
    { locationID: 30002814, sceneType: 3, templateNameID: 34 },
  ]);
});

// --- R7d sweep: the fixtures actually carry ids the decoders must keep -------

test("R7d: no decoder forces a numeric id into a label", () => {
  // Every id field above stays a number; this guards against a future 'resolve to
  // name' creeping into the plumbing layer (name resolution is a UI concern).
  const items = decodeSolarsystemItems(rowset(SSI_COLUMNS, [SSI_STATION]));
  assert.equal(typeof items[0]!.itemID, "number");
  assert.equal(typeof items[0]!.typeID, "number");
  const visits = decodeSolarSystemVisits(rowset(VISIT_COLUMNS, VISIT_LINES));
  assert.equal(typeof visits[0]!.solarSystemID, "number");
});
