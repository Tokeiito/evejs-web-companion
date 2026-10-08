"use strict";

// Record what the server tells a client about its own ship's dogma.
//
//   node scripts/record-dogma.js <accountName> <characterID> <moduleID> <effectName> [seconds] [outputPath]
//
// Logs a docked character in on the game port and, as the retail client's
// godma does, asks the dogma location bound for where the pilot is for
// everything about the ship (GetAllInfo). Then it undocks, asks again in
// space, runs one of the ship's modules for a while (anything that draws on
// the capacitor: an afterburner will do), asks a last time, and docks. Every
// frame both ways is kept, as scripts/record-destiny.js keeps them.
//
// While it runs it keeps the pilot's dogma readings itself
// (src/gamePort/pilotDogma.js) from the first answer in space and the
// notifications after it, and at the last answer sets what it had worked out
// for the capacitor beside what the server then says. That is the live check:
// the server's own number, not another reading of ours.
//
// The calls are the retail client's:
//
//   dogmaIM bound for the place          eveMoniker.CharGetDogmaLocation -> godma.GetDogmaLM()
//     GetAllInfo(True, True, None)       godma.Prime (godma.py 2409)
//     Activate(itemID, effect, None, n)  godma.Activate (2062)
//     Deactivate(itemID, effect)         godma.Deactivate
//
// ⚠ It UNDOCKS A REAL CHARACTER and runs one of its modules. If docking does
// not finish in time the character is left in space and the script says so.

const fs = require("node:fs");
const path = require("node:path");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { ATTRIBUTE, createPilotDogma, filetimeNow } = require("../src/gamePort/pilotDogma");
const { eveCommit } = require("./capture-game-frames");
const { timedRecorder } = require("./record-destiny");

const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "test", "fixtures", "dogmaFlight.json");
const GROUP_STATION = 15;
const GROUP_SOLAR_SYSTEM = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const id = (value) => (value === null || value === undefined ? null : Number(value));
const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : value);

async function until(test, timeoutMs, everyMs = 100) {
  for (let waited = 0; waited < timeoutMs; waited += everyMs) {
    if (test()) return true;
    await sleep(everyMs);
  }
  return test();
}

/** The ship's capacitor as one GetAllInfo answer states it: the charge, when it was that, and what it recharges towards. */
function capacitorIn(allInfo, shipID) {
  const field = (value, name) => (value.args.entries.find(([key]) => text(key) === name) || [])[1];
  const row = field(allInfo, "shipInfo").entries.find(([key]) => Number(key) === shipID)[1];
  const attribute = (attributeID) => Number((field(row, "attributes").entries.find(([key]) => Number(key) === attributeID) || [])[1]);
  return { charge: attribute(ATTRIBUTE.CHARGE), capacity: attribute(ATTRIBUTE.CAPACITOR_CAPACITY), rechargeRate: attribute(ATTRIBUTE.RECHARGE_RATE), time: String(field(row, "time")) };
}

