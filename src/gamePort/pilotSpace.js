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
//     __bp.Start()                       the park begins to tick, once a second
//
// The server answers the bind with the ballpark's state (DoDestinyUpdate), and
// from then on sends what changes. Nothing else passes between the two about
// where things are: the park steps itself (destiny/park.js).
//
// One bound object serves the whole park. Everything the client asks of the
// ballpark (CmdGotoDirection, CmdWarpToStuff, CmdDock, UpdateStateRequest) goes
// to it, through michelle.GetRemotePark().
//
// Not here: the formations GetFormations answers with (they feed the FORMATION
// mode, which is not ported), and the park's seconds following the server's
// clock when it is slowed (DoSimClockRebase, OnSetTimeDilation).

const { Ballpark } = require("./destiny/ballpark");
const { Park } = require("./destiny/park");

/** InitializeRemoteBallpark: tries, and the wait between them. */
const BIND_TRIES = 10;
const BIND_RETRY_MS = 1000;

/**
 * `session` is the pilot's game-port session. `onError(error, what)` is told
 * of anything that goes wrong in the park's own time (a tick, an update, the
 * bind), since nobody is waiting on those.
 */
function createPilotSpace({
  session,
  solarSystemID,
  tickMs = 1000,
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
      timer = startTicking(() => guard("tick", () => park.tick()), tickMs);
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

module.exports = { BIND_TRIES, createPilotSpace };
