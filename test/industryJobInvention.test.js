"use strict";

// An invention, as the client's own job reckons it before it sends the job. What is its own
// (industry/activities/invention.py) and what it has of every job (industry/job.py; industry/activity.py):
//
//   its time        activity.py job_time, 28: the activity's time x runs, then each time modifier the job has in turn
//                   (job.py 460 to 468): the pilot's own invention time, then the facility's for invention. An
//                   invention's own modifiers are of its chance (invention.py 13 to 18), and a decryptor's of time is
//                   of what is invented (industryCommon.GetDecryptors, 465: output=True).
//   its most runs   activity.py 34 to 36 with invention.py's MAX_RUNS, 500: what thirty days hold of the
//                   activity's time. (And the runs its copy has left, which are the blueprint's to say.)
//   its base        invention.py job_cost, 27 to 31: the price of the blueprint invented x COST_PERCENTAGE x
//                   float(runs)
//   its cost, tax   of that base, as any job's (job.py 310 to 320, 450 to 458); the SCC's surcharge whole
//   its materials   job.py 470 to 485: its own, by its runs; and the place of its optional material, the decryptor
//                   (GetDecryptors, 458 to 482; industry/material.py), which is one of the job's materials and is
//                   made whole as the rest are: a decryptor chosen from a base of one, and with none chosen a place
//                   whose type is None, from a base of nought, which comes to the job's runs
//
// No Tranquility recording has an install. THE ANSWERS SAID TO BE THE CLIENT'S OWN PYTHON'S ARE: each case was put
// to the retail client's python27.dll (scripts/py27-oracle.py) with the sums in the order above, and what it
// printed is what is expected here. (Some 74,000 cases were put to it, over every invention time and every
// invention quantity the game's blueprints have, and these functions made the same of every one.) The times and
// quantities are ones the game's blueprints list, or are made up; the prices are made up.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  INVENTION_MAX_RUNS,
  NO_OPTIONAL_MATERIAL,
  SERVICE_LABORATORY_INVENTION,
  inventionJobCost,
  inventionJobFee,
  inventionJobMaterials,
  inventionJobMostRuns,
  inventionJobSeconds,
  inventionJobTax,
} = require("../src/industryInstall");

/** A facility's modifier for anything: [amount, categoryID, groupID, typeID, reference]. */
const forAll = (amount) => [amount, null, null, null, 12];
const A_SHIP = { typeID: 587, groupID: 25, categoryID: 6 };
const DATACORE = 20172;
const DECRYPTOR = 34204;

