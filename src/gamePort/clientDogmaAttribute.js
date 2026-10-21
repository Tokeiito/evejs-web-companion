"use strict";

// The plain Attribute primitive, not a loaded-node registry or a factory for
// charged/stacking/heat/skill/security/TiDi subclasses. Source values stay
// records throughout; GetValue and callbacks therefore carry records too.
// Original Attribute98-412 / AttributeInterface27-36, executed in
// cdxnodevalueagent1 and cdxattributestateagent1. Collection traversal is an
// explicit identity-domain policy (cdxattributesetsagent1), never JS order.
const {
  applyAttributeOperator, attributeRecordsEqual, minimumAttributeRecord,
  maximumAttributeRecord, attributeInteger, roundAttributeToTwoPlaces,
} = require("./clientDogmaArithmetic");

const PRECEDENCE = Object.freeze([-1, 0, 1, 2, 3, 4, 5, 6, 8, 7]);
const ROUND_TO_TWO = new Set([49, 15, 11, 48, 50, 30]);
const NONE = Object.freeze({ value: null, kind: undefined });
const namedError = (name, message) => Object.assign(new Error(message), { name });
const keyError = key => Object.assign(namedError("KeyError", String(key)), { key });

function field(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) {
    throw namedError("AttributeError", `Object has no ${name} attribute.`);
  }
  return object[name];
}

function call(object, name, ...args) {
  return field(object, name).apply(object, args);
}

function dereference(reference) {
  const object = reference.deref();
  if (object === null || object === undefined) throw new ReferenceError("weakly-referenced object no longer exists");
  return object;
}

function operatorIndex(operation) {
  if (typeof operation === "boolean") operation = Number(operation);
  if (typeof operation === "bigint" && operation >= -1n && operation <= 8n) operation = Number(operation);
  const index = PRECEDENCE.indexOf(operation);
  if (index < 0) throw keyError(operation);
  return index;
}

class ClientDogmaAttribute {
  /** itemReference is the factory's weak item handle. world supplies ready
   * typeAttributeRecord, collections, dogmaItems, callback/admission/client
   * and logging providers. Missing providers fail where originally read;
   * they never silently become an empty modifier world. */
  constructor({ attributeID, baseRecord, itemReference, world, definition }) {
    this.attribID = attributeID;
    this.itemReference = itemReference;
    this.dogmaLM = world;
    this.invItem = field(this.item, "invItem");
    this.typeValue = attributeID === null ? baseRecord ?? NONE : call(world, "typeAttributeRecord", field(this.invItem, "typeID"), attributeID);
    this.baseValue = baseRecord === null || baseRecord?.value === null ? this.typeValue : baseRecord;
    this.incomingModifiers = null;
    this._outgoingModifiers = null;
    this.nonModifyingDependants = null;
    this._onChangeCallbacks = null;
    this.highIsGood = field(definition, "highIsGood");
    this.category = field(definition, "dataType");
    this.currentValue = this.baseValue;
    this.dirty = false;
    if (definition.maxAttributeID) {
      const cap = call(field(this.item, "attributes"), "get", definition.maxAttributeID);
      this.capAttrib = call(field(world, "collections"), "weak", cap);
      call(cap, "AddNonModifyingDependant", this);
    } else this.capAttrib = null;
    if (definition.minAttributeID) {
      const floor = call(field(this.item, "attributes"), "get", definition.minAttributeID);
      this.floorAttrib = call(field(world, "collections"), "weak", floor);
      call(floor, "AddNonModifyingDependant", this);
    } else this.floorAttrib = null;
    this._PickUpInitialModifiers(this.item);
  }

  get item() { return dereference(this.itemReference); }

  IsAnOrphan() {
    try { field(this.item, "invItem"); return false; }
    catch (error) { if (error.name === "ReferenceError") return true; throw error; }
  }

  _PickUpInitialModifiers(item) {
    const location = call(item, "GetLocation");
    if (location) call(location, "_PickUpInitialModifiersFromLocationTo", this);
    const pilotID = call(item, "GetPilot");
    const owner = call(field(this.dogmaLM, "dogmaItems"), "get", pilotID);
    if (owner && call(this.item, "IsOwnerModifiable")) call(owner, "_PickUpInitialModifiersFromOwnerTo", this);
  }

