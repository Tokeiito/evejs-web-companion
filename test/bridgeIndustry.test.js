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
  assert.equal(payload.licensedRuns, 1);
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

test("the job's product is None where the page names none, as the client's job has none until one is chosen; named, it is the one named", async () => {
  // industry/job.py 367 and 640: obj._productTypeID = None, and 'productTypeID': self.productTypeID. A product is
  // set on a job only where there is a choice of them (192 to 206): manufacturing has the one, and names none.
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
  const sent = (method) => gateway.calls.topLevel.filter((call) => call.method === method).map((call) => call.args[0].productTypeID);
  assert.deepEqual([sent("ConnectJob"), sent("InstallJob")], [[null], [null]]);
  // A nought, or what is no number, is no product named.
  for (const none of [0, "", null, "the product"]) {
    await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ productTypeID: none }) });
    assert.equal(sent("InstallJob").at(-1), null, JSON.stringify(none));
  }
  // Named, it goes as it was named.
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ productTypeID: PRODUCT_TYPE_ID }) });
  assert.equal(sent("InstallJob").at(-1), PRODUCT_TYPE_ID);
});

test("the job's solar system is its facility's, as the place its materials are in has it, and not the pilot's", async () => {
  // industry/job.py 629: 'solarSystemID': self.facility.solarSystemID.
  const gateway = fakeIndustryGateway({ placesIn: 30000144 });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
  const previewed = gateway.calls.topLevel.find((call) => call.method === "ConnectJob").args[0];
  const installed = gateway.calls.topLevel.find((call) => call.method === "InstallJob").args[0];
  assert.notEqual(SOLAR_SYSTEM_ID, 30000144);
  assert.deepEqual([previewed.solarSystemID, installed.solarSystemID], [30000144, 30000144]);
  assert.deepEqual([previewed.inputLocation.solarSystemID, installed.outputLocation.solarSystemID], [30000144, 30000144]);
  // The preview's request is the install's, name for name.
  assert.deepEqual(Object.keys(previewed).sort(), Object.keys(installed).sort());

  // A facility that gives no place: neither is sent, and the solar system is the pilot's own, for want of another.
  const bare = fakeIndustryGateway({ noPlaces: true });
  const second = await startTestServer({ gateway: bare });
  await selectOnServer(second.baseUrl);
  await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
  const placeless = bare.calls.topLevel.find((call) => call.method === "InstallJob").args[0];
  assert.deepEqual([placeless.solarSystemID, placeless.inputLocation, placeless.outputLocation], [SOLAR_SYSTEM_ID, null, null]);
});

// --- a job's time, by the client's own reckoning ------------------------------
//
// industry/job.py 460 to 468: the activity's time for the runs, through each time modifier the job has (each
// required skill's time per level, the pilot's own manufacturing time attribute, the blueprint's time research,
// the facility's time modifiers for the product), rounded to the whole second (src/industryInstall.js). The
// server holds a time that is not nought against its own, to the second.

const sentJobs = (gateway, method) => gateway.calls.topLevel.filter((call) => call.method === method).map((call) => call.args[0]);

test("a manufacturing job's time is the client's own reckoning, in the preview's request and the install's, and the preview says it", async () => {
  // 600 s a run, three runs, a pilot whose manufacturing time attribute is 0.68 and a blueprint with five of time
  // research: 600 x 3 x 0.68 x 0.95 = 1162.8.
  const gateway = fakeIndustryGateway({ timeMultiplier: 0.68 });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const preview = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  assert.deepEqual([sentJobs(gateway, "ConnectJob")[0].time, sentJobs(gateway, "InstallJob")[0].time, preview.payload.timeSeconds], [1163, 1163, 1163]);
  // The pilot's own attribute is asked of its dogma location, by the character and the attribute (219), and the
  // facility's modifiers are read for it; each once for the preview and once for the install.
  assert.deepEqual(gateway.calls.bound.map((call) => [call.method, call.args]), [["QueryAttributeValue", [CHARACTER_ID, 219]], ["QueryAttributeValue", [CHARACTER_ID, 219]]]);
  assert.equal(gateway.calls.topLevel.filter((call) => call.method === "GetFacilities").length, 2);
  // The cost and the tax go as nought still: the server reckons each.
  assert.deepEqual([sentJobs(gateway, "InstallJob")[0].cost, sentJobs(gateway, "InstallJob")[0].tax], [0, 0]);
  // A blueprint said to have no time research: 600 x 3 x 0.68 = 1224. One of which nothing is said: no time is
  // reckoned, nothing is asked for it, and nought goes.
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 0 }) });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
  assert.deepEqual(sentJobs(gateway, "InstallJob").slice(1).map((job) => job.time), [1224, 0]);
  assert.deepEqual([gateway.calls.bound.length, gateway.calls.topLevel.filter((call) => call.method === "GetFacilities").length], [3, 3]);
});

