"use strict";

// A NEW native item-construction context, deliberately stopping at pre-fit.
// These source-backed cold maps belong to this context, not an assertion that
// an existing pilot's modifier world is empty. This is not the complete
// Base/ClientDogmaLocation constructor, activation or LoadItem channel engine.
// cdxnodecreationagent1 / cdxprefitcontractagent1 define the phase boundary.
const { createClientDogmaIdentity } = require("./clientDogmaIdentity");
const { ClientBaseDogmaItem, ClientDogmaItemContinuationNotReadyError, createClientDogmaNumericMap, clientDogmaItemID } = require("./clientDogmaItem");
const { ClientShipDogmaItem, ClientModuleDogmaItem, ClientCharacterDogmaItem } = require("./clientDogmaPreFitItems");
const { ClientDogmaChargedAttribute } = require("./clientDogmaChargedAttribute");
const { ClientDogmaStackingAttribute } = require("./clientDogmaStackingAttribute");
const { sortClientDogmaAttributeFactors } = require("./clientDogmaFactorSort");
const { applyAttributeOperator, attributeRecordLessThan } = require("./clientDogmaArithmetic");

const field = (object, name) => {
  if (object === null || object === undefined || !(name in Object(object))) throw Object.assign(new Error(`Object has no ${name} attribute.`), { name: "AttributeError" });
  return object[name];
};
const keyError = key => Object.assign(new Error(String(key)), { name: "KeyError", key });
const numberID = (object, name) => clientDogmaItemID(field(object, name));
const fittingEpsilon = Object.freeze({ value: 1e-7, kind: Object.freeze({ kind: "real", pythonType: "float", source: "client-fitting-callback-literal" }) });

class ClientDogmaConstruction {
  /** All data/service adapters must already be ready synchronously. No RPC,
   * installed-data read, metadata row admission or ghost fitting registry is
   * hidden in this constructor. The caller owns this context's lifecycle. */
  constructor(providers) {
    this.providers = providers;
    this.collections = createClientDogmaIdentity(providers.identityPolicy);
    this.attributeData = providers.attributeData;
    this.attributeConstructors = new Map([
      ["StackingNurfedAttribute", ClientDogmaStackingAttribute],
      ["ChargedAttribute", ClientDogmaChargedAttribute],
    ]);
    this.dogmaItems = createClientDogmaNumericMap();
    this.shipsByPilotID = createClientDogmaNumericMap();
    this.pilotsByShipID = createClientDogmaNumericMap();
    this.itemsMissingLocation = createClientDogmaNumericMap({ missing: () => this.collections.strongSet() });
    this.itemsMissingOwner = createClientDogmaNumericMap({ missing: () => this.collections.strongSet() });
    this.locationID = null;
    this.attributeChangeCallbacksByAttributeID = createClientDogmaNumericMap();
    // Base.__init__153-155 really registers these three callbacks. The client
    // inherits ShouldMessageItemEvent=False; it does not erase this map.
    this.attributeChangeCallbacksByAttributeID.set(49, (...args) => this.OnCpuAttributeChanged(...args));
    this.attributeChangeCallbacksByAttributeID.set(15, (...args) => this.OnPowerAttributeChanged(...args));
    this.attributeChangeCallbacksByAttributeID.set(978, (...args) => this.OnMaxGroupOnlineChanged(...args));
  }

  requiredSkills(typeID) { return this.providers.requiredSkills(typeID); }
  typeAttributeRecord(typeID, attributeID) { return this.providers.typeAttributes.record(typeID, attributeID); }
  GetAttributesForItem(itemID, typeID) { return this.providers.GetAttributesForItem(itemID, typeID); }
  ownerRecord(ownerID) { return this.providers.ownerRecord(ownerID); }
  GetSimTimeRecord() { return this.providers.GetSimTimeRecord(); }
  SortAttributeFactors(factors) { return sortClientDogmaAttributeFactors(factors); }
  GetCharacter(itemID, flush) { return this.providers.GetCharacter(itemID, flush); }
  CharacterAttributeRecord(character, name) { return this.providers.CharacterAttributeRecord(character, name); }
  LogInfo(...args) { return this.providers.logging.LogInfo(...args); }
  LogError(...args) { return this.providers.logging.LogError(...args); }
  LogException(...args) { return this.providers.logging.LogException(...args); }
  LogWarn(...args) { return this.providers.logging.LogWarn(...args); }
  LogTraceback(...args) { return this.providers.logging.LogTraceback(...args); }
  FormatMissingOwnerAttribute(attribute, item) { return this.providers.FormatMissingOwnerAttribute(attribute, item); }
  IsClient() { return true; }
  ShouldMessageItemEvent() { return false; }

