"use strict";

// The one socket between a tab and the BFF (src/pilotSocket.js; the plan's Phase 6a, first slice).
//
// What has to hold: an operation carried on the socket is its route, unchanged. So each thing is asked both
// ways here, over HTTP and in process, and the answers set side by side.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const express = require("express");
const { WebSocket } = require("ws");

process.env.EVEJS_WEB_POC_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "pilot-socket-"));
const { CLOSE, MAX_FRAME_BYTES, SOCKET_PATH, attachPilotSocket, dispatchInProcess, isOperationPath } = require("../src/pilotSocket");

const TOKEN = "a-web-session-token";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A small app with the shapes the BFF's routes have: authenticated reads and writes, a slow one, one that throws, one that is no JSON. */
function smallApp() {
  const app = express();
  const seen = [];
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1kb" }));
  const requireAuth = (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
      return;
    }
    next();
  };
  app.get("/api/echo", requireAuth, (req, res) => {
    seen.push(["GET /api/echo", { ...req.query }, req.headers["content-type"] ?? null, req.body ?? null]);
    res.json({ ok: true, query: req.query, from: req.ip, authorized: true, odd: req.headers["x-odd"] ?? null });
  });
  // A route that is still at work after its body has been read: the request must not have been taken for one cut off.
  app.post("/api/late", requireAuth, async (req, res) => {
    await sleep(20);
    res.json({ ok: true, got: req.body, cutOff: req.aborted === true });
  });
  app.post("/api/echo", requireAuth, (req, res) => {
    seen.push(["POST /api/echo", req.body]);
    res.status(201).json({ ok: true, got: req.body });
  });
  app.get("/api/slow", requireAuth, async (req, res) => {
    await sleep(60);
    res.json({ ok: true, slow: true });
  });
  app.get("/api/throws", requireAuth, () => {
    throw Object.assign(new Error("The route's own refusal."), { code: "CALL_REFUSED", statusCode: 409 });
  });
  app.get("/api/text", (req, res) => res.type("text/plain").send("not json"));
  app.post("/api/nothing", (req, res) => res.status(204).end());
  app.get("/api/bridge/events", (req, res) => res.json({ ok: true, stream: true }));
  // The BFF's own last handler, in small: an error becomes its status and its code.
  app.use((error, req, res, next) => {
    void next;
    const status = Number.isFinite(error && (error.statusCode ?? error.status)) ? error.statusCode ?? error.status : 500;
    res.status(status).json({ ok: false, error: error.code || error.type || "SERVER_ERROR", message: error.message });
  });
  return { app, seen };
}

