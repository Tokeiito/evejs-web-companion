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
    ...(options.clientBuiltData ? { clientBuiltData: options.clientBuiltData } : {}),
    ...(options.clientConstants ? { clientConstants: options.clientConstants } : {}),
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

// ── The journal's "Read Details" (GET /api/bridge/agents/:agentID/mission-objectives) ──

test("a mission's page reads its objectives from the agent's own bound object, with ignoreLocateCheck and nothing else, as the client's job board does", async () => {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const bound = [];
  gamePort.bindObject = async (service, method, args) => { bound.push({ service, method, args }); return { boundHandle: "bound-agent", notifications: [] }; };
  const calls = [];
  const objective = { type: "dict", entries: [["contentID", 2156], ["missionState", 1]] };
  gamePort.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    calls.push({ service, method, args, kwargs, bridgeSessionID, handle });
    return { service, method, result: objective, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  const read = (agent) => apiRequest(baseUrl, `/api/bridge/agents/${agent}/mission-objectives`);

  // No pilot, no agent to ask.
  assert.equal((await read(3008416)).response.status, 409);
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });

  // Not an agent: nothing is bound and nothing is asked.
  for (const agent of [0, "x", -5, "1.5"]) {
    const refused = await read(agent);
    assert.equal(refused.response.status, 400, String(agent));
    assert.equal(refused.payload.error, "INVALID_AGENT");
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(bound, []);

  const answered = await read(3008416);
  assert.equal(answered.response.status, 200, JSON.stringify(answered.payload));
  // Raw: the browser decodes it.
  assert.deepEqual(answered.payload, { ok: true, agentID: 3008416, objective, notifications: [] });
  assert.deepEqual(bound, [{ service: "agentMgr", method: "MachoBindObject", args: [3008416] }]);
  assert.deepEqual(calls, [{ service: "agentMgr", method: "GetMissionObjectiveInfo", args: [], kwargs: { ignoreLocateCheck: true }, bridgeSessionID: GAME_PORT_SESSION_ID, handle: "bound-agent" }]);
});

// ── What the client's agents service knows of an agent (GET /api/bridge/agents/:agentID/record) ──

/** agentMgr.GetAgents as the server answers it: a rowset of every agent. */
const AGENT_TABLE = {
  type: "object",
  name: "util.Rowset",
  args: {
    type: "dict",
    entries: [
      ["header", { type: "list", items: ["agentID", "agentTypeID", "divisionID", "level", "stationID", "corporationID"] }],
      ["lines", { type: "list", items: [
        { type: "list", items: [3008416, 2, 22, 1, 60000004, 1000002] },
        { type: "list", items: [3011895, 2, 24, 1, 60000019, 1000017] },
        { type: "list", items: [3019999, 4, null, 3, null, null] },
      ] }],
    ],
  },
};

function builtData(tables, available = true) {
  const asked = [];
  return {
    asked,
    available: () => available,
    async lookup(name, key) {
      asked.push([name, key]);
      return available ? { available: true, row: (tables[name] || {})[key] ?? null } : { available: false, row: null };
    },
  };
}

test("an agent's record is its row of the agents table, with its corporation's faction and its division's name from the client's own data", async () => {
  const calls = [];
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  gamePort.callMethod = async (service, method, args, kwargs) => {
    calls.push({ service, method, args, kwargs });
    return { service, method, result: AGENT_TABLE, notifications: [] };
  };
  const clientBuiltData = builtData({ npcCorporations: { 1000002: { factionID: 500001, nameID: 9 }, 1000017: { nameID: 9 } }, npcCorporationDivisions: { 22: { nameID: 900109, internalName: "x" } } });
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport", clientBuiltData });
  const read = (agent) => apiRequest(baseUrl, `/api/bridge/agents/${agent}/record`);

  // No pilot, nobody to ask through.
  assert.equal((await read(3008416)).response.status, 409);
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  for (const agent of [0, "x", -5, "1.5"]) {
    const refused = await read(agent);
    assert.equal(refused.response.status, 400, String(agent));
    assert.equal(refused.payload.error, "INVALID_AGENT");
  }
  calls.length = 0;

  const found = await read(3008416);
  assert.equal(found.response.status, 200, JSON.stringify(found.payload));
  assert.deepEqual(found.payload, { ok: true, agent: { agentID: 3008416, agentTypeID: 2, divisionID: 22, level: 1, stationID: 60000004, corporationID: 1000002, factionID: 500001, divisionNameID: 900109 } });
  // The table is asked for as the client asks: the whole of it, with nothing.
  assert.deepEqual(calls.filter((call) => call.method === "GetAgents"), [{ service: "agentMgr", method: "GetAgents", args: [], kwargs: null }]);
  assert.deepEqual(clientBuiltData.asked, [["npcCorporations", 1000002], ["npcCorporationDivisions", 22]]);

  // A corporation with no faction in the client's record, and a division the client does not have: null, each.
  assert.deepEqual((await read(3011895)).payload.agent, { agentID: 3011895, agentTypeID: 2, divisionID: 24, level: 1, stationID: 60000019, corporationID: 1000017, factionID: null, divisionNameID: null });
  // An agent with no corporation and no division asks the client for neither.
  clientBuiltData.asked.length = 0;
  assert.deepEqual((await read(3019999)).payload.agent, { agentID: 3019999, agentTypeID: 4, divisionID: null, level: 3, stationID: null, corporationID: null, factionID: null, divisionNameID: null });
  assert.deepEqual(clientBuiltData.asked, []);
  // An agent the server does not list.
  assert.deepEqual((await read(3000001)).payload, { ok: true, agent: null });
  // And the table was read once for all of that, as the client reads it once.
  assert.equal(calls.filter((call) => call.method === "GetAgents").length, 1);
});

// ── The wallet (GET /api/bridge/wallet) ──────────────────────────────────────

