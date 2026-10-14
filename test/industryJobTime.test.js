"use strict";

// A manufacturing job's time, as the client's own job reckons it before it sends the job to be installed
// (industry/job.py _get_time, 460 to 468): the activity's time for the runs, times each time modifier the job
// has, in the order the job lists them, and rounded to the whole second.
//
//   job.modifiers            industryCommon.GetJobModifiers (485): each required skill that has a time per level
//                            (1.0 + amount x level / 100.0), then the pilot's own manufacturing time attribute
//   activity.job_modifiers   activities/manufacturing.py 10 to 16: 1.0 - timeEfficiency / 100.0, where the
//                            blueprint has any time research
//   facility.modifiers       industryCommon.Facility (378): each of the facility's time modifiers for the
//                            activity that is for the blueprint's product
//
// The server holds a time that is not nought against its own, to the second (eve.js industryRuntimeState.js,
// MISMATCH_TIME). No Tranquility recording has an install, so the numbers below are made up and worked by hand.

const assert = require("node:assert/strict");
const test = require("node:test");

const { facilityMaterialModifiers, facilityTimeModifiers, manufacturingJobSeconds } = require("../web/src/bridge/industryReckonings.mjs");

const dict = (entries) => ({ type: "dict", entries });
const keyVal = (entries) => ({ type: "object", name: "util.KeyVal", args: dict(entries) });
/** A frigate, by its type, group and category. */
const A_SHIP = { typeID: 587, groupID: 25, categoryID: 6 };
const job = (overrides = {}) => ({ activityTime: 6000, runs: 1, skills: [], characterAmount: 0.68, timeEfficiency: 5, facilityModifiers: [], productType: A_SHIP, ...overrides });

test("a job's time is the activity's for the runs, through the pilot's attribute and the blueprint's time research, to the whole second", () => {
  // 6000 x 0.68 x 0.95.
  assert.equal(manufacturingJobSeconds(job()), 3876);
  // The runs multiply the activity's time (activity.job_time: self.time * job.runs).
  assert.equal(manufacturingJobSeconds(job({ runs: 3 })), 11628);
  // A blueprint with no time research has no modifier of its own.
  assert.equal(manufacturingJobSeconds(job({ timeEfficiency: 0 })), 4080);
  // A pilot with no skill for it: the attribute is one.
  assert.equal(manufacturingJobSeconds(job({ characterAmount: 1, timeEfficiency: 20 })), 4800);
});

test("each required skill that has a time per level is a modifier of the job's, by the pilot's level of it", () => {
  // 1.0 + (-1) x 4 / 100.0 = 0.96; 6000 x 0.96 x 0.68 x 0.95 = 3720.96.
  assert.equal(manufacturingJobSeconds(job({ skills: [{ perLevel: -1, level: 4 }] })), 3721);
  // Two of them, and a level of nought changes nothing: 6000 x 0.95 x 1.0 x 0.68 x 0.95 = 3682.2.
  assert.equal(manufacturingJobSeconds(job({ skills: [{ perLevel: -1, level: 5 }, { perLevel: -2, level: 0 }] })), 3682);
});

test("the facility's time modifiers count where they are for the product: by its category, else its group, else its type, or for anything", () => {
  const modifiers = [
    [0.85, null, null, null, 2], // for anything
    [0.8, 6, null, null, 4], // for the product's category
    [0.5, 7, null, null, 4], // for another category
    [0.9, null, 25, null, 4], // for the product's group
    [0.5, null, 26, null, 4], // for another group
    [0.5, null, null, 588, 4], // for another type
  ];
  // 6000 x 0.68 x 0.95 x 0.85 x 0.8 x 0.9 = 2372.112.
  assert.equal(manufacturingJobSeconds(job({ facilityModifiers: modifiers })), 2372);
  // A modifier for a kind of thing counts for nothing where the product is not known.
  assert.equal(manufacturingJobSeconds(job({ facilityModifiers: modifiers, productType: null })), 3295); // 3876 x 0.85 = 3294.6
});

test("the modifiers are multiplied in the client's order, which is not every order to the second", () => {
  // A blueprint's seven of time research is 1.0 - 7 / 100.0, as the client writes it.
  const seven = 1.0 - 7 / 100.0;
  // 1000 x 0.85 x that is 790.5 as the client multiplies it, and a half goes up; the blueprint's first, and the
  // pilot's after, is 790.4999999999999, a second less.
  assert.equal(1000 * 0.85 * seven, 790.5);
  assert.equal(1000 * seven * 0.85, 790.4999999999999);
  assert.equal(manufacturingJobSeconds(job({ activityTime: 1000, characterAmount: 0.85, timeEfficiency: 7 })), 791);
  // 100 x 0.85 x 0.7 is 59.49999999999999 with the pilot's before the facility's; the other way about it is 59.5.
  assert.equal(100 * 0.7 * 0.85, 59.5);
  assert.equal(manufacturingJobSeconds(job({ activityTime: 100, characterAmount: 0.85, timeEfficiency: 0, facilityModifiers: [[0.7, null, null, null, 2]] })), 59);
  // The skill's before the pilot's and the blueprint's last: 1250 x 0.95 x 0.8 x that is 883.4999999999999, where
  // the blueprint's first is 883.5.
  assert.equal(1250 * seven * 0.8 * 0.95, 883.5);
  assert.equal(manufacturingJobSeconds(job({ activityTime: 1250, characterAmount: 0.8, timeEfficiency: 7, skills: [{ perLevel: -1, level: 5 }] })), 883);
  // And the skill's before the pilot's: 25000 x 0.95 x 0.68 x that is 15019.5, where the pilot's first is a hair under.
  assert.equal(25000 * 0.68 * 0.95 * seven, 15019.499999999998);
  assert.equal(manufacturingJobSeconds(job({ activityTime: 25000, characterAmount: 0.68, timeEfficiency: 7, skills: [{ perLevel: -1, level: 5 }] })), 15020);
});

test("no time is made of a guess: one input that is no number, and there is none", () => {
  for (const missing of [
    { characterAmount: null }, { characterAmount: undefined }, { characterAmount: Number.NaN }, { characterAmount: "0.68" },
    { activityTime: 0 }, { activityTime: undefined }, { runs: 0 }, { runs: 1.5 },
    { timeEfficiency: null }, { timeEfficiency: 2.5 }, { timeEfficiency: -1 },
    { skills: [{ perLevel: -1, level: null }] }, { skills: [{ perLevel: null, level: 3 }] },
    { facilityModifiers: [["0.85x", null, null, null, 2]] },
  ]) {
    assert.equal(manufacturingJobSeconds(job(missing)), null, JSON.stringify(missing));
  }
});

test("a facility's time modifiers are the first of an activity's lists, and its material modifiers the second", () => {
  const time = [[0.85, null, null, null, 2], [0.8, 6, null, null, 4]];
  const material = [[0.99, null, null, null, 2]];
  const row = keyVal([
    ["facilityID", 1030000000001],
    ["activities", dict([[1, [time, material, [], [6], [], []]], [8, [[[0.7, null, null, null, 2]], [], [], [], [], []]]])],
  ]);
  assert.deepEqual(facilityTimeModifiers(row, 1), time);
  assert.deepEqual(facilityMaterialModifiers(row, 1), material);
  assert.deepEqual(facilityTimeModifiers(row, 8), [[0.7, null, null, null, 2]]);
  // An activity the facility has not, and a row that is none.
  assert.deepEqual([facilityTimeModifiers(row, 5), facilityTimeModifiers(null, 1)], [[], []]);
});
