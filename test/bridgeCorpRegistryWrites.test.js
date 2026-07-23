"use strict";

// Goal R96 (Phase-4 top-level WRITES): the BFF corpRegistry batch-A write routes
// (bulletins / labels / contacts / titles). PLUMBING ONLY — no UI.
//
// Every route is CONFIRM-GATED: without `confirm: true` it answers 400
// CONFIRMATION_REQUIRED and NOTHING dispatches to the gateway. The destructive
// ones (bulletin/delete, label/delete, contact/remove) carry the same gate — this
// suite proves the gate + that a non-destructive write (contact/add) reaches the
// gateway on service "corpRegistry" once confirmed, and that a couple of writes
// forward their args cleanly. No destructive write is exercised through-to-
// dispatch here; only its refusal path. corpRegistry writes are role-gated
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
      // AddBulletin / CreateLabel echo an id; the rest return null.
      const result = method === "AddBulletin" || method === "CreateLabel" ? 101 : null;
      return { service, method, result, notifications: [] };
    },
    async bindObject() {
      throw new Error("R96 corpRegistry writes need no bound objects");
    },
    async callBoundMethod() {
      throw new Error("R96 corpRegistry writes need no bound objects");
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

// --- the 15 R96 corpRegistry batch-A write routes ---------------------------

const R96_WRITE_ROUTES = [
  // Bulletins (4)
  ["/api/bridge/corpreg/bulletin/add", { title: "Notice", body: "text" }],
  ["/api/bridge/corpreg/bulletin/update", { bulletinID: 1, title: "T", body: "b" }],
  ["/api/bridge/corpreg/bulletin/reorder", { order: [3, 1, 2] }],
  ["/api/bridge/corpreg/bulletin/delete", { bulletinID: 1 }],
  // Labels (5)
  ["/api/bridge/corpreg/label/create", { name: "Blue", color: 255 }],
  ["/api/bridge/corpreg/label/edit", { labelID: 1, name: "Red" }],
  ["/api/bridge/corpreg/label/delete", { labelID: 1 }],
  ["/api/bridge/corpreg/label/assign", { contactIDs: [140000002], labelMask: 1 }],
  ["/api/bridge/corpreg/label/remove", { contactIDs: [140000002], labelMask: 1 }],
  // Contacts (4)
  ["/api/bridge/corpreg/contact/add", { contactID: 140000002, relationshipID: 5 }],
  ["/api/bridge/corpreg/contact/edit", { contactID: 140000002, relationshipID: -5 }],
  ["/api/bridge/corpreg/contact/remove", { contactIDs: [140000002] }],
  ["/api/bridge/corpreg/contact/set-standing", { contactIDs: [140000002], relationshipID: 10 }],
  // Titles (2)
  ["/api/bridge/corpreg/title/update", { titleID: 1, titleName: "Director" }],
  ["/api/bridge/corpreg/title/update-many", { titles: [[1, "Director"]] }],
];

test("⚠ every R96 corpRegistry batch-A write REFUSES without confirm — no dispatch", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const [path, body] of R96_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "a refused write must not dispatch");
});

test("R96 writes dispatch on the corpRegistry service, never a bound step", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  // contact/add is a non-destructive write — exercise its confirmed dispatch.
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/corpreg/contact/add", {
    method: "POST",
    body: { contactID: 140000002, relationshipID: 5, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, true);
  const call = gateway.calls.topLevel.find((c) => c.method === "AddCorporateContact");
  assert.ok(call, "AddCorporateContact must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  assert.deepEqual(call.args, [140000002, 5]);
});

test("R96 AddBulletin forwards [title, body, bulletinID, editDateTime] and echoes the id", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/corpreg/bulletin/add", {
    method: "POST",
    body: { title: "Notice", body: "hello", confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.result, 101, "the allocated bulletinID is surfaced as result");
  const call = gateway.calls.topLevel.find((c) => c.method === "AddBulletin");
  assert.ok(call, "AddBulletin must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  assert.deepEqual(call.args, ["Notice", "hello", null, null]);
});

test("R96 contact/set-standing forwards [contactIDs, relationshipID] on corpRegistry", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/corpreg/contact/set-standing", {
    method: "POST",
    body: { contactIDs: [140000002, 140000005], relationshipID: 10, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.topLevel.find((c) => c.method === "EditContactsRelationshipID");
  assert.ok(call, "EditContactsRelationshipID must reach the gateway once confirmed");
  assert.equal(call.service, "corpRegistry");
  assert.deepEqual(call.args, [[140000002, 140000005], 10]);
});

test("R96 write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R96_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "no dispatch without a held session");
});
