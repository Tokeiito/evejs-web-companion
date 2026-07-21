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
  // 30000144 (Perimeter) is the system the R38 structure fixture sits in.
  system: { 30000142: "Jita", 30000144: "Perimeter" },
  corporation: { 1000044: "School of Applied Knowledge" },
  faction: { 500001: "Caldari State" },
  agent: { 3008416: "Antaken Kamola" },
};

function fakeStaticData() {
  return {
    // The map getters /api/map/resolve reads. Backed by the same fixture so a
    // station/system in one route is the same entity in the other.
    getStation(id) {
      const stationName = FIXTURE.station[Number(id)];
      return stationName ? { stationName, solarSystemID: 30000142 } : null;
    },
    getSolarSystem(id) {
      const name = FIXTURE.system[Number(id)];
      return name ? { solarSystemID: Number(id), solarSystemName: name } : null;
    },
    getSolarSystemName(id) {
      return FIXTURE.system[Number(id)] || null;
    },
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

// --- 3. R38 player-structure names (the ONE runtime name read) --------------
//
// A player-owned Upwell structure is runtime data: it exists only in the game
// store and in NO static table, so resolveNames answers null for it and the
// panel showed "an unnamed place". POST /api/names falls through to
// structureDirectory.GetStructureInfo for exactly those misses.
//
// ⚠ THE FIXTURES BELOW ARE REAL CAPTURED BYTES, not hand-written shapes. Both
// were taken from the live server (structure 1030000000001, an Astrahus named
// "Perimeter - asdf" in Perimeter) through POST /api/bridge/call:
//   * OWNER_PAYLOAD — as Farmer (140000005, corp 98000001, the owning corp):
//     the full directory record, 28 keys.
//   * NON_OWNER_PAYLOAD — as Test Pilot (140000001, corp 1000044, NOT the
//     owner and not docked there): the public eight-key payload.
// The point of keeping both: the two branches of Handle_GetStructureInfo return
// DIFFERENT key sets, and `itemName` is the only field this BFF reads, so the
// resolver must work against either. A decoder written against one shape only
// would silently answer null for the other.

const STRUCTURE_ID = 1030000000001;
const STRUCTURE_NAME = "Perimeter - asdf";
const STRUCTURE_SYSTEM_ID = 30000144;

const OWNER_PAYLOAD = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["itemID", STRUCTURE_ID],
      ["structureID", STRUCTURE_ID],
      ["itemName", STRUCTURE_NAME],
      ["solarSystemID", STRUCTURE_SYSTEM_ID],
      ["locationID", STRUCTURE_SYSTEM_ID],
      ["ownerID", 98000001],
      ["allianceID", null],
      ["typeID", 35832],
      ["groupID", 1657],
      ["categoryID", 65],
      ["x", 800382013408.2244],
      ["y", 54164076845.46208],
      ["z", 1112590660754.3835],
      ["inSpace", true],
      ["profileID", 2],
      ["services", { type: "dict", entries: [[1, 0], [2, 0], [3, 0], [6, 0], [8, 0], [9, 0]] }],
      ["fuelExpires", null],
      ["upkeepState", 1],
      ["state", 110],
      ["timerEnd", null],
      ["reinforce_weekday", 255],
      ["reinforce_hour", 20],
      ["next_reinforce_weekday", null],
      ["next_reinforce_hour", null],
      ["next_reinforce_apply", null],
      ["unanchoring", null],
      ["liquidOzoneQty", 0],
      ["wars", { type: "list", items: [] }],
    ],
  },
};

const NON_OWNER_PAYLOAD = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["typeID", 35832],
      ["structureID", STRUCTURE_ID],
      ["upkeepState", 1],
      ["wars", []],
      ["ownerID", 98000001],
      ["solarSystemID", STRUCTURE_SYSTEM_ID],
      ["itemName", STRUCTURE_NAME],
      ["inSpace", true],
    ],
  },
};

const BRIDGE_SESSION_ID = "bridge-session-for-structure-names";
const CHARACTER_ID = 140000005;

// A gateway that answers GetStructureInfo from a chosen fixture. `structureInfo`
// maps a structureID to the payload to answer with; an ID that is absent answers
// null, which is what the real server does for a structure that does not exist
// (verified live for an unknown ID, an NPC station ID, and 0).
function fakeStructureGateway(options = {}) {
  const calls = { topLevel: [] };
  const info = options.structureInfo || {};
  const failures = new Set(options.failures || []);
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
          userid: ACCOUNT.accountID,
          characterID: CHARACTER_ID,
          characterName: "Farmer",
          stationID: 60000358,
          structureID: null,
          solarSystemID: STRUCTURE_SYSTEM_ID,
          corporationID: 98000001,
          shipID: 1000000000001,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: CHARACTER_ID };
    },
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.topLevel.push({ service, method, args, bridgeSessionID });
      if (failures.has(`${service}.${method}`)) {
        throw Object.assign(new Error(`${service}.${method} failed`), { code: "CALL_FAILED" });
      }
      if (service === "structureDirectory" && method === "GetStructureInfo") {
        const structureID = Number(args && args[0]) || 0;
        return {
          service,
          method,
          result: Object.prototype.hasOwnProperty.call(info, structureID)
            ? info[structureID]
            : null,
          notifications: [],
        };
      }
      return { service, method, result: null, notifications: [] };
    },
  };
}

