"use strict";

const express = require("express");
const fs = require("fs");
const http = require("http");
const path = require("path");
// R17 mail: mailMgr.GetBody answers a zlib-DEFLATED buffer, and inflating it is
// this file's job — see mailBodyText. The browser never sees a compressed byte.
const zlib = require("zlib");
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

// --- R42: the login token rides TWO carriers, so tabs stop colliding --------
//
// The signed login token used to have exactly one carrier: the httpOnly cookie
// below, scoped to path "/". A cookie belongs to the BROWSER PROFILE, not to
// the tab, so a second tab logging in as another account OVERWROTE the first
// tab's session and every open tab collapsed onto whichever account signed in
// last. The operator wants ten tabs running ten accounts, so the token now
// also rides `Authorization: Bearer <token>`, fed from the tab's own
// `sessionStorage` — which is per-tab by specification. Same token, same
// `webAuth.verifySessionToken`, same `req.webSessionID`: this changes the
// CARRIER, not the authentication. The cookie stays for the migration window
// so nothing that already works breaks.
//
// SECURITY TRADE — DELIBERATE, AND LOCAL TO THIS POC. A token the page's own
// JavaScript can read is a token an XSS bug can steal; `httpOnly` existed to
// prevent precisely that, and we are giving it up. That is acceptable HERE and
// only here: this BFF is a companion to a LOCAL DEV EMULATOR whose login
// accepts ANY password for ANY existing username (see /api/login below, goal
// R1) — there is no secret left for httpOnly to protect. DO NOT COPY THIS
// PATTERN into anything reachable from a network. If this app ever grows real
// credentials, per-tab identity has to be solved some other way (a per-tab
// path-scoped cookie, or a session id in the URL path) and the token must go
// back to being httpOnly.
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

// The query-string name the SSE stream carries its token under. See
// requireStreamAuth below for why the stream needs one and every other route
// refuses it.
const SESSION_QUERY_PARAM = "access_token";

function readBearerToken(authorizationHeader) {
  const match = /^Bearer +(\S.*)$/i.exec(String(authorizationHeader || "").trim());
  return match ? match[1].trim() : "";
}

// The one place that decides which carrier a request's session token came from.
// Header first: when a tab has its own token in sessionStorage that is the
// deliberate identity, and the shared cookie left over from another tab's login
// must not be able to override it.
function readSessionToken(req, { allowQueryParam = false } = {}) {
  const fromHeader = readBearerToken(req.headers.authorization);
  if (fromHeader) {
    return fromHeader;
  }
  if (allowQueryParam) {
    const fromQuery = req.query ? req.query[SESSION_QUERY_PARAM] : undefined;
    if (typeof fromQuery === "string" && fromQuery) {
      return fromQuery;
    }
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[config.sessionCookieName] || "";
}

// One implementation, two doors — `requireAuth` for everything, and the
// query-tolerant variant the SSE route needs. The auth itself is identical;
// only the accepted carrier set differs.
function makeRequireAuth({ allowQueryParam = false } = {}) {
  return async function requireAuthenticatedSession(req, res, next) {
    const payload = auth.verifySessionToken(readSessionToken(req, { allowQueryParam }));
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
  };
}

// Every route. Header or cookie only — a token in the query string is REFUSED
// here, deliberately; see requireStreamAuth.
const requireAuth = makeRequireAuth();

// The SSE push channel alone. `EventSource` cannot set request headers — the
// API has no hook for it — so GET /api/bridge/events accepts the token as the
// `access_token` query parameter. That puts a credential in a URL, which is a
// real cost: URLs reach browser history, `Referer` headers, and any access log
// in front of the app. Two things contain it. First, this BFF writes no access
// log: nothing here logs `req.url`, and the error handler logs the Error alone,
// so the token is not recorded on this side — keep it that way if request
// logging is ever added, and redact this parameter if it is. Second, the query
// carrier is accepted by this route and no other, so a token that leaks through
// a URL can be used to WATCH a session's stream but never to drive it: every
// mutating route goes through `requireAuth`, which ignores the query string.
//
// A per-tab session whose push channel still rode the shared cookie would be
// half a feature — tab two would receive tab one's live events — so this is not
// optional decoration.
const requireStreamAuth = makeRequireAuth({ allowQueryParam: true });

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

    // R42: one token, both carriers. The cookie keeps the pre-R42 client
    // working; `sessionToken` in the body is what the tab puts in its own
    // sessionStorage so ten tabs can hold ten different accounts. Read the
    // security note above setSessionCookie before copying this anywhere.
    const token = auth.createSessionToken(account);
    setSessionCookie(res, token);
    res.json({
      ok: true,
      sessionToken: token,
      account: publicAccount(account),
      characters: await store.listCharactersForAccount(account.accountID),
    });
  } catch (error) {
    next(error);
  }
});

