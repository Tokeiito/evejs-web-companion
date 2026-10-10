"use strict";

// The station a pilot is docked in, as the client's station service keeps it (src/gamePort/pilotStation.js;
// eve/client/script/ui/station/base.py): its guests, asked for once for a station and from then on changed by the
// server's word of each pilot who arrives or leaves; and the station's own item.
//
// A guest is (charID, corpID, allianceID, warFactionID), as GetGuests lists one and as each notice carries one.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createPilotStation } = require("../src/gamePort/pilotStation");

const JITA = 60003760;
const AMARR = 60008494;
const guest = (charID, corpID = 1000044, allianceID = null, warFactionID = null) => [charID, corpID, allianceID, warFactionID];
const notice = (method, ...args) => ({ method, args });

test("the guests are had for the station they were asked of, and for no other", () => {
  const station = createPilotStation();
  // With nothing received, nothing is had: not for a station, and not for a pilot in none.
  assert.deepEqual([station.guestsKnown(JITA), station.guestsKnown(null), station.guestsRead()], [false, false, []]);
  station.guestsReceived(JITA, [guest(140000001), guest(140000003, 98000000, 99000001, 500001)]);
  assert.deepEqual([station.guestsKnown(JITA), station.guestsKnown(AMARR), station.guestsKnown(null)], [true, false, false]);
  assert.deepEqual(station.guestsRead(), [guest(140000001), guest(140000003, 98000000, 99000001, 500001)]);
  // Asked again for another station, what was had is gone.
  station.guestsReceived(AMARR, { type: "list", items: [guest(140000004)] });
  assert.deepEqual([station.guestsKnown(JITA), station.guestsKnown(AMARR), station.guestsRead()], [false, true, [guest(140000004)]]);
  // What is read is a list of its own, of rows of their own: changing either changes nothing kept.
  station.guestsRead().push(guest(1));
  station.guestsRead()[0][1] = 5;
  assert.deepEqual(station.guestsRead(), [guest(140000004)]);
});

test("a pilot who arrives is added once, with what the notice said of it, and one who leaves is taken out", () => {
  const station = createPilotStation();
  station.guestsReceived(JITA, [guest(140000001)]);
  assert.equal(station.feed(notice("OnCharNowInStation", guest(140000003, 98000000, 99000001, 500001))), true);
  assert.deepEqual(station.guestsRead(), [guest(140000001), guest(140000003, 98000000, 99000001, 500001)]);
  // One who is there already is left as it is listed (base.py 88: only where the character is not a guest yet).
  assert.equal(station.feed(notice("OnCharNowInStation", guest(140000003, 1, 2, 3))), false);
  assert.deepEqual(station.guestsRead()[1], guest(140000003, 98000000, 99000001, 500001));
  assert.equal(station.feed(notice("OnCharNoLongerInStation", guest(140000001))), true);
  assert.deepEqual(station.guestsRead(), [guest(140000003, 98000000, 99000001, 500001)]);
  // One who was not there leaves nothing changed.
  assert.equal(station.feed(notice("OnCharNoLongerInStation", guest(140000009))), false);
  // The pilot's own ID as the wire has a big one, and a list as the wire has one.
  assert.equal(station.feed(notice("OnCharNowInStation", { type: "list", items: [2112000001n, 98000001, null, null] })), true);
  assert.equal(station.feed(notice("OnCharNoLongerInStation", [2112000001, 98000001, null, null])), true);
  assert.equal(station.guestsRead().length, 1);
});

test("a notice that is neither, or that names nobody, changes nothing", () => {
  const station = createPilotStation();
  station.guestsReceived(JITA, [guest(140000001)]);
  for (const other of [notice("OnCharNowInSpace", guest(5)), notice("OnCharNowInSpace", guest(140000001)), notice("OnCharNowInStation"), notice("OnCharNowInStation", null), notice("OnCharNowInStation", []), notice("OnCharNowInStation", ["x", 1, 2, 3]), notice("OnCharNoLongerInStation", [0, 1, 2, 3]), { method: "OnCharNowInStation" }, {}]) {
    assert.equal(station.feed(other), false, JSON.stringify(other));
  }
  assert.deepEqual(station.guestsRead(), [guest(140000001)]);
});

test("a pilot who arrives before the guests were ever asked for is kept until they are, and then the answer is the list", () => {
  // base.py 86: OnCharNowInStation adds to the guests whether or not the list was received; GetGuests then clears
  // them and asks, for a station it has no list of.
  const station = createPilotStation();
  assert.equal(station.feed(notice("OnCharNowInStation", guest(140000003))), true);
  assert.deepEqual([station.guestsKnown(JITA), station.guestsRead()], [false, [guest(140000003)]]);
  station.guestsReceived(JITA, [guest(140000001)]);
  assert.deepEqual(station.guestsRead(), [guest(140000001)]);
});

test("rows of the answer that name nobody are left out, and an answer that is no list is no guests", () => {
  const station = createPilotStation();
  station.guestsReceived(JITA, [guest(140000001), null, "x", [], [0, 1, 2, 3], guest(140000003)]);
  assert.deepEqual(station.guestsRead(), [guest(140000001), guest(140000003)]);
  station.guestsReceived(JITA, null);
  assert.deepEqual([station.guestsKnown(JITA), station.guestsRead()], [true, []]);
});

test("the station's own item is had while it is the station the pilot is in, as its second part says", () => {
  // base.py 573 and 586: asked for while there is none, or its itemID is not the session's station.
  const station = createPilotStation();
  assert.deepEqual([station.itemKnown(JITA), station.itemRead()], [false, null]);
  const bits = [1000035, JITA, 26, 1529];
  station.itemReceived(bits);
  assert.deepEqual([station.itemKnown(JITA), station.itemKnown(AMARR), station.itemKnown(null), station.itemRead()], [true, false, false, bits]);
  // As the wire has a tuple, and an answer that is none.
  station.itemReceived({ type: "tuple", items: [1000035, AMARR, 26, 1529] });
  assert.deepEqual([station.itemKnown(AMARR), station.itemKnown(JITA)], [true, false]);
  station.itemReceived(null);
  assert.deepEqual([station.itemKnown(AMARR), station.itemRead()], [false, null]);
});

test("leaving a station, everything had of it is let go", () => {
  const station = createPilotStation();
  station.guestsReceived(JITA, [guest(140000001)]);
  station.itemReceived([1000035, JITA, 26, 1529]);
  station.left();
  assert.deepEqual([station.guestsKnown(JITA), station.guestsRead(), station.itemKnown(JITA), station.itemRead()], [false, [], false, null]);
});
