"use strict";

// A research job, of a blueprint's time or of its materials, as the client's own job reckons it before it sends the
// job. The two researches are one activity but for what they read of the blueprint
// (industry/activities/research_time.py and research_material.py), and have of every job what every job has
// (industry/job.py; industry/activity.py):
//
//   where it stands   blueprint_level, 11: the blueprint's research over the step (2 for its time, 1 for its
//                     materials), a whole division; job_max_runs, 23: what is left to the most (20, and 10) over
//                     the step; job_validate, 33 to 37: no job at the last level
//   its time          job_time, 17 to 20: the sum of each run's time, a run's being the activity's time by
//                     RESEARCH_TIMES at the level the run starts from, each run a level above the one before; then
//                     each time modifier the job has in turn (job.py 460 to 468): the pilot's own time for that
//                     research, then the facility's
//   its most runs     job_max_runs, 22 to 23: the fewer of the runs left and what any job can have (activity.py 34
//                     to 36: thirty days over the activity's time over the time modifiers together, taken up)
//   its base          job_cost, 25: the price x COST_PERCENTAGE x the job's time / float(the activity's time)
//   its cost and tax  of that base, as any job's; and the SCC's surcharge halved (job.py 144 to 145)
//   its materials     as any job's, by its runs; no research of the blueprint's is in them
//
// No Tranquility recording has an install. THE ANSWERS SAID TO BE THE CLIENT'S OWN PYTHON'S ARE: each case was put
// to the retail client's python27.dll (scripts/py27-oracle.py) with the sums in the order above, and what it
// printed is what is expected here. (Some 155,000 cases were put to it, over every research time and every research
// quantity the game's blueprints have, from every research a blueprint can have and for every number of runs left
// to it, and these functions made the same of every one.) The times and quantities are ones the game's blueprints
// list, or are made up; the prices are made up.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  researchJobCost,
  researchJobFee,
  researchJobMaterials,
  researchJobMostRuns,
  researchJobSeconds,
  researchJobTax,
  researchServiceID,
  researchStanding,
} = require("../web/src/bridge/industryReckonings.mjs");

const OF_TIME = 3;
const OF_MATERIALS = 4;
/** A facility's modifier for anything: [amount, categoryID, groupID, typeID, reference]. */
const forAll = (amount) => [amount, null, null, null, 12];
const A_SHIP = { typeID: 587, groupID: 25, categoryID: 6 };

test("a blueprint stands in a research at the level its research comes to by the step, with the runs left to the most, and at the last level it is finished", () => {
  // A research of time goes by twos to twenty; one of materials by ones to ten.
  assert.deepEqual(researchStanding(OF_TIME, 0), { level: 0, runsLeft: 10, finished: false });
  assert.deepEqual(researchStanding(OF_TIME, 4), { level: 2, runsLeft: 8, finished: false });
  assert.deepEqual(researchStanding(OF_TIME, 18), { level: 9, runsLeft: 1, finished: false });
  assert.deepEqual(researchStanding(OF_TIME, 20), { level: 10, runsLeft: 0, finished: true });
  assert.deepEqual(researchStanding(OF_MATERIALS, 0), { level: 0, runsLeft: 10, finished: false });
  assert.deepEqual(researchStanding(OF_MATERIALS, 4), { level: 4, runsLeft: 6, finished: false });
  assert.deepEqual(researchStanding(OF_MATERIALS, 9), { level: 9, runsLeft: 1, finished: false });
  assert.deepEqual(researchStanding(OF_MATERIALS, 10), { level: 10, runsLeft: 0, finished: true });
  // Each a whole division, as the client's Python divides whole numbers: a time research of 5 is at the second
  // level with seven runs left, and one of 19 is at the ninth with none left, and is not finished.
  assert.deepEqual(researchStanding(OF_TIME, 5), { level: 2, runsLeft: 7, finished: false });
  assert.deepEqual(researchStanding(OF_TIME, 19), { level: 9, runsLeft: 0, finished: false });
  // Any other kind of work, and a research that is no whole number from nought to the most.
  for (const [activityID, efficiency] of [[1, 4], [5, 4], [8, 4], [null, 4], ["3", 4], [OF_TIME, -2], [OF_TIME, 21], [OF_TIME, 2.5], [OF_TIME, null], [OF_TIME, "4"], [OF_MATERIALS, 11], [OF_MATERIALS, undefined]]) {
    assert.equal(researchStanding(activityID, efficiency), null, `${activityID}, ${JSON.stringify(efficiency)}`);
  }
  // The service a structure does each by (structures/services.py 168 to 171), and none for other work.
  assert.deepEqual([researchServiceID(OF_TIME), researchServiceID(OF_MATERIALS), researchServiceID(1), researchServiceID(5), researchServiceID(8)], [31, 32, null, null, null]);
});

