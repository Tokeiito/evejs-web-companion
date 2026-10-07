"use strict";

// Capture what a real eve.js server sends on the game port, as a test fixture.
//
// Tests of the game-port client must run against bytes a real server wrote, not
// bytes this repository's own encoder wrote: a codec that agrees only with
// itself proves nothing. This logs in on the game port, makes a few read-only
// account-level calls, and saves every frame the SERVER sent.
//
//   node scripts/capture-game-frames.js <accountName> [outputPath]
//
// ⚠ It never selects a character, so it evicts nobody and changes nothing in
// game. Use an account you are happy to see in a committed fixture: the frames
// carry its character list.

const childProcess = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { GameClient, gameEndpoint } = require("../src/gameClient");
const { eveRoot } = require("./vendor-marshal");

const WEB_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(WEB_ROOT, "test", "fixtures", "gamePortFrames.json");

// Read-only, and answered before any character is selected.
const CALLS = [
  ["machoNet", "GetTime", []],
  ["machoNet", "GetInitVals", []],
  ["charUnboundMgr", "GetCharacterSelectionData", []],
];

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

async function capture(accountName, { endpoint = gameEndpoint(), calls = CALLS } = {}) {
  const frames = [];
  let label = "handshake";
  // How many frames the client had sent when each server frame arrived. A
  // replay sends a frame once it has seen that many, which reproduces the
  // conversation without knowing what any frame means.
  let sent = 0;
  const record = frameSplitter((payload) => {
    frames.push({ during: label, afterClientFrames: sent, hex: payload.toString("hex") });
  });
  const client = new GameClient({
    ...endpoint,
    connectImpl: (options) => {
      const socket = net.connect(options);
      const write = socket.write.bind(socket);
      // GameClient writes exactly one frame per write.
      socket.write = (...args) => {
        sent += 1;
        return write(...args);
      };
      socket.on("data", record);
      return socket;
    },
  });
  try {
    await client.login(accountName);
    for (const [service, method, args] of calls) {
      label = `${service}.${method}`;
      await client.call(service, method, args);
    }
  } finally {
    client.close();
  }
  return frames;
}

async function main(argv = process.argv.slice(2)) {
  const [accountName, outputPath = DEFAULT_OUTPUT] = argv;
  if (!accountName) {
    throw new Error("Usage: node scripts/capture-game-frames.js <accountName> [outputPath]");
  }
  const frames = await capture(accountName);
  const fixture = {
    about: "Frames a real eve.js server sent on the game port. Re-capture with scripts/capture-game-frames.js; never edit by hand.",
    eveCommit: eveCommit(),
    capturedAt: new Date().toISOString(),
    frames,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  const bytes = frames.reduce((total, frame) => total + frame.hex.length / 2, 0);
  console.log(`Captured ${frames.length} frames (${bytes} bytes) into ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { CALLS, capture, frameSplitter };