test("a manufacturing job's materials are the client's own reckoning, in the preview's request and the install's, and the preview says them", async () => {
  // industry/job.py 470 to 485 and 637 (src/industryInstall.js, manufacturingJobMaterials). The blueprint's
  // manufacturing takes 86 of one material a run; three runs; a blueprint with ten of material research, in a
  // facility whose hull takes 1% off any job's materials: 86 x 0.9 x 0.99 x 3 = 229.878.
  const facility = facilityRow();
  facility.args.entries.find(([name]) => name === "activities")[1] = dict([
    [ACTIVITY_MANUFACTURING, { type: "tuple", items: [list([]), list([[0.99, null, null, null, 12]]), list([])] }],
    [ACTIVITY_COPYING, { type: "tuple", items: [list([]), list([[0.5, null, null, null, 12]]), list([])] }],
  ]);
  const gateway = fakeIndustryGateway({ facility });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const jobs = (method) => sentJobs(gateway, method);

  const preview = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ materialEfficiency: 10 }) });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ materialEfficiency: 10 }) });
  assert.deepEqual([jobs("ConnectJob")[0].materials, jobs("InstallJob")[0].materials, preview.payload.materials],
    [{ [MATERIAL_TYPE_ID]: 230 }, { [MATERIAL_TYPE_ID]: 230 }, { [MATERIAL_TYPE_ID]: 230 }]);
  // A blueprint said to have no material research: 86 x 0.99 x 3 = 255.42. And one run of it: 85.14.
  const none = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ materialEfficiency: 0 }) });
  const one = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ materialEfficiency: 0, runs: 1 }) });
  assert.deepEqual([none.payload.materials, jobs("ConnectJob")[1].materials, one.payload.materials], [{ [MATERIAL_TYPE_ID]: 256 }, { [MATERIAL_TYPE_ID]: 256 }, { [MATERIAL_TYPE_ID]: 86 }]);
  // One of which nothing is said: no materials are reckoned, an empty map goes as it always did, which the server
  // reads as its own to work out, and the preview says none.
  const unsaid = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
  assert.deepEqual([unsaid.payload.materials, jobs("ConnectJob").at(-1).materials, jobs("InstallJob").at(-1).materials], [null, {}, {}]);
  // Any other kind of work: none are reckoned, though the research is said and the facility has a modifier for it.
  const copying = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ activity: "copying", materialEfficiency: 10 }) });
  assert.deepEqual([copying.payload.materials, jobs("ConnectJob").at(-1).materials], [null, {}]);
  // A facility that is not among those read: none are reckoned.
  const elsewhere = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ facilityID: STATION_ID + 1, materialEfficiency: 10 }) });
  assert.deepEqual([elsewhere.payload.materials, jobs("ConnectJob").at(-1).materials], [null, {}]);
});

test("a blueprint's material research is a whole number from nought to ten, or the request is refused before anything is asked", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const materialEfficiency of [-1, 11, 2.5, "ten", "5", true]) {
    for (const route of ["preview", "install"]) {
      const { response, payload } = await apiRequest(baseUrl, `/api/bridge/industry/${route}`, { method: "POST", body: installBody({ materialEfficiency }) });
      assert.deepEqual([response.status, payload.error], [400, "INVALID_MATERIAL_EFFICIENCY"], `${route} ${materialEfficiency}`);
    }
  }
  assert.deepEqual([gateway.calls.topLevel.length, gateway.calls.bound.length], [0, 0]);
});

test("on the game port a job's materials go the same way, by the facility the pilot's own transport keeps", async () => {
  const facility = facilityRow();
  facility.args.entries.find(([name]) => name === "activities")[1] = dict([
    [ACTIVITY_MANUFACTURING, { type: "tuple", items: [list([]), list([[0.99, null, null, null, 12], [0.98, null, null, null, 11]]), list([])] }],
  ]);
  const asked = [];
  const plain = fakeIndustryGateway();
  const gamePort = {
    ...plain,
    async selectCharacter() {
      return {
        bridgeSessionID: "gp:a-pilot-on-the-game-port", service: "charUnboundMgr", method: "SelectCharacterID", result: null, notifications: [],
        session: { userid: 4, characterID: CHARACTER_ID, characterName: "Test Pilot", stationID: STATION_ID, structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000, shipID: ACTIVE_SHIP_ID },
      };
    },
    async freshFacility(sessionFields, bridgeSessionID, facilityID) {
      asked.push(facilityID);
      return facility;
    },
  };
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort });
  await selectOnServer(baseUrl);
  // 86 x 0.93 x 0.99 x 0.98 x 3 = 232.79...: each of the facility's two modifiers in turn.
  const preview = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ materialEfficiency: 7 }) });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ materialEfficiency: 7 }) });
  assert.deepEqual([preview.payload.materials, sentJobs(gamePort, "ConnectJob")[0].materials, sentJobs(gamePort, "InstallJob")[0].materials],
    [{ [MATERIAL_TYPE_ID]: 233 }, { [MATERIAL_TYPE_ID]: 233 }, { [MATERIAL_TYPE_ID]: 233 }]);
  // The facility is asked for once for a request, and nothing of the pilot's went to the gateway.
  assert.deepEqual([asked, gateway.calls.topLevel.length], [[STATION_ID, STATION_ID], 0]);
});

