// R77 — decoding the 7 RB-PI planetary-industry bound reads, against REAL CAPTURED
// BYTES.
//
// Every fixture below is VERBATIM from a live capture on 2026-07-22: Farmer
// (140000005) owns colony planetID 40009077 (command + factory + extractor +
// spaceport, 3 links, 3 routes) — captured through GET /api/bridge/bound-planet.
// The GetResourceData buffer is trimmed to its first 8 of 900 real bytes for the
// fixture; the length is asserted separately. The NO-COLONY GetPlanetInfo fixture is
// verbatim from the Test Two (140000002) cross-check (a foreign session with no
// colony on that planet — a legitimate empty state).
//
// The bigint fixtures matter: pin FILETIMEs (lastRunTime / expiryTime / installTime /
// currentSimTime) and the large program cycleTime are asserted as EXACT decimal
// strings — a decoder that routed them through Number would be caught here (R7d).

import test from "node:test";
import assert from "node:assert/strict";

import type { JsonValue } from "./wire.ts";
import {
  decodePlanetInfo,
  decodePlanetResourceInfo,
  decodeResourceData,
  decodeFullNetwork,
  decodeCommandPins,
  decodeExtractors,
  decodeProgramResult,
  decodeBoundPlanet,
} from "./boundPlanets.ts";

// --- real captured bytes (Farmer 140000005, colony 40009077, verbatim) ------

const FARMER_PLANET_INFO: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["planetID", 40009077],
      ["solarSystemID", 30000142],
      ["planetTypeID", 2016],
      ["radius", 2060000],
      ["celestialIndex", 1],
      ["ownerID", 140000005],
      [
        "pins",
        {
          type: "list",
          items: [
            // command center (typeID 2544): carries lastLaunchTime
            {
              type: "object",
              name: "util.KeyVal",
              args: {
                type: "dict",
                entries: [
                  ["id", 1054656331522],
                  ["latitude", 0.6503824637230289],
                  ["longitude", 2.127116920401462],
                  ["ownerID", 140000005],
                  ["lastRunTime", "134276968878520000"],
                  ["typeID", 2544],
                  ["contents", { type: "dict", entries: [["2396", 80]] }],
                  ["state", 0],
                  ["lastLaunchTime", "0"],
                ],
              },
            },
            // factory/process (typeID 2473): schematicID + input flags
            {
              type: "object",
              name: "util.KeyVal",
              args: {
                type: "dict",
                entries: [
                  ["id", 1054656331523],
                  ["latitude", 0.648990061373119],
                  ["longitude", 2.0940329372441573],
                  ["ownerID", 140000005],
                  ["lastRunTime", "134287114378050000"],
                  ["typeID", 2473],
                  ["contents", { type: "dict", entries: [["2288", 2160]] }],
                  ["state", 0],
                  ["schematicID", 134],
                  ["hasReceivedInputs", false],
                  ["receivedInputsLastCycle", true],
                ],
              },
            },
            // extractor control unit (typeID 2848): cycleTime/expiry/install/heads
            {
              type: "object",
              name: "util.KeyVal",
              args: {
                type: "dict",
                entries: [
                  ["id", 1054656331525],
                  ["latitude", 0.6464532306249989],
                  ["longitude", 2.0574392096663767],
                  ["ownerID", 140000005],
                  ["lastRunTime", "134287105378050000"],
                  ["typeID", 2848],
                  ["contents", { type: "dict", entries: [] }],
                  ["state", 0],
                  ["cycleTime", 9000000000],
                  ["programType", 2288],
                  ["qtyPerCycle", 1965],
                  ["expiryTime", "134287105378050000"],
                  ["installTime", "134287069378050000"],
                  ["headRadius", 0.01],
                  [
                    "heads",
                    {
                      type: "list",
                      items: [
                        { type: "list", items: [0, 0.637899275287385, 1.984919630732382] },
                        { type: "list", items: [1, 0.6569345396706695, 2.0089314524242825] },
                        { type: "list", items: [5, 0.661112922608148, 1.9707227855565301] },
                        { type: "list", items: [6, 0.6710720504808718, 2.03287135623005] },
                      ],
                    },
                  ],
                ],
              },
            },
            // spaceport/launchpad (typeID 2524): lastLaunchTime
            {
              type: "object",
              name: "util.KeyVal",
              args: {
                type: "dict",
                entries: [
                  ["id", 9988400018024],
                  ["latitude", 0.6624203957085567],
                  ["longitude", 2.1525127276679017],
                  ["ownerID", 140000005],
                  ["lastRunTime", "134276966607620000"],
                  ["typeID", 2524],
                  ["contents", { type: "dict", entries: [] }],
                  ["state", 0],
                  ["lastLaunchTime", "0"],
                ],
              },
            },
          ],
        },
      ],
      [
        "links",
        {
          type: "list",
          items: [
            keyVal([["typeID", 2280], ["endpoint1", 1054656331522], ["endpoint2", 1054656331523], ["level", 0]]),
            keyVal([["typeID", 2280], ["endpoint1", 1054656331522], ["endpoint2", 9988400018024], ["level", 0]]),
            keyVal([["typeID", 2280], ["endpoint1", 1054656331523], ["endpoint2", 1054656331525], ["level", 0]]),
          ],
        },
      ],
      [
        "routes",
        {
          type: "list",
          items: [
            keyVal([
              ["routeID", 3],
              ["charID", 140000005],
              ["path", { type: "list", items: [1054656331523, 1054656331522] }],
              ["commodityTypeID", 2396],
              ["commodityQuantity", 20],
            ]),
          ],
        },
      ],
      ["level", 5],
      ["currentSimTime", "134292316092880000"],
    ],
  },
};

