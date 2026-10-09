"use strict";

// The retail client's own constants, read by running one of its modules.
//
// What runs the module is injected here: the real one starts a Python that
// hosts the client's own, which no test machine is promised to have. The
// numbers are made up, in the shape scripts/client-constants.py prints them.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { CONSTANTS, createClientConstants, moduleArguments } = require("../src/clientData/clientConstants");

const ROOT = path.join("X:", "client");
const PRINTED = { packagedVolumeOverridesPerGroup: { 901: 2500.0, 902: 10000.0 }, packagedVolumeOverridesPerType: { 77001: 50000 }, typePlasticWrap: 77099 };

/** A client on a made-up disk, and a runner that prints `printed` and counts its runs. */
function client({ printed = JSON.stringify(PRINTED), fails = null, clientRoot = ROOT, hold = false } = {}) {
  const runs = [];
  const errors = [];
  let release = null;
  const held = hold ? new Promise((resolve) => { release = resolve; }) : null;
  const constants = createClientConstants({
    clientRoot,
    python: "a-python",
    async run(how) {
      runs.push(how);
      if (held) await held;
      if (fails) throw fails;
      return printed;
    },
    onError: (error) => errors.push(error.message),
  });
  return { constants, runs, errors, release: () => release() };
}

test("the packaged volumes are three names of one module of the client's code, which imports nothing", () => {
  assert.deepEqual(CONSTANTS.packagedVolumes, { module: "inventorycommon/const.pyj", names: ["packagedVolumeOverridesPerGroup", "packagedVolumeOverridesPerType", "typePlasticWrap"] });
});

test("the packaged volumes are read by running the client's module, from its own code archive and in its own Python", async () => {
  const { constants, runs } = client();
  const volumes = await constants.packagedVolumes();
  assert.deepEqual(runs, [{ python: "a-python", binFolder: path.join(ROOT, "tq", "bin64"), archive: path.join(ROOT, "tq", "code.ccp"), module: "inventorycommon/const.pyj", given: [], stubs: [], names: CONSTANTS.packagedVolumes.names }]);
  // By the group's number and the type's, as numbers; the wrap's type as it is.
  assert.deepEqual([...volumes.byGroup], [[901, 2500], [902, 10000]]);
  assert.deepEqual([...volumes.byType], [[77001, 50000]]);
  assert.equal(volumes.plasticWrapTypeID, 77099);
});

test("they are read once, however many ask and however many at once", async () => {
  const { constants, runs, release } = client({ hold: true });
  const asked = [constants.packagedVolumes(), constants.packagedVolumes(), constants.packagedVolumes()];
  release();
  const [first, second, third] = await Promise.all(asked);
  assert.equal(runs.length, 1);
  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(await constants.packagedVolumes(), first);
  assert.equal(runs.length, 1);
});

test("with no client there is nothing to read, and nothing is run", async () => {
  const { constants, runs, errors } = client({ clientRoot: null });
  assert.equal(constants.available(), false);
  assert.equal(await constants.packagedVolumes(), null);
  assert.deepEqual([runs, errors], [[], []]);
});

test("a module that cannot be run costs the constants, says why, and is not run again", async () => {
  const { constants, runs, errors } = client({ fails: new Error("The client's inventorycommon/const.pyj could not be run: no python") });
  assert.equal(await constants.packagedVolumes(), null);
  assert.equal(await constants.packagedVolumes(), null);
  assert.equal(runs.length, 1);
  assert.deepEqual(errors, ["The client's inventorycommon/const.pyj could not be run: no python"]);
  assert.deepEqual(constants.status().packagedVolumes, { loaded: false, error: "The client's inventorycommon/const.pyj could not be run: no python" });
});

test("what the module printed must be the tables, whole: a missing one or a number that is not one costs them all", async () => {
  for (const printed of [
    "not json",
    JSON.stringify([1, 2]),
    JSON.stringify({ ...PRINTED, packagedVolumeOverridesPerGroup: undefined }),
    JSON.stringify({ ...PRINTED, packagedVolumeOverridesPerType: [1] }),
    JSON.stringify({ ...PRINTED, packagedVolumeOverridesPerType: [] }),
    JSON.stringify({ ...PRINTED, packagedVolumeOverridesPerGroup: null }),
    JSON.stringify({ ...PRINTED, packagedVolumeOverridesPerGroup: { 0: 2500 } }),
    JSON.stringify({ ...PRINTED, packagedVolumeOverridesPerGroup: { 901: null } }),
    JSON.stringify({ ...PRINTED, typePlasticWrap: 0 }),
    JSON.stringify({ ...PRINTED, typePlasticWrap: 1.5 }),
    "null",
    JSON.stringify({ ...PRINTED, typePlasticWrap: "x" }),
    JSON.stringify({ ...PRINTED, packagedVolumeOverridesPerGroup: { 901: "big" } }),
    JSON.stringify({ ...PRINTED, packagedVolumeOverridesPerGroup: { frigate: 2500 } }),
  ]) {
    const { constants, errors } = client({ printed });
    assert.equal(await constants.packagedVolumes(), null, printed);
    assert.equal(errors.length, 1, printed);
  }
  const { constants } = client();
  assert.notEqual(await constants.packagedVolumes(), null);
  assert.deepEqual(constants.status().packagedVolumes, { loaded: true, error: null });
});

// ── each hold's capacity attribute ───────────────────────────────────────────

