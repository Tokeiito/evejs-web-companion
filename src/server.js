"use strict";

const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const eveStore = require("./eveStore");
const eveGatewayClient = require("./eveGatewayClient");
const marketClient = require("./marketClient");
const webAuth = require("./webAuth");
const staticDataModule = require("./staticData");
const config = require("./config");
const { createBrowserLeaseStore } = require("./browserLeaseStore");
const { createCharacterEventProxy } = require("./characterEventProxy");

function createApp(options = {}) {
const app = express();
const store = options.eveStore || eveStore;
const gateway = options.eveGatewayClient || eveGatewayClient;
const market = options.marketClient || marketClient;
const auth = options.webAuth || webAuth;
const staticData = options.staticData || staticDataModule;
const leaseStore = options.browserLeaseStore || createBrowserLeaseStore();
// Persistent-session handles (goal R2): webSessionID -> the opaque
// bridgeSessionID the gateway minted, held server-side only. The browser
// never sees the handle; it just gets its character/station state back.
const bridgeSessions = options.bridgeSessionStore || new Map();
const errorLogger = options.errorLogger || ((error) => console.error(error));
app.locals.browserLeaseStore = leaseStore;
app.locals.bridgeSessions = bridgeSessions;
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
    // Logging out closes the client: best-effort release of the persistent
    // bridge session so the character goes offline (the gateway TTL is the
    // backstop if this fails).
    try {
      await releaseHeldBridgeSession(payload.sessionID);
    } catch {
      bridgeSessions.delete(payload.sessionID);
    }
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
  // When this web session holds a persistent bridge session (goal R2), every
  // bridge call runs on that live session — one web login is one client
  // session, like retail. A browser-supplied bridgeSessionID is ignored; only
  // the server-held handle is ever forwarded.
  const heldBridgeSession = bridgeSessions.get(req.webSessionID) || null;
  try {
    const outcome = await gateway.callMethod(
      body.service,
      body.method,
      body.args,
      body.kwargs,
      { ...clientSessionFields, userid: Number(req.account.accountID) },
      heldBridgeSession ? heldBridgeSession.bridgeSessionID : undefined,
    );
    res.json({
      ok: true,
      service: outcome.service,
      method: outcome.method,
      result: outcome.result,
      notifications: outcome.notifications,
    });
  } catch (error) {
    // The gateway reaped or lost the persistent session (TTL expiry, retail
    // takeover, restart): drop the stale handle so the next call is stateless
    // and surface the typed error so the page can return to character select.
    if (heldBridgeSession && error && error.code === "SESSION_NOT_FOUND") {
      bridgeSessions.delete(req.webSessionID);
    }
    next(error);
  }
});

// Best-effort release of the bridge session a web session holds. Returns true
// when a held session existed. SESSION_NOT_FOUND from the gateway means the
// TTL (or a takeover) already disconnected it — the handle is just dropped.
async function releaseHeldBridgeSession(webSessionID) {
  const held = bridgeSessions.get(webSessionID);
  if (!held) {
    return false;
  }
  bridgeSessions.delete(webSessionID);
  try {
    await gateway.releaseBridgeSession(held.bridgeSessionID, {
      userid: Number(held.accountID),
    });
  } catch (error) {
    if (!(error && error.code === "SESSION_NOT_FOUND")) {
      throw error;
    }
  }
  return true;
}

// Read-only station identity from the local static reference data (allowed by
// the roadmap: names/SDE stay client-local, exactly as the retail client
// resolves station names from its static DB).
function buildStationStatic(stationID) {
  const numericStationID = Number(stationID) || 0;
  if (numericStationID <= 0) {
    return null;
  }
  const record = staticData.getStation(numericStationID) || {};
  const stationTypeID = Number(record.stationTypeID) || null;
  return {
    stationID: numericStationID,
    stationName: String(record.stationName || `Station ${numericStationID}`),
    solarSystemName: String(record.solarSystemName || ""),
    regionName: String(record.regionName || ""),
    stationTypeID,
    stationTypeName: stationTypeID ? staticData.getTypeName(stationTypeID) : null,
    operationID: Number(record.operationID) || null,
    security: Number(record.security) || null,
  };
}

