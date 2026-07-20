"use strict";

// Goal R5b: the BFF serves the system-adjacency graph the browser's client-side
// route solver runs BFS over, plus a static destination resolver (station or
// system -> system). This is read-only static reference data (like station
// identity), NOT a gateway/bridge call and NOT a server-side travel job.
// Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const JITA_STATION = 60003760;
const JITA_SYSTEM = 30000142;
const MAURASI_SYSTEM = 30000140;

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
  };
}

function fakeStaticData() {
  return {
    getSolarSystemGraph() {
      return {
        systems: { [JITA_SYSTEM]: "Jita", [MAURASI_SYSTEM]: "Maurasi" },
        edges: [
          [MAURASI_SYSTEM, JITA_SYSTEM, 50000802, 50001248],
          [JITA_SYSTEM, MAURASI_SYSTEM, 50001248, 50000802],
        ],
      };
    },
    getStation(id) {
      return Number(id) === JITA_STATION
        ? { stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant", solarSystemID: JITA_SYSTEM }
        : null;
    },
    getSolarSystem(id) {
      return Number(id) === MAURASI_SYSTEM ? { solarSystemID: MAURASI_SYSTEM } : null;
    },
    getSolarSystemName(id) {
      if (Number(id) === JITA_SYSTEM) return "Jita";
      if (Number(id) === MAURASI_SYSTEM) return "Maurasi";
      return `System ${id}`;
    },
    getTypeName(id) {
      return `Type ${id}`;
    },
  };
}

async function startTestServer() {
  const app = createApp({
    eveStore: fakeStore(),
    eveGatewayClient: {},
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
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, { method: options.method || "GET", headers });
  return { response, payload: await response.json() };
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

test("GET /api/map/graph returns the system-adjacency graph", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/map/graph");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "static-data");
  assert.equal(payload.systemCount, 2);
  assert.equal(payload.edgeCount, 2);
  assert.equal(payload.systems[String(JITA_SYSTEM)], "Jita");
  // The Maurasi -> Jita edge carries [fromSystem, toSystem, fromGate, toGate].
  const edge = payload.edges.find((e) => e[0] === MAURASI_SYSTEM && e[1] === JITA_SYSTEM);
  assert.deepEqual(edge, [MAURASI_SYSTEM, JITA_SYSTEM, 50000802, 50001248]);
});

test("GET /api/map/graph requires the web login session", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/map/graph", { authenticated: false });
  assert.equal(response.status, 401);
  assert.equal(payload.error, "AUTH_REQUIRED");
});

test("GET /api/map/resolve/:id resolves a station to its solar system", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, `/api/map/resolve/${JITA_STATION}`);
  assert.equal(response.status, 200);
  assert.equal(payload.kind, "station");
  assert.equal(payload.stationID, JITA_STATION);
  assert.equal(payload.solarSystemID, JITA_SYSTEM);
  assert.equal(payload.systemName, "Jita");
});

test("GET /api/map/resolve/:id resolves a solar system directly", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, `/api/map/resolve/${MAURASI_SYSTEM}`);
  assert.equal(response.status, 200);
  assert.equal(payload.kind, "system");
  assert.equal(payload.solarSystemID, MAURASI_SYSTEM);
  assert.equal(payload.systemName, "Maurasi");
});

test("GET /api/map/resolve/:id reports an unknown ID as kind:unknown", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/map/resolve/999999");
  assert.equal(response.status, 200);
  assert.equal(payload.kind, "unknown");
  assert.equal(payload.solarSystemID, null);
});

// R6b: the read-only static station-identity route the docked-station-change
// refresh uses to re-point the Station panel after the character docks somewhere
// new (autopilot arrival / manual dock) — same client-local resolution the
// select route returns, keyed by station ID.
test("GET /api/map/station/:id returns the static station identity", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, `/api/map/station/${JITA_STATION}`);
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "static-data");
  assert.equal(payload.station.stationID, JITA_STATION);
  assert.equal(payload.station.stationName, "Jita IV - Moon 4 - Caldari Navy Assembly Plant");
});

test("GET /api/map/station/:id 404s an unknown station", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/map/station/999999");
  assert.equal(response.status, 404);
  assert.equal(payload.error, "STATION_NOT_FOUND");
});

test("GET /api/map/station/:id requires the web login session", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, `/api/map/station/${JITA_STATION}`, { authenticated: false });
  assert.equal(response.status, 401);
  assert.equal(payload.error, "AUTH_REQUIRED");
});
