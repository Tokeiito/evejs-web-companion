"use strict";

// A pilot's colonies as the retail client reads them, made into what the BFF's colony projection reads
// (src/planetInfoColony.js).
//
// The first answers below are this server's own, printed through the game-port BFF on 2026-10-10 for a colony of
// a command center and a launchpad with one link (GetPlanetInfo, GetPlanetResourceInfo). The pins a colony of
// that kind has not got (an extractor's control unit, a factory) and the route are made up, in the shape the
// server's serializer gives each (planetMgrService.js buildPinRow, buildRouteRow).

const test = require("node:test");
const assert = require("node:assert/strict");

const { colonyRowOf, planetIDsOf, plain, resourceRecordOf, rowsetRows } = require("../src/planetInfoColony");

const long = (digits) => ({ type: "long", value: digits });
const keyVal = (entries) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries } });
const list = (items) => ({ type: "list", items });
const dict = (entries) => ({ type: "dict", entries });

const COMMAND = keyVal([["id", 1054656331534], ["latitude", 1.2], ["longitude", 1.2], ["ownerID", 140000002], ["lastRunTime", long("134358891481580000")], ["typeID", 2524], ["contents", dict([])], ["state", 0], ["lastLaunchTime", 0]]);
const LAUNCHPAD = keyVal([["id", 1054656331535], ["latitude", 1.21], ["longitude", 1.21], ["ownerID", 140000002], ["lastRunTime", long("134358891481580000")], ["typeID", 2544], ["contents", dict([])], ["state", 0], ["lastLaunchTime", 0]]);
const LINK = keyVal([["typeID", 2280], ["endpoint1", 1054656331534], ["endpoint2", 1054656331535], ["level", 0]]);
const REAL_PLANET_INFO = keyVal([
  ["planetID", 40176368], ["solarSystemID", 30002780], ["planetTypeID", 2016], ["radius", 2150000], ["celestialIndex", 1], ["ownerID", 140000002],
  ["pins", list([COMMAND, LAUNCHPAD])], ["links", list([LINK])], ["routes", list([])], ["level", 0], ["currentSimTime", long("134360648051900000")],
]);
const REAL_RESOURCE_INFO = dict([[2073, 87], [2267, 98], [2268, 101], [2270, 63], [2288, 98]]);

test("this server's own answer for a colony becomes the stored row's shape: a pin's id its pinID, a time its digits", () => {
  const row = colonyRowOf(REAL_PLANET_INFO);
  assert.deepEqual([row.planetID, row.solarSystemID, row.planetTypeID, row.ownerID, row.level, row.currentSimTime], [40176368, 30002780, 2016, 140000002, 0, "134360648051900000"]);
  assert.deepEqual(row.pins.map((pin) => [pin.pinID, pin.id, pin.typeID, pin.contents, pin.state, pin.lastRunTime, pin.lastLaunchTime]), [
    [1054656331534, 1054656331534, 2524, {}, 0, "134358891481580000", 0],
    [1054656331535, 1054656331535, 2544, {}, 0, "134358891481580000", 0],
  ]);
  assert.deepEqual(row.links, [{ typeID: 2280, endpoint1: 1054656331534, endpoint2: 1054656331535, level: 0 }]);
  assert.deepEqual(row.routes, []);
});

test("what a pin holds, an extractor's program, a factory's state and a route come across under the row's own names", () => {
  const holding = keyVal([["id", 501], ["latitude", 1], ["longitude", 2], ["ownerID", 7], ["lastRunTime", long("134360000000000000")], ["typeID", 2544], ["contents", dict([[2268, 200], [2073, 50]])], ["state", 1], ["lastLaunchTime", long("134360000500000000")]]);
  const extractor = keyVal([["id", 502], ["latitude", 1], ["longitude", 2], ["ownerID", 7], ["lastRunTime", long("134360000000000000")], ["typeID", 2848], ["contents", dict([])], ["state", 1],
    ["cycleTime", 9000000000], ["programType", 2268], ["qtyPerCycle", 1897], ["expiryTime", long("134360127496894203")], ["installTime", long("134360055496894203")], ["headRadius", { type: "real", value: 0.010121 }],
    ["heads", list([{ type: "tuple", items: [0, 1.05, 1.44] }, { type: "tuple", items: [1, 1.07, 1.45] }])]]);
  const factory = keyVal([["id", 503], ["latitude", 1], ["longitude", 2], ["ownerID", 7], ["lastRunTime", long("134360000000000000")], ["typeID", 2473], ["contents", dict([[2268, 3000]])], ["state", 0],
    ["schematicID", 126], ["hasReceivedInputs", true], ["receivedInputsLastCycle", false]]);
  const route = keyVal([["routeID", 1620331369], ["charID", 7], ["path", list([502, 503])], ["commodityTypeID", 2268], ["commodityQuantity", 3000]]);
  const row = colonyRowOf(keyVal([["planetID", 40000001], ["solarSystemID", 30000001], ["planetTypeID", 2016], ["radius", { type: "real", value: 2140000 }], ["celestialIndex", 1], ["ownerID", 7],
    ["pins", list([holding, extractor, factory])], ["links", list([])], ["routes", list([route])], ["level", 2], ["currentSimTime", long("134360000900000000")]]));
  assert.deepEqual([row.pins[0].contents, row.pins[0].lastLaunchTime, row.pins[0].state], [{ 2268: 200, 2073: 50 }, "134360000500000000", 1]);
  const drill = row.pins[1];
  assert.deepEqual([drill.pinID, drill.cycleTime, drill.programType, drill.qtyPerCycle, drill.expiryTime, drill.installTime, drill.headRadius, drill.heads],
    [502, 9000000000, 2268, 1897, "134360127496894203", "134360055496894203", 0.010121, [[0, 1.05, 1.44], [1, 1.07, 1.45]]]);
  assert.deepEqual([row.pins[2].schematicID, row.pins[2].hasReceivedInputs, row.pins[2].receivedInputsLastCycle], [126, true, false]);
  assert.deepEqual(row.routes, [{ routeID: 1620331369, charID: 7, path: [502, 503], commodityTypeID: 2268, commodityQuantity: 3000 }]);
  assert.equal(row.level, 2);
});

