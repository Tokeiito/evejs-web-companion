"use strict";

// Goal R15 (Slice A): the BFF industry READ route and the static recipe route.
//
// Industry is the first panel that needs NO bound-object machinery: the whole
// retail surface is top-level, so /api/bridge/industry is five plain
// callMethod round-trips on the held session. The interesting properties are
// therefore not about binds at all, they are about:
//
//   - INDEPENDENCE. The five reads run under Promise.allSettled, so a player
//     whose facility read fails still sees their blueprints and jobs. Each
//     read carries its own error; one failure never blanks the panel.
//   - ARGUMENTS. GetBlueprintDataByOwner / GetJobsByOwner / GetJobCounts are
//     scoped to the HELD session's own characterID — the browser cannot ask
//     for another character's industry, because it never supplies an ownerID.
//   - THE STATIC SPLIT. Names and recipes never touch the gateway. The recipe
//     route is pure static data, so it answers even with no live session.
//
// Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const STATION_ID = 60003760;
const SOLAR_SYSTEM_ID = 30000142;
const CHARACTER_ID = 7;
const ACTIVE_SHIP_ID = 9001;

// The blueprint the fixtures revolve around, and the job it is installed into.
const BLUEPRINT_ITEM_ID = 7_100_000_001;
const BLUEPRINT_TYPE_ID = 681;
const PRODUCT_TYPE_ID = 165;
const MATERIAL_TYPE_ID = 38;
const JOB_ID = 4_200_001;

// Activity + status codes. These appear in FIXTURES (the server's own view) and
// nowhere else — the decoded panel state speaks in names.
const ACTIVITY_MANUFACTURING = 1;
const ACTIVITY_COPYING = 5;
const STATUS_INSTALLED = 1;
const STATUS_DELIVERED = 101;

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
    async getCharacterForAccount(accountID, characterID) {
      return Number(accountID) === ACCOUNT.accountID && Number(characterID) === CHARACTER_ID
        ? { characterID: CHARACTER_ID, accountID: 4, characterName: "Test Pilot" }
        : null;
    },
    async releaseCharacterControl() {
      return { controlState: "offline" };
    },
  };
}

// The static-data half: the 5,081-definition table in miniature. Only the one
// blueprint the fixtures use is known; everything else is a definitive miss,
// which the route must echo as null rather than omitting.
function fakeStaticData() {
  return {
    getStation() {
      return null;
    },
    getTypeName(id) {
      return `Type ${id}`;
    },
    getIndustryBlueprint(blueprintTypeID) {
      if (Number(blueprintTypeID) !== BLUEPRINT_TYPE_ID) {
        return null;
      }
      return {
        blueprintTypeID: BLUEPRINT_TYPE_ID,
        blueprintName: "Clone Grade Beta Blueprint",
        productTypeID: PRODUCT_TYPE_ID,
        productName: "Clone Grade Beta",
        maxProductionLimit: 300,
        activities: {
          manufacturing: {
            materials: [{ typeID: MATERIAL_TYPE_ID, quantity: 86 }],
            products: [{ typeID: PRODUCT_TYPE_ID, quantity: 1 }],
            time: 600,
          },
          copying: { time: 480 },
        },
      };
    },
    resolveNames() {
      return { names: {}, capped: false, limit: 500 };
    },
  };
}

// --- marshaled-value builders (the server's own encodings) ------------------

function keyVal(entries) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

function list(items) {
  return { type: "list", items };
}

function dict(entries) {
  return { type: "dict", entries };
}

function long(value) {
  return { type: "long", value: String(value) };
}

function blueprintRow(overrides = {}) {
  return keyVal(
    Object.entries({
      typeID: BLUEPRINT_TYPE_ID,
      itemID: BLUEPRINT_ITEM_ID,
      timeEfficiency: 20,
      materialEfficiency: 10,
      runs: 40,
      quantity: -1,
      locationID: STATION_ID,
      locationTypeID: 0,
      locationFlagID: 4,
      flagID: 4,
      facilityID: null,
      ownerID: CHARACTER_ID,
      jobID: null,
      isImpounded: false,
      original: false,
      solarSystemID: SOLAR_SYSTEM_ID,
      ...overrides,
    }),
  );
}

