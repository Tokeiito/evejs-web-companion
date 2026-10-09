"use strict";

// Goal R2: persistent browser-backed sessions through the BFF. The gateway
// mints an opaque bridgeSessionID on select-character; the BFF keeps it
// server-side keyed by the signed web session and forwards it on bridge
// calls — it must never reach browser JS. Wire contract:
// docs/bridge-wire-contract.md.

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const gatewayClient = require("../src/eveGatewayClient");
const { createApp } = require("../src/server");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = {
  username: "pilot",
  accountID: 4,
  role: "0",
  banned: false,
};
const CHARACTERS = [
  { characterID: 7, accountID: 4, characterName: "Test Pilot" },
];
const BRIDGE_SESSION_ID = "opaque-gateway-minted-bridge-session-id";
const SELECT_SESSION_ECHO = {
  userid: 4,
  shipID: 9001,
  characterID: 7,
  characterName: "Test Pilot",
  stationID: 60003760,
  structureID: null,
  solarSystemID: 30000142,
  corporationID: 98000000,
};
const STATION_STATIC = {
  stationID: 60003760,
  stationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
  solarSystemName: "Jita",
  regionName: "The Forge",
  stationTypeID: 1529,
  operationID: 26,
  security: 0.9,
};

const ORIGINAL_FETCH = global.fetch;
const ENV_NAMES = ["EVEJS_GATEWAY_URL", "EVEJS_WEB_GATEWAY_TOKEN"];
const ORIGINAL_ENV = Object.fromEntries(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

const activeServers = new Set();

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type"
          ? "application/json"
          : null;
      },
    },
    async json() {
      return body;
    },
  };
}

function gatewayResponse(body = {}) {
  return {
    ok: true,
    source: "evejs-web-gateway",
    apiVersion: 1,
    ...body,
  };
}

function fakeAuth() {
  return {
    createSessionToken() {
      return COOKIE_TOKEN;
    },
    verifySessionToken(token) {
      return token === COOKIE_TOKEN
        ? {
          username: ACCOUNT.username,
          accountID: ACCOUNT.accountID,
          sessionID: SESSION_ID,
        }
        : null;
    },
    countConfiguredUsers() {
      return 1;
    },
  };
}

function fakeStore(overrides = {}) {
  return {
    async getAccount(username) {
      return username === ACCOUNT.username ? { ...ACCOUNT } : null;
    },
    async listCharactersForAccount(accountID) {
      return Number(accountID) === ACCOUNT.accountID
        ? CHARACTERS.map((character) => ({ ...character }))
        : [];
    },
    async getCharacterForAccount(accountID, characterID) {
      return Number(accountID) === ACCOUNT.accountID &&
        CHARACTERS.some((character) => character.characterID === Number(characterID))
        ? { ...CHARACTERS[0] }
        : null;
    },
    async releaseCharacterControl() {
      return { controlState: "offline" };
    },
    ...overrides,
  };
}

function fakeStaticData() {
  return {
    getStation(stationID) {
      return Number(stationID) === STATION_STATIC.stationID
        ? { ...STATION_STATIC }
        : null;
    },
    getTypeName(typeID) {
      return Number(typeID) === STATION_STATIC.stationTypeID
        ? "Caldari Administrative Station"
        : `Type ${typeID}`;
    },
  };
}

async function acknowledgeRecovery(baseUrl) {
  const selected = await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST", body: { characterID: 7 },
  });
  assert.equal(selected.response.status, 200);
  const ready = await apiRequest(baseUrl, "/api/bridge/drone-recovery/ready", {
    method: "POST", body: { checkID: selected.payload.droneRecoveryCheckID },
  });
  assert.equal(ready.response.status, 200, JSON.stringify(ready.payload));
}

