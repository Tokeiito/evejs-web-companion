"use strict";

// Goal R3: the BFF Inventory & Ship routes drive the bound-object bridge. The
// browser addresses items/ships by their GAME IDs; the BFF holds the gateway's
// opaque bound-object handles server-side (never sent to the browser) and maps
// the game IDs to them: bind hangar/cargo/ship, then List/Add/StackAll/Board.
// Wire contract: docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const gatewayClient = require("../src/eveGatewayClient");
const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = { username: "pilot", accountID: 4, role: "0", banned: false };
const CHARACTERS = [{ characterID: 7, accountID: 4, characterName: "Test Pilot" }];
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const STATION_ID = 60003760;
const ACTIVE_SHIP_ID = 9001;
const SELECT_SESSION_ECHO = {
  userid: 4,
  characterID: 7,
  characterName: "Test Pilot",
  stationID: STATION_ID,
  structureID: null,
  solarSystemID: 30000142,
  corporationID: 98000000,
  shipID: ACTIVE_SHIP_ID,
};

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
      return Number(accountID) === ACCOUNT.accountID &&
        CHARACTERS.some((c) => c.characterID === Number(characterID))
        ? { ...CHARACTERS[0] }
        : null;
    },
    async releaseCharacterControl() {
      return { controlState: "offline" };
    },
  };
}

function fakeStaticData() {
  return {
    getStation() { return null; },
    getTypeName(id) { return `Type ${id}`; },
    // The inventory route reads per-type VOLUME off the static tables to build
    // its `volumes` map (no bridge call). Tritanium's real 0.01 m³ stands in for
    // every type here; a double without this method 500s the whole route.
    getType(id) { return { typeID: id, volume: 0.01 }; },
  };
}

function packedRow(fields) {
  return { type: "packedrow", fields };
}

function keyVal(entries) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

