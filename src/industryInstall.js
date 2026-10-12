"use strict";

// Invention with a decryptor: the materials an InstallJob request must carry.
//
// ---------------------------------------------------------------------------
// WHY THE BFF HAS TO SEND MATERIALS AT ALL. For every other install the
// request's `materials` is advisory and the BFF sends an empty map, which the
// server reads as "recompute from the blueprint" (industryRuntimeState.js,
// after Job._get_errors). A decryptor is the exception: the server takes it
// from the request's materials ONLY (resolveInventionDecryptorSelection: one
// decryptor, quantity equal to the runs), and once that map is non-empty it
// must match the server's own map EXACTLY (materialMapsMatchExactly) or the
// install is refused with MISMATCH_MATERIAL. So the map is built here the way
// the server builds it, which is the way the retail client builds it:
//
//     quantity = max(trunc(ceil(round(base x runs x facility, 2))), runs)
//
// per invention material (industryParityHelpers.js buildIndustryActivityMaterials
// and roundMaterialQuantity; no blueprint efficiency applies to invention),
// where `facility` is the product of the facility's material modifiers for
// invention that match the product (resolveFacilityActivityModifier), plus the
// decryptor at one per run.

const DECRYPTOR_GROUP_ID = 1304;
const INVENTION_ACTIVITY_ID = 8;
/** activities[activityID] is a tuple of modifier lists: time, material, cost, ... */
const TIME_MODIFIER_INDEX = 0;
const MATERIAL_MODIFIER_INDEX = 1;
const COST_MODIFIER_INDEX = 2;
/** clonegrade.CLONE_STATE_INDUSTRY_TAX: an alpha clone's job costs this much of the base, less one, beyond an omega's. */
const ALPHA_INDUSTRY_TAX = 1.0025;
/** industry.SCC_SURCHARGE_RATE: what the SCC takes of a job's rounded base, by the facility's modifier of it. (Research pays half of it; no research is reckoned here.) */
const SCC_SURCHARGE_RATE = 0.04;
/** security.common.const.INDUSTRY_SECURITY_TAX_RATE: what a job in a safe system pays of its rounded base beside the rest. */
const INDUSTRY_SECURITY_TAX_RATE = 0.05;
/** eveuniverse/security.py SecurityClassFromLevel: a system's security from which it is a safe one. */
const SAFE_SECURITY_FROM = 0.95;
/** structures/services.py: the three services a structure manufactures by. */
const SERVICE_MANUFACTURING_BASIC = 22;
const SERVICE_MANUFACTURING_CAPITAL = 23;
const SERVICE_MANUFACTURING_SUPERCAPITAL = 24;
/** inventorycommon.const.superCapitalShipsGroups: the supercarriers' group and the titans'. */
const SUPERCAPITAL_SHIP_GROUPS = new Set([659, 30]);
/** inventorycommon.const.capitalShipsGroups: force auxiliaries, carriers, command carriers, dreadnoughts, capital industrial ships and lancer dreadnoughts. */
const CAPITAL_SHIP_GROUPS = new Set([1538, 547, 5120, 485, 883, 4594]);

function entriesOf(value) {
  if (value && typeof value === "object" && value.type === "dict" && Array.isArray(value.entries)) {
    return value.entries;
  }
  if (value && typeof value === "object" && value.args) {
    return entriesOf(value.args);
  }
  return [];
}

function itemsOf(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray(value.items)) {
    return value.items;
  }
  return [];
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

/** One of the lists of modifiers a facility has for an activity, by its place in the activity's tuple. */
function facilityModifierList(facilityRow, activityID, index) {
  const field = entriesOf(facilityRow).find(([key]) => key === "activities");
  const activity = entriesOf(field ? field[1] : null).find(([key]) => toInt(key) === activityID);
  const lists = itemsOf(activity ? activity[1] : null);
  return itemsOf(lists[index]).filter(Array.isArray);
}

/**
 * One facility's material modifiers for an activity, from a GetFacilities row
 * (a util.KeyVal whose `activities` is a dict of activityID to a tuple). Each
 * is [value, categoryID, groupID, typeID, reference]; null ids mean "any".
 */
