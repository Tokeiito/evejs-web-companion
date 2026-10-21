"use strict";

// Actual BaseDogmaStaticSvc.LoadAttributes79-147 only. Original compiled/data
// proof: cdxclientstaticrunagent1. No Service ctor/Run, LoadTypeAttributes,
// effects/type-effects/crystal tail, reload monitor or ready service claim.
const { types: { isPromise } } = require("node:util");
const { ClientDogmaConstructorPrimitiveNotReadyError } = require("./clientDogmaConstructorPrimitives");
const notReady = part => new ClientDogmaConstructorPrimitiveNotReadyError(part);
const sync = (result, part) => {
  if (isPromise(result)) throw notReady(`synchronous ${part}`);
  return result;
};
function member(object, name) {
  if (object === null || object === undefined || !(name in Object(object))) throw notReady(name);
  return object[name];
}
function call(receiver, method, args, part) {
  if (typeof method !== "function") throw notReady(part);
  return sync(Reflect.apply(method, receiver, args), part);
}
function invoke(receiver, name, args = []) { return call(receiver, member(receiver, name), args, name); }
function numeric(value) {
  if (typeof value === "bigint" || (typeof value === "number" && Number.isSafeInteger(value))) return value;
  throw notReady("installed integer static attribute constant/ID");
}
function ascii(value) {
  if (typeof value !== "string" || !/^[\x00-\x7f]*$/.test(value)) throw notReady("installed ASCII byte attribute name");
  return value;
}
function list(value) {
  if (!Array.isArray(value)) throw notReady("source attribute/index list");
  return value;
}
function appendID(world, name, row) {
  const target = member(world, name), append = member(target, "push");
  const id = numeric(member(row, "attributeID"));
  call(target, append, [id], "source list append");
}
const tuple = parts => Object.freeze(parts);
function zip(left, right) {
  list(left); list(right);
  const result = [];
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) result.push(tuple([left[index], right[index]]));
  return result;
}

/** Supplied world may be NEW or already have earlier-generation fields:
 * native LoadAttributes is rerunnable and intentionally NONTRANSACTIONAL.
 * Each field/append/map mutation survives a later failure; no guard/reset,
 * rollback or premature policy validation changes that phase behavior.
 *
 * data synchronous helper API: getAllAttributesByID/getAllAttributesByName/
 * getAttributeListByDataType/getChargeRechargeTimeAttributesByID/
 * getAttributesByChargeRechargeTimeID. Returned mappings are stored EXACTLY,
 * without cloning/remapping their row objects. Required surfaces are .size on
 * ID mapping, .at(categoryID) on category mapping and .at(ASCII name) on names.
 * Producer memoization/cFSD fresh-wrapper semantics belong to that provider.
 *
 * constants supplies REAL installed values under original const member names;
 * none of the IDs is guessed/hardcoded here. valueCollections supplies fresh
 * numeric maps with .set/.iteritems. All observed current dataType keys are
 * native int0..13, all2855 names are ASCII native str (not inferred from JSON).
 * Internal fixed tuples use frozen array carriers, source lists stay mutable;
 * arbitrary Python iterables/Unicode/descriptor overrides are not generalized.
 */
