"use strict";

// The pilot's own ship as dogma has it (src/gamePort/pilotDogma.js): the part
// of the retail client's godma that the ship's panel reads.
//
// The bytes are a real server's (test/fixtures/dogmaFlight.json, made by
// scripts/record-dogma.js): GetAllInfo docked and in space, an afterburner run
// for twelve seconds, GetAllInfo again. The last answer is the server's own
// account of the capacitor after all that, which is what ours is held up to.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ATTRIBUTE, CHARGED, DGM_TAU_CONSTANT, chargeValue, createPilotDogma, filetimeNow } = require("../src/gamePort/pilotDogma");
const flight = require("./fixtures/dogmaFlight.json");
const { answers, notifications } = require("./helpers/destinyRecording");

const SHIP = flight.shipID;
const PILOT = flight.characterID;
const MS = BigInt(DGM_TAU_CONSTANT);
/** The three GetAllInfo answers of the recording, by the step they were asked in. */
const allInfo = (during) => answers(flight).find((answer) => answer.during === during && answer.value && answer.value.type === "object").value;
/** A change as it arrives inside OnModuleAttributeChanges. */
const change = (itemID, attributeID, time, newValue, { owner = PILOT, old = null, stamp = time } = {}) => ["OnModuleAttributeChange", owner, itemID, attributeID, time, newValue, old, stamp];
const changes = (...list) => ({ method: "OnModuleAttributeChanges", args: [{ type: "list", items: list }] });
/** A dogma holding one ship: 100 GJ of capacitor that takes 500 s to recharge, 200 shield, at time T0. */
const T0 = 134359220000000000n;
function small({ charge = 100, capacity = 100, rechargeRate = 500000, now = () => T0 } = {}) {
  const dogma = createPilotDogma({ characterID: PILOT, now });
  const keyVal = (entries) => ({ type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: entries.map(([name, value]) => [Buffer.from(name), value]) } });
  const attributes = { type: "dict", entries: [[ATTRIBUTE.CHARGE, charge], [ATTRIBUTE.CAPACITOR_CAPACITY, capacity], [ATTRIBUTE.RECHARGE_RATE, rechargeRate], [ATTRIBUTE.SHIELD_CAPACITY, 200], [ATTRIBUTE.SHIELD_CHARGE, 200], [ATTRIBUTE.SHIELD_RECHARGE_RATE, 800000], [ATTRIBUTE.ARMOR_HP, 300], [ATTRIBUTE.HP, 400], [4, 1e6]] };
  dogma.loadAllInfo(keyVal([["shipInfo", { type: "dict", entries: [[5001n, keyVal([["itemID", 5001n], ["time", T0], ["attributes", attributes]])]] }]]));
  return dogma;
}
const seconds = (n) => T0 + BigInt(Math.round(n * 1000)) * MS;

test("a recharging attribute, by godma's formula", () => {
  // Empty, capacity 100, tau 1000 ms: after one tau it is (1 - 1/e)^2 of full.
  assert.ok(Math.abs(chargeValue(0, T0, 1000, 100, T0 + 1000n * MS) - 100 * (1 - 1 / Math.E) ** 2) < 1e-12);
  // No time passed: what it was. Full stays full. Asked about a time before the reading: what it was.
  assert.ok(Math.abs(chargeValue(37, T0, 1000, 100, T0) - 37) < 1e-12);
  assert.equal(chargeValue(100, T0, 1000, 100, T0 + 999999n * MS), 100);
  assert.equal(chargeValue(37, T0, 1000, 100, T0 - 5000n * MS), chargeValue(37, T0, 1000, 100, T0));
  // It only ever climbs towards its capacity, and nothing can be had of no capacity.
  const at = (ms) => chargeValue(25, T0, 1000, 100, T0 + BigInt(ms) * MS);
  assert.ok(at(100) > 25 && at(1000) > at(100) && at(100000) > 99.999 && at(100000) <= 100);
  assert.equal(chargeValue(5, T0, 1000, 0, T0 + 1000n * MS), 0);
  assert.equal(chargeValue(-3, T0, 1000, 100, T0), 0, "a charge below nothing is none");
  assert.deepEqual([...CHARGED], [[ATTRIBUTE.CHARGE, [ATTRIBUTE.RECHARGE_RATE, ATTRIBUTE.CAPACITOR_CAPACITY]], [ATTRIBUTE.SHIELD_CHARGE, [ATTRIBUTE.SHIELD_RECHARGE_RATE, ATTRIBUTE.SHIELD_CAPACITY]]]);
});

test("the clock is the server's: 100 ns since 1601", () => {
  assert.equal(filetimeNow(0), 116444736000000000n);
  assert.equal(filetimeNow(1791446717607), 134359203176070000n);
});

