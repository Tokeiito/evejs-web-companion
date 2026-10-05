"use strict";

// getPlanetsNear / getPlanetResourceTypeIDs: every planet within N stargate
// jumps of a system, with the raw resources its type carries.
//
// The fixture is a five-system line  A - B - C - D - E  plus an unconnected F,
// so jump counts, the clamp, ordering and "unknown origin" are all exact.
// A second block replays the lookup against the real data when it is reachable
// on this host, and skips cleanly (as in the docker build image) when not.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_GAMESTORE = "D:/evet/_local/gameStore/data";
const REAL_SDE = "D:/evet/_local/sde/eve-online-static-data-3396210-jsonl";

const SYS = { A: 30000001, B: 30000002, C: 30000003, D: 30000004, E: 30000005, F: 30000006 };

function writeTable(dataDir, name, body) {
  fs.mkdirSync(path.join(dataDir, name), { recursive: true });
  fs.writeFileSync(path.join(dataDir, name, "data.json"), JSON.stringify(body));
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-near-data-"));
const sdeDir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-near-sde-"));

writeTable(dataDir, "solarSystems", {
  solarSystems: [
    { solarSystemID: SYS.A, solarSystemName: "Alpha", security: 0.9 },
    { solarSystemID: SYS.B, solarSystemName: "Bravo", security: 0.5 },
    { solarSystemID: SYS.C, solarSystemName: "Charlie", security: 0 },
    { solarSystemID: SYS.D, solarSystemName: "Delta" },
    { solarSystemID: SYS.E, solarSystemName: "Echo", security: -0.4 },
    { solarSystemID: SYS.F, solarSystemName: "Foxtrot", security: 0.3 },
  ],
});
const line = [[SYS.A, SYS.B], [SYS.B, SYS.C], [SYS.C, SYS.D], [SYS.D, SYS.E]];
const stargates = [];
let gateID = 50000001;
for (const [x, y] of line) {
  stargates.push({ itemID: gateID, solarSystemID: x, destinationID: gateID + 1, destinationSolarSystemID: y });
  stargates.push({ itemID: gateID + 1, solarSystemID: y, destinationID: gateID, destinationSolarSystemID: x });
  gateID += 2;
}
writeTable(dataDir, "stargates", { stargates });
writeTable(dataDir, "itemTypes", {
  types: [
    { typeID: 11, name: "Planet (Temperate)" },
    { typeID: 12, name: "Planet (Ice)" },
  ],
});
const planets = [
  // Deliberately out of order: celestialIndex 2 before 1 in Alpha.
  { _key: 40000002, solarSystemID: SYS.A, celestialIndex: 2, typeID: 12 },
  { _key: 40000001, solarSystemID: SYS.A, celestialIndex: 1, typeID: 11 },
  { _key: 40000003, solarSystemID: SYS.B, celestialIndex: 1, typeID: 11 },
  { _key: 40000004, solarSystemID: SYS.C, celestialIndex: 1, typeID: 30889 }, // shattered: no entry
  { _key: 40000005, solarSystemID: SYS.D, celestialIndex: 1, typeID: 11 },
  { _key: 40000006, solarSystemID: SYS.E, celestialIndex: 1, typeID: 12 },
  { _key: 40000007, solarSystemID: SYS.F, celestialIndex: 1, typeID: 11 },
];
fs.writeFileSync(
  path.join(sdeDir, "mapPlanets.jsonl"),
  planets.map((row) => JSON.stringify(row)).join("\n") + "\n",
);

process.env.EVEJS_GAMESTORE_DATA_DIR = dataDir;
process.env.EVEJS_SDE_DIR = sdeDir;
process.env.EVEJS_WEB_POC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-near-app-"));

const staticData = require("../src/staticData");

test("the ported resource table: 16 planet types, five distinct raw resources each", () => {
  const known = [11, 12, 13, 2014, 2015, 2016, 2017, 2063, 56018, 56019, 56020, 56021, 56022, 56023, 56024, 73911];
  for (const typeID of known) {
    const ids = staticData.getPlanetResourceTypeIDs(typeID);
    assert.equal(ids.length, 5, `type ${typeID}`);
    assert.equal(new Set(ids).size, 5, `type ${typeID} repeats a resource`);
    for (const id of ids) {
      assert.ok(id >= 2073 && id <= 2311, `type ${typeID}: ${id} is not a raw resource id`);
    }
  }
  // The eight base planet types are all present.
  for (const typeID of [11, 12, 13, 2014, 2015, 2016, 2017, 2063]) {
    assert.ok(staticData.getPlanetResourceTypeIDs(typeID).length > 0);
  }
  // Temperate: aqueous liquids, autotrophs, carbon compounds, complex organisms, microorganisms.
  assert.deepEqual(staticData.getPlanetResourceTypeIDs(11), [2268, 2305, 2288, 2287, 2073]);
});

test("unknown planet types have no resources, and the result is a copy", () => {
  assert.deepEqual(staticData.getPlanetResourceTypeIDs(30889), []);
  assert.deepEqual(staticData.getPlanetResourceTypeIDs(undefined), []);
  const first = staticData.getPlanetResourceTypeIDs(11);
  first.push(1);
  assert.equal(staticData.getPlanetResourceTypeIDs(11).length, 5);
});

test("an unknown origin system reads null", () => {
  assert.equal(staticData.getPlanetsNear(99999999, 2), null);
  assert.equal(staticData.getPlanetsNear(0, 2), null);
});

test("jumps 0 lists only the origin's own planets, in celestial order", () => {
  const result = staticData.getPlanetsNear(SYS.A, 0);
  assert.deepEqual(result.origin, { solarSystemID: SYS.A, solarSystemName: "Alpha" });
  assert.equal(result.maxJumps, 0);
  assert.deepEqual(result.planets.map((p) => p.planetID), [40000001, 40000002]);
  assert.ok(result.planets.every((p) => p.jumps === 0));
  assert.equal(result.planets[0].planetName, "Alpha I");
  assert.equal(result.planets[1].planetName, "Alpha II");
  assert.equal(result.planets[0].planetTypeName, "Planet (Temperate)");
  assert.equal(result.planets[0].security, 0.9);
  assert.deepEqual(result.planets[0].resourceTypeIDs, staticData.getPlanetResourceTypeIDs(11));
});

test("breadth-first: jump counts follow the gates and unconnected systems are absent", () => {
  const result = staticData.getPlanetsNear(SYS.A, 3);
  assert.deepEqual(
    result.planets.map((p) => [p.solarSystemName, p.jumps]),
    [["Alpha", 0], ["Alpha", 0], ["Bravo", 1], ["Charlie", 2], ["Delta", 3]],
  );
  assert.ok(!result.planets.some((p) => p.solarSystemID === SYS.F));
  // Edges run both ways: from the middle, both directions are reached.
  const mid = staticData.getPlanetsNear(SYS.C, 1);
  assert.deepEqual(mid.planets.map((p) => p.solarSystemName), ["Charlie", "Bravo", "Delta"]);
});

test("every planet is listed, even one with no resources; security can be null or zero", () => {
  const result = staticData.getPlanetsNear(SYS.A, 5);
  const shattered = result.planets.find((p) => p.planetID === 40000004);
  assert.deepEqual(shattered.resourceTypeIDs, []);
  assert.equal(shattered.planetTypeName, null);
  assert.equal(shattered.security, 0);
  const delta = result.planets.find((p) => p.planetID === 40000005);
  assert.equal(delta.security, null);
  assert.equal(result.planets.length, 6);
});

test("maxJumps is clamped to an integer 0..5", () => {
  assert.equal(staticData.getPlanetsNear(SYS.A, 99).maxJumps, 5);
  assert.equal(staticData.getPlanetsNear(SYS.A, -3).maxJumps, 0);
  assert.equal(staticData.getPlanetsNear(SYS.A, 2.9).maxJumps, 2);
  assert.equal(staticData.getPlanetsNear(SYS.A, "abc").maxJumps, 0);
  assert.equal(staticData.getPlanetsNear(SYS.A, undefined).maxJumps, 0);
  // Four jumps reaches Echo; the clamp lets 99 get there too.
  assert.equal(staticData.getPlanetsNear(SYS.A, 99).planets.at(-1).solarSystemName, "Echo");
  assert.equal(staticData.getPlanetsNear(SYS.A, 4).planets.at(-1).jumps, 4);
});

const realReachable =
  fs.existsSync(path.join(REAL_GAMESTORE, "solarSystems", "data.json")) &&
  fs.existsSync(path.join(REAL_SDE, "mapPlanets.jsonl"));

test(
  "real data: a known system's neighbourhood is sorted, starts at jumps 0, and the clamp holds",
  { skip: realReachable ? false : "real gameStore/SDE not reachable on this host" },
  () => {
    const script = `
      const sd = require(${JSON.stringify(path.resolve(__dirname, "../src/staticData"))});
      const near = sd.getPlanetsNear(30000142, 99);
      const small = sd.getPlanetsNear(30000142, 0);
      process.stdout.write(JSON.stringify({ near, small }));
    `;
    const run = spawnSync(process.execPath, ["-e", script], {
      env: {
        ...process.env,
        EVEJS_GAMESTORE_DATA_DIR: REAL_GAMESTORE,
        EVEJS_SDE_DIR: REAL_SDE,
        EVEJS_WEB_POC_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-near-real-")),
      },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr);
    const { near, small } = JSON.parse(run.stdout);
    assert.equal(near.maxJumps, 5);
    assert.equal(near.origin.solarSystemID, 30000142);
    assert.ok(near.planets.length > 50);
    assert.ok(near.planets.some((p) => p.jumps === 0));
    assert.ok(near.planets.every((p) => p.jumps >= 0 && p.jumps <= 5));
    for (let i = 1; i < near.planets.length; i += 1) {
      assert.ok(near.planets[i - 1].jumps <= near.planets[i].jumps, "sorted by jumps");
    }
    assert.ok(small.planets.length > 0 && small.planets.every((p) => p.jumps === 0));
    assert.ok(small.planets.every((p) => typeof p.security === "number"));
    assert.ok(small.planets.some((p) => p.resourceTypeIDs.length === 5));
  },
);
