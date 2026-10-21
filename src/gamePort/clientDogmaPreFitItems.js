"use strict";

// Selected native constructors and Load overrides for the PRE-FIT phase.
// This is not a replacement for the remaining item classes' fitting, effects,
// brain, contents, unload or activation methods. Unsupported continuations
// remain explicit; these nodes must not become completed-activation evidence.
const { ClientBaseDogmaItem, ClientDogmaItemContinuationNotReadyError, createClientDogmaNumericMap, clientDogmaItemID } = require("./clientDogmaItem");
const sameIdentity = (left, right) => left === null || right === null ? left === right : clientDogmaItemID(left) === clientDogmaItemID(right);
function field(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw Object.assign(new Error(`Object has no ${name} attribute.`), { name: "AttributeError" });
  return object[name];
}

class ClientFittableDogmaItem extends ClientBaseDogmaItem {
  // Fittable.__init__16-20 precedes Base/Slim, including link setup.
  _InitializeStateBeforeSlim() { this._location = null; this.lastStopTime = null; }
  get location() { return this._location === null ? null : this._location.deref(); }
  set location(value) { this._location = value === null ? null : this.dogmaLocation.collections.weak(value); }
  get ownerID() { return this.location ? field(this.location, "ownerID") : null; }
  set ownerID(value) {
    if (this.location && !sameIdentity(field(this.location, "ownerID"), value)) {
      this.dogmaLocation.LogError("Setting ownerID on a FittableDogmaItem to something that disagrees with its location!", this.location.ownerID, value);
    }
  }
  GetShipID() { return this.location ? this.location.itemID : null; }
  GetPilot() { return this.location ? this.location.GetPilot() : null; }
}

class ClientModuleDogmaItem extends ClientFittableDogmaItem {
  GetCharacterID() { return this.GetPilot(); }
  IsOnline() { return this.activeEffects.has(16); }
}

class ClientLocationDogmaItem extends ClientBaseDogmaItem {
  constructor(input) {
    super(input);
    this.fittedItems = createClientDogmaNumericMap();
    this.subLocations = createClientDogmaNumericMap();
  }
  OnItemLoaded() { throw new ClientDogmaItemContinuationNotReadyError(this.itemID, "location contents and effects"); }
  PostLoadAction() {
    // Location51-55 adds CPU/power checks and _EnforceMaxGroupOnline after
    // Base's no-op. Do not accidentally inherit that no-op as full success.
    throw new ClientDogmaItemContinuationNotReadyError(this.itemID, "location post-load checks");
  }
}

class ClientShipDogmaItem extends ClientLocationDogmaItem {
  constructor(input) {
    super(input);
    this.flagID = field(input.invItem, "flagID");
    this.drones = createClientDogmaNumericMap();
    this.overloadedModules = this.dogmaLocation.collections.strongSet();
    this.damageByLayerByType = createClientDogmaNumericMap({ missing: () => createClientDogmaNumericMap({
      missing: () => Object.freeze({ value: 0, kind: Object.freeze({ kind: "real", pythonType: "float", source: "client-ship-damage-default" }) }),
    }) });
  }
  Load(item, instanceRow) { super.Load(item, instanceRow); this.isDirty = true; this.flagID = field(item, "flagID"); }
  GetPilot() { return this.dogmaLocation.pilotsByShipID.get(this.itemID) ?? null; }
  OnItemLoaded() { throw new ClientDogmaItemContinuationNotReadyError(this.itemID, "ship self fitting and location contents"); }
}

class ClientCharacterDogmaItem extends ClientFittableDogmaItem {
  constructor(input) {
    super(input);
    this.fittedItems = createClientDogmaNumericMap();
    this._activeShipID = null;
  }
  get activeShipID() { return this._activeShipID; }
  set activeShipID(value) {
    if (value === null && this._activeShipID !== null) {
      this.dogmaLocation.LogTraceback("Active shipID is being set to None post initialization!");
      return;
    }
    this._activeShipID = value;
  }
  Load(item, instanceRow) {
    super.Load(item, instanceRow);
    const attributes = this.attributes;
    // Native Client.GetCharacter is GetItem, not a new character-attributes
    // RPC. This ready adapter must retain source records from that real item.
    const character = this.dogmaLocation.GetCharacter(item.itemID, true);
    for (const [attributeID, name] of [[165, "intelligence"], [164, "charisma"], [167, "perception"], [166, "memory"], [168, "willpower"]]) {
      // Evaluate the lazy target BEFORE its value-producing argument, as the
      // original attrs[id].SetBaseValue(char.field) expression does.
      const target = attributes.get(attributeID);
      target.SetBaseValue(this.dogmaLocation.CharacterAttributeRecord(character, name));
    }
  }
  GetPilot() { return this.itemID; }
  GetCharacterID() { return this.itemID; }
  OnItemLoaded() { throw new ClientDogmaItemContinuationNotReadyError(this.itemID, "character brain and embarkation"); }
}

module.exports = { ClientFittableDogmaItem, ClientModuleDogmaItem, ClientLocationDogmaItem, ClientShipDogmaItem, ClientCharacterDogmaItem };