test("a research job's time is the sum of its runs' times, each run a level above the last, through the pilot's own time for the research and then the facility's modifiers", () => {
  // [the research, the activity's time, the blueprint's research, runs, the pilot's, the facility's] -> the
  // client's Python's seconds.
  for (const [activityID, activityTime, efficiency, runs, characterAmount, facility, seconds] of [
    [OF_TIME, 2100, 0, 1, 1.0, [], 2100],
    // Each run a level above the last: every run at the level the blueprint is at would be 420, 630 and 840.
    [OF_TIME, 210, 0, 2, 1.0, [], 500],
    [OF_TIME, 210, 0, 3, 1.0, [], 1190],
    [OF_TIME, 210, 0, 4, 1.0, [], 2828],
    // All ten levels, of either research.
    [OF_TIME, 2100, 0, 10, 1.0, [], 5120000],
    [OF_MATERIALS, 2100, 0, 10, 1.0, [], 5120000],
    // The level is the research over the step: a time research of 1 is still at the first level, and of 4 and of 5
    // at the third; a material research of 3 is at the fourth.
    [OF_TIME, 210, 1, 1, 1.0, [], 210],
    [OF_TIME, 2100, 4, 2, 0.6375, [0.85], 12615],
    [OF_TIME, 2100, 5, 2, 0.6375, [0.85], 12615],
    [OF_MATERIALS, 2100, 3, 2, 0.6375, [0.85], 29966],
    // The last level, of either: a time research of 18, and a material research of 9.
    [OF_TIME, 819, 18, 1, 0.75, [0.95], 824177],
    [OF_MATERIALS, 819, 9, 1, 0.75, [0.95], 824177],
    [OF_MATERIALS, 819, 4, 6, 0.6375, [0.85, 0.76], 817790],
    // Rounded, and not taken down: 124889.99..., and 157.5.
    [OF_TIME, 210, 16, 1, 1.0, [], 124890],
    [OF_TIME, 210, 0, 1, 0.75, [], 158],
    // With the modifiers multiplied together first each of these is a second less.
    [OF_TIME, 210, 0, 9, 0.75, [0.95], 153473],
    [OF_TIME, 210, 6, 5, 0.75, [0.95], 63641],
    // With the facility's before the pilot's, a second more, and a second less.
    [OF_TIME, 2100, 0, 7, 0.6375, [0.85], 205912],
    [OF_TIME, 2100, 12, 1, 0.6375, [0.85], 119213],
    // With the levels' shares added up before the time is multiplied in, a second less.
    [OF_TIME, 210, 0, 3, 0.75, [], 893],
    [OF_TIME, 210, 2, 3, 0.75, [], 1964],
  ]) {
    const { level } = researchStanding(activityID, efficiency);
    assert.equal(
      researchJobSeconds({ activityTime, level, runs, characterAmount, facilityModifiers: facility.map(forAll), productType: A_SHIP }),
      seconds,
      `research ${activityID}: ${activityTime}, from ${efficiency}, ${runs} run(s) x ${characterAmount} x ${facility.join(" x ")}`,
    );
  }
});

