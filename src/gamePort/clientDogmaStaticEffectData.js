"use strict";

// dogma.data345-486 full definition/type-effect helpers. The ordered inputs
// are actual installed tables, never godmaEffectData's partial warmed cache.
const { createClientDogmaValueCollections } = require("./clientDogmaValueCollections");
const { initializeClientDogmaStaticLoadEffects, initializeClientDogmaStaticLoadTypeEffects } = require("./clientDogmaStaticLoadEffects");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
const wrapper = row => Object.freeze({ ...row });

function ordered(table, part) {
  if (!table || typeof table !== "object" || Array.isArray(table) || !Array.isArray(table["#order"])) throw notReady(`complete ordered ${part}`);
  const ids = table["#order"], seen = new Set();
  if (Object.keys(table).length !== ids.length + 1) throw notReady(`complete ${part} order coverage`);
  return ids.map(id => {
    if (!Number.isSafeInteger(id) || seen.has(id) || !Object.hasOwn(table, id)) throw notReady(`${part} loader identity`);
    seen.add(id);
    return [id, table[id]];
  });
}

/** One emulated client's helper namespace. Source rows/vectors are INTERNAL
 * immutable projected carriers. cdxclientstaticeffectdataagent1 proves native
 * cFSD loader reads AND vector element reads create fresh wrappers: a cached
 * tuple retains its vector, not the relations yielded by later scans.
 * Getter arrays reproduce these demanded accesses, not the native cfsd.list
 * class/GC/general sequence or mutable FSD storage. Successful helper results
 * are memoized separately; no native expiry/resource-reload/Signal claim. */
function createClientDogmaStaticEffectData({ dogmaEffects, typeEffects, constants } = {}) {
  if (typeof dogmaEffects !== "function" || typeof typeEffects !== "function" || typeof constants !== "function") throw new TypeError("Complete ordered effect/type readers and installed constants are required.");
  const values = createClientDogmaValueCollections(), names = createClientDogmaValueCollections({ allowASCIIKeys: true });
  let definitions = null, relations = null, constantValues = null, effectsPending = null, typesPending = null;
  let byID = null, byName = null, tuple = null, byType = null, byEffect = null;
  function effectRows() { if (definitions === null) throw notReady("complete installed effect definitions"); return definitions; }
  function typeRows() { if (relations === null) throw notReady("complete installed type-effect vectors"); return relations; }
  function vector(raw) {
    const result = new Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) Object.defineProperty(result, index, { enumerable: true, get: () => wrapper(raw[index]) });
    return Object.freeze(result);
  }
  function getAllEffectsByID() {
    if (byID === null) {
      const result = values.map();
      for (const [, raw] of effectRows()) { const row = wrapper(raw); result.set(row.effectID, row); }
      byID = result;
    }
    return byID;
  }
  function getAllEffectsByName() {
    if (byName === null) {
      const result = names.map();
      for (const [, raw] of effectRows()) { const row = wrapper(raw); result.set(row.effectName, row); }
      byName = result;
    }
    return byName;
  }
  function getAllTypeIDsAndEffects() {
    if (tuple === null) tuple = Object.freeze(typeRows().map(([id, raw]) => Object.freeze([id, vector(raw)])));
    return tuple;
  }
  function getEffectsIndexedByTypeIDAndEffectID() {
    if (byType === null) {
      const result = values.map();
      for (const [id, rows] of getAllTypeIDsAndEffects()) {
        const indexed = values.map();
        for (const row of rows) indexed.set(row.effectID, row);
        result.set(id, indexed); // Include every empty type vector.
      }
      byType = result;
    }
    return byType;
  }
  function getEffectsIndexedByEffectIDAndTypeID() {
    if (byEffect === null) {
      const result = values.map();
      for (const [id, rows] of getAllTypeIDsAndEffects()) for (const row of rows) {
        if (!result.has(row.effectID)) result.set(row.effectID, values.map());
        result.at(row.effectID).set(id, row);
      }
      byEffect = result;
    }
    return byEffect;
  }
  const data = Object.freeze({ getAllEffectsByID, getAllEffectsByName, getAllTypeIDsAndEffects, getEffectsIndexedByTypeIDAndEffectID, getEffectsIndexedByEffectIDAndTypeID });
  function prepare(which) {
    const effects = which === "effects";
    if (effects ? definitions !== null : relations !== null && constantValues !== null) return Promise.resolve(api);
    const pending = effects ? effectsPending : typesPending;
    if (pending !== null) return pending;
    const reading = Promise.resolve().then(async () => {
      if (effects) {
        const loaded = ordered(await dogmaEffects(), "effect definitions");
        for (const [id, row] of loaded) {
          if (!row || typeof row !== "object" || row.effectID !== id || typeof row.effectName !== "string" || !/^[\x00-\x7f]*$/.test(row.effectName) || !Number.isSafeInteger(row.effectCategory)) throw notReady("installed effect identity/name/category");
        }
        definitions = loaded.map(([id, row]) => [id, wrapper(row)]);
      } else {
        const loaded = ordered(await typeEffects(), "type-effect vectors");
        for (const [, rows] of loaded) {
          if (!Array.isArray(rows)) throw notReady("ordered installed effect relation vector");
          for (const row of rows) if (!row || typeof row !== "object" || !Number.isSafeInteger(row.effectID) || !Number.isSafeInteger(row.isDefault)) throw notReady("installed numeric effect relation");
        }
        const loadedConstants = await constants();
        if (!loadedConstants || typeof loadedConstants !== "object") throw notReady("installed effect constants");
        relations = loaded.map(([id, rows]) => [id, rows.map(wrapper)]);
        constantValues = loadedConstants;
      }
      return api;
    });
    if (effects) effectsPending = reading; else typesPending = reading;
    const forget = () => { if (effects && effectsPending === reading) effectsPending = null; else if (!effects && typesPending === reading) typesPending = null; };
    reading.then(forget, forget);
    return reading;
  }
  const api = Object.freeze({
    prepareEffects: () => prepare("effects"), prepareTypeEffects: () => prepare("types"), data,
    loadEffects: world => initializeClientDogmaStaticLoadEffects(world, { data }),
    loadTypeEffects(world, run) {
      if (constantValues === null) throw notReady("installed effect constants");
      return initializeClientDogmaStaticLoadTypeEffects(world, { data, constants: constantValues, valueCollections: values }, run);
    },
    // Only the original BaseStatic constructor's literal input. This does not
    // run Service.__init__, create a service or initialize a complete world.
    createUnwantedEffects() {
      if (constantValues === null) throw notReady("installed unwanted-effect constants");
      const result = values.map();
      for (const name of ["effectHiPower", "effectLoPower", "effectMedPower", "effectSkillEffect"]) {
        if (!Number.isSafeInteger(constantValues[name])) throw notReady(name);
        result.set(constantValues[name], true);
      }
      return result;
    },
    clearMemoized() { byID = null; byName = null; tuple = null; byType = null; byEffect = null; },
  });
  return api;
}

module.exports = { createClientDogmaStaticEffectData };