// Select a character onto a persistent browser-backed session (goal R2): the
// BFF forwards the retail tuple SelectCharacterID(charID, secondChoiceID,
// skipTutorial) to the gateway's session/select route, pins the identity to
// the signed login session, and keeps the returned bridgeSessionID
// server-side in its own session store — it must never reach browser JS.
app.post("/api/bridge/select", requireAuth, async (req, res, next) => {
  const characterID = Number(req.body && req.body.characterID || 0);
  try {
    if (!Number.isSafeInteger(characterID) || characterID <= 0) {
      res.status(400).json({
        ok: false,
        error: "INVALID_CHARACTER",
        message: "A positive characterID is required.",
      });
      return;
    }
    const character = await store.getCharacterForAccount(
      req.account.accountID,
      characterID,
    );
    if (!character) {
      res.status(404).json({ ok: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    // One client session per web login: switching characters releases the
    // previous persistent session (retail semantics live on the gateway side;
    // the handler's own refusals pass through as CALL_REFUSED).
    await releaseHeldBridgeSession(req.webSessionID);
    const outcome = await gateway.selectCharacter(
      [characterID, null, true],
      null,
      {
        userid: Number(req.account.accountID),
        userName: String(req.account.username || ""),
      },
    );
    bridgeSessions.set(req.webSessionID, {
      bridgeSessionID: outcome.bridgeSessionID,
      characterID: Number(outcome.session.characterID) || characterID,
      accountID: Number(req.account.accountID),
      // R3: the docked-entry state the page needs to address inventories/ships
      // by their game IDs, plus the server-held bound-object handles keyed by a
      // semantic key (hangar/cargo/ship). Handles live here only — never in
      // browser JS — exactly like the bridgeSessionID.
      stationID: Number(outcome.session.stationID) || null,
      activeShipID: Number(outcome.session.shipID) || null,
      boundHandles: new Map(),
    });
    res.json({
      ok: true,
      character: {
        characterID: Number(outcome.session.characterID) || characterID,
        characterName: String(outcome.session.characterName || ""),
        stationID: outcome.session.stationID === undefined
          ? null
          : outcome.session.stationID,
        structureID: outcome.session.structureID === undefined
          ? null
          : outcome.session.structureID,
        solarSystemID: outcome.session.solarSystemID === undefined
          ? null
          : outcome.session.solarSystemID,
        corporationID: outcome.session.corporationID === undefined
          ? null
          : outcome.session.corporationID,
      },
      station: buildStationStatic(outcome.session.stationID),
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

// Release the persistent session this web login holds (character goes offline
// through the same disconnect path a retail socket close runs).
app.post("/api/bridge/release", requireAuth, async (req, res, next) => {
  try {
    const released = await releaseHeldBridgeSession(req.webSessionID);
    res.json({ ok: true, released });
  } catch (error) {
    next(error);
  }
});

// --- R3 Inventory & Ship (bound-object bridge) -----------------------------
// The browser refers to inventories and ships by their GAME IDs; the BFF maps
// those to bound-object handles it holds server-side and drives the retail
// two-step (bind then bound method) on the gateway. Handles never reach the
// browser. Wire contract: docs/bridge-wire-contract.md.

const ITEM_FLAG_HANGAR = 4;
const ITEM_FLAG_CARGO_HOLD = 5;
// A placeholder groupStation bind tuple for ship.MachoBindObject; EveJS's ship
// bind mints an OID and ignores bindParams (the retail moniker is
// Moniker('ship',(stationID,groupStation))).
const SHIP_BIND_GROUP_STATION = 5;

function requireHeldBridgeSession(req, res) {
  const held = bridgeSessions.get(req.webSessionID) || null;
  if (!held) {
    res.status(409).json({
      ok: false,
      error: "NO_LIVE_SESSION",
      message: "No character is online; select a character first.",
    });
    return null;
  }
  return held;
}

// Bind spec factories for the semantic targets the page addresses.
function hangarBindSpec(held) {
  return {
    key: `hangar:${held.stationID}`,
    service: "invbroker",
    method: "GetInventory",
    args: [held.stationID],
    kwargs: null,
  };
}

function cargoBindSpec(held, shipID) {
  return {
    key: `cargo:${shipID}`,
    service: "invbroker",
    method: "GetInventoryFromId",
    args: [shipID],
    kwargs: { passive: 0 },
  };
}

function shipBindSpec(held) {
  return {
    key: `ship:${held.stationID}`,
    service: "ship",
    method: "MachoBindObject",
    args: [[held.stationID, SHIP_BIND_GROUP_STATION]],
    kwargs: null,
  };
}

// R4 agent moniker: Moniker('agentMgr', agentID) via MachoBindObject. The bound
// agent is what DoAction / GetMission* / GetAgentLocationWrap dispatch on.
function agentBindSpec(agentID) {
  return {
    key: `agent:${agentID}`,
    service: "agentMgr",
    method: "MachoBindObject",
    args: [Number(agentID)],
    kwargs: null,
  };
}

// Dispatch a bound method, binding the target on demand and caching the bind
// under its semantic key. The cache holds the in-flight bind PROMISE, so the
// concurrent reads of one panel load (List + GetCapacity per container) share a
// single bind instead of racing to create duplicate OIDs. A reaped OID
// (BOUND_HANDLE_NOT_FOUND) rebinds once; a lost persistent session drops the
// whole held session (as /api/bridge/call).
async function boundCall(held, webSessionID, bindSpec, method, args, kwargs) {
  const sessionFields = { userid: held.accountID };
  function ensureHandle(forceRebind) {
    if (!forceRebind && held.boundHandles.has(bindSpec.key)) {
      return held.boundHandles.get(bindSpec.key);
    }
    const bindPromise = gateway
      .bindObject(
        bindSpec.service,
        bindSpec.method,
        bindSpec.args,
        bindSpec.kwargs,
        sessionFields,
        held.bridgeSessionID,
      )
      .then((bound) => bound.boundHandle)
      .catch((error) => {
        // Never cache a failed bind.
        if (held.boundHandles.get(bindSpec.key) === bindPromise) {
          held.boundHandles.delete(bindSpec.key);
        }
        throw error;
      });
    held.boundHandles.set(bindSpec.key, bindPromise);
    return bindPromise;
  }
  try {
    return await gateway.callBoundMethod(
      bindSpec.service,
      method,
      args,
      kwargs,
      sessionFields,
      held.bridgeSessionID,
      await ensureHandle(false),
    );
  } catch (error) {
    if (error && error.code === "SESSION_NOT_FOUND") {
      bridgeSessions.delete(webSessionID);
      throw error;
    }
    if (error && error.code === "BOUND_HANDLE_NOT_FOUND") {
      held.boundHandles.delete(bindSpec.key);
      return gateway.callBoundMethod(
        bindSpec.service,
        method,
        args,
        kwargs,
        sessionFields,
        held.bridgeSessionID,
        await ensureHandle(true),
      );
    }
    throw error;
  }
}

// Load the full Inventory & Ship panel: station hangar + active-ship cargo,
// each with its List and GetCapacity. The four reads are INDEPENDENT
// (Promise.allSettled) so one failed read never blanks the rest (R2's rule).
app.get("/api/bridge/inventory", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const shipID = held.activeShipID;
    const hangarSpec = hangarBindSpec(held);
    const cargoSpec = shipID ? cargoBindSpec(held, shipID) : null;
    const [hangarList, hangarCap, cargoList, cargoCap] = await Promise.allSettled([
      boundCall(held, req.webSessionID, hangarSpec, "List", [ITEM_FLAG_HANGAR], null),
      boundCall(held, req.webSessionID, hangarSpec, "GetCapacity", [ITEM_FLAG_HANGAR], null),
      cargoSpec
        ? boundCall(held, req.webSessionID, cargoSpec, "List", [ITEM_FLAG_CARGO_HOLD], null)
        : Promise.reject(Object.assign(new Error("No active ship."), { code: "NO_ACTIVE_SHIP" })),
      cargoSpec
        ? boundCall(held, req.webSessionID, cargoSpec, "GetCapacity", [ITEM_FLAG_CARGO_HOLD], null)
        : Promise.reject(Object.assign(new Error("No active ship."), { code: "NO_ACTIVE_SHIP" })),
    ]);

    // A lost live session can't be recovered by any read; surface it so the
    // page returns to character select.
    for (const settled of [hangarList, hangarCap, cargoList, cargoCap]) {
      if (settled.status === "rejected" && settled.reason && settled.reason.code === "SESSION_NOT_FOUND") {
        next(settled.reason);
        return;
      }
    }

    const settledCode = (settled) =>
      settled.status === "rejected"
        ? String((settled.reason && settled.reason.code) || "READ_FAILED")
        : null;
    const settledValue = (settled) =>
      settled.status === "fulfilled" ? settled.value.result : null;

    res.json({
      ok: true,
      stationID: held.stationID,
      activeShipID: shipID,
      hangar: {
        list: settledValue(hangarList),
        capacity: settledValue(hangarCap),
        error: settledCode(hangarList) || settledCode(hangarCap),
      },
      cargo: {
        shipID,
        list: settledValue(cargoList),
        capacity: settledValue(cargoCap),
        error: settledCode(cargoList) || settledCode(cargoCap),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Move one item hangar <-> active-ship cargo. The bound object is the
// DESTINATION; retail's Add(itemID, sourceLocationID, qty, flag) carries the
// source location and the destination flag.
app.post("/api/bridge/inventory/move", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemID = Number(body.itemID) || 0;
  const direction = String(body.direction || "");
  const qty = Number(body.qty);
  if (itemID <= 0 || (direction !== "toCargo" && direction !== "toHangar")) {
    res.status(400).json({ ok: false, error: "INVALID_MOVE", message: "itemID and a valid direction are required." });
    return;
  }
  const shipID = held.activeShipID;
  if (!shipID) {
    res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship to move cargo to or from." });
    return;
  }
  const kwargs = { flag: direction === "toCargo" ? ITEM_FLAG_CARGO_HOLD : ITEM_FLAG_HANGAR };
  if (Number.isSafeInteger(qty) && qty > 0) {
    kwargs.qty = qty;
  }
  const destSpec = direction === "toCargo" ? cargoBindSpec(held, shipID) : hangarBindSpec(held);
  const sourceLocationID = direction === "toCargo" ? held.stationID : shipID;
  try {
    const outcome = await boundCall(
      held,
      req.webSessionID,
      destSpec,
      "Add",
      [itemID, sourceLocationID],
      kwargs,
    );
    res.json({ ok: true, notifications: outcome.notifications });
  } catch (error) {
    next(error);
  }
});

// Stack all loose stacks in the hangar or the active-ship cargo.
app.post("/api/bridge/inventory/stack", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const target = String((req.body && req.body.target) || "");
  if (target !== "hangar" && target !== "cargo") {
    res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "target must be 'hangar' or 'cargo'." });
    return;
  }
  const shipID = held.activeShipID;
  if (target === "cargo" && !shipID) {
    res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship cargo to stack." });
    return;
  }
  const spec = target === "cargo" ? cargoBindSpec(held, shipID) : hangarBindSpec(held);
  const flag = target === "cargo" ? ITEM_FLAG_CARGO_HOLD : ITEM_FLAG_HANGAR;
  try {
    const outcome = await boundCall(held, req.webSessionID, spec, "StackAll", [flag], null);
    res.json({ ok: true, notifications: outcome.notifications });
  } catch (error) {
    next(error);
  }
});

// Board a ship sitting in the station hangar (the retail
// Moniker('ship',(stationID,groupStation)).Board(shipID, oldShipID)). On
// success the newly boarded ship becomes the active ship for cargo reads.
app.post("/api/bridge/ship/board", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const shipID = Number((req.body && req.body.shipID) || 0);
  if (shipID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_SHIP", message: "A positive shipID is required." });
    return;
  }
  try {
    const outcome = await boundCall(
      held,
      req.webSessionID,
      shipBindSpec(held),
      "Board",
      [shipID, held.activeShipID || null],
      null,
    );
    // The boarded ship is now active; cargo reads bind against it, and its
    // old cargo handle is stale.
    held.activeShipID = shipID;
    res.json({ ok: true, activeShipID: shipID, notifications: outcome.notifications });
  } catch (error) {
    next(error);
  }
});

// R4 Agents & Missions (agentMgr bridge). Agent list is a top-level read on the
// held session (retail agentMgr.GetAgents().Clone()); conversation, briefing,
// and journal use the bound agent (Moniker('agentMgr', agentID)). The browser
// addresses agents/missions by game ID; the BFF holds the agent bound handles.

// Dispatch a top-level (non-bound) call on the held live session. A lost
// persistent session drops the whole held session (as /api/bridge/call).
async function heldTopLevelCall(held, webSessionID, service, method, args, kwargs) {
  try {
    return await gateway.callMethod(
      service,
      method,
      args,
      kwargs,
      { userid: held.accountID },
      held.bridgeSessionID,
    );
  } catch (error) {
    if (error && error.code === "SESSION_NOT_FOUND") {
      bridgeSessions.delete(webSessionID);
    }
    throw error;
  }
}

// Decode agentMgr.GetAgents' marshaled Rowset (header + lines) into plain agent
// rows. Filtering to the docked station happens server-side: GetAgents returns
// the whole ~11k-agent roster, and the retail client itself filters by station
// client-side; the browser only ever needs the handful at Farmer's station.
function decodeStationAgents(result, stationID) {
  const dictEntries =
    result && result.args && Array.isArray(result.args.entries)
      ? result.args.entries
      : [];
  const header = (dictEntries.find(([key]) => key === "header") || [])[1];
  const lines = (dictEntries.find(([key]) => key === "lines") || [])[1];
  const fieldNames = header && Array.isArray(header.items) ? header.items : [];
  const rows = lines && Array.isArray(lines.items) ? lines.items : [];
  const indexOf = (name) => fieldNames.indexOf(name);
  const idx = {
    agentID: indexOf("agentID"),
    agentTypeID: indexOf("agentTypeID"),
    divisionID: indexOf("divisionID"),
    level: indexOf("level"),
    stationID: indexOf("stationID"),
    corporationID: indexOf("corporationID"),
    missionKind: indexOf("missionKind"),
    missionTypeLabel: indexOf("missionTypeLabel"),
  };
  const numericStationID = Number(stationID) || 0;
  const agents = [];
  for (const line of rows) {
    const values = line && Array.isArray(line.items) ? line.items : [];
    const rowStationID = Number(values[idx.stationID]) || null;
    if (numericStationID > 0 && rowStationID !== numericStationID) {
      continue;
    }
    agents.push({
      agentID: Number(values[idx.agentID]) || 0,
      agentTypeID: idx.agentTypeID >= 0 ? Number(values[idx.agentTypeID]) || null : null,
      divisionID: idx.divisionID >= 0 ? Number(values[idx.divisionID]) || null : null,
      level: idx.level >= 0 ? Number(values[idx.level]) || null : null,
      stationID: rowStationID,
      corporationID: idx.corporationID >= 0 ? Number(values[idx.corporationID]) || null : null,
      missionKind: idx.missionKind >= 0 ? String(values[idx.missionKind] || "") || null : null,
      missionTypeLabel:
        idx.missionTypeLabel >= 0 ? String(values[idx.missionTypeLabel] || "") || null : null,
    });
  }
  return agents.filter((agent) => agent.agentID > 0);
}

// List the agents at the docked station (retail agentMgr.GetAgents, filtered).
app.get("/api/bridge/agents", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "agentMgr",
      "GetAgents",
      [],
      null,
    );
    res.json({
      ok: true,
      stationID: held.stationID,
      agents: decodeStationAgents(outcome.result, held.stationID),
    });
  } catch (error) {
    next(error);
  }
});

// Drive the agent conversation: DoAction(actionID). actionID null opens the
// conversation; a server-assigned action token (from availableActions) requests
// / accepts / declines. The in-person accept is synchronous; a decline is a
// deferred outcome the gateway drives to completion (or refuses with a typed
// CALL_DEFERRED_UNSUPPORTED). The raw retail-shaped result is decoded browser
// side (web/src/bridge/agents.ts).
app.post("/api/bridge/agents/:agentID/action", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const agentID = Number(req.params.agentID) || 0;
  if (agentID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_AGENT", message: "A positive agentID is required." });
    return;
  }
  const rawActionID = req.body ? req.body.actionID : undefined;
  const actionID =
    rawActionID === undefined || rawActionID === null ? null : Number(rawActionID);
  if (actionID !== null && !Number.isSafeInteger(actionID)) {
    res.status(400).json({ ok: false, error: "INVALID_ACTION", message: "actionID must be an integer or null." });
    return;
  }
  try {
    const outcome = await boundCall(
      held,
      req.webSessionID,
      agentBindSpec(agentID),
      "DoAction",
      [actionID],
      null,
    );
    res.json({ ok: true, result: outcome.result, notifications: outcome.notifications });
  } catch (error) {
    next(error);
  }
});

// The mission briefing on the bound agent: header + objectives + agent location.
// The three reads are INDEPENDENT (Promise.allSettled) so one failure never
// blanks the rest; each carries its own error code. Raw results are decoded
// browser side.
app.get("/api/bridge/agents/:agentID/briefing", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const agentID = Number(req.params.agentID) || 0;
  if (agentID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_AGENT", message: "A positive agentID is required." });
    return;
  }
  try {
    const spec = agentBindSpec(agentID);
    const [briefing, objective, location] = await Promise.allSettled([
      boundCall(held, req.webSessionID, spec, "GetMissionBriefingInfo", [], null),
      boundCall(held, req.webSessionID, spec, "GetMissionObjectiveInfo", [], null),
      boundCall(held, req.webSessionID, spec, "GetAgentLocationWrap", [], null),
    ]);
    for (const settled of [briefing, objective, location]) {
      if (settled.status === "rejected" && settled.reason && settled.reason.code === "SESSION_NOT_FOUND") {
        next(settled.reason);
        return;
      }
    }
    const settledCode = (settled) =>
      settled.status === "rejected"
        ? String((settled.reason && settled.reason.code) || "READ_FAILED")
        : null;
    const settledValue = (settled) => (settled.status === "fulfilled" ? settled.value.result : null);
    res.json({
      ok: true,
      agentID,
      briefing: settledValue(briefing),
      objective: settledValue(objective),
      location: settledValue(location),
      errors: {
        briefing: settledCode(briefing),
        objective: settledCode(objective),
        location: settledCode(location),
      },
    });
  } catch (error) {
    next(error);
  }
});

// The mission journal (retail agentMgr.GetMyJournalDetails, top-level): active +
// offered missions for the character. Raw result decoded browser side.
app.get("/api/bridge/journal", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "agentMgr",
      "GetMyJournalDetails",
      [],
      null,
    );
    res.json({ ok: true, result: outcome.result });
  } catch (error) {
    next(error);
  }
});

