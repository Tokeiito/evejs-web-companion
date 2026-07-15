"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const gatewayClient = require("../src/eveGatewayClient");

const ORIGINAL_FETCH = global.fetch;
const ENV_NAMES = [
  "EVEJS_GATEWAY_URL",
  "EVEJS_WEB_GATEWAY_TOKEN",
];
const ORIGINAL_ENV = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

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

function gatewayHealth(ready = true) {
  return gatewayResponse({
    capabilities: {
      health: true,
      status: true,
      gameplay: true,
    },
    runtime: {
      ready,
      dependencies: {
        serviceManager: ready,
      },
    },
  });
}

test.beforeEach(() => {
  process.env.EVEJS_GATEWAY_URL = "http://gateway.test/_evejs-web/v1/";
  process.env.EVEJS_WEB_GATEWAY_TOKEN = "server-secret";
});

test.afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  for (const name of ENV_NAMES) {
    if (ORIGINAL_ENV[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = ORIGINAL_ENV[name];
    }
  }
});

test("getStatus strictly combines v1 status and health", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/status")) {
      return jsonResponse(200, gatewayResponse({
        hasAccounts: true,
        hasCharacters: true,
        hasSkills: true,
        accountCount: 2,
        characterCount: 3,
      }));
    }
    if (url.endsWith("/health")) {
      return jsonResponse(200, gatewayHealth(true));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const status = await gatewayClient.getStatus();

  assert.deepEqual(status, {
    ok: true,
    source: "evejs-web-gateway",
    apiVersion: 1,
    hasAccounts: true,
    hasCharacters: true,
    hasSkills: true,
    accountCount: 2,
    characterCount: 3,
    available: true,
    ready: true,
    capabilities: {
      health: true,
      status: true,
      gameplay: true,
    },
    runtime: {
      ready: true,
      dependencies: {
        serviceManager: true,
      },
    },
  });
  assert.deepEqual(
    calls.map((call) => call.url).sort(),
    [
      "http://gateway.test/_evejs-web/v1/health",
      "http://gateway.test/_evejs-web/v1/status",
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.headers["x-evejs-web-token"], "server-secret");
  }
  assert.equal(JSON.stringify(status).includes("server-secret"), false);
});

test("getStatus reports a detected v1 gateway whose runtime is not ready", async () => {
  global.fetch = async (url) => {
    if (url.endsWith("/status")) {
      return jsonResponse(200, gatewayResponse({
        hasAccounts: true,
        hasCharacters: true,
        hasSkills: true,
        accountCount: 1,
        characterCount: 1,
      }));
    }
    if (url.endsWith("/health")) {
      return jsonResponse(200, gatewayHealth(false));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const status = await gatewayClient.getStatus();

  assert.equal(status.available, true);
  assert.equal(status.ready, false);
  assert.equal(status.runtime.ready, false);
  assert.equal(status.runtime.dependencies.serviceManager, false);
});

test("getStatus fails when either required v1 endpoint is unhealthy", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.endsWith("/status")) {
      return jsonResponse(200, gatewayResponse({ accountCount: 2 }));
    }
    return jsonResponse(503, {
      ok: false,
      source: "evejs-web-gateway",
      apiVersion: 1,
      error: "GATEWAY_UNAVAILABLE",
      message: "Gateway runtime is unavailable",
    });
  };

  await assert.rejects(
    gatewayClient.getStatus(),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "GATEWAY_UNAVAILABLE",
  );
  assert.equal(calls.every((url) => url.startsWith("http://gateway.test/_evejs-web/v1/")), true);
});

