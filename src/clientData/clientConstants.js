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
const DOGMA_STATIC_ATTRIBUTE_NAMES = Object.freeze([
  "dgmAttrCatGroup", "dgmAttrCatType", "attributeDataTypeTypeDamage",
  "attributeHiSlots", "attributeHiSlotModifier", "attributeMedSlots", "attributeMedSlotModifier",
  "attributeLowSlots", "attributeLowSlotModifier", "attributeTurretSlotsLeft", "attributeTurretHardpointModifier",
  "attributeLauncherSlotsLeft", "attributeLauncherHardPointModifier", "attributeShieldCharge",
  "attributeShieldCapacity", "attributeShieldUniformity", "attributeArmorDamage", "attributeArmorHP",
  "attributeArmorUniformity", "attributeDamage", "attributeHp", "attributeStructureUniformity",
  ...["Shield", "Armor", ""].flatMap(layer => ["Em", "Explosive", "Kinetic", "Thermal"].map(damage => `attribute${layer}${damage}DamageResonance`)),
  "attributeEmDamage", "attributeExplosiveDamage", "attributeKineticDamage", "attributeThermalDamage",
]);

// What is read here: the name each set goes by, the module of the client's code it is in, and the names in it.
// A module that imports others is `given` those it uses while it is run, from the same archive and in the
// order they need each other, and has the ones it does not use stood in for (`stubs`).
const CONSTANTS = Object.freeze({
  // BaseDogmaStaticSvc.LoadAttributes79-147 and dogma.data's charge filter.
  dogmaStaticAttributes: Object.freeze({
    module: "dogma/const.pyj",
    given: Object.freeze([Object.freeze(["inventorycommon.const", "inventorycommon/const.pyj"])]),
    names: DOGMA_STATIC_ATTRIBUTE_NAMES,
  }),
  chatRoles: Object.freeze({ module: "carbon/common/script/sys/serviceConst.pyj", names: Object.freeze(["ROLE_CHTADMINISTRATOR", "ROLE_GML", "ROLE_LEGIONEER"]) }),
  chatOwnerGroup: Object.freeze({ module: "inventorycommon/const.pyj", names: Object.freeze(["groupCharacter"]) }),
  corporationRoleLocations: Object.freeze({
    module: "eve/common/lib/appConst.pyj",
    given: Object.freeze([
      Object.freeze(["carbon.common.lib.const", "carbon/common/lib/const.pyj"]),
      Object.freeze(["inventorycommon.const", "inventorycommon/const.pyj"]),
      Object.freeze(["dogma.const", "dogma/const.pyj"]),
    ]),
    stubs: Object.freeze(["collections", "eveuniverse.security"]),
    empty: Object.freeze(["eve.common.lib.infoEventConst", "crimewatch.const", "eveexceptions.const", "probescanning.const", "eve.common.script.util.notificationconst", "evefleet.const", "marketutil.const"]),
    names: Object.freeze(["locationalCorpRoles"]),
  }),
  configSynonyms: Object.freeze({ module: "monolithconfig/synonyms.pyj", names: Object.freeze(["ENABLED"]) }),
  packagedVolumes: Object.freeze({
    module: "inventorycommon/const.pyj",
    names: Object.freeze(["packagedVolumeOverridesPerGroup", "packagedVolumeOverridesPerType", "typePlasticWrap"]),
  }),
  // Each hold's flag and the attribute its capacity is (inventoryFlagsCommon.py), and what the client's
  // inventory tree goes by to say which holds a ship has (treeData.py 300 to 363).
  holdAttributes: Object.freeze({
    module: "eve/common/script/util/inventoryFlagsCommon.pyj",
    given: Object.freeze([Object.freeze(["inventorycommon.const", "inventorycommon/const.pyj"]), Object.freeze(["dogma.const", "dogma/const.pyj"])]),
    stubs: Object.freeze(["evetypes", "eveexceptions.const"]),
    names: Object.freeze([
      "inventoryFlagData", "dogma.const.attributeHasShipMaintenanceBay", "dogma.const.attributeHasFleetHangars", "inventorycommon.const.groupStrategicCruiser",
      "inventorycommon.const.flagCargo", "inventorycommon.const.flagDroneBay", "inventorycommon.const.flagShipHangar", "inventorycommon.const.flagFleetHangar",
    ]),
  }),
  // The owners' logos the client draws from its own tables (eveIconConst.py, eveIcon.LogoIcon): a faction's large
  // (IN_ICONS, else IN_CORP_ICONS) and small (IN_SMALL_ICONS), and an NPC corporation's (CORP_ICONS), each an icon
  // number. The module's RACE_ICONS is keyed by appConst's races, which is stood in for: it is not read.
  ownerLogos: Object.freeze({
    module: "eve/client/script/ui/const/eveIconConst.pyj",
    stubs: Object.freeze(["eve.common.lib.appConst"]),
    names: Object.freeze(["IN_ICONS", "IN_CORP_ICONS", "IN_SMALL_ICONS", "CORP_ICONS"]),
  }),
  // A player corporation's logo library (appConst.py: graphicCorpLogoLibShapes, graphicCorpLogoLibColors and their
  // blends), which eveIcon.CorpIcon draws its three layers by. appConst takes everything from a dozen modules; the
  // three whose names it uses while it is run are given, the rest are empty.
  corpLogoLibrary: Object.freeze({
    module: "eve/common/lib/appConst.pyj",
    given: Object.freeze([
      Object.freeze(["carbon.common.lib.const", "carbon/common/lib/const.pyj"]),
      Object.freeze(["inventorycommon.const", "inventorycommon/const.pyj"]),
      Object.freeze(["dogma.const", "dogma/const.pyj"]),
    ]),
    stubs: Object.freeze(["collections", "eveuniverse.security"]),
    empty: Object.freeze([
      "eve.common.lib.infoEventConst", "crimewatch.const", "eveexceptions.const", "probescanning.const",
      "eve.common.script.util.notificationconst", "evefleet.const", "marketutil.const",
    ]),
    names: Object.freeze([
      "graphicCorpLogoLibShapes", "graphicCorpLogoLibNoShape", "graphicCorpLogoLibColors",
      "CORPLOGO_BLEND", "CORPLOGO_SOLID", "CORPLOGO_GRADIENT", "CORPLOGO_DEFAULT_COLOR",
    ]),
  }),
});

