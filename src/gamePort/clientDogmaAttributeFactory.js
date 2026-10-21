"use strict";

const { ClientDogmaAttribute } = require("./clientDogmaAttribute");

class ClientDogmaAttributeClassNotReadyError extends Error {
  constructor(attributeID, className) {
    super(`Native ${className} is not ready for attribute ${String(attributeID)}.`);
    this.name = "ClientDogmaAttributeClassNotReadyError";
    this.attributeID = attributeID;
    this.className = className;
  }
}

function numericKey(value) {
  if (typeof value === "bigint") return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  if (Number.isSafeInteger(value)) return value;
  throw new TypeError("A normalized numeric attribute ID is required.");
}

// A supplied Map may spell a safe key as Number or BigInt. Native int/long
// dictionary keys alias. Retain the live backing map; do not snapshot base
// inputs and lose changes made before a later lazy construction.
function baseRecordFor(attributes, key) {
  if (!attributes) return null;
  const alternate = typeof key === "number" ? BigInt(key) : key;
  const canonicalPresent = attributes.has(key), alternatePresent = alternate !== key && attributes.has(alternate);
  if (canonicalPresent && alternatePresent) throw new TypeError("Base attributes contain duplicate Python numeric keys.");
  return canonicalPresent ? attributes.get(key) : alternatePresent ? attributes.get(alternate) : null;
}

function definitionField(definition, name) {
  if (!Object.hasOwn(definition, name)) {
    const error = new Error(`Installed attribute ${definition.attributeID} has no ${name} field.`);
    error.name = "AttributeError"; throw error;
  }
  return definition[name];
}

/** NewItemAttributeFactory23-47, after get_safe_dogma_identity. This internal
 * seam accepts already normalized numeric IDs, as Base.Load supplies them.
 * String/custom-object int conversion belongs to the caller's identity seam;
 * accepting a raw string here would also change keydefaultdict publication.
 * Definitions/type values/world links must be ready synchronously. */
function createClientDogmaAttributeFactory({ item, world, attributeData, baseAttributes = null, constructors = new Map() }) {
  const itemReference = world.collections.weak(item);

  function GetAttributeInstance(attributeID) {
    attributeID = numericKey(attributeID);
    const definition = attributeData.definitionByID(attributeID);
    if (!definition) {
      const error = new Error(`Unknown dogma attribute ${String(attributeID)}.`);
      error.name = "KeyError"; error.key = attributeID; throw error;
    }
    const baseRecord = baseRecordFor(baseAttributes, attributeID);
    const id = definition.attributeID;
    // get_charge_recharge_time_attributes_by_id491-492 excludes datatype8.
    // Never replace a selected nonplain class by a plain scalar object.
    const className = id === 280 ? "SkillLevelAttribute" :
      definitionField(definition, "chargeRechargeTimeID") && definitionField(definition, "dataType") !== 8 ? "ChargedAttribute" :
      [1175, 1176, 1177].includes(id) ? "HeatAttribute" :
      !definitionField(definition, "stackable") ? "StackingNurfedAttribute" :
      id === 2358 ? "SecurityModifierAttribute" :
      id === 2729 ? "TiDiSensitiveAttribute" : "Attribute";
    const Constructor = className === "Attribute" ? ClientDogmaAttribute : constructors.get(className);
    if (!Constructor) throw new ClientDogmaAttributeClassNotReadyError(id, className);
    // SecurityModifierAttribute has no supplied-base argument in the original
    // factory. Class adapters receive that distinction explicitly.
    const input = { attributeID: id, itemReference, world, definition };
    if (className !== "SecurityModifierAttribute") input.baseRecord = baseRecord;
    return new Constructor(input);
  }

  return Object.freeze({ GetAttributeInstance });
}

/** keydefaultdict.__missing__: publish ONLY after successful factory return.
 * Recursive cap/floor construction and partial dependency side effects are
 * deliberately retained when a later constructor step throws. A recursive
 * request for the same unpublished key is not replaced by a scalar/cycle
 * fallback. This map alone neither admits nor loads an item. */
function createClientDogmaLazyAttributes(factory) {
  const values = new Map();
  return Object.freeze({
    get(attributeID) {
      attributeID = numericKey(attributeID);
      if (values.has(attributeID)) return values.get(attributeID);
      const attribute = factory.GetAttributeInstance(attributeID);
      values.set(attributeID, attribute);
      return attribute;
    },
    has: attributeID => values.has(numericKey(attributeID)),
    // Inspection only. No native consumer may infer Python dictionary
    // traversal from this JS iterator; port that consumer's collection first.
    entries: () => values.entries(),
    get size() { return values.size; },
  });
}

module.exports = { createClientDogmaAttributeFactory, createClientDogmaLazyAttributes, ClientDogmaAttributeClassNotReadyError };