  Update() {
    const previous = this.currentValue;
    let cap = null, floor = null;
    if (this.capAttrib) {
      cap = call(dereference(this.capAttrib), "GetValue");
      this.baseValue = minimumAttributeRecord(this.baseValue, cap);
    }
    if (this.floorAttrib) {
      floor = call(dereference(this.floorAttrib), "GetValue");
      this.baseValue = maximumAttributeRecord(this.baseValue, floor);
    }
    let value = this._ApplyModifierOperationsToVal(this.baseValue);
    if (cap !== null && cap.value !== null) value = minimumAttributeRecord(value, cap);
    if (floor !== null && floor.value !== null) value = maximumAttributeRecord(value, floor);
    if ([10, 11, 12].includes(this.category)) value = attributeInteger(value);
    if (ROUND_TO_TWO.has(this.attribID)) value = roundAttributeToTwoPlaces(value);
    this.currentValue = value;
    this.dirty = false;
    this._PerformCallbacksIfValueChanged(previous);
  }

  _ApplyModifierOperationsToVal(value) {
    // enumerate captures the original tuple, even when a getter replaces the
    // field or removes the final edge. Each set iterator itself remains live.
    const incoming = this.incomingModifiers;
    if (incoming) {
      for (let index = 0; index < incoming.length; index += 1) {
        for (const source of incoming[index]) value = applyAttributeOperator(PRECEDENCE[index], value, call(source, "GetValue"));
      }
    }
    return value;
  }

  GetValue() { if (this.dirty) this.Update(); return this.currentValue; }

  MarkDirty(silent = false) {
    this.dirty = true;
    // Outgoing is a snapshot, dependants are a LIVE native-policy set.
    for (const { reference } of [...(this._outgoingModifiers ?? [])]) {
      try { call(reference.deref(), "MarkDirty"); }
      catch (error) { if (error.name !== "AttributeError") throw error; }
    }
    for (const dependant of this.nonModifyingDependants ?? []) {
      try { call(dependant, "MarkDirty"); }
      catch (error) { if (error.name !== "AttributeError") throw error; }
    }
    if (silent) return;
    let ownerID = null;
    try { ownerID = field(this.item, "ownerID"); }
    catch (error) {
      if (error.name !== "AttributeError") throw error;
      // Native self/vars/sorted formatting can itself fail before logging.
      // The ready world owns that diagnostic adapter; do not invent native
      // object repr/heap addresses or suppress its failure with a short text.
      const log = field(this.dogmaLM, "LogError");
      const diagnostic = call(this.dogmaLM, "FormatMissingOwnerAttribute", this, this.item);
      log.call(this.dogmaLM, diagnostic);
    }
    const itemID = field(this.item, "itemID");
    if (this.ShoulCallbackAttributeChange(itemID, ownerID)) {
      try {
        const previous = this.currentValue, value = this.GetValue();
        const callbacks = field(this.dogmaLM, "attributeChangeCallbacksByAttributeID");
        if (!callbacks.has(this.attribID)) throw keyError(this.attribID);
        callbacks.get(this.attribID)(this.attribID, itemID, value, previous);
      } catch (error) {
        // Native logging rereads the callback key. A self-removal can mask the
        // callback error with KeyError before the log sink is called.
        const callbacks = field(this.dogmaLM, "attributeChangeCallbacksByAttributeID");
        if (!callbacks.has(this.attribID)) throw keyError(this.attribID);
        call(this.dogmaLM, "LogException", `Error broadcasting attribute change ${String(callbacks.get(this.attribID))}`, error);
      }
    }
    if (call(this.dogmaLM, "IsClient")) return;
    if (call(this.dogmaLM, "ShouldMessageItemEvent", itemID)) {
      try { if (this.attribID !== null) call(field(this.dogmaLM, "msgMgr"), "AddAttribute", this); }
      catch (error) { call(this.dogmaLM, "LogException", "Error broadcasting attribute change", error); }
    }
  }

  ShoulCallbackAttributeChange(itemID, ownerID) {
    if (!field(this.dogmaLM, "attributeChangeCallbacksByAttributeID").has(this.attribID)) return false;
    return Boolean(call(this.dogmaLM, "ShouldMessageItemEvent", itemID, ownerID));
  }

  AddCallbackForChanges(callback, params) {
    if (this._onChangeCallbacks === null) this._onChangeCallbacks = call(field(this.dogmaLM, "collections"), "callbackMap");
    this._onChangeCallbacks.set(callback, params);
  }

  RemoveCallbackForChanges(callback) {
    if (this._onChangeCallbacks === null) throw new TypeError("'NoneType' object does not support item deletion");
    this._onChangeCallbacks.delete(callback);
    if (!this._onChangeCallbacks.size) this._onChangeCallbacks = null;
  }

  _PerformCallbacksIfValueChanged(previous) {
    if (this._onChangeCallbacks !== null && !attributeRecordsEqual(previous, this.currentValue)) {
      for (const [callback, params] of this._onChangeCallbacks) callback(this, previous, this.currentValue, ...params);
    }
  }

