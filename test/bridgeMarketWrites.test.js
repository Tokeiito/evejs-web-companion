"use strict";

// Goal R106 (WB-MARKET — the LAST plumbing batch, CLOSES the sweep 588/588): the
// BFF marketProxy FINANCIAL write routes (PlacePlexSellOrder / ModifyPlexCharOrder
// / BuyMultipleItems). PLUMBING ONLY — no UI.
//
// Every route is CONFIRM-GATED: without `confirm: true` it answers 400
// CONFIRMATION_REQUIRED and NOTHING dispatches to the gateway. Each write SPENDS or
// COMMITS real value, so REACHABILITY-ONLY — the ISK-spending / order-placing
// happy-path is never fired against the live world. This suite proves the gate (all
// 3 refuse without confirm — no dispatch) and that ONCE confirmed each write forwards
// its args on the "marketProxy" service against a FAKE recording gateway (which only
// records the dispatch, never touching a real market daemon or wallet). It lives in a
// NEW file so it never edits the market session's test/bridgeMarket.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const STATION_ID = 60003760;
const SOLAR_SYSTEM_ID = 30000142;
const CHARACTER_ID = 7;
const CORPORATION_ID = 98000000;

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
      return Number(accountID) === ACCOUNT.accountID && Number(characterID) === CHARACTER_ID
        ? { characterID: CHARACTER_ID, accountID: 4, characterName: "Test Pilot" }
        : null;
    },
    async releaseCharacterControl() {
      return { controlState: "offline" };
    },
  };
}

function fakeStaticData() {
  return {
    getStation() {
      return null;
    },
    getTypeName(id) {
      return `Type ${id}`;
    },
    resolveNames() {
      return { names: {}, capped: false, limit: 500 };
    },
  };
}

function fakeGateway() {
  const calls = { topLevel: [] };
  return {
    calls,
    async selectCharacter() {
      return {
        bridgeSessionID: BRIDGE_SESSION_ID,
        service: "charUnboundMgr",
        method: "SelectCharacterID",
        result: null,
        notifications: [],
        session: {
          userid: 4,
          characterID: CHARACTER_ID,
          characterName: "Test Pilot",
          stationID: STATION_ID,
          structureID: null,
          solarSystemID: SOLAR_SYSTEM_ID,
          corporationID: CORPORATION_ID,
          shipID: 9001,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: CHARACTER_ID };
    },
    async readFlightStatus() {
      return {
        flight: { docked: true, inSpace: false, stationID: STATION_ID, solarSystemID: SOLAR_SYSTEM_ID, shipID: 9001 },
        notifications: [],
      };
    },
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.topLevel.push({ service, method, args, kwargs, bridgeSessionID });
      // The three R106 handlers each succeed with null / [] — but this FAKE recorder
      // never fires anything live; it only proves the dispatch shape on the confirm path.
      return { service, method, result: null, notifications: [] };
    },
    async bindObject() {
      throw new Error("R106 marketProxy financial writes need no bound objects");
    },
    async callBoundMethod() {
      throw new Error("R106 marketProxy financial writes need no bound objects");
    },
  };
}

async function startTestServer(options = {}) {
  const app = createApp({
    eveStore: options.store || fakeStore(),
    eveGatewayClient: options.gateway,
    webAuth: fakeAuth(),
    staticData: options.staticData || fakeStaticData(),
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
  headers.cookie = `evejs_web_poc=${COOKIE_TOKEN}`;
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, payload: await response.json() };
}

async function selectOnServer(baseUrl) {
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: CHARACTER_ID } });
}

test.afterEach(async () => {
  global.fetch = ORIGINAL_FETCH;
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))));
  }
  await Promise.all(closing);
});

// --- the 3 R106 marketProxy financial write routes ----------------------------

const PLEX_ENTRY = { itemID: 1002, typeID: 44992, stationID: STATION_ID, price: 5000000000, quantity: 1 };

const R106_WRITE_ROUTES = [
  ["/api/bridge/market/plex/sell", { entry: PLEX_ENTRY }], // lists PLEX for sale
  ["/api/bridge/market/plex/modify", { orderID: 987654, newPrice: 5100000000 }], // re-prices own order
  ["/api/bridge/market/buy-multiple", { stationID: STATION_ID, itemList: [{ typeID: 34, quantity: 100, price: 10 }] }], // SPENDS ISK
];

test("⚠⚠ every R106 marketProxy financial write REFUSES without confirm — no dispatch (nothing fired)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  assert.equal(R106_WRITE_ROUTES.length, 3, "all 3 R106 financial write routes are covered");
  for (const [path, body] of R106_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "a refused financial write must not dispatch");
});

test("R106 PlacePlexSellOrder forwards [entry, false, durationDays, expectedBrokerFee] on marketProxy", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/market/plex/sell", {
    method: "POST",
    body: { entry: PLEX_ENTRY, durationDays: 90, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  const call = gateway.calls.topLevel.find((c) => c.method === "PlacePlexSellOrder");
  assert.ok(call, "PlacePlexSellOrder must reach the gateway once confirmed");
  assert.equal(call.service, "marketProxy");
  assert.deepEqual(call.args, [PLEX_ENTRY, false, 90, null]);
});

test("R106 ModifyPlexCharOrder forwards [orderID, newPrice] on marketProxy (owner-checked server-side)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/market/plex/modify", {
    method: "POST",
    body: { orderID: 987654, newPrice: 5100000000, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "ModifyPlexCharOrder");
  assert.ok(call, "ModifyPlexCharOrder must reach the gateway once confirmed");
  assert.equal(call.service, "marketProxy");
  assert.deepEqual(call.args, [987654, 5100000000]);
});

test("R106 BuyMultipleItems forwards [stationID, itemList, false] on marketProxy (session wallet)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const itemList = [{ typeID: 34, quantity: 100, price: 10 }];
  const { response } = await apiRequest(baseUrl, "/api/bridge/market/buy-multiple", {
    method: "POST",
    body: { stationID: STATION_ID, itemList, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "BuyMultipleItems");
  assert.ok(call, "BuyMultipleItems must reach the gateway once confirmed");
  assert.equal(call.service, "marketProxy");
  assert.deepEqual(call.args, [STATION_ID, itemList, false]);
});

test("R106 financial write routes refuse a confirmed call with missing/invalid fields — no dispatch", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const invalid = [
    ["/api/bridge/market/plex/sell", { confirm: true }], // no entry
    ["/api/bridge/market/plex/modify", { orderID: 0, newPrice: 0, confirm: true }], // no order/price
    ["/api/bridge/market/buy-multiple", { stationID: 0, itemList: [], confirm: true }], // no station/items
  ];
  for (const [path, body] of invalid) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must reject an invalid confirmed body`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "an invalid financial write must not dispatch");
});

test("R106 financial write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R106_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "no dispatch without a held session");
});
