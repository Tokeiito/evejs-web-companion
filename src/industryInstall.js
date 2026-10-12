"use strict";

// What an InstallJob request carries that the client's own job reckons before it sends the job: the time, the cost,
// the tax and the materials of a manufacturing job, a copy job, a research job and an invention.
//
// ---------------------------------------------------------------------------
// THE MATERIALS GO WITH EVERY JOB (industry/job.py dump, 637), each quantity made whole as the client's job makes
// it (470 to 485):
//
//     quantity = float(base), times each material modifier in turn, times the runs the materials are for
//     max(int(math.ceil(round(quantity, 2))), runs)
//
// The server holds a map that is not empty against its own, and refuses one that is not its own to the unit
// (MISMATCH_MATERIAL). AN INVENTION'S DECRYPTOR is in that map and nowhere else: the server takes it from the
// request's materials ONLY (resolveInventionDecryptorSelection: one decryptor, at the job's runs).

const DECRYPTOR_GROUP_ID = 1304;
const INVENTION_ACTIVITY_ID = 8;
/** activities[activityID] is a tuple of modifier lists: time, material, cost, ... */
const TIME_MODIFIER_INDEX = 0;
const MATERIAL_MODIFIER_INDEX = 1;
const COST_MODIFIER_INDEX = 2;
/** clonegrade.CLONE_STATE_INDUSTRY_TAX: an alpha clone's job costs this much of the base, less one, beyond an omega's. */
const ALPHA_INDUSTRY_TAX = 1.0025;
/** industry.SCC_SURCHARGE_RATE: what the SCC takes of a job's rounded base, by the facility's modifier of it. (A research job pays half of it: SCC_SURCHARGE_RESEARCH_DISCOUNT.) */
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
/** structures/services.py: the service a structure copies a blueprint by. */
const SERVICE_LABORATORY_COPYING = 33;
/** structures/services.py: the service a structure invents by. */
const SERVICE_LABORATORY_INVENTION = 34;
/** activities/invention.py MAX_RUNS: the most runs one invention has. */
const INVENTION_MAX_RUNS = 500;
/**
 * The name the empty place of an invention's optional material has in the BFF's own job. The client's job has the
 * place among its materials whether a decryptor is in it or not, and its dump has it under None where none is
 * (industryCommon.GetDecryptors, 458 to 482; industry/job.py 637); the game port writes this name as that None
 * (src/gamePort/retailCalls.js, jobDumped).
 */
const NO_OPTIONAL_MATERIAL = "None";
/** industry.COST_PERCENTAGE: what a copy job's base is of the blueprint's price, for each run of each copy. */
const COST_PERCENTAGE = 0.02;
/** activities/copying.py MAX_RUNS: the most copies one job makes. */
const COPYING_MAX_RUNS = 500;
/** industry.MAX_RUN_LENGTH: thirty days of seconds, by which the most runs a job can have are reckoned. */
const MAX_RUN_LENGTH = 2592000;
/** structures/services.py: the two services a structure researches a blueprint by, its time and its materials. */
const SERVICE_LABORATORY_RESEARCH_TIME = 31;
const SERVICE_LABORATORY_RESEARCH_MATERIAL = 32;
/** structures/services.py: the four services a structure reacts by. */
const SERVICE_REACTIONS = 40;
const SERVICE_REACTIONS_COMPOSITE = 41;
const SERVICE_REACTIONS_BIOCHEMICAL = 42;
const SERVICE_REACTIONS_HYBRID = 43;
/** inventorycommon.const.groupBiochemicalMaterial and groupMolecularForgedMaterials. */
const BIOCHEMICAL_REACTION_GROUPS = new Set([712, 4096]);
/** inventorycommon.const.groupHybridPolymers. */
const HYBRID_POLYMERS_GROUP = 974;
/** inventorycommon.const.compositeReactionGroups: intermediate materials, composites and unrefined minerals. */
const COMPOSITE_REACTION_GROUPS = new Set([428, 429, 4932]);
/** industry.RESEARCH_TIMES: what one run of a research takes of the activity's time, by the level the run starts from. */
const RESEARCH_TIMES = Object.freeze([1.0, 29 / 21.0, 23 / 7.0, 39 / 5.0, 278 / 15.0, 928 / 21.0, 2200 / 21.0, 5251 / 21.0, 4163 / 7.0, 29660 / 21.0]);
/** industry.SCC_SURCHARGE_RESEARCH_DISCOUNT_MODIFIER: a research job pays this much of the SCC's surcharge. */
const SCC_SURCHARGE_RESEARCH_DISCOUNT = 0.5;
/**
 * The two researches, by the activity's own number (3, of a blueprint's time; 4, of its materials): the step one
 * run raises the blueprint's research by, the most it comes to (industry.STEP_ and MAX_TIME_EFFICIENCY, and the
 * two of MATERIAL), and the service a structure does it by.
 */