function facilityMaterialModifiers(facilityRow, activityID) {
  return facilityModifierList(facilityRow, activityID, MATERIAL_MODIFIER_INDEX);
}

/** One facility's time modifiers for an activity, from the same row and in the same form. */
function facilityTimeModifiers(facilityRow, activityID) {
  return facilityModifierList(facilityRow, activityID, TIME_MODIFIER_INDEX);
}

/** One facility's cost modifiers for an activity, likewise. */
function facilityCostModifiers(facilityRow, activityID) {
  return facilityModifierList(facilityRow, activityID, COST_MODIFIER_INDEX);
}

/**
 * The two cost modifiers of a facility's that are not its own (industryCommon.Facility, 395 to 398): the
 * faction's, and the system's for an activity, out of the row's `globalModifiers`. Null for one the row has not.
 */
function facilityGlobalModifiers(facilityRow, activityID) {
  const named = (value, name) => (entriesOf(value).find(([key]) => key === name) || [])[1];
  const global = named(facilityRow, "globalModifiers");
  const faction = named(global, "faction");
  const system = (entriesOf(named(global, "system")).find(([key]) => toInt(key) === activityID) || [])[1];
  return { faction: aNumber(faction) ? faction : null, system: aNumber(system) ? system : null };
}

/** The facility row for `facilityID` in a GetFacilities answer, or null. */
function findFacilityRow(facilities, facilityID) {
  for (const row of itemsOf(facilities)) {
    const field = entriesOf(row).find(([key]) => key === "facilityID");
    if (field && toInt(field[1]) === facilityID) {
      return row;
    }
  }
  return null;
}

/** The server's modifierMatchesProduct: category, else group, else type. */
function modifierMatchesProduct(modifier, productType) {
  const categoryID = toInt(modifier[1]);
  const groupID = toInt(modifier[2]);
  const typeID = toInt(modifier[3]);
  if (categoryID <= 0 && groupID <= 0 && typeID <= 0) {
    return true;
  }
  if (!productType) {
    return false;
  }
  if (categoryID > 0) {
    return toInt(productType.categoryID) === categoryID;
  }
  if (groupID > 0) {
    return toInt(productType.groupID) === groupID;
  }
  return toInt(productType.typeID) === typeID;
}

/** The server's roundMaterialQuantity (two decimals, then up, at least one per run). */
function roundMaterialQuantity(quantity, runs) {
  return Math.max(Math.trunc(Math.ceil(Math.round(quantity * 100) / 100)), runs);
}

/**
 * The exact materials map for an invention install with a decryptor, keyed by
 * typeID. `invention` is the blueprint definition's invention activity
 * (static data), `modifiers` the facility's invention material modifiers, and
 * `productType` the invented blueprint's type record (for group and category).
 */
function inventionRequestMaterials({ invention, runs, modifiers, productType, decryptorTypeID }) {
  let facility = 1;
  for (const modifier of modifiers || []) {
    if (modifierMatchesProduct(modifier, productType)) {
      facility *= Math.max(0, Number(modifier[0]) || 0);
    }
  }
  const materials = {};
  for (const material of (invention && invention.materials) || []) {
    const typeID = toInt(material && material.typeID);
    const quantity = roundMaterialQuantity(Math.max(0, toInt(material && material.quantity)) * runs * facility, runs);
    if (typeID > 0 && quantity > 0) {
      materials[String(typeID)] = (materials[String(typeID)] || 0) + quantity;
    }
  }
  materials[String(decryptorTypeID)] = runs;
  return materials;
}