// A fake gateway recording bind/bound-call traffic and answering List/Capacity
// with handler-shaped fixtures. Each bind returns a handle derived from its
// (service, method, args) so the test can assert which handle a bound call used.
function fakeGateway(overrides = {}) {
  const calls = { select: [], release: [], call: [], bind: [], boundCall: [] };
  const state = { activeShipID: ACTIVE_SHIP_ID };
  const gateway = {
    calls,
    state,
    async selectCharacter(args, kwargs, sessionFields) {
      calls.select.push({ args, kwargs, sessionFields });
      return {
        bridgeSessionID: BRIDGE_SESSION_ID,
        service: "charUnboundMgr",
        method: "SelectCharacterID",
        result: null,
        notifications: [],
        session: { ...SELECT_SESSION_ECHO },
      };
    },
    async releaseBridgeSession(bridgeSessionID, sessionFields) {
      calls.release.push({ bridgeSessionID, sessionFields });
      return { released: true, characterID: 7 };
    },
    async readFlightStatus(bridgeSessionID, sessionFields) {
      calls.flightStatus = calls.flightStatus || [];
      calls.flightStatus.push({ bridgeSessionID, sessionFields });
      // Docked at the same station: the station-sync keeps held.stationID here.
      return {
        flight: {
          docked: true,
          inSpace: false,
          stationID: STATION_ID,
          solarSystemID: 30000142,
          shipID: state.activeShipID,
        },
        notifications: [],
      };
    },
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.call.push({ service, method, args, kwargs, sessionFields, bridgeSessionID });
      if (method === "LeaveShip" || method === "Eject" || method === "StoreVessel") {
        state.activeShipID = 9900;
      } else if (method === "CreateNewbieShip") {
        state.activeShipID = 9901;
      } else if (method === "BoardStoredShip") {
        state.activeShipID = Number(args[1]) || state.activeShipID;
      }
      return { service, method, result: method === "SafeLogoff" ? [] : null, notifications: [] };
    },
    async bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.bind.push({ service, method, args, kwargs, sessionFields, bridgeSessionID });
      return {
        boundHandle: `handle:${service}:${method}:${JSON.stringify(args)}`,
        service,
        method,
        notifications: [],
      };
    },
    async callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) {
      calls.boundCall.push({ service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle });
      if (method === "Board") {
        state.activeShipID = Number(args[0]) || state.activeShipID;
      }
      let result = null;
      if (method === "List") {
        result = {
          type: "list",
          items: [packedRow({ itemID: 100, typeID: 34, categoryID: 4, flagID: args[0], quantity: 750, singleton: 0 })],
        };
      } else if (method === "GetCapacity") {
        result = keyVal([["capacity", 1000], ["used", 7.5]]);
      }
      return { service, method, result, notifications: [] };
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
    staticData: fakeStaticData(),
    errorLogger() {},
    transitionReadyTimeoutMs: options.transitionReadyTimeoutMs,
    transitionPollMs: options.transitionPollMs,
    transitionSleep: options.transitionSleep,
    transitionNow: options.transitionNow,
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

async function selectOnServer(baseUrl) {
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
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

test("GET /api/bridge/inventory binds hangar + cargo and lists both; no handle reaches the browser", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.stationID, STATION_ID);
  assert.equal(payload.activeShipID, ACTIVE_SHIP_ID);
  assert.ok(payload.hangar.list, "hangar list present");
  assert.ok(payload.cargo.list, "cargo list present");
  assert.equal(payload.hangar.error, null);

  // The bound OID / handle must never cross to the browser.
  assert.equal(JSON.stringify(payload).includes("handle:"), false);

  // Hangar bound via invbroker.GetInventory([stationID]); cargo via
  // invbroker.GetInventoryFromId([shipID]).
  assert.ok(gateway.calls.bind.some((b) => b.service === "invbroker" && b.method === "GetInventory" && b.args[0] === STATION_ID));
  assert.ok(gateway.calls.bind.some((b) => b.service === "invbroker" && b.method === "GetInventoryFromId" && b.args[0] === ACTIVE_SHIP_ID));
  // Every bound call rode the held bridge session and a hangar/cargo handle.
  for (const call of gateway.calls.boundCall) {
    assert.equal(call.bridgeSessionID, BRIDGE_SESSION_ID);
    assert.match(call.boundHandle, /^handle:invbroker:/);
  }
  // List(flag) and GetCapacity(flag) dispatched for both containers.
  const methods = gateway.calls.boundCall.map((c) => `${c.method}(${c.args[0]})`);
  assert.ok(methods.includes("List(4)") && methods.includes("GetCapacity(4)"));
  assert.ok(methods.includes("List(5)") && methods.includes("GetCapacity(5)"));
});

