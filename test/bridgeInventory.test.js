"use strict";

// Goal R3: the BFF Inventory & Ship routes drive the bound-object bridge. The
// browser addresses items/ships by their GAME IDs; the BFF holds the gateway's
// opaque bound-object handles server-side (never sent to the browser) and maps
// the game IDs to them: bind hangar/cargo/ship, then List/Add/StackAll/Board.
// Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const gatewayClient = require("../src/eveGatewayClient");
const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const CHARACTERS = [{ characterID: 7, accountID: 4, characterName: "Test Pilot" }];
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const STATION_ID = 60003760;
const ACTIVE_SHIP_ID = 9001;
const SELECT_SESSION_ECHO = {
  userid: 4,
  characterID: 7,
  characterName: "Test Pilot",
  stationID: STATION_ID,
  structureID: null,
  solarSystemID: 30000142,
  corporationID: 98000000,
  shipID: ACTIVE_SHIP_ID,
};

const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();

function fakeAuth() {
  return {
    createSessionToken() {
      return COOKIE_TOKEN;
    },
    verifySessionToken(token) {
      return token === COOKIE_TOKEN
        ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: SESSION_ID }
        : null;
    },
    countConfiguredUsers() {
      return 1;
    },
  };
}

function fakeStore() {
  return {
    async getAccount(username) {
      return username === ACCOUNT.username ? { ...ACCOUNT } : null;
    },
    async getCharacterForAccount(accountID, characterID) {
      return Number(accountID) === ACCOUNT.accountID &&
        CHARACTERS.some((c) => c.characterID === Number(characterID))
        ? { ...CHARACTERS[0] }
        : null;
    },
    async releaseCharacterControl() {
      return { controlState: "offline" };
    },
  };
}

function fakeStaticData() {
  return { getStation() { return null; }, getTypeName(id) { return `Type ${id}`; } };
}

function packedRow(fields) {
  return { type: "packedrow", fields };
}

function keyVal(entries) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

// A fake gateway recording bind/bound-call traffic and answering List/Capacity
// with handler-shaped fixtures. Each bind returns a handle derived from its
// (service, method, args) so the test can assert which handle a bound call used.
function fakeGateway(overrides = {}) {
  const calls = { select: [], release: [], bind: [], boundCall: [] };
  const gateway = {
    calls,
    async selectCharacter(args, kwargs, sessionFields) {
      calls.select.push({ args, kwargs, sessionFields });
      return {
        bridgeSessionID: BRIDGE_SESSION_ID,
        service: "charUnboundMgr",
        method: "SelectCharacterID",
        result: null,
        notifications: [],
        session: { ...SELECT_SESSION_ECHO },
      };
    },
    async releaseBridgeSession(bridgeSessionID, sessionFields) {
      calls.release.push({ bridgeSessionID, sessionFields });
      return { released: true, characterID: 7 };
    },
    async bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.bind.push({ service, method, args, kwargs, sessionFields, bridgeSessionID });
      return {
        boundHandle: `handle:${service}:${method}:${JSON.stringify(args)}`,
        service,
        method,
        notifications: [],
      };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) {
      calls.boundCall.push({ service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle });
      let result = null;
      if (method === "List") {
        result = {
          type: "list",
          items: [packedRow({ itemID: 100, typeID: 34, categoryID: 4, flagID: args[0], quantity: 750, singleton: 0 })],
        };
      } else if (method === "GetCapacity") {
        result = keyVal([["capacity", 1000], ["used", 7.5]]);
      }
      return { service, method, result, notifications: [] };
    },
    ...overrides,
  };
  return gateway;
}

