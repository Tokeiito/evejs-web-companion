"use strict";

// Goal R104 (Phase-4 BOUND WRITES): the BFF probe / scan-control write routes —
// WB-SCAN (9 scanMgr writes: SignalTrackerRegister / SetProbeDestination /
// SetProbeRangeStep / ConeScan / RequestScans / ReconnectToLostProbes / DestroyProbe
// / RecoverProbes / SetActivityState). PLUMBING ONLY — no UI.
//
// WB-SCAN rides the scanMgr.GetSystemScanMgr bind (systemScanBindSpec — the SAME
// handle the R72/R79 scan READS use). Unlike a MachoBindObject bind, GetSystemScanMgr
// takes NO caller args — it always binds the SESSION's own current-system scan
// manager, so the bind cannot be pointed at a foreign system. Each write dispatches
// as a BOUND method (boundCall → callBoundMethod), NOT the top-level /call seam. Every
// route is CONFIRM-GATED: without `confirm: true` it answers 400 CONFIRMATION_REQUIRED
// and NOTHING dispatches (no bind, no bound call). This suite proves the gate (all 9
// refuse without confirm), that representative writes forward their args as a bound
// call ONCE confirmed against a FAKE recording gateway, and that no route dispatches
// without a held bridge session. NO write was ever fired against the live world
// (operator owns EveJS; no server restart).

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
const PROBE_ID = 70000001;
const LAUNCHER_ID = 80000001;
const AUTHORITATIVE_SCANNER = {
  inSpace: true,
  solarSystemID: SOLAR_SYSTEM_ID,
  shipID: SHIP_ID,
  maxActiveProbes: 8,
  launcher: {
    moduleID: LAUNCHER_ID,
    typeID: 17938,
    online: true,
    chargeTypeID: 30013,
    loadedCount: 8,
    launchCount: 7,
  },
  probes: [{
    probeID: PROBE_ID,
    typeID: 30013,
    pos: [1, 2, 3],
    destination: [4, 5, 6],
    scanRange: 149597870700,
    rangeStep: 4,
    state: 1,
    expiry: "133999999999999999",
  }],
};

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

// The scan writes never read flight (they bind the session's own current-system scan
// manager server-side and are docked-safe from the BFF's point of view), so no
// inSpace toggle is needed — every bind is scanMgr.GetSystemScanMgr with NO args.
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
    async readScannerState() {
      return { scanner: structuredClone(AUTHORITATIVE_SCANNER), notifications: [] };
    },
    async callMethod(service, method) {
      throw new Error(`R104 scan writes are BOUND — unexpected top-level ${service}.${method}`);
    },
    async bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.bind.push({ service, method, args, kwargs, bridgeSessionID });
      return { boundHandle: `handle:${service}:${method}:${JSON.stringify(args)}`, service, method, notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) {
      calls.boundCall.push({ service, method, args, kwargs, bridgeSessionID, boundHandle });
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

// --- the 9 R104 scan write routes --------------------------------------------

const R104_WRITE_ROUTES = [
  ["/api/bridge/scan/signal-tracker/register", {}],
  ["/api/bridge/scan/probe/set-destination", { probeID: PROBE_ID, destination: [1, 2, 3] }],
  ["/api/bridge/scan/probe/set-range-step", { probeID: PROBE_ID, rangeStep: 3 }],
  ["/api/bridge/scan/cone-scan", { angle: 1.5, range: 1000000, dx: 1, dy: 0, dz: 0 }],
  ["/api/bridge/scan/request-scans", { probeMap: {} }],
  ["/api/bridge/scan/probe/reconnect", {}],
  ["/api/bridge/scan/probe/destroy", { probeID: PROBE_ID }],
  ["/api/bridge/scan/probe/recover", { probeIDs: [PROBE_ID] }],
  ["/api/bridge/scan/probe/set-activity", { probeIDs: [PROBE_ID], active: true }],
];

test("⚠ every R104 scan write REFUSES without confirm — no bind, no dispatch (nothing fired)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  assert.equal(R104_WRITE_ROUTES.length, 9, "all 9 R104 scan write routes are covered");
  for (const [path, body] of R104_WRITE_ROUTES) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 400, `${path} must refuse without confirm`);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", `${path} must answer CONFIRMATION_REQUIRED`);
  }
  assert.equal(gateway.calls.boundCall.length, 0, "a refused write must not dispatch a bound call");
  assert.equal(gateway.calls.bind.length, 0, "a refused write must not even bind the scan manager");
});

// --- WB-SCAN: bound off the session-scoped scanMgr.GetSystemScanMgr bind -------

test("R104 SetProbeDestination binds GetSystemScanMgr (no args) and forwards [probeID, destination] once confirmed", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/scan/probe/set-destination", {
    method: "POST",
    body: { probeID: PROBE_ID, destination: [10, -20, 30], confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, true);
  // Bound, not top-level: the scan manager is bound via GetSystemScanMgr with NO
  // caller args (session's own system) and the call rides callBoundMethod.
  const bind = gateway.calls.bind.find((c) => c.service === "scanMgr");
  assert.ok(bind, "the scan manager is bound");
  assert.equal(bind.method, "GetSystemScanMgr");
  assert.deepEqual(bind.args, [], "the bind takes NO caller args — session's own system");
  const call = gateway.calls.boundCall.find((c) => c.method === "SetProbeDestination");
  assert.ok(call, "SetProbeDestination must reach the gateway as a bound call once confirmed");
  assert.equal(call.service, "scanMgr");
  assert.deepEqual(call.args, [PROBE_ID, [10, -20, 30]]);
});

