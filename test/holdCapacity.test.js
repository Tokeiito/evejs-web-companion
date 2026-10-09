"use strict";

// A hold's capacity and what is used of it, worked out as the retail client
// works them out (src/clientData/holdCapacity.js). The numbers are made up.

const test = require("node:test");
const assert = require("node:assert/strict");
const { STATION_CAPACITY, capacityAnswer, itemVolume, packagedVolume, usedVolume } = require("../src/clientData/holdCapacity");

const WRAP = 77099;
const TABLES = { byGroup: new Map([[901, 2500], [902, 10000]]), byType: new Map([[77001, 50000]]), plasticWrapTypeID: WRAP };
// A type's own volume, as the static data has it: 77001 and 77002 are ships of group 901, 77010 a mineral, 77020 has none.
const VOLUMES = { 77001: 180000, 77002: 16500, 77003: 92000, 77010: 0.01, 77030: -1 };
const typeVolume = (typeID) => VOLUMES[typeID] ?? null;
const item = (fields) => ({ itemID: 1, typeID: 77010, groupID: 18, flagID: 5, quantity: 1, stacksize: 1, singleton: 0, ...fields });

test("a packaged thing takes its type's override, else its group's, else the type's own volume", () => {
  assert.equal(packagedVolume(77001, 901, typeVolume, TABLES), 50000);
  assert.equal(packagedVolume(77002, 901, typeVolume, TABLES), 2500);
  assert.equal(packagedVolume(77003, 902, typeVolume, TABLES), 10000);
  assert.equal(packagedVolume(77010, 18, typeVolume, TABLES), 0.01);
  // A type whose volume is not known has none to give.
  assert.equal(packagedVolume(77020, 18, typeVolume, TABLES), null);
});

test("an item's volume: assembled by its type's own, packaged by the override, times the stack", () => {
  // Assembled (a singleton): the type's own volume, whatever the overrides say.
  assert.equal(itemVolume(item({ typeID: 77002, groupID: 901, singleton: 1, quantity: -1, stacksize: 1 }), typeVolume, TABLES), 16500);
  // Packaged: the group's override, for each of the stack.
  assert.equal(itemVolume(item({ typeID: 77002, groupID: 901, quantity: 3, stacksize: 3 }), typeVolume, TABLES), 7500);
  assert.equal(itemVolume(item({ typeID: 77001, groupID: 901, quantity: 2, stacksize: 2 }), typeVolume, TABLES), 100000);
  // A stack of something with no override.
  assert.equal(itemVolume(item({ quantity: 12345, stacksize: 12345 }), typeVolume, TABLES), 123.45);
  // A stack size below nought counts as one.
  assert.equal(itemVolume(item({ typeID: 77003, groupID: 5, singleton: 1, stacksize: -1 }), typeVolume, TABLES), 92000);
  // A volume of -1 is "none", and is not multiplied.
  assert.equal(itemVolume(item({ typeID: 77030, quantity: 40, stacksize: 40 }), typeVolume, TABLES), -1);
  // A plastic wrap, which is always a singleton, has its volume in its quantity: -quantity / 100.
  assert.equal(itemVolume(item({ typeID: WRAP, groupID: 5, singleton: 1, quantity: -123456, stacksize: 1 }), typeVolume, TABLES), 1234.56);
  // A type whose volume nobody knows cannot be summed.
  assert.equal(itemVolume(item({ typeID: 77020, quantity: 5, stacksize: 5 }), typeVolume, TABLES), null);
});

test("what is used of a hold is what its own flag holds, each above nought", () => {
  const rows = [
    item({ itemID: 1, quantity: 1000, stacksize: 1000 }),                                       // 10
    item({ itemID: 2, typeID: 77002, groupID: 901, quantity: 2, stacksize: 2 }),                // 5000
    item({ itemID: 3, typeID: 77002, groupID: 901, singleton: 1, quantity: -1, stacksize: 1 }), // 16500
    item({ itemID: 4, flagID: 87, quantity: 500000, stacksize: 500000 }),                        // another flag: not this hold's
    item({ itemID: 5, typeID: 77030, quantity: 9, stacksize: 9 }),                              // -1: not above nought
  ];
  assert.equal(usedVolume(rows, 5, typeVolume, TABLES), 21510);
  assert.equal(usedVolume(rows, 87, typeVolume, TABLES), 5000);
  assert.equal(usedVolume(rows, 134, typeVolume, TABLES), 0);
  assert.equal(usedVolume([], 5, typeVolume, TABLES), 0);
  // One thing of this flag whose volume is not known, and the sum is not known: never a sum that leaves it out.
  assert.equal(usedVolume([...rows, item({ itemID: 6, typeID: 77020 })], 5, typeVolume, TABLES), null);
  // Of another flag, it does not matter.
  assert.equal(usedVolume([...rows, item({ itemID: 6, typeID: 77020, flagID: 87 })], 5, typeVolume, TABLES), 21510);
});

test("the answer is the Row the client makes: capacity and used, as GetCapacity's answer is read", () => {
  assert.deepEqual(capacityAnswer(3900, 0.1), { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", 3900], ["used", 0.1]] } });
  // invCache.GetCapacity for a station: nine thousand million million, a number that has no end in sight.
  assert.equal(STATION_CAPACITY, 9000000000000000);
});