test("a required skill's time per level and the facility's time modifiers for the product are in a job's time", async () => {
  // A skill the blueprint requires that takes 1% a level (attribute 1982), the pilot at its second level; a facility
  // that takes 15% off anything and has another modifier for another category of thing:
  // 600 x 3 x 0.98 x 0.68 x 0.95 x 0.85 = 968.6124.
  const TIMED_SKILL = 11452;
  const withSkills = fakeStaticData();
  const staticData = {
    ...withSkills,
    getIndustryBlueprint(blueprintTypeID) {
      const definition = withSkills.getIndustryBlueprint(blueprintTypeID);
      // (And one more that takes 1% a level, which the pilot has not: a level of nought, which changes nothing.)
      if (definition) definition.activities.manufacturing.skills = [{ typeID: 3380, level: 1 }, { typeID: TIMED_SKILL, level: 1 }, { typeID: TIMED_SKILL + 1, level: 1 }];
      return definition;
    },
    getTypeDogmaAttribute: (typeID, attributeID) => ([TIMED_SKILL, TIMED_SKILL + 1].includes(Number(typeID)) && Number(attributeID) === 1982 ? -1 : null),
    getType: (typeID) => (Number(typeID) === PRODUCT_TYPE_ID ? { typeID: PRODUCT_TYPE_ID, groupID: 303, categoryID: 20 } : withSkills.getType(typeID)),
  };
  const facility = facilityRow();
  facility.args.entries.find(([name]) => name === "activities")[1] = dict([
    [ACTIVITY_MANUFACTURING, { type: "tuple", items: [list([[0.85, null, null, null, 2], [0.5, 6, null, null, 4]]), list([[0.99, null, null, null, 2]]), list([])] }],
  ]);
  const gateway = fakeIndustryGateway({ timeMultiplier: 0.68, skills: [{ typeID: 3380, level: 5 }, { typeID: TIMED_SKILL, level: 2 }], facility });
  const { baseUrl } = await startTestServer({ gateway, staticData });
  await selectOnServer(baseUrl);

  const preview = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  assert.deepEqual([preview.payload.timeSeconds, sentJobs(gateway, "ConnectJob")[0].time, sentJobs(gateway, "InstallJob")[0].time], [969, 969, 969]);

  // A modifier for the product's own category counts: 968.6124 x 0.5 = 484.3062.
  staticData.getType = (typeID) => (Number(typeID) === PRODUCT_TYPE_ID ? { typeID: PRODUCT_TYPE_ID, groupID: 303, categoryID: 6 } : withSkills.getType(typeID));
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  assert.equal(sentJobs(gateway, "InstallJob")[1].time, 484);
});

test("where a job's time cannot be reckoned whole it goes as nought, as it did, and the server reckons it", async () => {
  // The pilot's attribute could not be asked.
  const refused = fakeIndustryGateway({ attributeRefused: true });
  const first = await startTestServer({ gateway: refused });
  await selectOnServer(first.baseUrl);
  const preview = await apiRequest(first.baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  const installed = await apiRequest(first.baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  assert.deepEqual([preview.response.status, preview.payload.timeSeconds, installed.response.status, installed.payload.applied], [200, null, 200, true]);
  assert.deepEqual([sentJobs(refused, "ConnectJob")[0].time, sentJobs(refused, "InstallJob")[0].time], [0, 0]);

  // What it answered is no number.
  const odd = fakeIndustryGateway({ timeMultiplier: null });
  const second = await startTestServer({ gateway: odd });
  await selectOnServer(second.baseUrl);
  await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 0 }) });
  assert.equal(sentJobs(odd, "InstallJob")[0].time, 0);

  // The facility is not among those read.
  const elsewhere = fakeIndustryGateway({ timeMultiplier: 0.68, facility: facilityRow({ facilityID: STATION_ID + 1 }) });
  const fourth = await startTestServer({ gateway: elsewhere });
  await selectOnServer(fourth.baseUrl);
  await apiRequest(fourth.baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 0 }) });
  assert.equal(sentJobs(elsewhere, "InstallJob")[0].time, 0);

  // A required skill has a time per level, and the pilot's skills could not be read, or were read as no list.
  const timedSkill = fakeStaticData();
  const requiringIt = {
    ...timedSkill,
    getIndustryBlueprint(blueprintTypeID) {
      const definition = timedSkill.getIndustryBlueprint(blueprintTypeID);
      if (definition) definition.activities.manufacturing.skills = [{ typeID: 11452, level: 1 }];
      return definition;
    },
    getTypeDogmaAttribute: (typeID, attributeID) => (Number(typeID) === 11452 && Number(attributeID) === 1982 ? -1 : null),
  };
  for (const unread of [fakeIndustryGateway({ timeMultiplier: 0.68, skillsRefused: true }), fakeIndustryGateway({ timeMultiplier: 0.68, sheet: {} })]) {
    const { baseUrl } = await startTestServer({ gateway: unread, staticData: requiringIt });
    await selectOnServer(baseUrl);
    await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 0 }) });
    assert.equal(sentJobs(unread, "InstallJob")[0].time, 0);
  }

  // Any other kind of work: nothing is asked for its time, which goes as nought.
  const gateway = fakeIndustryGateway({ timeMultiplier: 0.68 });
  const third = await startTestServer({ gateway });
  await selectOnServer(third.baseUrl);
  const invention = await apiRequest(third.baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ activity: "invention", timeEfficiency: 5 }) });
  await apiRequest(third.baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ activity: "copying" }) });
  assert.deepEqual([invention.payload.timeSeconds, sentJobs(gateway, "ConnectJob")[0].time, sentJobs(gateway, "InstallJob")[0].time], [null, 0, 0]);
  assert.deepEqual([gateway.calls.bound.length, gateway.calls.topLevel.some((call) => call.method === "GetFacilities")], [0, false]);

  // A blueprint the game's data has not: there is no time to start from.
  await apiRequest(third.baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ blueprintTypeID: 999_999, timeEfficiency: 5 }) });
  assert.equal(sentJobs(gateway, "InstallJob")[1].time, 0);
});

