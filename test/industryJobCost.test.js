"use strict";

// A manufacturing job's cost, as the client's own job reckons it before it sends the job to be previewed or
// installed (industry/job.py _get_cost_for_modifiers, 310 to 320).
//
//   the base                 activity.job_cost (activities/manufacturing.py 26): the blueprint's price times the runs,
//                            not rounded. The blueprint's price (industryCommon.GetBlueprintPrice, 520 to 543) is
//                            each of its manufacturing materials' own price times its quantity; a type that is no
//                            blueprint is priced at its adjusted average price, and at nought where it has none.
//   job.modifiers            industryCommon.GetJobModifiers (485 to 513): the blueprint type's own cost multiplier
//                            (attribute 1954), where it has one; and for an alpha clone an added 0.25% of the base
//   facility.modifiers       industryCommon.Facility (378 to 418): the faction's modifier where it is not 1.0, the
//                            system's where it is neither 0.0 nor 1.0, then each of the facility's cost modifiers
//                            that is for the blueprint's product
//
// The base is multiplied by each in turn, the alpha's addition is of the base as it began, and the sum is rounded
// once. The server holds a cost that is not nought against its own, to the ISK (MISMATCH_COST). No Tranquility
// recording has an install, so the numbers below are made up and worked by hand.

const assert = require("node:assert/strict");
const test = require("node:test");

const { blueprintPrice, facilityCharges, facilityCostModifiers, facilityGlobalModifiers, facilityTaxRate, facilityTimeModifiers, manufacturingJobCost, manufacturingJobFee, manufacturingJobTax, manufacturingServiceID } = require("../web/src/bridge/industryReckonings.mjs");

const dict = (entries) => ({ type: "dict", entries });
const keyVal = (entries) => ({ type: "object", name: "util.KeyVal", args: dict(entries) });
/** A frigate, by its type, group and category. */
const A_SHIP = { typeID: 587, groupID: 25, categoryID: 6 };

/** A frigate's blueprint, a component's blueprint that the frigate's lists among its materials, and one with no manufacturing. */
const BLUEPRINTS = {
  691: { manufacturing: { materials: [{ typeID: 34, quantity: 32000 }, { typeID: 35, quantity: 6000 }, { typeID: 36, quantity: 2500 }, { typeID: 37, quantity: 500 }] } },
  900: { manufacturing: { materials: [{ typeID: 34, quantity: 10 }, { typeID: 901, quantity: 3 }, { typeID: 77, quantity: 5 }] } },
  901: { manufacturing: { materials: [{ typeID: 35, quantity: 4 }, { typeID: 36, quantity: 1 }] } },
  902: { copying: { time: 480 } },
  904: { manufacturing: { materials: [{ typeID: 901, quantity: 1 }, { typeID: 34, quantity: 1 }, { typeID: 901, quantity: 2 }] } },
  903: { manufacturing: { time: 600 } },
};
const PRICES = { 34: 2, 35: 8, 36: 32, 37: 128, 691: 2800000, 902: 5000, 903: 7000, 77: 0 };
const lookups = { activitiesOf: (typeID) => BLUEPRINTS[typeID] ?? null, adjustedPriceOf: (typeID) => PRICES[typeID] ?? null };

test("a blueprint's price is each of its manufacturing materials' own price times its quantity", () => {
  // 32000 x 2 + 6000 x 8 + 2500 x 32 + 500 x 128.
  assert.equal(blueprintPrice(691, lookups), 256000);
  // A material that is itself a blueprint is priced by its own materials (4 x 8 + 1 x 32 = 64), not by its adjusted
  // price; one with a price of nought, or none, counts nought: 10 x 2 + 3 x 64 + 5 x 0.
  assert.equal(blueprintPrice(900, lookups), 212);
  // The same component twice among a blueprint's materials is priced each time: 64 + 2 + 2 x 64.
  assert.equal(blueprintPrice(904, lookups), 194);
  // A type that is no blueprint is its adjusted average price, and nought where it has none.
  assert.deepEqual([blueprintPrice(34, lookups), blueprintPrice(77, lookups), blueprintPrice(12345, lookups)], [2, 0, 0]);
  // A blueprint that has no manufacturing is priced as a type (the client's KeyError), and one whose manufacturing
  // lists no materials is nought (the sum of none).
  assert.deepEqual([blueprintPrice(902, lookups), blueprintPrice(903, lookups)], [5000, 0]);
});