function jobRow(overrides = {}) {
  const fields = {
    activityID: ACTIVITY_MANUFACTURING,
    jobID: JOB_ID,
    blueprintID: BLUEPRINT_ITEM_ID,
    blueprintTypeID: BLUEPRINT_TYPE_ID,
    blueprintCopy: true,
    facilityID: STATION_ID,
    ownerID: CHARACTER_ID,
    status: STATUS_INSTALLED,
    installerID: CHARACTER_ID,
    solarSystemID: SOLAR_SYSTEM_ID,
    stationID: STATION_ID,
    runs: 3,
    licensedRuns: 1,
    successfulRuns: 0,
    cost: 1250,
    timeInSeconds: 1800,
    probability: 1,
    productTypeID: PRODUCT_TYPE_ID,
    outputLocationID: STATION_ID,
    outputFlagID: 4,
    ...overrides,
  };
  const entries = Object.entries(fields);
  // The dates are retail FILETIME longs, not plain numbers.
  entries.push(["startDate", long("133000000000000000")]);
  entries.push(["endDate", long("133000000018000000")]);
  return keyVal(entries);
}

function facilityRow(overrides = {}) {
  return keyVal(
    Object.entries({
      facilityID: STATION_ID,
      typeID: 52678,
      ownerID: 1000035,
      tax: 0.01,
      solarSystemID: SOLAR_SYSTEM_ID,
      online: true,
      sccTaxModifier: 1,
      ...overrides,
    }).concat([
      [
        "activities",
        dict([
          [ACTIVITY_MANUFACTURING, { type: "tuple", items: [] }],
          [ACTIVITY_COPYING, { type: "tuple", items: [] }],
        ]),
      ],
    ]),
  );
}

/**
 * A gateway fake for the industry surface. `failures` names the (service,
 * method) pairs that should throw, so the independence of the five reads can be
 * exercised one at a time.
 */
function fakeGateway(options = {}) {
  const calls = { topLevel: [] };
  const failures = new Set(options.failures || []);
  const jobs = options.jobs || [jobRow()];
  const blueprints = options.blueprints || [blueprintRow()];

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
          userid: 4,
          characterID: CHARACTER_ID,
          characterName: "Test Pilot",
          stationID: STATION_ID,
          structureID: null,
          solarSystemID: SOLAR_SYSTEM_ID,
          corporationID: 98000000,
          shipID: ACTIVE_SHIP_ID,
        },
      };
    },
    async releaseBridgeSession() {
      return { released: true, characterID: CHARACTER_ID };
    },
    async readFlightStatus() {
      return {
        flight: {
          docked: true,
          inSpace: false,
          stationID: STATION_ID,
          solarSystemID: SOLAR_SYSTEM_ID,
          shipID: ACTIVE_SHIP_ID,
        },
        notifications: [],
      };
    },
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.topLevel.push({ service, method, args, kwargs, bridgeSessionID });
      if (failures.has(`${service}.${method}`)) {
        throw Object.assign(new Error(`${service}.${method} failed`), { code: "CALL_FAILED" });
      }
      if (service === "blueprintManager" && method === "GetBlueprintDataByOwner") {
        // ⚠ A 2-TUPLE, not a list: [rows, facilityID -> count].
        return {
          service,
          method,
          result: [list(blueprints), dict([[STATION_ID, blueprints.length]])],
          notifications: [],
        };
      }
      if (service === "industryManager" && method === "GetJobsByOwner") {
        const includeCompleted = args[1] === true;
        return {
          service,
          method,
          result: list(includeCompleted ? jobs : jobs.filter((row) => !isFinishedRow(row))),
          notifications: [],
        };
      }
      if (service === "industryManager" && method === "GetJobCounts") {
        return { service, method, result: dict([[ACTIVITY_MANUFACTURING, 1]]), notifications: [] };
      }
      if (service === "facilityManager" && method === "GetFacilities") {
        return { service, method, result: list([facilityRow()]), notifications: [] };
      }
      if (service === "facilityManager" && method === "GetMaxActivityModifiers") {
        return { service, method, result: dict([[ACTIVITY_MANUFACTURING, 1.0]]), notifications: [] };
      }
      return { service, method, result: null, notifications: [] };
    },
    async bindObject() {
      throw new Error("industry needs no bound objects");
    },
    async callBoundMethod() {
      throw new Error("industry needs no bound objects");
    },
  };
}