test("GetAllInfo from a real server: the ship and its module are held, and the ship's numbers are the gateway's", () => {
  const dogma = createPilotDogma({ characterID: PILOT });
  assert.equal(dogma.shipReadings(SHIP), null, "nothing until it is loaded");
  const held = dogma.loadAllInfo(allInfo("GetAllInfo docked"));
  assert.deepEqual(held, [SHIP, flight.moduleID]);
  assert.deepEqual([dogma.has(SHIP), dogma.has(flight.moduleID), dogma.has(1)], [true, true, false]);
  assert.deepEqual([ATTRIBUTE.HP, ATTRIBUTE.ARMOR_HP, ATTRIBUTE.SHIELD_CAPACITY, ATTRIBUTE.CAPACITOR_CAPACITY, ATTRIBUTE.RECHARGE_RATE, ATTRIBUTE.SHIELD_RECHARGE_RATE, ATTRIBUTE.DAMAGE, ATTRIBUTE.ARMOR_DAMAGE].map((id) => dogma.attribute(SHIP, id)),
    [150, 150, 175, 125, 62500, 730000, 0, 0]);
  // What the gateway's snapshot said of the same ship: capacitor 1, capacities 175, 150, 150.
  assert.deepEqual(dogma.shipReadings(SHIP), { capacitorRatio: 1, shieldCapacity: 175, armorCapacity: 150, hullCapacity: 150 });
  assert.deepEqual([dogma.attribute(SHIP, ATTRIBUTE.CHARGE), dogma.attribute(SHIP, ATTRIBUTE.SHIELD_CHARGE)], [125, 175]);
  assert.equal(dogma.attribute(SHIP, 999999), null);
  dogma.clear();
  assert.deepEqual([dogma.has(SHIP), dogma.shipReadings(SHIP), dogma.attribute(SHIP, ATTRIBUTE.CHARGE)], [false, null, null]);
});

test("what is loaded is true at the time the server gave for it, and replaces what was held", () => {
  // Loaded 100 s ago by the server's clock at 40 of 100: read now, it has been recharging since then.
  const dogma = small({ charge: 40, now: () => seconds(100) });
  const expected = chargeValue(40, T0, 500000 / 5, 100, seconds(100));
  assert.equal(dogma.attribute(5001, ATTRIBUTE.CHARGE), expected);
  assert.ok(expected > 60, `${expected} of 100 after 100 s`);
  // Loaded again as something with a charge and nothing to recharge it by: the charge is a plain number, and the old recharge is gone.
  const keyVal = (entries) => ({ type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: entries.map(([name, value]) => [Buffer.from(name), value]) } });
  dogma.loadAllInfo(keyVal([["shipInfo", { type: "dict", entries: [[5001n, keyVal([["itemID", 5001n], ["time", T0], ["attributes", { type: "dict", entries: [[ATTRIBUTE.CHARGE, 7]] }]])]] }]]));
  assert.deepEqual([dogma.attribute(5001, ATTRIBUTE.CHARGE), dogma.attribute(5001, ATTRIBUTE.CAPACITOR_CAPACITY), dogma.shipReadings(5001).capacitorRatio], [7, null, null]);
  dogma.loadAllInfo(keyVal([["shipInfo", { type: "dict", entries: [[5001n, keyVal([["itemID", 5001n], ["time", T0], ["attributes", { type: "dict", entries: [[4, 5]] }]])]] }]]));
  assert.equal(dogma.attribute(5001, ATTRIBUTE.CHARGE), null);
});