test("an invention's time is the activity's time by the runs, through the pilot's own invention time and then the facility's modifiers", () => {
  // [the activity's time, the runs, the pilot's, the facility's] -> the client's Python's seconds.
  for (const [activityTime, runs, characterAmount, facility, seconds] of [
    [63900, 1, 1.0, [], 63900],
    [63900, 3, 0.6375, [0.85], 103877],
    [7800, 10, 0.75, [0.95], 55575],
    [1980000, 2, 0.6375, [0.85, 0.76], 1630827],
    // With the modifiers multiplied together first each of these is a second less.
    [63900, 2, 0.75, [0.95], 91058],
    [63900, 10, 0.75, [0.95], 455288],
    [128100, 2, 0.75, [0.95], 182543],
    // With the facility's before the pilot's, a second more, a second less, and a second more.
    [13800, 100, 0.6375, [0.85], 747787],
    [13800, 500, 0.6375, [0.85], 3738938],
    [13800, 100, 0.6375, [0.85, 0.76], 568318],
    // Rounded, and not taken down: 45528.75.
    [63900, 1, 0.75, [0.95], 45529],
  ]) {
    assert.equal(
      inventionJobSeconds({ activityTime, runs, characterAmount, facilityModifiers: facility.map(forAll), productType: A_SHIP }),
      seconds,
      `${activityTime} x ${runs} x ${characterAmount} x ${facility.join(" x ")}`,
    );
  }
  // Only the facility's modifiers that are for the blueprint's product are in it.
  const job = { activityTime: 63900, runs: 3, characterAmount: 0.6375, productType: A_SHIP };
  assert.equal(inventionJobSeconds({ ...job, facilityModifiers: [forAll(0.85), [0.5, 7, null, null, 11], [0.5, null, 26, null, 11]] }), 103877);
  assert.equal(inventionJobSeconds({ ...job, facilityModifiers: [forAll(0.85), [0.5, 6, null, null, 11]] }), 51939);
  assert.equal(inventionJobSeconds({ ...job, facilityModifiers: undefined }), 122209);
  const whole = { ...job, facilityModifiers: [forAll(0.85)] };
  for (const [name, wrong] of [
    ["activityTime", 0], ["activityTime", -63900], ["activityTime", null], ["activityTime", "63900"],
    ["runs", 0], ["runs", 1.5], ["runs", null],
    ["characterAmount", null], ["characterAmount", "0.6375"], ["characterAmount", NaN],
    ["facilityModifiers", [0.85]], ["facilityModifiers", [["0.85", null, null, null, 12]]], ["facilityModifiers", [forAll(0.85), null]],
  ]) {
    assert.equal(inventionJobSeconds({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});

test("the most runs any invention can have is what thirty days hold of the activity's time, and never more than five hundred", () => {
  assert.deepEqual([INVENTION_MAX_RUNS, SERVICE_LABORATORY_INVENTION], [500, 34]);
  // [the activity's time, the pilot's, the facility's] -> the client's Python's most.
  for (const [activityTime, characterAmount, facility, most] of [
    // Taken up: 74.8..., and 2.4...; and by the pilot's own time: without it, 48 and 2.
    [63900, 0.6375, [0.85], 75],
    [1980000, 0.6375, [0.85], 3],
    [1980000, 1.0, [], 2],
    [1021800, 0.75, [], 4],
    // Never more than five hundred, however short the invention.
    [300, 1.0, [], 500],
  ]) {
    assert.equal(
      inventionJobMostRuns({ activityTime, characterAmount, facilityModifiers: facility.map(forAll), productType: A_SHIP }),
      most,
      `${activityTime} / ${characterAmount} / ${facility.join(" / ")}`,
    );
  }
  assert.equal(inventionJobMostRuns({ activityTime: 63900, characterAmount: 0.6375, facilityModifiers: [forAll(0.85), [0.5, 7, null, null, 11]], productType: A_SHIP }), 75);
  const whole = { activityTime: 63900, characterAmount: 0.6375, facilityModifiers: [forAll(0.85)], productType: A_SHIP };
  for (const [name, wrong] of [["activityTime", 0], ["activityTime", null], ["characterAmount", null], ["characterAmount", 0], ["facilityModifiers", [forAll(0)]], ["facilityModifiers", [0.85]]]) {
    assert.equal(inventionJobMostRuns({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});

test("an invention's materials are its own by its runs, and the place of its optional material: a decryptor from a base of one, and with none an empty place at the job's runs", () => {
  const job = (runs, facility) => ({ runs, facilityModifiers: facility.map(forAll), productType: A_SHIP });
  // [the blueprint's quantity, the runs, the facility's] -> the client's Python's quantity of a material of the
  // invention's own.
  for (const [base, runs, facility, quantity] of [
    [2, 3, [0.98], 6],
    [85, 9, [0.958], 733],
    // Rounded to two places before it is taken up to the whole: taken up as it is each would be one more.
    [5, 100, [0.98], 490],
    [10, 25, [0.98], 245],
    [10, 100, [0.98], 980],
  ]) {
    assert.deepEqual(inventionJobMaterials({ ...job(runs, facility), materials: [{ typeID: DATACORE, quantity: base }] }), { [DATACORE]: quantity, [NO_OPTIONAL_MATERIAL]: runs }, `${base} x ${facility.join(" x ")} x ${runs}`);
  }
  // A decryptor chosen is in its place, from a base of one, made whole as any material is: one a run where the
  // facility takes something off, and more than one a run where it adds (the client's Python's: 7, 3, 4 and 510).
  for (const [runs, facility, quantity] of [[7, [], 7], [3, [0.98], 3], [3, [1.02], 4], [500, [1.02], 510]]) {
    assert.deepEqual(inventionJobMaterials({ ...job(runs, facility), materials: [], decryptorTypeID: DECRYPTOR }), { [DECRYPTOR]: quantity }, `a decryptor x ${facility.join(" x ")} x ${runs}`);
  }
  // None chosen: the empty place, from a base of nought, at the job's runs whatever the facility's modifiers are
  // (the client's Python's: 3 and 500). Nought and null say none chosen, as nothing said does.
  assert.deepEqual(inventionJobMaterials({ ...job(3, []), materials: [] }), { [NO_OPTIONAL_MATERIAL]: 3 });
  assert.deepEqual(inventionJobMaterials({ ...job(500, [0.5]), materials: [] }), { [NO_OPTIONAL_MATERIAL]: 500 });
  for (const none of [0, null, undefined]) {
    assert.deepEqual(inventionJobMaterials({ ...job(3, [0.98]), materials: [{ typeID: DATACORE, quantity: 2 }], decryptorTypeID: none }), { [DATACORE]: 6, [NO_OPTIONAL_MATERIAL]: 3 }, String(none));
  }
  // The two together, and the empty place's name is the one the game port writes as None.
  assert.deepEqual(inventionJobMaterials({ ...job(3, [0.98]), materials: [{ typeID: DATACORE, quantity: 2 }, { typeID: 20424, quantity: 2 }], decryptorTypeID: DECRYPTOR }), { [DATACORE]: 6, 20424: 6, [DECRYPTOR]: 3 });
  assert.equal(NO_OPTIONAL_MATERIAL, "None");
  // A modifier for another category of thing is left out, of the materials and of the decryptor.
  assert.deepEqual(inventionJobMaterials({ runs: 3, materials: [{ typeID: DATACORE, quantity: 2 }], decryptorTypeID: DECRYPTOR, facilityModifiers: [[1.02, 7, null, null, 11]], productType: A_SHIP }), { [DATACORE]: 6, [DECRYPTOR]: 3 });

  const whole = { ...job(3, [0.98]), materials: [{ typeID: DATACORE, quantity: 2 }], decryptorTypeID: DECRYPTOR };
  for (const [name, wrong] of [
    ["materials", null], ["materials", [{ typeID: 0, quantity: 2 }]], ["materials", [{ typeID: DATACORE, quantity: "2" }]],
    // (A decryptor that is one of the invention's own materials is no one quantity to a type.)
    ["materials", [{ typeID: DECRYPTOR, quantity: 2 }]],
    ["runs", 0], ["runs", 2.5], ["runs", null],
    ["decryptorTypeID", -1], ["decryptorTypeID", 2.5], ["decryptorTypeID", "34204"],
    ["facilityModifiers", [0.98]], ["facilityModifiers", [[null, null, null, null, 12]]],
  ]) {
    assert.equal(inventionJobMaterials({ ...whole, [name]: wrong }), null, `${name}: ${JSON.stringify(wrong)}`);
  }
});

test("an invention's cost, its tax and what it costs to start are of its own base, the price of the blueprint invented by the percentage and the runs, with the SCC's surcharge whole", () => {
  // [the price of the blueprint invented, the runs, an alpha's, the job's blueprint's own multiplier, the
  // facility's tax, the SCC's modifier, the facility's cost modifiers] -> the client's Python's base rounded,
  // cost, tax, surcharge and security tax.
  for (const [price, runs, alpha, blueprintAmount, facilityTax, sccTaxModifier, facility, charged] of [
    // The surcharge is whole (halved, as a research's is, it would be 125099, 3603 and 5875), and an alpha's share
    // is of the base as it began (of the cost as it stands, the cost would be 32440, 9633 and 2356).
    [3533874.878571429, 118, true, 0.1, 0.0375, 0.75, [0.0388], [8339945, 53209, 312748, 250198, 416997]],
    [285975, 42, true, 1, 0.02, 0.75, [0.04], [240219, 10209, 4804, 7207, 12011]],
    [94151.07097683451, 312, true, 0.1, 0.01, 0.5, [0.04], [587503, 3819, 5875, 11750, 29375]],
    // The tax is of the base rounded: of the base as it is, it would be 1245055, 3953622 and 17720056.
    [6622635.582857144, 94, false, 0.5, 0.1, 0.5, [], [12450555, 6225277, 1245056, 249011, 622528]],
    [21256034.9, 93, true, 0, 0.1, 1, [0.04], [39536225, 98841, 3953623, 1581449, 1976811]],
    [454360423.028, 195, false, 0.5, 0.01, 0.75, [0.04], [1772005650, 35440113, 17720057, 53160170, 88600283]],
  ]) {
    const job = { blueprintPrice: price, runs };
    const cost = inventionJobCost({ ...job, blueprintAmount, alpha, faction: 1.0, system: 1.0, facilityModifiers: facility.map((amount) => [amount, null, null, null, 4]), productType: A_SHIP });
    const tax = inventionJobTax({ ...job, facilityTax });
    const [base, theirCost, theirTax, surcharge, securityTax] = charged;
    assert.equal(inventionJobTax({ ...job, facilityTax: 1 }), base, `the base: ${price} x ${runs}`);
    assert.deepEqual(inventionJobFee({ ...job, cost, tax, sccTaxModifier, security: 1.0 }),
      { cost: theirCost, tax: theirTax, sccSurcharge: surcharge, securityTax, total: theirCost + theirTax + surcharge + securityTax }, `${price} x ${runs}`);
    assert.deepEqual(inventionJobFee({ ...job, cost, tax, sccTaxModifier, security: 0.9 }), { cost: theirCost, tax: theirTax, sccSurcharge: surcharge, securityTax: 0, total: theirCost + theirTax + surcharge });
  }
});

test("the faction's and the system's modifiers are in an invention's cost as they are in any job's, and nothing is made of an input that is not what it should be", () => {
  // The blueprint invented priced at 1,000,000, three runs: a base of 60000. The facility's one cost modifier 0.04.
  const job = { blueprintPrice: 1000000, runs: 3 };
  const modifiers = { blueprintAmount: null, alpha: false, faction: 1.0, system: 1.0, facilityModifiers: [[0.04, null, null, null, 4]], productType: A_SHIP };
  assert.equal(inventionJobCost({ ...job, ...modifiers }), 2400);
  assert.equal(inventionJobCost({ ...job, ...modifiers, alpha: true }), 2550);
  assert.equal(inventionJobCost({ ...job, ...modifiers, faction: 0.9, system: 0.5 }), 1080);
  assert.equal(inventionJobCost({ ...job, ...modifiers, facilityModifiers: [[0.04, null, null, null, 4], [0.5, 7, null, null, 11]] }), 2400);
  assert.deepEqual([inventionJobTax({ ...job, facilityTax: 0.01 }), inventionJobTax({ ...job, facilityTax: 0.0325 }), inventionJobTax({ ...job, facilityTax: 0 })], [600, 1950, 0]);
  assert.deepEqual(inventionJobFee({ ...job, cost: 2400, tax: 600, sccTaxModifier: 1, security: 0.9 }), { cost: 2400, tax: 600, sccSurcharge: 2400, securityTax: 0, total: 5400 });
  assert.deepEqual(inventionJobFee({ ...job, cost: 2400, tax: 600, sccTaxModifier: 1, security: 0.95 }), { cost: 2400, tax: 600, sccSurcharge: 2400, securityTax: 3000, total: 8400 });
  // A blueprint invented that is priced at nought makes a job that costs nothing.
  assert.equal(inventionJobCost({ ...job, ...modifiers, blueprintPrice: 0 }), 0);

  for (const [name, wrong] of [["blueprintPrice", null], ["blueprintPrice", -1], ["blueprintPrice", "1000000"], ["runs", 0], ["runs", 1.5], ["runs", null]]) {
    assert.equal(inventionJobCost({ ...job, ...modifiers, [name]: wrong }), null, `cost, ${name}: ${JSON.stringify(wrong)}`);
    assert.equal(inventionJobTax({ ...job, facilityTax: 0.01, [name]: wrong }), null, `tax, ${name}: ${JSON.stringify(wrong)}`);
    assert.equal(inventionJobFee({ ...job, cost: 2400, tax: 600, sccTaxModifier: 1, security: 0.9, [name]: wrong }), null, `fee, ${name}: ${JSON.stringify(wrong)}`);
  }
  for (const [name, wrong] of [["alpha", null], ["faction", null], ["system", undefined], ["blueprintAmount", "2"], ["facilityModifiers", [0.04]]]) {
    assert.equal(inventionJobCost({ ...job, ...modifiers, [name]: wrong }), null, `cost, ${name}: ${JSON.stringify(wrong)}`);
  }
  assert.equal(inventionJobTax({ ...job, facilityTax: null }), null);
});
