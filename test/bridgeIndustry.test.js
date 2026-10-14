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
// Invention from the same blueprint: a datacore per attempt and a decryptor.
const DATACORE_TYPE_ID = 20418;
const INVENTED_TYPE_ID = 1900;
const DECRYPTOR_TYPE_ID = 34204;
const TYPES = {
  [DATACORE_TYPE_ID]: { typeID: DATACORE_TYPE_ID, groupID: 333, categoryID: 17 },
  [INVENTED_TYPE_ID]: { typeID: INVENTED_TYPE_ID, groupID: 176, categoryID: 9 },
  [DECRYPTOR_TYPE_ID]: { typeID: DECRYPTOR_TYPE_ID, groupID: 1304, categoryID: 35 },
};

// Activity + status codes. These appear in FIXTURES (the server's own view) and
// nowhere else — the decoded panel state speaks in names.
const ACTIVITY_MANUFACTURING = 1;
const ACTIVITY_COPYING = 5;
const STATUS_INSTALLED = 1;
const STATUS_DELIVERED = 101;
const STATUS_CANCELLED = 102;
const MONITOR_ID = 90001;

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
          invention: {
            materials: [{ typeID: DATACORE_TYPE_ID, quantity: 2 }],
            products: [{ typeID: INVENTED_TYPE_ID, quantity: 10 }],
            time: 7800,
          },
        },
      };
    },
    getType(typeID) {
      return TYPES[Number(typeID)] || null;
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

/**
 * An industry.Location as facilityManager.GetFacilityLocations really answers
 * it: an objectex1 whose FIELDS live in header[2], with an EMPTY top-level
 * dict. A decoder that reads `value.dict` finds nothing.
 */
function locationObject(overrides = {}) {
  const fields = {
    itemID: STATION_ID,
    typeID: 52678,
    ownerID: CHARACTER_ID,
    flagID: 4,
    solarSystemID: SOLAR_SYSTEM_ID,
    canView: true,
    canTake: true,
    ...overrides,
  };
  return {
    type: "objectex1",
    header: [
      { type: "token", value: "industry.Location" },
      [],
      { type: "dict", entries: Object.entries(fields) },
    ],
    list: [],
    dict: [],
  };
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
    // A test may send the pilot to the game port, where another stand-in answers for it.
    ...(options.gamePortPilots ? { gamePortPilots: options.gamePortPilots, pilotTransportFor: () => "gameport" } : {}),
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

// --- Slice B: install / deliver / cancel ------------------------------------
//
// Installing SPENDS things - materials out of a hangar and ISK out of the
// wallet - so the route is fenced twice: it refuses outright without an
// explicit confirmation flag, and the UI puts a two-step confirm in front of
// that. Cancelling is fenced the same way, because it refunds NOTHING.
//
// And the R12/R14 lesson: a 200 is not proof. Every mutating route RE-READS the
// job and reports what actually applied. The gateway fake below therefore holds
// a real little job world and mutates it, so a re-read sees the real
// consequence of its own call.

/** A gateway fake with a mutable job world, for the mutating routes. */
function fakeIndustryGateway(options = {}) {
  const calls = { topLevel: [], bound: [] };
  const jobs = new Map();
  let nextJobID = JOB_ID;
  const installAnswersNull = options.installAnswersNull === true;
  const deliverDoesNothing = options.deliverDoesNothing === true;
  const failures = new Set(options.failures || []);
  // Where the facility's places are: the pilot's own solar system, unless a test says another. Or it has none.
  const placesIn = options.placesIn ? { solarSystemID: options.placesIn } : {};
  const noPlaces = options.noPlaces === true;

  function jobRowFor(job) {
    return jobRow({
      jobID: job.jobID,
      status: job.status,
      runs: job.runs,
      activityID: job.activityID,
      facilityID: job.facilityID,
      cost: job.cost,
      successfulRuns: job.successfulRuns || 0,
    });
  }

  return {
    calls,
    jobs,
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
        // The refusal shape the real gateway client raises: a typed code AND
        // the HTTP status it arrived with, which the BFF re-uses.
        throw Object.assign(new Error("IndustryValidationError: MISSING_MATERIAL"), {
          code: "CALL_REFUSED",
          statusCode: 409,
        });
      }
      if (service === "facilityManager" && method === "GetFacilityLocations") {
        return { service, method, result: list(noPlaces ? [] : [locationObject(placesIn), locationObject({ flagID: 62, canTake: false, ...placesIn })]), notifications: [] };
      }
      if (service === "industryMonitor" && method === "ConnectJob") {
        return {
          service,
          method,
          result: [MONITOR_ID, dict([[MATERIAL_TYPE_ID, 500]])],
          notifications: [],
        };
      }
      if (service === "industryMonitor" && method === "DisconnectJob") {
        // (A test may make the letting go slow, or make it fail.)
        if (options.onRelease) await options.onRelease();
        return { service, method, result: null, notifications: [] };
      }
      if (service === "industryManager" && method === "InstallJob") {
        if (installAnswersNull) {
          // The SILENT decline: 200, a null jobID, nothing started.
          return { service, method, result: null, notifications: [] };
        }
        const request = args[0] || {};
        nextJobID += 1;
        jobs.set(nextJobID, {
          jobID: nextJobID,
          status: STATUS_INSTALLED,
          runs: Number(request.runs) || 0,
          activityID: Number(request.activityID) || 0,
          facilityID: Number(request.facilityID) || 0,
          // The SERVER's cost, not the client's advisory zero.
          cost: 1250,
        });
        return { service, method, result: nextJobID, notifications: [] };
      }
      if (service === "industryManager" && method === "CompleteJob") {
        const job = jobs.get(Number(args[0]));
        if (job && !deliverDoesNothing) {
          job.status = STATUS_DELIVERED;
          job.successfulRuns = job.runs;
        }
        return { service, method, result: null, notifications: [] };
      }
      if (service === "industryManager" && method === "CancelJob") {
        const job = jobs.get(Number(args[0]));
        if (job) {
          job.status = STATUS_CANCELLED;
          job.successfulRuns = 0;
        }
        return { service, method, result: null, notifications: [] };
      }
      if (service === "industryManager" && method === "GetJob") {
        const job = jobs.get(Number(args[0]));
        return { service, method, result: job ? jobRowFor(job) : jobRow({ jobID: 0 }), notifications: [] };
      }
      if (service === "blueprintManager" && method === "GetBlueprintData") {
        // After an install the blueprint is locked into the job.
        const busy = [...jobs.values()].find((job) => job.status === STATUS_INSTALLED);
        return {
          service,
          method,
          result: blueprintRow(busy ? { jobID: busy.jobID } : {}),
          notifications: [],
        };
      }
      if (service === "industryManager" && method === "GetJobsByOwner") {
        return { service, method, result: list([...jobs.values()].map(jobRowFor)), notifications: [] };
      }
      if (service === "blueprintManager" && method === "GetBlueprintDataByOwner") {
        return { service, method, result: [list([blueprintRow()]), dict([])], notifications: [] };
      }
      if (service === "industryManager" && method === "GetJobCounts") {
        return { service, method, result: dict([]), notifications: [] };
      }
      if (service === "facilityManager" && method === "GetFacilities") {
        return { service, method, result: list([options.facility || facilityRow()]), notifications: [] };
      }
      return { service, method, result: null, notifications: [] };
    },
    // The dogma location alone: a manufacturing job's time wants the pilot's own attribute of it.
    async bindObject(service, method) {
      if (service !== "dogmaIM") throw new Error("industry binds the dogma location and nothing else");
      return { boundHandle: "dogma-handle", service, method, notifications: [] };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) {
      calls.bound.push({ service, method, args, kwargs, boundHandle });
      if (service !== "dogmaIM" || method !== "QueryAttributeValue") throw new Error(`industry asks nothing else of a bound object: ${service}.${method}`);
      if (options.attributeRefused) throw Object.assign(new Error("Not now."), { code: "CALL_REFUSED", statusCode: 409 });
      return { service, method, result: options.timeMultiplier === undefined ? 1 : options.timeMultiplier, notifications: [] };
    },
    // The pilot's skills, as the gateway's own sheet lists them.
    async getSkills() {
      if (options.skillsRefused) throw Object.assign(new Error("Not now."), { code: "CALL_REFUSED", statusCode: 409 });
      return options.sheet || { skills: options.skills || [] };
    },
  };
}

