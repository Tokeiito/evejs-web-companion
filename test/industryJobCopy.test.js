"use strict";

// A copy job, as the client's own job reckons it before it sends the job. What is its own
// (industry/activities/copying.py, 12 to 19) and what it has of every job (industry/job.py; industry/activity.py):
//
//   its time        job_time: the activity's time x float(licensedRuns or 1) x runs, then each time modifier the job
//                   has in turn (job.py 460 to 468): the pilot's own copy speed, then the facility's for copying.
//                   No skill's time per level and no time research of the blueprint's is among a copy job's.
//   its most runs   job_max_runs (activity.py 34 to 36): MAX_RUN_LENGTH / float(time) / the time modifiers
//                   multiplied together, taken up to the whole, and never more than MAX_RUNS, which is 500.
//   its materials   job.py 470 to 485: float(base), each material modifier in turn, x job_material_runs, which is
//                   runs x licensedRuns; max(int(math.ceil(round(quantity, 2))), runs).
//   its base        job_cost: the blueprint's price x COST_PERCENTAGE x float(licensedRuns or 0) x float(runs).
//   its cost        job.py 310 to 320, of that base; its tax, 450 to 458, and its surcharges, 127 to 174, of the
//                   base rounded.
//
// The server holds a time, a cost, a tax and a map of materials that are not nought against its own, and these are
// floats: the same numbers multiplied another way round come a second, an ISK or a unit apart.
//
// No Tranquility recording has an install. THE ANSWERS SAID TO BE THE CLIENT'S OWN PYTHON'S ARE: each case was put
// to the retail client's python27.dll (scripts/py27-oracle.py) with the sums in the order above, and what it
// printed is what is expected here. (Some 287,000 cases were put to it, over every copy time, every limit and every
// copying quantity the game's blueprints have, and these functions made the same of every one.) The times and
// quantities are ones the game's blueprints list, or are made up; the prices are made up.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COPYING_MAX_RUNS,
  SERVICE_LABORATORY_COPYING,
  copyingJobCost,
  copyingJobFee,
  copyingJobMaterials,
  copyingJobMostRuns,
  copyingJobSeconds,
  copyingJobTax,
} = require("../src/industryInstall");

/** A facility's modifier for anything: [amount, categoryID, groupID, typeID, reference]. */
const forAll = (amount) => [amount, null, null, null, 12];
const A_SHIP = { typeID: 587, groupID: 25, categoryID: 6 };

test("a copy job's time is the activity's time by the licensed runs and the copies, through the pilot's copy speed and then the facility's modifiers", () => {
  // [the activity's time, the runs each copy is licensed for, the copies, the pilot's, the facility's] -> the
  // client's Python's seconds.
  for (const [activityTime, licensedRuns, runs, characterAmount, facility, seconds] of [
    [480, 2, 1, 1.0, [], 960],
    [4800, 30, 1, 0.75, [0.85], 91800],
    [4800, 30, 3, 0.75, [0.85, 0.76], 209304],
    [48000, 1, 100, 0.75, [], 3600000],
    // With the modifiers multiplied together first each of these is a second less.
    [8, 5, 5, 0.75, [0.85], 128],
    [8, 5, 37, 0.75, [0.85], 944],
    [2000, 5, 5, 0.95, [0.7, 0.958], 31854],
    // With the facility's before the pilot's, a second more, and a second less.
    [7500, 1, 100, 0.95, [0.7, 0.958], 477802],
    [7500, 7, 100, 0.95, [0.7, 0.958], 3344618],
    // Rounded, and not taken down: 257.856.
    [480, 1, 1, 0.8, [0.85, 0.79], 258],
  ]) {
    assert.equal(
      copyingJobSeconds({ activityTime, licensedRuns, runs, characterAmount, facilityModifiers: facility.map(forAll), productType: A_SHIP }),
      seconds,
      `${activityTime} x ${licensedRuns} x ${runs} x ${characterAmount} x ${facility.join(" x ")}`,
    );
  }
});

