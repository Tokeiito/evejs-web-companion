"use strict";

// A manufacturing job's materials, as the client's own job reckons them before it sends the job
// (industry/job.py _get_materials, 470 to 485), and sends them (dump, 637: each material's type to its quantity):
//
//   quantity = float(material.base)                         the blueprint's own quantity of the material
//   for each of the job's input modifiers that is a material modifier, in the job's order (230 to 248):
//       quantity *= modifier.amount
//     activity.job_modifiers  activities/manufacturing.py 12: 1.0 - materialEfficiency / 100.0, where the blueprint
//                             has any material research
//     facility.modifiers      industryCommon.Facility (378): each of the facility's material modifiers for the
//                             activity that is for the blueprint's product, in the facility's own order
//   quantity *= runs                                        activity.job_material_runs (activity.py 38)
//   max(int(math.ceil(round(quantity, 2))), runs)           MATERIAL_ROUND_PRECISION is 2
//
// The server holds a map of materials that is not empty against its own (MISMATCH_MATERIAL), and these are floats:
// the same numbers multiplied another way round, or rounded another way to two places, come one unit apart.
//
// No Tranquility recording has an install. THE ANSWERS BELOW ARE THE CLIENT'S OWN PYTHON'S: each case was put to
// the retail client's python27.dll (scripts/py27-oracle.py) with the sums in the order above, and what it printed
// is what is expected here. The quantities are ones the game's blueprints list, or are made up.

const assert = require("node:assert/strict");
const test = require("node:test");

const { manufacturingJobMaterials, roundToTwoPlaces } = require("../web/src/bridge/industryReckonings.mjs");

/** A facility's material modifier for anything: [amount, categoryID, groupID, typeID, reference]. */
const forAll = (amount) => [amount, null, null, null, 12];
/** One material of `base` a run, and what the job takes of it. */
const taken = (base, materialEfficiency, amounts, runs, more = {}) => {
  const said = manufacturingJobMaterials({ materials: [{ typeID: 35, quantity: base }], runs, materialEfficiency, facilityModifiers: amounts.map(forAll), productType: null, ...more });
  return said === null ? null : said["35"];
};

test("a number is rounded to two places as the client's Python rounds it: by what the number is, and a half away from nought", () => {
  // Each pair is what the client's own Python 2.7 answered for round(x, 2). A float that is written as ending in
  // a 5 at the third place is seldom that number: 2.675 is a little under it, 8.345 a little over.
  for (const [x, answer] of [
    [2.675, 2.67], [1.005, 1.0], [1.115, 1.11], [8.345, 8.35], [0.285, 0.28], [1.245, 1.25], [31680.005, 31680.01], [470.255, 470.25],
    [0.005, 0.01], [0.015, 0.01], [0.045, 0.04], [1e-9, 0.0], [123456789.135, 123456789.14], [2.5, 2.5],
    // And the ones that are that number, which go away from nought.
    [0.125, 0.13], [0.375, 0.38], [0.625, 0.63], [0.875, 0.88], [123456789.125, 123456789.13],
  ]) {
    assert.equal(roundToTwoPlaces(x), answer, String(x));
  }
});

test("a job's material is the blueprint's quantity through its research and the facility's modifiers, then the runs, rounded up", () => {
  // In an engineering complex, whose hull takes 1% off (0.99). Beside each, in the comment, what another way of
  // doing the same sum comes to: the runs multiplied in first (R), the facility's modifier before the blueprint's
  // research (M), or the rounding done by a hundred times and back (S).
  for (const [base, research, runs, answer] of [
    [32000, 0, 1, 31680],
    [2500, 0, 1, 2475],
    [12055, 10, 1, 10741], // S and M: 10742
    [3685, 10, 3, 9851], // R: 9850
    [211, 10, 5, 940], // S: 941
    [255, 2, 5, 1238], // R and M: 1237
    [642, 5, 5, 3019], // R and M: 3020
    [12011, 10, 5, 53509], // S: 53510
    [135255, 2, 5, 656122], // R and M: 656123
    [1084811, 10, 5, 4832833], // S: 4832834
    [64525, 7, 6, 356449], // R and M: 356450
    [501535, 5, 6, 2830162], // S: 2830163
    [5030, 5, 7, 33116], // R and M: 33115
    [32450, 7, 7, 209137], // R: 209138
    [685030, 5, 7, 4509895], // S: 4509896
    [321, 5, 10, 3019], // R and M: 3020
  ]) {
    assert.equal(taken(base, research, [0.99], runs), answer, `${base} a run, research ${research}, ${runs} runs`);
  }
});