// R6 courier-completion reward readout (inventory Step 12): the wallet / LP /
// standings pull reads a panel issues after Complete pays out. These are plain
// TOP-LEVEL server-tier reads on the held session (no bind). The mission
// journal (the fourth Step-12 read) has its own route (/api/bridge/journal) +
// slice, refreshed on the same Complete. The three reads are INDEPENDENT
// (Promise.allSettled) so one failed read never blanks the rest; each carries
// its own error code. Raw retail-shaped results decoded browser side
// (web/src/bridge/rewards.ts).
app.get("/api/bridge/rewards", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const [cash, lp, standings] = await Promise.allSettled([
      heldTopLevelCall(held, req.webSessionID, "account", "GetCashBalance", [0], null),
      heldTopLevelCall(
        held,
        req.webSessionID,
        "LPSvc",
        "GetAllMyCharacterWalletLPBalances",
        [],
        null,
      ),
      heldTopLevelCall(held, req.webSessionID, "standingMgr", "GetCharStandings", [], null),
    ]);
    // A lost live session can't be recovered by any read; surface it so the page
    // returns to character select (as every held call does).
    for (const settled of [cash, lp, standings]) {
      if (settled.status === "rejected" && settled.reason && settled.reason.code === "SESSION_NOT_FOUND") {
        next(settled.reason);
        return;
      }
    }
    const settledCode = (settled) =>
      settled.status === "rejected"
        ? String((settled.reason && settled.reason.code) || "READ_FAILED")
        : null;
    const settledValue = (settled) =>
      settled.status === "fulfilled" ? settled.value.result : null;
    res.json({
      ok: true,
      cash: settledValue(cash),
      lp: settledValue(lp),
      standings: settledValue(standings),
      errors: {
        cash: settledCode(cash),
        lp: settledCode(lp),
        standings: settledCode(standings),
      },
    });
  } catch (error) {
    next(error);
  }
});

