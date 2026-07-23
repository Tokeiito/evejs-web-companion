"use strict";

// Goal R99 (Phase-4 top-level WRITES): the BFF allianceRegistry + warRegistry +
// corpStationMgr write routes (alliance governance / bill / relationships, war
// negotiations, corp-HQ move). PLUMBING ONLY — no UI. WB-ALLYREG + WB-WARREG +
// WB-CORPSTN (20 writes).
//
// Every route is CONFIRM-GATED: without `confirm: true` it answers 400
// CONFIRMATION_REQUIRED and NOTHING dispatches to the gateway. This suite proves the
// gate (all 20 refuse without confirm), and that a couple of representative GOVERNANCE
// writes forward their args on the correct service ONCE confirmed against a FAKE
// recording gateway. NO write was ever fired against the live world — the fake gateway
// only records dispatch, and the FINANCIAL / DESTRUCTIVE / CONSEQUENTIAL routes
// (PayBill, DeleteRelationship, Accept*/Decline*/Retract*, MoveCorpHQHere) are only
// ever exercised on the refuse-without-confirm path here.

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
      // All 20 R99 handlers return null on success. (Nothing is fired live — this is
      // the FAKE recorder used only by the confirm-path assertions.)
      return { service, method, result: null, notifications: [] };
    },
    async bindObject() {
      throw new Error("R99 alliance/war/station writes need no bound objects");
    },
    async callBoundMethod() {
      throw new Error("R99 alliance/war/station writes need no bound objects");
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

// --- the 20 R99 alliance / war / corp-station write routes --------------------

const R99_WRITE_ROUTES = [
  // allianceRegistry (10)
  ["/api/bridge/ally/relationship/set", { relationship: 5, toID: 99000001 }],
  ["/api/bridge/ally/relationship/delete", { toID: 99000001 }], // destructive
  ["/api/bridge/ally/contact/add", { contactID: 99000001, relationshipID: 5 }],
  ["/api/bridge/ally/bulletin/add", { title: "Notice", body: "Hello" }],
  ["/api/bridge/ally/application/update", { corporationID: 98000001, applicationText: "hi", state: 1 }],
  ["/api/bridge/ally/bill/pay", { billID: 123 }], // ISK
  ["/api/bridge/ally/prime-hour/set", { hour: 20 }],
  ["/api/bridge/ally/capital-system/set", { solarSystemID: 30000142 }],
  ["/api/bridge/ally/executor-support/declare", { chosenExecutorCorporationID: 98000001 }],
  ["/api/bridge/ally/update", { description: "New desc", url: "http://x" }],
  // warRegistry (9)
  ["/api/bridge/war/ally-offer/create", { warID: 1, iskValue: 1000000, defenderID: 98000002, description: "help" }],
  ["/api/bridge/war/ally-offer/retract", { warNegotiationID: 2 }],
  ["/api/bridge/war/surrender/create", { warID: 1, iskValue: 5000000, description: "terms" }],
  ["/api/bridge/war/ally-negotiation/accept", { warNegotiationID: 2 }], // ISK / consequential
  ["/api/bridge/war/ally-offer/decline", { warNegotiationID: 2 }],
  ["/api/bridge/war/surrender/accept", { warNegotiationID: 2 }], // ends a war
  ["/api/bridge/war/surrender/decline", { warNegotiationID: 2 }], // consequential
  ["/api/bridge/war/mutual/retract", { warID: 1 }], // ends a war
  ["/api/bridge/war/open-for-allies/set", { warID: 1, state: true }],
  // corpStationMgr (1)
  ["/api/bridge/corpstn/hq/move-here", { stationID: 60003760 }], // consequential
];

test("⚠⚠ every R99 alliance/war/station write REFUSES without confirm — no dispatch (nothing fired)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  assert.equal(R99_WRITE_ROUTES.length, 20, "all 20 R99 write routes are covered");
  for (const [path, body] of R99_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "a refused write must not dispatch");
});

test("R99 SetRelationship forwards [relationship, toID] on allianceRegistry (alliance derived server-side)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/ally/relationship/set", {
    method: "POST",
    body: { relationship: 5, toID: 99000001, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  const call = gateway.calls.topLevel.find((c) => c.method === "SetRelationship");
  assert.ok(call, "SetRelationship must reach the gateway once confirmed");
  assert.equal(call.service, "allianceRegistry");
  assert.deepEqual(call.args, [5, 99000001]);
});

test("R99 SetOpenForAllies forwards [warID, boolean] on warRegistry", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/war/open-for-allies/set", {
    method: "POST",
    body: { warID: 1, state: true, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "SetOpenForAllies");
  assert.ok(call, "SetOpenForAllies must reach the gateway once confirmed");
  assert.equal(call.service, "warRegistry");
  assert.deepEqual(call.args, [1, true]);
});

test("R99 AddBulletin defaults an omitted bulletinID to null (create) on allianceRegistry", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/ally/bulletin/add", {
    method: "POST",
    body: { title: "Notice", body: "Hello", confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "AddBulletin");
  assert.ok(call, "AddBulletin must reach the gateway once confirmed");
  assert.equal(call.service, "allianceRegistry");
  assert.deepEqual(call.args, ["Notice", "Hello", null]);
});

test("R99 MoveCorpHQHere forwards a station id on corpStationMgr (corp derived server-side)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/corpstn/hq/move-here", {
    method: "POST",
    body: { stationID: 60003760, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "MoveCorpHQHere");
  assert.ok(call, "MoveCorpHQHere must reach the gateway once confirmed");
  assert.equal(call.service, "corpStationMgr");
  assert.deepEqual(call.args, [60003760]);
});

test("R99 write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R99_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "no dispatch without a held session");
});
