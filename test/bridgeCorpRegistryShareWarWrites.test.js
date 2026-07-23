"use strict";

// Goal R98 (Phase-4 top-level WRITES): the BFF corpRegistry batch-C write routes
// (shares / dividend / kicks / CEO-resign / applications / alliance / war).
// PLUMBING ONLY — no UI. WB-CORPREG split 3 of 3 (CLOSES corpRegistry writes).
//
// ⚠⚠ EVERY route in this batch is FINANCIAL or DESTRUCTIVE. Every route is
// CONFIRM-GATED: without `confirm: true` it answers 400 CONFIRMATION_REQUIRED and
// NOTHING dispatches to the gateway. This suite proves the gate (all 14 refuse
// without confirm), that a couple of representative writes forward their args on
// service "corpRegistry" ONCE confirmed against a FAKE recording gateway, and that
// the arg-injection-safe writes pass corporationID = null (session corp). NO write
// was ever fired against the live world — the fake gateway only records dispatch.

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
      // ID-returning writes echo a number; the rest return null. (Nothing is fired
      // live — this is the FAKE recorder used only by the confirm-path assertions.)
      const idReturning = new Set([
        "InsertApplication",
        "InsertInvitation",
        "AddCorporation",
        "CreateAlliance",
      ]);
      const result = idReturning.has(method) ? 900001 : null;
      return { service, method, result, notifications: [] };
    },
    async bindObject() {
      throw new Error("R98 corpRegistry writes need no bound objects");
    },
    async callBoundMethod() {
      throw new Error("R98 corpRegistry writes need no bound objects");
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

// --- the 14 R98 corpRegistry batch-C write routes ----------------------------

const R98_WRITE_ROUTES = [
  // Shares (2)
  ["/api/bridge/corpreg/shares/move-company", { toShareholderID: 140000002, numberOfShares: 10 }],
  ["/api/bridge/corpreg/shares/move-private", { toShareholderID: 140000002, numberOfShares: 10 }],
  // Dividend (1) — ISK
  ["/api/bridge/corpreg/dividend/payout", { payoutAmount: 1000000 }],
  // Kicks + CEO-resign (3) — destructive
  ["/api/bridge/corpreg/member/kick", { characterID: 140000002 }],
  ["/api/bridge/corpreg/member/kick-many", { characterIDs: [140000002, 140000003] }],
  ["/api/bridge/corpreg/ceo/resign", { newCEOID: 140000002 }],
  // Applications (3)
  ["/api/bridge/corpreg/application/insert", { corporationID: 98000001, applicationText: "hi" }],
  ["/api/bridge/corpreg/application/invite", { characterID: 140000002 }],
  ["/api/bridge/corpreg/application/update-offer", { applicationID: 5, characterID: 140000002, corporationID: 98000000, status: 4 }],
  // Alliance + corp-creation (4) — ISK / creates
  ["/api/bridge/corpreg/corp/create", { name: "New Corp", tickerName: "NC" }],
  ["/api/bridge/corpreg/alliance/create", { name: "New Alliance", shortName: "NA" }],
  ["/api/bridge/corpreg/alliance/apply", { allianceID: 99000001, applicationText: "hi" }],
  ["/api/bridge/corpreg/alliance/delete-application", { allianceID: 99000001 }],
  // War (1) — ISK
  ["/api/bridge/corpreg/war/declare", { againstID: 98000002, warHQ: 60003760 }],
];

test("⚠⚠ every R98 corpRegistry batch-C write REFUSES without confirm — no dispatch (nothing fired)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const [path, body] of R98_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "a refused financial/destructive write must not dispatch");
});

test("R98 share moves pass corporationID = null (SESSION corp, not caller-supplied) on corpRegistry", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/corpreg/shares/move-company", {
    method: "POST",
    body: { toShareholderID: 140000002, numberOfShares: 25, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  const call = gateway.calls.topLevel.find((c) => c.method === "MoveCompanyShares");
  assert.ok(call, "MoveCompanyShares must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  // arg[0] corporationID is null so the handler resolves the SESSION corp.
  assert.deepEqual(call.args, [null, 140000002, 25]);
});

test("R98 DeclareWarAgainst forwards target + warHQ on corpRegistry (declarer derived server-side)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/corpreg/war/declare", {
    method: "POST",
    body: { againstID: 98000002, warHQ: 60003760, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "DeclareWarAgainst");
  assert.ok(call, "DeclareWarAgainst must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  assert.deepEqual(call.args, [98000002, 60003760]);
});

test("R98 AddCorporation forwards a 15-slot positional args array and echoes its id", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/corpreg/corp/create", {
    method: "POST",
    body: { name: "New Corp", tickerName: "NC", taxRate: 0.05, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.result, 900001, "AddCorporation's corporationID is surfaced as result");
  const call = gateway.calls.topLevel.find((c) => c.method === "AddCorporation");
  assert.ok(call, "AddCorporation must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  assert.equal(call.args.length, 15);
  assert.equal(call.args[0], "New Corp");
  assert.equal(call.args[1], "NC");
  assert.equal(call.args[4], 0.05);
});

test("R98 kick-many forwards a coerced id list on corpRegistry", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/corpreg/member/kick-many", {
    method: "POST",
    body: { characterIDs: [140000002, 140000003], confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "KickOutMembers");
  assert.ok(call, "KickOutMembers must reach the gateway once confirmed");
  assert.deepEqual(call.args, [[140000002, 140000003]]);
});

test("R98 write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R98_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "no dispatch without a held session");
});
