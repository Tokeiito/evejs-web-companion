"use strict";

// ── The retail client's own constants, read by running its code ──────────────
//
// Some of what the retail client knows it neither asks the server nor keeps in
// its data files: it is written into its code. What a packaged ship of each
// group takes up is such a table (inventorycommon/const.py,
// packagedVolumeOverridesPerGroup and ...PerType), and the client reckons what
// is used of a hold from it without a word to the server
// (inventorycommon/util.py GetItemVolume).
//
// So the module is what answers: its compiled code is taken out of the client's
// code archive and run in the client's own python27.dll, on the player's own
// disk, when the constants are first asked for (scripts/client-constants.py).
// Nothing of the client is copied into this repository, and nothing is kept on
// disk.
//
// This needs a 64-bit Python 3 on the machine to host the client's Python
// (EVEJS_PYTHON, "python" when unset). Without one, or without a client, the
// constants are not available and are null; nothing here throws for that.

const childProcess = require("node:child_process");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "client-constants.py");
const RUN_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

// What is read here: the name each set goes by, the module of the client's code it is in, and the names in it.
const CONSTANTS = Object.freeze({
  packagedVolumes: Object.freeze({
    module: "inventorycommon/const.pyj",
    names: Object.freeze(["packagedVolumeOverridesPerGroup", "packagedVolumeOverridesPerType", "typePlasticWrap"]),
  }),
});

/** Runs one module of the client's code and answers what it printed of the names asked for. */
function runModule({ python, binFolder, archive, module, names, timeoutMs = RUN_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      python,
      [SCRIPT, binFolder, archive, module, ...names],
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const said = String(stderr || "").trim().split(/\r?\n/).pop() || error.message;
          reject(new Error(`The client's ${module} could not be run: ${said}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** A printed table of numbers by ID, as a Map; anything else is not one. */
function numbersByID(printed, what) {
  if (!printed || typeof printed !== "object" || Array.isArray(printed)) throw new Error(`The client's ${what} is not a table.`);
  const table = new Map();
  for (const [key, value] of Object.entries(printed)) {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(value)) {
      throw new Error(`The client's ${what} has an entry that is not a number by an ID.`);
    }
    table.set(id, value);
  }
  return table;
}

/**
 * The client's constants, read from `clientRoot` (the folder holding `tq`) a
 * set at a time, each when first asked for.
 *
 *   available()         whether there is a client to read at all
 *   packagedVolumes()   Promise of { byGroup: Map, byType: Map, plasticWrapTypeID }, or null when they cannot be read
 *   status()            { available, python, packagedVolumes: { loaded, error } }
 */
function createClientConstants({ clientRoot = null, python = "python", run = runModule, onError = () => {} } = {}) {
  // name -> Promise of the set or null. One read for each, whoever asks and however many at once.
  const reads = new Map();
  const state = new Map();

  const available = () => Boolean(clientRoot);

  async function printed(name) {
    const described = CONSTANTS[name];
    const said = await run({
      python,
      binFolder: path.join(clientRoot, "tq", "bin64"),
      archive: path.join(clientRoot, "tq", "code.ccp"),
      module: described.module,
      names: [...described.names],
    });
    return JSON.parse(said);
  }

  function read(name, shape) {
    if (!available()) return Promise.resolve(null);
    if (!reads.has(name)) {
      reads.set(name, printed(name).then(shape).then(
        (loaded) => {
          state.set(name, { loaded: true, error: null });
          return loaded;
        },
        (error) => {
          // Kept: a client or a Python that is not there will not be there on the next request either.
          state.set(name, { loaded: false, error: String((error && error.message) || error) });
          onError(error);
          return null;
        },
      ));
    }
    return reads.get(name);
  }

  return {
    available,
    packagedVolumes: () => read("packagedVolumes", (values) => {
      if (!Number.isSafeInteger(values.typePlasticWrap) || values.typePlasticWrap <= 0) throw new Error("The client's typePlasticWrap is not a type.");
      return Object.freeze({
        byGroup: numbersByID(values.packagedVolumeOverridesPerGroup, "packagedVolumeOverridesPerGroup"),
        byType: numbersByID(values.packagedVolumeOverridesPerType, "packagedVolumeOverridesPerType"),
        plasticWrapTypeID: values.typePlasticWrap,
      });
    }),
    status() {
      const out = { available: available(), python };
      for (const name of Object.keys(CONSTANTS)) out[name] = state.get(name) || { loaded: false, error: null };
      return out;
    },
  };
}

module.exports = { CONSTANTS, createClientConstants, runModule };