test("on the game port a job's facility is asked of the transport, which keeps the region's as the client's facility service does", async () => {
  // industrySvc.CreateJob (109): job.facility = facilitySvc.GetFreshFacility(facilityID). The transport answers it
  // (src/gamePort/pilots.js, freshFacility), and the pilot's level of each skill that has a time per level.
  const TIMED_SKILL = 11452;
  const plain = fakeStaticData();
  const staticData = {
    ...plain,
    getIndustryBlueprint(blueprintTypeID) {
      const definition = plain.getIndustryBlueprint(blueprintTypeID);
      if (definition) definition.activities.manufacturing.skills = [{ typeID: TIMED_SKILL, level: 1 }];
      return definition;
    },
    getTypeDogmaAttribute: (typeID, attributeID) => (Number(typeID) === TIMED_SKILL && Number(attributeID) === 1982 ? -1 : null),
  };
  const facility = facilityRow();
  facility.args.entries.find(([name]) => name === "activities")[1] = dict([
    [ACTIVITY_MANUFACTURING, { type: "tuple", items: [list([[0.85, null, null, null, 2]]), list([]), list([])] }],
    [8, { type: "tuple", items: [list([]), list([[0.5, null, null, null, 2]]), list([])] }],
  ]);
  const asked = { fresh: [], levels: [] };
  /** The job each asking of the facility was for, as the route said it. */
  const jobsSaid = [];
  let refuse = false;
  const gamePort = {
    ...fakeIndustryGateway({ timeMultiplier: 0.68 }),
    async selectCharacter() {
      return {
        bridgeSessionID: "gp:a-pilot-on-the-game-port", service: "charUnboundMgr", method: "SelectCharacterID", result: null, notifications: [],
        session: { userid: 4, characterID: CHARACTER_ID, characterName: "Test Pilot", stationID: STATION_ID, structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000, shipID: ACTIVE_SHIP_ID },
      };
    },
    async freshFacility(sessionFields, bridgeSessionID, facilityID, job) {
      asked.fresh.push([sessionFields, bridgeSessionID, facilityID]);
      jobsSaid.push(job);
      if (refuse) throw Object.assign(new Error("That facility could not be found."), { code: "CALL_REFUSED", statusCode: 409 });
      return facility;
    },
    async skillLevels(sessionFields, bridgeSessionID, typeIDs) {
      asked.levels.push([sessionFields, bridgeSessionID, typeIDs]);
      return typeIDs.map(() => 2);
    },
  };
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, staticData });
  await selectOnServer(baseUrl);

  // 600 x 3 x 0.98 x 0.68 x 0.95 x 0.85 = 968.6124.
  const preview = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  assert.deepEqual([preview.payload.timeSeconds, sentJobs(gamePort, "ConnectJob")[0].time, sentJobs(gamePort, "InstallJob")[0].time], [969, 969, 969]);
  const who = [{ userid: 4 }, "gp:a-pilot-on-the-game-port"];
  assert.deepEqual(asked, { fresh: [[...who, STATION_ID], [...who, STATION_ID]], levels: [[...who, [TIMED_SKILL]], [...who, [TIMED_SKILL]]] });
  // The region's facilities are not asked for by the route, and nothing of the pilot's goes to the gateway.
  assert.deepEqual([gamePort.calls.topLevel.some((call) => call.method === "GetFacilities"), gateway.calls.topLevel.length, gateway.calls.bound.length], [false, 0, 0]);

  // An invention with a decryptor reads the same facility's material modifiers: 2 x 3 x 0.5 = 3 of the datacore.
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ activity: "invention", runs: 3, decryptorTypeID: DECRYPTOR_TYPE_ID }) });
  assert.deepEqual([sentJobs(gamePort, "InstallJob")[1].materials, asked.fresh.length, gamePort.calls.topLevel.some((call) => call.method === "GetFacilities")],
    [{ [DATACORE_TYPE_ID]: 3, [DECRYPTOR_TYPE_ID]: 3 }, 3, false]);
  // And it is asked for as the facility of that job: its blueprint, and invention.
  assert.deepEqual(jobsSaid.at(-1), { blueprintID: BLUEPRINT_ITEM_ID, activityID: 8 });

  // A facility the server will not answer for: no time is reckoned, nought goes, and the job is the server's to judge.
  refuse = true;
  const unknown = await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  assert.deepEqual([unknown.response.status, sentJobs(gamePort, "InstallJob")[2].time], [200, 0]);
  // And the decryptor's materials are reckoned with no modifier of the facility's: 2 x 3 = 6.
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ activity: "invention", runs: 3, decryptorTypeID: DECRYPTOR_TYPE_ID }) });
  assert.deepEqual(sentJobs(gamePort, "InstallJob")[3].materials, { [DATACORE_TYPE_ID]: 6, [DECRYPTOR_TYPE_ID]: 3 });
});

