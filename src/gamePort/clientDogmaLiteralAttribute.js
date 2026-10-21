"use strict";

// LiteralAttribute is an AttributeInterface, NOT a plain Attribute. No dirty,
// base/type/current, callback, outgoing-state or owner machinery is invented.
// Original literalAttribute10-33/brainLiteralAttribute10-26 and interface24-44;
// cdxctorprimitivesagent1. Values are retained source records, not scalars
// whose Python numeric class is inferred from their integral appearance.
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const { types: { isPromise } } = require("node:util");
const formats = new WeakMap();
const sync = value => {
  // Do not read arbitrary return-object properties: native ignores the target
  // return. Only an actual JS Promise establishes our async-adapter boundary.
  if (isPromise(value)) throw new ClientDogmaConstructorPrimitiveNotReadyError("synchronous literal modifier target");
  return value;
};

class ClientDogmaLiteralAttribute {
  constructor(value, { format } = {}) {
    // Brain's original unpack/skills write PRECEDES the inherited value/item
    // writes. This hook preserves that phase order without a plain Attribute.
    this.value = this._PrepareLiteralValue(value);
    this.item = null;
    if (format !== undefined) formats.set(this, format);
  }

  _PrepareLiteralValue(value) { return value; }
  GetBaseValue() { return this.value; }
  GetValue() { return this.value; }
  AddOutgoingModifier() {} // Genuine source no-ops; no outgoing set is kept.
  RemoveOutgoingModifier() {}
  AddModifierTo(operation, target) {
    this.AddOutgoingModifier(operation, target);
    sync(target.AddIncomingModifier(operation, this));
  }
  RemoveModifierTo(operation, target) {
    this.RemoveOutgoingModifier(operation, target);
    sync(target.RemoveIncomingModifier(operation, this));
  }
  GetIncomingModifiers() { return []; }
  GetOutgoingModifiers() { return []; }
  RemoveAllModifiers() {}
  IsAnOrphan() { return false; }
  CheckIntegrity() { return true; }

  toString() {
    // Native value/list/type-name formatting needs its source-kind/localized
    // providers. No JS object/heap repr is passed off as the client's words.
    const format = formats.get(this);
    if (typeof format !== "function") throw new ClientDogmaConstructorPrimitiveNotReadyError("literal native display");
    const text = format(this);
    if (typeof text !== "string") throw new ClientDogmaConstructorPrimitiveNotReadyError("literal native display projection");
    return text;
  }
  friendlyStr() { return this.toString(); }
  performantStr() { return this.toString(); }
}

class ClientDogmaBrainLiteralAttribute extends ClientDogmaLiteralAttribute {
  constructor(pair, options) {
    super(pair, options);
    this.forceUnnurfed = true;
    this.noPropagation = true;
  }

  _PrepareLiteralValue(pair) {
    // Already-normalized two-element tuple seam only, not generic Python
    // iterable unpacking or tuple-key hashing/caching. Retain BOTH objects.
    if (!Array.isArray(pair) || pair.length !== 2) throw new ClientDogmaConstructorPrimitiveNotReadyError("brain literal pair");
    this.skills = pair[0];
    return pair[1];
  }
}

module.exports = { ClientDogmaLiteralAttribute, ClientDogmaBrainLiteralAttribute };