// R5a flight (manually-stepped space movement): undock -> warp -> jump -> dock,
// each an explicit step the browser issues (no timer loop — the autopilot
// decide-loop is R5b). EveJS's space handlers stay authoritative for every
// move; the BFF only relays the atomic calls the retail client's client-side
// autopilot issues, holding the beyonce bound handle server-side. Movement
// refusals (scrambled, invalid target, docking-approach, lost control, ship
// destroyed) pass through as the handler's own CALL_REFUSED message so the page
// can surface a real reason — never a silent no-op or a fake success.

// beyonce remote park moniker: Moniker('beyonce', solarSystemID) via
// michelle.GetRemotePark(). Keyed by system so a jump (which changes the
// system) rebinds the park for the new system rather than reusing a stale OID.
const BEYONCE_BIND_GROUP = 5;
function parkBindSpec(solarSystemID) {
  return {
    key: `park:${solarSystemID}`,
    service: "beyonce",
    method: "MachoBindObject",
    args: [[Number(solarSystemID), BEYONCE_BIND_GROUP]],
    kwargs: null,
  };
}

// Read the held session's current flight status (location + ship movement
// state). A lost persistent session drops the held session (the page returns to
// character select), as with every held call.
async function readHeldFlight(held, webSessionID) {
  try {
    return await gateway.readFlightStatus(held.bridgeSessionID, {
      userid: held.accountID,
    });
  } catch (error) {
    if (error && error.code === "SESSION_NOT_FOUND") {
      bridgeSessions.delete(webSessionID);
    }
    throw error;
  }
}

