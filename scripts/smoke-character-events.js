"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { WebSocket } = require("ws");

const WEB_ROOT = path.resolve(__dirname, "..");
const EVE_ROOT = path.resolve(WEB_ROOT, "..", "eve.js");
const ACCOUNT = Object.freeze({
  accountID: 4,
  username: "goal-0d-smoke-user",
  role: 0,
  banned: false,
});
const CHARACTER_ID = 7;
const COMMAND_TYPE = "offline.skill_queue.save";
const TIMEOUT_MS = 4_000;

function randomCanary(label) {
  return `${label}-${crypto.randomBytes(18).toString("base64url")}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, description, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = predicate();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(5);
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function createTimerTracker() {
  const handles = new Set();
  return {
    timers: {
      setTimeout(callback, milliseconds, ...args) {
        let handle = null;
        handle = setTimeout(() => {
          handles.delete(handle);
          callback(...args);
        }, milliseconds);
        handles.add(handle);
        return handle;
      },
      clearTimeout(handle) {
        handles.delete(handle);
        clearTimeout(handle);
      },
    },
    count() {
      return handles.size;
    },
    clear() {
      for (const handle of handles) {
        clearTimeout(handle);
      }
      handles.clear();
    },
  };
}

function observeControlSubscriptions(controlRuntime) {
  let subscriberCount = 0;
  const observed = Object.freeze({
    ...controlRuntime,
    subscribe(listener) {
      const unsubscribe = controlRuntime.subscribe(listener);
      subscriberCount += 1;
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        subscriberCount -= 1;
        unsubscribe();
      };
    },
  });
  return {
    runtime: observed,
    subscriberCount() {
      return subscriberCount;
    },
  };
}

function makeWebStore() {
  return {
    async getAccount(username) {
      return username === ACCOUNT.username ? { ...ACCOUNT } : null;
    },
    async getCharacterForAccount(accountID, characterID) {
      return Number(accountID) === ACCOUNT.accountID &&
        Number(characterID) === CHARACTER_ID
        ? { characterID: CHARACTER_ID, accountID: ACCOUNT.accountID }
        : null;
    },
  };
}

function makeGatewayFacade(state) {
  const dependencies = Object.freeze({
    serviceManager: true,
    gameStore: true,
    skillQueue: true,
    planetaryInteraction: true,
    onlinePresence: true,
    characterControl: true,
    characterEvents: true,
    market: true,
  });
  let stopped = false;

  return Object.freeze({
    dependencies,
    getStatus: () => ({ hasAccounts: true, hasCharacters: true }),
    listAccounts: () => [{ ...ACCOUNT }],
    getAccountByUsername(username) {
      return username === ACCOUNT.username ? { ...ACCOUNT } : null;
    },
    getAccountByID(accountID) {
      return Number(accountID) === ACCOUNT.accountID ? { ...ACCOUNT } : null;
    },
    listCharacters(accountID) {
      return Number(accountID) === ACCOUNT.accountID
        ? [{ characterID: CHARACTER_ID, accountID: ACCOUNT.accountID }]
        : [];
    },
    getCharacter(characterID) {
      return Number(characterID) === CHARACTER_ID
        ? { characterID: CHARACTER_ID, accountID: ACCOUNT.accountID }
        : null;
    },
    buildSnapshot: () => null,
    isCharacterOnline(characterID) {
      return state.controlRuntime
        .getCharacterControlSnapshot(characterID).online === true;
    },
    getCharacterControlStatus(characterID) {
      return {
        ...state.controlRuntime.getCharacterControlSnapshot(characterID),
        stateVersion: state.commandRuntime.getStateVersion(characterID),
      };
    },
    claimBrowserControl(characterID, controllerID) {
      return state.controlRuntime.claimBrowserControl(characterID, controllerID);
    },
    renewBrowserControl(characterID, controllerID, leaseID, leaseSecret) {
      return state.controlRuntime.renewBrowserControl(
        characterID,
        controllerID,
        leaseID,
        leaseSecret,
      );
    },
    releaseBrowserControl(characterID, controllerID, leaseID, leaseSecret) {
      return state.controlRuntime.releaseBrowserControl(
        characterID,
        controllerID,
        leaseID,
        leaseSecret,
      );
    },
    submitSkillQueueSaveCommand(characterID, envelope) {
      return state.commandRuntime.submitCommand(characterID, envelope, {
        requiredType: COMMAND_TYPE,
      });
    },
    submitPiRestartExtractorsCommand() {
      throw new Error("not used by the Goal 0D smoke");
    },
    getStationAsks: async () => [],
    subscribeCharacterEvents(characterID, cursor, handlers) {
      if (stopped) {
        throw new Error("smoke gateway runtime is stopped");
      }
      return state.eventRuntime.subscribe(characterID, cursor, handlers);
    },
    getCharacterEventDiagnostics() {
      return state.eventRuntime.getDiagnostics();
    },
    shutdown() {
      if (stopped) {
        return;
      }
      stopped = true;
      state.eventRuntime.shutdown();
      state.commandRuntime.shutdown();
    },
  });
}

function eventUrl(authority, cursor = null) {
  const url = new URL(
    `ws://${authority}/api/characters/${CHARACTER_ID}/events`,
  );
  if (cursor) {
    url.searchParams.set("epoch", cursor.epoch);
    url.searchParams.set("sequence", String(cursor.sequence));
  }
  return url.toString();
}

