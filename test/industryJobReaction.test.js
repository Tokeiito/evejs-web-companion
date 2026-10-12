"use strict";

// A reaction's job, as the client's own job reckons it before it sends the job to be previewed or installed.
//
//   the base             activities/reaction.py 16: the formula's price times the runs, as a manufacturing job's.
//                        The formula's price (industryCommon.GetBlueprintPrice, 521 to 543) is by the materials of
//                        the work asked: for a reaction the reaction's own, and each material that is itself a
//                        blueprint with a reaction by that reaction's, in turn. (A science job's is by the
//                        manufacturing's: 527.)
//   job.modifiers        industryCommon.GetJobModifiers (485 to 513): the pilot's own reaction time (attribute 2662,
//                        CHARACTER_MODIFIERS 43). No skill's time per level: the client lists those for
//                        manufacturing alone (REQUIRED_SKILL_MODIFIERS, 44).
//   activity's own       none: a reaction has no modifier of the blueprint's (activity.py 22), a formula having no
//                        research.
//   facility.modifiers   each of the facility's modifiers for reactions that is for the formula's product.
//   the service          structures/services.py GetServiceID (149 to 167): by the group of what is made.
//
// The time is the activity's by the runs (activity.py 28), through the time modifiers in the job's order, rounded
// (job.py 460 to 468); the materials each of the reaction's by the material modifiers, by the runs, and never fewer
// than one a run (job.py 470 to 485). No Tranquility recording has an install, so the numbers below are made up
// and worked by hand.

const assert = require("node:assert/strict");
const test = require("node:test");

const { blueprintPrice, reactionJobMaterials, reactionJobSeconds, reactionServiceID } = require("../src/industryInstall");

/** What a formula makes: a composite, by its type, group and category. */
const A_COMPOSITE = { typeID: 16654, groupID: 429, categoryID: 4 };
/** A facility's modifier as its row lists one: (amount, categoryID, groupID, typeID, reference). */
const forAny = (amount) => [amount, null, null, null, 12];
const forGroup = (amount, groupID) => [amount, null, groupID, null, 13];

const BLUEPRINTS = {
  // A formula: its reaction takes a hundred of each of two moon materials and five fuel blocks.
  5000: { reaction: { materials: [{ typeID: 16633, quantity: 100 }, { typeID: 16634, quantity: 100 }, { typeID: 4051, quantity: 5 }], products: [{ typeID: 16654, quantity: 200 }], time: 10800 } },
  // A formula one of whose materials is itself a formula's type: that one is priced by its own reaction's materials.
  5001: { reaction: { materials: [{ typeID: 5002, quantity: 2 }, { typeID: 34, quantity: 3 }] } },
  5002: { reaction: { materials: [{ typeID: 35, quantity: 4 }] } },
  // A formula that lists a blueprint which has manufacturing and no reaction.
  5003: { reaction: { materials: [{ typeID: 691, quantity: 1 }] } },
  691: { manufacturing: { materials: [{ typeID: 34, quantity: 32000 }] } },
  // A type with both kinds of work (the game's data has none such): each is priced by its own.
  5004: { manufacturing: { materials: [{ typeID: 34, quantity: 10 }] }, reaction: { materials: [{ typeID: 35, quantity: 10 }] } },
  // A formula among its own materials, which the game's data has not.
  5005: { reaction: { materials: [{ typeID: 5005, quantity: 1 }] } },
  // A formula whose reaction lists no materials.
  5006: { reaction: { time: 3600 } },
};
const PRICES = { 34: 2, 35: 8, 16633: 100, 16634: 250, 4051: 12000, 691: 2800000, 5000: 9, 5004: 7 };
const lookups = { activitiesOf: (typeID) => BLUEPRINTS[typeID] ?? null, adjustedPriceOf: (typeID) => PRICES[typeID] ?? null };
const forAReaction = { ...lookups, activity: "reaction" };

test("a formula's price for a reaction is each of its reaction's materials' own price times its quantity", () => {
  // 100 x 100 + 100 x 250 + 5 x 12000.
  assert.equal(blueprintPrice(5000, forAReaction), 95000);
  // Priced for any other work it has no manufacturing, and is priced at its own adjusted price: the default.
  assert.equal(blueprintPrice(5000, lookups), 9);
  assert.equal(blueprintPrice(5000, { ...lookups, activity: "manufacturing" }), 9);
  // A material that is a formula's type is priced by its own reaction's materials: 2 x (4 x 8) + 3 x 2.
  assert.equal(blueprintPrice(5001, forAReaction), 70);
  // A material that is a blueprint with no reaction is priced at its own adjusted price, not by its manufacturing's.
  assert.equal(blueprintPrice(5003, forAReaction), 2800000);
  // A type with both: each work's price is by that work's materials.
  assert.deepEqual([blueprintPrice(5004, forAReaction), blueprintPrice(5004, lookups)], [80, 20]);
  // A formula whose reaction lists no materials is nought; a type that is no blueprint is its adjusted price.
  assert.deepEqual([blueprintPrice(5006, forAReaction), blueprintPrice(34, forAReaction), blueprintPrice(999, forAReaction)], [0, 2, 0]);
});

test("no price is made for a reaction of what cannot be read: a formula among its own materials, and no table", () => {
  assert.equal(blueprintPrice(5005, forAReaction), null);
  assert.equal(blueprintPrice(5000, { ...forAReaction, adjustedPriceOf: () => undefined }), null);
  // What was read for one price is not held against the next.
  assert.deepEqual([blueprintPrice(5001, forAReaction), blueprintPrice(5001, forAReaction)], [70, 70]);
});