// Logging out has to release the session the CALLING TAB holds, so it reads the
// same carriers as requireAuth: a tab signing out with its own Bearer token
// must not release whatever session the shared cookie happens to name.
app.post("/api/logout", async (req, res) => {
  const payload = auth.verifySessionToken(readSessionToken(req));
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
// (same-origin, routed to this web session's held bridge session). The
// bridgeSessionID stays server-side, exactly as on every request route. Since
// R42 the stream authenticates from the `access_token` query parameter as well
// as the cookie, because EventSource cannot send a header — see
// requireStreamAuth for the trade that buys and what bounds it.
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

app.get("/api/bridge/events", requireStreamAuth, (req, res) => {
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
      solarSystemID: Number(outcome.session.solarSystemID) || null,
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

// --- R14 Inventory depth + corporation hangars -----------------------------
// All of this is the SAME R3 bound-object bridge above, with arguments R3
// hardcoded away. Nothing here forks a parallel path: every route goes through
// boundCall() and the shared bind/handle cache.
//
//   split a stack   Add(itemID, sourceLocationID, qty=<partial>)
//   multi-move      MultiAdd(itemIDs, sourceLocationID, flag=<dest>)
//   re-merge        MultiMerge([[src,dst,qty]], sourceContainerID)
//   open container  GetInventoryFromId(containerID) then List() with NO FLAG
//   corp hangar     GetInventoryFromId(officeID) then List(<division flag>)
//   trash           TrashItems(itemIDs, locationID) — DESTRUCTIVE, confirm-gated
//
// The browser never sends a flagID or a division flag: it names a place
// ("hangar", "cargo", a container's itemID, a corp division NUMBER 1-7) and the
// mapping to retail flags lives here.

// Container contents carry flagID 0 — NOT 4/5. A container is therefore listed
// with no flag at all, and an item filed INTO one must be given flag 0
// explicitly (a container binding's flag context is null, and a null flag falls
// back to the hangar flag).
const ITEM_FLAG_NONE = 0;
// flagCorpSAG1..7 = 115..121. Division N maps to 114 + N. These numbers never
// reach the browser; it addresses a division by its ordinal and sees its NAME.
const CORP_DIVISION_FLAG_BASE = 114;
const CORP_DIVISION_COUNT = 7;

function corpDivisionFlag(division) {
  return CORP_DIVISION_FLAG_BASE + division;
}

function isValidDivision(division) {
  return Number.isSafeInteger(division) && division >= 1 && division <= CORP_DIVISION_COUNT;
}

// A container binds with the IDENTICAL call ship cargo binds with — there is no
// container-specific bind method, and container-ness is a client-side
// static-data question the server never asks.
function containerBindSpec(containerID) {
  return {
    key: `container:${containerID}`,
    service: "invbroker",
    method: "GetInventoryFromId",
    args: [containerID],
    kwargs: { passive: 0 },
  };
}

// The corporation's office at this station. See readCorpOffice() for why the
// identifier bound here is the PUBLISHED one and what it is not.
function corpOfficeBindSpec(officeID) {
  return {
    key: `corpOffice:${officeID}`,
    service: "invbroker",
    method: "GetInventoryFromId",
    args: [officeID],
    kwargs: { passive: 0 },
  };
}

// Moniker('invbroker', (stationID, groupStation)) — the inventory MANAGER.
// TrashItems dispatches on this, not on a per-container binding.
function inventoryManagerBindSpec(held) {
  return {
    key: `invManager:${held.stationID}`,
    service: "invbroker",
    method: "MachoBindObject",
    args: [[held.stationID, SHIP_BIND_GROUP_STATION]],
    kwargs: null,
  };
}

// Decode an invbroker List result to plain rows. Rows arrive as packedrows, or
// (when empty and flag-scoped) a python set wrapping an empty list.
function decodeInventoryRows(result) {
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
  const rows = [];
  for (const item of items) {
    const fields = item && item.type === "packedrow" && item.fields ? item.fields : item;
    if (!fields || typeof fields !== "object") {
      continue;
    }
    const itemID = Number(fields.itemID) || 0;
    if (itemID > 0) {
      rows.push({
        itemID,
        typeID: Number(fields.typeID) || 0,
        locationID: Number(fields.locationID) || 0,
        flagID: Number(fields.flagID) || 0,
        quantity: Number(fields.quantity) || Number(fields.stacksize) || 0,
        // R40: what a row IS, not just where it sits. The ship bays route needs
        // these to tell a ship from a container from a stack of ore without a
        // second read. Additive — every existing caller picks the fields it
        // wants and is unaffected. groupID/categoryID are null (not 0) when the
        // row did not carry them: 0 is a real category and "absent" is not it.
        groupID: fields.groupID === undefined || fields.groupID === null ? null : Number(fields.groupID),
        categoryID:
          fields.categoryID === undefined || fields.categoryID === null
            ? null
            : Number(fields.categoryID),
        singleton: Number(fields.singleton) === 1,
      });
    }
  }
  return rows;
}

// Decode officeManager.GetMyCorporationsOffices (a CRowset: objectex2 whose
// `list` holds packedrows).
function decodeOfficeRows(result) {
  const rows = result && Array.isArray(result.list) ? result.list : [];
  const offices = [];
  for (const row of rows) {
    const fields = row && row.type === "packedrow" && row.fields ? row.fields : null;
    if (!fields) {
      continue;
    }
    offices.push({
      officeID: Number(fields.officeID) || 0,
      stationID: Number(fields.stationID) || 0,
    });
  }
  return offices;
}

// Decode corpRegistry.GetCorporation (a util.Row: a `header` list of column
// names paired with a `line` list of values) into division ordinal -> name.
function decodeDivisionNames(result) {
  const entries =
    result && result.type === "object" && result.args && Array.isArray(result.args.entries)
      ? result.args.entries
      : [];
  const header = (entries.find(([key]) => key === "header") || [])[1];
  const line = (entries.find(([key]) => key === "line") || [])[1];
  const names = (header && header.items) || [];
  const values = (line && line.items) || [];
  const byDivision = {};
  for (let division = 1; division <= CORP_DIVISION_COUNT; division += 1) {
    const index = names.indexOf(`division${division}`);
    const value = index >= 0 ? values[index] : null;
    byDivision[division] = typeof value === "string" && value.trim() !== "" ? value : null;
  }
  return byDivision;
}

/**
 * Resolve the corporation's office at the docked station.
 *
 * ⚠ IDENTITY. An office carries three separately allocated ids: officeID (where
 * the hangar CONTENTS sit), officeFolderID, and itemID. What
 * GetMyCorporationsOffices publishes as `officeID` is the office's ITEM id.
 * GetInventoryFromId accepts any of the three, so BINDING with the published
 * value is correct — but it is NOT the items' locationID, and passing it as the
 * source location of a move-out gets the move declined SILENTLY (a 200 with
 * nothing moved). Everywhere a source location is needed, the bridge takes it
 * from the LISTED ROW's own locationID instead of assuming.
 */
async function readCorpOffice(held, webSessionID) {
  const outcome = await heldTopLevelCall(
    held,
    webSessionID,
    "officeManager",
    "GetMyCorporationsOffices",
    [],
    null,
  );
  const offices = decodeOfficeRows(outcome.result);
  const here = offices.find((office) => office.stationID === held.stationID);
  return here ? here.officeID : 0;
}

// Resolve a browser-supplied place descriptor to a bind spec, the destination
// flag, and the source location to quote when moving OUT of it.
//   { kind: "hangar" }                     the docked station hangar
//   { kind: "cargo" }                      the active ship's cargo hold
//   { kind: "container", itemID }          a container in the hangar or cargo
//   { kind: "corp", division: 1..7 }       a corporation hangar division
async function resolvePlace(held, webSessionID, descriptor) {
  const kind = String((descriptor && descriptor.kind) || "");
  if (kind === "hangar") {
    return { spec: hangarBindSpec(held), flag: ITEM_FLAG_HANGAR, locationID: held.stationID };
  }
  if (kind === "cargo") {
    if (!held.activeShipID) {
      throw Object.assign(new Error("No active ship."), { code: "NO_ACTIVE_SHIP", status: 409 });
    }
    return {
      spec: cargoBindSpec(held, held.activeShipID),
      flag: ITEM_FLAG_CARGO_HOLD,
      locationID: held.activeShipID,
    };
  }
  if (kind === "container") {
    const containerID = Number(descriptor && descriptor.itemID) || 0;
    if (containerID <= 0) {
      throw Object.assign(new Error("A container is required."), {
        code: "INVALID_CONTAINER",
        status: 400,
      });
    }
    return {
      spec: containerBindSpec(containerID),
      flag: ITEM_FLAG_NONE,
      locationID: containerID,
    };
  }
  if (kind === "corp") {
    const division = Number(descriptor && descriptor.division) || 0;
    if (!isValidDivision(division)) {
      throw Object.assign(new Error("A corporation hangar division is required."), {
        code: "INVALID_DIVISION",
        status: 400,
      });
    }
    const officeID = await readCorpOffice(held, webSessionID);
    if (!officeID) {
      throw Object.assign(
        new Error("Your corporation has no office at this station."),
        { code: "NO_CORP_OFFICE", status: 409 },
      );
    }
    // locationID is deliberately null: the office's PUBLISHED id is not where
    // items sit, so a move OUT of a division must read the row's own location.
    return {
      spec: corpOfficeBindSpec(officeID),
      flag: corpDivisionFlag(division),
      locationID: null,
      division,
    };
  }
  throw Object.assign(new Error("Unknown inventory location."), {
    code: "INVALID_LOCATION",
    status: 400,
  });
}

// List a place. A container lists with NO flag argument at all; everything else
// is flag-scoped.
async function listPlace(held, webSessionID, place) {
  const args = place.flag === ITEM_FLAG_NONE ? [] : [place.flag];
  const outcome = await boundCall(held, webSessionID, place.spec, "List", args, null);
  return decodeInventoryRows(outcome.result);
}

function sendPlaceError(res, error) {
  if (error && error.status) {
    res.status(error.status).json({ ok: false, error: error.code, message: error.message });
    return true;
  }
  return false;
}

// Open a container and list its contents. THE RULE: a container binding is
// listed with NO flag — its contents carry flagID 0, so a flag-scoped List
// would answer empty and the container would look wrongly empty.
app.get("/api/bridge/inventory/container/:itemID", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const containerID = Number(req.params.itemID) || 0;
  if (containerID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_CONTAINER", message: "A container is required." });
    return;
  }
  const spec = containerBindSpec(containerID);
  try {
    const [list, capacity] = await Promise.allSettled([
      boundCall(held, req.webSessionID, spec, "List", [], null),
      boundCall(held, req.webSessionID, spec, "GetCapacity", [], null),
    ]);
    for (const settled of [list, capacity]) {
      if (settled.status === "rejected" && settled.reason && settled.reason.code === "SESSION_NOT_FOUND") {
        next(settled.reason);
        return;
      }
    }
    if (list.status === "rejected") {
      next(list.reason);
      return;
    }
    res.json({
      ok: true,
      containerID,
      list: list.value.result,
      // A container that reports no capacity is still browsable; the panel
      // simply omits the gauge.
      capacity: capacity.status === "fulfilled" ? capacity.value.result : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * The general move. One route carries split, multi-select move, and every
 * hangar/cargo/container/corp-division combination, because they are all the
 * same retail call with different arguments:
 *   one item  + qty   -> Add(itemID, sourceLocationID, {qty, flag})   (a SPLIT)
 *   many items        -> MultiAdd(itemIDs, sourceLocationID, {flag})
 *
 * The response reports what ACTUALLY moved. invbroker declines silently in
 * several branches (source-location mismatch, no room, a rig, a corp division
 * the character cannot take from) — it returns null WITHOUT raising — so a 200
 * is never treated as proof. The destination is re-read and the caller is told
 * which items landed and which did not.
 */
app.post("/api/bridge/inventory/transfer", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemIDs = (Array.isArray(body.itemIDs) ? body.itemIDs : [body.itemID])
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0);
  const qty = Number(body.qty);
  const hasQty = Number.isSafeInteger(qty) && qty > 0;
  if (itemIDs.length === 0) {
    res.status(400).json({ ok: false, error: "INVALID_MOVE", message: "At least one item is required." });
    return;
  }
  if (hasQty && itemIDs.length > 1) {
    res.status(400).json({
      ok: false,
      error: "INVALID_SPLIT",
      message: "A quantity can only be given when moving a single stack.",
    });
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const from = await resolvePlace(held, req.webSessionID, body.from);
    const to = await resolvePlace(held, req.webSessionID, body.to);

    // Read the source FIRST. This is what supplies the source location for a
    // corp division (whose published office id is not the items' location), and
    // the before-quantity a split is judged against.
    const sourceRowsBefore = await listPlace(held, req.webSessionID, from);
    const sourceByID = new Map(sourceRowsBefore.map((row) => [row.itemID, row]));
    const missing = itemIDs.filter((itemID) => !sourceByID.has(itemID));
    if (missing.length === itemIDs.length) {
      res.status(409).json({
        ok: false,
        error: "ITEMS_NOT_AT_SOURCE",
        message: "Those items are no longer where the panel last saw them; refresh and try again.",
      });
      return;
    }
    const present = itemIDs.filter((itemID) => sourceByID.has(itemID));
    // Quote the source location the ITEMS report, never an assumed one.
    const sourceLocationID =
      from.locationID !== null && from.locationID !== undefined
        ? from.locationID
        : sourceByID.get(present[0]).locationID;

    const kwargs = { flag: to.flag };
    let outcome;
    // A THROW IS NOT PROOF OF FAILURE, exactly as a 200 is not proof of
    // success. Looting an NPC wreck raises after the item has already moved
    // (eve.js nativeNpcWreckService.js:222 calls a scene method that does not
    // exist, but only once the transfer itself is done). Measured live: five
    // consecutive loot calls each answered CALL_FAILED and all five items were
    // in the cargo hold afterwards. So the dispatch error is REMEMBERED, not
    // rethrown here, and the re-read below decides. If the re-read shows
    // nothing moved, the original error is raised unchanged.
    let dispatchError = null;
    try {
      if (present.length === 1 && hasQty) {
        outcome = await boundCall(
          held,
          req.webSessionID,
          to.spec,
          "Add",
          [present[0], sourceLocationID],
          { ...kwargs, qty },
        );
      } else if (present.length === 1) {
        outcome = await boundCall(
          held,
          req.webSessionID,
          to.spec,
          "Add",
          [present[0], sourceLocationID],
          kwargs,
        );
      } else {
        outcome = await boundCall(
          held,
          req.webSessionID,
          to.spec,
          "MultiAdd",
          [present, sourceLocationID],
          kwargs,
        );
      }
    } catch (error) {
      dispatchError = error;
      outcome = { notifications: [] };
    }

    // RE-READ. The status code above proves only that the call was dispatched.
    const [destinationRows, sourceRowsAfter] = await Promise.all([
      listPlace(held, req.webSessionID, to),
      listPlace(held, req.webSessionID, from),
    ]);
    const destinationIDs = new Set(destinationRows.map((row) => row.itemID));
    const sourceAfterByID = new Map(sourceRowsAfter.map((row) => [row.itemID, row]));

    // Items that kept their identity and are now at the destination. This is
    // the ONLY signal the route used to have, and it is the one that fails.
    const moved = present.filter((itemID) => destinationIDs.has(itemID));

    // THE SOURCE IS THE AUTHORITY, not the destination. Three different server
    // paths mint a NEW itemID at the destination and so can never appear in
    // `moved`, all three measured live against this emulator:
    //   * looting a wreck   — the wreck row is destroyed and a fresh row is
    //                         minted in the cargo hold (5/5 items, new ids)
    //   * splitting a stack — the source keeps its id and shrinks
    //   * fitting from a stack / loading ammo — one unit peels off as a new row
    // What every one of them has in common is that the SOURCE gave something
    // up: the row vanished, or its quantity fell. That is what `applied` now
    // asks. Judging by destination membership alone reported `applied:false`
    // on a completed move and would have told the player their loot was lost.
    const gaveUpAtSource = (itemID) => {
      const before = sourceByID.get(itemID);
      if (!before) {
        return false;
      }
      const after = sourceAfterByID.get(itemID);
      if (!after) {
        return true; // the row is gone from the source entirely
      }
      return (after.quantity ?? 0) < (before.quantity ?? 0);
    };
    const surrendered = present.filter(gaveUpAtSource);
    const applied = moved.length > 0 || surrendered.length > 0;

    // Nothing left the source AND nothing arrived: the server took the call and
    // did nothing, which is the silent-decline shape this bridge exists to
    // catch. Only now is a dispatch error a real failure.
    if (!applied && dispatchError) {
      throw dispatchError;
    }

    const declined = present.filter(
      (itemID) => !destinationIDs.has(itemID) && !gaveUpAtSource(itemID),
    );

    res.json({
      ok: true,
      applied,
      moved,
      // Items that left the source but arrived under a NEW id, so the caller
      // knows the move landed even though `moved` cannot name them.
      reminted: surrendered.filter((itemID) => !destinationIDs.has(itemID)),
      // Items the server did not move, and no reason was given: say exactly
      // that rather than inventing a cause.
      declined,
      declinedSilently: !applied && declined.length > 0,
      notFound: missing,
      notifications: outcome.notifications,
    });
  } catch (error) {
    if (sendPlaceError(res, error)) {
      return;
    }
    next(error);
  }
});

// Re-merge one stack into another of the same type (retail's drag-onto-stack).
// MultiMerge takes (ops, sourceContainerID) with each op [source, dest, qty].
app.post("/api/bridge/inventory/merge", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const sourceItemID = Number(body.sourceItemID) || 0;
  const destinationItemID = Number(body.destinationItemID) || 0;
  if (sourceItemID <= 0 || destinationItemID <= 0 || sourceItemID === destinationItemID) {
    res.status(400).json({
      ok: false,
      error: "INVALID_MERGE",
      message: "Two different stacks are required to merge.",
    });
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const place = await resolvePlace(held, req.webSessionID, body.place);
    const rowsBefore = await listPlace(held, req.webSessionID, place);
    const source = rowsBefore.find((row) => row.itemID === sourceItemID);
    const destination = rowsBefore.find((row) => row.itemID === destinationItemID);
    if (!source || !destination) {
      res.status(409).json({
        ok: false,
        error: "ITEMS_NOT_AT_SOURCE",
        message: "Those stacks are no longer where the panel last saw them; refresh and try again.",
      });
      return;
    }
    const requested = Number(body.qty);
    const quantity =
      Number.isSafeInteger(requested) && requested > 0 && requested <= source.quantity
        ? requested
        : source.quantity;
    const containerID =
      place.locationID !== null && place.locationID !== undefined
        ? place.locationID
        : source.locationID;
    const outcome = await boundCall(
      held,
      req.webSessionID,
      place.spec,
      "MultiMerge",
      [[[sourceItemID, destinationItemID, quantity]], containerID],
      null,
    );
    // Re-read: the destination should have GROWN by the merged quantity.
    const rowsAfter = await listPlace(held, req.webSessionID, place);
    const destinationAfter = rowsAfter.find((row) => row.itemID === destinationItemID);
    const applied = Boolean(destinationAfter) && destinationAfter.quantity > destination.quantity;
    res.json({
      ok: true,
      applied,
      merged: applied ? destinationAfter.quantity - destination.quantity : 0,
      declinedSilently: !applied,
      notifications: outcome.notifications,
    });
  } catch (error) {
    if (sendPlaceError(res, error)) {
      return;
    }
    next(error);
  }
});

/**
 * DESTROY items. This is irreversible, so — exactly as R12 fenced the rig
 * destroy — the route refuses outright unless `confirm` is true, and the web UI
 * puts a two-step confirm in front of that. TrashItems dispatches on the
 * inventory MANAGER moniker, not on a per-container binding.
 */
app.post("/api/bridge/inventory/trash", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemIDs = (Array.isArray(body.itemIDs) ? body.itemIDs : [body.itemID])
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0);
  if (itemIDs.length === 0) {
    res.status(400).json({ ok: false, error: "INVALID_TRASH", message: "At least one item is required." });
    return;
  }
  if (body.confirm !== true) {
    res.status(400).json({
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      message: "Trashing destroys these items permanently. This action must be confirmed explicitly.",
    });
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const place = await resolvePlace(held, req.webSessionID, body.place);
    const rowsBefore = await listPlace(held, req.webSessionID, place);
    const beforeIDs = new Set(rowsBefore.map((row) => row.itemID));
    const present = itemIDs.filter((itemID) => beforeIDs.has(itemID));
    if (present.length === 0) {
      res.status(409).json({
        ok: false,
        error: "ITEMS_NOT_AT_SOURCE",
        message: "Those items are no longer where the panel last saw them; refresh and try again.",
      });
      return;
    }
    const locationID =
      place.locationID !== null && place.locationID !== undefined
        ? place.locationID
        : rowsBefore.find((row) => row.itemID === present[0]).locationID;
    const outcome = await boundCall(
      held,
      req.webSessionID,
      inventoryManagerBindSpec(held),
      "TrashItems",
      [present, locationID],
      null,
    );
    // Re-read: the handler declines an untrashable item (an active ship, a
    // locked corp asset) by returning without raising, so only the listing
    // proves anything was destroyed.
    const rowsAfter = await listPlace(held, req.webSessionID, place);
    const afterIDs = new Set(rowsAfter.map((row) => row.itemID));
    const destroyed = present.filter((itemID) => !afterIDs.has(itemID));
    const survived = present.filter((itemID) => afterIDs.has(itemID));
    res.json({
      ok: true,
      applied: destroyed.length > 0,
      destroyed,
      survived,
      declinedSilently: survived.length > 0,
      notifications: outcome.notifications,
    });
  } catch (error) {
    if (sendPlaceError(res, error)) {
      return;
    }
    next(error);
  }
});

/**
 * The corporation hangar: which office, what the seven divisions are CALLED,
 * and what is in each one. Every division is read independently
 * (Promise.allSettled) so a division the character lacks the query role for
 * never blanks the rest — the server answers an empty list for those, and it
 * stays authoritative. The client's own role check is cosmetic.
 */
app.get("/api/bridge/inventory/corp", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const [officeSettled, corporationSettled] = await Promise.allSettled([
      readCorpOffice(held, req.webSessionID),
      heldTopLevelCall(held, req.webSessionID, "corpRegistry", "GetCorporation", [], null),
    ]);
    for (const settled of [officeSettled, corporationSettled]) {
      if (settled.status === "rejected" && settled.reason && settled.reason.code === "SESSION_NOT_FOUND") {
        next(settled.reason);
        return;
      }
    }
    const divisionNames =
      corporationSettled.status === "fulfilled"
        ? decodeDivisionNames(corporationSettled.value.result)
        : {};
    const officeID = officeSettled.status === "fulfilled" ? officeSettled.value : 0;
    if (!officeID) {
      res.json({
        ok: true,
        available: false,
        // Not an error: plenty of characters simply have no corp office here.
        reason:
          officeSettled.status === "rejected"
            ? String((officeSettled.reason && officeSettled.reason.code) || "READ_FAILED")
            : "NO_CORP_OFFICE",
        divisions: [],
      });
      return;
    }
    const spec = corpOfficeBindSpec(officeID);
    const ordinals = [];
    for (let division = 1; division <= CORP_DIVISION_COUNT; division += 1) {
      ordinals.push(division);
    }
    const settledLists = await Promise.allSettled(
      ordinals.map((division) =>
        boundCall(held, req.webSessionID, spec, "List", [corpDivisionFlag(division)], null),
      ),
    );
    for (const settled of settledLists) {
      if (settled.status === "rejected" && settled.reason && settled.reason.code === "SESSION_NOT_FOUND") {
        next(settled.reason);
        return;
      }
    }
    res.json({
      ok: true,
      available: true,
      divisions: ordinals.map((division, index) => {
        const settled = settledLists[index];
        return {
          division,
          // The player-authored name; the browser falls back to "Division N"
          // when a corporation never renamed it. A flag number is never shown.
          name: divisionNames[division] || null,
          list: settled.status === "fulfilled" ? settled.value.result : null,
          error:
            settled.status === "rejected"
              ? String((settled.reason && settled.reason.code) || "READ_FAILED")
              : null,
        };
      }),
    });
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

/**
 * Did a fit land? The named itemID is checked first, then — because fitting a
 * unit out of a STACK mints a new row the caller cannot predict — whether any
 * slot that was empty before is occupied now.
 *
 * Both maps are itemID -> flagID, so "a slot filled" is read as a flagID that
 * was not present before. This is the same mint-at-destination problem the
 * inventory transfer route hits with wreck loot, answered the same way: judge
 * the OUTCOME, never the identity of the row.
 */
function fitLanded(before, after, itemID) {
  if (after.has(itemID)) {
    return true;
  }
  const occupiedBefore = new Set(before.values());
  for (const flagID of after.values()) {
    if (!occupiedBefore.has(flagID)) {
      return true;
    }
  }
  return false;
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
    // The slots BEFORE, so a fit that arrives under a new itemID is still
    // recognised. Fitting ONE module out of a STACK peels a unit off and mints
    // a fresh row: measured live, fitting two turrets from a stack of three
    // produced ids the caller had never seen while the stack fell 3 -> 1, and
    // judging by `fitted.has(itemID)` called both successful fits a failure.
    const before = await readFittedItemIDs(held, req.webSessionID, shipID);
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
      applied: fitLanded(before, fitted, itemID),
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

// --- R15 Industry (blueprints / jobs / facilities) -------------------------
// Unlike every panel before it, industry needs NO bound-object machinery: the
// whole retail surface is TOP-LEVEL (sm.RemoteSvc('blueprintManager') /
// ('industryManager') / ('facilityManager')), so heldTopLevelCall carries all
// of it. See docs/bridge-wire-contract.md for the call table.
//
// The split between live calls and static data:
//   LIVE  — the player's own blueprint INSTANCES (material/time efficiency,
//           runs left, where they sit, whether one is busy in a job), their
//           JOBS, their used job slots, and the FACILITIES their region offers
//           with each one's tax and supported activities.
//   STATIC — every NAME and every recipe: what a blueprint is called, what it
//           produces, what each activity consumes and how long it takes, and
//           what a facility/solar system is called. None of that changes with
//           the player, so it never needs a round-trip.

app.get("/api/bridge/industry", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    // Sync held station/system to the live position first, so the facility
    // read reflects where the character actually is.
    await readHeldFlight(held, req.webSessionID);
    const ownerID = held.characterID;
    // Five INDEPENDENT reads (R2's rule): one failure never blanks the rest.
    // A player with no facilities in range should still see their blueprints.
    const [blueprints, jobs, jobCounts, facilities, modifiers] = await Promise.allSettled([
      heldTopLevelCall(held, req.webSessionID, "blueprintManager", "GetBlueprintDataByOwner", [ownerID, null], null),
      // includeCompleted=true: the panel shows finished work alongside running
      // work, and filters client-side by the status the SERVER computed.
      heldTopLevelCall(held, req.webSessionID, "industryManager", "GetJobsByOwner", [ownerID, true], null),
      heldTopLevelCall(held, req.webSessionID, "industryManager", "GetJobCounts", [ownerID], null),
      heldTopLevelCall(held, req.webSessionID, "facilityManager", "GetFacilities", [], null),
      heldTopLevelCall(held, req.webSessionID, "facilityManager", "GetMaxActivityModifiers", [], null),
    ]);

    for (const settled of [blueprints, jobs, jobCounts, facilities, modifiers]) {
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
      ownerID,
      stationID: held.stationID,
      solarSystemID: held.solarSystemID ?? null,
      blueprints: { result: settledValue(blueprints), error: settledCode(blueprints) },
      jobs: { result: settledValue(jobs), error: settledCode(jobs) },
      jobCounts: { result: settledValue(jobCounts), error: settledCode(jobCounts) },
      facilities: { result: settledValue(facilities), error: settledCode(facilities) },
      activityModifiers: { result: settledValue(modifiers), error: settledCode(modifiers) },
    });
  } catch (error) {
    next(error);
  }
});

// --- R15 Industry mutations (install / deliver / cancel) --------------------
//
// The browser names an ACTIVITY, never an activityID — the same rule R14 used
// for inventory places and R12 for slot families. This map is the only place
// the number exists on the BFF, and it never crosses the wire in either
// direction.
const INDUSTRY_ACTIVITY_IDS = Object.freeze({
  manufacturing: 1,
  research_time: 3,
  research_material: 4,
  copying: 5,
  invention: 8,
  reaction: 9,
});
// industry job status codes, for judging what a mutation actually did.
const INDUSTRY_STATUS_DELIVERED = 101;
const INDUSTRY_STATUS_CANCELLED = 102;
// Retail's own ceiling on a single job; a runs value beyond it is a typo, and
// rejecting it here makes that a clear 400 instead of a server refusal.
const INDUSTRY_MAX_RUNS = 1_000_000;

/**
 * Resolve the input/output hangars an install will use.
 *
 * `GetFacilityLocations(facilityID, ownerID)` answers the CHOICES; the input
 * must be one the character may TAKE from. Passing a location explicitly is
 * optional — the server falls back to the first usable one — but resolving it
 * here means the preview and the install agree about where the materials are
 * coming from, which is the whole point of showing the player a preview.
 *
 * ⚠ The fields live in `header[2]` as {type:"dict", entries:[...]}, NOT in the
 * top-level `dict` (which is empty). See docs/bridge-wire-contract.md.
 */
function decodeFacilityLocationChoices(result) {
  const items = result && Array.isArray(result.items) ? result.items : [];
  const choices = [];
  for (const item of items) {
    if (!item || item.type !== "objectex1" || !Array.isArray(item.header)) {
      continue;
    }
    const stateDict = item.header[2];
    const entries = stateDict && Array.isArray(stateDict.entries) ? stateDict.entries : [];
    const fields = {};
    for (const entry of entries) {
      if (Array.isArray(entry) && typeof entry[0] === "string") {
        fields[entry[0]] = entry[1];
      }
    }
    const itemID = Number(fields.itemID) || 0;
    if (itemID > 0) {
      choices.push({
        itemID,
        typeID: Number(fields.typeID) || 0,
        ownerID: Number(fields.ownerID) || 0,
        flagID: Number(fields.flagID) || 0,
        solarSystemID: Number(fields.solarSystemID) || 0,
        canView: fields.canView !== false,
        canTake: fields.canTake !== false,
      });
    }
  }
  return choices;
}

async function readIndustryLocations(held, webSessionID, facilityID) {
  const outcome = await heldTopLevelCall(
    held,
    webSessionID,
    "facilityManager",
    "GetFacilityLocations",
    [facilityID, held.characterID],
    null,
  );
  const choices = decodeFacilityLocationChoices(outcome.result);
  return {
    choices,
    // The input must be takeable; the output need not be.
    input: choices.find((choice) => choice.canTake !== false) || choices[0] || null,
    output: choices[0] || null,
  };
}

/**
 * The InstallJob payload — ONE POSITIONAL DICT, the shape
 * `industry.Job.dump()` produces and `parseIndustryRequest` reads.
 *
 * ⚠ WHAT THE SERVER ACTUALLY READS. It recomputes materials, time and cost
 * from the blueprint definition plus the facility's modifiers, so `cost` /
 * `tax` / `time` / `materials` here are ADVISORY — sending them wrong does not
 * change what gets charged, and sending them right does not make them
 * authoritative. The fields that genuinely decide the outcome are
 * `blueprintID`, `activityID`, `facilityID`, `runs` (plus `licensedRuns` for
 * copying, `productTypeID` for invention, and the two locations). They are all
 * sent anyway because the shape is the retail one and a partial dict is a
 * worse contract than a complete one.
 */
function buildInstallJobPayload(held, request) {
  return {
    blueprintID: request.blueprintItemID,
    blueprintTypeID: request.blueprintTypeID || 0,
    activityID: request.activityID,
    facilityID: request.facilityID,
    solarSystemID: held.solarSystemID || 0,
    characterID: held.characterID,
    corporationID: 0,
    // Personal industry only: the wallet charge takes the character path, for
    // which `account` is unused. A corporation install would need the
    // (ownerID, walletKey) pair here.
    account: null,
    runs: request.runs,
    licensedRuns: request.licensedRuns,
    cost: 0,
    tax: 0,
    time: 0,
    materials: {},
    inputLocation: request.inputLocation,
    outputLocation: request.outputLocation,
    productTypeID: request.productTypeID || 0,
    optionalTypeID: null,
    optionalTypeID2: null,
  };
}

/**
 * Validate the browser's install/preview request. Returns a normalized request
 * or null (having already answered a 400).
 */
function normalizeIndustryRequest(req, res) {
  const body = req.body || {};
  const blueprintItemID = Number(body.blueprintItemID) || 0;
  const facilityID = Number(body.facilityID) || 0;
  const runs = Number(body.runs) || 0;
  const activity = String(body.activity || "");
  const activityID = INDUSTRY_ACTIVITY_IDS[activity] || 0;
  if (blueprintItemID <= 0) {
    res.status(400).json({
      ok: false,
      error: "INVALID_BLUEPRINT",
      message: "A blueprint is required.",
    });
    return null;
  }
  if (activityID <= 0) {
    res.status(400).json({
      ok: false,
      error: "INVALID_ACTIVITY",
      message: "A known kind of industry work is required.",
    });
    return null;
  }
  if (facilityID <= 0) {
    res.status(400).json({
      ok: false,
      error: "INVALID_FACILITY",
      message: "A facility to do the work at is required.",
    });
    return null;
  }
  if (!Number.isSafeInteger(runs) || runs <= 0 || runs > INDUSTRY_MAX_RUNS) {
    res.status(400).json({
      ok: false,
      error: "INVALID_RUNS",
      message: "A positive number of runs is required.",
    });
    return null;
  }
  const licensedRuns = Number(body.licensedRuns) || 1;
  return {
    blueprintItemID,
    blueprintTypeID: Number(body.blueprintTypeID) || 0,
    activity,
    activityID,
    facilityID,
    runs,
    licensedRuns: licensedRuns > 0 ? licensedRuns : 1,
    productTypeID: Number(body.productTypeID) || 0,
  };
}

/**
 * The install PREVIEW: what the player actually HAS of each material this job
 * would consume, straight from the server.
 *
 * `industryMonitor.ConnectJob` is retail's own preview seam. It is NOT a pure
 * read — it persists a monitor row — so this route always releases the monitor
 * it opened, whatever happens.
 *
 * ⚠ WHAT THIS CANNOT TELL THE PLAYER: the installation FEE. No allowlisted
 * retail call quotes a cost without also installing the job, so the ISK figure
 * genuinely cannot be previewed. The panel says so plainly rather than showing
 * an invented estimate, and the install response reports the cost the server
 * actually charged.
 */
app.post("/api/bridge/industry/preview", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const request = normalizeIndustryRequest(req, res);
  if (!request) {
    return;
  }
  let monitorID = 0;
  try {
    await readHeldFlight(held, req.webSessionID);
    const locations = await readIndustryLocations(held, req.webSessionID, request.facilityID);
    const payload = buildInstallJobPayload(held, {
      ...request,
      inputLocation: locations.input,
      outputLocation: locations.output,
    });
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "industryMonitor",
      "ConnectJob",
      [payload],
      null,
    );
    // [monitorID, dict<typeID -> availableQuantity>]
    const result = Array.isArray(outcome.result) ? outcome.result : [];
    monitorID = Number(result[0]) || 0;
    const dict = result[1];
    const entries = dict && Array.isArray(dict.entries) ? dict.entries : [];
    const available = {};
    for (const entry of entries) {
      if (Array.isArray(entry)) {
        available[String(Number(entry[0]) || 0)] = Number(entry[1]) || 0;
      }
    }
    res.json({
      ok: true,
      available,
      inputLocation: locations.input,
      outputLocation: locations.output,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  } finally {
    if (monitorID > 0) {
      // Best-effort release: a leaked monitor row is harmless but untidy, and
      // failing to release must never turn a good preview into an error.
      try {
        await heldTopLevelCall(
          held,
          req.webSessionID,
          "industryMonitor",
          "DisconnectJob",
          [monitorID],
          null,
        );
      } catch {
        // Ignored on purpose (see above).
      }
    }
  }
});

/**
 * INSTALL a job. This CONSUMES MATERIALS out of a hangar and CHARGES THE
 * WALLET, so the route refuses outright without an explicit `confirm: true` —
 * the second gate behind the UI's two-step confirm, exactly as `destroy-rig`
 * (R12) and `trash` (R14) are fenced.
 *
 * The R12/R14 lesson applies: a 200 is not proof. The route re-reads the job
 * AND the blueprint and reports what actually applied.
 */
app.post("/api/bridge/industry/install", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const request = normalizeIndustryRequest(req, res);
  if (!request) {
    return;
  }
  if ((req.body || {}).confirm !== true) {
    res.status(400).json({
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      message:
        "Installing a job spends materials and charges an installation fee. This action must be confirmed explicitly.",
    });
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const locations = await readIndustryLocations(held, req.webSessionID, request.facilityID);
    const payload = buildInstallJobPayload(held, {
      ...request,
      inputLocation: locations.input,
      outputLocation: locations.output,
    });
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "industryManager",
      "InstallJob",
      [payload],
      null,
    );
    const jobID = Number(outcome.result) || 0;
    if (jobID <= 0) {
      // A SILENT DECLINE: the handler answered without raising and without
      // starting a job. Saying exactly that is honest; naming a cause would be
      // a guess, and the server did not give one.
      res.json({
        ok: true,
        applied: false,
        declinedSilently: true,
        jobID: null,
        job: null,
        blueprint: null,
        notifications: outcome.notifications,
      });
      return;
    }
    // Re-read BOTH: the job proves it exists and carries the cost the server
    // really charged, and the blueprint proves it is now locked into that job.
    const [jobSettled, blueprintSettled] = await Promise.allSettled([
      heldTopLevelCall(held, req.webSessionID, "industryManager", "GetJob", [jobID], null),
      heldTopLevelCall(
        held,
        req.webSessionID,
        "blueprintManager",
        "GetBlueprintData",
        [request.blueprintItemID],
        null,
      ),
    ]);
    res.json({
      ok: true,
      applied: true,
      declinedSilently: false,
      jobID,
      job: jobSettled.status === "fulfilled" ? jobSettled.value.result : null,
      blueprint: blueprintSettled.status === "fulfilled" ? blueprintSettled.value.result : null,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELIVER a finished job (`CompleteJob(jobID, solarSystemID)`) — this is what
 * hands the products over. Not gated behind a confirm: it only ever gives the
 * player something.
 *
 * `applied` comes from the RE-READ, not from the response: a job that was not
 * ready, or that another client already delivered, can come back without the
 * status having moved.
 */
app.post("/api/bridge/industry/deliver", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const jobID = Number((req.body || {}).jobID) || 0;
  if (jobID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_JOB", message: "A job is required." });
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "industryManager",
      "CompleteJob",
      [jobID, held.solarSystemID || 0],
      null,
    );
    const after = await heldTopLevelCall(
      held,
      req.webSessionID,
      "industryManager",
      "GetJob",
      [jobID],
      null,
    );
    const status = readIndustryJobStatus(after.result);
    const applied = status === INDUSTRY_STATUS_DELIVERED;
    res.json({
      ok: true,
      applied,
      declinedSilently: !applied,
      jobID,
      job: after.result,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * CANCEL a job. Cancelling stops the work and returns the blueprint, but
 * refunds NEITHER the materials NOR the installation fee — both stay spent —
 * so it is fenced behind the same explicit `confirm: true` the install is, and
 * the UI says what will be lost before asking.
 */
app.post("/api/bridge/industry/cancel", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const jobID = Number(body.jobID) || 0;
  if (jobID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_JOB", message: "A job is required." });
    return;
  }
  if (body.confirm !== true) {
    res.status(400).json({
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      message:
        "Cancelling a job does not return its materials or its installation fee. This action must be confirmed explicitly.",
    });
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "industryManager",
      "CancelJob",
      [jobID, held.solarSystemID || 0],
      null,
    );
    const after = await heldTopLevelCall(
      held,
      req.webSessionID,
      "industryManager",
      "GetJob",
      [jobID],
      null,
    );
    const applied = readIndustryJobStatus(after.result) === INDUSTRY_STATUS_CANCELLED;
    res.json({
      ok: true,
      applied,
      declinedSilently: !applied,
      jobID,
      job: after.result,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

// --- R16 Market (order books, own orders, transactions, escrow) ------------
//
// ⚠ THE SERVICE IS "marketProxy". EveJS registers TWO market services and the
// obvious name is the wrong one: `market` (marketService.js) is a DEAD STUB
// whose every method answers an empty rowset. `marketProxy`
// (marketProxyService.js) is the real implementation — daemon-backed order
// books, escrow, broker fees, real wallet debits. Calling `market` would give
// the player a market page that renders perfectly and is permanently empty.
// Every call below names marketProxy; the gateway allowlist refuses `market`.
//
// ⚠ THERE IS NO SERVER `marketQuote`. Sorting, jump filtering, best-bid
// matching and skill-gated order limits are CLIENT-side in retail, so they are
// client-side here too (web/src/bridge/market.ts). Do not go looking for a
// call.
//
// ⚠ AN EXTERNAL DAEMON BACKS THIS. marketProxy talks to a market daemon over
// TCP 127.0.0.1:40111. When it is down, reads THROW rather than answering
// empty — which is what lets this route tell the browser "the market is not
// answering" instead of "nobody is trading this item". The two are different
// facts and the panel says which one happened.
//
// Like industry, market needs NO bound-object machinery: the whole surface is
// top-level (sm.ProxySvc('marketProxy')), so heldTopLevelCall carries it all.
//
// SCOPE, and why the browser cannot widen it: every read below is scoped by the
// SESSION the gateway materialized — region for the order book, character for
// the own-orders/transactions/escrow reads. The only argument any of them takes
// is a typeID. There is no owner parameter to tamper with.

/**
 * The daemon-outage code, told apart from an ordinary read failure so the panel
 * can say something true about which one happened.
 */
function isMarketUnavailable(error) {
  const text = String((error && (error.message || error.detail)) || "");
  return text.includes("MarketUnavailable") || text.includes("market daemon");
}

app.get("/api/bridge/market", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  // A typeID is OPTIONAL: the player's own orders, transactions and escrow are
  // worth showing before they have picked an item to look at.
  const typeID = Number(req.query.typeID) || 0;
  try {
    // Sync the held station/system to the live position first: the order book's
    // `jumps` column is computed from where the character actually is.
    await readHeldFlight(held, req.webSessionID);

    // Six INDEPENDENT reads (R2's rule): one failure never blanks the rest. A
    // player whose order book fails to load still sees their own orders and
    // their ISK.
    const [book, ownOrders, history, transactions, escrow, balance, priceHistory] =
      await Promise.allSettled([
        typeID > 0
          ? heldTopLevelCall(held, req.webSessionID, "marketProxy", "GetOrders", [typeID], null)
          : Promise.resolve({ result: null }),
        heldTopLevelCall(held, req.webSessionID, "marketProxy", "GetCharOrders", [], null),
        heldTopLevelCall(held, req.webSessionID, "marketProxy", "GetMarketOrderHistory", [], null),
        // fromDate 0 = everything the server still keeps.
        heldTopLevelCall(held, req.webSessionID, "marketProxy", "CharGetTransactions", [0], null),
        heldTopLevelCall(held, req.webSessionID, "marketProxy", "GetCharEscrow", [], null),
        // Already allowlisted since R6. The wallet sits beside the order book
        // so the player can see what they have before they spend it.
        heldTopLevelCall(held, req.webSessionID, "account", "GetCashBalance", [0], null),
        typeID > 0
          ? heldTopLevelCall(held, req.webSessionID, "marketProxy", "GetNewPriceHistory", [typeID], null)
          : Promise.resolve({ result: null }),
      ]);

    const settled = [book, ownOrders, history, transactions, escrow, balance, priceHistory];
    for (const entry of settled) {
      if (entry.status === "rejected" && entry.reason && entry.reason.code === "SESSION_NOT_FOUND") {
        next(entry.reason);
        return;
      }
    }

    const codeOf = (entry) =>
      entry.status === "rejected"
        ? String((entry.reason && entry.reason.code) || "READ_FAILED")
        : null;
    const valueOf = (entry) => (entry.status === "fulfilled" ? entry.value.result : null);

    // ⚠ The daemon-outage signal, extracted ONCE across every read: if the
    // market itself is not answering, saying "you have no orders" would be a
    // lie. The panel gets told which it is.
    const outage = settled.find(
      (entry) => entry.status === "rejected" && isMarketUnavailable(entry.reason),
    );

    res.json({
      ok: true,
      typeID: typeID > 0 ? typeID : null,
      characterID: held.characterID,
      stationID: held.stationID,
      solarSystemID: held.solarSystemID ?? null,
      book: { result: valueOf(book), error: codeOf(book) },
      ownOrders: { result: valueOf(ownOrders), error: codeOf(ownOrders) },
      orderHistory: { result: valueOf(history), error: codeOf(history) },
      transactions: { result: valueOf(transactions), error: codeOf(transactions) },
      escrow: { result: valueOf(escrow), error: codeOf(escrow) },
      cashBalance: { result: valueOf(balance), error: codeOf(balance) },
      priceHistory: { result: valueOf(priceHistory), error: codeOf(priceHistory) },
      marketUnavailable: outage
        ? "The market is not answering right now, so these figures may be incomplete."
        : null,
    });
  } catch (error) {
    next(error);
  }
});

// --- R16 Market mutations (place buy / place sell / cancel / modify) -------
//
// ⚠ THIS IS THE FIRST FEATURE THAT SPENDS THE PLAYER'S ISK. Every route below
// runs a handler that calls debitCharacterWallet / creditCharacterWallet for
// real, writes escrow records, and charges a broker's fee and an SCC
// surcharge. So all four are fenced the way R12's destroy-rig, R14's trash and
// R15's install are: NO route acts without an explicit `confirm: true`, and the
// web UI puts a two-step confirm in front of that showing the item, price x
// quantity, the ESTIMATED broker's fee and the player's current ISK.
//
// ⚠ AND A 200 IS NOT PROOF (the R12/R14/R15 lesson). Every route below re-reads
// the WALLET before and after and reports the difference, plus re-reads the
// player's own orders. `charged` is that difference and nothing else — it is
// the only authoritative statement about what an order cost, and it is what the
// panel shows. The client's estimated fee never appears in a response.

// Retail's own ceiling (marketRules.MARKET_MAX_ORDER_PRICE): the ISK value at
// which the underlying scaled 64-bit representation overflows. Rejected here so
// a typo is a clear 400 instead of an opaque server refusal.
const MARKET_MAX_ORDER_PRICE = 9_223_372_036_854;
// The durations the server accepts (marketRules.ALLOWED_DURATIONS). 0 means
// "fill immediately or not at all" and creates no standing order.
const MARKET_ALLOWED_DURATIONS = new Set([0, 1, 3, 7, 14, 30, 90]);
// Order range sentinels. -1 = this station only; that is the default because a
// wider range is skill-gated and the server refuses one the character has not
// trained for.
const MARKET_RANGE_STATION = -1;

/** Round to 2dp exactly as the server's `roundIsk` does. */
function roundMarketPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100) / 100;
}

/**
 * Read the character's ISK. Used BEFORE and AFTER every write, because the
 * difference between the two is the only honest answer to "what did that
 * cost?" — the server's own fee arithmetic is not exposed by any allowlisted
 * read, and the client's estimate is an estimate.
 */
async function readMarketBalance(held, webSessionID) {
  try {
    const outcome = await heldTopLevelCall(
      held,
      webSessionID,
      "account",
      "GetCashBalance",
      [0],
      null,
    );
    return marketAmountString(outcome.result);
  } catch {
    // A wallet read that fails leaves `charged` null, which the panel reports
    // as "the server did not report a wallet change" rather than as a number.
    return null;
  }
}

/** An amount as a bigint-safe decimal string; null when absent/malformed. */
function marketAmountString(value) {
  if (value && typeof value === "object" && value.type === "long") {
    return String(value.value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return value;
  }
  return null;
}

/**
 * before - after, in exact hundredths. Positive = taken from the player,
 * negative = returned to them. Goes through BigInt, never a float: ISK exceeds
 * 2^53 and a float subtraction at that magnitude loses ISK.
 */
function marketIskDelta(before, after) {
  if (before === null || after === null) {
    return null;
  }
  const hundredths = (text) => {
    const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(String(text).trim());
    if (!match) {
      return null;
    }
    const frac = (match[3] || "").padEnd(2, "0").slice(0, 2);
    const value = BigInt(`${match[2] || "0"}${frac}`);
    return match[1] === "-" ? -value : value;
  };
  const left = hundredths(before);
  const right = hundredths(after);
  if (left === null || right === null) {
    return null;
  }
  const diff = left - right;
  const negative = diff < 0n;
  const magnitude = negative ? -diff : diff;
  return `${negative ? "-" : ""}${(magnitude / 100n).toString()}.${(magnitude % 100n)
    .toString()
    .padStart(2, "0")}`;
}

/** The confirm gate every market write sits behind. */
function requireMarketConfirmation(req, res, message) {
  if ((req.body || {}).confirm === true) {
    return true;
  }
  res.status(400).json({
    ok: false,
    error: "CONFIRMATION_REQUIRED",
    message,
  });
  return false;
}

/**
 * Validate a price the way the retail client does BEFORE dispatch: round to
 * 2dp, and reject anything above the market ceiling. Returns the rounded price,
 * or null having already answered a 400.
 */
function normalizeMarketPrice(req, res) {
  const raw = Number((req.body || {}).price);
  if (!Number.isFinite(raw) || raw <= 0) {
    res.status(400).json({
      ok: false,
      error: "INVALID_PRICE",
      message: "A price above zero is required.",
    });
    return null;
  }
  if (raw > MARKET_MAX_ORDER_PRICE) {
    res.status(400).json({
      ok: false,
      error: "PRICE_TOO_HIGH",
      message: "That price is higher than the market allows.",
    });
    return null;
  }
  const price = roundMarketPrice(raw);
  if (price <= 0) {
    res.status(400).json({
      ok: false,
      error: "INVALID_PRICE",
      message: "That price rounds down to nothing. The smallest price is 0.01 ISK.",
    });
    return null;
  }
  return price;
}

/**
 * Re-read the player's own orders after a write — the proof half. A response
 * saying "ok" proves nothing; this is what the panel judges `applied` against.
 */
async function readOwnOrdersQuietly(held, webSessionID) {
  try {
    const outcome = await heldTopLevelCall(
      held,
      webSessionID,
      "marketProxy",
      "GetCharOrders",
      [],
      null,
    );
    return outcome.result;
  } catch {
    return null;
  }
}

/**
 * PLACE A BUY ORDER.
 *
 * `PlaceBuyOrder([stationID, typeID, price, quantity, orderRange, minVolume,
 *                 duration, useCorp, expectedBrokersFee])` — every argument read
 * by INDEX.
 *
 * ⚠ `expectedBrokersFee` IS A RATE AND A CHECK, NOT A PAYMENT. The server
 * compares it against the character's real broker commission rate and refuses
 * the whole order (MktBrokersFeeUnexpected2) if they differ — it exists to stop
 * a player being charged a rate other than the one they were shown. We cannot
 * compute that rate: it is 3% minus (Broker Relations level x 0.3%) minus
 * standings terms, and NO allowlisted read answers either input. A guess would
 * refuse legitimate orders from any trained trader, so `null` — the documented
 * "do not check" value — is sent, and the honesty is delivered the other way
 * round: the UI labels its estimate an estimate, and this route reports the
 * amount the wallet ACTUALLY lost.
 */
app.post("/api/bridge/market/buy", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const typeID = Number(body.typeID) || 0;
  const quantity = Number(body.quantity) || 0;
  if (typeID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_TYPE", message: "An item is required." });
    return;
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    res.status(400).json({
      ok: false,
      error: "INVALID_QUANTITY",
      message: "A whole number of units above zero is required.",
    });
    return;
  }
  const price = normalizeMarketPrice(req, res);
  if (price === null) {
    return;
  }
  const durationDays = Number(body.durationDays);
  if (!MARKET_ALLOWED_DURATIONS.has(durationDays)) {
    res.status(400).json({
      ok: false,
      error: "INVALID_DURATION",
      message: "That is not a length of time the market accepts.",
    });
    return;
  }
  if (
    !requireMarketConfirmation(
      req,
      res,
      "Placing a buy order sets aside ISK straight away and charges a broker's fee. This action must be confirmed explicitly.",
    )
  ) {
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    // BEFORE. Read first, so the difference afterwards is the real charge.
    const balanceBefore = await readMarketBalance(held, req.webSessionID);
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "marketProxy",
      "PlaceBuyOrder",
      [
        held.stationID,
        typeID,
        price,
        quantity,
        // Station-only range: a wider one is skill-gated and the server refuses
        // a range the character has not trained for.
        MARKET_RANGE_STATION,
        1,
        durationDays,
        // Personal market only — the handler refuses a corp order outright.
        false,
        // See the note above: a rate we cannot know must not be asserted.
        null,
      ],
      null,
    );
    const balanceAfter = await readMarketBalance(held, req.webSessionID);
    const charged = marketIskDelta(balanceBefore, balanceAfter);
    const ownOrders = await readOwnOrdersQuietly(held, req.webSessionID);
    // ⚠ `applied` comes from the WALLET, not from the 200. PlaceBuyOrder
    // answers None whether it created an order, filled one immediately, or did
    // nothing at all — so a response alone cannot tell them apart. A charge of
    // exactly zero means nothing happened, and saying so is honest where
    // naming a cause would be a guess the server did not give.
    const applied = charged !== null && charged !== "0.00";
    res.json({
      ok: true,
      applied,
      declinedSilently: !applied,
      charged,
      balanceBefore,
      balanceAfter,
      ownOrders,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PLACE A SELL ORDER.
 *
 * `PlaceMultiSellOrder([itemList, useCorp, duration, expectedBrokersFee])`.
 *
 * ⚠ SELLING IS ITEM-BASED, NOT TYPE-BASED. Each entry must carry
 * `{itemID, typeID, stationID, price, quantity}` — the handler moves specific
 * STACKS out of the hangar into escrow, so it needs the itemID of the stack,
 * not just "10 of type 34". There is no single-sell method in the whole retail
 * surface; this one call is it, and the browser sends a one-entry list.
 */
app.post("/api/bridge/market/sell", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemID = Number(body.itemID) || 0;
  const typeID = Number(body.typeID) || 0;
  const quantity = Number(body.quantity) || 0;
  if (itemID <= 0 || typeID <= 0) {
    res.status(400).json({
      ok: false,
      error: "INVALID_ITEM",
      message: "A specific stack of goods to sell is required.",
    });
    return;
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    res.status(400).json({
      ok: false,
      error: "INVALID_QUANTITY",
      message: "A whole number of units above zero is required.",
    });
    return;
  }
  const price = normalizeMarketPrice(req, res);
  if (price === null) {
    return;
  }
  const durationDays = Number(body.durationDays);
  if (!MARKET_ALLOWED_DURATIONS.has(durationDays)) {
    res.status(400).json({
      ok: false,
      error: "INVALID_DURATION",
      message: "That is not a length of time the market accepts.",
    });
    return;
  }
  if (
    !requireMarketConfirmation(
      req,
      res,
      "Placing a sell order hands the goods over to the market and charges a broker's fee. This action must be confirmed explicitly.",
    )
  ) {
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const balanceBefore = await readMarketBalance(held, req.webSessionID);
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "marketProxy",
      "PlaceMultiSellOrder",
      [
        [{ itemID, typeID, stationID: held.stationID, price, quantity }],
        false,
        durationDays,
        // Same reasoning as the buy route: a rate we cannot know is not asserted.
        null,
      ],
      null,
    );
    const balanceAfter = await readMarketBalance(held, req.webSessionID);
    const ownOrders = await readOwnOrdersQuietly(held, req.webSessionID);
    // PlaceMultiSellOrder answers a BOOLEAN — true when it traded or created an
    // order. That is a real signal (unlike PlaceBuyOrder's None), so it is used,
    // and the wallet delta is reported alongside it: a sell order COSTS the
    // broker's fee up front and pays out only when it fills.
    const applied = outcome.result === true;
    res.json({
      ok: true,
      applied,
      declinedSilently: !applied,
      charged: marketIskDelta(balanceBefore, balanceAfter),
      balanceBefore,
      balanceAfter,
      ownOrders,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * CANCEL an order. `CancelCharOrder([orderID, regionID])`.
 *
 * ⚠ The server IGNORES `regionID` and reads only `args[0]`, re-deriving the
 * region from the order it loads. The trailing argument is sent anyway because
 * that is the retail shape.
 *
 * Cancelling a BUY order returns the ISK held in escrow but NOT the broker's
 * fee already paid; cancelling a SELL order returns the goods. Confirmed because
 * the fee is genuinely lost either way.
 */
app.post("/api/bridge/market/cancel", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const orderID = String((req.body || {}).orderID || "").trim();
  if (!/^\d+$/.test(orderID)) {
    res.status(400).json({ ok: false, error: "INVALID_ORDER", message: "An order is required." });
    return;
  }
  if (
    !requireMarketConfirmation(
      req,
      res,
      "Taking an order down returns what it was holding, but the broker's fee you already paid is not returned. This action must be confirmed explicitly.",
    )
  ) {
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const before = await readOwnOrdersQuietly(held, req.webSessionID);
    const balanceBefore = await readMarketBalance(held, req.webSessionID);
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "marketProxy",
      "CancelCharOrder",
      // The regionID the server ignores. Sent because the shape is retail's.
      [orderID, 0],
      null,
    );
    const balanceAfter = await readMarketBalance(held, req.webSessionID);
    const ownOrders = await readOwnOrdersQuietly(held, req.webSessionID);
    // ⚠ `applied` is the RE-READ, not the 200: the order is gone from the open
    // list, or it is not. CancelCharOrder answers None either way, including
    // when the order was already closed.
    const applied = marketOrderCount(before) > marketOrderCount(ownOrders);
    res.json({
      ok: true,
      applied,
      declinedSilently: !applied,
      // A cancel usually RETURNS ISK, so this is normally negative.
      charged: marketIskDelta(balanceBefore, balanceAfter),
      balanceBefore,
      balanceAfter,
      ownOrders,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * MODIFY an order's price.
 * `ModifyCharOrder([orderID, newPrice, bid, stationID, solarSystemID, oldPrice,
 *                   range, volRemaining, issueDate])`.
 *
 * ⚠ The server reads ONLY `args[0]` and `args[1]` and re-derives everything
 * else from the order it loads — so the seven trailing arguments cannot change
 * the outcome, and a caller that got one wrong would not be told. They are sent
 * because the shape is the retail one.
 *
 * Repricing charges a modification fee and, on a buy order, moves the escrow up
 * or down, so it is confirmed like the rest.
 */
app.post("/api/bridge/market/modify", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const orderID = String(body.orderID || "").trim();
  if (!/^\d+$/.test(orderID)) {
    res.status(400).json({ ok: false, error: "INVALID_ORDER", message: "An order is required." });
    return;
  }
  const price = normalizeMarketPrice(req, res);
  if (price === null) {
    return;
  }
  if (
    !requireMarketConfirmation(
      req,
      res,
      "Changing an order's price charges a fee, and on a buy order it changes how much ISK is set aside. This action must be confirmed explicitly.",
    )
  ) {
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const balanceBefore = await readMarketBalance(held, req.webSessionID);
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "marketProxy",
      "ModifyCharOrder",
      [
        orderID,
        price,
        // Everything from here down is re-derived server-side. Sent for shape
        // fidelity only — see the note above.
        Boolean(body.bid),
        held.stationID,
        held.solarSystemID || 0,
        roundMarketPrice(body.oldPrice),
        Number(body.range) || MARKET_RANGE_STATION,
        Number(body.volumeRemaining) || 0,
        0,
      ],
      null,
    );
    const balanceAfter = await readMarketBalance(held, req.webSessionID);
    const ownOrders = await readOwnOrdersQuietly(held, req.webSessionID);
    // ⚠ `applied` is the RE-READ: the order now carries the new price, or it
    // does not. ModifyCharOrder answers None whether it repriced, found nothing
    // to change, or the order was already closed.
    const applied = marketOrderHasPrice(ownOrders, orderID, price);
    res.json({
      ok: true,
      applied,
      declinedSilently: !applied,
      charged: marketIskDelta(balanceBefore, balanceAfter),
      balanceBefore,
      balanceAfter,
      ownOrders,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

// --- Reading the owner-order rowset, for the re-read verdicts ---------------
// The BFF understands just enough of this rowset to judge whether a mutation
// applied. The browser still gets the RAW result and decodes it properly; these
// two helpers exist only so `applied` is a fact rather than an echo.

/** Unwrap the inline cached envelope, if that is what arrived. */
function unwrapMarketCached(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  const name = result.name;
  const text = typeof name === "string" ? name : (name && name.value) || "";
  if (!String(text).endsWith("objectCaching.CachedMethodCallResult")) {
    return result;
  }
  const carrier = Array.isArray(result.args) ? result.args[1] : null;
  return carrier && carrier.type === "substream" ? carrier.value : null;
}

/** The owner-order rowset as {column: value} records. */
function marketOwnerOrderRows(result) {
  const rowset = unwrapMarketCached(result);
  if (!rowset || typeof rowset !== "object" || !rowset.args) {
    return [];
  }
  const entries = Array.isArray(rowset.args.entries) ? rowset.args.entries : [];
  const pick = (key) => {
    const entry = entries.find((candidate) => Array.isArray(candidate) && candidate[0] === key);
    return entry ? entry[1] : null;
  };
  const columnsValue = pick("columns");
  const columns = columnsValue && Array.isArray(columnsValue.items)
    ? columnsValue.items.map((column) =>
      (typeof column === "string" ? column : (column && column.value) || ""))
    : [];
  const linesValue = pick("lines");
  const lines = linesValue && Array.isArray(linesValue.items) ? linesValue.items : [];
  return lines.map((line) => {
    const cells = Array.isArray(line) ? line : (line && line.items) || [];
    const row = {};
    columns.forEach((column, index) => {
      row[column] = cells[index];
    });
    return row;
  });
}

function marketOrderCount(result) {
  return marketOwnerOrderRows(result).length;
}

/** Does the named order now carry `price`? The modify verdict. */
function marketOrderHasPrice(result, orderID, price) {
  const wanted = String(orderID);
  for (const row of marketOwnerOrderRows(result)) {
    const id = row.orderID && row.orderID.type === "long"
      ? String(row.orderID.value)
      : String(row.orderID);
    if (id === wanted) {
      return roundMarketPrice(row.price) === roundMarketPrice(price);
    }
  }
  return false;
}

// --- R17 Mail (mailMgr bridge) ---------------------------------------------
//
// Like industry and market, the whole retail mail surface is TOP-LEVEL
// (sm.RemoteSvc('mailMgr')) — no bound-object step — so heldTopLevelCall
// carries all of it and this adds no bridge machinery.
//
// ⚠ THE INBOX IS A DELTA SYNC, NOT A LIST CALL. There is no "give me my mail"
// method. SyncMail(firstID, lastID) takes the MIN and MAX messageID the CALLER
// already holds and answers only what falls outside that window. A caller that
// invents a window gets a PARTIAL mailbox and NO error. The browser caches
// nothing across a page load, so it is permanently cold and this route always
// passes the cold-start pair [null, 0] — "I hold nothing, send everything".
// (server/tests/webGatewayMail.test.js pins both the cold and the warm shape.)
//
// ⚠ GetBody RETURNS A ZLIB-DEFLATED BUFFER, NOT TEXT, and inflating it is THIS
// FILE'S JOB. See mailBodyText below. The browser never sees a compressed byte.
//
// ⚠ AN EMPTY RECIPIENT LIST IS NOT REFUSED BY THE SERVER. mailState.sendMail's
// NO_RECIPIENTS guard reads `recipients.length === 0 && !saveSenderCopy`, and
// the handler hardcodes saveSenderCopy: true — so the guard can never fire
// through the gateway, and mail addressed to nobody is written, filed into the
// sender's own mailbox, and looks sent. The send route below refuses it here
// instead, because nothing downstream will.

/** The cold-start SyncMail window: "I hold nothing, send me the lot." */
const MAIL_COLD_START_SYNC = Object.freeze([null, 0]);
const MAIL_STATUS_MASK_READ = 1;
const MAIL_MAX_RECIPIENTS = 20;
const MAIL_MAX_TITLE = 200;
const MAIL_MAX_BODY = 8000;

/**
 * ⚠ THE ZLIB RULE, and the single place it is implemented.
 *
 * mailMgr.GetBody answers zlib.deflateSync(body). A Node Buffer crosses the
 * JSON bridge as {type:"Buffer", data:[...]}, so rendering the return directly
 * would show the player a wall of byte values. This inflates it and hands back
 * plain text. Decompressing in the BROWSER is not an option worth taking: it
 * would mean shipping an inflate implementation to every page load to undo
 * something the server did for a wire format the browser never speaks.
 *
 * Returns null for "no such message" (GetBody's own answer for one the
 * character cannot see) and throws nothing on a corrupt stream — a body that
 * will not inflate is reported as unreadable rather than blanking the message.
 */
function mailBodyText(result) {
  if (result === null || result === undefined) {
    return { text: null, unreadable: false };
  }
  let bytes = null;
  if (Buffer.isBuffer(result)) {
    bytes = result;
  } else if (
    result &&
    typeof result === "object" &&
    result.type === "Buffer" &&
    Array.isArray(result.data)
  ) {
    bytes = Buffer.from(result.data);
  } else if (typeof result === "string") {
    // Not a shape the service produces today, but if a body ever arrives
    // already-decoded it is text, not an error.
    return { text: result, unreadable: false };
  }
  if (!bytes) {
    return { text: null, unreadable: true };
  }
  try {
    return { text: zlib.inflateSync(bytes).toString("utf8"), unreadable: false };
  } catch {
    return { text: null, unreadable: true };
  }
}

function readMailKeyVal(row, key) {
  const entries =
    row && row.args && Array.isArray(row.args.entries) ? row.args.entries : [];
  const entry = entries.find((candidate) => {
    const name = Array.isArray(candidate) ? candidate[0] : null;
    return (typeof name === "string" ? name : name && name.value) === key;
  });
  return entry ? entry[1] : undefined;
}

function mailListItems(value) {
  return value && Array.isArray(value.items) ? value.items : [];
}

function mailNumber(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value && value.type === "long") {
    return Number(value.value) || 0;
  }
  return Number(value) || 0;
}

/**
 * The unread count, computed HERE rather than trusted from anywhere else: it is
 * the number of status rows whose read bit is clear. The browser gets the raw
 * rows too and could count them itself; this exists so the count shown beside
 * the tab and the count implied by the list can never disagree.
 */
function mailUnreadCount(syncResult) {
  let unread = 0;
  for (const row of mailListItems(readMailKeyVal(syncResult, "mailStatus"))) {
    if ((mailNumber(readMailKeyVal(row, "statusMask")) & MAIL_STATUS_MASK_READ) === 0) {
      unread += 1;
    }
  }
  return unread;
}

/** Is `messageID` present in this sync's headers? The send/read re-read verdict. */
function mailHeaderIDs(syncResult) {
  const ids = new Set();
  for (const arm of ["newMail", "oldMail"]) {
    for (const row of mailListItems(readMailKeyVal(syncResult, arm))) {
      ids.add(mailNumber(readMailKeyVal(row, "messageID")));
    }
  }
  return ids;
}

function mailIsRead(syncResult, messageID) {
  for (const row of mailListItems(readMailKeyVal(syncResult, "mailStatus"))) {
    if (mailNumber(readMailKeyVal(row, "messageID")) === Number(messageID)) {
      return (mailNumber(readMailKeyVal(row, "statusMask")) & MAIL_STATUS_MASK_READ) !== 0;
    }
  }
  return false;
}

/**
 * GET /api/bridge/mail — the whole inbox, cold-started.
 *
 * One call does it: a cold SyncMail IS the full mailbox. GetMailHeaders is the
 * backfill for any messageID that has a status row but no header, which a cold
 * sync should never produce — it is issued only when that actually happens, so
 * the common case stays a single round-trip.
 */
app.get("/api/bridge/mail", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const sync = await heldTopLevelCall(
      held,
      req.webSessionID,
      "mailMgr",
      "SyncMail",
      MAIL_COLD_START_SYNC,
      null,
    );

    // Backfill: any message the mailbox knows the STATUS of but not the HEADER.
    // ⚠ The argument is a list NESTED in args[0], not a spread of ids.
    const haveHeaders = mailHeaderIDs(sync.result);
    const missing = [];
    for (const row of mailListItems(readMailKeyVal(sync.result, "mailStatus"))) {
      const messageID = mailNumber(readMailKeyVal(row, "messageID"));
      if (messageID > 0 && !haveHeaders.has(messageID)) {
        missing.push(messageID);
      }
    }
    let backfill = null;
    if (missing.length > 0) {
      const extra = await heldTopLevelCall(
        held,
        req.webSessionID,
        "mailMgr",
        "GetMailHeaders",
        [missing],
        null,
      );
      backfill = extra.result;
    }

    res.json({
      ok: true,
      characterID: held.characterID,
      sync: sync.result,
      backfill,
      unreadCount: mailUnreadCount(sync.result),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/bridge/mail/body?messageID=&markRead= — one message, as TEXT.
 *
 * ⚠ markRead=1 makes this a WRITE: it clears the unread bit and pushes
 * OnMailUpdatedByExternal to the character's other sessions. Opening a message
 * is the player's own deliberate act, so it needs no confirm gate — but it is
 * re-read anyway, because a 200 is not proof that the flag moved.
 */
app.get("/api/bridge/mail/body", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const messageID = Number(req.query.messageID) || 0;
  if (messageID <= 0) {
    res.status(400).json({ ok: false, error: "MAIL_INVALID", message: "No message was named." });
    return;
  }
  const markRead = req.query.markRead === "1" || req.query.markRead === "true";
  try {
    const body = await heldTopLevelCall(
      held,
      req.webSessionID,
      "mailMgr",
      "GetBody",
      [messageID, markRead ? 1 : 0],
      null,
    );
    const { text, unreadable } = mailBodyText(body.result);

    // GetBody answers null for a message this character cannot see. That is a
    // definite answer, not a failure, and it is reported as one.
    if (text === null && !unreadable) {
      res.status(404).json({
        ok: false,
        error: "MAIL_NOT_FOUND",
        message: "That message is not in your mailbox.",
      });
      return;
    }

    // ⚠ A 200 IS NOT PROOF. Re-read the mailbox and report the flag the server
    // actually holds, not the one we asked for.
    let nowRead = null;
    let unreadCount = null;
    try {
      const sync = await heldTopLevelCall(
        held,
        req.webSessionID,
        "mailMgr",
        "SyncMail",
        MAIL_COLD_START_SYNC,
        null,
      );
      nowRead = mailIsRead(sync.result, messageID);
      unreadCount = mailUnreadCount(sync.result);
    } catch {
      // The body is in hand and worth showing; a failed re-read only means we
      // decline to make a claim about the read flag.
    }

    res.json({
      ok: true,
      messageID,
      body: text,
      unreadable,
      markedRead: nowRead,
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/bridge/mail/send — write to another character.
 *
 * ⚠ EXACT POSITIONAL SIGNATURE (Handle_SendMail reads by index; a mis-ordered
 * list is a silently different message, not an error):
 *   [toCharacterIDs, toListID, toCorpOrAllianceID, title, body,
 *    isReplyTo, isForwardedFrom]
 * args[0] is a LIST on the way in even though headers read it back as a
 * comma-joined string on the way out. toListID and toCorpOrAllianceID are
 * always null: mailing lists are a separate service and corp/alliance mail fans
 * out to every member — neither is in this slice.
 *
 * This is a write, but not a destructive or costly one — nothing is spent and
 * nothing is deleted — so it takes no `confirm` gate, unlike R12/R14/R15/R16.
 * What it does take is a RECIPIENT CHECK, because the server has none: see the
 * empty-list note above.
 */
app.post("/api/bridge/mail/send", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const payload = req.body && typeof req.body === "object" ? req.body : {};
  const recipients = Array.isArray(payload.toCharacterIDs)
    ? [...new Set(payload.toCharacterIDs.map((id) => Number(id) || 0).filter((id) => id > 0))]
    : [];
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  // ⚠ THE GUARD THE SERVER DOES NOT HAVE. Without this, mail to nobody is
  // written into the sender's own mailbox and looks sent.
  if (recipients.length === 0) {
    res.status(400).json({
      ok: false,
      error: "MAIL_NO_RECIPIENT",
      message: "Choose someone to send this to first.",
    });
    return;
  }
  if (recipients.length > MAIL_MAX_RECIPIENTS) {
    res.status(400).json({
      ok: false,
      error: "MAIL_TOO_MANY_RECIPIENTS",
      message: `You can send to at most ${MAIL_MAX_RECIPIENTS} people at once.`,
    });
    return;
  }
  if (!title) {
    res.status(400).json({
      ok: false,
      error: "MAIL_NO_SUBJECT",
      message: "Give your message a subject first.",
    });
    return;
  }
  if (title.length > MAIL_MAX_TITLE || body.length > MAIL_MAX_BODY) {
    res.status(400).json({
      ok: false,
      error: "MAIL_TOO_LONG",
      message: "That message is longer than the mail system accepts.",
    });
    return;
  }

  try {
    const sent = await heldTopLevelCall(
      held,
      req.webSessionID,
      "mailMgr",
      "SendMail",
      [recipients, null, null, title, body, null, null],
      null,
    );
    const messageID = mailNumber(sent.result);

    // ⚠ THE SILENT DECLINE. SendMail answers a bare null on failure with NO
    // reason attached. Say exactly that rather than inventing a cause.
    if (!messageID) {
      res.json({
        ok: true,
        applied: false,
        declinedSilently: true,
        messageID: null,
        message: "The server did not send that message, and did not say why.",
      });
      return;
    }

    // ⚠ A 200 IS NOT PROOF. Re-read the sender's own mailbox: the handler keeps
    // a sender copy, so the message must be visible there if it really landed.
    let applied = true;
    let unreadCount = null;
    try {
      const sync = await heldTopLevelCall(
        held,
        req.webSessionID,
        "mailMgr",
        "SyncMail",
        MAIL_COLD_START_SYNC,
        null,
      );
      applied = mailHeaderIDs(sync.result).has(messageID);
      unreadCount = mailUnreadCount(sync.result);
    } catch {
      // Keep `applied` as the messageID implies; a failed re-read is not
      // evidence the send failed.
    }

    res.json({
      ok: true,
      applied,
      declinedSilently: false,
      messageID,
      unreadCount,
      recipientCount: recipients.length,
    });
  } catch (error) {
    next(error);
  }
});

// --- R17 Contracts (contractProxy bridge) -----------------------------------
//
// Like mail and market, the whole contract surface is TOP-LEVEL
// (sm.ProxySvc('contractProxy')) — no bound-object step — so heldTopLevelCall
// carries all of it.
//
// ⚠ THE SERVICE IS "contractProxy". EveJS registers TWO contract services and
// the obvious name is the wrong one: `contractMgr` (contractMgrService.js) is
// 86 lines of DEAD STUBS — GetLoginInfo answers three empty rowsets,
// SearchContracts an empty list, NumOutstandingContracts 0 — every method
// hardcoded empty, never called by the retail client. Naming it would give a
// contracts page that renders perfectly and is permanently empty, which is
// INDISTINGUISHABLE from the genuinely empty world below. Every call here names
// contractProxy; the gateway allowlist refuses `contractMgr` by name.
//
// ⚠ A PUBLIC BROWSE IS LEGITIMATELY EMPTY, AND THAT IS NOT A BUG. There is no
// NPC/seed contract generator anywhere in EveJS — `createContract` exists only
// in contractRuntimeState.js and its own handler, and nothing calls it at
// startup. So SearchContracts answers nothing until a player creates a
// contract. The route reports that as a FACT (`worldHasNoContracts`) so the
// panel can say "no public contracts exist in this world yet" rather than
// looking broken. Do not go hunting for a bug here.
//
// ⚠ SearchContracts IS KWARGS-ONLY. Handle_SearchContracts ignores `args`
// entirely and reads every filter off kwargs. Filters sent positionally are
// silently DROPPED — a browse meant to show couriers would quietly answer
// every contract type instead, with no error.
//
// ⚠ READS ONLY. Every contract MUTATOR (AcceptContract, CompleteContract,
// CreateContract, DeleteContract, ...) sits on the SAME service and is refused
// by the gateway. Accepting a contract transfers items and ISK; its signature
// is unambiguous ([contractID, forCorp]) but there is nothing in this world to
// accept, so an accept path could not be exercised end to end even once — and a
// two-step confirm gate that has never been run is worse than no gate.

/** contractType 3 = courier. availability 0 = public. */
const CONTRACT_TYPE_COURIER = 3;
const CONTRACT_AVAILABILITY_PUBLIC = 0;
/**
 * ⚠ THE REAL PAGE STRIDE, and it is NOT the `maxResults` the envelope reports.
 * searchContracts slices by CONTRACTS_PER_PAGE (100,
 * contractRuntimeState.js:48) while the envelope's `maxResults` carries
 * MAX_CONTRACTS_PER_SEARCH (1000, contractProxyService.js:29). The two
 * constants disagree, so paging by `maxResults` — the obvious reading — would
 * advance startNum by 1000 and SKIP 900 CONTRACTS PER PAGE, silently. Page by
 * this, never by that field.
 */
const CONTRACTS_PAGE_SIZE = 100;

function contractsListEmpty(result) {
  const contracts = readMailKeyVal(result, "contracts");
  return !contracts || !Array.isArray(contracts.items) || contracts.items.length === 0;
}

/**
 * GET /api/bridge/contracts?page= — the browse, the player's own, and the
 * summary, in one panel load.
 *
 * Five INDEPENDENT reads (R2's rule): one failure never blanks the rest. A
 * player whose public browse fails still sees their own contracts.
 */
app.get("/api/bridge/contracts", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const page = Math.max(0, Number(req.query.page) || 0);
  try {
    const [browse, outstanding, accepted, expired, summary] = await Promise.allSettled([
      // ⚠ KWARGS-ONLY: no positional args at all, or the filters are dropped.
      heldTopLevelCall(held, req.webSessionID, "contractProxy", "SearchContracts", [], {
        contractType: CONTRACT_TYPE_COURIER,
        availability: CONTRACT_AVAILABILITY_PUBLIC,
        startNum: page * CONTRACTS_PAGE_SIZE,
      }),
      // (isAccepted, forCorp). Neither names an owner — the character comes
      // from the session, so there is nothing here to point elsewhere.
      heldTopLevelCall(
        held, req.webSessionID, "contractProxy", "GetMyCurrentContractList", [false, false], null,
      ),
      heldTopLevelCall(
        held, req.webSessionID, "contractProxy", "GetMyCurrentContractList", [true, false], null,
      ),
      heldTopLevelCall(
        held, req.webSessionID, "contractProxy", "GetMyExpiredContractList", [false], null,
      ),
      heldTopLevelCall(
        held, req.webSessionID, "contractProxy", "GetLoginInfo", [], null,
      ),
    ]);

    const settled = [browse, outstanding, accepted, expired, summary];
    for (const entry of settled) {
      if (entry.status === "rejected" && entry.reason && entry.reason.code === "SESSION_NOT_FOUND") {
        next(entry.reason);
        return;
      }
    }

    const codeOf = (entry) =>
      entry.status === "rejected"
        ? String((entry.reason && entry.reason.code) || "READ_FAILED")
        : null;
    const valueOf = (entry) => (entry.status === "fulfilled" ? entry.value.result : null);

    // ⚠ THE FACT, NOT A GUESS. "The browse succeeded and found nothing" is a
    // different statement from "the browse failed", and only the first one
    // justifies telling the player this world has no contracts yet.
    const worldHasNoContracts =
      browse.status === "fulfilled" && contractsListEmpty(browse.value.result);

    res.json({
      ok: true,
      characterID: held.characterID,
      page,
      pageSize: CONTRACTS_PAGE_SIZE,
      browse: { result: valueOf(browse), error: codeOf(browse) },
      outstanding: { result: valueOf(outstanding), error: codeOf(outstanding) },
      accepted: { result: valueOf(accepted), error: codeOf(accepted) },
      expired: { result: valueOf(expired), error: codeOf(expired) },
      summary: { result: valueOf(summary), error: codeOf(summary) },
      worldHasNoContracts,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/bridge/contracts/detail?contractID= — one contract in full.
 *
 * GetContract answers null for a contract that does not exist — a definite
 * answer the panel can act on ("that contract is gone"), reported as a 404
 * rather than an empty detail pane.
 */
app.get("/api/bridge/contracts/detail", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const contractID = Number(req.query.contractID) || 0;
  if (contractID <= 0) {
    res.status(400).json({
      ok: false,
      error: "CONTRACT_INVALID",
      message: "No contract was named.",
    });
    return;
  }
  try {
    const detail = await heldTopLevelCall(
      held, req.webSessionID, "contractProxy", "GetContract", [contractID], null,
    );
    if (detail.result === null || detail.result === undefined) {
      res.status(404).json({
        ok: false,
        error: "CONTRACT_NOT_FOUND",
        message: "That contract is no longer available.",
      });
      return;
    }
    res.json({ ok: true, contractID, detail: detail.result });
  } catch (error) {
    next(error);
  }
});

// --- R37 Personal Assets (charMgr global-assets bridge) ---------------------
//
// "Where is my stuff, across the whole cluster." Unlike mail/market/contracts,
// this surface is NOT top-level: the retail moniker is
// Moniker('charMgr', (charID, 10002)) via MachoBindObject, and ListStations /
// ListStationItems dispatch on that bound object — so it rides boundCall, the
// same two-step invbroker and agentMgr use.
//
// ⚠ THE SERVER ALREADY ANSWERS "WHERE IS MY STUFF". charMgrGlobalAssets
// resolves every item up its container chain to a dockable ROOT location and
// groups by station (`_buildAssetSnapshot` / `_buildStationRows`). The bridge
// must not re-derive that by walking containers itself — one call is the whole
// feature, and a client-side aggregation would disagree with the server about
// asset-safety wraps, industry-installed items and hidden locations.
//
// ⚠ THE TWO READS SEND DIFFERENT ROW SHAPES, and this is the R32 trap again.
//   * ListStations is a CRowset — `{type:"objectex2", list:[packedrow …]}` —
//     whose rows are the POSITIONAL packedrow variant (`values` parallel to
//     `columns`), because buildDbRowset feeds buildPackedRowFromRowsetLine an
//     ARRAY per row.
//   * ListStationItems is a plain `{type:"list", items:[packedrow …]}` whose
//     rows are the NAME-KEYED variant (`fields`).
// A decoder that commits to either shape silently drops every field of the
// other. Both are read through `readRowField` on the browser side.
//
// ⚠ stationID / solarSystemID / itemID / locationID ARE DECLARED int64 (type
// code 0x14) in the row descriptors. They are ordinary JS numbers here because
// the handler builds them with toInteger(), but a caller must not ASSUME that —
// the gateway renders any genuine BigInt as a BARE DECIMAL STRING, not a
// {type:"long"} wrapper (encodeJsonSafeCallValue). The browser decoder accepts
// both.
//
// READS ONLY. The bound global-assets object implements no write at all.

/** Moniker('charMgr', (charID, 10002)) — the global ASSETS container. */
const CHAR_GLOBAL_ASSETS_CONTAINER_ID = 10002;

function globalAssetsBindSpec(held) {
  return {
    key: `globalAssets:${held.characterID}`,
    service: "charMgr",
    method: "MachoBindObject",
    args: [[held.characterID, CHAR_GLOBAL_ASSETS_CONTAINER_ID]],
    kwargs: null,
  };
}

/**
 * Is this ListStations result a SUCCESSFUL, EMPTY read?
 *
 * The CRowset's rows live on `list`. An absent/!array `list` is a shape we did
 * not expect and must NOT be reported as "you own nothing" — the caller only
 * treats `true` as the fact.
 */
function assetStationsEmpty(result) {
  return Boolean(result) && Array.isArray(result.list) && result.list.length === 0;
}

/**
 * GET /api/bridge/assets — every station holding this character's items.
 *
 * ONE bound read. The per-station contents are a separate route so first paint
 * does not fan out one call per station.
 */
app.get("/api/bridge/assets", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    // Sync the held session's live position first. The asset snapshot is built
    // AGAINST THE SESSION: charMgrGlobalAssets keys its cache on the session's
    // station/system/constellation/region, `isHiddenPersonalAssetLocation`
    // hides the character's own id, and an unknown location inherits the
    // session's system. This is the same class of dependency that made
    // GetAgents answer 0 for a docked station until the sync was added.
    await readHeldFlight(held, req.webSessionID).catch(() => null);
    const spec = globalAssetsBindSpec(held);
    const stations = await boundCall(held, req.webSessionID, spec, "ListStations", [], null);
    res.json({
      ok: true,
      characterID: held.characterID,
      stations: stations.result,
      // ⚠ THE FACT, NOT A GUESS. True only when the read SUCCEEDED and the
      // rowset was empty — "you own nothing anywhere" and "the read failed"
      // must never render alike (the worldHasNoContracts precedent).
      ownsNothing: assetStationsEmpty(stations.result),
      error: null,
    });
  } catch (error) {
    if (error && error.code === "SESSION_NOT_FOUND") {
      next(error);
      return;
    }
    // A failed read is reported AS a failed read, with ownsNothing false.
    res.json({
      ok: true,
      characterID: held.characterID,
      stations: null,
      ownsNothing: false,
      error: String((error && error.code) || "READ_FAILED"),
    });
  }
});

/**
 * Per-type volume (m³) for every type in a ListStationItems result.
 *
 * Reads the NAME-KEYED packedrow variant this handler builds. Types the static
 * tables do not know are simply absent from the map — never zero, which the
 * page would have to render as a real measurement.
 */
function readTypeVolumes(result) {
  const rows = result && Array.isArray(result.items) ? result.items : [];
  const volumes = {};
  for (const row of rows) {
    const fields = row && row.type === "packedrow" && row.fields ? row.fields : null;
    const typeID = Number(fields && fields.typeID) || 0;
    if (typeID <= 0 || Object.prototype.hasOwnProperty.call(volumes, typeID)) {
      continue;
    }
    const type = staticData.getType(typeID);
    const volume = Number(type && type.volume);
    if (Number.isFinite(volume) && volume > 0) {
      volumes[typeID] = volume;
    }
  }
  return volumes;
}

/**
 * GET /api/bridge/assets/station?stationID= — what is at ONE of those stations.
 *
 * Called when the player expands a station. `hasNoItems` is the same fact as
 * `ownsNothing` above, scoped to this station.
 */
app.get("/api/bridge/assets/station", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const stationID = Number(req.query.stationID) || 0;
  if (stationID <= 0) {
    res.status(400).json({
      ok: false,
      error: "ASSET_LOCATION_INVALID",
      message: "No location was named.",
    });
    return;
  }
  try {
    const spec = globalAssetsBindSpec(held);
    const items = await boundCall(
      held,
      req.webSessionID,
      spec,
      "ListStationItems",
      [stationID],
      null,
    );
    const result = items.result;
    res.json({
      ok: true,
      stationID,
      items: result,
      // Per-type VOLUME, from static reference data — no bridge call and no new
      // allowlist pair. The asset rows carry a typeID but no volume (the
      // descriptor has no such column), and volume is a property of the TYPE,
      // not of the stack, so it cannot vary by player. Same class of read as
      // /api/names. Absent for a type the static tables do not know, which the
      // page renders as "—" rather than as zero.
      volumes: readTypeVolumes(result),
      hasNoItems:
        Boolean(result) && Array.isArray(result.items) && result.items.length === 0,
      error: null,
    });
  } catch (error) {
    if (error && error.code === "SESSION_NOT_FOUND") {
      next(error);
      return;
    }
    res.json({
      ok: true,
      stationID,
      items: null,
      hasNoItems: false,
      error: String((error && error.code) || "READ_FAILED"),
    });
  }
});

/** Read `status` off a util.KeyVal job row (the re-read's verdict). */
function readIndustryJobStatus(row) {
  const entries =
    row && row.args && Array.isArray(row.args.entries) ? row.args.entries : [];
  const entry = entries.find((candidate) => Array.isArray(candidate) && candidate[0] === "status");
  return entry ? Number(entry[1]) || 0 : 0;
}

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
    // The solar system the character is in RIGHT NOW. Tracked here because
    // R15's industry deliver/cancel take it as an argument
    // (CompleteJob(jobID, solarSystemID)), and it is otherwise unavailable to a
    // route that never touches the space runtime.
    if (Number(flight.solarSystemID) > 0) {
      held.solarSystemID = Number(flight.solarSystemID);
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

// --- R23 slice A: targeting + module activation -----------------------------
//
// THE GENERIC IN-SPACE ACTION LAYER. Everything below is deliberately free of
// any notion of mining, combat, salvaging or ewar: a target is a target, a
// module is a module, and the effect name is an ARGUMENT. R23 slice B drives a
// mining laser through these four routes; a later combat goal drives a turret
// through the same four routes with a different module and effect name and
// needs no new BFF surface, no new store slice and no new UI.
//
// If you find yourself about to add "mining" to a name in this section, don't.

/** A dogmaIM target list ({type:"list", items:[…]}) as plain itemIDs. */
function decodeTargetIDList(result) {
  const items =
    result && result.type === "list" && Array.isArray(result.items) ? result.items : [];
  return items
    .map((value) => Number(value && typeof value === "object" ? value.value : value) || 0)
    .filter((value) => value > 0);
}

/** The itemIDs the server says are locked RIGHT NOW. The only authority. */
async function readLockedTargetIDs(held, webSessionID) {
  const outcome = await heldTopLevelCall(held, webSessionID, "dogmaIM", "GetTargets", [], null);
  return { ids: decodeTargetIDList(outcome.result), notifications: outcome.notifications };
}

/**
 * Did the module the caller named end up RUNNING? Answered as a set DELTA, not
 * by asking whether that exact itemID is in the running set.
 *
 * The reason is weapon banking. dogmaService.js Handle_Activate silently
 * redirects a banked weapon to its bank MASTER, and the snapshot then reports
 * the master's itemID — so a slave weapon can start cycling without its own id
 * ever appearing, and `ids.includes(itemID)` would call a successful shot a
 * failure. Asking "is this id running, OR did the running set grow?" is right
 * either way round.
 *
 * Measured live in R29: banking is NOT reachable from this browser today —
 * banks are built only by dogmaIM.LinkWeapons, which is not allowlisted, and
 * two same-type turrets fired together each reported their OWN itemID with
 * `isBanked:false` on every damage message. This is therefore a guard against
 * a real server behaviour the client cannot currently trigger, not a fix for a
 * bug firing today. It costs one extra snapshot read and cannot be wrong.
 *
 * Returns null when either snapshot could not answer — "unknown", never "off".
 */
function activationLanded(idsBefore, idsAfter, itemID) {
  if (idsAfter === null) {
    return null;
  }
  if (idsAfter.includes(itemID)) {
    return true;
  }
  if (idsBefore === null) {
    return false;
  }
  // The named module is absent, but something new IS cycling that was not
  // before: that is the bank master standing in for the weapon we asked for.
  const before = new Set(idsBefore);
  if (idsAfter.some((id) => !before.has(id))) {
    return true;
  }
  // Nothing is running at all, so nothing started. Unambiguous.
  if (idsAfter.length === 0) {
    return false;
  }
  // Otherwise the running set did not change and the module we named is not in
  // it. From OUTSIDE, with no bank map, this has two indistinguishable causes:
  // the weapon joined a bank whose master was already cycling, or the server
  // took the call and did nothing. This bridge does not get to guess between
  // "your gun is firing" and "your gun is not", so it says UNKNOWN — the same
  // answer it gives when the snapshot cannot answer at all.
  return null;
}

/**
 * The module itemIDs the server says are CYCLING right now, read from the space
 * snapshot's ship projection (which reads the ship entity's own active-effect
 * map). There is no separate retail call for this, and the browser must never
 * substitute its own memory of what it clicked.
 */
async function readActiveModuleIDs(held) {
  const outcome = await gateway.readSpaceSnapshot(held.bridgeSessionID, {
    userid: held.accountID,
  });
  const ship = outcome && outcome.space ? outcome.space.ship : null;
  const ids = ship && Array.isArray(ship.activeModuleIDs) ? ship.activeModuleIDs : null;
  return {
    // null (not []) when the snapshot could not answer at all, so the caller can
    // say "unknown" instead of "nothing is running".
    ids: ids === null ? null : ids.map((value) => Number(value) || 0).filter((v) => v > 0),
    notifications: outcome ? outcome.notifications : [],
  };
}

// What is locked right now. The page polls this alongside the space snapshot.
app.get("/api/bridge/targets", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const locked = await readLockedTargetIDs(held, req.webSessionID);
    res.json({ ok: true, targetIDs: locked.ids, notifications: locked.notifications });
  } catch (error) {
    next(error);
  }
});

// Lock a target: dogmaIM.AddTarget(targetID) -> [pendingFlag, targetIDList].
//
// A lock is NOT instant — the server acquires it over a duration that depends
// on the ship's scan resolution and the target's signature — so AddTarget
// answering 200 does not mean the target is locked. The pending flag says the
// server ACCEPTED the attempt; the re-read of GetTargets says whether it has
// landed yet. Both are reported separately and the page shows "Locking…" until
// a later poll sees the target in the locked list.
//
// Every refusal (out of range, too many locked, already warping, no such ball)
// is the handler's own reason, passed through untouched.
app.post("/api/bridge/targets/lock", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const targetID = Number(req.body && req.body.targetID) || 0;
  if (targetID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "A target is required." });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "dogmaIM",
      "AddTarget",
      [targetID],
      null,
    );
    // AddTarget answers the retail pair [pendingFlag, targetIDList].
    const pair = Array.isArray(outcome.result) ? outcome.result : [];
    const accepted = Number(pair[0]) === 1;
    // A 200 is not proof: ask the server what is actually locked.
    const locked = await readLockedTargetIDs(held, req.webSessionID);
    res.json({
      ok: true,
      targetID,
      // The lock has LANDED.
      locked: locked.ids.includes(targetID),
      // The server accepted the attempt and is still acquiring it.
      acquiring: accepted && !locked.ids.includes(targetID),
      targetIDs: locked.ids,
      notifications: [...outcome.notifications, ...locked.notifications],
    });
  } catch (error) {
    next(error);
  }
});

// Unlock one target: dogmaIM.RemoveTarget(targetID). The handler returns null
// whether or not anything was dropped, so the re-read is the whole answer.
//
// Unlocking is deliberately ONE TARGET AT A TIME: dogmaIM.RemoveTargets and
// ClearTargets (drop every lock in a single call) are NOT allowlisted, so a
// stray click here can only ever cost one lock.
app.post("/api/bridge/targets/unlock", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const targetID = Number(req.body && req.body.targetID) || 0;
  if (targetID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "A target is required." });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    // A lock that is still being ACQUIRED is not in the locked list yet, and
    // RemoveTarget does not touch it — CancelAddTarget is the verb for that.
    // Cancelling first makes one "Unlock" button correct in both states; a
    // cancel for a target that was never pending is a no-op on the server.
    const cancelled = await heldTopLevelCall(
      held,
      req.webSessionID,
      "dogmaIM",
      "CancelAddTarget",
      [targetID],
      null,
    );
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "dogmaIM",
      "RemoveTarget",
      [targetID],
      null,
    );
    const locked = await readLockedTargetIDs(held, req.webSessionID);
    res.json({
      ok: true,
      targetID,
      // The only claim worth making: it is no longer locked.
      released: !locked.ids.includes(targetID),
      targetIDs: locked.ids,
      notifications: [
        ...cancelled.notifications,
        ...outcome.notifications,
        ...locked.notifications,
      ],
    });
  } catch (error) {
    next(error);
  }
});

// Switch a module ON: dogmaIM.Activate(moduleItemID, effectName, targetID, repeat).
//
// GENERIC BY CONSTRUCTION. The browser does not know, and must not guess, which
// effect a given module runs: an EMPTY effect name makes the server resolve the
// module's own default activation effect from its typeID. A caller that DOES
// know (slice B sends "miningLaser") may name one, and combat will name its
// own — but that is the caller's argument, not this route's business.
//
// `repeat` is the retail cycle flag: -1 keeps cycling until something stops it,
// 0 runs a single cycle. Default -1, the retail default for a held module.
//
// The handler owns every refusal — module not online, no target, target not
// locked, out of range, not enough capacitor, wrong charge/crystal — and each
// arrives with its own reason, which is passed through untouched. This BFF
// never pre-judges whether a module can run.
app.post("/api/bridge/modules/activate", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemID = Number(body.itemID) || 0;
  if (itemID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_MODULE", message: "A module is required." });
    return;
  }
  const effect = typeof body.effect === "string" ? body.effect : "";
  const targetID = Number(body.targetID) || 0;
  const repeat = body.repeat === 0 || body.repeat === "0" ? 0 : -1;
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    // Read the running set BEFORE, so success can be judged as a set DELTA
    // rather than by asking whether this exact itemID came back.
    const activeBefore = await readActiveModuleIDs(held);
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "dogmaIM",
      "Activate",
      [itemID, effect, targetID > 0 ? targetID : null, repeat],
      null,
    );
    // A 200 is not proof: ask the server which modules are actually cycling.
    const active = await readActiveModuleIDs(held);
    res.json({
      ok: true,
      itemID,
      // null when the snapshot could not answer — "unknown", never "off".
      active: activationLanded(activeBefore.ids, active.ids, itemID),
      activeModuleIDs: active.ids,
      notifications: [...outcome.notifications, ...active.notifications],
    });
  } catch (error) {
    next(error);
  }
});

// Switch a module OFF: dogmaIM.Deactivate(moduleItemID, effectName). Same
// generality, same re-read.
app.post("/api/bridge/modules/deactivate", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemID = Number(body.itemID) || 0;
  if (itemID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_MODULE", message: "A module is required." });
    return;
  }
  const effect = typeof body.effect === "string" ? body.effect : "";
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const activeBefore = await readActiveModuleIDs(held);
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "dogmaIM",
      "Deactivate",
      [itemID, effect],
      null,
    );
    const active = await readActiveModuleIDs(held);
    const landed = activationLanded(activeBefore.ids, active.ids, itemID);
    res.json({
      ok: true,
      itemID,
      stopped: landed === null ? null : !landed,
      activeModuleIDs: active.ids,
      notifications: [...outcome.notifications, ...active.notifications],
    });
  } catch (error) {
    next(error);
  }
});

// --- R23 slice B: the mining loop -------------------------------------------
//
// mine -> haul -> refine -> sell. Note what is NOT here: there is no "start
// mining" route and no mining cycle. Mining a rock IS slice A's generic
// lock-then-activate with a mining laser's itemID, flying to the belt is R5a's
// warp and R13's orbit, and selling the minerals is R16's market. Slice B adds
// only what was genuinely missing — a place to see the ore, a way to get it
// home, the survey scanner, and the refinery.
//
// The BROWSER NEVER SIMULATES A CYCLE. It does not predict yield, it does not
// count down a rock, and it does not decide when a hold is full. It asks the
// server and shows the answer.

// The ore/gas/ice hold ladder (server-side flags 134/135/181/182), with the
// ship's ordinary cargo hold as the fallback the mining runtime itself falls
// back to. THESE NUMBERS NEVER LEAVE THIS FILE: the browser is handed a NAME
// per hold ("Ore hold", "Ice hold") and never a flagID (R7d / R9a).
const MINING_HOLDS = Object.freeze([
  Object.freeze({ key: "ore", flag: 134, label: "Ore hold" }),
  Object.freeze({ key: "gas", flag: 135, label: "Gas hold" }),
  Object.freeze({ key: "ice", flag: 181, label: "Ice hold" }),
  Object.freeze({ key: "asteroid", flag: 182, label: "Asteroid hold" }),
  // The fallback: a hull with no specialised hold mines straight into cargo,
  // so a miner flying a frigate must still be able to see and unload the ore.
  Object.freeze({ key: "cargo", flag: ITEM_FLAG_CARGO_HOLD, label: "Cargo hold" }),
]);

/** A util.KeyVal capacity reading ({capacity, used}) as plain numbers, or null. */
function decodeCapacityReading(result) {
  const entries =
    result && result.args && Array.isArray(result.args.entries) ? result.args.entries : [];
  const read = (key) => {
    const entry = entries.find((pair) => Array.isArray(pair) && pair[0] === key);
    const value = entry ? entry[1] : undefined;
    const numeric = Number(value && typeof value === "object" ? value.value : value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const capacity = read("capacity");
  const used = read("used");
  return capacity === null && used === null ? null : { capacity, used };
}

// Read the ship's mining holds. Every hold in the ladder is read independently
// (Promise.allSettled) so one that the hull does not have — or one whose read
// fails — never blanks the rest, and a hold that answers nothing at all is
// simply reported as absent rather than as an empty hold.
app.get("/api/bridge/ship/ore-hold", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const shipID = held.activeShipID;
    if (!shipID) {
      res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship." });
      return;
    }
    const spec = cargoBindSpec(held, shipID);
    const settled = await Promise.allSettled(
      MINING_HOLDS.flatMap((hold) => [
        boundCall(held, req.webSessionID, spec, "List", [hold.flag], null),
        boundCall(held, req.webSessionID, spec, "GetCapacity", [hold.flag], null),
      ]),
    );
    for (const entry of settled) {
      if (entry.status === "rejected" && entry.reason && entry.reason.code === "SESSION_NOT_FOUND") {
        next(entry.reason);
        return;
      }
    }
    const holds = MINING_HOLDS.map((hold, index) => {
      const listed = settled[index * 2];
      const capacity = settled[index * 2 + 1];
      // R7d: the shared row decoder carries flagID and locationID, and NEITHER
      // may reach the browser — the whole point of naming the holds here is
      // that the page never learns 134 exists. Only what a player reads about
      // a stack survives: what it is, and how much of it there is.
      const rows =
        listed.status === "fulfilled"
          ? decodeInventoryRows(listed.value.result).map((row) => ({
              itemID: row.itemID,
              typeID: row.typeID,
              quantity: row.quantity,
            }))
          : null;
      const reading =
        capacity.status === "fulfilled" ? decodeCapacityReading(capacity.value.result) : null;
      return {
        // A NAME, never a flag number. The browser has no idea 134 exists.
        key: hold.key,
        label: hold.label,
        // null (not []) when the read failed: "we could not look" is not the
        // same as "the hold is empty", and the page says which.
        items: rows,
        capacity: reading,
        // A hull without this hold answers a zero capacity; say so plainly so
        // the page can leave it out instead of showing an empty 0 / 0 bar.
        present: reading !== null && Number(reading.capacity) > 0,
        error:
          listed.status === "rejected"
            ? String((listed.reason && listed.reason.code) || "READ_FAILED")
            : capacity.status === "rejected"
              ? String((capacity.reason && capacity.reason.code) || "READ_FAILED")
              : null,
      };
    });
    res.json({ ok: true, activeShipID: shipID, stationID: held.stationID, holds });
  } catch (error) {
    next(error);
  }
});

// Unload mined ore into the station hangar. This is R3's invbroker.Add in the
// unfit direction: the DESTINATION (the hangar) is the bound object and the ship
// is the source location — no new server method at all.
//
// Docked-only, because there is nowhere else for it to go.
app.post("/api/bridge/ship/ore-hold/unload", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const requested = Array.isArray(body.itemIDs)
    ? body.itemIDs.map((value) => Number(value) || 0).filter((value) => value > 0)
    : [];
  if (requested.length === 0) {
    res.status(400).json({
      ok: false,
      error: "NOTHING_SELECTED",
      message: "Choose what to unload first.",
    });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!before.flight || before.flight.docked !== true) {
      res.status(409).json({
        ok: false,
        error: "NOT_DOCKED",
        message: "Dock at a station before unloading.",
      });
      return;
    }
    const shipID = held.activeShipID;
    if (!shipID) {
      res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship." });
      return;
    }
    const hangarSpec = hangarBindSpec(held);
    const notifications = [];
    for (const itemID of requested) {
      const outcome = await boundCall(
        held,
        req.webSessionID,
        hangarSpec,
        "Add",
        [itemID, shipID],
        { flag: ITEM_FLAG_HANGAR },
      );
      notifications.push(...outcome.notifications);
    }
    // A 200 is not proof — invbroker can decline a move silently. The answer is
    // what the HOLDS say afterwards: anything still sitting in a mining hold
    // did not move, and is named as such rather than assumed moved.
    const spec = cargoBindSpec(held, shipID);
    const stillHeld = new Set();
    for (const hold of MINING_HOLDS) {
      try {
        const listed = await boundCall(held, req.webSessionID, spec, "List", [hold.flag], null);
        for (const row of decodeInventoryRows(listed.result)) {
          stillHeld.add(row.itemID);
        }
      } catch {
        // A hold that cannot be re-read leaves its items unverified; they are
        // reported as not-moved rather than silently counted as moved.
      }
    }
    const moved = requested.filter((itemID) => !stillHeld.has(itemID));
    res.json({
      ok: true,
      requested,
      moved,
      remaining: requested.filter((itemID) => stillHeld.has(itemID)),
      notifications,
    });
  } catch (error) {
    next(error);
  }
});

// --- R40 ship bays ---------------------------------------------------------
//
// EVERY bay a hull can have, by NAME. A "bay" is nothing but an inventory FLAG
// on the ship's own inventory — exactly the mechanism R12 fitting uses for slot
// flags — so enumerating a hull's bays is one GetCapacity per candidate flag.
//
// WHY THIS ROUTE EXISTS AT ALL (the client-first rule). Bound-object calls are
// BFF-only: /api/bridge/call is a TOP-LEVEL proxy and cannot dispatch on a
// bound handle, so the browser physically cannot run the bind-then-List
// two-step. The existing routes each read a fixed slice and none of them
// answers "what bays does THIS ship have": /ship/ore-hold covers the four
// mining holds plus cargo and only for the ACTIVE ship; /drones covers the
// drone bay, again active-ship only; /inventory/container/:itemID binds an
// arbitrary itemID but calls List/GetCapacity with NO flag, which answers for
// one unnamed default hold and can never enumerate the rest. A ship sitting in
// the hangar that the player has not boarded is unreadable today.
//
// It adds NO eve.js allowlist pairs. GetInventoryFromId (the bind), ListByFlags
// and GetCapacity are all ALREADY allowlisted (evejsWebGatewayRuntime.js) and
// already driven from this file — GetInventoryFromId by containerBindSpec,
// GetCapacity by /api/bridge/inventory, ListByFlags by /api/bridge/drones. So
// no gateway restart is required and no new server surface is exposed.
//
// WHICH FLAGS. Only the flags eve.js actually MAPS to a hull attribute are
// asked about. That is not fussiness: _calculateCapacity initialises capacity
// to 1000000.0 and returns it untouched when no branch matches, so asking about
// an unmapped flag (151 specialized material bay, for instance) yields a
// phantom 1,000,000 m³ bay on every hull in the game. Asking only about mapped
// flags means a capacity of 0 always means "this hull has no such bay".
//
// THESE NUMBERS NEVER LEAVE THIS FILE (R7d/R9a): the browser is handed a key
// and a LABEL per bay and never learns that 134 exists.
const SHIP_BAYS = Object.freeze([
  Object.freeze({ key: "cargo", flag: ITEM_FLAG_CARGO_HOLD, label: "Cargo hold" }),
  // The same flag ITEM_FLAG_DRONE_BAY names for /api/bridge/drones; spelled out
  // here because that constant is declared further down this file and a const
  // cannot be read before its declaration is evaluated.
  Object.freeze({ key: "drone", flag: 87, label: "Drone bay" }),
  Object.freeze({ key: "shipMaintenance", flag: 90, label: "Ship maintenance bay" }),
  Object.freeze({ key: "fuel", flag: 133, label: "Fuel bay" }),
  Object.freeze({ key: "ore", flag: 134, label: "Ore hold" }),
  Object.freeze({ key: "gas", flag: 135, label: "Gas hold" }),
  Object.freeze({ key: "mineral", flag: 136, label: "Mineral hold" }),
  Object.freeze({ key: "salvage", flag: 137, label: "Salvage hold" }),
  Object.freeze({ key: "ship", flag: 138, label: "Ship hold" }),
  Object.freeze({ key: "smallShip", flag: 139, label: "Small ship hold" }),
  Object.freeze({ key: "mediumShip", flag: 140, label: "Medium ship hold" }),
  Object.freeze({ key: "largeShip", flag: 141, label: "Large ship hold" }),
  Object.freeze({ key: "industrialShip", flag: 142, label: "Industrial ship hold" }),
  Object.freeze({ key: "ammo", flag: 143, label: "Ammo hold" }),
  Object.freeze({ key: "commandCenter", flag: 148, label: "Command center hold" }),
  Object.freeze({ key: "planetary", flag: 149, label: "Planetary commodities hold" }),
  Object.freeze({ key: "quafe", flag: 154, label: "Quafe bay" }),
  Object.freeze({ key: "fleet", flag: 155, label: "Fleet hangar" }),
  Object.freeze({ key: "fighter", flag: 158, label: "Fighter bay" }),
  Object.freeze({ key: "corpse", flag: 174, label: "Corpse bay" }),
  Object.freeze({ key: "booster", flag: 176, label: "Booster bay" }),
  Object.freeze({ key: "subsystem", flag: 177, label: "Subsystem bay" }),
  Object.freeze({ key: "ice", flag: 181, label: "Ice hold" }),
  Object.freeze({ key: "asteroid", flag: 182, label: "Asteroid hold" }),
  Object.freeze({ key: "mobileDepot", flag: 183, label: "Mobile depot hold" }),
  Object.freeze({ key: "colony", flag: 185, label: "Colony resources hold" }),
  Object.freeze({ key: "expedition", flag: 188, label: "Expedition hold" }),
]);

// Which bays a ship has, what each one holds, and how full it is.
//
// ABSENT IS NOT EMPTY, AND NEITHER IS UNKNOWN. Three states cross the wire,
// because conflating them is the mistake worldHasNoContracts exists to prevent:
//   present === true   the hull HAS this bay (capacity > 0)
//   present === false  the hull does NOT have it (the server answered 0)
//   present === null   we could not tell — the capacity read itself FAILED
// A 200 on this route is not proof any individual bay was read.
app.get("/api/bridge/ship/:shipID/bays", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const shipID = Number(req.params.shipID) || 0;
  if (shipID <= 0) {
    res.status(400).json({ ok: false, error: "INVALID_SHIP", message: "A ship is required." });
    return;
  }
  // The bind is the SAME call a container binds with — a ship's bays are just
  // its own inventory, so there is no ship-specific bind method.
  const spec = containerBindSpec(shipID);
  try {
    // One capacity read per candidate flag, all independent: a hull that
    // refuses one bay must not blank the other twenty-six.
    const settled = await Promise.allSettled(
      SHIP_BAYS.map((bay) =>
        boundCall(held, req.webSessionID, spec, "GetCapacity", [bay.flag], null),
      ),
    );
    for (const entry of settled) {
      if (entry.status === "rejected" && entry.reason && entry.reason.code === "SESSION_NOT_FOUND") {
        next(entry.reason);
        return;
      }
    }
    const readings = SHIP_BAYS.map((bay, index) => {
      const outcome = settled[index];
      if (outcome.status !== "fulfilled") {
        // Could not look. NOT "the hull lacks this bay".
        return { bay, capacity: null, present: null, error: String((outcome.reason && outcome.reason.code) || "READ_FAILED") };
      }
      const reading = decodeCapacityReading(outcome.value.result);
      if (reading === null || reading.capacity === null) {
        return { bay, capacity: reading, present: null, error: "NO_CAPACITY_REPORTED" };
      }
      return { bay, capacity: reading, present: Number(reading.capacity) > 0, error: null };
    });

    // Contents come from ONE ListByFlags over just the bays that exist, rather
    // than a List per bay: the rows carry their own flagID, so a single read
    // fills every bay at once. An absent bay is never asked about.
    const presentReadings = readings.filter((entry) => entry.present === true);
    let byFlag = null;
    let listError = null;
    if (presentReadings.length > 0) {
      try {
        const listed = await boundCall(
          held,
          req.webSessionID,
          spec,
          "ListByFlags",
          [presentReadings.map((entry) => entry.bay.flag)],
          null,
        );
        byFlag = new Map(presentReadings.map((entry) => [entry.bay.flag, []]));
        for (const row of decodeInventoryRows(listed.result)) {
          const bucket = byFlag.get(row.flagID);
          if (bucket) {
            // R7d: flagID and locationID are wire detail and must NOT reach the
            // browser. Only what a player reads about a stack survives — what
            // it is, how much of it there is, and enough to name and act on it.
            bucket.push({
              itemID: row.itemID,
              typeID: row.typeID,
              groupID: row.groupID,
              categoryID: row.categoryID,
              quantity: row.quantity,
              singleton: row.singleton,
            });
          }
        }
      } catch (error) {
        if (error && error.code === "SESSION_NOT_FOUND") {
          next(error);
          return;
        }
        listError = String(error.code || "READ_FAILED");
      }
    }

    res.json({
      ok: true,
      shipID,
      activeShipID: held.activeShipID || null,
      bays: readings.map((entry) => ({
        key: entry.bay.key,
        label: entry.bay.label,
        present: entry.present,
        capacity: entry.capacity,
        // null is "we could not look"; [] is "we looked, and it is empty".
        // An absent bay has no contents to speak of and stays null.
        items:
          entry.present === true && byFlag !== null ? byFlag.get(entry.bay.flag) || [] : null,
        error: entry.error || (entry.present === true ? listError : null),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// The survey scanner: miningScanMgr.perform_scan() -> [[entityID, yieldTypeID,
// remainingQuantity], …]. Read-only, session-scoped, no arguments. This is how
// the player learns how much ore a rock has left; the browser MERGES it into
// the overview rather than computing anything of its own.
app.get("/api/bridge/mining/scan", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "miningScanMgr",
      "perform_scan",
      [],
      null,
    );
    res.json({ ok: true, results: outcome.result, notifications: outcome.notifications });
  } catch (error) {
    next(error);
  }
});

// R3's bound-object machinery, reused: Moniker('reprocessingSvc', stationID).
// Keyed by station so docking somewhere else binds that station's refinery
// rather than reusing a stale OID.
function reprocessingBindSpec(held) {
  return {
    key: `reprocessing:${held.stationID}`,
    service: "reprocessingSvc",
    method: "MachoBindObject",
    args: [held.stationID],
    kwargs: null,
  };
}

/** One value out of a util.KeyVal, unwrapping a marshaled long but NOT a
 * nested list/dict (which the caller still needs whole). */
function readKeyValField(entries, key) {
  const entry = entries.find((pair) => Array.isArray(pair) && pair[0] === key);
  const value = entry ? entry[1] : undefined;
  if (value && typeof value === "object" && value.type === "long") {
    return value.value;
  }
  return value;
}

function keyValEntries(value) {
  return value && value.args && Array.isArray(value.args.entries) ? value.args.entries : [];
}

/**
 * GetQuotes' [tax, efficiencyByTypeID, quotesByItemID] triple, as plain data.
 *
 * ⚠ `recoverables` is a LIST of util.KeyVals — NOT a dict of typeID -> amount —
 * and the amount the player actually receives is the `client` field on each
 * (`unrecoverable` is the station's share, which is exactly what the player must
 * not be shown as theirs). Getting this wrong would put a confidently wrong
 * mineral count on screen, so it is read from the real handler's shape
 * (services/station/reprocessingService.js buildRecoverableEntry).
 */
function decodeReprocessingQuotes(result) {
  const triple = Array.isArray(result) ? result : [];
  const taxRaw = Number(triple[0]);
  const dictEntries = (value) =>
    value && value.type === "dict" && Array.isArray(value.entries) ? value.entries : [];
  const quotes = [];
  for (const [itemID, quote] of dictEntries(triple[2])) {
    const entries = keyValEntries(quote);
    const numericItemID = Number(itemID) || 0;
    if (numericItemID <= 0) {
      continue;
    }
    const recoverables = readKeyValField(entries, "recoverables");
    const outputs = [];
    const recoverableItems =
      recoverables && recoverables.type === "list" && Array.isArray(recoverables.items)
        ? recoverables.items
        : [];
    for (const recoverable of recoverableItems) {
      const fields = keyValEntries(recoverable);
      const typeID = Number(readKeyValField(fields, "typeID")) || 0;
      // `client` is the player's share. Anything else on the entry is the
      // station's, and must never be presented as what the player gets.
      const quantity = Number(readKeyValField(fields, "client")) || 0;
      if (typeID > 0 && quantity > 0) {
        outputs.push({ typeID, quantity });
      }
    }
    const iskCost = Number(readKeyValField(entries, "totalISKCost"));
    quotes.push({
      itemID: numericItemID,
      typeID: Number(readKeyValField(entries, "typeID")) || null,
      quantityToProcess: Number(readKeyValField(entries, "quantityToProcess")) || null,
      leftOvers: Number(readKeyValField(entries, "leftOvers")) || null,
      // What this stack costs in ISK, as the station computed it.
      iskCost: Number.isFinite(iskCost) ? iskCost : null,
      outputs,
    });
  }
  return {
    // null rather than 0 when the server did not give a rate: "we do not know
    // the tax" and "the tax is nothing" are different, and a wrong 0 would
    // understate what this costs.
    taxRate: Number.isFinite(taxRaw) ? taxRaw : null,
    quotes,
  };
}

// What reprocessing these stacks WOULD produce, and what the station will take.
// A pure read: nothing is consumed and nothing is charged by this route. The
// tax comes back first in the retail triple and is passed through as its own
// field, because the page must show it BEFORE the player commits.
app.get("/api/bridge/reprocessing/quote", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const itemIDs = String((req.query && req.query.itemIDs) || "")
    .split(",")
    .map((value) => Number(value.trim()) || 0)
    .filter((value) => value > 0);
  if (itemIDs.length === 0) {
    res.status(400).json({
      ok: false,
      error: "NOTHING_SELECTED",
      message: "Choose what to reprocess first.",
    });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!before.flight || before.flight.docked !== true) {
      res.status(409).json({
        ok: false,
        error: "NOT_DOCKED",
        message: "Dock at a station to use its refinery.",
      });
      return;
    }
    const outcome = await boundCall(
      held,
      req.webSessionID,
      reprocessingBindSpec(held),
      "GetQuotes",
      [itemIDs],
      null,
    );
    const decoded = decodeReprocessingQuotes(outcome.result);
    res.json({
      ok: true,
      stationID: held.stationID,
      taxRate: decoded.taxRate,
      quotes: decoded.quotes,
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

// ⚠ REPROCESS CONSUMES THE INPUT STACKS AND CHARGES ISK TAX. It is the only
// destructive route in the mining loop, so it refuses outright unless the caller
// explicitly confirms — a second gate behind the page's own two-step
// confirmation, exactly like R12's destroy-rig. Neither a stray click nor a
// stray POST can consume a hold full of ore.
app.post("/api/bridge/reprocessing/reprocess", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const itemIDs = Array.isArray(body.itemIDs)
    ? body.itemIDs.map((value) => Number(value) || 0).filter((value) => value > 0)
    : [];
  if (itemIDs.length === 0) {
    res.status(400).json({
      ok: false,
      error: "NOTHING_SELECTED",
      message: "Choose what to reprocess first.",
    });
    return;
  }
  if (body.confirm !== true) {
    res.status(400).json({
      ok: false,
      error: "CONFIRMATION_REQUIRED",
      message:
        "Reprocessing consumes the ore and charges the station's tax. This action must be confirmed explicitly.",
    });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!before.flight || before.flight.docked !== true) {
      res.status(409).json({
        ok: false,
        error: "NOT_DOCKED",
        message: "Dock at a station to use its refinery.",
      });
      return;
    }
    const spec = reprocessingBindSpec(held);
    // Reprocess(itemIDs, fromLocationID, ownerID, outputLocationID?, outputFlagID?)
    // — the station hangar is both the source and the destination, so the
    // minerals land where the ore was.
    const outcome = await boundCall(
      held,
      req.webSessionID,
      spec,
      "Reprocess",
      [itemIDs, held.stationID, held.characterID || 0, null, null],
      null,
    );
    // A 200 is not proof: re-read the hangar and report which stacks are
    // actually gone. A stack still present was NOT reprocessed, whatever the
    // call answered.
    let stillPresent = null;
    try {
      const listed = await boundCall(
        held,
        req.webSessionID,
        hangarBindSpec(held),
        "List",
        [ITEM_FLAG_HANGAR],
        null,
      );
      stillPresent = new Set(decodeInventoryRows(listed.result).map((row) => row.itemID));
    } catch {
      // The hangar could not be re-read, so nothing can be claimed either way.
      stillPresent = null;
    }
    res.json({
      ok: true,
      requested: itemIDs,
      // null when the verification read failed — "we could not check", which is
      // reported as such and never as success.
      processed: stillPresent === null ? null : itemIDs.filter((id) => !stillPresent.has(id)),
      remaining: stillPresent === null ? null : itemIDs.filter((id) => stillPresent.has(id)),
      notifications: outcome.notifications,
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

// --- R25 slice A: drones ----------------------------------------------------
//
// The first thing on this bridge that KEEPS FIGHTING after the browser stops
// asking, and that is the whole point. An idle combat drone auto-engages
// whatever shoots the ship it was launched from — the server's own behaviour
// (droneRuntime's incoming-aggression hook, gated on a per-drone `aggressive`
// setting that DEFAULTS ON). So for a miner sitting in a belt the minimum
// viable defence is LAUNCHING. Engage below is for CHOOSING a victim; it is not
// what makes a player defended, and this BFF does not imply that it is.
//
// ⚠ THE SERVICE SPLIT. Launch and scoop are `ship`; every in-space order is
// `entity`. One feature, two services.
//
// ⚠ LAUNCH ANSWERS 200 WHEN IT REFUSES. The server's handler returns an empty
// dict on outright failure and an error tuple per itemID on partial failure —
// bandwidth, the active-drone cap, a wrong bay flag and a vanished stack all
// arrive that way. Nothing here reads a 200 as a launch: every route below
// re-reads the SPACE SNAPSHOT and reports what is actually out there.

// The ship's drone bay flag. Like the mining holds and the slot flags, this
// number NEVER leaves this file — the browser is handed drones by name.
const ITEM_FLAG_DRONE_BAY = 87;

/**
 * The drones the SERVER says are in space under this ship's control.
 *
 * Owner AND controller are both checked. `ownerID` alone would also match a
 * drone this character owns but launched from a hull they have since swapped
 * out of; `controllerID` alone would match a drone flown by this hull for
 * someone else. A drone the panel offers a Recall button for must be both.
 */
async function readDronesInSpace(held) {
  const outcome = await gateway.readSpaceSnapshot(held.bridgeSessionID, {
    userid: held.accountID,
  });
  const space = outcome && outcome.space ? outcome.space : null;
  const entities = space && Array.isArray(space.entities) ? space.entities : null;
  if (entities === null) {
    // null, not [] — "we could not look" is not "you have no drones in space",
    // and a page that confuses the two invites a player to launch a second set.
    return { drones: null, notifications: outcome ? outcome.notifications : [] };
  }
  const shipID = Number(held.activeShipID) || 0;
  const characterID = Number(held.characterID) || 0;
  const drones = entities
    .filter((row) => row && row.kind === "drone")
    .filter((row) => {
      const owner = Number(row.ownerID) || 0;
      const controller = Number(row.controllerID) || 0;
      return (
        (characterID > 0 && owner === characterID) ||
        (shipID > 0 && controller === shipID)
      );
    })
    .map((row) => ({
      itemID: Number(row.itemID) || 0,
      typeID: Number(row.typeID) || null,
      // A NAME. The panel never renders the itemID it keys rows by (R7d).
      name: typeof row.name === "string" && row.name.length > 0 ? row.name : null,
      // A WORD, or null for "we could not tell" — never a raw activity enum.
      activity: typeof row.droneActivity === "string" ? row.droneActivity : null,
      // What it is busy with, so the page can name the rock or the rat.
      targetID: Number(row.targetEntityID) || null,
      shieldRatio: typeof row.shieldRatio === "number" ? row.shieldRatio : null,
      armorRatio: typeof row.armorRatio === "number" ? row.armorRatio : null,
      hullRatio: typeof row.hullRatio === "number" ? row.hullRatio : null,
    }));
  return { drones, notifications: outcome ? outcome.notifications : [] };
}

// The whole Drones panel: what is in the bay, what is in space, and the two
// limits the server enforces on a launch.
//
// The LIMITS ADD NO ALLOWLIST PAIR. maxActiveDrones and droneBandwidth are
// ordinary ship dogma attributes, and dogmaIM.ShipGetInfo — allowlisted since
// R6 for the fitting panel — already answers the ship's whole attribute map.
// The raw result is passed through and decoded browser-side, exactly as the
// fitting route does, so the attribute IDs live in one place.
//
// The three reads are INDEPENDENT (allSettled): a bay that cannot be read must
// not blank the drones already flying, and vice versa.
app.get("/api/bridge/drones", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    await readHeldFlight(held, req.webSessionID);
    const shipID = held.activeShipID;
    if (!shipID) {
      res.status(409).json({ ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship." });
      return;
    }
    const noShip = () =>
      Promise.reject(Object.assign(new Error("No active ship."), { code: "NO_ACTIVE_SHIP" }));
    const [bay, shipInfo, inSpace] = await Promise.allSettled([
      boundCall(
        held,
        req.webSessionID,
        cargoBindSpec(held, shipID),
        "ListByFlags",
        [[ITEM_FLAG_DRONE_BAY]],
        null,
      ),
      heldTopLevelCall(held, req.webSessionID, "dogmaIM", "ShipGetInfo", [], null),
      shipID ? readDronesInSpace(held) : noShip(),
    ]);
    for (const settled of [bay, shipInfo, inSpace]) {
      if (settled.status === "rejected" && settled.reason && settled.reason.code === "SESSION_NOT_FOUND") {
        next(settled.reason);
        return;
      }
    }
    const settledCode = (settled) =>
      settled.status === "rejected"
        ? String((settled.reason && settled.reason.code) || "READ_FAILED")
        : null;
    // R7d: the shared row decoder carries flagID and locationID and NEITHER may
    // reach the browser. Only what a player reads about a drone stack survives.
    const bayRows =
      bay.status === "fulfilled"
        ? decodeInventoryRows(bay.value.result).map((row) => ({
            itemID: row.itemID,
            typeID: row.typeID,
            quantity: row.quantity,
          }))
        : null;
    res.json({
      ok: true,
      activeShipID: shipID,
      // null (not []) on a failed read: "we could not look in the bay" is not
      // "the bay is empty", and the panel says which.
      bay: bayRows,
      inSpace: inSpace.status === "fulfilled" ? inSpace.value.drones : null,
      // Raw, decoded browser-side alongside the fitting panel's attributes.
      shipInfo: shipInfo.status === "fulfilled" ? shipInfo.value.result : null,
      errors: {
        bay: settledCode(bay),
        shipInfo: settledCode(shipInfo),
        inSpace: settledCode(inSpace),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * The shared tail of every drone mutation: re-read what is actually in space
 * and answer with it.
 *
 * Not one of the four server calls below returns anything a caller can trust.
 * LaunchDrones answers a dict that is empty on failure; CmdEngage,
 * CmdMineRepeatedly and CmdReturnBay answer a dict that is empty on SUCCESS and
 * carries per-drone error tuples otherwise. The snapshot is the authority, and
 * it is the same authority in all four cases.
 */
async function answerWithDronesInSpace(res, held, extra, notifications) {
  let after = { drones: null, notifications: [] };
  try {
    after = await readDronesInSpace(held);
  } catch {
    // The re-read failed; `inSpace: null` says so rather than claiming an
    // outcome the server never confirmed.
  }
  res.json({
    ok: true,
    ...extra,
    inSpace: after.drones,
    notifications: [...notifications, ...after.notifications],
  });
}

// Launch from the bay: ship.LaunchDrones([[itemID, qty], …], whoseBehalfID,
// ignoreWarning).
//
// The BFF does NOT pre-check bandwidth or the active-drone cap. The server owns
// both limits, refuses per drone with its own reason, and would have to be
// re-implemented here to guess — so the page shows the limits, sends the
// request, and reports what came back in space.
app.post("/api/bridge/drones/launch", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  const requested = Array.isArray(body.drones)
    ? body.drones
        .map((entry) => ({
          itemID: Number(entry && entry.itemID) || 0,
          quantity: Math.max(1, Number(entry && entry.quantity) || 1),
        }))
        .filter((entry) => entry.itemID > 0)
    : [];
  if (requested.length === 0) {
    res.status(400).json({
      ok: false,
      error: "NOTHING_SELECTED",
      message: "Choose which drones to launch first.",
    });
    return;
  }
  try {
    const before = await readHeldFlight(held, req.webSessionID);
    if (!requireInSpace(res, before.flight)) {
      return;
    }
    // What was ALREADY out, so "launched" can mean "new since the request"
    // rather than "everything in space". A read that fails here does not block
    // the launch — it just makes the outcome unverifiable, which is reported as
    // such below rather than guessed at.
    let beforeSpace = { drones: null, notifications: [] };
    try {
      beforeSpace = await readDronesInSpace(held);
    } catch {
      beforeSpace = { drones: null, notifications: [] };
    }
    const already = new Set((beforeSpace.drones || []).map((drone) => drone.itemID));
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "ship",
      "LaunchDrones",
      [requested.map((entry) => [entry.itemID, entry.quantity]), held.characterID || 0, false],
      null,
    );
    let after = { drones: null, notifications: [] };
    try {
      after = await readDronesInSpace(held);
    } catch {
      after = { drones: null, notifications: [] };
    }
    res.json({
      ok: true,
      requested: requested.map((entry) => entry.itemID),
      inSpace: after.drones,
      // The only honest claim: which drones are in space NOW that were not
      // before. A launch the server declined simply does not appear here, and
      // the panel reports "nothing launched" instead of a phantom success.
      //
      // null when EITHER read failed — without the "before" list, a drone in
      // space now could equally have been there all along, so there is nothing
      // to claim in either direction.
      launched:
        after.drones === null || beforeSpace.drones === null
          ? null
          : after.drones.filter((drone) => !already.has(drone.itemID)),
      notifications: [...beforeSpace.notifications, ...outcome.notifications, ...after.notifications],
    });
  } catch (error) {
    next(error);
  }
});

/** Normalize a `droneIDs` body field for the three entity orders below. */
function readDroneIDs(body) {
  return Array.isArray(body && body.droneIDs)
    ? body.droneIDs.map((value) => Number(value) || 0).filter((value) => value > 0)
    : [];
}

/**
 * The three in-space orders. All three are the SAME shape — entity.<Cmd>(
 * [droneIDs], targetID?) followed by the same snapshot re-read — so they share
 * one implementation and differ only in the method name and whether a target is
 * required.
 */
function droneOrderRoute(routePath, method, { needsTarget }) {
  app.post(routePath, requireAuth, async (req, res, next) => {
    const held = requireHeldBridgeSession(req, res);
    if (!held) {
      return;
    }
    const body = req.body || {};
    const droneIDs = readDroneIDs(body);
    if (droneIDs.length === 0) {
      res.status(400).json({
        ok: false,
        error: "NO_DRONES",
        message: "Choose which drones to order first.",
      });
      return;
    }
    const targetID = Number(body.targetID) || 0;
    if (needsTarget && targetID <= 0) {
      res.status(400).json({ ok: false, error: "INVALID_TARGET", message: "A target is required." });
      return;
    }
    try {
      const before = await readHeldFlight(held, req.webSessionID);
      if (!requireInSpace(res, before.flight)) {
        return;
      }
      const outcome = await heldTopLevelCall(
        held,
        req.webSessionID,
        "entity",
        method,
        needsTarget ? [droneIDs, targetID] : [droneIDs],
        null,
      );
      await answerWithDronesInSpace(
        res,
        held,
        {
          droneIDs,
          targetID: needsTarget ? targetID : null,
          // R34 — THE SERVER'S OWN REASON, PER DRONE, FORWARDED RAW.
          //
          // ⚠ THIS IS THE REPAIR OF A LOSS, NOT A NEW FEATURE. `droneRuntime.js`
          // writes a plain-language sentence for every drone it refuses —
          // `appendDroneError(response, droneID, "…")`, thirteen distinct
          // sentences, all already player-ready — into the call RESULT dict,
          // keyed by droneID. This route used to forward `outcome.notifications`
          // alone and drop `outcome.result` on the floor, so a refusal the
          // server had already explained in words reached the player as
          // nothing whatsoever. R33 had to PREDICT one of those thirteen
          // client-side because there was nothing to render; the other twelve
          // could not be predicted at all.
          //
          // NOTHING IS DECODED OR TRANSLATED HERE, deliberately. R31's rule is
          // that the BFF forwards the raw structure and the browser is the only
          // place a refusal becomes words — the wording then stays inside reach
          // of the tests that pin it, instead of being re-spelled here.
          //
          // ⚠ THE DICT IS KEYED BY droneID, and that key is an ID (R7d). It is
          // forwarded because it is the ONLY thing that attributes a sentence to
          // a drone; the browser turns it into a NAME and drops it, and no
          // reader of this field may render it.
          result: outcome.result ?? null,
        },
        outcome.notifications,
      );
    } catch (error) {
      next(error);
    }
  });
}

// Attack that ball.
//
// ⚠ The server does NOT require the ship to have the target locked — the
// drone's own visibility check is the gate. The page drives this from the R23
// locked target anyway, because "shoot the thing you deliberately locked" is
// the only version a player can reason about; that is a UI choice, and this
// route does not pretend it is a server rule.
droneOrderRoute("/api/bridge/drones/engage", "CmdEngage", { needsTarget: true });

// Mining drones on a rock (and salvage drones on a wreck — the same call).
droneOrderRoute("/api/bridge/drones/mine", "CmdMineRepeatedly", { needsTarget: true });

// Come home. The runtime flies them back and scoops them into the bay itself
// once they are inside 2500 m, so there is no second call — and the drones stay
// in space, visibly "returning", for as long as the trip takes. The re-read
// reports exactly that rather than pretending the bay is already full.
droneOrderRoute("/api/bridge/drones/recall", "CmdReturnBay", { needsTarget: false });

// --- R28 Skills: the character sheet and the training queue ----------------
//
// TWO DIFFERENT SURFACES ON PURPOSE.
//
// The READ is the gateway's v1 GET /skills — a plain-JSON projection that needs
// no bridge session, because reading what a character knows is not an act of
// piloting. It arrives with names, group names, the SP threshold for every
// level of every skill, and the queue's instants as epoch milliseconds against
// `serverNowMs` sampled in the same read. Nothing is decoded here and nothing
// is computed here.
//
// The WRITE is the retail call skillMgr.SaveNewQueue on the HELD session. It
// has to be: the gateway's own POST /skill-queue runs under an
// OFFLINE_COMPANION authorization policy that requires the character to be
// OFFLINE, and a web login that has selected a character is `retail_client`.
// (Measured, not assumed — eve.js server/tests/webGatewaySkills.test.js pins
// both halves.) So the offline command is a companion-app surface for a
// character who is not playing, and this client's player IS playing.
//
// ⚠ A 200 IS NOT PROOF. SaveNewQueue returns null on success AND validates
// before it writes, so the only honest answer to "did the edit take" is the
// re-read below — which comes back through the gateway's snapshot of
// skillQueueRuntime, the same authority the save wrote to.
async function answerWithSkillSheet(res, account, characterID, extra = {}) {
  const skills = await gateway.getSkills(account.accountID, characterID);
  if (!skills) {
    res.status(404).json({
      ok: false,
      error: "CHARACTER_NOT_FOUND",
      message: "That character was not found.",
    });
    return;
  }
  res.json({ ok: true, ...extra, skills });
}

app.get("/api/bridge/skills", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    await answerWithSkillSheet(res, req.account, held.characterID);
  } catch (error) {
    next(error);
  }
});

/**
 * Save the whole queue (goal R28).
 *
 * Adding a skill, removing one and reordering are ALL "save this list" — that
 * is how retail models it, and inventing three verbs on top of one server call
 * would only create three ways to disagree with the server. The browser sends
 * the list it wants; the server validates it as a whole (prerequisites, level
 * order, Omega gating, the 50-entry cap, the queue-length limit) and refuses
 * the whole list with ONE of its eleven public codes if any of that fails.
 *
 * The refusal codes pass through UNTRANSLATED as the CALL_REFUSED message —
 * turning `QueueCannotPlaceSkillBeforeRequirements` into a sentence a player
 * can act on is the page's job (R9a), and doing it here would put the wording
 * out of reach of the tests that pin it.
 */
app.post("/api/bridge/skills/queue", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  const body = req.body || {};
  if (!Array.isArray(body.entries)) {
    res.status(400).json({
      ok: false,
      error: "INVALID_QUEUE",
      message: "A queue is a list of skills to train.",
    });
    return;
  }
  // Shape-check only. What is TRAINABLE is the server's judgement, and this
  // route never pre-refuses on its behalf — a client-side guess about
  // prerequisites or Omega state is exactly the kind of duplicated mechanic
  // that drifts out of step with the emulator.
  const entries = [];
  for (const entry of body.entries) {
    const typeID = Number(entry && entry.typeID) || 0;
    const toLevel = Number(entry && entry.toLevel) || 0;
    if (!Number.isSafeInteger(typeID) || typeID <= 0 || toLevel < 1 || toLevel > 5) {
      res.status(400).json({
        ok: false,
        error: "INVALID_QUEUE_ENTRY",
        message: "Each queued skill needs a skill and a level from 1 to 5.",
      });
      return;
    }
    entries.push([typeID, toLevel]);
  }
  try {
    const outcome = await heldTopLevelCall(
      held,
      req.webSessionID,
      "skillMgr",
      "SaveNewQueue",
      [entries],
      // An empty queue is a PAUSE, not a start: activating nothing would ask
      // the server to begin training a queue that does not exist.
      { activate: entries.length > 0 },
    );
    await answerWithSkillSheet(res, req.account, held.characterID, {
      notifications: outcome.notifications,
    });
  } catch (error) {
    next(error);
  }
});

// --- R41 Planets: the character's colonies ---------------------------------
//
// WHERE THIS READ COMES FROM, AND WHY IT IS NOT A BRIDGE CALL.
//
// The emulator's colonies live in the `planetRuntimeState` root table, and the
// gateway's GET /snapshot ALREADY carries them: buildPlanetRuntimeForCharacter
// filters `coloniesByKey` down to rows whose `ownerID` is the requested
// character before the snapshot is serialized. That read is owner-scoped by
// construction and needs no held session — reading what you have built on a
// planet is not an act of piloting, exactly as reading what you have trained
// is not (R28).
//
// So this route adds ZERO entries to the gateway's deny-by-default call
// allowlist. That is not laziness, it is the safer of the two options. The
// planetMgr service DOES expose reads — GetFullNetworkForOwner,
// GetCommandPinsForPlanet, GetExtractorsForPlanet — and every one of them is
// deliberately OWNER-AGNOSTIC, because in the retail client they back the
// in-space planet view where you can see that someone else has a colony:
//
//   Handle_GetFullNetworkForOwner takes the ownerID from `args[1]`, so
//   allowlisting it would let any logged-in browser read ANY character's pin
//   layout on any planet by passing someone else's ID. GetCommandPinsForPlanet
//   and GetExtractorsForPlanet iterate `listColoniesForPlanet` across ALL
//   owners by design.
//
// That is the R38 shape precisely: a convenient read that leaks owner-only data
// for arbitrary IDs, declined. The snapshot answers the same question with the
// ownership check already applied.

const PI_PIN_KIND_BY_GROUP_ID = Object.freeze({
  1026: "extractor",
  1027: "command",
  1028: "factory",
  1029: "storage",
  1030: "launchpad",
  1063: "extractor-control",
});

// EveJS stores instants as Windows FILETIME (100ns ticks since 1601) in
// STRINGS, because they overflow a double. Every instant leaves this route as
// epoch milliseconds next to a `serverNowMs` sampled in the same read, so the
// browser never converts a FILETIME and never compares one clock to another.
const FILETIME_TICKS_PER_MS = 10000n;
const FILETIME_UNIX_EPOCH_OFFSET = 116444736000000000n;

// ⚠ A DURATION IS IN TICKS TOO, AND THIS ONE COST A ROUND TRIP.
//
// An extractor's `cycleTime` is NOT seconds — it is 100ns FILETIME ticks, the
// same unit as the instants. planetRuntimeStore divides it by SECOND_TICKS
// (10,000,000) everywhere it uses it. A live read caught this: the real colony
// on Jita I carries cycleTime 9,000,000,000, which is 900 seconds — a 15-minute
// extractor cycle, exactly what retail PI uses. Copied across as "seconds" it
// would have rendered as a cycle 285 years long, and the tests passed happily
// because the fixture had been written with the same wrong assumption.
const FILETIME_TICKS_PER_SECOND = 10000000;

function cycleTicksToSeconds(value) {
  const ticks = Number(value) || 0;
  if (ticks <= 0) {
    return 0;
  }
  return Math.round(ticks / FILETIME_TICKS_PER_SECOND);
}

function fileTimeToEpochMs(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const ticks = BigInt(text);
  // "0" is EveJS's "never", not 1601 — a launchpad that has never launched
  // carries lastLaunchTime "0". Answer null so the panel says nothing rather
  // than printing a date four centuries ago.
  if (ticks <= FILETIME_UNIX_EPOCH_OFFSET) {
    return null;
  }
  return Number((ticks - FILETIME_UNIX_EPOCH_OFFSET) / FILETIME_TICKS_PER_MS);
}

function planetPinKind(staticDataSource, typeID) {
  const type = staticDataSource.getType(typeID);
  const groupID = Number(type && type.groupID) || 0;
  return PI_PIN_KIND_BY_GROUP_ID[groupID] || "other";
}

function projectPinContents(staticDataSource, contents) {
  if (!contents || typeof contents !== "object" || Array.isArray(contents)) {
    return [];
  }
  return Object.entries(contents)
    .map(([typeIDText, quantity]) => ({
      typeID: Number(typeIDText) || 0,
      typeName: staticDataSource.getTypeName(Number(typeIDText) || 0),
      quantity: Number(quantity) || 0,
    }))
    .filter((entry) => entry.typeID > 0 && entry.quantity > 0)
    .sort((left, right) => right.quantity - left.quantity);
}

/**
 * One extraction program, or null when this pin has none.
 *
 * NOTHING IS SIMULATED HERE. The cycle time, the quantity per cycle and both
 * instants are the server's own numbers, copied across. Whether the program has
 * run out is not decided here either — the browser compares `expiresAtMs` to
 * `serverNowMs`, so a page left open goes stale visibly instead of lying.
 */
function projectExtractionProgram(staticDataSource, pin) {
  const resourceTypeID = Number(pin && pin.programType) || 0;
  const expiresAtMs = fileTimeToEpochMs(pin && pin.expiryTime);
  const installedAtMs = fileTimeToEpochMs(pin && pin.installTime);
  if (!resourceTypeID && expiresAtMs === null && installedAtMs === null) {
    return null;
  }
  return {
    resourceTypeID,
    resourceTypeName: resourceTypeID ? staticDataSource.getTypeName(resourceTypeID) : null,
    cycleTimeSeconds: cycleTicksToSeconds(pin && pin.cycleTime),
    quantityPerCycle: Number(pin && pin.qtyPerCycle) || 0,
    installedAtMs,
    expiresAtMs,
    headCount: Array.isArray(pin && pin.heads) ? pin.heads.length : 0,
  };
}

function projectColony(staticDataSource, colony) {
  const planetID = Number(colony && colony.planetID) || 0;
  const solarSystemID = Number(colony && colony.solarSystemID) || 0;
  const planetTypeID = Number(colony && colony.planetTypeID || colony && colony.typeID) || 0;
  const pins = (Array.isArray(colony && colony.pins) ? colony.pins : []).map((pin) => {
    const typeID = Number(pin && pin.typeID) || 0;
    const kind = planetPinKind(staticDataSource, typeID);
    return {
      pinID: Number(pin && pin.pinID) || 0,
      typeID,
      typeName: staticDataSource.getTypeName(typeID),
      kind,
      contents: projectPinContents(staticDataSource, pin && pin.contents),
      program: kind === "extractor-control"
        ? projectExtractionProgram(staticDataSource, pin)
        : null,
    };
  }).filter((pin) => pin.pinID > 0);
  const routes = (Array.isArray(colony && colony.routes) ? colony.routes : []).map((route) => {
    const commodityTypeID = Number(route && route.commodityTypeID) || 0;
    return {
      routeID: Number(route && route.routeID) || 0,
      path: (Array.isArray(route && route.path) ? route.path : []).map((id) => Number(id) || 0),
      commodityTypeID,
      commodityTypeName: commodityTypeID ? staticDataSource.getTypeName(commodityTypeID) : null,
      commodityQuantity: Number(route && route.commodityQuantity) || 0,
    };
  }).filter((route) => route.routeID > 0);
  return {
    planetID,
    // Null, never a stringified id: a planet the static map cannot name is a
    // fact the panel decides how to word (R7d), not a number to print.
    planetName: planetID ? staticDataSource.getPlanetName(planetID) : null,
    solarSystemID,
    solarSystemName: solarSystemID ? staticDataSource.getSolarSystemName(solarSystemID) : null,
    planetTypeID,
    planetTypeName: planetTypeID ? staticDataSource.getTypeName(planetTypeID) : null,
    commandCenterLevel: Number(colony && colony.level) || 0,
    lastSimulatedAtMs: fileTimeToEpochMs(colony && colony.currentSimTime),
    pins,
    linkCount: (Array.isArray(colony && colony.links) ? colony.links : []).length,
    routes,
  };
}

/**
 * GET /api/bridge/planets — every colony this character owns.
 *
 * ⚠ THE FACT, NOT A GUESS (the worldHasNoContracts rule). "The snapshot carried
 * a colony table and none of it is yours" is a different statement from "this
 * gateway did not report colonies at all", and only the first one justifies
 * telling a player they have no colonies. `coloniesReadable` carries which one
 * happened; a read that throws never reaches here at all.
 */
app.get("/api/bridge/planets", requireAuth, async (req, res, next) => {
  const held = requireHeldBridgeSession(req, res);
  if (!held) {
    return;
  }
  try {
    const snapshot = await gateway.getSnapshot(req.account.accountID, held.characterID);
    if (!snapshot) {
      res.status(404).json({
        ok: false,
        error: "CHARACTER_NOT_FOUND",
        message: "That character was not found.",
      });
      return;
    }
    const runtime = snapshot.planetRuntimeState;
    const coloniesReadable = Boolean(
      runtime && typeof runtime === "object" && !Array.isArray(runtime)
      && runtime.coloniesByKey && typeof runtime.coloniesByKey === "object"
      && !Array.isArray(runtime.coloniesByKey),
    );
    const colonies = coloniesReadable
      ? Object.values(runtime.coloniesByKey)
        .map((colony) => projectColony(staticData, colony))
        .filter((colony) => colony.planetID > 0)
        .sort((left, right) => (
          String(left.planetName || "").localeCompare(String(right.planetName || ""))
          || left.planetID - right.planetID
        ))
      : [];
    res.json({
      ok: true,
      characterID: held.characterID,
      serverNowMs: Date.now(),
      coloniesReadable,
      colonies,
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
    // R38 — the static tables have no answer, but a player structure is a legal
    // destination and is runtime data. This is the SECOND consumer of the one
    // shared structure resolver (the first is /api/names); Travel and the
    // flight readout reach a structure name through here. A structure that
    // cannot be resolved still falls through to kind:"unknown" below, so the
    // honest fallback is unchanged when the lookup genuinely fails.
    let structureLookupFailed = false;
    if (isPlayerStructureID(id)) {
      const { records, failed } = await resolveRuntimeStructureNames(req, [id]);
      structureLookupFailed = failed.has(id);
      const record = records.get(id);
      const structureName = record ? record.name : null;
      if (typeof structureName === "string") {
        // GetStructureInfo carries the structure's solar system in the SAME
        // payload as the name, so Travel gets a routable system for free.
        const solarSystemID = record.solarSystemID;
        res.json({
          ok: true,
          id,
          kind: "structure",
          structureID: id,
          structureName,
          // A structure is dockable, so the existing station-shaped consumers
          // (which read stationID/stationName) keep working unchanged rather
          // than every caller having to learn a new shape.
          stationID: id,
          stationName: structureName,
          solarSystemID,
          systemName: solarSystemID ? staticData.getSolarSystemName(solarSystemID) : null,
          // Stated rather than implied: this resolved, so the caller may cache it.
          lookupFailed: false,
        });
        return;
      }
    }
    // ⚠ THE FACT, NOT A GUESS. "Nothing in the world bears this ID" and "we
    // could not ask" both land on kind:"unknown", but only the first justifies
    // the client caching the miss. `lookupFailed` separates them so a structure
    // we simply could not reach is retried instead of being written off.
    res.json({
      ok: true,
      id,
      kind: "unknown",
      stationID: null,
      stationName: null,
      solarSystemID: null,
      systemName: null,
      lookupFailed: structureLookupFailed,
    });
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

/**
 * R16 market ITEM SEARCH — how a player picks what to trade.
 *
 * The browser never knows a typeID and must never ask the player for one
 * (R7d), so the market panel searches the static type table by NAME, exactly as
 * /api/map/find searches systems and stations. Read-only static reference data;
 * NOT a gateway/bridge call, so it works before (and independently of) the
 * market daemon.
 *
 * Only PUBLISHED types that belong to a market group are offered: the table
 * also holds test objects and internal placeholders that no market will ever
 * list, and offering one would produce a server refusal the player could make
 * no sense of.
 */
/**
 * R17 mail RECIPIENT SEARCH — how a player picks who to write to.
 *
 * ⚠ THIS IS THE ONE PLACE THE NAMES RULE RUNS BACKWARDS. R7d says the player
 * never sees a numeric ID; composing a message needs the opposite direction —
 * a name typed by the player turned into the characterID SendMail's args[0]
 * wants. Asking the player for an ID would be exactly what R7d forbids, so the
 * name is searched here and the id is carried invisibly.
 *
 * Read-only static reference data, like /api/map/find and /api/market/find —
 * NOT a gateway/bridge call, so it works independently of the live session. The
 * caller's own character is excluded: the server treats a self-addressed
 * message as a sender copy with no recipient, so offering it would be offering
 * a message that goes nowhere.
 */
app.get("/api/characters/find", requireAuth, async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const held = req.webSessionID ? bridgeSessions.get(req.webSessionID) : null;
    const result = staticData.findCharacters({
      q,
      limit,
      excludeCharacterID: held ? held.characterID : 0,
    });
    res.json({
      ok: true,
      source: "static-data",
      q: result.q,
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

app.get("/api/market/find", requireAuth, async (req, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const result = staticData.findMarketTypes({ q, limit });
    res.json({
      ok: true,
      source: "static-data",
      q: result.q,
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

/**
 * R38 — PLAYER-STRUCTURE NAMES. The one runtime name read, shared by every
 * name path in this BFF.
 *
 * ⚠ WHY THIS EXISTS AT ALL. Every other name in this app comes from the static
 * SDE, which is why /api/names and /api/map/resolve were both able to be
 * honest "read-only static reference data, NOT a gateway call". A player-owned
 * Upwell structure breaks that assumption: it is created at runtime, lives only
 * in the game store, and appears in NO static table. Both static paths
 * therefore answered "unknown" for a structure that very much has a name, and
 * a docked Astrahus rendered as "an unnamed place".
 *
 * ⚠ THIS IS THE ONLY PLACE A STRUCTURE NAME IS FETCHED. Both /api/names (the
 * batch path Assets/overview/contracts/market use) and /api/map/resolve/:id
 * (the path Travel and the flight readout use) call through here. Resolving a
 * structure name anywhere else — or teaching a panel to call the gateway
 * itself — reintroduces exactly the duplicated mechanic this goal exists to
 * avoid.
 *
 * THE READ: structureDirectory.GetStructureInfo(structureID) -> util.KeyVal.
 * For a structure the caller's corp owns it returns the full directory record;
 * for one it does not own, the public eight-key payload. BOTH carry `itemName`,
 * which is the only field taken here — so this works for any structure, owned
 * or not, docked at or not. Verified live against structure 1030000000001
 * ("Perimeter - asdf", an Astrahus).
 *
 * ⚠ null IS A REAL ANSWER, NOT A FAILURE. GetStructureInfo returns null for a
 * structure that does not exist — confirmed live for an unknown ID, for an NPC
 * station ID, and for 0. That is a DEFINITIVE "this is not a player structure",
 * safe for the client to cache forever. It is categorically different from "we
 * could not ask" (no character online, gateway error), which must NOT be cached
 * as a name-less result or the panel would be stuck on the fallback for the
 * rest of the session. `failed` carries that second case out separately —
 * the `worldHasNoContracts` rule: assert the negative only when the read
 * actually succeeded.
 */

// Retail's structure ID floor. NPC stations live in the 60,000,000 range; every
// player-deployed Upwell structure is allocated above 1e12. Below this, a miss
// in the static station table is a genuine unknown and never worth a round trip.
const STRUCTURE_ID_FLOOR = 1000000000000;

// A names batch can legitimately carry hundreds of IDs, but only a handful can
// ever be structures. GetStructureInfo is per-structure (see the allowlist note
// on why the batch GetStructures is deliberately NOT reachable), so this bounds
// the fan-out a single request can provoke.
const STRUCTURE_NAME_LOOKUP_CAP = 25;

// Structure names change only when someone renames the structure, so a short
// TTL removes the per-panel-load round trip without letting a rename go stale
// for long. Only DEFINITIVE outcomes are cached — never a failure.
//
// ⚠ PROCESS-WIDE, NOT PER-SESSION, AND THAT IS DELIBERATE. A structure's name
// is public: Handle_GetStructureInfo applies no access check and hands its
// public payload — itemName included — to any session that asks, owner or not.
// So one account's cached name tells another account nothing it could not
// fetch for itself, and sharing the cache means the second viewer of a
// structure pays no round trip. Nothing owner-only is cached here: only the
// name, system and type are kept, never the services/fuel/timer fields the
// owner branch also returns.
const STRUCTURE_NAME_TTL_MS = 60000;
const structureNameCache = new Map();

function isPlayerStructureID(id) {
  return Number.isSafeInteger(id) && id >= STRUCTURE_ID_FLOOR;
}

function readCachedStructureName(structureID, now) {
  const hit = structureNameCache.get(structureID);
  if (!hit || hit.expiresAt <= now) {
    structureNameCache.delete(structureID);
    return undefined;
  }
  return { name: hit.name, solarSystemID: hit.solarSystemID, typeID: hit.typeID };
}

/**
 * Resolve player-structure IDs on the caller's live session.
 *
 * Returns `{ records, failed }` where `records` maps a structureID to
 * `{ name, solarSystemID, typeID }` — `name` null when the server said "no such
 * structure" — and `failed` holds the IDs that could not be asked about at all.
 * An ID never appears in both.
 *
 * ⚠ The system and type come out of the SAME KeyVal as the name. A caller that
 * needs a structure's system must read it from here rather than making a second
 * call; GetStructureInfo already carries it.
 */
async function resolveRuntimeStructureNames(req, structureIDs) {
  const records = new Map();
  const failed = new Set();
  const wanted = [...new Set(structureIDs.filter(isPlayerStructureID))];
  if (wanted.length === 0) {
    return { records, failed };
  }

  const now = Date.now();
  const toFetch = [];
  for (const structureID of wanted) {
    const cached = readCachedStructureName(structureID, now);
    if (cached !== undefined) {
      records.set(structureID, cached);
    } else {
      toFetch.push(structureID);
    }
  }
  if (toFetch.length === 0) {
    return { records, failed };
  }

  // No character online means no session to ask on. That is a FAILURE to look
  // up, not a finding that the structure is nameless — the caller must be able
  // to tell those apart, so these go to `failed` and nothing is cached.
  const held = bridgeSessions.get(req.webSessionID) || null;
  if (!held) {
    for (const structureID of toFetch) {
      failed.add(structureID);
    }
    return { records, failed };
  }

  const remember = (structureID, record) => {
    records.set(structureID, record);
    structureNameCache.set(structureID, { ...record, expiresAt: now + STRUCTURE_NAME_TTL_MS });
  };

  for (const structureID of toFetch.slice(0, STRUCTURE_NAME_LOOKUP_CAP)) {
    try {
      const outcome = await heldTopLevelCall(
        held,
        req.webSessionID,
        "structureDirectory",
        "GetStructureInfo",
        [structureID],
        null,
      );
      const result = outcome && outcome.result;
      if (result === null || result === undefined) {
        // The definitive "not a player structure" — cacheable.
        remember(structureID, { name: null, solarSystemID: null, typeID: null });
        continue;
      }
      const entries = keyValEntries(result);
      const itemName = readKeyValField(entries, "itemName");
      // A structure row with a blank name is a nameless structure (null), not a
      // failed lookup — the empty string must never reach a panel as a label.
      const name =
        typeof itemName === "string" && itemName.trim().length > 0 ? itemName : null;
      remember(structureID, {
        name,
        solarSystemID: Number(readKeyValField(entries, "solarSystemID")) || null,
        typeID: Number(readKeyValField(entries, "typeID")) || null,
      });
    } catch (_error) {
      // Refusal, transport error, reaped session: we do not know. Not cached.
      failed.add(structureID);
    }
  }
  // Anything past the cap was never asked about — also "we do not know".
  for (const structureID of toFetch.slice(STRUCTURE_NAME_LOOKUP_CAP)) {
    failed.add(structureID);
  }
  return { records, failed };
}

// Batch name resolution (goal R7c): the names-everywhere UI pass turns raw IDs
// into names across every tab, so a list of many IDs (an inventory of typeIDs,
// a guest list of corp IDs, ...) resolves in ONE round-trip. POST /api/names
// takes { items: [{kind, id}] } and returns { names: { "kind:id": name } } over
// the existing static getters. Each item is echoed (a name string, or null for a
// definitive unknown the client caches); the batch is capped server-side so an
// oversized request can't scan the whole item table.
//
// R38: no longer PURELY static. Static resolution runs first and answers
// everything it can; only the `station`/`structure` items it could not name AND
// whose ID is above the player-structure floor fall through to the runtime read
// above. A request with no such items still makes zero gateway calls, so the
// common case is unchanged. `unresolved` names the keys whose lookup could not
// be completed — the client must not cache those as "unknown".
// The kinds that can legally denote a place a player structure could be. A
// structure arrives as "station" from every existing caller (Assets asks for
// the location it found an item at, and does not know the difference); the
// explicit "structure" kind is for callers that do.
const STRUCTURE_NAME_KINDS = new Set(["station", "structure"]);

app.post("/api/names", requireAuth, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const result = staticData.resolveNames({ items });
    const names = { ...result.names };

    // Only the static misses that could be a player structure are candidates —
    // a name the SDE already answered is never re-asked, and an ID below the
    // structure floor is a genuine static unknown.
    const candidates = [];
    for (const [key, value] of Object.entries(names)) {
      if (value !== null) {
        continue;
      }
      const separator = key.indexOf(":");
      const kind = key.slice(0, separator);
      const id = Number(key.slice(separator + 1)) || 0;
      if (STRUCTURE_NAME_KINDS.has(kind) && isPlayerStructureID(id)) {
        candidates.push({ key, id });
      }
    }

    const unresolved = [];
    let runtimeUsed = false;
    if (candidates.length > 0) {
      runtimeUsed = true;
      const { records, failed } = await resolveRuntimeStructureNames(
        req,
        candidates.map((candidate) => candidate.id),
      );
      for (const candidate of candidates) {
        if (failed.has(candidate.id)) {
          // Stays null in `names`, but named here so the client leaves it
          // uncached and retries rather than believing it is nameless.
          unresolved.push(candidate.key);
          continue;
        }
        const record = records.get(candidate.id);
        if (record && typeof record.name === "string") {
          names[candidate.key] = record.name;
        }
      }
    }

    res.json({
      ok: true,
      // Named on the wire so a consumer can see whether a live session was
      // involved at all, rather than inferring it.
      source: runtimeUsed ? "static-data+runtime-structures" : "static-data",
      count: Object.keys(names).length,
      capped: result.capped,
      limit: result.limit,
      names,
      unresolved,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * R24 slice C — MODULE CYCLE TIMES, from static reference data.
 *
 * How long a module takes to run one cycle is attribute **73** (`duration`, in
 * milliseconds), and it is already sitting in the static dogma table:
 * Miner I / Miner II = 15000, Modulated Strip Miner II = 45000. `staticData`
 * has exposed `getTypeDogmaAttribute` since it was written and nothing has ever
 * called it — this is the first caller. ZERO bridge calls: like /api/names and
 * /api/map/graph this is read-only reference data that cannot vary by player,
 * so it never needs a round trip to EveJS.
 *
 * ⚠ WHAT THIS NUMBER IS NOT. It is the BASE duration on the type, before the
 * pilot's skills, the ship's role bonuses, rigs, implants or heat. The server
 * computes the EFFECTIVE duration (it is what it puts in an `OnGodmaShipEffect`
 * cycle event), but there is still no allowlisted call that returns effective
 * per-module attributes — the same wall that blocks DPS. So this route answers
 * `baseCycleMs`, named `base` all the way to the screen, and the page prefers
 * the server's own figure whenever a cycle event has told it one. A number
 * presented as the truth when it is only the starting point is worse than no
 * number at all.
 */
const CYCLE_TIME_TYPE_LIMIT = 500;
const ATTRIBUTE_DURATION = 73;

// A GET, deliberately: this is an idempotent read of unchanging reference data
// with no player context in it at all. Nothing here mutates, so nothing here
// should look like it might.
app.get("/api/types/cycle-times", requireAuth, async (req, res, next) => {
  try {
    const requested = String((req.query && req.query.typeIDs) || "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const seen = new Set();
    const baseCycleMs = {};
    for (const raw of requested) {
      const typeID = Number(raw) || 0;
      if (typeID <= 0 || seen.has(typeID)) {
        continue;
      }
      seen.add(typeID);
      if (seen.size > CYCLE_TIME_TYPE_LIMIT) {
        break;
      }
      const value = Number(staticData.getTypeDogmaAttribute(typeID, ATTRIBUTE_DURATION, null));
      // null, never 0: a module with no duration attribute does not cycle, and
      // "0 ms" would read as an instant one.
      baseCycleMs[String(typeID)] = Number.isFinite(value) && value > 0 ? value : null;
    }
    res.json({
      ok: true,
      source: "static-data",
      // Named on the wire, not just in a comment: every consumer is forced to
      // acknowledge that this is the base figure.
      baseCycleMs,
      capped: requested.length > CYCLE_TIME_TYPE_LIMIT,
      limit: CYCLE_TIME_TYPE_LIMIT,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * R15 industry RECIPES — the static half of the industry panel.
 *
 * Every NAME the panel needs is already reachable through /api/names: a
 * blueprint and its product are ordinary types ("type"), and a facility is a
 * station ("station") in a system ("system"). What /api/names cannot answer is
 * the RECIPE — which activities a blueprint supports, what each one consumes,
 * how long it takes, and what it produces. That comes from the 5,081 blueprint
 * definitions in static data, and it is what the install preview is built from.
 *
 * Read-only reference data (like /api/map/graph or /api/agents/find), NOT a
 * gateway call: none of it varies by player, so it never needs a round-trip to
 * EveJS. The player's OWN numbers — efficiencies, runs left, whether a
 * blueprint is busy — come from the live read instead.
 */
const INDUSTRY_DEFINITIONS_MAX = 500;

app.post("/api/industry/blueprints", requireAuth, async (req, res, next) => {
  try {
    const requested = Array.isArray(req.body && req.body.blueprintTypeIDs)
      ? req.body.blueprintTypeIDs
      : [];
    const unique = [];
    const seen = new Set();
    for (const value of requested) {
      const typeID = Number(value) || 0;
      if (typeID > 0 && !seen.has(typeID)) {
        seen.add(typeID);
        unique.push(typeID);
      }
    }
    const capped = unique.length > INDUSTRY_DEFINITIONS_MAX;
    const slice = capped ? unique.slice(0, INDUSTRY_DEFINITIONS_MAX) : unique;
    const definitions = {};
    for (const typeID of slice) {
      const definition = staticData.getIndustryBlueprint(typeID);
      // A definitive null is echoed too, so the client can cache the miss.
      definitions[String(typeID)] = definition
        ? {
            blueprintTypeID: definition.blueprintTypeID,
            blueprintName: definition.blueprintName,
            productTypeID: definition.productTypeID,
            productName: definition.productName,
            maxProductionLimit: definition.maxProductionLimit,
            activities: definition.activities || {},
          }
        : null;
    }
    res.json({
      ok: true,
      source: "static-data",
      count: slice.length,
      capped,
      limit: INDUSTRY_DEFINITIONS_MAX,
      definitions,
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