function isFinishedRow(row) {
  const entries = row.args.entries;
  const status = (entries.find(([key]) => key === "status") || [])[1];
  return Number(status) >= 100;
}

/** Read one key off a util.KeyVal row (the tests assert on raw results too). */
function readKeyVal(row, key) {
  const entry = (row.args.entries || []).find((candidate) => candidate[0] === key);
  return entry ? entry[1] : undefined;
}

async function startTestServer(options = {}) {
  const app = createApp({
    eveStore: options.store || fakeStore(),
    eveGatewayClient: options.gateway,
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
  headers.cookie = `evejs_web_poc=${COOKIE_TOKEN}`;
  const response = await ORIGINAL_FETCH(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { response, payload: await response.json() };
}

async function selectOnServer(baseUrl) {
  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: CHARACTER_ID },
  });
}

test.afterEach(async () => {
  global.fetch = ORIGINAL_FETCH;
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    );
  }
  await Promise.all(closing);
});

// --- the read route ---------------------------------------------------------

test("GET /api/bridge/industry issues the five top-level reads and NO bind", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  // Every industry call is TOP-LEVEL. If a bind ever appears here the fake
  // throws, so this is enforced rather than merely asserted.
  const issued = gateway.calls.topLevel.map((call) => `${call.service}.${call.method}`);
  for (const pair of [
    "blueprintManager.GetBlueprintDataByOwner",
    "industryManager.GetJobsByOwner",
    "industryManager.GetJobCounts",
    "facilityManager.GetFacilities",
    "facilityManager.GetMaxActivityModifiers",
  ]) {
    assert.ok(issued.includes(pair), `expected ${pair} to be issued`);
  }
  // Each read rides the SAME held bridge session.
  for (const call of gateway.calls.topLevel) {
    assert.equal(call.bridgeSessionID, BRIDGE_SESSION_ID);
  }
});

test("the reads are scoped to the HELD session's own character, not a browser-supplied id", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  await apiRequest(baseUrl, "/api/bridge/industry");

  const owned = gateway.calls.topLevel.filter((call) =>
    ["GetBlueprintDataByOwner", "GetJobsByOwner", "GetJobCounts"].includes(call.method),
  );
  assert.equal(owned.length, 3);
  for (const call of owned) {
    assert.equal(
      call.args[0],
      CHARACTER_ID,
      `${call.method} must be scoped to the held character`,
    );
  }
  // The facility read is region-scoped off the SESSION and takes no arguments,
  // so it cannot be pointed at another region either.
  const facilities = gateway.calls.topLevel.find((call) => call.method === "GetFacilities");
  assert.deepEqual(facilities.args, []);
});

test("jobs are read with includeCompleted=true so finished work is shown too", async () => {
  const gateway = fakeGateway({
    jobs: [jobRow(), jobRow({ jobID: JOB_ID + 1, status: STATUS_DELIVERED, successfulRuns: 3 })],
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/bridge/industry");

  const jobsCall = gateway.calls.topLevel.find((call) => call.method === "GetJobsByOwner");
  assert.equal(jobsCall.args[1], true, "includeCompleted must be true");
  assert.equal(payload.jobs.result.items.length, 2);
});

test("the blueprint read answers a 2-TUPLE, and the route passes it through intact", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload } = await apiRequest(baseUrl, "/api/bridge/industry");

  // ⚠ The shape is [list<instance>, dict<facilityID -> count>]. A route that
  // "helpfully" unwrapped it to the list alone would lose the counts and break
  // the decoder's own tuple handling.
  const result = payload.blueprints.result;
  assert.ok(Array.isArray(result), "GetBlueprintDataByOwner answers an array");
  assert.equal(result.length, 2);
  assert.equal(result[0].type, "list");
  assert.equal(result[1].type, "dict");

  // Material and time efficiency are DISTINCT fields; the fixture makes them
  // differ so a transposition fails here.
  const row = result[0].items[0];
  assert.equal(readKeyVal(row, "materialEfficiency"), 10);
  assert.equal(readKeyVal(row, "timeEfficiency"), 20);
  assert.equal(readKeyVal(row, "runs"), 40);
});

