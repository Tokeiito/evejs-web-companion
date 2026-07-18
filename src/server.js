"use strict";

const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const eveStore = require("./eveStore");
const eveGatewayClient = require("./eveGatewayClient");
const marketClient = require("./marketClient");
const webAuth = require("./webAuth");
const config = require("./config");
const { createBrowserLeaseStore } = require("./browserLeaseStore");
const { createCharacterEventProxy } = require("./characterEventProxy");

function createApp(options = {}) {
const app = express();
const store = options.eveStore || eveStore;
const gateway = options.eveGatewayClient || eveGatewayClient;
const market = options.marketClient || marketClient;
const auth = options.webAuth || webAuth;
const leaseStore = options.browserLeaseStore || createBrowserLeaseStore();
const errorLogger = options.errorLogger || ((error) => console.error(error));
app.locals.browserLeaseStore = leaseStore;
app.locals.characterEventProxyOptions = {
  eveStore: store,
  webAuth: auth,
  sessionCookieName: config.sessionCookieName,
  ...(options.characterEventProxyOptions || {}),
};
fs.mkdirSync(config.iconCacheDir, { recursive: true });

app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(value);
    }
  }
  return cookies;
}

function setSessionCookie(res, token) {
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: config.sessionTtlMs,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
  });
}

function publicAccount(account) {
  return {
    username: account.username,
    accountID: account.accountID,
    role: account.role,
    banned: account.banned,
  };
}

function publicControlStatus(status) {
  return {
    characterID: Number(status.characterID),
    online: status.online === true,
    controlState: status.controlState,
    transport: status.transport === null ? null : status.transport,
    leaseExpiresAt:
      typeof status.leaseExpiresAt === "string"
        ? status.leaseExpiresAt
        : null,
    stateVersion: typeof status.stateVersion === "string" ? status.stateVersion : undefined,
  };
}

async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = auth.verifySessionToken(cookies[config.sessionCookieName]);
  if (!payload) {
    res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
    return;
  }

  try {
    const account = await store.getAccount(payload.username);
    if (!account || account.accountID !== Number(payload.accountID)) {
      clearSessionCookie(res);
      res.status(401).json({ ok: false, error: "ACCOUNT_NOT_FOUND" });
      return;
    }
    if (account.banned) {
      clearSessionCookie(res);
      res.status(403).json({ ok: false, error: "ACCOUNT_BANNED" });
      return;
    }
    req.account = account;
    req.webSessionID = payload.sessionID;
    next();
  } catch (error) {
    next(error);
  }
}

function controlUnavailableError() {
  const error = new Error("The EveJS character-control authority is unavailable.");
  error.code = "CHARACTER_CONTROL_UNAVAILABLE";
  error.statusCode = 503;
  return error;
}

function invalidLeaseError() {
  const error = new Error("This web session does not hold valid credentials for the browser lease.");
  error.code = "CHARACTER_LEASE_INVALID";
  error.statusCode = 403;
  return error;
}

function expiredLeaseError() {
  const error = new Error("This web session's browser lease has expired.");
  error.code = "CHARACTER_LEASE_EXPIRED";
  error.statusCode = 409;
  return error;
}

function missingLocalLeaseError(sessionID, characterID) {
  if (
    typeof leaseStore.getLeaseStatus === "function" &&
    leaseStore.getLeaseStatus(sessionID, characterID) === "expired"
  ) {
    leaseStore.remove(sessionID, characterID);
    return expiredLeaseError();
  }
  return invalidLeaseError();
}

function normalizeControlError(error) {
  const stableCodes = new Set([
    "CHARACTER_CONTROL_RETAIL_CLIENT",
    "CHARACTER_CONTROL_BROWSER_PILOT",
    "CHARACTER_LEASE_EXPIRED",
    "CHARACTER_LEASE_INVALID",
    "CHARACTER_CONTROL_UNAVAILABLE",
  ]);
  if (error && stableCodes.has(error.code)) {
    return error;
  }
  if (error && error.name === "EveGatewayError") {
    const code = String(error.code || "");
    const isGatewayAuthorityFailure =
      code.startsWith("EVE_GATEWAY_") ||
      code.startsWith("GATEWAY_");
    if (
      !isGatewayAuthorityFailure &&
      Number(error.statusCode) >= 400 &&
      Number(error.statusCode) < 500
    ) {
      return error;
    }
    return controlUnavailableError();
  }
  return error;
}