/** A valid install request the way the browser sends it: activity by NAME. */
function installBody(overrides = {}) {
  return {
    blueprintItemID: BLUEPRINT_ITEM_ID,
    blueprintTypeID: BLUEPRINT_TYPE_ID,
    activity: "manufacturing",
    facilityID: STATION_ID,
    runs: 3,
    confirm: true,
    ...overrides,
  };
}

test("install REFUSES without an explicit confirmation, and nothing reaches the gateway", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody({ confirm: false }),
  });
  assert.equal(response.status, 400);
  assert.equal(payload.error, "CONFIRMATION_REQUIRED");
  assert.match(payload.message, /materials/i, "the refusal must say what would be spent");
  assert.equal(
    gateway.calls.topLevel.some((call) => call.method === "InstallJob"),
    false,
    "an unconfirmed install must never reach InstallJob",
  );
  assert.equal(gateway.jobs.size, 0, "and must not start a job");
});

test("install sends ONE POSITIONAL DICT with the fields the server actually reads", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });

  const install = gateway.calls.topLevel.find((call) => call.method === "InstallJob");
  assert.ok(install, "InstallJob must be called");
  assert.equal(install.args.length, 1, "InstallJob takes exactly ONE positional argument");
  assert.equal(install.kwargs, null, "...and no kwargs");

  const payload = install.args[0];
  assert.equal(typeof payload, "object");
  assert.equal(Array.isArray(payload), false, "the argument is a DICT, not a list");

  // The fields that decide the outcome.
  assert.equal(payload.blueprintID, BLUEPRINT_ITEM_ID);
  assert.equal(payload.activityID, ACTIVITY_MANUFACTURING, "the browser named the activity; the BFF maps it");
  assert.equal(payload.facilityID, STATION_ID);
  assert.equal(payload.runs, 3);
  // The runs a copy would be licensed for go with any job, as the client's job has them: the most the blueprint
  // allows (industrySvc._ApplyJobSettings, 357), which only a copy job's window gives the pilot a way to change.
  assert.equal(payload.licensedRuns, 300);
  // Scoped to the HELD session, never to a browser-supplied identity.
  assert.equal(payload.characterID, CHARACTER_ID);
  assert.equal(payload.solarSystemID, SOLAR_SYSTEM_ID);

  // The full retail shape is sent, including the advisory fields the server
  // recomputes anyway - a partial dict is a worse contract than a complete one.
  for (const key of [
    "blueprintTypeID",
    "corporationID",
    "account",
    "cost",
    "tax",
    "time",
    "materials",
    "inputLocation",
    "outputLocation",
    "productTypeID",
  ]) {
    assert.ok(key in payload, `the payload must carry ${key}`);
  }
  // The client's dump has seventeen names (industry/job.py 624 to 640). These are they, and nothing else is sent:
  // the server reads no other from a request.
  assert.deepEqual(Object.keys(payload).sort(), [
    "account", "activityID", "blueprintID", "blueprintTypeID", "characterID", "corporationID", "cost", "facilityID", "inputLocation",
    "licensedRuns", "materials", "outputLocation", "productTypeID", "runs", "solarSystemID", "tax", "time",
  ]);
  // The job's corporation is the session's (industryCommon.AttachSessionToJob), and it is paid for from the
  // character's own cash (industrySvc._UpdateAccounts: (session.charid, accountingKeyCash), the key 1000).
  assert.equal(payload.corporationID, 98000000);
  assert.deepEqual(payload.account, [CHARACTER_ID, 1000]);
});

// The tests of the preview route (POST /api/bridge/industry/preview) and of the window's events route (.../window)
// went on 2026-10-14, the Industry window's job, its reckoning, its monitor and its letting go being the page's own
// (web/src/app/flow.ts, previewIndustryJob and industryWindowClosed; web/src/bridge/industryJobReckoning.ts and
// industryMonitor.ts). With them went what each held of the install route's request too: a job's time, materials,
// cost, tax and fee of every kind of work as the client reckons them (the arithmetic's own tests are
// test/industryJob*.test.js), its product, its solar system, its facility, and the monitor kept, let go and answered.
// The install route goes in its turn (the Industry window's third making).


