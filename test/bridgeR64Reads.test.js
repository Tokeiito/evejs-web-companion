"use strict";

// Goal R64 (PLUMBING ONLY — no UI): the agent/mission READ route wired for later
// UI. GET /api/bridge/agent-info dispatches the nine allowlisted agentMgr reads on
// the held session for one agentID:
//   • FIVE top-level: GetAgentStaticInfo([agentID]), GetAgentByID([agentID]),
//     GetSolarSystemOfAgent([agentID]), GetMyEpicArcStatus([]),
//     GetCompletedCareerAgentIDs([[careerAgentIDs]]) (the LIST is the single arg;
//     defaults to [agentID], overridable by ?agentIDs=).
//   • THREE bound on the agent moniker (agentMgr.MachoBindObject → callBoundMethod):
//     GetInfoServiceDetails, GetMissionJournalInfo, GetEntryPoint.
//   • GetDungeonShipRestrictions([dungeonID, gateID]) ONLY when ?dungeonID= is given.
// ⚠ Every agentMgr MUTATOR (RemoveOfferFromJournal / GotoLocation / WarpToLocation /
// WarpToAgentInSpace) must NEVER be dispatched. Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const CHARACTERS = [{ characterID: 7, accountID: 4, characterName: "Test Pilot" }];
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const SESSION_STATION_ID = 60000358;
const SESSION_SYSTEM_ID = 30000144;
const SESSION_CORP_ID = 98000001;
const AGENT_ID = 3008416;

const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();

// Sentinel results — the route must pass each through verbatim.
const STATIC_RESULT = { tag: "agentStaticInfo" };
const BYID_RESULT = { tag: "agentByID" };
const SOLAR_RESULT = 30002780;
const EPIC_RESULT = { tag: "epicArcStatus" };
const CAREER_RESULT = { tag: "completedCareerAgents" };
const INFO_RESULT = { tag: "infoServiceDetails" };
const JOURNAL_RESULT = { tag: "missionJournal" };
const ENTRY_RESULT = { tag: "entryPoint" };
const DUNGEON_RESULT = { tag: "dungeonShipRestrictions" };

const TOP_LEVEL_RESULTS = {
  "agentMgr.GetAgentStaticInfo": STATIC_RESULT,
  "agentMgr.GetAgentByID": BYID_RESULT,
  "agentMgr.GetSolarSystemOfAgent": SOLAR_RESULT,
  "agentMgr.GetMyEpicArcStatus": EPIC_RESULT,
  "agentMgr.GetCompletedCareerAgentIDs": CAREER_RESULT,
  "agentMgr.GetDungeonShipRestrictions": DUNGEON_RESULT,
};
const BOUND_RESULTS = {
  GetInfoServiceDetails: INFO_RESULT,
  GetMissionJournalInfo: JOURNAL_RESULT,
  GetEntryPoint: ENTRY_RESULT,
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
  const calls = { select: [], call: [], bind: [], boundCall: [] };
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
          stationID: SESSION_STATION_ID,
          structureID: null,
          solarSystemID: SESSION_SYSTEM_ID,
          corporationID: SESSION_CORP_ID,
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
      return { service, method, result: key in TOP_LEVEL_RESULTS ? TOP_LEVEL_RESULTS[key] : null, notifications: [] };
    },
    async bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.bind.push({ service, method, args, kwargs, sessionFields, bridgeSessionID });
      return { boundHandle: `handle:${service}:${method}:${JSON.stringify(args)}`, service, method, notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) {
      calls.boundCall.push({ service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle });
      return { service, method, result: method in BOUND_RESULTS ? BOUND_RESULTS[method] : null, notifications: [] };
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

function topCall(gateway, method) {
  return gateway.calls.call.find((c) => c.method === method);
}
function boundCallFor(gateway, method) {
  return gateway.calls.boundCall.find((c) => c.method === method);
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

// --- always-on reads --------------------------------------------------------

test("GET /api/bridge/agent-info dispatches the 5 top-level + 3 bound reads, passes each through", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, `/api/bridge/agent-info?agentID=${AGENT_ID}`);
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.agentID, AGENT_ID);
  assert.deepEqual(payload.staticInfo, STATIC_RESULT);
  assert.deepEqual(payload.agentByID, BYID_RESULT);
  assert.equal(payload.solarSystem, SOLAR_RESULT);
  assert.deepEqual(payload.epicArcStatus, EPIC_RESULT);
  assert.deepEqual(payload.completedCareerAgents, CAREER_RESULT);
  assert.deepEqual(payload.infoServiceDetails, INFO_RESULT);
  assert.deepEqual(payload.missionJournal, JOURNAL_RESULT);
  assert.deepEqual(payload.entryPoint, ENTRY_RESULT);
  // No dungeon named → not issued, value null.
  assert.equal(payload.dungeonShipRestrictions, null);

  // The five top-level reads are on agentMgr, on the held session.
  for (const method of [
    "GetAgentStaticInfo",
    "GetAgentByID",
    "GetSolarSystemOfAgent",
    "GetMyEpicArcStatus",
    "GetCompletedCareerAgentIDs",
  ]) {
    const read = topCall(gateway, method);
    assert.ok(read, `${method} issued`);
    assert.equal(read.service, "agentMgr", method);
    assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID, method);
  }
  // The three bound reads dispatch on the agent moniker bound via MachoBindObject.
  assert.ok(gateway.calls.bind.some((b) => b.service === "agentMgr" && b.method === "MachoBindObject" && b.args[0] === AGENT_ID));
  for (const method of ["GetInfoServiceDetails", "GetMissionJournalInfo", "GetEntryPoint"]) {
    const read = boundCallFor(gateway, method);
    assert.ok(read, `${method} issued`);
    assert.equal(read.service, "agentMgr", method);
    assert.equal(read.bridgeSessionID, BRIDGE_SESSION_ID, method);
  }

  // ⚠ The bound OID / handle must never cross to the browser.
  assert.equal(JSON.stringify(payload).includes("handle:"), false);

  // ⚠ No agentMgr MUTATOR is ever dispatched, and no dungeon read without a dungeonID.
  for (const method of [
    "RemoveOfferFromJournal",
    "GotoLocation",
    "WarpToLocation",
    "WarpToAgentInSpace",
    "GetDungeonShipRestrictions",
  ]) {
    assert.equal(topCall(gateway, method), undefined, `${method} not dispatched top-level`);
    assert.equal(boundCallFor(gateway, method), undefined, `${method} not dispatched bound`);
  }
});

