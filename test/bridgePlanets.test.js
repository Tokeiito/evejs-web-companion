"use strict";

// Goal R41: the BFF's half of Planetary Interaction — GET /api/bridge/planets.
//
// WHAT THIS ROUTE IS NOT: it is not a bridge `callMethod`. It adds ZERO pairs to
// the gateway's deny-by-default allowlist, because the gateway's GET /snapshot
// already carries `planetRuntimeState` filtered to the requested character's own
// colonies. The planetMgr reads that WOULD have needed allowlisting
// (GetFullNetworkForOwner, GetCommandPinsForPlanet, GetExtractorsForPlanet) are
// owner-agnostic by design — GetFullNetworkForOwner takes the ownerID from
// args[1] — so allowlisting one would have handed the browser any character's
// colony layout for an arbitrary id. Declined, R38-style. The test at the bottom
// of this file pins that decision by proving the route makes no bridge call.
//
// The colony fixture below is NOT hand-written. It was produced by running
// eve.js's own planetRuntimeStore._testing.buildPin + normalizeColony, so every
// field, every default the normalizer fills in (`typeID: 2280` on links,
// `charID` on routes, string-keyed `contents`, sorted `heads`) is the shape the
// emulator really stores. The instants are Windows FILETIME strings, which is
// why they are strings: they overflow a double.
//
// Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const CHARACTER_ID = 7;
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const ORIGIN_STATION_ID = 60003760;
const ORIGIN_SYSTEM_ID = 30000142;

const PLANET_ID = 40000002;
const COLONY_SYSTEM_ID = 30000001;
const COMMAND_CENTER_TYPE_ID = 2254;
const ECU_TYPE_ID = 3068;
const FACTORY_TYPE_ID = 2481;
const LAUNCHPAD_TYPE_ID = 2256;
const STORAGE_TYPE_ID = 2562;
const AQUEOUS_LIQUIDS_TYPE_ID = 2268;
const MICROORGANISMS_TYPE_ID = 2073;
const WATER_TYPE_ID = 3645;
const BACTERIA_TYPE_ID = 2393;
const PLANET_TEMPERATE_TYPE_ID = 11;

// ⚠ AN EXTRACTOR'S cycleTime IS IN 100ns FILETIME TICKS, NOT SECONDS.
// planetRuntimeStore divides it by SECOND_TICKS (10,000,000) wherever it uses
// it, and the real colony on Jita I carries 9,000,000,000 — 900 seconds, a
// 15-minute cycle. Treating it as seconds renders a cycle 285 years long.
const FILETIME_TICKS_PER_SECOND = 10000000;
const CYCLE_TICKS_1_HOUR = 3600 * FILETIME_TICKS_PER_SECOND;
const CYCLE_TICKS_30_MIN = 1800 * FILETIME_TICKS_PER_SECOND;
// The value a live read actually returned, kept verbatim.
const CYCLE_TICKS_LIVE_JITA = 9000000000;

// The two instants the active extractor carries, as the emulator stores them
// and as epoch ms. Computed independently of the route so the conversion is
// checked against arithmetic, not against itself.
const INSTALLED_AT_MS = Date.UTC(2026, 6, 21, 9, 0, 0);
const EXPIRES_AT_MS = Date.UTC(2026, 6, 22, 9, 0, 0);
const EXPIRED_EXPIRES_AT_MS = Date.UTC(2026, 6, 21, 10, 0, 0);

const ORIGINAL_FETCH = global.fetch;
const activeServers = new Set();