async function startTestServer(options = {}) {
  const app = createApp({
    eveStore: options.store || fakeStore(),
    eveGatewayClient: options.gateway || fakeGateway(),
    webAuth: fakeAuth(),
    marketClient: {},
    staticData: fakeStaticData(),
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}` };
}

async function apiRequest(baseUrl, path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (options.authenticated !== false) {
    headers.cookie = `evejs_web_poc=${COOKIE_TOKEN}`;
  }
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, payload: await response.json() };
}

async function selectOnServer(baseUrl) {
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
}

test.afterEach(async () => {
  global.fetch = ORIGINAL_FETCH;
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }));
  }
  await Promise.all(closing);
});

test("GET /api/bridge/inventory binds hangar + cargo and lists both; no handle reaches the browser", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.stationID, STATION_ID);
  assert.equal(payload.activeShipID, ACTIVE_SHIP_ID);
  assert.ok(payload.hangar.list, "hangar list present");
  assert.ok(payload.cargo.list, "cargo list present");
  assert.equal(payload.hangar.error, null);

  // The bound OID / handle must never cross to the browser.
  assert.equal(JSON.stringify(payload).includes("handle:"), false);

  // Hangar bound via invbroker.GetInventory([stationID]); cargo via
  // invbroker.GetInventoryFromId([shipID]).
  assert.ok(gateway.calls.bind.some((b) => b.service === "invbroker" && b.method === "GetInventory" && b.args[0] === STATION_ID));
  assert.ok(gateway.calls.bind.some((b) => b.service === "invbroker" && b.method === "GetInventoryFromId" && b.args[0] === ACTIVE_SHIP_ID));
  // Every bound call rode the held bridge session and a hangar/cargo handle.
  for (const call of gateway.calls.boundCall) {
    assert.equal(call.bridgeSessionID, BRIDGE_SESSION_ID);
    assert.match(call.boundHandle, /^handle:invbroker:/);
  }
  // List(flag) and GetCapacity(flag) dispatched for both containers.
  const methods = gateway.calls.boundCall.map((c) => `${c.method}(${c.args[0]})`);
  assert.ok(methods.includes("List(4)") && methods.includes("GetCapacity(4)"));
  assert.ok(methods.includes("List(5)") && methods.includes("GetCapacity(5)"));
});

test("a bind handle is reused across reads (cached per semantic key)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/inventory");
  await apiRequest(baseUrl, "/api/bridge/inventory");

  // Two panel loads (4 hangar + 4 cargo reads) but only one hangar bind and
  // one cargo bind: the handles are cached per semantic key.
  const hangarBinds = gateway.calls.bind.filter((b) => b.method === "GetInventory").length;
  const cargoBinds = gateway.calls.bind.filter((b) => b.method === "GetInventoryFromId").length;
  assert.equal(hangarBinds, 1);
  assert.equal(cargoBinds, 1);
});

test("move toCargo runs Add on the cargo binding with the source station and cargo flag", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/inventory/move", {
    method: "POST",
    body: { itemID: 100, direction: "toCargo", qty: 250 },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  const add = gateway.calls.boundCall.find((c) => c.method === "Add");
  assert.ok(add, "Add dispatched");
  assert.equal(add.service, "invbroker");
  assert.deepEqual(add.args, [100, STATION_ID]);
  assert.deepEqual(add.kwargs, { flag: 5, qty: 250 });
  // Dispatched on the cargo binding (GetInventoryFromId handle).
  assert.match(add.boundHandle, /GetInventoryFromId/);
});

test("move toHangar runs Add on the hangar binding with the source ship and hangar flag", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/inventory/move", {
    method: "POST",
    body: { itemID: 100, direction: "toHangar" },
  });
  const add = gateway.calls.boundCall.find((c) => c.method === "Add");
  assert.deepEqual(add.args, [100, ACTIVE_SHIP_ID]);
  assert.deepEqual(add.kwargs, { flag: 4 });
  assert.match(add.boundHandle, /GetInventory:/);
});

test("stack runs StackAll on the requested container", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/inventory/stack", { method: "POST", body: { target: "cargo" } });
  const stack = gateway.calls.boundCall.find((c) => c.method === "StackAll");
  assert.ok(stack);
  assert.deepEqual(stack.args, [5]);
  assert.match(stack.boundHandle, /GetInventoryFromId/);
});

test("board binds ship, boards, and makes the boarded ship the new active ship for cargo", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/ship/board", {
    method: "POST",
    body: { shipID: 200 },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.activeShipID, 200);

  const board = gateway.calls.boundCall.find((c) => c.method === "Board");
  assert.equal(board.service, "ship");
  assert.deepEqual(board.args, [200, ACTIVE_SHIP_ID]);
  assert.ok(gateway.calls.bind.some((b) => b.service === "ship" && b.method === "MachoBindObject"));

  // A later cargo read binds against the newly boarded ship.
  await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.ok(gateway.calls.bind.some((b) => b.method === "GetInventoryFromId" && b.args[0] === 200));
});

test("inventory routes require a live session and pass gateway refusals through", async () => {
  const { baseUrl } = await startTestServer({ gateway: fakeGateway() });

  // No character online yet.
  const noSession = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(noSession.response.status, 409);
  assert.equal(noSession.payload.error, "NO_LIVE_SESSION");

  // A refused bound method passes through with its gateway status.
  const refusingGateway = fakeGateway({
    async callBoundMethod() {
      throw new gatewayClient.EveGatewayError("not allowed", { code: "CALL_NOT_ALLOWED", statusCode: 403 });
    },
  });
  const refused = await startTestServer({ gateway: refusingGateway });
  await selectOnServer(refused.baseUrl);
  const move = await apiRequest(refused.baseUrl, "/api/bridge/inventory/move", {
    method: "POST",
    body: { itemID: 100, direction: "toCargo" },
  });
  assert.equal(move.response.status, 403);
  assert.equal(move.payload.error, "CALL_NOT_ALLOWED");
});

test("a lost persistent session during an inventory read drops the held handle", async () => {
  const gateway = fakeGateway({
    async callBoundMethod() {
      throw new gatewayClient.EveGatewayError("gone", { code: "SESSION_NOT_FOUND", statusCode: 404 });
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const move = await apiRequest(baseUrl, "/api/bridge/inventory/move", {
    method: "POST",
    body: { itemID: 100, direction: "toCargo" },
  });
  assert.equal(move.response.status, 404);
  assert.equal(move.payload.error, "SESSION_NOT_FOUND");

  // The stale handle was dropped: releasing now reports nothing held.
  const { payload } = await apiRequest(baseUrl, "/api/bridge/release", { method: "POST", body: {} });
  assert.deepEqual(payload, { ok: true, released: false });
});