function fakeGateway(overrides = {}) {
  const calls = { select: [], release: [], call: [] };
  const gateway = {
    calls,
    async readFlightStatus() {
      return { flight: { docked: true, inSpace: false, stationID: 60003760, shipID: 9001 }, notifications: [] };
    },
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
    async callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID) {
      calls.call.push({ service, method, args, kwargs, sessionFields, bridgeSessionID });
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
    gamePortPilots: options.gamePortPilots,
    pilotTransportFor: options.pilotTransportFor,
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

test.afterEach(async () => {
  global.fetch = ORIGINAL_FETCH;
  for (const name of ENV_NAMES) {
    if (ORIGINAL_ENV[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = ORIGINAL_ENV[name];
    }
  }
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }));
  }
  await Promise.all(closing);
});

test("gateway client selectCharacter posts the retail tuple to /session/select", async () => {
  process.env.EVEJS_GATEWAY_URL = "http://gateway.test/_evejs-web/v1";
  process.env.EVEJS_WEB_GATEWAY_TOKEN = "server-secret";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(200, gatewayResponse({
      bridgeSessionID: BRIDGE_SESSION_ID,
      service: "charUnboundMgr",
      method: "SelectCharacterID",
      result: null,
      notifications: [],
      session: SELECT_SESSION_ECHO,
    }));
  };

  const outcome = await gatewayClient.selectCharacter(
    [7, null, true],
    null,
    { userid: 4, userName: "pilot" },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://gateway.test/_evejs-web/v1/session/select");
  assert.equal(calls[0].options.headers["x-evejs-web-token"], "server-secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    args: [7, null, true],
    kwargs: null,
    session: { userid: 4, userName: "pilot" },
  });
  assert.equal(outcome.bridgeSessionID, BRIDGE_SESSION_ID);
  assert.deepEqual(outcome.session, SELECT_SESSION_ECHO);
});

test("gateway client releaseBridgeSession posts the handle to /session/release", async () => {
  process.env.EVEJS_GATEWAY_URL = "http://gateway.test/_evejs-web/v1";
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse(200, gatewayResponse({ released: true, characterID: 7 }));
  };

  const outcome = await gatewayClient.releaseBridgeSession(BRIDGE_SESSION_ID, { userid: 4 });

  assert.equal(calls[0].url, "http://gateway.test/_evejs-web/v1/session/release");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    bridgeSessionID: BRIDGE_SESSION_ID,
    session: { userid: 4 },
  });
  assert.deepEqual(outcome, { released: true, characterID: 7 });
  assert.equal(Object.hasOwn(outcome, "offline"), false, "handle release is not authoritative offline proof");
});

test("gateway client callMethod forwards a bridgeSessionID only when supplied", async () => {
  process.env.EVEJS_GATEWAY_URL = "http://gateway.test/_evejs-web/v1";
  const bodies = [];
  global.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return jsonResponse(200, gatewayResponse({
      service: "station",
      method: "GetGuests",
      result: { type: "list", items: [] },
      notifications: [],
    }));
  };

  await gatewayClient.callMethod("station", "GetGuests", [], null, { userid: 4 });
  await gatewayClient.callMethod(
    "station",
    "GetGuests",
    [],
    null,
    { userid: 4 },
    BRIDGE_SESSION_ID,
  );

  assert.equal("bridgeSessionID" in bodies[0], false);
  assert.equal(bodies[1].bridgeSessionID, BRIDGE_SESSION_ID);
});

test("select pins identity, keeps the bridgeSessionID server-side, and returns character + static station", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  // The opaque gateway handle must never reach browser JS.
  assert.equal(JSON.stringify(payload).includes(BRIDGE_SESSION_ID), false);
  assert.deepEqual(payload.character, {
    characterID: 7,
    characterName: "Test Pilot",
    stationID: 60003760,
    structureID: null,
    solarSystemID: 30000142,
    corporationID: 98000000,
  });
  assert.equal(payload.station.stationName, STATION_STATIC.stationName);
  assert.equal(payload.station.stationTypeName, "Caldari Administrative Station");
  assert.deepEqual(payload.notifications, []);
  // Identity is pinned to the signed login session.
  assert.deepEqual(gateway.calls.select, [{
    args: [7, null, true],
    kwargs: null,
    sessionFields: { userid: 4, userName: "pilot" },
  }]);
});