/** The colony, exactly as eve.js's normalizeColony emitted it. */
function capturedColony() {
  return {
    planetID: PLANET_ID,
    ownerID: 140000238,
    solarSystemID: COLONY_SYSTEM_ID,
    planetTypeID: PLANET_TEMPERATE_TYPE_ID,
    planetRadius: 5060000,
    level: 3,
    typeID: PLANET_TEMPERATE_TYPE_ID,
    currentSimTime: "134291087400000000",
    pins: [
      {
        id: 1,
        pinID: 1,
        ownerID: 140000238,
        typeID: COMMAND_CENTER_TYPE_ID,
        latitude: 0.1,
        longitude: 0.2,
        lastRunTime: "134291331597230000",
        contents: {},
        state: 0,
        lastLaunchTime: "0",
      },
      {
        id: 2,
        pinID: 2,
        ownerID: 140000238,
        typeID: ECU_TYPE_ID,
        latitude: 0.12,
        longitude: 0.22,
        lastRunTime: "134291331597240000",
        contents: {},
        state: 1,
        cycleTime: CYCLE_TICKS_1_HOUR,
        programType: AQUEOUS_LIQUIDS_TYPE_ID,
        qtyPerCycle: 2841,
        expiryTime: "134291844000000000",
        installTime: "134290980000000000",
        headRadius: 0.012,
        heads: [[0, 0.121, 0.221], [1, 0.119, 0.223], [2, 0.122, 0.219]],
      },
      {
        id: 3,
        pinID: 3,
        ownerID: 140000238,
        typeID: ECU_TYPE_ID,
        latitude: 0.31,
        longitude: 0.44,
        lastRunTime: "134291331597240000",
        contents: {},
        state: 0,
        cycleTime: CYCLE_TICKS_30_MIN,
        programType: MICROORGANISMS_TYPE_ID,
        qtyPerCycle: 1204,
        expiryTime: "134291016000000000",
        installTime: "134289360000000000",
        headRadius: 0.01,
        heads: [[0, 0.311, 0.441]],
      },
      {
        id: 4,
        pinID: 4,
        ownerID: 140000238,
        typeID: FACTORY_TYPE_ID,
        latitude: 0.13,
        longitude: 0.23,
        lastRunTime: "134291331597240000",
        contents: { 2268: 900 },
        state: 0,
        schematicID: 65,
        hasReceivedInputs: true,
        receivedInputsLastCycle: true,
      },
      {
        id: 5,
        pinID: 5,
        ownerID: 140000238,
        typeID: LAUNCHPAD_TYPE_ID,
        latitude: 0.14,
        longitude: 0.24,
        lastRunTime: "134291331597240000",
        contents: { 2393: 300, 3645: 4200 },
        state: 0,
        lastLaunchTime: "0",
      },
      {
        id: 6,
        pinID: 6,
        ownerID: 140000238,
        typeID: STORAGE_TYPE_ID,
        latitude: 0.15,
        longitude: 0.25,
        lastRunTime: "134291331597240000",
        contents: { 2268: 12000 },
        state: 0,
      },
    ],
    links: [
      { endpoint1: 1, endpoint2: 2, level: 0, typeID: 2280 },
      { endpoint1: 1, endpoint2: 4, level: 1, typeID: 2280 },
      { endpoint1: 4, endpoint2: 5, level: 0, typeID: 2280 },
      { endpoint1: 1, endpoint2: 6, level: 0, typeID: 2280 },
    ],
    routes: [
      {
        routeID: 1,
        path: [2, 4],
        commodityTypeID: AQUEOUS_LIQUIDS_TYPE_ID,
        commodityQuantity: 2841,
        charID: 140000238,
      },
      {
        routeID: 2,
        path: [4, 5],
        commodityTypeID: WATER_TYPE_ID,
        commodityQuantity: 20,
        charID: 140000238,
      },
    ],
  };
}

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
        ? { characterID: CHARACTER_ID, accountID: ACCOUNT.accountID, characterName: "Test Pilot" }
        : null;
    },
    async releaseCharacterControl() {
      return { controlState: "offline" };
    },
  };
}

const TYPE_NAMES = new Map([
  [COMMAND_CENTER_TYPE_ID, "Temperate Command Center"],
  [ECU_TYPE_ID, "Temperate Extractor Control Unit"],
  [FACTORY_TYPE_ID, "Temperate Basic Industry Facility"],
  [LAUNCHPAD_TYPE_ID, "Temperate Launchpad"],
  [STORAGE_TYPE_ID, "Temperate Storage Facility"],
  [AQUEOUS_LIQUIDS_TYPE_ID, "Aqueous Liquids"],
  [MICROORGANISMS_TYPE_ID, "Microorganisms"],
  [WATER_TYPE_ID, "Water"],
  [BACTERIA_TYPE_ID, "Bacteria"],
  [PLANET_TEMPERATE_TYPE_ID, "Planet (Temperate)"],
]);

