"use strict";

// Goal R6a: the Agent Finder lists agents from the static agentAuthority
// reference table so the player can find a courier agent to travel to. Two
// layers are covered here:
//   1. src/staticData.js findAgents — the read/filter/cap/name-resolution
//      against the REAL data file (skipped if the eve.js data isn't present).
//   2. GET /api/agents/find — the BFF route shape, filtering, cap, and auth,
//      against an injected fake staticData (deterministic, no real-data need).
// This is read-only static reference data (like /api/map/graph), NOT a
// gateway/bridge call. Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { once } = require("events");

const { createApp } = require("../src/server");
const staticData = require("../src/staticData");
const config = require("../src/config");

// --- 1. staticData.findAgents against the real agentAuthority table ---------

const AGENT_DATA_FILE = path.join(
  config.eveRoot,
  "_local",
  "gameStore",
  "data",
  "agentAuthority",
  "data.json",
);
const HAS_REAL_DATA = fs.existsSync(AGENT_DATA_FILE);

test("staticData.findAgents defaults to courier, caps, and resolves names", { skip: HAS_REAL_DATA ? false : "agentAuthority data.json not present" }, () => {
  const result = staticData.findAgents({ limit: 50 });
  assert.equal(result.kind, "courier"); // default kind
  assert.ok(result.total > 50, "the real dataset has many couriers");
  assert.equal(result.capped, true);
  assert.equal(result.agents.length, 50); // capped to the requested limit
  for (const agent of result.agents) {
    assert.equal(agent.missionKind, "courier");
    assert.ok(agent.agentID > 0);
    assert.equal(typeof agent.name, "string");
    assert.ok(agent.name.length > 0);
    // Station/system names are resolved server-side (not raw IDs), when present.
    if (agent.stationID) {
      assert.equal(typeof agent.stationName, "string");
    }
    if (agent.solarSystemID) {
      assert.equal(typeof agent.solarSystemName, "string");
    }
  }
});

test("staticData.findAgents filters by level and disables kind with 'all'", { skip: HAS_REAL_DATA ? false : "agentAuthority data.json not present" }, () => {
  const l1 = staticData.findAgents({ kind: "courier", level: 1, limit: 5000 });
  assert.equal(l1.level, 1);
  assert.ok(l1.total > 0);
  assert.equal(l1.capped, false, "the requested limit covers all L1 couriers");
  assert.ok(l1.agents.every((a) => a.level === 1 && a.missionKind === "courier"));

  const all = staticData.findAgents({ kind: "all", limit: 10 });
  assert.equal(all.kind, null, "'all' disables the kind filter");
  const kinds = new Set(all.agents.map((a) => a.missionKind));
  // 'all' spans more than one kind across the dataset (cap is just the sample).
  assert.ok(all.total > l1.total);
  assert.ok(kinds.size >= 1);
});

// --- 2. GET /api/agents/find route (injected fake staticData) ---------------

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

// A deterministic 4-agent fixture: 3 couriers (L1, L1, L2) + 1 encounter.
const FIXTURE_AGENTS = [
  { agentID: 3001, ownerName: "Near One", level: 1, missionKind: "courier", corporationID: 1000001, factionID: 500001, stationID: 60000001, solarSystemID: 30000001 },
  { agentID: 3002, ownerName: "Far Two", level: 1, missionKind: "courier", corporationID: 1000002, factionID: 500002, stationID: 60000002, solarSystemID: 30000002 },
  { agentID: 3003, ownerName: "Deep Three", level: 2, missionKind: "courier", corporationID: 1000003, factionID: 500003, stationID: 60000003, solarSystemID: 30000003 },
  { agentID: 3004, ownerName: "Fighter Four", level: 1, missionKind: "encounter", corporationID: 1000004, factionID: 500004, stationID: 60000004, solarSystemID: 30000004 },
];

function fakeStaticData() {
  // Reuse the real findAgents logic over a fixture by re-implementing the same
  // filter/cap contract the route depends on (small + deterministic).
  return {
    findAgents(filters = {}) {
      const rawKind = filters.kind === undefined || filters.kind === null ? "courier" : String(filters.kind).trim().toLowerCase();
      const kind = rawKind === "all" || rawKind === "any" || rawKind === "" ? null : rawKind;
      const level = Number(filters.level) || null;
      const limit = Number.isFinite(Number(filters.limit)) && Number(filters.limit) > 0
        ? Math.min(Math.floor(Number(filters.limit)), 5000)
        : 500;
      const matches = FIXTURE_AGENTS.filter((a) =>
        (kind === null || a.missionKind === kind) && (level === null || a.level === level));
      matches.sort((a, b) => a.level - b.level || a.agentID - b.agentID);
      const total = matches.length;
      const capped = total > limit;
      const agents = (capped ? matches.slice(0, limit) : matches).map((a) => ({
        agentID: a.agentID,
        name: a.ownerName,
        level: a.level,
        missionKind: a.missionKind,
        missionTypeLabel: `UI/Agents/MissionTypes/${a.missionKind}`,
        corporationID: a.corporationID,
        factionID: a.factionID,
        stationID: a.stationID,
        stationName: `Station ${a.stationID}`,
        solarSystemID: a.solarSystemID,
        solarSystemName: `System ${a.solarSystemID}`,
      }));
      return { agents, total, capped, kind, level, limit };
    },
  };
}

async function startTestServer() {
  const app = createApp({
    eveStore: fakeStore(),
    eveGatewayClient: {},
    webAuth: fakeAuth(),
    marketClient: {},
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

test("GET /api/agents/find defaults to courier and resolves station/system names", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/agents/find");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "static-data");
  assert.equal(payload.kind, "courier");
  assert.equal(payload.total, 3); // 3 couriers in the fixture
  assert.equal(payload.agents.length, 3); // the encounter agent is excluded
  assert.ok(payload.agents.every((a) => a.missionKind === "courier"));
  const near = payload.agents.find((a) => a.agentID === 3001);
  assert.equal(near.name, "Near One");
  assert.equal(near.stationName, "Station 60000001");
  assert.equal(near.solarSystemName, "System 30000001");
});

test("GET /api/agents/find?level=1 filters by level", async () => {
  const { baseUrl } = await startTestServer();
  const { payload } = await apiRequest(baseUrl, "/api/agents/find?kind=courier&level=1");
  assert.equal(payload.level, 1);
  assert.equal(payload.total, 2); // 2 L1 couriers
  assert.ok(payload.agents.every((a) => a.level === 1 && a.missionKind === "courier"));
});

test("GET /api/agents/find caps the result and reports total/capped", async () => {
  const { baseUrl } = await startTestServer();
  const { payload } = await apiRequest(baseUrl, "/api/agents/find?kind=courier&limit=1");
  assert.equal(payload.total, 3); // full match count before the cap
  assert.equal(payload.capped, true);
  assert.equal(payload.agents.length, 1); // capped to 1
  assert.equal(payload.limit, 1);
});

test("GET /api/agents/find?kind=all spans all mission kinds", async () => {
  const { baseUrl } = await startTestServer();
  const { payload } = await apiRequest(baseUrl, "/api/agents/find?kind=all");
  assert.equal(payload.total, 4); // all fixture agents
  const kinds = new Set(payload.agents.map((a) => a.missionKind));
  assert.ok(kinds.has("courier") && kinds.has("encounter"));
});

test("GET /api/agents/find requires the web login session", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/agents/find", { authenticated: false });
  assert.equal(response.status, 401);
  assert.equal(payload.error, "AUTH_REQUIRED");
});
