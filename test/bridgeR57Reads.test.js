"use strict";

// Goal R57 (PLUMBING ONLY — no UI): the three top-level READ routes wired for
// later UI. Each dispatches an allowlisted read as a TOP-LEVEL call on the held
// session, arg-less, so the handler scopes to the logged-in character:
//   • GET /api/bridge/fittings    — charFittingMgr.GetFittings (saved library)
//   • GET /api/bridge/kill-rights — bountyProxy.GetMyKillRights
//   • GET /api/bridge/lp          — LPSvc.GetLPsForCharacter + GetLPExchangeRates
//     + GetAvailableOffersFromCorp (three INDEPENDENT reads; empty ≠ failed)
// The fixtures are the real retail shapes captured live from Farmer on
// 2026-07-22. Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const CHARACTERS = [{ characterID: 7, accountID: 4, characterName: "Test Pilot" }];
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";

const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();

// The real captured shapes (Farmer, character 140000005).
const FITTINGS_RESULT = {
  type: "dict",
  entries: [
    [
      1,
      {
        type: "object",
        name: "util.KeyVal",
        args: {
          type: "dict",
          entries: [
            ["description", ""],
            [
              "fitData",
              {
                type: "list",
                items: [
                  { type: "tuple", items: [3651, 28, 1] },
                  { type: "tuple", items: [21857, 19, 1] },
                  { type: "tuple", items: [3636, 27, 1] },
                ],
              },
            ],
            ["fittingID", 1],
            ["name", "asdf"],
            ["ownerID", 140000005],
            ["savedDate", { type: "long", value: "134285151537020000" }],
            ["shipTypeID", 588],
          ],
        },
      },
    ],
  ],
};
const KILL_RIGHTS_RESULT = { type: "list", items: [] };
const LP_BALANCES_RESULT = {
  type: "list",
  items: [
    { type: "list", items: [1000002, 213] },
    { type: "list", items: [1000033, 1500] },
    { type: "list", items: [1000035, 100067000] },
  ],
};
const LP_EMPTY_RESULT = { type: "list", items: [] };

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
          stationID: 60003760,
          structureID: null,
          solarSystemID: 30000142,
          corporationID: 98000000,
          shipID: 9001,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: 7 };
    },
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.call.push({ service, method, args, kwargs, sessionFields, bridgeSessionID });
      if (service === "charFittingMgr" && method === "GetFittings") {
        return { service, method, result: FITTINGS_RESULT, notifications: [] };
      }
      if (service === "bountyProxy" && method === "GetMyKillRights") {
        return { service, method, result: KILL_RIGHTS_RESULT, notifications: [] };
      }
      if (service === "LPSvc" && method === "GetLPsForCharacter") {
        return { service, method, result: LP_BALANCES_RESULT, notifications: [] };
      }
      if (service === "LPSvc" && method === "GetLPExchangeRates") {
        return { service, method, result: LP_EMPTY_RESULT, notifications: [] };
      }
      if (service === "LPSvc" && method === "GetAvailableOffersFromCorp") {
        return { service, method, result: LP_EMPTY_RESULT, notifications: [] };
      }
      return { service, method, result: null, notifications: [] };
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

test("GET /api/bridge/fittings dispatches charFittingMgr.GetFittings top-level, arg-less", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/fittings");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.fittings, FITTINGS_RESULT);

  const read = gateway.calls.call.find((c) => c.method === "GetFittings");
  assert.ok(read, "GetFittings dispatched");
  assert.equal(read.service, "charFittingMgr");
  assert.deepEqual(read.args, [], "arg-less so the handler scopes to the session character");
  assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID);
});

test("GET /api/bridge/kill-rights dispatches bountyProxy.GetMyKillRights (empty ok)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/kill-rights");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  // An empty list is a REAL "no kill rights" answer, passed through untouched.
  assert.deepEqual(payload.killRights, KILL_RIGHTS_RESULT);

  const read = gateway.calls.call.find((c) => c.method === "GetMyKillRights");
  assert.ok(read, "GetMyKillRights dispatched");
  assert.equal(read.service, "bountyProxy");
  assert.deepEqual(read.args, []);
  assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID);
});

test("GET /api/bridge/lp dispatches the three LPSvc reads independently", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/lp");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.balances, LP_BALANCES_RESULT);
  assert.deepEqual(payload.exchangeRates, LP_EMPTY_RESULT);
  assert.deepEqual(payload.offers, LP_EMPTY_RESULT);
  assert.deepEqual(payload.errors, { balances: null, exchangeRates: null, offers: null });

  const balances = gateway.calls.call.find((c) => c.method === "GetLPsForCharacter");
  const rates = gateway.calls.call.find((c) => c.method === "GetLPExchangeRates");
  const offers = gateway.calls.call.find((c) => c.method === "GetAvailableOffersFromCorp");
  assert.ok(balances && rates && offers, "all three LP reads dispatched");
  for (const read of [balances, rates, offers]) {
    assert.equal(read.service, "LPSvc");
    assert.deepEqual(read.args, []);
    assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID);
  }
});

test("one failed LP read carries its own error code; the rest still return (empty ≠ failed)", async () => {
  const gateway = fakeGateway({
    async callMethod(service, method) {
      if (method === "GetAvailableOffersFromCorp") {
        const error = new Error("offers unavailable");
        error.code = "CALL_FAILED";
        error.statusCode = 502;
        throw error;
      }
      if (method === "GetLPsForCharacter") {
        return { service, method, result: LP_BALANCES_RESULT, notifications: [] };
      }
      return { service, method, result: LP_EMPTY_RESULT, notifications: [] };
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/lp");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.balances, LP_BALANCES_RESULT, "the balances read still returns");
  assert.equal(payload.errors.offers, "CALL_FAILED", "the failed read carries its code");
  assert.equal(payload.errors.balances, null);
  // An EMPTY exchange-rates read is a real answer, distinct from the FAILED offers read.
  assert.deepEqual(payload.exchangeRates, LP_EMPTY_RESULT);
  assert.equal(payload.errors.exchangeRates, null);
});

test("a lost live session unwinds each read route (404 SESSION_NOT_FOUND)", async () => {
  const gateway = fakeGateway({
    async callMethod() {
      const error = new Error("gone");
      error.code = "SESSION_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    },
  });
  for (const path of ["/api/bridge/fittings", "/api/bridge/kill-rights", "/api/bridge/lp"]) {
    const { baseUrl } = await startTestServer({ gateway });
    await selectOnServer(baseUrl);
    const { response, payload } = await apiRequest(baseUrl, path);
    assert.equal(response.status, 404, path);
    assert.equal(payload.error, "SESSION_NOT_FOUND", path);
  }
});

test("each read route requires a live session (409 NO_LIVE_SESSION with no character online)", async () => {
  for (const path of ["/api/bridge/fittings", "/api/bridge/kill-rights", "/api/bridge/lp"]) {
    const { baseUrl } = await startTestServer();
    const { response, payload } = await apiRequest(baseUrl, path);
    assert.equal(response.status, 409, path);
    assert.equal(payload.error, "NO_LIVE_SESSION", path);
  }
});
