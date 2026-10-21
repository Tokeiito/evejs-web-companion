"use strict";

// Genuine Slim/Base PRE-FIT construction and Load, not LoadItem completion.
// Original construction41/state49/prefitcontract/instanceproducer evidence.
// The world owns ready synchronous providers and a separate native registry;
// neither godma metadata nor GetAllInfo admits items into this registry.
const { createClientDogmaAttributeFactory, createClientDogmaLazyAttributes } = require("./clientDogmaAttributeFactory");
const { attributeRecordsEqual, attributePythonType, attributeInteger } = require("./clientDogmaArithmetic");
const { INSTANCE_ATTRIBUTES } = require("./clientDogmaInstance");
const ZERO = Object.freeze({ value: 0, kind: Object.freeze({ kind: "integer", pythonType: "int", source: "client-dogma-item-zero-comparison" }) });
// Original const.dgmAttributesByIdx / Base.GetAttributesByIndex. Slot0 is ID.
const CLIENT_DOGMA_INSTANCE_ATTRIBUTES = Object.freeze(INSTANCE_ATTRIBUTES.map((attributeID, index) => Object.freeze([index + 1, attributeID])));
const namedError = (name, message) => Object.assign(new Error(message), { name });
const keyError = key => Object.assign(namedError("KeyError", String(key)), { key });

function field(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw namedError("AttributeError", `Object has no ${String(name)} attribute.`);
  return object[name];
}

function synchronous(value) {
  if (value !== null && value !== undefined && typeof value.then === "function") {
    throw namedError("ClientDogmaProviderNotReadyError", "A native item provider must be prepared synchronously.");
  }
  return value;
}

function call(object, method, ...args) { return synchronous(field(object, method).apply(object, args)); }

/** Numeric world maps alias safe Number/BigInt keys like Python int/long.
 * Item fields retain their supplied raw identity. Null is only an absent-key
 * lookup (Slim.GetPilot); it cannot be registered as a normal numeric item. */
function clientDogmaItemID(value) {
  if (typeof value === "bigint") return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new TypeError("An exact normal numeric dogma identity is required.");
}

/** Explicit world/default-map constructor, never a missing-world fallback.
 * Iteration retains the provider's supplied order; this is NOT a general
 * Python dictionary-order model. Current item methods only do keyed lookup. */
function createClientDogmaNumericMap({ missing } = {}) {
  if (missing !== undefined && typeof missing !== "function") throw new TypeError("A numeric default-map factory is required.");
  const values = new Map();
  return Object.freeze({
    has(key) { return key === null ? false : values.has(clientDogmaItemID(key)); },
    get(key) {
      if (key === null) return undefined;
      key = clientDogmaItemID(key);
      if (!values.has(key) && missing !== undefined) values.set(key, synchronous(missing(key)));
      return values.get(key);
    },
    set(key, value) { values.set(clientDogmaItemID(key), value); },
    delete(key) { return key === null ? false : values.delete(clientDogmaItemID(key)); },
    keys: () => values.keys(),
    entries: () => values.entries(),
    get size() { return values.size; },
    [Symbol.iterator]: () => values.entries(),
  });
}

function numericHas(map, key) { return call(map, "has", key === null ? null : clientDogmaItemID(key)); }
function numericGet(map, key) { return call(map, "get", key === null ? null : clientDogmaItemID(key)); }
function numericAt(map, key) {
  // Full Base value maps separate native defaultdict brackets from .get.
  // The earlier numeric-only component exposed brackets through .get.
  return call(map, typeof map.at === "function" ? "at" : "get", key === null ? null : clientDogmaItemID(key));
}
function numericRequiredGet(map, key) {
  if (!numericHas(map, key)) throw keyError(key);
  return numericGet(map, key);
}
function numericSet(map, key, value) { return call(map, "set", clientDogmaItemID(key), value); }
function claim(world, name, itemID) {
  const map = field(world, name);
  if (!numericHas(map, itemID)) return call(field(world, "collections"), "strongSet");
  const value = numericGet(map, itemID);
  call(map, "delete", clientDogmaItemID(itemID));
  return value;
}