test("only the facility's modifiers that are for the blueprint's product are in a copy job's time, and nothing is made of an input that is not what it should be", () => {
  const job = { activityTime: 4800, licensedRuns: 30, runs: 1, characterAmount: 0.75, productType: A_SHIP };
  // One for ships counts; one for another category of thing, another group or another type does not.
  const forOthers = [[0.5, 7, null, null, 11], [0.5, null, 26, null, 11], [0.5, null, null, 588, 11]];
  assert.equal(copyingJobSeconds({ ...job, facilityModifiers: [forAll(0.85), ...forOthers] }), 91800);
  assert.equal(copyingJobSeconds({ ...job, facilityModifiers: [forAll(0.85), [0.5, 6, null, null, 11]] }), 45900);
  assert.equal(copyingJobSeconds({ ...job, facilityModifiers: [forAll(0.85), [0.5, null, 25, null, 11]] }), 45900);
  // A product that is not known: only what is for anything counts.
  assert.equal(copyingJobSeconds({ ...job, productType: null, facilityModifiers: [forAll(0.85), [0.5, 6, null, null, 11]] }), 91800);
  // A facility with no modifiers, and one of which none are said.
  assert.equal(copyingJobSeconds({ ...job, facilityModifiers: [] }), 108000);
  assert.equal(copyingJobSeconds({ ...job, facilityModifiers: undefined }), 108000);

  const whole = { ...job, facilityModifiers: [forAll(0.85)] };
  for (const [name, wrong] of [
    ["activityTime", 0], ["activityTime", -480], ["activityTime", null], ["activityTime", "4800"],
    ["runs", 0], ["runs", 1.5], ["runs", null],
    ["licensedRuns", 0], ["licensedRuns", 2.5], ["licensedRuns", null], ["licensedRuns", undefined],
    ["characterAmount", null], ["characterAmount", "0.75"], ["characterAmount", NaN],
    ["facilityModifiers", [0.85]], ["facilityModifiers", [["0.85", null, null, null, 12]]], ["facilityModifiers", [forAll(0.85), null]],
  ]) {
    assert.equal(copyingJobSeconds({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});

test("the most copies one job can make is thirty days over the time and the time modifiers together, taken up to the whole, and never more than five hundred", () => {
  assert.equal(COPYING_MAX_RUNS, 500);
  // [the activity's time, the pilot's, the facility's] -> the client's Python's most.
  for (const [activityTime, characterAmount, facility, most] of [
    [48000, 0.75, [], 72],
    [9600, 0.75, [], 360],
    // Taken up: 423.5..., and 282.3... Without the pilot's own they would be 318 and 212.
    [9600, 0.75, [0.85], 424],
    [14400, 0.75, [0.85], 283],
    // Never more than five hundred, whatever the time.
    [9600, 0.8, [0.85, 0.79], 500],
    [4800, 0.75, [0.85], 500],
    [480, 1.0, [], 500],
    // And one at the least, for a blueprint whose one copy takes more than the thirty days.
    [7200000, 0.75, [0.85], 1],
    [6758807, 0.847, [0.963, 0.7224], 1],
    [2880000, 1.0, [], 1],
    // At the edge of a whole number: a second less of the activity's time, and one copy more.
    [864000, 1.0, [], 3],
    [863999, 1.0, [], 4],
    [25920, 1.0, [], 100],
    [25919, 1.0, [], 101],
    [34560, 0.75, [], 100],
    [34559, 0.75, [], 101],
    [40659, 0.75, [0.85], 100],
    [40658, 0.75, [0.85], 101],
  ]) {
    assert.equal(
      copyingJobMostRuns({ activityTime, characterAmount, facilityModifiers: facility.map(forAll), productType: A_SHIP }),
      most,
      `${activityTime} / ${characterAmount} / ${facility.join(" / ")}`,
    );
  }
  // The runs each copy is licensed for are not in it, and only the facility's modifiers for the product are.
  assert.equal(copyingJobMostRuns({ activityTime: 9600, characterAmount: 0.75, licensedRuns: 30, facilityModifiers: [forAll(0.85), [0.5, 7, null, null, 11]], productType: A_SHIP }), 424);
  // An input that is not what it should be, and modifiers that come to nothing a time can be divided by.
  const whole = { activityTime: 9600, characterAmount: 0.75, facilityModifiers: [forAll(0.85)], productType: A_SHIP };
  for (const [name, wrong] of [
    ["activityTime", 0], ["activityTime", null], ["characterAmount", null], ["characterAmount", 0], ["characterAmount", -0.75],
    ["facilityModifiers", [forAll(0)]], ["facilityModifiers", [0.85]],
  ]) {
    assert.equal(copyingJobMostRuns({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});

test("a copy job's materials are for every run of every copy, through the facility's modifiers, and never fewer than one a copy", () => {
  const taken = (base, runs, licensedRuns, facility) => copyingJobMaterials({
    materials: [{ typeID: 3812, quantity: base }], runs, licensedRuns, facilityModifiers: facility.map(forAll), productType: A_SHIP,
  });
  // [the blueprint's quantity, the copies, the runs each is licensed for, the facility's] -> the client's Python's.
  for (const [base, runs, licensedRuns, facility, quantity] of [
    [2, 3, 10, [], 60],
    [3, 2, 7, [0.958], 41],
    [20, 7, 30, [0.99, 0.958, 0.98], 3904],
    [50, 9, 300, [0.99, 0.976], 130443],
    // Never fewer than one a copy; but not one a run of a copy, which would be 200, 1000 and 3.
    [1, 100, 2, [0.99], 198],
    [1, 500, 2, [0.99], 990],
    [1, 1, 1, [0.99], 1],
    [1, 3, 1, [0.958], 3],
    // Rounded to two places before it is taken up to the whole: taken up as it is each would be one more.
    [5, 100, 1, [0.98], 490],
    [5, 25, 2, [0.98], 245],
  ]) {
    assert.deepEqual(taken(base, runs, licensedRuns, facility), { 3812: quantity }, `${base} x ${facility.join(" x ")} x ${runs} x ${licensedRuns}`);
  }
  // Each material by itself, and a modifier for another category of thing left out.
  assert.deepEqual(copyingJobMaterials({
    materials: [{ typeID: 3812, quantity: 5 }, { typeID: 3814, quantity: 2 }], runs: 25, licensedRuns: 2,
    facilityModifiers: [forAll(0.98), [0.5, 7, null, null, 11]], productType: A_SHIP,
  }), { 3812: 245, 3814: 98 });
  // A blueprint whose copying lists no materials takes none: an empty map, and not nothing.
  assert.deepEqual(copyingJobMaterials({ materials: [], runs: 3, licensedRuns: 10, facilityModifiers: [forAll(0.98)], productType: A_SHIP }), {});

  const whole = { materials: [{ typeID: 3812, quantity: 5 }], runs: 25, licensedRuns: 2, facilityModifiers: [forAll(0.98)], productType: A_SHIP };
  for (const [name, wrong] of [
    ["materials", null], ["materials", [{ typeID: 0, quantity: 5 }]], ["materials", [{ typeID: 3812, quantity: "5" }]], ["materials", [{ typeID: 3812, quantity: 5 }, { typeID: 3812, quantity: 1 }]],
    ["runs", 0], ["runs", 2.5], ["licensedRuns", 0], ["licensedRuns", null], ["licensedRuns", 1.5],
    ["facilityModifiers", [0.98]], ["facilityModifiers", [[null, null, null, null, 12]]],
  ]) {
    assert.equal(copyingJobMaterials({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});

test("a copy job's cost, its tax and what it costs to start are of its own base: the price by the percentage, the licensed runs and the copies", () => {
  assert.equal(SERVICE_LABORATORY_COPYING, 33);
  // [the blueprint's price, licensed runs, copies, an alpha's, the blueprint type's own multiplier, the facility's
  // tax, the SCC's modifier, the facility's cost modifiers] -> the client's Python's cost, tax, surcharge and
  // security tax.
  for (const [price, licensedRuns, runs, alpha, blueprintAmount, facilityTax, sccTaxModifier, facility, charged] of [
    [40597608.78, 571, 88, false, null, 0, 1, [0.1162, 0.95, 0.958, 0.976], [4211087741, 0, 1631958917, 2039948646]],
    // The tax is of the base rounded: of the base as it is, it would be 9360069, 804637 and 21597113.
    [49344.55246162671, 524, 181, false, 2, 0.1, 0.75, [0.04, 0.97], [7263414, 9360070, 2808021, 4680035]],
    [82172.94728818303, 544, 18, false, 0, 0.05, 1, [0.04], [0, 804638, 643710, 804638]],
    [3838804.39, 194, 145, false, 0.1, 0.01, 0.5, [0.0514, 0.97, 0.79], [8506632, 21597114, 43194227, 107985568]],
    // And the surcharge: of the base as it is, it would be 10916887243, 6581669823 and 46504645.
    [423371464.829, 272, 158, false, 2, 0, 0.75, [0.04], [29111699316, 0, 10916887244, 18194812073]],
    [330903460.156, 510, 65, true, 0, 0, 0.75, [0.0514, 0.97, 0.79], [548472485, 0, 6581669822, 10969449704]],
    [38987798.03, 7, 426, false, 0.1, 0.1, 0.5, [0.0388], [9021901, 232523228, 46504646, 116261614]],
    // An alpha's share is of the base as it began, and not of the cost as it stands: that would be 11994136,
    // 39874952961 and 515544.
    [69186.05167858256, 560, 392, true, null, 0.0375, 0.75, [0.0514, 0.97, 0.79], [12723611, 11390792, 9112633, 15187722]],
    [332954253.187, 306, 488, true, null, 0.0375, 0.5, [0.04], [42261483812, 37289544540, 19887757088, 49719392720]],
    [10882.922505229013, 199, 306, true, null, 0.0025, 0.5, [0.04, 0.97], [547394, 33135, 265082, 662705]],
    // Each modifier in turn: multiplied together first, the cost would be an ISK less.
    [339584393.777, 219, 169, true, 2, 0.1, 0, [0.1162, 0.95, 0.958, 0.976], [52518408749, 25136715996, 0, 12568357998]],
  ]) {
    const job = { blueprintPrice: price, licensedRuns, runs };
    const cost = copyingJobCost({ ...job, blueprintAmount, alpha, faction: 1.0, system: 1.0, facilityModifiers: facility.map((amount) => [amount, null, null, null, 4]), productType: A_SHIP });
    const tax = copyingJobTax({ ...job, facilityTax });
    // In a safe system, that the security tax is among what is added up.
    const fee = copyingJobFee({ ...job, cost, tax, sccTaxModifier, security: 1.0 });
    const [theirCost, theirTax, surcharge, securityTax] = charged;
    assert.deepEqual(fee, { cost: theirCost, tax: theirTax, sccSurcharge: surcharge, securityTax, total: theirCost + theirTax + surcharge + securityTax }, `${price} x ${licensedRuns} x ${runs}`);
    // And in one that is not, no security tax: the rest as it was.
    assert.deepEqual(copyingJobFee({ ...job, cost, tax, sccTaxModifier, security: 0.9 }), { cost: theirCost, tax: theirTax, sccSurcharge: surcharge, securityTax: 0, total: theirCost + theirTax + surcharge });
  }
});

test("the faction's and the system's modifiers are in a copy job's cost as they are in any job's, and nothing is made of an input that is not what it should be", () => {
  // A price of 44032, ten licensed runs, three copies: a base of 26419.2. The facility's one cost modifier 0.04.
  const job = { blueprintPrice: 44032, licensedRuns: 10, runs: 3 };
  const modifiers = { blueprintAmount: null, alpha: false, faction: 1.0, system: 1.0, facilityModifiers: [[0.04, null, null, null, 4]], productType: A_SHIP };
  assert.equal(copyingJobCost({ ...job, ...modifiers }), 1057);
  // The faction's where it is not one, and the system's where it is neither nought nor one: 26419.2 x 0.9 x 0.5 x 0.04.
  assert.equal(copyingJobCost({ ...job, ...modifiers, faction: 0.9, system: 0.5 }), 476);
  assert.equal(copyingJobCost({ ...job, ...modifiers, system: 0.0 }), 1057);
  // A cost modifier for another category of thing is left out.
  assert.equal(copyingJobCost({ ...job, ...modifiers, facilityModifiers: [[0.04, null, null, null, 4], [0.5, 7, null, null, 11]] }), 1057);
  // The licensed runs are in the base: three hundred of them, 792576 x 0.04.
  assert.equal(copyingJobCost({ ...job, ...modifiers, licensedRuns: 300 }), 31703);
  assert.deepEqual([copyingJobTax({ ...job, facilityTax: 0.01 }), copyingJobTax({ ...job, licensedRuns: 300, facilityTax: 0.01 }), copyingJobTax({ ...job, facilityTax: 0 })], [264, 7926, 0]);

  for (const [name, wrong] of [
    ["blueprintPrice", null], ["blueprintPrice", -1], ["blueprintPrice", "44032"], ["runs", 0], ["runs", 1.5],
    ["licensedRuns", 0], ["licensedRuns", null], ["licensedRuns", undefined], ["licensedRuns", 2.5],
  ]) {
    assert.equal(copyingJobCost({ ...job, ...modifiers, [name]: wrong }), null, `cost, ${name}: ${JSON.stringify(wrong)}`);
    assert.equal(copyingJobTax({ ...job, facilityTax: 0.01, [name]: wrong }), null, `tax, ${name}: ${JSON.stringify(wrong)}`);
    assert.equal(copyingJobFee({ ...job, cost: 1057, tax: 264, sccTaxModifier: 1, security: 0.9, [name]: wrong }), null, `fee, ${name}: ${JSON.stringify(wrong)}`);
  }
  for (const [name, wrong] of [["alpha", null], ["faction", null], ["system", undefined], ["blueprintAmount", "2"], ["facilityModifiers", [0.04]]]) {
    assert.equal(copyingJobCost({ ...job, ...modifiers, [name]: wrong }), null, `cost, ${name}: ${JSON.stringify(wrong)}`);
  }
  assert.equal(copyingJobTax({ ...job, facilityTax: null }), null);
  for (const [name, wrong] of [["cost", null], ["cost", 1056.5], ["tax", null], ["tax", -1], ["sccTaxModifier", null], ["security", null]]) {
    assert.equal(copyingJobFee({ ...job, cost: 1057, tax: 264, sccTaxModifier: 1, security: 0.9, [name]: wrong }), null, `fee, ${name}: ${JSON.stringify(wrong)}`);
  }
  // What it adds up to: the cost, the tax, the SCC's 4% of the base rounded, and no security tax in a system of 0.9.
  assert.deepEqual(copyingJobFee({ ...job, cost: 1057, tax: 264, sccTaxModifier: 1, security: 0.9 }), { cost: 1057, tax: 264, sccSurcharge: 1057, securityTax: 0, total: 2378 });
});
