"use strict";

// The gateway push socket's own failure handling, against a real WebSocket
// server. Two regressions live here:
//
//   * a constructor failure used to report onClose SYNCHRONOUSLY, before the
//     caller could store the returned handle — server.js would then write the
//     dead handle over the null the close handler had just set, and the
//     channel wedged in "degraded" forever with no retry;
//   * nothing detected a half-open upstream socket. The gateway pings us and
//     `ws` auto-answers, but a silently dead TCP connection (sleeping host,
//     NAT reap) never fires `close`, so the retry loop never started and the
//     browser trusted a dead channel indefinitely. The stream now pings the
//     gateway itself and terminates — into the normal retried close path —
//     when a whole interval passes silent.

const test = require("node:test");
const assert = require("node:assert/strict");
const { WebSocketServer } = require("ws");

const { openSessionEventStream } = require("../src/eveGatewayClient");

const GATEWAY_PATH = "/_evejs-web/v1/session-events";

function listen(server) {
  return new Promise((resolve) => {
    server.on("listening", () => resolve(server.address().port));
  });
}

async function startGateway(t, options = {}) {
  const wss = new WebSocketServer({
    autoPong: options.autoPong !== false,
    host: "127.0.0.1",
    path: GATEWAY_PATH,
    port: 0,
  });
  const port = await listen(wss);
  t.after(() => new Promise((resolve) => wss.close(() => resolve())));
  const originalUrl = process.env.EVEJS_GATEWAY_URL;
  process.env.EVEJS_GATEWAY_URL = `http://127.0.0.1:${port}/_evejs-web/v1`;
  t.after(() => {
    if (originalUrl === undefined) {
      delete process.env.EVEJS_GATEWAY_URL;
    } else {
      process.env.EVEJS_GATEWAY_URL = originalUrl;
    }
  });
  return wss;
}

test("a constructor failure reports close asynchronously, after the handle exists", async (t) => {
  const originalUrl = process.env.EVEJS_GATEWAY_URL;
  process.env.EVEJS_GATEWAY_URL = "not-a-gateway-url";
  t.after(() => {
    if (originalUrl === undefined) {
      delete process.env.EVEJS_GATEWAY_URL;
    } else {
      process.env.EVEJS_GATEWAY_URL = originalUrl;
    }
  });

  let closeDetails = null;
  let handleAssigned = false;
  const closed = new Promise((resolve) => {
    const handle = openSessionEventStream({
      bridgeSessionID: "session",
      userid: 4,
      onClose(details) {
        // The caller must already hold the handle when this fires; the
        // synchronous ordering is exactly what wedged the channel.
        assert.equal(handleAssigned, true);
        closeDetails = details;
        resolve();
      },
    });
    assert.equal(typeof handle.close, "function");
    handleAssigned = true;
  });
  await closed;
  assert.equal(closeDetails.code, 0);
  assert.ok(String(closeDetails.reason).length > 0);
});

test("the ping watchdog terminates a half-open stream into the close path", async (t) => {
  const wss = await startGateway(t, { autoPong: false });
  const serverSockets = [];
  wss.on("connection", (socket) => {
    serverSockets.push(socket);
  });

  let opened = false;
  const closeDetails = await new Promise((resolve) => {
    openSessionEventStream({
      bridgeSessionID: "session",
      userid: 4,
      pingIntervalMs: 40,
      onOpen() {
        opened = true;
      },
      onClose: resolve,
    });
  });

  assert.equal(opened, true, "the stream must open before the watchdog runs");
  assert.equal(closeDetails.reason, "ping timeout");
  assert.equal(serverSockets.length, 1);
});

test("a healthy stream survives the watchdog and still delivers frames", async (t) => {
  const wss = await startGateway(t);
  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        source: "evejs-web-gateway",
        type: "event",
        cursor: { epoch: "e1", sequence: 1 },
        event: { kind: "test" },
      }),
    );
  });

  const frames = [];
  let closeDetails = null;
  let handle = null;
  const firstFrame = new Promise((resolve) => {
    handle = openSessionEventStream({
      bridgeSessionID: "session",
      userid: 4,
      pingIntervalMs: 25,
      onFrame(frame) {
        frames.push(frame);
        resolve();
      },
      onClose(details) {
        closeDetails = details;
      },
    });
  });
  await firstFrame;

  // Several watchdog intervals with the server answering pongs: no false kill.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(closeDetails, null, "a pong-answering stream must not be killed");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event.kind, "test");

  handle.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
});
