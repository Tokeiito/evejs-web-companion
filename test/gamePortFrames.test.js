"use strict";

// The game-port codec and client against bytes a REAL eve.js server sent.
//
// test/fixtures/gamePortFrames.json is a recording (scripts/capture-game-frames.js)
// of one login and three read-only calls. Every other game-port test in this
// repository builds its server frames with this repository's own encoder, so it
// can only show that the codec agrees with itself. These show that it reads what
// the server writes.
//
// ⚠ What this recording does NOT cover: nothing in it is a pickle, a negative
// long or a NULL bool, so it decodes the same on the codec from before those
// three fixes. test/gameProtocolMarshal.test.js is what pins the fixes.

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { once } = require("node:events");
const { GameClient } = require("../src/gameClient");
const { marshalDecodeExact, marshalEncode, wrapPacket } = require("../src/gameProtocol/marshal");
const { CALLS, frameSplitter } = require("../scripts/capture-game-frames");
const fixture = require("./fixtures/gamePortFrames.json");

const frames = fixture.frames.map((frame) => ({ ...frame, bytes: Buffer.from(frame.hex, "hex") }));

// The stock encoder writes an integer beyond 32 bits as an int64, and the stock
// decoder reads an int64 back as a BigInt even when the server had sent the same
// value in the variable-length form that reads as a number. Same integer, so
// compare integers by value.
function integersByValue(value) {
  if (typeof value === "number") return Number.isInteger(value) ? BigInt(value) : value;
  if (Array.isArray(value)) return value.map(integersByValue);
  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, integersByValue(entry)]));
  }
  return value;
}

test("the recording is a whole conversation", () => {
  assert.ok(frames.length >= 5 + CALLS.length, "a handshake and one reply per call");
  assert.deepEqual(frames.slice(-CALLS.length).map((frame) => frame.during), CALLS.map(([s, m]) => `${s}.${m}`));
});

test("every frame a real server sent decodes with no bytes left over", () => {
  for (const [index, frame] of frames.entries()) {
    assert.doesNotThrow(() => marshalDecodeExact(frame.bytes), `frame ${index} (${frame.during})`);
  }
});

test("a real frame cut short is refused, not half-read", () => {
  for (const [index, frame] of frames.entries()) {
    assert.throws(
      () => marshalDecodeExact(frame.bytes.subarray(0, frame.bytes.length - 1)),
      `frame ${index} (${frame.during})`,
    );
  }
});

test("a real frame survives decode, encode, decode", () => {
  for (const [index, frame] of frames.entries()) {
    const decoded = marshalDecodeExact(frame.bytes);
    const again = marshalDecodeExact(marshalEncode(decoded));
    assert.deepEqual(integersByValue(again), integersByValue(decoded), `frame ${index} (${frame.during})`);
  }
});

/** A server that replays the recording: each frame once the client has sent as much as it had then. */
async function replayServer(context) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    let received = 0;
    let next = 0;
    const flush = () => {
      while (next < frames.length && frames[next].afterClientFrames <= received) {
        socket.write(wrapPacket(frames[next].bytes));
        next += 1;
      }
    };
    socket.on("data", frameSplitter(() => {
      received += 1;
      flush();
    }));
    flush();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

test("the game client logs in and reads from a real server's recorded bytes", { timeout: 5000 }, async (context) => {
  const client = new GameClient({ host: "127.0.0.1", port: await replayServer(context) });
  context.after(() => client.close());

  await client.login("recorded");
  assert.ok(Number.isSafeInteger(client.userID) && client.userID > 0, "a user id from session_init");
  assert.ok(Number(client.clientID) > 0, "a client id from the login answer");

  const results = [];
  for (const [service, method, args] of CALLS) results.push(await client.call(service, method, args));
  const [time, initVals, selection] = results;

  // FILETIME: 100ns ticks since 1601. Anything after 2020 is above 1.32e17.
  assert.equal(typeof time, "bigint");
  assert.ok(time > 132_000_000_000_000_000n, "GetTime answers a present-day FILETIME");
  assert.ok(Array.isArray(initVals) && initVals.length === 2, "GetInitVals answers its pair");
  // (userDetails, trainingDetails, characterDetails, wars)
  assert.ok(Array.isArray(selection) && selection.length === 4, "character selection answers its four parts");
  assert.equal(selection[2].type, "list");
  assert.equal(client.pending.size, 0);
});