const HOLDS_PRINTED = {
  inventoryFlagData: {
    5: { name: "a/label", attribute: 3801, allowCategories: null },
    87: { name: "a/label", attribute: 3802, allowCategories: [18] },
    90: { name: "a/label", attribute: 3803 },
    134: { name: "a/label", attribute: 3804 },
    155: { name: "a/label", attribute: 3805 },
  },
  "dogma.const.attributeHasShipMaintenanceBay": 3901,
  "dogma.const.attributeHasFleetHangars": 3902,
  "inventorycommon.const.groupStrategicCruiser": 963001,
  "inventorycommon.const.flagCargo": 5,
  "inventorycommon.const.flagDroneBay": 87,
  "inventorycommon.const.flagShipHangar": 90,
  "inventorycommon.const.flagFleetHangar": 155,
};

test("the holds' attributes are in a module that imports others: two are given it from the same archive, and two it does not use are stood in for", () => {
  assert.deepEqual(CONSTANTS.holdAttributes, {
    module: "eve/common/script/util/inventoryFlagsCommon.pyj",
    given: [["inventorycommon.const", "inventorycommon/const.pyj"], ["dogma.const", "dogma/const.pyj"]],
    stubs: ["evetypes", "eveexceptions.const"],
    names: ["inventoryFlagData", "dogma.const.attributeHasShipMaintenanceBay", "dogma.const.attributeHasFleetHangars", "inventorycommon.const.groupStrategicCruiser",
      "inventorycommon.const.flagCargo", "inventorycommon.const.flagDroneBay", "inventorycommon.const.flagShipHangar", "inventorycommon.const.flagFleetHangar"],
  });
  // As the script is told them: what is given first, in the order given, then the stand-ins, then the names.
  assert.deepEqual(moduleArguments({ binFolder: "B", archive: "A", module: "m.pyj", given: [["a.b", "a/b.pyj"], ["c", "c.pyj"]], stubs: ["d", "e.f"], names: ["x", "a.b.y"] }),
    ["B", "A", "m.pyj", "--with", "a.b=a/b.pyj", "--with", "c=c.pyj", "--stub", "d", "--stub", "e.f", "x", "a.b.y"]);
  assert.deepEqual(moduleArguments({ binFolder: "B", archive: "A", module: "m.pyj", given: [], stubs: [], names: ["x"] }), ["B", "A", "m.pyj", "x"]);
});

test("the holds' attributes: each flag's, the two a ship has a bay by, the group of the ships built of parts, and the four flags with rules of their own", async () => {
  const { constants, runs } = client({ printed: JSON.stringify(HOLDS_PRINTED) });
  const holds = await constants.holdAttributes();
  assert.deepEqual(runs.map((run) => [run.module, run.given, run.stubs, run.names]), [[CONSTANTS.holdAttributes.module, CONSTANTS.holdAttributes.given, CONSTANTS.holdAttributes.stubs, CONSTANTS.holdAttributes.names]]);
  assert.deepEqual([...holds.byFlag], [[5, 3801], [87, 3802], [90, 3803], [134, 3804], [155, 3805]]);
  assert.deepEqual({ ...holds, byFlag: null }, { byFlag: null, hasShipMaintenanceBay: 3901, hasFleetHangars: 3902, strategicCruiserGroupID: 963001, cargoFlag: 5, droneBayFlag: 87, shipHangarFlag: 90, fleetHangarFlag: 155 });
  // One read, and the other set is its own.
  await constants.holdAttributes();
  assert.equal(runs.length, 1);
  assert.deepEqual(constants.status().holdAttributes, { loaded: true, error: null });
  assert.deepEqual(constants.status().packagedVolumes, { loaded: false, error: null });
});

test("the holds' attributes must be whole: a flag with no attribute, or a name that is not a number, costs them all", async () => {
  for (const broken of [
    { ...HOLDS_PRINTED, inventoryFlagData: { ...HOLDS_PRINTED.inventoryFlagData, 134: { name: "a/label" } } },
    { ...HOLDS_PRINTED, inventoryFlagData: { ...HOLDS_PRINTED.inventoryFlagData, 134: { attribute: "x" } } },
    { ...HOLDS_PRINTED, inventoryFlagData: { ...HOLDS_PRINTED.inventoryFlagData, 134: null } },
    { ...HOLDS_PRINTED, inventoryFlagData: { ...HOLDS_PRINTED.inventoryFlagData, ore: { attribute: 3804 } } },
    { ...HOLDS_PRINTED, inventoryFlagData: [] },
    { ...HOLDS_PRINTED, inventoryFlagData: undefined },
    { ...HOLDS_PRINTED, "dogma.const.attributeHasShipMaintenanceBay": null },
    { ...HOLDS_PRINTED, "dogma.const.attributeHasFleetHangars": "x" },
    { ...HOLDS_PRINTED, "inventorycommon.const.groupStrategicCruiser": 0 },
    { ...HOLDS_PRINTED, "inventorycommon.const.flagCargo": undefined },
    { ...HOLDS_PRINTED, "inventorycommon.const.flagDroneBay": 1.5 },
    { ...HOLDS_PRINTED, "inventorycommon.const.flagShipHangar": -1 },
    { ...HOLDS_PRINTED, "inventorycommon.const.flagFleetHangar": null },
  ]) {
    const { constants, errors } = client({ printed: JSON.stringify(broken) });
    assert.equal(await constants.holdAttributes(), null, JSON.stringify(broken).slice(0, 120));
    assert.equal(errors.length, 1);
  }
});
