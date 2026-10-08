"use strict";

// The sim clock (src/gamePort/simClock.js): CCP's blue, BlueOS.cpp.

const test = require("node:test");
const assert = require("node:assert/strict");
const { DILATION_EVENT_LEAD_MS, SimClock } = require("../src/gamePort/simClock");

const T0 = 1_791_000_000_000;

test("a clock begins locked to the real clock, with blue's own bounds", () => {
  const clock = new SimClock(T0);
  assert.deepEqual(
    [clock.simTime, clock.simDilation, clock.desiredSimDilation, clock.locked, clock.dynamic, clock.minSimDilation, clock.maxSimDilation],
    [T0, 1, 1, true, false, 0.1, 1],
  );
  assert.deepEqual(
    [clock.dilationOverloadThreshold, clock.dilationUnderloadThreshold, clock.dilationOverloadAdjustment, clock.dilationUnderloadAdjustment, DILATION_EVENT_LEAD_MS],
    [10_000, 2_000, 0.8254, 1.059254, 2000],
  );
  assert.equal(clock.frame(T0 + 1234), T0 + 1234);
  // Locked, its bounds mean nothing: it is the real clock.
  clock.maxSimDilation = 0.5;
  clock.minSimDilation = 0.5;
  assert.equal(clock.frame(T0 + 60_000), T0 + 60_000);
  assert.deepEqual([clock.simDilation, clock.pending], [1, []]);
  // A frame at a time already past does not move it.
  assert.equal(clock.frame(T0 + 5), T0 + 60_000);
});

test("freed, a clock inside its bounds runs with the real clock, to the millisecond", () => {
  const clock = new SimClock(T0);
  clock.frame(T0 + 777);
  clock.enableSimDilation(0);
  assert.deepEqual([clock.locked, clock.dynamic, clock.simTime], [false, true, T0 + 777]);
  for (const at of [T0 + 778, T0 + 5_000, T0 + 3_600_000]) assert.equal(clock.frame(at), at);
  assert.deepEqual([clock.simDilation, clock.desiredSimDilation, clock.pending], [1, 1, []]);
});

test("a clock outside its bounds goes to the bound two real seconds on, and counts from there", () => {
  const clock = new SimClock(T0);
  clock.enableSimDilation(0);
  clock.frame(T0 + 10_000);
  clock.maxSimDilation = 0.5;
  clock.minSimDilation = 0.5;
  // The next frame sees it and sets the change two seconds ahead, at the sim time the clock will read then.
  assert.equal(clock.frame(T0 + 10_016), T0 + 10_016);
  assert.deepEqual(clock.pending, [{ factor: 0.5, realTime: T0 + 12_016, simTime: T0 + 12_016 }]);
  // Until then nothing has changed, and nothing new is decided.
  assert.equal(clock.frame(T0 + 11_000), T0 + 11_000);
  assert.deepEqual([clock.simDilation, clock.desiredSimDilation, clock.pending.length], [1, 1, 1]);
  // Not at the moment itself: after it.
  assert.equal(clock.frame(T0 + 12_016), T0 + 12_016);
  assert.equal(clock.simDilation, 1);
  assert.equal(clock.frame(T0 + 12_116), T0 + 12_016 + 50);
  assert.deepEqual([clock.simDilation, clock.desiredSimDilation, clock.pending], [0.5, 0.5, []]);
  // Half pace from there: ten real seconds are five of the clock's.
  assert.equal(clock.frame(T0 + 22_016), T0 + 12_016 + 5_000);
  // Lifted: back to full pace two seconds on, having lost what it lost.
  clock.maxSimDilation = 1;
  clock.minSimDilation = 1;
  clock.frame(T0 + 22_016);
  assert.deepEqual(clock.pending, [{ factor: 1, realTime: T0 + 24_016, simTime: T0 + 12_016 + 6_000 }]);
  assert.equal(clock.frame(T0 + 24_016), T0 + 12_016 + 6_000);
  assert.equal(clock.frame(T0 + 30_016), T0 + 12_016 + 12_000);
  assert.deepEqual([clock.simDilation, clock.desiredSimDilation], [1, 1]);
});

test("outside two bounds that differ, a clock goes to the nearer one", () => {
  const above = new SimClock(T0);
  above.enableSimDilation(0);
  above.minSimDilation = 0.3;
  above.maxSimDilation = 0.6;
  above.frame(T0 + 1);
  assert.deepEqual(above.pending.map((event) => event.factor), [0.6]);
  const below = new SimClock(T0);
  below.enableSimDilation(0);
  below.simDilation = 0.2;
  below.minSimDilation = 0.3;
  below.maxSimDilation = 0.6;
  below.frame(T0 + 1);
  assert.deepEqual(below.pending.map((event) => event.factor), [0.3]);
});

test("a change that came due while nobody looked is taken from its own moment, not from the look", () => {
  const clock = new SimClock(T0);
  clock.enableSimDilation(0);
  clock.maxSimDilation = 0.25;
  clock.minSimDilation = 0.25;
  clock.frame(T0 + 1_000);
  // An hour later: two seconds at full pace, the rest at a quarter.
  assert.equal(clock.frame(T0 + 3_601_000), T0 + 3_000 + (3_601_000 - 3_000) * 0.25);
});

