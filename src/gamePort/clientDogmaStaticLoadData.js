"use strict";

// Real installed prerequisites for BaseStatic.Load56-77, not Service/Run.
const { createClientDogmaValueCollections } = require("./clientDogmaValueCollections");
const { createClientDogmaStaticTypeValues } = require("./clientDogmaStaticTypeValues");
const { initializeClientDogmaStaticLoadTail } = require("./clientDogmaStaticLoadTail");
const { attributeInteger } = require("./clientDogmaArithmetic");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
const FLOAT_KIND = Object.freeze({ kind: "real", source: "installed-static-load-tail" });
const constantNames = Object.freeze(["groupControlBunker", "attributeFactionID", "categoryModule", "categoryStructureModule", "categoryStarbase"]);

/** Explicit async preparation warms the ACTUAL selected installed rows in
 * batches. It publishes no world fields. The source tail later asks for NEW
 * group/type copies and performs its OWN pops and scalar reads. Preparation
 * failure is a local readiness boundary, not source resource-error ordering.
 * Same immutable prepared type lists feed both first-match lazy lookup and
 * last-wins merged-by-ID helpers; definition defaults are only GetTypeAttribute2.
 * Current source values/defaults are witnessed floats; scalar conversion is
 * explicit provenance, never guessed from JS magnitude or integrality. */
function createClientDogmaStaticLoadData({ groupData, definitionData, typeData, constants, prepareTypeInputs } = {}) {
  if (!groupData || !definitionData || !typeData || typeof constants !== "function" || typeof prepareTypeInputs !== "function") throw new TypeError("Installed group/definition/type readers and batch preparation are required.");
  const values = createClientDogmaValueCollections(), typeValues = createClientDogmaStaticTypeValues({ typeData });
  let constantValues = null, pending = null;
  function prepared() { if (constantValues === null) throw notReady("installed static-load tail inputs"); }
  async function load() {
    await Promise.all([groupData.ready(), definitionData.ready()]);
    const loaded = await constants();
    if (!loaded || constantNames.some(name => !Number.isSafeInteger(loaded[name]))) throw notReady("installed static-load tail constants");
    const selected = new Set(groupData.getTypeIDsByGroup(loaded.groupControlBunker));
    for (const category of [loaded.categoryModule, loaded.categoryStructureModule, loaded.categoryStarbase]) {
      for (const group of groupData.getGroupIDsByCategory(category)) {
        const types = groupData.getTypeIDsByGroup(group);
        if (types.size) selected.add(types.pop());
      }
    }
    const ids = [...selected];
    await prepareTypeInputs(ids);
    await Promise.all(ids.map(id => typeData.ready(id)));
    constantValues = loaded;
    return api;
  }
  const getters = Object.freeze({
    GetTypeAttribute(typeID, attributeID, defaultValue = null) { return typeValues.getTypeAttribute(typeID, attributeID, defaultValue); },
    GetTypeAttribute2(typeID, attributeID) { return typeValues.getTypeAttribute2(this, typeID, attributeID); },
  });
  const providers = {
    getCrystalGroups: () => groupData.getCrystalGroups(),
    getTypeIDsByGroup: id => groupData.getTypeIDsByGroup(id),
    getGroupIDsByCategory: id => groupData.getGroupIDsByCategory(id),
    getChargeGroupAttributeIDs: () => definitionData.data.getChargeGroupAttributeIDs(),
    toInteger(value) {
      // Both actual lazy values and definition defaults in the installed
      // corpus are floats. None retains native int(None)'s failure here.
      if (value !== null && typeof value !== "number") throw notReady("installed float faction value");
      return attributeInteger({ value, kind: FLOAT_KIND }).value;
    },
    get constants() { prepared(); return constantValues; },
    valueCollections: values,
  };
  const api = Object.freeze({
    ready() {
      if (constantValues !== null) return Promise.resolve(api);
      if (pending !== null) return pending;
      const reading = Promise.resolve().then(load); pending = reading;
      const forget = () => { if (pending === reading) pending = null; };
      reading.then(forget, forget); return reading;
    },
    getters, typeValues,
    loadTypeAttributes(world) { return typeValues.loadTypeAttributes(world); },
    loadTail(world) { prepared(); return initializeClientDogmaStaticLoadTail(world, providers); },
  });
  return api;
}

module.exports = { createClientDogmaStaticLoadData };
