"use strict";

// A pilot's sim clock, and what the server does to it.
//
// The clock itself is the client engine's (simClock.js). What sets its pace on
// an eve.js server is not CCP's: a CCP server slows its clients' clocks over
// its own network layer, which nothing on the game port speaks. eve.js does it
// with the function it sends every client at login, which the client runs
// (session.js, KNOWN_HANDSHAKE_FUNCTIONS). That function
//
//   - calls blue.os.EnableSimDilation(0), so the client's clock sets its own
//     pace between two bounds, and
//   - installs a handler for a notice of eve.js's own,
//     OnSetTimeDilation(max, min, threshold), which sets those bounds
//     (blue.os.maxSimDilation, minSimDilation, dilationOverloadThreshold) and
//     how sharply the pace is eased.
//
// The server sends the notice with both bounds the same, when a pilot enters
// space and whenever a system's time dilation changes. The clock then goes to
// that pace two real seconds later (simClock.js), which is when the server
// changes its own.
//
// We are not a Python interpreter and do not run the function. A pilot whose
// session was sent the function we know, and answered as the client answers
// once the handler is in place, gets a clock that behaves as that client's
// does. Any other pilot's clock stays locked to the real clock, and the notice
// goes unheard, as it would in a client nobody had given a handler.
//
// The other clock notice, DoSimClockRebase, is the park's (pilotSpace.js).

const { SimClock } = require("./simClock");

/** What the client prints once the login function has installed the handler. */
const HANDLER_INSTALLED = "TIDI_HANDLER:OK";
/** blue counts in 100 ns; the clock here in milliseconds. */
const BLUE_TICKS_PER_MS = 10_000;
/**
 * The handler's own numbers (eve.js network/tcp/handshake.js,
 * buildTidiSignedFuncSource, as sent by eve.js 7603a2966). A threshold of
 * exactly this many of blue's ticks is the server lifting time dilation.
 */
const LIFTING_THRESHOLD = 100_000_000;
const EASING = {
  lifting: { overload: 0.8254, underload: 1000.0 },
  slowing: { overload: 0.1, underload: 1.059254 },
};

/** Whether a session's answer to the login function says the handler is in place. */
const handlerInstalled = (handshakeAnswer) => String(handshakeAnswer ?? "").split("\n").includes(HANDLER_INSTALLED);

/**
 * `now()` reads the real clock, in milliseconds. `handshakeAnswer` is what the
 * pilot's session answered the server's login function with, if it already
 * has; otherwise say so with loggedIn() when it does.
 */
function createPilotClock({ now = Date.now, handshakeAnswer = null } = {}) {
  const clock = new SimClock(now());
  let hears = false;

  /** The session has answered the server's login function with `answer`: if that put the handler in place, the function has also freed the clock. */
  function loggedIn(answer) {
    if (hears || !handlerInstalled(answer)) return;
    hears = true;
    clock.frame(now());
    clock.enableSimDilation(0);
  }
  loggedIn(handshakeAnswer);

  /** The sim clock's reading now, in milliseconds. */
  const simTime = () => clock.frame(now());

  /** A notification from the session. True when it was the clock's and was heard. */
  function feed(notification) {
    if (notification.method !== "OnSetTimeDilation" || !hears) return false;
    // def OnSetTimeDilation(self, maxD, minD, thresh): three arguments, each made a number of. Anything else and the client's handler throws.
    const given = Array.isArray(notification.args) ? notification.args : [];
    if (given.length !== 3 || !given.every((value) => typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value)))) return false;
    const [max, min, threshold] = given.map(Number);
    clock.maxSimDilation = max;
    clock.minSimDilation = min;
    clock.dilationOverloadThreshold = Math.trunc(threshold) / BLUE_TICKS_PER_MS;
    const easing = Math.trunc(threshold) === LIFTING_THRESHOLD ? EASING.lifting : EASING.slowing;
    clock.dilationOverloadAdjustment = easing.overload;
    clock.dilationUnderloadAdjustment = easing.underload;
    // The client's next frame is at most a sixtieth of a second on: the clock judges its pace against the new bounds now.
    clock.frame(now());
    return true;
  }

  return {
    clock,
    simTime,
    loggedIn,
    feed,
    /** blue.os.desiredSimDilation: the pace the clock is meant to hold now, which is what the client shows a pilot. */
    get timeDilation() {
      simTime();
      return clock.desiredSimDilation;
    },
  };
}

module.exports = { HANDLER_INSTALLED, createPilotClock, handlerInstalled };
