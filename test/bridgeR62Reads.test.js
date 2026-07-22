"use strict";

// Goal R62 (PLUMBING ONLY — no UI): the two trading READ routes wired for later
// UI. Each dispatches allowlisted TOP-LEVEL reads on the held session:
//   • GET /api/bridge/market-trading — the seven marketProxy corp-order + PLEX
//     reads. GetCorporationOrders / GetPlexOrders / GetPlexBest / GetPlexHistory /
//     GetPlexOldPriceHistory / GetPlexNewPriceHistory are arg-less;
//     CorpGetTransactions carries [fromDate, accountKey]. Seven INDEPENDENT reads;
//     empty ≠ failed; a market-daemon outage surfaces its own signal.
//   • GET /api/bridge/contract-items — the seven contractProxy bids/escrow/item
//     reads. Escrow / MyBids / NumOutstandingContracts / GetItemsInDockableLocation
//     are always issued; the two container reads only when ?containerID= is given;
//     the courier read only when ?itemID= is given. Retail arg order is location-
//     first: GetItemsInContainer([locationID, containerID, forCorp, null]).
// Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const CHARACTERS = [{ characterID: 7, accountID: 4, characterName: "Test Pilot" }];
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const SESSION_STATION_ID = 60003760;
const SESSION_CORP_ID = 98000000;

const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();

// Sentinel results — the route must pass each through verbatim.
const CORP_ORDERS_RESULT = { tag: "corporationOrders" };
const CORP_TXNS_RESULT = { tag: "corpTransactions" };
const PLEX_ORDERS_RESULT = { tag: "plexOrders" };
const PLEX_BEST_RESULT = { tag: "plexBest" };
const PLEX_HISTORY_RESULT = { tag: "plexHistory" };
const PLEX_OLD_HISTORY_RESULT = { tag: "plexOldPriceHistory" };
const PLEX_NEW_HISTORY_RESULT = { tag: "plexNewPriceHistory" };
const ESCROW_RESULT = { tag: "escrow" };
const MY_BIDS_RESULT = { tag: "myBids" };
const OUTSTANDING_RESULT = { tag: "outstandingCounts" };
const CONTAINER_ITEMS_RESULT = { tag: "containerItems" };
const DOCKABLE_ITEMS_RESULT = { tag: "dockableItems" };
const CONTAINER_COUNTS_RESULT = { tag: "containerCounts" };
const COURIER_RESULT = { tag: "courierContract" };

const RESULTS = {
  "marketProxy.GetCorporationOrders": CORP_ORDERS_RESULT,
  "marketProxy.CorpGetTransactions": CORP_TXNS_RESULT,
  "marketProxy.GetPlexOrders": PLEX_ORDERS_RESULT,
  "marketProxy.GetPlexBest": PLEX_BEST_RESULT,
  "marketProxy.GetPlexHistory": PLEX_HISTORY_RESULT,
  "marketProxy.GetPlexOldPriceHistory": PLEX_OLD_HISTORY_RESULT,
  "marketProxy.GetPlexNewPriceHistory": PLEX_NEW_HISTORY_RESULT,
  "contractProxy.GetMyContractEscrow": ESCROW_RESULT,
  "contractProxy.GetMyBids": MY_BIDS_RESULT,
  "contractProxy.NumOutstandingContracts": OUTSTANDING_RESULT,
  "contractProxy.GetItemsInContainer": CONTAINER_ITEMS_RESULT,
  "contractProxy.GetItemsInDockableLocation": DOCKABLE_ITEMS_RESULT,
  "contractProxy.GetNumItemsInContainers": CONTAINER_COUNTS_RESULT,
  "contractProxy.GetCourierContractFromItemID": COURIER_RESULT,
};

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

function fakeGateway(overrides = {}) {
  const calls = { select: [], call: [] };
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
        session: {
          userid: 4,
          characterID: 7,
          characterName: "Test Pilot",
          stationID: SESSION_STATION_ID,
          structureID: null,
          solarSystemID: 30000142,
          corporationID: SESSION_CORP_ID,
          shipID: 9001,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: 7 };
    },
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.call.push({ service, method, args, kwargs, sessionFields, bridgeSessionID });
      const key = `${service}.${method}`;
      return { service, method, result: key in RESULTS ? RESULTS[key] : null, notifications: [] };
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