test("no price is made of what cannot be read: prices that could not be had, and a blueprint among its own materials", () => {
  // The pilot has no table of prices: there is none to read, which is not a price of nought.
  assert.equal(blueprintPrice(691, { ...lookups, adjustedPriceOf: () => undefined }), null);
  // A price that is no number.
  assert.equal(blueprintPrice(691, { ...lookups, adjustedPriceOf: (typeID) => (typeID === 36 ? "32" : PRICES[typeID] ?? null) }), null);
  // The game's data has no blueprint among its own materials, however deep; one that had would have no price.
  const round = { 1: { manufacturing: { materials: [{ typeID: 2, quantity: 1 }] } }, 2: { manufacturing: { materials: [{ typeID: 1, quantity: 1 }] } } };
  assert.equal(blueprintPrice(1, { activitiesOf: (typeID) => round[typeID] ?? null, adjustedPriceOf: () => 5 }), null);
  // A quantity that is no whole number.
  const many = (quantity) => blueprintPrice(5, { activitiesOf: (typeID) => (typeID === 5 ? { manufacturing: { materials: [{ typeID: 34, quantity }] } } : null), adjustedPriceOf: () => 5 });
  assert.deepEqual([many(3), many("many"), many(2.5), many(undefined)], [15, null, null, null]);
});

const job = (overrides = {}) => ({ blueprintPrice: 256000, runs: 1, blueprintAmount: null, alpha: false, faction: 1, system: 1, facilityModifiers: [[0.04, null, null, null, 4]], productType: A_SHIP, ...overrides });

test("a job's cost is the blueprint's price for the runs through each cost modifier, to the whole ISK", () => {
  // 256000 x 0.04.
  assert.equal(manufacturingJobCost(job()), 10240);
  assert.equal(manufacturingJobCost(job({ runs: 3 })), 30720);
  // With no modifier at all it is the base.
  assert.equal(manufacturingJobCost(job({ facilityModifiers: [] })), 256000);
  // A half goes up: 100 x 0.045 is 4.5.
  assert.equal(manufacturingJobCost(job({ blueprintPrice: 100, facilityModifiers: [[0.045, null, null, null, 4]] })), 5);
  // The base is not rounded before it is multiplied: 1.4 x 0.4 is 0.56, which is 1, where 1 x 0.4 would be nought.
  assert.equal(manufacturingJobCost(job({ blueprintPrice: 1.4, facilityModifiers: [[0.4, null, null, null, 4]] })), 1);
});

test("an alpha clone's job costs a quarter of a percent of the base more, added and not multiplied", () => {
  // 256000 x 0.04 + 256000 x (1.0025 - 1.0) = 10240 + 640.
  assert.equal(manufacturingJobCost(job({ alpha: true })), 10880);
  // Of the base as it began: the blueprint type's own multiplier of nought leaves the alpha its addition.
  assert.equal(manufacturingJobCost(job({ alpha: true, blueprintAmount: 0 })), 640);
  // And the sum is rounded once: 12 x 0.04 = 0.48 and 12 x 0.0025 = 0.03 make 0.51, which is 1, where each rounded is nought.
  assert.equal(manufacturingJobCost(job({ blueprintPrice: 12, alpha: true })), 1);
  assert.equal(manufacturingJobCost(job({ blueprintPrice: 12 })), 0);
});

test("the blueprint type's own multiplier, the faction's and the system's are modifiers of the cost where they are any", () => {
  // The blueprint type's own (attribute 1954), which is nought for the blueprints that have it: the job costs nothing.
  assert.equal(manufacturingJobCost(job({ blueprintAmount: 0 })), 0);
  assert.equal(manufacturingJobCost(job({ blueprintAmount: 0.5 })), 5120);
  // The faction's, where it is not 1.0.
  assert.equal(manufacturingJobCost(job({ faction: 0.9 })), 9216);
  // The system's, where it is neither 0.0 nor 1.0: 256000 x 0.05 x 0.04.
  assert.equal(manufacturingJobCost(job({ system: 0.05 })), 512);
  assert.deepEqual([manufacturingJobCost(job({ system: 0 })), manufacturingJobCost(job({ system: 1 }))], [10240, 10240]);
});

