"use strict";

// Record what the server answers to godma's priming in each of the forms the retail client sends it.
//
//   node scripts/record-godma-priming.js <accountName> <characterID> [outputPath]
//
// The client's godma asks its dogma location for everything it does not hold (godma.py, Prime, 2399 to 2409):
//
//   primeCharacter = session.charid and session.charid not in self.invByID
//   primeShip      = session.shipid and session.shipid not in self.invByID
//   primeStructure = session.structureid and session.structureid not in self.invByID
//   GetDogmaLM().GetAllInfo(primeCharacter, primeShip, primeStructure)
//
// At the first priming of a session it holds nothing, and asks for the character and the ship. At a change of
// place or of ship it keeps the character and lets the ship go (ProcessSessionChange, 1154), so every priming
// after the first is GetAllInfo(False, True, None), or (False, True, True) in a structure. Tranquility's
// recordings have the call 164 times: (False, True, None) 144, (False, True, True) 14, (True, True, None) 4
// and (True, True, True) twice.
//
// This logs a docked character in on the game port and asks, of the dogma location bound for where it is:
//
//   "first, docked"       GetAllInfo(True, True, None)      the first priming
//   "later, docked"       GetAllInfo(False, True, None)     as after a boarding in the station
//   "later, in space"     GetAllInfo(False, True, None)     as after the undock
//   "later, docked again" GetAllInfo(False, True, None)     as after the docking
//
// Every frame both ways is kept, as scripts/record-destiny.js keeps them.
//
// ⚠ It UNDOCKS A REAL CHARACTER. If docking does not finish in time the character is left in space and the
// script says so.

const fs = require("node:fs");
const path = require("node:path");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { eveCommit } = require("./capture-game-frames");
const { timedRecorder } = require("./record-destiny");

const DEFAULT_OUTPUT = path.resolve(__dirname, "..", "test", "fixtures", "godmaPriming.json");
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

/** What an answer has of each thing godma takes from one: how many rows, or that it is None. */
function shapeOf(allInfo) {
  const entries = allInfo && allInfo.args && Array.isArray(allInfo.args.entries) ? allInfo.args.entries : [];
  const out = {};
  for (const [key, value] of entries) {
    const name = text(key);
    if (value === null || value === undefined) out[name] = null;
    else if (Array.isArray(value)) out[name] = value.map((each) => (each && Array.isArray(each.entries) ? `${each.entries.length} rows` : each === null ? null : typeof each));
    else if (Array.isArray(value.entries)) out[name] = `${value.entries.length} rows`;
    else out[name] = typeof value === "bigint" ? String(value) : typeof value === "object" ? value.type || "object" : value;
  }
  return out;
}

async function record({ accountName, characterID, endpoint = gameEndpoint(), log = console.log }) {
  const frames = [];
  let current = "connect";
  const step = (name) => {
    current = name;
    log(`· ${name}`);
  };
  const session = new GamePortSession({ transport: timedRecorder(await connectTcp(endpoint), frames, () => current) });
  const outcome = { docked: null, stationID: null, solarSystemID: null, shipID: null, asked: {}, answered: {} };
  const ask = async (during, objectID, args) => {
    step(during);
    outcome.asked[during] = args;
    outcome.answered[during] = shapeOf(await session.callBound(objectID, "GetAllInfo", args));
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
    Object.assign(outcome, { stationID, shipID });

    const docked = await session.bind("dogmaIM", [stationID, GROUP_STATION]);
    await ask("first, docked", docked.objectID, [true, true, null]);
    await ask("later, docked", docked.objectID, [false, true, null]);

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

    const location = await session.bind("dogmaIM", [solarSystemID, GROUP_SOLAR_SYSTEM]);
    await ask("later, in space", location.objectID, [false, true, null]);

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
    if (outcome.docked) {
      const again = await session.bind("dogmaIM", [stationID, GROUP_STATION]);
      await ask("later, docked again", again.objectID, [false, true, null]);
    }
    step("done");
    await sleep(500);
  } finally {
    session.close();
  }
  return { frames, outcome };
}

async function main(argv = process.argv.slice(2)) {
  const [accountName, characterText, outputPath = DEFAULT_OUTPUT] = argv;
  const characterID = Number(characterText);
  if (!accountName || !Number.isSafeInteger(characterID)) {
    throw new Error("Usage: node scripts/record-godma-priming.js <accountName> <characterID> [outputPath]");
  }
  const { frames, outcome } = await record({ accountName, characterID });
  const fixture = {
    about: "What a real eve.js server answered to godma's priming in each form the retail client sends it: the first of a session " +
      "(True, True, None), and those after it (False, True, None), docked, in space and docked again. " +
      "Re-record with scripts/record-godma-priming.js; never edit by hand.",
    eveCommit: eveCommit(),
    capturedAt: new Date().toISOString(),
    accountName,
    characterID,
    ...outcome,
    frames,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 1)}\n`, "utf8");
  const count = (from) => frames.filter((frame) => frame.from === from).length;
  console.log(`Recorded ${count("client")} client and ${count("server")} server frames into ${outputPath}`);
  for (const [during, shape] of Object.entries(outcome.answered)) console.log(`${during} ${JSON.stringify(outcome.asked[during])}: ${JSON.stringify(shape)}`);
  console.log(outcome.docked ? "The character is docked again." : "⚠ The character did NOT dock again in time. It is in space.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { record, shapeOf };
