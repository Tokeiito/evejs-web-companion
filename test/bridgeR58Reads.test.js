"use strict";

// Goal R58 (PLUMBING ONLY — no UI): the three charMgr social/profile READ routes
// wired for later UI. Each dispatches allowlisted TOP-LEVEL charMgr reads on the
// held session:
//   • GET /api/bridge/character-profile — GetPublicInfo + GetHomeStationRow +
//     GetCharacterCreationDate + GetSettingsInfo + GetPaperdollState +
//     GetCohortsForCharacter + GetPrivateInfoOnCorpChange (seven INDEPENDENT
//     reads, arg-less; empty ≠ failed).
//   • GET /api/bridge/character-notes — GetOwnerNoteLabels (arg-less) +
//     GetOwnerNote([noteID]) + GetNote([itemID]) (noteID/itemID from the query).
//   • GET /api/bridge/contact-list — GetContactList (arg-less, session-scoped).
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

// The real captured charMgr shapes (Farmer, character 140000005).
function keyVal(entries) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}
function rowset(columns, lines) {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: columns }],
        ["columns", { type: "list", items: columns }],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: lines }],
      ],
    },
  };
}

const PUBLIC_INFO = keyVal([["characterID", 140000005], ["characterName", "Farmer"], ["corporationID", 98000001]]);
const HOME_STATION_ROW = keyVal([["stationID", 60015249], ["stationTypeID", 92885], ["solarSystemID", 30100032]]);
const CREATION_DATE = { type: "long", value: "134274243893290000" };
const SETTINGS_INFO = [{ type: "Buffer", data: [99, 0, 0, 0] }, 0];
const PAPERDOLL_STATE = 0;
const COHORTS = { type: "list", items: [] };
const CORP_CHANGE = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [] },
    { type: "substream", value: keyVal([["corporationID", 98000001], ["corporationDateTime", CREATION_DATE]]) },
    { type: "list", items: [] },
  ],
};
const OWNER_NOTE_LABELS = rowset(["noteID", "label"], [[1, "S:Folders"]]);
const OWNER_NOTE = { type: "list", items: [keyVal([["noteID", 1], ["label", "S:Folders"], ["note", "1::F::0::Main|"]])] };
const ENTITY_NOTE = "";
const CONTACT_LIST = keyVal([
  ["addresses", rowset(["contactID", "inWatchlist", "relationshipID", "labelMask"], [])],
  ["blocked", rowset(["senderID"], [])],
]);

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

const CHARMGR_RESULTS = {
  GetPublicInfo: PUBLIC_INFO,
  GetHomeStationRow: HOME_STATION_ROW,
  GetCharacterCreationDate: CREATION_DATE,
  GetSettingsInfo: SETTINGS_INFO,
  GetPaperdollState: PAPERDOLL_STATE,
  GetCohortsForCharacter: COHORTS,
  GetPrivateInfoOnCorpChange: CORP_CHANGE,
  GetOwnerNoteLabels: OWNER_NOTE_LABELS,
  GetOwnerNote: OWNER_NOTE,
  GetNote: ENTITY_NOTE,
  GetContactList: CONTACT_LIST,
};

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
      if (service === "charMgr" && method in CHARMGR_RESULTS) {
        return { service, method, result: CHARMGR_RESULTS[method], notifications: [] };
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

test("GET /api/bridge/character-profile dispatches the seven charMgr reads top-level, arg-less", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/character-profile");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.publicInfo, PUBLIC_INFO);
  assert.deepEqual(payload.homeStationRow, HOME_STATION_ROW);
  assert.deepEqual(payload.creationDate, CREATION_DATE);
  assert.deepEqual(payload.settingsInfo, SETTINGS_INFO);
  assert.equal(payload.paperdollState, 0);
  assert.deepEqual(payload.cohorts, COHORTS);
  assert.deepEqual(payload.corpChange, CORP_CHANGE);
  assert.deepEqual(payload.errors, {
    publicInfo: null,
    homeStationRow: null,
    creationDate: null,
    settingsInfo: null,
    paperdollState: null,
    cohorts: null,
    corpChange: null,
  });

  const methods = [
    "GetPublicInfo",
    "GetHomeStationRow",
    "GetCharacterCreationDate",
    "GetSettingsInfo",
    "GetPaperdollState",
    "GetCohortsForCharacter",
    "GetPrivateInfoOnCorpChange",
  ];
  for (const method of methods) {
    const read = gateway.calls.call.find((c) => c.method === method);
    assert.ok(read, `${method} dispatched`);
    assert.equal(read.service, "charMgr");
    assert.deepEqual(read.args, [], `${method} arg-less (scopes to session character)`);
    assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID);
  }
});

