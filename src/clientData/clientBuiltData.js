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
  // The kinds of a wallet journal's entries, each with the message its line is worded by (eveaccounting/data.py
  // get_entry_format_localization_id: entryJournalMessageID), which the client's FmtWalletEntry words it with.
  accountingEntryTypes: Object.freeze({ loader: "accountingEntryTypesLoader", resource: "res:/staticdata/accountingentrytypes.fsdbinary" }),
  // A ship type's group in the client's ship tree (evetypes.GetShipGroupID: the type's isisGroupID), which the Ship
  // Restrictions window groups its hulls by. Only that attribute of the types is read: the table is too big to walk.
  typeShipGroups: Object.freeze({ loader: "typesLoader", resource: "res:/staticdata/types.fsdbinary", attribute: "isisGroupID" }),
  // The objectives the client tracks without asking the server (objectives/common/objectives_data.py): a chain's
  // objectives and its context's parameters, an objective's tasks, a task's own parameters, title and icon. The
  // Abyssal info panel is one chain of them (abyssal_service.py ABYSS_OBJECTIVE_CHAIN_ID).
  objectiveChains: Object.freeze({ loader: "objectiveChainsLoader", resource: "res:/staticdata/objectivechains.fsdbinary" }),
  objectiveTypes: Object.freeze({ loader: "objectiveTypesLoader", resource: "res:/staticdata/objectivetypes.fsdbinary" }),
  objectiveTaskTypes: Object.freeze({ loader: "objectiveTaskTypesLoader", resource: "res:/staticdata/objectivetasktypes.fsdbinary" }),
  // The special effects that are a jump (fsdBuiltData/client/travelEffects.py, by guid): IsTravelEffect.
  travelEffects: Object.freeze({ loader: "travelEffectsLoader", resource: "res:/staticdata/traveleffects.fsdbinary" }),
  // The skills a type needs and at what level, by type (evetypes/skills.py get_dogma_required_skills), which the
  // client's skill service and dogma location walk to say what is missing to fly a ship or use a thing.
  requiredSkillsForTypes: Object.freeze({ loader: "requiredSkillsForTypesLoader", resource: "res:/staticdata/requiredskillsfortypes.fsdbinary" }),
  // A type's base price and whether it is published (evetypes.GetBasePrice and IsPublished): what a skill book bought
  // directly costs (characterskills/common/purchase.py get_direct_purchase_price) and whether it is sold so at all
  // (evetypes.IsSkillAvailableForPurchase). One attribute of the types each, as typeShipGroups is.
  typeBasePrices: Object.freeze({ loader: "typesLoader", resource: "res:/staticdata/types.fsdbinary", attribute: "basePrice" }),
  typePublished: Object.freeze({ loader: "typesLoader", resource: "res:/staticdata/types.fsdbinary", attribute: "published" }),
  // A type's portion size (evetypes.GetPortionSize), by which the market's average falls back to the base price where
  // nothing traded in the week (marketsvc.GetAveragePrice).
  typePortionSizes: Object.freeze({ loader: "typesLoader", resource: "res:/staticdata/types.fsdbinary", attribute: "portionSize" }),
});

// The ship tree's groups (eveCfg.LoadCfgData: fsdlite.EveStorage(data='infoBubbleElements', cache='infoBubbles.static'),
// its infoBubbleGroups), each with its name's message, its icons and more. The cache is an SQLite file of fsdlite's,
// a row of JSON for each of its tables; it is read where it is, as it is.
const INFO_BUBBLES = "res:/staticdata/infobubbles.static";

/** Runs the client's loader on a data file and answers what it printed. */
function runLoader({ python, binFolder, loader, dataFile, attribute = null, timeoutMs = LOAD_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      python,
      [SCRIPT, binFolder, loader, dataFile, ...(attribute ? [attribute] : [])],
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
      ...(described.attribute ? { attribute: described.attribute } : {}),
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

  // The ship tree's groups, once (INFO_BUBBLES): {groupID: {nameID, iconSmall}}, or null where they cannot be read.
  let infoBubbleGroupsRead = null;
  function infoBubbleGroups() {
    if (!available()) return Promise.resolve(null);
    if (!infoBubbleGroupsRead) {
      infoBubbleGroupsRead = Promise.resolve().then(() => {
        const index = readResourceIndex(readFile(path.join(clientRoot, "tq", "resfileindex.txt"), "utf8"));
        const relative = index.get(INFO_BUBBLES);
        if (!relative) throw new Error(`The client's index has no ${INFO_BUBBLES}.`);
        const { DatabaseSync } = require("node:sqlite");
        const database = new DatabaseSync(path.join(clientRoot, "ResFiles", relative), { readOnly: true });
        try {
          const row = database.prepare("SELECT value FROM cache WHERE key = ?").get("infoBubbleGroups");
          const groups = row ? JSON.parse(String(row.value)) : null;
          if (!groups || typeof groups !== "object") throw new Error("The client's ship tree has no groups.");
          const out = {};
          for (const [key, value] of Object.entries(groups)) {
            if (Number(key) > 0 && value && typeof value === "object") {
              out[key] = { nameID: Number(value.nameID) || null, iconSmall: typeof value.iconSmall === "string" ? value.iconSmall : null };
            }
          }
          return out;
        } finally {
          database.close();
        }
      }).catch((error) => {
        onError(error);
        return null;
      });
    }
    return infoBubbleGroupsRead;
  }

  return {
    available,
    table,
    infoBubbleGroups,
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