async function startStructureServer(gatewayOptions = {}) {
  const app = createApp({
    eveStore: {
      async getAccount(username) {
        return username === ACCOUNT.username ? { ...ACCOUNT } : null;
      },
      async getCharacterForAccount(accountID, characterID) {
        return accountID === ACCOUNT.accountID && characterID === CHARACTER_ID
          ? { characterID: CHARACTER_ID, characterName: "Farmer" }
          : null;
      },
    },
    eveGatewayClient: fakeStructureGateway(gatewayOptions),
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

async function withLiveCharacter(baseUrl) {
  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: CHARACTER_ID },
  });
}

test("POST /api/names names a player structure the static tables cannot see", async () => {
  const { baseUrl } = await startStructureServer({
    structureInfo: { [STRUCTURE_ID]: OWNER_PAYLOAD },
  });
  await withLiveCharacter(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    // `station` is what every existing caller asks for — Assets does not know a
    // structure from an NPC station, and must not have to.
    body: { items: [{ kind: "station", id: STRUCTURE_ID }] },
  });
  assert.equal(payload.names[`station:${STRUCTURE_ID}`], STRUCTURE_NAME);
  assert.equal(payload.source, "static-data+runtime-structures");
  assert.deepEqual(payload.unresolved, []);
});

test("POST /api/names reads the name from the NON-OWNER payload shape too", async () => {
  // The public eight-key branch. `itemName` is present in both shapes and is the
  // only field read, so a character with no relationship to the structure still
  // gets its name.
  const { baseUrl } = await startStructureServer({
    structureInfo: { [STRUCTURE_ID]: NON_OWNER_PAYLOAD },
  });
  await withLiveCharacter(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: { items: [{ kind: "structure", id: STRUCTURE_ID }] },
  });
  assert.equal(payload.names[`structure:${STRUCTURE_ID}`], STRUCTURE_NAME);
});

test("POST /api/names makes NO gateway call when nothing could be a structure", async () => {
  // The common case must stay exactly as cheap as it was: a batch of types and
  // NPC stations is still pure static data with zero round trips.
  const gatewayOptions = { structureInfo: { [STRUCTURE_ID]: OWNER_PAYLOAD } };
  const app = createApp({
    eveStore: {
      async getAccount(username) {
        return username === ACCOUNT.username ? { ...ACCOUNT } : null;
      },
    },
    eveGatewayClient: fakeStructureGateway(gatewayOptions),
    webAuth: fakeAuth(),
    staticData: fakeStaticData(),
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const { payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: {
      items: [
        { kind: "type", id: 34 },
        { kind: "station", id: 60003760 },
        // A static MISS below the structure floor: still no round trip, because
        // no player structure can have an ID this low.
        { kind: "station", id: 60009999 },
      ],
    },
  });
  assert.equal(payload.source, "static-data");
  assert.equal(payload.names["station:60009999"], null);
});

test("POST /api/names keeps a definitive null for an ID that is no structure", async () => {
  // The gateway answered null — "nothing bears this ID". That is a FINDING, so
  // it stays a cacheable null and is NOT reported as unresolved.
  const { baseUrl } = await startStructureServer({ structureInfo: {} });
  await withLiveCharacter(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: { items: [{ kind: "station", id: STRUCTURE_ID }] },
  });
  assert.equal(payload.names[`station:${STRUCTURE_ID}`], null);
  assert.deepEqual(payload.unresolved, []);
});

test("POST /api/names reports a FAILED structure lookup as unresolved, not as nameless", async () => {
  // ⚠ The distinction this goal turns on. The read threw, so we do not know
  // whether the structure has a name. Saying null WITHOUT saying unresolved
  // would let the client cache "this place has no name" forever on the strength
  // of a question that was never answered.
  const { baseUrl } = await startStructureServer({
    structureInfo: { [STRUCTURE_ID]: OWNER_PAYLOAD },
    failures: ["structureDirectory.GetStructureInfo"],
  });
  await withLiveCharacter(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: { items: [{ kind: "station", id: STRUCTURE_ID }] },
  });
  assert.equal(payload.names[`station:${STRUCTURE_ID}`], null);
  assert.deepEqual(payload.unresolved, [`station:${STRUCTURE_ID}`]);
});

