"use strict";

// A pilot in space: its ballpark, kept as the retail client keeps one.
//
// The client's `michelle` service makes a ballpark when the session is in a
// solar system and the view is of space, and lets it go when it is not
// (michelle.py UpdateBallpark, AddBallpark, RemoveBallpark):
//
//   AddBallpark(solarsystemID)
//     Park(...)                          and with it, on a thread of its own,
//       InitializeRemoteBallpark         eveMoniker.GetBallPark(solarsystemID).Bind(),
//                                        up to ten tries a second apart
//     sm.RemoteSvc('beyonce').GetFormations()
//     __bp.Start()                       the park begins to tick
//
// A ticking park is called every frame with the client's sim clock, and steps
// once for each second of that clock gone by (Park.onTick). So it steps once a
// second, and more slowly when the server has slowed the pilot's clock
// (pilotClock.js). Its first frame is the next one after Start, before the
// bind below has been answered.
//
// The server answers the bind with the ballpark's state (DoDestinyUpdate), and
// from then on sends what changes. Nothing else passes between the two about
// where things are: the park steps itself (destiny/park.js).
//
// One bound object serves the whole park. Everything the client asks of the
// ballpark (CmdGotoDirection, CmdWarpToStuff, CmdDock, UpdateStateRequest) goes
// to it, through michelle.GetRemotePark().
//
// When the client is told its sim clock has been rebased (DoSimClockRebase,
// with the old reading and the new) michelle moves the park's own times by the
// difference (michelle.DoSimClockRebase, Ballpark::AdjustTimes). eve.js sends
// that as a notice when a pilot enters space and when time dilation changes.
//
// Not here: the formations GetFormations answers with (they feed the FORMATION
// mode, which is not ported).

const { Ballpark } = require("./destiny/ballpark");
const { Park } = require("./destiny/park");
const { SimClock } = require("./simClock");

/** InitializeRemoteBallpark: tries, and the wait between them. */
const BIND_TRIES = 10;
const BIND_RETRY_MS = 1000;
/** How often the park is shown the clock. The client does it every frame it draws; a park needs it only often enough to step on time. */
const FRAME_MS = 50;
/** blue counts in 100 ns; the park's clock in milliseconds. */
const BLUE_TICKS_PER_MS = 10_000n;

/** The two readings of a DoSimClockRebase, as a difference in milliseconds; null if they are not two whole numbers. */
function rebaseDelta(times) {
  const pair = Array.isArray(times) ? times : times && Array.isArray(times.items) ? times.items : null;
  if (!pair || pair.length !== 2) return null;
  try {
    const [from, to] = pair.map((value) => BigInt(value));
    return Number(to - from) / Number(BLUE_TICKS_PER_MS);
  } catch {
    return null;
  }
}

/**
 * `session` is the pilot's game-port session. `simTime()` reads the pilot's
 * sim clock, in milliseconds (pilotClock.js); left out, the park has a clock
 * of its own that runs with the real one. `onError(error, what)` is told of
 * anything that goes wrong in the park's own time (a tick, an update, the
 * bind), since nobody is waiting on those.
 */
function createPilotSpace({
  session,
  solarSystemID,
  frameMs = FRAME_MS,
  simTime = null,
  startTicking = (tick, ms) => setInterval(tick, ms),
  stopTicking = (timer) => clearInterval(timer),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onError = () => {},
  onPost = null,
} = {}) {
  let timer = null;
  let released = false;
  let remotePark = null;
  let formations = null;
  let bound = null;
  const park = new Park({
    ballpark: new Ballpark({ onPost }),
    // Park.RequestReset: the park has lost its place and asks for the whole state again.
    requestState: () => {
      if (remotePark === null) return; // not bound yet, or let go
      Promise.resolve(session.callBound(remotePark, "UpdateStateRequest", [])).catch((error) => onError(error, "UpdateStateRequest"));
    },
  });
  // An entry the park could not apply is not thrown: the park goes on to the next, as the client does. It is still worth knowing.
  park.onFail = (name, error) => onError(error ?? new Error("the entry could not be applied"), `entry ${name}`);
  const ownClock = simTime === null ? new SimClock(Date.now()) : null;
  const readClock = simTime ?? (() => ownClock.frame(Date.now()));
  /** One frame: the park is shown the clock, and steps if a second of it has gone by. */
  const frame = () => guard("tick", () => park.onTick(readClock()));
  const guard = (what, action) => {
    try {
      action();
    } catch (error) {
      onError(error, what);
    }
  };

  async function bind() {
    for (let tries = BIND_TRIES; tries > 0 && !released; tries -= 1) {
      try {
        remotePark = (await session.bind("beyonce", solarSystemID)).objectID;
        return remotePark;
      } catch (error) {
        onError(error, "bind");
        if (tries > 1) await sleep(BIND_RETRY_MS);
      }
    }
    return null;
  }

  /** Michelle.AddBallpark. Resolves once the park is ticking and the remote ballpark is bound, or cannot be. */
  function start() {
    bound ??= (async () => {
      try {
        formations = await session.call("beyonce", "GetFormations", []);
      } catch (error) {
        onError(error, "GetFormations");
      }
      if (released) return null;
      timer = startTicking(frame, frameMs);
      frame();
      return bind();
    })();
    return bound;
  }

  /** A notification from the session. True when it was the ballpark's. */
  function feed(notification) {
    if (released) return false;
    if (notification.method === "DoDestinyUpdate") {
      guard("DoDestinyUpdate", () => park.doDestinyUpdate(notification.args[0], notification.args[1], notification.args[2]));
      return true;
    }
    if (notification.method === "DoDestinyUpdates") {
      guard("DoDestinyUpdates", () => park.doDestinyUpdates(notification.args[0]));
      return true;
    }
    if (notification.method === "DoSimClockRebase") {
      const delta = rebaseDelta(Array.isArray(notification.args) ? notification.args[0] : null);
      if (delta !== null) park.adjustTimes(delta);
      return true;
    }
    return false;
  }

  /** Michelle.RemoveBallpark: the park stops, and its remote ballpark is let go. */
  function release() {
    if (released) return;
    released = true;
    if (timer !== null) stopTicking(timer);
    timer = null;
    remotePark = null;
  }

  return {
    solarSystemID,
    park,
    /** The reading of the clock the park is stepped by, in milliseconds: what a ball is drawn at (Ballpark.drawn). */
    simTime: readClock,
    start,
    feed,
    release,
    /** The bound remote ballpark's "N=...", once it is bound; null if it could not be. */
    remote: () => start(),
    get remotePark() {
      return remotePark;
    },
    get formations() {
      return formations;
    },
    get released() {
      return released;
    },
  };
}

module.exports = { BIND_TRIES, FRAME_MS, createPilotSpace, rebaseDelta };