test("a failed facility read never blanks the blueprints or the jobs", async () => {
  const gateway = fakeGateway({ failures: ["facilityManager.GetFacilities"] });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry");
  // The ROUTE still succeeds: the five reads are independent.
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.facilities.error, "CALL_FAILED");
  assert.equal(payload.facilities.result, null);
  // ...and the rest came through untouched.
  assert.equal(payload.blueprints.error, null);
  assert.ok(Array.isArray(payload.blueprints.result));
  assert.equal(payload.jobs.error, null);
  assert.equal(payload.jobs.result.items.length, 1);
});

test("a failed blueprint read never blanks the jobs or the facilities", async () => {
  const gateway = fakeGateway({ failures: ["blueprintManager.GetBlueprintDataByOwner"] });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, "/api/bridge/industry");
  assert.equal(payload.blueprints.error, "CALL_FAILED");
  assert.equal(payload.jobs.error, null);
  assert.equal(payload.facilities.error, null);
  assert.equal(payload.facilities.result.items.length, 1);
});

test("the industry read requires a live session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No select: nothing is held.
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry");
  assert.equal(response.status, 409);
  assert.equal(payload.error, "NO_LIVE_SESSION");
  assert.equal(gateway.calls.topLevel.length, 0, "no call may reach the gateway");
});

// --- the static recipe route ------------------------------------------------

test("POST /api/industry/blueprints answers recipes from STATIC data, with no gateway call", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // Deliberately NO select — static reference data does not need a live
  // session, which is what keeps the panel's recipes available after one drops.
  const { response, payload } = await apiRequest(baseUrl, "/api/industry/blueprints", {
    method: "POST",
    body: { blueprintTypeIDs: [BLUEPRINT_TYPE_ID] },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "static-data");
  assert.equal(gateway.calls.topLevel.length, 0, "recipes never touch the gateway");

  const definition = payload.definitions[String(BLUEPRINT_TYPE_ID)];
  assert.equal(definition.blueprintName, "Clone Grade Beta Blueprint");
  assert.equal(definition.productName, "Clone Grade Beta");
  assert.equal(definition.activities.manufacturing.time, 600);
  assert.deepEqual(definition.activities.manufacturing.materials, [
    { typeID: MATERIAL_TYPE_ID, quantity: 86 },
  ]);
  // A blueprint's copying activity has a time but no materials — the shape
  // varies per activity and the route must not normalize that away.
  assert.equal(definition.activities.copying.time, 480);
  assert.equal(definition.activities.copying.materials, undefined);
});

test("an unknown blueprint type is echoed as an explicit null, not omitted", async () => {
  const { baseUrl } = await startTestServer({ gateway: fakeGateway() });
  const { payload } = await apiRequest(baseUrl, "/api/industry/blueprints", {
    method: "POST",
    body: { blueprintTypeIDs: [BLUEPRINT_TYPE_ID, 999_999] },
  });
  // Echoing the miss lets the client cache it and never ask again.
  assert.ok("999999" in payload.definitions);
  assert.equal(payload.definitions["999999"], null);
  assert.notEqual(payload.definitions[String(BLUEPRINT_TYPE_ID)], null);
});

test("the recipe route dedupes and caps its input", async () => {
  const { baseUrl } = await startTestServer({ gateway: fakeGateway() });
  const { payload } = await apiRequest(baseUrl, "/api/industry/blueprints", {
    method: "POST",
    body: { blueprintTypeIDs: [BLUEPRINT_TYPE_ID, BLUEPRINT_TYPE_ID, 0, -3, BLUEPRINT_TYPE_ID] },
  });
  assert.equal(payload.count, 1, "duplicates and non-positive ids are dropped");
  assert.equal(payload.capped, false);

  const oversized = [];
  for (let index = 1; index <= payload.limit + 25; index += 1) {
    oversized.push(index);
  }
  const { payload: cappedPayload } = await apiRequest(baseUrl, "/api/industry/blueprints", {
    method: "POST",
    body: { blueprintTypeIDs: oversized },
  });
  assert.equal(cappedPayload.capped, true);
  assert.equal(cappedPayload.count, cappedPayload.limit);
});
