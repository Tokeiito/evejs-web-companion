"use strict";

// (The R105 fleet write routes, and R94's top-level ones, went on 2026-10-14 with the plumbing's other unasked writes (the loop's item 62); their tests here with them. The
// own-fleet reads' two tests are what is left. The page's own fleet calls are tested in test/bridgeSession.test.js.)

// Goal R105 (Phase-4 BOUND WRITES): the BFF fleet composition / membership / broadcast
// write routes — WB-FLEET (16 fleetObjectHandler writes: CreateWing / CreateSquad /
// MoveMember / KickMember / MakeLeader / LeaveFleet / DisbandFleet / SetOptions /
// SetMotdEx / UpdateMemberInfo / SendBroadcast / Invite / MassInvite / AcceptInvite /
// RejectInvite / Reconnect). These routes now back Fleet Center and bot actions.
//
// WB-FLEET rides the fleetObjectHandler.MachoBindObject bind (fleetBindSpec — the SAME
// handle the R85 bound fleet READS use). ⚠ UNLIKE the scanMgr bind, MachoBindObject
// ACCEPTS a caller fleetID. Most routes pass args:[] and bind the SESSION's OWN fleet;
// invite accept/reject + reconnect bind the invite/saved fleetID because the current
// session has none yet, and the runtime verifies the pending invite/member row. Each write dispatches
// as a BOUND method (boundCall → callBoundMethod), NOT the top-level /call
// seam. Every route is CONFIRM-GATED: without `confirm: true` it answers 400
// CONFIRMATION_REQUIRED and NOTHING dispatches (no bind, no bound call). This suite proves
// the gate (all 16 refuse without confirm), that each write forwards its args as a bound
// call ONCE confirmed against a FAKE recording gateway with either the session-owned bind
// or the explicit invite/saved fleetID, and that no route dispatches without a held bridge
// session. NO write was ever
// fired against the live world (operator owns EveJS; no server restart).

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
const MEMBER_ID = 140000009;
const TARGET_FLEET_ID = 123456;

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

// Most fleet writes bind the session's own fleet server-side. AcceptInvite, RejectInvite,
// and Reconnect explicitly bind their invite/saved fleetID; no inSpace toggle is needed.
function fakeGateway() {
  const calls = { call: [], bind: [], boundCall: [] };
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
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.call.push({ service, method, args, kwargs, sessionFields, bridgeSessionID });
      if (service === "fleetMgr" && method === "ForceLeaveFleet") {
        return { service, method, result: true, notifications: [] };
      }
      throw new Error(`R105 fleet writes are BOUND — unexpected top-level ${service}.${method}`);
    },
    async bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.bind.push({ service, method, args, kwargs, bridgeSessionID });
      return { boundHandle: `handle:${service}:${method}:${JSON.stringify(args)}`, service, method, notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) {
      calls.boundCall.push({ service, method, args, kwargs, bridgeSessionID, boundHandle });
      return { service, method, result: true, notifications: [] };
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

// --- the 16 R105 fleet write routes (path, body, method, expected bound args) ------

test("own-fleet reads rebind current membership on every refresh while sharing one handle within a batch", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  for (let index = 0; index < 2; index += 1) {
    const { response, payload } = await apiRequest(baseUrl, "/api/bridge/bound-fleet");
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
  }

  const ownFleetBinds = gateway.calls.bind.filter(
    (call) => call.service === "fleetObjectHandler" && call.method === "MachoBindObject",
  );
  assert.equal(ownFleetBinds.length, 2, "each refresh resolves membership again");
  assert.deepEqual(ownFleetBinds.map((call) => call.args), [[], []]);
  assert.equal(
    gateway.calls.boundCall.filter((call) => [
      "GetInitState",
      "GetWings",
      "GetMotd",
      "GetJoinRequests",
      "GetFleetComposition",
    ].includes(call.method)).length,
    10,
    "the five reads still share one bind per refresh",
  );
});

test("own-fleet envelopes retain a bind invitation and successful read drains even when another read is refused", async () => {
  const invite = { method: "OnFleetInvite", args: [700, MEMBER_ID, "AskJoinFleet", {}] };
  const joined = { method: "OnFleetJoin", args: [MEMBER_ID] };
  const gateway = { ...fakeGateway(),
    async bindObject(service, method) { return { boundHandle: "fleet-handle", service, method, notifications: [invite] }; },
    async callBoundMethod(service, method) {
      if (method === "GetWings") throw Object.assign(new Error("Refused"), { code: "CALL_REFUSED" });
      return { service, method, result: true, notifications: method === "GetInitState" ? [joined] : [] };
    },
  };
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/bound-fleet");
  assert.equal(response.status, 200);
  assert.equal(payload.reads.GetWings.error, "CALL_REFUSED");
  assert.deepEqual(payload.notifications, [invite, joined]);
});