class ClientDogmaItemContinuationNotReadyError extends Error {
  constructor(itemID, phase) {
    super(`Native item ${String(itemID)} ${phase} continuation is not ready.`);
    this.name = "ClientDogmaItemContinuationNotReadyError";
    this.itemID = itemID;
    this.phase = phase;
  }
}

class ClientSlimDogmaItem {
  /** world: collections, numeric dogmaItems/itemsMissingLocation/Owner maps,
   * locationID, attributeData, requiredSkills(typeID)->ordered numeric-key map,
   * typeAttributeRecord, world callbacks/log providers, and optional actual
   * attributeConstructors. Providers throw when unavailable; no empty stand-in
   * world is created. clientIDFunc is retained, not invoked in this phase. */
  constructor({ world, invItem, clientIDFunc, baseAttributes = null }) {
    this._InitializeStateBeforeSlim();
    this._owner = null;
    this.dogmaLocation = world;
    // This publication MUST precede invItem/skills/factory/link completion.
    numericSet(field(world, "dogmaItems"), field(invItem, "itemID"), this);
    this.invItem = invItem;
    this.itemID = field(invItem, "itemID");
    this.typeID = field(invItem, "typeID");
    this.groupID = field(invItem, "groupID");
    this.categoryID = field(invItem, "categoryID");
    this.reqSkills = call(world, "requiredSkills", field(invItem, "typeID"));
    this.contentsChangedCallbacks = call(field(world, "collections"), "strongSet");
    this.FindClientID = clientIDFunc;
    const factory = createClientDogmaAttributeFactory({ item: this, world, attributeData: field(world, "attributeData"), baseAttributes, constructors: world.attributeConstructors });
    this.attributes = createClientDogmaLazyAttributes(factory);
    this.activeEffects = createClientDogmaNumericMap();
    this._SetupLocationLinks();
    this._SetupLocationMods();
    this._SetupOwnerLinks();
    this._SetupOwnerMods();
    const location = this.location;
    if (location) {
      for (const callback of field(location, "contentsChangedCallbacks")) {
        try { synchronous(callback(this)); }
        catch (error) {
          // Original ExceptionEater catches Exception, not BaseException.
          if (["SystemExit", "KeyboardInterrupt", "GeneratorExit"].includes(error?.name)) throw error;
          call(world, "LogException", "Contents callback excepted", error);
        }
      }
    }
  }

  // Selected derived constructors may need state before a link setter runs.
  _InitializeStateBeforeSlim() {}

  get owner() {
    try { return this._owner === null ? null : this._owner.deref(); }
    catch (error) { if (error?.name === "ReferenceError") return null; throw error; }
  }
  set owner(reference) { this._owner = reference; }
  get locationID() { return field(this.invItem, "locationID"); }
  get ownerID() { return field(this.invItem, "ownerID"); }

  _SetupLocationLinks() {
    const world = this.dogmaLocation;
    this.subItems = claim(world, "itemsMissingLocation", this.itemID);
    for (const child of this.subItems) {
      call(world, "LogInfo", "Patching-up location link", child, this);
      child.location = this;
    }
    const registry = field(world, "dogmaItems"), locationID = field(this.invItem, "locationID");
    try {
      const location = numericRequiredGet(registry, locationID);
      call(field(location, "subItems"), "add", this);
      this.location = location;
    } catch (error) {
      if (error?.name !== "KeyError") throw error;
      this.location = null;
      if (locationID !== null) {
        const worldLocationID = field(world, "locationID");
        if (worldLocationID === null || clientDogmaItemID(locationID) !== clientDogmaItemID(worldLocationID)) {
          call(numericAt(field(world, "itemsMissingLocation"), locationID), "add", this);
        }
      }
    }
  }