// --- a job's time, by the client's own reckoning ------------------------------
//
// industry/job.py 460 to 468: the activity's time for the runs, through each time modifier the job has (each
// required skill's time per level, the pilot's own manufacturing time attribute, the blueprint's time research,
// the facility's time modifiers for the product), rounded to the whole second (web/src/bridge/industryReckonings.mjs). The
// server holds a time that is not nought against its own, to the second.

const sentJobs = (gateway, method) => gateway.calls.topLevel.filter((call) => call.method === method).map((call) => call.args[0]);



test("a blueprint's material research is a whole number from nought to ten, or the request is refused before anything is asked", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const materialEfficiency of [-1, 11, 2.5, "ten", "5", true]) {
    for (const route of ["install"]) {
      const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: installBody({ materialEfficiency }) });
      assert.deepEqual([response.status, payload.error], [400, "INVALID_MATERIAL_EFFICIENCY"], `${route} ${materialEfficiency}`);
    }
  }
  assert.deepEqual([gateway.calls.topLevel.length, gateway.calls.bound.length], [0, 0]);
});











test("a blueprint's time research is a whole number from nought to twenty, or the request is refused before anything is asked", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const timeEfficiency of [-1, 21, 2.5, "five", "5", true]) {
    for (const route of ["install"]) {
      const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: installBody({ timeEfficiency }) });
      assert.deepEqual([response.status, payload.error], [400, "INVALID_TIME_EFFICIENCY"], `${route} ${timeEfficiency}`);
    }
  }
  assert.deepEqual([gateway.calls.topLevel.length, gateway.calls.bound.length], [0, 0]);
});

test("install resolves the input hangar from GetFacilityLocations, preferring one it may TAKE from", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });

  const locations = gateway.calls.topLevel.find((call) => call.method === "GetFacilityLocations");
  assert.ok(locations, "the hangar choices must be read first");
  assert.deepEqual(locations.args, [STATION_ID, CHARACTER_ID]);

  const payload = gateway.calls.topLevel.find((call) => call.method === "InstallJob").args[0];
  // The fixture offers a takeable hangar (flag 4) and a non-takeable one
  // (flag 62). Materials can only come from the one it may take from.
  assert.equal(payload.inputLocation.flagID, 4);
  assert.equal(payload.inputLocation.canTake, true);
});

test("install RE-READS the job and the blueprint - a 200 is not the proof", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.applied, true);
  assert.equal(payload.declinedSilently, false);
  assert.ok(payload.jobID > 0);

  // Both re-reads happened, and both are returned.
  assert.ok(gateway.calls.topLevel.some((call) => call.method === "GetJob"));
  assert.ok(gateway.calls.topLevel.some((call) => call.method === "GetBlueprintData"));
  assert.notEqual(payload.job, null);
  assert.notEqual(payload.blueprint, null);

  // The job carries the cost the SERVER charged, not the advisory zero sent.
  assert.equal(readKeyVal(payload.job, "cost"), 1250);
  // ...and the blueprint is now locked into that job.
  assert.equal(readKeyVal(payload.blueprint, "jobID"), payload.jobID);
});

test("a SILENT install decline is reported as a decline, not as success", async () => {
  const gateway = fakeIndustryGateway({ installAnswersNull: true });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });
  // The handler answered WITHOUT raising and without starting anything.
  assert.equal(response.status, 200);
  assert.equal(payload.applied, false);
  assert.equal(payload.declinedSilently, true);
  assert.equal(payload.jobID, null);
  assert.equal(payload.job, null);
  // No re-read is issued for a job that was never created.
  assert.equal(gateway.calls.topLevel.some((call) => call.method === "GetJob"), false);
});

test("a THROWN install refusal passes the server's own reasons through", async () => {
  const gateway = fakeIndustryGateway({ failures: ["industryManager.InstallJob"] });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });
  assert.equal(response.status, 409);
  assert.equal(payload.error, "CALL_REFUSED");
  // The SERVER's own error names, unreworded by the BFF.
  assert.match(String(payload.message), /MISSING_MATERIAL/);
});

test("install validates its request before spending anything", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const cases = [
    [{ blueprintItemID: 0 }, "INVALID_BLUEPRINT"],
    [{ activity: "smelting" }, "INVALID_ACTIVITY"],
    [{ facilityID: 0 }, "INVALID_FACILITY"],
    [{ runs: 0 }, "INVALID_RUNS"],
    [{ runs: -5 }, "INVALID_RUNS"],
    [{ runs: 99_999_999 }, "INVALID_RUNS"],
  ];
  for (const [overrides, expected] of cases) {
    const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
      method: "POST",
      body: installBody(overrides),
    });
    assert.equal(response.status, 400, JSON.stringify(overrides));
    assert.equal(payload.error, expected, JSON.stringify(overrides));
  }
  assert.equal(gateway.jobs.size, 0, "no invalid request may start a job");
});




test("deliver calls CompleteJob(jobID, solarSystemID) and judges by the RE-READ", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload: installed } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/deliver", {
    method: "POST",
    body: { jobID: installed.jobID },
  });
  assert.equal(response.status, 200);
  assert.equal(payload.applied, true);
  assert.equal(payload.declinedSilently, false);

  const deliver = gateway.calls.topLevel.find((call) => call.method === "CompleteJob");
  // The solar system comes from the HELD session's live position.
  assert.deepEqual(deliver.args, [installed.jobID, SOLAR_SYSTEM_ID]);
  assert.equal(readKeyVal(payload.job, "status"), STATUS_DELIVERED);
});

test("a deliver that changes nothing is reported as a silent decline", async () => {
  const gateway = fakeIndustryGateway({ deliverDoesNothing: true });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload: installed } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/deliver", {
    method: "POST",
    body: { jobID: installed.jobID },
  });
  // 200 with the job STILL running: the re-read is what catches this, and it
  // is reported honestly rather than as a success.
  assert.equal(response.status, 200);
  assert.equal(payload.applied, false);
  assert.equal(payload.declinedSilently, true);
  assert.equal(readKeyVal(payload.job, "status"), STATUS_INSTALLED);
});

