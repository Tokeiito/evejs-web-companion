"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const bridgeClient = require("../src/eveBridgeClient");

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_BRIDGE_URL = process.env.EVEJS_BRIDGE_URL;
const ORIGINAL_BRIDGE_TOKEN = process.env.EVEJS_WEB_BRIDGE_TOKEN;

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

function legacyStatus() {
  return {
    ok: true,
    source: "evejs-web-bridge",
    hasAccounts: true,
    hasCharacters: true,
    hasSkills: true,
    accountCount: 2,
    characterCount: 3,
  };
}

function gatewayHealth(ready = true) {
  return {
    ok: true,
    source: "evejs-web-gateway",
    apiVersion: 1,
    capabilities: {
      health: true,
      legacyBridge: true,
    },
    runtime: {
      ready,
      dependencies: {
        serviceManager: ready,
      },
    },
  };
}

test.beforeEach(() => {
  process.env.EVEJS_BRIDGE_URL = "http://bridge.test/_evejs-web/";
  process.env.EVEJS_WEB_BRIDGE_TOKEN = "server-secret";
});

test.afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_BRIDGE_URL === undefined) {
    delete process.env.EVEJS_BRIDGE_URL;
  } else {
    process.env.EVEJS_BRIDGE_URL = ORIGINAL_BRIDGE_URL;
  }
  if (ORIGINAL_BRIDGE_TOKEN === undefined) {
    delete process.env.EVEJS_WEB_BRIDGE_TOKEN;
  } else {
    process.env.EVEJS_WEB_BRIDGE_TOKEN = ORIGINAL_BRIDGE_TOKEN;
  }
});

test("getStatus preserves legacy status and reports a ready v1 gateway", async () => {
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/status")) {
      return jsonResponse(200, legacyStatus());
    }
    if (url.endsWith("/v1/health")) {
      return jsonResponse(200, gatewayHealth(true));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const status = await bridgeClient.getStatus();

  assert.equal(status.accountCount, 2);
  assert.equal(status.characterCount, 3);
  assert.deepEqual(status.gateway, {
    available: true,
    ready: true,
    source: "evejs-web-gateway",
    apiVersion: 1,
    capabilities: {
      health: true,
      legacyBridge: true,
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
      "http://bridge.test/_evejs-web/status",
      "http://bridge.test/_evejs-web/v1/health",
    ],
  );
  for (const call of calls) {
    assert.equal(call.options.headers["x-evejs-web-token"], "server-secret");
  }
  assert.equal(JSON.stringify(status).includes("server-secret"), false);
});

test("detectGateway distinguishes a present gateway whose runtime is not ready", async () => {
  global.fetch = async (url) => {
    assert.equal(url, "http://bridge.test/_evejs-web/v1/health");
    return jsonResponse(200, gatewayHealth(false));
  };

  const gateway = await bridgeClient.detectGateway();

  assert.equal(gateway.available, true);
  assert.equal(gateway.ready, false);
  assert.equal(gateway.apiVersion, 1);
  assert.equal(gateway.runtime.dependencies.serviceManager, false);
});

test("getStatus keeps legacy compatibility when the v1 gateway is absent", async () => {
  global.fetch = async (url) => {
    if (url.endsWith("/status")) {
      return jsonResponse(200, legacyStatus());
    }
    return jsonResponse(404, {
      ok: false,
      error: "NOT_FOUND",
      message: "Not found",
    });
  };

  const status = await bridgeClient.getStatus();

  assert.equal(status.ok, true);
  assert.equal(status.accountCount, 2);
  assert.equal(status.gateway.available, false);
  assert.equal(status.gateway.ready, false);
  assert.equal(status.gateway.apiVersion, null);
});

test("getStatus keeps legacy compatibility when the v1 gateway returns an error", async () => {
  global.fetch = async (url) => {
    if (url.endsWith("/status")) {
      return jsonResponse(200, legacyStatus());
    }
    return jsonResponse(503, {
      ok: false,
      error: "GATEWAY_UNAVAILABLE",
      message: "Gateway runtime is unavailable",
    });
  };

  const status = await bridgeClient.getStatus();

  assert.equal(status.ok, true);
  assert.equal(status.gateway.available, false);
  assert.equal(status.gateway.error, "GATEWAY_UNAVAILABLE");
});

test("detectGateway rejects an unsupported v1 response as unavailable", async () => {
  global.fetch = async () => jsonResponse(200, {
    ...gatewayHealth(true),
    apiVersion: 2,
  });

  const gateway = await bridgeClient.detectGateway();

  assert.equal(gateway.available, false);
  assert.equal(gateway.error, "EVE_GATEWAY_UNSUPPORTED");
});

test("detectGateway does not mistake a legacy response for the v1 gateway", async () => {
  global.fetch = async () => jsonResponse(200, legacyStatus());

  const gateway = await bridgeClient.detectGateway();

  assert.equal(gateway.available, false);
  assert.equal(gateway.error, "EVE_BRIDGE_NOT_AVAILABLE");
});
