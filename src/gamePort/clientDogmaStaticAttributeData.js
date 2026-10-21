"use strict";

// The five actual dogma.data definition helpers consumed by LoadAttributes.
// Installed row fields/order come from godmaAttributeData's complete loader
// projection. Native cFSD wrapper lifetime: cdxclientstaticrunagent1-identity.
const { createClientDogmaValueCollections } = require("./clientDogmaValueCollections");
const { initializeClientDogmaStaticLoadAttributes } = require("./clientDogmaStaticLoadAttributes");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);

/** Each instance belongs to ONE emulated client's static helper namespace.
 * Async ready prepares local installed definitions/constants, not service Run.
 * Row objects are internal projected records, never native cFSD objects or
 * marshalled values. Source get/iteration creates a fresh wrapper per access;
 * helper dicts retain those wrappers. No writable FSD map/general coercion,
 * native 30-hour expiry, loader reload/signals or full-service readiness. */
function createClientDogmaStaticAttributeData({ attributeData, constants } = {}) {
  if (!attributeData || typeof attributeData.ready !== "function" || typeof attributeData.byID !== "function" || typeof constants !== "function") {
    throw new TypeError("Installed ordered definitions and constant reader are required.");
  }
  const values = createClientDogmaValueCollections(), names = createClientDogmaValueCollections({ allowASCIIKeys: true });
  let sourceMap = null, constantValues = null, pending = null;
  let byName = null, byCategory = null, charged = null;
  function prepared() {
    if (sourceMap === null || constantValues === null) throw notReady("installed static definition helpers/constants");
  }
  const wrap = row => Object.freeze({ ...row });
  function numeric(key) {
    if (typeof key === "bigint" && key >= BigInt(Number.MIN_SAFE_INTEGER) && key <= BigInt(Number.MAX_SAFE_INTEGER)) key = Number(key);
    if (!Number.isSafeInteger(key)) throw notReady("normalized installed attribute ID");
    return key;
  }
  function missing(key) {
    // Use the same actual missing-key class/args policy as numeric maps.
    return values.map().at(key);
  }
  function loaderView(rows) {
    const get = (key, fallback = null) => { const row = rows.get(numeric(key)); return row === undefined ? fallback : wrap(row); };
    return Object.freeze({
      get, has: key => rows.has(numeric(key)),
      at(key) { const row = rows.get(numeric(key)); return row === undefined ? missing(key) : wrap(row); },
      get size() { return rows.size; },
      iterkeys: () => rows.keys(),
      *itervalues() { for (const row of rows.values()) yield wrap(row); },
      *iteritems() { for (const [key, row] of rows) yield [key, wrap(row)]; },
      [Symbol.iterator]: () => rows.keys(),
    });
  }
  function getAllAttributesByID() { prepared(); return sourceMap; }
  function getAllAttributesByName() {
    prepared();
    if (byName === null) {
      const result = names.map();
      for (const row of sourceMap.itervalues()) result.set(row.name, row);
      byName = result;
    }
    return byName;
  }
  function getAttributeListByDataType() {
    prepared();
    if (byCategory === null) {
      const result = values.map();
      for (const row of sourceMap.itervalues()) {
        if (!Number.isSafeInteger(row.dataType)) throw notReady("installed numeric attribute data type");
        if (!result.has(row.dataType)) result.set(row.dataType, [row]);
        else result.at(row.dataType).push(row);
      }
      byCategory = result;
    }
    return byCategory;
  }
  function isCharged(row) {
    if (!Number.isSafeInteger(constantValues.attributeDataTypeTypeDamage) || !Number.isSafeInteger(row.dataType)) throw notReady("installed charge attribute data type");
    const id = row.chargeRechargeTimeID;
    if (id !== null && !Number.isSafeInteger(id)) throw notReady("installed charge recharge identity");
    return id !== null && id !== 0 && row.dataType !== constantValues.attributeDataTypeTypeDamage;
  }
  function getChargeRechargeTimeAttributesByID() {
    prepared();
    if (charged === null) {
      const result = values.map();
      for (const row of sourceMap.itervalues()) if (isCharged(row)) result.set(row.attributeID, row);
      charged = result;
    }
    return charged;
  }
  function getAttributesByChargeRechargeTimeID() {
    prepared();
    const result = values.map({ defaultFactory: () => [] });
    for (const row of sourceMap.itervalues()) if (isCharged(row)) result.at(row.chargeRechargeTimeID).push(row);
    return result; // This helper has NO Memoize decorator.
  }
  const data = Object.freeze({ getAllAttributesByID, getAllAttributesByName, getAttributeListByDataType, getChargeRechargeTimeAttributesByID, getAttributesByChargeRechargeTimeID });
  async function load() {
    await attributeData.ready();
    const loadedConstants = await constants();
    if (!loadedConstants || typeof loadedConstants !== "object") throw notReady("installed static attribute constants");
    const rows = attributeData.byID();
    for (const [id, row] of rows) {
      if (!Number.isSafeInteger(id) || row.attributeID !== id || typeof row.name !== "string" || !/^[\x00-\x7f]*$/.test(row.name)) throw notReady("installed numeric/ASCII definition records");
    }
    sourceMap = loaderView(rows);
    constantValues = loadedConstants;
    return api;
  }
  const api = Object.freeze({
    ready() {
      if (sourceMap !== null && constantValues !== null) return Promise.resolve(api);
      if (pending !== null) return pending;
      const reading = Promise.resolve().then(load);
      pending = reading;
      const forget = () => { if (pending === reading) pending = null; };
      reading.then(forget, forget);
      return reading;
    },
    data,
    loadAttributes(world) { prepared(); return initializeClientDogmaStaticLoadAttributes(world, { data, constants: constantValues, valueCollections: values }); },
    // Coordinator prerequisite only: reproduces these memoized helper clears,
    // not DogmaAttributes resource replacement or the full refresh_dogma pass.
    clearMemoized() { byName = null; byCategory = null; charged = null; },
  });
  return api;
}

module.exports = { createClientDogmaStaticAttributeData };