function eveEventUrl(authority) {
  const url = new URL(`ws://${authority}/_evejs-web/v1/events`);
  url.searchParams.set("accountID", String(ACCOUNT.accountID));
  url.searchParams.set("characterID", String(CHARACTER_ID));
  return url.toString();
}

async function openCollector(url, options, clients) {
  const frames = [];
  const parseErrors = [];
  let closed = null;
  const webSocket = new WebSocket(url, options);
  clients.add(webSocket);
  webSocket.on("message", (data, isBinary) => {
    if (isBinary) {
      parseErrors.push(new Error("Received an unexpected binary frame."));
      return;
    }
    try {
      frames.push(JSON.parse(data.toString("utf8")));
    } catch (error) {
      parseErrors.push(error);
    }
  });
  webSocket.on("error", () => {});
  webSocket.once("close", (code, reason) => {
    closed = { code, reason: reason.toString("utf8") };
  });
  await once(webSocket, "open");
  return {
    frames,
    parseErrors,
    webSocket,
    get closed() {
      return closed;
    },
  };
}

async function waitForFrames(connection, count, description) {
  await waitFor(() => {
    if (connection.parseErrors.length > 0) {
      throw connection.parseErrors[0];
    }
    if (connection.closed && connection.frames.length < count) {
      throw new Error(
        `Socket closed (${connection.closed.code}) before ${description}.`,
      );
    }
    return connection.frames.length >= count;
  }, description);
}

async function closeWebSocket(webSocket, clients) {
  if (!webSocket) {
    return;
  }
  if (webSocket.readyState !== WebSocket.CLOSED) {
    await new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (webSocket.readyState !== WebSocket.CLOSED) {
          webSocket.terminate();
        }
        finish();
      }, 500);
      function finish() {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
      webSocket.once("close", finish);
      if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.close(1000, "Goal 0D smoke checkpoint complete");
      } else {
        webSocket.terminate();
      }
    });
  }
  clients.delete(webSocket);
  webSocket.removeAllListeners();
}

