"use strict";

// Goal R59 (PLUMBING ONLY — no UI): the three comms READ routes wired for later
// UI. Each dispatches allowlisted TOP-LEVEL reads on the held session:
//   • GET /api/bridge/mail-aux — mailMgr.GetLabels (arg-less) + the four
//     mailingListsMgr reads GetJoinedLists (arg-less) + GetInfo/GetMembers/
//     GetSettings ([listID] from the query, default 0). Five INDEPENDENT reads;
//     empty ≠ failed.
//   • GET /api/bridge/notifications — notificationMgr.GetAllNotifications
//     ([fromID]) + GetUnprocessed (arg-less) + GetByGroupID ([groupID]).
//   • GET /api/bridge/calendar — calendarMgr.GetResponsesForCharacter (arg-less)
//     + calendarProxy.GetEventList ([month, year]) + calendarMgr.GetResponsesTo-
//     Event ([eventID, ownerID]) + calendarProxy.GetEventDetails ([eventID,
//     ownerID]). month/year default to the current UTC month; eventID/ownerID
//     from the query (ownerID 0 -> null).
// The fixtures are the real retail shapes captured live from Farmer on 2026-07-22
// (mail empty; 213 notifications; one calendar event). Wire contract:
// docs/bridge-wire-contract.md.

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

function keyVal(entries) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function dict(entries) {
  return { type: "dict", entries };
}
function list(items) {
  return { type: "list", items };
}

// The real captured comms shapes (Farmer, character 140000005).
// Mail aux was entirely EMPTY (no labels, no lists).
const LABELS = dict([]);
const JOINED_LISTS = dict([]);
const LIST_INFO = null;
const LIST_MEMBERS = dict([]);
const LIST_SETTINGS = null;
// A verbatim live notification DTO.
const NOTIFICATION = keyVal([
  ["notificationID", 2877],
  ["typeID", 35],
  ["senderID", 1000113],
  ["receiverID", 140000005],
  ["processed", false],
  ["created", { type: "long", value: "134282765436910000" }],
  ["data", dict([["itemID", 9988400082811], ["payout", true]])],
]);
const ALL_NOTIFICATIONS = [NOTIFICATION];
const UNPROCESSED = [NOTIFICATION];
const BY_GROUP = [NOTIFICATION];
// Calendar: responses empty live; one real event.
const RESPONSES_FOR_CHARACTER = list([]);
const EVENT_LIST = [
  list([
    keyVal([
      ["eventID", 980000000006],
      ["ownerID", 1],
      ["eventDateTime", { type: "long", value: "134282418600000000" }],
      ["eventDuration", 11],
      ["eventTitle", "Make a wish"],
      ["importance", 0],
      ["dateModified", { type: "long", value: "134274243506890000" }],
      ["isDeleted", false],
      ["flag", 8],
      ["autoEventType", null],
    ]),
  ]),
  null,
  null,
];
const RESPONSES_TO_EVENT = list([]);
const EVENT_DETAILS = keyVal([["eventText", "The clock reads 11:11 — make a wish."], ["creatorID", 1]]);

const RESULTS = {
  "mailMgr.GetLabels": LABELS,
  "mailingListsMgr.GetJoinedLists": JOINED_LISTS,
  "mailingListsMgr.GetInfo": LIST_INFO,
  "mailingListsMgr.GetMembers": LIST_MEMBERS,
  "mailingListsMgr.GetSettings": LIST_SETTINGS,
  "notificationMgr.GetAllNotifications": ALL_NOTIFICATIONS,
  "notificationMgr.GetUnprocessed": UNPROCESSED,
  "notificationMgr.GetByGroupID": BY_GROUP,
  "calendarMgr.GetResponsesForCharacter": RESPONSES_FOR_CHARACTER,
  "calendarProxy.GetEventList": EVENT_LIST,
  "calendarMgr.GetResponsesToEvent": RESPONSES_TO_EVENT,
  "calendarProxy.GetEventDetails": EVENT_DETAILS,
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

test("GET /api/bridge/mail-aux dispatches GetLabels + the four mailingLists reads (empty ok)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail-aux?listID=100");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.requested, { listID: 100 });
  assert.deepEqual(payload.labels, LABELS);
  assert.deepEqual(payload.joinedLists, JOINED_LISTS);
  assert.equal(payload.listInfo, null);
  assert.deepEqual(payload.listMembers, LIST_MEMBERS);
  assert.equal(payload.listSettings, null);
  assert.deepEqual(payload.errors, {
    labels: null,
    joinedLists: null,
    listInfo: null,
    listMembers: null,
    listSettings: null,
  });

  // GetLabels + GetJoinedLists are arg-less (session-scoped); the three detail
  // reads carry the query listID.
  assert.equal(callFor(gateway, "GetLabels").service, "mailMgr");
  assert.deepEqual(callFor(gateway, "GetLabels").args, []);
  assert.equal(callFor(gateway, "GetJoinedLists").service, "mailingListsMgr");
  assert.deepEqual(callFor(gateway, "GetJoinedLists").args, []);
  for (const method of ["GetInfo", "GetMembers", "GetSettings"]) {
    const read = callFor(gateway, method);
    assert.equal(read.service, "mailingListsMgr", method);
    assert.deepEqual(read.args, [100], `${method} carries the query listID`);
    assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID);
  }
});