function callFor(gateway, method) {
  return gateway.calls.call.find((c) => c.method === method);
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

// --- market-trading ---------------------------------------------------------

test("GET /api/bridge/market-trading dispatches the seven marketProxy corp/PLEX reads", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/market-trading");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.corporationOrders, CORP_ORDERS_RESULT);
  assert.deepEqual(payload.corpTransactions, CORP_TXNS_RESULT);
  assert.deepEqual(payload.plexOrders, PLEX_ORDERS_RESULT);
  assert.deepEqual(payload.plexBest, PLEX_BEST_RESULT);
  assert.deepEqual(payload.plexHistory, PLEX_HISTORY_RESULT);
  assert.deepEqual(payload.plexOldPriceHistory, PLEX_OLD_HISTORY_RESULT);
  assert.deepEqual(payload.plexNewPriceHistory, PLEX_NEW_HISTORY_RESULT);
  assert.equal(payload.marketUnavailable, null);
  assert.deepEqual(payload.errors, {
    corporationOrders: null,
    corpTransactions: null,
    plexOrders: null,
    plexBest: null,
    plexHistory: null,
    plexOldPriceHistory: null,
    plexNewPriceHistory: null,
  });

  // Every read is on marketProxy, on the held session.
  for (const method of [
    "GetCorporationOrders",
    "CorpGetTransactions",
    "GetPlexOrders",
    "GetPlexBest",
    "GetPlexHistory",
    "GetPlexOldPriceHistory",
    "GetPlexNewPriceHistory",
  ]) {
    const read = callFor(gateway, method);
    assert.equal(read.service, "marketProxy", method);
    assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID, method);
  }
  // The corp orders / PLEX reads are arg-less; CorpGetTransactions carries
  // [fromDate, accountKey], defaulting to [0, null].
  assert.deepEqual(callFor(gateway, "GetCorporationOrders").args, []);
  assert.deepEqual(callFor(gateway, "GetPlexOrders").args, []);
  assert.deepEqual(callFor(gateway, "CorpGetTransactions").args, [0, null]);
});

test("market-trading forwards ?fromDate= and ?accountKey= to CorpGetTransactions", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, "/api/bridge/market-trading?fromDate=999&accountKey=1000");
  assert.deepEqual(callFor(gateway, "CorpGetTransactions").args, [999, 1000]);
  assert.deepEqual(payload.requested, { fromDate: 999, accountKey: 1000 });
});