function rejectedUpgrade(url, options = {}) {
  return new Promise((resolve, reject) => {
    const webSocket = new WebSocket(url, options);
    let responding = false;
    const timeout = setTimeout(() => {
      webSocket.terminate();
      reject(new Error("Timed out waiting for WebSocket upgrade rejection."));
    }, TIMEOUT_MS);
    webSocket.once("open", () => {
      clearTimeout(timeout);
      webSocket.terminate();
      reject(new Error("WebSocket upgrade unexpectedly succeeded."));
    });
    webSocket.once("error", (error) => {
      if (!responding) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    webSocket.once("unexpected-response", (request, response) => {
      void request;
      responding = true;
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        clearTimeout(timeout);
        try {
          webSocket.terminate();
        } catch {
          // The rejected client is already closed.
        }
        const bodyText = Buffer.concat(chunks).toString("utf8");
        let body = null;
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
        resolve({ statusCode: response.statusCode, body });
      });
      response.resume();
    });
  });
}

function walkKeys(value, matches, pathParts = []) {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (new Set([
      "token",
      "session",
      "sessionID",
      "controllerID",
      "leaseID",
      "leaseSecret",
      "payload",
      "fingerprint",
      "rawError",
      "stack",
      "database",
      "sql",
    ]).has(key)) {
      matches.push(childPath.join("."));
    }
    walkKeys(child, matches, childPath);
  }
}

function assertSanitized(frames, rejectionBodies, secretValues) {
  const inspected = [...frames, ...rejectionBodies];
  const serialized = JSON.stringify(inspected);
  const leakedValues = [];
  for (const [name, value] of Object.entries(secretValues)) {
    if (value && serialized.includes(String(value))) {
      leakedValues.push(name);
    }
  }
  const forbiddenFields = [];
  walkKeys(frames, forbiddenFields);
  assert.deepEqual(leakedValues, []);
  assert.deepEqual(forbiddenFields, []);
  return {
    framesInspected: frames.length,
    rejectionBodiesInspected: rejectionBodies.length,
    secretCanariesChecked: Object.keys(secretValues).length,
    leakedValues,
    forbiddenFields,
  };
}

async function closeHttpServer(server) {
  if (!server || !server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function portIsClosed(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const connected = await new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(100);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => resolve(false));
    });
    if (!connected) {
      return true;
    }
    await delay(10);
  }
  return false;
}

function redactError(error, secrets) {
  let message = String(error && error.message || error || "Unknown error");
  for (const value of Object.values(secrets || {})) {
    if (value) {
      message = message.split(String(value)).join("[REDACTED]");
    }
  }
  return {
    name: String(error && error.name || "Error"),
    message,
  };
}