test("after select, bridge calls ride the held persistent session; browser-supplied handles are ignored", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });

  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });
  const { response } = await apiRequest(baseUrl, "/api/bridge/call", {
    method: "POST",
    body: {
      service: "station",
      method: "GetGuests",
      args: [],
      kwargs: null,
      // Spoofed handle from the browser must not survive.
      bridgeSessionID: "spoofed-browser-handle",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(gateway.calls.call.length, 1);
  assert.equal(gateway.calls.call[0].bridgeSessionID, BRIDGE_SESSION_ID);
});

test("selecting again releases the previously held bridge session first", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });

  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });
  await acknowledgeRecovery(baseUrl);
  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });

  assert.equal(gateway.calls.select.length, 2);
  assert.deepEqual(gateway.calls.release, [{
    bridgeSessionID: BRIDGE_SESSION_ID,
    sessionFields: { userid: 4 },
  }]);
});

test("release ends the held session and later calls go back to stateless", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });

  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });
  await acknowledgeRecovery(baseUrl);
  const { payload: releasePayload } = await apiRequest(baseUrl, "/api/bridge/release", {
    method: "POST",
    body: {},
  });
  assert.deepEqual(releasePayload, { ok: true, released: true });
  assert.equal(gateway.calls.release.length, 1);

  const again = await apiRequest(baseUrl, "/api/bridge/release", {
    method: "POST",
    body: {},
  });
  assert.deepEqual(again.payload, { ok: true, released: false });

  await apiRequest(baseUrl, "/api/bridge/call", {
    method: "POST",
    body: { service: "map", method: "GetStationInfo" },
  });
  assert.equal(gateway.calls.call[0].bridgeSessionID, undefined);
});

test("SESSION_NOT_FOUND from the gateway drops the stale handle and surfaces the typed error", async () => {
  const gateway = fakeGateway({
    async callMethod() {
      throw new gatewayClient.EveGatewayError("Unknown, expired, or released bridge session.", {
        code: "SESSION_NOT_FOUND",
        statusCode: 404,
      });
    },
  });
  const { baseUrl } = await startTestServer({ gateway });

  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/call", {
    method: "POST",
    body: { service: "station", method: "GetGuests" },
  });
  assert.equal(response.status, 404);
  assert.equal(payload.error, "SESSION_NOT_FOUND");

  // The stale handle is gone: releasing now reports nothing held.
  const { payload: releasePayload } = await apiRequest(baseUrl, "/api/bridge/release", {
    method: "POST",
    body: {},
  });
  assert.deepEqual(releasePayload, { ok: true, released: false });
});

test("a release the gateway never answered retains the held owner for reconciliation", async () => {
  const gateway = fakeGateway({
    async releaseBridgeSession() {
      throw new gatewayClient.EveGatewayError("EveJS gateway timed out.", {
        code: "EVE_GATEWAY_TIMEOUT",
      });
    },
  });
  const { baseUrl } = await startTestServer({ gateway });

  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });
  await acknowledgeRecovery(baseUrl);
  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/release", {
    method: "POST",
    body: {},
  });
  assert.equal(response.status, 502, JSON.stringify(payload));
  assert.equal(payload.error, "EVE_GATEWAY_TIMEOUT");

  // The handle remains owned: a second unanswered release must not claim it
  // was already forgotten.
  const again = await apiRequest(baseUrl, "/api/bridge/release", {
    method: "POST",
    body: {},
  });
  assert.equal(again.response.status, 502);
  assert.equal(again.payload.error, "EVE_GATEWAY_TIMEOUT");
  await apiRequest(baseUrl, "/api/bridge/call", {
    method: "POST", body: { service: "map", method: "GetStationInfo" },
  });
  assert.equal(gateway.calls.call[0].bridgeSessionID, BRIDGE_SESSION_ID);
});

