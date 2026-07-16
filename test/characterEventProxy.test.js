"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { once } = require("events");
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;

const ORIGINAL_DATA_DIR = process.env.EVEJS_WEB_POC_DATA_DIR;
const ORIGINAL_GATEWAY_URL = process.env.EVEJS_GATEWAY_URL;
const ORIGINAL_GATEWAY_TOKEN = process.env.EVEJS_WEB_GATEWAY_TOKEN;
const TEMPORARY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-events-"));
process.env.EVEJS_WEB_POC_DATA_DIR = TEMPORARY_DATA_DIR;

const webAuth = require("../src/webAuth");
const { createApp, startServer } = require("../src/server");
const {
  acceptsNextCursor,
  parseGatewayFrame,
  validateGatewayFrame,
} = require("../src/characterEventProxy");

const ACCOUNT = Object.freeze({
  username: "event-pilot",
  accountID: 42,
  role: 0,
  banned: false,
});
const CHARACTER_ID = 90000001;
const EVENT_EPOCH = "event_epoch_0123456789abcdef";
const STATE_VERSION = "command_epoch_0123456789abcdef:4";
const GATEWAY_TOKEN = "server-only-gateway-token";

test.after(() => {
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.EVEJS_WEB_POC_DATA_DIR;
  } else {
    process.env.EVEJS_WEB_POC_DATA_DIR = ORIGINAL_DATA_DIR;
  }
  if (ORIGINAL_GATEWAY_URL === undefined) {
    delete process.env.EVEJS_GATEWAY_URL;
  } else {
    process.env.EVEJS_GATEWAY_URL = ORIGINAL_GATEWAY_URL;
  }
  if (ORIGINAL_GATEWAY_TOKEN === undefined) {
    delete process.env.EVEJS_WEB_GATEWAY_TOKEN;
  } else {
    process.env.EVEJS_WEB_GATEWAY_TOKEN = ORIGINAL_GATEWAY_TOKEN;
  }
  fs.rmSync(TEMPORARY_DATA_DIR, { recursive: true, force: true });
});

function offlineControl() {
  return {
    online: false,
    controlState: "offline",
    transport: null,
    leaseExpiresAt: null,
  };
}

function commandOutcome(overrides = {}) {
  return {
    commandID: "command-1",
    commandType: "offline.skill_queue.save",
    success: true,
    errorCode: null,
    admissionStatus: "admitted",
    stateVersion: STATE_VERSION,
    ...overrides,
  };
}

function snapshotFrame(sequence = 0, overrides = {}) {
  return {
    source: "evejs-web-gateway",
    apiVersion: 1,
    streamVersion: 1,
    type: "snapshot",
    characterID: CHARACTER_ID,
    cursor: { epoch: EVENT_EPOCH, sequence },
    control: offlineControl(),
    stateVersion: STATE_VERSION,
    commandOutcomes: [],
    ...overrides,
  };
}

