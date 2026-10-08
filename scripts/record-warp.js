"use strict";

// Record what the server sends a client that warps.
//
//   node scripts/record-warp.js <accountName> <characterID> <targetItemID> [outputPath]
//
// Logs a docked character in on the game port, undocks it, warps it to
// <targetItemID> (anything in the same system: a moon, a planet, a station),
// lets it come to rest, asks the server where it has the ship, warps back to
// the station it left, asks again, and docks. Every frame both ways is kept
// with the time it passed, as scripts/record-destiny.js keeps them.
//
// Nothing tells a client that its warp is over: its own ballpark drops the
// ship out of warp, and that is how the retail client knows. So this runs the
// client's park (src/gamePort/destiny/park.js) on the live stream, one tick a
// second, and waits on what the park says. It is the first thing to fly by it.
//
// The calls are the retail client's:
//
//   beyonce.CmdWarpToStuff('item', itemID, minRange=0)   movementFunctions.WarpToItem -> michelle.CmdWarpToStuff
//   beyonce.UpdateStateRequest()                         michelle's RequestReset; here, asked only at rest
//   beyonce.CmdDock(stationID, shipID)
//
// A state asked for in flight is good to about a tick (see
// scripts/destiny-compare.js). Asked at rest, it is where the ship is.
//
// ⚠ It UNDOCKS AND WARPS A REAL CHARACTER on the server it is pointed at. If a
// warp or the docking does not finish in time the character is left in space
// and the script says so.

const fs = require("node:fs");
const path = require("node:path");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { Ballpark } = require("../src/gamePort/destiny/ballpark");
const { Park } = require("../src/gamePort/destiny/park");
const { MODE } = require("../src/gamePort/destiny/state");
const { eveCommit } = require("./capture-game-frames");
const { timedRecorder } = require("./record-destiny");

const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "test", "fixtures", "destinyWarp.json");
const GROUP_STATION = 15;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const id = (value) => (value === null || value === undefined ? null : Number(value));

async function until(test, timeoutMs, everyMs = 100) {
  for (let waited = 0; waited < timeoutMs; waited += everyMs) {
    if (test()) return true;
    await sleep(everyMs);
  }
  return test();
}

/** The client's park, fed by the session and ticked once a second from the first update. */
function livePark(session, log) {
  const posted = [];
  const park = new Park({ ballpark: new Ballpark({ onPost: (name, ballID, value) => posted.push({ name, ballID, value, tick: park.currentTime }) }) });
  let timer = null;
  const errors = [];
  const guard = (what, action) => {
    try {
      action();
    } catch (error) {
      errors.push(`${what}: ${error.message}`);
      log(`park ${what} failed: ${error.message}`);
    }
  };
  session.onNotification((notification) => {
    if (notification.method !== "DoDestinyUpdate" && notification.method !== "DoDestinyUpdates") return;
    guard(notification.method, () => {
      if (notification.method === "DoDestinyUpdates") park.doDestinyUpdates(notification.args[0]);
      else park.doDestinyUpdate(notification.args[0], notification.args[1], notification.args[2]);
    });
    timer ??= setInterval(() => guard("tick", () => park.tick()), 1000);
  });
  return {
    park,
    posted,
    errors,
    ego: () => (park.ego === null ? null : park.ballpark.ball(park.ego)),
    stop: () => clearInterval(timer),
  };
}

const speedOf = (ball) => Math.hypot(ball.newVel.x, ball.newVel.y, ball.newVel.z);

