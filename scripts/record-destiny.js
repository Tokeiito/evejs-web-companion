"use strict";

// Record what the server sends a client in space.
//
// Logs a docked character in on the game port, undocks it, keeps every frame
// both ways with the time it passed, and docks again. The recording is what
// the ballpark (docs/game-port-transport-plan.md, Phase 4) is built and tested
// against: the real DoDestinyUpdate stream, not a description of one.
//
//   node scripts/record-destiny.js <accountName> <characterID> [seconds] [outputPath] [probeEverySeconds]
//
// With probeEverySeconds, the server is also asked for its whole state again
// every so often while in space (UpdateStateRequest, which is what the client
// sends when it has lost its place). Each answer is the server's own account
// of where everything is, good to about a tick: see scripts/destiny-compare.js
// for why no finer.
//
// The calls are the retail client's, in its order, as a real client's session
// shows them in eve.js's log:
//
//   ship.Undock(shipID, ignoreContraband)      on the ship object bound for the station
//   beyonce.GetFormations()                    michelle.py, on entering space
//   beyonce bound for the solar system         the server answers with the ballpark's state
//   CmdStop()                                  part-way through, so the stream holds a command
//   CmdDock(stationID, shipID)                 movementFunctions.py
//
// ⚠ It UNDOCKS A REAL CHARACTER on the server it is pointed at, and leaves it
// docked where it started if all goes well. If docking does not complete in
// time the character is left in space and the script says so.
//
// Not sent, and the retail client does send it: Undock's `onlineModules`
// keyword (the fitted modules the client believes are online).

const fs = require("node:fs");
const path = require("node:path");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { boundObjectID } = require("../src/gamePort/pilots");
const { eveCommit } = require("./capture-game-frames");

const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "test", "fixtures", "destinyUndock.json");
const GROUP_STATION = 15;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const id = (value) => (value === null || value === undefined ? null : Number(value));

/** A frame transport that keeps every frame through it, with when it passed and what was being done. */
function timedRecorder(inner, frames, step, startedAt = Date.now()) {
  let sent = 0;
  const outer = {
    onFrame: null,
    onClose: null,
    send(payload) {
      sent += 1;
      frames.push({ from: "client", atMs: Date.now() - startedAt, during: step(), hex: payload.toString("hex") });
      inner.send(payload);
    },
    close: () => inner.close(),
  };
  inner.onClose = (error) => outer.onClose && outer.onClose(error);
  inner.onFrame = (payload) => {
    frames.push({ from: "server", atMs: Date.now() - startedAt, during: step(), afterClientFrames: sent, hex: payload.toString("hex") });
    if (outer.onFrame) outer.onFrame(payload);
  };
  return outer;
}

/** Wait until the session says something, or give up. */
async function until(test, timeoutMs, everyMs = 100) {
  for (let waited = 0; waited < timeoutMs; waited += everyMs) {
    if (test()) return true;
    await sleep(everyMs);
  }
  return test();
}

async function record({ accountName, characterID, seconds = 20, probeEverySeconds = 0, endpoint = gameEndpoint() }) {
  const frames = [];
  const notifications = new Map();
  let current = "connect";
  const step = (name) => { current = name; };
  const session = new GamePortSession({ transport: timedRecorder(await connectTcp(endpoint), frames, () => current) });
  session.onNotification((notification) => {
    notifications.set(notification.method, (notifications.get(notification.method) ?? 0) + 1);
  });
  const outcome = { docked: null, stationID: null, solarSystemID: null, shipID: null };
  try {
    step("login");
    await session.login(accountName, "");
    step("select");
    await session.call("charUnboundMgr", "GetCharacterSelectionData", []);
    await session.call("charUnboundMgr", "GetCharacterLockType", [characterID]);
    await session.call("charUnboundMgr", "SelectCharacterID", [characterID, null, false]);
    await until(() => id(session.attributes.charid) === characterID, 5000);
    const stationID = id(session.attributes.stationid);
    const shipID = id(session.attributes.shipid);
    if (!stationID || !shipID) throw new Error("The character is not docked in a station with an active ship.");
    Object.assign(outcome, { stationID, shipID });

    step("undock");
    const ship = await session.bind("ship", [stationID, GROUP_STATION]);
    await session.callBound(ship.objectID, "Undock", [shipID, false]);
    if (!(await until(() => id(session.attributes.solarsystemid) !== null, 15000))) {
      throw new Error("Undock was answered, but the session never reached space.");
    }
    const solarSystemID = id(session.attributes.solarsystemid);
    outcome.solarSystemID = solarSystemID;

    step("enter space");
    await session.call("beyonce", "GetFormations", []);
    const park = await session.bind("beyonce", solarSystemID);

    /** Stay in space for a while, asking for the state again every so often if that was asked for. */
    const stay = async (name, ms) => {
      step(name);
      if (!(probeEverySeconds > 0)) return sleep(ms);
      const every = Math.round(probeEverySeconds * 1000);
      let left = ms;
      for (; left > every; left -= every) {
        await sleep(every);
        step("probe");
        await session.callBound(park.objectID, "UpdateStateRequest", []);
        step(name);
      }
      return sleep(left);
    };
    await stay("in space", Math.round(seconds * 500));
    step("stop");
    await session.callBound(park.objectID, "CmdStop", []);
    await stay("in space, stopped", Math.round(seconds * 500));

    step("dock");
    await session.callBound(park.objectID, "CmdDock", [stationID, shipID]);
    outcome.docked = await until(() => id(session.attributes.stationid) === stationID, 90000, 250);
    step("docked");
    await sleep(1000);
  } finally {
    session.close();
  }
  return { frames, notifications: Object.fromEntries([...notifications.entries()].sort()), outcome };
}

async function main(argv = process.argv.slice(2)) {
  const [accountName, characterText, secondsText, outputPath = DEFAULT_OUTPUT, probeText] = argv;
  const characterID = Number(characterText);
  if (!accountName || !Number.isSafeInteger(characterID)) {
    throw new Error("Usage: node scripts/record-destiny.js <accountName> <characterID> [seconds] [outputPath] [probeEverySeconds]");
  }
  const seconds = Number(secondsText) > 0 ? Number(secondsText) : 20;
  const probeEverySeconds = Number(probeText) > 0 ? Number(probeText) : 0;
  const { frames, notifications, outcome } = await record({ accountName, characterID, seconds, probeEverySeconds });
  const fixture = {
    about: "What a real eve.js server sent a client that undocked, stopped and docked again, on the game port. " +
      (probeEverySeconds ? `Every ${probeEverySeconds} s in space it was asked for its whole state again. ` : "") +
      "Re-record with scripts/record-destiny.js; never edit by hand.",
    eveCommit: eveCommit(),
    capturedAt: new Date().toISOString(),
    accountName,
    characterID,
    seconds,
    probeEverySeconds,
    ...outcome,
    notifications,
    frames,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 1)}\n`, "utf8");
  const count = (from) => frames.filter((frame) => frame.from === from).length;
  console.log(`Recorded ${count("client")} client and ${count("server")} server frames into ${outputPath}`);
  console.log(`Notifications: ${JSON.stringify(notifications)}`);
  console.log(outcome.docked ? "The character is docked again." : "⚠ The character did NOT dock again in time. It is in space.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { record, timedRecorder };