test("on the game port a manufacturing job's cost is the client's own reckoning, from the pilot's table of prices", async () => {
  // industry/job.py 310 to 320 (src/industryInstall.js, manufacturingJobCost). 86 of the one material a run, at an
  // adjusted price of 512, three runs: a base of 132096. The facility's one cost modifier, 0.04: 5283.84.
  const facility = facilityRow();
  facility.args.entries.push(["globalModifiers", dict([["faction", 1], ["system", dict([[ACTIVITY_MANUFACTURING, 1]])]])]);
  facility.args.entries.find(([name]) => name === "activities")[1] = dict([
    [ACTIVITY_MANUFACTURING, { type: "tuple", items: [list([]), list([]), list([[0.04, null, null, null, 4]])] }],
  ]);
  const state = { grade: 1, table: true, priced: [] };
  const plain = fakeIndustryGateway({ timeMultiplier: 0.68 });
  const who = [{ userid: 4 }, "gp:a-pilot-on-the-game-port"];
  const gamePort = {
    ...plain,
    async selectCharacter() {
      return {
        bridgeSessionID: who[1], service: "charUnboundMgr", method: "SelectCharacterID", result: null, notifications: [],
        session: { userid: 4, characterID: CHARACTER_ID, characterName: "Test Pilot", stationID: STATION_ID, structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000, shipID: ACTIVE_SHIP_ID },
      };
    },
    // The account's clone grade, as the transport answers it from what it keeps.
    async callMethod(service, method, ...rest) {
      if (service === "subscriptionMgr" && method === "GetCloneGrade") return { service, method, result: state.grade, notifications: [] };
      return plain.callMethod(service, method, ...rest);
    },
    async freshFacility() {
      state.fresh = (state.fresh || 0) + 1;
      return state.facility || facility;
    },
    // The pilot's table of prices: a type's two prices, none of either for a type it has not, and null with no table.
    averageMarketPrice(sessionFields, bridgeSessionID, typeID) {
      state.priced.push([sessionFields, bridgeSessionID, typeID]);
      if (!state.table) return null;
      return typeID === MATERIAL_TYPE_ID ? { averagePrice: 600, adjustedPrice: 512 } : { averagePrice: null, adjustedPrice: null };
    },
  };
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort });
  await selectOnServer(baseUrl);
  const install = async (overrides = {}) => {
    await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody(overrides) });
    return sentJobs(gamePort, "InstallJob").at(-1);
  };

  await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() });
  assert.deepEqual([sentJobs(gamePort, "ConnectJob")[0].cost, (await install()).cost], [5284, 5284]);
  // The price read is the adjusted one, of the blueprint's material, off the pilot's own table.
  assert.deepEqual(state.priced[0], [...who, MATERIAL_TYPE_ID]);
  // The tax is its own reckoning's (the facility's 0.01 of the base: 1320.96), and the time its own: none here,
  // nothing being said of the blueprint's time research.
  assert.deepEqual([(await install()).tax, (await install()).time, (await install({ timeEfficiency: 0 })).time], [1321, 0, 1224]);
  // One run: 86 x 512 x 0.04 = 1761.28.
  assert.equal((await install({ runs: 1 })).cost, 1761);
  // An alpha clone's job costs a quarter of a percent of the base more: 5283.84 + 330.24.
  state.grade = 0;
  assert.equal((await install()).cost, 5614);
  // A grade that is neither an alpha's nor an omega's is no grade to reckon by: nought goes, and the server reckons the cost.
  state.grade = null;
  assert.equal((await install()).cost, 0);
  state.grade = 1;
  // A pilot with no table of prices yet: nought goes.
  state.table = false;
  assert.equal((await install()).cost, 0);
  state.table = true;
  // Any other kind of work: nought goes, and no price is read for it.
  const before = state.priced.length;
  assert.deepEqual([(await install({ activity: "copying" })).cost, state.priced.length], [0, before]);
  // The job's facility is asked for once for a request, whether the cost alone wants it or the time does too.
  const asked = state.fresh;
  await install();
  await install({ timeEfficiency: 0 });
  assert.equal(state.fresh, asked + 2);
  // And nothing of the pilot's went to the gateway.
  assert.equal(gateway.calls.topLevel.length, 0);

  // The blueprint type's own cost multiplier (attribute 1954), the faction's modifier and the system's are in it:
  // 132096 x 0.5 x 0.9 x 0.05 x 0.04 = 118.8864.
  state.facility = facilityRow();
  state.facility.args.entries.push(["globalModifiers", dict([["faction", 0.9], ["system", dict([[ACTIVITY_MANUFACTURING, 0.05]])]])]);
  state.facility.args.entries.find(([name]) => name === "activities")[1] = facility.args.entries.find(([name]) => name === "activities")[1];
  const withItsOwn = { ...fakeStaticData(), getTypeDogmaAttribute: (typeID, attributeID) => (Number(typeID) === BLUEPRINT_TYPE_ID && Number(attributeID) === 1954 ? 0.5 : null) };
  const second = await startTestServer({ gateway: fakeIndustryGateway(), gamePortPilots: gamePort, staticData: withItsOwn });
  await selectOnServer(second.baseUrl);
  await apiRequest(second.baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
  assert.equal(sentJobs(gamePort, "InstallJob").at(-1).cost, 119);
});

