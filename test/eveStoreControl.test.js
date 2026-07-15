"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const eveStore = require("../src/eveStore");

const originalFetch = global.fetch;
const originalGatewayUrl = process.env.EVEJS_GATEWAY_URL;

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? "application/json" : null;
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

function snapshotResponse(accountID = 4) {
  return gatewayResponse({
    snapshot: {
      characters: {
        "7": {
          characterID: 7,
          accountID,
          characterName: "Test Pilot",
        },
      },
    },
  });
}

test.beforeEach(() => {
  process.env.EVEJS_GATEWAY_URL = "http://gateway.test/_evejs-web/v1";
});

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalGatewayUrl === undefined) {
    delete process.env.EVEJS_GATEWAY_URL;
  } else {
    process.env.EVEJS_GATEWAY_URL = originalGatewayUrl;
  }
});

test("character status preserves only the transport-neutral control projection", async () => {
  global.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/snapshot")) {
      return jsonResponse(200, snapshotResponse());
    }
    if (pathname.endsWith("/character-status")) {
      return jsonResponse(200, gatewayResponse({
        characterID: 7,
        online: true,
        controlState: "browser_pilot",
        transport: "web",
        leaseExpiresAt: "2026-07-15T12:01:00.000Z",
        leaseID: "must-not-leak",
        leaseSecret: "must-not-leak",
        controllerID: "must-not-leak",
      }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  assert.deepEqual(await eveStore.getCharacterStatus(4, 7), {
    characterID: 7,
    online: true,
    controlState: "browser_pilot",
    transport: "web",
    leaseExpiresAt: "2026-07-15T12:01:00.000Z",
  });
});

test("claim separates internal credentials from sanitized control", async () => {
  global.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/snapshot")) {
      return jsonResponse(200, snapshotResponse());
    }
    if (pathname.endsWith("/character-control/claim")) {
      return jsonResponse(200, gatewayResponse({
        characterID: 7,
        online: true,
        controlState: "browser_pilot",
        transport: "web",
        leaseExpiresAt: "2026-07-15T12:01:00.000Z",
        leaseID: "lease-id",
        leaseSecret: "lease-secret",
      }));
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await eveStore.claimCharacterControl(4, 7, "signed-session-id");
  assert.deepEqual(result.control, {
    characterID: 7,
    online: true,
    controlState: "browser_pilot",
    transport: "web",
    leaseExpiresAt: "2026-07-15T12:01:00.000Z",
  });
  assert.deepEqual(result.credentials, {
    leaseID: "lease-id",
    leaseSecret: "lease-secret",
  });
});

test("every character-control wrapper rejects an ownership mismatch before control access", async () => {
  let controlRequests = 0;
  global.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/snapshot")) {
      return jsonResponse(200, snapshotResponse(4));
    }
    if (pathname.includes("/character-control/")) {
      controlRequests += 1;
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const credentials = { leaseID: "lease-id", leaseSecret: "lease-secret" };

  assert.equal(await eveStore.claimCharacterControl(9, 7, "session-id"), null);
  assert.equal(await eveStore.renewCharacterControl(9, 7, "session-id", credentials), null);
  assert.equal(await eveStore.releaseCharacterControl(9, 7, "session-id", credentials), null);
  assert.equal(controlRequests, 0);
});

test("an inconsistent control projection fails closed", async () => {
  global.fetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith("/snapshot")) {
      return jsonResponse(200, snapshotResponse());
    }
    return jsonResponse(200, gatewayResponse({
      characterID: 7,
      online: false,
      controlState: "browser_pilot",
      transport: "web",
      leaseExpiresAt: null,
    }));
  };

  await assert.rejects(
    eveStore.getCharacterStatus(4, 7),
    (error) => error.code === "EVE_GATEWAY_UNSUPPORTED",
  );
});