const RESEARCHES = Object.freeze({
  3: Object.freeze({ step: 2, most: 20, serviceID: SERVICE_LABORATORY_RESEARCH_TIME }),
  4: Object.freeze({ step: 1, most: 10, serviceID: SERVICE_LABORATORY_RESEARCH_MATERIAL }),
});

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

const aNumber = (value) => typeof value === "number" && Number.isFinite(value);
/** A whole number above nought: a job's runs, or the runs a copy is licensed for. */
const aCount = (value) => Number.isSafeInteger(value) && value > 0;

/**
 * The amounts of those of a facility's modifiers that are for a product, in the facility's own order. Null where
 * one of them is no modifier: nothing is reckoned from a row that is not what it should be.
 */
function facilityAmounts(facilityModifiers, productType) {
  const amounts = [];
  for (const modifier of facilityModifiers || []) {
    if (!Array.isArray(modifier) || !aNumber(modifier[0])) {
      return null;
    }
    if (modifierMatchesProduct(modifier, productType)) {
      amounts.push(modifier[0]);
    }
  }
  return amounts;
}

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
 * A copy job's time in whole seconds, as the client's own job reckons it (industry/job.py _get_time, 460 to 468):
 * the activity's time for the job (activities/copying.py job_time, 12: the time, by the runs each copy is licensed
 * for, by the copies), times each time modifier the job has, in the order the job lists them, and rounded.
 *
 *   job.modifiers        industryCommon.GetJobModifiers (485): the pilot's own copy speed attribute,
 *                        `characterAmount`. No skill's time per level is among a copy job's: the client lists those
 *                        for manufacturing alone (REQUIRED_SKILL_MODIFIERS, 44)
 *   facility.modifiers   each of the facility's time modifiers for copying that is for the blueprint's product, in
 *                        the facility's own order
 *
 * The blueprint's time research is not in it: a copy job has no modifier of the blueprint's
 * (activity.job_modifiers, 22). The order is the client's and must stay so, as a manufacturing job's must.
 *
 * Null where any input is not what it should be, and nought is sent instead, which the server does not check.
 */
function copyingJobSeconds({ activityTime, runs, licensedRuns, characterAmount, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!aNumber(activityTime) || activityTime <= 0 || !aCount(runs) || !aCount(licensedRuns) || !aNumber(characterAmount) || amounts === null) {
    return null;
  }
  let seconds = activityTime * licensedRuns * runs;
  seconds *= characterAmount;
  for (const amount of amounts) {
    seconds *= amount;
  }
  return Math.round(seconds);
}

/**
 * The most copies one job can make, as the client's job has it, which holds a job's runs to it (industry/job.py
 * _get_runs, 395; activity.py job_max_runs, 34 to 36): thirty days over the activity's time over the job's time
 * modifiers multiplied together, taken up to the whole, and never more than COPYING_MAX_RUNS. The runs each copy is
 * licensed for are not in it.
 *
 * Null where an input is not what it should be, or the modifiers come to nothing a time can be divided by.
 */
function copyingJobMostRuns({ activityTime, characterAmount, facilityModifiers, productType }) {
  const most = runsThirtyDaysHold({ activityTime, characterAmount, facilityModifiers, productType });
  return most === null ? null : Math.min(most, COPYING_MAX_RUNS);
}

/**
 * The runs thirty days hold of an activity's time, as the client's activity reckons them for any job
 * (activity.py job_max_runs, 34 to 36): MAX_RUN_LENGTH over the activity's time over the job's time modifiers
 * multiplied together, taken up to the whole. The modifiers are the pilot's own time for the work and then the
 * facility's for the blueprint's product. Null where an input is not what it should be, or the modifiers come to
 * nothing a time can be divided by.
 */
function runsThirtyDaysHold({ activityTime, characterAmount, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!aNumber(activityTime) || activityTime <= 0 || !aNumber(characterAmount) || amounts === null) {
    return null;
  }
  // reduce(operator.mul, modifiers, 1.0): multiplied together first, from one.
  let together = 1.0 * characterAmount;
  for (const amount of amounts) {
    together *= amount;
  }
  const most = Math.ceil(MAX_RUN_LENGTH / activityTime / together);
  return aCount(most) ? most : null;
}