function keyVal(entries: readonly (readonly [string, JsonValue])[]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries: entries as JsonValue } };
}

// GetPlanetResourceInfo — a CachedMethodCallResult wrapping a substream dict.
const FARMER_RESOURCE_INFO: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "run" }]] },
    {
      type: "substream",
      value: {
        type: "dict",
        entries: [[2073, 73], [2267, 53], [2268, 102], [2270, 81], [2288, 130]],
      },
    },
    { type: "list", items: [{ type: "long", value: "134292316092890000" }, 1424819789] },
  ],
};

const FARMER_RESOURCE_DATA: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["data", { type: "bytes", value: { type: "Buffer", data: [203, 79, 3, 67, 38, 218, 78, 63] } }],
      ["numBands", 15],
      ["proximity", 0],
    ],
  },
};

// GetFullNetworkForOwner — [pins, links] where links are BARE 2-tuples.
const FARMER_FULL_NETWORK: JsonValue = [
  { type: "list", items: (FARMER_PLANET_INFO as any).args.entries[6][1].items },
  {
    type: "list",
    items: [
      { type: "list", items: [1054656331522, 1054656331523] },
      { type: "list", items: [1054656331522, 9988400018024] },
      { type: "list", items: [1054656331523, 1054656331525] },
    ],
  },
];

const FARMER_COMMAND_PINS: JsonValue = {
  type: "dict",
  entries: [
    [
      140000005,
      keyVal([
        ["pinID", 9988400018024],
        ["id", 9988400018024],
        ["typeID", 2524],
        ["ownerID", 140000005],
        ["latitude", 0.6624203957085567],
        ["longitude", 2.1525127276679017],
      ]),
    ],
  ],
};

const FARMER_EXTRACTORS: JsonValue = {
  type: "list",
  items: [
    keyVal([
      ["pinID", 1054656331525],
      ["id", 1054656331525],
      ["typeID", 2848],
      ["ownerID", 140000005],
      ["latitude", 0.6464532306249989],
      ["longitude", 2.0574392096663767],
    ]),
  ],
};

const FARMER_PROGRAM_RESULT: JsonValue = [1, 144000000000, 84];

// NO-COLONY GetPlanetInfo — verbatim from the Test Two cross-check.
const NO_COLONY_PLANET_INFO: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["planetID", 40009077],
      ["solarSystemID", 30000142],
      ["planetTypeID", 2016],
      ["radius", 2060000],
      ["celestialIndex", 1],
    ],
  },
};

// --- GetPlanetInfo ----------------------------------------------------------

test("decodePlanetInfo reads geography + the owned colony (pins/links/routes)", () => {
  const info = decodePlanetInfo(FARMER_PLANET_INFO);
  assert.equal(info.planetID, 40009077);
  assert.equal(info.solarSystemID, 30000142);
  assert.equal(info.planetTypeID, 2016);
  assert.equal(info.radius, 2060000);
  assert.equal(info.celestialIndex, 1);
  assert.notEqual(info.colony, null);
  const colony = info.colony!;
  assert.equal(colony.ownerID, 140000005);
  assert.equal(colony.level, 5);
  assert.equal(colony.currentSimTime, "134292316092880000");
  assert.equal(colony.pins.length, 4);
  assert.equal(colony.links.length, 3);
  assert.equal(colony.routes.length, 1);
});