test("mail-aux defaults listID to 0 when the query omits it", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, "/api/bridge/mail-aux");
  assert.deepEqual(payload.requested, { listID: 0 });
  assert.deepEqual(callFor(gateway, "GetInfo").args, [0]);
});

test("GET /api/bridge/notifications dispatches the three notificationMgr reads", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/notifications?fromID=100&groupID=5");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.requested, { fromID: 100, groupID: 5 });
  assert.deepEqual(payload.all, ALL_NOTIFICATIONS);
  assert.deepEqual(payload.unprocessed, UNPROCESSED);
  assert.deepEqual(payload.byGroup, BY_GROUP);
  assert.deepEqual(payload.errors, { all: null, unprocessed: null, byGroup: null });

  assert.equal(callFor(gateway, "GetAllNotifications").service, "notificationMgr");
  assert.deepEqual(callFor(gateway, "GetAllNotifications").args, [100]);
  assert.deepEqual(callFor(gateway, "GetUnprocessed").args, []);
  assert.deepEqual(callFor(gateway, "GetByGroupID").args, [5]);
  for (const method of ["GetAllNotifications", "GetUnprocessed", "GetByGroupID"]) {
    assert.equal(callFor(gateway, method).bridgeSessionID, BRIDGE_SESSION_ID);
  }
});

test("notifications defaults fromID/groupID to 0 when the query omits them", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, "/api/bridge/notifications");
  assert.deepEqual(payload.requested, { fromID: 0, groupID: 0 });
  assert.deepEqual(callFor(gateway, "GetAllNotifications").args, [0]);
  assert.deepEqual(callFor(gateway, "GetByGroupID").args, [0]);
});

test("GET /api/bridge/calendar dispatches the four calendar reads across both services", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(
    baseUrl,
    "/api/bridge/calendar?month=7&year=2026&eventID=980000000006&ownerID=1",
  );
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.requested, { month: 7, year: 2026, eventID: 980000000006, ownerID: 1 });
  assert.deepEqual(payload.responsesForCharacter, RESPONSES_FOR_CHARACTER);
  assert.deepEqual(payload.eventList, EVENT_LIST);
  assert.deepEqual(payload.responsesToEvent, RESPONSES_TO_EVENT);
  assert.deepEqual(payload.eventDetails, EVENT_DETAILS);

  // GetResponsesForCharacter is arg-less on calendarMgr; GetEventList/GetEventDetails
  // are on the TOP-LEVEL calendarProxy.
  assert.equal(callFor(gateway, "GetResponsesForCharacter").service, "calendarMgr");
  assert.deepEqual(callFor(gateway, "GetResponsesForCharacter").args, []);
  assert.equal(callFor(gateway, "GetEventList").service, "calendarProxy");
  assert.deepEqual(callFor(gateway, "GetEventList").args, [7, 2026]);
  assert.equal(callFor(gateway, "GetResponsesToEvent").service, "calendarMgr");
  assert.deepEqual(callFor(gateway, "GetResponsesToEvent").args, [980000000006, 1]);
  assert.equal(callFor(gateway, "GetEventDetails").service, "calendarProxy");
  assert.deepEqual(callFor(gateway, "GetEventDetails").args, [980000000006, 1]);
});

test("calendar defaults month/year to the current UTC month and eventID/ownerID to 0/null", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();

  const { payload } = await apiRequest(baseUrl, "/api/bridge/calendar");
  assert.deepEqual(payload.requested, { month, year, eventID: 0, ownerID: 0 });
  assert.deepEqual(callFor(gateway, "GetEventList").args, [month, year]);
  // ownerID 0 collapses to null so the handler's owner check is not spuriously pinned.
  assert.deepEqual(callFor(gateway, "GetResponsesToEvent").args, [0, null]);
  assert.deepEqual(callFor(gateway, "GetEventDetails").args, [0, null]);
});

test("one failed read carries its own error code; the rest still return (empty ≠ failed)", async () => {
  const gateway = fakeGateway({
    async callMethod(service, method) {
      if (method === "GetSettings") {
        const error = new Error("settings unavailable");
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

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/mail-aux");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.labels, LABELS, "the other reads still return");
  assert.equal(payload.listSettings, null, "the failed read has no value");
  assert.equal(payload.errors.listSettings, "CALL_FAILED", "the failed read carries its code");
  assert.equal(payload.errors.labels, null);
});

test("a lost live session unwinds each comms route (404 SESSION_NOT_FOUND)", async () => {
  const gateway = fakeGateway({
    async callMethod() {
      const error = new Error("gone");
      error.code = "SESSION_NOT_FOUND";
      error.statusCode = 404;
      throw error;
    },
  });
  for (const path of ["/api/bridge/mail-aux", "/api/bridge/notifications", "/api/bridge/calendar"]) {
    const { baseUrl } = await startTestServer({ gateway });
    await selectOnServer(baseUrl);
    const { response, payload } = await apiRequest(baseUrl, path);
    assert.equal(response.status, 404, path);
    assert.equal(payload.error, "SESSION_NOT_FOUND", path);
  }
});

test("each comms route requires a live session (409 NO_LIVE_SESSION with no character online)", async () => {
  for (const path of ["/api/bridge/mail-aux", "/api/bridge/notifications", "/api/bridge/calendar"]) {
    const { baseUrl } = await startTestServer();
    const { response, payload } = await apiRequest(baseUrl, path);
    assert.equal(response.status, 409, path);
    assert.equal(payload.error, "NO_LIVE_SESSION", path);
  }
});
