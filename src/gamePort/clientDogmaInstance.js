"use strict";

const { getDecodedNumberKind } = require("../gameProtocol/marshal");

// Original Base.GetAttributesByIndex1200-1201 / dogma.const1747-1753.
// Slot zero is the item ID, not a value to overlay on an attribute.
const INSTANCE_ATTRIBUTES = Object.freeze([2, 3, 18, 276, 266, 264, 1168]);
const ZERO = Object.freeze({ value: 0, kind: Object.freeze({ kind: "integer", pythonType: "int", source: "client-instance-missing-item" }) });
const sourceRecord = (value, kind) => Object.freeze({ value, kind });

function numericKey(value) {
  return typeof value === "bigint" && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
}

/** Native GetInstance417-429. `cache()` is the actual temporary activation
 * cache, installed by MakeShipActive and cleared by its own continuation.
 * A hit returns the original row object unchanged. A miss reads one genuine
 * godma wrapper and its NAME attributes at that moment; it makes no RPC and
 * does not use inventory/GetAllInfo rows to admit or seed loaded nodes.
 * Providers are synchronous and ready. Explicit null means known absence;
 * undefined never silently supplies the None/getattr-default branch. */
function createClientDogmaInstanceSource({ cache, attributeData, godmaItem, readNamedAttributeRecord, itemIdentityRecord }) {
  const generated = new WeakSet();

  function GetInstance(item) {
    const id = numericKey(item.itemID), instances = cache();
    if (instances.has(id)) return instances.get(id);
    const row = [itemIdentityRecord(item)];
    const wrapper = godmaItem(item.itemID);
    if (wrapper === undefined) {
      const error = new Error("Native instance construction requires a ready godma item lookup.");
      error.name = "ClientDogmaInstanceNotReadyError"; throw error;
    }
    for (const attributeID of INSTANCE_ATTRIBUTES) {
      // Native evaluates the installed name even in getattr(None,name,0).
      const definition = attributeData.definitionByID(attributeID);
      if (!definition) {
        const error = new Error(`Unknown instance attribute ${attributeID}.`);
        error.name = "KeyError"; error.key = attributeID; throw error;
      }
      const value = wrapper === null ? ZERO : readNamedAttributeRecord(wrapper, definition.name);
      if (value === undefined) {
        const error = new Error(`Native instance attribute ${definition.name} is not ready.`);
        error.name = "ClientDogmaInstanceNotReadyError"; throw error;
      }
      row.push(value);
    }
    generated.add(row);
    return row;
  }

  function recordAt(row, index) {
    if (!Number.isInteger(index) || index < 0 || index > 7) throw new RangeError("A native instance row index from zero through seven is required.");
    if (generated.has(row)) return row[index];
    // Actual decoded packed-row values carry DBTYPE source sidecars. Do not
    // impose this cached-row schema on later NAME-getter/default results:
    // those may have DIFFERENT numeric classes for the same slot.
    if (!row || !Array.isArray(row.values) || row.values.length !== 8 || !Object.hasOwn(row.values, index)) {
      throw new TypeError("A genuine decoded eight-field native instance row is required.");
    }
    const value = row.values[index], kind = getDecodedNumberKind(row.values, index);
    if (typeof value !== "boolean" && value !== null && kind === undefined) {
      const error = new Error(`Native instance source kind ${index} is unavailable.`);
      error.name = "ClientDogmaInstanceNotReadyError"; throw error;
    }
    return sourceRecord(value, kind);
  }

  return Object.freeze({ GetInstance, recordAt });
}

module.exports = { createClientDogmaInstanceSource, INSTANCE_ATTRIBUTES };