test("only the facility's modifiers that are for the blueprint's product are in a research job's time, and nothing is made of an input that is not what it should be", () => {
  const job = { activityTime: 2100, level: 2, runs: 2, characterAmount: 0.6375, productType: A_SHIP };
  const forOthers = [[0.5, 7, null, null, 11], [0.5, null, 26, null, 11], [0.5, null, null, 588, 11]];
  assert.equal(researchJobSeconds({ ...job, facilityModifiers: [forAll(0.85), ...forOthers] }), 12615);
  // One for ships counts: 12614.85 x 0.5.
  assert.equal(researchJobSeconds({ ...job, facilityModifiers: [forAll(0.85), [0.5, 6, null, null, 11]] }), 6307);
  // A facility with no modifiers, and one of which none are said: 23280 x 0.6375.
  assert.equal(researchJobSeconds({ ...job, facilityModifiers: [] }), 14841);
  assert.equal(researchJobSeconds({ ...job, facilityModifiers: undefined }), 14841);

  const whole = { ...job, facilityModifiers: [forAll(0.85)] };
  for (const [name, wrong] of [
    ["activityTime", 0], ["activityTime", -2100], ["activityTime", null], ["activityTime", "2100"],
    ["level", -1], ["level", 10], ["level", 2.5], ["level", null], ["level", undefined],
    ["runs", 0], ["runs", 1.5], ["runs", null],
    ["characterAmount", null], ["characterAmount", "0.6375"], ["characterAmount", NaN],
    ["facilityModifiers", [0.85]], ["facilityModifiers", [["0.85", null, null, null, 12]]], ["facilityModifiers", [forAll(0.85), null]],
  ]) {
    assert.equal(researchJobSeconds({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});

test("the most runs one research job can have are the fewer of the runs left to the blueprint and what thirty days hold of the activity's time", () => {
  // [the research, the activity's time, the blueprint's research, the pilot's, the facility's] -> the client's
  // Python's most.
  for (const [activityID, activityTime, efficiency, characterAmount, facility, most] of [
    // The runs left, where thirty days hold more: ten, nine of a time research of 1, one, and none.
    [OF_TIME, 210, 0, 1.0, [], 10],
    [OF_TIME, 210, 1, 1.0, [], 9],
    [OF_TIME, 2100, 18, 0.6375, [0.85], 1],
    [OF_TIME, 210, 19, 1.0, [], 0],
    [OF_TIME, 210, 20, 1.0, [], 0],
    [OF_MATERIALS, 210, 0, 1.0, [], 10],
    [OF_MATERIALS, 210, 9, 1.0, [], 1],
    [OF_MATERIALS, 210, 10, 1.0, [], 0],
    // What thirty days hold, where that is fewer: taken up (6.17..., and 8.22...), and by the pilot's own time too.
    [OF_TIME, 420000, 0, 1.0, [], 7],
    [OF_TIME, 420000, 0, 0.75, [], 9],
    [OF_TIME, 420000, 4, 0.6375, [0.85], 8],
    // At the edge of a whole number, and one at the least where one run takes more than the thirty days.
    [OF_TIME, 864000, 0, 1.0, [], 3],
    [OF_TIME, 863999, 0, 1.0, [], 4],
    [OF_TIME, 2592000, 0, 1.0, [], 1],
    [OF_TIME, 2591999, 0, 1.0, [], 2],
    [OF_TIME, 2592001, 0, 1.0, [], 1],
    [OF_TIME, 5000000, 0, 1.0, [], 1],
  ]) {
    const { runsLeft } = researchStanding(activityID, efficiency);
    assert.equal(
      researchJobMostRuns({ activityTime, runsLeft, characterAmount, facilityModifiers: facility.map(forAll), productType: A_SHIP }),
      most,
      `research ${activityID}: ${activityTime}, from ${efficiency} / ${characterAmount} / ${facility.join(" / ")}`,
    );
  }
  // Only the facility's modifiers for the product are in it.
  assert.equal(researchJobMostRuns({ activityTime: 420000, runsLeft: 10, characterAmount: 1.0, facilityModifiers: [[0.5, 7, null, null, 11]], productType: A_SHIP }), 7);
  assert.equal(researchJobMostRuns({ activityTime: 420000, runsLeft: 10, characterAmount: 1.0, facilityModifiers: [[0.5, 6, null, null, 11]], productType: A_SHIP }), 10);
  const whole = { activityTime: 420000, runsLeft: 10, characterAmount: 0.75, facilityModifiers: [forAll(0.85)], productType: A_SHIP };
  for (const [name, wrong] of [
    ["activityTime", 0], ["activityTime", null], ["runsLeft", -1], ["runsLeft", null], ["runsLeft", 2.5], ["runsLeft", undefined],
    ["characterAmount", null], ["characterAmount", 0], ["characterAmount", -0.75], ["facilityModifiers", [forAll(0)]], ["facilityModifiers", [0.85]],
  ]) {
    assert.equal(researchJobMostRuns({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});

test("a research job's cost, its tax and what it costs to start are of its own base, the price by the percentage and the job's time over the activity's, and the SCC's surcharge is halved", () => {
  // [the research, the blueprint's price, the activity's time, the blueprint's research, runs, an alpha's, the
  // blueprint type's own multiplier, the facility's tax, the SCC's modifier, the facility's cost modifiers] -> the
  // client's Python's base rounded, cost, tax, surcharge and security tax.
  for (const [activityID, price, activityTime, efficiency, runs, alpha, blueprintAmount, facilityTax, sccTaxModifier, facility, charged] of [
    // The surcharge is half the rate of the base rounded: whole it would be 3224747, and halved after it is rounded
    // 1612374, 150174 and 3648.
    [OF_TIME, 22400000, 50000, 2, 6, false, 0.1, 0.0025, 1, [0.97, 0.04], [80618667, 312800, 201547, 1612373, 4030933]],
    [OF_MATERIALS, 80450000, 84000, 1, 2, false, 0.5, 0, 1, [], [7508667, 3754333, 0, 150173, 375433]],
    [OF_TIME, 28585.20378307323, 3150, 6, 5, false, null, 0.0025, 0.75, [0.04], [243165, 9727, 608, 3647, 12158]],
    // The division by the activity's time comes last. As this server has it, the price's share times the time over
    // the activity's time, the first's base would be 27748476 and the second's 314754023; with the time over the
    // activity's time first of all, the third's would be 116345443.
    [OF_TIME, 2332925, 10631, 16, 1, false, 0.5, 0.1, 0.75, [0.97, 0.04], [27748477, 538320, 2774848, 416227, 1387424]],
    [OF_TIME, 26462625, 210, 17, 1, false, 1, 0.02, 0, [0.0514, 0.97, 0.79], [314754022, 12397475, 6295080, 0, 15737701]],
    [OF_TIME, 9781625, 21000, 17, 1, false, 0.1, 0.02, 0.75, [], [116345442, 11634544, 2326909, 1745182, 5817272]],
    // The tax is of the base rounded: of the base as it is, it would be 3631330.
    [OF_MATERIALS, 9101078.901428571, 210, 5, 3, false, null, 0.05, 0.75, [], [72626610, 72626610, 3631331, 1089399, 3631331]],
    // An alpha's share is of the base as it began: of the cost as it stands, it would be 67969 and 2167.
    [OF_MATERIALS, 99626.87772196694, 31500, 3, 5, true, 2, 0, 1, [0.04], [847493, 69918, 0, 16950, 42375]],
    [OF_TIME, 44401.38679665467, 420000, 8, 2, true, null, 0.0375, 0, [0.97, 0.04], [55700, 2300, 2089, 0, 2785]],
  ]) {
    const { level } = researchStanding(activityID, efficiency);
    const job = { blueprintPrice: price, activityTime, level, runs };
    const cost = researchJobCost({ ...job, blueprintAmount, alpha, faction: 1.0, system: 1.0, facilityModifiers: facility.map((amount) => [amount, null, null, null, 4]), productType: A_SHIP });
    const tax = researchJobTax({ ...job, facilityTax });
    const [base, theirCost, theirTax, surcharge, securityTax] = charged;
    // The base rounded, as a tax of the whole of it.
    assert.equal(researchJobTax({ ...job, facilityTax: 1 }), base, `the base: ${price}, ${activityTime}, from ${efficiency}, ${runs} run(s)`);
    // In a safe system, that the security tax is among what is added up.
    assert.deepEqual(researchJobFee({ ...job, cost, tax, sccTaxModifier, security: 1.0 }),
      { cost: theirCost, tax: theirTax, sccSurcharge: surcharge, securityTax, total: theirCost + theirTax + surcharge + securityTax }, `${price}, ${activityTime}, from ${efficiency}, ${runs} run(s)`);
    // And in one that is not, no security tax: the rest as it was.
    assert.deepEqual(researchJobFee({ ...job, cost, tax, sccTaxModifier, security: 0.9 }), { cost: theirCost, tax: theirTax, sccSurcharge: surcharge, securityTax: 0, total: theirCost + theirTax + surcharge });
  }
});

test("the faction's and the system's modifiers are in a research job's cost as they are in any job's, and nothing is made of an input that is not what it should be", () => {
  // A price of 44032, an activity's time of 2100, two runs from the third level: 44032 x 0.02 x 23280 / 2100, a base
  // of 9762.52... The facility's one cost modifier 0.04.
  const job = { blueprintPrice: 44032, activityTime: 2100, level: 2, runs: 2 };
  const modifiers = { blueprintAmount: null, alpha: false, faction: 1.0, system: 1.0, facilityModifiers: [[0.04, null, null, null, 4]], productType: A_SHIP };
  assert.equal(researchJobCost({ ...job, ...modifiers }), 391);
  // The faction's where it is not one, and the system's where it is neither nought nor one: x 0.9 x 0.5.
  assert.equal(researchJobCost({ ...job, ...modifiers, faction: 0.9, system: 0.5 }), 176);
  assert.equal(researchJobCost({ ...job, ...modifiers, system: 0.0 }), 391);
  // A cost modifier for another category of thing is left out.
  assert.equal(researchJobCost({ ...job, ...modifiers, facilityModifiers: [[0.04, null, null, null, 4], [0.5, 7, null, null, 11]] }), 391);
  // The level is in the base: from the fourth level the two runs come to 23190.
  assert.equal(researchJobCost({ ...job, ...modifiers, level: 3 }), 928);
  assert.deepEqual([researchJobTax({ ...job, facilityTax: 0.01 }), researchJobTax({ ...job, level: 3, facilityTax: 0.05 }), researchJobTax({ ...job, facilityTax: 0 })], [98, 1160, 0]);
  // What it adds up to: the cost, the tax, the SCC's 4% halved of the base rounded (9763 x 0.02), and no security
  // tax in a system of 0.9; and one of 5% of the base rounded in a system of 0.95.
  assert.deepEqual(researchJobFee({ ...job, cost: 391, tax: 98, sccTaxModifier: 1, security: 0.9 }), { cost: 391, tax: 98, sccSurcharge: 195, securityTax: 0, total: 684 });
  assert.deepEqual(researchJobFee({ ...job, cost: 391, tax: 98, sccTaxModifier: 1, security: 0.95 }), { cost: 391, tax: 98, sccSurcharge: 195, securityTax: 488, total: 1172 });
  // The SCC's modifier is never below nought.
  assert.equal(researchJobFee({ ...job, cost: 391, tax: 98, sccTaxModifier: -1, security: 0.9 }).sccSurcharge, 0);

  for (const [name, wrong] of [
    ["blueprintPrice", null], ["blueprintPrice", -1], ["blueprintPrice", "44032"], ["runs", 0], ["runs", 1.5],
    ["activityTime", 0], ["activityTime", null], ["activityTime", "2100"], ["level", 10], ["level", -1], ["level", null], ["level", undefined],
  ]) {
    assert.equal(researchJobCost({ ...job, ...modifiers, [name]: wrong }), null, `cost, ${name}: ${JSON.stringify(wrong)}`);
    assert.equal(researchJobTax({ ...job, facilityTax: 0.01, [name]: wrong }), null, `tax, ${name}: ${JSON.stringify(wrong)}`);
    assert.equal(researchJobFee({ ...job, cost: 391, tax: 98, sccTaxModifier: 1, security: 0.9, [name]: wrong }), null, `fee, ${name}: ${JSON.stringify(wrong)}`);
  }
  for (const [name, wrong] of [["alpha", null], ["faction", null], ["system", undefined], ["blueprintAmount", "2"], ["facilityModifiers", [0.04]]]) {
    assert.equal(researchJobCost({ ...job, ...modifiers, [name]: wrong }), null, `cost, ${name}: ${JSON.stringify(wrong)}`);
  }
  assert.equal(researchJobTax({ ...job, facilityTax: null }), null);
  for (const [name, wrong] of [["cost", null], ["cost", 390.5], ["tax", null], ["tax", -1], ["sccTaxModifier", null], ["security", null]]) {
    assert.equal(researchJobFee({ ...job, cost: 391, tax: 98, sccTaxModifier: 1, security: 0.9, [name]: wrong }), null, `fee, ${name}: ${JSON.stringify(wrong)}`);
  }
});

test("a research job's materials are by its runs, through the facility's modifiers, and never fewer than one a run", () => {
  const taken = (base, runs, facility) => researchJobMaterials({ materials: [{ typeID: 3814, quantity: base }], runs, facilityModifiers: facility.map(forAll), productType: A_SHIP });
  // [the blueprint's quantity, the runs, the facility's] -> the client's Python's.
  for (const [base, runs, facility, quantity] of [
    [1, 1, [], 1],
    [2, 5, [], 10],
    [5, 7, [0.98], 35],
    [16, 10, [0.99, 0.976], 155],
    [140, 9, [0.958], 1208],
    // Never fewer than one a run: 2.874 and 29.7 taken up would be 3 and 30, and are.
    [1, 3, [0.958], 3],
    [3, 10, [0.99], 30],
  ]) {
    assert.deepEqual(taken(base, runs, facility), { 3814: quantity }, `${base} x ${facility.join(" x ")} x ${runs}`);
  }
  // Never fewer than one a run where the facility would take it below: 1 x 0.5 x 4 is 2, and 4 are taken.
  assert.deepEqual(taken(1, 4, [0.5]), { 3814: 4 });
  // Each material by itself, and a modifier for another category of thing left out.
  assert.deepEqual(researchJobMaterials({
    materials: [{ typeID: 3814, quantity: 5 }, { typeID: 11459, quantity: 1 }], runs: 7,
    facilityModifiers: [forAll(0.98), [0.5, 7, null, null, 11]], productType: A_SHIP,
  }), { 3814: 35, 11459: 7 });
  // A blueprint whose research lists no materials takes none: an empty map, and not nothing.
  assert.deepEqual(researchJobMaterials({ materials: [], runs: 3, facilityModifiers: [forAll(0.98)], productType: A_SHIP }), {});

  const whole = { materials: [{ typeID: 3814, quantity: 5 }], runs: 7, facilityModifiers: [forAll(0.98)], productType: A_SHIP };
  for (const [name, wrong] of [
    ["materials", null], ["materials", [{ typeID: 0, quantity: 5 }]], ["materials", [{ typeID: 3814, quantity: "5" }]], ["materials", [{ typeID: 3814, quantity: 5 }, { typeID: 3814, quantity: 1 }]],
    ["runs", 0], ["runs", 2.5], ["runs", null], ["facilityModifiers", [0.98]], ["facilityModifiers", [[null, null, null, null, 12]]],
  ]) {
    assert.equal(researchJobMaterials({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});