/**
 * An invention's time in whole seconds, as the client's own job reckons it (industry/job.py _get_time, 460 to 468):
 * the activity's time for the job (activity.py job_time, 28: the time by the runs), times each time modifier the job
 * has, in the order the job lists them, and rounded.
 *
 *   job.modifiers        industryCommon.GetJobModifiers (485): the pilot's own invention time, `characterAmount`
 *                        (attribute 1959). No skill's time per level is among an invention's
 *   facility.modifiers   each of the facility's time modifiers for invention that is for the blueprint's product,
 *                        in the facility's own order
 *
 * An invention's own modifiers are of its chance, and a decryptor's of time is of what is invented, not of the job
 * (activities/invention.py 13 to 18; industryCommon.GetDecryptors, 465: output=True). The order is the client's and
 * must stay so. Null where any input is not what it should be, and nought is sent instead, which the server does
 * not check.
 */
function inventionJobSeconds({ activityTime, runs, characterAmount, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!aNumber(activityTime) || activityTime <= 0 || !aCount(runs) || !aNumber(characterAmount) || amounts === null) {
    return null;
  }
  let seconds = activityTime * runs;
  seconds *= characterAmount;
  for (const amount of amounts) {
    seconds *= amount;
  }
  return Math.round(seconds);
}

/**
 * A reaction's time in whole seconds, as the client's own job reckons it (industry/job.py _get_time, 460 to 468):
 * the activity's time by the runs (activity.py job_time, 28), times each time modifier the job has, in the order
 * the job lists them, and rounded.
 *
 *   job.modifiers        industryCommon.GetJobModifiers (485): the pilot's own reaction time, `characterAmount`
 *                        (attribute 2662). No skill's time per level is among a reaction's: the client lists those
 *                        for manufacturing alone (REQUIRED_SKILL_MODIFIERS, 44)
 *   facility.modifiers   each of the facility's time modifiers for reactions that is for the formula's product, in
 *                        the facility's own order
 *
 * A reaction has no modifier of the blueprint's (activities/reaction.py has none; activity.py 22): a formula has
 * no research. The order is the client's and must stay so, as a manufacturing job's must. Null where any input is
 * not what it should be, and nought is sent instead, which the server does not check.
 */
function reactionJobSeconds({ activityTime, runs, characterAmount, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!aNumber(activityTime) || activityTime <= 0 || !aCount(runs) || !aNumber(characterAmount) || amounts === null) {
    return null;
  }
  let seconds = activityTime * runs;
  seconds *= characterAmount;
  for (const amount of amounts) {
    seconds *= amount;
  }
  return Math.round(seconds);
}

/**
 * The most runs any invention can have, as the client's activity has it (activity.py 34 to 36, with
 * activities/invention.py's own MAX_RUNS): what thirty days hold of the activity's time, and never more than
 * INVENTION_MAX_RUNS. (The client's job holds its runs to the fewer of this and the runs the copy has left,
 * invention.py 36 to 37; those are the blueprint's, and are held by the page and by the server.)
 */
function inventionJobMostRuns({ activityTime, characterAmount, facilityModifiers, productType }) {
  const most = runsThirtyDaysHold({ activityTime, characterAmount, facilityModifiers, productType });
  return most === null ? null : Math.min(most, INVENTION_MAX_RUNS);
}

/**
 * Where a blueprint stands in a research, as the client's activity reads it (activities/research_time.py and
 * research_material.py, which are one but for what they read: blueprint_level, 11, and job_max_runs, 23): the
 * level it is at, which is its research over the step, and the runs left to it, which is what is left to the most
 * over the step; each a whole division. `finished` is a blueprint at the last level, which has no job of that
 * research (job_validate, 33 to 37). `activityID` is the research's own number and `efficiency` the blueprint's
 * research of that kind (its time research for the one, its material research for the other).
 *
 * Null for any other kind of work, and for a research that is no whole number from nought to the most.
 */
function researchStanding(activityID, efficiency) {
  const research = aResearch(activityID) ? RESEARCHES[activityID] : null;
  if (!research || !Number.isSafeInteger(efficiency) || efficiency < 0 || efficiency > research.most) {
    return null;
  }
  const level = Math.floor(efficiency / research.step);
  return { level, runsLeft: Math.floor((research.most - efficiency) / research.step), finished: level >= RESEARCH_TIMES.length };
}