function settlementFrame(sequence, overrides = {}) {
  return {
    source: "evejs-web-gateway",
    apiVersion: 1,
    streamVersion: 1,
    type: "event",
    characterID: CHARACTER_ID,
    cursor: { epoch: EVENT_EPOCH, sequence },
    event: {
      kind: "command_settled",
      ...commandOutcome(),
      ...overrides,
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakeStore(overrides = {}) {
  return {
    async getAccount(username) {
      return username === ACCOUNT.username ? { ...ACCOUNT } : null;
    },
    async getCharacterForAccount(accountID, characterID) {
      return Number(accountID) === ACCOUNT.accountID && Number(characterID) === CHARACTER_ID
        ? { accountID: ACCOUNT.accountID, characterID: CHARACTER_ID }
        : null;
    },
    ...overrides,
  };
}

async function closeHttpServer(server) {
  if (!server || !server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function startGateway(onConnection = () => {}) {
  const requests = [];
  const clients = new Set();
  const webSocketServer = new WebSocketServer({ noServer: true });
  const server = http.createServer((request, response) => {
    response.writeHead(404).end();
  });
  server.on("upgrade", (request, socket, head) => {
    requests.push(request);
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      clients.add(webSocket);
      webSocket.once("close", () => clients.delete(webSocket));
      onConnection(webSocket, request);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    clients,
    requests,
    server,
    url: `http://127.0.0.1:${address.port}/_evejs-web/v1`,
    async close() {
      for (const client of clients) {
        client.terminate();
      }
      webSocketServer.close();
      await closeHttpServer(server);
    },
  };
}

async function startDelayedGateway(delayMs) {
  const requests = [];
  const clients = new Set();
  const webSocketServer = new WebSocketServer({ noServer: true });
  const server = http.createServer();
  server.on("upgrade", (request, socket, head) => {
    requests.push(request);
    setTimeout(() => {
      if (socket.destroyed) {
        return;
      }
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        clients.add(webSocket);
        webSocket.once("close", () => clients.delete(webSocket));
      });
    }, delayMs);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    clients,
    requests,
    url: `http://127.0.0.1:${address.port}/_evejs-web/v1`,
    async close() {
      for (const client of clients) {
        client.terminate();
      }
      webSocketServer.close();
      await closeHttpServer(server);
    },
  };
}

async function startBff(store = fakeStore(), proxyOptions = {}) {
  const app = createApp({
    eveStore: store,
    webAuth,
  });
  const server = startServer({
    app,
    host: "127.0.0.1",
    port: 0,
    silent: true,
    characterEventProxyOptions: proxyOptions,
  });
  await once(server, "listening");
  const address = server.address();
  const authority = `127.0.0.1:${address.port}`;
  return {
    authority,
    origin: `http://${authority}`,
    server,
    url: `ws://${authority}`,
    async close() {
      await closeHttpServer(server);
    },
  };
}

function signedCookie() {
  return `${require("../src/config").sessionCookieName}=${webAuth.createSessionToken(ACCOUNT)}`;
}

function nearExpirySignedSession(remainingMs) {
  const token = webAuth.createSessionToken(ACCOUNT);
  const payload = webAuth.verifySessionToken(token);
  const wallStart = Date.now();
  const simulatedStart = payload.exp - remainingMs;
  return {
    cookie: `${require("../src/config").sessionCookieName}=${token}`,
    now: () => simulatedStart + (Date.now() - wallStart),
  };
}

async function openBrowserSocket(url, options = {}) {
  const messages = [];
  const webSocket = new WebSocket(url, {
    autoPong: options.autoPong !== false,
    origin: options.origin,
    headers: {
      Cookie: options.cookie || signedCookie(),
    },
  });
  webSocket.on("message", (data) => messages.push(data.toString("utf8")));
  await once(webSocket, "open");
  return { messages, webSocket };
}

async function rejectedUpgrade(url, options = {}) {
  return new Promise((resolve, reject) => {
    const webSocketOptions = {
      headers: {
        Cookie: options.cookie || signedCookie(),
      },
    };
    if (options.origin !== null) {
      webSocketOptions.origin = options.origin;
    }
    const webSocket = new WebSocket(url, webSocketOptions);
    const timeout = setTimeout(() => {
      webSocket.terminate();
      reject(new Error("Timed out waiting for WebSocket upgrade rejection."));
    }, 2000);
    webSocket.once("open", () => {
      clearTimeout(timeout);
      webSocket.terminate();
      reject(new Error("WebSocket upgrade unexpectedly succeeded."));
    });
    webSocket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    webSocket.once("unexpected-response", (request, response) => {
      void request;
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        clearTimeout(timeout);
        resolve({
          statusCode: response.statusCode,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.resume();
    });
  });
}

async function waitFor(predicate, description, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${description}.`);
}

test("strict frame validation accepts only the versioned sanitized schemas", () => {
  const validSnapshot = snapshotFrame(7, {
    control: {
      online: true,
      controlState: "browser_pilot",
      transport: "web",
      leaseExpiresAt: "2026-07-15T18:01:00.000Z",
    },
    commandOutcomes: [
      commandOutcome(),
      commandOutcome(),
      commandOutcome({
        commandID: "command-2",
        success: false,
        errorCode: "QueueTooLong",
        admissionStatus: "rejected",
      }),
    ],
  });
  assert.equal(validateGatewayFrame(validSnapshot, CHARACTER_ID), true);
  assert.equal(validateGatewayFrame(settlementFrame(8), CHARACTER_ID), true);

  const mutations = [
    (frame) => { frame.source = "other-service"; },
    (frame) => { frame.apiVersion = 2; },
    (frame) => { frame.streamVersion = 2; },
    (frame) => { frame.characterID += 1; },
    (frame) => { frame.cursor.epoch = "bad epoch"; },
    (frame) => { frame.cursor.sequence = "7"; },
    (frame) => { frame.extra = true; },
    (frame) => { frame.control.online = false; },
    (frame) => { frame.control.leaseExpiresAt = "tomorrow"; },
    (frame) => { frame.commandOutcomes[0].success = false; },
    (frame) => { frame.commandOutcomes[0].admissionStatus = "rejected"; },
    (frame) => { frame.commandOutcomes[0].commandType = "unknown.command"; },
    (frame) => { frame.commandOutcomes[0].unexpected = "secret"; },
  ];
  for (const mutate of mutations) {
    const candidate = clone(validSnapshot);
    mutate(candidate);
    assert.equal(validateGatewayFrame(candidate, CHARACTER_ID), false);
  }

  const tooManyOutcomes = snapshotFrame(7, {
    commandOutcomes: Array.from({ length: 65 }, (_, index) =>
      commandOutcome({ commandID: `command-${index}` })),
  });
  assert.equal(validateGatewayFrame(tooManyOutcomes, CHARACTER_ID), false);

  const malformedEvent = settlementFrame(8);
  malformedEvent.event.errorCode = "bad-error-code";
  assert.equal(validateGatewayFrame(malformedEvent, CHARACTER_ID), false);
  assert.equal(parseGatewayFrame(Buffer.from("{}"), false, 65536, CHARACTER_ID), null);
  assert.equal(
    parseGatewayFrame(Buffer.from(JSON.stringify(validSnapshot)), true, 65536, CHARACTER_ID),
    null,
  );
});

test("cursor continuity permits an initial snapshot or exact retained replay only", () => {
  const replayState = {
    hasFrame: false,
    requested: { epoch: EVENT_EPOCH, sequence: 4 },
    epoch: null,
    sequence: null,
  };
  assert.equal(acceptsNextCursor(settlementFrame(5), replayState), true);
  assert.equal(acceptsNextCursor(settlementFrame(6), replayState), true);
  assert.equal(acceptsNextCursor(settlementFrame(8), replayState), false);
  assert.equal(acceptsNextCursor(snapshotFrame(6), replayState), false);

  const snapshotState = {
    hasFrame: false,
    requested: null,
    epoch: null,
    sequence: null,
  };
  assert.equal(acceptsNextCursor(settlementFrame(1), snapshotState), false);
  assert.equal(acceptsNextCursor(snapshotFrame(12), snapshotState), true);
  assert.equal(acceptsNextCursor(settlementFrame(13), snapshotState), true);
});

test("signed same-origin upgrades recheck ownership and proxy only the cursor and token", async (t) => {
  const serializedFrame = JSON.stringify(settlementFrame(5));
  const gateway = await startGateway((webSocket) => {
    webSocket.send(serializedFrame);
  });
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const calls = [];
  const bff = await startBff(fakeStore({
    async getAccount(username) {
      calls.push(["account", username]);
      return { ...ACCOUNT };
    },
    async getCharacterForAccount(accountID, characterID) {
      calls.push(["character", accountID, characterID]);
      return { accountID, characterID };
    },
  }));
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const browser = await openBrowserSocket(
    `${bff.url}/api/characters/${CHARACTER_ID}/events?epoch=${EVENT_EPOCH}&sequence=4`,
    { origin: bff.origin },
  );
  await waitFor(() => browser.messages.length === 1, "forwarded replay event");
  assert.equal(browser.messages[0], serializedFrame);
  assert.equal(browser.messages[0].includes(GATEWAY_TOKEN), false);
  assert.deepEqual(calls, [
    ["account", ACCOUNT.username],
    ["character", ACCOUNT.accountID, CHARACTER_ID],
  ]);

  assert.equal(gateway.requests.length, 1);
  const upstreamRequest = gateway.requests[0];
  const upstreamUrl = new URL(upstreamRequest.url, gateway.url);
  assert.equal(upstreamUrl.pathname, "/_evejs-web/v1/events");
  assert.deepEqual(Object.fromEntries(upstreamUrl.searchParams), {
    accountID: String(ACCOUNT.accountID),
    characterID: String(CHARACTER_ID),
    epoch: EVENT_EPOCH,
    sequence: "4",
  });
  assert.equal(upstreamRequest.headers["x-evejs-web-token"], GATEWAY_TOKEN);
  assert.equal(upstreamRequest.headers.cookie, undefined);
  assert.equal(upstreamRequest.headers.origin, undefined);
  assert.equal(upstreamRequest.url.includes(GATEWAY_TOKEN), false);
  assert.equal(upstreamRequest.url.includes("controller"), false);

  assert.deepEqual(bff.server.characterEventProxy.getDiagnostics(), {
    attached: true,
    closed: false,
    pendingUpgrades: 0,
    sessions: 1,
    sockets: 2,
    timers: 2,
  });
  browser.webSocket.close();
  await once(browser.webSocket, "close");
  await waitFor(
    () => bff.server.characterEventProxy.getDiagnostics().sockets === 0,
    "proxy socket cleanup",
  );
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 0);
});

test("validated frames are canonically serialized before browser delivery", async (t) => {
  const canonicalFrame = JSON.stringify(settlementFrame(5));
  const duplicateKeyFrame = canonicalFrame.replace(
    '"source":"evejs-web-gateway"',
    `"source":"${GATEWAY_TOKEN}","source":"evejs-web-gateway"`,
  );
  const gateway = await startGateway((webSocket) => {
    webSocket.send(duplicateKeyFrame);
  });
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const bff = await startBff(fakeStore());
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const browser = await openBrowserSocket(
    `${bff.url}/api/characters/${CHARACTER_ID}/events?epoch=${EVENT_EPOCH}&sequence=4`,
    { origin: bff.origin },
  );
  await waitFor(() => browser.messages.length === 1, "canonical forwarded event");
  assert.equal(browser.messages[0], canonicalFrame);
  assert.equal(browser.messages[0].includes(GATEWAY_TOKEN), false);
  browser.webSocket.close();
  await once(browser.webSocket, "close");
});

test("an accepted socket expires with its signed session and clears both tracked timers", async (t) => {
  const gateway = await startGateway();
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const session = nearExpirySignedSession(200);
  const bff = await startBff(fakeStore(), { now: session.now });
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const browser = await openBrowserSocket(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin, cookie: session.cookie },
  );
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 2);
  const [closeCode] = await once(browser.webSocket, "close");
  assert.equal(closeCode, 1008);
  await waitFor(
    () => bff.server.characterEventProxy.getDiagnostics().sockets === 0,
    "expired browser and upstream socket cleanup",
  );
  assert.equal(bff.server.characterEventProxy.getDiagnostics().sessions, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 0);
  await waitFor(() => gateway.clients.size === 0, "expired upstream peer cleanup");
});

test("session expiry is rechecked after asynchronous account authorization", async (t) => {
  const gateway = await startGateway();
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const session = nearExpirySignedSession(30);
  let ownershipCalls = 0;
  const bff = await startBff(fakeStore({
    async getAccount() {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { ...ACCOUNT };
    },
    async getCharacterForAccount() {
      ownershipCalls += 1;
      return { accountID: ACCOUNT.accountID, characterID: CHARACTER_ID };
    },
  }), { now: session.now });
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const rejection = await rejectedUpgrade(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin, cookie: session.cookie },
  );
  assert.equal(rejection.statusCode, 401);
  assert.equal(JSON.parse(rejection.body).error, "AUTH_REQUIRED");
  assert.equal(ownershipCalls, 0);
  assert.equal(gateway.requests.length, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().sockets, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 0);
});

test("session expiry is rechecked after the upstream WebSocket handshake", async (t) => {
  const gateway = await startDelayedGateway(90);
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const session = nearExpirySignedSession(50);
  const bff = await startBff(fakeStore(), {
    now: session.now,
    upgradeTimeoutMs: 500,
  });
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const rejection = await rejectedUpgrade(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin, cookie: session.cookie },
  );
  assert.equal(rejection.statusCode, 401);
  assert.equal(JSON.parse(rejection.body).error, "AUTH_REQUIRED");
  assert.equal(gateway.requests.length, 1);
  await waitFor(() => gateway.clients.size === 0, "expired upstream handshake cleanup");
  assert.equal(bff.server.characterEventProxy.getDiagnostics().pendingUpgrades, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().sockets, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 0);
});

test("unknown, cross-origin, unsigned, partial-cursor, and unowned upgrades fail before dial", async (t) => {
  const gateway = await startGateway();
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const bff = await startBff();
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const validToken = webAuth.createSessionToken(ACCOUNT);
  const tamperedToken = `${validToken.slice(0, -1)}${validToken.endsWith("a") ? "b" : "a"}`;
  const cookieName = require("../src/config").sessionCookieName;
  const cases = [
    {
      path: `/api/characters/${CHARACTER_ID}/not-events`,
      origin: bff.origin,
      statusCode: 404,
      error: "EVENT_STREAM_NOT_FOUND",
    },
    {
      path: `/api/characters/${CHARACTER_ID}/events`,
      origin: "https://attacker.invalid",
      statusCode: 403,
      error: "EVENT_STREAM_ORIGIN_FORBIDDEN",
    },
    {
      path: `/api/characters/${CHARACTER_ID}/events`,
      origin: null,
      statusCode: 403,
      error: "EVENT_STREAM_ORIGIN_FORBIDDEN",
    },
    {
      path: `/api/characters/${CHARACTER_ID}/events`,
      origin: bff.origin,
      cookie: `${cookieName}=${tamperedToken}`,
      statusCode: 401,
      error: "AUTH_REQUIRED",
    },
    {
      path: "/api/characters/90000002/events",
      origin: bff.origin,
      statusCode: 403,
      error: "CHARACTER_FORBIDDEN",
    },
    {
      path: `/api/characters/${CHARACTER_ID}/events?epoch=${EVENT_EPOCH}`,
      origin: bff.origin,
      statusCode: 400,
      error: "EVENT_STREAM_CURSOR_INVALID",
    },
    {
      path: `/api/characters/${CHARACTER_ID}/events?epoch=${EVENT_EPOCH}` +
        "&sequence=01",
      origin: bff.origin,
      statusCode: 400,
      error: "EVENT_STREAM_CURSOR_INVALID",
    },
    {
      path: `/api/characters/${CHARACTER_ID}/events?accountID=7`,
      origin: bff.origin,
      statusCode: 400,
      error: "EVENT_STREAM_QUERY_INVALID",
    },
  ];

  for (const entry of cases) {
    const rejection = await rejectedUpgrade(`${bff.url}${entry.path}`, entry);
    assert.equal(rejection.statusCode, entry.statusCode, entry.path);
    assert.equal(JSON.parse(rejection.body).error, entry.error, entry.path);
    assert.equal(rejection.body.includes(GATEWAY_TOKEN), false);
  }
  assert.equal(gateway.requests.length, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().sockets, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 0);
});

test("event upgrades require a server-only gateway token before dialing upstream", async (t) => {
  const gateway = await startGateway();
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  delete process.env.EVEJS_WEB_GATEWAY_TOKEN;
  const bff = await startBff();
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const rejection = await rejectedUpgrade(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin },
  );
  assert.equal(rejection.statusCode, 503);
  assert.equal(JSON.parse(rejection.body).error, "EVENT_STREAM_CONFIGURATION");
  assert.equal(gateway.requests.length, 0);
  assert.equal(rejection.body.includes(GATEWAY_TOKEN), false);
});

test("sequence gaps, oversized frames, and output backpressure never forward unsafe data", async (t) => {
  const gateway = await startGateway((webSocket, request) => {
    const url = new URL(request.url, "http://gateway.invalid");
    if (url.searchParams.get("sequence") === "3") {
      webSocket.send(JSON.stringify(settlementFrame(4)));
      webSocket.send(JSON.stringify(settlementFrame(6)));
      return;
    }
    webSocket.send(JSON.stringify(snapshotFrame(0)));
  });
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const gapBff = await startBff();
  const pressureBff = await startBff(fakeStore(), { maxBufferedBytes: 1 });
  const frameBff = await startBff(fakeStore(), { maxFrameBytes: 128 });
  t.after(async () => {
    await gapBff.close();
    await pressureBff.close();
    await frameBff.close();
    await gateway.close();
  });

  const gapBrowser = await openBrowserSocket(
    `${gapBff.url}/api/characters/${CHARACTER_ID}/events?epoch=${EVENT_EPOCH}&sequence=3`,
    { origin: gapBff.origin },
  );
  const [gapCode] = await once(gapBrowser.webSocket, "close");
  assert.equal(gapCode, 1002);
  assert.equal(gapBrowser.messages.length, 1);
  assert.equal(JSON.parse(gapBrowser.messages[0]).cursor.sequence, 4);
  await waitFor(
    () => gapBff.server.characterEventProxy.getDiagnostics().sockets === 0,
    "gap connection cleanup",
  );
  assert.equal(gapBff.server.characterEventProxy.getDiagnostics().timers, 0);

  const pressureBrowser = await openBrowserSocket(
    `${pressureBff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: pressureBff.origin },
  );
  const [pressureCode] = await once(pressureBrowser.webSocket, "close");
  assert.equal(pressureCode, 1009);
  assert.deepEqual(pressureBrowser.messages, []);
  await waitFor(
    () => pressureBff.server.characterEventProxy.getDiagnostics().sockets === 0,
    "backpressure connection cleanup",
  );
  assert.equal(pressureBff.server.characterEventProxy.getDiagnostics().timers, 0);

  const frameBrowser = await openBrowserSocket(
    `${frameBff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: frameBff.origin },
  );
  await once(frameBrowser.webSocket, "close");
  assert.deepEqual(frameBrowser.messages, []);
  await waitFor(
    () => frameBff.server.characterEventProxy.getDiagnostics().sockets === 0,
    "oversized-frame connection cleanup",
  );
  assert.equal(frameBff.server.characterEventProxy.getDiagnostics().timers, 0);
});

test("missed heartbeat pong terminates both sides and clears the heartbeat timer", async (t) => {
  const gateway = await startGateway();
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const bff = await startBff(fakeStore(), { heartbeatIntervalMs: 15 });
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const browser = await openBrowserSocket(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin, autoPong: false },
  );
  await once(browser.webSocket, "close");
  await waitFor(
    () => bff.server.characterEventProxy.getDiagnostics().sockets === 0,
    "heartbeat connection cleanup",
  );
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 0);
  await waitFor(() => gateway.clients.size === 0, "upstream heartbeat peer cleanup");
});

test("downstream application data is rejected and shutdown removes listeners, sockets, and timers", async (t) => {
  const gateway = await startGateway();
  process.env.EVEJS_GATEWAY_URL = gateway.url;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const bff = await startBff();
  t.after(async () => {
    await bff.close();
    await gateway.close();
  });

  const browser = await openBrowserSocket(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin },
  );
  browser.webSocket.send("browser-data-is-not-allowed");
  const [closeCode] = await once(browser.webSocket, "close");
  assert.equal(closeCode, 1008);
  await waitFor(
    () => bff.server.characterEventProxy.getDiagnostics().sockets === 0,
    "downstream rejection cleanup",
  );
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 0);

  const active = await openBrowserSocket(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin },
  );
  assert.equal(bff.server.listenerCount("upgrade"), 1);
  const wrappedClose = bff.server.close;
  bff.server.characterEventProxy.close();
  await once(active.webSocket, "close");
  assert.notEqual(bff.server.close, wrappedClose);
  assert.equal(bff.server.listenerCount("upgrade"), 0);
  assert.deepEqual(bff.server.characterEventProxy.getDiagnostics(), {
    attached: false,
    closed: true,
    pendingUpgrades: 0,
    sessions: 0,
    sockets: 0,
    timers: 0,
  });
});

test("authentication is bounded by the raw upgrade timeout", async (t) => {
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const never = new Promise(() => {});
  const bff = await startBff(fakeStore({
    async getAccount() {
      return never;
    },
  }), { upgradeTimeoutMs: 30 });
  t.after(async () => bff.close());

  const rejection = await rejectedUpgrade(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin },
  );
  assert.equal(rejection.statusCode, 503);
  assert.equal(JSON.parse(rejection.body).error, "EVENT_STREAM_TIMEOUT");
  assert.deepEqual(bff.server.characterEventProxy.getDiagnostics(), {
    attached: true,
    closed: false,
    pendingUpgrades: 0,
    sessions: 0,
    sockets: 0,
    timers: 0,
  });
});

test("a stalled upstream handshake is bounded and leaves no pending socket or timer", async (t) => {
  const sockets = new Set();
  const gatewayServer = http.createServer();
  gatewayServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  gatewayServer.on("upgrade", (request, socket) => {
    void request;
    // Deliberately retain the connection without sending an upgrade response.
    socket.once("end", () => socket.destroy());
  });
  gatewayServer.listen(0, "127.0.0.1");
  await once(gatewayServer, "listening");
  const address = gatewayServer.address();
  process.env.EVEJS_GATEWAY_URL =
    `http://127.0.0.1:${address.port}/_evejs-web/v1`;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = GATEWAY_TOKEN;
  const bff = await startBff(fakeStore(), { upgradeTimeoutMs: 30 });
  t.after(async () => {
    await bff.close();
    for (const socket of sockets) {
      socket.destroy();
    }
    await closeHttpServer(gatewayServer);
  });

  const rejection = await rejectedUpgrade(
    `${bff.url}/api/characters/${CHARACTER_ID}/events`,
    { origin: bff.origin },
  );
  assert.equal(rejection.statusCode, 503);
  assert.match(
    JSON.parse(rejection.body).error,
    /^EVENT_STREAM_(?:TIMEOUT|UNAVAILABLE)$/,
  );
  await waitFor(() => sockets.size === 0, "stalled upstream socket cleanup");
  assert.equal(bff.server.characterEventProxy.getDiagnostics().pendingUpgrades, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().sockets, 0);
  assert.equal(bff.server.characterEventProxy.getDiagnostics().timers, 0);
});
