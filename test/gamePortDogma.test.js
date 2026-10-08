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
const { ATTRIBUTE, CHARGED, DGM_TAU_CONSTANT, EFFECT_CATEGORY, EFFECT_ONLINE, chargeValue, createPilotDogma, filetimeNow } = require("../src/gamePort/pilotDogma");
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
  assert.deepEqual(dogma.shipReadings(SHIP), {
    capacitorRatio: 1, shieldRatio: 1, armorRatio: 1, hullRatio: 1, shieldCapacity: 175, armorCapacity: 150, hullCapacity: 150,
    activeModuleIDs: [], overloadedModuleIDs: [], moduleDamage: {}, weaponBanks: {},
  });
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

test("a change that is someone else's, stale, or for a charge that is not held is not taken", () => {
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
  // What was never said (no armour damage, no hull damage, no ship state) is not known, and is not made up.
  assert.deepEqual(small().shipReadings(5001), {
    capacitorRatio: 1, shieldRatio: 1, armorRatio: null, hullRatio: null, shieldCapacity: 200, armorCapacity: 300, hullCapacity: 400,
    activeModuleIDs: [], overloadedModuleIDs: [], moduleDamage: {}, weaponBanks: null,
  });
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

// ── which modules are running ────────────────────────────────────────────────

/**
 * What kind each effect of a 1MN Civilian Afterburner is, as the game's static
 * data has it (staticData.getEffect): its slot, being online, overloading it,
 * and the afterburner itself. Being online is filed as an activation.
 */
const AFTERBURNER = 6731;
const OVERLOAD_SPEED = 3175;
const KIND = new Map([[13, EFFECT_CATEGORY.PASSIVE], [EFFECT_ONLINE, EFFECT_CATEGORY.ACTIVATION], [OVERLOAD_SPEED, EFFECT_CATEGORY.OVERLOAD], [AFTERBURNER, EFFECT_CATEGORY.ACTIVATION]]);
const effectCategory = (effectID) => KIND.get(effectID) ?? null;
const MODULE = flight.moduleID;

test("a real flight: the afterburner is running from the server's word that it started until its word that it stopped", () => {
  const dogma = createPilotDogma({ characterID: PILOT, effectCategory });
  const loaded = answers(flight).find((answer) => answer.during === "GetAllInfo in space" && answer.value && answer.value.type === "object");
  dogma.loadAllInfo(loaded.value);
  // Fitted and online, which is an active effect, and not running.
  assert.deepEqual([dogma.effect(MODULE, EFFECT_ONLINE).isActive, dogma.effect(MODULE, AFTERBURNER)], [true, null]);
  assert.deepEqual([dogma.shipReadings(SHIP).activeModuleIDs, dogma.shipReadings(SHIP).overloadedModuleIDs], [[], []]);

  const seen = [];
  for (const notification of notifications(flight)) {
    if (notification.atMs < loaded.atMs) continue;
    const taken = dogma.feed(notification);
    if (notification.method === "OnGodmaShipEffect") {
      assert.equal(taken, true);
      seen.push({ during: notification.during, running: dogma.shipReadings(SHIP).activeModuleIDs, effect: { ...dogma.effect(MODULE, AFTERBURNER) } });
    }
  }
  // Two cycles begin, each said by the server; then the stop, at the end of the cycle that was running when it was asked for.
  assert.deepEqual(seen.map((each) => each.running), [[MODULE], [MODULE], []]);
  assert.deepEqual(seen.map((each) => [each.effect.isActive, each.effect.duration, each.effect.repeat, each.effect.targetID]), [[true, 10000, 1000, null], [true, 10000, 1000, null], [false, 10000, 0, null]]);
  // The second cycle began ten seconds after the first, to the tick of the server's clock.
  assert.equal(seen[1].effect.startTime - seen[0].effect.startTime, 10000n * MS);
  assert.deepEqual(seen.map((each) => each.during), ["module running", "module running", "dock"]);
});

test("GetAllInfo taken while a module is running says so by itself", () => {
  const dogma = createPilotDogma({ characterID: PILOT, effectCategory });
  dogma.loadAllInfo(allInfo("GetAllInfo after"));
  const effect = dogma.effect(MODULE, AFTERBURNER);
  assert.deepEqual([effect.isActive, effect.duration, effect.repeat], [true, 10000, 1000]);
  assert.deepEqual(dogma.shipReadings(SHIP).activeModuleIDs, [MODULE]);
  // Without the static data to say what kind an effect is, nothing can be called running.
  const blind = createPilotDogma({ characterID: PILOT });
  blind.loadAllInfo(allInfo("GetAllInfo after"));
  assert.deepEqual(blind.shipReadings(SHIP).activeModuleIDs, []);
  dogma.clear();
  assert.equal(dogma.effect(MODULE, AFTERBURNER), null);
});

/** A dogma holding a ship (5001) and two modules (5003, 5002), nothing running. */
function fitted() {
  const dogma = createPilotDogma({ characterID: PILOT, effectCategory, now: () => T0 });
  const keyVal = (entries) => ({ type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: entries.map(([name, value]) => [Buffer.from(name), value]) } });
  const online = (itemID) => [EFFECT_ONLINE, [itemID, PILOT, 5001n, null, null, [], EFFECT_ONLINE, T0, -1, 1]];
  const row = (itemID, activeEffects) => [itemID, keyVal([["itemID", itemID], ["time", T0], ["attributes", { type: "dict", entries: [[4, 1]] }], ["activeEffects", { type: "dict", entries: activeEffects }]])];
  dogma.loadAllInfo(keyVal([["shipInfo", { type: "dict", entries: [row(5001n, []), row(5003n, [online(5003n)]), row(5002n, [online(5002n)])] }]]));
  return dogma;
}
const effectEvent = (itemID, effectID, time, active, { target = null, repeat = 1000 } = {}) => [itemID, effectID, time, active, active, [itemID, PILOT, 5001n, target, null, [], effectID, null], time, 5000, active ? repeat : false, null];
const shipEffect = (...args) => ({ method: "OnGodmaShipEffect", args: effectEvent(...args) });

test("running and overloaded are told apart by the kind of effect, and listed in order", () => {
  const dogma = fitted();
  const of = () => [dogma.shipReadings(5001).activeModuleIDs, dogma.shipReadings(5001).overloadedModuleIDs];
  assert.deepEqual(of(), [[], []]);
  dogma.feed(shipEffect(5003n, AFTERBURNER, seconds(1), 1, { target: 9000000000001n }));
  dogma.feed(shipEffect(5002n, AFTERBURNER, seconds(2), 1));
  assert.deepEqual(of(), [[5002, 5003], []]);
  assert.equal(dogma.effect(5003, AFTERBURNER).targetID, 9000000000001n);
  // Overloading a module is an effect of its own kind: the module is overloaded, and that alone does not make it running.
  dogma.feed(shipEffect(5002n, OVERLOAD_SPEED, seconds(3), 1));
  dogma.feed(shipEffect(5002n, AFTERBURNER, seconds(4), 0));
  assert.deepEqual(of(), [[5003], [5002]]);
  // A passive effect, and an effect of a kind the static data does not know, are neither.
  dogma.feed(shipEffect(5003n, 13, seconds(5), 1));
  dogma.feed(shipEffect(5003n, 424242, seconds(5), 1));
  dogma.feed(shipEffect(5003n, AFTERBURNER, seconds(6), 0));
  assert.deepEqual(of(), [[], [5002]]);
  // The ship itself is not one of its modules, and an item that is not held is not made up.
  dogma.feed(shipEffect(5001n, AFTERBURNER, seconds(7), 1));
  assert.equal(dogma.feed(shipEffect(7777n, AFTERBURNER, seconds(7), 1)), true);
  assert.deepEqual([of(), dogma.effect(7777, AFTERBURNER)], [[[], [5002]], null]);
});

test("OnMultiEvent: of the starts and stops of one effect in one moment, the last one is what stands", () => {
  const dogma = fitted();
  const event = (...args) => ["OnGodmaShipEffect", ...effectEvent(...args)];
  // Stop (at 3 s) and start (at 2 s) in one moment, out of order: the stop is the later.
  dogma.multiEvent([[event(5003n, AFTERBURNER, seconds(3), 0), seconds(3)], [event(5003n, AFTERBURNER, seconds(2), 1), seconds(3)], [event(5002n, AFTERBURNER, seconds(2), 1), seconds(3)]]);
  assert.deepEqual(dogma.shipReadings(5001).activeModuleIDs, [5002]);
  assert.equal(dogma.feed({ method: "OnMultiEvent", args: [{ type: "list", items: [[event(5003n, AFTERBURNER, seconds(4), 1), seconds(4)]] }] }), true);
  assert.deepEqual(dogma.shipReadings(5001).activeModuleIDs, [5002, 5003]);
  // Two different effects on one module in one moment are two things, and both stand.
  const both = fitted();
  both.multiEvent([[event(5002n, AFTERBURNER, seconds(2), 1), seconds(2)], [event(5002n, OVERLOAD_SPEED, seconds(2), 1), seconds(2)]]);
  assert.deepEqual([both.shipReadings(5001).activeModuleIDs, both.shipReadings(5001).overloadedModuleIDs], [[5002], [5002]]);
});

test("an active effect that cannot be read is passed over, and the rest of the item is still loaded", () => {
  const dogma = createPilotDogma({ characterID: PILOT, effectCategory, now: () => T0 });
  const keyVal = (entries) => ({ type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: entries.map(([name, value]) => [Buffer.from(name), value]) } });
  const good = [5002n, PILOT, 5001n, null, null, [], AFTERBURNER, T0, 5000, 1000];
  dogma.loadAllInfo(keyVal([["shipInfo", { type: "dict", entries: [
    [5001n, keyVal([["itemID", 5001n], ["time", T0], ["attributes", { type: "dict", entries: [[4, 1]] }]])],
    [5002n, keyVal([["itemID", 5002n], ["time", T0], ["attributes", { type: "dict", entries: [[4, 1]] }], ["activeEffects", { type: "dict", entries: [[OVERLOAD_SPEED, null], [AFTERBURNER, good]] }]])],
  ] }]]));
  assert.deepEqual([dogma.has(5002), dogma.effect(5002, OVERLOAD_SPEED), dogma.shipReadings(5001).activeModuleIDs], [true, null, [5002]]);
});