/** The service a structure does a research by, by the research's own number (structures/services.py 168 to 171); null for any other work. */
function researchServiceID(activityID) {
  return aResearch(activityID) ? RESEARCHES[activityID].serviceID : null;
}

/** An activity's number that is a research's: the number itself, and not its text. */
const aResearch = (activityID) => typeof activityID === "number" && Object.hasOwn(RESEARCHES, activityID);

/** A level a run of research can start from: a whole number from nought to the last but one of the ten. */
const aLevel = (value) => Number.isSafeInteger(value) && value >= 0 && value < RESEARCH_TIMES.length;

/**
 * A research's own time for a job (job_time, 17 to 20), not rounded: the sum, from nought, of each run's time, a
 * run's being the activity's time by RESEARCH_TIMES at the level the run starts from (blueprint_levels, 14). Each
 * run starts a level above the one before it.
 */
function researchActivitySeconds(activityTime, level, runs) {
  let seconds = 0;
  for (let run = 0; run < runs; run += 1) {
    seconds += activityTime * RESEARCH_TIMES[Math.min(level + run, RESEARCH_TIMES.length - 1)];
  }
  return seconds;
}

/**
 * A research job's time in whole seconds, as the client's own job reckons it (industry/job.py _get_time, 460 to
 * 468): the research's own time for the job (researchActivitySeconds), from the level the blueprint is at, times
 * each time modifier the job has, in the order the job lists them, and rounded.
 *
 *   job.modifiers        industryCommon.GetJobModifiers (485): the pilot's own time for that research,
 *                        `characterAmount` (attribute 385 for a research of time, 398 for one of materials). No
 *                        skill's time per level is among a research job's
 *   facility.modifiers   each of the facility's time modifiers for that research that is for the blueprint's
 *                        product, in the facility's own order
 *
 * The order is the client's and must stay so, as a manufacturing job's must. Null where any input is not what it
 * should be, and nought is sent instead, which the server does not check.
 */
function researchJobSeconds({ activityTime, level, runs, characterAmount, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!aNumber(activityTime) || activityTime <= 0 || !aLevel(level) || !aCount(runs) || !aNumber(characterAmount) || amounts === null) {
    return null;
  }
  let seconds = researchActivitySeconds(activityTime, level, runs);
  seconds *= characterAmount;
  for (const amount of amounts) {
    seconds *= amount;
  }
  return Math.round(seconds);
}

/**
 * The most runs one research job can have, as the client's job has it, which holds a job's runs to it
 * (research_time.py job_max_runs, 22 to 23; activity.py 34 to 36): the fewer of the runs left to the blueprint
 * (`runsLeft`: researchStanding) and what any job can have, which is thirty days over the activity's time over the
 * job's time modifiers multiplied together, taken up to the whole. (And never more than a million,
 * industry.MAX_RUNS_HARD_CAP, which a research cannot come near: it has ten runs at the most.) Nought for a
 * blueprint that has no run left.
 *
 * Null where an input is not what it should be, or the modifiers come to nothing a time can be divided by.
 */
function researchJobMostRuns({ activityTime, runsLeft, characterAmount, facilityModifiers, productType }) {
  const most = runsThirtyDaysHold({ activityTime, characterAmount, facilityModifiers, productType });
  if (most === null || !Number.isSafeInteger(runsLeft) || runsLeft < 0) {
    return null;
  }
  return Math.min(most, runsLeft);
}

/**
 * A number rounded to two places as the client's Python 2.7 rounds one (round(x, 2), by which its job rounds a
 * material's quantity): to the nearer of the two by what the number itself is, and a number that is exactly a
 * half goes away from nought. toFixed(2) is that for a number that is not below nought: it rounds the number and
 * not its hundredfold, and of two as near it takes the larger. (Asked of the client's own python27.dll for some
 * forty thousand numbers at and beside a half of the second place, and the same for every one;
 * test/industryJobMaterials.test.js has a score of them.)
 *
 * ⚠ NOT Math.round(x * 100) / 100, which the server's own roundMaterialQuantity is. A float written 2.675 is a
 * little under it and rounds to 2.67; its hundredfold comes to 267.5 and rounds to 268.
 */
function roundToTwoPlaces(value) {
  return Number(value.toFixed(2));
}