// The real groupIDs, so the route's kind classification is exercised against
// the numbers the emulator's static data actually carries.
const TYPE_GROUPS = new Map([
  [COMMAND_CENTER_TYPE_ID, 1027],
  [ECU_TYPE_ID, 1063],
  [FACTORY_TYPE_ID, 1028],
  [LAUNCHPAD_TYPE_ID, 1030],
  [STORAGE_TYPE_ID, 1029],
  [AQUEOUS_LIQUIDS_TYPE_ID, 1033],
  [WATER_TYPE_ID, 1042],
  [BACTERIA_TYPE_ID, 1042],
  [PLANET_TEMPERATE_TYPE_ID, 7],
]);

function fakeStaticData() {
  return {
    getType(id) {
      const numeric = Number(id) || 0;
      return TYPE_GROUPS.has(numeric)
        ? { typeID: numeric, name: TYPE_NAMES.get(numeric), groupID: TYPE_GROUPS.get(numeric) }
        : null;
    },
    getTypeName(id) {
      return TYPE_NAMES.get(Number(id) || 0) || `Type ${id}`;
    },
    getPlanetName(id) {
      return Number(id) === PLANET_ID ? "Tanoo I" : null;
    },
    getSolarSystemName(id) {
      return Number(id) === COLONY_SYSTEM_ID ? "Tanoo" : `System ${id}`;
    },
    getStation() {
      return null;
    },
  };
}

function fakeGateway(overrides = {}) {
  const calls = { snapshot: [], call: [], bind: [], boundCall: [] };
  const gateway = {
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
          characterName: "Test Pilot",
          stationID: ORIGIN_STATION_ID,
          structureID: null,
          solarSystemID: ORIGIN_SYSTEM_ID,
          corporationID: 98000000,
          shipID: 9001,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: CHARACTER_ID };
    },
    async getSnapshot(accountID, characterID) {
      calls.snapshot.push({ accountID, characterID });
      return {
        source: "evejs-web-gateway",
        apiVersion: 1,
        planetRuntimeState: {
          schemaVersion: 1,
          resourcesByPlanetID: {},
          coloniesByKey: { [`${PLANET_ID}:140000238`]: capturedColony() },
          launchesByID: {},
          acceptedNetworkEditsByKey: {},
          nextIDs: {},
        },
      };
    },
    async callMethod(service, method, args, kwargs) {
      calls.call.push({ service, method, args, kwargs });
      return { service, method, result: null, notifications: [] };
    },
    async bindObject(service, method, args) {
      calls.bind.push({ service, method, args });
      return { boundID: "bound-1", notifications: [] };
    },
    async callBoundMethod(boundID, service, method, args) {
      calls.boundCall.push({ boundID, service, method, args });
      return { service, method, result: null, notifications: [] };
    },
    ...overrides,
  };
  return gateway;
}

async function startTestServer(options = {}) {
  const app = createApp({
    eveStore: options.store || fakeStore(),
    eveGatewayClient: options.gateway || fakeGateway(),
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
  if (options.authenticated !== false) {
    headers.cookie = `evejs_web_poc=${COOKIE_TOKEN}`;
  }
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, payload: await response.json() };
}

async function selected(overrides) {
  const gateway = fakeGateway(overrides);
  const { baseUrl } = await startTestServer({ gateway });
  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: CHARACTER_ID },
  });
  return { gateway, baseUrl };
}

test.afterEach(async () => {
  global.fetch = ORIGINAL_FETCH;
  for (const server of activeServers) {
    server.close();
  }
  activeServers.clear();
});

test("the colony arrives named, not numbered", async () => {
  const { baseUrl } = await selected();
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/planets");

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.coloniesReadable, true);
  assert.equal(payload.colonies.length, 1);

  const colony = payload.colonies[0];
  assert.equal(colony.planetName, "Tanoo I");
  assert.equal(colony.solarSystemName, "Tanoo");
  assert.equal(colony.planetTypeName, "Planet (Temperate)");
  assert.equal(colony.commandCenterLevel, 3);
});

