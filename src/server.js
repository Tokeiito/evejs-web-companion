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
      forgetBridgeSession(payload.sessionID);
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
      forgetBridgeSession(req.webSessionID);
    }
    next(error);
  }
});

// Drop a held bridge session from the BFF's map. Every site that forgets a
// handle goes through here so the R10 push stream is torn down with it: a
// gateway WebSocket for a session the BFF no longer holds can never be useful,
// and attached browsers are told the channel ended rather than being left on a
// silent stream.
function forgetBridgeSession(webSessionID) {
  const held = bridgeSessions.get(webSessionID);
  if (!held) {
    return false;
  }
  bridgeSessions.delete(webSessionID);
  publishStreamStatus(held, "ended", "session_released");
  closeHeldStream(held);
  for (const subscriber of [...held.streamSubscribers]) {
    held.streamSubscribers.delete(subscriber);
    try {
      subscriber.end();
    } catch {
      // The response is already gone.
    }
  }
  return true;
}

// Best-effort release of the bridge session a web session holds. Returns true
// when a held session existed. SESSION_NOT_FOUND from the gateway means the
// TTL (or a takeover) already disconnected it — the handle is just dropped.
async function releaseHeldBridgeSession(webSessionID) {
  const held = bridgeSessions.get(webSessionID);
  if (!held) {
    return false;
  }
  forgetBridgeSession(webSessionID);
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

// --- R10 live event channel (gateway push -> SSE) --------------------------
// The BFF holds at most ONE gateway WebSocket per held bridge session and
// republishes it to the browser as Server-Sent Events on GET /api/bridge/events
// (same-origin, cookie-authed, routed to this web session's held bridge
// session). The bridgeSessionID stays server-side, exactly as on every request
// route.
//
// The stream is opened lazily when a browser attaches and closed when the last
// one detaches, so a held session with nobody watching costs nothing. The last
// cursor seen is remembered on the held-session entry, so a gateway reconnect
// resumes with it and the gateway replays the frames missed in between.
//
// Liveness only: every request route still drains notifications onto its
// response, so a stream that never opens or drops mid-flight degrades to the
// old poll-based behaviour rather than losing data.

const STREAM_RETRY_MS = 3000;
const SSE_HEARTBEAT_MS = 25_000;

function writeSseFrame(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

// Fan a gateway frame out to every SSE subscriber on this held session, and
// remember its cursor so a reconnect resumes from it.
function publishStreamFrame(held, frame) {
  if (frame && frame.cursor && typeof frame.cursor.epoch === "string") {
    held.streamCursor = {
      epoch: frame.cursor.epoch,
      sequence: Number(frame.cursor.sequence) || 0,
    };
  }
  for (const subscriber of [...held.streamSubscribers]) {
    if (!writeSseFrame(subscriber, frame)) {
      held.streamSubscribers.delete(subscriber);
    }
  }
}

function publishStreamStatus(held, state, detail) {
  publishStreamFrame(held, {
    source: "evejs-web-bff",
    type: "stream-status",
    state,
    detail: detail === undefined ? null : detail,
  });
}

function openHeldStream(webSessionID, held) {
  if (held.stream || held.streamSubscribers.size === 0) {
    return;
  }
  held.streamRetryTimer = null;
  held.stream = gateway.openSessionEventStream({
    bridgeSessionID: held.bridgeSessionID,
    userid: Number(held.accountID),
    cursor: held.streamCursor || null,
    onOpen() {
      publishStreamStatus(held, "live");
    },
    onFrame(frame) {
      publishStreamFrame(held, frame);
    },
    onClose(details) {
      held.stream = null;
      if (held.streamSubscribers.size === 0) {
        return;
      }
      // Tell the browser the channel is degraded so it leans on its poll, then
      // retry. A 404 means the gateway no longer knows this bridge session —
      // retrying cannot fix that, so stop and let the next request route
      // surface SESSION_NOT_FOUND.
      const refusal = Number(details && details.refusalStatus) || 0;
      if (refusal === 404) {
        publishStreamStatus(held, "ended", "session_not_found");
        return;
      }
      publishStreamStatus(held, "degraded", (details && details.reason) || null);
      held.streamRetryTimer = setTimeout(() => {
        held.streamRetryTimer = null;
        if (bridgeSessions.get(webSessionID) === held) {
          openHeldStream(webSessionID, held);
        }
      }, STREAM_RETRY_MS);
      if (typeof held.streamRetryTimer.unref === "function") {
        held.streamRetryTimer.unref();
      }
    },
  });
}

function closeHeldStream(held) {
  if (held.streamRetryTimer) {
    clearTimeout(held.streamRetryTimer);
    held.streamRetryTimer = null;
  }
  if (held.stream) {
    held.stream.close();
    held.stream = null;
  }
}

app.get("/api/bridge/events", requireAuth, (req, res) => {
  const held = bridgeSessions.get(req.webSessionID) || null;
  if (!held) {
    res.status(409).json({
      ok: false,
      error: "NO_LIVE_SESSION",
      message: "No character is online; select a character first.",
    });
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    // Defeat proxy buffering, which would otherwise hold frames back and
    // reintroduce exactly the latency this channel removes.
    "x-accel-buffering": "no",
  });
  res.write(": open\n\n");
  held.streamSubscribers.add(res);
  publishStreamStatus(held, held.stream ? "live" : "connecting");
  openHeldStream(req.webSessionID, held);

  // SSE comment heartbeat: keeps intermediaries from reaping an idle stream.
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      // The close handler below owns teardown.
    }
  }, SSE_HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") {
    heartbeat.unref();
  }

  req.on("close", () => {
    clearInterval(heartbeat);
    held.streamSubscribers.delete(res);
    if (held.streamSubscribers.size === 0) {
      closeHeldStream(held);
    }
  });
});

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
      // R10 live event channel: the single gateway push WebSocket for this
      // session (opened lazily when a browser attaches), the SSE responses it
      // fans out to, and the last cursor seen so a reconnect resumes there.
      stream: null,
      streamSubscribers: new Set(),
      streamCursor: null,
      streamRetryTimer: null,
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
      forgetBridgeSession(webSessionID);
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