test("an unconfirmed release preserves the held session instead of reporting success", async () => {
  const gateway = fakeGateway({ releaseBridgeSession: async () => ({ released: false }) });
  const { baseUrl } = await startTestServer({ gateway });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  await acknowledgeRecovery(baseUrl);
  const refused = await apiRequest(baseUrl, "/api/bridge/release", { method: "POST", body: {} });
  assert.equal(refused.response.status, 409);
  assert.equal(refused.payload.error, "PILOT_RELEASE_UNVERIFIED");
  await apiRequest(baseUrl, "/api/bridge/call", {
    method: "POST", body: { service: "map", method: "GetStationInfo" },
  });
  assert.equal(gateway.calls.call[0].bridgeSessionID, BRIDGE_SESSION_ID);
});

test("select refusals pass through with the handler's own message", async () => {
  const gateway = fakeGateway({
    async selectCharacter() {
      throw new gatewayClient.EveGatewayError("Test Pilot is already online.", {
        code: "CALL_REFUSED",
        statusCode: 409,
      });
    },
  });
  const { baseUrl } = await startTestServer({ gateway });

  const { response, payload } = await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });
  assert.equal(response.status, 409);
  assert.equal(payload.error, "CALL_REFUSED");
  assert.match(payload.message, /already online/i);
});

test("select validates ownership and requires auth", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });

  const unknown = await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 999 },
  });
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.payload.error, "CHARACTER_NOT_FOUND");

  const invalid = await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: -1 },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error, "INVALID_CHARACTER");

  const unauthenticated = await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    authenticated: false,
    body: { characterID: 7 },
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.payload.error, "AUTH_REQUIRED");
  assert.equal(gateway.calls.select.length, 0);
});

test("logout releases the held bridge session", async () => {
  const gateway = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway });

  await apiRequest(baseUrl, "/api/bridge/select", {
    method: "POST",
    body: { characterID: 7 },
  });
  await acknowledgeRecovery(baseUrl);
  const { response } = await apiRequest(baseUrl, "/api/logout", {
    method: "POST",
    body: {},
  });
  assert.equal(response.status, 200);
  assert.equal(gateway.calls.release.length, 1);
  assert.equal(gateway.calls.release[0].bridgeSessionID, BRIDGE_SESSION_ID);
});

// ── The pilot's transport (src/pilotTransport.js) ────────────────────────────

const GAME_PORT_SESSION_ID = "gp:opaque-game-port-session-id";

test("a pilot the setting sends to the game port is selected, called and released there, and never on the gateway", async () => {
  const gateway = fakeGateway();
  // The game-port transport answers as the gateway client does; only the handle differs.
  const gamePort = fakeGateway({
    async selectCharacter(args, kwargs, sessionFields) {
      gamePort.calls.select.push({ args, kwargs, sessionFields });
      return {
        bridgeSessionID: GAME_PORT_SESSION_ID,
        service: "charUnboundMgr",
        method: "SelectCharacterID",
        result: null,
        notifications: [],
        session: { ...SELECT_SESSION_ECHO },
      };
    },
  });
  const asked = [];
  const { baseUrl } = await startTestServer({
    gateway,
    gamePortPilots: gamePort,
    pilotTransportFor(who) {
      asked.push(who);
      return "gameport";
    },
  });

  const selected = await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  assert.equal(selected.response.status, 200);
  assert.equal(JSON.stringify(selected.payload).includes(GAME_PORT_SESSION_ID), false, "the handle never reaches the browser");
  assert.equal(selected.payload.character.characterID, 7);
  assert.deepEqual(asked, [{ accountID: 4, characterID: 7, userName: "pilot" }]);
  assert.deepEqual(gamePort.calls.select, [{ args: [7, null, true], kwargs: null, sessionFields: { userid: 4, userName: "pilot" } }]);

  const called = await apiRequest(baseUrl, "/api/bridge/call", {
    method: "POST",
    body: { service: "station", method: "GetGuests", args: [], kwargs: null },
  });
  assert.equal(called.response.status, 200);
  assert.equal(gamePort.calls.call.length, 1);
  assert.equal(gamePort.calls.call[0].bridgeSessionID, GAME_PORT_SESSION_ID);

  const ready = await apiRequest(baseUrl, "/api/bridge/drone-recovery/ready", {
    method: "POST", body: { checkID: selected.payload.droneRecoveryCheckID },
  });
  assert.equal(ready.response.status, 200, JSON.stringify(ready.payload));
  const released = await apiRequest(baseUrl, "/api/bridge/release", { method: "POST", body: {} });
  assert.deepEqual(released.payload, { ok: true, released: true });
  assert.deepEqual(gamePort.calls.release, [{ bridgeSessionID: GAME_PORT_SESSION_ID, sessionFields: { userid: 4 } }]);

  // Nothing about this pilot went to the gateway.
  assert.deepEqual(gateway.calls, { select: [], release: [], call: [] });

  // With no pilot held, a call is an account-level one again: the gateway's.
  await apiRequest(baseUrl, "/api/bridge/call", { method: "POST", body: { service: "map", method: "GetStationInfo" } });
  assert.equal(gateway.calls.call.length, 1);
  assert.equal(gateway.calls.call[0].bridgeSessionID, undefined);
  assert.equal(gamePort.calls.call.length, 1);
});

