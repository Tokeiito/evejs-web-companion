"use strict";

// BaseDogmaStaticSvc193-202, ClientDogmaStaticSvc49-52 and
// dogma.data283-305. One prepared typeData list feeds BOTH native paths:
// last-wins merged row map and first-match lazy lookup. Not full Service/Run.
const { types: { isPromise } } = require("node:util");
const { createClientDogmaValueCollections } = require("./clientDogmaValueCollections");
const { createClientDogmaStaticTypeLookup, ClientDogmaStaticTypeKeyError } = require("./clientDogmaStaticTypeLookup");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
function member(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw notReady(name);
  return object[name];
}
function invoke(receiver, name, args = []) {
  const method = member(receiver, name);
  if (typeof method !== "function") throw notReady(name);
  const value = Reflect.apply(method, receiver, args);
  if (isPromise(value)) throw notReady(`synchronous ${name}`);
  return value;
}
function numericID(value) {
  if (typeof value === "bigint" || (typeof value === "number" && Number.isSafeInteger(value))) return value;
  throw notReady("normalized numeric static type/attribute ID");
}
function scalar(cell) {
  if (cell === null) return null;
  if (isPromise(cell)) throw notReady("synchronous static source cell");
  // Installed typeData explicitly supplies INTERNAL typed cells, not native
  // cFSD scalar objects. Unwrap without reading/inventing their numeric kind.
  const value = member(cell, "value");
  if (value !== null && typeof value !== "number" && typeof value !== "bigint") throw notReady("normalized static source scalar");
  return value;
}

/** typeData is the real prepared composed-list provider used by the lazy
 * lookup too: getTypeAttributes, hasTypeAttributes, typeExists and physical
 * getMass/getCapacity/getVolume. Preparation/ready remains the caller's job;
 * there are no alternate type sources, empty substitutes or swallowed errors.
 *
 * Each instance is ONE prepared-client helper namespace. Successful by-ID
 * maps retain last row objects/cells, native table order and Number/BigInt key
 * aliases. No general Memoize expiry/reload/list-mutation protocol is claimed.
 * Source cells are explicitly supplied internal records, not codec sidecars
 * or an inference from numeric integrality. world.attributes definition rows
 * expose actual scalar defaultValue fields directly. Foreign native KeyError
 * classification is outside this adapter: only the imported authoritative
 * lazy-lookup KeyError triggers definition fallback.
 */
function createClientDogmaStaticTypeValues({ typeData }) {
  const values = createClientDogmaValueCollections();
  const mergedByType = values.map();
  function getTypeAttributesByID(typeID) {
    numericID(typeID);
    if (mergedByType.has(typeID)) return mergedByType.get(typeID);
    const rows = invoke(typeData, "getTypeAttributes", [typeID]);
    if (!Array.isArray(rows)) throw notReady("ordered composed static attribute array");
    // The source obtains the comprehension iterable before entering its
    // private dict-comprehension body/allocating that result dictionary.
    const result = values.map();
    for (const row of rows) result.set(numericID(member(row, "attributeID")), row);
    // Native Memoize stores only a successful complete dict comprehension.
    mergedByType.set(typeID, result);
    return result;
  }
  function getTypeAttribute(typeID, attributeID, defaultValue = null) {
    const merged = getTypeAttributesByID(typeID);
    const row = merged.get(numericID(attributeID));
    // Supported rows are real object records (native row truth is true even
    // when its value is0/None). Never test the scalar's truthiness here.
    if (row === null) return defaultValue;
    return scalar(member(row, "value"));
  }
  function loadTypeAttributes(world) {
    const lookup = createClientDogmaStaticTypeLookup({
      valueCollections: values,
      getTypeAttributes: typeID => invoke(typeData, "getTypeAttributes", [typeID]),
      hasTypeAttributes: typeID => invoke(typeData, "hasTypeAttributes", [typeID]),
      typeExists: typeID => invoke(typeData, "typeExists", [typeID]),
      getMass: typeID => invoke(typeData, "getMass", [typeID]),
      getCapacity: typeID => invoke(typeData, "getCapacity", [typeID]),
      getVolume: typeID => invoke(typeData, "getVolume", [typeID]),
    });
    world.attributesByTypeAttribute = lookup.attributesByTypeAttribute;
    return null;
  }
  function getTypeAttribute2(world, typeID, attributeID) {
    try {
      const inner = invoke(member(world, "attributesByTypeAttribute"), "at", [typeID]);
      const cell = invoke(inner, "at", [attributeID]);
      return scalar(cell);
    } catch (error) {
      if (!(error instanceof ClientDogmaStaticTypeKeyError)) throw error;
      const definition = invoke(member(world, "attributes"), "at", [attributeID]);
      return member(definition, "defaultValue");
    }
  }
  return Object.freeze({ loadTypeAttributes, getTypeAttributesByID, getTypeAttribute, getTypeAttribute2 });
}

module.exports = { createClientDogmaStaticTypeValues };