test("GET /api/bridge/character-notes dispatches labels arg-less + note reads with the query ids", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/character-notes?noteID=1&itemID=42");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.requested, { noteID: 1, itemID: 42 });
  assert.deepEqual(payload.labels, OWNER_NOTE_LABELS);
  assert.deepEqual(payload.ownerNote, OWNER_NOTE);
  assert.equal(payload.entityNote, "");

  const labels = gateway.calls.call.find((c) => c.method === "GetOwnerNoteLabels");
  const ownerNote = gateway.calls.call.find((c) => c.method === "GetOwnerNote");
  const entityNote = gateway.calls.call.find((c) => c.method === "GetNote");
  assert.equal(labels.service, "charMgr");
  assert.deepEqual(labels.args, []);
  // The two id-bearing reads carry the query args, so a UI can page the notes.
  assert.deepEqual(ownerNote.args, [1]);
  assert.deepEqual(entityNote.args, [42]);
  for (const read of [labels, ownerNote, entityNote]) {
    assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID);
  }
});

test("character-notes defaults noteID/itemID to 1 when the query omits them", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, "/api/bridge/character-notes");
  assert.deepEqual(payload.requested, { noteID: 1, itemID: 1 });
  assert.deepEqual(gateway.calls.call.find((c) => c.method === "GetOwnerNote").args, [1]);
  assert.deepEqual(gateway.calls.call.find((c) => c.method === "GetNote").args, [1]);
});

test("GET /api/bridge/contact-list dispatches charMgr.GetContactList (empty ok)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/contact-list");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  // Two empty rowsets is a REAL "no contacts" answer, passed through untouched.
  assert.deepEqual(payload.contactList, CONTACT_LIST);

  const read = gateway.calls.call.find((c) => c.method === "GetContactList");
  assert.ok(read, "GetContactList dispatched");
  assert.equal(read.service, "charMgr");
  assert.deepEqual(read.args, []);
  assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID);
});

test("one failed profile read carries its own error code; the rest still return (empty ≠ failed)", async () => {
  const gateway = fakeGateway({
    async callMethod(service, method) {
      if (method === "GetSettingsInfo") {
        const error = new Error("settings unavailable");
        error.code = "CALL_FAILED";
        error.statusCode = 502;
        throw error;
      }
      return { service, method, result: method in CHARMGR_RESULTS ? CHARMGR_RESULTS[method] : null, notifications: [] };
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/character-profile");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.publicInfo, PUBLIC_INFO, "the identity read still returns");
  assert.equal(payload.settingsInfo, null, "the failed read has no value");
  assert.equal(payload.errors.settingsInfo, "CALL_FAILED", "the failed read carries its code");
  assert.equal(payload.errors.publicInfo, null);
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
  for (const path of ["/api/bridge/character-profile", "/api/bridge/character-notes", "/api/bridge/contact-list"]) {
    const { baseUrl } = await startTestServer({ gateway });
    await selectOnServer(baseUrl);
    const { response, payload } = await apiRequest(baseUrl, path);
    assert.equal(response.status, 404, path);
    assert.equal(payload.error, "SESSION_NOT_FOUND", path);
  }
});

test("each read route requires a live session (409 NO_LIVE_SESSION with no character online)", async () => {
  for (const path of ["/api/bridge/character-profile", "/api/bridge/character-notes", "/api/bridge/contact-list"]) {
    const { baseUrl } = await startTestServer();
    const { response, payload } = await apiRequest(baseUrl, path);
    assert.equal(response.status, 409, path);
    assert.equal(payload.error, "NO_LIVE_SESSION", path);
  }
});