test("the reads forward the agentID; career-agent list defaults to [agentID]; epic-arc is arg-less", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, `/api/bridge/agent-info?agentID=${AGENT_ID}`);
  assert.deepEqual(topCall(gateway, "GetAgentStaticInfo").args, [AGENT_ID]);
  assert.deepEqual(topCall(gateway, "GetAgentByID").args, [AGENT_ID]);
  assert.deepEqual(topCall(gateway, "GetSolarSystemOfAgent").args, [AGENT_ID]);
  assert.deepEqual(topCall(gateway, "GetMyEpicArcStatus").args, []);
  // ⚠ GetCompletedCareerAgentIDs takes the LIST as its single positional arg.
  assert.deepEqual(topCall(gateway, "GetCompletedCareerAgentIDs").args, [[AGENT_ID]]);
  assert.deepEqual(payload.requested, {
    agentID: AGENT_ID,
    careerAgentIDs: [AGENT_ID],
    dungeonID: null,
    gateID: null,
  });
});

test("?agentIDs= overrides the career-agent list (dropping non-positive ids)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(
    baseUrl,
    `/api/bridge/agent-info?agentID=${AGENT_ID}&agentIDs=3008416,3010879,0,-4`,
  );
  assert.deepEqual(topCall(gateway, "GetCompletedCareerAgentIDs").args, [[3008416, 3010879]]);
  assert.deepEqual(payload.requested.careerAgentIDs, [3008416, 3010879]);
});

// --- conditional dungeon read ----------------------------------------------

test("?dungeonID= issues GetDungeonShipRestrictions with [dungeonID, gateID]", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(
    baseUrl,
    `/api/bridge/agent-info?agentID=${AGENT_ID}&dungeonID=43&gateID=596711`,
  );
  assert.deepEqual(payload.dungeonShipRestrictions, DUNGEON_RESULT);
  assert.deepEqual(topCall(gateway, "GetDungeonShipRestrictions").args, [43, 596711]);
  assert.deepEqual(payload.requested.dungeonID, 43);
  assert.deepEqual(payload.requested.gateID, 596711);
});

test("?dungeonID= without a gate forwards a null gateID", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, `/api/bridge/agent-info?agentID=${AGENT_ID}&dungeonID=43`);
  assert.deepEqual(topCall(gateway, "GetDungeonShipRestrictions").args, [43, null]);
});

// --- validation + error handling -------------------------------------------

test("a missing/invalid agentID is a 400 INVALID_AGENT (no reads issued)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/agent-info");
  assert.equal(response.status, 400);
  assert.equal(payload.error, "INVALID_AGENT");
  assert.equal(gateway.calls.call.length, 0);
  assert.equal(gateway.calls.boundCall.length, 0);
});

test("one failed read carries its own error code; the rest still return", async () => {
  const gateway = fakeGateway({
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      if (method === "GetMyEpicArcStatus") {
        const error = new Error("boom");
        error.code = "CALL_FAILED";
        error.statusCode = 502;
        throw error;
      }
      const key = `${service}.${method}`;
      return { service, method, result: key in TOP_LEVEL_RESULTS ? TOP_LEVEL_RESULTS[key] : null, notifications: [] };
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, `/api/bridge/agent-info?agentID=${AGENT_ID}`);
  assert.equal(response.status, 200);
  assert.equal(payload.epicArcStatus, null, "the failed read has no value");
  assert.equal(payload.errors.epicArcStatus, "CALL_FAILED", "the failed read carries its code");
  assert.deepEqual(payload.staticInfo, STATIC_RESULT, "the other reads still return");
  assert.deepEqual(payload.infoServiceDetails, INFO_RESULT, "the bound reads still return");
});

test("a lost live session unwinds the R64 route (404 SESSION_NOT_FOUND)", async () => {
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
  const { response, payload } = await apiRequest(baseUrl, `/api/bridge/agent-info?agentID=${AGENT_ID}`);
  assert.equal(response.status, 404);
  assert.equal(payload.error, "SESSION_NOT_FOUND");
});

test("the R64 route requires a live session (409 NO_LIVE_SESSION with no character online)", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, `/api/bridge/agent-info?agentID=${AGENT_ID}`);
  assert.equal(response.status, 409);
  assert.equal(payload.error, "NO_LIVE_SESSION");
});