async function record({ accountName, characterID, targetItemID, endpoint = gameEndpoint(), log = console.log }) {
  const frames = [];
  const notifications = new Map();
  let current = "connect";
  const step = (name) => {
    current = name;
    log(`· ${name}`);
  };
  const session = new GamePortSession({ transport: timedRecorder(await connectTcp(endpoint), frames, () => current) });
  session.onNotification((notification) => {
    notifications.set(notification.method, (notifications.get(notification.method) ?? 0) + 1);
  });
  const live = livePark(session, log);
  const outcome = { docked: null, stationID: null, solarSystemID: null, shipID: null, targetItemID, warps: [], parkErrors: live.errors };
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
    outcome.solarSystemID = id(session.attributes.solarsystemid);

    step("enter space");
    await session.call("beyonce", "GetFormations", []);
    const remotePark = await session.bind("beyonce", outcome.solarSystemID);
    if (!(await until(() => live.ego() !== null, 10000))) throw new Error("The park never got a state with the ship in it.");
    step("in space");
    await sleep(4000);

    /** Warp to an item, wait for the park to drop the ship out of warp and for it to come to rest, then ask the server where it is. */
    const warp = async (name, itemID) => {
      const seen = live.posted.length;
      const entered = () => live.posted.slice(seen).some((event) => event.name === "OnActivatingWarp" && event.ballID === shipID);
      const left = () => live.posted.slice(seen).some((event) => event.name === "OnDeactivatingWarp" && event.ballID === shipID);
      step(`${name}: warp`);
      const orderedAt = live.park.currentTime;
      await session.callBound(remotePark.objectID, "CmdWarpToStuff", ["item", itemID], { minRange: 0 });
      const result = { name, itemID, orderedAt, enteredWarpAt: null, leftWarpAt: null, atRest: false };
      outcome.warps.push(result);
      if (!(await until(entered, 200000))) throw new Error(`${name}: the park's ship never entered warp.`);
      result.enteredWarpAt = live.posted.slice(seen).find((event) => event.name === "OnActivatingWarp").tick;
      step(`${name}: in warp`);
      if (!(await until(left, 300000))) throw new Error(`${name}: the park's ship never left warp.`);
      result.leftWarpAt = live.posted.slice(seen).find((event) => event.name === "OnDeactivatingWarp").tick;
      step(`${name}: out of warp, slowing`);
      result.atRest = await until(() => live.ego() && live.ego().mode === MODE.STOP && speedOf(live.ego()) < 0.05, 120000, 250);
      step(`${name}: at rest, asking`);
      await session.callBound(remotePark.objectID, "UpdateStateRequest", []);
      await sleep(3000);
    };
    await warp("out", targetItemID);
    await warp("back", stationID);

    step("dock");
    await session.callBound(remotePark.objectID, "CmdDock", [stationID, shipID]);
    outcome.docked = await until(() => id(session.attributes.stationid) === stationID, 120000, 250);
    step("docked");
    await sleep(1000);
  } finally {
    live.stop();
    session.close();
  }
  outcome.parkFailed = [...live.park.failed];
  outcome.parkResets = live.park.resets;
  return { frames, notifications: Object.fromEntries([...notifications.entries()].sort()), outcome };
}

async function main(argv = process.argv.slice(2)) {
  const [accountName, characterText, targetText, outputPath = DEFAULT_OUTPUT] = argv;
  const characterID = Number(characterText);
  const targetItemID = Number(targetText);
  if (!accountName || !Number.isSafeInteger(characterID) || !Number.isSafeInteger(targetItemID)) {
    throw new Error("Usage: node scripts/record-warp.js <accountName> <characterID> <targetItemID> [outputPath]");
  }
  let result;
  try {
    result = await record({ accountName, characterID, targetItemID });
  } catch (error) {
    console.error(`⚠ ${error.message} The character may be in space.`);
    throw error;
  }
  const { frames, notifications, outcome } = result;
  const fixture = {
    about: "What a real eve.js server sent a client that undocked, warped to an item, warped back and docked, on the game port; " +
      "at rest after each warp it was asked for its whole state. Re-record with scripts/record-warp.js; never edit by hand.",
    eveCommit: eveCommit(),
    capturedAt: new Date().toISOString(),
    accountName,
    characterID,
    ...outcome,
    notifications,
    frames,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 1)}\n`, "utf8");
  const count = (from) => frames.filter((frame) => frame.from === from).length;
  console.log(`Recorded ${count("client")} client and ${count("server")} server frames into ${outputPath}`);
  console.log(`Notifications: ${JSON.stringify(notifications)}`);
  console.log(`Warps, by the park's ticks: ${JSON.stringify(outcome.warps)}`);
  console.log(`Park: failed ${JSON.stringify(outcome.parkFailed)}, resets ${outcome.parkResets}, errors ${JSON.stringify(outcome.parkErrors)}`);
  console.log(outcome.docked ? "The character is docked again." : "⚠ The character did NOT dock again in time. It is in space.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { livePark, record };