test("on the game port the preview says what the job costs to start, as the client adds it up, and the job's tax goes with the job", async () => {
  // industry/job.py 127 to 174 and 450 to 458 (src/industryInstall.js, manufacturingJobFee). A base of 132096 (86 of
  // the material a run at 512, three runs); the facility's cost modifier 0.04, its tax 0.01 and the SCC's modifier 1.
  // The facility is in another system than the pilot.
  const A_SYSTEM_AWAY = 30000144;
  const facility = facilityRow({ solarSystemID: A_SYSTEM_AWAY });
  facility.args.entries.push(["globalModifiers", dict([["faction", 1], ["system", dict([[ACTIVITY_MANUFACTURING, 1]])]])]);
  facility.args.entries.find(([name]) => name === "activities")[1] = dict([
    [ACTIVITY_MANUFACTURING, { type: "tuple", items: [list([]), list([]), list([[0.04, null, null, null, 4]])] }],
  ]);
  const state = { facility, security: 0.9, table: true, grade: 1 };
  const plain = fakeIndustryGateway({ timeMultiplier: 0.68 });
  const gamePort = {
    ...plain,
    async selectCharacter() {
      return {
        bridgeSessionID: "gp:a-pilot-on-the-game-port", service: "charUnboundMgr", method: "SelectCharacterID", result: null, notifications: [],
        session: { userid: 4, characterID: CHARACTER_ID, characterName: "Test Pilot", stationID: STATION_ID, structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000, shipID: ACTIVE_SHIP_ID },
      };
    },
    async callMethod(service, method, ...rest) {
      if (service === "subscriptionMgr" && method === "GetCloneGrade") return { service, method, result: state.grade, notifications: [] };
      return plain.callMethod(service, method, ...rest);
    },
    async freshFacility() {
      return state.facility;
    },
    averageMarketPrice(sessionFields, bridgeSessionID, typeID) {
      if (!state.table) return null;
      return typeID === MATERIAL_TYPE_ID ? { averagePrice: 600, adjustedPrice: 512 } : { averagePrice: null, adjustedPrice: null };
    },
  };
  // The facility's system and its security, as the game's own data has them.
  const asked = [];
  const staticData = { ...fakeStaticData(), getSolarSystem: (solarSystemID) => { asked.push(solarSystemID); return state.security === null ? null : { security: state.security }; } };
  const { baseUrl } = await startTestServer({ gateway: fakeIndustryGateway(), gamePortPilots: gamePort, staticData });
  await selectOnServer(baseUrl);
  const previewed = async () => (await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() })).payload.fee;
  const installed = async () => {
    await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
    return sentJobs(gamePort, "InstallJob").at(-1);
  };

  // The cost 5283.84; the tax 132096 x 0.01 = 1320.96; the surcharge 132096 x 0.04 = 5283.84; no security tax in a system of 0.9.
  assert.deepEqual(await previewed(), { cost: 5284, tax: 1321, sccSurcharge: 5284, securityTax: 0, total: 11889 });
  // The security read is the facility's system's, and not the pilot's.
  assert.deepEqual([asked.at(-1), A_SYSTEM_AWAY === SOLAR_SYSTEM_ID], [A_SYSTEM_AWAY, false]);
  // Any other kind of work: no tax is reckoned, nought goes, and no fee is said.
  const other = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ activity: "copying" }) });
  assert.deepEqual([other.payload.fee, sentJobs(gamePort, "ConnectJob").at(-1).tax], [null, 0]);
  await previewed();
  // The tax is in the job as the cost is: in the preview's request and the install's.
  assert.deepEqual([sentJobs(gamePort, "ConnectJob").at(-1).tax, (await installed()).tax, (await installed()).cost], [1321, 1321, 5284]);
  // A system of security 0.95 and over has a security tax of 5% of the base beside them: 6604.8.
  state.security = 0.95;
  assert.deepEqual(await previewed(), { cost: 5284, tax: 1321, sccSurcharge: 5284, securityTax: 6605, total: 18494 });
  // A system whose security the data has not: there is no total to say, and the tax goes all the same.
  state.security = null;
  assert.deepEqual([await previewed(), (await installed()).tax], [null, 1321]);
  state.security = 0.9;
  // A cost that could not be reckoned (a clone grade that is neither): there is no total to say, and the tax goes all the same.
  state.grade = null;
  const ungraded = await installed();
  assert.deepEqual([await previewed(), ungraded.tax, ungraded.cost], [null, 1321, 0]);
  state.grade = 1;
  // A facility that says no tax of its own, and no access by service either: no tax is reckoned, nought goes, and
  // there is no total to say. The cost goes as it did.
  state.facility = facilityRow({ tax: null });
  state.facility.args.entries.push(...facility.args.entries.filter(([name]) => name === "globalModifiers"));
  state.facility.args.entries.find(([name]) => name === "activities")[1] = facility.args.entries.find(([name]) => name === "activities")[1];
  const untaxed = await installed();
  assert.deepEqual([await previewed(), untaxed.tax, untaxed.cost], [null, 0, 5284]);
  state.facility = facility;
  // A pilot with no table of prices: nothing is reckoned, and nought goes for each.
  state.table = false;
  const unpriced = await installed();
  assert.deepEqual([await previewed(), unpriced.tax, unpriced.cost], [null, 0, 0]);
});

test("on the game port a job in a structure is taxed by the access of the service it is done by", async () => {
  // industry/activity.py 50 to 58 and structures/services.py 149 to 158. A structure's row says no tax of its own
  // (None) and, by service, what each takes: the basic manufacturing's (22) 0.0325, the capital ships' (23) 0.05,
  // and nothing for the supercapital ships' (24). The base is 132096, and the facility's cost modifier 0.04.
  const structure = facilityRow({ tax: null, serviceAccess: dict([[22, 0.0325], [23, 0.05]]) });
  structure.args.entries.push(["globalModifiers", dict([["faction", 1], ["system", dict([[ACTIVITY_MANUFACTURING, 1]])]])]);
  structure.args.entries.find(([name]) => name === "activities")[1] = dict([
    [ACTIVITY_MANUFACTURING, { type: "tuple", items: [list([]), list([]), list([[0.04, null, null, null, 4]])] }],
  ]);
  // What the blueprint makes, by its group: a frigate (25), a carrier (547), a titan (30), or a type the data has not.
  // The blueprint's named product is another type here than the first thing its manufacturing makes, and a
  // carrier: the service is by the first thing made.
  const A_NAMED_PRODUCT = 23757;
  const state = { facility: structure, group: 25 };
  const plain = fakeIndustryGateway({ timeMultiplier: 0.68 });
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
      return state.facility;
    },
    averageMarketPrice(sessionFields, bridgeSessionID, typeID) {
      return typeID === MATERIAL_TYPE_ID ? { averagePrice: 600, adjustedPrice: 512 } : { averagePrice: null, adjustedPrice: null };
    },
  };
  const asked = [];
  const staticData = {
    ...fakeStaticData(),
    getSolarSystem: () => ({ security: 0.9 }),
    getIndustryBlueprint: (blueprintTypeID) => {
      const known = fakeStaticData().getIndustryBlueprint(blueprintTypeID);
      return known && { ...known, productTypeID: A_NAMED_PRODUCT };
    },
    getType: (typeID) => {
      asked.push(Number(typeID));
      if (Number(typeID) === A_NAMED_PRODUCT) return { typeID: A_NAMED_PRODUCT, groupID: 547, categoryID: 6 };
      if (Number(typeID) !== PRODUCT_TYPE_ID) return fakeStaticData().getType(typeID);
      return state.group === null ? null : { typeID: PRODUCT_TYPE_ID, groupID: state.group, categoryID: 6 };
    },
  };
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, staticData });
  await selectOnServer(baseUrl);
  const previewed = async () => (await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() })).payload.fee;
  const installed = async () => {
    await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody() });
    return sentJobs(gamePort, "InstallJob").at(-1);
  };

  // A frigate, by the basic service: 132096 x 0.0325 = 4293.12. The tax is in the fee, in the preview's job and the install's.
  assert.deepEqual(await previewed(), { cost: 5284, tax: 4293, sccSurcharge: 5284, securityTax: 0, total: 14861 });
  assert.deepEqual([sentJobs(gamePort, "ConnectJob").at(-1).tax, (await installed()).tax], [4293, 4293]);
  // The group read is the product's: the first thing the blueprint's manufacturing makes.
  assert.ok(asked.includes(PRODUCT_TYPE_ID));
  // A carrier, by the capital ships' service: 132096 x 0.05 = 6604.8.
  state.group = 547;
  assert.deepEqual([await previewed(), (await installed()).tax], [{ cost: 5284, tax: 6605, sccSurcharge: 5284, securityTax: 0, total: 17173 }, 6605]);
  // A titan, by a service the access says nothing for: a tax of nought, which is a tax, and the fee is said.
  state.group = 30;
  assert.deepEqual([await previewed(), (await installed()).tax], [{ cost: 5284, tax: 0, sccSurcharge: 5284, securityTax: 0, total: 10568 }, 0]);
  // A product whose group the game's data has not: no service, no tax reckoned, nought goes, and no fee is said.
  state.group = null;
  assert.deepEqual([await previewed(), (await installed()).tax, (await installed()).cost], [null, 0, 5284]);
  // A station's own tax is its tax whatever is made there, a product the data has not among them: 132096 x 0.01.
  state.facility = facilityRow({ tax: 0.01, serviceAccess: dict([[22, 0.5]]) });
  state.facility.args.entries.push(...structure.args.entries.filter(([name]) => name === "globalModifiers"));
  state.facility.args.entries.find(([name]) => name === "activities")[1] = structure.args.entries.find(([name]) => name === "activities")[1];
  assert.deepEqual([(await previewed()).tax, (await installed()).tax], [1321, 1321]);
  state.group = 25;
  assert.equal((await installed()).tax, 1321);
  // And nothing of the pilot's went to the gateway.
  assert.equal(gateway.calls.topLevel.length, 0);
});