const COMMAND_ERROR_DETAILS = Object.freeze({
  CHARACTER_COMMAND_INVALID: {
    statusCode: 400,
    message: "The character command request is invalid.",
  },
  CHARACTER_COMMAND_ID_REUSED: {
    statusCode: 409,
    message: "This command identifier was already used for a different request.",
  },
  CHARACTER_STATE_VERSION_MISMATCH: {
    statusCode: 409,
    message: "Character state changed after this page was loaded.",
  },
  CHARACTER_COMMAND_UNAVAILABLE: {
    statusCode: 503,
    message: "The EveJS character-command runtime is unavailable.",
  },
  CHARACTER_CONTROL_RETAIL_CLIENT: {
    statusCode: 409,
    message: "Character is controlled by a retail client and must be offline for this mutation.",
  },
  CHARACTER_CONTROL_BROWSER_PILOT: {
    statusCode: 409,
    message: "Character is controlled by a browser pilot and must be offline for this mutation.",
  },
  CHARACTER_CONTROL_UNAVAILABLE: {
    statusCode: 503,
    message: "The EveJS character-control authority is unavailable.",
  },
});

function commandError(code) {
  const details = COMMAND_ERROR_DETAILS[code] || COMMAND_ERROR_DETAILS.CHARACTER_COMMAND_INVALID;
  const error = new Error(details.message);
  error.code = code;
  error.statusCode = details.statusCode;
  return error;
}

function normalizeCommandError(error) {
  if (error && COMMAND_ERROR_DETAILS[error.code]) {
    return commandError(error.code);
  }
  if (error && error.name === "EveGatewayError") {
    const code = String(error.code || "");
    const isGatewayFailure = code.startsWith("EVE_GATEWAY_") || code.startsWith("GATEWAY_");
    if (!isGatewayFailure && Number(error.statusCode) >= 400 && Number(error.statusCode) < 500) {
      return error;
    }
    return commandError("CHARACTER_COMMAND_UNAVAILABLE");
  }
  return commandError("CHARACTER_COMMAND_UNAVAILABLE");
}

function readClientCommandMetadata(body) {
  const commandID = body && body.commandID;
  const expectedStateVersion = body && body.expectedStateVersion;
  if (
    typeof commandID !== "string" ||
    commandID.length === 0 ||
    commandID.length > 256 ||
    typeof expectedStateVersion !== "string" ||
    expectedStateVersion.length === 0 ||
    expectedStateVersion.length > 512
  ) {
    throw commandError("CHARACTER_COMMAND_INVALID");
  }
  return { commandID, expectedStateVersion };
}

function readSkillQueuePayload(body) {
  if (!body || !Array.isArray(body.entries) || typeof body.activate !== "boolean") {
    throw commandError("CHARACTER_COMMAND_INVALID");
  }
  const entries = body.entries.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      !Number.isSafeInteger(entry.typeID) ||
      entry.typeID <= 0 ||
      !Number.isSafeInteger(entry.toLevel) ||
      entry.toLevel < 1 ||
      entry.toLevel > 5
    ) {
      throw commandError("CHARACTER_COMMAND_INVALID");
    }
    return { typeID: entry.typeID, toLevel: entry.toLevel };
  });
  return { entries, activate: body.activate };
}

function readPlanetRestartPayload(body) {
  if (!body || !Number.isSafeInteger(body.planetID) || body.planetID < 0) {
    throw commandError("CHARACTER_COMMAND_INVALID");
  }
  return { planetID: body.planetID };
}

app.get("/api/health", async (req, res) => {
  try {
    const storeStatus = await store.getStatus();
    res.json({
      ok: true,
      eveRoot: config.eveRoot,
      webUsersConfigured: auth.countConfiguredUsers(),
      gateway: storeStatus,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      gatewayUrl: process.env.EVEJS_GATEWAY_URL || "http://127.0.0.1:26002/_evejs-web/v1",
    });
  }
});