test("market-trading surfaces the daemon outage signal when a read is MarketUnavailable", async () => {
  const gateway = fakeGateway({
    async callMethod(service, method) {
      if (method === "GetPlexOrders") {
        const error = new Error("MarketUnavailable: the market daemon is not answering");
        error.code = "CALL_SERVICE_UNAVAILABLE";
        error.statusCode = 503;
        throw error;
      }
      const key = `${service}.${method}`;
      return { service, method, result: key in RESULTS ? RESULTS[key] : null, notifications: [] };
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/market-trading");
  assert.equal(response.status, 200);
  // The other reads still return (empty ≠ failed); the failed read carries its
  // code; the daemon-outage signal is set once.
  assert.deepEqual(payload.plexBest, PLEX_BEST_RESULT);
  assert.equal(payload.plexOrders, null);
  assert.equal(payload.errors.plexOrders, "CALL_SERVICE_UNAVAILABLE");
  assert.ok(payload.marketUnavailable, "the daemon-outage signal is set");
});

// --- contract-items ---------------------------------------------------------

test("GET /api/bridge/contract-items issues escrow/bids/counts/dockable, but NOT the container/courier reads without their ids", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/contract-items");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.escrow, ESCROW_RESULT);
  assert.deepEqual(payload.myBids, MY_BIDS_RESULT);
  assert.deepEqual(payload.outstandingCounts, OUTSTANDING_RESULT);
  assert.deepEqual(payload.dockableItems, DOCKABLE_ITEMS_RESULT);
  // The container + courier reads are NOT issued (no ?containerID= / ?itemID=).
  assert.equal(payload.containerItems, null);
  assert.equal(payload.containerCounts, null);
  assert.equal(payload.courierContract, null);
  assert.equal(callFor(gateway, "GetItemsInContainer"), undefined);
  assert.equal(callFor(gateway, "GetNumItemsInContainers"), undefined);
  assert.equal(callFor(gateway, "GetCourierContractFromItemID"), undefined);

  // locationID defaults to the docked station; the dockable read is location-first.
  assert.deepEqual(payload.requested, {
    locationID: SESSION_STATION_ID,
    containerID: null,
    itemID: null,
    forCorp: false,
  });
  const dockable = callFor(gateway, "GetItemsInDockableLocation");
  assert.equal(dockable.service, "contractProxy");
  assert.deepEqual(dockable.args, [SESSION_STATION_ID, false]);
  // The unissued container/courier reads carry a null error, not a code.
  assert.equal(payload.errors.containerItems, null);
  assert.equal(payload.errors.courierContract, null);
});

test("contract-items issues the container + courier reads with the retail location-first args when their ids are given", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(
    baseUrl,
    "/api/bridge/contract-items?locationID=60000358&containerID=9988400023309&itemID=42&forCorp=1",
  );
  assert.deepEqual(payload.containerItems, CONTAINER_ITEMS_RESULT);
  assert.deepEqual(payload.containerCounts, CONTAINER_COUNTS_RESULT);
  assert.deepEqual(payload.courierContract, COURIER_RESULT);
  assert.deepEqual(payload.requested, {
    locationID: 60000358,
    containerID: 9988400023309,
    itemID: 42,
    forCorp: true,
  });

  // GetItemsInContainer(locationID, containerID, forCorp, null) — location FIRST.
  assert.deepEqual(callFor(gateway, "GetItemsInContainer").args, [60000358, 9988400023309, true, null]);
  // GetNumItemsInContainers(locationID, [containerID], forCorp, null).
  assert.deepEqual(callFor(gateway, "GetNumItemsInContainers").args, [60000358, [9988400023309], true, null]);
  // GetCourierContractFromItemID(itemID).
  assert.deepEqual(callFor(gateway, "GetCourierContractFromItemID").args, [42]);
});

test("one failed contract-items read carries its own error code; the rest still return", async () => {
  const gateway = fakeGateway({
    async callMethod(service, method) {
      if (method === "GetMyContractEscrow") {
        const error = new Error("escrow read failed");
        error.code = "CALL_FAILED";
        error.statusCode = 502;
        throw error;
      }
      const key = `${service}.${method}`;
      return { service, method, result: key in RESULTS ? RESULTS[key] : null, notifications: [] };
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/contract-items");
  assert.equal(response.status, 200);
  assert.equal(payload.escrow, null, "the failed read has no value");
  assert.equal(payload.errors.escrow, "CALL_FAILED", "the failed read carries its code");
  assert.deepEqual(payload.dockableItems, DOCKABLE_ITEMS_RESULT, "the other reads still return");
});

// --- session lifecycle both routes ------------------------------------------

test("a lost live session unwinds each R62 route (404 SESSION_NOT_FOUND)", async () => {
  const gateway = fakeGateway({
    async callMethod() {
      const error = new Error("gone");
      error.code = "SESSION_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    },
  });
  for (const path of ["/api/bridge/market-trading", "/api/bridge/contract-items"]) {
    const { baseUrl } = await startTestServer({ gateway });
    await selectOnServer(baseUrl);
    const { response, payload } = await apiRequest(baseUrl, path);
    assert.equal(response.status, 404, path);
    assert.equal(payload.error, "SESSION_NOT_FOUND", path);
  }
});

test("each R62 route requires a live session (409 NO_LIVE_SESSION with no character online)", async () => {
  for (const path of ["/api/bridge/market-trading", "/api/bridge/contract-items"]) {
    const { baseUrl } = await startTestServer();
    const { response, payload } = await apiRequest(baseUrl, path);
    assert.equal(response.status, 409, path);
    assert.equal(payload.error, "NO_LIVE_SESSION", path);
  }
});
