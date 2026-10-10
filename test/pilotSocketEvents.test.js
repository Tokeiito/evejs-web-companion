"use strict";

// The pushed notices on the tab's socket (src/pilotSocket.js; the plan's Phase 6a).
//
// What has to hold: the pushes on the socket are the event stream's own. The BFF's event stream route is run in
// this process for as long as the tab listens, and each frame it writes is handed on as it is written; who may
// listen, what is refused and when it ends are the route's. So the route is asked both ways here, as Server-Sent
// Events over HTTP and on the socket, and what each is sent set side by side.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const express = require("express");
const { WebSocket } = require("ws");

process.env.EVEJS_WEB_POC_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "pilot-socket-events-"));
const { CLOSE, EVENTS_PATH, SOCKET_PATH, attachPilotSocket, eventFrames, streamInProcess } = require("../src/pilotSocket");

const TOKEN = "a-web-session-token";
const AUTH = { authorization: `Bearer ${TOKEN}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits are bounded: what never comes fails its test, and does not hang the run. */
async function until(test_, waitMs = 2000) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const found = test_();
    if (found !== undefined && found !== null && found !== false) return found;
    if (Date.now() >= deadline) return null;
    await sleep(5);
  }
}

/** A small app with an event stream of the BFF's shape: authenticated, refused where nobody is flown, and held open until its request closes. */
function streamApp() {
  const app = express();
  const listeners = new Set();
  const state = { refuse: false, closes: 0, opened: 0 };
  app.disable("x-powered-by");
  const requireAuth = (req, res, next) => {
    if (req.headers.authorization !== AUTH.authorization) {
      res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
      return;
    }
    next();
  };
  app.get(EVENTS_PATH, requireAuth, (req, res) => {
    if (state.refuse === "as text") {
      res.status(503).type("text/plain").send('data: {"not":"a frame"}\n\n');
      return;
    }
    if (state.refuse) {
      res.status(409).json({ ok: false, error: "NO_LIVE_SESSION", message: "No character is online; select a character first." });
      return;
    }
    state.opened += 1;
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" });
    res.write(": open\n\n");
    listeners.add(res);
    res.write(`data: ${JSON.stringify({ type: "stream-status", state: "connecting" })}\n\n`);
    req.on("close", () => {
      state.closes += 1;
      listeners.delete(res);
    });
  });
  app.get("/api/echo", requireAuth, (req, res) => res.json({ ok: true }));
  return {
    app, listeners, state,
    /** What the stream's route writes to everyone listening, as it stands. */
    write: (text) => { for (const res of listeners) res.write(text); },
    publish(frame) { this.write(`data: ${JSON.stringify(frame)}\n\n`); },
    /** The route ends every stream itself, as it does when a session is released. */
    endAll: () => { for (const res of [...listeners]) { listeners.delete(res); res.end(); } },
  };
}

/** The stream run in process, with everything it says kept in order. */
function listened(app, request = { method: "GET", path: EVENTS_PATH, headers: AUTH }) {
  const said = [];
  const handle = streamInProcess(app, request, {
    onHead: (status) => said.push(["head", status]),
    onChunk: (buffer) => said.push(["chunk", buffer.toString("utf8")]),
    onEnd: () => said.push(["end"]),
    onError: (error) => said.push(["error", error.message]),
  });
  return { said, handle };
}

async function served(t, made = streamApp()) {
  const server = http.createServer(made.app);
  const errors = [];
  const socket = attachPilotSocket(server, made.app, { verify: (token) => token === TOKEN, onError: (error) => errors.push(error) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  t.after(async () => {
    await socket.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { ...made, made, server, socket, errors, port, wsUrl: `ws://127.0.0.1:${port}${SOCKET_PATH}` };
}

/** A tab's socket, greeted, with what it was sent after the hello kept in order. */
async function tabOn(wsUrl, token = TOKEN) {
  const ws = new WebSocket(wsUrl);
  const frames = [];
  let closed = null;
  ws.on("message", (data) => frames.push(JSON.parse(data.toString("utf8"))));
  ws.on("close", (code) => { closed = { code }; });
  ws.on("error", () => {});
  await once(ws, "open");
  ws.send(JSON.stringify({ hello: { token } }));
  const greeted = await until(() => frames.length > 0 || closed);
  assert.ok(greeted, "the socket said nothing to its hello");
  if (!closed) assert.deepEqual(frames.shift(), { hello: { ok: true } });
  const send = (frame) => ws.send(JSON.stringify(frame));
  return {
    ws, frames, send,
    closed: () => closed,
    /** Wait until this many frames have come since the hello, and hand them all back. */
    async count(n) {
      await until(() => frames.length >= n);
      return frames.slice();
    },
    async ask(frame) {
      send(frame);
      return until(() => frames.find((each) => each.id === frame.id));
    },
  };
}