test("the wallet reads what the retail client reads: no journal by any other call, and the transactions with False for the pilot's own", async () => {
  const calls = [];
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  gamePort.callMethod = async (service, method, args, kwargs) => {
    calls.push({ service, method, args, kwargs });
    if (method === "GetTransactions") return { service, method, result: { type: "list", items: [] }, notifications: [] };
    return { service, method, result: method === "GetCashBalance" ? 42 : null, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  calls.length = 0;
  const wallet = await apiRequest(baseUrl, "/api/bridge/wallet");
  assert.equal(wallet.response.status, 200, JSON.stringify(wallet.payload));
  assert.deepEqual(calls.map((call) => [`${call.service}.${call.method}`, call.args, call.kwargs]).sort((a, b) => a[0].localeCompare(b[0])), [
    ["account.GetCashBalance", [0], null],
    ["account.GetEntryTypes", [], null],
    // accountsvc.py 116: GetTransactions(accountingKeyCash, year, month, False).
    ["account.GetTransactions", [1000, null, null, false], null],
    ["account.GetWalletDivisionsInfo", [], null],
    ["corpRegistry.GetCorporation", [], null],
  ]);
  assert.equal(wallet.payload.cash, 42);
  assert.deepEqual(wallet.payload.transactions, { type: "list", items: [] });
  // The journal is not a read of its own any more, nor an error of its own.
  assert.equal("journal" in wallet.payload, false);
  assert.deepEqual(Object.keys(wallet.payload.errors).sort(), ["cash", "corp", "divisions", "entryTypes", "transactions"]);
});

// ── Standings (GET /api/bridge/standings) ────────────────────────────────────

test("a pilot in an NPC corporation is asked for its own standings alone; in a player's corporation, for the corporation's too", async () => {
  for (const [corporationID, asked] of [[1000044, ["GetCharStandings"]], [98000001, ["GetCharStandings", "GetCorpStandings"]], [90000000, ["GetCharStandings", "GetCorpStandings"]], [10001, ["GetCharStandings"]]]) {
    const calls = [];
    const gamePort = gamePortWithQuestions(() => ({ answered: true }));
    const select = gamePort.selectCharacter;
    gamePort.selectCharacter = async (...args) => {
      const selected = await select(...args);
      return { ...selected, session: { ...selected.session, corporationID, corpid: corporationID } };
    };
    gamePort.callMethod = async (service, method, args, kwargs) => {
      calls.push({ service, method, args, kwargs });
      return { service, method, result: { type: "list", items: [] }, notifications: [] };
    };
    const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
    await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
    calls.length = 0;
    const standings = await apiRequest(baseUrl, "/api/bridge/standings");
    assert.equal(standings.response.status, 200, JSON.stringify(standings.payload));
    assert.deepEqual(calls.filter((call) => call.service === "standingMgr").map((call) => call.method).sort(), asked, String(corporationID));
    // Not asked is not a failure: no standings and no error, as the client takes an NPC corporation's to be none.
    assert.deepEqual([standings.payload.errors.char, standings.payload.errors.corp], [null, null], String(corporationID));
    assert.deepEqual(standings.payload.corp, asked.length === 1 ? null : { type: "list", items: [] }, String(corporationID));
  }
});

// ── The Inventory panel's holds (GET /api/bridge/inventory) ──────────────────

const HOLD_VOLUMES = { 77002: 16500, 77010: 0.01, 77011: 2, 77012: null };
const holdRow = (fields) => ({ type: "packedrow", fields: { itemID: 1, typeID: 77010, groupID: 18, categoryID: 4, flagID: 4, quantity: 1, stacksize: 1, singleton: 0, ...fields } });
const HANGAR_ROWS = [
  holdRow({ itemID: 9001, typeID: 77002, groupID: 901, categoryID: 6, quantity: -1, singleton: 1 }), // the active ship, assembled: 16500
  holdRow({ itemID: 9002, typeID: 77002, groupID: 901, categoryID: 6, quantity: 2, stacksize: 2 }),  // two packaged: 2 x 2500
  holdRow({ itemID: 9003, quantity: 1000, stacksize: 1000 }),                                        // 10
];
const CARGO_ROWS = [
  holdRow({ itemID: 9011, flagID: 5, quantity: 300, stacksize: 300 }),                               // 3
  holdRow({ itemID: 9012, flagID: 5, typeID: 77011, quantity: 40, stacksize: 40 }),                  // 80
  holdRow({ itemID: 9013, flagID: 87, typeID: 77011, quantity: 500, stacksize: 500 }),               // the drone bay's, not the cargo's
];
const holdConstants = (packaged = { byGroup: new Map([[901, 2500]]), byType: new Map(), plasticWrapTypeID: 77099 }) => ({ packagedVolumes: async () => packaged });
const holdStatics = () => ({ ...fakeStaticData(), getType: (typeID) => (HOLD_VOLUMES[typeID] === undefined ? null : { typeID, volume: HOLD_VOLUMES[typeID] }) });

/** A game-port pilot, docked, whose inventories answer the rows above; the capacity the server would give is a marked one. */
async function inventoryOnGamePort({ shipAttribute = async () => 3900, constants = holdConstants(), hangar = HANGAR_ROWS, cargo = CARGO_ROWS, statics = holdStatics(), shipID = SELECT_SESSION_ECHO.shipID } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const select = gamePort.selectCharacter;
  gamePort.selectCharacter = async (...args) => {
    const selected = await select(...args);
    return { ...selected, session: { ...selected.session, shipID } };
  };
  gamePort.readFlightStatus = async () => ({ flight: { docked: true, inSpace: false, stationID: SELECT_SESSION_ECHO.stationID, solarSystemID: SELECT_SESSION_ECHO.solarSystemID, shipID }, notifications: [] });
  gamePort.bindObject = async (service, method, args) => ({ boundHandle: `${method}:${args[0]}`, notifications: [] });
  const calls = [];
  gamePort.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    calls.push({ method, args, handle });
    if (method === "List") {
      const rows = handle.startsWith("GetInventoryFromId") ? cargo : hangar;
      if (rows === null) throw Object.assign(new Error("Refused"), { code: "CALL_REFUSED" });
      return { service, method, result: { type: "list", items: rows }, notifications: [] };
    }
    return { service, method, result: { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", 1000000], ["used", 777]] } }, notifications: [] };
  };
  const attributes = [];
  if (shipAttribute) gamePort.shipAttribute = async (attributeID, sessionFields, bridgeSessionID) => { attributes.push({ attributeID, sessionFields, bridgeSessionID }); return shipAttribute(attributeID); };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport", staticData: statics, clientConstants: constants });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answer = await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  return { payload: answer.payload, calls, attributes };
}
const capacityOf = (hold) => Object.fromEntries(hold.capacity.args.entries);

test("on the game port the Inventory panel's holds are reckoned as the client reckons them, and the server is not asked", async () => {
  const { payload, calls, attributes } = await inventoryOnGamePort();
  // invCache.py 1224, godma.py 871: the client never asks GetCapacity. Two Lists, and that is all.
  assert.deepEqual(calls.map((call) => [call.method, call.args]), [["List", [4]], ["List", [5]]]);
  // A station's hangar has no limit: the client's own figure for one. What is in it is summed the client's way:
  // the assembled ship by its type's volume, the packaged two by their group's, the stack by its own.
  assert.deepEqual(capacityOf(payload.hangar), { capacity: 9000000000000000, used: 16500 + 5000 + 10 });
  // The cargo: the ship's capacity as godma has it, and what the List answered in the cargo's own flag.
  assert.deepEqual(capacityOf(payload.cargo), { capacity: 3900, used: 83 });
  assert.deepEqual(attributes, [{ attributeID: 38, sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  assert.deepEqual([payload.hangar.error, payload.cargo.error], [null, null]);
  assert.deepEqual(payload.hangar.list.items, HANGAR_ROWS);
});

test("where the client's way cannot be followed, the hold's capacity is asked of the server as before", async () => {
  const asked = (calls) => calls.filter((call) => call.method === "GetCapacity").map((call) => call.args[0]);
  const fromServer = { capacity: 1000000, used: 777 };
  // No client to read the packaged volumes from: both.
  const noClient = await inventoryOnGamePort({ constants: { packagedVolumes: async () => null } });
  assert.deepEqual(asked(noClient.calls), [4, 5]);
  assert.deepEqual([capacityOf(noClient.payload.hangar), capacityOf(noClient.payload.cargo)], [fromServer, fromServer]);
  // Godma does not know the ship's capacity: the cargo alone.
  const noDogma = await inventoryOnGamePort({ shipAttribute: async () => null });
  assert.deepEqual(asked(noDogma.calls), [5]);
  assert.deepEqual([capacityOf(noDogma.payload.hangar).capacity, capacityOf(noDogma.payload.cargo)], [9000000000000000, fromServer]);
  // A transport that keeps no godma: the cargo alone.
  assert.deepEqual(asked((await inventoryOnGamePort({ shipAttribute: null })).calls), [5]);
  // Something in the hold whose volume nobody knows: that hold alone.
  const unknown = await inventoryOnGamePort({ cargo: [...CARGO_ROWS, holdRow({ itemID: 9014, flagID: 5, typeID: 77999 })] });
  assert.deepEqual(asked(unknown.calls), [5]);
  assert.deepEqual(capacityOf(unknown.payload.cargo), fromServer);
  // A type the static tables have, with no volume to it: the same.
  assert.deepEqual(asked((await inventoryOnGamePort({ cargo: [...CARGO_ROWS, holdRow({ itemID: 9015, flagID: 5, typeID: 77012 })] })).calls), [5]);
  // A row that is not one: that hold alone.
  assert.deepEqual(asked((await inventoryOnGamePort({ hangar: [...HANGAR_ROWS, { type: "list", items: [] }] })).calls), [4]);
  // Static tables that know no type's volume at all: both, for neither can be summed.
  assert.deepEqual(asked((await inventoryOnGamePort({ statics: fakeStaticData() })).calls), [4, 5]);
  // No ship: there is no cargo to reckon or to ask about, and godma is not troubled.
  const afoot = await inventoryOnGamePort({ shipID: null });
  assert.deepEqual([afoot.calls.map((call) => call.method), afoot.attributes, afoot.payload.cargo.error], [["List"], [], "NO_ACTIVE_SHIP"]);
  assert.equal(capacityOf(afoot.payload.hangar).capacity, 9000000000000000);
  // The List itself failing: nothing to sum, so that hold is asked, and the other is still reckoned.
  const hangarDown = await inventoryOnGamePort({ hangar: null });
  assert.deepEqual(asked(hangarDown.calls), [4]);
  assert.deepEqual(capacityOf(hangarDown.payload.cargo), { capacity: 3900, used: 83 });
  assert.equal(hangarDown.payload.hangar.error, "CALL_REFUSED");
});

test("on the gateway the Inventory panel's holds are asked of the server, as they were", async () => {
  const calls = [];
  const gateway = fakeGateway();
  gateway.readFlightStatus = async () => ({ flight: { docked: true, inSpace: false, stationID: SELECT_SESSION_ECHO.stationID, solarSystemID: SELECT_SESSION_ECHO.solarSystemID, shipID: SELECT_SESSION_ECHO.shipID }, notifications: [] });
  gateway.bindObject = async (service, method, args) => ({ boundHandle: `${method}:${args[0]}`, notifications: [] });
  gateway.callBoundMethod = async (service, method, args) => { calls.push([method, args]); return { service, method, result: method === "List" ? { type: "list", items: [] } : null, notifications: [] }; };
  const expected = [["GetCapacity", 4], ["GetCapacity", 5], ["List", 4], ["List", 5]];
  const { baseUrl } = await startTestServer({ gateway, staticData: holdStatics(), clientConstants: holdConstants() });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  await apiRequest(baseUrl, "/api/bridge/inventory");
  assert.deepEqual(calls.map(([method, args]) => [method, args[0]]).sort(), expected);
  // And so with a game port in the process, for a pilot who is not on it.
  calls.length = 0;
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  gamePort.shipAttribute = async () => { throw new Error("not this pilot's transport"); };
  const both = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => "gateway", staticData: holdStatics(), clientConstants: holdConstants() });
  await apiRequest(both.baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  assert.equal((await apiRequest(both.baseUrl, "/api/bridge/inventory")).response.status, 200);
  assert.deepEqual(calls.map(([method, args]) => [method, args[0]]).sort(), expected);
});

// ── A ship's bays (GET /api/bridge/ship/:shipID/bays) ────────────────────────

// The flags of every bay the route knows, each with a made-up attribute for its capacity: 3800 and the flag.
const BAY_FLAGS = [5, 87, 90, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 148, 149, 154, 155, 158, 174, 176, 177, 181, 182, 183, 185, 188];
const bayHolds = (flags = BAY_FLAGS) => ({
  byFlag: new Map(flags.map((flag) => [flag, 3800 + flag])),
  hasShipMaintenanceBay: 3701, hasFleetHangars: 3702, strategicCruiserGroupID: 963001, cargoFlag: 5, droneBayFlag: 87, shipHangarFlag: 90, fleetHangarFlag: 155,
});
// Two hulls: the one being flown (a miner: cargo, drones and an ore hold), and one in the hangar (a carrier of ships:
// cargo, a ship maintenance bay and a fleet hangar).
const BAY_TYPES = {
  // 1556 is the ore hold's capacity as the server pairs it, which the mining holds' route goes by off the game port.
  77002: { groupID: 901, volume: 16500, capacity: 400, attributes: { 3805: 400, 3887: 25, 3934: 5000, 1556: 5000 } },
  77003: { groupID: 902, volume: 92000, capacity: 900, attributes: { 3805: 899, 3701: 1, 3890: 1000000, 3702: 1, 3955: 10000 } },
  // A ship built of parts: no drone capacity of its own, and no capacity among its type's fields.
  77004: { groupID: 963001, volume: 5000, capacity: null, attributes: { 3805: 111 } },
  // A container, with a capacity among its type's fields; and one whose type has none.
  77020: { groupID: 340, volume: 3000, capacity: 1200, attributes: {} },
  77021: { groupID: 340, volume: 3000, capacity: null, attributes: {} },
  // A plastic wrap (the type the tables below name as one): it is as big as what is in it.
  77099: { groupID: 5, volume: 0, capacity: 0, attributes: {} },
  // A hull whose type has no size for anything, its cargo included.
  77006: { groupID: 901, volume: 16500, capacity: null, attributes: {} },
  // A hull that says it has a ship maintenance bay and whose type has no size for one.
  77005: { groupID: 902, volume: 92000, capacity: 700, attributes: { 3805: 700, 3701: 1 } },
};
const bayStatics = () => ({
  ...fakeStaticData(),
  getType: (typeID) => (BAY_TYPES[typeID] ? { typeID, groupID: BAY_TYPES[typeID].groupID, volume: BAY_TYPES[typeID].volume, capacity: BAY_TYPES[typeID].capacity } : HOLD_VOLUMES[typeID] === undefined ? null : { typeID, volume: HOLD_VOLUMES[typeID] }),
  getTypeDogmaAttribute: (typeID, attributeID, fallback = null) => (BAY_TYPES[typeID] && BAY_TYPES[typeID].attributes[attributeID] !== undefined ? BAY_TYPES[typeID].attributes[attributeID] : fallback),
  getTypeDogmaAttributeOrDefault: (typeID, attributeID, fallback = null) => (BAY_TYPES[typeID] && BAY_TYPES[typeID].attributes[attributeID] !== undefined ? BAY_TYPES[typeID].attributes[attributeID] : attributeID === 3887 ? 0 : fallback),
});
const SHIP_ROWS = [
  holdRow({ itemID: 9101, flagID: 5, quantity: 300, stacksize: 300 }),                    // cargo: 3
  holdRow({ itemID: 9102, flagID: 134, typeID: 77011, quantity: 40, stacksize: 40 }),    // ore hold: 80
  holdRow({ itemID: 9103, flagID: 134, quantity: 500, stacksize: 500 }),                 // ore hold: 5
];
const HANGAR_SHIPS = [
  holdRow({ itemID: 9001, typeID: 77002, groupID: 901, categoryID: 6, quantity: -1, singleton: 1 }),
  holdRow({ itemID: 9050, typeID: 77003, groupID: 902, categoryID: 6, quantity: -1, singleton: 1 }),
  holdRow({ itemID: 9051, typeID: 77004, groupID: 963001, categoryID: 6, quantity: -1, singleton: 1 }),
  holdRow({ itemID: 9052, typeID: 77005, groupID: 902, categoryID: 6, quantity: -1, singleton: 1 }),
];

/** A game-port pilot flying ship 9001 of type 77002, asking the bays route. */
async function baysOnGamePort(query, { shipID = 9001, constants = { ...holdConstants(), holdAttributes: async () => bayHolds() }, godma = { 3805: 410, 3887: 30 }, flying = { shipID: 9001, typeID: 77002 }, statics = bayStatics(), contents = SHIP_ROWS, hangar = HANGAR_SHIPS, transport = "gameport" } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  // Whichever transport holds the pilot answers its inventories; the other is never asked.
  const backend = transport === "gameport" ? gamePort : gateway;
  backend.bindObject = async (service, method, args) => ({ boundHandle: `${method}:${args[0]}`, notifications: [] });
  const calls = [];
  backend.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    calls.push({ method, args, handle });
    if (method === "List") {
      if (hangar === null) throw Object.assign(new Error("Refused"), { code: "CALL_REFUSED" });
      return { service, method, result: { type: "list", items: hangar }, notifications: [] };
    }
    if (method === "ListByFlags") {
      if (contents === null) throw Object.assign(new Error("Refused"), { code: "CALL_REFUSED" });
      return { service, method, result: { type: "list", items: contents.filter((row) => args[0].includes(row.fields.flagID)) }, notifications: [] };
    }
    // GetCapacity: the server's own, marked so that it is known for the server's.
    return { service, method, result: { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", { 5: 777, 134: 5001 }[args[0]] ?? 0], ["used", 7]] } }, notifications: [] };
  };
  const asked = { ship: 0, attributes: [] };
  if (flying) gamePort.ship = async () => { asked.ship += 1; return flying; };
  gamePort.shipAttribute = async (attributeID) => { asked.attributes.push(attributeID); return godma[attributeID] ?? null; };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport, staticData: statics, clientConstants: constants });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answer = await apiRequest(baseUrl, `/api/bridge/ship/${shipID}/bays${query}`);
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  const bays = Object.fromEntries(answer.payload.bays.map((bay) => [bay.key, bay]));
  return { bays, calls, asked, capacityCalls: calls.filter((call) => call.method === "GetCapacity").map((call) => call.args[0]) };
}

test("on the game port the bays of the ship being flown are known as the client knows them, and the server is asked for their contents alone", async () => {
  const { bays, calls, asked } = await baysOnGamePort("?keys=cargo,drone,ore,fleet,shipMaintenance");
  // treeData.py 300 to 363, godma.py 871: which bays from the type, how big from godma, and one read of what is in them.
  assert.deepEqual(calls.map((call) => [call.method, call.args]), [["ListByFlags", [[5, 87, 134]]]]);
  // The cargo and the drone bay as godma has them now; the ore hold, which godma was not told of, as the type has it.
  assert.deepEqual([bays.cargo.present, bays.cargo.capacity], [true, { capacity: 410, used: 3 }]);
  assert.deepEqual([bays.drone.present, bays.drone.capacity], [true, { capacity: 30, used: 0 }]);
  assert.deepEqual([bays.ore.present, bays.ore.capacity], [true, { capacity: 5000, used: 85 }]);
  // The two this hull has not: said so, with nothing in them and nothing asked about them.
  for (const key of ["fleet", "shipMaintenance"]) assert.deepEqual([bays[key].present, bays[key].capacity, bays[key].items, bays[key].error], [false, { capacity: 0, used: 0 }, null, null], key);
  assert.deepEqual(bays.ore.items.map((item) => [item.itemID, item.typeID, item.quantity]), [[9102, 77011, 40], [9103, 77010, 500]]);
  assert.deepEqual([bays.cargo.error, bays.drone.items], [null, []]);
  assert.deepEqual([asked.ship, asked.attributes.sort()], [1, [3805, 3887, 3934]]);
});

test("every bay of the route is in the client's own table, and a whole reading asks the server for the contents and nothing else", async () => {
  const { bays, calls } = await baysOnGamePort("");
  assert.equal(Object.keys(bays).length, 27);
  assert.deepEqual(calls.map((call) => call.method), ["ListByFlags"]);
  assert.deepEqual(Object.keys(bays).filter((key) => bays[key].present), ["cargo", "drone", "ore"]);
  assert.equal(Object.values(bays).every((bay) => bay.present === true || (bay.present === false && bay.capacity.capacity === 0)), true);
});

test("a ship in the hangar that is not the one being flown has its type from the hangar's list and its bays from the type alone", async () => {
  const { bays, calls, asked } = await baysOnGamePort("?keys=cargo,drone,ore,fleet,shipMaintenance", { shipID: 9050, contents: [] });
  // The client has the hangar's rows already; here they are one List. Its dogma has not that ship loaded, so a
  // capacity is the type's own (clientDogmaIM.GetCapacityForItem answers None, invCache.py 1268 on).
  assert.deepEqual(calls.map((call) => [call.method, call.args, call.handle]), [["List", [4], "GetInventory:60003760"], ["ListByFlags", [[5, 90, 155]], "GetInventoryFromId:9050"]]);
  // The cargo by the type's own capacity (evetypes.GetCapacity), not by the attribute, where the two differ.
  assert.deepEqual([bays.cargo.capacity, bays.shipMaintenance.capacity, bays.fleet.capacity], [{ capacity: 900, used: 0 }, { capacity: 1000000, used: 0 }, { capacity: 10000, used: 0 }]);
  assert.deepEqual([bays.drone.present, bays.ore.present], [false, false]);
  assert.deepEqual(asked.attributes, [], "godma holds the ship being flown, not this one");

  // A ship built of parts has a drone bay whatever its type says, as big as the attribute is by default; and
  // with no capacity among its type's fields, its cargo is the attribute's.
  const parts = await baysOnGamePort("?keys=cargo,drone,ore", { shipID: 9051, contents: [] });
  assert.deepEqual([parts.bays.cargo.capacity, parts.bays.drone.present, parts.bays.drone.capacity, parts.bays.ore.present], [{ capacity: 111, used: 0 }, true, { capacity: 0, used: 0 }, false]);
  assert.deepEqual(parts.capacityCalls, []);
  // A bay the hull has, with no size to be found for it: that bay is the server's to say.
  const sizeless = await baysOnGamePort("?keys=cargo,shipMaintenance", { shipID: 9052, contents: [] });
  assert.deepEqual([sizeless.capacityCalls, sizeless.bays.cargo.capacity, sizeless.bays.shipMaintenance.capacity], [[90], { capacity: 700, used: 0 }, { capacity: 0, used: 7 }]);
});

test("where the client's way cannot be followed, a ship's bays are asked of the server as before", async () => {
  const keys = "?keys=cargo,drone,ore";
  const asIs = (reading) => [reading.capacityCalls, reading.bays.cargo.capacity, reading.bays.drone.present, reading.bays.ore.capacity];
  const fromServer = [[5, 87, 134], { capacity: 777, used: 7 }, false, { capacity: 5001, used: 7 }];
  // No client to read from: neither table, or either one.
  assert.deepEqual(asIs(await baysOnGamePort(keys, { constants: { packagedVolumes: async () => null, holdAttributes: async () => null } })), fromServer);
  assert.deepEqual(asIs(await baysOnGamePort(keys, { constants: { ...holdConstants(), holdAttributes: async () => null } })), fromServer);
  assert.deepEqual(asIs(await baysOnGamePort(keys, { constants: { packagedVolumes: async () => null, holdAttributes: async () => bayHolds() } })), fromServer);
  // A transport that cannot say what is being flown, or godma not knowing its type.
  assert.deepEqual(asIs(await baysOnGamePort(keys, { flying: null })), fromServer);
  assert.deepEqual(asIs(await baysOnGamePort(keys, { flying: { shipID: 9001, typeID: null } })), fromServer);
  // A type the static tables have not, or tables that know no type's attributes.
  assert.deepEqual(asIs(await baysOnGamePort(keys, { flying: { shipID: 9001, typeID: 77999 } })), fromServer);
  assert.deepEqual(asIs(await baysOnGamePort(keys, { statics: holdStatics() })), fromServer);
  // A ship that is neither flown nor in the hangar's list, or the hangar's list not answering.
  assert.deepEqual(asIs(await baysOnGamePort(keys, { shipID: 9099 })), fromServer);
  assert.deepEqual(asIs(await baysOnGamePort(keys, { shipID: 9050, hangar: null })), fromServer);
  // On the gateway, with a game port in the process.
  const onGateway = await baysOnGamePort(keys, { transport: "gateway" });
  assert.deepEqual(asIs(onGateway), fromServer);
  assert.deepEqual([onGateway.asked.ship, onGateway.asked.attributes], [0, []]);
});

test("one bay that cannot be reckoned is asked about by itself, and the rest are still the client's", async () => {
  // A flag the client's table has not: that bay alone.
  const partial = await baysOnGamePort("?keys=cargo,drone,ore", { constants: { ...holdConstants(), holdAttributes: async () => bayHolds([5, 87]) } });
  assert.deepEqual(partial.capacityCalls, [134]);
  assert.deepEqual([partial.bays.cargo.capacity, partial.bays.ore.present, partial.bays.ore.capacity], [{ capacity: 410, used: 3 }, true, { capacity: 5001, used: 7 }]);
  // The bay the server said is there is among those whose contents are read.
  assert.deepEqual(partial.calls.find((call) => call.method === "ListByFlags").args, [[5, 87, 134]]);
  // Something in a bay whose volume nobody here knows: what is used of that bay is the server's to say.
  const unknown = await baysOnGamePort("?keys=cargo,ore", { contents: [...SHIP_ROWS, holdRow({ itemID: 9104, flagID: 134, typeID: 77999 })] });
  assert.deepEqual(unknown.capacityCalls, [134]);
  assert.deepEqual([unknown.bays.cargo.capacity, unknown.bays.ore.capacity, unknown.bays.ore.items.length], [{ capacity: 410, used: 3 }, { capacity: 5001, used: 7 }, 3]);
  // And so with something in the list that is not a row at all: no bay of that reading can be summed.
  const broken = await baysOnGamePort("?keys=cargo,ore", { contents: [...SHIP_ROWS, { type: "list", items: [], fields: { flagID: 5 } }] });
  assert.deepEqual([broken.capacityCalls.sort(), broken.bays.cargo.capacity], [[134, 5], { capacity: 777, used: 7 }]);
  // The contents not answering: each bay keeps its size, what is used is not known, and the bay says why.
  const dark = await baysOnGamePort("?keys=cargo,ore", { contents: null });
  assert.deepEqual(dark.capacityCalls, []);
  assert.deepEqual([dark.bays.cargo.capacity, dark.bays.cargo.items, dark.bays.cargo.error], [{ capacity: 410, used: null }, null, "CALL_REFUSED"]);
  assert.deepEqual([dark.bays.ore.capacity, dark.bays.ore.error], [{ capacity: 5000, used: null }, "CALL_REFUSED"]);
});

// ── The mining holds (GET /api/bridge/ship/ore-hold) ─────────────────────────

/** A game-port pilot flying ship 9001 of type 77002 (cargo, drones, an ore hold), asking for its mining holds. */
async function miningHoldsOnGamePort({ constants = { ...holdConstants(), holdAttributes: async () => bayHolds() }, godma = { 3805: 410 }, flying = { shipID: 9001, typeID: 77002 }, contents = SHIP_ROWS, failing = null, transport = "gameport" } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  backend.readFlightStatus = async () => ({ flight: { docked: true, inSpace: false, stationID: SELECT_SESSION_ECHO.stationID, solarSystemID: SELECT_SESSION_ECHO.solarSystemID, shipID: 9001, shipTypeID: 77002 }, notifications: [] });
  backend.bindObject = async (service, method, args) => ({ boundHandle: `${method}:${args[0]}`, notifications: [] });
  const calls = [];
  backend.callBoundMethod = async (service, method, args) => {
    calls.push({ method, flag: args[0] });
    if (method === "List") {
      if (failing === args[0]) throw Object.assign(new Error("Refused"), { code: "CALL_REFUSED" });
      return { service, method, result: { type: "list", items: contents.filter((row) => !row.fields || row.fields.flagID === args[0]) }, notifications: [] };
    }
    // GetCapacity: the server's own, marked.
    return { service, method, result: { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", { 5: 777, 134: 5001 }[args[0]] ?? 0], ["used", 7]] } }, notifications: [] };
  };
  const attributes = [];
  if (flying) gamePort.ship = async () => flying;
  gamePort.shipAttribute = async (attributeID) => { attributes.push(attributeID); return godma[attributeID] ?? null; };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport, staticData: { ...bayStatics(), getTypeDogma: (typeID) => (BAY_TYPES[typeID] ? { attributes: BAY_TYPES[typeID].attributes } : null) }, clientConstants: constants });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answer = await apiRequest(baseUrl, "/api/bridge/ship/ore-hold");
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  const holds = Object.fromEntries(answer.payload.holds.map((hold) => [hold.key, hold]));
  const named = (method) => calls.filter((call) => call.method === method).map((call) => call.flag).sort((a, b) => a - b);
  return { holds, lists: named("List"), capacities: named("GetCapacity"), attributes };
}

test("on the game port the mining holds are reckoned as the client reckons them: a List for each the hull has, and no capacity asked", async () => {
  const { holds, lists, capacities, attributes } = await miningHoldsOnGamePort();
  // The hull's type has an ore hold and, as every ship, its cargo: those two are listed, and that is all that is asked.
  assert.deepEqual([lists, capacities], [[5, 134], []]);
  // The cargo's size as godma has it; the ore hold's, which godma was not told of, as the type has it.
  assert.deepEqual([holds.cargo.present, holds.cargo.capacity, holds.cargo.error], [true, { capacity: 410, used: 3 }, null]);
  assert.deepEqual([holds.ore.present, holds.ore.capacity, holds.ore.error], [true, { capacity: 5000, used: 85 }, null]);
  assert.deepEqual(holds.ore.items.map((item) => [item.itemID, item.typeID, item.quantity]), [[9102, 77011, 40], [9103, 77010, 500]]);
  // The three this hull has not: not there, nothing in them, and nothing asked about them.
  for (const key of ["gas", "ice", "asteroid"]) assert.deepEqual([holds[key].present, holds[key].capacity, holds[key].items, holds[key].error], [false, { capacity: 0, used: 0 }, [], null], key);
  assert.deepEqual(attributes.sort(), [3805, 3934]);
});

test("a mining hold that cannot be reckoned is asked about by itself, and where the client's way cannot be followed all are asked as before", async () => {
  // Something in the ore hold whose volume nobody here knows: the server says how full that one is.
  const unknown = await miningHoldsOnGamePort({ contents: [...SHIP_ROWS, holdRow({ itemID: 9104, flagID: 134, typeID: 77999 })] });
  assert.deepEqual([unknown.capacities, unknown.holds.ore.capacity, unknown.holds.cargo.capacity], [[134], { capacity: 5001, used: 7 }, { capacity: 410, used: 3 }]);
  // A hold's List not answering: its capacity is still the server's to give, and the hold says what went wrong.
  const dark = await miningHoldsOnGamePort({ failing: 134 });
  assert.deepEqual([dark.capacities, dark.holds.ore.capacity, dark.holds.ore.items, dark.holds.ore.error, dark.holds.cargo.capacity], [[134], { capacity: 5001, used: 7 }, null, "CALL_REFUSED", { capacity: 410, used: 3 }]);
  // A hold with no size to be found, in godma or on the type: that hold is the server's to say.
  const sizeless = await miningHoldsOnGamePort({ flying: { shipID: 9001, typeID: 77006 }, godma: {} });
  assert.deepEqual([sizeless.lists, sizeless.capacities, sizeless.holds.cargo.capacity], [[5], [5], { capacity: 777, used: 7 }]);
  // A hold the client's own table has not is still read, and asked about.
  const partial = await miningHoldsOnGamePort({ constants: { ...holdConstants(), holdAttributes: async () => bayHolds([5, 135, 181, 182]) } });
  assert.deepEqual([partial.lists, partial.capacities, partial.holds.ore.capacity, partial.holds.cargo.capacity], [[5, 134], [134], { capacity: 5001, used: 7 }, { capacity: 410, used: 3 }]);
  // No client to read from, a transport that cannot say what is flown, or the gateway: the holds the hull's type
  // carries are each listed and asked about, as they were.
  const fromServer = [[5, 134], [5, 134], { capacity: 777, used: 7 }, { capacity: 5001, used: 7 }];
  const asIs = (reading) => [reading.lists, reading.capacities, reading.holds.cargo.capacity, reading.holds.ore.capacity];
  assert.deepEqual(asIs(await miningHoldsOnGamePort({ constants: { packagedVolumes: async () => null, holdAttributes: async () => null } })), fromServer);
  assert.deepEqual(asIs(await miningHoldsOnGamePort({ flying: null })), fromServer);
  const onGateway = await miningHoldsOnGamePort({ transport: "gateway" });
  assert.deepEqual([asIs(onGateway), onGateway.attributes], [fromServer, []]);
});

// ── A container (GET /api/bridge/inventory/container/:itemID) ────────────────

const CONTAINER_ROWS = [
  holdRow({ itemID: 9201, flagID: 0, quantity: 1000, stacksize: 1000 }),                                        // 10
  holdRow({ itemID: 9202, flagID: 0, typeID: 77011, quantity: 40, stacksize: 40 }),                             // 80
  holdRow({ itemID: 9203, flagID: 0, typeID: 77002, groupID: 901, categoryID: 6, quantity: 2, stacksize: 2 }),  // two packaged: 5000
  holdRow({ itemID: 9204, flagID: 64, quantity: 500, stacksize: 500 }),                                         // in another flag: 5
];

/** A pilot opening container 9200, on the game port unless told otherwise. */
async function containerOnGamePort(query, { constants = holdConstants(), contents = CONTAINER_ROWS, transport = "gameport", statics = bayStatics() } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  backend.bindObject = async (service, method, args) => ({ boundHandle: `${method}:${args[0]}`, notifications: [] });
  const calls = [];
  backend.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    calls.push([method, args, handle]);
    if (method === "List") return { service, method, result: { type: "list", items: contents }, notifications: [] };
    return { service, method, result: { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["capacity", 777], ["used", 7]] } }, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport, staticData: statics, clientConstants: constants });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answer = await apiRequest(baseUrl, `/api/bridge/inventory/container/9200${query}`);
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  return { payload: answer.payload, calls, methods: calls.map(([method]) => method).sort(), capacity: answer.payload.capacity === null ? null : Object.fromEntries(answer.payload.capacity.args.entries) };
}

test("on the game port a container's capacity is its type's, and what is in it is summed, with the server asked for its List alone", async () => {
  // invCache.py 1224 on, for a container: evetypes.GetCapacity of its type, and the volume of everything it lists.
  const { payload, calls, capacity } = await containerOnGamePort("?typeID=77020");
  assert.deepEqual(calls, [["List", [], "GetInventoryFromId:9200"]]);
  assert.deepEqual(capacity, { capacity: 1200, used: 10 + 80 + 5000 + 5 });
  assert.deepEqual([payload.containerID, payload.list.items.length, payload.volumes], [9200, 4, { 77002: 16500, 77010: 0.01, 77011: 2 }]);
  // A plastic wrap is as big as what is in it.
  assert.deepEqual((await containerOnGamePort("?typeID=77099")).capacity, { capacity: 5095, used: 5095 });
  // The type is read as this file reads every whole number of a query: its leading digits.
  assert.deepEqual((await containerOnGamePort("?typeID=77020.9")).capacity, { capacity: 1200, used: 5095 });
  // An empty container: its type's capacity, and nothing used.
  assert.deepEqual((await containerOnGamePort("?typeID=77020", { contents: [] })).capacity, { capacity: 1200, used: 0 });
});

test("a caller that does not say what the container is wants its contents: no capacity is reckoned, and none is asked for", async () => {
  // The bots open cans and offices for what is in them. The client knows the type of what it opens; a caller
  // that wants the capacity says it.
  for (const query of ["", "?typeID=", "?typeID=abc", "?typeID=0", "?typeID=-5"]) {
    const { payload, methods, capacity } = await containerOnGamePort(query);
    assert.deepEqual([methods, capacity, payload.list.items.length], [["List"], null, 4], query);
  }
});

test("where a container's capacity cannot be reckoned it is asked of the server, and on the gateway it always is", async () => {
  const fromServer = { capacity: 777, used: 7 };
  const asked = async (query, options) => { const reading = await containerOnGamePort(query, options); return [reading.methods, reading.capacity]; };
  // A type the static tables have not, or one with no capacity among its fields.
  assert.deepEqual(await asked("?typeID=77998"), [["GetCapacity", "List"], fromServer]);
  assert.deepEqual(await asked("?typeID=77021"), [["GetCapacity", "List"], fromServer]);
  // Something in it whose volume nobody here knows, or something that is not a row.
  assert.deepEqual(await asked("?typeID=77020", { contents: [...CONTAINER_ROWS, holdRow({ itemID: 9205, flagID: 0, typeID: 77999 })] }), [["GetCapacity", "List"], fromServer]);
  assert.deepEqual(await asked("?typeID=77020", { contents: [...CONTAINER_ROWS, { type: "list", items: [] }] }), [["GetCapacity", "List"], fromServer]);
  // No client to read the packaged volumes from, or static tables that know no type.
  assert.deepEqual(await asked("?typeID=77020", { constants: { packagedVolumes: async () => null } }), [["GetCapacity", "List"], fromServer]);
  assert.deepEqual(await asked("?typeID=77020", { statics: fakeStaticData() }), [["GetCapacity", "List"], fromServer]);
  // The gateway: asked, whether or not the caller says what the container is.
  assert.deepEqual(await asked("?typeID=77020", { transport: "gateway" }), [["GetCapacity", "List"], fromServer]);
  assert.deepEqual(await asked("", { transport: "gateway" }), [["GetCapacity", "List"], fromServer]);
});

// ── The ship's own dogma on the Fitting and Drones routes ────────────────────

const GODMA_SHIP_ROW = { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["itemID", 9001], ["attributes", { type: "dict", entries: [[48, 150], [283, 25]] }]] } };

