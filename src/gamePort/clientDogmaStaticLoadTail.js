"use strict";

// BaseDogmaStaticSvc.Load56-77 AFTER its four timed loading phases. This is
// the ordered local tail only: no Service/Run, timers, monitor or full static
// acquisition readiness. cdxclientstaticloadtailagent1 / original source.
const { types: { isPromise } } = require("node:util");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
function member(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw notReady(name);
  return object[name];
}
function call(receiver, method, args, name) {
  if (typeof method !== "function") throw notReady(name);
  const value = Reflect.apply(method, receiver, args);
  if (isPromise(value)) throw notReady(`synchronous ${name}`);
  return value;
}
function invoke(receiver, name, args = []) {
  return call(receiver, member(receiver, name), args, name);
}
function numeric(value) {
  if (typeof value !== "number" && typeof value !== "bigint") throw notReady("normalized native numeric scalar");
  return value;
}
function containsNumeric(list, value) {
  if (!Array.isArray(list)) throw notReady("actual cfg crystal-group list");
  numeric(value);
  for (const candidate of list) {
    numeric(candidate);
    // Numeric-only abstract equality compares Number/BigInt without rounding
    // a long through Number; NaN stays unequal, signed zeros compare equal.
    if (candidate == value) return true; // eslint-disable-line eqeqeq
  }
  return false;
}

/** Real synchronous providers are demanded at their source phases. Returned
 * cfg list and charge-group frozenset references are assigned UNCHANGED.
 * Group/type lookups supply independent native VALUE sets with actual .size,
 * .pop() and native iteration order; no first/min/sorted representative.
 * valueCollections.map supplies numeric .set. Constants are caller-installed
 * groupControlBunker, attributeFactionID, categoryModule,
 * categoryStructureModule, categoryStarbase; no source IDs are hardcoded.
 *
 * world.GetTypeAttribute2/GetTypeAttribute supply normalized native scalar
 * Number/bigint/null, not source-record wrappers. Required toInteger performs
 * the real source int conversion (including its failures), not JS Number.
 * This adapter makes no scalar-kind/heap identity, arbitrary Python iterable,
 * bool/custom numeric/descriptor or source-cell unwrapping claim. Actual
 * Promise adapters reject without probing arbitrary .then properties.
 * Repeated invocation is allowed; no catch/rollback erases partial writes.
 */
function initializeClientDogmaStaticLoadTail(world, providers) {
  world.crystalGroupIDs = invoke(providers, "getCrystalGroups");
  world.controlBunkersByFactionID = invoke(member(providers, "valueCollections"), "map");
  const typeGetter = member(providers, "getTypeIDsByGroup");
  const bunkerGroup = member(member(providers, "constants"), "groupControlBunker");
  const bunkerTypes = call(providers, typeGetter, [bunkerGroup], "getTypeIDsByGroup");
  for (const typeID of bunkerTypes) {
    // int callee is captured BEFORE evaluating the nested method call.
    const convert = member(providers, "toInteger");
    const attribute = member(world, "GetTypeAttribute2");
    const factionAttribute = member(member(providers, "constants"), "attributeFactionID");
    const value = call(world, attribute, [typeID, factionAttribute], "GetTypeAttribute2");
    const factionID = call(providers, convert, [value], "toInteger");
    invoke(member(world, "controlBunkersByFactionID"), "set", [factionID, typeID]);
  }
  const chargeAttributes = invoke(providers, "getChargeGroupAttributeIDs");
  world.chargeGroupAttributes = chargeAttributes;
  world.crystalModuleGroupIDs = invoke(member(providers, "valueCollections"), "map");
  // Evaluate the WHOLE tuple before the first category getter lookup.
  const categories = [
    member(member(providers, "constants"), "categoryModule"),
    member(member(providers, "constants"), "categoryStructureModule"),
    member(member(providers, "constants"), "categoryStarbase")
  ];
  for (const categoryID of categories) {
    for (const groupID of invoke(providers, "getGroupIDsByCategory", [categoryID])) {
      const typeIDs = invoke(providers, "getTypeIDsByGroup", [groupID]);
      const size = member(typeIDs, "size");
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw notReady("native copied type-set length");
      if (size > 0) {
        const typeID = invoke(typeIDs, "pop");
        for (const attributeID of chargeAttributes) {
          const value = invoke(world, "GetTypeAttribute", [typeID, attributeID]);
          if (value !== null && containsNumeric(member(world, "crystalGroupIDs"), value)) {
            invoke(member(world, "crystalModuleGroupIDs"), "set", [groupID, true]);
            break;
          }
        }
      }
    }
  }
  return null;
}

module.exports = { initializeClientDogmaStaticLoadTail };