const CONNECTING = { type: "stream-status", state: "connecting" };

// ── the stream, run in process ───────────────────────────────────────────────

test("the event stream run in process is its route: its status once, then each thing it writes as it writes it", () => {
  const made = streamApp();
  const { said, handle } = listened(made.app);
  // All of it before the asking returned: a route that answers at once is heard at once.
  assert.deepEqual(said, [["head", 200], ["chunk", ": open\n\n"], ["chunk", `data: ${JSON.stringify(CONNECTING)}\n\n`]]);
  assert.equal(made.listeners.size, 1);
  made.publish({ n: 1 });
  made.write(": ping\n\n");
  assert.deepEqual(said.slice(3), [["chunk", 'data: {"n":1}\n\n'], ["chunk", ": ping\n\n"]]);

  // The listener goes away: the request is told it has closed, once, and the route lets go of it.
  const response = [...made.listeners][0];
  handle.close();
  assert.deepEqual([made.state.closes, made.listeners.size], [1, 0]);
  handle.close();
  assert.equal(made.state.closes, 1);
  // What a route writes to a listener that has gone is handed to nobody, and its ending is not said.
  response.write('data: {"late":true}\n\n');
  response.end();
  assert.equal(said.length, 5);
});

test("a stream its route refuses, ends, or does not have says so once, and has nothing to close", () => {
  const made = streamApp();
  made.state.refuse = true;
  const refused = listened(made.app);
  assert.deepEqual(refused.said.map((each) => each[0]), ["head", "chunk", "end"]);
  assert.equal(refused.said[0][1], 409);
  assert.deepEqual(JSON.parse(refused.said[1][1]), { ok: false, error: "NO_LIVE_SESSION", message: "No character is online; select a character first." });
  refused.handle.close();
  assert.equal(made.state.closes, 0, "a request that was answered is not told it closed");

  // Nobody's token: the route's own refusal, as over HTTP.
  const stranger = listened(made.app, { method: "GET", path: EVENTS_PATH, headers: { authorization: "Bearer nobody's" } });
  assert.deepEqual([stranger.said[0], JSON.parse(stranger.said[1][1]), stranger.said[2]], [["head", 401], { ok: false, error: "AUTH_REQUIRED" }, ["end"]]);

  // A path no route has.
  assert.deepEqual(listened(made.app, { method: "GET", path: "/api/no-such-stream", headers: AUTH }).said, [["head", 404], ["end"]]);

  // A route that ends a stream it had opened.
  made.state.refuse = false;
  const ended = listened(made.app);
  made.endAll();
  assert.deepEqual(ended.said.slice(3), [["end"]]);
  ended.handle.close();
  assert.equal(made.state.closes, 0);

  // Something thrown outside of every handler: said, and ended as a failure.
  const thrown = listened(() => { throw new Error("outside of every handler"); });
  assert.deepEqual(thrown.said, [["error", "outside of every handler"], ["head", 500], ["end"]]);
  const passedOn = listened((req, res, next) => next(new Error("handed on")));
  assert.deepEqual(passedOn.said, [["error", "handed on"], ["head", 500], ["end"]]);
});

test("the frames in what an event stream writes: each whole record's data, and what is left for the next of it", () => {
  assert.deepEqual(eventFrames(": open\n\n"), { frames: [], rest: "" });
  assert.deepEqual(eventFrames('data: {"a":1}\n\n'), { frames: [{ a: 1 }], rest: "" });
  assert.deepEqual(eventFrames('data:{"a":1}\n\n'), { frames: [{ a: 1 }], rest: "" });
  assert.deepEqual(eventFrames('data: {"a":1}\n\n: ping\n\ndata: {"b":2}\n\n'), { frames: [{ a: 1 }, { b: 2 }], rest: "" });
  assert.deepEqual(eventFrames(': a comment\ndata: {"a":1}\n\n'), { frames: [{ a: 1 }], rest: "" });
  // A record not yet whole is kept, and read when the rest of it has come.
  const first = eventFrames('data: {"a":1}\n\ndata: {"b"');
  assert.deepEqual(first, { frames: [{ a: 1 }], rest: 'data: {"b"' });
  assert.deepEqual(eventFrames(`${first.rest}:2}\n\n`), { frames: [{ b: 2 }], rest: "" });
  assert.deepEqual(eventFrames('data: {"a":1}\n'), { frames: [], rest: 'data: {"a":1}\n' });
  // What is no frame is let pass, as the stream's own readers let it.
  assert.deepEqual(eventFrames("data: not json\n\nevent: named\n\n"), { frames: [], rest: "" });
});

