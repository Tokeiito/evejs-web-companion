"use strict";

// dogma.data get_all_attributes_by_id/get_all_attributes_by_name: definitions
// retain every ID, while duplicate names overwrite in installed loader order.
// Evidence: cdxattributegetteragent1 and cdxattributealiasagent1. This provider
// supplies identity/definitions only, not cache values or getter/default rules.
class GodmaAttributeDataNotReadyError extends Error {
  constructor(message = "Installed dogma attribute definitions are not ready; await ready().") {
    super(message);
    this.name = "GodmaAttributeDataNotReadyError";
  }
}

class KeyError extends Error {
  constructor(key) {
    super(`Unknown dogma attribute ${String(key)}.`);
    this.name = "KeyError";
    this.key = key;
  }
}

function identity(value) {
  if (typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) value = Number(value);
  if (!Number.isSafeInteger(value)) throw new TypeError("A safe integer dogma attribute identity is required.");
  return value;
}

/** dogmaAttributes() must read clientBuiltData.table("dogmaAttributesOrdered")
 * or supply that same complete table with #order. It may be asynchronous.
 * A rejected/unavailable/malformed read leaves this provider cold and clears
 * its pending read. clientBuiltData.table itself caches loader failures; this
 * layer does not promise to retry that underlying cached failure. */
function createGodmaAttributeData({ dogmaAttributes } = {}) {
  if (typeof dogmaAttributes !== "function") throw new TypeError("An installed ordered dogma attribute reader is required.");
  let definitions = null;
  let pending = null;
  // Original installed dogmaAttributesLoader defaultValue fields are PyFloat
  // for all 2855 definitions (cdxdefaultgetteragent1 native loader oracle).
  // This is static-data provenance, not a marshal opcode or a JS value guess.
  const defaultKind = Object.freeze({ kind: "real", source: "installed-dogma-default" });

  function prepared() {
    if (definitions === null) throw new GodmaAttributeDataNotReadyError();
    return definitions;
  }

  function readDefinitions(table) {
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      throw new GodmaAttributeDataNotReadyError("Installed ordered dogma attribute definitions are unavailable.");
    }
    if (!Object.hasOwn(table, "#order") || !Array.isArray(table["#order"]) || table["#order"].length === 0) {
      throw new TypeError("Installed dogma attribute definitions require a nonempty loader #order.");
    }
    const order = table["#order"];
    if (Object.keys(table).length !== order.length + 1) throw new TypeError("Dogma attribute loader order does not cover the complete table.");
    const byID = new Map(), byName = new Map();
    for (const id of order) {
      if (!Number.isSafeInteger(id) || byID.has(id) || !Object.hasOwn(table, id)) {
        throw new TypeError("Dogma attribute loader order has an invalid, duplicate or missing ID.");
      }
      const row = table[id];
      if (!row || typeof row !== "object" || Array.isArray(row) ||
          !Object.hasOwn(row, "attributeID") || !Number.isSafeInteger(row.attributeID) || row.attributeID !== id ||
          !Object.hasOwn(row, "name") || typeof row.name !== "string" ||
          !Object.hasOwn(row, "defaultValue") || row.defaultValue !== null && !Number.isFinite(row.defaultValue)) {
        throw new TypeError(`Installed dogma attribute ${id} has no valid attributeID, name or defaultValue.`);
      }
      // Preserve all supplied fields, including explicit None/null. Neither
      // aliases nor absent optional fields acquire fabricated defaults here.
      const definition = Object.freeze({ ...row });
      byID.set(id, definition);
      byName.set(definition.name, definition);
    }
    return { byID, byName };
  }

  function ready() {
    if (definitions !== null) return Promise.resolve(api);
    if (pending !== null) return pending;
    const reading = Promise.resolve().then(async () => {
      const loaded = readDefinitions(await dogmaAttributes());
      definitions = loaded;
      return api;
    });
    pending = reading;
    const forget = () => { if (pending === reading) pending = null; };
    reading.then(forget, forget);
    return reading;
  }

  const api = {
    ready,
    isReady: () => definitions !== null,
    name(attributeID) {
      const { byID } = prepared(), id = identity(attributeID);
      if (!byID.has(id)) throw new KeyError(id);
      return byID.get(id).name;
    },
    // Native GetAttributeValueByID uses dict.get, without dogma.data's string
    // identity coercion. Missing/None IDs return before any inventory lookup.
    definitionByID(attributeID) {
      const { byID } = prepared();
      if (typeof attributeID === "boolean") attributeID = Number(attributeID);
      if (typeof attributeID === "bigint") {
        if (attributeID < BigInt(Number.MIN_SAFE_INTEGER) || attributeID > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
        attributeID = Number(attributeID);
      }
      return typeof attributeID === "number" ? byID.get(attributeID) : undefined;
    },
    defaultRecordByName(name) {
      const definition = prepared().byName.get(name);
      if (!definition) throw new KeyError(name);
      return Object.freeze({ value: definition.defaultValue, kind: definition.defaultValue === null ? undefined : defaultKind });
    },
    definitionByName: name => prepared().byName.get(name),
    // Map snapshots prevent callers from replacing the provider's identity
    // definitions. By-name winners share the exact by-ID definition object.
    byID: () => new Map(prepared().byID),
    byName: () => new Map(prepared().byName),
  };
  return api;
}

module.exports = { createGodmaAttributeData, GodmaAttributeDataNotReadyError };