/** A pilot asking a route that wants the ship's own dogma; on the game port unless told otherwise. */
async function shipDogmaRoute(path, { own = { shipID: 9001, row: GODMA_SHIP_ROW, online: [9002] }, transport = "gameport", knows = true } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  backend.readFlightStatus = async () => ({ flight: { docked: true, inSpace: false, stationID: SELECT_SESSION_ECHO.stationID, solarSystemID: SELECT_SESSION_ECHO.solarSystemID, shipID: 9001, shipTypeID: 77002 }, notifications: [] });
  backend.readSpaceSnapshot = async () => ({ space: { inSpace: false, entities: [], ship: null }, notifications: [] });
  backend.bindObject = async (service, method, args) => ({ boundHandle: `${method}:${args[0]}`, notifications: [] });
  backend.callBoundMethod = async (service, method) => ({ service, method, result: { type: "list", items: [] }, notifications: [] });
  const asked = [];
  backend.callMethod = async (service, method, args) => {
    asked.push(`${service}.${method}`);
    // The server's own answers, marked so that they are known for the server's.
    const result = method === "ShipGetInfo" ? { type: "dict", entries: [[9001, { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["itemID", 9001], ["attributes", { type: "dict", entries: [[48, 777]] }]] } }]] }
      : method === "ShipOnlineModules" ? { type: "list", items: [777] } : null;
    return { service, method, result, notifications: [] };
  };
  const given = [];
  if (knows) gamePort.shipInfo = async (sessionFields, bridgeSessionID) => { given.push({ sessionFields, bridgeSessionID }); return own; };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport, staticData: bayStatics(), clientConstants: holdConstants() });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  asked.length = 0;
  const answer = await apiRequest(baseUrl, path);
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  return { payload: answer.payload, dogma: asked.filter((pair) => pair.startsWith("dogmaIM.")).sort(), given };
}
const FROM_SERVER = { shipInfo: { type: "dict", entries: [[9001, { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["itemID", 9001], ["attributes", { type: "dict", entries: [[48, 777]] }]] } }]] }, online: { type: "list", items: [777] } };

