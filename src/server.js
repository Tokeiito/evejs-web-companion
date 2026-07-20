"use strict";

const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
const eveStore = require("./eveStore");
const eveGatewayClient = require("./eveGatewayClient");
const webAuth = require("./webAuth");
const staticDataModule = require("./staticData");
const config = require("./config");

function createApp(options = {}) {
const app = express();
const store = options.eveStore || eveStore;
const gateway = options.eveGatewayClient || eveGatewayClient;
const auth = options.webAuth || webAuth;
const staticData = options.staticData || staticDataModule;
// Persistent-session handles (goal R2): webSessionID -> the opaque
// bridgeSessionID the gateway minted, held server-side only. The browser
// never sees the handle; it just gets its character/station state back.
const bridgeSessions = options.bridgeSessionStore || new Map();
const errorLogger = options.errorLogger || ((error) => console.error(error));
app.locals.bridgeSessions = bridgeSessions;
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
    // Sync held station/ship to the live position first, so the hangar/cargo
    // binds target the CURRENT station + active ship after a new dock, not the
    // select-time ones.
    await readHeldFlight(held, req.webSessionID);
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
    // Sync the held station to the character's live position first, so a dock
    // at a new station (autopilot arrival) lists THAT station's agents rather
    // than the select-time station's.
    await readHeldFlight(held, req.webSessionID);
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

// --- R7 Local + Corp chat ---------------------------------------------------
// The browser reads a channel's member roster + recent backlog and sends
// messages to Local or Corp on the held session. Chat delivery bypasses the
// notification drain, so READ is a backlog poll: the panel polls /chat/read on
// a modest interval while it is open, and stops when it closes. The BFF holds
// the bridgeSessionID server-side (never in browser JS); the browser addresses
// channels by name only. Wire contract: docs/bridge-wire-contract.md.

const CHAT_CHANNELS = new Set(["local", "corp"]);

function normalizeChatChannel(res, value) {
  const channel = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!CHAT_CHANNELS.has(channel)) {
    res.status(400).json({
      ok: false,
      error: "INVALID_CHANNEL",
      message: "channel must be 'local' or 'corp'.",
    });
    return null;
  }
  return channel;
}

app.get("/api/bridge/chat/:channel", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const channel = normalizeChatChannel(res, req.params.channel);
  if (!channel) {
    return;
  }
  try {
    const outcome = await gateway.readChat(
      held.bridgeSessionID,
      channel,
      { userid: held.accountID },
      { limit: Number(req.query.limit) || undefined },
    );
    res.json({ ok: true, chat: outcome.chat, notifications: outcome.notifications });
  } catch (error) {
    if (error && error.code === "SESSION_NOT_FOUND") {
      bridgeSessions.delete(req.webSessionID);
    }
    next(error);
  }
});