async function record({ accountName, characterID, moduleID, effectName, seconds = 12, endpoint = gameEndpoint(), log = console.log }) {
  const frames = [];
  const notifications = new Map();
  let current = "connect";
  const step = (name) => {
    current = name;
    log(`· ${name}`);
  };
  const session = new GamePortSession({ transport: timedRecorder(await connectTcp(endpoint), frames, () => current) });
  const dogma = createPilotDogma({ characterID });
  session.onNotification((notification) => {
    notifications.set(notification.method, (notifications.get(notification.method) ?? 0) + 1);
    dogma.feed(notification);
  });
  const outcome = { docked: null, stationID: null, solarSystemID: null, shipID: null, moduleID, effectName, capacitor: {} };
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

    step("GetAllInfo docked");
    const docked = await session.bind("dogmaIM", [stationID, GROUP_STATION]);
    outcome.capacitor.docked = capacitorIn(await session.callBound(docked.objectID, "GetAllInfo", [true, true, null]), shipID);

    step("undock");
    const ship = await session.bind("ship", [stationID, GROUP_STATION]);
    await session.callBound(ship.objectID, "Undock", [shipID, false]);
    if (!(await until(() => id(session.attributes.solarsystemid) !== null, 15000))) throw new Error("Undock was answered, but the session never reached space.");
    const solarSystemID = id(session.attributes.solarsystemid);
    outcome.solarSystemID = solarSystemID;
    step("enter space");
    await session.call("beyonce", "GetFormations", []);
    const park = await session.bind("beyonce", solarSystemID);
    await sleep(3000);

    step("GetAllInfo in space");
    const location = await session.bind("dogmaIM", [solarSystemID, GROUP_SOLAR_SYSTEM]);
    const first = await session.callBound(location.objectID, "GetAllInfo", [true, true, null]);
    dogma.loadAllInfo(first);
    outcome.capacitor.inSpace = capacitorIn(first, shipID);

    step("module running");
    await session.callBound(location.objectID, "Activate", [moduleID, effectName, null, 1000]);
    await sleep(Math.round(seconds * 1000));
    step("module stopping");
    try {
      await session.callBound(location.objectID, "Deactivate", [moduleID, effectName]);
    } catch (error) {
      log(`  Deactivate: ${error.message}`);
    }
    await sleep(4000);

    step("GetAllInfo after");
    const ours = { charge: dogma.attribute(shipID, ATTRIBUTE.CHARGE), at: String(filetimeNow()) };
    const last = await session.callBound(location.objectID, "GetAllInfo", [true, true, null]);
    outcome.capacitor.after = capacitorIn(last, shipID);
    // Ours, brought to the moment the server's number is for.
    outcome.capacitor.oursThen = { ...ours, chargeAtServersTime: dogma.attribute(shipID, ATTRIBUTE.CHARGE, BigInt(outcome.capacitor.after.time)) };

    step("dock");
    await session.callBound(park.objectID, "CmdStop", []);
    for (let tries = 0; tries < 40 && outcome.docked !== true; tries += 1) {
      try {
        await session.callBound(park.objectID, "CmdDock", [stationID, shipID]);
      } catch (error) {
        if (!/DockingApproach/.test(String(error.message))) throw error;
      }
      outcome.docked = await until(() => id(session.attributes.stationid) === stationID, 3000, 250);
    }
    step("docked");
    await sleep(1000);
  } finally {
    session.close();
  }
  return { frames, notifications: Object.fromEntries([...notifications.entries()].sort()), outcome };
}

async function main(argv = process.argv.slice(2)) {
  const [accountName, characterText, moduleText, effectName, secondsText, outputPath = DEFAULT_OUTPUT] = argv;
  const characterID = Number(characterText);
  const moduleID = Number(moduleText);
  if (!accountName || !Number.isSafeInteger(characterID) || !Number.isSafeInteger(moduleID) || !effectName) {
    throw new Error("Usage: node scripts/record-dogma.js <accountName> <characterID> <moduleID> <effectName> [seconds] [outputPath]");
  }
  const seconds = Number(secondsText) > 0 ? Number(secondsText) : 12;
  const { frames, notifications, outcome } = await record({ accountName, characterID, moduleID, effectName, seconds });
  const fixture = {
    about: "What a real eve.js server told a client about its own ship's dogma: GetAllInfo docked and in space, a module run for a while, " +
      "GetAllInfo again. Re-record with scripts/record-dogma.js; never edit by hand.",
    eveCommit: eveCommit(),
    capturedAt: new Date().toISOString(),
    accountName,
    characterID,
    seconds,
    ...outcome,
    notifications,
    frames,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 1)}\n`, "utf8");
  const count = (from) => frames.filter((frame) => frame.from === from).length;
  console.log(`Recorded ${count("client")} client and ${count("server")} server frames into ${outputPath}`);
  console.log(`Notifications: ${JSON.stringify(notifications)}`);
  console.log(`Capacitor: ${JSON.stringify(outcome.capacitor, null, 1)}`);
  console.log(outcome.docked ? "The character is docked again." : "⚠ The character did NOT dock again in time. It is in space.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { capacitorIn, record };
