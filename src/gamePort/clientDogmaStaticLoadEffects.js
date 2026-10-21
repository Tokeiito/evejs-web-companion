"use strict";

// BaseDogmaStaticSvc.LoadEffects146-151 / LoadTypeEffects153-176, original
// compiled contract cdxclientstaticloadeffectsagent1 and producer audit
// cdxclientstaticindexesagent1. No full static Service/Run, acquisition,
// crystal tail, reload monitor, effect execution or loaded-world readiness.
const { types: { isPromise } } = require("node:util");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
function member(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw notReady(name);
  return object[name];
}
function invoke(receiver, name, args = []) {
  const method = member(receiver, name);
  if (typeof method !== "function") throw notReady(name);
  const result = Reflect.apply(method, receiver, args);
  if (isPromise(result)) throw notReady(`synchronous ${name}`);
  return result;
}
function numeric(value) {
  if (typeof value === "bigint" || (typeof value === "number" && Number.isSafeInteger(value))) return value;
  throw notReady("installed integer effect/type/category value");
}
function sameNumber(left, right) { return BigInt(numeric(left)) === BigInt(numeric(right)); }
function integerTruth(value) {
  // Actual installed relation.isDefault fields are native ints. Do not use
  // JS truthiness or infer Python classes for arbitrary objects/None/bools.
  numeric(value);
  return value !== 0 && value !== 0n;
}
function list(value, part) {
  if (!Array.isArray(value)) throw notReady(part);
  return value;
}

/** Assign real provider mapping objects unchanged, at each source phase.
 * data.getAllEffectsByID/getAllEffectsByName are synchronous complete helpers,
 * not a partial warmed effect cache. ID mapping supplies actual .size.
 * Reload/repeated invocation is allowed; failures retain earlier assignments
 * and later old fields. LogError happens only after empty effects is stored.
 */
function initializeClientDogmaStaticLoadEffects(world, { data }) {
  world.effects = invoke(data, "getAllEffectsByID");
  const size = member(world.effects, "size");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw notReady("effect mapping length");
  if (size === 0) invoke(world, "LogError", ["STATIC DATA MISSING: Dogma Effects"]);
  world.effectsByName = invoke(data, "getAllEffectsByName");
  return null;
}

/** Synchronous data helpers: getEffectsIndexedByTypeIDAndEffectID,
 * getEffectsIndexedByEffectIDAndTypeID, getAllTypeIDsAndEffects. Index mapping
 * objects remain EXACT provider references. They and inner maps must supply
 * native .iterkeys() traversal/.at(key) bracket access; unwantedEffects.has
 * must supply actual membership. No vector-order/sorted/JS Map traversal is
 * substituted for those native dictionaries.
 *
 * getAllTypeIDsAndEffects supplies the ORIGINAL ordered array of [typeID,
 * relation-array] pairs, including empty vectors/duplicates. Relations expose
 * actual numeric effectID/isDefault. Default selection uses these raw vectors,
 * not the deduplicated index, and publishes its local map only AFTER success.
 * constants supplies real caller-owned dgmEffPassive/dgmEffSystem values; no
 * category IDs are hardcoded. Local maps use the proven numeric value domain.
 * The source run parameter is UNUSED: no property/truth/Promise inspection.
 * No general Python iterable/custom numeric/descriptor equivalence is claimed.
 */
function initializeClientDogmaStaticLoadTypeEffects(world, { data, constants, valueCollections }, _run = false) {
  world.effectsByType = invoke(data, "getEffectsIndexedByTypeIDAndEffectID");
  world.typesByEffect = invoke(data, "getEffectsIndexedByEffectIDAndTypeID");
  world.passiveFilteredEffectsByType = invoke(valueCollections, "map");
  const typeIDs = invoke(member(world, "effectsByType"), "iterkeys");
  for (const typeID of typeIDs) {
    const passiveEffects = [];
    const indexed = invoke(member(world, "effectsByType"), "at", [typeID]);
    const effectIDs = invoke(indexed, "iterkeys");
    for (const effectID of effectIDs) {
      const unwanted = invoke(member(world, "unwantedEffects"), "has", [effectID]);
      if (typeof unwanted !== "boolean") throw notReady("effect membership predicate");
      if (unwanted) continue; // Must precede definition lookup/category access.
      const effect = invoke(member(world, "effects"), "at", [effectID]);
      const category = member(effect, "effectCategory");
      // Original evaluates category THEN BOTH constant reads/builds the list,
      // even when the first entry will match. Do not short-circuit the reads.
      const categories = [member(constants, "dgmEffPassive"), member(constants, "dgmEffSystem")];
      if (sameNumber(category, categories[0]) || sameNumber(category, categories[1])) passiveEffects.push(effectID);
    }
    if (passiveEffects.length) invoke(member(world, "passiveFilteredEffectsByType"), "set", [typeID, passiveEffects]);
  }
  const defaultEffect = invoke(valueCollections, "map");
  const typeRows = list(invoke(data, "getAllTypeIDsAndEffects"), "ordered original type/effect pair array");
  for (const pair of typeRows) {
    if (!Array.isArray(pair) || pair.length !== 2) throw notReady("original type/effect pair");
    const [typeID, relations] = pair;
    for (const relation of list(relations, "original effect relation array")) {
      if (integerTruth(member(relation, "isDefault"))) {
        const effectID = numeric(member(relation, "effectID"));
        invoke(defaultEffect, "set", [typeID, effectID]);
      }
    }
  }
  world.defaultEffectByType = defaultEffect;
  return null;
}

module.exports = { initializeClientDogmaStaticLoadEffects, initializeClientDogmaStaticLoadTypeEffects };
