"use strict";

// The TCP binding for the game port: bytes on a socket, frames to the session.

const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { once } = require("node:events");
const { MAX_FRAME_LENGTH, connectTcp, gameEndpoint } = require("../src/gamePort/tcp");

const framed = (payload) => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
};
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

async function listener(context, onConnection) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

test("frames arrive whole however the bytes were split or joined", { timeout: 3000 }, async (context) => {
  const payloads = [Buffer.from("first"), Buffer.alloc(0), Buffer.from("third, a little longer"), Buffer.from("4")];
  const stream = Buffer.concat(payloads.map(framed));
  const port = await listener(context, (socket) => {
    // One byte, then a cut inside a header, then the rest in one piece.
    socket.write(stream.subarray(0, 1));
    setTimeout(() => socket.write(stream.subarray(1, 11)), 5);
    setTimeout(() => socket.write(stream.subarray(11)), 10);
  });
  const transport = await connectTcp({ port });
  context.after(() => transport.close());
  const received = [];
  transport.onFrame = (payload) => received.push(Buffer.from(payload));
  await settle(60);
  assert.deepEqual(received.map(String), payloads.map(String));
});

test("frames that arrive before anyone is listening are kept, in order", { timeout: 3000 }, async (context) => {
  const port = await listener(context, (socket) => socket.write(Buffer.concat([framed(Buffer.from("a")), framed(Buffer.from("b"))])));
  const transport = await connectTcp({ port });
  context.after(() => transport.close());
  await settle(40);
  const received = [];
  transport.onFrame = (payload) => received.push(String(payload));
  assert.deepEqual(received, ["a", "b"]);
});

test("what is sent is the payload behind its little-endian length", { timeout: 3000 }, async (context) => {
  let arrived = Buffer.alloc(0);
  const port = await listener(context, (socket) => socket.on("data", (chunk) => { arrived = Buffer.concat([arrived, chunk]); }));
  const transport = await connectTcp({ port });
  context.after(() => transport.close());
  transport.send(Buffer.from("hello"));
  await settle(40);
  assert.equal(arrived.toString("hex"), `05000000${Buffer.from("hello").toString("hex")}`);
});

test("the server hanging up is reported once", { timeout: 3000 }, async (context) => {
  let server;
  const port = await listener(context, (socket) => { server = socket; });
  const transport = await connectTcp({ port });
  const closes = [];
  transport.onClose = (error) => closes.push(error.message);
  await settle(20);
  server.destroy();
  await settle(40);
  assert.equal(closes.length, 1);
  assert.match(closes[0], /closed|ECONNRESET/);
});

test("closing it ourselves is not reported as a failure", { timeout: 3000 }, async (context) => {
  const port = await listener(context, () => {});
  const transport = await connectTcp({ port });
  const closes = [];
  transport.onClose = (error) => closes.push(error);
  transport.close();
  await settle(40);
  assert.deepEqual(closes, []);
});

test("a frame longer than the server would ever send ends the connection", { timeout: 3000 }, async (context) => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_FRAME_LENGTH + 1, 0);
  const port = await listener(context, (socket) => socket.write(header));
  const transport = await connectTcp({ port });
  const closes = [];
  transport.onClose = (error) => closes.push(error.message);
  await settle(40);
  assert.equal(closes.length, 1);
  assert.match(closes[0], /-byte frame/);
});

test("a server that is not there rejects the connect", { timeout: 3000 }, async (context) => {
  const port = await listener(context, () => {});
  // A port nothing listens on: the one we just had, closed again.
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const dead = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  await assert.rejects(connectTcp({ port: dead }));
  void port;
});

test("the game endpoint follows the gateway's host unless told otherwise", () => {
  assert.deepEqual(gameEndpoint({}), { host: "127.0.0.1", port: 26000 });
  assert.deepEqual(gameEndpoint({ EVEJS_GATEWAY_URL: "http://evejs.internal:26002/_evejs-web/v1" }), { host: "evejs.internal", port: 26000 });
  assert.deepEqual(gameEndpoint({ EVEJS_GAME_HOST: "10.0.0.5", EVEJS_GAME_PORT: "26010" }), { host: "10.0.0.5", port: 26010 });
});