test("a game-port transport that is present but not chosen is never touched", async () => {
  const gateway = fakeGateway();
  const gamePort = fakeGateway();
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => "gateway" });

  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  await apiRequest(baseUrl, "/api/bridge/call", { method: "POST", body: { service: "station", method: "GetGuests" } });

  assert.equal(gateway.calls.select.length, 1);
  assert.equal(gateway.calls.call[0].bridgeSessionID, BRIDGE_SESSION_ID);
  assert.deepEqual(gamePort.calls, { select: [], release: [], call: [] });
});


// ── The server's questions (POST /api/bridge/questions/:id/answer) ───────────

function gamePortWithQuestions(answer) {
  const gamePort = fakeGateway({
    async selectCharacter() {
      return {
        bridgeSessionID: GAME_PORT_SESSION_ID,
        service: "charUnboundMgr",
        method: "SelectCharacterID",
        result: null,
        notifications: [],
        session: { ...SELECT_SESSION_ECHO },
      };
    },
    answers: [],
    async answerClientQuestion(bridgeSessionID, questionID, given, sessionFields) {
      gamePort.answers.push({ bridgeSessionID, questionID, given, sessionFields });
      return answer(questionID);
    },
  });
  return gamePort;
}

test("the user's answer to a question the server asked goes to the game-port pilot it was asked of", async () => {
  const gamePort = gamePortWithQuestions((questionID) => {
    if (questionID === "gone") {
      throw Object.assign(new Error("That question is no longer open."), { code: "QUESTION_NOT_FOUND", statusCode: 404 });
    }
    return { answered: true, questionID };
  });
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  const answer = (id, body) => apiRequest(baseUrl, `/api/bridge/questions/${id}/answer`, { method: "POST", body });

  // Before a pilot is selected there is nobody a question could have been asked of.
  assert.equal((await answer("q1", { answer: true })).response.status, 409);

  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const no = await answer("q1", { answer: false });
  assert.equal(no.response.status, 200, JSON.stringify(no.payload));
  assert.deepEqual(no.payload, { ok: true, answered: true });
  // The answer as given, false and all, to the pilot's own session and under the pilot's own account.
  assert.deepEqual(gamePort.answers, [{ bridgeSessionID: GAME_PORT_SESSION_ID, questionID: "q1", given: false, sessionFields: { userid: 4 } }]);

  // No answer at all is not an answer; nothing is passed on.
  const empty = await answer("q1", {});
  assert.equal(empty.response.status, 400);
  assert.equal(empty.payload.error, "INVALID_ANSWER");
  assert.equal(gamePort.answers.length, 1);

  // A question that has closed says so.
  const gone = await answer("gone", { answer: true });
  assert.equal(gone.response.status, 404);
  assert.equal(gone.payload.error, "QUESTION_NOT_FOUND");
});

