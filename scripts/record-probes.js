"use strict";

// Record what the server tells a client about its scan probes and its probe launcher.
//
//   node scripts/record-probes.js <accountName> <characterID> <launcherModuleID> [count] [outputPath]
//
// Logs a docked character in on the game port, whose ship has an online scan
// probe launcher with probes loaded, and does what the retail client's scan
// service does (eve/client/script/parklife/scanSvc.py):
//
//   dogmaIM bound for the place, GetAllInfo(True, True, None)    godma.Prime: the launcher and what is loaded in it
//   undock; GetAllInfo again in space
//   dogmaLM.LaunchProbes(moduleID, count)                        FindModuleAndLaunchProbes; the server answers with OnNewProbe for each
//   scanMgr.GetSystemScanMgr()                                   GetScanMan: the bound scan manager
//     RequestScans({probeID: probe})                             RequestScans, with the client's own idle probes
//     ... OnSystemScanStarted, OnSystemScanStopped
//     RecoverProbes([probeID, ...])                              AskServerToRecallProbes; then OnRemoveProbe for each
//   GetAllInfo a last time; dock
//
// Every frame both ways is kept, as scripts/record-destiny.js keeps them.
// While it runs it keeps the probes itself (src/gamePort/pilotScanner.js) and
// says what it holds at each step.
//
// ⚠ It UNDOCKS A REAL CHARACTER and launches its probes. Copy the game store
// first and put it back afterwards (the loop brief says how). If docking does
// not finish in time the character is left in space and the script says so.

const fs = require("node:fs");
const path = require("node:path");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { boundObjectID } = require("../src/gamePort/pilots");
const { createPilotScanner } = require("../src/gamePort/pilotScanner");
const staticData = require("../src/staticData");
const { eveCommit } = require("./capture-game-frames");
const { timedRecorder } = require("./record-destiny");

const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "test", "fixtures", "probeFlight.json");
const GROUP_STATION = 15;
const GROUP_SOLAR_SYSTEM = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const id = (value) => (value === null || value === undefined ? null : Number(value));

async function until(test, timeoutMs, everyMs = 100) {
  for (let waited = 0; waited < timeoutMs; waited += everyMs) {
    if (test()) return true;
    await sleep(everyMs);
  }
  return test();
}

/** A probe as the client sends one back: the util.KeyVal the server sent, with what the client has changed on it. */
const probeKeyVal = (probe) => ({
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["probeID", probe.probeID], ["typeID", probe.typeID],
      ["pos", { type: "list", items: probe.pos }], ["destination", { type: "list", items: probe.destination }],
      ["scanRange", probe.scanRange], ["rangeStep", probe.rangeStep], ["state", probe.state], ["expiry", probe.expiry],
    ],
  },
});

async function record({ accountName, characterID, moduleID, count = 4, endpoint = gameEndpoint(), log = console.log }) {
  const frames = [];
  const notifications = new Map();
  let current = "connect";
  const scanner = createPilotScanner({ typeAttribute: (typeID, attributeID) => staticData.getTypeDogmaAttribute(typeID, attributeID) });
  const held = () => scanner.probes().map((probe) => `${probe.probeID}:${probe.state}`).join(" ") || "none";
  const step = (name) => {
    current = name;
    log(`· ${name} (probes held: ${held()})`);
  };
  const session = new GamePortSession({ transport: timedRecorder(await connectTcp(endpoint), frames, () => current) });
  session.onNotification((notification) => {
    notifications.set(notification.method, (notifications.get(notification.method) ?? 0) + 1);
    scanner.feed(notification);
  });
  const seen = (method) => notifications.get(method) ?? 0;
  const outcome = { docked: null, stationID: null, solarSystemID: null, shipID: null, moduleID, launched: 0, probeIDs: [], scanned: false, recovered: [] };
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
    await session.callBound(docked.objectID, "GetAllInfo", [true, true, null]);

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
    await session.callBound(location.objectID, "GetAllInfo", [true, true, null]);

    step("launch");
    await session.callBound(location.objectID, "LaunchProbes", [moduleID, count]);
    await until(() => seen("OnNewProbe") >= count, 8000);
    outcome.launched = seen("OnNewProbe");
    outcome.probeIDs = scanner.probes().map((probe) => probe.probeID);
    await sleep(1500);

    step("GetAllInfo after launch");
    await session.callBound(location.objectID, "GetAllInfo", [true, true, null]);

    step("bind scan manager");
    const scanManager = boundObjectID(await session.call("scanMgr", "GetSystemScanMgr", []));
    if (!scanManager) throw new Error("scanMgr.GetSystemScanMgr did not answer with a bound object.");

    step("scan");
    const idle = scanner.idleProbes();
    await session.callBound(scanManager, "RequestScans", [{ type: "dict", entries: idle.map((probe) => [probe.probeID, probeKeyVal(probe)]) }]);
    scanner.moving(idle.map((probe) => probe.probeID));
    await until(() => seen("OnSystemScanStarted") >= 1, 8000);
    step("scanning");
    outcome.scanned = await until(() => seen("OnSystemScanStopped") >= 1, 30000);
    await sleep(1000);

    step("recover");
    const answered = await session.callBound(scanManager, "RecoverProbes", [{ type: "list", items: outcome.probeIDs }]);
    outcome.recovered = (Array.isArray(answered) ? answered : answered && Array.isArray(answered.items) ? answered.items : []).map(Number);
    scanner.moving(outcome.recovered);
    step("recovering");
    await until(() => seen("OnRemoveProbe") >= outcome.recovered.length, 20000);
    await sleep(1500);

    step("GetAllInfo after recover");
    await session.callBound(location.objectID, "GetAllInfo", [true, true, null]);

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
  const [accountName, characterText, moduleText, countText, outputPath = DEFAULT_OUTPUT] = argv;
  const characterID = Number(characterText);
  const moduleID = Number(moduleText);
  if (!accountName || !Number.isSafeInteger(characterID) || !Number.isSafeInteger(moduleID)) {
    throw new Error("Usage: node scripts/record-probes.js <accountName> <characterID> <launcherModuleID> [count] [outputPath]");
  }
  const count = Number(countText) > 0 ? Math.trunc(Number(countText)) : 4;
  const { frames, notifications, outcome } = await record({ accountName, characterID, moduleID, count });
  const fixture = {
    about: "What a real eve.js server told a client about its scan probes: GetAllInfo with a loaded probe launcher, probes launched, a scan, the probes " +
      "recalled, GetAllInfo again. Re-record with scripts/record-probes.js; never edit by hand.",
    eveCommit: eveCommit(),
    capturedAt: new Date().toISOString(),
    accountName,
    characterID,
    count,
    ...outcome,
    notifications,
    frames,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 1)}\n`, "utf8");
  const sent = (from) => frames.filter((frame) => frame.from === from).length;
  console.log(`Recorded ${sent("client")} client and ${sent("server")} server frames into ${outputPath}`);
  console.log(`Notifications: ${JSON.stringify(notifications)}`);
  console.log(`Launched ${outcome.launched} of ${count}; scanned: ${outcome.scanned}; recalled ${outcome.recovered.length}.`);
  console.log(outcome.docked ? "The character is docked again." : "⚠ The character did NOT dock again in time. It is in space.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { probeKeyVal, record };
