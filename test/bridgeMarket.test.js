"use strict";

// Goal R16 (Slice A): the BFF market READ route and the tradable-item search.
//
// ⚠ THE SERVICE NAME IS THE WHOLE POINT OF THE FIRST TEST. EveJS registers two
// market services: `market` (marketService.js) is a DEAD STUB whose every
// method answers an empty rowset, and `marketProxy` (marketProxyService.js) is
// the real one. Calling the stub gives a market page that renders perfectly and
// is permanently empty — which reads as a bridge bug and would be very hard to
// find. So this suite asserts, by name, that every call the route issues is on
// `marketProxy` and that `market` is never named.
//
// The other properties this pins:
//
//   - INDEPENDENCE. Seven reads run under Promise.allSettled, so a player whose
//     order book fails still sees their own orders, their trades and their ISK.
//   - SCOPE. Not one read takes an owner or a location argument: the region
//     comes from the session, the character comes from the session. The only
//     argument any of them takes is the typeID the player chose.
//   - THE DAEMON. marketProxy is backed by an out-of-process daemon on TCP
//     127.0.0.1:40111. When it is down the reads THROW, and the route reports
//     an OUTAGE rather than an empty market — because "nobody is trading this"
//     and "the market is not answering" are different facts.
//   - THE ITEM SEARCH is pure static data, so it answers with no live session
//     at all, and it is the only way the panel ever obtains a typeID (the
//     player must never be asked for one — R7d).
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
const TYPE_ID = 34;

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

function fakeStaticData() {
  return {
    getStation() {
      return null;
    },
    getTypeName(id) {
      return `Type ${id}`;
    },
    resolveNames() {
      return { names: {}, capped: false, limit: 500 };
    },
    findMarketTypes(filters) {
      const q = String((filters && filters.q) || "").trim();
      if (q.length < 2) {
        return { matches: [], total: 0, capped: false, q, limit: 25 };
      }
      return {
        matches: [{ typeID: TYPE_ID, name: "Tritanium", groupName: "Mineral" }],
        total: 1,
        capped: false,
        q,
        limit: 25,
      };
    },
  };
}

// --- marshaled-value builders (the server's own encodings) ------------------

function long(value) {
  return { type: "long", value: String(value) };
}

function list(items) {
  return { type: "list", items };
}

function keyVal(entries) {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

/**
 * The retail cached envelope in its INLINE form: the payload rides args[1] as
 * a substream. (map.GetStationInfo uses the other form, a cached-OBJECT
 * reference, which the browser genuinely cannot decode — the market does not.)
 */
function cached(payload) {
  return {
    type: "object",
    name: { value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [null, { type: "substream", value: payload }, null],
  };
}

const ORDER_COLUMNS = [
  "price", "volRemaining", "typeID", "range", "orderID", "volEntered", "minVolume",
  "bid", "issueDate", "duration", "stationID", "regionID", "solarSystemID",
  "constellationID", "jumps",
];

function orderRowset(lines) {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["columns", list(ORDER_COLUMNS)],
        ["RowClass", { type: "token", value: "blue.DBRow" }],
        ["lines", list(lines)],
      ],
    },
  };
}

function orderLine(overrides = {}) {
  const fields = {
    price: 5.51,
    volRemaining: 1200,
    typeID: TYPE_ID,
    range: 0,
    orderID: long("8000000001"),
    volEntered: 2000,
    minVolume: 1,
    bid: 0,
    issueDate: long("133000000000000000"),
    duration: 30,
    stationID: STATION_ID,
    regionID: 10000002,
    solarSystemID: SOLAR_SYSTEM_ID,
    constellationID: 20000020,
    jumps: 0,
    ...overrides,
  };
  return ORDER_COLUMNS.map((column) => fields[column]);
}

const OWN_COLUMNS = [
  "orderID", "typeID", "charID", "regionID", "stationID", "range", "bid", "price",
  "volEntered", "volRemaining", "issueDate", "minVolume", "contraband", "duration",
  "isCorp", "solarSystemID", "escrow", "constellationID", "keyID", "orderState",
  "lastStateChange",
];

function ownOrderRowset(rows) {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["columns", list(OWN_COLUMNS)],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", list(rows.map((row) => list(OWN_COLUMNS.map((column) => row[column] ?? null))))],
      ],
    },
  };
}

function ownOrder(overrides = {}) {
  return {
    orderID: long("8000000101"),
    typeID: TYPE_ID,
    charID: CHARACTER_ID,
    regionID: 10000002,
    stationID: STATION_ID,
    range: 5,
    bid: 1,
    price: 4.9,
    volEntered: 1000,
    volRemaining: 500,
    issueDate: long("133000000000000000"),
    minVolume: 1,
    contraband: 0,
    duration: 30,
    isCorp: 0,
    solarSystemID: SOLAR_SYSTEM_ID,
    escrow: 2450,
    constellationID: 20000020,
    keyID: 1000,
    orderState: 0,
    lastStateChange: null,
    ...overrides,
  };
}