test("on the game port the Fitting panel's ship and its online modules are godma's, and dogma is asked nothing", async () => {
  // godma.py 2409, 697: the client never sends ShipGetInfo or ShipOnlineModules. What it knows of its ship it was
  // primed with and has been told since.
  const { payload, dogma, given } = await shipDogmaRoute("/api/bridge/fitting");
  assert.deepEqual(dogma, []);
  assert.deepEqual(payload.shipInfo, { type: "dict", entries: [[9001, GODMA_SHIP_ROW]] });
  assert.deepEqual(payload.online, { type: "list", items: [9002] });
  assert.deepEqual(payload.errors, { slots: null, shipInfo: null, online: null });
  assert.deepEqual(given, [{ sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  // A ship with no module online: an empty list, which is an answer.
  assert.deepEqual((await shipDogmaRoute("/api/bridge/fitting", { own: { shipID: 9001, row: GODMA_SHIP_ROW, online: [] } })).payload.online, { type: "list", items: [] });
});

test("on the game port the Drones panel's ship is godma's too", async () => {
  const { payload, dogma } = await shipDogmaRoute("/api/bridge/drones");
  assert.deepEqual(dogma, []);
  assert.deepEqual(payload.shipInfo, { type: "dict", entries: [[9001, GODMA_SHIP_ROW]] });
  assert.equal(payload.errors.shipInfo, null);
});

test("where godma cannot say, and on the gateway, the ship's dogma is asked of the server as before", async () => {
  // Godma not primed; godma holding another ship than this session's own; a transport with no godma; the gateway.
  for (const options of [{ own: { shipID: 9001, row: null, online: [] } }, { own: { shipID: 9555, row: GODMA_SHIP_ROW, online: [9002] } }, { knows: false }, { transport: "gateway" }]) {
    const fitting = await shipDogmaRoute("/api/bridge/fitting", options);
    assert.deepEqual([fitting.dogma, fitting.payload.shipInfo, fitting.payload.online], [["dogmaIM.ShipGetInfo", "dogmaIM.ShipOnlineModules"], FROM_SERVER.shipInfo, FROM_SERVER.online], JSON.stringify(options));
    const drones = await shipDogmaRoute("/api/bridge/drones", options);
    assert.deepEqual([drones.dogma, drones.payload.shipInfo], [["dogmaIM.ShipGetInfo"], FROM_SERVER.shipInfo], JSON.stringify(options));
  }
  // On the gateway the transport that keeps a godma is not asked for it.
  assert.deepEqual((await shipDogmaRoute("/api/bridge/fitting", { transport: "gateway" })).given, []);
});

// ── The Fitting window's dogma (GET /api/bridge/bound-dogma) ─────────────────

test("the Fitting window's snapshot is one read of dogma, the one godma makes: all info", async () => {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const bound = [];
  const calls = [];
  gamePort.bindObject = async (service, method, args) => { bound.push({ service, method, args }); return { boundHandle: "bound-dogma", notifications: [] }; };
  gamePort.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    calls.push({ service, method, args, kwargs, handle });
    return { service, method, result: { type: "tuple", items: [method] }, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });

  const dogma = await apiRequest(baseUrl, "/api/bridge/bound-dogma");
  assert.equal(dogma.response.status, 200, JSON.stringify(dogma.payload));
  // godma.py 2409: GetDogmaLM().GetAllInfo(...). The page reads nothing else of this answer, and the client asks
  // none of the rest when its fitting window opens: an item with no ID and the drones' damage with no drones it never asks at all.
  assert.deepEqual(calls.map((call) => [call.service, call.method, call.handle]), [["dogmaIM", "GetAllInfo", "bound-dogma"]]);
  assert.deepEqual(Object.keys(dogma.payload.reads), ["GetAllInfo"]);
  assert.deepEqual(dogma.payload.reads.GetAllInfo, { result: { type: "tuple", items: ["GetAllInfo"] } });
  assert.equal(bound.length, 1);
});

test("the dogma read's own failure is told in its place, not as the route's", async () => {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  gamePort.bindObject = async () => ({ boundHandle: "bound-dogma", notifications: [] });
  gamePort.callBoundMethod = async () => { throw Object.assign(new Error("Refused"), { code: "CALL_REFUSED" }); };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const dogma = await apiRequest(baseUrl, "/api/bridge/bound-dogma");
  assert.equal(dogma.response.status, 200);
  assert.deepEqual(dogma.payload.reads, { GetAllInfo: { error: "CALL_REFUSED", message: "Refused" } });
});

// ── A corporation's assets (GET /api/bridge/corp-assets) ─────────────────────

test("a corporation's assets are searched only when a search is asked for", async () => {
  const asked = async (query) => {
    const calls = [];
    const gamePort = gamePortWithQuestions(() => ({ answered: true }));
    gamePort.callMethod = async (service, method, args, kwargs) => {
      calls.push({ service, method, args, kwargs });
      return { service, method, result: { type: "list", items: [method] }, notifications: [] };
    };
    const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
    await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
    calls.length = 0;
    const answer = await apiRequest(baseUrl, `/api/bridge/corp-assets${query}`);
    assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
    return { payload: answer.payload, corpmgr: calls.filter((call) => call.service === "corpmgr") };
  };
  // The page's own two readings: where the offices are, and what is in one. corp_ui_accounts.py 752: the
  // client asks SearchAssets when the pilot presses Search, and at no other time.
  const offices = await asked("?which=offices");
  assert.deepEqual(offices.corpmgr.map((call) => call.method), ["GetAssetInventory"]);
  assert.deepEqual([offices.payload.search, offices.payload.errors.search], [null, null]);
  assert.deepEqual(offices.payload.inventory, { type: "list", items: ["GetAssetInventory"] });
  const office = await asked("?which=offices&locationID=60000004");
  assert.deepEqual(office.corpmgr.map((call) => call.method).sort(), ["GetAssetInventory", "GetAssetInventoryForLocation"]);
  // A search names a filter, even one that is nought: the client's Search pressed with nothing set.
  for (const [query, filters] of [["?which=offices&typeID=34", [0, 0, 34, 0]], ["?which=offices&minimumQuantity=0", [0, 0, 0, 0]], ["?which=offices&categoryID=6", [6, 0, 0, 0]], ["?which=offices&groupID=25", [0, 25, 0, 0]], ["?which=offices&categoryID=6&groupID=25&typeID=34&minimumQuantity=3", [6, 25, 34, 3]]]) {
    const search = await asked(query);
    assert.deepEqual(search.corpmgr.map((call) => call.method).sort(), ["GetAssetInventory", "SearchAssets"], query);
    assert.deepEqual(search.corpmgr.find((call) => call.method === "SearchAssets").args, ["offices", ...filters], query);
    assert.deepEqual(search.payload.search, { type: "list", items: ["SearchAssets"] }, query);
  }
});

// ── Where an agent is (GET /api/bridge/agents/:agentID/solar-system) ─────────

test("which solar system an agent is in is asked of the server as the client asks it, and passed on as it came", async () => {
  const calls = [];
  let reply = () => 30002780;
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  gamePort.callMethod = async (service, method, args, kwargs) => {
    calls.push({ service, method, args, kwargs });
    return { service, method, result: method === "GetSolarSystemOfAgent" ? reply() : null, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  const read = (agent) => apiRequest(baseUrl, `/api/bridge/agents/${agent}/solar-system`);

  // No pilot, nobody to ask through.
  assert.equal((await read(3008416)).response.status, 409);
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  for (const agent of [0, "x", -5, "1.5"]) {
    const refused = await read(agent);
    assert.equal(refused.response.status, 400, String(agent));
    assert.equal(refused.payload.error, "INVALID_AGENT");
  }
  calls.length = 0;

  const found = await read(3008416);
  assert.equal(found.response.status, 200, JSON.stringify(found.payload));
  assert.deepEqual(found.payload, { ok: true, agentID: 3008416, solarSystemID: 30002780, notifications: [] });
  assert.deepEqual(calls, [{ service: "agentMgr", method: "GetSolarSystemOfAgent", args: [3008416], kwargs: null }]);

  // An agent the server places nowhere: null, whether it said None or nothing at all.
  reply = () => null;
  assert.deepEqual((await read(3011895)).payload, { ok: true, agentID: 3011895, solarSystemID: null, notifications: [] });
  reply = () => undefined;
  assert.deepEqual((await read(3011895)).payload, { ok: true, agentID: 3011895, solarSystemID: null, notifications: [] });
  // Each ask goes to the server: it is the page that keeps the answer, as the client's service does.
  assert.equal(calls.length, 3);
  // A server that does not answer is an error, not an agent with no system.
  reply = () => { throw Object.assign(new Error("The game server did not answer in time."), { code: "EVE_GATEWAY_TIMEOUT", statusCode: 504 }); };
  const failed = await read(3008416);
  assert.equal(failed.response.status >= 500, true, JSON.stringify(failed.payload));
  assert.equal(failed.payload.ok, false);
});

test("an agent's record without a client to read has its row and nothing of the client's; a table that could not be read is read again", async () => {
  let fails = true;
  let reads = 0;
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  gamePort.callMethod = async (service, method) => {
    if (method !== "GetAgents") return { service, method, result: null, notifications: [] };
    reads += 1;
    if (fails) throw Object.assign(new Error("The game server did not answer in time."), { code: "EVE_GATEWAY_TIMEOUT", statusCode: 504 });
    return { service, method, result: AGENT_TABLE, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport", clientBuiltData: builtData({}, false) });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  reads = 0;
  const failed = await apiRequest(baseUrl, "/api/bridge/agents/3008416/record");
  assert.equal(failed.response.status >= 500, true, JSON.stringify(failed.payload));
  fails = false;
  const found = await apiRequest(baseUrl, "/api/bridge/agents/3008416/record");
  assert.deepEqual(found.payload.agent, { agentID: 3008416, agentTypeID: 2, divisionID: 22, level: 1, stationID: 60000004, corporationID: 1000002, factionID: null, divisionNameID: null });
  assert.equal(reads, 2);
});

// ── The pilot's own contracts on the Contracts route ─────────────────────────
//
// The client's My Contracts panel lists an owner's contracts by status (contractPanels.py 419, and recorded on
// Tranquility): GetContractListForOwner(ownerID, status, None, None, num=100, startContractID=None). It never asks
// GetMyCurrentContractList. The page's two lists, what the pilot issued and what the pilot took on, are among the
// owner's outstanding and in-progress contracts, which is what the route asks for on the game port.

const ME = 7;
const contractRow = (contractID, { issuerID = 0, acceptorID = 0, assigneeID = 0, status = 0 } = {}) =>
  ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["contractID", contractID], ["status", status], ["issuerID", issuerID], ["acceptorID", acceptorID], ["assigneeID", assigneeID]] } });
const contractItems = (contractID) => [contractID, { type: "list", items: [{ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["contractID", contractID]] } }] }];
const contractBundle = (rows, items = rows.map((row) => contractItems(row.args.entries[0][1]))) =>
  ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["contracts", { type: "list", items: rows }], ["items", { type: "dict", entries: items }]] } });
/** The owner's contracts as the server has them: issued by the pilot (two still waiting, one taken by someone), taken on by the pilot, offered to the pilot. */
const WAITING = [contractRow(31, { issuerID: ME }), contractRow(34, { issuerID: 99, assigneeID: ME }), contractRow(36, { issuerID: ME })];
const UNDER_WAY = [contractRow(32, { issuerID: ME, acceptorID: 55, status: 1 }), contractRow(35, { issuerID: 99, acceptorID: ME, status: 1 })];

/** A pilot opening the Contracts panel; on the game port unless told otherwise. Says what was asked of the contract proxy and what the route answered. */
async function contractsRoute({ transport = "gameport", byStatus = { 0: contractBundle(WAITING), 1: contractBundle(UNDER_WAY) }, failing = () => false } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  const asked = [];
  backend.callMethod = async (service, method, args, kwargs) => {
    asked.push([`${service}.${method}`, args, kwargs ?? null]);
    if (failing(method, args)) throw Object.assign(new Error("refused"), { code: "CALL_REFUSED" });
    // The server's own answers to the page's old calls, marked so that they are known for the server's.
    if (method === "GetMyCurrentContractList") return { service, method, result: contractBundle([contractRow(args[0] ? 902 : 901, { issuerID: ME })]), notifications: [] };
    if (method === "GetContractListForOwner") return { service, method, result: byStatus[args[1]], notifications: [] };
    return { service, method, result: null, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: ME } });
  asked.length = 0;
  const answer = await apiRequest(baseUrl, "/api/bridge/contracts");
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  const ids = (list) => (list.result === null ? null : list.result.args.entries[0][1].items.map((row) => row.args ? row.args.entries[0][1] : row.fields.contractID));
  const itemIDs = (list) => list.result.args.entries[1][1].entries.map(([contractID]) => contractID);
  return { payload: answer.payload, mine: asked.filter(([pair]) => /GetContractListForOwner|GetMyCurrentContractList/.test(pair)), ids, itemIDs };
}