// ── the ship's health, its modules' damage and its weapon banks ──────────────
//
// The ship's panel reads its own health from godma (activeShipController.py):
// shieldCharge / shieldCapacity, (armorHP - armorDamage) / armorHP,
// (hp - damage) / hp. A module's damage is its damage over its hp. The banks
// are the third part of the ship's state in GetAllInfo.

const HEALTH_T = 134359220000000000n;
const row7 = (fields) => ({ type: "packedrow", fields });
const kv = (fields) => ({ type: "object", name: Buffer.from("util.KeyVal"), args: { type: "dict", entries: Object.entries(fields).map(([name, value]) => [Buffer.from(name), value]) } });
const attrs = (pairs) => ({ type: "dict", entries: pairs });
const shipRow = (shipID, pairs) => [BigInt(shipID), kv({ itemID: BigInt(shipID), invItem: row7({ itemID: shipID, typeID: 588, locationID: 30000142, flagID: 0, groupID: 237, categoryID: 6 }), time: HEALTH_T, attributes: attrs(pairs), activeEffects: attrs([]) })];
const fittedModule = (itemID, { damage = 0, hp = 40, categoryID = 7, locationID = 5001, flagID = 27 } = {}) =>
  [BigInt(itemID), kv({ itemID: BigInt(itemID), invItem: row7({ itemID, typeID: 3636, locationID, flagID, groupID: 53, categoryID }), time: HEALTH_T, attributes: attrs([[ATTRIBUTE.DAMAGE, damage], [ATTRIBUTE.HP, hp]]), activeEffects: attrs([]) })];