test("a real flight with the afterburner running: between the server's own reports, godma's recharge lands on the next one", () => {
  // The server reports the capacitor about twice a second while it changes.
  // From each report the client works out the charge for itself until the
  // next; so each next report is a check on that working, by the server.
  let clockNow = 0n;
  const dogma = createPilotDogma({ characterID: PILOT, now: () => clockNow });
  const loaded = answers(flight).find((answer) => answer.during === "GetAllInfo in space" && answer.value && answer.value.type === "object");
  const last = answers(flight).find((answer) => answer.during === "GetAllInfo after" && answer.value && answer.value.type === "object");
  dogma.loadAllInfo(loaded.value);
  const reports = [];
  for (const notification of notifications(flight)) {
    // Only what had arrived when the server was asked for the last time.
    if (notification.atMs < loaded.atMs || notification.atMs > last.atMs) continue;
    const mine = (notification.method === "OnModuleAttributeChanges" ? notification.args[0].items : [])
      .filter((each) => Number(each[2]) === SHIP && Number(each[3]) === ATTRIBUTE.CHARGE);
    for (const each of mine) {
      clockNow = each[4];
      reports.push({ time: each[4], reported: each[5], previous: each[6], predicted: dogma.attribute(SHIP, ATTRIBUTE.CHARGE, each[4]) });
    }
    dogma.feed(notification);
  }
  assert.ok(reports.length >= 30, `${reports.length} reports of the capacitor`);
  // Two of them are the afterburner's cycles starting: five units gone at once.
  const drains = reports.filter((report) => report.reported < report.predicted - 1);
  assert.deepEqual(drains.map((report) => Math.round(report.predicted - report.reported)), [5, 5]);
  // The report straight after each is the server's own first step from the new value, and is not on the curve.
  const settling = new Set(drains.map((drain) => reports[reports.indexOf(drain) + 1]));
  const recharging = reports.filter((report) => !drains.includes(report) && !settling.has(report) && report !== reports[0]);
  assert.ok(recharging.length >= 26, `${recharging.length} reports while only recharging`);
  for (const report of recharging) {
    // The server rounds what it sends to six places.
    assert.ok(Math.abs(report.predicted - report.reported) < 2e-6, `predicted ${report.predicted}, the server then said ${report.reported}`);
  }
  for (const report of settling) assert.ok(Math.abs(report.predicted - report.reported) < 0.1);
  // The capacitor fell and had not simply come back to full.
  assert.ok(Math.min(...reports.map((report) => report.reported)) < 118);

  // The server's last GetAllInfo repeats its last report, under a later time: ours for that time has recharged a little further.
  const after = flight.capacitor.after;
  assert.deepEqual([after.capacity, after.rechargeRate, after.charge], [125, 62500, reports.at(-1).reported]);
  const ours = dogma.attribute(SHIP, ATTRIBUTE.CHARGE, BigInt(after.time));
  assert.ok(ours > after.charge && ours - after.charge < 0.1, `ours ${ours}, the server's ${after.charge}`);
  // What the live run worked out at the time is what the replay works out.
  assert.ok(Math.abs(ours - flight.capacitor.oursThen.chargeAtServersTime) < 1e-9);
  assert.ok(Math.abs(dogma.shipReadings(SHIP, BigInt(after.time)).capacitorRatio - ours / 125) < 1e-12);
});

test("a change is applied as godma applies one", () => {
  const dogma = small();
  // The charge is set, and recharges from the change's own moment.
  assert.equal(dogma.feed(changes(change(5001n, ATTRIBUTE.CHARGE, seconds(10), 40, { old: 100 }))), true);
  assert.ok(Math.abs(dogma.attribute(5001, ATTRIBUTE.CHARGE, seconds(10)) - 40) < 1e-12);
  const expected = chargeValue(40, seconds(10), 500000 / 5, 100, seconds(30));
  assert.equal(dogma.attribute(5001, ATTRIBUTE.CHARGE, seconds(30)), expected);
  assert.ok(expected > 44 && expected < 50, `${expected} after twenty seconds`);
  // A plain attribute simply takes the value.
  dogma.feed(changes(change(5001n, 4, seconds(11), 2e6)));
  assert.equal(dogma.attribute(5001, 4), 2e6);
  // An item that was never loaded is not made up from a change.
  assert.equal(dogma.applyAttributeChange(7777, 4, seconds(11), 5), false);
  assert.equal(dogma.has(7777), false);
  // The same value again changes nothing (and does not restart a recharge).
  assert.equal(dogma.applyAttributeChange(5001, 4, seconds(12), 2e6), false);
});

test("a change that is someone else's, stale, or for a loaded charge is not taken", () => {
  const dogma = small();
  dogma.feed(changes(change(5001n, 4, seconds(1), 7, { owner: 140000099 })));
  assert.equal(dogma.attribute(5001, 4), 1e6, "another character's item");
  dogma.feed(changes(change(5001n, 4, seconds(5), 8, { stamp: seconds(5) }), change(5001n, 4, seconds(4), 9, { stamp: seconds(4) })));
  assert.equal(dogma.attribute(5001, 4), 8, "an older change arriving after a newer one is dropped");
  dogma.feed(changes(change([5001n, 27, 2488], 805, seconds(6), 3)));
  assert.equal(dogma.has(5001), true);
  // One change that cannot be read does not lose the ones after it.
  dogma.feed(changes(null, change(5001n, 4, seconds(7), 11)));
  assert.equal(dogma.attribute(5001, 4), 11);
  // The single form of the notification.
  assert.equal(dogma.feed({ method: "OnModuleAttributeChange", args: [PILOT, 5001n, 4, seconds(8), 12, 11, seconds(8)] }), true);
  assert.equal(dogma.attribute(5001, 4), 12);
  assert.equal(dogma.feed({ method: "OnItemsChanged", args: [] }), false);
});