test("the facility's cost modifiers count where they are for the product, and all are multiplied in the client's order", () => {
  const modifiers = [
    [0.04, null, null, null, 4], // for anything
    [0.5, 6, null, null, 2], // for the product's category
    [0.1, 7, null, null, 2], // for another category
    [0.9, null, 25, null, 2], // for the product's group
    [0.1, null, null, 588, 2], // for another type
  ];
  // 256000 x 0.04 x 0.5 x 0.9.
  assert.equal(manufacturingJobCost(job({ facilityModifiers: modifiers })), 4608);
  // A modifier for a kind of thing counts for nothing where the product is not known.
  assert.equal(manufacturingJobCost(job({ facilityModifiers: modifiers, productType: null })), 10240);
  // The order is the client's: the blueprint's own, the faction's, the system's, then the facility's. These are
  // floats: 1000 x 0.85 x (1.0 - 7 / 100.0) is 790.5 with the faction's before the facility's, and a hair under the
  // other way about.
  const seven = 1.0 - 7 / 100.0;
  assert.deepEqual([1000 * 0.85 * seven, 1000 * seven * 0.85], [790.5, 790.4999999999999]);
  assert.equal(manufacturingJobCost(job({ blueprintPrice: 1000, faction: 0.85, facilityModifiers: [[seven, null, null, null, 2]] })), 791);
  assert.equal(manufacturingJobCost(job({ blueprintPrice: 1000, system: 0.85, facilityModifiers: [[seven, null, null, null, 2]] })), 791);
  assert.equal(manufacturingJobCost(job({ blueprintPrice: 1000, blueprintAmount: 0.85, faction: seven, facilityModifiers: [] })), 791);
  assert.equal(manufacturingJobCost(job({ blueprintPrice: 1000, faction: 0.85, system: seven, facilityModifiers: [] })), 791);
});

test("no cost is made of a guess: one input that is no number, and there is none", () => {
  for (const missing of [
    { blueprintPrice: null }, { blueprintPrice: undefined }, { blueprintPrice: Number.NaN }, { blueprintPrice: -1 },
    { runs: 0 }, { runs: 1.5 }, { blueprintAmount: "0" }, { blueprintAmount: undefined },
    { alpha: null }, { alpha: 0 }, { faction: null }, { faction: "1" }, { system: null }, { system: undefined },
    { facilityModifiers: [["4%", null, null, null, 4]] },
  ]) {
    assert.equal(manufacturingJobCost(job(missing)), null, JSON.stringify(missing));
  }
});

test("a facility's cost modifiers are the third of an activity's lists, and its faction's and system's modifiers are beside them", () => {
  const time = [[0.95, null, null, null, 5]];
  const cost = [[0.04, null, null, null, 4], [0.5, 6, null, null, 2]];
  const row = keyVal([
    ["facilityID", 60003760],
    ["globalModifiers", dict([["faction", 0.9], ["system", dict([[1, 0.05], [8, 1]])]])],
    ["activities", dict([[1, [time, [], cost, [], [], []]], [8, [[], [], [[0.02, null, null, null, 4]], [], [], []]]])],
  ]);
  assert.deepEqual([facilityCostModifiers(row, 1), facilityTimeModifiers(row, 1), facilityCostModifiers(row, 8)], [cost, time, [[0.02, null, null, null, 4]]]);
  assert.deepEqual([facilityGlobalModifiers(row, 1), facilityGlobalModifiers(row, 8)], [{ faction: 0.9, system: 0.05 }, { faction: 0.9, system: 1 }]);
  // An activity the system has no modifier for, a row that says nothing of them, and no row.
  assert.deepEqual([facilityGlobalModifiers(row, 5), facilityGlobalModifiers(keyVal([["facilityID", 1]]), 1), facilityGlobalModifiers(null, 1)],
    [{ faction: 0.9, system: null }, { faction: null, system: null }, { faction: null, system: null }]);
  assert.deepEqual([facilityCostModifiers(row, 5), facilityCostModifiers(null, 1)], [[], []]);
});

// ── the tax, and what a job costs to start ──────────────────────────────────
//
// industry/job.py: the tax (450 to 458) is the base rounded (base_cost, 127 to 130) times the facility's tax, rounded.
// What the job costs to start (total_cost, 132 to 135) is the cost, the tax, the SCC's surcharge (137 to 152: the
// rounded base times 4% by the facility's modifier of it) and, in a system of security 0.95 and over, an industry
// security tax of 5% of the rounded base (164 to 174).