test("cancel REFUSES without an explicit confirmation, and says what will be lost", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload: installed } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/cancel", {
    method: "POST",
    body: { jobID: installed.jobID },
  });
  assert.equal(response.status, 400);
  assert.equal(payload.error, "CONFIRMATION_REQUIRED");
  // Cancelling refunds NEITHER the materials NOR the fee, and the refusal has
  // to say so - that is the whole reason it is gated.
  assert.match(payload.message, /materials/i);
  assert.match(payload.message, /fee/i);
  assert.equal(gateway.calls.topLevel.some((call) => call.method === "CancelJob"), false);
});

test("a confirmed cancel stops the job, and the RE-READ is what proves it", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { payload: installed } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody(),
  });

  const { payload } = await apiRequest(baseUrl, "/api/bridge/industry/cancel", {
    method: "POST",
    body: { jobID: installed.jobID, confirm: true },
  });
  assert.equal(payload.applied, true);
  const cancel = gateway.calls.topLevel.find((call) => call.method === "CancelJob");
  assert.deepEqual(cancel.args, [installed.jobID, SOLAR_SYSTEM_ID]);
  assert.equal(readKeyVal(payload.job, "status"), STATUS_CANCELLED);
});

test("every mutating industry route requires a live session", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // No select.
  for (const [path, body] of [
    ["/api/bridge/industry/install", installBody()],
    ["/api/bridge/industry/deliver", { jobID: 1 }],
    ["/api/bridge/industry/cancel", { jobID: 1, confirm: true }],
  ]) {
    const { response, payload } = await apiRequest(baseUrl, path, { method: "POST", body });
    assert.equal(response.status, 409, path);
    assert.equal(payload.error, "NO_LIVE_SESSION", path);
  }
  assert.equal(gateway.calls.topLevel.length, 0, "no call may reach the gateway");
});

test("deliver and cancel reject a missing job before calling anything", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const path of ["/api/bridge/industry/deliver", "/api/bridge/industry/cancel"]) {
    const { response, payload } = await apiRequest(baseUrl, path, {
      method: "POST",
      body: { jobID: 0, confirm: true },
    });
    assert.equal(response.status, 400, path);
    assert.equal(payload.error, "INVALID_JOB", path);
  }
  assert.equal(gateway.calls.topLevel.length, 0);
});

// --- invention with a decryptor ---------------------------------------------
//
// The server takes a decryptor from the request's materials only, and then
// compares that map EXACTLY with its own (web/src/bridge/industryReckonings.mjs). Every other
// install keeps sending an empty map, which the server recomputes.

test("an invention with a decryptor sends the exact materials map and names the decryptor", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response } = await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody({ activity: "invention", runs: 3, decryptorTypeID: DECRYPTOR_TYPE_ID }),
  });
  assert.equal(response.status, 200);
  const install = gateway.calls.topLevel.find((call) => call.method === "InstallJob");
  assert.ok(install);
  const payload = install.args[0];
  assert.equal(payload.activityID, 8);
  assert.deepEqual(payload.materials, { [DATACORE_TYPE_ID]: 6, [DECRYPTOR_TYPE_ID]: 3 });
  assert.equal("optionalTypeID" in payload, false, "the client's dump names no decryptor: the server takes it from the materials");
  // No product is named where the recipe has the one: the client's job has none until one is chosen (industry/job.py
  // 367 and 640), and the server finds the only one itself.
  assert.equal(payload.productTypeID, null);
  // The job's time goes with it: the activity's 7800 s by the three runs, the pilot's own time being 1.
  assert.equal(payload.time, 23400);
  // The facility's modifiers are read for it, the way the retail client does.
  assert.ok(gateway.calls.topLevel.some((call) => call.method === "GetFacilities"));
});

test("without a decryptor an invention's materials have the empty place of one, as the client's job has it, and the facility is read for them", async () => {
  // industryCommon.GetDecryptors (458 to 482) and industry/job.py 637: the optional material is one of the job's
  // materials whether a decryptor is in it or not, and the dump has it under None, at the job's runs.
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody({ activity: "invention", runs: 3 }),
  });
  const install = gateway.calls.topLevel.find((call) => call.method === "InstallJob");
  assert.deepEqual(install.args[0].materials, { [DATACORE_TYPE_ID]: 6, None: 3 });
  assert.equal("optionalTypeID" in install.args[0], false);
  assert.equal(gateway.calls.topLevel.some((call) => call.method === "GetFacilities"), true);
});

test("a decryptor is refused on anything but invention, and anything but a decryptor is refused as one", async () => {
  for (const body of [
    installBody({ activity: "manufacturing", decryptorTypeID: DECRYPTOR_TYPE_ID }),
    installBody({ activity: "invention", decryptorTypeID: DATACORE_TYPE_ID }),
    installBody({ activity: "invention", decryptorTypeID: 999999 }),
    installBody({ activity: "invention", decryptorTypeID: "parity" }),
  ]) {
    const gateway = fakeIndustryGateway();
    const { baseUrl } = await startTestServer({ gateway });
    await selectOnServer(baseUrl);
    const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(payload.error, "INVALID_DECRYPTOR");
    assert.equal(gateway.calls.topLevel.some((call) => call.method === "InstallJob"), false);
  }
});

// --- a copy job, by the client's own reckoning ---------------------------------
//
// industry/activities/copying.py, 12 to 19, and what a job has of every kind of work (web/src/bridge/industryReckonings.mjs: the
// copy job's time, its most runs, its materials, its cost, its tax and its fee; test/industryJobCopy.test.js has
// each against the client's own Python's answers).

/** The game's data with a blueprint's copying said as a test wants it. */
function staticDataCopying(copying) {
  const plain = fakeStaticData();
  return {
    ...plain,
    getIndustryBlueprint(blueprintTypeID) {
      const definition = plain.getIndustryBlueprint(blueprintTypeID);
      if (definition) definition.activities.copying = copying;
      return definition;
    },
    // (A skill that takes 1% off a job's time a level: it is of a manufacturing job's time alone.)
    getTypeDogmaAttribute: (typeID, attributeID) => (Number(typeID) === 11452 && Number(attributeID) === 1982 ? -1 : null),
  };
}

/** A copy job's request, as the page sends it. */
const copyBody = (overrides = {}) => installBody({ activity: "copying", ...overrides });