test("on the game port the preview's monitor is kept, the facility is asked for the job it is for, and the window's events are the transport's", async () => {
  // The client's window keeps its job from its making to its letting go: its monitor is opened once
  // (industrySvc.ConnectJob, 303) and let go at the window's close (industryWnd.Close, 107), and the job is given
  // its facility once (CreateJob, 109). On the game port the transport keeps that job (src/gamePort/pilots.js,
  // industryWindowClosed, industryJobLetGo, freshFacility), and the routes leave it to it.
  const facility = facilityRow();
  const said = [];
  const plain = fakeIndustryGateway();
  const gamePort = {
    ...plain,
    async selectCharacter() {
      return {
        bridgeSessionID: "gp:a-pilot-on-the-game-port", service: "charUnboundMgr", method: "SelectCharacterID", result: null, notifications: [],
        session: { userid: 4, characterID: CHARACTER_ID, characterName: "Test Pilot", stationID: STATION_ID, structureID: null, solarSystemID: SOLAR_SYSTEM_ID, corporationID: 98000000, shipID: ACTIVE_SHIP_ID },
      };
    },
    async freshFacility(sessionFields, bridgeSessionID, facilityID, job) {
      said.push(["fresh", facilityID, job]);
      return facility;
    },
    async industryWindowClosed(sessionFields, bridgeSessionID) {
      said.push(["closed", sessionFields.userid, bridgeSessionID]);
      return { sent: true };
    },
    industryJobLetGo(sessionFields, bridgeSessionID) {
      said.push(["let go", sessionFields.userid, bridgeSessionID]);
    },
  };
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort });
  await selectOnServer(baseUrl);
  const preview = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ materialEfficiency: 0 }) });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ materialEfficiency: 0 }) });
  // The monitor is opened, what the pilot has is answered, and the monitor is not let go.
  const methods = gamePort.calls.topLevel.map((call) => call.method);
  assert.deepEqual([preview.payload.available, methods.filter((method) => method === "ConnectJob").length, methods.includes("DisconnectJob"), methods.includes("InstallJob")],
    [{ [String(MATERIAL_TYPE_ID)]: 500 }, 1, false, true]);
  // The facility is asked for with the job it is for, its blueprint and its work: by the preview, and by the install.
  const theJob = { blueprintID: BLUEPRINT_ITEM_ID, activityID: ACTIVITY_MANUFACTURING };
  assert.deepEqual(said, [["fresh", STATION_ID, theJob], ["fresh", STATION_ID, theJob]]);

  // The window's two events go to the transport, as the pilot's own.
  const closed = await apiRequest(baseUrl, "/api/bridge/industry/window", { method: "POST", body: { event: "closed" } });
  const letGo = await apiRequest(baseUrl, "/api/bridge/industry/window", { method: "POST", body: { event: "job-let-go" } });
  assert.deepEqual([closed.response.status, closed.payload, letGo.response.status, letGo.payload], [200, { ok: true, kept: true }, 200, { ok: true, kept: true }]);
  assert.deepEqual(said.slice(2), [["closed", 4, "gp:a-pilot-on-the-game-port"], ["let go", 4, "gp:a-pilot-on-the-game-port"]]);
  // Anything else is no event of the window's, and nothing is told.
  for (const event of [undefined, "", "opened", 5, null, ["closed"]]) {
    const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/window", { method: "POST", body: { event } });
    assert.deepEqual([response.status, payload.error], [400, "INVALID_WINDOW_EVENT"], JSON.stringify(event));
  }
  assert.equal(said.length, 4);
  // And nothing of the pilot's went to the gateway.
  assert.equal(gateway.calls.topLevel.length, 0);
});

