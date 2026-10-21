"use strict";

// Original BaseDogmaLocation.__init__100-160, cdxcoldworldagent1 and
// cdxbaseconstructoragent1. Ordered BASE-LOCAL field initialization only:
// no Client service fields, notification registration, IM publication, Prime,
// activation or claim that this world can finish a normal loaded-item graph.
const { types: { isPromise } } = require("node:util");
const { ClientDogmaEventCount, ClientDogmaBrainUpdate, ClientDogmaMessageMgr,
  ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const { ClientDogmaBrainLiteralCache } = require("./clientDogmaBrainLiteralCache");
const { CLIENT_DOGMA_INSTANCE_SCHEMA } = require("./clientDogmaConstructorRow");

const started = new WeakSet();
const sourceFields = Object.freeze([
  "broker", "onlineEffects", "shipsByPilotID", "pilotsByShipID", "dogmaItems",
  "locationID", "locationName", "locationGroup", "moduleListsByShipGroup",
  "moduleListsByShipType", "attributeChangeCallbacksByAttributeID", "loadingItems",
  "failedLoadingItems", "crits", "activatingEffects", "deactivatingEffects",
  "activatingEffectsByLocation", "activatingEffectsByTarget", "activeEffectsByShip",
  "activeDungeonEffectsByItem", "instanceFlagQuantityCache", "unloadingItems",
  "extraTracebacks", "pendingPowerCpuRequirementChecks", "ignoredOwnerEvents",
  "itemsMissingLocation", "itemsMissingOwner", "modifiersAwaitingTarget",
  "slaveModulesByMasterModule", "onlineByShip", "embarkingShips",
  "instanceRowDescriptor", "fakeInstanceRow", "msgMgr", "brainLiterals",
  "scarecrows", "brainUpdate",
]);
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
const sync = (value, part) => {
  if (isPromise(value)) throw notReady(`synchronous ${part}`);
  return value;
};
function member(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw notReady(name);
  return object[name];
}
function call(receiver, method, args, part) {
  // Evaluate arguments before rejecting a noncallable method, as a native
  // CALL_FUNCTION does. No arbitrary payload .then property is inspected.
  if (typeof method !== "function") throw notReady(part);
  return sync(Reflect.apply(method, receiver, args), part);
}
function invoke(receiver, name, args = []) {
  return call(receiver, member(receiver, name), args, name);
}
function bound(world, name) {
  const method = member(world, name);
  if (typeof method !== "function") throw notReady(`bound ${name}`);
  return method.bind(world);
}
function register(world, attributeID, methodName) {
  const registerCallback = member(world, "RegisterCallback");
  const callback = bound(world, methodName);
  call(world, registerCallback, [attributeID, callback], "RegisterCallback");
}

/** Mutate ONE NEW, uninitialized source world in exact Base assignment order.
 * The new-world guard is an EMULATOR factory contract: Python __init__ itself
 * can be recalled, but this API never resets/repairs an existing/failed world.
 * It inspects own-field presence only, without reading source field getters.
 * Earlier assignments and actual callback effects survive later exceptions.
 *
 * Required providers are demanded at their use phases, not prevalidated:
 * valueCollections is the ready structural-key domain; identityCollections is
 * the ready same-world strong identity domain; constructorRows is an explicit
 * ready fixed-row API (null/omitted is NOT a fallback). Brain key/format and
 * pending callable-set policies remain deferred until their real demand.
 * World callback adapters are actual methods. Python's valid noncallable
 * instance-field overrides/descriptor machinery are not admitted by bound().
 * Every collection is NEW; this is not retrofit attachment or successful Load.
 */
function initializeClientDogmaBase(world, options) {
  if (world === null || typeof world !== "object" || started.has(world) ||
    sourceFields.some(name => Object.hasOwn(world, name))) throw notReady("NEW uninitialized Base world");
  started.add(world);

  world.broker = options.broker;
  const values = options.valueCollections;
  // BUILD_MAP/populate RHS before STORE_ATTR: failure must not publish it.
  const onlineEffects = invoke(values, "map");
  invoke(onlineEffects, "set", [16, true]);
  invoke(onlineEffects, "set", [901, true]);
  world.onlineEffects = onlineEffects;
  world.shipsByPilotID = invoke(values, "map");
  world.pilotsByShipID = invoke(values, "map");
  // Item constructors admit only numeric/tuple item IDs. Attribute's normal
  // unpiloted path still performs dogmaItems.get(None), a provable miss.
  world.dogmaItems = invoke(values, "map", [{ absentNoneLookups: true }]);
  world.locationID = null;
  world.locationName = null;
  world.locationGroup = 0;
  world.moduleListsByShipGroup = invoke(values, "map", [{
    defaultFactory: () => invoke(values, "map", [{ defaultFactory: () => invoke(values, "set") }]),
  }]);
  world.moduleListsByShipType = invoke(values, "map", [{
    defaultFactory: () => invoke(values, "map", [{ defaultFactory: () => invoke(values, "set") }]),
  }]);
  world.attributeChangeCallbacksByAttributeID = invoke(values, "map");
  world.loadingItems = invoke(values, "map");
  world.failedLoadingItems = invoke(values, "map");
  world.crits = invoke(values, "map");
  world.activatingEffects = invoke(values, "map");
  world.deactivatingEffects = invoke(values, "set");
  world.activatingEffectsByLocation = invoke(values, "map");
  world.activatingEffectsByTarget = invoke(values, "map");
  world.activeEffectsByShip = invoke(values, "map");
  world.activeDungeonEffectsByItem = invoke(values, "map", [{
    defaultFactory: () => invoke(values, "map", [{ defaultFactory: () => invoke(values, "set") }]),
  }]);
  world.instanceFlagQuantityCache = invoke(values, "map");
  world.unloadingItems = invoke(values, "set");
  world.extraTracebacks = true;
  world.pendingPowerCpuRequirementChecks = invoke(values, "set");
  world.ignoredOwnerEvents = new ClientDogmaEventCount();
  world.itemsMissingLocation = invoke(values, "map", [{
    defaultFactory: () => invoke(options.identityCollections, "strongSet"),
  }]);
  world.itemsMissingOwner = invoke(values, "map", [{
    defaultFactory: () => invoke(options.identityCollections, "strongSet"),
  }]);
  world.modifiersAwaitingTarget = invoke(values, "map", [{
    // Do not substitute a value set/strong object set for callable tuples.
    // Missing policy leaves the map empty until an actual missing-key demand.
    defaultFactory: () => invoke(options.pendingModifiers, "createSet"),
  }]);
  world.slaveModulesByMasterModule = invoke(values, "map");
  world.onlineByShip = invoke(values, "map");
  world.embarkingShips = invoke(values, "map");

  const rows = options.constructorRows;
  const descriptorConstructor = member(rows, "DBRowDescriptor");
  world.instanceRowDescriptor = call(rows, descriptorConstructor, [CLIENT_DOGMA_INSTANCE_SCHEMA], "DBRowDescriptor");
  const length = world.instanceRowDescriptor.length;
  if (length !== 8) throw notReady("fixed eight-column instance descriptor length");
  const zero = Object.freeze({ value: 0, kind: Object.freeze({
    kind: "integer", pythonType: "int", source: "client-base-constructor-zero",
  }) });
  const data = Array.from({ length }, () => zero);
  const rowConstructor = member(rows, "DBRow");
  world.fakeInstanceRow = call(rows, rowConstructor, [world.instanceRowDescriptor, data], "DBRow");
  register(world, 49, "OnCpuAttributeChanged");
  register(world, 15, "OnPowerAttributeChanged");
  register(world, 978, "OnMaxGroupOnlineChanged");
  world.msgMgr = new ClientDogmaMessageMgr(options.identityCollections);
  world.brainLiterals = new ClientDogmaBrainLiteralCache({ keyPolicy: options.brainLiteralKeys, format: options.formatBrainLiteral });
  world.scarecrows = invoke(values, "map");
  world.brainUpdate = new ClientDogmaBrainUpdate(bound(world, "CheckPowerCpuRequirementForOnlineModules"));
}

module.exports = { initializeClientDogmaBase };
