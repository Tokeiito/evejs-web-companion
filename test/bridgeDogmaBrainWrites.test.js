"use strict";

// Goal R101 (Phase-4 BOUND WRITES): the BFF dogma batch-B write routes — WB-DOGMA
// batch B (11 writes: weapon-bank peel/unlink/link-all/unlink-all/destroy, probe
// launch, drone settings, and the char-brain inject-skill / inject-implant /
// destroy-implant / use-booster ops). PLUMBING ONLY — no UI. CLOSES WB-DOGMA (22/22).
//
// These ride the SAME dogmaIM.MachoBindObject bind the R74 dogma READS use: each
// dispatches as a BOUND method off dogmaBindSpec() (boundCall → callBoundMethod),
// NOT the top-level /call seam. Every route is CONFIRM-GATED: without `confirm: true`
// it answers 400 CONFIRMATION_REQUIRED and NOTHING dispatches (no bind, no bound
// call). This suite proves the gate (all 11 refuse without confirm), that a few
// representative writes forward their args as a bound dogma call ONCE confirmed
// against a FAKE recording gateway, and that no route dispatches without a held
// bridge session. NO write was ever fired against the live world (operator owns
// EveJS; no server restart this batch).

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
const SHIP_ID = 9001;

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
  const calls = { bind: [], boundCall: [] };
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
          shipID: SHIP_ID,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: CHARACTER_ID };
    },
    async readFlightStatus() {
      return {
        flight: { docked: true, inSpace: false, stationID: STATION_ID, solarSystemID: SOLAR_SYSTEM_ID, shipID: SHIP_ID },
        notifications: [],
      };
    },
    async callMethod(service, method) {
      throw new Error(`R101 dogma batch-B writes are BOUND — unexpected top-level ${service}.${method}`);
    },
    async bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.bind.push({ service, method, args, kwargs, bridgeSessionID });
      return { boundHandle: `handle:${service}:${method}:${JSON.stringify(args)}`, service, method, notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) {
      calls.boundCall.push({ service, method, args, kwargs, bridgeSessionID, boundHandle });
      // FAST-MODE fake: the real handlers return varied shapes (a weapon-bank state
      // dict / a peeledModuleID / null); the recorder acks null so the route folds
      // it into {ok, applied, result:null}.
      return { service, method, result: null, notifications: [] };
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

// --- the 11 R101 dogma batch-B write routes ----------------------------------

const R101_WRITE_ROUTES = [
  ["/api/bridge/dogma/weapons/peel-and-link", { shipID: SHIP_ID, targetMasterID: 7400000020, sourceMasterID: 7400000021 }],
  ["/api/bridge/dogma/weapons/unlink-module", { shipID: SHIP_ID, masterModuleID: 7400000020 }],
  ["/api/bridge/dogma/weapons/link-all", { shipID: SHIP_ID }],
  ["/api/bridge/dogma/weapons/unlink-all", { shipID: SHIP_ID }],
  ["/api/bridge/dogma/weapons/destroy-bank", { shipID: SHIP_ID, masterModuleID: 7400000020 }],
  ["/api/bridge/dogma/probes/launch", { moduleID: 7400000030, count: 8 }],
  ["/api/bridge/dogma/drones/settings", { settings: { aggression: 1, focusFire: true } }],
  ["/api/bridge/dogma/brain/inject-skill", { itemIDs: [7500000001, 7500000002] }],
  ["/api/bridge/dogma/implant/inject", { itemID: 7600000001 }],
  ["/api/bridge/dogma/implant/destroy", { itemID: 7600000001 }],
  ["/api/bridge/dogma/booster/use", { itemID: 7700000001, locationID: SHIP_ID }],
];

test("⚠ every R101 dogma batch-B write REFUSES without confirm — no bind, no dispatch (nothing fired)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  assert.equal(R101_WRITE_ROUTES.length, 11, "all 11 R101 write routes are covered");
  for (const [path, body] of R101_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  assert.equal(gateway.calls.boundCall.length, 0, "a refused write must not dispatch a bound call");
  assert.equal(gateway.calls.bind.length, 0, "a refused write must not even bind the dogma object");
});

test("R101 PeelAndLink forwards [shipID, targetMasterID, sourceMasterID] as a BOUND dogmaIM call once confirmed", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/dogma/weapons/peel-and-link", {
    method: "POST",
    body: { shipID: SHIP_ID, targetMasterID: 7400000020, sourceMasterID: 7400000021, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, true);
  // Bound, not top-level: the dogma object is bound and the call rides callBoundMethod.
  assert.equal(gateway.calls.bind.length, 1, "the dogma object is bound once");
  assert.equal(gateway.calls.bind[0].service, "dogmaIM");
  assert.equal(gateway.calls.bind[0].method, "MachoBindObject");
  const call = gateway.calls.boundCall.find((c) => c.method === "PeelAndLink");
  assert.ok(call, "PeelAndLink must reach the gateway as a bound call once confirmed");
  assert.equal(call.service, "dogmaIM");
  assert.deepEqual(call.args, [SHIP_ID, 7400000020, 7400000021]);
  assert.match(call.boundHandle, /^handle:dogmaIM:MachoBindObject/);
});

test("R101 InjectSkillIntoBrain forwards [[itemIDs]] (a skillbook list) as a bound dogmaIM call", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/dogma/brain/inject-skill", {
    method: "POST",
    body: { itemIDs: [7500000001, 7500000002], confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "InjectSkillIntoBrain");
  assert.ok(call, "InjectSkillIntoBrain must reach the gateway once confirmed");
  assert.equal(call.service, "dogmaIM");
  assert.deepEqual(call.args, [[7500000001, 7500000002]]);
});

test("R101 UseBooster forwards [itemID, locationID] as a bound dogmaIM call", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/dogma/booster/use", {
    method: "POST",
    body: { itemID: 7700000001, locationID: SHIP_ID, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "UseBooster");
  assert.ok(call, "UseBooster must reach the gateway once confirmed");
  assert.equal(call.service, "dogmaIM");
  assert.deepEqual(call.args, [7700000001, SHIP_ID]);
});

test("R101 ChangeDroneSettings forwards [settings] as a bound dogmaIM call", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/dogma/drones/settings", {
    method: "POST",
    body: { settings: { aggression: 1, focusFire: true }, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "ChangeDroneSettings");
  assert.ok(call, "ChangeDroneSettings must reach the gateway once confirmed");
  assert.equal(call.service, "dogmaIM");
  assert.deepEqual(call.args, [{ aggression: 1, focusFire: true }]);
});

test("R101 LaunchProbes forwards [moduleID, count] as a bound dogmaIM call", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/dogma/probes/launch", {
    method: "POST",
    body: { moduleID: 7400000030, count: 8, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "LaunchProbes");
  assert.ok(call, "LaunchProbes must reach the gateway once confirmed");
  assert.equal(call.service, "dogmaIM");
  assert.deepEqual(call.args, [7400000030, 8]);
});

test("R101 write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R101_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.boundCall.length, 0, "no dispatch without a held session");
});
