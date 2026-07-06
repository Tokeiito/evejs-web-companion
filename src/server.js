"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const eveStore = require("./eveStore");
const marketClient = require("./marketClient");
const webAuth = require("./webAuth");

const app = express();
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

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = webAuth.verifySessionToken(cookies[config.sessionCookieName]);
  if (!payload) {
    res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
    return;
  }

  const account = eveStore.getAccount(payload.username);
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
  next();
}

app.get("/api/health", (req, res) => {
  try {
    const storeStatus = eveStore.getStatus();
    res.json({
      ok: true,
      eveRoot: config.eveRoot,
      gamestorePath: config.gamestorePath,
      webUsersConfigured: webAuth.countConfiguredUsers(),
      store: storeStatus,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      gamestorePath: config.gamestorePath,
    });
  }
});

app.post("/api/login", (req, res) => {
  const username = String(req.body && req.body.username || "").trim();
  const password = String(req.body && req.body.password || "");
  const account = eveStore.getAccount(username);
  if (!account || account.banned) {
    res.status(401).json({ ok: false, error: "INVALID_LOGIN" });
    return;
  }

  const verification = webAuth.verifyWebPassword(username, password);
  if (!verification.ok) {
    const status = verification.reason === "WEB_PASSWORD_NOT_SET" ? 428 : 401;
    res.status(status).json({ ok: false, error: verification.reason });
    return;
  }

  if (Number(verification.user.eveAccountID) !== Number(account.accountID)) {
    res.status(409).json({ ok: false, error: "WEB_ACCOUNT_MAPPING_MISMATCH" });
    return;
  }

  setSessionCookie(res, webAuth.createSessionToken(account));
  res.json({
    ok: true,
    account: publicAccount(account),
    characters: eveStore.listCharactersForAccount(account.accountID),
  });
});

app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({
    ok: true,
    account: publicAccount(req.account),
    characters: eveStore.listCharactersForAccount(req.account.accountID),
  });
});

app.get("/api/characters", requireAuth, (req, res) => {
  res.json({
    ok: true,
    characters: eveStore.listCharactersForAccount(req.account.accountID),
  });
});

app.get("/api/characters/:characterID/skills", requireAuth, (req, res) => {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = eveStore.getSkillDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
});

app.post("/api/characters/:characterID/skills/queue", requireAuth, async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const dashboard = await eveStore.saveSkillQueue(
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
    next(error);
  }
});

app.get("/api/characters/:characterID/overview", requireAuth, (req, res) => {
  const characterID = Number(req.params.characterID || 0);
  const overview = eveStore.getCharacterOverview(req.account.accountID, characterID);
  if (!overview) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, overview });
});

app.get("/api/characters/:characterID/inventory", requireAuth, (req, res) => {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = eveStore.getInventoryDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
});

app.get("/api/characters/:characterID/industry", requireAuth, (req, res) => {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = eveStore.getIndustryDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
});

app.get("/api/characters/:characterID/status", requireAuth, async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const status = await eveStore.getCharacterStatus(req.account.accountID, characterID);
    if (!status) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    res.json({ ok: true, ...status });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters/:characterID/pi", requireAuth, (req, res) => {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = eveStore.getPlanetDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
});

app.post("/api/characters/:characterID/pi/restart", requireAuth, async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const planetID = Number(req.body && req.body.planetID) || 0;
    const dashboard = await eveStore.restartExtractors(
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
    next(error);
  }
});

app.get("/api/characters/:characterID/market", requireAuth, async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const character = eveStore.getCharacterForAccount(req.account.accountID, characterID);
    if (!character) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    const dashboard = await marketClient.getMarketOverview(character.regionID);
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
  console.error(error);
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

const server = app.listen(config.port, config.host, () => {
  console.log(`EveJS Web POC listening on http://${config.host}:${config.port}`);
  console.log(`Reading EveJS gamestore: ${config.gamestorePath}`);
});

module.exports = {
  app,
  server,
};