/** What scripts/client-constants.py is told, after the Python and the script itself. */
function moduleArguments({ binFolder, archive, module, given, stubs, empty = [], names }) {
  return [
    binFolder, archive, module,
    ...given.flatMap(([name, path]) => ["--with", `${name}=${path}`]),
    ...stubs.flatMap((name) => ["--stub", name]),
    ...empty.flatMap((name) => ["--empty", name]),
    ...names,
  ];
}

/** Runs one module of the client's code and answers what it printed of the names asked for. */
function runModule({ python, binFolder, archive, module, given, stubs, empty = [], names, timeoutMs = RUN_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      python,
      [SCRIPT, ...moduleArguments({ binFolder, archive, module, given, stubs, empty, names })],
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

/** A printed table, or an error: an object that is not an array. */
function tableOf(printed, what) {
  if (!printed || typeof printed !== "object" || Array.isArray(printed)) throw new Error(`The client's ${what} is not a table.`);
  return printed;
}

/** A printed table of numbers by ID, as a Map; anything else is not one. */
function numbersByID(printed, what) {
  tableOf(printed, what);
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
      given: (described.given ?? []).map((pair) => [...pair]),
      stubs: [...(described.stubs ?? [])],
      ...(described.empty ? { empty: [...described.empty] } : {}),
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
    dogmaStaticAttributes: () => read("dogmaStaticAttributes", values => {
      for (const name of DOGMA_STATIC_ATTRIBUTE_NAMES) {
        if (!Object.hasOwn(values, name) || !Number.isSafeInteger(values[name])) throw new Error(`The client's ${name} is not an integer constant.`);
      }
      return Object.freeze(Object.fromEntries(DOGMA_STATIC_ATTRIBUTE_NAMES.map(name => [name, values[name]])));
    }),
    chatRules: async () => {
      const [roles, owner] = await Promise.all([
        read("chatRoles", values => {
          const result = {};
          for (const name of ["ROLE_CHTADMINISTRATOR", "ROLE_GML", "ROLE_LEGIONEER"]) {
            const value = values[name];
            if (!Number.isInteger(value) || value <= 0 || (BigInt(value) & (BigInt(value) - 1n)) !== 0n) throw Error("The client's chat role is not a role bit.");
            result[name] = BigInt(value).toString();
          }
          return result;
        }),
        read("chatOwnerGroup", values => Number.isSafeInteger(values.groupCharacter) ? values.groupCharacter : null),
      ]);
      return roles && owner ? { ...roles, groupCharacter: owner } : null;
    },
    corporationRoleLocations: () => read("corporationRoleLocations", (values) => {
      if (!Array.isArray(values.locationalCorpRoles) || !values.locationalCorpRoles.every(Number.isSafeInteger)) throw new Error("The client's locational corporation roles could not be read.");
      return Object.freeze(values.locationalCorpRoles.map(String));
    }),
    packagedVolumes: () => read("packagedVolumes", (values) => {
      if (!Number.isSafeInteger(values.typePlasticWrap) || values.typePlasticWrap <= 0) throw new Error("The client's typePlasticWrap is not a type.");
      return Object.freeze({
        byGroup: numbersByID(values.packagedVolumeOverridesPerGroup, "packagedVolumeOverridesPerGroup"),
        byType: numbersByID(values.packagedVolumeOverridesPerType, "packagedVolumeOverridesPerType"),
        plasticWrapTypeID: values.typePlasticWrap,
      });
    }),
    holdAttributes: () => read("holdAttributes", (values) => {
      const id = (name) => {
        const value = values[name];
        if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`The client's ${name} is not a number to go by.`);
        return value;
      };
      // Of all the client says of a flag (what it is called, what may go in it), its capacity's attribute alone.
      const attributes = Object.entries(tableOf(values.inventoryFlagData, "inventoryFlagData")).map(([flag, described]) => [flag, described.attribute]);
      return Object.freeze({
        byFlag: numbersByID(Object.fromEntries(attributes), "inventoryFlagData"),
        hasShipMaintenanceBay: id("dogma.const.attributeHasShipMaintenanceBay"),
        hasFleetHangars: id("dogma.const.attributeHasFleetHangars"),
        strategicCruiserGroupID: id("inventorycommon.const.groupStrategicCruiser"),
        cargoFlag: id("inventorycommon.const.flagCargo"),
        droneBayFlag: id("inventorycommon.const.flagDroneBay"),
        shipHangarFlag: id("inventorycommon.const.flagShipHangar"),
        fleetHangarFlag: id("inventorycommon.const.flagFleetHangar"),
      });
    }),
    ownerLogos: () => read("ownerLogos", (values) => {
      const iconsByID = (name) => {
        const table = tableOf(values[name], name);
        const out = new Map();
        for (const [key, value] of Object.entries(table)) {
          const id = Number(key);
          if (!Number.isSafeInteger(id) || id <= 0 || typeof value !== "string") throw new Error(`The client's ${name} has an entry that is not an icon by an ID.`);
          out.set(id, value);
        }
        return out;
      };
      return Object.freeze({
        factions: iconsByID("IN_ICONS"),
        factionCorporations: iconsByID("IN_CORP_ICONS"),
        factionsSmall: iconsByID("IN_SMALL_ICONS"),
        corporations: iconsByID("CORP_ICONS"),
      });
    }),
    corpLogoLibrary: () => read("corpLogoLibrary", (values) => {
      const shapes = new Map();
      for (const [key, resPath] of Object.entries(tableOf(values.graphicCorpLogoLibShapes, "graphicCorpLogoLibShapes"))) {
        const id = Number(key);
        if (!Number.isSafeInteger(id) || typeof resPath !== "string") throw new Error("The client's graphicCorpLogoLibShapes has an entry that is not a texture by an ID.");
        shapes.set(id, resPath);
      }
      const colorOf = (value, what) => {
        const [rgba, blend] = Array.isArray(value) ? value : [];
        if (!Array.isArray(rgba) || rgba.length !== 4 || !rgba.every(Number.isFinite) || !Number.isSafeInteger(blend)) throw new Error(`The client's ${what} is not a colour and its blend.`);
        return Object.freeze({ rgba: Object.freeze([...rgba]), blend });
      };
      const colors = new Map();
      for (const [key, value] of Object.entries(tableOf(values.graphicCorpLogoLibColors, "graphicCorpLogoLibColors"))) {
        const id = Number(key);
        if (!Number.isSafeInteger(id)) throw new Error("The client's graphicCorpLogoLibColors has an entry that is not by an ID.");
        colors.set(id, colorOf(value, "graphicCorpLogoLibColors"));
      }
      const whole = (name) => {
        if (!Number.isSafeInteger(values[name])) throw new Error(`The client's ${name} is not a number.`);
        return values[name];
      };
      return Object.freeze({
        shapes,
        noShape: whole("graphicCorpLogoLibNoShape"),
        colors,
        blends: Object.freeze({ blend: whole("CORPLOGO_BLEND"), solid: whole("CORPLOGO_SOLID"), gradient: whole("CORPLOGO_GRADIENT") }),
        defaultColor: colorOf(values.CORPLOGO_DEFAULT_COLOR, "CORPLOGO_DEFAULT_COLOR"),
      });
    }),
    configEnabledValues: () => read("configSynonyms", (values) => {
      if (!Array.isArray(values.ENABLED) || !values.ENABLED.every((value) => typeof value === "string")) throw new Error("The client's enabled config values are not text.");
      return Object.freeze([...values.ENABLED]);
    }),
    status() {
      const out = { available: available(), python };
      for (const name of Object.keys(CONSTANTS)) out[name] = state.get(name) || { loaded: false, error: null };
      return out;
    },
  };
}

module.exports = { CONSTANTS, createClientConstants, moduleArguments, runModule };
