"use strict";

// dogma.data255-305: type overrides plus physical attributes, followed by the
// by-ID definition default. This supplies local TYPE values for attribute
// construction, not godma's NAME cache default or a loaded item's GetValue.
// cdxnodestaticagent2: all 643235 raw values and 52591 types' physical fields
// are actual Python floats in build3396210. This is current installed-corpus
// provenance, not inferred from JS integrality or a future schema guarantee.
const { orderEntries } = require("./py27");
const { TypeNotFoundException } = require("./godmaTypeNames");
const TYPE_KIND = Object.freeze({ kind: "real", source: "installed-type-dogma" });
const PHYSICAL_KIND = Object.freeze({ kind: "real", source: "installed-type-physical" });
const DEFAULT_KIND = Object.freeze({ kind: "real", source: "installed-dogma-default" });
const record = (value, kind) => Object.freeze({ value, kind });

class ClientDogmaStaticAttributesNotReadyError extends Error {
  constructor(typeID) {
    super(`Installed dogma type attributes ${String(typeID)} are not ready; await ready(typeID).`);
    this.name = "ClientDogmaStaticAttributesNotReadyError";
    this.typeID = typeID;
  }
}

function identity(value) {
  if (typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) value = Number(value);
  if (!Number.isSafeInteger(value)) throw new TypeError("A safe integer dogma identity is required.");
  return value;
}

/** Readers return actual clientBuiltData rows: null means known absent,
 * undefined means unavailable. Preparation performs no server calls or item
 * admission. A failed read leaves this type cold and permits another attempt;
 * underlying clientBuiltData failure caching remains its own policy. */
function createClientDogmaStaticAttributes({ attributeData, typeDogma, types } = {}) {
  if (!attributeData || typeof attributeData.ready !== "function" || typeof attributeData.definitionByID !== "function" ||
      typeof typeDogma !== "function" || typeof types !== "function") {
    throw new TypeError("Installed attribute definitions, typeDogma and type readers are required.");
  }
  const held = new Map(), pending = new Map();

  function prepared(typeID) {
    const id = identity(typeID);
    if (!held.has(id)) throw new ClientDogmaStaticAttributesNotReadyError(id);
    return held.get(id);
  }

  function physical(row, field, typeID) {
    // Every physical field exists in this installed corpus. A missing field
    // is not explicit None. evetypes.GetRadius363 uses float(radius or 1.0);
    // the other three use float(value), where None raises instead of becoming
    // JavaScript zero. Numeric fields are the verified current loader outputs;
    // this is not a general Python float(string/bool) conversion utility.
    if (!Object.hasOwn(row, field)) {
      const error = new Error(`Installed type ${typeID} has no ${field} attribute.`);
      error.name = "TypeAttributeNotFoundException"; throw error;
    }
    let value = row[field];
    if (field === "radius" && (value === null || value === 0)) value = 1;
    if (typeof value !== "number") throw new TypeError(`Installed type ${typeID} ${field} cannot be converted to a float.`);
    return record(value, PHYSICAL_KIND);
  }

  async function load(id) {
    await attributeData.ready();
    const row = await typeDogma(id);
    if (row === undefined) throw new ClientDogmaStaticAttributesNotReadyError(id);
    const entries = [];
    if (row !== null) {
      if (!row || typeof row !== "object" || !Array.isArray(row.dogmaAttributes)) throw new TypeError(`Installed typeDogma ${id} has no attribute relation list.`);
      for (const relation of row.dogmaAttributes) {
        if (!relation || typeof relation !== "object" || !Object.hasOwn(relation, "value") || typeof relation.value !== "number") throw new TypeError(`Installed typeDogma ${id} has an invalid attribute value.`);
        entries.push([identity(relation.attributeID), record(relation.value, TYPE_KIND)]);
      }
    }
    const type = await types(id);
    if (type === undefined) throw new ClientDogmaStaticAttributesNotReadyError(id);
    if (type === null) throw new TypeNotFoundException(id);
    if (typeof type !== "object" || Array.isArray(type)) throw new TypeError(`Installed type ${id} is malformed.`);
    // These are appended AFTER raw rows, so physical values win duplicate IDs.
    for (const [attributeID, field] of [[4, "mass"], [38, "capacity"], [161, "volume"], [162, "radius"]]) {
      entries.push([attributeID, physical(type, field, id)]);
    }
    // get_type_attributes_by_id and BaseDogmaLocation.GetAttributesForItem
    // each build one dictionary from the raw-then-physical list. The separate
    // get_type_attribute_values_by_id helper would build a SECOND dictionary;
    // its traversal is not the item loader's traversal.
    const ordered = orderEntries(entries);
    const rows = new Map(ordered);
    const snapshot = Object.freeze(ordered.map(([attributeID, value]) => Object.freeze([attributeID, value])));
    held.set(id, { rows, snapshot });
    return api;
  }

  function ready(typeID) {
    const id = identity(typeID);
    if (held.has(id)) return Promise.resolve(api);
    if (pending.has(id)) return pending.get(id);
    const reading = Promise.resolve().then(() => load(id));
    pending.set(id, reading);
    const forget = () => { if (pending.get(id) === reading) pending.delete(id); };
    reading.then(forget, forget);
    return reading;
  }

  const api = {
    ready,
    isReady: typeID => held.has(identity(typeID)),
    entries: typeID => prepared(typeID).snapshot,
    record(typeID, attributeID) {
      const { rows } = prepared(typeID), id = identity(attributeID);
      const override = rows.get(id);
      if (override !== undefined && override.value !== null) return override;
      // This is by ID, including duplicate-name definitions. Native godma's
      // by-NAME default is a separate provider and must not be substituted.
      const definition = attributeData.definitionByID(id);
      if (!definition) {
        const error = new Error(`Unknown dogma attribute ${id}.`);
        error.name = "KeyError"; error.key = id; throw error;
      }
      return record(definition.defaultValue, definition.defaultValue === null ? undefined : DEFAULT_KIND);
    },
  };
  return api;
}

module.exports = { createClientDogmaStaticAttributes, ClientDogmaStaticAttributesNotReadyError };