// --- R12 Ship fitting -------------------------------------------------------
// Fitting is NOT a dedicated service: it is the SAME bound-object two-step the
// R3 inventory routes above drive, with a SLOT flag instead of the hangar (4) /
// cargo (5) flag. So `fit` and `unfit` are literally invbroker.Add through the
// same boundCall + handle cache, and this section adds no new bind machinery.
//
//   read  slots      ship binding . ListByFlags(<every slot flag>)
//   read  resources  dogmaIM.ShipGetInfo()        [top level, no bind]
//   read  online     dogmaIM.ShipOnlineModules()  [top level, no bind]
//   fit              ship binding . Add(moduleID, sourceID, {flag:<slot>})
//   unfit            hangar/ship binding . Add(moduleID, shipID, {flag:4|5})
//   online/offline   dogmaIM.SetModuleOnline / TakeModuleOffline
//   remove a rig     ship binding . DestroyFitting(rigID)  -- DESTRUCTIVE
//
// The browser NEVER sends a slot flagID. It addresses a slot by FAMILY and
// INDEX ("the third high slot"), and this module is the only place that knows
// the numbers — which is what keeps raw flagIDs out of browser JS entirely.

// Slot flag families (inventorycommon/const.py; mirrored server-side by
// services/fitting/liveFittingState.js SLOT_FAMILY_FLAGS).
const SLOT_FAMILY_FLAGS = Object.freeze({
  high: Object.freeze([27, 28, 29, 30, 31, 32, 33, 34]),
  mid: Object.freeze([19, 20, 21, 22, 23, 24, 25, 26]),
  low: Object.freeze([11, 12, 13, 14, 15, 16, 17, 18]),
  rig: Object.freeze([92, 93, 94, 95, 96, 97, 98, 99]),
  subsystem: Object.freeze([125, 126, 127, 128, 129, 130, 131, 132]),
});
// Deliberately the SERVER's ranges (rig 92-99, subsystem 125-132), which are
// wider than the retail client's own lists (92-94 / 125-128). The server clamps
// each family to the ship's actual slot count anyway, so reading the wider
// range costs nothing and never misses a slot this server considers legal.
const ALL_SLOT_FLAGS = Object.freeze([
  ...SLOT_FAMILY_FLAGS.low,
  ...SLOT_FAMILY_FLAGS.mid,
  ...SLOT_FAMILY_FLAGS.high,
  ...SLOT_FAMILY_FLAGS.rig,
  ...SLOT_FAMILY_FLAGS.subsystem,
]);
// flag 0 is flagAutoFit: the SERVER picks the slot. The panel offers this as
// "first free slot" so a player never has to think in slot numbers at all.
const ITEM_FLAG_AUTO_FIT = 0;

