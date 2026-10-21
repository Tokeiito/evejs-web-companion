"use strict";

// A NEW native item-construction context, deliberately stopping at pre-fit.
// These source-backed cold maps belong to this context, not an assertion that
// an existing pilot's modifier world is empty. This is not the complete
// Base/ClientDogmaLocation constructor or activation. AttachItemLoader adds
// the explicit bounded wrapper; it does not complete those remaining phases.
// cdxnodecreationagent1 / cdxprefitcontractagent1 define the item boundary.
const { createClientDogmaIdentity } = require("./clientDogmaIdentity");
const { ClientBaseDogmaItem, ClientDogmaItemContinuationNotReadyError, createClientDogmaNumericMap, clientDogmaItemID } = require("./clientDogmaItem");
const { ClientShipDogmaItem, ClientModuleDogmaItem, ClientCharacterDogmaItem } = require("./clientDogmaPreFitItems");
const { ClientDogmaChargedAttribute } = require("./clientDogmaChargedAttribute");
const { ClientDogmaStackingAttribute } = require("./clientDogmaStackingAttribute");
const { sortClientDogmaAttributeFactors } = require("./clientDogmaFactorSort");
const { applyAttributeOperator, attributeRecordLessThan } = require("./clientDogmaArithmetic");
const { ClientDogmaItemLoader, ClientDogmaLoadPolicyNotReadyError } = require("./clientDogmaItemLoader");
const { ClientDogmaEventCount, ClientDogmaBrainUpdate, ClientDogmaMessageMgr, ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const { ClientDogmaBrainLiteralCache } = require("./clientDogmaBrainLiteralCache");
const { CLIENT_DOGMA_INSTANCE_SCHEMA, createClientDogmaConstructorRowApi } = require("./clientDogmaConstructorRow");

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
    this.ignoredOwnerEvents = new ClientDogmaEventCount();
    this.itemsMissingLocation = createClientDogmaNumericMap({ missing: () => this.collections.strongSet() });
    this.itemsMissingOwner = createClientDogmaNumericMap({ missing: () => this.collections.strongSet() });
    this.locationID = null;
    this.attributeChangeCallbacksByAttributeID = createClientDogmaNumericMap();
    // Local source-backed Base prerequisites, still NOT its complete ctor.
    // Descriptor and eight explicit PyInt-zero inputs precede callbacks even
    // though Client later overwrites fakeInstanceRow=None. These locally
    // constructed records are not packets or GetInstance/registry defaults.
    this.constructorRows = Object.hasOwn(providers, "constructorRows") ? providers.constructorRows : createClientDogmaConstructorRowApi();
    if (typeof this.constructorRows?.DBRowDescriptor !== "function" || typeof this.constructorRows?.DBRow !== "function") {
      throw new ClientDogmaConstructorPrimitiveNotReadyError("instance constructor rows");
    }
    this.instanceRowDescriptor = this.constructorRows.DBRowDescriptor(CLIENT_DOGMA_INSTANCE_SCHEMA);
    const zero = Object.freeze({ value: 0, kind: Object.freeze({ kind: "integer", pythonType: "int", source: "client-base-constructor-zero" }) });
    this.fakeInstanceRow = this.constructorRows.DBRow(this.instanceRowDescriptor, Array.from({ length: this.instanceRowDescriptor.length }, () => zero));
    // Base.__init__153-155 really registers these three callbacks. The client
    // inherits ShouldMessageItemEvent=False; it does not erase this map.
    // Native attribute lookup captures each bound method at registration.
    // Later method replacement must not change an already stored callback.
    this.attributeChangeCallbacksByAttributeID.set(49, this.OnCpuAttributeChanged.bind(this));
    this.attributeChangeCallbacksByAttributeID.set(15, this.OnPowerAttributeChanged.bind(this));
    this.attributeChangeCallbacksByAttributeID.set(978, this.OnMaxGroupOnlineChanged.bind(this));
    this.msgMgr = new ClientDogmaMessageMgr(this.collections);
    this.brainLiterals = new ClientDogmaBrainLiteralCache({ keyPolicy: providers.brainLiteralKeys, format: providers.formatBrainLiteral });
    this.scarecrows = createClientDogmaNumericMap();
    this.brainUpdate = new ClientDogmaBrainUpdate(this.CheckPowerCpuRequirementForOnlineModules.bind(this));
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
    if (attributeRecordLessThan(applyAttributeOperator(3, output, load), fittingEpsilon)) this.CheckPowerCpuRequirementForOnlineModules(itemID);
  }
  CheckPowerCpuRequirementForOnlineModules(...args) {
    // Ready service/body adapter only. This partial context does not pretend
    // the full Base CPU/online enforcement graph has been implemented.
    if (typeof this.providers.CheckPowerCpuRequirementForOnlineModules !== "function") throw new ClientDogmaConstructorPrimitiveNotReadyError("CPU/power enforcement");
    return this.providers.CheckPowerCpuRequirementForOnlineModules(...args);
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
    const itemKey = field(invItem, "itemID");
    this.LogInfo("BaseDogmaLocation::_InstantiateDogmaItem", itemKey);
    return this._ConstructAndLoadResolved(itemKey, invItem, newInstance);
  }

  LoadItemPhase(itemKey, { invItem = null, newInstance = false } = {}) {
    // _Instantiate logs BEFORE the actual GetItem producer. A supplied row is
    // used as-is; instanceRow is replaced by GetInstance in the common phase.
    this.LogInfo("BaseDogmaLocation::_InstantiateDogmaItem", itemKey);
    if (invItem !== null) return this._ConstructAndLoadResolved(itemKey, invItem, newInstance);
    if (typeof this.providers.GetItem !== "function") throw new ClientDogmaItemContinuationNotReadyError(itemKey, "actual GetItem producer");
    const found = this.providers.GetItem(itemKey);
    if (found !== null && found !== undefined && typeof found.then === "function") {
      return found.then(item => this._ConstructAndLoadResolved(itemKey, item, newInstance));
    }
    return this._ConstructAndLoadResolved(itemKey, found, newInstance);
  }

  AttachItemLoader(options = {}) {
    const { sessionLocationID, exceptionPolicy, pendingModifiers, scheduling } = options;
    // Explicit extension of this NEW partial context, never retrofitting or
    // clearing an existing loaded registry. This is not the complete native
    // Base/Client constructor or the pilot IM attachment/activation tail.
    if (this.itemLoader || this.dogmaItems.size) throw new Error("Attach the item loader once, before constructing nodes.");
    if (typeof sessionLocationID !== "function") throw new TypeError("The actual session location provider is required.");
    const loaderOptions = { world: this, loadItem: (key, options) => this.LoadItemPhase(key, options),
      exceptionPolicy, pendingModifiers, scheduling, logging: this.providers.logging };
    const shared = Object.hasOwn(options, "sharedState");
    if (shared) loaderOptions.sharedState = options.sharedState;
    for (const name of ["loadingItems", "failedLoadingItems", "modifiersAwaitingTarget"]) {
      if (Object.hasOwn(this, name) && (!shared || this[name] !== options.sharedState?.[name])) {
        throw new ClientDogmaLoadPolicyNotReadyError(`existing ${name} alias`);
      }
    }
    // A future full Base keeps its structural this.crits object. The injected
    // loader.crits is only a numeric view; do not replace the world registry.
    const loader = new ClientDogmaItemLoader(loaderOptions);
    this.itemLoader = loader;
    this.loadingItems = loader.loadingItems;
    this.failedLoadingItems = loader.failedLoadingItems;
    this.modifiersAwaitingTarget = loader.modifiersAwaitingTarget;
    this.IsItemLoaded = key => loader.IsItemLoaded(key);
    this.IsItemLoading = key => loader.IsItemLoading(key);
    this.LoadItem = (key, options) => loader.ClientLoadItem(key, sessionLocationID(), options);
    return loader;
  }

  _ConstructAndLoadResolved(itemKey, invItem, newInstance) {
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
    this.LogInfo("BaseDogmaLocation::Actually Loading dogma item", itemKey);
    // Adapt records LAZILY: native Base.Load does not access instance slots
    // until AFTER all earlier static writes. Never eagerly validate/read them.
    const records = {};
    for (let index = 0; index < 8; index += 1) Object.defineProperty(records, index, { get: () => source.recordAt(instanceRow, index) });
    item.Load(invItem, records);
    if (numberID(invItem, "flagID") !== 57) throw new ClientDogmaItemContinuationNotReadyError(item.itemID, "FitItemToLocation");
    item.OnItemLoaded();
    // Current selected OnItemLoaded methods throw at unsupported continuations.
    // Only a genuinely completed _LoadItem returns its item to pending/post.
    return item;
  }
}

module.exports = { ClientDogmaConstruction };
