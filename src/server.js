"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const eveStore = require("./eveStore");
const marketClient = require("./marketClient");
const webAuth = require("./webAuth");
const config = require("./config");

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

async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = webAuth.verifySessionToken(cookies[config.sessionCookieName]);
  if (!payload) {
    res.status(401).json({ ok: false, error: "AUTH_REQUIRED" });
    return;
  }

  try {
    const account = await eveStore.getAccount(payload.username);
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
  } catch (error) {
    next(error);
  }
}

async function blockOnlineCharacterPost(req, res, next) {
  if (req.method !== "POST") {
    next();
    return;
  }

  const characterID = Number(req.params.characterID || 0);
  if (!characterID) {
    res.status(400).json({ ok: false, error: "INVALID_CHARACTER" });
    return;
  }

  try {
    const status = await eveStore.getCharacterStatus(req.account.accountID, characterID);
    if (!status) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }

    if (status.online === true) {
      res.status(409).json({
        ok: false,
        error: "CHARACTER_ONLINE",
        message: "Character is currently logged in. Log out of the game before making changes from the companion.",
      });
      return;
    }

    if (status.online !== false) {
      res.status(503).json({
        ok: false,
        error: "CHARACTER_STATUS_UNAVAILABLE",
        message: "Cannot confirm whether the character is online. EveJS must be reachable before the companion can write character data.",
      });
      return;
    }

    next();
  } catch (error) {
    if (error && error.name === "EveGatewayError") {
      res.status(503).json({
        ok: false,
        error: "CHARACTER_STATUS_UNAVAILABLE",
        message: "Cannot confirm whether the character is online. EveJS must be reachable before the companion can write character data.",
      });
      return;
    }
    next(error);
  }
}

app.get("/api/health", async (req, res) => {
  try {
    const storeStatus = await eveStore.getStatus();
    res.json({
      ok: true,
      eveRoot: config.eveRoot,
      webUsersConfigured: webAuth.countConfiguredUsers(),
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
    const account = await eveStore.getAccount(username);
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
      characters: await eveStore.listCharactersForAccount(account.accountID),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, async (req, res, next) => {
  try {
  res.json({
    ok: true,
    account: publicAccount(req.account),
    characters: await eveStore.listCharactersForAccount(req.account.accountID),
  });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters", requireAuth, async (req, res, next) => {
  try {
  res.json({
    ok: true,
    characters: await eveStore.listCharactersForAccount(req.account.accountID),
  });
  } catch (error) {
    next(error);
  }
});

app.use("/api/characters/:characterID", requireAuth, blockOnlineCharacterPost);

app.get("/api/characters/:characterID/skills", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = await eveStore.getSkillDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:characterID/skills/queue", async (req, res, next) => {
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

app.get("/api/characters/:characterID/overview", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const overview = await eveStore.getCharacterOverview(req.account.accountID, characterID);
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
  const dashboard = await eveStore.getInventoryDashboard(req.account.accountID, characterID);
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
  const dashboard = await eveStore.getIndustryDashboard(req.account.accountID, characterID);
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

app.get("/api/characters/:characterID/pi", async (req, res, next) => {
  try {
  const characterID = Number(req.params.characterID || 0);
  const dashboard = await eveStore.getPlanetDashboard(req.account.accountID, characterID);
  if (!dashboard) {
    res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, dashboard });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:characterID/pi/restart", async (req, res, next) => {
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

app.get("/api/characters/:characterID/market", async (req, res, next) => {
  try {
    const characterID = Number(req.params.characterID || 0);
    const character = await eveStore.getCharacterForAccount(req.account.accountID, characterID);
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
  console.log(`Using EveJS gateway: ${process.env.EVEJS_GATEWAY_URL || "http://127.0.0.1:26002/_evejs-web/v1"}`);
});

module.exports = {
  app,
  server,
};
