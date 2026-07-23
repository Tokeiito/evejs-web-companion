"use strict";

// Goal R95 (Phase-4 top-level WRITES): the BFF skill / clone / safety write
// routes. First Phase-4 batch. PLUMBING ONLY — no UI.
//
// Every route is CONFIRM-GATED: without `confirm: true` it answers 400
// CONFIRMATION_REQUIRED and NOTHING dispatches to the gateway. The destructive /
// financial ones (extract / inject-skillbook / install-clone / clone-jump /
// destroy) carry the same gate — this suite proves the gate + that ONE safe,
// reversible write (AbortTraining) reaches the gateway on the right service once
// confirmed. No destructive/financial write is ever exercised through-to-dispatch
// here; only its refusal path.

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
const ACTIVE_SHIP_ID = 9001;

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
          corporationID: 98000000,
          shipID: ACTIVE_SHIP_ID,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: CHARACTER_ID };
    },
    async readFlightStatus() {
      return {
        flight: { docked: true, inSpace: false, stationID: STATION_ID, solarSystemID: SOLAR_SYSTEM_ID, shipID: ACTIVE_SHIP_ID },
        notifications: [],
      };
    },
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.topLevel.push({ service, method, args, kwargs, bridgeSessionID });
      return { service, method, result: null, notifications: [] };
    },
    async bindObject() {
      throw new Error("R95 writes need no bound objects");
    },
    async callBoundMethod() {
      throw new Error("R95 writes need no bound objects");
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

// --- the 17 R95 write routes ------------------------------------------------

const R95_WRITE_ROUTES = [
  // WB-SKILL (skillHandler)
  ["/api/bridge/skills/start-training", { itemID: 1 }],
  ["/api/bridge/skills/abort-training", {}],
  ["/api/bridge/skills/apply-free-points", {}],
  ["/api/bridge/skills/extract", { injectorTypeID: 1 }],
  ["/api/bridge/skills/inject-skillpoints", { amount: 1 }],
  ["/api/bridge/skills/split-injector", { itemID: 1 }],
  ["/api/bridge/skills/combine-injector", { itemID: 1 }],
  ["/api/bridge/skills/inject-skillbook", { itemIDs: [1] }],
  // WB-CLONE (jumpCloneSvc)
  ["/api/bridge/clones/install-station", {}],
  ["/api/bridge/clones/install-structure", {}],
  ["/api/bridge/clones/jump", { destinationLocationID: STATION_ID }],
  ["/api/bridge/clones/destroy", { cloneID: 1 }],
  ["/api/bridge/clones/set-name", { cloneID: 1, name: "PvP" }],
  ["/api/bridge/clones/ship/offer", { targetCharID: 140000002 }],
  ["/api/bridge/clones/ship/accept", {}],
  ["/api/bridge/clones/ship/cancel", {}],
  // WB-CRIME (crimewatch)
  ["/api/bridge/safety/set-level", { level: 2 }],
];

test("⚠ every R95 skill/clone/safety write REFUSES without confirm — no dispatch", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const [path, body] of R95_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  // Not one write reached the gateway (select never dispatches a top-level call).
  assert.equal(gateway.calls.topLevel.length, 0, "a refused write must not dispatch");
});

test("R95 writes dispatch on the three session-scoped services, never a bound step", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  // AbortTraining is a safe, reversible write — exercise its confirmed dispatch.
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/skills/abort-training", {
    method: "POST",
    body: { confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, true);
  const call = gateway.calls.topLevel.find((c) => c.method === "AbortTraining");
  assert.ok(call, "AbortTraining must reach the gateway once confirmed");
  assert.equal(call.service, "skillHandler");
});

test("R95 SetSafetyLevel forwards the level as the sole positional arg", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/safety/set-level", {
    method: "POST",
    body: { level: 1, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "SetSafetyLevel");
  assert.ok(call, "SetSafetyLevel must reach the gateway once confirmed");
  assert.equal(call.service, "crimewatch");
  assert.deepEqual(call.args, [1]);
});

test("R95 clone/name write forwards [cloneID, name] on jumpCloneSvc", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/clones/set-name", {
    method: "POST",
    body: { cloneID: 555, name: "Home", confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "SetJumpCloneName");
  assert.ok(call, "SetJumpCloneName must reach the gateway once confirmed");
  assert.equal(call.service, "jumpCloneSvc");
  assert.deepEqual(call.args, [555, "Home"]);
});

test("R95 write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R95_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "no dispatch without a held session");
});