test("a planet's answer with no colony of the pilot's in it, and what is no answer, are no colony", () => {
  // The planet's own facts come back alone for a pilot with nothing on it.
  const bare = keyVal([["planetID", 40176368], ["solarSystemID", 30002780], ["planetTypeID", 2016], ["radius", 2150000], ["celestialIndex", 1]]);
  for (const nothing of [bare, null, undefined, 5, "x", list([]), dict([]), { type: "object", name: "something.Else", args: dict([["pins", list([])]]) }]) assert.equal(colonyRowOf(nothing), null);
  // A colony with nothing built yet is still one.
  assert.deepEqual(colonyRowOf(keyVal([["planetID", 5], ["pins", list([])]])).pins, []);
});

test("the planets a pilot has colonies on are read off the rowset by its columns' names", () => {
  const columns = [["solarSystemID", 3], ["planetID", 3], ["typeID", 3], ["numberOfPins", 3], ["celestialIndex", 3]];
  const rowset = { type: "objectex2", header: [], list: [
    { type: "packedrow", columns, values: [30002780, 40176368, 2016, 2, 1] },
    { type: "packedrow", columns, values: [30002780, 40176369, 13, 5, 2] },
  ], dict: [] };
  assert.deepEqual(planetIDsOf(rowset), [40176368, 40176369]);
  assert.deepEqual(rowsetRows(rowset)[1], { solarSystemID: 30002780, planetID: 40176369, typeID: 13, numberOfPins: 5, celestialIndex: 2 });
  // No colonies is an empty rowset, which is not the same as no answer.
  assert.deepEqual(planetIDsOf({ type: "objectex2", header: [], list: [], dict: [] }), []);
  for (const nothing of [null, undefined, "x", {}, { list: "x" }]) assert.equal(planetIDsOf(nothing), null);
  // A row with no planet named is left out.
  assert.deepEqual(planetIDsOf({ list: [{ columns, values: [30002780, 0, 2016, 2, 1] }, { columns: "x", values: [] }] }), []);
});

test("this server's own answer for a planet's resources becomes the stored record's shape, in the order it came", () => {
  assert.deepEqual(resourceRecordOf(REAL_RESOURCE_INFO), { resourceTypeIDs: [2073, 2267, 2268, 2270, 2288], qualitiesByTypeID: { 2073: 87, 2267: 98, 2268: 101, 2270: 63, 2288: 98 } });
  assert.deepEqual(resourceRecordOf(dict([])), { resourceTypeIDs: [], qualitiesByTypeID: {} });
  for (const nothing of [null, undefined, 5, list([]), { type: "dict" }]) assert.equal(resourceRecordOf(nothing), null);
});

test("a wire value as plain data", () => {
  assert.deepEqual(plain(keyVal([["a", long("12345678901234567890")], ["b", { type: "real", value: 0.5 }], ["c", list([1, { type: "tuple", items: [2, 3] }])], ["d", dict([[7, true]])], ["e", null], ["f", "text"]])),
    { a: "12345678901234567890", b: 0.5, c: [1, [2, 3]], d: { 7: true }, e: null, f: "text" });
  assert.deepEqual([plain(undefined), plain({ type: "list" }), plain({ type: "dict" }), plain({ type: "buffer" })], [null, [], {}, null]);
});