function requireInSpace(res, flight) {
  if (!flight || flight.inSpace !== true) {
    res.status(409).json({
      ok: false,
      error: "NOT_IN_SPACE",
      message: "The ship is not in space; undock first.",
    });
    return false;
  }
  return true;
}

// Current flight status snapshot for the page's status readout + "Refresh
// flight status" button.
app.get("/api/bridge/flight/status", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const outcome = await readHeldFlight(held, req.webSessionID);
    res.json({ ok: true, flight: outcome.flight, notifications: outcome.notifications });
  } catch (error) {
    next(error);
  }
});

// Undock: ship.Undock(shipID, ignoreContraband, onlineModules=[]) — a top-level
// call on the docked session (Handle_Undock resolves the ship + attaches the
// session to space). onlineModules is a kwarg (never positional).
app.post("/api/bridge/flight/undock", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (before.flight.inSpace === true) {
      res.status(409).json({
        ok: false,
        error: "ALREADY_IN_SPACE",
        message: "The ship is already in space.",
      });
      return;
    }
    const shipID = Number(before.flight.shipID) || Number(held.activeShipID) || 0;
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "ship",
      "Undock",
      [shipID, false],
      { onlineModules: [] },
    );
    const after = await readHeldFlight(held, req.webSessionID);
    res.json({
      ok: true,
      flight: after.flight,
      notifications: [...outcome.notifications, ...after.notifications],
    });
  } catch (error) {
    next(error);
  }
});

