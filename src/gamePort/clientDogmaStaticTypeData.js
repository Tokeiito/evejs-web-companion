"use strict";

// dogma.data.get_type_attributes255-266/has_type_attributes319-321. This is
// the ordered LIST consumed by clientDogmaStaticSvc, not the last-wins by-ID
// dictionary/default producer in clientDogmaStaticAttributes.
const { TypeNotFoundException } = require("./godmaTypeNames");
const RAW_KIND = Object.freeze({ kind: "real", source: "installed-type-dogma" });
const PHYSICAL_KIND = Object.freeze({ kind: "real", source: "installed-type-physical" });
const cell = (value, kind) => Object.freeze({ value, kind });
const physicalFields = Object.freeze([[4, "mass"], [38, "capacity"], [161, "volume"], [162, "radius"]]);

class ClientDogmaStaticTypeDataNotReadyError extends Error {
  constructor(typeID) {
    super(`Installed ordered dogma type data ${String(typeID)} is not ready; await ready(typeID).`);
    this.name = "ClientDogmaStaticTypeDataNotReadyError";
    this.typeID = typeID;
  }
}

function identity(value) {
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) value = Number(value);
  // Explicit installed-row reader domain, not general Python int()/identity
  // coercion. The real reader supports type0; unknown IDs are not empty data.
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("A nonnegative safe integer type identity is required.");
  return value;
}

/** Async preparation makes actual installed inputs available to synchronous
 * native calls. Values are INTERNAL typed cells backed by the complete
 * cdxnodestaticagent2 installed float corpus, not native scalar/wire shapes.
 * No item registration, server request or full static-service readiness.
 * Successful composed lists are immutable prepared snapshots; this does not
 * claim generic @Memoize argument/list mutation/30-hour expiry or reload. */
function createClientDogmaStaticTypeData({ typeDogma, types } = {}) {
  if (typeof typeDogma !== "function" || typeof types !== "function") throw new TypeError("Installed typeDogma and type readers are required.");
  const inputs = new Map(), composed = new Map(), pending = new Map();
  function source(typeID) {
    const id = identity(typeID);
    if (!inputs.has(id)) throw new ClientDogmaStaticTypeDataNotReadyError(id);
    return inputs.get(id);
  }
  function physical(typeID, field) {
    const id = identity(typeID), type = source(id).type;
    if (type === null) throw new TypeNotFoundException(id);
    // evetypes._GetAttributeForType94-100: missing field differs from None.
    if (!Object.hasOwn(type, field)) {
      const error = new Error(`Installed type ${id} has no ${field} attribute.`);
      error.name = "TypeAttributeNotFoundException";
      throw error;
    }
    let value = type[field];
    if (field === "radius" && (value === null || value === 0)) value = 1;
    // Actual current loader fields are floats. Arbitrary Python float(str/
    // bool/custom) coercion is outside this installed-input adapter domain.
    if (typeof value !== "number") throw new TypeError(`Installed type ${id} ${field} cannot be converted to a float.`);
    return cell(value, PHYSICAL_KIND);
  }
  function getTypeAttributes(typeID) {
    const id = identity(typeID);
    if (composed.has(id)) return composed.get(id);
    const { raw } = source(id), rows = raw.slice();
    // Evaluate ALL four physical getters in source order before a caller can
    // scan even the first raw match. Exceptions never cache a composed list.
    for (const [attributeID, field] of physicalFields) rows.push(Object.freeze({ attributeID, value: physical(id, field) }));
    const result = Object.freeze(rows);
    composed.set(id, result);
    return result;
  }
  async function load(id) {
    const dogma = await typeDogma(id);
    if (dogma === undefined) throw new ClientDogmaStaticTypeDataNotReadyError(id);
    const raw = [];
    if (dogma !== null) {
      if (!dogma || typeof dogma !== "object" || !Array.isArray(dogma.dogmaAttributes)) throw new TypeError(`Installed typeDogma ${id} has no ordered attribute list.`);
      for (const row of dogma.dogmaAttributes) {
        if (!row || typeof row !== "object" || !Object.hasOwn(row, "value") || typeof row.value !== "number") throw new TypeError(`Installed typeDogma ${id} has an invalid attribute value.`);
        raw.push(Object.freeze({ attributeID: identity(row.attributeID), value: cell(row.value, RAW_KIND) }));
      }
    }
    const type = await types(id);
    if (type === undefined) throw new ClientDogmaStaticTypeDataNotReadyError(id);
    if (type !== null && (typeof type !== "object" || Array.isArray(type))) throw new TypeError(`Installed type ${id} is malformed.`);
    // Retain known absence separately from successful composition. A failed
    // composition can be demanded again and raises the actual source error;
    // it is neither a ready empty list nor a cached exception.
    inputs.set(id, { raw, type });
    getTypeAttributes(id);
    return api;
  }
  function ready(typeID) {
    const id = identity(typeID);
    if (composed.has(id)) return Promise.resolve(api);
    if (pending.has(id)) return pending.get(id);
    const reading = Promise.resolve().then(() => load(id));
    pending.set(id, reading);
    const forget = () => { if (pending.get(id) === reading) pending.delete(id); };
    reading.then(forget, forget);
    return reading;
  }
  const api = Object.freeze({
    ready,
    isReady: typeID => composed.has(identity(typeID)),
    getTypeAttributes,
    hasTypeAttributes: typeID => getTypeAttributes(typeID).length > 0,
    typeExists: typeID => source(typeID).type !== null,
    getMass: typeID => physical(typeID, "mass"),
    getCapacity: typeID => physical(typeID, "capacity"),
    getVolume: typeID => physical(typeID, "volume"),
  });
  return api;
}

module.exports = { createClientDogmaStaticTypeData, ClientDogmaStaticTypeDataNotReadyError };