test("decodePlanetInfo decodes each pin's entity-type-conditional fields", () => {
  const colony = decodePlanetInfo(FARMER_PLANET_INFO).colony!;
  const command = colony.pins[0]!;
  const factory = colony.pins[1]!;
  const ecu = colony.pins[2]!;
  const spaceport = colony.pins[3]!;

  // command center — id kept as data, lastLaunchTime present, contents decoded
  assert.equal(command.id, 1054656331522);
  assert.equal(command.typeID, 2544);
  assert.equal(command.lastLaunchTime, "0");
  assert.deepEqual(command.contents, [{ typeID: 2396, quantity: "80" }]);
  // a command pin has no ECU/process conditionals
  assert.equal(command.schematicID, null);
  assert.equal(command.cycleTime, null);
  assert.deepEqual(command.heads, []);

  // factory/process — schematicID + input booleans
  assert.equal(factory.typeID, 2473);
  assert.equal(factory.schematicID, 134);
  assert.equal(factory.hasReceivedInputs, false);
  assert.equal(factory.receivedInputsLastCycle, true);

  // ecu — cycleTime, program fields, FILETIMEs, nested heads
  assert.equal(ecu.typeID, 2848);
  assert.equal(ecu.cycleTime, "9000000000");
  assert.equal(ecu.programType, 2288);
  assert.equal(ecu.qtyPerCycle, "1965");
  assert.equal(ecu.expiryTime, "134287105378050000");
  assert.equal(ecu.installTime, "134287069378050000");
  assert.equal(ecu.headRadius, 0.01);
  assert.equal(ecu.heads.length, 4);
  assert.deepEqual(ecu.heads[0], { headID: 0, latitude: 0.637899275287385, longitude: 1.984919630732382 });

  // spaceport — lastLaunchTime, no ECU conditionals
  assert.equal(spaceport.typeID, 2524);
  assert.equal(spaceport.lastLaunchTime, "0");
});

test("decodePlanetInfo keeps FILETIMEs as EXACT strings (never through Number)", () => {
  const ecu = decodePlanetInfo(FARMER_PLANET_INFO).colony!.pins[2]!;
  // 134287105378050000 > 2^53; a Number round-trip would corrupt the last digits.
  assert.equal(typeof ecu.lastRunTime, "string");
  assert.equal(ecu.lastRunTime, "134287105378050000");
  assert.equal(ecu.expiryTime, "134287105378050000");
});

test("decodePlanetInfo decodes colony links (KeyVal) and routes", () => {
  const colony = decodePlanetInfo(FARMER_PLANET_INFO).colony!;
  assert.deepEqual(colony.links[0], {
    typeID: 2280,
    endpoint1: 1054656331522,
    endpoint2: 1054656331523,
    level: 0,
  });
  assert.deepEqual(colony.routes[0], {
    routeID: 3,
    charID: 140000005,
    path: [1054656331523, 1054656331522],
    commodityTypeID: 2396,
    commodityQuantity: "20",
  });
});

test("decodePlanetInfo returns colony:null for a planet with no owned colony", () => {
  const info = decodePlanetInfo(NO_COLONY_PLANET_INFO);
  assert.equal(info.planetID, 40009077);
  assert.equal(info.planetTypeID, 2016);
  assert.equal(info.colony, null);
});

// --- GetPlanetResourceInfo --------------------------------------------------

test("decodePlanetResourceInfo unwraps the CachedMethodCallResult substream dict", () => {
  const qualities = decodePlanetResourceInfo(FARMER_RESOURCE_INFO);
  assert.deepEqual(qualities, [
    { resourceTypeID: 2073, quality: 73 },
    { resourceTypeID: 2267, quality: 53 },
    { resourceTypeID: 2268, quality: 102 },
    { resourceTypeID: 2270, quality: 81 },
    { resourceTypeID: 2288, quality: 130 },
  ]);
});

test("decodePlanetResourceInfo also reads a bare (unwrapped) dict", () => {
  const bare: JsonValue = { type: "dict", entries: [[2073, 73], [2288, 130]] };
  assert.deepEqual(decodePlanetResourceInfo(bare), [
    { resourceTypeID: 2073, quality: 73 },
    { resourceTypeID: 2288, quality: 130 },
  ]);
});

// --- GetResourceData --------------------------------------------------------

test("decodeResourceData reads the distribution bytes + numBands + proximity", () => {
  const rd = decodeResourceData(FARMER_RESOURCE_DATA);
  assert.deepEqual(rd.data, [203, 79, 3, 67, 38, 218, 78, 63]);
  assert.equal(rd.numBands, 15);
  assert.equal(rd.proximity, 0);
});