test("a copy job of more copies than the client's job can have is refused before the job is sent, where that most could be reckoned", async () => {
  // industry/job.py 395 and activity.py 34 to 36: the client's job holds its runs to the most it can have. A
  // blueprint whose copy takes 96000 s, and a pilot whose copy speed is 0.75: 2592000 / 96000 / 0.75 = 36.
  const gateway = fakeIndustryGateway({ timeMultiplier: 0.75 });
  const { baseUrl } = await startTestServer({ gateway, staticData: staticDataCopying({ time: 96000 }) });
  await selectOnServer(baseUrl);
  for (const route of ["install"]) {
    const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: copyBody({ runs: 37, licensedRuns: 1 }) });
    assert.deepEqual([response.status, payload.error], [400, "INVALID_RUNS"], route);
    assert.match(payload.message, /at most 36 copies/);
  }
  assert.deepEqual([sentJobs(gateway, "ConnectJob").length, sentJobs(gateway, "InstallJob").length], [0, 0]);
  // Thirty-six go, however many runs each is licensed for.
  const most = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: copyBody({ runs: 36, licensedRuns: 300 }) });
  assert.deepEqual([most.response.status, sentJobs(gateway, "InstallJob").map((job) => [job.runs, job.licensedRuns])], [200, [[36, 300]]]);

  // Never more than five hundred, however short the copy: the blueprint of the fixture, at 480 s.
  const short = fakeIndustryGateway({ timeMultiplier: 0.75 });
  const second = await startTestServer({ gateway: short });
  await selectOnServer(second.baseUrl);
  const over = await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: copyBody({ runs: 501, licensedRuns: 1 }) });
  assert.deepEqual([over.response.status, over.payload.error, sentJobs(short, "InstallJob").length], [400, "INVALID_RUNS", 0]);
  assert.match(over.payload.message, /at most 500 copies/);
  await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: copyBody({ runs: 500, licensedRuns: 1 }) });
  assert.deepEqual(sentJobs(short, "InstallJob").map((job) => job.runs), [500]);
  // A manufacturing job's runs are not held to a copy job's most.
  await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ runs: 501, timeEfficiency: 0 }) });
  assert.deepEqual(sentJobs(short, "InstallJob").map((job) => job.runs), [500, 501]);

  // Where the most could not be reckoned (the pilot's copy speed could not be asked), the job is the server's to judge.
  const unasked = fakeIndustryGateway({ attributeRefused: true });
  const third = await startTestServer({ gateway: unasked });
  await selectOnServer(third.baseUrl);
  const sent = await apiRequest(third.baseUrl, "/api/bridge/industry/install", { method: "POST", body: copyBody({ runs: 501, licensedRuns: 1 }) });
  assert.deepEqual([sent.response.status, sentJobs(unasked, "InstallJob").map((job) => [job.runs, job.time])], [200, [[501, 0]]]);
});

test("the runs each copy is licensed for are a whole number from one to the most the blueprint allows, or the request is refused before anything is asked; any other job's are that most", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const licensedRuns of [0, -1, 301, 2.5, "10", true]) {
    for (const route of ["install"]) {
      const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: copyBody({ licensedRuns }) });
      assert.deepEqual([response.status, payload.error], [400, "INVALID_LICENSED_RUNS"], `${route} ${licensedRuns}`);
      assert.match(payload.message, /from 1 to 300/);
    }
  }
  assert.deepEqual([gateway.calls.topLevel.length, gateway.calls.bound.length], [0, 0]);

  const licensed = async (body, base = baseUrl, through = gateway) => {
    const { response } = await apiRequest(base, "/api/bridge/industry/install", { method: "POST", body });
    return [response.status, response.status === 200 ? sentJobs(through, "InstallJob").at(-1).licensedRuns : null];
  };
  // One and the most go as they were said; nothing said, or null, is the most.
  assert.deepEqual([await licensed(copyBody({ licensedRuns: 1 })), await licensed(copyBody({ licensedRuns: 300 })), await licensed(copyBody()), await licensed(copyBody({ licensedRuns: null }))],
    [[200, 1], [200, 300], [200, 300], [200, 300]]);
  // Any other kind of work: the most, whatever is said of them, and whatever is said is not refused.
  assert.deepEqual([await licensed(installBody({ licensedRuns: 7 })), await licensed(installBody({ licensedRuns: "seven" })), await licensed(installBody({ activity: "invention", licensedRuns: 0 }))],
    [[200, 300], [200, 300], [200, 300]]);

  // A blueprint whose type has no limit: one, and no other.
  const plain = fakeStaticData();
  const unlimited = { ...plain, getIndustryBlueprint: (blueprintTypeID) => { const definition = plain.getIndustryBlueprint(blueprintTypeID); if (definition) definition.maxProductionLimit = null; return definition; } };
  const bare = fakeIndustryGateway();
  const second = await startTestServer({ gateway: bare, staticData: unlimited });
  await selectOnServer(second.baseUrl);
  assert.deepEqual([await licensed(copyBody(), second.baseUrl, bare), await licensed(copyBody({ licensedRuns: 1 }), second.baseUrl, bare), await licensed(copyBody({ licensedRuns: 2 }), second.baseUrl, bare), await licensed(installBody(), second.baseUrl, bare)],
    [[200, 1], [200, 1], [400, null], [200, 1]]);
  // A blueprint the game's data has not: there is no most to hold them to. What is said goes, where it is a
  // whole number above nought, and one where nothing is said.
  const unknown = { blueprintTypeID: 999_999 };
  assert.deepEqual([await licensed(copyBody({ ...unknown, licensedRuns: 7 })), await licensed(copyBody(unknown)), await licensed(installBody(unknown)), await licensed(copyBody({ ...unknown, licensedRuns: 0 }))],
    [[200, 7], [200, 1], [200, 1], [400, null]]);
});


// --- a research job, by the client's own reckoning ----------------------------
//
// industry/activities/research_time.py and research_material.py, which are one but for what they read of the
// blueprint, and what a job has of every kind of work (web/src/bridge/industryReckonings.mjs: where a blueprint stands in a
// research, and the research job's time, its most runs, its materials, its cost, its tax and its fee;
// test/industryJobResearch.test.js has each against the client's own Python's answers).

const RESEARCH_OF_TIME = 3;
const RESEARCH_OF_MATERIALS = 4;