// Warp to a chosen gate/celestial through the bound park:
// beyonce.CmdWarpToStuffAutopilot(destinationID).
app.post("/api/bridge/flight/warp", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const destinationID = Number(req.body && req.body.destinationID) || 0;
  if (destinationID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "A positive destinationID is required." });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const outcome = await boundCall(
      held,
      req.webSessionID,
      parkBindSpec(before.flight.solarSystemID),
      "CmdWarpToStuffAutopilot",
      [destinationID],
      null,
    );
    const after = await readHeldFlight(held, req.webSessionID);
    res.json({
      ok: true,
      result: outcome.result,
      flight: after.flight,
      notifications: [...outcome.notifications, ...after.notifications],
    });
  } catch (error) {
    next(error);
  }
});

// Jump through an NPC stargate: beyonce.CmdStargateJump(fromGateID, toGateID,
// shipID). The system transition completes after a short handoff delay; the
// page polls flight status to see the new system.
app.post("/api/bridge/flight/jump", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const fromGateID = Number(req.body && req.body.fromGateID) || 0;
  const toGateID = Number(req.body && req.body.toGateID) || 0;
  if (fromGateID <= 0 || toGateID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_GATE", message: "Positive fromGateID and toGateID are required." });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const shipID = Number(before.flight.shipID) || 0;
    const outcome = await boundCall(
      held,
      req.webSessionID,
      parkBindSpec(before.flight.solarSystemID),
      "CmdStargateJump",
      [fromGateID, toGateID, shipID],
      null,
    );
    const after = await readHeldFlight(held, req.webSessionID);
    res.json({
      ok: true,
      result: outcome.result,
      flight: after.flight,
      notifications: [...outcome.notifications, ...after.notifications],
    });
  } catch (error) {
    next(error);
  }
});