test("when the capacity or the recharge time changes, the charge carries on from what it is", () => {
  // A full capacitor stays full when the capacity grows, and none is ever over a smaller one.
  const full = small({ now: () => seconds(50) });
  full.feed(changes(change(5001n, ATTRIBUTE.CAPACITOR_CAPACITY, seconds(50), 150)));
  assert.equal(full.attribute(5001, ATTRIBUTE.CHARGE, seconds(50)), 150);
  full.feed(changes(change(5001n, ATTRIBUTE.CAPACITOR_CAPACITY, seconds(50), 60)));
  assert.equal(full.attribute(5001, ATTRIBUTE.CHARGE, seconds(50)), 60);
  // A part-full one above a smaller capacity is brought down to it.
  const over = small({ charge: 80, now: () => T0 });
  over.feed(changes(change(5001n, ATTRIBUTE.CAPACITOR_CAPACITY, T0, 50)));
  assert.equal(over.attribute(5001, ATTRIBUTE.CHARGE, T0), 50);
  // A part-full one keeps its charge and recharges towards the new capacity.
  const part = small({ charge: 40, now: () => T0 });
  part.feed(changes(change(5001n, ATTRIBUTE.CAPACITOR_CAPACITY, T0, 200)));
  assert.ok(Math.abs(part.attribute(5001, ATTRIBUTE.CHARGE, T0) - 40) < 1e-9);
  assert.ok(part.attribute(5001, ATTRIBUTE.CHARGE, seconds(100000)) > 199.9);
  // A new recharge time: from what the charge is now, at the new rate.
  const slow = small({ charge: 40, now: () => seconds(20) });
  const before = slow.attribute(5001, ATTRIBUTE.CHARGE, seconds(20));
  slow.feed(changes(change(5001n, ATTRIBUTE.RECHARGE_RATE, seconds(20), 5000000)));
  assert.ok(Math.abs(slow.attribute(5001, ATTRIBUTE.CHARGE, seconds(20)) - before) < 1e-9);
  assert.equal(slow.attribute(5001, ATTRIBUTE.CHARGE, seconds(40)), chargeValue(before, seconds(20), 5000000 / 5, 100, seconds(40)));
  // The shield is the other one that recharges; the readings are fractions and capacities.
  assert.deepEqual(small().shipReadings(5001), { capacitorRatio: 1, shieldCapacity: 200, armorCapacity: 300, hullCapacity: 400 });
  assert.ok(Math.abs(small({ charge: 25 }).shipReadings(5001, T0).capacitorRatio - 0.25) < 1e-12);
});

test("OnMultiEvent: a moment at a time in order, and within one the last change for an attribute is the one that counts", () => {
  const dogma = small();
  const events = {
    type: "list",
    items: [
      // The later moment first: it is still applied second.
      [change(5001n, 4, seconds(9), 30), seconds(9)],
      [change(5001n, 4, seconds(3), 10), seconds(3)],
      [change(5001n, 4, seconds(2), 20), seconds(3)],
      [["OnGodmaShipEffect", 5002n, 6731, seconds(3), 1, 1], seconds(3)],
      [change(5001n, ATTRIBUTE.CHARGE, seconds(3), 50), seconds(3)],
    ],
  };
  assert.equal(dogma.feed({ method: "OnMultiEvent", args: [events] }), true);
  assert.equal(dogma.attribute(5001, 4), 30);
  assert.ok(Math.abs(dogma.attribute(5001, ATTRIBUTE.CHARGE, seconds(3)) - 50) < 1e-9);
  // Within one moment: of 10 (at 3 s) and 20 (at 2 s), the one with the later time wins.
  const one = small();
  one.multiEvent([[change(5001n, 4, seconds(3), 10), seconds(3)], [change(5001n, 4, seconds(2), 20), seconds(3)]]);
  assert.equal(one.attribute(5001, 4), 10);
  one.multiEvent([null, [change(5001n, 4, seconds(4), 44), seconds(4)]]);
  assert.equal(one.attribute(5001, 4), 44);
  // Moments are taken in their own order whatever order they arrive in, even when the changes carry no time of their own to be judged stale by.
  const bare = (attributeID, time, value) => ["OnModuleAttributeChange", PILOT, 5001n, attributeID, time, value, null];
  const ordered = small();
  ordered.multiEvent([[bare(4, seconds(9), 90), seconds(9)], [bare(4, seconds(3), 30), seconds(3)]]);
  assert.equal(ordered.attribute(5001, 4), 90);
});