/**
 * A manufacturing job's materials, each type to its quantity, as the client's own job reckons them before it sends
 * the job to be previewed or installed (industry/job.py _get_materials, 470 to 485; dump, 637). For each material
 * the blueprint's manufacturing lists:
 *
 *   quantity = float(material.base)                 the blueprint's own quantity of it
 *   activity.job_modifiers                          activities/manufacturing.py 12: 1.0 - materialEfficiency /
 *                                                   100.0, where the blueprint has any material research
 *   facility.modifiers                              industryCommon.Facility (378): each of the facility's
 *                                                   material modifiers for the activity that is for the
 *                                                   blueprint's product (`productType`), in the facility's order
 *   quantity *= runs                                activity.job_material_runs (activity.py 38)
 *   max(int(math.ceil(round(quantity, 2))), runs)   never fewer than one a run
 *
 * ⚠ THE ORDER AND THE ROUNDING ARE THE CLIENT'S AND MUST STAY SO. The server holds a map that is not empty against
 * its own, each quantity to the unit, and these are floats: the runs multiplied in first, the facility's modifiers
 * multiplied together first, or the rounding done by a hundred times and back, each comes a unit apart for
 * quantities the game's blueprints list (test/industryJobMaterials.test.js has each).
 *
 * Null where any input is not what it should be: no materials are made of a guess, and an empty map is sent
 * instead, which the server reads as its own to work out.
 */
function manufacturingJobMaterials({ materials, runs, materialEfficiency, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!Array.isArray(materials) || !aCount(runs) || !Number.isSafeInteger(materialEfficiency) || materialEfficiency < 0 || amounts === null) {
    return null;
  }
  return materialsTaken(materials, materialEfficiency ? [1.0 - materialEfficiency / 100.0, ...amounts] : amounts, runs, runs);
}

/**
 * A copy job's materials, each type to its quantity, as the client's own job reckons them (industry/job.py
 * _get_materials, 470 to 485): as a manufacturing job's are, but that the blueprint's material research is not in
 * them (a copy job has no modifier of the blueprint's), and that the quantity is for every run of every copy
 * (activities/copying.py job_material_runs, 18: the copies times the runs each is licensed for). Never fewer than
 * one a copy.
 *
 * A blueprint whose copying lists no materials takes none: an empty map, which is what the client's job sends.
 * Null where any input is not what it should be.
 */
function copyingJobMaterials({ materials, runs, licensedRuns, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!Array.isArray(materials) || !aCount(runs) || !aCount(licensedRuns) || amounts === null) {
    return null;
  }
  return materialsTaken(materials, amounts, runs * licensedRuns, runs);
}

/**
 * A research job's materials, each type to its quantity, as the client's own job reckons them (industry/job.py
 * _get_materials, 470 to 485): as a manufacturing job's are, by the job's runs, but that the blueprint's material
 * research is not in them (a research job has no modifier of the blueprint's). A blueprint whose research lists no
 * materials takes none: an empty map. Null where any input is not what it should be.
 */
function researchJobMaterials({ materials, runs, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!Array.isArray(materials) || !aCount(runs) || amounts === null) {
    return null;
  }
  return materialsTaken(materials, amounts, runs, runs);
}

/**
 * An invention's materials, each type to its quantity, as the client's own job reckons them (industry/job.py
 * _get_materials, 470 to 485): its own materials by its runs, through the facility's material modifiers for
 * invention that are for the blueprint's product (an invention has no material modifier of its own: its own are
 * of its chance), and the place of its optional material, the decryptor, which is one of the job's materials too
 * and is made whole as the rest are (industryCommon.GetDecryptors, 458 to 482; industry/material.py):
 *
 *   a decryptor chosen (`decryptorTypeID`)   its type, from a base of one: one a run, at this server's modifiers
 *   none chosen (nought, or not said)        NO_OPTIONAL_MATERIAL, from a base of nought: the job's runs, which is
 *                                            what the client's job makes of it and sends under None
 *
 * Null where any input is not what it should be.
 */
function inventionJobMaterials({ materials, runs, facilityModifiers, productType, decryptorTypeID }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  const chosen = decryptorTypeID === undefined || decryptorTypeID === 0 ? null : decryptorTypeID;
  if (!Array.isArray(materials) || !aCount(runs) || amounts === null) {
    return null;
  }
  // (A decryptor that is no type is no material, and nothing is made of it: materialsTaken.)
  const taken = materialsTaken(chosen === null ? materials : [...materials, { typeID: chosen, quantity: 1 }], amounts, runs, runs);
  if (taken === null) {
    return null;
  }
  // (None chosen: a base of nought comes to nought whatever it is multiplied by, and is never fewer than the runs.)
  return chosen === null ? { ...taken, [NO_OPTIONAL_MATERIAL]: runs } : taken;
}