// ── the stream on the socket ─────────────────────────────────────────────────

test("a tab that asks for the event stream on its socket is sent each frame of it, beside its operations", async (t) => {
  const made = await served(t);
  const tab = await tabOn(made.wsUrl);
  tab.send({ events: "open", n: 1 });
  assert.deepEqual(await tab.count(2), [{ events: { open: true, n: 1 } }, { event: CONNECTING }]);
  assert.equal(made.listeners.size, 1);

  made.publish({ source: "evejs-web-gateway", type: "event", cursor: { epoch: "e1", sequence: 1 }, event: { kind: "chat" } });
  // The stream's heartbeat is a comment: nothing of it is handed on.
  made.write(": ping\n\n");
  // A frame the route writes in two pieces, and two it writes in one.
  made.write('data: {"split":');
  made.write('true}\n\ndata: {"second":true}\n\n');
  assert.deepEqual(await tab.ask({ id: 7, method: "GET", path: "/api/echo" }), { id: 7, status: 200, body: { ok: true } });
  assert.deepEqual(tab.frames.slice(2), [
    { event: { source: "evejs-web-gateway", type: "event", cursor: { epoch: "e1", sequence: 1 }, event: { kind: "chat" } } },
    { event: { split: true } },
    { event: { second: true } },
    { id: 7, status: 200, body: { ok: true } },
  ]);
  assert.deepEqual(made.errors, []);
});

test("the stream is let go when the tab says so, when it asks for another, and when its socket closes", async (t) => {
  const made = await served(t);
  const tab = await tabOn(made.wsUrl);
  tab.send({ events: "open", n: 1 });
  await tab.count(2);

  // Closed by the tab: the route is told, nothing more is sent, and no ending is said of it.
  tab.send({ events: "close" });
  assert.ok(await until(() => made.listeners.size === 0));
  assert.equal(made.state.closes, 1);
  tab.send({ events: "close" });
  assert.equal((await tab.ask({ id: 1, method: "GET", path: "/api/echo" })).status, 200);
  assert.deepEqual(tab.frames.slice(2), [{ id: 1, status: 200, body: { ok: true } }]);
  assert.equal(made.state.closes, 1, "closing what is not attached tells nobody anything");

  // Asked for twice: the first is let go and the second attached, so the route has one listener for the socket.
  tab.send({ events: "open", n: 2 });
  tab.send({ events: "open", n: 3 });
  assert.ok(await until(() => tab.frames.some((frame) => frame.events && frame.events.n === 3)));
  await until(() => tab.frames.length >= 7);
  assert.deepEqual(tab.frames.slice(3), [{ events: { open: true, n: 2 } }, { event: CONNECTING }, { events: { open: true, n: 3 } }, { event: CONNECTING }]);
  assert.deepEqual([made.listeners.size, made.state.opened, made.state.closes], [1, 3, 2]);
  made.publish({ once: true });
  assert.equal((await tab.ask({ id: 2, method: "GET", path: "/api/echo" })).status, 200);
  assert.deepEqual(tab.frames.slice(7), [{ event: { once: true } }, { id: 2, status: 200, body: { ok: true } }]);

  // The socket closes: its stream goes with it.
  tab.ws.close();
  assert.ok(await until(() => made.listeners.size === 0));
  assert.equal(made.state.closes, 3);
});