async function executeSmoke(state, evidence, tempDataDir) {
  const {
    AUTHORIZATION_POLICIES,
    createCharacterCommandRuntime,
  } = require(path.join(
    EVE_ROOT,
    "server/src/services/online/characterCommandRuntime",
  ));
  const {
    createCharacterControlRuntime,
  } = require(path.join(
    EVE_ROOT,
    "server/src/services/online/characterControlRuntime",
  ));
  const {
    createCharacterEventRuntime,
  } = require(path.join(
    EVE_ROOT,
    "server/src/services/online/characterEventRuntime",
  ));
  const {
    mountEvejsWebGatewayUpgrades,
  } = require(path.join(
    EVE_ROOT,
    "server/src/_secondary/express/evejsWebGateway",
  ));
  const {
    createRuntimeContext,
  } = require(path.join(EVE_ROOT, "server/src/runtimeContext"));

  const webAuth = require(path.join(WEB_ROOT, "src/webAuth"));
  const webConfig = require(path.join(WEB_ROOT, "src/config"));
  const { createApp, startServer } = require(path.join(WEB_ROOT, "src/server"));

  assert.equal(path.dirname(webAuth.USERS_PATH), tempDataDir);
  const sessionToken = webAuth.createSessionToken(ACCOUNT);
  const sessionPayload = webAuth.verifySessionToken(sessionToken);
  assert.ok(sessionPayload);
  assert.equal(sessionPayload.accountID, ACCOUNT.accountID);
  assert.equal(sessionPayload.username, ACCOUNT.username);
  assert.equal(
    fs.existsSync(path.join(tempDataDir, "session-secret.txt")),
    true,
  );

  state.secretValues = {
    gatewayToken: process.env.EVEJS_WEB_GATEWAY_TOKEN,
    signedSessionToken: sessionToken,
    controllerID: sessionPayload.sessionID,
    firstPayload: randomCanary("payload-one"),
    secondPayload: randomCanary("payload-two"),
    livePayload: randomCanary("payload-live"),
  };

  state.controlTimers = createTimerTracker();
  state.controlCore = createCharacterControlRuntime({
    findRetailSession: () => null,
    timers: state.controlTimers.timers,
  });
  state.controlObservation = observeControlSubscriptions(state.controlCore);
  state.controlRuntime = state.controlObservation.runtime;

  state.commandRuntime = createCharacterCommandRuntime({
    controlRuntime: state.controlRuntime,
    commandDefinitions: {
      [COMMAND_TYPE]: {
        authorizationPolicy: AUTHORIZATION_POLICIES.OFFLINE_COMPANION,
        normalizePayload(payload) {
          if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload) ||
            typeof payload.canary !== "string" ||
            !Number.isSafeInteger(payload.ordinal)
          ) {
            throw new TypeError("invalid smoke payload");
          }
          return { canary: payload.canary, ordinal: payload.ordinal };
        },
        async handler({ payload }) {
          return { accepted: true, ordinal: payload.ordinal };
        },
      },
    },
    onReceiptCached(settlement) {
      if (state.eventRuntime) {
        state.eventRuntime.publishCommandSettlement(settlement);
      }
    },
  });

  function createFreshEventRuntime() {
    return createCharacterEventRuntime({
      controlRuntime: state.controlRuntime,
      getStateVersion: state.commandRuntime.getStateVersion,
      historyLimit: 16,
      commandOutcomeLimit: 8,
    });
  }

  state.eventRuntime = createFreshEventRuntime();
  state.gatewayRuntime = makeGatewayFacade(state);
  const runtimeContext = createRuntimeContext({
    serviceManager: { lookup: () => null },
    gatewayRuntime: state.gatewayRuntime,
  });

  state.eveServer = http.createServer((request, response) => {
    void request;
    response.statusCode = 404;
    response.end();
  });
  state.eveUpgrades = mountEvejsWebGatewayUpgrades(
    state.eveServer,
    runtimeContext,
    { heartbeatIntervalMs: 100, shutdownGraceMs: 250 },
  );
  state.eveServer.listen(0, "127.0.0.1");
  await once(state.eveServer, "listening");
  state.evePort = state.eveServer.address().port;
  const eveAuthority = `127.0.0.1:${state.evePort}`;
  process.env.EVEJS_GATEWAY_URL =
    `http://${eveAuthority}/_evejs-web/v1`;

  const app = createApp({
    eveStore: makeWebStore(),
    webAuth,
    errorLogger: () => {},
    characterEventProxyOptions: {
      heartbeatIntervalMs: 100,
      upgradeTimeoutMs: 1_000,
    },
  });
  state.webServer = startServer({
    app,
    host: "127.0.0.1",
    port: 0,
    silent: true,
  });
  await once(state.webServer, "listening");
  state.webPort = state.webServer.address().port;
  const webAuthority = `127.0.0.1:${state.webPort}`;
  const origin = `http://${webAuthority}`;
  const cookie = `${webConfig.sessionCookieName}=${encodeURIComponent(sessionToken)}`;
  const browserOptions = {
    origin,
    headers: { Cookie: cookie },
  };

  const directRejection = await rejectedUpgrade(eveEventUrl(eveAuthority));
  assert.equal(directRejection.statusCode, 401);
  assert.equal(directRejection.body.error, "UNAUTHORIZED");
  const bffRejection = await rejectedUpgrade(eventUrl(webAuthority), { origin });
  assert.equal(bffRejection.statusCode, 401);
  assert.equal(bffRejection.body.error, "AUTH_REQUIRED");
  evidence.authentication = {
    signedTemporarySessionVerified: true,
    signedSessionCookieName: webConfig.sessionCookieName,
    directEveRejection: {
      statusCode: directRejection.statusCode,
      error: directRejection.body.error,
    },
    bffRejection: {
      statusCode: bffRejection.statusCode,
      error: bffRejection.body.error,
    },
  };

  const initialConnection = await openCollector(
    eventUrl(webAuthority),
    browserOptions,
    state.clients,
  );
  await waitForFrames(initialConnection, 1, "the initial snapshot");
  assert.equal(initialConnection.frames.length, 1);
  const initialSnapshot = initialConnection.frames[0];
  assert.equal(initialSnapshot.type, "snapshot");
  assert.equal(initialSnapshot.characterID, CHARACTER_ID);
  assert.equal(initialSnapshot.cursor.sequence, 0);
  assert.equal(initialSnapshot.control.controlState, "offline");
  assert.deepEqual(initialSnapshot.commandOutcomes, []);
  evidence.initialSnapshot = {
    type: initialSnapshot.type,
    cursor: initialSnapshot.cursor,
    controlState: initialSnapshot.control.controlState,
    stateVersion: initialSnapshot.stateVersion,
    recentCommandOutcomeCount: initialSnapshot.commandOutcomes.length,
  };

  await closeWebSocket(initialConnection.webSocket, state.clients);
  await waitFor(() => {
    const proxy = state.webServer.characterEventProxy.getDiagnostics();
    const upgrades = state.eveUpgrades.getDiagnostics();
    const runtime = state.eventRuntime.getDiagnostics();
    return proxy.sessions === 0 &&
      proxy.sockets === 0 &&
      upgrades.activeSocketCount === 0 &&
      upgrades.subscriptionCount === 0 &&
      runtime.subscriberCount === 0;
  }, "the initial disconnect to remove every subscription");

  async function submitCommand(commandID, canary, ordinal) {
    const stateVersion = state.commandRuntime.getStateVersion(CHARACTER_ID);
    const result = await state.commandRuntime.submitCommand(
      CHARACTER_ID,
      {
        commandID,
        controllerID: sessionPayload.sessionID,
        expectedStateVersion: stateVersion,
        payload: { canary, ordinal },
        type: COMMAND_TYPE,
      },
      { requiredType: COMMAND_TYPE },
    );
    assert.equal(result.result.accepted, true);
    return result;
  }

  const missedCommandIDs = ["smoke-command-0001", "smoke-command-0002"];
  await submitCommand(
    missedCommandIDs[0],
    state.secretValues.firstPayload,
    1,
  );
  await submitCommand(
    missedCommandIDs[1],
    state.secretValues.secondPayload,
    2,
  );
  const lease = state.controlRuntime.claimBrowserControl(
    CHARACTER_ID,
    sessionPayload.sessionID,
  );
  state.secretValues.leaseID = lease.credentials.leaseID;
  state.secretValues.leaseSecret = lease.credentials.leaseSecret;
  state.controlRuntime.releaseBrowserControl(
    CHARACTER_ID,
    sessionPayload.sessionID,
    lease.credentials.leaseID,
    lease.credentials.leaseSecret,
  );
  const missedDiagnostics = state.eventRuntime.getDiagnostics();
  assert.equal(missedDiagnostics.subscriberCount, 0);
  assert.equal(missedDiagnostics.historyEventCount, 4);
  assert.equal(missedDiagnostics.commandOutcomeCount, 2);

  const replayConnection = await openCollector(
    eventUrl(webAuthority, initialSnapshot.cursor),
    browserOptions,
    state.clients,
  );
  await waitForFrames(replayConnection, 4, "the exact missed-event replay");
  assert.equal(replayConnection.frames.length, 4);
  assert.deepEqual(
    replayConnection.frames.map((frame) => frame.cursor.sequence),
    [1, 2, 3, 4],
  );
  assert.ok(replayConnection.frames.every((frame) => frame.type === "event"));
  assert.deepEqual(
    replayConnection.frames.map((frame) => frame.event.kind),
    [
      "command_settled",
      "command_settled",
      "control_changed",
      "control_changed",
    ],
  );
  assert.deepEqual(
    replayConnection.frames.slice(0, 2).map((frame) => frame.event.commandID),
    missedCommandIDs,
  );
  assert.deepEqual(
    replayConnection.frames.slice(2).map(
      (frame) => frame.event.control.controlState,
    ),
    ["browser_pilot", "offline"],
  );
  evidence.disconnectAndReplay = {
    disconnectedSubscriberCount: 0,
    missedEventCount: 4,
    requestedCursor: initialSnapshot.cursor,
    replaySequences: replayConnection.frames.map(
      (frame) => frame.cursor.sequence,
    ),
    replayKinds: replayConnection.frames.map((frame) => frame.event.kind),
    replayCommandIDs: missedCommandIDs,
    replayControlStates: ["browser_pilot", "offline"],
  };

  const liveCommandID = "smoke-command-0003";
  await submitCommand(liveCommandID, state.secretValues.livePayload, 3);
  await waitForFrames(replayConnection, 5, "the live continuation event");
  await delay(20);
  assert.equal(replayConnection.frames.length, 5);
  const liveFrame = replayConnection.frames[4];
  assert.equal(liveFrame.type, "event");
  assert.equal(liveFrame.cursor.sequence, 5);
  assert.equal(liveFrame.event.kind, "command_settled");
  assert.equal(liveFrame.event.commandID, liveCommandID);
  evidence.liveContinuation = {
    sequence: liveFrame.cursor.sequence,
    kind: liveFrame.event.kind,
    commandID: liveFrame.event.commandID,
    duplicateFrameCount: replayConnection.frames.length - 5,
  };

  await closeWebSocket(replayConnection.webSocket, state.clients);
  await waitFor(() => {
    return state.eventRuntime.getDiagnostics().subscriberCount === 0 &&
      state.eveUpgrades.getDiagnostics().subscriptionCount === 0 &&
      state.webServer.characterEventProxy.getDiagnostics().sessions === 0;
  }, "the live connection to disconnect before the epoch change");

  const oldCursor = liveFrame.cursor;
  const oldEventRuntime = state.eventRuntime;
  state.retiredEventRuntime = oldEventRuntime;
  const oldEpoch = oldEventRuntime.getDiagnostics().epoch;
  oldEventRuntime.shutdown();
  assert.deepEqual(
    {
      stopped: oldEventRuntime.getDiagnostics().stopped,
      characterCount: oldEventRuntime.getDiagnostics().characterCount,
      subscriberCount: oldEventRuntime.getDiagnostics().subscriberCount,
      historyEventCount: oldEventRuntime.getDiagnostics().historyEventCount,
      commandOutcomeCount: oldEventRuntime.getDiagnostics().commandOutcomeCount,
    },
    {
      stopped: true,
      characterCount: 0,
      subscriberCount: 0,
      historyEventCount: 0,
      commandOutcomeCount: 0,
    },
  );
  state.eventRuntime = createFreshEventRuntime();
  const newEpoch = state.eventRuntime.getDiagnostics().epoch;
  assert.notEqual(newEpoch, oldEpoch);

  const epochConnection = await openCollector(
    eventUrl(webAuthority, oldCursor),
    browserOptions,
    state.clients,
  );
  await waitForFrames(epochConnection, 1, "the new-epoch snapshot");
  assert.equal(epochConnection.frames.length, 1);
  const epochSnapshot = epochConnection.frames[0];
  assert.equal(epochSnapshot.type, "snapshot");
  assert.equal(epochSnapshot.cursor.epoch, newEpoch);
  assert.equal(epochSnapshot.cursor.sequence, 0);
  assert.notEqual(epochSnapshot.cursor.epoch, oldCursor.epoch);
  assert.equal(epochSnapshot.control.controlState, "offline");
  assert.deepEqual(epochSnapshot.commandOutcomes, []);
  assert.equal(
    epochSnapshot.stateVersion,
    state.commandRuntime.getStateVersion(CHARACTER_ID),
  );
  evidence.epochReset = {
    requestedOldCursor: oldCursor,
    oldEpoch,
    newEpoch,
    responseType: epochSnapshot.type,
    responseSequence: epochSnapshot.cursor.sequence,
    controlState: epochSnapshot.control.controlState,
    recentCommandOutcomeCount: epochSnapshot.commandOutcomes.length,
  };

  const forwardedFrames = [
    initialSnapshot,
    ...replayConnection.frames,
    epochSnapshot,
  ];
  evidence.sanitization = assertSanitized(
    forwardedFrames,
    [directRejection.body, bffRejection.body],
    state.secretValues,
  );
  evidence.ephemeral = {
    evePort: state.evePort,
    bffPort: state.webPort,
    existingServersRequired: false,
    temporaryDataDirectory: true,
  };
}