/**
 * A reaction's materials, each type to its quantity, as the client's own job reckons them (industry/job.py
 * _get_materials, 470 to 485): as a manufacturing job's are, by the job's runs, but that nothing of the blueprint's
 * is in them (a reaction has no modifier of the blueprint's: a formula has no research). A reaction that lists no
 * materials takes none: an empty map. Null where any input is not what it should be.
 */
function reactionJobMaterials({ materials, runs, facilityModifiers, productType }) {
  const amounts = facilityAmounts(facilityModifiers, productType);
  if (!Array.isArray(materials) || !aCount(runs) || amounts === null) {
    return null;
  }
  return materialsTaken(materials, amounts, runs, runs);
}

/**
 * What a job takes of each material listed, as the client's job makes each quantity whole (industry/job.py 473 to
 * 479): the blueprint's own quantity, times each amount in turn, times the runs the materials are for, rounded to
 * two places as Python rounds, taken up to the whole, and never fewer than the job's runs. Null where a material is
 * not what it should be.
 */
function materialsTaken(materials, amounts, materialRuns, runs) {
  const taken = {};
  for (const material of materials) {
    const typeID = material ? material.typeID : null;
    const base = material ? material.quantity : null;
    // (A material listed twice is no one quantity to a type: no blueprint of the game's lists one so.)
    if (!Number.isSafeInteger(typeID) || typeID <= 0 || !aNumber(base) || base < 0 || Object.hasOwn(taken, typeID)) {
      return null;
    }
    let quantity = base;
    for (const amount of amounts) {
      quantity *= amount;
    }
    quantity *= materialRuns;
    const whole = Math.max(Math.ceil(roundToTwoPlaces(quantity)), runs);
    if (!Number.isSafeInteger(whole)) {
      return null;
    }
    taken[typeID] = whole;
  }
  return taken;
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
 * The service a structure reacts by, as the client's structures say it (structures/services.py GetServiceID, 159
 * to 167): by the group of what the reaction makes. Biochemical materials and molecular-forged materials have one,
 * hybrid polymers another, the composite groups a third, and anything else the plain one. Null where that is no
 * group.
 */
function reactionServiceID(productGroupID) {
  if (!Number.isSafeInteger(productGroupID) || productGroupID <= 0) {
    return null;
  }
  if (BIOCHEMICAL_REACTION_GROUPS.has(productGroupID)) {
    return SERVICE_REACTIONS_BIOCHEMICAL;
  }
  if (productGroupID === HYBRID_POLYMERS_GROUP) {
    return SERVICE_REACTIONS_HYBRID;
  }
  return COMPOSITE_REACTION_GROUPS.has(productGroupID) ? SERVICE_REACTIONS_COMPOSITE : SERVICE_REACTIONS;
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
 * A copy job's base, not rounded, of which its cost, its tax and its surcharges are taken (activities/copying.py
 * job_cost, 15): the blueprint's price, times COST_PERCENTAGE, times the runs each copy is licensed for, times the
 * copies, in that order. Null where an input is not what it should be.
 */
function copyingJobBase({ blueprintPrice: price, runs, licensedRuns }) {
  return aBase(price, runs) && aCount(licensedRuns) ? price * COST_PERCENTAGE * licensedRuns * runs : null;
}

/**
 * An invention's base, not rounded, of which its cost, its tax and its surcharges are taken
 * (activities/invention.py job_cost, 27 to 31): the price of the blueprint invented (`blueprintPrice`: the job's
 * product, priced as any blueprint is), times COST_PERCENTAGE, times the runs. Null where an input is not what it
 * should be. (An invention that has no product has no job: the client's has an error for it, and sends none.)
 */
function inventionJobBase({ blueprintPrice: price, runs }) {
  return aBase(price, runs) ? price * COST_PERCENTAGE * runs : null;
}

/**
 * A research job's base, not rounded, of which its cost, its tax and its surcharges are taken
 * (activities/research_time.py job_cost, 25): the blueprint's price, times COST_PERCENTAGE, times the research's own
 * time for the job (researchActivitySeconds), over the activity's time; in that order, the division last. Null
 * where an input is not what it should be.
 *
 * (This server reckons it the price's share times the time over the activity's time. Of every research of every
 * blueprint the two price alike, from every level and for every number of runs left, they come to another whole
 * base for one blueprint alone, at a price no wallet holds: scratch's rsc-search.js, 2026-10-12.)
 */