/** The game's data with a blueprint's two researches said as a test wants them: the one recipe for both, unless another is said for its materials'. */
function staticDataResearching(ofTime, ofMaterials = ofTime) {
  const plain = fakeStaticData();
  return {
    ...plain,
    getIndustryBlueprint(blueprintTypeID) {
      const definition = plain.getIndustryBlueprint(blueprintTypeID);
      if (definition) Object.assign(definition.activities, { research_time: { ...ofTime }, research_material: { ...ofMaterials } });
      return definition;
    },
    // (A skill that takes 1% off a job's time a level: it is of a manufacturing job's time alone.)
    getTypeDogmaAttribute: (typeID, attributeID) => (Number(typeID) === 11452 && Number(attributeID) === 1982 ? -1 : null),
  };
}

/** A research job's request, as the page sends it: the work by name, and the blueprint's two researches as it read them. */
const researchBody = (activity, overrides = {}) => installBody({ activity, ...overrides });


test("a research job's runs are held to what is left to the blueprint, and a blueprint at the last level has no job, before anything is asked", async () => {
  // research_time.py 22 to 23 and 33 to 37, and job.py 395: the client's job has no more runs than are left to the
  // blueprint, one at the least, and at the last level it has an error and is not sent.
  const gateway = fakeIndustryGateway({ timeMultiplier: 1 });
  const { baseUrl } = await startTestServer({ gateway, staticData: staticDataResearching({ time: 2100 }) });
  await selectOnServer(baseUrl);
  const answered = async (route, activity, overrides) => {
    const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: researchBody(activity, overrides) });
    return [response.status, payload.error || null, payload.message || null];
  };
  for (const route of ["install"]) {
    // At the last level: twenty of time research, ten of material.
    assert.deepEqual((await answered(route, "research_time", { runs: 1, timeEfficiency: 20, materialEfficiency: 0 })).slice(0, 2), [400, "RESEARCH_LIMIT"], route);
    assert.deepEqual((await answered(route, "research_material", { runs: 1, timeEfficiency: 0, materialEfficiency: 10 })).slice(0, 2), [400, "RESEARCH_LIMIT"], route);
    // More runs than are left: a time research of 16 has two levels left, and a material research of 9 has one.
    const [status, error, message] = await answered(route, "research_time", { runs: 3, timeEfficiency: 16, materialEfficiency: 0 });
    assert.deepEqual([status, error], [400, "INVALID_RUNS"], route);
    assert.match(message, /has 2 levels of that research left/);
    const ofMaterials = await answered(route, "research_material", { runs: 2, timeEfficiency: 0, materialEfficiency: 9 });
    assert.deepEqual(ofMaterials.slice(0, 2), [400, "INVALID_RUNS"], route);
    assert.match(ofMaterials[2], /has 1 level of that research left/);
    // One at the least: a time research of 19 has no whole step left and is not at the last level. Two runs do not
    // go, and one is said to be left.
    const odd = await answered(route, "research_time", { runs: 2, timeEfficiency: 19, materialEfficiency: 0 });
    assert.deepEqual(odd.slice(0, 2), [400, "INVALID_RUNS"], route);
    assert.match(odd[2], /has 1 level of that research left/);
  }
  assert.deepEqual([gateway.calls.topLevel.length, gateway.calls.bound.length], [0, 0]);

  const went = async (activity, overrides) => {
    const [status] = await answered("install", activity, overrides);
    const job = sentJobs(gateway, "InstallJob").at(-1);
    return [status, job.activityID, job.runs];
  };
  // What is left goes, and one run of a time research of 19.
  assert.deepEqual(await went("research_time", { runs: 2, timeEfficiency: 16, materialEfficiency: 0 }), [200, RESEARCH_OF_TIME, 2]);
  assert.deepEqual(await went("research_material", { runs: 1, timeEfficiency: 0, materialEfficiency: 9 }), [200, RESEARCH_OF_MATERIALS, 1]);
  assert.deepEqual(await went("research_time", { runs: 1, timeEfficiency: 19, materialEfficiency: 0 }), [200, RESEARCH_OF_TIME, 1]);
  // Each research is held by its own: a blueprint whose materials are at the most has all ten of its time left,
  // and one whose time is at the most all ten of its materials.
  assert.deepEqual(await went("research_time", { runs: 10, timeEfficiency: 0, materialEfficiency: 10 }), [200, RESEARCH_OF_TIME, 10]);
  assert.deepEqual(await went("research_material", { runs: 10, timeEfficiency: 20, materialEfficiency: 0 }), [200, RESEARCH_OF_MATERIALS, 10]);
  // Nothing said of the research: there is nothing to hold the runs to, and the job is the server's to judge.
  assert.deepEqual(await went("research_time", { runs: 11, materialEfficiency: 0 }), [200, RESEARCH_OF_TIME, 11]);
  // No other kind of work is held to a research's levels.
  assert.deepEqual(await went("manufacturing", { runs: 50, timeEfficiency: 20, materialEfficiency: 10 }), [200, ACTIVITY_MANUFACTURING, 50]);
  assert.deepEqual(await went("copying", { runs: 50, licensedRuns: 1, timeEfficiency: 20, materialEfficiency: 10 }), [200, ACTIVITY_COPYING, 50]);
});

test("a research job of more runs than thirty days hold of its time is refused before the job is sent, where that could be reckoned", async () => {
  // activity.py 34 to 36: thirty days over the activity's time over the time modifiers together, taken up. A
  // research whose first level takes 420000 s, and a pilot whose own time for it is 1: 2592000 / 420000 = 6.17..., so
  // seven runs, of the ten that are left to the blueprint.
  const gateway = fakeIndustryGateway({ timeMultiplier: 1 });
  const { baseUrl } = await startTestServer({ gateway, staticData: staticDataResearching({ time: 420000 }) });
  await selectOnServer(baseUrl);
  for (const route of ["install"]) {
    const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: researchBody("research_time", { runs: 8, timeEfficiency: 0 }) });
    assert.deepEqual([response.status, payload.error], [400, "INVALID_RUNS"], route);
    assert.match(payload.message, /at most 7 runs/);
  }
  assert.deepEqual([sentJobs(gateway, "ConnectJob").length, sentJobs(gateway, "InstallJob").length], [0, 0]);
  const most = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: researchBody("research_material", { runs: 7, materialEfficiency: 0 }) });
  assert.deepEqual([most.response.status, sentJobs(gateway, "InstallJob").map((job) => job.runs)], [200, [7]]);
  // Where it could not be reckoned (the pilot's own time could not be asked), the job is the server's to judge.
  const unasked = fakeIndustryGateway({ attributeRefused: true });
  const second = await startTestServer({ gateway: unasked, staticData: staticDataResearching({ time: 420000 }) });
  await selectOnServer(second.baseUrl);
  const sent = await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: researchBody("research_time", { runs: 8, timeEfficiency: 0 }) });
  assert.deepEqual([sent.response.status, sentJobs(unasked, "InstallJob").map((job) => [job.runs, job.time])], [200, [[8, 0]]]);
});