test("a dock at a NEW station re-targets station-scoped reads (held station synced from live flight)", async () => {
  const NEW_STATION = 60011866;
  const gateway = fakeGateway({
    // The character has since docked at a different station (e.g. an autopilot
    // arrival) than the select-time one.
    async readFlightStatus() {
      return {
        flight: { docked: true, inSpace: false, stationID: NEW_STATION, solarSystemID: 30000144, shipID: ACTIVE_SHIP_ID },
        notifications: [],
      };
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl); // select-time station is STATION_ID

  const { payload } = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(payload.stationID, NEW_STATION, "inventory reflects the new docked station, not the select-time one");
  assert.ok(
    gateway.calls.bind.some((b) => b.method === "GetInventory" && b.args[0] === NEW_STATION),
    "hangar bound at the NEW station",
  );
  assert.ok(
    !gateway.calls.bind.some((b) => b.method === "GetInventory" && b.args[0] === STATION_ID),
    "hangar not bound at the stale select-time station",
  );
});

test("structure personal hangar stays unknown and load/unload refuse unavailable service authority", async () => {
  const structureID = 1_030_000_000_011;
  const FLAG_HANGAR = 4, FLAG_CARGO = 5;
  const placement = new Map([[100, { flag: FLAG_HANGAR, quantity: 5, typeID: 34 }],
    [101, { flag: FLAG_CARGO, quantity: 3, typeID: 35 }]]);
  let permitMove = true;
  const gateway = fakeGateway();
  const select = gateway.selectCharacter.bind(gateway);
  gateway.selectCharacter = async (...args) => {
    const result = await select(...args);
    return { ...result, session: { ...result.session, stationID: null, structureID } };
  };
  gateway.readFlightStatus = async () => ({ flight: { docked: true, inSpace: false, stationID: null,
    structureID, solarSystemID: 30000142, shipID: ACTIVE_SHIP_ID }, notifications: [] });
  gateway.callMethod = async (_service, method) => {
    if (method === "GetMyAccessibleStructureServices") assert.fail("Private service authority must not be called");
    return { result: { type: "list", items: method === "CheckMyDockingAccessToStructures" ? [structureID] : [] }, notifications: [] };
  };
  gateway.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle) => {
    gateway.calls.boundCall.push({ service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle });
    if (method === "Add") {
      const item = placement.get(args[0]);
      assert.ok(item);
      assert.equal(args[1], item.flag === FLAG_HANGAR ? structureID : ACTIVE_SHIP_ID);
      if (permitMove) item.flag = kwargs.flag;
    }
    if (method === "List") return { result: { type: "list", items: [...placement].filter(([, item]) => item.flag === args[0])
      .map(([itemID, item]) => packedRow({ itemID, typeID: item.typeID, categoryID: 4, flagID: item.flag,
        quantity: item.quantity, singleton: 0 })) }, notifications: [] };
    if (method === "GetCapacity") return { result: keyVal([["capacity", 1000], ["used", 1]]), notifications: [] };
    return { result: null, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const panel = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(panel.response.status, 409);
  assert.equal(panel.payload.error, "STRUCTURE_SERVICE_AUTHORITY_UNAVAILABLE");
  assert.equal(gateway.calls.bind.some((bind) => bind.method === "GetInventory" && bind.args[0] === structureID), false);
  // (The fitting route this asked too went on 2026-10-14: a fitting is the page's own call.)
  // (The move route, which this asked too, went on 2026-10-13: nothing of the page asked it.)
  assert.equal(placement.get(100).flag, FLAG_HANGAR);
  assert.equal(placement.get(101).flag, FLAG_CARGO);
  assert.equal(gateway.calls.boundCall.some(call => call.method === "Add"), false);
});

// (A test held the move route to an ambiguous docked flight: the route went on 2026-10-13, nothing of the page
// asking it.)

test("a bind handle is reused across reads (cached per semantic key)", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  await apiRequest(baseUrl, "/api/bridge/inventory");
  await apiRequest(baseUrl, "/api/bridge/inventory");

  // Two panel loads (4 hangar + 4 cargo reads) but only one hangar bind and
  // one cargo bind: the handles are cached per semantic key.
  const hangarBinds = gateway.calls.bind.filter((b) => b.method === "GetInventory").length;
  const cargoBinds = gateway.calls.bind.filter((b) => b.method === "GetInventoryFromId").length;
  assert.equal(hangarBinds, 1);
  assert.equal(cargoBinds, 1);
});

// (Two tests held the move route to Add on the hold's or the hangar's binding: the route went on 2026-10-13,
// nothing of the page asking it. The page moves things by the transfer.)

// (A test held the stack route to StackAll on the place's binding: the route went on 2026-10-14, the page's own
// call taking its place.)

// (Two tests held the board's route (POST /api/bridge/ship/board) to Board on the ship's binding, with the ship left,
// and to its failure after the server took it: the route went on 2026-10-14, the page boarding by its own call under
// the generic call's keeping of a swap of the pilot's ship, held to the ship boarded.)

test("leaving the ship is a write of the page's own, made under the BFF's own watch of the swap: it answers once the pilot is in the capsule", async () => {
  const gateway = fakeGateway();
  let clockMs = 0;
  const { baseUrl } = await startTestServer({
    gateway,
    transitionNow: () => clockMs,
    transitionSleep: async (ms) => { clockMs += ms; },
  });
  await selectOnServer(baseUrl);
  const call = (more) => apiRequest(baseUrl, "/api/bridge/call", { method: "POST", body: { service: "ship", method: "LeaveShip", args: [ACTIVE_SHIP_ID], kwargs: null, ...more } });
  const left = () => gateway.calls.call.filter((each) => each.method === "LeaveShip");
  for (const more of [{}, { pilot: true }, { confirm: true }]) {
    const refused = await call(more);
    assert.deepEqual([refused.response.status, refused.payload.error], [403, "BRIDGE_WRITE_REFUSED"], JSON.stringify(more));
  }
  assert.equal(left().length, 0);

  const made = await call({ pilot: true, confirm: true });
  // The generic call's own answer, and none of the route's: the page reads its ship again for itself.
  assert.deepEqual([made.response.status, made.payload.ok, made.payload.service, made.payload.method, Array.isArray(made.payload.notifications)], [200, true, "ship", "LeaveShip", true]);
  assert.deepEqual([made.payload.applied, made.payload.activeShipID, made.payload.flight, made.payload.transition], [undefined, undefined, undefined, undefined]);
  // station.TryLeaveShip (236 to 251): GetShipAccess().LeaveShip(shipid), once.
  assert.deepEqual(left().map((each) => [each.service, each.args, each.kwargs]), [["ship", [ACTIVE_SHIP_ID], null]]);
  // The BFF's own word for the pilot's ship is the capsule from then on, as after the route's.
  const inventory = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(inventory.payload.activeShipID, 9900);
  // (The next swap's wait was seen through the stored ship's route, which went on 2026-10-14 with the plumbing's other unasked writes (the loop's item 62).)
});

test("a corvette boarded is a write of the page's own, made under the BFF's own watch of the swap, with the client's two arguments", async () => {
  const gateway = fakeGateway();
  let clockMs = 0;
  const { baseUrl } = await startTestServer({
    gateway,
    transitionNow: () => clockMs,
    transitionSleep: async (ms) => { clockMs += ms; },
  });
  await selectOnServer(baseUrl);
  const call = (more) => apiRequest(baseUrl, "/api/bridge/call", { method: "POST", body: { service: "dogmaIM", method: "CreateNewbieShip", args: [ACTIVE_SHIP_ID, STATION_ID], kwargs: null, ...more } });
  const boarded = () => gateway.calls.call.filter((each) => each.method === "CreateNewbieShip");
  for (const more of [{}, { pilot: true }, { confirm: true }]) {
    const refused = await call(more);
    assert.deepEqual([refused.response.status, refused.payload.error], [403, "BRIDGE_WRITE_REFUSED"], JSON.stringify(more));
  }
  assert.equal(boarded().length, 0);

  const made = await call({ pilot: true, confirm: true });
  // The generic call's own answer, and none of the route's.
  assert.deepEqual([made.response.status, made.payload.ok, made.payload.service, made.payload.method, Array.isArray(made.payload.notifications)], [200, true, "dogmaIM", "CreateNewbieShip", true]);
  assert.deepEqual([made.payload.applied, made.payload.activeShipID, made.payload.flight, made.payload.transition], [undefined, undefined, undefined, undefined]);
  // station.CreateNewbieShip (base.py 613): sm.RemoteSvc('dogmaIM').CreateNewbieShip(shipID, locationID), once, by the service's name.
  assert.deepEqual(boarded().map((each) => [each.service, each.args, each.kwargs]), [["dogmaIM", [ACTIVE_SHIP_ID, STATION_ID], null]]);
  assert.equal(gateway.calls.boundCall.some((each) => each.method === "CreateNewbieShip"), false);
  // The BFF's own word for the pilot's ship is the corvette from then on, as after the route's.
  const inventory = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(inventory.payload.activeShipID, 9901);
  // (The next swap's wait was seen through the stored ship's route, which went on 2026-10-14 with the plumbing's other unasked writes (the loop's item 62).)
});

test("a corvette asked for with no pilot held is refused as its route refused it", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  const refused = await apiRequest(baseUrl, "/api/bridge/call", { method: "POST", body: { service: "dogmaIM", method: "CreateNewbieShip", args: [ACTIVE_SHIP_ID, STATION_ID], kwargs: null, pilot: true, confirm: true } });
  assert.deepEqual([refused.response.status, refused.payload.error], [409, "NO_LIVE_SESSION"]);
  assert.equal(gateway.calls.call.filter((each) => each.method === "CreateNewbieShip").length, 0);
});

test("the ship's other swaps are their routes' alone, whatever the generic call is told", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  const before = gateway.calls.call.length;
  for (const [service, method, args] of [["ship", "Eject", []], ["ship", "BoardStoredShip", [1_000_000_001, 2200]], ["ship", "StoreVessel", [1, 2]]]) {
    const refused = await apiRequest(baseUrl, "/api/bridge/call", { method: "POST", body: { service, method, args, kwargs: null, pilot: true, confirm: true } });
    assert.deepEqual([refused.response.status, refused.payload.error], [403, "BRIDGE_WRITE_REFUSED"], `${service}.${method}`);
  }
  assert.equal(gateway.calls.call.length, before);
});