function researchJobBase({ blueprintPrice: price, activityTime, level, runs }) {
  if (!aBase(price, runs) || !aNumber(activityTime) || activityTime <= 0 || !aLevel(level)) {
    return null;
  }
  return price * COST_PERCENTAGE * researchActivitySeconds(activityTime, level, runs) / activityTime;
}

/**
 * A manufacturing job's tax in whole ISK, as the client's own job reckons it (industry/job.py _get_tax, 450 to
 * 458): the base rounded (base_cost, 127 to 130: int(round(job_cost))) times the facility's rate (facilityTaxRate),
 * rounded. Null where there is no rate, or an input is not what it should be.
 */
function manufacturingJobTax({ blueprintPrice: price, runs, facilityTax }) {
  return aBase(price, runs) ? taxOn(price * runs, facilityTax) : null;
}

/** A copy job's tax in whole ISK, likewise, of the copy job's own base (copyingJobBase). */
function copyingJobTax({ blueprintPrice, runs, licensedRuns, facilityTax }) {
  const base = copyingJobBase({ blueprintPrice, runs, licensedRuns });
  return base === null ? null : taxOn(base, facilityTax);
}

/** An invention's tax in whole ISK, likewise, of the invention's own base (inventionJobBase). */
function inventionJobTax({ blueprintPrice, runs, facilityTax }) {
  const base = inventionJobBase({ blueprintPrice, runs });
  return base === null ? null : taxOn(base, facilityTax);
}

/** A research job's tax in whole ISK, likewise, of the research job's own base (researchJobBase). */
function researchJobTax({ blueprintPrice, activityTime, level, runs, facilityTax }) {
  const base = researchJobBase({ blueprintPrice, activityTime, level, runs });
  return base === null ? null : taxOn(base, facilityTax);
}