// The ship's resource attributes (CPU / powergrid / capacitor / calibration)
// ride back in the raw ShipGetInfo result and are decoded browser side, like
// every other retail-shaped read here — see web/src/bridge/fitting.ts for the
// dogma attribute IDs and why the capacitor read is capacity-or-charge.

// Resolve a browser-addressed slot ("high", index 2) to its flagID. `family`
// "auto" (or a missing index) means let the server choose the slot.
function resolveSlotFlag(family, index) {
  if (family === "auto") {
    return ITEM_FLAG_AUTO_FIT;
  }
  const flags = SLOT_FAMILY_FLAGS[family];
  if (!flags) {
    return null;
  }
  const numericIndex = Number(index);
  if (!Number.isSafeInteger(numericIndex) || numericIndex < 0 || numericIndex >= flags.length) {
    return null;
  }
  return flags[numericIndex];
}

// The whole fitting panel: what is in every slot, the ship's resource
// attributes, and which modules are online. The three reads are INDEPENDENT
// (Promise.allSettled) so one failed read never blanks the rest — R2's rule,
// as the inventory and rewards routes apply it.
app.get("/api/bridge/fitting", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    // Sync the held ship/station to the live position first, so the slot read
    // binds the CURRENT active ship after a board or a dock elsewhere.
    await readHeldFlight(held, req.webSessionID);
    const shipID = held.activeShipID;
    const noShip = () =>
      Promise.reject(Object.assign(new Error("No active ship."), { code: "NO_ACTIVE_SHIP" }));
    const [slots, shipInfo, online] = await Promise.allSettled([
      shipID
        ? boundCall(held, req.webSessionID, cargoBindSpec(held, shipID), "ListByFlags", [ALL_SLOT_FLAGS], null)
        : noShip(),
      shipID
        ? heldTopLevelCall(held, req.webSessionID, "dogmaIM", "ShipGetInfo", [], null)
        : noShip(),
      shipID
        ? heldTopLevelCall(held, req.webSessionID, "dogmaIM", "ShipOnlineModules", [], null)
        : noShip(),
    ]);

    for (const settled of [slots, shipInfo, online]) {
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
      activeShipID: shipID,
      stationID: held.stationID,
      slots: settledValue(slots),
      shipInfo: settledValue(shipInfo),
      online: settledValue(online),
      errors: {
        slots: settledCode(slots),
        shipInfo: settledCode(shipInfo),
        online: settledCode(online),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Read just the slot rows — used to VERIFY a mutation actually landed. The
// server can decline a fit SILENTLY (invbroker's SKILL_REQUIRED branch returns
// null without raising a UserError), so a 200 from Add is not proof anything
// moved. Every mutating route below re-reads and reports what really happened
// rather than echoing an optimistic success.
async function readFittedItemIDs(held, webSessionID, shipID) {
  const outcome = await boundCall(
    held,
    webSessionID,
    cargoBindSpec(held, shipID),
    "ListByFlags",
    [ALL_SLOT_FLAGS],
    null,
  );
  return decodeFittedSlotMap(outcome.result);
}

// Decode an invbroker ListByFlags result to itemID -> flagID. Rows arrive as
// packedrows (or, when empty, a python set wrapping an empty list).
function decodeFittedSlotMap(result) {
  let listValue = result;
  if (listValue && listValue.type === "objectex1" && Array.isArray(listValue.header)) {
    const token = listValue.header[0];
    if (token && token.value === "__builtin__.set" && Array.isArray(listValue.header[1])) {
      listValue = listValue.header[1][0] ?? null;
    }
  } else if (listValue && listValue.type === "object" && Array.isArray(listValue.args)) {
    listValue = listValue.args[0] ?? null;
  }
  const items =
    listValue && listValue.type === "list" && Array.isArray(listValue.items) ? listValue.items : [];
  const byItemID = new Map();
  for (const item of items) {
    const fields = item && item.type === "packedrow" && item.fields ? item.fields : item;
    if (!fields || typeof fields !== "object") {
      continue;
    }
    const itemID = Number(fields.itemID) || 0;
    if (itemID > 0) {
      byItemID.set(itemID, Number(fields.flagID) || 0);
    }
  }
  return byItemID;
}

// Fit a module from the station hangar or the ship's own cargo into a slot.
// The bound object is the SHIP (the destination); the source location is the
// station when fitting from the hangar and the ship when fitting from cargo.
app.post("/api/bridge/fitting/fit", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemID = Number(body.itemID) || 0;
  const source = String(body.source || "hangar");
  const family = String(body.family || "auto");
  const slotFlag = resolveSlotFlag(family, body.index);
  if (itemID <= 0 || slotFlag === null || (source !== "hangar" && source !== "cargo")) {
    res.status(400).json({
      ok: false,
      error: "INVALID_FIT",
      message: "A module, a source of 'hangar' or 'cargo', and a real slot are required.",
    });
    return;
  }
  const shipID = held.activeShipID;
  if (!shipID) {
    res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship to fit to." });
    return;
  }
  try {
    const outcome = await boundCall(
      held,
      req.webSessionID,
      cargoBindSpec(held, shipID),
      "Add",
      [itemID, source === "cargo" ? shipID : held.stationID],
      { qty: 1, flag: slotFlag },
    );
    // Verify: a silent decline is indistinguishable from success at the call
    // seam, so the answer is what the SLOTS say afterwards.
    const fitted = await readFittedItemIDs(held, req.webSessionID, shipID);
    res.json({
      ok: true,
      applied: fitted.has(itemID),
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

// Unfit a module back to the station hangar (docked) or the ship's cargo. The
// same Add, reversed: the DESTINATION container is the bound object, the ship
// is the source location, and the flag is the hangar/cargo flag.
app.post("/api/bridge/fitting/unfit", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemID = Number(body.itemID) || 0;
  const destination = String(body.destination || "hangar");
  if (itemID <= 0 || (destination !== "hangar" && destination !== "cargo")) {
    res.status(400).json({
      ok: false,
      error: "INVALID_UNFIT",
      message: "A module and a destination of 'hangar' or 'cargo' are required.",
    });
    return;
  }
  const shipID = held.activeShipID;
  if (!shipID) {
    res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship to unfit from." });
    return;
  }
  const destSpec =
    destination === "cargo" ? cargoBindSpec(held, shipID) : hangarBindSpec(held);
  try {
    const outcome = await boundCall(
      held,
      req.webSessionID,
      destSpec,
      "Add",
      [itemID, shipID],
      { qty: 1, flag: destination === "cargo" ? ITEM_FLAG_CARGO_HOLD : ITEM_FLAG_HANGAR },
    );
    const fitted = await readFittedItemIDs(held, req.webSessionID, shipID);
    res.json({
      ok: true,
      applied: !fitted.has(itemID),
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

// Bring a fitted module online or take it offline. Top-level dogmaIM calls: the
// handler resolves the ship from the session. The handler ALSO owns the CPU /
// powergrid / capacitor gating, and answers a refusal with its own reason
// ("You do not have enough CPU to online that module.") — which arrives here as
// a typed CALL_REFUSED and is passed through untouched. The BFF never
// pre-judges whether a module can be onlined.
app.post("/api/bridge/fitting/state", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemID = Number(body.itemID) || 0;
  const online = body.online === true;
  if (itemID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_MODULE", message: "A module is required." });
    return;
  }
  const shipID = held.activeShipID;
  if (!shipID) {
    res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship." });
    return;
  }
  try {
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "dogmaIM",
      online ? "SetModuleOnline" : "TakeModuleOffline",
      [shipID, itemID],
      null,
    );
    res.json({ ok: true, online, notifications: outcome.notifications });
  } catch (error) {
    next(error);
  }
});

// DESTROY a fitted rig. Rigs cannot be unfitted — removing one destroys it —
// so this route is the only destructive fitting action, and it refuses unless
// the caller explicitly confirms. That is a second gate behind the web UI's own
// two-step confirmation: neither a stray click nor a stray POST can lose a rig.
app.post("/api/bridge/fitting/destroy-rig", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemID = Number(body.itemID) || 0;
  if (itemID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_MODULE", message: "A rig is required." });
    return;
  }
  if (body.confirm !== true) {
    res.status(400).json({
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      message: "Removing a rig destroys it. This action must be confirmed explicitly.",
    });
    return;
  }
  const shipID = held.activeShipID;
  if (!shipID) {
    res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship." });
    return;
  }
  try {
    // Only a RIG may go through this route: the server refuses a non-rig
    // anyway, but checking here means a mis-aimed call is a clear 400 rather
    // than a silent no-op the player has to infer from the panel.
    const before = await readFittedItemIDs(held, req.webSessionID, shipID);
    const flagID = before.get(itemID);
    if (flagID === undefined || !SLOT_FAMILY_FLAGS.rig.includes(flagID)) {
      res.status(400).json({
        ok: false,
        error: "NOT_A_RIG",
        message: "That module is not a rig on the active ship; unfit it instead.",
      });
      return;
    }
    const outcome = await boundCall(
      held,
      req.webSessionID,
      cargoBindSpec(held, shipID),
      "DestroyFitting",
      [itemID],
      null,
    );
    const after = await readFittedItemIDs(held, req.webSessionID, shipID);
    res.json({
      ok: true,
      applied: !after.has(itemID),
      notifications: outcome.notifications,
    });
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
      forgetBridgeSession(webSessionID);
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
      forgetBridgeSession(req.webSessionID);
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
      forgetBridgeSession(req.webSessionID);
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
      forgetBridgeSession(webSessionID);
    }
    throw error;
  }
}

// --- R13 flight-verb ranges -------------------------------------------------
// Every one of these is a DISTANCE IN METRES, never an identifier. The retail
// defaults: Approach 50 m (the menu form; the autopilot uses 0), Keep at range
// 1000 m floored at 50 m, Orbit 1000 m. The warp-range menu offers a fixed
// ladder, whose default is 0 — NOT 10 km.
const APPROACH_DEFAULT_RANGE_M = 50;
const KEEP_AT_RANGE_DEFAULT_M = 1000;
const KEEP_AT_RANGE_FLOOR_M = 50;
const ORBIT_DEFAULT_RANGE_M = 1000;
// A sane ceiling so a typo cannot send an absurd follow/orbit range: 1000 km,
// far beyond any sensible hold distance and well inside warp range.
const MAX_FOLLOW_RANGE_M = 1_000_000;
const WARP_RANGE_CHOICES_M = Object.freeze([0, 10000, 20000, 30000, 50000, 70000, 100000]);

/**
 * A follow/orbit range in metres: absent -> the caller's default, otherwise a
 * finite non-negative number clamped up to `floor` and bounded above. Returns
 * null for anything that is not a number at all (the route answers 400).
 */
function normalizeFollowRange(value, fallback, floor) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > MAX_FOLLOW_RANGE_M) {
    return null;
  }
  return Math.max(floor, numeric);
}

/** A warp range in metres: one of the offered choices, or null (400). */
function normalizeWarpRange(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return WARP_RANGE_CHOICES_M.includes(numeric) ? numeric : null;
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

// Warp to a chosen gate/celestial through the bound park.
//
// Two shapes, exactly as retail has two:
//   - no `minRange` in the body  -> beyonce.CmdWarpToStuffAutopilot(destID),
//     the autopilot's own warp (the browser decide-loop uses this one);
//   - `minRange` present         -> beyonce.CmdWarpToStuff("item", destID,
//     minRange=<metres>), the right-click "Warp to → within N km" menu (R13).
//     Retail's own default for that menu is 0, not 10 km.
// `minRange` is a KWARG; the subject string ("item") is positional.
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
  const rangedWarp = req.body && req.body.minRange !== undefined && req.body.minRange !== null;
  const minRange = rangedWarp ? normalizeWarpRange(req.body.minRange) : 0;
  if (rangedWarp && minRange === null) {
    res.status(400).json({
      ok: false,
      error: "INVALID_RANGE",
      message: "The warp range must be one of the offered distances.",
    });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const outcome = rangedWarp
      ? await boundCall(
          held,
          req.webSessionID,
          parkBindSpec(before.flight.solarSystemID),
          "CmdWarpToStuff",
          ["item", destinationID],
          { minRange },
        )
      : await boundCall(
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

// Approach a gate/target at full speed:
// beyonce.CmdSetSpeedFraction(1.0) + CmdFollowBall(destinationID, range).
//
// R13: the range is no longer hardcoded to 0.0. Retail has TWO callers of this
// one method and they differ only in that number — the right-click "Approach"
// menu uses 50 m, and the autopilot's close-the-gap step uses 0.0. So the
// browser passes what it means: the Overview's Approach button sends the 50 m
// default, and the decide-loop sends 0. (Keep at range is the same method again
// at the player's chosen distance — see /flight/keep-at-range below.)
//
// An autopilot-warp lands the ship NEAR a gate but often outside jump range, so
// CmdStargateJump refuses NotWithinMaxJumpDist until the ship follows the gate
// into range. (Both methods were allowlisted in R5a; R13 adds no pair here.)
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
  const range = normalizeFollowRange(req.body && req.body.range, APPROACH_DEFAULT_RANGE_M, 0);
  if (range === null) {
    res.status(400).json({
      ok: false,
      error: "INVALID_RANGE",
      message: "The approach range must be a distance in metres.",
    });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const spec = parkBindSpec(before.flight.solarSystemID);
    await boundCall(held, req.webSessionID, spec, "CmdSetSpeedFraction", [1.0], null);
    const outcome = await boundCall(held, req.webSessionID, spec, "CmdFollowBall", [destinationID, range], null);
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

// Keep at range: beyonce.CmdSetSpeedFraction(1.0) + CmdFollowBall(targetID,
// range). The SAME server method as Approach — retail has no separate
// keep-at-range command, it just passes a non-zero range. Default 1000 m,
// floored at 50 m (below that the server treats it as a docking-style approach).
app.post("/api/bridge/flight/keep-at-range", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const targetID = Number(req.body && req.body.targetID) || 0;
  if (targetID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "A positive targetID is required." });
    return;
  }
  const range = normalizeFollowRange(
    req.body && req.body.range,
    KEEP_AT_RANGE_DEFAULT_M,
    KEEP_AT_RANGE_FLOOR_M,
  );
  if (range === null) {
    res.status(400).json({
      ok: false,
      error: "INVALID_RANGE",
      message: "The range to hold must be a distance in metres.",
    });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const spec = parkBindSpec(before.flight.solarSystemID);
    await boundCall(held, req.webSessionID, spec, "CmdSetSpeedFraction", [1.0], null);
    const outcome = await boundCall(held, req.webSessionID, spec, "CmdFollowBall", [targetID, range], null);
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

// Orbit: beyonce.CmdOrbit(targetID, range) (allowlisted in R13). Default 1000 m.
// The range is coerced the way the retail client coerces it before sending —
// float below 10, int at or above — so the wire value matches what the real
// client puts on it.
app.post("/api/bridge/flight/orbit", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const targetID = Number(req.body && req.body.targetID) || 0;
  if (targetID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "A positive targetID is required." });
    return;
  }
  const requested = normalizeFollowRange(req.body && req.body.range, ORBIT_DEFAULT_RANGE_M, 0);
  if (requested === null) {
    res.status(400).json({
      ok: false,
      error: "INVALID_RANGE",
      message: "The orbit range must be a distance in metres.",
    });
    return;
  }
  const range = requested < 10 ? Number(requested) : Math.round(requested);
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const spec = parkBindSpec(before.flight.solarSystemID);
    await boundCall(held, req.webSessionID, spec, "CmdSetSpeedFraction", [1.0], null);
    const outcome = await boundCall(held, req.webSessionID, spec, "CmdOrbit", [targetID, range], null);
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

// Align to: beyonce.CmdAlignTo(dstID=targetID, bookmarkID=null) (allowlisted in
// R13). KWARGS ONLY — the retail client never sends a positional target here,
// and exactly one of dstID / bookmarkID is non-null. This BFF only offers the
// dstID form (the browser has no bookmarks yet), so bookmarkID is always null.
app.post("/api/bridge/flight/align", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const targetID = Number(req.body && req.body.targetID) || 0;
  if (targetID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "A positive targetID is required." });
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
      "CmdAlignTo",
      [],
      { dstID: targetID, bookmarkID: null },
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

// Stop: beyonce.CmdStop() (allowlisted in R13). No arguments at all.
//
// In retail, Stop also kills the autopilot (CancelSystemNavigation before,
// SetOff after). Our autopilot is CLIENT-side, so the browser aborts its own
// decide-loop around this call — the server half is just CmdStop.
app.post("/api/bridge/flight/stop", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
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
      "CmdStop",
      [],
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

// R11 space overview + ship HUD. A read-only snapshot of what the ship can see
// right now — the visible entities around it and the active ship's shield /
// armor / hull / capacitor. The browser polls this ~1s while in space with the
// overview open (the retail client re-renders its own overview on the same
// 0.5-1.0s cadence) and computes distance, sorting and filtering itself from
// the returned positions, exactly as the real client does. Read-only: it starts
// no movement; the Warp to / Approach buttons on each row reuse the existing
// atomic-move routes above (/api/bridge/flight/warp and /approach).
app.get("/api/bridge/space/snapshot", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const outcome = await gateway.readSpaceSnapshot(held.bridgeSessionID, {
      userid: held.accountID,
    });
    res.json({ ok: true, space: outcome.space, notifications: outcome.notifications });
  } catch (error) {
    if (error && error.code === "SESSION_NOT_FOUND") {
      forgetBridgeSession(req.webSessionID);
    }
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