const aNumber = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * A manufacturing job's time in whole seconds, as the client's own job reckons it before it sends the job to be
 * previewed or installed (industry/job.py _get_time, 460 to 468): the activity's time for the runs
 * (activity.job_time), times each time modifier the job has, in the order the job lists them
 * (_get_all_modifiers, 230), and rounded.
 *
 *   job.modifiers            industryCommon.GetJobModifiers (485): each required skill that has a time per level,
 *                            `skills` ({ perLevel, level }: 1.0 + perLevel x level / 100.0), then the pilot's own
 *                            manufacturing time attribute, `characterAmount`
 *   activity.job_modifiers   activities/manufacturing.py 15: 1.0 - timeEfficiency / 100.0, where the blueprint has
 *                            any time research
 *   facility.modifiers       industryCommon.Facility (378): each of the facility's time modifiers for the activity
 *                            that is for the blueprint's product (`productType`), in the facility's own order
 *
 * ⚠ THE ORDER IS THE CLIENT'S AND MUST STAY SO. The server holds a time that is not nought against its own, to the
 * second, and these are floats: the same numbers multiplied another way round can come a second apart
 * (test/industryJobTime.test.js has three such).
 *
 * Null where any input is not what it should be: no time is made of a guess, and nought is sent instead, which
 * the server does not check.
 */
function manufacturingJobSeconds({ activityTime, runs, skills, characterAmount, timeEfficiency, facilityModifiers, productType }) {
  if (!aNumber(activityTime) || activityTime <= 0 || !Number.isSafeInteger(runs) || runs <= 0 || !aNumber(characterAmount)) {
    return null;
  }
  if (!Number.isSafeInteger(timeEfficiency) || timeEfficiency < 0) {
    return null;
  }
  let seconds = activityTime * runs;
  for (const skill of skills || []) {
    if (!skill || !aNumber(skill.perLevel) || !aNumber(skill.level)) {
      return null;
    }
    seconds *= 1.0 + (skill.perLevel * skill.level) / 100.0;
  }
  seconds *= characterAmount;
  if (timeEfficiency) {
    seconds *= 1.0 - timeEfficiency / 100.0;
  }
  for (const modifier of facilityModifiers || []) {
    if (!Array.isArray(modifier) || !aNumber(modifier[0])) {
      return null;
    }
    if (modifierMatchesProduct(modifier, productType)) {
      seconds *= modifier[0];
    }
  }
  // long(round(seconds)): a half goes up, as it does here for a time, which is never below nought.
  return Math.round(seconds);
}

/**
 * What a facility's row says a job at it is charged by beside its tax (industryCommon.Facility, 378 to 380): the
 * SCC's modifier of its surcharge, and the system it is in. Null for one the row has not.
 */
function facilityCharges(facilityRow) {
  const named = (name) => (entriesOf(facilityRow).find(([key]) => key === name) || [])[1];
  const [sccTaxModifier, solarSystemID] = [named("sccTaxModifier"), toInt(named("solarSystemID"))];
  return {
    sccTaxModifier: aNumber(sccTaxModifier) ? sccTaxModifier : null,
    solarSystemID: solarSystemID > 0 ? solarSystemID : null,
  };
}

/**
 * The service a structure manufactures a thing by, as the client's structures say it (structures/services.py
 * GetServiceID, 149 to 158): by the group of what is made. Null where that is no group.
 */
function manufacturingServiceID(productGroupID) {
  if (!Number.isSafeInteger(productGroupID) || productGroupID <= 0) {
    return null;
  }
  if (SUPERCAPITAL_SHIP_GROUPS.has(productGroupID)) {
    return SERVICE_MANUFACTURING_SUPERCAPITAL;
  }
  return CAPITAL_SHIP_GROUPS.has(productGroupID) ? SERVICE_MANUFACTURING_CAPITAL : SERVICE_MANUFACTURING_BASIC;
}

/**
 * The rate a facility taxes a job by, as the client's activity has it (industry/activity.py activity_tax, 50 to
 * 58): the row's own tax where it says one, a tax of nought among them. Where it says None, as a structure's does,
 * the rate is by the access of the service the job is done by (`serviceID`), out of the row's `serviceAccess`, and
 * nought where that says nothing for the service, or says None (serviceAccess.get(serviceID, 0) or 0).
 *
 * Null where no rate can be read whole: the row says no tax at all, or one that is no number; it says None and has
 * no access by service; the service is not known; or the access says something for it that is no number.
 */