  GetAttributeValue(itemID, attributeID) {
    if (!this.dogmaItems.has(itemID)) throw keyError(itemID);
    // Internal source-record API only. A pre-fit value is not a completed
    // native accurate value and is never exposed to the bridge as one here.
    return this.dogmaItems.get(itemID).attributes.get(attributeID).GetValue();
  }
  OnCpuAttributeChanged(_attributeID, itemID) { this.OnFittingChanged(itemID, 49, 48); }
  OnPowerAttributeChanged(_attributeID, itemID) { this.OnFittingChanged(itemID, 15, 11); }
  OnMaxGroupOnlineChanged() {} // Actual Base1180-1181 body returns None.
  OnFittingChanged(itemID, loadID, outputID) {
    if (Array.isArray(itemID) || !this.pilotsByShipID.has(itemID)) return;
    if (!this.dogmaItems.has(itemID)) throw keyError(itemID);
    if (this.dogmaItems.get(itemID).isBeingDisembarked) return;
    const load = this.GetAttributeValue(itemID, loadID), output = this.GetAttributeValue(itemID, outputID);
    if (attributeRecordLessThan(applyAttributeOperator(3, output, load), fittingEpsilon)) this.providers.CheckPowerCpuRequirementForOnlineModules(itemID);
  }
  OnAttributeChanged(...args) { return this.providers.OnAttributeChanged(...args); }

  GetClassForItem(item) {
    // Base1013-1041 selection order. Unsupported selected classes fail here;
    // they never accidentally enter the generic Base fallback.
    const category = numberID(item, "categoryID"), group = () => numberID(item, "groupID");
    let Constructor, unsupported;
    if (category === 6) Constructor = ClientShipDogmaItem;
    else if (category === 65) unsupported = "StructureDogmaItem";
    else if (category === 66) unsupported = "StructureModuleDogmaItem";
    else if (group() === 1) Constructor = ClientCharacterDogmaItem;
    else if ([492, 548, 4088, 479, 90, 863, 864].includes(group())) unsupported = "ProbeDogmaItem";
    else if (category === 8) unsupported = "ChargeDogmaItem";
    else if ([7, 32].includes(category)) Constructor = ClientModuleDogmaItem;
    else if (group() === 365) unsupported = "ControlTowerDogmaItem";
    else if (category === 23) unsupported = "StarbaseDogmaItem";
    else if (category === 18) unsupported = "DroneDogmaItem";
    else if (category === 87) unsupported = "FighterDogmaItem";
    else Constructor = ClientBaseDogmaItem;
    if (unsupported) throw new ClientDogmaItemContinuationNotReadyError(item.itemID, unsupported);
    return Constructor;
  }

  ConstructAndLoadItem(invItem, { newInstance = false } = {}) {
    // The full LoadItem wrapper's presence/wait/critical/channel/failure policy
    // is intentionally NOT supplied by this bounded _Instantiate/_Load phase.
    // A caller may inspect retained partial nodes; it must not call this as a
    // completed activation or silently retry it on behalf of LoadItem.
    this.LogInfo("BaseDogmaLocation::_InstantiateDogmaItem", field(invItem, "itemID"));
    try { field(invItem, "typeID"); }
    catch (error) {
      if (error.name !== "AttributeError") throw error;
      throw Object.assign(new Error("Dogma was unable to get invItem to load dogmaItem!"), { name: "RuntimeError" });
    }
    if (newInstance) throw new ClientDogmaItemContinuationNotReadyError(invItem.itemID, "IntroduceNewItem");
    const source = this.providers.instanceSource;
    const instanceRow = source.GetInstance(invItem);
    const Constructor = this.GetClassForItem(invItem);
    const item = new Constructor({ world: this, invItem, clientIDFunc: this.providers.clientIDFunc, cfg: this.providers.cfg });
    this.LogInfo("BaseDogmaLocation::Actually Loading dogma item", invItem.itemID);
    // Adapt records LAZILY: native Base.Load does not access instance slots
    // until AFTER all earlier static writes. Never eagerly validate/read them.
    const records = {};
    for (let index = 0; index < 8; index += 1) Object.defineProperty(records, index, { get: () => source.recordAt(instanceRow, index) });
    item.Load(invItem, records);
    if (numberID(invItem, "flagID") !== 57) throw new ClientDogmaItemContinuationNotReadyError(item.itemID, "FitItemToLocation");
    item.OnItemLoaded();
    // Current selected OnItemLoaded methods throw at their unsupported
    // continuation. No success sentinel, fitted index or passive is supplied.
    throw new ClientDogmaItemContinuationNotReadyError(item.itemID, "post-load");
  }
}

module.exports = { ClientDogmaConstruction };