test("a job's tax is the base, rounded, times the facility's tax, to the whole ISK", () => {
  assert.equal(manufacturingJobTax({ blueprintPrice: 256000, runs: 1, facilityTax: 0.1 }), 25600);
  assert.equal(manufacturingJobTax({ blueprintPrice: 44032, runs: 3, facilityTax: 0.01 }), 1321); // 1320.96
  assert.equal(manufacturingJobTax({ blueprintPrice: 256000, runs: 1, facilityTax: 0 }), 0);
  // Of the base rounded: 1.5 is 2, and 2 x 0.3 is 0.6, which is 1; of 1.5 as it is it would be 0.45, and nought.
  assert.equal(manufacturingJobTax({ blueprintPrice: 1.5, runs: 1, facilityTax: 0.3 }), 1);
  // A facility that says no tax of its own, and what is no number: none is reckoned.
  for (const missing of [{ facilityTax: null }, { facilityTax: undefined }, { facilityTax: "0.1" }, { blueprintPrice: null }, { blueprintPrice: -1 }, { runs: 0 }, { runs: 1.5 }]) {
    assert.equal(manufacturingJobTax({ blueprintPrice: 256000, runs: 1, facilityTax: 0.1, ...missing }), null, JSON.stringify(missing));
  }
});

const fee = (overrides = {}) => manufacturingJobFee({ blueprintPrice: 256000, runs: 1, cost: 10240, tax: 0, sccTaxModifier: 1, security: 0.9, ...overrides });

test("what a job costs to start is its cost, its tax, the SCC's surcharge and, in a safe system, a security tax", () => {
  // The Rifter at the Jita station: 10240 and a surcharge of 256000 x 0.04.
  assert.deepEqual(fee(), { cost: 10240, tax: 0, sccSurcharge: 10240, securityTax: 0, total: 20480 });
  assert.deepEqual(fee({ tax: 25600 }), { cost: 10240, tax: 25600, sccSurcharge: 10240, securityTax: 0, total: 46080 });
  // The surcharge goes by the facility's modifier of it, and is never below nought.
  assert.deepEqual([fee({ sccTaxModifier: 0.5 }).sccSurcharge, fee({ sccTaxModifier: 0 }).sccSurcharge, fee({ sccTaxModifier: -1 }).sccSurcharge], [5120, 0, 0]);
  // A security of 0.95 and over is a safe system's: 5% of the base. Under it, none.
  assert.deepEqual([fee({ security: 0.95 }).securityTax, fee({ security: 1 }).securityTax, fee({ security: 0.9499 }).securityTax, fee({ security: 0 }).securityTax, fee({ security: -0.4 }).securityTax], [12800, 12800, 0, 0, 0]);
  assert.deepEqual(fee({ security: 1, tax: 25600 }), { cost: 10240, tax: 25600, sccSurcharge: 10240, securityTax: 12800, total: 58880 });
  // Each is of the base rounded, with the runs in it: 150.5 x 3 runs is 451.5, which is 452; 452 x 0.04 is 18.08, and 452 x 0.05 is 22.6.
  assert.deepEqual(manufacturingJobFee({ blueprintPrice: 150.5, runs: 3, cost: 18, tax: 0, sccTaxModifier: 1, security: 1 }), { cost: 18, tax: 0, sccSurcharge: 18, securityTax: 23, total: 59 });
  // The rounding of the base shows where a rate's half falls on a whole base: 9.6 is 10, and 10 x 0.05 is a half, which
  // is 1, for the security tax and for a surcharge at a modifier of 1.25; of 9.6 as it is each would be 0.48, and nought.
  assert.deepEqual(manufacturingJobFee({ blueprintPrice: 9.6, runs: 1, cost: 0, tax: 0, sccTaxModifier: 1.25, security: 1 }), { cost: 0, tax: 0, sccSurcharge: 1, securityTax: 1, total: 2 });
  // A cost of nought is a cost (a blueprint whose own multiplier is nought): the surcharge is all there is.
  assert.deepEqual(fee({ cost: 0 }), { cost: 0, tax: 0, sccSurcharge: 10240, securityTax: 0, total: 10240 });
});

