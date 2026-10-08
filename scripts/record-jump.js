"use strict";

// Record what the server sends a client that goes through a stargate and comes back.
//
//   node scripts/record-jump.js <accountName> <characterID> <gateID> <farGateID> [outputPath]
//
// <gateID> is a stargate in the system the character is docked in, and
// <farGateID> the gate at its other end (GET /api/map/graph on a BFF lists
// them as [fromSystem, toSystem, fromGateID, toGateID]).
//
// Logs a docked character in on the game port, undocks it, warps it to the
// gate, jumps, waits a while in the next system, flies up to the gate it came
// out of, jumps back, warps to its station and docks. Every frame both ways is
// kept with the time it passed, as scripts/record-destiny.js keeps them.
//
// A jump changes the session's solar system, and the retail client's michelle
// then lets its ballpark go and makes another (UpdateBallpark). This does the
// same with the very thing the game-port transport uses (src/gamePort/pilotSpace.js),
// and waits on what those parks say: out of warp, in the new system, the grid
// arrived. What each park held when it was let go is written into the recording.
//
// The calls are the retail client's:
//
//   beyonce.CmdWarpToStuff('item', gateID, minRange=0)
//   beyonce.CmdStargateJump(gateID, farGateID, shipID)     autopilot.py 358, through sessionMgr.PerformSessionChange
//   beyonce.CmdFollowBall(gateID, 50)                      to fly up to the gate arrived at
//   beyonce.CmdDock(stationID, shipID)
//
// ⚠ It FLIES A REAL CHARACTER through a gate and back. If a leg does not
// finish the character is left where it was and the script says so.

const fs = require("node:fs");
const path = require("node:path");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { createPilotSpace } = require("../src/gamePort/pilotSpace");
const { MODE } = require("../src/gamePort/destiny/state");
const { eveCommit } = require("./capture-game-frames");
const { timedRecorder } = require("./record-destiny");

const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "test", "fixtures", "destinyJump.json");
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

/** What a park holds, in a few numbers. */
function describe(space) {
  const { park } = space;
  const kinds = {};
  for (const slim of park.slimItems.values()) {
    const key = `${slim.get("categoryID")}/${slim.get("groupID")}`;
    kinds[key] = (kinds[key] ?? 0) + 1;
  }
  return {
    solarSystemID: space.solarSystemID,
    validState: park.validState,
    tick: park.currentTime,
    balls: park.ballpark.balls.size,
    slimItems: park.slimItems.size,
    byCategoryAndGroup: kinds,
    queued: park.history.length,
    latestSetStateTime: park.latestSetStateTime,
    failed: [...park.failed],
    resets: park.resets,
    updatesHoldingTwoTicks: park.fatalDesyncs,
  };
}

