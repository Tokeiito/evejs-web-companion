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

test("runtime-not-ready is propagated without retry or fallback", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return jsonResponse(503, {
      ok: false,
      source: "evejs-web-gateway",
      apiVersion: 1,
      error: "GATEWAY_RUNTIME_NOT_READY",
      message: "Authoritative EveJS gateway runtime is not ready.",
    });
  };

  await assert.rejects(
    gatewayClient.getSnapshot(4, 7),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "GATEWAY_RUNTIME_NOT_READY" &&
      error.statusCode === 503,
  );
  assert.deepEqual(calls, [
    "http://gateway.test/_evejs-web/v1/snapshot?accountID=4&characterID=7",
  ]);
});

test("character-control calls fail closed when the gateway runtime is not ready", async () => {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    return jsonResponse(503, {
      ok: false,
      source: "evejs-web-gateway",
      apiVersion: 1,
      error: "GATEWAY_RUNTIME_NOT_READY",
      message: "Authoritative EveJS gateway runtime is not ready.",
    });
  };

  await assert.rejects(
    gatewayClient.claimCharacterControl(4, 7, "signed-session-id"),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "GATEWAY_RUNTIME_NOT_READY" &&
      error.statusCode === 503,
  );
  assert.deepEqual(calls, [
    "http://gateway.test/_evejs-web/v1/character-control/claim",
  ]);
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
      return jsonResponse(200, gatewayResponse({
        snapshot: { stateVersion: "runtime-a:4", characters: {} },
      }));
    }
    if (pathname.endsWith("/character-status")) {
      return jsonResponse(200, gatewayResponse({
        characterID: 7,
        online: false,
        controlState: "offline",
        transport: null,
        leaseExpiresAt: null,
        stateVersion: "runtime-a:4",
      }));
    }
    if (pathname.endsWith("/character-control/claim")) {
      return jsonResponse(200, gatewayResponse({
        characterID: 7,
        online: true,
        controlState: "browser_pilot",
        transport: "web",
        leaseExpiresAt: "2026-07-15T12:01:00.000Z",
        stateVersion: "runtime-a:5",
        leaseID: "opaque-lease-id",
        leaseSecret: "opaque-lease-secret",
      }));
    }
    if (pathname.endsWith("/character-control/renew")) {
      return jsonResponse(200, gatewayResponse({
        characterID: 7,
        online: true,
        controlState: "browser_pilot",
        transport: "web",
        leaseExpiresAt: "2026-07-15T12:02:00.000Z",
        stateVersion: "runtime-a:6",
      }));
    }
    if (pathname.endsWith("/character-control/release")) {
      return jsonResponse(200, gatewayResponse({
        characterID: 7,
        online: false,
        controlState: "offline",
        transport: null,
        leaseExpiresAt: null,
        stateVersion: "runtime-a:7",
      }));
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
  assert.deepEqual(await gatewayClient.getSnapshot(4, 7), {
    stateVersion: "runtime-a:4",
    characters: {},
  });
  assert.equal((await gatewayClient.getCharacterStatus(4, 7)).online, false);
  await gatewayClient.claimCharacterControl(4, 7, "signed-session-id");
  await gatewayClient.renewCharacterControl(4, 7, "signed-session-id", {
    leaseID: "opaque-lease-id",
    leaseSecret: "opaque-lease-secret",
  });
  await gatewayClient.releaseCharacterControl(4, 7, "signed-session-id", {
    leaseID: "opaque-lease-id",
    leaseSecret: "opaque-lease-secret",
  });
  assert.deepEqual(await gatewayClient.getStationAsks(60003760), [{ typeID: 34 }]);
  await gatewayClient.saveSkillQueue(4, 7, [
    { typeID: 3300, toLevel: 4 },
    { typeID: 3301, toLevel: 3 },
  ], {
    activate: false,
    commandID: "queue-command",
    expectedStateVersion: "runtime-a:4",
    controllerID: "signed-session-id",
  });
  await gatewayClient.restartExtractors(4, 7, {
    planetID: 99,
    commandID: "pi-command",
    expectedStateVersion: "runtime-a:5",
    controllerID: "signed-session-id",
  });

  assert.deepEqual(calls.map((call) => call.url), [
    "http://gateway.test/_evejs-web/v1/accounts",
    "http://gateway.test/_evejs-web/v1/account?username=pilot+one",
    "http://gateway.test/_evejs-web/v1/characters?accountID=4",
    "http://gateway.test/_evejs-web/v1/snapshot?accountID=4&characterID=7",
    "http://gateway.test/_evejs-web/v1/character-status?accountID=4&characterID=7",
    "http://gateway.test/_evejs-web/v1/character-control/claim",
    "http://gateway.test/_evejs-web/v1/character-control/renew",
    "http://gateway.test/_evejs-web/v1/character-control/release",
    "http://gateway.test/_evejs-web/v1/market/station-asks?stationID=60003760",
    "http://gateway.test/_evejs-web/v1/skill-queue",
    "http://gateway.test/_evejs-web/v1/pi/restart-extractors",
  ]);
  assert.equal(calls.every((call) => call.options.headers["x-evejs-web-token"] === "server-secret"), true);
  assert.deepEqual(calls.map((call) => call.options.method), [
    "GET", "GET", "GET", "GET", "GET",
    "POST", "POST", "POST", "GET", "POST", "POST",
  ]);

  const claimBody = JSON.parse(calls[5].options.body);
  assert.deepEqual(claimBody, {
    accountID: 4,
    characterID: 7,
    controllerID: "signed-session-id",
  });

  for (const index of [6, 7]) {
    const leaseBody = JSON.parse(calls[index].options.body);
    assert.deepEqual(leaseBody, {
      accountID: 4,
      characterID: 7,
      controllerID: "signed-session-id",
      leaseID: "opaque-lease-id",
      leaseSecret: "opaque-lease-secret",
    });
    assert.equal(JSON.stringify(leaseBody).includes("evejs_web_poc"), false);
  }

  const queueBody = JSON.parse(calls[9].options.body);
  assert.deepEqual(queueBody, {
    accountID: 4,
    characterID: 7,
    command: {
      commandID: "queue-command",
      expectedStateVersion: "runtime-a:4",
      controllerID: "signed-session-id",
      type: "offline.skill_queue.save",
      payload: {
        entries: [
          { typeID: 3300, toLevel: 4 },
          { typeID: 3301, toLevel: 3 },
        ],
        activate: false,
      },
    },
  });

  const piBody = JSON.parse(calls[10].options.body);
  assert.deepEqual(piBody, {
    accountID: 4,
    characterID: 7,
    command: {
      commandID: "pi-command",
      expectedStateVersion: "runtime-a:5",
      controllerID: "signed-session-id",
      type: "offline.pi.extractors.restart",
      payload: { planetID: 99 },
    },
  });
});

