"use strict";

// (The R104 scan write routes went on 2026-10-14 with the plumbing's other unasked writes (the loop's item 62); their tests here with them. The scanner state's test is what is
// left.)

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

// --- WB-SCAN: bound off the session-scoped scanMgr.GetSystemScanMgr bind -------

// --- Product scanner state --------------------------------------------------
//
// The four writes that stood beside this read (POST /api/bridge/scanner/launch, analyze, recover and reconnect)
// went on 2026-10-13, and the tests of them with them: the page makes the client's own calls
// (web/src/bridge/scannerWrites.ts) through the generic call, which the policy's tests have
// (test/bridgeCallPolicy.test.js).

test("product scanner state exposes EveJS's held-session authority", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/scanner/state");
  assert.equal(response.status, 200);
  assert.deepEqual(payload.scanner, AUTHORITATIVE_SCANNER);
});