// Dock at the destination station: beyonce.CmdDock(stationID, shipID). If the
// ship is out of docking range the handler refuses with a DockingApproach user
// error (surfaced as the reason); on the live server the sim completes the
// pending dock, so the page polls flight status to see the docked state.
app.post("/api/bridge/flight/dock", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const stationID = Number(req.body && req.body.stationID) || 0;
  if (stationID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_STATION", message: "A positive stationID is required." });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const shipID = Number(before.flight.shipID) || 0;
    const outcome = await boundCall(
      held,
      req.webSessionID,
      parkBindSpec(before.flight.solarSystemID),
      "CmdDock",
      [stationID, shipID],
      null,
    );
    const after = await readHeldFlight(held, req.webSessionID);
    res.json({
      ok: true,
      result: outcome.result,
      flight: after.flight,
      notifications: [...outcome.notifications, ...after.notifications],
    });
  } catch (error) {
    next(error);
  }
});

// Approach a gate/target at full speed — the autopilot's close-the-gap step:
// beyonce.CmdSetSpeedFraction(1.0) + CmdFollowBall(destinationID, 0.0), exactly
// as autopilot.py does. An autopilot-warp lands the ship NEAR a gate but often
// outside jump range, so CmdStargateJump refuses NotWithinMaxJumpDist until the
// ship follows the gate into range. (Both methods were allowlisted in R5a.)
app.post("/api/bridge/flight/approach", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const destinationID = Number(req.body && req.body.destinationID) || 0;
  if (destinationID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "A positive destinationID is required." });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const spec = parkBindSpec(before.flight.solarSystemID);
    await boundCall(held, req.webSessionID, spec, "CmdSetSpeedFraction", [1.0], null);
    const outcome = await boundCall(held, req.webSessionID, spec, "CmdFollowBall", [destinationID, 0.0], null);
    const after = await readHeldFlight(held, req.webSessionID);
    res.json({
      ok: true,
      result: outcome.result,
      flight: after.flight,
      notifications: [...outcome.notifications, ...after.notifications],
    });
  } catch (error) {
    next(error);
  }
});

