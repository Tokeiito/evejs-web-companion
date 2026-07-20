"use strict";

// Goal R7c: names everywhere. The BFF route POST /api/names batch-resolves a set
// of { kind, id } refs to display names over the static reference getters, so a
// list of many IDs (an inventory of typeIDs, a guest list of corp IDs, ...)
// resolves in ONE round-trip. Two layers are covered here:
//   1. src/staticData.js resolveNames — the batch resolve/dedup/cap against the
//      REAL gameStore tables (skipped if the eve.js data isn't present).
//   2. POST /api/names — the BFF route shape, batch echo, unknown handling, cap,
//      and auth, against an injected fake staticData (deterministic, no real data).
// This is read-only static reference data (like /api/map/find and
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

// --- 1. staticData.resolveNames against the real static tables --------------

const ITEMTYPES_DATA_FILE = path.join(
  config.eveRoot,
  "_local",
  "gameStore",
  "data",
  "itemTypes",
  "data.json",
);
const HAS_REAL_DATA = fs.existsSync(ITEMTYPES_DATA_FILE);

test("staticData.resolveNames batch-resolves across kinds and dedupes", { skip: HAS_REAL_DATA ? false : "itemTypes data.json not present" }, () => {
  const result = staticData.resolveNames({
    items: [
      { kind: "type", id: 34 },
      { kind: "type", id: 34 }, // duplicate → resolved once
      { kind: "station", id: 60003760 },
      { kind: "system", id: 30000142 },
      { kind: "corporation", id: 1000044 },
      { kind: "faction", id: 500001 },
      { kind: "character", id: 140000001 },
      { kind: "category", id: 6 },
      { kind: "owner", id: 1000044 },
    ],
  });
  assert.equal(result.names["type:34"], "Tritanium");
  assert.equal(result.names["station:60003760"], "Jita IV - Moon 4 - Caldari Navy Assembly Plant");
  assert.equal(result.names["system:30000142"], "Jita");
  assert.equal(result.names["corporation:1000044"], "School of Applied Knowledge");
  assert.equal(result.names["faction:500001"], "Caldari State");
  assert.equal(result.names["character:140000001"], "Test Pilot");
  assert.equal(result.names["category:6"], "Ship");
  // The `owner` kind resolves an unknown-entity-type id (corp here) by trying
  // corp/faction/character/alliance in turn.
  assert.equal(result.names["owner:1000044"], "School of Applied Knowledge");
});

test("staticData.resolveNames resolves an agent's name from its ownerName", { skip: HAS_REAL_DATA ? false : "itemTypes data.json not present" }, () => {
  const agents = staticData.getAgentsByID();
  const [agentID, agent] = agents.entries().next().value;
  const result = staticData.resolveNames({ items: [{ kind: "agent", id: agentID }] });
  assert.equal(result.names[`agent:${agentID}`], String(agent.ownerName));
});

test("staticData.resolveNames reports a definitive null for an unknown id", { skip: HAS_REAL_DATA ? false : "itemTypes data.json not present" }, () => {
  const result = staticData.resolveNames({
    items: [
      { kind: "type", id: 999999999 },
      { kind: "character", id: 999999999 },
      { kind: "corporation", id: 999999999 },
    ],
  });
  // The key is present (so the client caches the outcome) but the value is null.
  assert.equal(Object.prototype.hasOwnProperty.call(result.names, "type:999999999"), true);
  assert.equal(result.names["type:999999999"], null);
  assert.equal(result.names["character:999999999"], null);
  assert.equal(result.names["corporation:999999999"], null);
});

test("staticData.resolveNames caps an oversized batch", { skip: HAS_REAL_DATA ? false : "itemTypes data.json not present" }, () => {
  const items = [];
  for (let i = 0; i < 600; i++) {
    items.push({ kind: "type", id: 34 + i });
  }
  const result = staticData.resolveNames({ items });
  assert.equal(result.capped, true);
  assert.equal(result.limit, 500);
  // At most the cap of distinct keys were resolved.
  assert.ok(Object.keys(result.names).length <= 500);
});

// --- 2. POST /api/names route (injected fake staticData) --------------------

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

// A deterministic fixture resolver: a small map per kind. Re-implements the real
// resolveNames contract (dedup, echo-null for unknown, cap) so the route test is
// independent of the real data file.
const FIXTURE = {
  type: { 34: "Tritanium", 587: "Rifter" },
  station: { 60003760: "Jita IV - Moon 4 - Caldari Navy Assembly Plant" },
  system: { 30000142: "Jita" },
  corporation: { 1000044: "School of Applied Knowledge" },
  faction: { 500001: "Caldari State" },
  agent: { 3008416: "Antaken Kamola" },
};

function fakeStaticData() {
  return {
    resolveNames(input = {}) {
      const items = Array.isArray(input.items) ? input.items : [];
      const capped = items.length > 500;
      const slice = capped ? items.slice(0, 500) : items;
      const names = {};
      for (const item of slice) {
        const kind = item && item.kind ? String(item.kind) : "";
        const id = Number(item && item.id) || 0;
        if (!kind || id <= 0) {
          continue;
        }
        const key = `${kind}:${id}`;
        if (Object.prototype.hasOwnProperty.call(names, key)) {
          continue;
        }
        names[key] = (FIXTURE[kind] && FIXTURE[kind][id]) || null;
      }
      return { names, capped, limit: 500 };
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
  const init = { method: options.method || "GET", headers };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, init);
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

test("POST /api/names batch-resolves a mix of kinds in one round-trip", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: {
      items: [
        { kind: "type", id: 34 },
        { kind: "station", id: 60003760 },
        { kind: "system", id: 30000142 },
        { kind: "corporation", id: 1000044 },
        { kind: "faction", id: 500001 },
        { kind: "agent", id: 3008416 },
      ],
    },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "static-data");
  assert.equal(payload.names["type:34"], "Tritanium");
  assert.equal(payload.names["station:60003760"], "Jita IV - Moon 4 - Caldari Navy Assembly Plant");
  assert.equal(payload.names["system:30000142"], "Jita");
  assert.equal(payload.names["corporation:1000044"], "School of Applied Knowledge");
  assert.equal(payload.names["faction:500001"], "Caldari State");
  assert.equal(payload.names["agent:3008416"], "Antaken Kamola");
});

test("POST /api/names echoes a definitive null for an unknown id (client caches it)", async () => {
  const { baseUrl } = await startTestServer();
  const { payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: { items: [{ kind: "type", id: 999999999 }] },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload.names, "type:999999999"), true);
  assert.equal(payload.names["type:999999999"], null);
});

test("POST /api/names tolerates an empty / missing items body", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/names", { method: "POST", body: {} });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.names, {});
});

test("POST /api/names requires the web login session", async () => {
  const { baseUrl } = await startTestServer();
  const { response, payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: { items: [{ kind: "type", id: 34 }] },
    authenticated: false,
  });
  assert.equal(response.status, 401);
  assert.equal(payload.error, "AUTH_REQUIRED");
});
