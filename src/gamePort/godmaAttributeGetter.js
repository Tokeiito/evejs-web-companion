"use strict";

const { ZeroDivisionError } = require("./godmaChargeValue");
const { GodmaTypeNamesNotReadyError } = require("./godmaTypeNames");

// Numeric GetAttributeValueByID2681-2688 -> GetAttribute1849-1887, build3396210.
// This is not ItemWrapper's computed attributes, tuple sublocations, native
// loaded nodes, GetItem wait channels, or implicit RPC/static-table loading.
class KeyError extends Error {
  constructor(key) { super(`Godma inventory item ${String(key)} is missing.`); this.name = "KeyError"; this.key = key; }
}
class GodmaTypeFactsNotReadyError extends Error {
  constructor(typeID) { super(`Dogma type category ${String(typeID)} is unavailable.`); this.name = "GodmaTypeFactsNotReadyError"; this.typeID = typeID; }
}

function createGodmaAttributeGetter({ data, cacheRecord, inventoryItem, typeFacts, fieldsOf, typeName = () => { throw new GodmaTypeNamesNotReadyError(); }, logException = () => {} }) {
  function record(itemID, attributeID, at) {
    const definition = data.definitionByID(attributeID);
    if (!definition) return Object.freeze({ value: null, kind: undefined });
    // Membership, not truthiness: cached None and zero both precede metadata.
    // The cache itself checks charged membership before scalar membership.
    let cached;
    try {
      cached = cacheRecord(itemID, definition.attributeID, at);
    } catch (error) {
      if (!(error instanceof ZeroDivisionError)) throw error;
      // GetAttribute1858-1867: diagnostic expressions run BEFORE logging and
      // bare-reraise. Their failures deliberately replace the arithmetic error.
      const current = inventoryItem(itemID);
      if (current === null || current === undefined) throw new KeyError(itemID);
      const currentFields = fieldsOf(current);
      if (!currentFields.has("typeID")) throw new TypeError("Godma diagnostic metadata requires typeID.");
      const name = typeName(currentFields.get("typeID"));
      if (typeof name !== "string") throw new TypeError("Godma diagnostic type-name provider must return text synchronously.");
      logException(`GetChargeValue got a ZeroDivisionError for item ${String(itemID)} of type ${name}`, error);
      throw error;
    }
    if (cached !== undefined) return cached;
    const item = inventoryItem(itemID);
    if (item === null || item === undefined) throw new KeyError(itemID);
    const fields = fieldsOf(item);
    if (!fields.has("typeID") || !fields.has("locationID")) throw new TypeError("Godma inventory metadata requires typeID and locationID.");
    const typeID = fields.get("typeID"), categoryID = typeFacts(typeID)?.categoryID;
    if (!Number.isInteger(categoryID)) throw new GodmaTypeFactsNotReadyError(typeID);
    if (categoryID === 16) {
      const error = new Error("StateManager::GetAttribute called for skill item! Skill items should not exist!");
      error.name = "RuntimeError";
      throw error;
    }
    return data.defaultRecordByName(definition.name);
  }
  return { record, value: (itemID, attributeID, at) => record(itemID, attributeID, at).value };
}

module.exports = { createGodmaAttributeGetter, KeyError, GodmaTypeFactsNotReadyError };