// --- R5b Travel: client-side route solver static data ----------------------
// The browser autopilot's route solver is client-side (roadmap §7 / G2): the
// system-adjacency graph it runs BFS over is read-only static reference data
// (like station names), served here from src/staticData.js. This is NOT a
// gateway/bridge call and NOT a server-side travel job — no live bridge session
// is touched. Requires the web login session (as every /api route does).
app.get("/api/map/graph", requireAuth, async (req, res, next) => {
  try {
    const graph = staticData.getSolarSystemGraph();
    res.json({
      ok: true,
      source: "static-data",
      systemCount: Object.keys(graph.systems).length,
      edgeCount: graph.edges.length,
      systems: graph.systems,
      edges: graph.edges,
    });
  } catch (error) {
    next(error);
  }
});

// Resolve a picked destination (a courier destination is a station; the route
// solver works on systems) to its solar system, from static reference data —
// the same client-local resolution the select route does for station identity.
app.get("/api/map/resolve/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id) || 0;
    if (id <= 0) {
      res.status(400).json({ ok: false, error: "INVALID_ID", message: "A positive id is required." });
      return;
    }
    const station = staticData.getStation(id);
    if (station) {
      const solarSystemID = Number(station.solarSystemID) || null;
      res.json({
        ok: true,
        id,
        kind: "station",
        stationID: id,
        stationName: String(station.stationName || `Station ${id}`),
        solarSystemID,
        systemName: solarSystemID ? staticData.getSolarSystemName(solarSystemID) : null,
      });
      return;
    }
    const system = staticData.getSolarSystem(id);
    if (system) {
      res.json({
        ok: true,
        id,
        kind: "system",
        stationID: null,
        stationName: null,
        solarSystemID: id,
        systemName: staticData.getSolarSystemName(id),
      });
      return;
    }
    res.json({ ok: true, id, kind: "unknown", stationID: null, stationName: null, solarSystemID: null, systemName: null });
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