function facilityTaxRate(facilityRow, serviceID) {
  const named = (name) => (entriesOf(facilityRow).find(([key]) => key === name) || [])[1];
  const tax = named("tax");
  if (aNumber(tax)) {
    return tax;
  }
  const access = named("serviceAccess");
  if (tax !== null || !(access && access.type === "dict" && Array.isArray(access.entries)) || !Number.isSafeInteger(serviceID)) {
    return null;
  }
  const said = (access.entries.find(([key]) => typeof key === "number" && key === serviceID) || [])[1];
  if (said === undefined || said === null) {
    return 0;
  }
  return aNumber(said) ? said : null;
}

/** A blueprint's price and a job's runs that a base can be made of. */
const aBase = (price, runs) => aNumber(price) && price >= 0 && Number.isSafeInteger(runs) && runs > 0;

/**
 * A manufacturing job's tax in whole ISK, as the client's own job reckons it (industry/job.py _get_tax, 450 to
 * 458): the base rounded (base_cost, 127 to 130: int(round(job_cost))) times the facility's rate (facilityTaxRate),
 * rounded. Null where there is no rate, or an input is not what it should be.
 */
function manufacturingJobTax({ blueprintPrice: price, runs, facilityTax }) {
  if (!aBase(price, runs) || !aNumber(facilityTax)) {
    return null;
  }
  return Math.round(Math.round(price * runs) * facilityTax);
}

/**
 * What a manufacturing job costs to start, as the client's own job adds it up (industry/job.py total_cost, 132 to
 * 135): its cost and its tax, each as it was reckoned; the SCC's surcharge (137 to 152), the rounded base times
 * SCC_SURCHARGE_RATE by the facility's modifier of it, never below nought; and, in a system whose security is 0.95
 * or more, an industry security tax (164 to 174) of the rounded base times INDUSTRY_SECURITY_TAX_RATE. Each part a
 * whole amount, and their total.
 *
 * Null where a part is no whole amount or an input is no number: no fee is said of a guess.
 */
function manufacturingJobFee({ blueprintPrice: price, runs, cost, tax, sccTaxModifier, security }) {
  const anAmount = (value) => Number.isSafeInteger(value) && value >= 0;
  if (!aBase(price, runs) || !anAmount(cost) || !anAmount(tax) || !aNumber(sccTaxModifier) || !aNumber(security)) {
    return null;
  }
  const baseCost = Math.round(price * runs);
  const sccSurcharge = Math.round(baseCost * Math.max(0, SCC_SURCHARGE_RATE * sccTaxModifier));
  const securityTax = security >= SAFE_SECURITY_FROM ? Math.round(baseCost * INDUSTRY_SECURITY_TAX_RATE) : 0;
  return { cost, tax, sccSurcharge, securityTax, total: cost + tax + sccSurcharge + securityTax };
}

/**
 * A blueprint's price, as the client's industry prices one (industryCommon.GetBlueprintPrice, 520 to 543): each of
 * its manufacturing materials' own price times its quantity, summed in the blueprint's order. A type that is no
 * blueprint, or a blueprint that has no manufacturing, is priced at its adjusted average price, and at nought
 * where it has none (the client logs that, and goes on). A blueprint whose manufacturing lists no materials is
 * nought.
 *
 * `activitiesOf(typeID)` is a blueprint type's activities, or null for a type that is no blueprint.
 * `adjustedPriceOf(typeID)` is the type's adjusted average price off the pilot's price table: null where the
 * table has not the type, and undefined where there is no table to read.
 *
 * Null where the price cannot be read whole: there is no table, a price or a quantity is no number, or a blueprint
 * is among its own materials (the game's data has none such, and the client would not come back from one).
 */
function blueprintPrice(typeID, lookups, within = new Set()) {
  const activities = lookups.activitiesOf(typeID);
  const manufacturing = activities ? activities.manufacturing : null;
  if (!manufacturing) {
    const adjusted = lookups.adjustedPriceOf(typeID);
    if (adjusted === null) {
      return 0;
    }
    return aNumber(adjusted) ? adjusted : null;
  }
  if (within.has(typeID)) {
    return null;
  }
  within.add(typeID);
  let price = 0;
  for (const material of manufacturing.materials || []) {
    const each = Number.isSafeInteger(material && material.quantity) ? blueprintPrice(material.typeID, lookups, within) : null;
    if (each === null) {
      return null;
    }
    price += each * material.quantity;
  }
  within.delete(typeID);
  return price;
}

