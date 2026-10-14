"use strict";

// (The R103 planet and beyonce write routes but the jump through a fleet member went on 2026-10-14 with the plumbing's other unasked writes (the loop's item 62); their tests here
// with them. The fleet-bridge jump's test is what is left.)

// Goal R103 (Phase-4 BOUND WRITES): the BFF planet colony-op + beyonce nav/bookmark
// write routes — WB-PI (4 planetMgr writes: UserUpdateNetwork / UserLaunchCommodities
// / UserTransferCommodities / UserAbandonPlanet) and WB-BEYONCE (7 beyonce nav/bookmark
// writes: CmdGotoPoint / CmdGotoBookmark / CmdAbandonLoot / CmdFleetTagTarget /
// CmdJumpThroughFleet / BookmarkLocation / BookmarkScanResult). PLUMBING ONLY — no UI.
//
// WB-PI rides the planetMgr.MachoBindObject(planetID) bind (planetBindSpec — the SAME
// handle the R77 colony READS use); WB-BEYONCE rides the beyonce remote-park bind
// (parkBindSpec(solarSystemID) — the SAME handle the R5a/R13 movement verbs use). Each
// dispatches as a BOUND method (boundCall → callBoundMethod), NOT the top-level /call
// seam. Every route is CONFIRM-GATED: without `confirm: true` it answers 400
// CONFIRMATION_REQUIRED and NOTHING dispatches (no bind, no bound call). This suite
// proves the gate (all 11 refuse without confirm), that representative writes forward
// their args as a bound call ONCE confirmed against a FAKE recording gateway, and that
// no route dispatches without a held bridge session. NO write was ever fired against
// the live world (operator owns EveJS; no server restart).

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
const PLANET_ID = 40009077;

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

// `inSpace` toggles the flight snapshot: the beyonce nav/bookmark writes require the
// ship in space (dispatchBoundBeyonceWrite calls requireInSpace); the planet writes
// never read flight (colony ops are docked-safe).
function fakeGateway(options = {}) {
  const state = { inSpace: options.inSpace === true, solarSystemID: SOLAR_SYSTEM_ID };
  const calls = { bind: [], boundCall: [] };
  return {
    calls,
    state,
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
        flight: {
          docked: !state.inSpace,
          inSpace: state.inSpace,
          stationID: state.inSpace ? 0 : STATION_ID,
          solarSystemID: state.solarSystemID,
          shipID: SHIP_ID,
        },
        notifications: [],
      };
    },
    async readSpaceSnapshot() {
      return { space: { inSpace: state.inSpace, shipID: SHIP_ID, solarSystemID: state.solarSystemID,
        ship: { itemID: SHIP_ID, characterID: CHARACTER_ID }, entities: [] }, notifications: [] };
    },
    async callMethod(service, method) {
      throw new Error(`R103 planet/beyonce writes are BOUND — unexpected top-level ${service}.${method}`);
    },
    async bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.bind.push({ service, method, args, kwargs, bridgeSessionID });
      return { boundHandle: `handle:${service}:${method}:${JSON.stringify(args)}`, service, method, notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) {
      calls.boundCall.push({ service, method, args, kwargs, bridgeSessionID, boundHandle });
      if (method === "CmdJumpThroughFleet") {
        state.solarSystemID = Number(args[3]) || state.solarSystemID;
      }
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
  const { payload } = await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: CHARACTER_ID } });
  const ready = await apiRequest(baseUrl, "/api/bridge/drone-recovery/ready", {
    method: "POST", body: { checkID: payload.droneRecoveryCheckID } });
  assert.equal(ready.response.status, 200, JSON.stringify(ready.payload));
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

// --- the 11 R103 planet + beyonce write routes -------------------------------

// --- WB-PI: bound off the planetMgr planetID bind ----------------------------

// --- WB-BEYONCE: bound off the beyonce solar-system park bind -----------------

test("R103 fleet-bridge jump waits for the destination scene and dispatches once", async () => {
  const gateway = fakeGateway({ inSpace: true });
  const destinationSystemID = 30000144;
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/flight/jump-through-fleet", {
    method: "POST",
    body: {
      otherCharID: 140000002,
      otherShipID: 9002,
      beaconID: 6001,
      solarSystemID: destinationSystemID,
      confirm: true,
    },
  });
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.flight.solarSystemID, destinationSystemID);
  assert.equal(payload.transition.phase, "ready");
  assert.equal(payload.transition.sceneReady, true);
  assert.equal(
    gateway.calls.boundCall.filter((call) => call.method === "CmdJumpThroughFleet").length,
    1,
    "the bridge jump must never be replayed while the session handoff settles",
  );
});

// --- the customs office's transfer --------------------------------------------
//
// A launchpad's goods are sent up into its planet's customs office by the page's own two calls since 2026-10-13,
// as the client's customs window makes them (web/src/bridge/customsWrites.ts): the office's tax rate asked of the
// system's orbital registry (importExportUI.py 382 to 385), and ImportExportWithPlanet on the office's own
// inventory naming it (549). The route (POST /api/bridge/planet/customs/export) is gone, and its four tests with
// it: the two calls in their order, a rate answered as a number or of nought, the refusals before anything is
// asked (no confirmation, no office, pin or goods, docked), and an office that names no rate.