async function teardown(state) {
  const teardownEvidence = {};

  if (state.webServer) {
    await closeHttpServer(state.webServer);
  }
  for (const client of [...state.clients]) {
    await closeWebSocket(client, state.clients);
  }

  if (state.eveUpgrades) {
    await waitFor(() => {
      const diagnostics = state.eveUpgrades.getDiagnostics();
      return diagnostics.activeSocketCount === 0 &&
        diagnostics.subscriptionCount === 0;
    }, "the Eve gateway sockets to close during BFF teardown");
    await state.eveUpgrades.shutdown();
  }
  if (state.gatewayRuntime) {
    state.gatewayRuntime.shutdown();
  } else {
    if (state.eventRuntime) {
      state.eventRuntime.shutdown();
    }
    if (state.commandRuntime) {
      state.commandRuntime.shutdown();
    }
  }
  if (state.controlCore) {
    state.controlCore.shutdown();
  }
  if (state.eveServer) {
    await closeHttpServer(state.eveServer);
  }

  if (state.webServer) {
    const proxy = state.webServer.characterEventProxy.getDiagnostics();
    assert.deepEqual(proxy, {
      attached: false,
      closed: true,
      pendingUpgrades: 0,
      sessions: 0,
      sockets: 0,
      timers: 0,
    });
    teardownEvidence.bffProxy = proxy;
    teardownEvidence.bffServerListeners = {
      upgrade: state.webServer.listenerCount("upgrade"),
      close: state.webServer.listenerCount("close"),
    };
    assert.deepEqual(teardownEvidence.bffServerListeners, {
      upgrade: 0,
      close: 0,
    });
  }
  if (state.eveUpgrades) {
    const gateway = state.eveUpgrades.getDiagnostics();
    assert.deepEqual(gateway, {
      stopped: true,
      activeSocketCount: 0,
      subscriptionCount: 0,
      heartbeatActive: false,
      shutdownTimerActive: false,
    });
    teardownEvidence.eveGateway = gateway;
    teardownEvidence.eveServerListeners = {
      upgrade: state.eveServer.listenerCount("upgrade"),
      close: state.eveServer.listenerCount("close"),
    };
    assert.deepEqual(teardownEvidence.eveServerListeners, {
      upgrade: 0,
      close: 0,
    });
  }
  if (state.eventRuntime) {
    const runtime = state.eventRuntime.getDiagnostics();
    assert.equal(runtime.stopped, true);
    assert.equal(runtime.characterCount, 0);
    assert.equal(runtime.subscriberCount, 0);
    assert.equal(runtime.historyEventCount, 0);
    assert.equal(runtime.commandOutcomeCount, 0);
    teardownEvidence.eventRuntime = runtime;
  }
  if (state.retiredEventRuntime) {
    const retiredRuntime = state.retiredEventRuntime.getDiagnostics();
    assert.equal(retiredRuntime.stopped, true);
    assert.equal(retiredRuntime.characterCount, 0);
    assert.equal(retiredRuntime.subscriberCount, 0);
    assert.equal(retiredRuntime.historyEventCount, 0);
    assert.equal(retiredRuntime.commandOutcomeCount, 0);
    teardownEvidence.retiredEventRuntime = retiredRuntime;
  }
  if (state.commandRuntime) {
    assert.throws(
      () => state.commandRuntime.getStateVersion(CHARACTER_ID),
      (error) => error && error.code === "CHARACTER_COMMAND_UNAVAILABLE",
    );
    teardownEvidence.commandRuntimeStopped = true;
  }
  if (state.controlObservation) {
    teardownEvidence.controlSubscriptions =
      state.controlObservation.subscriberCount();
    assert.equal(teardownEvidence.controlSubscriptions, 0);
  }
  if (state.controlTimers) {
    teardownEvidence.controlTimers = state.controlTimers.count();
    assert.equal(teardownEvidence.controlTimers, 0);
  }
  teardownEvidence.clientSockets = state.clients.size;
  assert.equal(teardownEvidence.clientSockets, 0);

  if (state.evePort) {
    teardownEvidence.evePortClosed = await portIsClosed(state.evePort);
    assert.equal(teardownEvidence.evePortClosed, true);
  }
  if (state.webPort) {
    teardownEvidence.bffPortClosed = await portIsClosed(state.webPort);
    assert.equal(teardownEvidence.bffPortClosed, true);
  }
  return teardownEvidence;
}