/**
 * A manufacturing job's cost in whole ISK, as the client's own job reckons it before it sends the job to be
 * previewed or installed (industry/job.py _get_cost_for_modifiers, 310 to 320): the base, activity.job_cost
 * (activities/manufacturing.py 26: the blueprint's price times the runs, not rounded), times each cost modifier
 * the job has that is not an added one, in the order the job lists them (_get_all_modifiers, 230); plus, for each
 * added one, the base as it began times what the modifier is beyond one; rounded once.
 *
 *   job.modifiers        industryCommon.GetJobModifiers (485 to 513): the blueprint type's own cost multiplier,
 *                        `blueprintAmount` (attribute 1954; null for a type that has none); and for an alpha
 *                        clone an added one, clonegrade.CLONE_STATE_INDUSTRY_TAX
 *   facility.modifiers   industryCommon.Facility (378 to 418): the faction's where it is not 1.0, the system's
 *                        for the activity where it is neither 0.0 nor 1.0, then each of the facility's cost
 *                        modifiers that is for the blueprint's product, in the facility's own order
 *
 * ⚠ THE ORDER IS THE CLIENT'S AND MUST STAY SO, as a job's time's is (manufacturingJobSeconds): the server holds
 * a cost that is not nought against its own, to the ISK.
 *
 * Null where any input is not what it should be: no cost is made of a guess, and nought is sent instead, which
 * the server does not check.
 */
function manufacturingJobCost({ blueprintPrice: price, runs, blueprintAmount, alpha, faction, system, facilityModifiers, productType }) {
  if (!aNumber(price) || price < 0 || !Number.isSafeInteger(runs) || runs <= 0) {
    return null;
  }
  if ((blueprintAmount !== null && !aNumber(blueprintAmount)) || typeof alpha !== "boolean" || !aNumber(faction) || !aNumber(system)) {
    return null;
  }
  const base = price * runs;
  let cost = base;
  if (blueprintAmount !== null) {
    cost *= blueprintAmount;
  }
  if (faction !== 1.0) {
    cost *= faction;
  }
  if (system !== 0.0 && system !== 1.0) {
    cost *= system;
  }
  for (const modifier of facilityModifiers || []) {
    if (!Array.isArray(modifier) || !aNumber(modifier[0])) {
      return null;
    }
    if (modifierMatchesProduct(modifier, productType)) {
      cost *= modifier[0];
    }
  }
  const added = alpha ? base * (ALPHA_INDUSTRY_TAX - 1.0) : 0;
  // int(round(cost + additive_cost)): a half goes up, as it does here for a cost, which is never below nought.
  return Math.round(cost + added);
}

/** The single product an invention makes, as the server resolves it when none is asked for. */
function inventionProductTypeID(invention, requested) {
  const products = ((invention && invention.products) || []).filter((product) => toInt(product && product.typeID) > 0);
  if (requested > 0) {
    return products.some((product) => toInt(product.typeID) === requested) ? requested : 0;
  }
  return products.length === 1 ? toInt(products[0].typeID) : 0;
}

module.exports = {
  DECRYPTOR_GROUP_ID,
  INVENTION_ACTIVITY_ID,
  blueprintPrice,
  facilityCharges,
  facilityCostModifiers,
  facilityGlobalModifiers,
  facilityMaterialModifiers,
  facilityTaxRate,
  facilityTimeModifiers,
  findFacilityRow,
  inventionProductTypeID,
  inventionRequestMaterials,
  manufacturingJobCost,
  manufacturingJobFee,
  manufacturingJobSeconds,
  manufacturingJobTax,
  manufacturingServiceID,
  modifierMatchesProduct,
  roundMaterialQuantity,
};