test("a stream the route refuses or ends is said to have ended, with the route's own answer, and can be asked for again", async (t) => {
  const made = await served(t);
  const tab = await tabOn(made.wsUrl);
  made.state.refuse = true;
  tab.send({ events: "open", n: 5 });
  assert.deepEqual(await tab.count(1), [{ events: { ended: true, n: 5, status: 409, body: { ok: false, error: "NO_LIVE_SESSION", message: "No character is online; select a character first." } } }]);
  assert.equal(made.listeners.size, 0);
  // Nothing was left attached: closing tells no request anything.
  tab.send({ events: "close" });
  // What a route that refuses writes is its answer, whatever it looks like: none of it is a frame of the stream's.
  made.state.refuse = "as text";
  tab.send({ events: "open", n: 50 });
  assert.deepEqual((await tab.count(2)).slice(1), [{ events: { ended: true, n: 50, status: 503, body: 'data: {"not":"a frame"}\n\n' } }]);
  tab.frames.splice(1);

  made.state.refuse = false;
  tab.send({ events: "open" });
  assert.deepEqual((await tab.count(3)).slice(1), [{ events: { open: true, n: null } }, { event: CONNECTING }]);
  assert.equal(made.state.closes, 0);

  // The route ends it, as when the session is released.
  made.endAll();
  assert.deepEqual((await tab.count(4)).slice(3), [{ events: { ended: true, n: null, status: 200, body: null } }]);
  tab.send({ events: "open", n: 6 });
  assert.deepEqual((await tab.count(6)).slice(4), [{ events: { open: true, n: 6 } }, { event: CONNECTING }]);
  assert.deepEqual([made.listeners.size, made.state.closes], [1, 0]);
});

test("the stream is asked to open or to close and nothing else, and not before the hello", async (t) => {
  const made = await served(t);
  const tab = await tabOn(made.wsUrl);
  tab.send({ events: "maybe" });
  tab.send({ events: { open: true } });
  const bad = { id: null, error: { code: "BAD_FRAME", message: "The event stream is asked to open or to close." } };
  assert.deepEqual(await tab.count(2), [bad, bad]);
  assert.equal(made.state.opened, 0);

  const early = new WebSocket(made.wsUrl);
  early.on("error", () => {});
  await once(early, "open");
  early.send(JSON.stringify({ events: "open" }));
  const [code] = await once(early, "close");
  assert.equal(code, CLOSE.HELLO_EXPECTED);
  assert.equal(made.state.opened, 0);
});

// ── the BFF itself ───────────────────────────────────────────────────────────

const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";

/** A gateway whose pushes the test makes (as test/bridgeEvents.test.js has it). */
function fakeGateway() {
  const streams = [];
  return {
    streams,
    async selectCharacter() {
      return {
        bridgeSessionID: BRIDGE_SESSION_ID, service: "charUnboundMgr", method: "SelectCharacterID", result: null, notifications: [],
        session: { userid: 4, characterID: 7, characterName: "Test Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: 98000000, shipID: 9001 },
      };
    },
    async releaseBridgeSession() { return { released: true, characterID: 7 }; },
    async readFlightStatus() { return { flight: { docked: true, inSpace: false, stationID: 60003760, shipID: 9001 }, notifications: [] }; },
    openSessionEventStream(options) {
      const stream = { options, closed: false, emit: (frame) => options.onFrame(frame), open: () => options.onOpen?.(), close() { stream.closed = true; } };
      streams.push(stream);
      return stream;
    },
  };
}

/** The route over HTTP, as a tab's `EventSource` reads it: each frame, and how the answer ended. */
async function overHttp(base) {
  const controller = new AbortController();
  const response = await fetch(`${base}${EVENTS_PATH}`, { headers: AUTH, signal: controller.signal });
  const frames = [];
  let unread = "";
  let ended = false;
  const reader = response.body.getReader();
  const pump = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const read = eventFrames(unread + Buffer.from(chunk.value).toString("utf8"));
        unread = read.rest;
        frames.push(...read.frames);
      }
      ended = true;
    } catch {
      // Given up on by the test.
    }
  })();
  return { status: response.status, frames, ended: () => ended, async close() { try { await reader.cancel(); } catch { /* ended */ } controller.abort(); await pump; } };
}

