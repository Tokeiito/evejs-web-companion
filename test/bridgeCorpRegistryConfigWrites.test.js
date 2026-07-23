"use strict";

// Goal R97 (Phase-4 top-level WRITES): the BFF corpRegistry batch-B write routes
// (member config / corp config / settings / title-delete / execute-actions).
// PLUMBING ONLY — no UI.
//
// Every route is CONFIRM-GATED: without `confirm: true` it answers 400
// CONFIRMATION_REQUIRED and NOTHING dispatches to the gateway. The extra-care ones
// (title/delete destructive, member/execute-actions generic executor) carry the
// same gate and are exercised through their REFUSAL path only — never fired
// through-to-dispatch here. This suite proves the gate + that a non-destructive
// write reaches the gateway on service "corpRegistry" once confirmed, and that a
// couple of writes forward their args cleanly. corpRegistry writes are role-gated
// server-side — the fake gateway simply records the dispatch, which is what the
// BFF is responsible for.

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
      // SetAccountKey echoes a boolean; the rest return null.
      const result = method === "SetAccountKey" ? true : null;
      return { service, method, result, notifications: [] };
    },
    async bindObject() {
      throw new Error("R97 corpRegistry writes need no bound objects");
    },
    async callBoundMethod() {
      throw new Error("R97 corpRegistry writes need no bound objects");
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

// --- the 14 R97 corpRegistry batch-B write routes ---------------------------

const R97_WRITE_ROUTES = [
  // Member config (2)
  ["/api/bridge/corpreg/member/update", { memberID: 140000002, title: "Ops" }],
  ["/api/bridge/corpreg/member/update-many", { members: [[140000002, "Ops"]] }],
  // Corp config (4)
  ["/api/bridge/corpreg/corp/update", { description: "d", url: "u", taxRate: 0.1 }],
  ["/api/bridge/corpreg/corp/abilities", { applicationsEnabled: true }],
  ["/api/bridge/corpreg/corp/logo", { shape1: 1, color1: 2 }],
  ["/api/bridge/corpreg/corp/division-names", { names: ["Div 1"] }],
  // Settings (6)
  ["/api/bridge/corpreg/member/account-key", { accountKey: 1001 }],
  ["/api/bridge/corpreg/corp/welcome-mail", { welcomeMail: "Welcome!" }],
  ["/api/bridge/corpreg/corp/reinforce-default", { hour: 18 }],
  ["/api/bridge/corpreg/settings/aggression", { friendlyFireLegal: true }],
  ["/api/bridge/corpreg/settings/accept-structures", { acceptStructures: true }],
  ["/api/bridge/corpreg/settings/mail-restriction", { restrictCorpMails: true }],
  // Extra-care (2) — refusal path only
  ["/api/bridge/corpreg/title/delete", { titleID: 1 }],
  ["/api/bridge/corpreg/member/execute-actions", { targetIDs: [140000002], actions: null }],
];

test("⚠ every R97 corpRegistry batch-B write REFUSES without confirm — no dispatch", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const [path, body] of R97_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "a refused write must not dispatch");
});

test("R97 writes dispatch on the corpRegistry service, never a bound step", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  // corp/abilities is a non-destructive, non-extra-care write — exercise dispatch.
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/corpreg/corp/abilities", {
    method: "POST",
    body: { applicationsEnabled: true, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, true);
  const call = gateway.calls.topLevel.find((c) => c.method === "UpdateCorporationAbilities");
  assert.ok(call, "UpdateCorporationAbilities must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  assert.deepEqual(call.args, [1]);
});

test("R97 member/update forwards a full positional row scoped to the session corp", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/corpreg/member/update", {
    method: "POST",
    body: { memberID: 140000002, title: "Ops", divisionID: 3, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "UpdateMember");
  assert.ok(call, "UpdateMember must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  assert.equal(call.args[0], 140000002);
  assert.equal(call.args[1], "Ops");
  assert.equal(call.args[2], 3);
  assert.equal(call.args.length, 15);
});

test("R97 SetAccountKey forwards the key on corpRegistry and echoes its boolean", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/corpreg/member/account-key", {
    method: "POST",
    body: { accountKey: 1001, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.result, true, "SetAccountKey's boolean is surfaced as result");
  const call = gateway.calls.topLevel.find((c) => c.method === "SetAccountKey");
  assert.ok(call, "SetAccountKey must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  assert.deepEqual(call.args, [1001]);
});

test("R97 division-names forwards a 14-slot positional args array", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/corpreg/corp/division-names", {
    method: "POST",
    body: { names: ["Alpha", "Beta"], confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "UpdateDivisionNames");
  assert.ok(call, "UpdateDivisionNames must reach the gateway once confirmed");
  assert.equal(call.args.length, 14);
  assert.equal(call.args[0], "Alpha");
  assert.equal(call.args[1], "Beta");
  assert.equal(call.args[2], null);
});

test("R97 write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R97_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "no dispatch without a held session");
});
