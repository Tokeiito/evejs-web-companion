"use strict";

// The guests of the structure a pilot is docked in, as the client's structure guests service keeps them
// (src/gamePort/pilotStructureGuests.js; eve/client/script/ui/services/structure/structureGuests.py): asked for
// once for a structure, and from then on changed by the server's word of each pilot who enters or leaves.
//
// Tranquility's recordings: GetGuests(structureID) answered a dict of one, the character to (corporationID, None,
// None); OnCharacterEnteredStructure came with (characterID, corporationID, None, None), and
// OnCharacterLeftStructure with (characterID,). The numbers here are made up.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPilotStructureGuests } = require("../src/gamePort/pilotStructureGuests");

const COMPLEX = 1030000000001;
const CITADEL = 1030000000002;
const dict = (...entries) => ({ type: "dict", entries });
const notice = (method, ...args) => ({ method, args });
const entered = (...args) => notice("OnCharacterEnteredStructure", ...args);
const left = (...args) => notice("OnCharacterLeftStructure", ...args);

test("the guests are had for the structure they were asked of, and for no other", () => {
  const guests = createPilotStructureGuests();
  // With nothing received, nothing is had: not for a structure, and not for a pilot in none.
  assert.deepEqual([guests.known(COMPLEX), guests.known(null), guests.read()], [false, false, dict()]);
  guests.received(COMPLEX, dict([140000001, [1000044, null, null]], [140000003, [98000000, 99000001, 500001]]));
  assert.deepEqual([guests.known(COMPLEX), guests.known(CITADEL), guests.known(null)], [true, false, false]);
  assert.deepEqual(guests.read(), dict([140000001, [1000044, null, null]], [140000003, [98000000, 99000001, 500001]]));
  // Asked again for another structure, what was had is gone.
  guests.received(CITADEL, dict([140000004, [1000044, null, null]]));
  assert.deepEqual([guests.known(COMPLEX), guests.known(CITADEL), guests.read()], [false, true, dict([140000004, [1000044, null, null]])]);
  // What is read is a dict of its own, of rows of their own: changing either changes nothing kept.
  guests.read().entries.push([1, [2, 3, 4]]);
  guests.read().entries[0][1][0] = 5;
  assert.deepEqual(guests.read(), dict([140000004, [1000044, null, null]]));
});

test("a pilot who enters is set with what the notice said of it, and one who leaves is taken out", () => {
  const guests = createPilotStructureGuests();
  guests.received(COMPLEX, dict([140000001, [1000044, null, null]]));
  assert.equal(guests.feed(entered(140000003, 98000000, 99000001, 500001)), true);
  assert.deepEqual(guests.read(), dict([140000001, [1000044, null, null]], [140000003, [98000000, 99000001, 500001]]));
  // structureGuests.py 37: one who is there already is set again, with what this notice says.
  assert.equal(guests.feed(entered(140000003, 98000009, null, null)), true);
  assert.deepEqual(guests.read().entries[1], [140000003, [98000009, null, null]]);
  assert.equal(guests.feed(left(140000001)), true);
  assert.deepEqual(guests.read(), dict([140000003, [98000009, null, null]]));
  // One who was not there leaves nothing changed (pop with a default, 41).
  assert.equal(guests.feed(left(140000009)), false);
  // A character's ID as the wire has a big one, in the answer and in a notice.
  guests.received(COMPLEX, dict([2112000001n, { type: "tuple", items: [98000001, null, null] }]));
  assert.deepEqual(guests.read(), dict([2112000001, [98000001, null, null]]));
  assert.equal(guests.feed(left(2112000001n)), true);
  assert.equal(guests.feed(entered(2112000002n, 98000001, null, null)), true);
  assert.deepEqual(guests.read(), dict([2112000002, [98000001, null, null]]));
});

test("a notice that is neither, that names nobody, or that has not what its handler takes, changes nothing", () => {
  const guests = createPilotStructureGuests();
  guests.received(COMPLEX, dict([140000001, [1000044, null, null]]));
  for (const other of [
    notice("OnCharNowInStation", [140000003, 98000000, null, null]), notice("OnCharNoLongerInStation", [140000001, 1000044, null, null]),
    // The handler takes the character and its three (36), and the leaving the character alone (40).
    entered(), entered(140000003), entered(140000003, 98000000, null), entered(140000003, 98000000, null, null, 5),
    entered(0, 98000000, null, null), entered(null, 98000000, null, null), entered("140000003", 98000000, null, null),
    left(), left(null), left(0), left(140000001, 1000044), left([140000001]),
    { method: "OnCharacterEnteredStructure" }, { method: "OnCharacterLeftStructure", args: null }, null, undefined,
  ]) {
    assert.equal(guests.feed(other), false, JSON.stringify(other, (key, value) => (typeof value === "bigint" ? String(value) : value)));
  }
  assert.deepEqual(guests.read(), dict([140000001, [1000044, null, null]]));
});

test("with no guests had, a notice changes nothing: the next asking is answered who is there", () => {
  const guests = createPilotStructureGuests();
  assert.equal(guests.feed(entered(140000003, 98000000, null, null)), false);
  assert.deepEqual([guests.known(COMPLEX), guests.read()], [false, dict()]);
  guests.received(COMPLEX, dict([140000001, [1000044, null, null]]));
  assert.deepEqual(guests.read(), dict([140000001, [1000044, null, null]]));
});

test("entries of the answer that name nobody are left out, and an answer that is no dict is no guests", () => {
  const guests = createPilotStructureGuests();
  guests.received(COMPLEX, dict([140000001, [1000044, null, null]], [0, [1, 2, 3]], [null, [1, 2, 3]], ["x", [1, 2, 3]], [140000003, [98000000, null, null]]));
  assert.deepEqual(guests.read(), dict([140000001, [1000044, null, null]], [140000003, [98000000, null, null]]));
  // A guest's three as they came, whatever they are: the page reads them.
  guests.received(COMPLEX, dict([140000001, null], [140000003, [98000000]]));
  assert.deepEqual(guests.read(), dict([140000001, []], [140000003, [98000000]]));
  for (const none of [null, undefined, [], { type: "list", items: [[140000001, 1, 2, 3]] }, { type: "dict" }]) {
    guests.received(COMPLEX, none);
    assert.deepEqual([guests.known(COMPLEX), guests.read()], [true, dict()], JSON.stringify(none));
  }
});

test("out of the structure, everything had of it is let go", () => {
  const guests = createPilotStructureGuests();
  guests.received(COMPLEX, dict([140000001, [1000044, null, null]]));
  guests.left();
  assert.deepEqual([guests.known(COMPLEX), guests.read()], [false, dict()]);
  // And a notice after changes nothing.
  assert.equal(guests.feed(entered(140000003, 98000000, null, null)), false);
  assert.deepEqual(guests.read(), dict());
});
