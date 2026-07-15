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

test("command routes forward canonical DTOs with only the signed session controller", async () => {
  const calls = [];
  const store = fakeStore({
    async saveSkillQueue(accountID, characterID, entries, options) {
      calls.push({ operation: "skill", accountID, characterID, entries, options });
      return { stateVersion: "runtime-a:5", queue: [] };
    },
    async restartExtractors(accountID, characterID, options) {
      calls.push({ operation: "pi", accountID, characterID, options });
      return { stateVersion: "runtime-a:6", colonies: [] };
    },
  });
  const harness = await startTestServer(store);
  const maliciousFields = {
    controllerID: COOKIE_TOKEN,
    type: "arbitrary.dispatch",
    payload: { leaseSecret: "browser-supplied-secret" },
    leaseSecret: "browser-supplied-secret",
    gatewayToken: "browser-supplied-token",
  };

  const skill = await apiRequest(harness.baseUrl, "/api/characters/7/skills/queue", {
    method: "POST",
    body: {
      commandID: "queue-command",
      expectedStateVersion: "runtime-a:4",
      entries: [{ typeID: 3300, toLevel: 4 }],
      activate: false,
      ...maliciousFields,
    },
  });
  const pi = await apiRequest(harness.baseUrl, "/api/characters/7/pi/restart", {
    method: "POST",
    body: {
      commandID: "pi-command",
      expectedStateVersion: "runtime-a:5",
      planetID: 99,
      ...maliciousFields,
    },
  });

  assert.equal(skill.response.status, 200);
  assert.equal(skill.payload.stateVersion, "runtime-a:5");
  assert.equal(pi.response.status, 200);
  assert.equal(pi.payload.stateVersion, "runtime-a:6");
  assert.deepEqual(calls, [
    {
      operation: "skill",
      accountID: 4,
      characterID: 7,
      entries: [{ typeID: 3300, toLevel: 4 }],
      options: {
        activate: false,
        commandID: "queue-command",
        expectedStateVersion: "runtime-a:4",
        controllerID: SESSION_ID,
      },
    },
    {
      operation: "pi",
      accountID: 4,
      characterID: 7,
      options: {
        planetID: 99,
        commandID: "pi-command",
        expectedStateVersion: "runtime-a:5",
        controllerID: SESSION_ID,
      },
    },
  ]);
  const browserPayloads = JSON.stringify([skill.payload, pi.payload]);
  for (const secret of [COOKIE_TOKEN, SESSION_ID, "browser-supplied-secret", "browser-supplied-token"]) {
    assert.equal(browserPayloads.includes(secret), false);
  }
});

test("command routes reject missing or malformed client envelopes without invoking the store", async () => {
  let mutations = 0;
  const store = fakeStore({
    async saveSkillQueue() {
      mutations += 1;
    },
    async restartExtractors() {
      mutations += 1;
    },
  });
  const harness = await startTestServer(store);
  const cases = [
    ["/api/characters/7/skills/queue", { expectedStateVersion: "runtime-a:4", entries: [], activate: true }],
    ["/api/characters/7/skills/queue", { commandID: "x", expectedStateVersion: "runtime-a:4", entries: [], activate: "yes" }],
    ["/api/characters/7/skills/queue", { commandID: "x", expectedStateVersion: "runtime-a:4", entries: [{ typeID: 3300, toLevel: 6 }], activate: true }],
    ["/api/characters/7/pi/restart", { commandID: "x", expectedStateVersion: "", planetID: 0 }],
    ["/api/characters/7/pi/restart", { commandID: "x", expectedStateVersion: "runtime-a:4", planetID: -1 }],
  ];
  for (const [path, body] of cases) {
    const result = await apiRequest(harness.baseUrl, path, { method: "POST", body });
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.error, "CHARACTER_COMMAND_INVALID");
  }
  assert.equal(mutations, 0);
});

test("BFF retries preserve the browser envelope and command errors stay stable and secret-free", async () => {
  const calls = [];
  let attempt = 0;
  const store = fakeStore({
    async saveSkillQueue(accountID, characterID, entries, options) {
      calls.push({ accountID, characterID, entries, options });
      attempt += 1;
      if (attempt === 1) {
        const error = new Error(`do not expose ${SESSION_ID} or lease-secret`);
        error.name = "EveGatewayError";
        error.code = "CHARACTER_COMMAND_UNAVAILABLE";
        error.statusCode = 503;
        throw error;
      }
      return { stateVersion: "runtime-a:5", queue: [] };
    },
  });
  const harness = await startTestServer(store);
  const body = {
    commandID: "retained-command",
    expectedStateVersion: "runtime-a:4",
    entries: [],
    activate: true,
  };

  const first = await apiRequest(harness.baseUrl, "/api/characters/7/skills/queue", {
    method: "POST",
    body,
  });
  const retry = await apiRequest(harness.baseUrl, "/api/characters/7/skills/queue", {
    method: "POST",
    body,
  });

  assert.equal(first.response.status, 503);
  assert.equal(first.payload.error, "CHARACTER_COMMAND_UNAVAILABLE");
  assert.equal(JSON.stringify(first.payload).includes(SESSION_ID), false);
  assert.equal(JSON.stringify(first.payload).includes("lease-secret"), false);
  assert.equal(retry.response.status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].options.controllerID, SESSION_ID);
  assert.notEqual(calls[0].options.controllerID, COOKIE_TOKEN);
});

test("all stable command and control errors survive BFF normalization", async () => {
  let failure = null;
  const store = fakeStore({
    async saveSkillQueue() {
      const error = new Error(`internal fingerprint lease-secret ${SESSION_ID}`);
      error.name = "EveGatewayError";
      error.code = failure.code;
      error.statusCode = failure.status;
      throw error;
    },
  });
  const harness = await startTestServer(store);
  const cases = [
    { code: "CHARACTER_COMMAND_INVALID", status: 400 },
    { code: "CHARACTER_COMMAND_ID_REUSED", status: 409 },
    { code: "CHARACTER_STATE_VERSION_MISMATCH", status: 409 },
    { code: "CHARACTER_COMMAND_UNAVAILABLE", status: 503 },
    { code: "CHARACTER_CONTROL_RETAIL_CLIENT", status: 409 },
    { code: "CHARACTER_CONTROL_BROWSER_PILOT", status: 409 },
    { code: "CHARACTER_CONTROL_UNAVAILABLE", status: 503 },
    { code: "GATEWAY_RUNTIME_NOT_READY", status: 503, expected: "CHARACTER_COMMAND_UNAVAILABLE" },
  ];

  for (const entry of cases) {
    failure = entry;
    const result = await apiRequest(harness.baseUrl, "/api/characters/7/skills/queue", {
      method: "POST",
      body: {
        commandID: `command-${entry.code}`,
        expectedStateVersion: "runtime-a:4",
        entries: [],
        activate: true,
      },
    });
    assert.equal(result.response.status, entry.status);
    assert.equal(result.payload.error, entry.expected || entry.code);
    const serialized = JSON.stringify(result.payload);
    assert.equal(serialized.includes("fingerprint"), false);
    assert.equal(serialized.includes("lease-secret"), false);
    assert.equal(serialized.includes(SESSION_ID), false);
  }
});

test("expired leases use the stable fail-closed error", async () => {
  const mode = "expired";
  const leaseStore = createBrowserLeaseStore();
  leaseStore.put(SESSION_ID, 4, 7, {
    leaseID: "lease-id",
    leaseSecret: "lease-secret",
  });
  const store = fakeStore({
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