test("POST /api/names reports unresolved (not nameless) when no character is online", async () => {
  // No live session means no session to ask on — again "we could not ask",
  // never "there is no name".
  const { baseUrl } = await startStructureServer({
    structureInfo: { [STRUCTURE_ID]: OWNER_PAYLOAD },
  });
  const { payload } = await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: { items: [{ kind: "station", id: STRUCTURE_ID }] },
  });
  assert.equal(payload.names[`station:${STRUCTURE_ID}`], null);
  assert.deepEqual(payload.unresolved, [`station:${STRUCTURE_ID}`]);
});

test("POST /api/names resolves a repeated structure through the cache, not a second call", async () => {
  const { baseUrl } = await startStructureServer({
    structureInfo: { [STRUCTURE_ID]: OWNER_PAYLOAD },
  });
  await withLiveCharacter(baseUrl);
  const body = { items: [{ kind: "station", id: STRUCTURE_ID }] };
  const first = await apiRequest(baseUrl, "/api/names", { method: "POST", body });
  const second = await apiRequest(baseUrl, "/api/names", { method: "POST", body });
  assert.equal(first.payload.names[`station:${STRUCTURE_ID}`], STRUCTURE_NAME);
  assert.equal(second.payload.names[`station:${STRUCTURE_ID}`], STRUCTURE_NAME);
});

test("GET /api/map/resolve names a player structure (Travel + the flight readout)", async () => {
  // The SECOND consumer of the one shared resolver. Travel and the flight
  // readout resolve locations through this route, so a structure destination
  // gets a real name and a routable system without a parallel code path.
  const { baseUrl } = await startStructureServer({
    structureInfo: { [STRUCTURE_ID]: OWNER_PAYLOAD },
  });
  await withLiveCharacter(baseUrl);
  const { payload } = await apiRequest(baseUrl, `/api/map/resolve/${STRUCTURE_ID}`);
  assert.equal(payload.kind, "structure");
  assert.equal(payload.structureName, STRUCTURE_NAME);
  // Echoed into the station fields too, so existing station-shaped consumers
  // keep working unchanged.
  assert.equal(payload.stationName, STRUCTURE_NAME);
  assert.equal(payload.stationID, STRUCTURE_ID);
  // The system comes out of the SAME payload as the name — no second call.
  assert.equal(payload.solarSystemID, STRUCTURE_SYSTEM_ID);
  assert.equal(payload.lookupFailed, false);
});

test("GET /api/map/resolve marks a FAILED structure lookup, so the miss is not cached", async () => {
  const { baseUrl } = await startStructureServer({
    structureInfo: { [STRUCTURE_ID]: OWNER_PAYLOAD },
    failures: ["structureDirectory.GetStructureInfo"],
  });
  await withLiveCharacter(baseUrl);
  const { payload } = await apiRequest(baseUrl, `/api/map/resolve/${STRUCTURE_ID}`);
  assert.equal(payload.kind, "unknown");
  assert.equal(payload.lookupFailed, true);
});

test("GET /api/map/resolve leaves an ordinary static miss cacheable", async () => {
  // A plain unknown ID below the structure floor is a definite miss, exactly as
  // before — lookupFailed must stay false or the client would stop caching it.
  const { baseUrl } = await startStructureServer({ structureInfo: {} });
  await withLiveCharacter(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/map/resolve/60009999");
  assert.equal(payload.kind, "unknown");
  assert.equal(payload.lookupFailed, false);
});

test("the structure name read is the ONLY structureDirectory call the BFF makes", async () => {
  // Minimum allowlist surface, asserted from the caller's side: exactly one
  // pair is reachable, and it is the read. If a future change reaches for
  // GetStructures (the batch form, deliberately NOT allowlisted because it
  // hands non-owners a defender's reinforcement timers) this fails.
  const gateway = fakeStructureGateway({
    structureInfo: { [STRUCTURE_ID]: OWNER_PAYLOAD },
  });
  const app = createApp({
    eveStore: {
      async getAccount(username) {
        return username === ACCOUNT.username ? { ...ACCOUNT } : null;
      },
      async getCharacterForAccount() {
        return { characterID: CHARACTER_ID, characterName: "Farmer" };
      },
    },
    eveGatewayClient: gateway,
    webAuth: fakeAuth(),
    staticData: fakeStaticData(),
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await withLiveCharacter(baseUrl);
  await apiRequest(baseUrl, "/api/names", {
    method: "POST",
    body: { items: [{ kind: "station", id: STRUCTURE_ID }] },
  });
  const structureCalls = gateway.calls.topLevel.filter(
    (call) => call.service === "structureDirectory",
  );
  assert.deepEqual(
    [...new Set(structureCalls.map((call) => call.method))],
    ["GetStructureInfo"],
  );
  assert.deepEqual(structureCalls[0].args, [STRUCTURE_ID]);
});