// Who-cares web login (roadmap section 6, goal R1): an existing EveJS account
// username signs in with ANY password, including an empty one — the password
// is not checked at all. This deliberately mirrors the emulator's retail-path
// devSkipPasswordValidation behavior. The scrypt web-password store is
// BYPASSED, NOT DELETED: src/webAuth.js verifyWebPassword/upsertWebPassword,
// data/web-users.json, and `npm run webpass` stay in place (data-preservation
// rule) but are deprecated for login. Unknown usernames get a clear 401;
// account auto-create is deferred to R2.
app.post("/api/login", async (req, res, next) => {
  const username = String(req.body && req.body.username || "").trim();
  try {
    let account = null;
    try {
      account = await store.getAccount(username);
    } catch (error) {
      if (!(error && error.code === "ACCOUNT_NOT_FOUND")) {
        throw error;
      }
    }
    if (!account) {
      res.status(401).json({
        ok: false,
        error: "UNKNOWN_EVEJS_ACCOUNT",
        message: "Unknown EveJS account.",
      });
      return;
    }
    if (account.banned) {
      res.status(403).json({ ok: false, error: "ACCOUNT_BANNED" });
      return;
    }

    setSessionCookie(res, auth.createSessionToken(account));
    res.json({
      ok: true,
      account: publicAccount(account),
      characters: await store.listCharactersForAccount(account.accountID),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const payload = auth.verifySessionToken(cookies[config.sessionCookieName]);
  if (payload && payload.sessionID) {
    const leases = leaseStore.listForSession(payload.sessionID);
    await Promise.allSettled(leases.map((lease) =>
      store.releaseCharacterControl(
        lease.accountID,
        lease.characterID,
        payload.sessionID,
        lease,
      )));
    leaseStore.clearSession(payload.sessionID);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, async (req, res, next) => {
  try {
  res.json({
    ok: true,
    account: publicAccount(req.account),
    characters: await store.listCharactersForAccount(req.account.accountID),
  });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters", requireAuth, async (req, res, next) => {
  try {
  res.json({
    ok: true,
    characters: await store.listCharactersForAccount(req.account.accountID),
  });
  } catch (error) {
    next(error);
  }
});

// Thin bridge proxy for the whitelisted EveJS callMethod path (goal R1).
// Forwards the retail call tuple (service, method, args, kwargs) to the
// gateway's POST /_evejs-web/v1/call; the gateway enforces the deny-by-default
// (service, method) allowlist and materializes the browser-backed session.
// The BFF pins the session identity: `userid` always comes from the signed
// login session, never from the browser payload. Wire contract:
// docs/bridge-wire-contract.md.
app.post("/api/bridge/call", requireAuth, async (req, res, next) => {
  const body = req.body || {};
  const clientSessionFields =
    body.session && typeof body.session === "object" && !Array.isArray(body.session)
      ? body.session
      : {};
  try {
    const outcome = await gateway.callMethod(
      body.service,
      body.method,
      body.args,
      body.kwargs,
      { ...clientSessionFields, userid: Number(req.account.accountID) },
    );
    res.json({
      ok: true,
      service: outcome.service,
      method: outcome.method,
      result: outcome.result,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/characters/:characterID", requireAuth);

app.get("/api/characters/:characterID/events", (req, res) => {
  res.status(426).json({
    ok: false,
    error: "WEBSOCKET_UPGRADE_REQUIRED",
  });
});

app.get("/api/characters/:characterID/skills", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = await store.getSkillDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, stateVersion: dashboard.stateVersion, dashboard });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:characterID/skills/queue", async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const command = readClientCommandMetadata(req.body);
    const payload = readSkillQueuePayload(req.body);
    const dashboard = await store.saveSkillQueue(
      req.account.accountID,
      characterID,
      payload.entries,
      {
        activate: payload.activate,
        commandID: command.commandID,
        expectedStateVersion: command.expectedStateVersion,
        controllerID: req.webSessionID,
      },
    );
    if (!dashboard) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    res.json({ ok: true, stateVersion: dashboard.stateVersion, dashboard });
  } catch (error) {
    next(normalizeCommandError(error));
  }
});

app.get("/api/characters/:characterID/overview", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const overview = await store.getCharacterOverview(req.account.accountID, characterID);
  if (!overview) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, overview });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters/:characterID/inventory", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = await store.getInventoryDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters/:characterID/industry", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = await store.getIndustryDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters/:characterID/status", async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const status = await store.getCharacterStatus(req.account.accountID, characterID);
    if (!status) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    res.json({ ok: true, ...publicControlStatus(status) });
  } catch (error) {
    next(normalizeControlError(error));
  }
});

app.post("/api/characters/:characterID/control/claim", async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const result = await store.claimCharacterControl(
      req.account.accountID,
      characterID,
      req.webSessionID,
    );
    if (!result) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    leaseStore.put(
      req.webSessionID,
      req.account.accountID,
      characterID,
      {
        ...result.credentials,
        leaseExpiresAt: result.control.leaseExpiresAt,
      },
    );
    res.json({ ok: true, ...publicControlStatus(result.control) });
  } catch (error) {
    next(normalizeControlError(error));
  }
});

app.post("/api/characters/:characterID/control/renew", async (req, res, next) => {
  const characterID = Number(req.params.characterID || 0);
  try {
    const character = await store.getCharacterForAccount(req.account.accountID, characterID);
    if (!character) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    const credentials = leaseStore.get(req.webSessionID, characterID);
    if (!credentials || credentials.accountID !== Number(req.account.accountID)) {
      next(missingLocalLeaseError(req.webSessionID, characterID));
      return;
    }
    const control = await store.renewCharacterControl(
      req.account.accountID,
      characterID,
      req.webSessionID,
      credentials,
    );
    if (!control) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    leaseStore.put(
      req.webSessionID,
      req.account.accountID,
      characterID,
      {
        ...credentials,
        leaseExpiresAt: control.leaseExpiresAt,
      },
    );
    res.json({ ok: true, ...publicControlStatus(control) });
  } catch (error) {
    if (error && (error.code === "CHARACTER_LEASE_EXPIRED" || error.code === "CHARACTER_LEASE_INVALID")) {
      leaseStore.remove(req.webSessionID, characterID);
    }
    next(normalizeControlError(error));
  }
});

app.post("/api/characters/:characterID/control/release", async (req, res, next) => {
  const characterID = Number(req.params.characterID || 0);
  try {
    const character = await store.getCharacterForAccount(req.account.accountID, characterID);
    if (!character) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    const credentials = leaseStore.get(req.webSessionID, characterID);
    if (!credentials || credentials.accountID !== Number(req.account.accountID)) {
      next(missingLocalLeaseError(req.webSessionID, characterID));
      return;
    }
    const control = await store.releaseCharacterControl(
      req.account.accountID,
      characterID,
      req.webSessionID,
      credentials,
    );
    if (!control) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    leaseStore.remove(req.webSessionID, characterID);
    res.json({ ok: true, ...publicControlStatus(control) });
  } catch (error) {
    if (error && (error.code === "CHARACTER_LEASE_EXPIRED" || error.code === "CHARACTER_LEASE_INVALID")) {
      leaseStore.remove(req.webSessionID, characterID);
    }
    next(normalizeControlError(error));
  }
});

app.get("/api/characters/:characterID/pi", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = await store.getPlanetDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, stateVersion: dashboard.stateVersion, dashboard });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:characterID/pi/restart", async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const command = readClientCommandMetadata(req.body);
    const payload = readPlanetRestartPayload(req.body);
    const dashboard = await store.restartExtractors(
      req.account.accountID,
      characterID,
      {
        planetID: payload.planetID,
        commandID: command.commandID,
        expectedStateVersion: command.expectedStateVersion,
        controllerID: req.webSessionID,
      },
    );
    if (!dashboard) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    res.json({ ok: true, stateVersion: dashboard.stateVersion, dashboard });
  } catch (error) {
    next(normalizeCommandError(error));
  }
});