/**
 * A gateway fake for the market surface. `failures` names (service, method)
 * pairs that should throw, so the independence of the reads can be exercised
 * one at a time; `daemonDown` makes every marketProxy read fail the way a dead
 * daemon on 40111 makes them fail.
 */
function fakeGateway(options = {}) {
  const calls = { topLevel: [] };
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
      if (options.daemonDown && service === "marketProxy") {
        throw Object.assign(
          new Error("MarketUnavailable: the market daemon is not reachable"),
          { code: "CALL_FAILED" },
        );
      }
      if (failures.has(`${service}.${method}`)) {
        throw Object.assign(new Error(`${service}.${method} failed`), { code: "CALL_FAILED" });
      }
      if (service === "marketProxy" && method === "GetOrders") {
        return {
          service,
          method,
          // ⚠ A cached envelope around a 2-TUPLE [sells, buys].
          result: cached([
            orderRowset([orderLine({ bid: 0, price: 5.51 })]),
            orderRowset([orderLine({ bid: 1, price: 4.9, orderID: long("8000000002") })]),
          ]),
          notifications: [],
        };
      }
      if (service === "marketProxy" && method === "GetCharOrders") {
        return { service, method, result: cached(ownOrderRowset([ownOrder()])), notifications: [] };
      }
      if (service === "marketProxy" && method === "GetMarketOrderHistory") {
        return {
          service,
          method,
          result: cached(ownOrderRowset([ownOrder({ orderID: long("8000000102"), orderState: 1 })])),
          notifications: [],
        };
      }
      if (service === "marketProxy" && method === "CharGetTransactions") {
        return {
          service,
          method,
          result: list([
            keyVal([
              ["transactionID", 1],
              ["typeID", TYPE_ID],
              ["quantity", 100],
              ["price", 5.5],
              ["stationID", STATION_ID],
              ["buyerID", CHARACTER_ID],
              ["sellerID", 999],
              ["transactionDate", long("133000000000000000")],
            ]),
          ]),
          notifications: [],
        };
      }
      if (service === "marketProxy" && method === "GetCharEscrow") {
        return {
          service,
          method,
          result: keyVal([["iskEscrow", 2450], ["itemsEscrow", 3]]),
          notifications: [],
        };
      }
      if (service === "account" && method === "GetCashBalance") {
        return { service, method, result: long("125000000"), notifications: [] };
      }
      return { service, method, result: null, notifications: [] };
    },
    async bindObject() {
      throw new Error("the market needs no bound objects");
    },
    async callBoundMethod() {
      throw new Error("the market needs no bound objects");
    },
  };
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

// --- the service name -------------------------------------------------------

test("every market call is on marketProxy — the `market` service is NEVER named", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  await apiRequest(baseUrl, `/api/bridge/market?typeID=${TYPE_ID}`);

  const services = new Set(gateway.calls.topLevel.map((call) => call.service));
  // ⚠ marketService.js is a DEAD STUB. Naming it here would answer empty
  // rowsets forever and look exactly like a bug in this bridge.
  assert.equal(
    services.has("market"),
    false,
    'the dead-stub "market" service must never be called',
  );
  assert.ok(services.has("marketProxy"), "the real service is marketProxy");
});

// --- the read route ---------------------------------------------------------

test("GET /api/bridge/market issues the seven top-level reads and NO bind", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, `/api/bridge/market?typeID=${TYPE_ID}`);
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  // Every market call is TOP-LEVEL. A bind makes the fake throw, so this is
  // enforced rather than merely asserted.
  const issued = gateway.calls.topLevel.map((call) => `${call.service}.${call.method}`);
  for (const pair of [
    "marketProxy.GetOrders",
    "marketProxy.GetCharOrders",
    "marketProxy.GetMarketOrderHistory",
    "marketProxy.CharGetTransactions",
    "marketProxy.GetCharEscrow",
    "marketProxy.GetNewPriceHistory",
    "account.GetCashBalance",
  ]) {
    assert.ok(issued.includes(pair), `expected ${pair} to be issued`);
  }
  // Each read rides the SAME held bridge session.
  for (const call of gateway.calls.topLevel) {
    assert.equal(call.bridgeSessionID, BRIDGE_SESSION_ID);
  }
});