async function main() {
  const originalEnvironment = {
    EVEJS_GATEWAY_URL: process.env.EVEJS_GATEWAY_URL,
    EVEJS_WEB_GATEWAY_TOKEN: process.env.EVEJS_WEB_GATEWAY_TOKEN,
    EVEJS_WEB_POC_DATA_DIR: process.env.EVEJS_WEB_POC_DATA_DIR,
  };
  const tempDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "evejs-goal-0d-smoke-"),
  );
  process.env.EVEJS_WEB_POC_DATA_DIR = tempDataDir;
  process.env.EVEJS_WEB_GATEWAY_TOKEN = randomCanary("gateway-token");

  const state = {
    clients: new Set(),
    secretValues: {
      gatewayToken: process.env.EVEJS_WEB_GATEWAY_TOKEN,
    },
  };
  const evidence = {
    ok: false,
    goal: "0D cross-stack character-event smoke",
    productionEntrypoints: {
      eveControlRuntime: true,
      eveCommandRuntime: true,
      eveEventRuntime: true,
      eveGatewayUpgradeHandler: true,
      webCreateApp: true,
      webStartServer: true,
      webAuthSignedSession: true,
      wsClient: true,
    },
  };
  let failure = null;

  try {
    await executeSmoke(state, evidence, tempDataDir);
  } catch (error) {
    failure = error;
  }
  try {
    evidence.teardown = await teardown(state);
  } catch (error) {
    failure = failure || error;
    evidence.teardown = {
      ok: false,
      error: redactError(error, state.secretValues),
    };
  }

  if (state.controlTimers) {
    state.controlTimers.clear();
  }
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  const resolvedTempDataDir = path.resolve(tempDataDir);
  const resolvedTempRoot = path.resolve(os.tmpdir());
  assert.equal(
    resolvedTempDataDir.startsWith(`${resolvedTempRoot}${path.sep}`),
    true,
  );
  fs.rmSync(resolvedTempDataDir, { recursive: true, force: true });
  evidence.temporaryDataDirectoryRemoved = !fs.existsSync(resolvedTempDataDir);

  if (failure) {
    evidence.error = redactError(failure, state.secretValues);
    process.exitCode = 1;
  } else {
    evidence.ok = true;
  }
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  process.exitCode = 1;
  console.error(JSON.stringify({
    ok: false,
    goal: "0D cross-stack character-event smoke",
    error: redactError(error, {}),
  }, null, 2));
});