test("on the game port the pilot's own contracts are asked for as the client's My Contracts panel asks, and the page's two lists are drawn from them", async () => {
  const { payload, mine, ids, itemIDs } = await contractsRoute();
  assert.equal(payload.characterID, ME);
  // The owner's outstanding, then the owner's in progress: no type, issued to or by, a hundred from the first.
  assert.deepEqual(mine, [
    ["contractProxy.GetContractListForOwner", [ME, 0, null, null], { num: 100, startContractID: null }],
    ["contractProxy.GetContractListForOwner", [ME, 1, null, null], { num: 100, startContractID: null }],
  ]);
  // What the pilot issued, waiting or under way, newest first; what the pilot took on. One only offered to the pilot is in neither.
  assert.deepEqual([ids(payload.outstanding), ids(payload.accepted)], [[36, 32, 31], [35]]);
  assert.deepEqual([payload.outstanding.error, payload.accepted.error], [null, null]);
  // Each list has the items of its own contracts and no others.
  assert.deepEqual([itemIDs(payload.outstanding).sort(), itemIDs(payload.accepted)], [[31, 32, 36], [35]]);
  // The answer is the form the page reads a list in.
  assert.deepEqual(payload.accepted.result, contractBundle([UNDER_WAY[1]]));
});

test("the owner's contracts as packed rows are read the same, and an owner with none has two empty lists", async () => {
  const packed = (contractID, fields) => ({ type: "packedrow", columns: [], fields: { contractID, issuerID: 0, acceptorID: 0, ...fields }, values: [] });
  // One of them with no items listed for it, as a contract with nothing in it has none: its list has no entry for it.
  const rows = await contractsRoute({ byStatus: {
    0: contractBundle([packed(41, { issuerID: { type: "long", value: String(ME) } }), packed(43, { issuerID: ME })], [contractItems(41)]),
    1: contractBundle([packed(42, { acceptorID: ME })], [contractItems(42)]),
  } });
  assert.deepEqual([rows.ids(rows.payload.outstanding), rows.ids(rows.payload.accepted)], [[43, 41], [42]]);
  assert.deepEqual(rows.payload.outstanding.result.args.entries[1], ["items", { type: "dict", entries: [contractItems(41)] }]);
  const none = await contractsRoute({ byStatus: { 0: contractBundle([]), 1: contractBundle([]) } });
  assert.deepEqual([none.payload.outstanding, none.payload.accepted], [{ result: contractBundle([]), error: null }, { result: contractBundle([]), error: null }]);
  // An answer that lists contracts and no items at all is read for its contracts.
  const bare = { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["contracts", { type: "list", items: [contractRow(61, { issuerID: ME })] }]] } };
  const itemless = await contractsRoute({ byStatus: { 0: bare, 1: contractBundle([]) } });
  assert.deepEqual([itemless.ids(itemless.payload.outstanding), itemless.itemIDs(itemless.payload.outstanding), itemless.payload.outstanding.error], [[61], [], null]);
});

test("when either of the owner's lists is refused or cannot be read, both of the page's lists say so, and the rest of the panel is answered", async () => {
  // Either one alone: what the pilot issued may be in either, so neither of the page's lists is whole without both.
  for (const status of [0, 1]) {
    const refused = await contractsRoute({ failing: (method, args) => method === "GetContractListForOwner" && args[1] === status });
    assert.deepEqual([refused.payload.outstanding, refused.payload.accepted], [{ result: null, error: "CALL_REFUSED" }, { result: null, error: "CALL_REFUSED" }], String(status));
    assert.deepEqual([refused.payload.expired.error, refused.payload.summary.error, refused.payload.browse.error], [null, null, null]);
  }
  // An answer with no list of contracts in it, one whose list is something else, and a row that is not a row:
  // an empty list would say the pilot has no contracts, which nothing here knows.
  const noList = { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["items", { type: "dict", entries: [] }]] } };
  const oddList = { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["contracts", { type: "object", name: "carbon.common.script.sys.crowset.CRowset", args: null }], ["items", { type: "dict", entries: [] }]] } };
  for (const odd of [null, noList, oddList, contractBundle([contractRow(51, { issuerID: ME }), "x"], [])]) {
    for (const byStatus of [{ 0: odd, 1: contractBundle(UNDER_WAY) }, { 0: contractBundle(WAITING), 1: odd }]) {
      const unread = await contractsRoute({ byStatus });
      assert.deepEqual([unread.payload.outstanding, unread.payload.accepted], [{ result: null, error: "READ_FAILED" }, { result: null, error: "READ_FAILED" }], JSON.stringify(odd));
    }
  }
});

test("on the gateway the pilot's own contracts are asked of the server as before", async () => {
  const { payload, mine, ids } = await contractsRoute({ transport: "gateway" });
  assert.deepEqual(mine, [
    ["contractProxy.GetMyCurrentContractList", [false, false], null],
    ["contractProxy.GetMyCurrentContractList", [true, false], null],
  ]);
  assert.deepEqual([ids(payload.outstanding), ids(payload.accepted)], [[901], [902]]);
});

// ── The pilot's implants on the Character Sheet route ────────────────────────
//
// The client's sheet lists the implants its skill handler answers (skillsvc.GetImplants, which godma's
// 'implants' of the character hands on), each by its type and sorted by the slot the type's own attribute says
// (implantsBoostersPanel.py 40). It never asks charMgr.GetCloneInfo. Of that answer the page shows the implants
// and nothing else.

const IMPLANT_SLOTS = { 9899: 1, 9941: 2, 3097: 6 };
const implantStatics = () => ({ ...fakeStaticData(), getTypeDogmaAttribute: (typeID, attributeID, fallback) => (attributeID === 331 && IMPLANT_SLOTS[typeID] !== undefined ? IMPLANT_SLOTS[typeID] : fallback) });
const implantRow = (typeID, more = []) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["typeID", typeID], ...more] } });
const implantsAnswer = (...entries) => ({ type: "dict", entries });
const cloneWith = (...implants) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["implants", { type: "dict", entries: implants.map(([key, typeID, slot]) => [key, implantRow(typeID, [["slot", slot]])]) }]] } });
const FROM_CLONE_INFO = { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["homeStationID", 60003760], ["implants", { type: "dict", entries: [] }]] } };

/** A pilot opening the Character Sheet; on the game port unless told otherwise. Says what was asked for the clone and what the route answered of it. */
async function characterSheetRoute({ transport = "gameport", implants = implantsAnswer([6, implantRow(3097, [["slot", 99]])], [1, implantRow(9899)]), statics = implantStatics(), failing = false } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  const asked = [];
  backend.callMethod = async (service, method, args, kwargs) => {
    asked.push([`${service}.${method}`, args, kwargs ?? null]);
    if (method === "GetImplants") {
      if (failing) throw Object.assign(new Error("refused"), { code: "CALL_REFUSED" });
      return { service, method, result: implants, notifications: [] };
    }
    // The server's own answer to the page's old call, marked so that it is known for the server's.
    if (method === "GetCloneInfo") return { service, method, result: FROM_CLONE_INFO, notifications: [] };
    return { service, method, result: null, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport, staticData: statics });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  asked.length = 0;
  const answer = await apiRequest(baseUrl, "/api/bridge/character-sheet");
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  return { payload: answer.payload, clone: asked.filter(([pair]) => /GetImplants|GetCloneInfo/.test(pair)), all: asked.map(([pair]) => pair).sort() };
}

test("on the game port the Character Sheet's implants are the skill handler's, each in the slot its type says, and the clone is not asked about", async () => {
  const { payload, clone, all } = await characterSheetRoute();
  // GetSkillHandler().GetImplants(), with nothing; and charMgr.GetCloneInfo not at all.
  assert.deepEqual(clone, [["skillHandler.GetImplants", [], null]]);
  assert.deepEqual(all, ["charMgr.GetCharacterDescription", "charMgr.GetHomeStationRow", "charMgr.GetPublicInfo3", "skillHandler.GetImplants"]);
  // In the form the page reads a clone in: each implant by its type, in its type's slot whatever the server said of one, under the server's own key.
  assert.deepEqual([payload.cloneInfo, payload.errors.cloneInfo], [cloneWith([6, 3097, 6], [1, 9899, 1]), null]);
  // Implants as rows are read the same; a type the static tables have no slot for is in none.
  const packed = await characterSheetRoute({ implants: implantsAnswer([2, { type: "packedrow", columns: [], fields: { typeID: { type: "long", value: "9941" } }, values: [] }], [3, implantRow(424242)]) });
  assert.deepEqual(packed.payload.cloneInfo, cloneWith([2, 9941, 2], [3, 424242, 0]));
  const unknowing = await characterSheetRoute({ statics: fakeStaticData() });
  assert.deepEqual(unknowing.payload.cloneInfo, cloneWith([6, 3097, 0], [1, 9899, 0]));
  // A pilot with none: a clean clone, which is an answer.
  const clean = await characterSheetRoute({ implants: implantsAnswer() });
  assert.deepEqual([clean.payload.cloneInfo, clean.payload.errors.cloneInfo], [cloneWith(), null]);
});

test("implants that are refused or cannot be read are said to be so, and the rest of the sheet is answered", async () => {
  const refused = await characterSheetRoute({ failing: true });
  assert.deepEqual([refused.payload.cloneInfo, refused.payload.errors], [null, { publicInfo: null, description: null, homeStation: null, cloneInfo: "CALL_REFUSED" }]);
  // No answer, one that is no dict, and an implant with no type: an empty list would say the pilot has none.
  for (const odd of [null, { type: "list", items: [] }, 7, implantsAnswer([1, implantRow(9899)], [2, implantRow(0)]), implantsAnswer([1, "x"])]) {
    const unread = await characterSheetRoute({ implants: odd });
    assert.deepEqual([unread.payload.cloneInfo, unread.payload.errors.cloneInfo, unread.payload.errors.publicInfo], [null, "READ_FAILED", null], JSON.stringify(odd));
  }
});

test("on the gateway the Character Sheet's clone is asked of the server as before", async () => {
  const { payload, clone } = await characterSheetRoute({ transport: "gateway" });
  assert.deepEqual(clone, [["charMgr.GetCloneInfo", [], null]]);
  assert.deepEqual([payload.cloneInfo, payload.errors.cloneInfo], [FROM_CLONE_INFO, null]);
});

// ── The pilot's fleet on the Fleet route ─────────────────────────────────────
//
// The client's fleet service asks nothing of a fleet unless session.fleetid says the pilot is in one
// (fleetSvc.py 254, 366): with none there is no fleet moniker to call. The route asked five things of the
// session's fleet whatever the session said, and took five refusals for "not in a fleet".

const FLEET_READ_NAMES = ["GetInitState", "GetWings", "GetMotd", "GetJoinRequests", "GetFleetComposition"];
const fleetState = (fleetID) => ({ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["fleetID", fleetID], ["members", { type: "dict", entries: [] }], ["wings", { type: "dict", entries: [] }]] } });

/** A pilot opening the Fleet panel; on the game port unless told otherwise. Says what was asked of the fleet's service and what the route answered. */
async function fleetRoute({ transport = "gameport", own = { fleetID: null }, knows = true } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  const asked = [];
  backend.bindObject = async (service, method, args) => { asked.push(`bind ${service}`); return { boundHandle: `${service}:${method}`, notifications: [] }; };
  backend.callBoundMethod = async (service, method) => {
    asked.push(`${service}.${method}`);
    if (own.refuses === method) throw Object.assign(new Error("FleetNotAllowed"), { code: "CALL_REFUSED" });
    if (own.fleetID === null && FLEET_READ_NAMES.includes(method)) throw Object.assign(new Error("FleetNotInFleet"), { code: "CALL_REFUSED" });
    return { service, method, result: method === "GetInitState" ? fleetState(own.fleetID) : null, notifications: [] };
  };
  const byName = backend.callMethod;
  backend.callMethod = async (service, method, ...rest) => { asked.push(service + "." + method); return byName(service, method, ...rest); };
  const given = [];
  const keptAsked = [];
  if (knows) gamePort.fleet = (sessionFields, bridgeSessionID) => { given.push({ sessionFields, bridgeSessionID }); return own; };
  // What the transport keeps of the fleet, where the test says it keeps any.
  if (knows && typeof own.kept === "function") gamePort.fleetKept = async (sessionFields, bridgeSessionID) => { keptAsked.push({ sessionFields, bridgeSessionID }); return own.kept(); };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  asked.length = 0;
  const answer = await apiRequest(baseUrl, "/api/bridge/bound-fleet");
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  return { payload: answer.payload, asked, given, keptAsked, baseUrl };
}
const ALL_FIVE = ["bind fleetObjectHandler", ...FLEET_READ_NAMES.map((name) => `fleetObjectHandler.${name}`)];

