"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const eveStore = require("./eveStore");
const marketClient = require("./marketClient");
const webAuth = require("./webAuth");
const config = require("./config");
const { createBrowserLeaseStore } = require("./browserLeaseStore");

function createApp(options = {}) {
const app = express();
const store = options.eveStore || eveStore;
const market = options.marketClient || marketClient;
const auth = options.webAuth || webAuth;
const leaseStore = options.browserLeaseStore || createBrowserLeaseStore();
const errorLogger = options.errorLogger || ((error) => console.error(error));
app.locals.browserLeaseStore = leaseStore;
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

function sendControlStateConflict(res, status) {
  if (status.controlState === "retail_client") {
    res.status(409).json({
      ok: false,
      error: "CHARACTER_CONTROL_RETAIL_CLIENT",
      message: "Character is controlled by a retail client and must be offline for this mutation.",
    });
    return true;
  }
  if (status.controlState === "browser_pilot") {
    res.status(409).json({
      ok: false,
      error: "CHARACTER_CONTROL_BROWSER_PILOT",
      message: "Character is controlled by a browser pilot and must be offline for this mutation.",
    });
    return true;
  }
  return false;
}

async function requireOfflineCharacter(req, res, next) {
  const characterID = Number(req.params.characterID || 0);
  if (!characterID) {
    res.status(400).json({ ok: false, error: "INVALID_CHARACTER" });
    return;
  }

  try {
    const status = await store.getCharacterStatus(req.account.accountID, characterID);
    if (!status) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }

    if (sendControlStateConflict(res, status)) {
      return;
    }

    if (status.controlState !== "offline" || status.online !== false) {
      next(controlUnavailableError());
      return;
    }

    next();
  } catch (error) {
    next(normalizeControlError(error));
  }
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

app.post("/api/login", async (req, res, next) => {
  const username = String(req.body && req.body.username || "").trim();
  const password = String(req.body && req.body.password || "");
  try {
    const account = await store.getAccount(username);
    if (!account || account.banned) {
      res.status(401).json({ ok: false, error: "INVALID_LOGIN" });
      return;
    }

    const verification = auth.verifyWebPassword(username, password);
    if (!verification.ok) {
      const status = verification.reason === "WEB_PASSWORD_NOT_SET" ? 428 : 401;
      res.status(status).json({ ok: false, error: verification.reason });
      return;
    }

    if (Number(verification.user.eveAccountID) !== Number(account.accountID)) {
      res.status(409).json({ ok: false, error: "WEB_ACCOUNT_MAPPING_MISMATCH" });
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

app.use("/api/characters/:characterID", requireAuth);

app.get("/api/characters/:characterID/skills", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = await store.getSkillDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:characterID/skills/queue", requireOfflineCharacter, async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const dashboard = await store.saveSkillQueue(
      req.account.accountID,
      characterID,
      Array.isArray(req.body && req.body.entries) ? req.body.entries : [],
      {
        activate: !req.body || req.body.activate !== false,
      },
    );
    if (!dashboard) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    res.json({ ok: true, dashboard });
  } catch (error) {
    next(normalizeControlError(error));
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
  res.json({ ok: true, dashboard });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:characterID/pi/restart", requireOfflineCharacter, async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const planetID = Number(req.body && req.body.planetID) || 0;
    const dashboard = await store.restartExtractors(
      req.account.accountID,
      characterID,
      { planetID },
    );
    if (!dashboard) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    res.json({ ok: true, dashboard });
  } catch (error) {
    next(normalizeControlError(error));
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
  const server = appToStart.listen(port, host, () => {
    const address = server.address();
    const activePort = address && typeof address === "object" ? address.port : port;
    console.log(`EveJS Web POC listening on http://${host}:${activePort}`);
    console.log(`Using EveJS gateway: ${process.env.EVEJS_GATEWAY_URL || "http://127.0.0.1:26002/_evejs-web/v1"}`);
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