  _SetupOwnerLinks() {
    const world = this.dogmaLocation;
    this.ownedItems = claim(world, "itemsMissingOwner", this.itemID);
    for (const child of this.ownedItems) {
      call(world, "LogInfo", "Patching-up owner link", child, this);
      child.owner = call(field(world, "collections"), "weak", this);
    }
    this.ownedItemsAtCreation = call(this.ownedItems, "copy");
    const registry = field(world, "dogmaItems"), ownerID = field(this.invItem, "ownerID");
    try {
      const owner = numericRequiredGet(registry, ownerID);
      call(field(owner, "ownedItems"), "add", this);
      this.owner = call(field(world, "collections"), "weak", owner);
    } catch (error) {
      if (error?.name !== "KeyError") throw error;
      this.owner = null;
      if (ownerID !== null && clientDogmaItemID(ownerID) >= 2) call(numericAt(field(world, "itemsMissingOwner"), ownerID), "add", this);
    }
  }

  _SetupLocationMods() {
    const modifiers = () => call(field(this.dogmaLocation, "collections"), "modifierSet");
    this.locationMods = createClientDogmaNumericMap({ missing: modifiers });
    this.locationGroupMods = createClientDogmaNumericMap({ missing: () => createClientDogmaNumericMap({ missing: modifiers }) });
    this.locationReqSkillMods = createClientDogmaNumericMap({ missing: () => createClientDogmaNumericMap({ missing: modifiers }) });
  }

  _SetupOwnerMods() {
    this.ownerReqSkillMods = createClientDogmaNumericMap({ missing: () => createClientDogmaNumericMap({ missing: () => call(field(this.dogmaLocation, "collections"), "modifierSet") }) });
  }

  _PickUpInitialModifiersFromLocationTo(toAttribute) {
    const attributeID = field(toAttribute, "attribID"), item = field(toAttribute, "item"), groupID = field(item, "groupID");
    if (numericHas(this.locationMods, attributeID)) this._ApplyModsToAttrib(numericGet(this.locationMods, attributeID), toAttribute, false, "PickUp LocMods");
    if (numericHas(this.locationGroupMods, groupID)) {
      const group = numericGet(this.locationGroupMods, groupID);
      if (numericHas(group, attributeID)) this._ApplyModsToAttrib(numericGet(group, attributeID), toAttribute, false, "PickUp LogGroupMods");
    }
    for (const skillID of call(field(item, "reqSkills"), "keys")) {
      if (!numericHas(this.locationReqSkillMods, skillID)) continue;
      const skills = numericGet(this.locationReqSkillMods, skillID);
      if (numericHas(skills, attributeID)) this._ApplyModsToAttrib(numericGet(skills, attributeID), toAttribute, false, "PickUp LocReqSkillMods");
    }
  }

  _PickUpInitialModifiersFromOwnerTo(toAttribute) {
    const attributeID = field(toAttribute, "attribID"), item = field(toAttribute, "item");
    for (const skillID of call(field(item, "reqSkills"), "keys")) {
      if (!numericHas(this.ownerReqSkillMods, skillID)) continue;
      const skills = numericGet(this.ownerReqSkillMods, skillID);
      if (numericHas(skills, attributeID)) this._ApplyModsToAttrib(numericGet(skills, attributeID), toAttribute, false, "PickUp OwnerReqSkillMods");
    }
  }

  _ApplyModsToAttrib(modifiers, toAttribute, callOnAttributeChanged = false, debugContext = "<no debug context>") {
    if (!field(modifiers, "size")) return;
    let purge = null;
    for (const modifier of modifiers) {
      const source = field(modifier, "attribute"), operation = field(modifier, "operation");
      if (call(source, "IsAnOrphan")) {
        if (purge === null) purge = call(field(this.dogmaLocation, "collections"), "modifierSet");
        call(purge, "add", modifier);
      } else {
        call(source, "AddModifierTo", operation, toAttribute);
        if (callOnAttributeChanged) call(this.dogmaLocation, "OnAttributeChanged", field(toAttribute, "attribID"), this.itemID);
      }
    }
    if (purge !== null && purge.size) {
      // Provider observes native log-before-purge ordering. Python object/
      // address repr formatting is not inferred from JS object stringification.
      call(this.dogmaLocation, "LogError", "SlimDogmaItem::_ApplyModsToAttrib PURGING ORPHANS (attempting self-repair)!", modifiers, purge, toAttribute, debugContext);
      call(modifiers, "differenceUpdate", purge);
    }
  }

