"use strict";

// Goal R7a: the Travel tab lets a player set a destination by NAME. The BFF
// route GET /api/map/find searches the static solar-system + station tables by
// name and returns capped matches the client hands to startRoute (the R5b route
// solver + autopilot). Two layers are covered here:
//   1. src/staticData.js findMapLocations — the search/rank/cap against the REAL
//      gameStore tables (skipped if the eve.js data isn't present).
//   2. GET /api/map/find — the BFF route shape, filtering, cap, and auth,
//      against an injected fake staticData (deterministic, no real-data need).
// This is read-only static reference data (like /api/map/graph and
// /api/agents/find), NOT a gateway/bridge call. Wire contract:
// docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { once } = require("events");

const { createApp } = require("../src/server");
const staticData = require("../src/staticData");
const config = require("../src/config");

// --- 1. staticData.findMapLocations against the real static tables ----------

const SYSTEMS_DATA_FILE = path.join(
  config.eveRoot,
  "_local",
  "gameStore",
  "data",
  "solarSystems",
  "data.json",
);
const HAS_REAL_DATA = fs.existsSync(SYSTEMS_DATA_FILE);

test("staticData.findMapLocations finds the Jita system first, ranked by name match", { skip: HAS_REAL_DATA ? false : "solarSystems data.json not present" }, () => {
  const result = staticData.findMapLocations({ q: "Jita" });
  assert.ok(result.total > 0);
  // The exact-name system match ranks ahead of "Jita IV - ..." stations.
  const first = result.matches[0];
  assert.equal(first.kind, "system");
  assert.equal(first.name, "Jita");
  assert.equal(first.id, 30000142);
  assert.equal(first.solarSystemID, 30000142);
  assert.equal(first.solarSystemName, "Jita");
  // Stations in Jita are present (searched too), with their system resolved.
  const station = result.matches.find((m) => m.kind === "station");
  assert.ok(station, "Jita station matches are included");
  assert.equal(typeof station.solarSystemName, "string");
  assert.ok(station.solarSystemName.length > 0);
});

test("staticData.findMapLocations narrows by kind and caps the result", { skip: HAS_REAL_DATA ? false : "solarSystems data.json not present" }, () => {
  const systemsOnly = staticData.findMapLocations({ q: "Jita", kind: "system" });
  assert.equal(systemsOnly.kind, "system");
  assert.ok(systemsOnly.matches.every((m) => m.kind === "system"));

  const stationsOnly = staticData.findMapLocations({ q: "Jita", kind: "station" });
  assert.equal(stationsOnly.kind, "station");
  assert.ok(stationsOnly.matches.every((m) => m.kind === "station"));
  assert.ok(stationsOnly.total > 0);

  const capped = staticData.findMapLocations({ q: "en", kind: "system", limit: 5 });
  // "en" is a broad substring across many systems, so the cap engages.
  assert.equal(capped.matches.length, 5);
  assert.equal(capped.capped, true);
  assert.ok(capped.total > 5);
});

test("staticData.findMapLocations ignores a too-short query", { skip: HAS_REAL_DATA ? false : "solarSystems data.json not present" }, () => {
  const result = staticData.findMapLocations({ q: "J" });
  assert.equal(result.total, 0);
  assert.equal(result.matches.length, 0);
  assert.equal(result.capped, false);
});

// --- 2. GET /api/map/find route (injected fake staticData) ------------------

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
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