test("no fee is said of a guess: one part that is no whole amount, or one input that is no number, and there is none", () => {
  for (const missing of [
    { cost: null }, { cost: 10240.5 }, { cost: -1 }, { tax: null }, { tax: 1.5 }, { tax: -1 },
    { sccTaxModifier: null }, { sccTaxModifier: "1" }, { security: null }, { security: undefined }, { security: "0.9" },
    { blueprintPrice: null }, { blueprintPrice: -1 }, { runs: 0 },
  ]) {
    assert.equal(fee(missing), null, JSON.stringify(missing));
  }
});

test("a facility's row says the SCC's modifier of its surcharge and its system", () => {
  const row = keyVal([["facilityID", 60003760], ["tax", 0.1], ["sccTaxModifier", 0.5], ["solarSystemID", 30000142]]);
  assert.deepEqual(facilityCharges(row), { sccTaxModifier: 0.5, solarSystemID: 30000142 });
  assert.deepEqual(facilityCharges(keyVal([["tax", 0], ["sccTaxModifier", 1], ["solarSystemID", 30000142]])), { sccTaxModifier: 1, solarSystemID: 30000142 });
  assert.deepEqual(facilityCharges(keyVal([["sccTaxModifier", "1"], ["solarSystemID", 0]])), { sccTaxModifier: null, solarSystemID: null });
  assert.deepEqual(facilityCharges(null), { sccTaxModifier: null, solarSystemID: null });
});

test("a job's tax rate is the facility's own, or by the access of the service the job is done by", () => {
  // industry/activity.py activity_tax (50 to 58). A station's row says a tax; the service is not looked at.
  const station = keyVal([["facilityID", 60003760], ["tax", 0.1], ["serviceAccess", dict([])]]);
  assert.deepEqual([facilityTaxRate(station, 22), facilityTaxRate(station, null)], [0.1, 0.1]);
  // A tax of nought is a tax, and is not looked past to the services.
  assert.equal(facilityTaxRate(keyVal([["tax", 0], ["serviceAccess", dict([[22, 0.5]])]]), 22), 0);
  // A structure's row says None, and its services' access says each service's: the one the job is done by, and
  // nought where the access says nothing for it, or says None.
  const structure = keyVal([["facilityID", 1030000000002], ["tax", null], ["serviceAccess", dict([[22, 0.0325], [23, 0.05], [24, null], [31, 0]])]]);
  assert.deepEqual([22, 23, 24, 31, 33].map((serviceID) => facilityTaxRate(structure, serviceID)), [0.0325, 0.05, 0, 0, 0]);
  // The access is found by the service's number, as a dict finds it: under a key that is its text there is nothing for it.
  assert.equal(facilityTaxRate(keyVal([["tax", null], ["serviceAccess", dict([["22", 0.5]])]]), 22), 0);
  // With no service known there is no rate to say; nor with one that is no whole number.
  for (const serviceID of [null, undefined, 22.5, "22"]) assert.equal(facilityTaxRate(structure, serviceID), null, String(serviceID));
  // And none of a guess: no row; a row with no tax said at all; None with no access, or with an access that is no
  // dict; a tax that is no number; an access that is none.
  for (const row of [
    null,
    keyVal([["serviceAccess", dict([[22, 0.1]])]]),
    keyVal([["tax", null]]),
    keyVal([["tax", null], ["serviceAccess", null]]),
    keyVal([["tax", null], ["serviceAccess", [22, 0.1]]]),
    keyVal([["tax", "0.1"], ["serviceAccess", dict([[22, 0.1]])]]),
    keyVal([["tax", null], ["serviceAccess", dict([[22, "0.1"]])]]),
  ]) {
    assert.equal(facilityTaxRate(row, 22), null, JSON.stringify(row).slice(0, 120));
  }
});

test("a structure manufactures by one of three services, by the group of what is made", () => {
  // structures/services.py GetServiceID (149 to 158): the supercapital ships' groups, the capital ships', and the rest.
  assert.deepEqual([659, 30].map(manufacturingServiceID), [24, 24]);
  assert.deepEqual([1538, 547, 5120, 485, 883, 4594].map(manufacturingServiceID), [23, 23, 23, 23, 23, 23]);
  // A frigate, a freighter, a jump freighter, a mineral: the basic one.
  assert.deepEqual([25, 513, 902, 18].map(manufacturingServiceID), [22, 22, 22, 22]);
  // A group that is none has no service.
  for (const group of [null, undefined, 0, -1, 25.5, "25", NaN]) assert.equal(manufacturingServiceID(group), null, String(group));
});