  AddModifierTo(operation, target) {
    this.AddOutgoingModifier(operation, target);
    call(target, "AddIncomingModifier", operation, this);
  }

  RemoveModifierTo(operation, target) {
    this.RemoveOutgoingModifier(operation, target);
    call(target, "RemoveIncomingModifier", operation, this);
  }

  _makeEmptyIncomingModifiers() { return Object.freeze(PRECEDENCE.map(() => call(field(this.dogmaLM, "collections"), "strongSet"))); }
  _initIncomingModifiers() { this.incomingModifiers = this._makeEmptyIncomingModifiers(); }

  AddIncomingModifier(operation, source) {
    if (this.incomingModifiers === null) this._initIncomingModifiers();
    this.incomingModifiers[operatorIndex(operation)].add(source);
    this.MarkDirty();
  }

  RemoveIncomingModifier(operation, source) {
    try {
      if (this.incomingModifiers === null) throw new TypeError("'NoneType' object is not subscriptable");
      this.incomingModifiers[operatorIndex(operation)].remove(source);
      this.MarkDirty();
    } catch (error) {
      if (["TypeError", "IndexError", "KeyError", "ValueError"].includes(error.name)) return;
      throw error;
    }
    if (this.incomingModifiers && !this.incomingModifiers.some(set => set.size)) this.incomingModifiers = null;
  }

  GetIncomingModifiers() { return this.incomingModifiers?.flatMap((set, index) => [...set].map(source => [PRECEDENCE[index], source])) ?? []; }
  CountIncomingModifiers() { return this.GetIncomingModifiers().length; }

  AddNonModifyingDependant(attribute) {
    if (this.nonModifyingDependants === null) this.nonModifyingDependants = call(field(this.dogmaLM, "collections"), "strongSet");
    this.nonModifyingDependants.add(attribute);
    call(attribute, "MarkDirty", true);
  }

  _makeEmptyOutgoingModifiers() { return call(field(this.dogmaLM, "collections"), "outgoingSet"); }
  _initOutgoingModifiers() { this._outgoingModifiers = this._makeEmptyOutgoingModifiers(); }

  AddOutgoingModifier(operation, attribute) {
    if (this._outgoingModifiers === null) this._initOutgoingModifiers();
    const reference = call(field(this.dogmaLM, "collections"), "weak", attribute);
    this._outgoingModifiers.add({ operation, reference });
  }

  RemoveOutgoingModifier(operation, attribute) {
    const reference = call(field(this.dogmaLM, "collections"), "weak", attribute);
    try {
      if (this._outgoingModifiers === null) throw namedError("AttributeError", "None has no remove attribute.");
      this._outgoingModifiers.remove({ operation, reference });
    } catch (error) {
      if (["AttributeError", "KeyError", "ValueError"].includes(error.name)) return;
      throw error;
    }
    if (!this._outgoingModifiers.size) this._outgoingModifiers = null;
  }

  GetOutgoingModifiers() { return [...(this._outgoingModifiers ?? [])].map(({ operation, reference }) => [operation, reference.deref()]); }
  CountOutgoingModifiers() { return this.GetOutgoingModifiers().length; }

  RemoveAllModifiers() {
    for (const [operation, source] of this.GetIncomingModifiers()) call(source, "RemoveOutgoingModifier", operation, this);
    for (const [operation, target] of this.GetOutgoingModifiers()) call(target, "RemoveIncomingModifier", operation, this);
    this._DiscardAllModifiers();
  }

  _DiscardAllModifiers() { this.incomingModifiers = null; this._outgoingModifiers = null; }
  GetBaseValue() { return this.baseValue; }
  SetBaseValue(value) { if (!attributeRecordsEqual(this.baseValue, value)) { this.baseValue = value; this.MarkDirty(); } }
  ResetBaseValue() { if (!attributeRecordsEqual(this.baseValue, this.typeValue)) { this.baseValue = this.typeValue; this.MarkDirty(); } }
  IncreaseBaseValue(amount) { if (call(this.item, "CanAttributeBeModified")) { this.baseValue = applyAttributeOperator(2, this.baseValue, amount); this.MarkDirty(); } }
  DecreaseBaseValue(amount) { if (call(this.item, "CanAttributeBeModified")) { this.baseValue = applyAttributeOperator(3, this.baseValue, amount); this.MarkDirty(); } }
  GetPersistData() { return attributeRecordsEqual(this.baseValue, this.typeValue) ? null : this.baseValue; }
  ApplyPersistData(value) { this.SetBaseValue(value); }
}

module.exports = { ClientDogmaAttribute };
