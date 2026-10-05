"use strict";

// GET /api/pi/planet-richness: each planet's GetPlanetResourceInfo on the tab's
// HELD session, and nothing else -- never the other six /bound-planet reads.
// Pins: a tab with no pilot is refused before any bind; each planet binds its
// own planetMgr and answers for itself, a failed one beside good ones; ids are
// cleaned and capped.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const CHARACTER_ID = 90000001;
const PLANET_A = 40000002;
const PLANET_B = 40000004;
const PLANET_BROKEN = 40000006;

const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();

function fakeAuth() {
  return {
    createSessionToken: () => COOKIE_TOKEN,
    verifySessionToken: (token) =>
      token === COOKIE_TOKEN ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: SESSION_ID } : null,
    countConfiguredUsers: () => 1,
  };
}

function fakeStore() {
  return {
    async getAccount(username) {
      return username === ACCOUNT.username ? { ...ACCOUNT } : null;
    },
    async getCharacterForAccount(accountID, characterID) {
      return Number(accountID) === ACCOUNT.accountID && Number(characterID) === CHARACTER_ID
        ? { characterID: CHARACTER_ID, accountID: ACCOUNT.accountID, characterName: "Pilot One" }
        : null;
    },
    async releaseCharacterControl() {
      return { controlState: "offline" };
    },
  };
}

function fakeGateway() {
  const binds = [];
  const calls = [];
  return {
    binds,
    calls,
    async selectCharacter() {
      return {
        bridgeSessionID: BRIDGE_SESSION_ID,
        service: "charUnboundMgr",
        method: "SelectCharacterID",
        result: null,
        notifications: [],
        session: {
          userid: ACCOUNT.accountID,
          characterID: CHARACTER_ID,
          characterName: "Pilot One",
          stationID: 60000004,
          structureID: null,
          solarSystemID: 30000001,
          corporationID: 98000000,
          shipID: 9001,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: CHARACTER_ID };
    },
    async readFlightStatus() {
      return { flight: { docked: true, inSpace: false, stationID: 60000004, solarSystemID: 30000001, shipID: 9001 }, notifications: [] };
    },
    async callMethod(service, method) {
      return { service, method, result: null, notifications: [] };
    },
    async bindObject(service, method, args) {
      binds.push({ service, method, args });
      return { boundHandle: `handle-${args[0]}`, notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, handle) {
      calls.push({ service, method, args, handle });
      if (args[0] === PLANET_BROKEN) {
        throw Object.assign(new Error("bound read failed"), { code: "CALL_FAILED" });
      }
      return { result: { type: "dict", entries: [[2268, args[0] === PLANET_A ? 140 : 96]] }, notifications: [] };
    },
  };
}

async function startTestServer(gateway) {
  const app = createApp({
    eveStore: fakeStore(),
    eveGatewayClient: gateway,
    webAuth: fakeAuth(),
    staticData: {
      getStation: () => null,
      getTypeName: (id) => `Type ${id}`,
      resolveNames: () => ({ names: {}, capped: false, limit: 500 }),
    },
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function apiRequest(baseUrl, path, options = {}) {
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", cookie: `evejs_web_poc=${COOKIE_TOKEN}` },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, payload: await response.json() };
}

test.afterEach(async () => {
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  }
  await Promise.all(closing);
});

test("with no pilot held in the tab, the read is refused before any bind", async () => {
  const gateway = fakeGateway();
  const baseUrl = await startTestServer(gateway);
  const { response } = await apiRequest(baseUrl, `/api/pi/planet-richness?planetIDs=${PLANET_A}`);
  assert.equal(response.status, 409);
  assert.equal(gateway.binds.length, 0);
});

test("each planet binds its own planetMgr and asks only GetPlanetResourceInfo, a failure beside good answers", async () => {
  const gateway = fakeGateway();
  const baseUrl = await startTestServer(gateway);
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: CHARACTER_ID } });
  const { response, payload } = await apiRequest(
    baseUrl,
    `/api/pi/planet-richness?planetIDs=${PLANET_A},${PLANET_B},junk,${PLANET_A},${PLANET_BROKEN}`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(payload.planets.map((planet) => planet.planetID), [PLANET_A, PLANET_B, PLANET_BROKEN]);
  assert.deepEqual(payload.planets[0].result, { type: "dict", entries: [[2268, 140]] });
  assert.equal(payload.planets[2].error, "CALL_FAILED");
  assert.ok(gateway.calls.every((call) => call.service === "planetMgr" && call.method === "GetPlanetResourceInfo"));
  assert.deepEqual(gateway.binds.map((bind) => bind.args[0]).sort(), [PLANET_A, PLANET_B, PLANET_BROKEN].sort());
});

test("more planets than one ask may carry is refused, and binds nothing", async () => {
  const gateway = fakeGateway();
  const baseUrl = await startTestServer(gateway);
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: CHARACTER_ID } });
  const ids = Array.from({ length: 61 }, (_, index) => 40000000 + index * 2 + 2).join(",");
  const { response, payload } = await apiRequest(baseUrl, `/api/pi/planet-richness?planetIDs=${ids}`);
  assert.equal(response.status, 400);
  assert.equal(payload.error, "TOO_MANY_PLANETS");
  assert.equal(gateway.binds.length, 0);
});
