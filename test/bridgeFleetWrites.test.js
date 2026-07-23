"use strict";

// Goal R105 (Phase-4 BOUND WRITES): the BFF fleet composition / membership / broadcast
// write routes — WB-FLEET (16 fleetObjectHandler writes: CreateWing / CreateSquad /
// MoveMember / KickMember / MakeLeader / LeaveFleet / DisbandFleet / SetOptions /
// SetMotdEx / UpdateMemberInfo / SendBroadcast / Invite / MassInvite / AcceptInvite /
// RejectInvite / Reconnect). CLOSES WB-FLEET. PLUMBING ONLY — no UI.
//
// WB-FLEET rides the fleetObjectHandler.MachoBindObject bind (fleetBindSpec — the SAME
// handle the R85 bound fleet READS use). ⚠ UNLIKE the scanMgr bind, MachoBindObject
// ACCEPTS a caller fleetID — but fleetBindSpec() passes args:[], so the server binds the
// SESSION's OWN fleet, and these dedicated routes NEVER pass a caller fleetID. Each write
// dispatches as a BOUND method (boundCall → callBoundMethod), NOT the top-level /call
// seam. Every route is CONFIRM-GATED: without `confirm: true` it answers 400
// CONFIRMATION_REQUIRED and NOTHING dispatches (no bind, no bound call). This suite proves
// the gate (all 16 refuse without confirm), that each write forwards its args as a bound
// call ONCE confirmed against a FAKE recording gateway with the bind carrying NO caller
// fleetID, and that no route dispatches without a held bridge session. NO write was ever
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

// The fleet writes bind the session's OWN fleet server-side (fleetBindSpec passes NO
// fleetID), so no inSpace toggle is needed — every bind is
// fleetObjectHandler.MachoBindObject with NO args.
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

const R105_WRITE_ROUTES = [
  ["/api/bridge/fleet/wing/create", {}, "CreateWing", []],
  ["/api/bridge/fleet/squad/create", { wingID: 100 }, "CreateSquad", [100]],
  [
    "/api/bridge/fleet/member/move",
    { characterID: MEMBER_ID, wingID: 100, squadID: 200, role: 3 },
    "MoveMember",
    [MEMBER_ID, 100, 200, 3],
  ],
  ["/api/bridge/fleet/member/kick", { characterID: MEMBER_ID }, "KickMember", [MEMBER_ID]],
  ["/api/bridge/fleet/member/make-leader", { characterID: MEMBER_ID }, "MakeLeader", [MEMBER_ID]],
  ["/api/bridge/fleet/member/leave", {}, "LeaveFleet", []],
  ["/api/bridge/fleet/disband", {}, "DisbandFleet", []],
  ["/api/bridge/fleet/options", { options: { isFreeMove: true } }, "SetOptions", [{ isFreeMove: true }]],
  ["/api/bridge/fleet/motd", { motd: "Form up on the FC." }, "SetMotdEx", ["Form up on the FC."]],
  ["/api/bridge/fleet/member/update-info", { shipTypeID: 587 }, "UpdateMemberInfo", [587]],
  [
    "/api/bridge/fleet/broadcast",
    { name: "Target", scope: 1, itemID: 1000000, typeID: 587 },
    "SendBroadcast",
    ["Target", 1, 1000000, 587],
  ],
  [
    "/api/bridge/fleet/invite",
    { inviteeCharID: MEMBER_ID, wingID: 100, squadID: 200, role: 0 },
    "Invite",
    [MEMBER_ID, 100, 200, 0],
  ],
  [
    "/api/bridge/fleet/mass-invite",
    { characterIDs: [MEMBER_ID, 140000010], wingID: 100, squadID: 200, role: 0 },
    "MassInvite",
    [[MEMBER_ID, 140000010], 100, 200, 0],
  ],
  ["/api/bridge/fleet/invite/accept", { shipTypeID: 587 }, "AcceptInvite", [587]],
  ["/api/bridge/fleet/invite/reject", { alreadyInFleet: false }, "RejectInvite", [false]],
  ["/api/bridge/fleet/reconnect", {}, "Reconnect", []],
];

test("⚠ every R105 fleet write REFUSES without confirm — no bind, no dispatch (nothing fired)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  assert.equal(R105_WRITE_ROUTES.length, 16, "all 16 R105 fleet write routes are covered");
  for (const [path, body] of R105_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  assert.equal(gateway.calls.boundCall.length, 0, "a refused write must not dispatch a bound call");
  assert.equal(gateway.calls.bind.length, 0, "a refused write must not even bind the fleet object");
});

test("R105 every fleet write binds MachoBindObject (NO caller fleetID) and forwards its args once confirmed", async () => {
  for (const [path, body, method, expectedArgs] of R105_WRITE_ROUTES) {
    const gateway = fakeGateway();
    const { baseUrl } = await startTestServer({ gateway });
    await selectOnServer(baseUrl);
    const { response, payload } = await apiRequest(baseUrl, path, {
      method: "POST",
      body: { ...body, confirm: true },
    });
    assert.equal(response.status, 200, `${path} must succeed once confirmed`);
    assert.equal(payload.ok, true, `${path} ok`);
    assert.equal(payload.applied, true, `${path} applied`);
    // Bound, not top-level: the fleet object is bound via MachoBindObject with NO caller
    // fleetID (session's OWN fleet) and the call rides callBoundMethod.
    const bind = gateway.calls.bind.find((c) => c.service === "fleetObjectHandler");
    assert.ok(bind, `${path} binds the fleet object`);
    assert.equal(bind.method, "MachoBindObject", `${path} bind method`);
    assert.deepEqual(bind.args, [], `${path} bind takes NO caller fleetID — session's own fleet`);
    const call = gateway.calls.boundCall.find((c) => c.method === method);
    assert.ok(call, `${method} must reach the gateway as a bound call once confirmed`);
    assert.equal(call.service, "fleetObjectHandler", `${method} service`);
    assert.deepEqual(call.args, expectedArgs, `${method} forwards its educated-guess args`);
  }
});

test("⚠ R105 DisbandFleet (DESTRUCTIVE) binds the session's own fleet, no caller fleetID, once confirmed", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/fleet/disband", {
    method: "POST",
    body: { confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.applied, true);
  const bind = gateway.calls.bind.find((c) => c.service === "fleetObjectHandler");
  assert.ok(bind && bind.method === "MachoBindObject" && bind.args.length === 0, "disband binds the session's own fleet, no caller fleetID");
  const call = gateway.calls.boundCall.find((c) => c.method === "DisbandFleet");
  assert.ok(call, "DisbandFleet must reach the gateway once confirmed");
  assert.deepEqual(call.args, []);
});

test("⚠ R105 KickMember (removes another char) forwards [characterID] once confirmed", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/fleet/member/kick", {
    method: "POST",
    body: { characterID: MEMBER_ID, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "KickMember");
  assert.ok(call, "KickMember must reach the gateway once confirmed");
  assert.equal(call.service, "fleetObjectHandler");
  assert.deepEqual(call.args, [MEMBER_ID]);
});

test("R105 fleet write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R105_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.boundCall.length, 0, "no dispatch without a held session");
});