test("every gameplay operation uses only the v1 gateway", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/accounts")) {
      return jsonResponse(200, gatewayResponse({ accounts: [{ username: "pilot" }] }));
    }
    if (pathname.endsWith("/account")) {
      return jsonResponse(200, gatewayResponse({ account: { username: "pilot one" } }));
    }
    if (pathname.endsWith("/characters")) {
      return jsonResponse(200, gatewayResponse({ characters: [{ characterID: 7 }] }));
    }
    if (pathname.endsWith("/snapshot")) {
      return jsonResponse(200, gatewayResponse({ snapshot: { characters: {} } }));
    }
    if (pathname.endsWith("/character-status")) {
      return jsonResponse(200, gatewayResponse({ online: false }));
    }
    if (pathname.endsWith("/market/station-asks")) {
      return jsonResponse(200, gatewayResponse({ rows: [{ typeID: 34 }] }));
    }
    if (pathname.endsWith("/skill-queue")) {
      return jsonResponse(200, gatewayResponse({ snapshot: { queue: [] } }));
    }
    if (pathname.endsWith("/pi/restart-extractors")) {
      return jsonResponse(200, gatewayResponse({ summary: { restarted: 1 } }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.deepEqual(await gatewayClient.listAccounts(), [{ username: "pilot" }]);
  assert.deepEqual(await gatewayClient.getAccount("pilot one"), { username: "pilot one" });
  assert.deepEqual(await gatewayClient.listCharacters(4), [{ characterID: 7 }]);
  assert.deepEqual(await gatewayClient.getSnapshot(4, 7), { characters: {} });
  assert.equal((await gatewayClient.getCharacterStatus(4, 7)).online, false);
  assert.deepEqual(await gatewayClient.getStationAsks(60003760), [{ typeID: 34 }]);
  await gatewayClient.saveSkillQueue(4, 7, [
    { typeID: 3300, toLevel: 4 },
    { trainingTypeID: 3301, trainingToLevel: 3 },
    { typeID: 0, toLevel: 1 },
  ], { activate: false });
  await gatewayClient.restartExtractors(4, 7, { planetID: 99 });

  assert.deepEqual(calls.map((call) => call.url), [
    "http://gateway.test/_evejs-web/v1/accounts",
    "http://gateway.test/_evejs-web/v1/account?username=pilot+one",
    "http://gateway.test/_evejs-web/v1/characters?accountID=4",
    "http://gateway.test/_evejs-web/v1/snapshot?accountID=4&characterID=7",
    "http://gateway.test/_evejs-web/v1/character-status?accountID=4&characterID=7",
    "http://gateway.test/_evejs-web/v1/market/station-asks?stationID=60003760",
    "http://gateway.test/_evejs-web/v1/skill-queue",
    "http://gateway.test/_evejs-web/v1/pi/restart-extractors",
  ]);
  assert.equal(calls.every((call) => call.options.headers["x-evejs-web-token"] === "server-secret"), true);
  assert.equal(calls.slice(0, 6).every((call) => call.options.method === "GET"), true);
  assert.equal(calls.slice(6).every((call) => call.options.method === "POST"), true);

  const queueBody = JSON.parse(calls[6].options.body);
  assert.equal(queueBody.accountID, 4);
  assert.equal(queueBody.characterID, 7);
  assert.equal(queueBody.activate, false);
  assert.deepEqual(queueBody.entries, [
    { typeID: 3300, toLevel: 4 },
    { typeID: 3301, toLevel: 3 },
  ]);
  assert.match(queueBody.webHost, /^.+:\d+$/);

  const piBody = JSON.parse(calls[7].options.body);
  assert.equal(piBody.accountID, 4);
  assert.equal(piBody.characterID, 7);
  assert.equal(piBody.planetID, 99);
});

test("GET and POST reject non-gateway response sources", async () => {
  global.fetch = async () => jsonResponse(200, {
    ok: true,
    source: "unexpected-service",
    apiVersion: 1,
    accounts: [],
  });

  await assert.rejects(
    gatewayClient.listAccounts(),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "EVE_GATEWAY_NOT_AVAILABLE",
  );
  await assert.rejects(
    gatewayClient.saveSkillQueue(4, 7, []),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "EVE_GATEWAY_NOT_AVAILABLE",
  );
});

test("GET and POST reject unsupported API versions", async () => {
  global.fetch = async () => jsonResponse(200, gatewayResponse({
    apiVersion: 2,
    accounts: [],
  }));

  await assert.rejects(
    gatewayClient.listAccounts(),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "EVE_GATEWAY_UNSUPPORTED",
  );
  await assert.rejects(
    gatewayClient.restartExtractors(4, 7),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "EVE_GATEWAY_UNSUPPORTED",
  );
});

test("the default gateway URL is v1 and the token is optional", async () => {
  delete process.env.EVEJS_GATEWAY_URL;
  delete process.env.EVEJS_WEB_GATEWAY_TOKEN;

  global.fetch = async (url, options) => {
    assert.equal(url, "http://127.0.0.1:26002/_evejs-web/v1/health");
    assert.equal(options.headers["x-evejs-web-token"], undefined);
    return jsonResponse(200, gatewayHealth(true));
  };

  const health = await gatewayClient.getGatewayHealth();
  assert.equal(health.source, "evejs-web-gateway");
});

test("an unversioned gateway URL is rejected before any request", async () => {
  process.env.EVEJS_GATEWAY_URL = "http://gateway.test/_evejs-web";
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch must not be called");
  };

  await assert.rejects(
    gatewayClient.listAccounts(),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "EVE_GATEWAY_CONFIGURATION" &&
      error.statusCode === 500,
  );
  assert.equal(fetchCalled, false);
});

test("gateway errors never expose the configured token", async () => {
  global.fetch = async () => {
    throw new Error("connection refused");
  };

  await assert.rejects(
    gatewayClient.getGatewayHealth(),
    (error) => {
      assert.equal(error.name, "EveGatewayError");
      assert.equal(error.code, "EVE_GATEWAY_UNREACHABLE");
      assert.equal(String(error.message).includes("server-secret"), false);
      assert.equal(JSON.stringify(error).includes("server-secret"), false);
      return true;
    },
  );
});
