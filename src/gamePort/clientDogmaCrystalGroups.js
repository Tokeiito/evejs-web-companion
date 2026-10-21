"use strict";

// EveConfig.GetCrystalGroups527-533; initialized cache at183, Release at205.
// This is the local cache method, not a complete Cfg/localization service.
const { types: { isPromise } } = require("node:util");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
function member(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw notReady(name);
  return object[name];
}
function call(receiver, method, args, name) {
  if (typeof method !== "function") throw notReady(name);
  const result = Reflect.apply(method, receiver, args);
  if (isPromise(result)) throw notReady(`synchronous ${name}`);
  return result;
}
function collect(providers, suffix) {
  // Capture the callee BEFORE reading the argument, once for EACH pass.
  const getter = member(providers, "getGroupIDsByCategory");
  const category = member(member(providers, "constants"), "categoryCharge");
  const groups = call(providers, getter, [category], "getGroupIDsByCategory");
  if (groups === null || groups === undefined || typeof groups[Symbol.iterator] !== "function") {
    throw notReady("ordered native group-set iterable");
  }
  const selected = [];
  for (const groupID of groups) {
    // Native nested-call evaluation captures CleanImportantMarkup FIRST.
    const clean = member(providers, "cleanImportantMarkup");
    const nameGetter = member(providers, "getGroupNameByGroup");
    const name = call(providers, nameGetter, [groupID, "en"], "getGroupNameByGroup");
    const cleaned = call(providers, clean, [name], "cleanImportantMarkup");
    if (typeof cleaned !== "string") throw notReady("primary-English cleaned group-name string");
    if (cleaned.endsWith(suffix)) selected.push(groupID);
  }
  return selected;
}
function extendCurrent(cfg, values) {
  const current = member(cfg, "crystalgroups");
  // A released config's None is NOT repaired. Demand the initialized list only
  // here, after the private comprehension has completed, as the source does.
  if (!Array.isArray(current)) throw notReady("initialized cfg.crystalgroups list at extend");
  for (const value of values) Array.prototype.push.call(current, value);
}

/** providers supplies synchronous real getGroupIDsByCategory (fresh native
 * value-set traversal per call), getGroupNameByGroup(groupID, 'en'),
 * cleanImportantMarkup(text), and actual constants.categoryCharge. No category
 * ID, name table, sorting or merged suffix pass is substituted here.
 *
 * cfg owns an initialized ordinary array. Literal null models released None
 * solely to retain its late failure phase; arbitrary Python cache/container,
 * descriptor/Unicode-subclass and async-provider behavior is outside this
 * internal adapter. Actual Promise results reject without arbitrary .then
 * probes. Name text is a JS string with ASCII suffix comparison; a complete
 * localization engine or cFSD wrapper identity is not claimed.
 */
function getClientCrystalGroups(cfg, providers) {
  const cached = member(cfg, "crystalgroups");
  if (cached !== null && !Array.isArray(cached)) throw notReady("initialized cfg.crystalgroups list");
  if (cached === null || cached.length === 0) {
    const crystals = collect(providers, "Crystal");
    extendCurrent(cfg, crystals);
    const scripts = collect(providers, "Script");
    extendCurrent(cfg, scripts);
  }
  // Reentrant providers may replace the field: never return a held old list.
  return member(cfg, "crystalgroups");
}

module.exports = { getClientCrystalGroups };
