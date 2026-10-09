"use strict";

// ── The retail client's built data, read by the client's own loaders ─────────
//
// What the retail client knows without asking the server is mostly "cFSD": a
// binary file among its resources (res:/staticdata/missions.fsdbinary) laid
// out by a schema that is compiled into a loader module beside its executable
// (bin64/missionsLoader.pyd). The file does not describe itself, and only that
// loader knows its layout. So the loader is what reads it: in the client's own
// python27.dll, on the player's own disk, when a table is first asked for
// (scripts/client-built-data.py). Nothing of the client is copied into this
// repository, and nothing is kept on disk.
//
// A mission is the first table read this way: the client's job board words a
// mission's page from its record here (evemissions/client/data.py get_mission),
// the message IDs of its briefing and of what its agent says, and never asks
// the server for them.
//
// This needs a 64-bit Python 3 on the machine to host the client's Python
// (EVEJS_PYTHON, "python" when unset). Without one, or without a client, a
// table is not available and its rows are null; nothing here throws for that.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { readResourceIndex } = require("./clientWords");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "client-built-data.py");
const LOAD_TIMEOUT_MS = 60_000;
// A table is a megabyte or two of JSON; the largest of the client's is far below this.
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

// The tables read here: the name each goes by, the client's loader for it, and its resource (in lower case, as
// the index is kept).
const TABLES = Object.freeze({
  missions: Object.freeze({ loader: "missionsLoader", resource: "res:/staticdata/missions.fsdbinary" }),
  // An NPC corporation's own record: the client takes an agent's faction from its corporation's (npcs/npccorporations.py).
  npcCorporations: Object.freeze({ loader: "npcCorporationsLoader", resource: "res:/staticdata/npccorporations.fsdbinary" }),
  // The divisions agents work in, each with the message its name is (npcs/divisions.py).
  npcCorporationDivisions: Object.freeze({ loader: "npcCorporationDivisionsLoader", resource: "res:/staticdata/npccorporationdivisions.fsdbinary" }),
});

/** Runs the client's loader on a data file and answers what it printed. */
function runLoader({ python, binFolder, loader, dataFile, timeoutMs = LOAD_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      python,
      [SCRIPT, binFolder, loader, dataFile],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const said = String(stderr || "").trim().split(/\r?\n/).pop() || error.message;
          reject(new Error(`The client's ${loader} could not be run: ${said}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * The client's built data, read from `clientRoot` (the folder holding `tq` and
 * `ResFiles`) a table at a time, each when first asked for.
 *
 *   available()         whether there is a client to read at all
 *   table(name)         Promise of the whole table, an object by key; or null when it cannot be read
 *   lookup(name, key)   Promise of {available, row}: whether the table could be read, and its row or null
 *   status()            {available, python, tables: {name: {loaded, rows, error}}}
 */
function createClientBuiltData({
  clientRoot = null,
  python = "python",
  tables = TABLES,
  readFile = fs.readFileSync,
  run = runLoader,
  onError = () => {},
} = {}) {
  // name -> Promise of the table or null. One read for each table, whoever asks and however many at once.
  const reads = new Map();
  const state = new Map();

  const available = () => Boolean(clientRoot);

  async function read(name) {
    const described = tables[name];
    const index = readResourceIndex(readFile(path.join(clientRoot, "tq", "resfileindex.txt"), "utf8"));
    const relative = index.get(described.resource);
    if (!relative) throw new Error(`The client's index has no ${described.resource}.`);
    const printed = await run({
      python,
      binFolder: path.join(clientRoot, "tq", "bin64"),
      loader: described.loader,
      dataFile: path.join(clientRoot, "ResFiles", relative),
    });
    const table = JSON.parse(printed);
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      throw new Error(`The client's ${described.loader} did not print a table.`);
    }
    return table;
  }

  function table(name) {
    if (!available() || !Object.hasOwn(tables, name)) return Promise.resolve(null);
    if (!reads.has(name)) {
      reads.set(name, read(name).then(
        (loaded) => {
          state.set(name, { loaded: true, rows: Object.keys(loaded).length, error: null });
          return loaded;
        },
        (error) => {
          // Kept: a client or a Python that is not there will not be there on the next request either.
          state.set(name, { loaded: false, rows: 0, error: String((error && error.message) || error) });
          onError(error);
          return null;
        },
      ));
    }
    return reads.get(name);
  }

  return {
    available,
    table,
    async lookup(name, key) {
      const loaded = await table(name);
      if (!loaded) return { available: false, row: null };
      const row = Object.hasOwn(loaded, String(key)) ? loaded[String(key)] : null;
      return { available: true, row };
    },
    status() {
      const out = {};
      for (const name of Object.keys(tables)) {
        out[name] = state.get(name) || { loaded: false, rows: 0, error: null };
      }
      return { available: available(), python, tables: out };
    },
  };
}

module.exports = { createClientBuiltData, runLoader, TABLES };