test("the ONLY argument any read takes is the typeID — no owner, no location", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);
  await apiRequest(baseUrl, `/api/bridge/market?typeID=${TYPE_ID}`);

  const by = (method) =>
    gateway.calls.topLevel.find((call) => call.service === "marketProxy" && call.method === method);

  // ⚠ THE SECURITY PROPERTY. The region GetOrders searches and the character
  // whose orders/trades/escrow are read come from the SESSION the gateway
  // materialized. There is no parameter here a browser could tamper with to
  // reach another character or another region.
  assert.deepEqual(by("GetOrders").args, [TYPE_ID]);
  assert.deepEqual(by("GetCharOrders").args, []);
  assert.deepEqual(by("GetMarketOrderHistory").args, []);
  assert.deepEqual(by("GetCharEscrow").args, []);
  // fromDate 0 = everything the server still keeps.
  assert.deepEqual(by("CharGetTransactions").args, [0]);
  // Positional only, every time.
  for (const call of gateway.calls.topLevel) {
    assert.equal(call.kwargs, null, `${call.service}.${call.method} must be positional`);
  }
});

test("with no item chosen the order book is SKIPPED, and the rest still answers", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, "/api/bridge/market");
  assert.equal(payload.ok, true);
  assert.equal(payload.typeID, null);
  assert.equal(payload.book.result, null);
  // The player's own market is worth showing before they pick anything.
  const issued = gateway.calls.topLevel.map((call) => `${call.service}.${call.method}`);
  assert.equal(issued.includes("marketProxy.GetOrders"), false);
  assert.ok(issued.includes("marketProxy.GetCharOrders"));
  assert.ok(issued.includes("account.GetCashBalance"));
});

test("the route hands back the RAW retail-shaped results for the browser to decode", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, `/api/bridge/market?typeID=${TYPE_ID}`);
  // The cached envelope survives intact: the BFF does not pre-decode, so the
  // browser's decoder is the single place the shape is understood.
  assert.equal(payload.book.result.type, "object");
  assert.match(String(payload.book.result.name.value), /CachedMethodCallResult$/);
  assert.equal(payload.cashBalance.result.type, "long");
  assert.equal(payload.characterID, CHARACTER_ID);
});

// --- independence -----------------------------------------------------------

test("a failed order book keeps its OWN error and never blanks the other reads", async () => {
  const gateway = fakeGateway({ failures: ["marketProxy.GetOrders"] });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, `/api/bridge/market?typeID=${TYPE_ID}`);
  assert.equal(response.status, 200, "one failed read must not fail the route");
  assert.equal(payload.book.error, "CALL_FAILED");
  assert.equal(payload.book.result, null);
  // Everything else came through.
  assert.equal(payload.ownOrders.error, null);
  assert.notEqual(payload.ownOrders.result, null);
  assert.notEqual(payload.cashBalance.result, null);
});

test("a failed WALLET read never blanks the order book", async () => {
  const gateway = fakeGateway({ failures: ["account.GetCashBalance"] });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, `/api/bridge/market?typeID=${TYPE_ID}`);
  assert.equal(payload.cashBalance.error, "CALL_FAILED");
  assert.notEqual(payload.book.result, null);
});

// --- the external daemon ----------------------------------------------------

test("a DOWN market daemon is reported as an OUTAGE, not as an empty market", async () => {
  const gateway = fakeGateway({ daemonDown: true });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { response, payload } = await apiRequest(baseUrl, `/api/bridge/market?typeID=${TYPE_ID}`);
  assert.equal(response.status, 200);
  // ⚠ THE POINT. Without this the panel would say "nobody is trading this and
  // you have no orders", which is a lie about the player's own position.
  assert.match(String(payload.marketUnavailable), /not answering/);
  assert.equal(payload.book.error, "CALL_FAILED");
  // The wallet is NOT daemon-backed, so it still answers.
  assert.notEqual(payload.cashBalance.result, null);
});

test("an ordinary read failure is NOT reported as a daemon outage", async () => {
  const gateway = fakeGateway({ failures: ["marketProxy.GetOrders"] });
  const { baseUrl } = await startTestServer({ gateway });
  await selectOnServer(baseUrl);

  const { payload } = await apiRequest(baseUrl, `/api/bridge/market?typeID=${TYPE_ID}`);
  assert.equal(payload.marketUnavailable, null, "only a real outage says the market is down");
});

// --- the item search --------------------------------------------------------

test("GET /api/market/find searches by NAME and touches the gateway not at all", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  // Deliberately NO character selected: this is static reference data, so it
  // must answer even before a session exists (and when the market is down).
  const { response, payload } = await apiRequest(baseUrl, "/api/market/find?q=tritan");
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "static-data");
  assert.equal(payload.matches[0].name, "Tritanium");
  assert.equal(gateway.calls.topLevel.length, 0, "the search is not a bridge call");
});

test("a query too short to be useful returns nothing rather than the whole table", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  const { payload } = await apiRequest(baseUrl, "/api/market/find?q=t");
  assert.deepEqual(payload.matches, []);
});

// --- session handling -------------------------------------------------------

test("the market route requires a held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/market");
  assert.equal(response.status, 409);
  assert.equal(payload.ok, false);
});
