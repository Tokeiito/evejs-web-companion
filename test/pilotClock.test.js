"use strict";

// A pilot's sim clock and the server's notice that sets its pace (src/gamePort/pilotClock.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const { HANDLER_INSTALLED, createPilotClock, handlerInstalled } = require("../src/gamePort/pilotClock");
const { KNOWN_HANDSHAKE_FUNCTIONS } = require("../src/gamePort/session");
const { notifications } = require("./helpers/destinyRecording");
const undock = require("./fixtures/destinyUndock.json");

const T0 = 1_791_000_000_000;
/** What the session answers the login function it knows with. */
const ANSWER = [...KNOWN_HANDSHAKE_FUNCTIONS.values()][0];
const notice = (...args) => ({ method: "OnSetTimeDilation", args });

function clockAt(options = {}) {
  const state = { now: T0 };
  const pilot = createPilotClock({ now: () => state.now, ...options });
  return { state, pilot, clock: pilot.clock };
}

test("the handler is in place when the session answered as the client does once it is", () => {
  assert.equal(HANDLER_INSTALLED, "TIDI_HANDLER:OK");
  assert.equal(handlerInstalled(ANSWER), true, "the function the session knows installs it");
  assert.deepEqual(["", null, undefined, "TIDI_HANDLER:FAILED", "NOT_TIDI_HANDLER:OK", "PORTRAIT_UPLOAD_HANDLER:OK\n"].map(handlerInstalled), [false, false, false, false, false, false]);
  assert.equal(handlerInstalled("SOMETHING:OK\nTIDI_HANDLER:OK\n"), true);
});

test("a pilot whose session was not given the handler keeps the real clock, and the notice goes unheard", () => {
  for (const options of [{}, { handshakeAnswer: "" }, { handshakeAnswer: "PORTRAIT_UPLOAD_HANDLER:OK\n" }]) {
    const { state, pilot, clock } = clockAt(options);
    assert.deepEqual([clock.locked, clock.dynamic], [true, false]);
    assert.equal(pilot.feed(notice(0.5, 0.5, 0)), false);
    state.now = T0 + 60_000;
    assert.deepEqual([pilot.simTime(), pilot.timeDilation, clock.maxSimDilation, clock.minSimDilation], [T0 + 60_000, 1, 1, 0.1]);
  }
});

test("a pilot whose session was given the handler has a free clock, from the login on", () => {
  const made = clockAt({ handshakeAnswer: ANSWER });
  assert.deepEqual([made.clock.locked, made.clock.dynamic], [false, true]);
  // Made before the login, as a pilot's is: free once the login function has been answered.
  const { state, pilot, clock } = clockAt();
  state.now = T0 + 400;
  pilot.loggedIn("");
  assert.equal(clock.dynamic, false);
  pilot.loggedIn(ANSWER);
  assert.deepEqual([clock.locked, clock.dynamic, clock.simTime], [false, true, T0 + 400]);
  state.now = T0 + 9_000;
  assert.equal(pilot.simTime(), T0 + 9_000);
  // Told again, nothing more happens.
  pilot.loggedIn(ANSWER);
  assert.equal(pilot.simTime(), T0 + 9_000);
});

test("the server's notice sets the clock's bounds, and the clock is at that pace two seconds later", () => {
  const { state, pilot, clock } = clockAt({ handshakeAnswer: ANSWER });
  state.now = T0 + 1_000;
  // As eve.js sends it when a pilot enters space with no time dilation: nothing to change.
  const sent = notifications(undock).find((notification) => notification.method === "OnSetTimeDilation");
  assert.deepEqual(sent.args, [1, 1, 100000000]);
  assert.equal(pilot.feed(sent), true);
  assert.deepEqual([clock.maxSimDilation, clock.minSimDilation, clock.dilationOverloadThreshold, clock.dilationOverloadAdjustment, clock.dilationUnderloadAdjustment, clock.pending], [1, 1, 10_000, 0.8254, 1000, []]);
  // Half pace: the clock judges it at once, and what a pilot is shown changes when the pace does.
  state.now = T0 + 5_000;
  assert.equal(pilot.feed(notice(0.5, 0.5, 0)), true);
  assert.deepEqual([clock.maxSimDilation, clock.minSimDilation, clock.dilationOverloadThreshold, clock.dilationOverloadAdjustment, clock.dilationUnderloadAdjustment], [0.5, 0.5, 0, 0.1, 1.059254]);
  assert.deepEqual(clock.pending, [{ factor: 0.5, realTime: T0 + 7_000, simTime: T0 + 7_000 }]);
  assert.equal(pilot.timeDilation, 1);
  state.now = T0 + 7_000;
  assert.equal(pilot.timeDilation, 1);
  state.now = T0 + 17_000;
  assert.deepEqual([pilot.timeDilation, pilot.simTime()], [0.5, T0 + 12_000]);
  // Lifted.
  assert.equal(pilot.feed(notice(1.0, 1.0, 100000000)), true);
  state.now = T0 + 19_001;
  assert.deepEqual([pilot.timeDilation, pilot.simTime(), clock.dilationUnderloadAdjustment], [1, T0 + 13_001, 1000]);
});

test("a notice that is not three numbers, or not this notice, changes nothing", () => {
  const { state, pilot, clock } = clockAt({ handshakeAnswer: ANSWER });
  // The handler takes three arguments and makes numbers of them; given anything else, the client's Python throws and its clock is as it was.
  for (const bad of [notice(), notice(0.5), notice(0.5, 0.5), notice(0.5, 0.5, 0, 0), notice("fast", 0.5, 0), notice(0.5, 0.5, null), notice(0.5, NaN, 0), { method: "OnSetTimeDilation", args: null }, { method: "DoSimClockRebase", args: [0.5, 0.5, 0] }]) {
    assert.equal(pilot.feed(bad), false, JSON.stringify(bad));
  }
  state.now = T0 + 30_000;
  assert.deepEqual([clock.maxSimDilation, clock.minSimDilation, clock.pending, pilot.simTime(), pilot.timeDilation], [1, 0.1, [], T0 + 30_000, 1]);
  // Whole numbers arrive as numbers or as longs.
  assert.equal(pilot.feed(notice(1, 1, 100000000n)), true);
  assert.deepEqual([clock.dilationOverloadThreshold, clock.dilationUnderloadAdjustment], [10_000, 1000]);
  // Each bound is its own, and a threshold is in blue's ticks, cut to a whole number as the handler cuts it.
  assert.equal(pilot.feed(notice(0.75, 0.25, 25_000.9)), true);
  assert.deepEqual([clock.maxSimDilation, clock.minSimDilation, clock.dilationOverloadThreshold, clock.dilationOverloadAdjustment], [0.75, 0.25, 2.5, 0.1]);
  // One tick short of the lifting threshold is not lifting.
  assert.equal(pilot.feed(notice(1, 1, 99_999_999)), true);
  assert.deepEqual([clock.dilationOverloadAdjustment, clock.dilationUnderloadAdjustment], [0.1, 1.059254]);
  assert.equal(pilot.feed(notice(1, 1, 100_000_000.7)), true);
  assert.deepEqual([clock.dilationOverloadAdjustment, clock.dilationUnderloadAdjustment], [0.8254, 1000]);
});