test("each of the facility's material modifiers is multiplied in by itself, in the facility's order", () => {
  // Two modifiers, a hull's and a rig's: multiplied together first and then in, 15790.
  assert.equal(taken(2500, 7, [0.99, 0.98], 7), 15791);
  assert.equal(taken(7, 5, [0.958, 0.99], 4321), 27253);
  assert.equal(taken(1234567, 5, [0.958, 0.99], 4321), 4806436836);
  // With none, and no research, it is the quantity times the runs.
  assert.equal(taken(1, 0, [], 1), 1);
  assert.equal(taken(86, 0, [], 3), 258);
});

test("a job takes no fewer of a material than one a run", () => {
  // 1 x 0.9 x 5 = 4.5, which is 5 rounded up; 1 x 0.9 x 0.5 x 5 = 2.25, which is 3, and five runs take five.
  assert.equal(taken(1, 10, [], 5), 5);
  assert.equal(taken(1, 10, [0.5], 5), 5);
  assert.equal(taken(3, 10, [0.5], 5), 7);
});

test("a facility's modifier counts where it is for the product, and each material of the blueprint's is in the answer by its type", () => {
  const A_SHIP = { typeID: 587, groupID: 25, categoryID: 6 };
  const materials = [{ typeID: 34, quantity: 32000 }, { typeID: 35, quantity: 6000 }, { typeID: 36, quantity: 2500 }, { typeID: 37, quantity: 500 }];
  const facilityModifiers = [
    [0.99, null, null, null, 12],
    // For ships, for frigates and for this frigate: each counts. For modules, for cruisers and for another type: none does.
    [0.98, 6, null, null, 11], [0.5, 7, null, null, 11], [0.97, null, 25, null, 11], [0.5, null, 26, null, 11], [0.96, null, null, 587, 11], [0.5, null, null, 588, 11],
  ];
  const said = manufacturingJobMaterials({ materials, runs: 2, materialEfficiency: 3, facilityModifiers, productType: A_SHIP });
  // 32000 x 0.97 x 0.99 x 0.98 x 0.97 x 0.96 x 2 = 56086.19...; and so on for each.
  const each = (base) => Math.ceil(Number((base * 0.97 * 0.99 * 0.98 * 0.97 * 0.96 * 2).toFixed(2)));
  assert.deepEqual(said, { 34: each(32000), 35: each(6000), 36: each(2500), 37: each(500) });
  assert.equal(said["34"], 56087);
  // With no product known, only the modifier for anything counts.
  assert.equal(manufacturingJobMaterials({ materials, runs: 2, materialEfficiency: 3, facilityModifiers, productType: null })["34"], Math.ceil(32000 * 0.97 * 0.99 * 2));
  // A blueprint whose manufacturing lists no materials takes none.
  assert.deepEqual(manufacturingJobMaterials({ materials: [], runs: 2, materialEfficiency: 3, facilityModifiers: [], productType: null }), {});
});

test("no materials are made of a guess: one input that is not what it should be, and there are none", () => {
  const good = { materials: [{ typeID: 35, quantity: 211 }], runs: 5, materialEfficiency: 10, facilityModifiers: [forAll(0.99)], productType: null };
  assert.deepEqual(manufacturingJobMaterials(good), { 35: 940 });
  for (const wrong of [
    { runs: 0 }, { runs: -1 }, { runs: 1.5 }, { runs: "5" }, { runs: null },
    { materialEfficiency: -1 }, { materialEfficiency: 2.5 }, { materialEfficiency: "10" }, { materialEfficiency: null }, { materialEfficiency: undefined },
    { materials: null }, { materials: { 35: 211 } }, { materials: [null] }, { materials: [{ typeID: 0, quantity: 211 }] }, { materials: [{ typeID: 35.5, quantity: 211 }] },
    { materials: [{ typeID: 35, quantity: "211" }] }, { materials: [{ typeID: 35, quantity: -1 }] }, { materials: [{ typeID: 35 }] }, { materials: [{ typeID: 35, quantity: NaN }] },
    { facilityModifiers: [["0.99", null, null, null, 12]] }, { facilityModifiers: [[null, null, null, null, 12]] }, { facilityModifiers: ["a modifier"] },
    // A material listed twice is not a map of one quantity to a type.
    { materials: [{ typeID: 35, quantity: 211 }, { typeID: 35, quantity: 4 }] },
    // A quantity past what a whole number can be counted on to be.
    { materials: [{ typeID: 35, quantity: Number.MAX_SAFE_INTEGER }], materialEfficiency: 0, facilityModifiers: [] },
  ]) {
    assert.equal(manufacturingJobMaterials({ ...good, ...wrong }), null, JSON.stringify(wrong));
  }
  // No list of modifiers at all is no modifiers.
  assert.deepEqual(manufacturingJobMaterials({ ...good, facilityModifiers: undefined }), { 35: Math.ceil(211 * 0.9 * 5) });
});