test("through the gateway the preview's monitor is let go as it was, and the window's events ask nothing", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() });
  const before = gateway.calls.topLevel.map((call) => call.method);
  assert.deepEqual([before.filter((method) => method === "ConnectJob").length, before.filter((method) => method === "DisconnectJob").length], [1, 1]);
  for (const event of ["closed", "job-let-go"]) {
    const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/window", { method: "POST", body: { event } });
    assert.deepEqual([response.status, payload], [200, { ok: true, kept: false }], event);
  }
  assert.deepEqual([gateway.calls.topLevel.length, gateway.calls.bound.length], [before.length, 0]);
});

test("through the gateway the preview says no fee, and the job's tax goes as nought", async () => {
  const gateway = fakeIndustryGateway({ timeMultiplier: 0.68 });
  const { baseUrl } = await startTestServer({ gateway, staticData: { ...fakeStaticData(), getSolarSystem: () => ({ security: 0.9 }) } });
  await selectOnServer(baseUrl);
  const preview = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  await apiRequest(baseUrl, "/api/bridge/industry/install", { method: "POST", body: installBody({ timeEfficiency: 5 }) });
  assert.deepEqual([preview.payload.fee, preview.payload.timeSeconds, sentJobs(gateway, "InstallJob")[0].tax, sentJobs(gateway, "InstallJob")[0].cost], [null, 1163, 0, 0]);
});

test("a blueprint's time research is a whole number from nought to twenty, or the request is refused before anything is asked", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  for (const timeEfficiency of [-1, 21, 2.5, "five", "5", true]) {
    for (const route of ["preview", "install"]) {
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

test("the preview reads what the player HAS and always RELEASES its monitor", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/preview", {
    method: "POST",
    body: installBody({ confirm: undefined }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(payload.available, { [String(MATERIAL_TYPE_ID)]: 500 });

  // ConnectJob is NOT a pure read - it persists a monitor row - so the route
  // always releases the monitor it opened.
  const disconnect = gateway.calls.topLevel.find((call) => call.method === "DisconnectJob");
  assert.ok(disconnect, "the monitor must be released");
  assert.deepEqual(disconnect.args, [MONITOR_ID]);

  // The preview starts NOTHING.
  assert.equal(gateway.calls.topLevel.some((call) => call.method === "InstallJob"), false);
  assert.equal(gateway.jobs.size, 0);
});

test("the preview answers only once its monitor is let go of, so that a write which follows its answer finds the pilot free", async () => {
  // Measured live, 2026-10-11: an install asked the instant a preview answered was refused CHARACTER_IN_USE, the
  // preview's DisconnectJob still being made (one write at a time for a pilot: src/pilotMutationFence.js).
  const events = [];
  const gateway = fakeIndustryGateway({
    onRelease: async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      events.push("let go");
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() });
  events.push("answered");
  assert.deepEqual([response.status, payload.available], [200, { [String(MATERIAL_TYPE_ID)]: 500 }]);
  assert.deepEqual(events, ["let go", "answered"]);

  // A letting go that fails does not make an error of a good preview: it is answered all the same, and after.
  const failing = fakeIndustryGateway({
    onRelease: async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      events.push("not let go");
      throw Object.assign(new Error("gone"), { code: "CALL_FAILED", statusCode: 502 });
    },
  });
  const second = await startTestServer({ gateway: failing });
  await selectOnServer(second.baseUrl);
  const again = await apiRequest(second.baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() });
  events.push("answered again");
  assert.deepEqual([again.response.status, again.payload.ok], [200, true]);
  assert.deepEqual(events.slice(2), ["not let go", "answered again"]);

  // A preview the server refuses is answered with the refusal, and no monitor is let go of: none was made.
  const refusing = fakeIndustryGateway({ failures: ["industryMonitor.ConnectJob"] });
  const third = await startTestServer({ gateway: refusing });
  await selectOnServer(third.baseUrl);
  const refused = await apiRequest(third.baseUrl, "/api/bridge/industry/preview", { method: "POST", body: installBody() });
  assert.deepEqual([refused.response.status, refused.payload.error], [409, "CALL_REFUSED"]);
  assert.equal(refusing.calls.topLevel.some((call) => call.method === "DisconnectJob"), false);
});

test("the preview needs no confirmation - it spends nothing", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/bridge/industry/preview", {
    method: "POST",
    body: { ...installBody(), confirm: false },
  });
  assert.equal(response.status, 200);
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
    ["/api/bridge/industry/preview", installBody()],
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
// compares that map EXACTLY with its own (src/industryInstall.js). Every other
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
  assert.equal(payload.productTypeID, INVENTED_TYPE_ID, "the invented blueprint, as the server resolves it");
  // The facility's modifiers are read for it, the way the retail client does.
  assert.ok(gateway.calls.topLevel.some((call) => call.method === "GetFacilities"));
});

test("without a decryptor, install keeps sending an empty materials map and reads no facility", async () => {
  const gateway = fakeIndustryGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/industry/install", {
    method: "POST",
    body: installBody({ activity: "invention", runs: 3 }),
  });
  const install = gateway.calls.topLevel.find((call) => call.method === "InstallJob");
  assert.deepEqual(install.args[0].materials, {});
  assert.equal("optionalTypeID" in install.args[0], false);
  assert.equal(gateway.calls.topLevel.some((call) => call.method === "GetFacilities"), false);
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