test("the read is owner-scoped by the SNAPSHOT, and makes no bridge call at all", async () => {
  const { gateway, baseUrl } = await selected();
  await apiRequest(baseUrl, "/api/bridge/planets");

  // The ownership check is the gateway's: it is handed the account that is
  // signed in and the character the bridge session holds, and it filters
  // coloniesByKey itself. Nothing here passes an ownerID the browser chose.
  assert.deepEqual(gateway.calls.snapshot, [
    { accountID: ACCOUNT.accountID, characterID: CHARACTER_ID },
  ]);

  // ⚠ The R38 decision, pinned. If someone later "improves" this route by
  // reaching for planetMgr.GetFullNetworkForOwner, this fails — that read takes
  // its ownerID from args[1] and would answer for any character.
  assert.deepEqual(gateway.calls.call, []);
  assert.deepEqual(gateway.calls.bind, []);
  assert.deepEqual(gateway.calls.boundCall, []);
});

test("every pin is classified by what it DOES, from the real groupIDs", async () => {
  const { baseUrl } = await selected();
  const { payload } = await apiRequest(baseUrl, "/api/bridge/planets");
  const pins = payload.colonies[0].pins;

  assert.deepEqual(
    pins.map((pin) => [pin.pinID, pin.kind]),
    [
      [1, "command"],
      [2, "extractor-control"],
      [3, "extractor-control"],
      [4, "factory"],
      [5, "launchpad"],
      [6, "storage"],
    ],
  );
  assert.equal(pins[0].typeName, "Temperate Command Center");
  assert.equal(pins[4].typeName, "Temperate Launchpad");
});

test("a FILETIME becomes epoch ms, and \"0\" becomes nothing at all", async () => {
  const { baseUrl } = await selected();
  const { payload } = await apiRequest(baseUrl, "/api/bridge/planets");
  const colony = payload.colonies[0];
  const active = colony.pins.find((pin) => pin.pinID === 2);
  const expired = colony.pins.find((pin) => pin.pinID === 3);

  assert.equal(active.program.installedAtMs, INSTALLED_AT_MS);
  assert.equal(active.program.expiresAtMs, EXPIRES_AT_MS);
  assert.equal(expired.program.expiresAtMs, EXPIRED_EXPIRES_AT_MS);
  assert.equal(colony.lastSimulatedAtMs, Date.UTC(2026, 6, 21, 11, 59, 0));

  // The launchpad's lastLaunchTime is the string "0" — EveJS's "never". It must
  // not surface as an instant in 1601, and the route must not invent one.
  const launchpad = colony.pins.find((pin) => pin.pinID === 5);
  assert.equal(launchpad.program, null);

  // serverNowMs is sampled in the SAME read, so the browser compares one clock.
  assert.equal(typeof payload.serverNowMs, "number");
  assert.ok(payload.serverNowMs > Date.UTC(2020, 0, 1));
});

test("an extraction program carries the server's own numbers, unchanged", async () => {
  const { baseUrl } = await selected();
  const { payload } = await apiRequest(baseUrl, "/api/bridge/planets");
  const active = payload.colonies[0].pins.find((pin) => pin.pinID === 2);

  assert.equal(active.program.resourceTypeName, "Aqueous Liquids");
  assert.equal(active.program.cycleTimeSeconds, 3600);
  assert.equal(active.program.quantityPerCycle, 2841);
  assert.equal(active.program.headCount, 3);
});

test("a cycle time is TICKS on the wire and SECONDS in the answer", async () => {
  // The exact value a live read returned for the colony on Jita I. If this is
  // ever copied across unconverted it renders as a cycle 285 years long.
  const { baseUrl } = await selected({
    async getSnapshot() {
      const colony = capturedColony();
      const ecu = colony.pins.find((pin) => pin.pinID === 2);
      ecu.cycleTime = CYCLE_TICKS_LIVE_JITA;
      return {
        planetRuntimeState: { schemaVersion: 1, coloniesByKey: { "40000002:140000238": colony } },
      };
    },
  });
  const { payload } = await apiRequest(baseUrl, "/api/bridge/planets");
  const active = payload.colonies[0].pins.find((pin) => pin.pinID === 2);

  assert.equal(active.program.cycleTimeSeconds, 900, "9e9 ticks is 15 minutes");
  assert.notEqual(
    active.program.cycleTimeSeconds,
    CYCLE_TICKS_LIVE_JITA,
    "the raw tick count must never reach the browser as a duration",
  );
});