// --- an invention, by the client's own reckoning ------------------------------
//
// industry/activities/invention.py, and what a job has of every kind of work (web/src/bridge/industryReckonings.mjs: the
// invention's time, its most runs, its materials with the place of its decryptor, its cost, its tax and its fee;
// test/industryJobInvention.test.js has each against the client's own Python's answers).

const ACTIVITY_INVENTION = 8;

/** The game's data with a blueprint's invention said as a test wants it, and what else of it a test wants changed. */
function staticDataInventing(invention, more = {}) {
  const plain = fakeStaticData();
  return {
    ...plain,
    getIndustryBlueprint(blueprintTypeID) {
      const definition = plain.getIndustryBlueprint(blueprintTypeID);
      if (definition) definition.activities.invention = { ...definition.activities.invention, ...invention };
      return definition;
    },
    // (A skill that takes 1% off a job's time a level: it is of a manufacturing job's time alone.)
    getTypeDogmaAttribute: (typeID, attributeID) => (Number(typeID) === 11452 && Number(attributeID) === 1982 ? -1 : null),
    ...more,
  };
}

/** An invention's request, as the page sends it. */
const inventionBody = (overrides = {}) => installBody({ activity: "invention", ...overrides });


test("an invention that has a decryptor is not sent without it: where its materials could not be made, the request fails", async () => {
  // The decryptor is in the job's materials and nowhere else. A facility's row that cannot be read, for a reason
  // that is no refusal: with no decryptor the job goes with an empty map, and with one it does not go.
  const gateway = fakeIndustryGateway();
  const broken = { ...gateway };
  broken.callMethod = async (service, method, ...rest) => {
    if (service === "facilityManager" && method === "GetFacilities") throw new Error("The facilities could not be read.");
    return gateway.callMethod(service, method, ...rest);
  };
  const { baseUrl } = await startTestServer({ gateway: broken });
  await selectOnServer(baseUrl);
  const without = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: inventionBody({ runs: 3 }) });
  assert.deepEqual([without.response.status, sentJobs(gateway, "InstallJob").map((job) => job.materials)], [200, [{}]]);
  const with_ = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: inventionBody({ runs: 3, decryptorTypeID: DECRYPTOR_TYPE_ID }) });
  assert.equal(with_.response.status >= 500, true, String(with_.response.status));
  assert.equal(sentJobs(gateway, "InstallJob").length, 1);
});

test("an invention of a blueprint that makes one of several is refused until one of them is named, before anything is asked", async () => {
  // industry/job.py 181 to 190 and 562: a job whose recipe has several products has none until one is chosen, and
  // the client's job has an error for it, INVALID_PRODUCT, and is not sent.
  const OTHER_INVENTED = INVENTED_TYPE_ID + 1;
  const several = staticDataInventing({ products: [{ typeID: INVENTED_TYPE_ID, quantity: 1 }, { typeID: OTHER_INVENTED, quantity: 1 }] });
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway, staticData: several });
  await selectOnServer(baseUrl);
  for (const route of ["install"]) {
    for (const productTypeID of [undefined, 0, null, PRODUCT_TYPE_ID, "the second"]) {
      const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: inventionBody({ productTypeID }) });
      assert.deepEqual([response.status, payload.error], [400, "INVALID_PRODUCT"], `${route} ${productTypeID}`);
    }
  }
  assert.deepEqual([gateway.calls.topLevel.length, gateway.calls.bound.length], [0, 0]);
  // One of them named: it goes, and is named in the job.
  for (const productTypeID of [INVENTED_TYPE_ID, OTHER_INVENTED]) {
    const { response } = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: inventionBody({ productTypeID }) });
    assert.deepEqual([response.status, sentJobs(gateway, "InstallJob").at(-1).productTypeID], [200, productTypeID]);
  }
  // No other kind of work is held to an invention's products.
  const made = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
  assert.equal(made.response.status, 200);

  // A recipe that has the one: none need be named; the one named goes; and another than it does not.
  const plain = fakeIndustryGateway();
  const second = await startTestServer({ gateway: plain });
  await selectOnServer(second.baseUrl);
  const asked = async (productTypeID) => (await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: inventionBody({ productTypeID }) })).response.status;
  assert.deepEqual([await asked(undefined), await asked(INVENTED_TYPE_ID), await asked(OTHER_INVENTED)], [200, 200, 400]);
  assert.deepEqual(sentJobs(plain, "InstallJob").map((job) => job.productTypeID), [null, INVENTED_TYPE_ID]);
  // A blueprint the game's data has not: there is no recipe to hold it to, and the job is the server's to judge.
  const unknown = await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: inventionBody({ blueprintTypeID: 999_999 }) });
  assert.equal(unknown.response.status, 200);
});