test("a reaction's time is the activity's by the runs, through the pilot's own reaction time and the facility's, to the whole second", () => {
  // Three hours a run, three runs, a pilot whose reaction time is 0.85: 10800 x 3 x 0.85 = 27540.
  const job = { activityTime: 10800, runs: 3, characterAmount: 0.85, facilityModifiers: [], productType: A_COMPOSITE };
  assert.equal(reactionJobSeconds(job), 27540);
  // A refinery's hull takes a quarter off any reaction's time, and a rig a fifth off a composite's: x 0.75 x 0.8.
  assert.equal(reactionJobSeconds({ ...job, facilityModifiers: [forAny(0.75), forGroup(0.8, 429)] }), 16524);
  // A rig for another group's reactions is not this job's.
  assert.equal(reactionJobSeconds({ ...job, facilityModifiers: [forAny(0.75), forGroup(0.8, 974)] }), 20655);
  // One run, and a half second goes up: 3601 x 0.5 = 1800.5.
  assert.equal(reactionJobSeconds({ ...job, activityTime: 3601, runs: 1, characterAmount: 0.5 }), 1801);
  // Nothing of a blueprint's research or of a skill is in it: there is nowhere to say either.
  assert.equal(reactionJobSeconds({ ...job, timeEfficiency: 20, skills: [{ perLevel: -4, level: 5 }] }), 27540);
});

test("no time is made of a guess for a reaction: one input that is not what it should be, and there is none", () => {
  const job = { activityTime: 10800, runs: 3, characterAmount: 0.85, facilityModifiers: [forAny(0.75)], productType: A_COMPOSITE };
  for (const wrong of [{ activityTime: 0 }, { activityTime: null }, { activityTime: "10800" }, { runs: 0 }, { runs: 1.5 }, { runs: null }, { characterAmount: null }, { characterAmount: "0.85" },
    { facilityModifiers: [null] }, { facilityModifiers: [["0.75", null, null, null, 12]] }]) {
    assert.equal(reactionJobSeconds({ ...job, ...wrong }), null, JSON.stringify(wrong));
  }
  // No facility's modifiers at all are none.
  assert.equal(reactionJobSeconds({ ...job, facilityModifiers: undefined }), 27540);
});

test("a reaction's materials are each of the formula's by the facility's modifiers for the product, by the runs, and never fewer than one a run", () => {
  const materials = [{ typeID: 16633, quantity: 100 }, { typeID: 16634, quantity: 100 }, { typeID: 4051, quantity: 5 }];
  const job = { materials, runs: 3, facilityModifiers: [], productType: A_COMPOSITE };
  assert.deepEqual(reactionJobMaterials(job), { 16633: 300, 16634: 300, 4051: 15 });
  // A rig that takes 2.4% off a composite's materials: 100 x 0.976 x 3 = 292.8, and 5 x 0.976 x 3 = 14.64.
  assert.deepEqual(reactionJobMaterials({ ...job, facilityModifiers: [forGroup(0.976, 429)] }), { 16633: 293, 16634: 293, 4051: 15 });
  // One for another group is not this job's; one for any is.
  assert.deepEqual(reactionJobMaterials({ ...job, facilityModifiers: [forGroup(0.976, 974)] }), { 16633: 300, 16634: 300, 4051: 15 });
  assert.deepEqual(reactionJobMaterials({ ...job, facilityModifiers: [forAny(0.5)] }), { 16633: 150, 16634: 150, 4051: 8 });
  // Never fewer than one a run: 1 x 0.5 x 3 = 1.5, and three runs take three.
  assert.deepEqual(reactionJobMaterials({ materials: [{ typeID: 4051, quantity: 1 }], runs: 3, facilityModifiers: [forAny(0.5)], productType: A_COMPOSITE }), { 4051: 3 });
  // A formula's research is not in them: there is nowhere to say it.
  assert.deepEqual(reactionJobMaterials({ ...job, materialEfficiency: 10 }), { 16633: 300, 16634: 300, 4051: 15 });
  // A reaction that lists no materials takes none.
  assert.deepEqual(reactionJobMaterials({ ...job, materials: [] }), {});
});

test("no materials are made of a guess for a reaction", () => {
  const job = { materials: [{ typeID: 16633, quantity: 100 }], runs: 3, facilityModifiers: [], productType: A_COMPOSITE };
  for (const wrong of [{ materials: null }, { materials: "none" }, { runs: 0 }, { runs: 2.5 }, { runs: null }, { facilityModifiers: [null] }, { materials: [{ typeID: 16633, quantity: "100" }] }]) {
    assert.equal(reactionJobMaterials({ ...job, ...wrong }), null, JSON.stringify(wrong));
  }
});

test("a structure reacts by one of four services, by the group of what is made", () => {
  // structures/services.py 161 to 167: biochemical materials and molecular-forged materials; hybrid polymers; the
  // composite groups (intermediate materials, composites, unrefined minerals); and the plain service for any other.
  assert.deepEqual([712, 4096].map(reactionServiceID), [42, 42]);
  assert.equal(reactionServiceID(974), 43);
  assert.deepEqual([428, 429, 4932].map(reactionServiceID), [41, 41, 41]);
  assert.deepEqual([4, 25, 18].map(reactionServiceID), [40, 40, 40]);
  // What is no group is no service.
  for (const none of [0, -1, 1.5, null, undefined, "429"]) assert.equal(reactionServiceID(none), null, String(none));
});