const HEALTHY = [[ATTRIBUTE.HP, 150], [ATTRIBUTE.DAMAGE, 0], [ATTRIBUTE.ARMOR_HP, 150], [ATTRIBUTE.ARMOR_DAMAGE, 0], [ATTRIBUTE.SHIELD_CAPACITY, 175], [ATTRIBUTE.SHIELD_CHARGE, 175], [ATTRIBUTE.SHIELD_RECHARGE_RATE, 730000], [ATTRIBUTE.CAPACITOR_CAPACITY, 125], [ATTRIBUTE.CHARGE, 125], [ATTRIBUTE.RECHARGE_RATE, 62500]];
const withAttributes = (changes) => HEALTHY.map(([id, value]) => [id, id in changes ? changes[id] : value]);
function loaded(rows, { shipState, activeShipID = 5001n } = {}) {
  const dogma = createPilotDogma({ characterID: PILOT, now: () => HEALTH_T });
  const fields = { shipInfo: attrs(rows) };
  if (shipState !== undefined) Object.assign(fields, { shipState, activeShipID });
  dogma.loadAllInfo(kv(fields));
  return dogma;
}
const bankState = (banks) => [attrs([]), attrs([]), attrs(Object.entries(banks).map(([master, slaves]) => [BigInt(master), { type: "list", items: slaves.map(BigInt) }])), attrs([])];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("the ship's health is what is left of each of its three, as godma has them", () => {
  const readings = (changes) => loaded([shipRow(5001, withAttributes(changes))]).shipReadings(5001);
  assert.deepEqual([readings({}).shieldRatio, readings({}).armorRatio, readings({}).hullRatio], [1, 1, 1]);
  // Armour 52.5 down of 150, hull 30 down of 150: 0.65 and 0.8.
  const hurt = readings({ [ATTRIBUTE.ARMOR_DAMAGE]: 52.5, [ATTRIBUTE.DAMAGE]: 30 });
  near(hurt.armorRatio, 0.65);
  near(hurt.hullRatio, 0.8);
  // The shield recharges by itself: read at the moment it was true, it is what was said.
  near(readings({ [ATTRIBUTE.SHIELD_CHARGE]: 70 }).shieldRatio, 0.4);
  const later = loaded([shipRow(5001, withAttributes({ [ATTRIBUTE.SHIELD_CHARGE]: 70 }))]).shipReadings(5001, HEALTH_T + 600n * 10000000n);
  assert.ok(later.shieldRatio > 0.4 && later.shieldRatio <= 1, "and ten minutes on it has climbed");
  // More damage than there is to damage is none left, not less than none; and damage below nothing is whole.
  assert.deepEqual([readings({ [ATTRIBUTE.ARMOR_DAMAGE]: 500 }).armorRatio, readings({ [ATTRIBUTE.DAMAGE]: 500 }).hullRatio], [0, 0]);
  assert.deepEqual([readings({ [ATTRIBUTE.ARMOR_DAMAGE]: -5 }).armorRatio, readings({ [ATTRIBUTE.DAMAGE]: -5 }).hullRatio], [1, 1]);
  // Nothing to be a fraction of: not known.
  assert.deepEqual([readings({ [ATTRIBUTE.ARMOR_HP]: 0 }).armorRatio, readings({ [ATTRIBUTE.HP]: 0 }).hullRatio, readings({ [ATTRIBUTE.SHIELD_CAPACITY]: 0 }).shieldRatio], [null, null, null]);
});

