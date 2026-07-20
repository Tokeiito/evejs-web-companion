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

function gatewayHealth(ready = true, characterEventsReady = ready) {
  return gatewayResponse({
    capabilities: {
      health: true,
      status: true,
      gameplay: true,
      characterEvents: true,
    },
    runtime: {
      ready,
      dependencies: {
        serviceManager: ready,
        characterEvents: ready,
      },
      characterEvents: {
        ready: ready && characterEventsReady,
        dependencies: {
          gatewayRuntime: ready,
          gatewayToken: characterEventsReady,
        },
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
      characterEvents: true,
    },
    runtime: {
      ready: true,
      dependencies: {
        serviceManager: true,
        characterEvents: true,
      },
      characterEvents: {
        ready: true,
        dependencies: {
          gatewayRuntime: true,
          gatewayToken: true,
        },
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
  assert.equal(status.capabilities.characterEvents, true);
  assert.equal(status.runtime.dependencies.characterEvents, false);
  assert.equal(status.runtime.characterEvents.ready, false);
});

test("getStatus reports token-aware character-event transport readiness", async () => {
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
      return jsonResponse(200, gatewayHealth(true, false));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const status = await gatewayClient.getStatus();
  assert.equal(status.runtime.ready, true);
  assert.equal(status.runtime.dependencies.characterEvents, true);
  assert.equal(status.runtime.characterEvents.ready, false);
  assert.deepEqual(status.runtime.characterEvents.dependencies, {
    gatewayRuntime: true,
    gatewayToken: false,
  });
  assert.equal(status.ready, false);
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

// Goal R9b trimmed the v1 read surface to the four calls the auth/health path
// still needs; the retired control/market/command helpers went with the legacy
// /api/characters/* routes. This case pins that the survivors are GET-only, hit
// only the v1 namespace, and always carry the server token.
test("every surviving v1 read uses only the v1 gateway", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const pathname = new URL(url).pathname;
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
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.deepEqual(await gatewayClient.getAccount("pilot one"), { username: "pilot one" });
  assert.deepEqual(await gatewayClient.listCharacters(4), [{ characterID: 7 }]);
  assert.deepEqual(await gatewayClient.getSnapshot(4, 7), {
    stateVersion: "runtime-a:4",
    characters: {},
  });

  assert.deepEqual(calls.map((call) => call.url), [
    "http://gateway.test/_evejs-web/v1/account?username=pilot+one",
    "http://gateway.test/_evejs-web/v1/characters?accountID=4",
    "http://gateway.test/_evejs-web/v1/snapshot?accountID=4&characterID=7",
  ]);
  assert.equal(calls.every((call) => call.options.headers["x-evejs-web-token"] === "server-secret"), true);
  assert.deepEqual(calls.map((call) => call.options.method), ["GET", "GET", "GET"]);
});

// The envelope guards are shared by getJson/postSerializedJson, so the GET leg
// rides on a surviving v1 read (listCharacters) and the POST leg on the live
// bridge call — the two shapes that still exist after goal R9b.
test("GET and POST reject non-gateway response sources", async () => {
  global.fetch = async () => jsonResponse(200, {
    ok: true,
    source: "unexpected-service",
    apiVersion: 1,
    characters: [],
  });

  await assert.rejects(
    gatewayClient.listCharacters(4),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "EVE_GATEWAY_NOT_AVAILABLE",
  );
  await assert.rejects(
    gatewayClient.callMethod("charUnboundMgr", "GetCharacterSelectionData", [], null, { userid: 4 }),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "EVE_GATEWAY_NOT_AVAILABLE",
  );
});

test("GET and POST reject unsupported API versions", async () => {
  global.fetch = async () => jsonResponse(200, gatewayResponse({
    apiVersion: 2,
    characters: [],
  }));

  await assert.rejects(
    gatewayClient.listCharacters(4),
    (error) => error instanceof gatewayClient.EveGatewayError &&
      error.code === "EVE_GATEWAY_UNSUPPORTED",
  );
  await assert.rejects(
    gatewayClient.callMethod("charUnboundMgr", "GetCharacterSelectionData", [], null, { userid: 4 }),
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
    gatewayClient.listCharacters(4),
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
