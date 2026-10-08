"use strict";

// Record a conversation with a real eve.js server on the game port, as a test
// fixture.
//
// Tests of the game-port session must run against bytes a real server wrote,
// not bytes this repository's own encoder wrote: a codec that agrees only with
// itself proves nothing. This logs in, optionally selects a docked character
// and reads its station inventory, and saves every frame in both directions.
//
//   node scripts/capture-game-frames.js <accountName> [characterID] [outputPath]
//
// ⚠ With a characterID it SELECTS that character, which evicts any other
// session holding it, and logs it off again when it closes. Use a docked
// character nobody is flying. It changes nothing in game.
//
// ⚠ Use an account you are happy to see in a committed fixture: the frames carry
// its character list.
//
// The session's clock is frozen while recording. A real session decides how many
// clock-sync calls to make from how long each took, so two recordings would
// otherwise differ in length and a replay could not follow either.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { GamePortSession } = require("../src/gamePort/session");
const { connectTcp, gameEndpoint } = require("../src/gamePort/tcp");
const { eveRoot } = require("./vendor-marshal");

const WEB_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(WEB_ROOT, "test", "fixtures", "gamePortFrames.json");
/** The same journey ID in every recording, so what we send is the same bytes. */
const RECORDING_JOURNEY_ID = "00000000-0000-4000-8000-000000000000";
/** invGroups 15, Station: the group half of the station inventory's bind. */
const GROUP_STATION = 15;
/** const.containerHangar */
const CONTAINER_HANGAR = 10004;
const SELECT_SETTLE_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Split a byte stream into machoNet frames: 4-byte little-endian length, then payload. */
function frameSplitter(onFrame) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const length = buffer.readUInt32LE(0);
      onFrame(buffer.subarray(4, 4 + length));
      buffer = buffer.subarray(4 + length);
    }
  };
}

/**
 * Wrap a frame transport so every frame through it is kept. A server frame
 * records how many frames the client had sent when it arrived: a replay sends
 * it once it has seen that many, which reproduces the conversation without
 * knowing what any frame means.
 */
function recordingTransport(inner, frames, step) {
  let sent = 0;
  const outer = {
    onFrame: null,
    onClose: null,
    send(payload) {
      sent += 1;
      frames.push({ from: "client", during: step(), hex: payload.toString("hex") });
      inner.send(payload);
    },
    close: () => inner.close(),
  };
  inner.onClose = (error) => outer.onClose && outer.onClose(error);
  inner.onFrame = (payload) => {
    frames.push({ from: "server", during: step(), afterClientFrames: sent, hex: payload.toString("hex") });
    if (outer.onFrame) outer.onFrame(payload);
  };
  return outer;
}

/** The session options a recording and its replay must share. */
function recordingSessionOptions() {
  return { journeyID: RECORDING_JOURNEY_ID, now: () => 0 };
}

/**
 * The conversation, as steps. A replay runs the same function against the
 * recording, so the two cannot drift apart.
 */
async function converse(session, { accountName, characterID = null, step = () => {}, settleMs = SELECT_SETTLE_MS }) {
  const results = {};
  step("login");
  await session.login(accountName, "");
  step("charUnboundMgr.GetCharacterSelectionData");
  results.selection = await session.call("charUnboundMgr", "GetCharacterSelectionData");
  if (characterID !== null) {
    step("charUnboundMgr.SelectCharacterID");
    await session.call("charUnboundMgr", "SelectCharacterID", [characterID]);
    // SelectCharacterID answers before the session change has arrived.
    if (settleMs > 0) await sleep(settleMs);
    step("invbroker bind");
    results.broker = await session.bind("invbroker", [session.attributes.stationid, GROUP_STATION]);
    step("GetInventory");
    results.hangar = await session.callBound(results.broker.objectID, "GetInventory", [CONTAINER_HANGAR]);
    // The two ways the server hands back a cached answer: carried inline, and
    // as a reference the client fetches from objectCaching. The second one is
    // asked twice; the client fetches it once.
    step("account.GetKeyMap");
    results.keyMap = await session.call("account", "GetKeyMap");
    step("corporationSvc.GetAllCorpMedals");
    results.medals = await session.call("corporationSvc", "GetAllCorpMedals", [session.attributes.corpid]);
    step("corporationSvc.GetAllCorpMedals again");
    results.medalsAgain = await session.call("corporationSvc", "GetAllCorpMedals", [session.attributes.corpid]);
    step("pingService.Ping");
    results.ping = await session.proxyCall("pingService", "Ping");
  }
  return results;
}

function eveCommit() {
  try {
    return childProcess.execFileSync("git", ["-C", eveRoot(), "rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

async function capture({ accountName, characterID = null, endpoint = gameEndpoint() }) {
  const frames = [];
  let current = "connect";
  const transport = recordingTransport(await connectTcp(endpoint), frames, () => current);
  const session = new GamePortSession({ transport, ...recordingSessionOptions() });
  try {
    await converse(session, { accountName, characterID, step: (name) => { current = name; } });
    // Let anything the server was still pushing arrive.
    await sleep(500);
  } finally {
    session.close();
  }
  return frames;
}

async function main(argv = process.argv.slice(2)) {
  const [accountName, second, third] = argv;
  if (!accountName) {
    throw new Error("Usage: node scripts/capture-game-frames.js <accountName> [characterID] [outputPath]");
  }
  const characterID = /^\d+$/.test(second ?? "") ? Number(second) : null;
  const outputPath = (characterID === null ? second : third) ?? DEFAULT_OUTPUT;
  const frames = await capture({ accountName, characterID });
  const fixture = {
    about: "A conversation with a real eve.js server on the game port. Re-record with scripts/capture-game-frames.js; never edit by hand.",
    eveCommit: eveCommit(),
    capturedAt: new Date().toISOString(),
    accountName,
    characterID,
    frames,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 1)}\n`, "utf8");
  const count = (from) => frames.filter((frame) => frame.from === from).length;
  console.log(`Recorded ${count("client")} client and ${count("server")} server frames into ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { capture, converse, frameSplitter, recordingSessionOptions, recordingTransport };