test("a ship left with no pilot held is refused as its route refused it", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  const refused = await apiRequest(baseUrl, "/api/bridge/call", { method: "POST", body: { service: "ship", method: "LeaveShip", args: [ACTIVE_SHIP_ID], kwargs: null, pilot: true, confirm: true } });
  assert.deepEqual([refused.response.status, refused.payload.error], [409, "NO_LIVE_SESSION"]);
  assert.equal(gateway.calls.call.filter((each) => each.method === "LeaveShip").length, 0);
});

test("inventory routes require a live session and pass gateway refusals through", async () => {
  const { baseUrl } = await startTestServer({ gateway: fakeGateway() });

  // No character online yet.
  const noSession = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(noSession.response.status, 409);
  assert.equal(noSession.payload.error, "NO_LIVE_SESSION");

  // A refused bound method passes through with its gateway status.
  const refusingGateway = fakeGateway({
    async callBoundMethod() {
      throw new gatewayClient.EveGatewayError("not allowed", { code: "CALL_NOT_ALLOWED", statusCode: 403 });
    },
  });
  const refused = await startTestServer({ gateway: refusingGateway });
  await selectOnServer(refused.baseUrl);
  // (By the generic call on the hangar's own inventory, as the page stacks it: the routes this went by are gone.)
  const stacked = await apiRequest(refused.baseUrl, "/api/bridge/call", {
    method: "POST",
    body: { service: "invbroker", method: "StackAll", args: [4], kwargs: null, pilot: true, confirm: true, of: "hangar" },
  });
  assert.equal(stacked.response.status, 403);
  assert.equal(stacked.payload.error, "CALL_NOT_ALLOWED");
});

test("a lost persistent session during an inventory read drops the held handle", async () => {
  const gateway = fakeGateway({
    async callBoundMethod() {
      throw new gatewayClient.EveGatewayError("gone", { code: "SESSION_NOT_FOUND", statusCode: 404 });
    },
  });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  // (By the generic call on the hangar's own inventory, as the page stacks it: the routes this went by are gone.)
  const stacked = await apiRequest(baseUrl, "/api/bridge/call", {
    method: "POST",
    body: { service: "invbroker", method: "StackAll", args: [4], kwargs: null, pilot: true, confirm: true, of: "hangar" },
  });
  assert.equal(stacked.response.status, 404);
  assert.equal(stacked.payload.error, "SESSION_NOT_FOUND");

  // The stale handle was dropped: releasing now reports nothing held.
  const { payload } = await apiRequest(baseUrl, "/api/bridge/release", { method: "POST", body: {} });
  assert.deepEqual(payload, { ok: true, released: false });
});