// A deterministic fixture: the Jita system + two Jita stations + one unrelated
// system. Re-implements the real findMapLocations contract (rank + cap) so the
// route test is independent of the real data file.
const FIXTURE_SYSTEMS = [
  { solarSystemID: 30000142, solarSystemName: "Jita" },
  { solarSystemID: 30000144, solarSystemName: "Perimeter" },
];
const FIXTURE_STATIONS = [
  { stationID: 60003760, stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant", solarSystemID: 30000142, solarSystemName: "Jita" },
  { stationID: 60003761, stationName: "Jita IV - Moon 6 - Ytiri Storage", solarSystemID: 30000142, solarSystemName: "Jita" },
];

function fakeStaticData() {
  return {
    findMapLocations(filters = {}) {
      const q = filters.q === undefined || filters.q === null ? "" : String(filters.q).trim();
      const rawKind = filters.kind === undefined || filters.kind === null ? "" : String(filters.kind).trim().toLowerCase();
      const kind = rawKind === "system" || rawKind === "station" ? rawKind : null;
      const limit = Number.isFinite(Number(filters.limit)) && Number(filters.limit) > 0
        ? Math.min(Math.floor(Number(filters.limit)), 200)
        : 50;
      if (q.length < 2) {
        return { matches: [], total: 0, capped: false, q, kind, limit };
      }
      const needle = q.toLowerCase();
      const score = (name) => {
        const l = name.toLowerCase();
        if (l === needle) return 0;
        if (l.startsWith(needle)) return 1;
        return l.includes(needle) ? 2 : -1;
      };
      const scored = [];
      if (kind === null || kind === "system") {
        for (const s of FIXTURE_SYSTEMS) {
          const sc = score(s.solarSystemName);
          if (sc < 0) continue;
          scored.push({ sc, name: s.solarSystemName, entry: { id: s.solarSystemID, name: s.solarSystemName, kind: "system", solarSystemID: s.solarSystemID, solarSystemName: s.solarSystemName } });
        }
      }
      if (kind === null || kind === "station") {
        for (const s of FIXTURE_STATIONS) {
          const sc = score(s.stationName);
          if (sc < 0) continue;
          scored.push({ sc, name: s.stationName, entry: { id: s.stationID, name: s.stationName, kind: "station", solarSystemID: s.solarSystemID, solarSystemName: s.solarSystemName } });
        }
      }
      scored.sort((a, b) => a.sc - b.sc || a.name.length - b.name.length || a.name.localeCompare(b.name));
      const total = scored.length;
      const capped = total > limit;
      const matches = (capped ? scored.slice(0, limit) : scored).map((s) => s.entry);
      return { matches, total, capped, q, kind, limit };
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

test("GET /api/map/find searches systems + stations and ranks the exact system first", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/map/find?q=Jita");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "static-data");
  assert.equal(payload.q, "Jita");
  assert.equal(payload.total, 3); // Jita system + 2 Jita stations
  assert.equal(payload.matches[0].kind, "system");
  assert.equal(payload.matches[0].id, 30000142);
  assert.equal(payload.matches[0].name, "Jita");
  assert.ok(payload.matches.some((m) => m.kind === "station" && m.solarSystemName === "Jita"));
});

test("GET /api/map/find?kind=station narrows to stations", async () => {
  const { baseUrl } = await startTestServer();
  const { payload } = await apiRequest(baseUrl, "/api/map/find?q=Jita&kind=station");
  assert.equal(payload.kind, "station");
  assert.equal(payload.total, 2);
  assert.ok(payload.matches.every((m) => m.kind === "station"));
});

test("GET /api/map/find caps the result and reports total/capped", async () => {
  const { baseUrl } = await startTestServer();
  const { payload } = await apiRequest(baseUrl, "/api/map/find?q=Jita&limit=1");
  assert.equal(payload.total, 3);
  assert.equal(payload.capped, true);
  assert.equal(payload.matches.length, 1);
  assert.equal(payload.limit, 1);
});

test("GET /api/map/find ignores a too-short query", async () => {
  const { baseUrl } = await startTestServer();
  const { payload } = await apiRequest(baseUrl, "/api/map/find?q=J");
  assert.equal(payload.total, 0);
  assert.equal(payload.matches.length, 0);
});

test("GET /api/map/find requires the web login session", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/map/find?q=Jita", { authenticated: false });
  assert.equal(response.status, 401);
  assert.equal(payload.error, "AUTH_REQUIRED");
});
