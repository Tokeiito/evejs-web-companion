"use strict";

// A type's volume, as static reference data: GET /api/types/volumes.
//
// WHY IT EXISTS: a retail client has every type's volume in its own static data, and shows it beside whatever
// lists items. The page has no such data: the BFF's routes that list items have sent each type's volume beside
// the server's answer (`volumes`). Where the page asks the server itself (what is at a station of the pilot's
// things, since 2026-10-11), it asks the volumes here, once for a type, as it asks a type's cycle time
// (/api/types/cycle-times). No gateway call, no live session: this cannot vary by player.
//
// The route is read against an injected staticData.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();
// What the static tables say of a type: a Reaper's 15,800 m³, a stack's fraction of one, a type with a volume of
// nought, one whose volume is no number, and one with no volume said at all.
const FIXTURE_TYPES = { 588: { typeID: 588, volume: 15800 }, 34: { typeID: 34, volume: 0.01 }, 7001: { typeID: 7001, volume: 0 }, 7002: { typeID: 7002, volume: "big" }, 7003: { typeID: 7003 }, 7004: { typeID: 7004, volume: -5 } };

async function startTestServer({ asked = [], staticData } = {}) {
  const app = createApp({
    eveStore: { async getAccount(username) { return username === ACCOUNT.username ? { ...ACCOUNT } : null; } },
    eveGatewayClient: {},
    webAuth: {
      createSessionToken() { return COOKIE_TOKEN; },
      verifySessionToken(token) { return token === COOKIE_TOKEN ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: SESSION_ID } : null; },
      countConfiguredUsers() { return 1; },
    },
    staticData: staticData ?? { getType(typeID) { asked.push(typeID); return FIXTURE_TYPES[typeID] ?? null; } },
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, asked };
}

async function getVolumes(baseUrl, query, options = {}) {
  const headers = options.authenticated === false ? {} : { cookie: `evejs_web_poc=${COOKIE_TOKEN}` };
  const response = await ORIGINAL_FETCH(`${baseUrl}/api/types/volumes${query}`, { headers });
  return { response, payload: await response.json() };
}

test.afterEach(async () => {
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(new Promise((resolve, reject) => { server.close((error) => (error ? reject(error) : resolve())); }));
  }
  await Promise.all(closing);
});

test("GET /api/types/volumes answers each type asked of once: its volume, or null where the tables have none; never nought", async () => {
  const { baseUrl, asked } = await startTestServer();
  const { response, payload } = await getVolumes(baseUrl, "?typeIDs=588,34,588,%207001%20,7002,7003,7004,999,,0,-4,junk,1.5");
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, source: "static-data", volumes: { 588: 15800, 34: 0.01, 7001: null, 7002: null, 7003: null, 7004: null, 999: null }, capped: false, limit: 500 });
  // A type is looked up once however often it is named, and what is no type's ID is not looked up at all.
  assert.deepEqual(asked, [588, 34, 7001, 7002, 7003, 7004, 999]);
});

test("GET /api/types/volumes with nothing asked answers nothing", async () => {
  const { baseUrl, asked } = await startTestServer();
  for (const query of ["", "?typeIDs=", "?other=1"]) {
    const { response, payload } = await getVolumes(baseUrl, query);
    assert.deepEqual([response.status, payload.volumes, payload.capped], [200, {}, false], query);
  }
  assert.deepEqual(asked, []);
});

test("GET /api/types/volumes answers no more types than its limit, and says it stopped", async () => {
  const { baseUrl, asked } = await startTestServer();
  const many = Array.from({ length: 503 }, (_, at) => 20000 + at);
  const { response, payload } = await getVolumes(baseUrl, `?typeIDs=${many.join(",")}`);
  assert.equal(response.status, 200);
  assert.deepEqual([Object.keys(payload.volumes).length, payload.capped, payload.limit, asked.length], [500, true, 500, 500]);
  assert.equal(Object.hasOwn(payload.volumes, "20500"), false);
  // As many as the limit is all of them: nothing was left out, and it does not say so.
  const all = await getVolumes(baseUrl, `?typeIDs=${many.slice(0, 500).join(",")}`);
  assert.deepEqual([Object.keys(all.payload.volumes).length, all.payload.capped], [500, false]);
});

test("GET /api/types/volumes says each type is unknown where the static tables cannot be asked at all", async () => {
  const { baseUrl } = await startTestServer({ staticData: {} });
  const { response, payload } = await getVolumes(baseUrl, "?typeIDs=588,34");
  assert.deepEqual([response.status, payload.volumes], [200, { 588: null, 34: null }]);
});

test("GET /api/types/volumes requires the web login session", async () => {
  const { baseUrl, asked } = await startTestServer();
  const { response, payload } = await getVolumes(baseUrl, "?typeIDs=588", { authenticated: false });
  assert.deepEqual([response.status, payload.error, asked], [401, "AUTH_REQUIRED", []]);
});
