"use strict";

// What the page's combat classifier wants to know of a type, as static reference data:
// GET /api/types/combat-utility.
//
// WHY IT EXISTS: the page tells what a fitted module does to a target (a web, a painter, a damper, a disruptor,
// a neutraliser) and what its charges are from the type's own facts: its group and category, its effects and
// attributes, and how much it holds and measures (nav/combatUtilities.ts). A retail client has all of it in its
// own static data. The page asks here, for the types of what is fitted and what is in the hold.
//
// Until 2026-10-11 it was GET /api/bridge/combat-utility-types: static data under the bridge's path, which makes
// no call of the server's. It refused a request of more than 100 types, or with anything in it that was no
// type's number, or with none; and left out a type the tables did not know, so that "not known" and "not asked"
// read alike. No test asked it.
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
// A web (the type and its dogma), a charge whose volume the tables have as nought and whose capacity they have
// not, a type the tables know and have no dogma for, and one with dogma and no type.
const FIXTURE_TYPES = { 527: { typeID: 527, groupID: 65, capacity: 0, volume: 5 }, 12614: { typeID: 12614, groupID: 908, volume: 0 }, 34: { typeID: 34, groupID: 18, capacity: 0, volume: 0.01 } };
// (A type's category is the static data's own to say, by its function: the type's record here has none.)
const FIXTURE_CATEGORIES = { 527: 7, 12614: 8, 34: 4 };
const FIXTURE_DOGMA = { 527: { effects: [11, 16, 586], attributes: { 6: 1, 20: -60, 54: 10000 } }, 12614: { effects: [], attributes: { 128: 1 } }, 7001: { effects: [16], attributes: {} } };
const WEB = { typeID: 527, groupID: 65, categoryID: 7, effects: [11, 16, 586], attributes: { 6: 1, 20: -60, 54: 10000 }, capacity: 0, volume: 5 };
const CHARGE = { typeID: 12614, groupID: 908, categoryID: 8, effects: [], attributes: { 128: 1 }, capacity: null, volume: 0 };

async function startTestServer({ asked = [], staticData } = {}) {
  const app = createApp({
    eveStore: { async getAccount(username) { return username === ACCOUNT.username ? { ...ACCOUNT } : null; } },
    eveGatewayClient: {},
    webAuth: {
      createSessionToken() { return COOKIE_TOKEN; },
      verifySessionToken(token) { return token === COOKIE_TOKEN ? { username: ACCOUNT.username, accountID: ACCOUNT.accountID, sessionID: SESSION_ID } : null; },
      countConfiguredUsers() { return 1; },
    },
    staticData: staticData ?? {
      getType(typeID) { asked.push(typeID); return FIXTURE_TYPES[typeID] ?? null; },
      getTypeDogma(typeID) { return FIXTURE_DOGMA[typeID] ?? null; },
      getTypeCategoryID(typeID) { return FIXTURE_CATEGORIES[typeID] ?? null; },
    },
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, asked };
}

async function get(baseUrl, path, options = {}) {
  const headers = options.authenticated === false ? {} : { cookie: `evejs_web_poc=${COOKIE_TOKEN}` };
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, { headers });
  return { response, payload: await response.json().catch(() => null) };
}
const getFacts = (baseUrl, query, options) => get(baseUrl, `/api/types/combat-utility${query}`, options);

test.afterEach(async () => {
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(new Promise((resolve, reject) => { server.close((error) => (error ? reject(error) : resolve())); }));
  }
  await Promise.all(closing);
});

test("GET /api/types/combat-utility answers each type asked of once: its facts, or null where the tables have not both the type and its dogma", async () => {
  const { baseUrl, asked } = await startTestServer();
  const { response, payload } = await getFacts(baseUrl, "?typeIDs=527,12614,527,%2034%20,7001,999,,0,-4,junk,1.5");
  assert.equal(response.status, 200);
  // What is no type's number is left out, and nothing is refused for it. A type asked of and not known is said
  // to be so: null, where "not asked" is not there at all.
  assert.deepEqual(payload, { ok: true, source: "static-data", types: { 527: WEB, 12614: CHARGE, 34: null, 7001: null, 999: null }, capped: false, limit: 500 });
  // A type is looked up once however often it is named.
  assert.deepEqual(asked, [527, 12614, 34, 7001, 999]);
});

test("GET /api/types/combat-utility with nothing asked answers nothing, and refuses nothing", async () => {
  const { baseUrl, asked } = await startTestServer();
  for (const query of ["", "?typeIDs=", "?other=1", "?typeIDs=junk,0"]) {
    const { response, payload } = await getFacts(baseUrl, query);
    assert.deepEqual([response.status, payload.types, payload.capped], [200, {}, false], query);
  }
  assert.deepEqual(asked, []);
});

test("GET /api/types/combat-utility answers no more types than its limit, and says it stopped", async () => {
  const { baseUrl, asked } = await startTestServer();
  const many = Array.from({ length: 503 }, (_, at) => 20000 + at);
  const { response, payload } = await getFacts(baseUrl, `?typeIDs=${many.join(",")}`);
  assert.equal(response.status, 200);
  assert.deepEqual([Object.keys(payload.types).length, payload.capped, payload.limit, asked.length], [500, true, 500, 500]);
  assert.equal(Object.hasOwn(payload.types, "20500"), false);
  // As many as the limit is all of them: nothing was left out, and it does not say so. And the 101 types the
  // route under the bridge's path refused are answered.
  const all = await getFacts(baseUrl, `?typeIDs=${many.slice(0, 500).join(",")}`);
  assert.deepEqual([Object.keys(all.payload.types).length, all.payload.capped], [500, false]);
  const more = await getFacts(baseUrl, `?typeIDs=${many.slice(0, 101).join(",")}`);
  assert.deepEqual([more.response.status, Object.keys(more.payload.types).length, more.payload.capped], [200, 101, false]);
});

test("GET /api/types/combat-utility requires the web login session", async () => {
  const { baseUrl, asked } = await startTestServer();
  const { response, payload } = await getFacts(baseUrl, "?typeIDs=527", { authenticated: false });
  assert.deepEqual([response.status, payload.error, asked], [401, "AUTH_REQUIRED", []]);
});

test("the read is under the bridge's path no longer: static data is no call of a pilot's", async () => {
  const { baseUrl, asked } = await startTestServer();
  const old = await get(baseUrl, "/api/bridge/combat-utility-types?typeIDs=527");
  assert.equal(old.response.status === 200 && old.payload !== null && old.payload.types !== undefined, false, JSON.stringify(old.payload));
  assert.deepEqual(asked, []);
});