  CanAttributeBeModified() { return true; }
  IsOwnerModifiable() { return false; }
  GetPilot() { return null; }
  GetLocation() { return this.location; }
  GetValue(attributeID) { return this.attributes.get(attributeID).GetValue(); }
}

class ClientBaseDogmaItem extends ClientSlimDogmaItem {
  constructor({ world, invItem, clientIDFunc, cfg }) {
    super({ world, invItem, clientIDFunc });
    this.flagID = null;
    this.isDirty = false;
    // Only the original EMPTY construction state is supported here. Numeric
    // fitting-flag mutation belongs to the unported fitting continuation.
    this.fittingFlags = call(field(world, "collections"), "strongSet");
    this.cfg = cfg;
  }

  Load(item, instanceRow) {
    // Keep even currently-unused inventory reads in original failure order.
    field(item, "categoryID");
    const typeID = field(item, "typeID");
    field(item, "groupID");
    let ownerID = field(item, "ownerID");
    field(item, "flagID");
    if (ownerID) {
      // Adapter for cfg.eveowners.Get; no cached/empty owner fallback.
      const owner = call(this.dogmaLocation, "ownerRecord", ownerID);
      if (clientDogmaItemID(field(owner, "typeID")) === 2 || call(owner, "IsNPC") || call(owner, "IsSystem")) ownerID = null;
    }
    this.flagID = null;
    const attributes = this.attributes;
    const entries = call(this.dogmaLocation, "GetAttributesForItem", field(item, "itemID"), typeID);
    for (const [attributeID, value] of entries) attributes.get(attributeID).SetBaseValue(value);
    // No up-front fake/zero row validation: later missing slots fail after
    // preceding genuine static/instance writes, as original Load does.
    for (const [index, attributeID] of CLIENT_DOGMA_INSTANCE_ATTRIBUTES) {
      if (instanceRow === null || instanceRow === undefined || !(index in Object(instanceRow))) throw namedError("IndexError", `Missing instance slot ${index}.`);
      let value = instanceRow[index];
      if (!attributeRecordsEqual(value, ZERO)) {
        if (attributePythonType(value) === "bool") value = attributeInteger(value);
        attributes.get(attributeID).SetBaseValue(value);
      }
    }
  }

  GetPilot() { return field(this.invItem, "ownerID"); }
  GetShip() { return numericGet(field(this.dogmaLocation, "shipsByPilotID"), this.GetPilot()) ?? null; }
  GetLocationInfo() { return [field(this.invItem, "ownerID"), field(this.invItem, "locationID"), this.flagID]; }
  GetItemInfo() { const [ownerID, locationID, flagID] = this.GetLocationInfo(); return [field(this.invItem, "typeID"), field(this.invItem, "groupID"), field(this.invItem, "categoryID"), ownerID, locationID, flagID]; }
  OnItemLoaded() { throw new ClientDogmaItemContinuationNotReadyError(this.itemID, "location effects"); }
  PostLoadAction() {} // Original BaseDogmaItem50-51 is an actual no-op.
  SetLocation() { throw new ClientDogmaItemContinuationNotReadyError(this.itemID, "fitting"); }
}

module.exports = { ClientSlimDogmaItem, ClientBaseDogmaItem, ClientDogmaItemContinuationNotReadyError, createClientDogmaNumericMap, clientDogmaItemID, CLIENT_DOGMA_INSTANCE_ATTRIBUTES };