test("command POST retries a 503 once with the byte-identical envelope", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: options.body });
    if (calls.length === 1) {
      return jsonResponse(503, {
        ok: false,
        source: "evejs-web-gateway",
        apiVersion: 1,
        error: "CHARACTER_COMMAND_UNAVAILABLE",
        message: "Command runtime unavailable",
      });
    }
    return jsonResponse(200, gatewayResponse({
      snapshot: { queue: [] },
      stateVersion: "runtime-a:5",
    }));
  };

  const result = await gatewayClient.saveSkillQueue(4, 7, [], {
    activate: true,
    commandID: "retry-command",
    expectedStateVersion: "runtime-a:4",
    controllerID: "signed-session-id",
  });

  assert.equal(result.stateVersion, "runtime-a:5");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, calls[1].url);
  assert.equal(calls[0].body, calls[1].body);
});

test("command POST retries a network failure but never retries a definitive mismatch", async () => {
  const networkBodies = [];
  global.fetch = async (url, options) => {
    networkBodies.push(options.body);
    if (networkBodies.length === 1) {
      throw new TypeError("connection reset");
    }
    return jsonResponse(200, gatewayResponse({
      summary: { restartedCount: 1 },
      stateVersion: "runtime-a:5",
    }));
  };

  await gatewayClient.restartExtractors(4, 7, {
    planetID: 99,
    commandID: "network-command",
    expectedStateVersion: "runtime-a:4",
    controllerID: "signed-session-id",
  });
  assert.equal(networkBodies.length, 2);
  assert.equal(networkBodies[0], networkBodies[1]);

  let mismatchCalls = 0;
  global.fetch = async () => {
    mismatchCalls += 1;
    return jsonResponse(409, {
      ok: false,
      source: "evejs-web-gateway",
      apiVersion: 1,
      error: "CHARACTER_STATE_VERSION_MISMATCH",
      message: "State changed",
    });
  };
  await assert.rejects(
    gatewayClient.restartExtractors(4, 7, {
      planetID: 99,
      commandID: "stale-command",
      expectedStateVersion: "runtime-a:4",
      controllerID: "signed-session-id",
    }),
    (error) => error.code === "CHARACTER_STATE_VERSION_MISMATCH",
  );
  assert.equal(mismatchCalls, 1);
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