// --- GetFullNetworkForOwner -------------------------------------------------

test("decodeFullNetwork reads [pins, links] with links as bare 2-tuples", () => {
  const network = decodeFullNetwork(FARMER_FULL_NETWORK);
  assert.equal(network.pins.length, 4);
  assert.equal(network.pins[2]!.typeID, 2848);
  assert.deepEqual(network.links, [
    { endpoint1: 1054656331522, endpoint2: 1054656331523 },
    { endpoint1: 1054656331522, endpoint2: 9988400018024 },
    { endpoint1: 1054656331523, endpoint2: 1054656331525 },
  ]);
});

test("decodeFullNetwork returns an empty network for [[], []]", () => {
  const network = decodeFullNetwork([
    { type: "list", items: [] },
    { type: "list", items: [] },
  ]);
  assert.deepEqual(network, { pins: [], links: [] });
});

// --- GetCommandPinsForPlanet / GetExtractorsForPlanet -----------------------

test("decodeCommandPins reads the ownerID-keyed command pin dict", () => {
  const pins = decodeCommandPins(FARMER_COMMAND_PINS);
  assert.equal(pins.length, 1);
  assert.deepEqual(pins[0], {
    ownerID: 140000005,
    pinID: 9988400018024,
    id: 9988400018024,
    typeID: 2524,
    latitude: 0.6624203957085567,
    longitude: 2.1525127276679017,
  });
});

test("decodeExtractors reads the extractor list", () => {
  const extractors = decodeExtractors(FARMER_EXTRACTORS);
  assert.equal(extractors.length, 1);
  assert.equal(extractors[0]!.pinID, 1054656331525);
  assert.equal(extractors[0]!.typeID, 2848);
  assert.equal(extractors[0]!.ownerID, 140000005);
});

test("decodeCommandPins / decodeExtractors return [] for empty results", () => {
  assert.deepEqual(decodeCommandPins({ type: "dict", entries: [] }), []);
  assert.deepEqual(decodeExtractors({ type: "list", items: [] }), []);
});

// --- GetProgramResultInfo ---------------------------------------------------

test("decodeProgramResult reads [qty, cycleTime, numCycles] bigint-safe", () => {
  const result = decodeProgramResult(FARMER_PROGRAM_RESULT);
  assert.deepEqual(result, {
    qtyToDistribute: "1",
    cycleTime: "144000000000",
    numCycles: "84",
  });
});

// --- the whole /api/bridge/bound-planet envelope ----------------------------

test("decodeBoundPlanet folds the envelope with per-read results and errors", () => {
  const raw: JsonValue = {
    ok: true,
    characterID: 140000005,
    planetID: 40009077,
    ownerID: 140000005,
    resourceTypeID: 2073,
    reads: {
      GetPlanetInfo: { result: FARMER_PLANET_INFO },
      GetPlanetResourceInfo: { result: FARMER_RESOURCE_INFO },
      GetResourceData: { result: FARMER_RESOURCE_DATA },
      GetFullNetworkForOwner: { result: FARMER_FULL_NETWORK },
      GetCommandPinsForPlanet: { result: FARMER_COMMAND_PINS },
      GetExtractorsForPlanet: { result: FARMER_EXTRACTORS },
      GetProgramResultInfo: { error: "CALL_FAILED", message: "boom" },
    },
  };
  const decoded = decodeBoundPlanet(raw);
  assert.equal(decoded.planetID, 40009077);
  assert.equal(decoded.ownerID, 140000005);
  assert.equal(decoded.resourceTypeID, 2073);
  assert.equal(decoded.planetInfo.error, null);
  assert.equal(decoded.planetInfo.value.colony!.pins.length, 4);
  assert.equal(decoded.resourceInfo.value.length, 5);
  assert.equal(decoded.network.value.links.length, 3);
  assert.equal(decoded.commandPins.value.length, 1);
  assert.equal(decoded.extractors.value.length, 1);
  // a failed read carries its code and a safe default value
  assert.equal(decoded.programResult.error, "CALL_FAILED");
  assert.deepEqual(decoded.programResult.value, {
    qtyToDistribute: null,
    cycleTime: null,
    numCycles: null,
  });
});

test("decodeBoundPlanet tolerates a missing reads envelope", () => {
  const decoded = decodeBoundPlanet(null);
  assert.equal(decoded.planetID, null);
  assert.equal(decoded.planetInfo.value.colony, null);
  assert.deepEqual(decoded.commandPins.value, []);
  assert.deepEqual(decoded.network.value, { pins: [], links: [] });
});
