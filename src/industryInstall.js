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
  facilityMaterialModifiers,
  facilityTimeModifiers,
  findFacilityRow,
  inventionProductTypeID,
  inventionRequestMaterials,
  manufacturingJobSeconds,
  modifierMatchesProduct,
  roundMaterialQuantity,
};