test("a gateway pilot has no question open, and the game port is not asked about one", async () => {
  const gamePort = gamePortWithQuestions((questionID) => ({ answered: true, questionID }));
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gateway" });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answered = await apiRequest(baseUrl, "/api/bridge/questions/q1/answer", { method: "POST", body: { answer: true } });
  assert.equal(answered.response.status, 404);
  assert.equal(answered.payload.error, "QUESTION_NOT_FOUND");
  assert.deepEqual(gamePort.answers, []);
});

test("a question is answered while the write that caused it is still waiting on the server", async () => {
  // What happens live: the browser presses Decline, the server asks "are you sure" before it answers that press,
  // and the answer has to get through while the press is still in flight. One write per pilot at a time is the
  // rule for everything else; an answer is the rest of the write in flight, not a second one.
  let finishPress;
  const gamePort = gamePortWithQuestions((questionID) => {
    finishPress({ service: "agentMgr", method: "DoAction", result: ["the conversation after"], notifications: [] });
    return { answered: true, questionID };
  });
  gamePort.bindObject = async () => ({ boundHandle: "bound-agent", notifications: [] });
  gamePort.callBoundMethod = () => new Promise((resolve) => { finishPress = resolve; });
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });

  const press = apiRequest(baseUrl, "/api/bridge/agents/3008416/action", { method: "POST", body: { actionID: 378 } });
  for (let waited = 0; finishPress === undefined && waited < 200; waited += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(typeof finishPress, "function", "the press reached the pilot and is waiting");

  // Another write for the same pilot is turned away while the press is in flight...
  const other = await apiRequest(baseUrl, "/api/bridge/flight/stop", { method: "POST", body: {} });
  assert.equal(other.response.status, 409);
  assert.equal(other.payload.error, "CHARACTER_IN_USE");
  // ...and the answer is not.
  const answered = await apiRequest(baseUrl, "/api/bridge/questions/q1/answer", { method: "POST", body: { answer: true } });
  if (answered.response.status !== 200) {
    // Let the press go before failing, or the server this test started never closes.
    finishPress({ service: "agentMgr", method: "DoAction", result: null, notifications: [] });
    await press;
  }
  assert.equal(answered.response.status, 200, JSON.stringify(answered.payload));
  const pressed = await press;
  assert.equal(pressed.response.status, 200, JSON.stringify(pressed.payload));
  assert.deepEqual(pressed.payload.result, ["the conversation after"]);
});

// ── A mission's keywords (GET /api/bridge/agents/:agentID/keywords) ──────────

test("a mission's keywords are asked of the bound agent, by the mission's content ID", async () => {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const bound = [];
  gamePort.bindObject = async (service, method, args) => { bound.push({ service, method, args }); return { boundHandle: "bound-agent", notifications: [] }; };
  const calls = [];
  gamePort.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    calls.push({ service, method, args, bridgeSessionID, handle });
    return { service, method, result: { type: "dict", entries: [["objectiveLocationSystemID", 30000120]] }, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  const keywords = (agent, query) => apiRequest(baseUrl, `/api/bridge/agents/${agent}/keywords${query}`);

  // No pilot, no agent to ask.
  assert.equal((await keywords(3008416, "?contentID=4802")).response.status, 409);
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });

  const answer = await keywords(3008416, "?contentID=4802");
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  assert.deepEqual(answer.payload, { ok: true, keywords: { type: "dict", entries: [["objectiveLocationSystemID", 30000120]] }, notifications: [] });
  assert.deepEqual(bound, [{ service: "agentMgr", method: "MachoBindObject", args: [3008416] }]);
  assert.deepEqual(calls, [{ service: "agentMgr", method: "GetMissionKeywords", args: [4802], bridgeSessionID: GAME_PORT_SESSION_ID, handle: "bound-agent" }]);

  // What is not an agent or not a mission is refused before anything is asked.
  for (const [agent, query, error] of [
    [0, "?contentID=4802", "INVALID_AGENT"], ["x", "?contentID=4802", "INVALID_AGENT"],
    [3008416, "", "INVALID_CONTENT"], [3008416, "?contentID=0", "INVALID_CONTENT"], [3008416, "?contentID=abc", "INVALID_CONTENT"], [3008416, "?contentID=1.5", "INVALID_CONTENT"],
  ]) {
    const refused = await keywords(agent, query);
    assert.equal(refused.response.status, 400, `${agent} ${query}`);
    assert.equal(refused.payload.error, error);
  }
  assert.equal(calls.length, 1);
});