test("a cycle time of zero stays zero rather than becoming a rounding artefact", async () => {
  const { baseUrl } = await selected({
    async getSnapshot() {
      const colony = capturedColony();
      colony.pins.find((pin) => pin.pinID === 2).cycleTime = 0;
      return {
        planetRuntimeState: { schemaVersion: 1, coloniesByKey: { "40000002:140000238": colony } },
      };
    },
  });
  const { payload } = await apiRequest(baseUrl, "/api/bridge/planets");
  assert.equal(
    payload.colonies[0].pins.find((pin) => pin.pinID === 2).program.cycleTimeSeconds,
    0,
  );
});

test("what is stored on a pin arrives as names and quantities, biggest first", async () => {
  const { baseUrl } = await selected();
  const { payload } = await apiRequest(baseUrl, "/api/bridge/planets");
  const launchpad = payload.colonies[0].pins.find((pin) => pin.pinID === 5);

  assert.deepEqual(
    launchpad.contents.map((entry) => [entry.typeName, entry.quantity]),
    [["Water", 4200], ["Bacteria", 300]],
  );
});

test("routes name what they carry", async () => {
  const { baseUrl } = await selected();
  const { payload } = await apiRequest(baseUrl, "/api/bridge/planets");
  const colony = payload.colonies[0];

  assert.equal(colony.linkCount, 4);
  assert.deepEqual(
    colony.routes.map((route) => [route.commodityTypeName, route.commodityQuantity]),
    [["Aqueous Liquids", 2841], ["Water", 20]],
  );
});

test("\"you have no colonies\" is a different answer from \"colonies could not be read\"", async () => {
  const empty = await selected({
    async getSnapshot() {
      return { planetRuntimeState: { schemaVersion: 1, coloniesByKey: {} } };
    },
  });
  const { payload: emptyPayload } = await apiRequest(empty.baseUrl, "/api/bridge/planets");
  assert.equal(emptyPayload.coloniesReadable, true);
  assert.deepEqual(emptyPayload.colonies, []);

  // A gateway that reports no colony table at all has NOT told us the character
  // has none. Saying "you have no colonies" here would be a guess.
  const silent = await selected({
    async getSnapshot() {
      return { source: "evejs-web-gateway", apiVersion: 1 };
    },
  });
  const { payload: silentPayload } = await apiRequest(silent.baseUrl, "/api/bridge/planets");
  assert.equal(silentPayload.coloniesReadable, false);
  assert.deepEqual(silentPayload.colonies, []);
});

test("a character the gateway does not know is a 404, not an empty colony list", async () => {
  const { baseUrl } = await selected({
    async getSnapshot() {
      return null;
    },
  });
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/planets");
  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, "CHARACTER_NOT_FOUND");
});

test("without a held bridge session there is nothing to read", async () => {
  const { baseUrl } = await startTestServer();
  const { response } = await apiRequest(baseUrl, "/api/bridge/planets");
  assert.equal(response.status, 409);
});

test("a planet the static map cannot name answers null, never a stringified id", async () => {
  const { baseUrl } = await selected();
  const app = await apiRequest(baseUrl, "/api/bridge/planets");
  assert.equal(app.payload.colonies[0].planetName, "Tanoo I");

  const unnamed = await selected({
    async getSnapshot() {
      const colony = capturedColony();
      colony.planetID = 40999999;
      return {
        planetRuntimeState: { schemaVersion: 1, coloniesByKey: { "40999999:140000238": colony } },
      };
    },
  });
  const { payload } = await apiRequest(unnamed.baseUrl, "/api/bridge/planets");
  assert.equal(payload.colonies[0].planetName, null);
  assert.ok(
    !JSON.stringify(payload.colonies[0].planetName).includes("40999999"),
    "an unnamed planet must not fall back to printing its id",
  );
});
