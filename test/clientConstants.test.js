"use strict";

// The retail client's own constants, read by running one of its modules.
//
// What runs the module is injected here: the real one starts a Python that
// hosts the client's own, which no test machine is promised to have. The
// numbers are made up, in the shape scripts/client-constants.py prints them.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { CONSTANTS, createClientConstants } = require("../src/clientData/clientConstants");

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
  assert.deepEqual(runs, [{ python: "a-python", binFolder: path.join(ROOT, "tq", "bin64"), archive: path.join(ROOT, "tq", "code.ccp"), module: "inventorycommon/const.pyj", names: CONSTANTS.packagedVolumes.names }]);
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
