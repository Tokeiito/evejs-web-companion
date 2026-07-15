"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("events");

const { createApp } = require("../src/server");
const { createBrowserLeaseStore } = require("../src/browserLeaseStore");

const COOKIE_TOKEN = "raw-signed-login-cookie";
const SESSION_ID = "signed-random-session-id";
const ACCOUNT = {
  username: "pilot",
  accountID: 4,
  role: "0",
  banned: false,
};
const BROWSER_CONTROL = {
  characterID: 7,
  online: true,
  controlState: "browser_pilot",
  transport: "web",
  leaseExpiresAt: "2099-07-15T12:01:00.000Z",
};
const OFFLINE_CONTROL = {
  characterID: 7,
  online: false,
  controlState: "offline",
  transport: null,
  leaseExpiresAt: null,
};

const activeServers = new Set();

function fakeAuth() {
  return {
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
    ...overrides,
  };
}

async function startTestServer(store, leaseStore = createBrowserLeaseStore()) {
  const app = createApp({
    eveStore: store,
    webAuth: fakeAuth(),
    browserLeaseStore: leaseStore,
    marketClient: {},
    errorLogger() {},
  });
  const server = app.listen(0, "127.0.0.1");
  activeServers.add(server);
  await once(server, "listening");
  const { port } = server.address();
  return {
    leaseStore,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

async function apiRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      cookie: `evejs_web_poc=${COOKIE_TOKEN}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {
    response,
    payload: await response.json(),
  };
}

test.afterEach(async () => {
  const closing = [];
  for (const server of activeServers) {
    activeServers.delete(server);
    closing.push(new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }));
  }
  await Promise.all(closing);
});

test("claim, renew, and release keep credentials server-side and use the signed session ID", async () => {
  const calls = [];
  const store = fakeStore({
    async claimCharacterControl(accountID, characterID, controllerID) {
      calls.push({ operation: "claim", accountID, characterID, controllerID });
      return {
        control: {
          ...BROWSER_CONTROL,
          leaseID: "must-not-reach-browser",
          leaseSecret: "must-not-reach-browser",
          controllerID: "must-not-reach-browser",
        },
        credentials: {
          leaseID: "lease-id",
          leaseSecret: "lease-secret",
        },
      };
    },
    async getCharacterForAccount(accountID, characterID) {
      calls.push({ operation: "ownership", accountID, characterID });
      return { characterID, accountID };
    },
    async renewCharacterControl(accountID, characterID, controllerID, credentials) {
      calls.push({ operation: "renew", accountID, characterID, controllerID, credentials });
      return {
        ...BROWSER_CONTROL,
        leaseExpiresAt: "2099-07-15T12:02:00.000Z",
      };
    },
    async releaseCharacterControl(accountID, characterID, controllerID, credentials) {
      calls.push({ operation: "release", accountID, characterID, controllerID, credentials });
      return { ...OFFLINE_CONTROL };
    },
  });
  const harness = await startTestServer(store);

  const claim = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/control/claim",
    { method: "POST", body: {} },
  );
  assert.equal(claim.response.status, 200);
  assert.deepEqual(claim.payload, { ok: true, ...BROWSER_CONTROL });
  assert.equal(JSON.stringify(claim.payload).includes("lease-id"), false);
  assert.equal(JSON.stringify(claim.payload).includes("lease-secret"), false);
  assert.equal(JSON.stringify(claim.payload).includes("controllerID"), false);
  assert.equal(harness.leaseStore.get(SESSION_ID, 7).leaseSecret, "lease-secret");

  const renew = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/control/renew",
    { method: "POST", body: {} },
  );
  assert.equal(renew.response.status, 200);
  assert.equal(renew.payload.leaseExpiresAt, "2099-07-15T12:02:00.000Z");
  assert.equal(JSON.stringify(renew.payload).includes("leaseSecret"), false);

  const release = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/control/release",
    { method: "POST", body: {} },
  );
  assert.equal(release.response.status, 200);
  assert.deepEqual(release.payload, { ok: true, ...OFFLINE_CONTROL });
  assert.equal(harness.leaseStore.get(SESSION_ID, 7), null);

  const controlCalls = calls.filter((call) => call.operation !== "ownership");
  assert.deepEqual(controlCalls.map((call) => call.operation), ["claim", "renew", "release"]);
  assert.equal(controlCalls.every((call) => call.controllerID === SESSION_ID), true);
  assert.equal(controlCalls.every((call) => call.controllerID !== COOKIE_TOKEN), true);
  assert.deepEqual(controlCalls[1].credentials, {
    sessionID: SESSION_ID,
    accountID: 4,
    characterID: 7,
    leaseID: "lease-id",
    leaseSecret: "lease-secret",
    leaseExpiresAt: "2099-07-15T12:01:00.000Z",
  });
});

test("status exposes only sanitized transport-neutral fields", async () => {
  const store = fakeStore({
    async getCharacterStatus() {
      return {
        ...BROWSER_CONTROL,
        leaseID: "hidden-id",
        leaseSecret: "hidden-secret",
        controllerID: "hidden-controller",
      };
    },
  });
  const harness = await startTestServer(store);

  const result = await apiRequest(harness.baseUrl, "/api/characters/7/status");
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, { ok: true, ...BROWSER_CONTROL });
  assert.equal(JSON.stringify(result.payload).includes("hidden"), false);
});

test("renew and release validate ownership before rejecting missing local credentials", async () => {
  const calls = [];
  const store = fakeStore({
    async getCharacterForAccount(accountID, characterID) {
      calls.push({ operation: "ownership", accountID, characterID });
      return { accountID, characterID };
    },
    async renewCharacterControl() {
      calls.push({ operation: "renew" });
    },
    async releaseCharacterControl() {
      calls.push({ operation: "release" });
    },
  });
  const harness = await startTestServer(store);

  const renew = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/control/renew",
    { method: "POST", body: {} },
  );
  const release = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/control/release",
    { method: "POST", body: {} },
  );

  assert.equal(renew.response.status, 403);
  assert.equal(renew.payload.error, "CHARACTER_LEASE_INVALID");
  assert.equal(release.response.status, 403);
  assert.equal(release.payload.error, "CHARACTER_LEASE_INVALID");
  assert.deepEqual(calls.map((call) => call.operation), ["ownership", "ownership"]);
});

test("gateway ownership failures remain authorization failures", async () => {
  const store = fakeStore({
    async claimCharacterControl() {
      const error = new Error("Character does not belong to this account.");
      error.name = "EveGatewayError";
      error.code = "CHARACTER_OWNERSHIP_MISMATCH";
      error.statusCode = 403;
      throw error;
    },
  });
  const harness = await startTestServer(store);

  const result = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/control/claim",
    { method: "POST", body: {} },
  );

  assert.equal(result.response.status, 403);
  assert.equal(result.payload.error, "CHARACTER_OWNERSHIP_MISMATCH");
});

test("logout best-effort releases every session lease and always clears local credentials", async () => {
  const releases = [];
  const leaseStore = createBrowserLeaseStore();
  leaseStore.put(SESSION_ID, 4, 7, {
    leaseID: "lease-7",
    leaseSecret: "secret-7",
  });
  leaseStore.put(SESSION_ID, 4, 8, {
    leaseID: "lease-8",
    leaseSecret: "secret-8",
  });
  const store = fakeStore({
    async releaseCharacterControl(accountID, characterID, controllerID, credentials) {
      releases.push({ accountID, characterID, controllerID, credentials });
      if (characterID === 8) {
        throw new Error("simulated gateway outage");
      }
      return { ...OFFLINE_CONTROL, characterID };
    },
  });
  const harness = await startTestServer(store, leaseStore);

  const result = await apiRequest(harness.baseUrl, "/api/logout", {
    method: "POST",
    body: {},
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.payload, { ok: true });
  assert.equal(releases.length, 2);
  assert.equal(releases.every((call) => call.controllerID === SESSION_ID), true);
  assert.deepEqual(leaseStore.listForSession(SESSION_ID), []);
  assert.match(result.response.headers.get("set-cookie") || "", /evejs_web_poc=;/);
});

test("skill queue and PI mutations require authoritative offline control", async () => {
  let control = {
    ...BROWSER_CONTROL,
    controlState: "retail_client",
    transport: "tcp",
    leaseExpiresAt: null,
  };
  const mutations = [];
  const store = fakeStore({
    async getCharacterStatus() {
      return { ...control };
    },
    async saveSkillQueue() {
      mutations.push("skill-queue");
      return { queue: [] };
    },
    async restartExtractors() {
      mutations.push("pi");
      return { colonies: [] };
    },
  });
  const harness = await startTestServer(store);

  const retail = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/skills/queue",
    { method: "POST", body: { entries: [] } },
  );
  assert.equal(retail.response.status, 409);
  assert.equal(retail.payload.error, "CHARACTER_CONTROL_RETAIL_CLIENT");

  control = { ...BROWSER_CONTROL };
  const browser = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/pi/restart",
    { method: "POST", body: {} },
  );
  assert.equal(browser.response.status, 409);
  assert.equal(browser.payload.error, "CHARACTER_CONTROL_BROWSER_PILOT");
  assert.deepEqual(mutations, []);

  control = { ...OFFLINE_CONTROL };
  const offlineSkill = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/skills/queue",
    { method: "POST", body: { entries: [] } },
  );
  const offlinePi = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/pi/restart",
    { method: "POST", body: {} },
  );
  assert.equal(offlineSkill.response.status, 200);
  assert.equal(offlinePi.response.status, 200);
  assert.deepEqual(mutations, ["skill-queue", "pi"]);
});

test("mutation authority outages after an offline precheck use the stable unavailable error", async () => {
  function gatewayOutage(code) {
    const error = new Error("character-control authority disappeared");
    error.name = "EveGatewayError";
    error.code = code;
    error.statusCode = 503;
    return error;
  }
  const store = fakeStore({
    async getCharacterStatus() {
      return { ...OFFLINE_CONTROL };
    },
    async saveSkillQueue() {
      throw gatewayOutage("EVE_GATEWAY_UNREACHABLE");
    },
    async restartExtractors() {
      throw gatewayOutage("GATEWAY_RUNTIME_NOT_READY");
    },
  });
  const harness = await startTestServer(store);

  for (const [path, body] of [
    ["/api/characters/7/skills/queue", { entries: [] }],
    ["/api/characters/7/pi/restart", {}],
  ]) {
    const result = await apiRequest(harness.baseUrl, path, {
      method: "POST",
      body,
    });
    assert.equal(result.response.status, 503);
    assert.equal(result.payload.error, "CHARACTER_CONTROL_UNAVAILABLE");
  }
});

test("authority failures and expired leases use stable fail-closed errors", async () => {
  let mode = "unavailable";
  const leaseStore = createBrowserLeaseStore();
  leaseStore.put(SESSION_ID, 4, 7, {
    leaseID: "lease-id",
    leaseSecret: "lease-secret",
  });
  const store = fakeStore({
    async getCharacterStatus() {
      const error = new Error("runtime not ready");
      error.name = "EveGatewayError";
      error.code = "GATEWAY_RUNTIME_NOT_READY";
      error.statusCode = 503;
      throw error;
    },
    async getCharacterForAccount(accountID, characterID) {
      return { accountID, characterID };
    },
    async renewCharacterControl() {
      const error = new Error("lease expired");
      error.name = "EveGatewayError";
      error.code = mode === "expired" ? "CHARACTER_LEASE_EXPIRED" : "CHARACTER_LEASE_INVALID";
      error.statusCode = mode === "expired" ? 409 : 403;
      throw error;
    },
  });
  const harness = await startTestServer(store, leaseStore);

  const unavailable = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/skills/queue",
    { method: "POST", body: { entries: [] } },
  );
  assert.equal(unavailable.response.status, 503);
  assert.equal(unavailable.payload.error, "CHARACTER_CONTROL_UNAVAILABLE");

  mode = "expired";
  const expired = await apiRequest(
    harness.baseUrl,
    "/api/characters/7/control/renew",
    { method: "POST", body: {} },
  );
  assert.equal(expired.response.status, 409);
  assert.equal(expired.payload.error, "CHARACTER_LEASE_EXPIRED");
  assert.equal(leaseStore.get(SESSION_ID, 7), null);
});

test("normally expired local leases report expired after their secrets are pruned", async () => {
  const nowMs = Date.parse("2026-07-15T12:01:00.000Z");
  const leaseStore = createBrowserLeaseStore({
    now: () => nowMs,
    setTimer() {
      return 1;
    },
    clearTimer() {},
  });
  for (const characterID of [7, 8]) {
    leaseStore.put(SESSION_ID, 4, characterID, {
      leaseID: `expired-lease-${characterID}`,
      leaseSecret: `expired-secret-${characterID}`,
      leaseExpiresAt: "2026-07-15T12:01:00.000Z",
    });
    assert.equal(leaseStore.get(SESSION_ID, characterID), null);
    assert.equal(leaseStore.getLeaseStatus(SESSION_ID, characterID), "expired");
  }
  assert.deepEqual(leaseStore.listForSession(SESSION_ID), []);

  const controlCalls = [];
  const store = fakeStore({
    async getCharacterForAccount(accountID, characterID) {
      return { accountID, characterID };
    },
    async renewCharacterControl() {
      controlCalls.push("renew");
      throw new Error("expired credentials must not remain available");
    },
    async releaseCharacterControl() {
      controlCalls.push("release");
      throw new Error("expired credentials must not remain available");
    },
  });
  const harness = await startTestServer(store, leaseStore);
  for (const [characterID, operation] of [[7, "renew"], [8, "release"]]) {
    const result = await apiRequest(
      harness.baseUrl,
      `/api/characters/${characterID}/control/${operation}`,
      { method: "POST", body: {} },
    );
    assert.equal(result.response.status, 409);
    assert.equal(result.payload.error, "CHARACTER_LEASE_EXPIRED");
    assert.equal(leaseStore.getLeaseStatus(SESSION_ID, characterID), "missing");
  }
  assert.deepEqual(controlCalls, []);
});