test("the ship's health follows the server's changes", () => {
  const dogma = loaded([shipRow(5001, HEALTHY)]);
  const stamp = HEALTH_T + 10000000n;
  dogma.feed(changes(change(5001n, ATTRIBUTE.ARMOR_DAMAGE, stamp, 75, { stamp }), change(5001n, ATTRIBUTE.DAMAGE, stamp, 15, { stamp })));
  const now = dogma.shipReadings(5001, stamp);
  near(now.armorRatio, 0.5);
  near(now.hullRatio, 0.9);
});

test("each fitted module's damage is its damage over its hp, and only the damaged ones are named", () => {
  const dogma = loaded([
    shipRow(5001, withAttributes({ [ATTRIBUTE.DAMAGE]: 30 })),
    fittedModule(101, { damage: 7.2 }),
    fittedModule(102),
    fittedModule(103, { damage: 40 }),
    fittedModule(104, { damage: 55 }),
    // Not modules of this ship: a charge at a slot's flag, a module in another ship, a module with no hp.
    fittedModule(105, { damage: 5, categoryID: 8 }),
    fittedModule(106, { damage: 5, locationID: 6001 }),
    fittedModule(107, { damage: 5, hp: 0 }),
  ]);
  // The ship's own hull damage is not a module's; burnt out is 1, and so is more than that.
  assert.deepEqual(dogma.shipReadings(5001).moduleDamage, { 101: 0.18, 103: 1, 104: 1 });
  // Heat does more, and a repair undoes it.
  const stamp = HEALTH_T + 10000000n;
  dogma.feed(changes(change(102n, ATTRIBUTE.DAMAGE, stamp, 10, { stamp }), change(101n, ATTRIBUTE.DAMAGE, stamp, 0, { stamp })));
  assert.deepEqual(dogma.shipReadings(5001).moduleDamage, { 102: 0.25, 103: 1, 104: 1 });
  assert.deepEqual(loaded([shipRow(5001, HEALTHY), fittedModule(101)]).shipReadings(5001).moduleDamage, {});
});

