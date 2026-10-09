"use strict";

// The retail client's built data, read by the client's own loader.
//
// What runs the loader is injected here: the real one starts a Python that
// hosts the client's own, which no test machine is promised to have. The rows
// are made up, in the shape scripts/client-built-data.py prints a mission in.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createClientBuiltData, TABLES } = require("../src/clientData/clientBuiltData");

const ROOT = path.join("X:", "client");
const INDEX = [
  "res:/staticdata/dialogs.static,aa/aa01_dialogs,ffff,10,5",
  "res:/staticData/Missions.fsdbinary,5f/5f05_missions,c34c,1265112,202049",
  "",
].join("\n");
const MISSIONS = {
  875: { contentTemplate: "agent.missionTemplatizedContent_BasicKillMission", killMission: { dungeonID: 900 }, messages: { "messages.mission.briefing": 900450 }, nameID: 900260 },
  1381: { contentTemplate: "agent.missionTemplatizedContent_BasicCourierMission", messages: { "messages.mission.briefing": 900954, "messages.mission.offered.agentsays": 900955 }, nameID: 900456 },
};

/** A client on a made-up disk, and a loader that prints `printed` and counts its runs. */
function client({ printed = JSON.stringify(MISSIONS), index = INDEX, fails = null, clientRoot = ROOT, ...options } = {}) {
  const runs = [];
  const read = [];
  const errors = [];
  let release = null;
  const held = options.hold ? new Promise((resolve) => { release = resolve; }) : null;
  const data = createClientBuiltData({
    clientRoot,
    python: "a-python",
    readFile(file, encoding) {
      read.push([file, encoding]);
      if (index === null) throw new Error("ENOENT: no such file");
      return index;
    },
    async run(how) {
      runs.push(how);
      if (held) await held;
      if (fails) throw fails;
      return printed;
    },
    onError: (error) => errors.push(error.message),
  });
  return { data, runs, read, errors, release: () => release && release() };
}

test("the missions table is the client's missionsLoader over its missions.fsdbinary", () => {
  assert.deepEqual(TABLES.missions, { loader: "missionsLoader", resource: "res:/staticdata/missions.fsdbinary" });
});

test("a table is read by the client's loader, from where the client's index says its file is", async () => {
  const { data, runs, read, errors } = client();
  assert.equal(data.available(), true);
  // Nothing is read until something is asked for.
  assert.deepEqual(runs, []);
  assert.deepEqual(read, []);
  assert.deepEqual(data.status(), { available: true, python: "a-python", tables: { missions: { loaded: false, rows: 0, error: null } } });

  assert.deepEqual(await data.lookup("missions", 1381), { available: true, row: MISSIONS[1381] });
  assert.deepEqual(read, [[path.join(ROOT, "tq", "resfileindex.txt"), "utf8"]]);
  // The index is matched whatever its case; the loader gets the client's own folder, its module and the file.
  assert.deepEqual(runs, [{
    python: "a-python",
    binFolder: path.join(ROOT, "tq", "bin64"),
    loader: "missionsLoader",
    dataFile: path.join(ROOT, "ResFiles", "5f/5f05_missions"),
  }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(data.status().tables.missions, { loaded: true, rows: 2, error: null });
});

test("a row is found by its number or by the number as text; one the client does not have is null", async () => {
  const { data } = client();
  assert.deepEqual(await data.lookup("missions", "875"), { available: true, row: MISSIONS[875] });
  assert.deepEqual(await data.lookup("missions", 875), { available: true, row: MISSIONS[875] });
  assert.deepEqual(await data.lookup("missions", 999), { available: true, row: null });
  // What every object has is not a row.
  for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.deepEqual(await data.lookup("missions", key), { available: true, row: null }, key);
  }
  assert.deepEqual(await data.table("missions"), MISSIONS);
});

test("a table is read once, however many ask and however many at once", async () => {
  const { data, runs, release } = client({ hold: true });
  const asked = [data.lookup("missions", 875), data.lookup("missions", 1381), data.table("missions")];
  release();
  const [first, second, whole] = await Promise.all(asked);
  assert.deepEqual(first.row, MISSIONS[875]);
  assert.deepEqual(second.row, MISSIONS[1381]);
  assert.deepEqual(whole, MISSIONS);
  await data.lookup("missions", 875);
  assert.equal(runs.length, 1);
});

test("with no client there is nothing to read, and nothing is run", async () => {
  const { data, runs, read, errors } = client({ clientRoot: null });
  assert.equal(data.available(), false);
  assert.deepEqual(await data.lookup("missions", 875), { available: false, row: null });
  assert.equal(await data.table("missions"), null);
  assert.deepEqual(runs, []);
  assert.deepEqual(read, []);
  // And it is no failure: nothing was tried.
  assert.deepEqual(errors, []);
  assert.deepEqual(data.status(), { available: false, python: "a-python", tables: { missions: { loaded: false, rows: 0, error: null } } });
});

test("a table this does not read is not one, and nothing is run for it", async () => {
  const { data, runs, read } = client();
  for (const name of ["dungeons", "constructor", "__proto__", ""]) {
    assert.deepEqual(await data.lookup(name, 1), { available: false, row: null }, name);
  }
  assert.deepEqual(runs, []);
  assert.deepEqual(read, []);
});

test("a loader that cannot be run costs the table, says why, and is not run again", async () => {
  const { data, runs, errors } = client({ fails: new Error("The client's missionsLoader could not be run: python is not there") });
  assert.deepEqual(await data.lookup("missions", 875), { available: false, row: null });
  assert.equal(await data.table("missions"), null);
  assert.deepEqual(await data.lookup("missions", 1381), { available: false, row: null });
  assert.equal(runs.length, 1);
  assert.deepEqual(errors, ["The client's missionsLoader could not be run: python is not there"]);
  assert.deepEqual(data.status().tables.missions, { loaded: false, rows: 0, error: "The client's missionsLoader could not be run: python is not there" });
});

test("a client whose index has no such file, or no index at all, costs the table without running anything", async () => {
  const without = client({ index: "res:/staticdata/dialogs.static,aa/aa01_dialogs,ffff,10,5\n" });
  assert.deepEqual(await without.data.lookup("missions", 875), { available: false, row: null });
  assert.deepEqual(without.runs, []);
  assert.match(without.data.status().tables.missions.error, /index has no res:\/staticdata\/missions\.fsdbinary/);

  const none = client({ index: null });
  assert.deepEqual(await none.data.lookup("missions", 875), { available: false, row: null });
  assert.deepEqual(none.runs, []);
  assert.match(none.data.status().tables.missions.error, /ENOENT/);
});

test("what the loader printed must be a table", async () => {
  for (const printed of ["", "not json", "null", "[]", "3", "\"text\""]) {
    const { data, errors } = client({ printed });
    assert.deepEqual(await data.lookup("missions", 875), { available: false, row: null }, JSON.stringify(printed));
    assert.equal(errors.length, 1, JSON.stringify(printed));
  }
});
