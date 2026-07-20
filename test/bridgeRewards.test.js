"use strict";

// Goal R6: the BFF reward-readout route (inventory Step 12). GET
// /api/bridge/rewards dispatches the three post-completion pull reads
// (account.GetCashBalance / LPSvc.GetAllMyCharacterWalletLPBalances /
// standingMgr.GetCharStandings) as top-level calls on the held session. The
// three reads are INDEPENDENT (Promise.allSettled) so one failed read carries
// its own error code and never blanks the rest; a lost session unwinds.
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
const AGENT_CORP_ID = 1000002;

const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();

const CASH_RESULT = 1000165000;
const LP_RESULT = {
  type: "objectex2",
  header: [],
  list: [
    { type: "packedrow", columns: [["issuerCorpID", 3], ["loyaltyPoints", 3]], values: [AGENT_CORP_ID, 213] },
  ],
  dict: [],
};
const STANDINGS_RESULT = {
  type: "object",
  name: "eve.common.script.sys.rowset.Rowset",
  args: {
    type: "dict",
    entries: [
      ["header", { type: "list", items: ["fromID", "standing"] }],
      ["RowClass", { type: "token", value: "util.Row" }],
      ["lines", { type: "list", items: [{ type: "list", items: [AGENT_CORP_ID, 0.42] }] }],
    ],
  },
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
      if (service === "account" && method === "GetCashBalance") {
        return { service, method, result: CASH_RESULT, notifications: [] };
      }
      if (service === "LPSvc" && method === "GetAllMyCharacterWalletLPBalances") {
        return { service, method, result: LP_RESULT, notifications: [] };
      }
      if (service === "standingMgr" && method === "GetCharStandings") {
        return { service, method, result: STANDINGS_RESULT, notifications: [] };
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

test("GET /api/bridge/rewards dispatches the three Step-12 reads on the held session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/rewards");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.cash, CASH_RESULT);
  assert.deepEqual(payload.lp, LP_RESULT);
  assert.deepEqual(payload.standings, STANDINGS_RESULT);
  assert.deepEqual(payload.errors, { cash: null, lp: null, standings: null });

  // Each read dispatched top-level on the held bridge session (no bind step).
  const cash = gateway.calls.call.find((c) => c.method === "GetCashBalance");
  const lp = gateway.calls.call.find((c) => c.method === "GetAllMyCharacterWalletLPBalances");
  const standings = gateway.calls.call.find((c) => c.method === "GetCharStandings");
  assert.ok(cash && lp && standings, "all three Step-12 reads dispatched");
  assert.deepEqual(cash.args, [0]);
  assert.equal(cash.service, "account");
  assert.equal(lp.service, "LPSvc");
  assert.equal(standings.service, "standingMgr");
  assert.equal(cash.bridgeSessionID, BRIDGE_SESSION_ID);
});

test("one failed reward read carries its own error code; the rest still return", async () => {
  const gateway = fakeGateway({
    async callMethod(service, method) {
      if (service === "standingMgr") {
        const error = new Error("standings unavailable");
        error.code = "CALL_FAILED";
        error.statusCode = 502;
        throw error;
      }
      if (service === "account") {
        return { service, method, result: CASH_RESULT, notifications: [] };
      }
      return { service, method, result: LP_RESULT, notifications: [] };
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/rewards");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.cash, CASH_RESULT, "the wallet read still returns");
  assert.equal(payload.errors.standings, "CALL_FAILED", "the failed read carries its code");
  assert.equal(payload.errors.cash, null);
});

test("a lost live session unwinds (404 SESSION_NOT_FOUND)", async () => {
  const gateway = fakeGateway({
    async callMethod() {
      const error = new Error("gone");
      error.code = "SESSION_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/rewards");
  assert.equal(response.status, 404);
  assert.equal(payload.error, "SESSION_NOT_FOUND");
});

test("the rewards route requires a live session (409 NO_LIVE_SESSION with no character online)", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/rewards");
  assert.equal(response.status, 409);
  assert.equal(payload.error, "NO_LIVE_SESSION");
});