test("the weapon banks are the third part of the active ship's state, and null when no state came", () => {
  const dogma = loaded([shipRow(5001, HEALTHY)], { shipState: bankState({ 102: [103, 101, 102], 200: [201] }) });
  // Slaves in order, and a master is not its own slave.
  assert.deepEqual(dogma.weaponBanks(5001), { 102: [101, 103], 200: [201] });
  assert.deepEqual(dogma.shipReadings(5001).weaponBanks, { 102: [101, 103], 200: [201] });
  assert.equal(dogma.weaponBanks(6001), null, "another ship's are not known");
  // A state with no banks is no banks, which is not the same as not knowing.
  assert.deepEqual(loaded([shipRow(5001, HEALTHY)], { shipState: bankState({}) }).weaponBanks(5001), {});
  assert.equal(loaded([shipRow(5001, HEALTHY)]).weaponBanks(5001), null);
  // The banks go to the ship the answer names as the active one.
  assert.deepEqual(loaded([shipRow(5001, HEALTHY)], { shipState: bankState({ 102: [103] }), activeShipID: 6001n }).weaponBanks(5001), null);
  // A state that is not the four parts, or names no active ship, is no state.
  assert.equal(loaded([shipRow(5001, HEALTHY)], { shipState: [attrs([]), attrs([])] }).weaponBanks(5001), null);
  const unnamed = loaded([shipRow(5001, HEALTHY)], { shipState: bankState({ 102: [103] }), activeShipID: null });
  assert.deepEqual([unnamed.weaponBanks(5001), unnamed.weaponBanks(null)], [null, null], "and is kept under no ship at all");
  dogma.clear();
  assert.equal(dogma.weaponBanks(5001), null);
});

test("the banks change by the server's word, and by the answers to the client's own grouping calls", () => {
  const dogma = loaded([shipRow(5001, HEALTHY)], { shipState: bankState({ 102: [103] }) });
  // OnWeaponBanksChanged: the whole set, anew.
  assert.equal(dogma.feed({ method: "OnWeaponBanksChanged", args: [5001n, attrs([[104n, { type: "list", items: [105n, 106n] }]])] }), true);
  assert.deepEqual(dogma.weaponBanks(5001), { 104: [105, 106] });
  // As a tuple of slaves, and for a ship not seen before.
  dogma.feed({ method: "OnWeaponBanksChanged", args: [6001n, attrs([[1n, [2n]]])] });
  assert.deepEqual([dogma.weaponBanks(6001), dogma.weaponBanks(5001)], [{ 1: [2] }, { 104: [105, 106] }]);
  // OnWeaponGroupDestroyed: that master's bank is gone.
  assert.equal(dogma.feed({ method: "OnWeaponGroupDestroyed", args: [5001n, 104n] }), true);
  assert.deepEqual(dogma.weaponBanks(5001), {});
  dogma.feed({ method: "OnWeaponGroupDestroyed", args: [7001n, 1n] });
  dogma.feed({ method: "OnWeaponGroupDestroyed" });
  dogma.feed({ method: "OnWeaponBanksChanged" });
  assert.deepEqual(dogma.weaponBanks(6001), { 1: [2] });
  // The client's own: the answer to a link is the banks; an unlink takes one slave out, and an empty bank is gone.
  dogma.setWeaponBanks(5001n, attrs([[102n, { type: "list", items: [103n, 104n] }]]));
  assert.deepEqual(dogma.weaponBanks(5001), { 102: [103, 104] });
  dogma.unlinkModule(5001n, 102n, 104n);
  assert.deepEqual(dogma.weaponBanks(5001), { 102: [103] });
  dogma.unlinkModule(5001n, 999n, 103n);
  dogma.unlinkModule(7001n, 102n, 103n);
  assert.deepEqual(dogma.weaponBanks(5001), { 102: [103] });
  dogma.unlinkModule(5001n, 102n, 103n);
  assert.deepEqual(dogma.weaponBanks(5001), {});
  dogma.setWeaponBanks(5001n, attrs([[102n, [103n]]]));
  dogma.setWeaponBanks(5001n, null);
  assert.deepEqual(dogma.weaponBanks(5001), {}, "no banks is none, and known");
});