test("above its upper bound a clock comes down to it; a clock that keeps up climbs back by steps", () => {
  const clock = new SimClock(T0);
  clock.enableSimDilation(0);
  clock.maxSimDilation = 0.5;
  clock.minSimDilation = 0.5;
  clock.frame(T0 + 1);
  clock.frame(T0 + 3_000);
  assert.equal(clock.simDilation, 0.5);
  // At its bound, with nowhere to go, nothing is set.
  assert.deepEqual(clock.pending, []);
  // The upper bound lifted, the lower left. Nothing forces it; but it has kept up for more than two seconds
  // since its last change was set, so it eases up by blue's step.
  clock.maxSimDilation = 1;
  clock.frame(T0 + 3_001);
  assert.deepEqual(clock.pending.map((event) => [event.factor, event.realTime]), [[0.5 * 1.059254, T0 + 5_001]]);
  // That change comes two seconds on, by which time two seconds have again gone by: the next is set in the same frame.
  clock.frame(T0 + 5_001);
  assert.equal(clock.simDilation, 0.5);
  clock.frame(T0 + 5_002);
  assert.equal(clock.simDilation, 0.5 * 1.059254);
  assert.deepEqual(clock.pending.map((event) => [event.factor, event.realTime]), [[0.5 * 1.059254 * 1.059254, T0 + 7_002]]);
  // The spell of keeping up is counted from when the last change was set: with five seconds asked for, three more go by first.
  clock.dilationUnderloadThreshold = 5_000;
  clock.frame(T0 + 7_003);
  assert.equal(clock.simDilation, 0.5 * 1.059254 * 1.059254);
  assert.deepEqual(clock.pending, []);
  clock.frame(T0 + 10_002);
  assert.deepEqual(clock.pending, []);
  clock.frame(T0 + 10_003);
  assert.equal(clock.pending[0].factor, 0.5 * 1.059254 * 1.059254 * 1.059254);
  // With a sharp step it is at the top in one.
  const snap = new SimClock(T0);
  snap.enableSimDilation(0);
  snap.simDilation = 0.3;
  snap.dilationUnderloadAdjustment = 1000;
  snap.frame(T0 + 2_001);
  assert.equal(snap.pending[0].factor, 1);
});

test("a clock that falls behind slows by steps, down to its lower bound and no further", () => {
  const clock = new SimClock(T0);
  clock.enableSimDilation(0);
  let behind = true;
  clock.overloaded = () => behind;
  clock.frame(T0 + 10_000);
  assert.deepEqual(clock.pending, [], "ten seconds behind is not yet more than ten");
  clock.frame(T0 + 10_001);
  assert.deepEqual(clock.pending.map((event) => event.factor), [0.8254]);
  clock.frame(T0 + 12_002);
  assert.equal(clock.simDilation, 0.8254);
  // Judged afresh from the change: ten more seconds behind before the next.
  clock.frame(T0 + 20_001);
  assert.deepEqual(clock.pending, []);
  clock.frame(T0 + 20_002);
  assert.equal(clock.pending[0].factor, 0.8254 * 0.8254);
  // At the lower bound there is nowhere to go.
  const floor = new SimClock(T0);
  floor.enableSimDilation(0);
  floor.overloaded = () => true;
  floor.minSimDilation = 0.9;
  floor.frame(T0 + 10_001);
  assert.equal(floor.pending[0].factor, 0.9);
  floor.frame(T0 + 12_002);
  floor.frame(T0 + 60_000);
  assert.deepEqual([floor.simDilation, floor.pending], [0.9, []]);
  // Keeping up again, it climbs: the two are told apart by which was seen last.
  behind = false;
  clock.frame(T0 + 22_003);
  assert.equal(clock.simDilation, 0.8254 * 0.8254);
  assert.deepEqual(clock.pending.map((event) => [event.factor, event.realTime]), [[0.8254 * 0.8254 * 1.059254, T0 + 24_003]]);
  // Behind again before that has come: it comes all the same, and the slowing is judged from the last frame it kept up.
  behind = true;
  clock.frame(T0 + 24_004);
  assert.equal(clock.simDilation, 0.8254 * 0.8254 * 1.059254);
  assert.deepEqual(clock.pending, []);
  clock.frame(T0 + 32_003);
  assert.deepEqual(clock.pending, []);
  clock.frame(T0 + 32_004);
  assert.equal(clock.pending[0].factor, 0.8254 * 0.8254 * 1.059254 * 0.8254);
});

test("freeing a clock can set it on by an offset, once", () => {
  const clock = new SimClock(T0);
  clock.enableSimDilation(5_000);
  assert.equal(clock.frame(T0 + 100), T0 + 5_100);
  clock.enableSimDilation(5_000);
  assert.equal(clock.frame(T0 + 200), T0 + 5_200);
});