test("the BFF's own event stream on the socket: a tab there is sent what a tab over HTTP is sent, and counts as one more listener", async (t) => {
  const { createApp, startServer } = require("../src/server");
  const gateway = fakeGateway();
  const app = createApp({
    bridgeSessionStore: new Map(),
    webAuth: {
      createSessionToken: () => TOKEN,
      verifySessionToken: (token) => (token === TOKEN ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: "a-web-session" } : null),
    },
    eveStore: {
      async getAccount(name) { return name === ACCOUNT.username ? { ...ACCOUNT } : null; },
      async getCharacterForAccount(accountID, characterID) { return Number(accountID) === 4 && Number(characterID) === 7 ? { characterID: 7, accountID: 4, characterName: "Test Pilot" } : null; },
      async listCharactersForAccount() { return [{ characterID: 7, accountID: 4, characterName: "Test Pilot" }]; },
    },
    eveGatewayClient: gateway,
    staticData: { getStation: () => null, getTypeName: (id) => `Type ${id}` },
    errorLogger() {},
  });
  const server = startServer({ app, host: "127.0.0.1", port: 0, silent: true, resumeServerBots: false });
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); if (server.listening) server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tab = await tabOn(`ws://127.0.0.1:${server.address().port}${SOCKET_PATH}`);

  // Nobody flown yet: the route's refusal, the same both ways.
  const refusedOverHttp = await fetch(`${base}${EVENTS_PATH}`, { headers: AUTH });
  tab.send({ events: "open", n: 1 });
  assert.deepEqual(await tab.count(1), [{ events: { ended: true, n: 1, status: refusedOverHttp.status, body: await refusedOverHttp.json() } }]);
  assert.equal(tab.frames[0].events.body.error, "NO_LIVE_SESSION");

  // A pilot chosen, on the socket.
  const selected = await tab.ask({ id: 1, method: "POST", path: "/api/bridge/select", body: { characterID: 7 } });
  assert.equal(selected.status, 200);
  assert.equal((await tab.ask({ id: 2, method: "POST", path: "/api/bridge/drone-recovery/ready", body: { checkID: selected.body.droneRecoveryCheckID } })).status, 200);
  const before = tab.frames.length;
  const since = () => tab.frames.slice(before);

  // Listened to on the socket: the route's first frame, and the one gateway stream opened for the held pilot.
  tab.send({ events: "open", n: 2 });
  assert.ok(await until(() => since().length >= 2));
  assert.deepEqual(since(), [{ events: { open: true, n: 2 } }, { event: { source: "evejs-web-bff", type: "stream-status", state: "connecting", detail: null } }]);
  assert.equal(gateway.streams.length, 1);
  assert.deepEqual([gateway.streams[0].options.bridgeSessionID, gateway.streams[0].options.userid, gateway.streams[0].options.cursor], [BRIDGE_SESSION_ID, 4, null]);

  // A tab over HTTP beside it: the same held stream, and from here the same frames.
  const other = await overHttp(base);
  assert.equal(other.status, 200);
  assert.ok(await until(() => other.frames.length >= 1));
  assert.equal(gateway.streams.length, 1, "one gateway stream for the held pilot, however it is listened to");
  const socketFrom = since().length;
  const httpFrom = other.frames.length;
  gateway.streams[0].open();
  const pushed = { source: "evejs-web-gateway", type: "event", cursor: { epoch: "e1", sequence: 3 }, event: { kind: "notification", notification: { kind: "service", name: "OnItemChange" } } };
  gateway.streams[0].emit(pushed);
  assert.ok(await until(() => since().length >= socketFrom + 2 && other.frames.length >= httpFrom + 2));
  const onSocket = since().slice(socketFrom).map((frame) => frame.event);
  assert.deepEqual(onSocket, other.frames.slice(httpFrom));
  assert.deepEqual(onSocket, [{ source: "evejs-web-bff", type: "stream-status", state: "live", detail: null }, pushed]);
  // The held session's handle is the BFF's, and is in nothing a tab is sent.
  assert.ok(!JSON.stringify(tab.frames).includes(BRIDGE_SESSION_ID));

  // The tab over HTTP leaves: the socket is still a listener, so the gateway's stream stays.
  await other.close();
  await sleep(50);
  assert.equal(gateway.streams[0].closed, false);
  // The socket's tab stops listening: nobody is, and the gateway's stream is closed.
  tab.send({ events: "close" });
  assert.ok(await until(() => gateway.streams[0].closed));

  // Listened to again: a new gateway stream, from where the last one had got to.
  tab.send({ events: "open", n: 3 });
  assert.ok(await until(() => gateway.streams.length === 2));
  assert.deepEqual(gateway.streams[1].options.cursor, { epoch: "e1", sequence: 3 });

  // The pilot released: the stream's last frame says so, and then that it has ended; the reply to the release is after both.
  const mark = tab.frames.length;
  assert.equal((await tab.ask({ id: 3, method: "POST", path: "/api/bridge/release", body: {} })).status, 200);
  const last = tab.frames.slice(mark).filter((frame) => frame.id === 3 || frame.events || (frame.event && frame.event.state === "ended"));
  assert.deepEqual(last.map((frame) => (frame.id === 3 ? "reply" : frame.events ? frame.events : frame.event.detail)), ["session_released", { ended: true, n: 3, status: 200, body: null }, "reply"]);
  assert.equal(gateway.streams[1].closed, true);
});