async function record({ accountName, characterID, gateID, farGateID, endpoint = gameEndpoint(), log = console.log }) {
  const frames = [];
  const notifications = new Map();
  let current = "connect";
  const step = (name) => {
    current = name;
    log(`· ${name}`);
  };
  const session = new GamePortSession({ transport: timedRecorder(await connectTcp(endpoint), frames, () => current) });
  const outcome = { docked: null, stationID: null, shipID: null, gateID, farGateID, parks: [], parkErrors: [] };
  /** michelle.UpdateBallpark: a park for the system the session is in, replaced when the system changes. */
  let space = null;
  const posted = [];
  const sync = () => {
    const system = session.attributes.stationid ? null : id(session.attributes.solarsystemid);
    if (space && space.solarSystemID !== system) {
      outcome.parks.push({ letGoDuring: current, ...describe(space) });
      space.release();
      space = null;
    }
    if (system !== null && !space) {
      const made = createPilotSpace({
        session,
        solarSystemID: system,
        onError: (error, what) => outcome.parkErrors.push(`${current}: ${what}: ${error.message}`),
        onPost: (name, ballID, value) => posted.push({ name, ballID, value, system }),
      });
      space = made;
      made.start().catch((error) => outcome.parkErrors.push(`${current}: start: ${error.message}`));
    }
  };
  session.onNotification((notification) => {
    notifications.set(notification.method, (notifications.get(notification.method) ?? 0) + 1);
    if (space) space.feed(notification);
  });
  session.onSessionChange((changes) => {
    if (["stationid", "solarsystemid", "locationid"].some((name) => name in changes)) sync();
  });
  const ego = () => (space && space.park.ego !== null ? space.park.ballpark.ball(space.park.ego) : null);
  const speed = (ball) => Math.hypot(ball.newVel.x, ball.newVel.y, ball.newVel.z);
  const remote = async () => {
    const objectID = await space.remote();
    if (!objectID) throw new Error("The system's ballpark could not be bound.");
    return objectID;
  };

  /** Warp to an item and wait for the park to drop the ship out of warp and for it to slow. */
  const warp = async (name, itemID) => {
    const seen = posted.length;
    step(`${name}: warp`);
    await session.callBound(await remote(), "CmdWarpToStuff", ["item", itemID], { minRange: 0 });
    if (!(await until(() => posted.slice(seen).some((event) => event.name === "OnDeactivatingWarp"), 300000))) throw new Error(`${name}: the park's ship never came out of warp.`);
    step(`${name}: out of warp`);
    await until(() => ego() && ego().mode === MODE.STOP && speed(ego()) < 1, 60000, 250);
  };

  /** Jump through a gate, asking until the server lets the ship, and wait to be in another system with its grid. */
  const jump = async (name, fromGate, toGate, shipID) => {
    const from = id(session.attributes.solarsystemid);
    step(`${name}: jump`);
    let refusals = 0;
    for (; id(session.attributes.solarsystemid) === from && refusals < 150; ) {
      try {
        await session.callBound(await remote(), "CmdStargateJump", [fromGate, toGate, shipID]);
        if (await until(() => id(session.attributes.solarsystemid) !== from, 30000)) break;
      } catch (error) {
        if (id(session.attributes.solarsystemid) !== from) break; // the park it was asked of went with the system
        refusals += 1;
        await sleep(2000);
      }
    }
    if (id(session.attributes.solarsystemid) === from) throw new Error(`${name}: still in ${from} after ${refusals} refusals.`);
    step(`${name}: arrived`);
    if (!(await until(() => space && space.park.validState && ego(), 30000))) throw new Error(`${name}: the new system's state never came.`);
    await sleep(12000);
    return refusals;
  };

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
    Object.assign(outcome, { stationID, shipID, homeSystemID: id(session.attributes.solarsystemid2) });

    step("undock");
    const ship = await session.bind("ship", [stationID, GROUP_STATION]);
    await session.callBound(ship.objectID, "Undock", [shipID, false]);
    if (!(await until(() => id(session.attributes.solarsystemid) !== null && space && space.park.validState && ego(), 30000))) throw new Error("The session never reached space with a state.");
    await sleep(4000);

    await warp("to the gate", gateID);
    outcome.refusalsOut = await jump("out", gateID, farGateID, shipID);
    outcome.farSystemID = id(session.attributes.solarsystemid);
    step("fly up to the gate");
    await session.callBound(await remote(), "CmdFollowBall", [farGateID, 50]);
    outcome.refusalsBack = await jump("back", farGateID, gateID, shipID);
    await warp("to the station", stationID);

    step("dock");
    for (let tries = 0; tries < 40 && outcome.docked !== true; tries += 1) {
      try {
        await session.callBound(await remote(), "CmdDock", [stationID, shipID]);
      } catch (error) {
        if (!/DockingApproach/.test(String(error.message))) throw error;
      }
      outcome.docked = await until(() => id(session.attributes.stationid) === stationID, 3000, 250);
    }
    step("docked");
    await sleep(1000);
  } finally {
    if (space) {
      outcome.parks.push({ letGoDuring: current, ...describe(space) });
      space.release();
    }
    session.close();
  }
  outcome.warpEvents = posted;
  return { frames, notifications: Object.fromEntries([...notifications.entries()].sort()), outcome };
}

async function main(argv = process.argv.slice(2)) {
  const [accountName, characterText, gateText, farGateText, outputPath = DEFAULT_OUTPUT] = argv;
  const [characterID, gateID, farGateID] = [Number(characterText), Number(gateText), Number(farGateText)];
  if (!accountName || ![characterID, gateID, farGateID].every(Number.isSafeInteger)) {
    throw new Error("Usage: node scripts/record-jump.js <accountName> <characterID> <gateID> <farGateID> [outputPath]");
  }
  const { frames, notifications, outcome } = await record({ accountName, characterID, gateID, farGateID });
  const fixture = {
    about: "What a real eve.js server sent a client that warped to a stargate, jumped, came back through it and docked, on the game port. " +
      "Re-record with scripts/record-jump.js; never edit by hand.",
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
  for (const park of outcome.parks) console.log(`Park let go during "${park.letGoDuring}": ${JSON.stringify({ ...park, letGoDuring: undefined })}`);
  console.log(`Park errors: ${JSON.stringify(outcome.parkErrors)}`);
  console.log(outcome.docked ? "The character is docked again." : "⚠ The character did NOT dock again in time. It is in space.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { describe, record };