/** A job's tax of its base (industry/job.py _get_tax, 450 to 458): the base rounded, times the facility's rate, rounded. */
function taxOn(base, facilityTax) {
  return aNumber(facilityTax) ? Math.round(Math.round(base) * facilityTax) : null;
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
function manufacturingJobFee({ blueprintPrice: price, runs, ...charges }) {
  return aBase(price, runs) ? feeOn(price * runs, charges) : null;
}

/**
 * What a copy job costs to start, likewise, of the copy job's own base (copyingJobBase). The SCC's surcharge is
 * whole for a copy: it is a research job's that is halved (industry/job.py 144).
 */
function copyingJobFee({ blueprintPrice, runs, licensedRuns, ...charges }) {
  const base = copyingJobBase({ blueprintPrice, runs, licensedRuns });
  return base === null ? null : feeOn(base, charges);
}

/** What an invention costs to start, likewise, of the invention's own base (inventionJobBase); the SCC's surcharge whole. */
function inventionJobFee({ blueprintPrice, runs, ...charges }) {
  const base = inventionJobBase({ blueprintPrice, runs });
  return base === null ? null : feeOn(base, charges);
}

/**
 * What a research job costs to start, likewise, of the research job's own base (researchJobBase), with the SCC's
 * surcharge halved (industry/job.py 144 to 145).
 */
function researchJobFee({ blueprintPrice, activityTime, level, runs, ...charges }) {
  const base = researchJobBase({ blueprintPrice, activityTime, level, runs });
  return base === null ? null : feeOn(base, charges, true);
}

/**
 * What a job costs to start, of its base (industry/job.py total_cost, 132 to 135, and what it adds up). The SCC's
 * rate is its own by the facility's modifier, never below nought, and for a research job (`research`) halved then
 * (137 to 146).
 */
function feeOn(base, { cost, tax, sccTaxModifier, security }, research = false) {
  const anAmount = (value) => Number.isSafeInteger(value) && value >= 0;
  if (!anAmount(cost) || !anAmount(tax) || !aNumber(sccTaxModifier) || !aNumber(security)) {
    return null;
  }
  const baseCost = Math.round(base);
  let sccRate = Math.max(0, SCC_SURCHARGE_RATE * sccTaxModifier);
  if (research) {
    sccRate *= SCC_SURCHARGE_RESEARCH_DISCOUNT;
  }
  const sccSurcharge = Math.round(baseCost * sccRate);
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
 * ⚠ FOR A REACTION IT IS BY THE REACTION'S MATERIALS, and each material's by its own reaction's in turn: the
 * client prices by the materials of the work asked, and makes manufacturing of a science job's alone (527).
 * `activity` names the work whose materials price it: "reaction" for a reaction's job, and manufacturing where
 * none is said.
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
  // (The work whose materials price it: manufacturing, or the reaction for a reaction's job.)
  const work = activities ? activities[lookups.activity ?? "manufacturing"] : null;
  if (!work) {
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
  for (const material of work.materials || []) {
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
function manufacturingJobCost({ blueprintPrice: price, runs, ...modifiers }) {
  return aBase(price, runs) ? costOn(price * runs, modifiers) : null;
}

/**
 * A copy job's cost in whole ISK, likewise, of the copy job's own base (copyingJobBase), through the cost modifiers
 * the job has for copying: the blueprint type's own multiplier and an alpha clone's added one are of any kind of
 * work (industryCommon.BLUEPRINT_MODIFIERS, 47; GetJobModifiers, 510).
 */
function copyingJobCost({ blueprintPrice, runs, licensedRuns, ...modifiers }) {
  const base = copyingJobBase({ blueprintPrice, runs, licensedRuns });
  return base === null ? null : costOn(base, modifiers);
}

/**
 * An invention's cost in whole ISK, likewise, of the invention's own base (inventionJobBase), through the cost
 * modifiers the job has for invention.
 */
function inventionJobCost({ blueprintPrice, runs, ...modifiers }) {
  const base = inventionJobBase({ blueprintPrice, runs });
  return base === null ? null : costOn(base, modifiers);
}

/**
 * A research job's cost in whole ISK, likewise, of the research job's own base (researchJobBase), through the cost
 * modifiers the job has for that research.
 */
function researchJobCost({ blueprintPrice, activityTime, level, runs, ...modifiers }) {
  const base = researchJobBase({ blueprintPrice, activityTime, level, runs });
  return base === null ? null : costOn(base, modifiers);
}

/** A job's cost of its base, not rounded (industry/job.py _get_cost_for_modifiers, 310 to 320). */
function costOn(base, { blueprintAmount, alpha, faction, system, facilityModifiers, productType }) {
  if ((blueprintAmount !== null && !aNumber(blueprintAmount)) || typeof alpha !== "boolean" || !aNumber(faction) || !aNumber(system)) {
    return null;
  }
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

/**
 * The blueprint an invention's job is for the making of, as the client's job has its product (industry/job.py
 * _get_product, 181 to 190): the only one the recipe has, or the one named where the recipe has it. Nought where
 * there are several and none of them is named: that job has no product, and the client sends none such.
 */
function inventionProductTypeID(invention, requested) {
  const products = ((invention && invention.products) || []).filter((product) => toInt(product && product.typeID) > 0);
  if (requested > 0) {
    return products.some((product) => toInt(product.typeID) === requested) ? requested : 0;
  }
  return products.length === 1 ? toInt(products[0].typeID) : 0;
}

module.exports = {
  COPYING_MAX_RUNS,
  DECRYPTOR_GROUP_ID,
  INVENTION_ACTIVITY_ID,
  INVENTION_MAX_RUNS,
  NO_OPTIONAL_MATERIAL,
  SERVICE_LABORATORY_COPYING,
  SERVICE_LABORATORY_INVENTION,
  blueprintPrice,
  copyingJobCost,
  copyingJobFee,
  copyingJobMaterials,
  copyingJobMostRuns,
  copyingJobSeconds,
  copyingJobTax,
  facilityCharges,
  facilityCostModifiers,
  facilityGlobalModifiers,
  facilityMaterialModifiers,
  facilityTaxRate,
  facilityTimeModifiers,
  findFacilityRow,
  inventionJobCost,
  inventionJobFee,
  inventionJobMaterials,
  inventionJobMostRuns,
  inventionJobSeconds,
  inventionJobTax,
  inventionProductTypeID,
  manufacturingJobCost,
  manufacturingJobFee,
  manufacturingJobMaterials,
  manufacturingJobSeconds,
  manufacturingJobTax,
  manufacturingServiceID,
  modifierMatchesProduct,
  reactionJobMaterials,
  reactionJobSeconds,
  reactionServiceID,
  researchJobCost,
  researchJobFee,
  researchJobMaterials,
  researchJobMostRuns,
  researchJobSeconds,
  researchJobTax,
  researchServiceID,
  researchStanding,
  roundToTwoPlaces,
};