app.get("/api/characters/:characterID/market", async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const character = await store.getCharacterForAccount(req.account.accountID, characterID);
    if (!character) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    const dashboard = await market.getMarketOverview(character.regionID);
    res.json({
      ok: true,
      character,
      dashboard,
    });
  } catch (error) {
    next(error);
  }
});

app.use(config.iconCacheUrlPath, express.static(config.iconCacheDir, {
  fallthrough: false,
  immutable: true,
  maxAge: "30d",
}));
app.use(express.static(path.join(config.repoRoot, "public")));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(config.repoRoot, "public", "index.html"));
});

app.use((error, req, res, next) => {
  void next;
  errorLogger(error);
  const statusCode =
    Number.isFinite(error && error.statusCode) && error.statusCode >= 400
      ? error.statusCode
      : 500;
  res.status(statusCode).json({
    ok: false,
    error: error && error.code ? error.code : error.message || "SERVER_ERROR",
    message: error && error.message ? error.message : "Server error",
  });
});

return app;
}

function startServer(options = {}) {
  const appToStart = options.app || createApp(options);
  const host = options.host || config.host;
  const port = options.port === undefined ? config.port : Number(options.port);
  const server = http.createServer(appToStart);
  const characterEventProxy = createCharacterEventProxy({
    ...(appToStart.locals.characterEventProxyOptions || {}),
    ...(options.characterEventProxyOptions || {}),
  });
  characterEventProxy.attach(server);
  Object.defineProperty(server, "characterEventProxy", {
    configurable: false,
    enumerable: false,
    value: characterEventProxy,
    writable: false,
  });
  server.listen(port, host, () => {
    const address = server.address();
    const activePort = address && typeof address === "object" ? address.port : port;
    if (options.silent !== true) {
      console.log(`EveJS Web POC listening on http://${host}:${activePort}`);
      console.log(`Using EveJS gateway: ${process.env.EVEJS_GATEWAY_URL || "http://127.0.0.1:26002/_evejs-web/v1"}`);
    }
  });
  return server;
}

const app = createApp();
const server = require.main === module ? startServer({ app }) : null;

module.exports = {
  app,
  createApp,
  server,
  startServer,
};