test("on the game port a pilot whose session has no fleet is asked nothing of one, and the route says the session has none", async () => {
  const { payload, asked, given } = await fleetRoute();
  assert.deepEqual(asked, []);
  assert.deepEqual(given, [{ sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  assert.deepEqual([payload.membership, payload.fleetID, payload.notifications], ["none", null, []]);
  // Each read is said not to have been asked: not an answer, and not a refusal.
  assert.deepEqual(payload.reads, Object.fromEntries(FLEET_READ_NAMES.map((name) => [name, { error: "NOT_ASKED", message: null }])));
});

test("with a fleet in the session, and on the gateway, the fleet is asked as before", async () => {
  // In a fleet: the five reads, on the fleet's object, and nothing said of the session having none.
  const member = await fleetRoute({ own: { fleetID: 654500010000 } });
  assert.deepEqual([member.asked.slice().sort(), member.payload.membership, member.payload.fleetID], [ALL_FIVE.slice().sort(), undefined, "654500010000"]);
  assert.deepEqual(member.payload.reads.GetInitState, { result: fleetState(654500010000) });
  // A transport that cannot say, and the gateway, whose held session does not know: asked, and refused five times.
  for (const options of [{ knows: false }, { transport: "gateway" }]) {
    const unknowing = await fleetRoute(options);
    assert.deepEqual([unknowing.asked.slice().sort(), unknowing.payload.membership, unknowing.given], [ALL_FIVE.slice().sort(), undefined, []], JSON.stringify(options));
    assert.deepEqual(unknowing.payload.reads.GetWings, { error: "CALL_REFUSED", message: "FleetNotInFleet" });
  }
});

test("on the game port a fleet the session has left is a fleet the BFF has forgotten", async () => {
  // The squad board goes by the fleet the BFF holds for the session, which only this route sets.
  const own = { fleetID: 654500010000 };
  const { baseUrl } = await fleetRoute({ own });
  assert.equal((await apiRequest(baseUrl, "/api/bots/squad-board")).payload.fleetID, "654500010000");
  own.fleetID = null;
  assert.equal((await apiRequest(baseUrl, "/api/bridge/bound-fleet")).payload.membership, "none");
  assert.equal((await apiRequest(baseUrl, "/api/bots/squad-board")).payload.error, "FLEET_UNKNOWN");
});

// ── Leaving a fleet ──────────────────────────────────────────────────────────
//
// fleetSvc.LeaveFleet (365): self.fleet.LeaveFleet(), on the fleet's own object, where the client holds one; and
// sm.RemoteSvc('fleetMgr').ForceLeaveFleet() only where it holds none for a fleet the session is in. The route
// asked fleetMgr every time.

const LEAVE = { method: "POST", body: { confirm: true } };

/** The page's "Leave fleet", after a read of the Fleet panel. `log` is everything asked from then on, in order. */
async function leaveFleet(options) {
  const { baseUrl, asked: log } = await fleetRoute(options);
  log.length = 0;
  const unconfirmed = await apiRequest(baseUrl, "/api/bridge/fleet/leave", { method: "POST", body: {} });
  assert.deepEqual([unconfirmed.response.status, log], [400, []]);
  const answer = await apiRequest(baseUrl, "/api/bridge/fleet/leave", LEAVE);
  return { answer, asked: [...log], log, baseUrl };
}

test("on the game port leaving is asked of the fleet's object where one is held, and of fleetMgr only where none is", async () => {
  // Held, in the fleet: on the object the panel's read was made on.
  const member = await leaveFleet({ own: { fleetID: 654500010000, holdsObject: true } });
  assert.deepEqual([member.answer.response.status, member.answer.payload.ok, member.answer.payload.applied, member.asked], [200, true, true, ["fleetObjectHandler.LeaveFleet"]]);
  // Held, with the session not in the fleet (CreateFleet answered, and no more): on the object all the same.
  const early = await leaveFleet({ own: { fleetID: null, holdsObject: true } });
  assert.deepEqual([early.answer.response.status, early.answer.payload.applied, early.asked], [200, true, ["bind fleetObjectHandler", "fleetObjectHandler.LeaveFleet"]]);
  // None held: the client's ForceLeaveFleet, of the service by name, and nothing bound for it.
  for (const options of [
    { own: { fleetID: 654500010000, holdsObject: false } },
    { own: { fleetID: null, holdsObject: false } },
    { own: { fleetID: 654500010000 } },
    { own: { fleetID: 654500010000, holdsObject: true }, knows: false },
    { own: { fleetID: 654500010000, holdsObject: true }, transport: "gateway" },
  ]) {
    const { answer, asked } = await leaveFleet(options);
    assert.deepEqual([answer.response.status, answer.payload.applied, asked], [200, true, ["fleetMgr.ForceLeaveFleet"]], JSON.stringify(options));
  }
});

test("the fleet's handle is not kept across a leaving, refused or not", async () => {
  const own = { fleetID: 654500010000, holdsObject: true, refuses: "LeaveFleet" };
  const { answer, asked, log, baseUrl } = await leaveFleet({ own });
  assert.deepEqual([answer.response.status >= 400, answer.payload.ok, asked], [true, false, ["fleetObjectHandler.LeaveFleet"]], JSON.stringify(answer.payload));
  // A refusal is not proof that nothing changed: the next asking is of an object asked for afresh. And the one after.
  delete own.refuses;
  for (const time of ["after a refusal", "after a leaving"]) {
    log.length = 0;
    const next = await apiRequest(baseUrl, "/api/bridge/fleet/leave", LEAVE);
    assert.deepEqual([next.response.status, next.payload.applied, log], [200, true, ["bind fleetObjectHandler", "fleetObjectHandler.LeaveFleet"]], time);
  }
});

// ── The fleet as it is kept ──────────────────────────────────────────────────
//
// fleetSvc.py reads a fleet's state once and keeps it right from the server's notices; its wings and its message
// with it. Where the game port holds the fleet's object it keeps the fleet the same way (pilots.js fleetKept), and
// the route's reads of those three are answered from it. The route asked the server for all five at every read.

const KEPT_READS = ["GetInitState", "GetWings", "GetMotd"];
const STILL_ASKED = ["bind fleetObjectHandler", "fleetObjectHandler.GetFleetComposition", "fleetObjectHandler.GetJoinRequests"];
const keptFleet = (fleetID) => ({
  GetInitState: fleetState(fleetID),
  GetWings: { type: "dict", entries: [[5, "a wing"]] },
  GetMotd: "kept",
  notifications: [{ kind: "client", method: "OnFleetJoin", args: [] }],
});

test("on the game port a fleet whose object is held is read from what is kept, and only the rest is asked", async () => {
  const kept = keptFleet(654500010000);
  const own = { fleetID: 654500010000, holdsObject: true, kept: () => kept };
  const { payload, asked, keptAsked, baseUrl } = await fleetRoute({ own });
  assert.deepEqual(asked.slice().sort(), STILL_ASKED);
  assert.deepEqual(KEPT_READS.map((name) => payload.reads[name]), [{ result: kept.GetInitState }, { result: kept.GetWings }, { result: "kept" }]);
  assert.deepEqual([payload.reads.GetJoinRequests, payload.reads.GetFleetComposition], [{ result: null }, { result: null }]);
  // What was kept is asked for as the pilot's own, and its notices come with the route's.
  assert.deepEqual(keptAsked, [{ sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  assert.deepEqual([payload.fleetID, payload.membership, payload.notifications], ["654500010000", undefined, kept.notifications]);
  // The fleet the BFF holds for the session is the kept state's own.
  assert.equal((await apiRequest(baseUrl, "/api/bots/squad-board")).payload.fleetID, "654500010000");
  // A message of the day that is empty is an answer, and so is one that is None.
  for (const motd of ["", null]) {
    kept.GetMotd = motd;
    assert.deepEqual((await apiRequest(baseUrl, "/api/bridge/bound-fleet")).payload.reads.GetMotd, { result: motd }, JSON.stringify(motd));
  }
});

test("with nothing kept the fleet is asked all five, as before", async () => {
  const fleetID = 654500010000;
  for (const [why, options] of [
    ["no object is held", { own: { fleetID, holdsObject: false, kept: () => keptFleet(fleetID) } }],
    ["nothing could be read", { own: { fleetID, holdsObject: true, kept: () => null } }],
    ["the reading failed", { own: { fleetID, holdsObject: true, kept: () => { throw Object.assign(new Error("lost"), { code: "CALL_FAILED" }); } } }],
    ["the transport keeps none", { own: { fleetID, holdsObject: true } }],
    ["the gateway", { own: { fleetID, holdsObject: true, kept: () => keptFleet(fleetID) }, transport: "gateway" }],
  ]) {
    const { payload, asked, keptAsked } = await fleetRoute(options);
    assert.deepEqual(asked.slice().sort(), ALL_FIVE.slice().sort(), why);
    assert.deepEqual(payload.reads.GetInitState, { result: fleetState(fleetID) }, why);
    // Kept or not is asked only where an object is held, and only of the game port.
    assert.equal(keptAsked.length, why === "nothing could be read" || why === "the reading failed" ? 1 : 0, why);
  }
});

test("a session the game port has lost while the kept fleet is read is forgotten, and the route says so", async () => {
  const own = { fleetID: 654500010000, holdsObject: true, kept: () => { throw Object.assign(new Error("gone"), { code: "SESSION_NOT_FOUND", statusCode: 404 }); } };
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const asked = [];
  gamePort.bindObject = async (service) => { asked.push(`bind ${service}`); return { boundHandle: "h", notifications: [] }; };
  gamePort.callBoundMethod = async (service, method) => { asked.push(`${service}.${method}`); return { service, method, result: null, notifications: [] }; };
  gamePort.fleet = () => own;
  gamePort.fleetKept = async () => own.kept();
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => "gameport" });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answer = await apiRequest(baseUrl, "/api/bridge/bound-fleet");
  assert.deepEqual([answer.response.status, answer.payload.ok, asked], [404, false, []]);
  // The pilot is no longer held: the next read is refused for want of one.
  const next = await apiRequest(baseUrl, "/api/bridge/bound-fleet");
  assert.equal(next.response.status >= 400, true);
  assert.notEqual(next.response.status, 404);
});

test("a fleet kept whole is read with nothing asked of the server, and what is not kept of it is not an error", async () => {
  // pilots.js fleetKept answers all five where the fleet's object is held: the join requests and the composition
  // as the client's own windows for them would have them, which for most pilots is none.
  const kept = { ...keptFleet(654500010000), GetJoinRequests: { type: "dict", entries: [] }, GetFleetComposition: null };
  const { payload, asked } = await fleetRoute({ own: { fleetID: 654500010000, holdsObject: true, kept: () => kept } });
  assert.deepEqual(asked, []);
  assert.deepEqual([payload.reads.GetJoinRequests, payload.reads.GetFleetComposition], [{ result: { type: "dict", entries: [] } }, { result: null }]);
  assert.deepEqual(Object.keys(payload.reads).sort(), FLEET_READ_NAMES.slice().sort());
  assert.equal(Object.values(payload.reads).some((read) => "error" in read), false);
});

// ── The standings as they are kept ───────────────────────────────────────────
//
// standingsvc.py reads a character's standings when it is chosen and keeps them right from the server's notices.
// The game port keeps them the same way (pilots.js standingsKept), and the Standings route's two lists are
// answered from that. The route asked the server for both at every read.

const standingsRowset = (rows) => ({ type: "object", name: "eve.common.script.sys.rowset.Rowset", args: { type: "dict", entries: [["header", { type: "list", items: ["fromID", "standing"] }], ["lines", { type: "list", items: rows.map((items) => ({ type: "list", items })) }]] } });

/** A pilot reading its standings; on the game port unless told otherwise. Says what was asked of standingMgr and what the route answered. */
async function standingsRoute({ transport = "gameport", kept, query = "" } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  const asked = [];
  backend.callMethod = async (service, method, args) => {
    asked.push([`${service}.${method}`, args]);
    return { service, method, result: `asked ${method}`, notifications: [] };
  };
  const keptAsked = [];
  if (kept !== undefined) gamePort.standingsKept = async (sessionFields, bridgeSessionID) => { keptAsked.push({ sessionFields, bridgeSessionID }); return kept(); };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  asked.length = 0;
  const answer = await apiRequest(baseUrl, `/api/bridge/standings${query}`);
  return { answer, payload: answer.payload, asked, pairs: asked.map(([pair]) => pair), keptAsked, baseUrl };
}

test("on the game port a pilot's standings are read from what is kept, and the server is asked only for an owner's detail", async () => {
  const kept = { char: standingsRowset([[500001, 1.5]]), corp: standingsRowset([[500001, -1.5]]) };
  const lists = await standingsRoute({ kept: () => kept });
  assert.deepEqual([lists.answer.response.status, lists.pairs, lists.payload.char, lists.payload.corp], [200, [], kept.char, kept.corp]);
  assert.deepEqual(lists.payload.errors, { char: null, corp: null, transactions: null, compositions: null });
  assert.deepEqual(lists.keptAsked, [{ sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  // A pilot in an NPC corporation has none kept for its corporation: that is the route's answer, as it was.
  const npc = await standingsRoute({ kept: () => ({ char: kept.char, corp: null }) });
  assert.deepEqual([npc.pairs, npc.payload.char, npc.payload.corp, npc.payload.errors.corp], [[], kept.char, null, null]);
  // One owner's history and make-up are asked for as before, beside the kept lists.
  const detail = await standingsRoute({ kept: () => kept, query: "?fromID=500001" });
  assert.deepEqual(detail.asked, [["standingMgr.GetStandingTransactions", [500001, 7]], ["standingMgr.GetStandingCompositions", [500001, 98000000]]]);
  assert.deepEqual([detail.payload.char, detail.payload.transactions, detail.payload.compositions], [kept.char, "asked GetStandingTransactions", "asked GetStandingCompositions"]);
});

test("with no standings kept, and on the gateway, the server is asked for them as before", async () => {
  for (const [why, options, keptTimes] of [
    ["none could be read", { kept: () => null }, 1],
    ["the reading failed", { kept: () => { throw Object.assign(new Error("lost"), { code: "CALL_FAILED" }); } }, 1],
    ["the transport keeps none", {}, 0],
    ["the gateway", { kept: () => ({ char: standingsRowset([]), corp: null }), transport: "gateway" }, 0],
  ]) {
    const { payload, pairs, keptAsked } = await standingsRoute(options);
    // The stand-in pilot's corporation is a player's: both lists.
    assert.deepEqual([pairs, payload.char, payload.corp, keptAsked.length], [["standingMgr.GetCharStandings", "standingMgr.GetCorpStandings"], "asked GetCharStandings", "asked GetCorpStandings", keptTimes], why);
  }
  // A session the game port has lost while the kept standings are read is forgotten, and the route says so.
  const lost = await standingsRoute({ kept: () => { throw Object.assign(new Error("gone"), { code: "SESSION_NOT_FOUND", statusCode: 404 }); } });
  assert.deepEqual([lost.answer.response.status, lost.payload.ok, lost.pairs], [404, false, []]);
  const next = await apiRequest(lost.baseUrl, "/api/bridge/standings");
  assert.equal(next.response.status >= 400 && next.response.status !== 404, true);
});

// ── the Skills sheet ─────────────────────────────────────────────────────────
//
// The page's Skills window reads one sheet. The gateway's is a snapshot the server builds for the web gateway,
// which no retail client asks for. On the game port the sheet is the transport's, made from what the client's
// skill services keep (pilots.js skillSheet), and the gateway's is what there is where that cannot be made.

const sheetNamed = (characterName) => ({ characterID: 7, characterName, totalSkillPoints: 5, freeSkillPoints: 0, serverNowMs: 1, skills: [], queue: { active: false, entries: [], endTimeMs: null, maxEntries: 150 }, queueWarning: null });
const SHEET_KEPT = sheetNamed("from what is kept");
const SHEET_GATEWAY = sheetNamed("the gateway's");

/** A pilot reading its skill sheet, or saving a queue, on the game port unless told otherwise. Says whose sheet answered and what was asked on the way. */
async function skillsRoute({ transport = "gameport", sheet, save, saving } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  const asked = [];
  backend.callMethod = async (service, method, args, kwargs) => {
    asked.push([`${service}.${method}`, args, kwargs]);
    return { service, method, result: null, notifications: ["a notice"] };
  };
  const gatewayRead = [];
  gateway.getSkills = async (accountID, characterID) => { gatewayRead.push([accountID, characterID]); return SHEET_GATEWAY; };
  const sheetAsked = [];
  if (sheet !== undefined) gamePort.skillSheet = async (sessionFields, bridgeSessionID) => { sheetAsked.push({ sessionFields, bridgeSessionID }); return sheet(); };
  const saves = [];
  gamePort.saveSkillQueue = async (entries, sessionFields, bridgeSessionID) => {
    saves.push({ entries, sessionFields, bridgeSessionID });
    if (saving) return saving();
    return { service: "skillHandler", method: "SaveNewQueue", result: null, notifications: ["the save's notice"] };
  };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  asked.length = 0;
  const answer = save === undefined ? await apiRequest(baseUrl, "/api/bridge/skills") : await apiRequest(baseUrl, "/api/bridge/skills/queue", { method: "POST", body: save });
  return { answer, payload: answer.payload, asked, gatewayRead, sheetAsked, saves, baseUrl };
}

test("on the game port the Skills sheet is the transport's own, made from what is kept, and the gateway's snapshot is not read", async () => {
  const read = await skillsRoute({ sheet: () => SHEET_KEPT });
  assert.deepEqual([read.answer.response.status, read.payload, read.asked, read.gatewayRead], [200, { ok: true, skills: SHEET_KEPT }, [], []]);
  assert.deepEqual(read.sheetAsked, [{ sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  // A queue saved: the transport saves it as the client's queue panel does, and what answers is the kept sheet with
  // what the save pushed. Nothing is asked by name.
  const saved = await skillsRoute({ sheet: () => SHEET_KEPT, save: { entries: [{ typeID: 3300, toLevel: 5 }, { typeID: 3327, toLevel: 4 }] } });
  assert.deepEqual([saved.saves, saved.asked], [[{ entries: [[3300, 5], [3327, 4]], sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }], []]);
  assert.deepEqual([saved.payload, saved.gatewayRead, saved.sheetAsked.length], [{ ok: true, notifications: ["the save's notice"], skills: SHEET_KEPT }, [], 1]);
  const emptied = await skillsRoute({ sheet: () => SHEET_KEPT, save: { entries: [] } });
  assert.deepEqual([emptied.saves.map((each) => each.entries), emptied.asked, emptied.payload.skills], [[[]], [], SHEET_KEPT]);
  // A queue that is no queue is refused before anything is asked of the transport.
  for (const body of [{}, { entries: "3300" }, { entries: [{ typeID: 3300, toLevel: 6 }] }, { entries: [{ typeID: 0, toLevel: 1 }] }]) {
    const bad = await skillsRoute({ sheet: () => SHEET_KEPT, save: body });
    assert.deepEqual([bad.answer.response.status, bad.saves, bad.sheetAsked], [400, [], []], JSON.stringify(body));
  }
  // What the server refuses is the route's refusal, in the server's own word, and no sheet is made for it.
  const refused = await skillsRoute({ sheet: () => SHEET_KEPT, save: { entries: [{ typeID: 3300, toLevel: 5 }] }, saving: () => { throw Object.assign(new Error("QueueTooLong"), { code: "CALL_REFUSED", statusCode: 409 }); } });
  assert.deepEqual([refused.answer.response.status, refused.payload.error, refused.payload.message, refused.sheetAsked], [409, "CALL_REFUSED", "QueueTooLong", []]);
  // A session lost under the save is forgotten.
  const lost = await skillsRoute({ sheet: () => SHEET_KEPT, save: { entries: [] }, saving: () => { throw Object.assign(new Error("gone"), { code: "SESSION_NOT_FOUND", statusCode: 404 }); } });
  assert.equal(lost.answer.response.status, 404);
  const next = await apiRequest(lost.baseUrl, "/api/bridge/skills");
  assert.equal(next.response.status >= 400 && next.response.status !== 404, true);
});

test("on the gateway a queue is saved by name, as before: started unless it is empty", async () => {
  const saved = await skillsRoute({ transport: "gateway", save: { entries: [{ typeID: 3300, toLevel: 5 }, { typeID: 3327, toLevel: 4 }] } });
  assert.deepEqual([saved.asked, saved.saves, saved.payload], [[["skillMgr.SaveNewQueue", [[[3300, 5], [3327, 4]]], { activate: true }]], [], { ok: true, notifications: ["a notice"], skills: SHEET_GATEWAY }]);
  const emptied = await skillsRoute({ transport: "gateway", save: { entries: [] } });
  assert.deepEqual([emptied.asked, emptied.saves], [[["skillMgr.SaveNewQueue", [[]], { activate: false }]], []]);
});

test("where the transport cannot make a sheet, and on the gateway, the sheet is the gateway's as before", async () => {
  for (const [why, options, sheetTimes] of [
    ["the making failed", { sheet: () => { throw Object.assign(new Error("refused"), { code: "CALL_REFUSED", statusCode: 409 }); } }, 1],
    ["the transport makes none", {}, 0],
    ["the gateway", { sheet: () => SHEET_KEPT, transport: "gateway" }, 0],
  ]) {
    const read = await skillsRoute(options);
    assert.deepEqual([read.answer.response.status, read.payload, read.gatewayRead, read.sheetAsked.length], [200, { ok: true, skills: SHEET_GATEWAY }, [[4, 7]], sheetTimes], why);
    const saved = await skillsRoute({ ...options, save: { entries: [{ typeID: 3300, toLevel: 5 }] } });
    const onGateway = options.transport === "gateway";
    assert.deepEqual([saved.payload.skills, saved.payload.notifications, saved.asked.length, saved.saves.length, saved.gatewayRead], [SHEET_GATEWAY, [onGateway ? "a notice" : "the save's notice"], onGateway ? 1 : 0, onGateway ? 0 : 1, [[4, 7]]], why);
  }
  // A session the game port has lost while the sheet is made is forgotten, and the route says so. The gateway's is not read in its place.
  const lost = await skillsRoute({ sheet: () => { throw Object.assign(new Error("gone"), { code: "SESSION_NOT_FOUND", statusCode: 404 }); } });
  assert.deepEqual([lost.answer.response.status, lost.payload.ok, lost.gatewayRead], [404, false, []]);
  const next = await apiRequest(lost.baseUrl, "/api/bridge/skills");
  assert.equal(next.response.status >= 400 && next.response.status !== 404, true);
});

// ── the agents' journal ──────────────────────────────────────────────────────
//
// sensorSuiteService asks the system's scan manager for the sites it knows of: the object GetSystemScanMgr()
// answers. The scanner's route asks so on the game port, and by the service's name on the gateway, as it did.

/** The scanner's read through the route; on the game port unless told otherwise. Says what was bound, and asked of what. */
async function scanFullState({ transport = "gameport", answer = () => ({ type: "list", items: ["sites"] }) } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  const asked = [];
  backend.callMethod = async (service, method, args) => { asked.push({ byName: `${service}.${method}`, args }); return { service, method, result: answer(), notifications: [] }; };
  backend.bindObject = async (service, method, args) => { asked.push({ bound: `${service}.${method}`, args }); return { boundHandle: "the-scan-manager", notifications: [] }; };
  backend.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    asked.push({ onObject: `${service}.${method}`, args, kwargs, sessionFields, handle });
    return { service, method, result: answer(), notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  asked.length = 0;
  const read = () => apiRequest(baseUrl, "/api/bridge/scan-full-state");
  return { first: await read(), again: await read(), asked };
}

test("on the game port the scanner's sites are asked of the system's scan manager, bound once, and by name on the gateway as before", async () => {
  const onGamePort = await scanFullState();
  assert.deepEqual([onGamePort.first.response.status, onGamePort.first.payload.reads, onGamePort.again.payload.reads], [200, { GetFullState: { result: { type: "list", items: ["sites"] } } }, { GetFullState: { result: { type: "list", items: ["sites"] } } }]);
  // GetSystemScanMgr() once, and GetFullState() on what it answered, with nothing, each time.
  const onObject = { onObject: "scanMgr.GetFullState", args: [], kwargs: null, sessionFields: { userid: 4 }, handle: "the-scan-manager" };
  assert.deepEqual(onGamePort.asked, [{ bound: "scanMgr.GetSystemScanMgr", args: [] }, onObject, onObject]);
  const onGateway = await scanFullState({ transport: "gateway" });
  assert.deepEqual([onGateway.first.payload.reads, onGateway.asked], [{ GetFullState: { result: { type: "list", items: ["sites"] } } }, [{ byName: "scanMgr.GetFullState", args: [] }, { byName: "scanMgr.GetFullState", args: [] }]]);
  // A read the server refuses is the read's own failure, in the route's envelope, on either transport.
  const refused = await scanFullState({ answer: () => { throw Object.assign(new Error("NotNow"), { code: "CALL_REFUSED", statusCode: 409 }); } });
  assert.deepEqual([refused.first.response.status, refused.first.payload.reads], [200, { GetFullState: { error: "CALL_REFUSED", message: "NotNow" } }]);
});

// cfg.eveowners names a player's corporation, alliance or character by asking the game server
// (config.GetMultiOwnersEx). The game port asks as the client does and keeps the rows (pilots.js ownersNamed), and
// the names route asks it for what the static tables cannot name.

const [PLAYER_CORPORATION, PLAYER_ALLIANCE, PLAYER_CHARACTER] = [98000007, 99000007, 140000099];
const OWNER_ROWS = { [PLAYER_CORPORATION]: { name: "Made-up Industries", typeID: 2 }, [PLAYER_ALLIANCE]: { name: "Made-up", typeID: 16159 }, [PLAYER_CHARACTER]: { name: "Someone Else", typeID: 1380 } };
/** Static tables that name one NPC corporation and one player's character, and nothing else. */
const [NPC_CORPORATION, CHARACTER_THE_TABLES_NAME] = [1000125, 140000098];
const STATIC_NAMES = { [`corporation:${NPC_CORPORATION}`]: "CONCORD", [`character:${CHARACTER_THE_TABLES_NAME}`]: "Named By The Tables" };
const staticNames = () => ({
  ...fakeStaticData(),
  resolveNames({ items }) {
    return { names: Object.fromEntries(items.map((item) => [`${item.kind}:${item.id}`, STATIC_NAMES[`${item.kind}:${item.id}`] ?? null])), capped: false, limit: 500 };
  },
});

/** Names asked of the names route; with a pilot held on the game port unless told otherwise. Says what the transport was asked. */
async function namesRoute(items, { transport = "gameport", online = true, owners = (ownerIDs) => new Map(ownerIDs.map((ownerID) => [ownerID, OWNER_ROWS[ownerID] ?? null])), gamePortPilots = true } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const asked = [];
  gamePort.ownersNamed = async (ownerIDs, sessionFields, bridgeSessionID) => { asked.push({ ownerIDs, sessionFields, bridgeSessionID }); return owners(ownerIDs); };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePortPilots ? gamePort : undefined, pilotTransportFor: () => transport, staticData: staticNames() });
  if (online) await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answer = await apiRequest(baseUrl, "/api/names", { method: "POST", body: { items } });
  return { answer, payload: answer.payload, asked };
}
const named = (kind, id) => ({ kind, id });

test("a player's corporation, alliance or character the static tables cannot name is asked of the game server as the client asks", async () => {
  const read = await namesRoute([named("corporation", PLAYER_CORPORATION), named("alliance", PLAYER_ALLIANCE), named("character", PLAYER_CHARACTER), named("owner", PLAYER_ALLIANCE), named("corporation", NPC_CORPORATION), named("type", 587)]);
  assert.deepEqual(read.payload.names, {
    [`corporation:${PLAYER_CORPORATION}`]: "Made-up Industries", [`alliance:${PLAYER_ALLIANCE}`]: "Made-up", [`character:${PLAYER_CHARACTER}`]: "Someone Else",
    [`owner:${PLAYER_ALLIANCE}`]: "Made-up", [`corporation:${NPC_CORPORATION}`]: "CONCORD", "type:587": null,
  });
  // Asked once, for the players' owners only, as the pilot the page has online; what the static tables name is not asked about.
  assert.deepEqual(read.asked, [{ ownerIDs: [PLAYER_CORPORATION, PLAYER_ALLIANCE, PLAYER_CHARACTER, PLAYER_ALLIANCE], sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  assert.deepEqual([read.payload.source, read.payload.unresolved], ["static-data+game-server-owners", []]);
  // Nothing of a player's that the static tables cannot name: the game server is not asked.
  // (The last of the NPCs' owners is one below 90,000,000, the first of the players': idCheckers.IsNPC.)
  const npc = await namesRoute([named("corporation", NPC_CORPORATION), named("corporation", 1000126), named("type", 98000007), named("station", 60003760), named("character", CHARACTER_THE_TABLES_NAME), named("character", 3999999), named("owner", 89999999)]);
  assert.deepEqual([npc.asked, npc.payload.source, npc.payload.names[`corporation:${NPC_CORPORATION}`], npc.payload.names["corporation:1000126"], npc.payload.names[`character:${CHARACTER_THE_TABLES_NAME}`]], [[], "static-data", "CONCORD", null, "Named By The Tables"]);
});

test("an owner is named only as the kind of thing it is, and one the server has no name for stays unknown", async () => {
  // A character's ID asked about as a corporation, an alliance's as a character, a corporation's as an alliance: none is that.
  const wrong = await namesRoute([named("corporation", PLAYER_CHARACTER), named("character", PLAYER_ALLIANCE), named("alliance", PLAYER_CORPORATION), named("character", PLAYER_CORPORATION), named("owner", PLAYER_CHARACTER)]);
  assert.deepEqual(wrong.payload.names, {
    [`corporation:${PLAYER_CHARACTER}`]: null, [`character:${PLAYER_ALLIANCE}`]: null, [`alliance:${PLAYER_CORPORATION}`]: null, [`character:${PLAYER_CORPORATION}`]: null, [`owner:${PLAYER_CHARACTER}`]: "Someone Else",
  });
  // No row, a row with no name, and this server's row for what is no owner (type nought): unknown, and known to be.
  const none = await namesRoute([named("corporation", 98000050), named("corporation", 98000051), named("owner", 98000052), named("character", 98000052)], {
    owners: () => new Map([[98000050, null], [98000051, { name: null, typeID: 2 }], [98000052, { name: "Item 98000052", typeID: 0 }]]),
  });
  assert.deepEqual([Object.values(none.payload.names), none.payload.unresolved], [[null, null, null, null], []]);
});

test("with no pilot online, or a refusal, a player's owner is not known rather than nameless; on the gateway it is as it was", async () => {
  const items = [named("corporation", PLAYER_CORPORATION), named("corporation", NPC_CORPORATION)];
  // No pilot online yet: nobody to ask as. The page is told to ask again.
  const offline = await namesRoute(items, { online: false });
  assert.deepEqual([offline.asked, offline.payload.names[`corporation:${PLAYER_CORPORATION}`], offline.payload.unresolved, offline.payload.source], [[], null, [`corporation:${PLAYER_CORPORATION}`], "static-data"]);
  // The asking refused: the same.
  const refused = await namesRoute(items, { owners: () => { throw Object.assign(new Error("NotNow"), { code: "CALL_REFUSED", statusCode: 409 }); } });
  assert.deepEqual([refused.answer.response.status, refused.payload.names[`corporation:${PLAYER_CORPORATION}`], refused.payload.unresolved, refused.payload.names[`corporation:${NPC_CORPORATION}`]], [200, null, [`corporation:${PLAYER_CORPORATION}`], "CONCORD"]);
  // A pilot on the gateway, and a BFF with no game port at all: the static tables' answer stands, as before.
  for (const options of [{ transport: "gateway" }, { transport: "gateway", gamePortPilots: false }, { online: false, gamePortPilots: false }]) {
    const before = await namesRoute(items, options);
    assert.deepEqual([before.asked, before.payload.names[`corporation:${PLAYER_CORPORATION}`], before.payload.unresolved, before.payload.source], [[], null, [], "static-data"], JSON.stringify(options));
  }
});

// journal.py reads the journal once, keeps it, and makes it right from each changed mission's own agent. The game
// port keeps it the same way (pilots.js journalKept), and the Journal route answers from that.

const journalAnswer = (...agentIDs) => [{ type: "list", items: agentIDs.map((agentID) => [1, 0, "UI/Agents/MissionTypes/Courier", 57959, agentID]) }, { type: "list", items: [] }];

/** A pilot reading its journal; on the game port unless told otherwise. Says what was asked of agentMgr and what the route answered. */
async function journalRoute({ transport = "gameport", kept } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  const asked = [];
  backend.callMethod = async (service, method, args) => {
    asked.push([`${service}.${method}`, args]);
    return { service, method, result: "asked by name", notifications: [] };
  };
  const keptAsked = [];
  if (kept !== undefined) gamePort.journalKept = async (sessionFields, bridgeSessionID) => { keptAsked.push({ sessionFields, bridgeSessionID }); return kept(); };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  asked.length = 0;
  const answer = await apiRequest(baseUrl, "/api/bridge/journal");
  return { answer, payload: answer.payload, asked, keptAsked, baseUrl };
}

test("on the game port the journal is read from what is kept, and the server is not asked for it", async () => {
  const kept = journalAnswer(3008416);
  const read = await journalRoute({ kept: () => kept });
  assert.deepEqual([read.answer.response.status, read.payload, read.asked], [200, { ok: true, result: kept }, []]);
  assert.deepEqual(read.keptAsked, [{ sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  // An empty journal is a journal.
  const empty = await journalRoute({ kept: () => journalAnswer() });
  assert.deepEqual([empty.payload, empty.asked], [{ ok: true, result: journalAnswer() }, []]);
});

test("with no journal kept, and on the gateway, the server is asked for it as before; a reading refused is the route's refusal", async () => {
  const none = await journalRoute({ kept: () => null });
  assert.deepEqual([none.payload, none.asked, none.keptAsked.length], [{ ok: true, result: "asked by name" }, [["agentMgr.GetMyJournalDetails", []]], 1]);
  const gateway = await journalRoute({ kept: () => journalAnswer(1), transport: "gateway" });
  assert.deepEqual([gateway.payload, gateway.asked, gateway.keptAsked], [{ ok: true, result: "asked by name" }, [["agentMgr.GetMyJournalDetails", []]], []]);
  // The reading refused by the server: the route says so, and does not ask by name behind it.
  const refused = await journalRoute({ kept: () => { throw Object.assign(new Error("NotNow"), { code: "CALL_REFUSED", statusCode: 409 }); } });
  assert.deepEqual([refused.answer.response.status, refused.payload.error, refused.asked], [409, "CALL_REFUSED", []]);
  // A session the game port has lost while the journal is read is forgotten, and the route says so.
  const lost = await journalRoute({ kept: () => { throw Object.assign(new Error("gone"), { code: "SESSION_NOT_FOUND", statusCode: 404 }); } });
  assert.deepEqual([lost.answer.response.status, lost.payload.ok, lost.asked], [404, false, []]);
  const next = await apiRequest(lost.baseUrl, "/api/bridge/journal");
  assert.equal(next.response.status >= 400 && next.response.status !== 404, true);
});

// ── a follow or an orbit, and the throttle ───────────────────────────────────
//
// The client's autopilot sends CmdSetSpeedFraction(1.0) before its approach, the one with no range. Its menu's
// approach, keep at range and orbit send the one command and nothing before it, and are recorded so on
// Tranquility. The routes do the same on the game port, and open the throttle before each through the gateway, as
// they always have.

const [FOLLOWED, PILOTS_SYSTEM] = [9001, 30000142];
const THROTTLE_OPENED = ["CmdSetSpeedFraction", [1]];
/** One of the flight's routes asked of a pilot in space; on the game port unless told otherwise. Says what was sent to the ballpark's object, in order. */
async function flown(path, body, { transport = "gameport", alreadySo = null } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  const gateway = fakeGateway();
  const backend = transport === "gameport" ? gamePort : gateway;
  const asked = [];
  // Whether the ship is already flying an order is the pilot's transport's to say, where it can (pilots.js alreadyFollowing).
  const wondered = [];
  if (alreadySo !== null) {
    for (const each of [gamePort, gateway]) each.alreadyFollowing = (bridgeSessionID, sessionFields, ...order) => { wondered.push({ sessionFields, order }); return alreadySo(...order); };
  }
  backend.readFlightStatus = async () => ({ flight: { docked: false, inSpace: true, stationID: null, solarSystemID: PILOTS_SYSTEM, shipID: 9002 }, notifications: [] });
  backend.readSpaceSnapshot = async () => ({ space: { inSpace: true, solarSystemID: PILOTS_SYSTEM, ship: { itemID: 9002 }, entities: [] }, notifications: [] });
  backend.bindObject = async (service, method, args) => { asked.push({ bound: `${service}.${method}`, args }); return { boundHandle: "the-park", notifications: [] }; };
  backend.callBoundMethod = async (service, method, args, kwargs, sessionFields, bridgeSessionID, handle) => {
    asked.push({ sent: [method, args], on: [service, handle] });
    return { service, method, result: null, notifications: [] };
  };
  const { baseUrl } = await startTestServer({ gateway, gamePortPilots: gamePort, pilotTransportFor: () => transport });
  // A pilot is not moved until the page has said its check for lost drones is done.
  const selected = await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const ready = await apiRequest(baseUrl, "/api/bridge/drone-recovery/ready", { method: "POST", body: { checkID: selected.payload.droneRecoveryCheckID } });
  assert.equal(ready.response.status, 200, JSON.stringify(ready.payload));
  asked.length = 0;
  const answer = await apiRequest(baseUrl, path, { method: "POST", body });
  const sent = asked.filter((each) => each.sent);
  return { payload: answer.payload, wondered, status: answer.response.status, sent: sent.map((each) => each.sent), on: [...new Set(sent.map((each) => each.on.join(" ")))], bound: asked.filter((each) => each.bound).map((each) => each.bound) };
}

test("on the game port the throttle is opened only before the autopilot's approach: the menu's approach, keep at range and orbit go alone", async () => {
  // The menu's approach, at the route's own 50 m or at a range the page names.
  const menus = await flown("/api/bridge/flight/approach", { destinationID: FOLLOWED });
  assert.deepEqual([menus.status, menus.sent, menus.on, menus.bound], [200, [["CmdFollowBall", [FOLLOWED, 50]]], ["beyonce the-park"], ["beyonce.MachoBindObject"]]);
  assert.deepEqual((await flown("/api/bridge/flight/approach", { destinationID: FOLLOWED, range: 3000 })).sent, [["CmdFollowBall", [FOLLOWED, 3000]]]);
  // The autopilot's: no range, and the throttle opened first.
  assert.deepEqual((await flown("/api/bridge/flight/approach", { destinationID: FOLLOWED, range: 0 })).sent, [THROTTLE_OPENED, ["CmdFollowBall", [FOLLOWED, 0]]]);
  // Keep at range and orbit are the menu's, whatever the range.
  assert.deepEqual((await flown("/api/bridge/flight/keep-at-range", { targetID: FOLLOWED, range: 5000 })).sent, [["CmdFollowBall", [FOLLOWED, 5000]]]);
  assert.deepEqual((await flown("/api/bridge/flight/keep-at-range", { targetID: FOLLOWED })).sent, [["CmdFollowBall", [FOLLOWED, 1000]]]);
  assert.deepEqual((await flown("/api/bridge/flight/orbit", { targetID: FOLLOWED, range: 2500 })).sent, [["CmdOrbit", [FOLLOWED, 2500]]]);
  assert.deepEqual((await flown("/api/bridge/flight/orbit", { targetID: FOLLOWED })).sent, [["CmdOrbit", [FOLLOWED, 1000]]]);
});

test("through the gateway an approach, keep at range and orbit each open the throttle first, as before", async () => {
  for (const [path, body, command] of [
    ["/api/bridge/flight/approach", { destinationID: FOLLOWED }, ["CmdFollowBall", [FOLLOWED, 50]]],
    ["/api/bridge/flight/approach", { destinationID: FOLLOWED, range: 0 }, ["CmdFollowBall", [FOLLOWED, 0]]],
    ["/api/bridge/flight/keep-at-range", { targetID: FOLLOWED, range: 5000 }, ["CmdFollowBall", [FOLLOWED, 5000]]],
    ["/api/bridge/flight/orbit", { targetID: FOLLOWED, range: 2500 }, ["CmdOrbit", [FOLLOWED, 2500]]],
  ]) {
    const { status, sent } = await flown(path, body, { transport: "gateway" });
    assert.deepEqual([status, sent], [200, [THROTTLE_OPENED, command]], `${path} ${JSON.stringify(body)}`);
  }
});

// The client's menu sends nothing for an approach, keep at range or orbit the ship is already flying
// (movementFunctions._IsAlreadyFollowingBallAtRange). On the game port the routes ask the pilot's transport, which
// has the ship's own ballpark, and hold the order back as the client does.

test("on the game port an approach, keep at range or orbit the ship is already flying is not sent again, and the autopilot's always is", async () => {
  const WHOSE_PILOT = { userid: 4 };
  for (const [path, body, order] of [
    ["/api/bridge/flight/approach", { destinationID: FOLLOWED }, ["CmdFollowBall", FOLLOWED, 50]],
    ["/api/bridge/flight/approach", { destinationID: FOLLOWED, range: 3000 }, ["CmdFollowBall", FOLLOWED, 3000]],
    ["/api/bridge/flight/keep-at-range", { targetID: FOLLOWED, range: 5000 }, ["CmdFollowBall", FOLLOWED, 5000]],
    ["/api/bridge/flight/orbit", { targetID: FOLLOWED, range: 2500 }, ["CmdOrbit", FOLLOWED, 2500]],
  ]) {
    const held = await flown(path, body, { alreadySo: () => true });
    assert.deepEqual([held.status, held.sent, held.wondered, held.payload.ok, held.payload.alreadySo, held.payload.result], [200, [], [{ sessionFields: WHOSE_PILOT, order }], true, true, null], path);
    // Not already so: sent, and nothing said of it.
    const sent = await flown(path, body, { alreadySo: () => false });
    assert.deepEqual([sent.sent, sent.wondered.length, "alreadySo" in sent.payload], [[[order[0], order.slice(1)]], 1, false], path);
  }
  // The autopilot's approach is sent whatever the ship is doing: the client's autopilot does not look.
  const autopilots = await flown("/api/bridge/flight/approach", { destinationID: FOLLOWED, range: 0 }, { alreadySo: () => true });
  assert.deepEqual([autopilots.sent, autopilots.wondered, "alreadySo" in autopilots.payload], [[THROTTLE_OPENED, ["CmdFollowBall", [FOLLOWED, 0]]], [], false]);
  // A transport that cannot say is not asked, and the order is sent.
  assert.deepEqual((await flown("/api/bridge/flight/orbit", { targetID: FOLLOWED, range: 2500 })).sent, [["CmdOrbit", [FOLLOWED, 2500]]]);
});

test("through the gateway an order is sent whether the ship is flying it already or not, as before", async () => {
  const sent = await flown("/api/bridge/flight/approach", { destinationID: FOLLOWED }, { transport: "gateway", alreadySo: () => true });
  assert.deepEqual([sent.status, sent.sent, sent.wondered, "alreadySo" in sent.payload], [200, [THROTTLE_OPENED, ["CmdFollowBall", [FOLLOWED, 50]]], [], false]);
});

// The Market read says the broker's fee rate the pilot will pay where it is docked, so that the page can show the
// fee and not an estimate at the base rate. On the game port the transport works it out as the client does
// (pilots.js brokersFeeAt). Through the gateway nothing does, and the read says none.

async function marketRead({ transport = "gameport", rate = async () => 0.0295803 } = {}) {
  const gamePort = gamePortWithQuestions(() => ({ answered: true }));
  gamePort.readFlightStatus = async () => ({ flight: { docked: true, inSpace: false, stationID: SELECT_SESSION_ECHO.stationID, solarSystemID: SELECT_SESSION_ECHO.solarSystemID, shipID: SELECT_SESSION_ECHO.shipID }, notifications: [] });
  gamePort.callMethod = async (service, method) => ({ service, method, result: null, notifications: [] });
  const asked = [];
  gamePort.brokersFeeRate = async (stationID, sessionFields, bridgeSessionID) => { asked.push({ stationID, sessionFields, bridgeSessionID }); return rate(); };
  const { baseUrl } = await startTestServer({ gateway: fakeGateway(), gamePortPilots: gamePort, pilotTransportFor: () => transport });
  await apiRequest(baseUrl, "/api/bridge/select", { method: "POST", body: { characterID: 7 } });
  const answer = await apiRequest(baseUrl, "/api/bridge/market");
  assert.equal(answer.response.status, 200, JSON.stringify(answer.payload));
  return { payload: answer.payload, asked };
}

test("on the game port the Market read says the broker's fee rate the pilot pays where it is docked", async () => {
  const { payload, asked } = await marketRead();
  assert.equal(payload.brokersFeeRate, 0.0295803);
  assert.deepEqual(asked, [{ stationID: SELECT_SESSION_ECHO.stationID, sessionFields: { userid: 4 }, bridgeSessionID: GAME_PORT_SESSION_ID }]);
  // A rate of nought is a rate; one that cannot be worked out, or the working out failing, is none, and the read stands.
  assert.equal((await marketRead({ rate: async () => 0 })).payload.brokersFeeRate, 0);
  assert.equal((await marketRead({ rate: async () => null })).payload.brokersFeeRate, null);
  assert.equal((await marketRead({ rate: async () => { throw new Error("no"); } })).payload.brokersFeeRate, null);
  assert.equal((await marketRead({ rate: async () => "0.03" })).payload.brokersFeeRate, null);
});

test("through the gateway the Market read says no broker's fee rate, and the game port is not asked for one", async () => {
  const { payload, asked } = await marketRead({ transport: "gateway" });
  assert.equal(payload.brokersFeeRate, null);
  assert.deepEqual(asked, []);
});