async function served(t, attach = {}) {
  const { app, seen } = smallApp();
  const server = http.createServer(app);
  const errors = [];
  const socket = attachPilotSocket(server, app, { verify: (token) => token === TOKEN, onError: (error) => errors.push(error), ...attach });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  t.after(async () => {
    await socket.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { app, seen, server, socket, errors, port, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}${SOCKET_PATH}` };
}

/** Over HTTP, as a tab asks today. */
async function overHttp(base, method, route, body, token = TOKEN) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = text;
  try { parsed = text === "" ? null : JSON.parse(text); } catch { /* text it is */ }
  return { status: response.status, body: parsed };
}

/** In process, as the socket carries it. */
async function inProcess(app, method, route, body, token = TOKEN) {
  const answer = await dispatchInProcess(app, { method, path: route, body, headers: token ? { Authorization: `Bearer ${token}` } : {}, remoteAddress: "127.0.0.1" });
  const text = answer.body.toString("utf8");
  let parsed = text;
  try { parsed = text === "" ? null : JSON.parse(text); } catch { /* text it is */ }
  return { status: answer.status, body: parsed };
}

/** A socket opened, with what it was sent kept in order and a way to wait for the next of it. */
async function opened(wsUrl, hello = { hello: { token: TOKEN } }) {
  const ws = new WebSocket(wsUrl);
  const frames = [];
  const waiters = [];
  let closed = null;
  ws.on("message", (data) => {
    frames.push(JSON.parse(data.toString("utf8")));
    for (const waiter of waiters.splice(0)) waiter();
  });
  ws.on("close", (code, reason) => {
    closed = { code, reason: reason.toString("utf8") };
    for (const waiter of waiters.splice(0)) waiter();
  });
  ws.on("error", () => {});
  await once(ws, "open");
  // Waits are bounded: a socket that never says what is waited for fails its test, and does not hang the run.
  const until = async (test, waitMs = 2000) => {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const found = test();
      if (found !== undefined && found !== null && found !== false) return found;
      if (closed || Date.now() >= deadline) return null;
      await Promise.race([new Promise((resolve) => waiters.push(resolve)), sleep(Math.max(1, deadline - Date.now()))]);
    }
  };
  if (hello !== null) ws.send(typeof hello === "string" ? hello : JSON.stringify(hello));
  return {
    ws, frames, until,
    closing: () => until(() => closed),
    said: (test) => until(() => frames.find(test)),
    ask: async (frame) => { ws.send(JSON.stringify(frame)); return until(() => frames.find((each) => each.id === frame.id)); },
  };
}

// ── an operation run in process ──────────────────────────────────────────────

test("an operation run in process is its route: the same status and the same answer as over HTTP, for each shape of route", async (t) => {
  const { app, base, seen } = await served(t);
  for (const [method, route, body] of [
    ["GET", "/api/echo?a=1&b=two", undefined],
    ["POST", "/api/echo", { characterID: 140000002, confirm: true, nested: { list: [1, 2, 3] } }],
    ["POST", "/api/echo", {}],
    ["POST", "/api/late", { after: "the body" }],
    ["GET", "/api/throws", undefined],
    ["GET", "/api/text", undefined],
    ["POST", "/api/nothing", undefined],
    ["GET", "/api/no-such-route", undefined],
    ["POST", "/api/echo", { big: "x".repeat(2000) }],
  ]) {
    const [http_, here] = [await overHttp(base, method, route, body), await inProcess(app, method, route, body)];
    if (route === "/api/no-such-route") {
      // Over HTTP an unanswered path is Express's own page; in process it is said as the BFF says a refusal.
      assert.deepEqual([http_.status, here.status, here.body], [404, 404, { ok: false, error: "NOT_FOUND" }]);
      continue;
    }
    assert.deepEqual(here, http_, `${method} ${route}`);
  }
  // What each kind answered, so that "the same" is not the same nothing.
  assert.deepEqual(await inProcess(app, "GET", "/api/echo?a=1&b=two"), { status: 200, body: { ok: true, query: { a: "1", b: "two" }, from: "127.0.0.1", authorized: true, odd: null } });
  assert.deepEqual(await inProcess(app, "POST", "/api/late", { after: "the body" }), { status: 200, body: { ok: true, got: { after: "the body" }, cutOff: false } });
  assert.deepEqual(await inProcess(app, "POST", "/api/echo", { n: 1 }), { status: 201, body: { ok: true, got: { n: 1 } } });
  assert.deepEqual(await inProcess(app, "GET", "/api/throws"), { status: 409, body: { ok: false, error: "CALL_REFUSED", message: "The route's own refusal." } });
  assert.deepEqual(await inProcess(app, "GET", "/api/text"), { status: 200, body: "not json" });
  assert.deepEqual(await inProcess(app, "POST", "/api/nothing"), { status: 204, body: null });
  // A body too big for the app's own parser is the app's refusal, in process as over HTTP.
  assert.equal((await inProcess(app, "POST", "/api/echo", { big: "x".repeat(2000) })).status, 413);
  // A read is sent no body, whatever was handed in with it.
  seen.length = 0;
  await dispatchInProcess(app, { method: "get", path: "/api/echo", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.deepEqual(seen, [["GET /api/echo", {}, null, null]]);
});

test("a route authenticates an operation run in process as it does a request: by the header it is given", async (t) => {
  const { app, base } = await served(t);
  for (const token of [null, "somebody-else"]) {
    assert.deepEqual(await inProcess(app, "GET", "/api/echo", undefined, token), await overHttp(base, "GET", "/api/echo", undefined, token));
    assert.deepEqual(await inProcess(app, "GET", "/api/echo", undefined, token), { status: 401, body: { ok: false, error: "AUTH_REQUIRED" } });
  }
  // Who is asking is the address handed in, and a header that is no text is not passed on.
  const answer = await dispatchInProcess(app, { method: "GET", path: "/api/echo", headers: { authorization: `Bearer ${TOKEN}`, "x-odd": 7 }, remoteAddress: "10.1.2.3" });
  assert.deepEqual([JSON.parse(answer.body.toString("utf8")).from, JSON.parse(answer.body.toString("utf8")).odd], ["10.1.2.3", null]);
  // A header that is text is passed on, under its name in small letters.
  const passed = await dispatchInProcess(app, { method: "GET", path: "/api/echo", headers: { AUTHORIZATION: `Bearer ${TOKEN}`, "X-Odd": "seven" } });
  assert.equal(JSON.parse(passed.body.toString("utf8")).odd, "seven");
});

test("what is an operation: the BFF's own API, and not the event stream or the socket itself", () => {
  assert.deepEqual(["/api/bridge/select", "/api/bots/active", "/api/echo?a=1", "/api/bridge/events/more"].map(isOperationPath), [true, true, true, true]);
  assert.deepEqual(["/api/bridge/events", "/api/bridge/events?access_token=x", SOCKET_PATH, `${SOCKET_PATH}?x=1`, "/", "/index.html", "api/echo", "//evil/api/", "/api/x\r\nHost: y", "", null, 7].map(isOperationPath),
    [false, false, false, false, false, false, false, false, false, false, false, false]);
  assert.equal(MAX_FRAME_BYTES, 262144);
});

// ── the socket ───────────────────────────────────────────────────────────────

test("a socket says hello with its web session's token and is then answered; without one it is closed", async (t) => {
  const { wsUrl, socket } = await served(t, { helloWaitMs: 80 });
  const good = await opened(wsUrl);
  assert.deepEqual(await good.said((frame) => frame.hello), { hello: { ok: true } });
  assert.equal(socket.sockets(), 1);

  // A token that is nobody's, and no token.
  for (const hello of [{ hello: { token: "nobody's" } }, { hello: {} }, { hello: { token: 7 } }]) {
    const refused = await opened(wsUrl, hello);
    assert.deepEqual(await refused.closing(), { code: CLOSE.NOT_AUTHENTICATED, reason: "not authenticated" }, JSON.stringify(hello));
    assert.deepEqual(refused.frames, []);
  }
  // Something else said first, or what is no JSON: the hello was expected.
  for (const first of [{ id: 1, method: "GET", path: "/api/echo" }, "not json", "[]"]) {
    const wrong = await opened(wsUrl, first);
    assert.deepEqual(await wrong.closing(), { code: CLOSE.HELLO_EXPECTED, reason: "hello expected" }, JSON.stringify(first));
    assert.deepEqual(wrong.frames, []);
  }
  // Nothing said at all: closed when the wait is up.
  const silent = await opened(wsUrl, null);
  assert.deepEqual(await silent.closing(), { code: CLOSE.HELLO_EXPECTED, reason: "hello expected" });
  // The first one is still open, and still answered.
  assert.deepEqual(await good.ask({ id: "after", method: "GET", path: "/api/echo" }), { id: "after", status: 200, body: { ok: true, query: {}, from: "127.0.0.1", authorized: true, odd: null } });
});

test("an operation on the socket is answered as its route answers over HTTP, by the id it was asked with", async (t) => {
  const { wsUrl, base, seen } = await served(t);
  const tab = await opened(wsUrl);
  await tab.said((frame) => frame.hello);
  let id = 0;
  for (const [method, route, body] of [
    ["GET", "/api/echo?a=1", undefined],
    ["POST", "/api/echo", { characterID: 140000002, confirm: true }],
    ["GET", "/api/throws", undefined],
    ["GET", "/api/text", undefined],
    ["POST", "/api/nothing", undefined],
  ]) {
    id += 1;
    const [answer, same] = [await tab.ask({ id, method, path: route, body }), await overHttp(base, method, route, body)];
    assert.deepEqual(answer, { id, status: same.status, body: same.body }, `${method} ${route}`);
  }
  // The route is authenticated with the token of the hello: the socket's frames carry none.
  assert.deepEqual(seen.filter((each) => each[0] === "POST /api/echo").length, 2);
  // A method said in small letters is the same method; a read's body is not sent on.
  seen.length = 0;
  assert.equal((await tab.ask({ id: "small", method: "get", path: "/api/echo", body: { ignored: true } })).status, 200);
  assert.deepEqual(seen, [["GET /api/echo", {}, null, null]]);
  // A path no route has, on the socket: the BFF's refusal, not a page.
  assert.deepEqual(await tab.ask({ id: "none", method: "GET", path: "/api/no-such-route" }), { id: "none", status: 404, body: { ok: false, error: "NOT_FOUND" } });
});

test("replies come as their routes finish, each with its own id", async (t) => {
  const { wsUrl } = await served(t);
  const tab = await opened(wsUrl);
  await tab.said((frame) => frame.hello);
  tab.ws.send(JSON.stringify({ id: "slow", method: "GET", path: "/api/slow" }));
  tab.ws.send(JSON.stringify({ id: "quick", method: "GET", path: "/api/echo" }));
  await tab.said((frame) => frame.id === "slow");
  assert.deepEqual(tab.frames.filter((frame) => frame.id).map((frame) => [frame.id, frame.status]), [["quick", 200], ["slow", 200]]);
});

test("a frame that is no operation is said so, and the socket stays open", async (t) => {
  const { wsUrl, seen } = await served(t);
  const tab = await opened(wsUrl);
  await tab.said((frame) => frame.hello);
  const count = () => tab.frames.length;
  const next = async (send) => { const before = count(); send(); return tab.until(() => (count() > before ? tab.frames[tab.frames.length - 1] : null)); };

  assert.deepEqual(await next(() => tab.ws.send("not json")), { id: null, error: { code: "BAD_FRAME", message: "A frame is a JSON object, sent as text." } });
  assert.deepEqual(await next(() => tab.ws.send("[1,2]")), { id: null, error: { code: "BAD_FRAME", message: "A frame is a JSON object, sent as text." } });
  assert.deepEqual(await next(() => tab.ws.send(Buffer.from([1, 2, 3]))), { id: null, error: { code: "BAD_FRAME", message: "A frame is a JSON object, sent as text." } });
  const noOperation = { code: "BAD_FRAME", message: "An operation has an id, a method and a path." };
  assert.deepEqual(await tab.ask({ id: 1, method: "TRACE", path: "/api/echo" }), { id: 1, error: noOperation });
  assert.deepEqual(await tab.ask({ id: 2, path: "/api/echo" }), { id: 2, error: noOperation });
  assert.deepEqual(await tab.ask({ id: 3, method: "GET" }), { id: 3, error: noOperation });
  assert.deepEqual(await next(() => tab.ws.send(JSON.stringify({ method: "GET", path: "/api/echo" }))), { id: null, error: noOperation });
  assert.deepEqual(await next(() => tab.ws.send(JSON.stringify({ id: { not: "an id" }, method: "GET", path: "/api/echo" }))), { id: null, error: noOperation });
  const notOurs = { code: "NOT_AN_OPERATION", message: "Only the BFF's own API is carried, and the event stream is not an operation." };
  for (const [id, path_] of [[4, "/index.html"], [5, "/api/bridge/events"], [6, SOCKET_PATH], [7, "http://elsewhere/api/echo"]]) {
    assert.deepEqual(await tab.ask({ id, method: "GET", path: path_ }), { id, error: notOurs }, path_);
  }
  // None of it reached a route, and the socket still answers.
  assert.deepEqual(seen, []);
  assert.equal((await tab.ask({ id: 8, method: "GET", path: "/api/echo" })).status, 200);
});

test("nothing else of the server's is a socket, and a closed server's sockets are closed with it", async (t) => {
  const { wsUrl, port, socket, server } = await served(t);
  const elsewhere = new WebSocket(`ws://127.0.0.1:${port}/api/bridge/events`);
  const refused = await new Promise((resolve) => {
    elsewhere.on("unexpected-response", (request, response) => resolve(response.statusCode));
    elsewhere.on("error", () => resolve("error"));
    elsewhere.on("open", () => resolve("opened"));
    setTimeout(() => resolve("left hanging"), 1000).unref();
  });
  elsewhere.terminate();
  assert.equal(refused, 404);
  const tab = await opened(wsUrl);
  await tab.said((frame) => frame.hello);
  assert.equal(socket.sockets(), 1);
  assert.equal(server.listenerCount("upgrade"), 1);
  await socket.close();
  assert.ok(await tab.closing());
  assert.equal(socket.sockets(), 0);
  // It has let go of the server's upgrades too: served again later, it would otherwise answer each one twice.
  assert.equal(server.listenerCount("upgrade"), 0);
  // And no new one is taken: the upgrade is no longer the socket's to answer.
  const late = new WebSocket(wsUrl);
  const outcome = await new Promise((resolve) => { late.on("open", () => resolve("opened")); late.on("error", () => resolve("refused")); setTimeout(() => resolve("left hanging"), 400).unref(); });
  late.terminate();
  assert.notEqual(outcome, "opened");
});

// ── the BFF itself ───────────────────────────────────────────────────────────

test("the BFF serves the socket beside its routes: a tab's operation there is the route's answer, authenticated as the route does it", async (t) => {
  const { createApp, startServer } = require("../src/server");
  const ACCOUNT = { username: "test2", accountID: 2, role: "0", banned: false };
  const characters = [{ accountID: 2, characterID: 140000002, characterName: "Test Two", corporationID: 1000044, corporationName: "A School" }];
  const app = createApp({
    bridgeSessionStore: new Map(),
    webAuth: {
      createSessionToken: () => TOKEN,
      verifySessionToken: (token) => (token === TOKEN ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: "a-web-session" } : null),
    },
    eveStore: {
      async getAccount(name) { return name === ACCOUNT.username ? { ...ACCOUNT } : null; },
      async listCharactersForAccount(accountID) { return Number(accountID) === 2 ? characters : []; },
      async getCharacterForAccount() { return null; },
    },
    eveGatewayClient: {},
    errorLogger() {},
  });
  const server = startServer({ app, host: "127.0.0.1", port: 0, silent: true, resumeServerBots: false });
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); if (server.listening) server.close(); });
  const { port } = server.address();
  assert.equal(server.pilotSocket.path, SOCKET_PATH);

  // A token that is no web session's is turned away at the hello.
  const stranger = await opened(`ws://127.0.0.1:${port}${SOCKET_PATH}`, { hello: { token: "nobody's" } });
  assert.equal((await stranger.closing()).code, CLOSE.NOT_AUTHENTICATED);

  const tab = await opened(`ws://127.0.0.1:${port}${SOCKET_PATH}`);
  assert.deepEqual(await tab.said((frame) => frame.hello), { hello: { ok: true } });
  const route = "/api/pilot-training/characters";
  const viaSocket = await tab.ask({ id: 1, method: "GET", path: route });
  const viaHttp = await overHttp(`http://127.0.0.1:${port}`, "GET", route);
  assert.deepEqual(viaSocket, { id: 1, status: viaHttp.status, body: viaHttp.body });
  assert.deepEqual(viaSocket.body, { ok: true, account: "test2", characters: [{ characterID: 140000002, name: "Test Two", corporationID: 1000044, corporationName: "A School" }] });
  // A route that wants a pilot held says so on the socket as it does over HTTP.
  const unheld = await tab.ask({ id: 2, method: "GET", path: "/api/bridge/flight/status" });
  assert.deepEqual([unheld.status, unheld.body], [(await overHttp(`http://127.0.0.1:${port}`, "GET", "/api/bridge/flight/status")).status, (await overHttp(`http://127.0.0.1:${port}`, "GET", "/api/bridge/flight/status")).body]);
  assert.ok(unheld.status >= 400);

  // A server that is closing closes its sockets as the closing begins. Left open, the tab's socket is a
  // connection the server would wait on for ever: its closing would never be done.
  assert.equal(server.pilotSocket.sockets(), 1);
  const done = await Promise.race([new Promise((resolve) => server.close(() => resolve("closed"))), sleep(3000).then(() => "still closing after three seconds")]);
  assert.equal(done, "closed");
  assert.ok(await tab.closing());
  // (The server's own count of them falls as each closing is done, a moment after the tab has seen its end.)
  for (let waited = 0; waited < 500 && server.pilotSocket.sockets() > 0; waited += 10) await sleep(10);
  assert.equal(server.pilotSocket.sockets(), 0);
});