// ── a real damaged ship ──────────────────────────────────────────────────────
//
// test/fixtures/dogmaDamaged.json (scripts/record-dogma.js): a Reaper given
// the GM's medium test damage while docked, with two guns grouped, undocked.
// The server tells a client of that ship's health twice over: in GetAllInfo,
// as dogma attributes, and in the ballpark, as a damage state. The two have to
// agree, or the ship's own panel and everyone else's view of it differ.

const damaged = require("./fixtures/dogmaDamaged.json");
const damagedInfo = (during) => answers(damaged).find((answer) => answer.during === during && answer.value && answer.value.type === "object").value;
/** The damage state the ballpark was sent for a ship: ((shield, tau, when), armour, hull), wherever it is in the updates. */
function damageStateOf(recording, shipID) {
  const wanted = BigInt(shipID);
  let found = null;
  const walk = (node, depth) => {
    if (found || depth > 12 || node === null || typeof node !== "object" || Buffer.isBuffer(node)) return;
    if (node.type === "dict" && Array.isArray(node.entries)) {
      for (const [name, value] of node.entries) {
        if ((name === wanted || name === Number(wanted)) && Array.isArray(value) && Array.isArray(value[0])) found = value;
        else walk(value, depth + 1);
      }
      return;
    }
    for (const value of Array.isArray(node) ? node : Object.values(node)) walk(value, depth + 1);
  };
  for (const notification of notifications(recording)) if (notification.method === "DoDestinyUpdate") walk(notification.args, 0);
  return found;
}

test("a real damaged ship: godma's health is the health the server's own ballpark gives for it", () => {
  const dogma = createPilotDogma({ characterID: damaged.characterID });
  dogma.loadAllInfo(damagedInfo("GetAllInfo in space"));
  const state = damageStateOf(damaged, damaged.shipID);
  assert.ok(state, "the recording has the ship's damage state");
  const [[shield], armour, hull] = state;
  assert.deepEqual([shield, armour, hull], [1, 0.65, 0.8], "the GM's medium damage");
  const time = BigInt(new Map(damagedInfo("GetAllInfo in space").args.entries.map(([name, value]) => [name.toString(), value])).get("shipInfo").entries[0][1].args.entries.find(([name]) => name.toString() === "time")[1]);
  const readings = dogma.shipReadings(damaged.shipID, time);
  assert.ok(Math.abs(readings.shieldRatio - shield) < 1e-6, `shield ${readings.shieldRatio}`);
  assert.ok(Math.abs(readings.armorRatio - armour) < 1e-6, `armour ${readings.armorRatio}`);
  assert.ok(Math.abs(readings.hullRatio - hull) < 1e-6, `hull ${readings.hullRatio}`);
});

test("a real damaged ship: each fitted module's damage, and the two guns in one bank", () => {
  const dogma = createPilotDogma({ characterID: damaged.characterID });
  dogma.loadAllInfo(damagedInfo("GetAllInfo in space"));
  const readings = dogma.shipReadings(damaged.shipID);
  // Three fitted modules, each 7.2 down of 40: what the web gateway's own snapshot said of them, 0.18.
  const modules = Object.keys(readings.moduleDamage).map(Number).sort((a, b) => a - b);
  assert.equal(modules.length, 3);
  for (const moduleID of modules) assert.ok(Math.abs(readings.moduleDamage[moduleID] - 0.18) < 1e-9, `${moduleID}: ${readings.moduleDamage[moduleID]}`);
  assert.ok(modules.includes(damaged.moduleID));
  // The bank the server answered LinkWeapons with when the two were grouped: the master, and its one slave.
  const banks = Object.entries(readings.weaponBanks);
  assert.equal(banks.length, 1);
  const [master, slaves] = banks[0];
  assert.equal(slaves.length, 1);
  assert.ok(modules.includes(Number(master)) && modules.includes(slaves[0]) && Number(master) !== slaves[0]);
  // Docked, the same ship says the same of its modules and its bank.
  const docked = createPilotDogma({ characterID: damaged.characterID });
  docked.loadAllInfo(damagedInfo("GetAllInfo docked"));
  assert.deepEqual(docked.shipReadings(damaged.shipID).weaponBanks, readings.weaponBanks);
  assert.deepEqual(Object.keys(docked.shipReadings(damaged.shipID).moduleDamage).map(Number).sort((a, b) => a - b), modules);
});
