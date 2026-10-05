"use strict";

// The saved-PI-expansion routes and the planets-near read: signed-in only, the
// store's refusals mapped to a status with the store's own sentence, and the
// map read answering from static data with no session. The store is real, over
// an in-memory database (src/piExpansionStore.test.js covers it on its own).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");

process.env.EVEJS_WEB_POC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-web-pi-expansions-"));

const webAuth = require("../src/webAuth");
const { createApp } = require("../src/server");
const { lazyCompanionDb } = require("../src/companionDb");
const { createPiExpansionStore } = require("../src/piExpansionStore");

const FARMER = { username: "farmer", accountID: 4001, role: "0", banned: false };
const HOME = 30000001;
const PILOT = 90000001;
const PLANET = 40000002;

const activeServers = new Set();
test.after(() => {
  for (const server of activeServers) server.close();
});

async function startTestServer(extra = {}) {
  const app = createApp({
    eveStore: {
      async getAccount(username) {
        return String(username) === FARMER.username ? { ...FARMER } : null;
      },
      async listCharactersForAccount() {
        return [];
      },
      async getCharacterForAccount() {
        return null;
      },
    },
    eveGatewayClient: {},
    webAuth,
    botHost: {
      list: () => [],
      claimedBy: () => null,
      authorizesClaim: () => false,
      activeCharacterIDs: () => [],
      activeBots: () => [],
      sampleAllVitals: async () => {},
      resume: async () => {},
      stopAll: async () => {},
    },
    piExpansionStore: createPiExpansionStore({ db: lazyCompanionDb({ filename: ":memory:" }) }),
    errorLogger() {},
    ...extra,
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(baseUrl, routePath, { method = "GET", token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function signIn(baseUrl) {
  const login = await request(baseUrl, "/api/login", {
    method: "POST",
    body: { username: FARMER.username, password: "x" },
  });
  return login.payload.sessionToken;
}

const SETTINGS = { homeSystemID: HOME, maxJumps: 2, nullsecTolerance: 0.2, characterIDs: [PILOT] };
const ROWS = [{ characterID: PILOT, planetID: PLANET, resourceTypeID: 2268, productTypeID: 3645 }];

test("the expansion and map routes refuse a caller who is not signed in", async () => {
  const baseUrl = await startTestServer();
  assert.equal((await request(baseUrl, "/api/pi/expansions")).response.status, 401);
  assert.equal((await request(baseUrl, `/api/pi/planets-near?systemID=${HOME}&jumps=1`)).response.status, 401);
});

test("create, list, update and delete an expansion plan", async () => {
  const baseUrl = await startTestServer();
  const token = await signIn(baseUrl);
  const created = await request(baseUrl, "/api/pi/expansions", { method: "POST", token, body: { settings: SETTINGS, rows: ROWS } });
  assert.equal(created.response.status, 200);
  const plan = created.payload.plan;
  assert.deepEqual(plan.rows, ROWS);
  assert.equal(plan.settings.maxJumps, 2);

  const listed = await request(baseUrl, "/api/pi/expansions", { token });
  assert.deepEqual(listed.payload.plans.map((entry) => entry.planID), [plan.planID]);

  const updated = await request(baseUrl, `/api/pi/expansions/${plan.planID}`, {
    method: "POST", token, body: { status: "done", baseRev: plan.rev },
  });
  assert.equal(updated.payload.plan.status, "done");

  const stale = await request(baseUrl, `/api/pi/expansions/${plan.planID}`, {
    method: "POST", token, body: { note: "late", baseRev: plan.rev },
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.payload.error, "PI_EXPANSION_REV_CONFLICT");

  const removed = await request(baseUrl, `/api/pi/expansions/${plan.planID}/delete`, { method: "POST", token, body: {} });
  assert.equal(removed.payload.removed, true);
});

test("a malformed plan is refused with the store's sentence", async () => {
  const baseUrl = await startTestServer();
  const token = await signIn(baseUrl);
  const bad = await request(baseUrl, "/api/pi/expansions", {
    method: "POST", token, body: { settings: { ...SETTINGS, maxJumps: 9 }, rows: ROWS },
  });
  assert.equal(bad.response.status, 400);
  assert.equal(bad.payload.error, "PI_EXPANSION_INVALID");
  assert.equal(typeof bad.payload.message, "string");
});

test("planets near a system come from static data, and an unknown system is a 404", async () => {
  const asked = [];
  const baseUrl = await startTestServer({
    staticData: {
      getPlanetsNear(systemID, jumps) {
        asked.push([systemID, jumps]);
        return systemID === HOME
          ? { origin: { solarSystemID: HOME, solarSystemName: "Alpha" }, maxJumps: jumps, planets: [{ planetID: PLANET, jumps: 0 }] }
          : null;
      },
    },
  });
  const token = await signIn(baseUrl);
  const near = await request(baseUrl, `/api/pi/planets-near?systemID=${HOME}&jumps=2`, { token });
  assert.equal(near.response.status, 200);
  assert.equal(near.payload.planets[0].planetID, PLANET);
  const missing = await request(baseUrl, "/api/pi/planets-near?systemID=31999999&jumps=2", { token });
  assert.equal(missing.response.status, 404);
  assert.deepEqual(asked, [[HOME, 2], [31999999, 2]]);
});