function initializeClientDogmaStaticLoadAttributes(world, { data, constants, valueCollections }) {
  const constant = name => numeric(member(constants, name));
  const newMap = () => invoke(valueCollections, "map");

  world.attributes = invoke(data, "getAllAttributesByID");
  const size = member(world.attributes, "size");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw notReady("attribute mapping length");
  if (size === 0) invoke(world, "LogError", ["STATIC DATA MISSING: Dogma Attributes"]);
  world.attributesByName = invoke(data, "getAllAttributesByName");
  world.attributesByCategory = invoke(data, "getAttributeListByDataType");
  world.chargedAttributes = invoke(data, "getChargeRechargeTimeAttributesByID");
  world.attributesRechargedByAttribute = invoke(data, "getAttributesByChargeRechargeTimeID");
  world.attributesByIdx = newMap();
  world.idxByAttribute = newMap();
  world.canFitShipGroupAttributes = [];
  world.allowedDroneGroupAttributes = [];
  world.chargeGroupAttributes = [];
  const byCategoryForGroups = member(world, "attributesByCategory");
  const groupCategory = constant("dgmAttrCatGroup");
  for (const row of list(invoke(byCategoryForGroups, "at", [groupCategory]))) {
    const name = ascii(member(row, "name"));
    if (name.startsWith("canFitShipGroup")) appendID(world, "canFitShipGroupAttributes", row);
    else if (name.startsWith("allowedDroneGroup")) appendID(world, "allowedDroneGroupAttributes", row);
    else if (name.startsWith("chargeGroup")) appendID(world, "chargeGroupAttributes", row);
  }
  world.canFitShipTypeAttributes = [];
  world.requiredSkillAttributes = newMap();
  const byCategoryForTypes = member(world, "attributesByCategory");
  const typeCategory = constant("dgmAttrCatType");
  for (const row of list(invoke(byCategoryForTypes, "at", [typeCategory]))) {
    const name = ascii(member(row, "name"));
    if (name === "fitsToShipType" || name.startsWith("canFitShipType")) appendID(world, "canFitShipTypeAttributes", row);
    else if (name.startsWith("requiredSkill")) {
      const level = invoke(member(world, "attributesByName"), "at", [name + "Level"]);
      // RHS level.attributeID precedes target-map/key evaluation in STORE_SUBSCR.
      const value = numeric(member(level, "attributeID"));
      const target = member(world, "requiredSkillAttributes");
      const key = numeric(member(row, "attributeID"));
      invoke(target, "set", [key, value]);
    }
  }
  world.shipHardwareModifierAttribs = [
    tuple([constant("attributeHiSlots"), constant("attributeHiSlotModifier")]),
    tuple([constant("attributeMedSlots"), constant("attributeMedSlotModifier")]),
    tuple([constant("attributeLowSlots"), constant("attributeLowSlotModifier")]),
    tuple([constant("attributeTurretSlotsLeft"), constant("attributeTurretHardpointModifier")]),
    tuple([constant("attributeLauncherSlotsLeft"), constant("attributeLauncherHardPointModifier")]),
  ];
  world.resistanceAttributesByLayer = newMap();
  // Build the ENTIRE RHS tuple before starting the loop, including the source
  // hp/uniformity constants not subsequently used by this method's body.
  const layers = tuple([
    tuple([constant("attributeShieldCharge"), "Shield", constant("attributeShieldCapacity"), constant("attributeShieldUniformity")]),
    tuple([constant("attributeArmorDamage"), "Armor", constant("attributeArmorHP"), constant("attributeArmorUniformity")]),
    tuple([constant("attributeDamage"), "", constant("attributeHp"), constant("attributeStructureUniformity")]),
  ]);
  for (const [attributeID, layerName] of layers) {
    const resonances = ["EmDamageResonance", "ExplosiveDamageResonance", "KineticDamageResonance", "ThermalDamageResonance"]
      .map(suffix => constant("attribute" + layerName + suffix));
    invoke(member(world, "resistanceAttributesByLayer"), "set", [attributeID, resonances]);
  }
  world.damageAttributes = tuple([
    constant("attributeEmDamage"), constant("attributeExplosiveDamage"),
    constant("attributeKineticDamage"), constant("attributeThermalDamage"),
  ]);
  world.damageStateAttributes = tuple([
    constant("attributeDamage"), constant("attributeArmorDamage"), constant("attributeShieldCharge"),
  ]);
  world.layerResAttributesByDamage = newMap();
  const entries = invoke(member(world, "resistanceAttributesByLayer"), "iteritems");
  for (const [layerAttributeID, resonances] of entries) {
    const paired = zip(member(world, "damageAttributes"), resonances);
    invoke(member(world, "layerResAttributesByDamage"), "set", [layerAttributeID, paired]);
  }
  return null; // Original successful implicit None return.
}

module.exports = { initializeClientDogmaStaticLoadAttributes };