test("an invention of more runs than thirty days hold of its time, or than five hundred, is refused before the job is sent, where that could be reckoned", async () => {
  // activity.py 34 to 36 with invention.py's MAX_RUNS. An invention that takes 1980000 s a run, and a pilot whose own
  // invention time is 1: 2592000 / 1980000 = 1.3..., so two runs.
  const gateway = fakeIndustryGateway({ timeMultiplier: 1 });
  const { baseUrl } = await startTestServer({ gateway, staticData: staticDataInventing({ time: 1980000 }) });
  await selectOnServer(baseUrl);
  for (const route of ["install"]) {
    const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: inventionBody({ runs: 3 }) });
    assert.deepEqual([response.status, payload.error], [400, "INVALID_RUNS"], route);
    assert.match(payload.message, /inventing from this blueprint here has at most 2 runs/);
  }
  assert.deepEqual([sentJobs(gateway, "ConnectJob").length, sentJobs(gateway, "InstallJob").length], [0, 0]);
  const most = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: inventionBody({ runs: 2 }) });
  assert.deepEqual([most.response.status, sentJobs(gateway, "InstallJob").map((job) => job.runs)], [200, [2]]);
  // Never more than five hundred, however short the invention: one of 300 s a run.
  const short = fakeIndustryGateway({ timeMultiplier: 1 });
  const second = await startTestServer({ gateway: short, staticData: staticDataInventing({ time: 300 }) });
  await selectOnServer(second.baseUrl);
  const over = await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: inventionBody({ runs: 501 }) });
  assert.deepEqual([over.response.status, over.payload.error, sentJobs(short, "InstallJob").length], [400, "INVALID_RUNS", 0]);
  assert.match(over.payload.message, /at most 500 runs/);
  await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: inventionBody({ runs: 500 }) });
  assert.deepEqual(sentJobs(short, "InstallJob").map((job) => job.runs), [500]);
});


// ── a reaction's job ──────────────────────────────────────────────────────────
//
// activities/reaction.py, whole; industryCommon.GetJobModifiers (485 to 513) and GetBlueprintPrice (521 to 543);
// industry/blueprint.py 62 to 72; structures/services.py 149 to 167 (web/src/bridge/industryReckonings.mjs, reactionJobSeconds,
// reactionJobMaterials, reactionServiceID, and blueprintPrice for a reaction). No Tranquility recording has an
// install: the numbers are made up and worked by hand.

const FUEL_TYPE_ID = 4051;
const REACTED_TYPE_ID = 16654;
/** A skill a reaction requires. It is given a time per level here, which only a manufacturing job's time is of. */
const REACTION_SKILL = 45746;

/**
 * The game's data with the test's blueprint a reaction formula: it has a reaction and nothing else, its own type
 * says no product (as the data's formulas say none at the top), and what it makes is a composite (group 429).
 */
function staticDataReacting(more = {}) {
  const plain = fakeStaticData();
  return {
    ...plain,
    getIndustryBlueprint(blueprintTypeID) {
      if (Number(blueprintTypeID) !== BLUEPRINT_TYPE_ID) return null;
      return {
        blueprintTypeID: BLUEPRINT_TYPE_ID,
        blueprintName: "A Made-Up Reaction Formula",
        productTypeID: 0,
        maxProductionLimit: 1000,
        activities: {
          reaction: {
            materials: [{ typeID: MATERIAL_TYPE_ID, quantity: 100 }, { typeID: FUEL_TYPE_ID, quantity: 5 }],
            products: [{ typeID: REACTED_TYPE_ID, quantity: 200 }],
            skills: [{ typeID: REACTION_SKILL, level: 1 }],
            time: 10800,
          },
        },
      };
    },
    getType: (typeID) => (Number(typeID) === REACTED_TYPE_ID ? { typeID: REACTED_TYPE_ID, groupID: 429, categoryID: 4 } : plain.getType(typeID)),
    getTypeDogmaAttribute: (typeID, attributeID) => (Number(typeID) === REACTION_SKILL && Number(attributeID) === 1982 ? -1 : null),
    ...more,
  };
}

/** A reaction's request, as the page sends it: nothing is said of a formula's research. */
const reactionBody = (overrides = {}) => installBody({ activity: "reaction", ...overrides });



test("a reaction is taxed by the service its product's group is reacted by, and a formula that makes nothing the data knows is not taxed by a guess", async () => {
  // structures/services.py 161 to 167, by the row's access (industry/activity.py 50 to 58): a biochemical material's
  // (group 712) by service 42, a hybrid polymer's (974) by 43, and any other thing's by 40.
  const facility = facilityRow({ tax: null });
  facility.args.entries.push(["serviceAccess", dict([[40, 0.04], [41, 0.01], [42, 0.02], [43, 0.03]])]);
  facility.args.entries.push(["globalModifiers", dict([["faction", 1], ["system", dict([[9, 1]])]])]);
  const state = { groupID: 712 };
  const plain = fakeIndustryGateway({ timeMultiplier: 1 });
  const gamePort = {
    ...plain,
    async selectCharacter() {
      return {
        bridgeSessionID: "gp:a-pilot-on-the-game-port", service: "charUnboundMgr", method: "SelectCharacterID", result: null, notifications: [],
        session: { userid: 4, characterID: CHARACTER_ID, characterName: "Test Pilot", stationID: STATION_ID, structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000, shipID: ACTIVE_SHIP_ID },
      };
    },
    async callMethod(service, method, ...rest) {
      if (service === "subscriptionMgr" && method === "GetCloneGrade") return { service, method, result: 1, notifications: [] };
      return plain.callMethod(service, method, ...rest);
    },
    async freshFacility() {
      return facility;
    },
    averageMarketPrice: (sessionFields, bridgeSessionID, typeID) => ({ averagePrice: 1, adjustedPrice: typeID === MATERIAL_TYPE_ID ? 1000 : 0 }),
  };
  const staticData = staticDataReacting({ getType: (typeID) => (Number(typeID) === REACTED_TYPE_ID && state.groupID !== null ? { typeID: REACTED_TYPE_ID, groupID: state.groupID, categoryID: 4 } : null) });
  const { baseUrl } = await startTestServer({ gateway: fakeIndustryGateway(), gamePortPilots: gamePort, staticData });
  await selectOnServer(baseUrl);
  const taxed = async () => {
    await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: reactionBody({ runs: 1 }) });
    return sentJobs(gamePort, "InstallJob").at(-1).tax;
  };
  // A base of 100 x 1000 = 100000 a run.
  const taxes = [];
  for (const groupID of [712, 4096, 974, 428, 429, 4932, 18]) {
    state.groupID = groupID;
    taxes.push(await taxed());
  }
  assert.deepEqual(taxes, [2000, 2000, 3000, 1000, 1000, 1000, 4000]);
  // What the formula makes is no type the data has: no service, no rate, and nought goes for the tax.
  state.groupID = null;
  assert.equal(await taxed(), 0);
});