test("R104 RequestScans forwards [probeMap] as a bound scanMgr call once confirmed", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/scan/request-scans", {
    method: "POST",
    body: { probeMap: { [PROBE_ID]: { rangeStep: 2 } }, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "RequestScans");
  assert.ok(call, "RequestScans must reach the gateway once confirmed");
  assert.equal(call.service, "scanMgr");
  assert.deepEqual(call.args, [{ [PROBE_ID]: { rangeStep: 2 } }]);
});

test("R104 RecoverProbes forwards [[probeIDs]] as a bound scanMgr call once confirmed", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/scan/probe/recover", {
    method: "POST",
    body: { probeIDs: [PROBE_ID, 70000002], confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "RecoverProbes");
  assert.ok(call, "RecoverProbes must reach the gateway once confirmed");
  assert.equal(call.service, "scanMgr");
  assert.deepEqual(call.args, [[PROBE_ID, 70000002]]);
});

test("⚠ R104 DestroyProbe binds the session scan manager and forwards [probeID] once confirmed (DESTRUCTIVE)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/scan/probe/destroy", {
    method: "POST",
    body: { probeID: PROBE_ID, confirm: true },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.applied, true);
  const bind = gateway.calls.bind.find((c) => c.service === "scanMgr");
  assert.ok(bind && bind.method === "GetSystemScanMgr" && bind.args.length === 0, "destroy binds the session's own scan manager, no caller args");
  const call = gateway.calls.boundCall.find((c) => c.method === "DestroyProbe");
  assert.ok(call, "DestroyProbe must reach the gateway once confirmed");
  assert.equal(call.service, "scanMgr");
  assert.deepEqual(call.args, [PROBE_ID]);
});

test("R104 SetActivityState forwards [[probeIDs], active] as a bound scanMgr call once confirmed", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/scan/probe/set-activity", {
    method: "POST",
    body: { probeIDs: [PROBE_ID], active: true, confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "SetActivityState");
  assert.ok(call, "SetActivityState must reach the gateway once confirmed");
  assert.equal(call.service, "scanMgr");
  assert.deepEqual(call.args, [[PROBE_ID], true]);
});

test("R104 SignalTrackerRegister dispatches with no args once confirmed", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/scan/signal-tracker/register", {
    method: "POST",
    body: { confirm: true },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((c) => c.method === "SignalTrackerRegister");
  assert.ok(call, "SignalTrackerRegister must reach the gateway once confirmed");
  assert.equal(call.service, "scanMgr");
  assert.deepEqual(call.args, []);
});

test("R104 scan write routes refuse without a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No selectOnServer — no held session.
  for (const [path, body] of R104_WRITE_ROUTES) {
    const { response } = await apiRequest(baseUrl, path, { method: "POST", body: { ...body, confirm: true } });
    assert.notEqual(response.status, 200, `${path} must refuse without a held session`);
  }
  assert.equal(gateway.calls.boundCall.length, 0, "no dispatch without a held session");
});

// --- Product scanner surface: no browser-supplied authority -----------------

const PRODUCT_SCANNER_WRITES = [
  "/api/bridge/scanner/launch",
  "/api/bridge/scanner/analyze",
  "/api/bridge/scanner/recover",
  "/api/bridge/scanner/reconnect",
];

test("product scanner state exposes EveJS's held-session authority", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/scanner/state");
  assert.equal(response.status, 200);
  assert.deepEqual(payload.scanner, AUTHORITATIVE_SCANNER);
});

test("every product scanner write is confirm-gated", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const path of PRODUCT_SCANNER_WRITES) {
    const { response, payload } = await apiRequest(baseUrl, path, {
      method: "POST",
      body: {},
    });
    assert.equal(response.status, 400, path);
    assert.equal(payload.error, "CONFIRMATION_REQUIRED", path);
  }
  assert.equal(gateway.calls.boundCall.length, 0);
});

test("product launch ignores spoofed module/count and dispatches EveJS authority", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/scanner/launch", {
    method: "POST",
    body: { confirm: true, moduleID: 666, count: 99 },
  });
  assert.equal(response.status, 200);
  const call = gateway.calls.boundCall.find((entry) => entry.method === "LaunchProbes");
  assert.ok(call);
  assert.deepEqual(call.args, [LAUNCHER_ID, 7]);
});

test("product analyze and recover use exact authoritative probe data, never spoofed input", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  await apiRequest(baseUrl, "/api/bridge/scanner/analyze", {
    method: "POST",
    body: { confirm: true, probeMap: { 666: { pos: [99, 99, 99] } } },
  });
  await apiRequest(baseUrl, "/api/bridge/scanner/recover", {
    method: "POST",
    body: { confirm: true, probeIDs: [666] },
  });
  const analyze = gateway.calls.boundCall.find((entry) => entry.method === "RequestScans");
  assert.ok(analyze);
  assert.deepEqual(analyze.args, [{
    [PROBE_ID]: {
      typeID: 30013,
      pos: [1, 2, 3],
      destination: [4, 5, 6],
      scanRange: 149597870700,
      rangeStep: 4,
      state: 1,
      expiry: "133999999999999999",
    },
  }]);
  const recover = gateway.calls.boundCall.find((entry) => entry.method === "RecoverProbes");
  assert.ok(recover);
  assert.deepEqual(recover.args, [[PROBE_ID]]);
});