app.post("/api/bridge/chat/:channel/send", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const channel = normalizeChatChannel(res, req.params.channel);
  if (!channel) {
    return;
  }
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  if (!message.trim()) {
    res.status(400).json({
      ok: false,
      error: "EMPTY_MESSAGE",
      message: "message must be a non-empty string.",
    });
    return;
  }
  try {
    const outcome = await gateway.sendChat(held.bridgeSessionID, channel, message, {
      userid: held.accountID,
    });
    res.json({ ok: true, chat: outcome.chat, notifications: outcome.notifications });
  } catch (error) {
    if (error && error.code === "SESSION_NOT_FOUND") {
      bridgeSessions.delete(req.webSessionID);
    }
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
    const outcome = await gateway.readFlightStatus(held.bridgeSessionID, {
      userid: held.accountID,
    });
    // Keep the held session's station in sync with the character's LIVE
    // position. held.stationID is otherwise set only at select, so after the
    // ship docks somewhere new (e.g. an autopilot arrival) the station-scoped
    // reads (agents, inventory bind) would still target the select-time station
    // until a full re-login. Adopt a real docked station here; leave the last
    // station in place while in space (agents/inventory are docked-only). The
    // active ship is owned by the board flow, so it is not synced here.
    const flight = outcome && outcome.flight ? outcome.flight : {};
    if (flight.docked === true && Number(flight.stationID) > 0) {
      held.stationID = Number(flight.stationID);
    }
    return outcome;
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

// Read-only static station identity by ID (goal R6b): the same client-local
// resolution the select route returns for the docked station, exposed so the
// web app can refresh the Station panel's identity (name / system / region /
// type / security) after the docked station changes (autopilot arrival, manual
// dock) without a full page reload. Read-only static reference data like
// /api/map/graph and /api/map/resolve — NOT a gateway/bridge call.
app.get("/api/map/station/:id", requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id) || 0;
    if (id <= 0) {
      res.status(400).json({ ok: false, error: "INVALID_ID", message: "A positive id is required." });
      return;
    }
    // Only resolve a real station record (buildStationStatic otherwise returns a
    // "Station <id>" fallback for any positive ID); an unknown ID is a 404.
    if (!staticData.getStation(id)) {
      res.status(404).json({ ok: false, error: "STATION_NOT_FOUND" });
      return;
    }
    res.json({ ok: true, source: "static-data", station: buildStationStatic(id) });
  } catch (error) {
    next(error);
  }
});

// Map name search (goal R7a): let a player set a travel destination by NAME
// instead of a raw EVE ID. Searches the static solar-system + station tables by
// name and returns capped matches the client hands to startRoute (the R5b route
// solver + autopilot). Read-only static reference data — like /api/map/graph and
// /api/agents/find, NOT a gateway/bridge call. Filters by q (min 2 chars) and an
// optional kind (system|station; default both); caps server-side (default 50 /
// max 200) so a broad query never dumps the whole table.
app.get("/api/map/find", requireAuth, async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const result = staticData.findMapLocations({ q, kind, limit });
    res.json({
      ok: true,
      source: "static-data",
      q: result.q,
      kind: result.kind,
      total: result.total,
      capped: result.capped,
      limit: result.limit,
      count: result.matches.length,
      matches: result.matches,
    });
  } catch (error) {
    next(error);
  }
});

// Batch name resolution (goal R7c): the names-everywhere UI pass turns raw IDs
// into names across every tab, so a list of many IDs (an inventory of typeIDs,
// a guest list of corp IDs, ...) resolves in ONE round-trip. POST /api/names
// takes { items: [{kind, id}] } and returns { names: { "kind:id": name } } over
// the existing static getters. Read-only static reference data — like
// /api/map/find and /api/agents/find, NOT a gateway/bridge call. Each item is
// echoed (a name string, or null for a definitive unknown the client caches);
// the batch is capped server-side so an oversized request can't scan the whole
// item table.
app.post("/api/names", requireAuth, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const result = staticData.resolveNames({ items });
    res.json({
      ok: true,
      source: "static-data",
      count: Object.keys(result.names).length,
      capped: result.capped,
      limit: result.limit,
      names: result.names,
    });
  } catch (error) {
    next(error);
  }
});

// Agent Finder (goal R6a): list agents from the static agentAuthority reference
// table so the player can find a courier agent to travel to (the per-station
// GetAgents roster is unreliable for this). Read-only static reference data —
// like /api/map/graph, NOT a gateway/bridge call. Filters server-side by kind
// (default courier) + optional level and caps the result so the ~11k-agent
// dataset never crosses the wire whole; the client sorts by jumps from the
// current system (distancesFrom, a single client-side BFS) and renders a page.
app.get("/api/agents/find", requireAuth, async (req, res, next) => {
  try {
    const kind = typeof req.query.kind === "string" ? req.query.kind : "courier";
    const level = req.query.level !== undefined ? Number(req.query.level) : null;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const result = staticData.findAgents({ kind, level, limit });
    res.json({
      ok: true,
      source: "static-data",
      kind: result.kind,
      level: result.level,
      total: result.total,
      capped: result.capped,
      limit: result.limit,
      count: result.agents.length,
      agents: result.agents,
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