// ── The agent's window, read as it is laid out (GET /api/bridge/agents/:agentID/briefing) ──

test("the briefing's three reads are asked of the bound agent in the order the client's window asks them", async () => {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  gamePort.bindObject = async () => ({ boundHandle: "bound-agent", notifications: [] });
  const calls = [];
  gamePort.callBoundMethod = async (service, method, args) => {
    calls.push([service, method, args]);
    if (method === "GetMissionObjectiveInfo") throw Object.assign(new Error("no mission"), { code: "CALL_FAILED" });
    return { service, method, result: method, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answer = await apiRequest(baseUrl, "/api/bridge/agents/3008416/briefing");
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  // agentDialogueWindow.ReconstructLayout: the agent's place for the header, the briefing, then the objectives.
  assert.deepEqual(calls, [
    ["agentMgr", "GetAgentLocationWrap", []],
    ["agentMgr", "GetMissionBriefingInfo", []],
    ["agentMgr", "GetMissionObjectiveInfo", []],
  ]);
  // Each answer under its own name, and a read that failed says so without blanking the others.
  assert.deepEqual(answer.payload, {
    ok: true,
    agentID: 3008416,
    briefing: "GetMissionBriefingInfo",
    objective: null,
    location: "GetAgentLocationWrap",
    errors: { briefing: null, objective: "CALL_FAILED", location: null },
  });
});

// ── The journal's "Remove Offer" (POST /api/bridge/agents/:agentID/remove-offer) ──

test("an offer is removed by asking the agent's own bound object, with no arguments, as the client asks", async () => {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const bound = [];
  gamePort.bindObject = async (service, method, args) => { bound.push({ service, method, args }); return { boundHandle: "bound-agent", notifications: [] }; };
  const calls = [];
  gamePort.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    calls.push({ service, method, args, kwargs, bridgeSessionID, handle });
    return { service, method, result: null, notifications: [{ method: "OnAgentMissionChange", args: ["offer_removed", 3008416] }] };
  };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  const remove = (agent, body) => apiRequest(baseUrl, `/api/bridge/agents/${agent}/remove-offer`, { method: "POST", body });

  // No pilot, no agent to ask.
  assert.equal((await remove(3008416, { confirm: true })).response.status, 409);
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });

  // Not confirmed, or not an agent: nothing is bound and nothing is asked.
  const unconfirmed = await remove(3008416, {});
  assert.equal(unconfirmed.response.status, 400);
  assert.equal(unconfirmed.payload.error, "CONFIRMATION_REQUIRED");
  for (const agent of [0, "x", -5, "1.5"]) {
    const refused = await remove(agent, { confirm: true });
    assert.equal(refused.response.status, 400, String(agent));
    assert.equal(refused.payload.error, "INVALID_AGENT");
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(bound, []);

  const removed = await remove(3008416, { confirm: true });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.payload));
  // What the server pushed because of it goes back with the answer.
  assert.deepEqual(removed.payload, { ok: true, result: null, notifications: [{ method: "OnAgentMissionChange", args: ["offer_removed", 3008416] }] });
  assert.deepEqual(bound, [{ service: "agentMgr", method: "MachoBindObject", args: [3008416] }]);
  assert.deepEqual(calls, [{ service: "agentMgr", method: "RemoveOfferFromJournal", args: [], kwargs: null, bridgeSessionID: GAME_PORT_SESSION_ID, handle: "bound-agent" }]);

  // The route that asked the service by name, with no agent, is gone.
  const old = await ORIGINAL_FETCH(`${baseUrl}/api/bridge/agent/journal/remove-offer`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `evejs_web_poc=${COOKIE_TOKEN}` },
    body: JSON.stringify({ confirm: true }),
  });
  assert.equal(old.status, 404);
  assert.equal(calls.length, 1);
});
