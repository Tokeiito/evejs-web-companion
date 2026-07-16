"use strict";

const { STATUS_CODES } = require("http");
const Ws = require("ws");
const config = require("./config");
const eveGatewayClient = require("./eveGatewayClient");

const GATEWAY_SOURCE = "evejs-web-gateway";
const API_VERSION = 1;
const STREAM_VERSION = 1;
const EVENT_PATH = /^\/api\/characters\/([1-9][0-9]*)\/events$/;
const EPOCH_PATTERN = /^[A-Za-z0-9_-]+$/;
const COMMAND_TYPE_PATTERN = /^[a-z0-9_.-]+$/;
const ERROR_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const CONTROL_STATES = new Set(["offline", "retail_client", "browser_pilot"]);
const CONTROL_TRANSPORTS = new Set([null, "tcp", "web"]);
const ADMISSION_STATUSES = new Set(["admitted", "rejected"]);
const COMMAND_TYPES = new Set([
  "offline.skill_queue.save",
  "offline.pi.extractors.restart",
]);
const DEFAULT_MAX_FRAME_BYTES = 64 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 256 * 1024;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const DEFAULT_UPGRADE_TIMEOUT_MS = 5 * 1000;
const MAX_COMMAND_OUTCOMES = 64;
const MAX_TIMER_DELAY_MS = 0x7fffffff;

class EventProxyError extends Error {
  constructor(code, statusCode) {
    super(code);
    this.name = "EventProxyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) {
    return false;
  }
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index]);
}

function isBoundedString(value, maxLength, pattern = null) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    (!pattern || pattern.test(value));
}

function isSafeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalIsoTimestamp(value) {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validateCursor(cursor) {
  return hasExactKeys(cursor, ["epoch", "sequence"]) &&
    isBoundedString(cursor.epoch, 128, EPOCH_PATTERN) &&
    isSafeSequence(cursor.sequence);
}

function validateControl(control) {
  if (!hasExactKeys(control, [
    "online",
    "controlState",
    "transport",
    "leaseExpiresAt",
  ])) {
    return false;
  }
  if (
    typeof control.online !== "boolean" ||
    !CONTROL_STATES.has(control.controlState) ||
    !CONTROL_TRANSPORTS.has(control.transport) ||
    !(
      control.leaseExpiresAt === null ||
      (
        isBoundedString(control.leaseExpiresAt, 128) &&
        isCanonicalIsoTimestamp(control.leaseExpiresAt)
      )
    )
  ) {
    return false;
  }

  if (control.controlState === "offline") {
    return control.online === false &&
      control.transport === null &&
      control.leaseExpiresAt === null;
  }
  if (control.controlState === "retail_client") {
    return control.online === true &&
      control.transport === "tcp" &&
      control.leaseExpiresAt === null;
  }
  return control.online === true &&
    control.transport === "web" &&
    typeof control.leaseExpiresAt === "string";
}

function validateStateVersion(value) {
  return isBoundedString(value, 512);
}

function validateCommandOutcome(outcome, includeKind) {
  const expectedKeys = [
    "commandID",
    "commandType",
    "success",
    "errorCode",
    "admissionStatus",
    "stateVersion",
  ];
  if (includeKind) {
    expectedKeys.unshift("kind");
  }
  if (!hasExactKeys(outcome, expectedKeys)) {
    return false;
  }
  if (includeKind && outcome.kind !== "command_settled") {
    return false;
  }
  return isBoundedString(outcome.commandID, 512) &&
    isBoundedString(outcome.commandType, 128, COMMAND_TYPE_PATTERN) &&
    COMMAND_TYPES.has(outcome.commandType) &&
    typeof outcome.success === "boolean" &&
    (
      outcome.errorCode === null ||
      isBoundedString(outcome.errorCode, 128, ERROR_CODE_PATTERN)
    ) &&
    ADMISSION_STATUSES.has(outcome.admissionStatus) &&
    validateStateVersion(outcome.stateVersion) &&
    ((outcome.success && outcome.errorCode === null) ||
      (!outcome.success && outcome.errorCode !== null)) &&
    (!outcome.success || outcome.admissionStatus === "admitted");
}

function validateStreamEvent(event) {
  if (!isPlainObject(event)) {
    return false;
  }
  if (event.kind === "control_changed") {
    return hasExactKeys(event, ["kind", "control", "stateVersion"]) &&
      validateControl(event.control) &&
      validateStateVersion(event.stateVersion);
  }
  if (event.kind === "command_settled") {
    return validateCommandOutcome(event, true);
  }
  return false;
}

function validateGatewayFrame(frame, characterID) {
  const numericCharacterID = Number(characterID);
  if (!isPlainObject(frame)) {
    return false;
  }
  if (
    frame.source !== GATEWAY_SOURCE ||
    frame.apiVersion !== API_VERSION ||
    frame.streamVersion !== STREAM_VERSION ||
    frame.characterID !== numericCharacterID ||
    !validateCursor(frame.cursor)
  ) {
    return false;
  }

  if (frame.type === "snapshot") {
    if (!hasExactKeys(frame, [
      "source",
      "apiVersion",
      "streamVersion",
      "type",
      "characterID",
      "cursor",
      "control",
      "stateVersion",
      "commandOutcomes",
    ])) {
      return false;
    }
    if (
      !validateControl(frame.control) ||
      !validateStateVersion(frame.stateVersion) ||
      !Array.isArray(frame.commandOutcomes) ||
      frame.commandOutcomes.length > MAX_COMMAND_OUTCOMES ||
      !frame.commandOutcomes.every((outcome) => validateCommandOutcome(outcome, false))
    ) {
      return false;
    }
    return true;
  }

  return frame.type === "event" &&
    hasExactKeys(frame, [
      "source",
      "apiVersion",
      "streamVersion",
      "type",
      "characterID",
      "cursor",
      "event",
    ]) &&
    validateStreamEvent(frame.event);
}

function parseGatewayFrame(data, isBinary, maxFrameBytes, characterID) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (isBinary || buffer.byteLength === 0 || buffer.byteLength > maxFrameBytes) {
    return null;
  }
  let text;
  let frame;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    frame = JSON.parse(text);
  } catch {
    return null;
  }
  return validateGatewayFrame(frame, characterID) ? frame : null;
}

function acceptsNextCursor(frame, state) {
  const cursor = frame.cursor;
  if (!state.hasFrame) {
    if (frame.type === "snapshot") {
      state.hasFrame = true;
      state.epoch = cursor.epoch;
      state.sequence = cursor.sequence;
      return true;
    }
    if (
      !state.requested ||
      cursor.epoch !== state.requested.epoch ||
      cursor.sequence !== state.requested.sequence + 1
    ) {
      return false;
    }
    state.hasFrame = true;
    state.epoch = cursor.epoch;
    state.sequence = cursor.sequence;
    return true;
  }

  if (
    frame.type !== "event" ||
    cursor.epoch !== state.epoch ||
    cursor.sequence !== state.sequence + 1
  ) {
    return false;
  }
  state.sequence = cursor.sequence;
  return true;
}

function readSingleHeader(headers, name) {
  const value = headers && headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hasSameOrigin(request) {
  const host = readSingleHeader(request.headers, "host");
  const originHeader = readSingleHeader(request.headers, "origin");
  if (!host || !originHeader || host.includes(",")) {
    return false;
  }
  try {
    const origin = new URL(originHeader);
    return (origin.protocol === "http:" || origin.protocol === "https:") &&
      !origin.username &&
      !origin.password &&
      origin.host.toLowerCase() === host.toLowerCase() &&
      origin.pathname === "/" &&
      !origin.search &&
      !origin.hash;
  } catch {
    return false;
  }
}

function parseCursor(searchParams) {
  const allowedKeys = new Set(["epoch", "sequence"]);
  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new EventProxyError("EVENT_STREAM_QUERY_INVALID", 400);
    }
  }
  const epochs = searchParams.getAll("epoch");
  const sequences = searchParams.getAll("sequence");
  if (epochs.length === 0 && sequences.length === 0) {
    return null;
  }
  if (epochs.length !== 1 || sequences.length !== 1) {
    throw new EventProxyError("EVENT_STREAM_CURSOR_INVALID", 400);
  }
  const epoch = epochs[0];
  const sequenceText = sequences[0];
  if (
    !isBoundedString(epoch, 128, EPOCH_PATTERN) ||
    !/^(0|[1-9][0-9]*)$/.test(sequenceText)
  ) {
    throw new EventProxyError("EVENT_STREAM_CURSOR_INVALID", 400);
  }
  const sequence = Number(sequenceText);
  if (!isSafeSequence(sequence)) {
    throw new EventProxyError("EVENT_STREAM_CURSOR_INVALID", 400);
  }
  return { epoch, sequence };
}

function parseUpgradeRequest(request) {
  if (
    request.method !== "GET" ||
    String(request.headers.upgrade || "").toLowerCase() !== "websocket" ||
    !String(request.headers.connection || "")
      .split(",")
      .some((value) => value.trim().toLowerCase() === "upgrade") ||
    request.headers["sec-websocket-version"] !== "13" ||
    !/^[+/0-9A-Za-z]{22}==$/.test(
      readSingleHeader(request.headers, "sec-websocket-key") || "",
    ) ||
    request.headers["sec-websocket-protocol"] !== undefined
  ) {
    throw new EventProxyError("WEBSOCKET_UPGRADE_REQUIRED", 400);
  }

  let url;
  try {
    if (!/^\/(?!\/)/.test(request.url || "")) {
      throw new Error("The request target must use origin form.");
    }
    url = new URL(request.url, "http://evejs-web.invalid");
  } catch {
    throw new EventProxyError("EVENT_STREAM_NOT_FOUND", 404);
  }
  const match = EVENT_PATH.exec(url.pathname);
  if (!match) {
    throw new EventProxyError("EVENT_STREAM_NOT_FOUND", 404);
  }
  if (!hasSameOrigin(request)) {
    throw new EventProxyError("EVENT_STREAM_ORIGIN_FORBIDDEN", 403);
  }
  const characterID = Number(match[1]);
  if (!Number.isSafeInteger(characterID) || characterID <= 0) {
    throw new EventProxyError("EVENT_STREAM_NOT_FOUND", 404);
  }
  return {
    characterID,
    cursor: parseCursor(url.searchParams),
  };
}

function readSessionCookie(header, cookieName) {
  const matches = [];
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== cookieName) {
      continue;
    }
    try {
      matches.push(decodeURIComponent(part.slice(index + 1).trim()));
    } catch {
      return null;
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function writeUpgradeRejection(socket, statusCode, code) {
  if (!socket || socket.destroyed) {
    return;
  }
  const status = Number(statusCode) || 500;
  const payload = Buffer.from(JSON.stringify({ ok: false, error: code }));
  const response = [
    `HTTP/1.1 ${status} ${STATUS_CODES[status] || "Error"}`,
    "Connection: close",
    "Cache-Control: no-store",
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${payload.byteLength}`,
    "",
    "",
  ].join("\r\n");
  socket.once("error", () => {});
  socket.end(Buffer.concat([Buffer.from(response), payload]));
}

function destroyWebSocket(webSocket) {
  if (!webSocket) {
    return;
  }
  webSocket.removeAllListeners();
  webSocket.on("error", () => {});
  if (webSocket.readyState !== Ws.CLOSED) {
    try {
      webSocket.terminate();
    } catch {
      // The socket is already being destroyed.
    }
  }
}

function createCharacterEventProxy(options = {}) {
  const store = options.eveStore;
  const auth = options.webAuth;
  if (!store || !auth) {
    throw new TypeError("The character event proxy requires EveJS store and web auth dependencies.");
  }
  const sessionCookieName = options.sessionCookieName || config.sessionCookieName;
  const buildEventStreamRequest = options.buildEventStreamRequest ||
    eveGatewayClient.buildEventStreamRequest;
  const WebSocketClient = options.WebSocket || Ws;
  const WebSocketServer = options.WebSocketServer || Ws.WebSocketServer;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const now = options.now || Date.now;
  const maxFrameBytes = options.maxFrameBytes || DEFAULT_MAX_FRAME_BYTES;
  const maxBufferedBytes = options.maxBufferedBytes || DEFAULT_MAX_BUFFERED_BYTES;
  const heartbeatIntervalMs = options.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
  const upgradeTimeoutMs = options.upgradeTimeoutMs || DEFAULT_UPGRADE_TIMEOUT_MS;
  const webSocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: maxFrameBytes,
    perMessageDeflate: false,
  });
  webSocketServer.on("error", () => {});

  const pendingUpgrades = new Set();
  const sessions = new Set();
  const closingSockets = new Set();
  const timers = new Set();
  let attachedServer = null;
  let originalServerClose = null;
  let wrappedServerClose = null;
  let closed = false;

  function clearTrackedTimer(timer, clearFn) {
    if (timer === null || timer === undefined) {
      return;
    }
    timers.delete(timer);
    clearFn(timer);
  }

  async function authorize(request, characterID) {
    const token = readSessionCookie(request.headers.cookie, sessionCookieName);
    const payload = token && auth.verifySessionToken(token);
    const expiresAtMs = Number(payload && payload.exp);
    if (
      !payload ||
      !isBoundedString(payload.username, 256) ||
      !Number.isSafeInteger(Number(payload.accountID)) ||
      Number(payload.accountID) <= 0 ||
      !isBoundedString(payload.sessionID, 256, EPOCH_PATTERN) ||
      !Number.isSafeInteger(expiresAtMs) ||
      expiresAtMs <= now()
    ) {
      throw new EventProxyError("AUTH_REQUIRED", 401);
    }

    let account;
    let character;
    try {
      account = await store.getAccount(payload.username);
      if (expiresAtMs <= now()) {
        throw new EventProxyError("AUTH_REQUIRED", 401);
      }
      if (
        !account ||
        Number(account.accountID) !== Number(payload.accountID)
      ) {
        throw new EventProxyError("AUTH_REQUIRED", 401);
      }
      if (account.banned) {
        throw new EventProxyError("ACCOUNT_BANNED", 403);
      }
      character = await store.getCharacterForAccount(account.accountID, characterID);
      if (expiresAtMs <= now()) {
        throw new EventProxyError("AUTH_REQUIRED", 401);
      }
    } catch (error) {
      if (error instanceof EventProxyError) {
        throw error;
      }
      throw new EventProxyError("EVENT_STREAM_UNAVAILABLE", 503);
    }
    if (!character) {
      throw new EventProxyError("CHARACTER_FORBIDDEN", 403);
    }

    return {
      accountID: Number(account.accountID),
      characterID,
      controllerID: payload.sessionID,
      expiresAtMs,
    };
  }

  function detachPending(record) {
    if (!pendingUpgrades.delete(record)) {
      return false;
    }
    clearTrackedTimer(record.timer, clearTimeoutFn);
    record.timer = null;
    record.socket.removeListener("close", record.onSocketClose);
    record.socket.removeListener("error", record.onSocketError);
    return true;
  }

  function cancelPending(record, rejection = null) {
    if (!detachPending(record)) {
      return;
    }
    destroyWebSocket(record.upstream);
    if (rejection) {
      writeUpgradeRejection(record.socket, rejection.statusCode, rejection.code);
    } else if (!record.socket.destroyed) {
      record.socket.destroy();
    }
  }

  function closeDownstream(webSocket, code, reason) {
    if (!webSocket || webSocket.readyState !== Ws.OPEN) {
      destroyWebSocket(webSocket);
      return;
    }
    webSocket.removeAllListeners();
    webSocket.on("error", () => {});
    closingSockets.add(webSocket);
    let forceTimer = null;
    const finish = (force) => {
      if (!closingSockets.delete(webSocket)) {
        return;
      }
      clearTrackedTimer(forceTimer, clearTimeoutFn);
      forceTimer = null;
      if (force) {
        destroyWebSocket(webSocket);
      } else {
        webSocket.removeAllListeners();
        webSocket.on("error", () => {});
      }
    };
    webSocket.once("close", () => finish(false));
    try {
      webSocket.close(code, reason);
    } catch {
      finish(true);
      return;
    }
    if (!closingSockets.has(webSocket)) {
      return;
    }
    forceTimer = setTimeoutFn(() => finish(true), 250);
    if (forceTimer && typeof forceTimer.unref === "function") {
      forceTimer.unref();
    }
    timers.add(forceTimer);
  }

  function cleanupSession(session, downstreamClose = null) {
    if (session.closed) {
      return;
    }
    session.closed = true;
    sessions.delete(session);
    clearTrackedTimer(session.heartbeatTimer, clearIntervalFn);
    session.heartbeatTimer = null;
    clearTrackedTimer(session.sessionExpiryTimer, clearTimeoutFn);
    session.sessionExpiryTimer = null;
    destroyWebSocket(session.upstream);
    if (downstreamClose) {
      closeDownstream(
        session.downstream,
        downstreamClose.code,
        downstreamClose.reason,
      );
    } else {
      destroyWebSocket(session.downstream);
    }
  }

  function scheduleSessionExpiry(session) {
    if (session.closed) {
      return;
    }
    clearTrackedTimer(session.sessionExpiryTimer, clearTimeoutFn);
    session.sessionExpiryTimer = null;
    const remainingMs = session.expiresAtMs - now();
    if (remainingMs <= 0) {
      cleanupSession(session, {
        code: 1008,
        reason: "Web session expired",
      });
      return;
    }
    const delayMs = Math.max(1, Math.min(Math.ceil(remainingMs), MAX_TIMER_DELAY_MS));
    const timer = setTimeoutFn(() => {
      if (session.sessionExpiryTimer !== timer) {
        return;
      }
      timers.delete(timer);
      session.sessionExpiryTimer = null;
      if (session.expiresAtMs <= now()) {
        cleanupSession(session, {
          code: 1008,
          reason: "Web session expired",
        });
      } else {
        scheduleSessionExpiry(session);
      }
    }, delayMs);
    session.sessionExpiryTimer = timer;
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }
    timers.add(timer);
  }

  function startSession(downstream, upstream, context, cursor) {
    const session = {
      closed: false,
      downstream,
      upstream,
      accountID: context.accountID,
      characterID: context.characterID,
      controllerID: context.controllerID,
      expiresAtMs: context.expiresAtMs,
      downstreamAlive: true,
      upstreamAlive: true,
      heartbeatTimer: null,
      sessionExpiryTimer: null,
      cursorState: {
        hasFrame: false,
        requested: cursor,
        epoch: null,
        sequence: null,
      },
    };
    sessions.add(session);
    scheduleSessionExpiry(session);
    if (session.closed) {
      return;
    }

    downstream.on("error", () => cleanupSession(session));
    upstream.on("error", () => cleanupSession(session, {
      code: 1011,
      reason: "Upstream unavailable",
    }));
    downstream.on("close", () => cleanupSession(session));
    upstream.on("close", () => cleanupSession(session, {
      code: 1011,
      reason: "Upstream unavailable",
    }));
    downstream.on("pong", () => {
      session.downstreamAlive = true;
    });
    upstream.on("pong", () => {
      session.upstreamAlive = true;
    });
    downstream.on("message", () => cleanupSession(session, {
      code: 1008,
      reason: "Server-only event stream",
    }));
    upstream.on("message", (data, isBinary) => {
      if (session.closed) {
        return;
      }
      if (session.expiresAtMs <= now()) {
        cleanupSession(session, {
          code: 1008,
          reason: "Web session expired",
        });
        return;
      }
      const byteLength = Buffer.isBuffer(data)
        ? data.byteLength
        : Buffer.byteLength(data);
      const frame = parseGatewayFrame(
        data,
        isBinary,
        maxFrameBytes,
        session.characterID,
      );
      if (!frame || !acceptsNextCursor(frame, session.cursorState)) {
        cleanupSession(session, {
          code: byteLength > maxFrameBytes ? 1009 : 1002,
          reason: byteLength > maxFrameBytes
            ? "Upstream frame too large"
            : "Invalid upstream frame",
        });
        return;
      }
      const downstreamPayload = JSON.stringify(frame);
      const downstreamByteLength = Buffer.byteLength(downstreamPayload);
      if (downstreamByteLength > maxFrameBytes) {
        cleanupSession(session, {
          code: 1009,
          reason: "Upstream frame too large",
        });
        return;
      }
      if (downstream.readyState !== Ws.OPEN) {
        cleanupSession(session);
        return;
      }
      if (downstream.bufferedAmount + downstreamByteLength > maxBufferedBytes) {
        cleanupSession(session, {
          code: 1009,
          reason: "Browser output buffer exceeded",
        });
        return;
      }
      try {
        downstream.send(
          downstreamPayload,
          { binary: false, compress: false },
          (error) => {
            if (error) {
              cleanupSession(session);
            }
          },
        );
      } catch {
        cleanupSession(session);
      }
    });

    session.heartbeatTimer = setIntervalFn(() => {
      if (session.closed) {
        return;
      }
      if (session.expiresAtMs <= now()) {
        cleanupSession(session, {
          code: 1008,
          reason: "Web session expired",
        });
        return;
      }
      const sockets = [
        [downstream, "downstreamAlive"],
        [upstream, "upstreamAlive"],
      ];
      for (const [socket, aliveKey] of sockets) {
        if (
          socket.readyState !== Ws.OPEN ||
          session[aliveKey] !== true ||
          socket.bufferedAmount > maxBufferedBytes
        ) {
          cleanupSession(session);
          return;
        }
        session[aliveKey] = false;
        try {
          socket.ping();
        } catch {
          cleanupSession(session);
          return;
        }
      }
    }, heartbeatIntervalMs);
    if (session.heartbeatTimer && typeof session.heartbeatTimer.unref === "function") {
      session.heartbeatTimer.unref();
    }
    timers.add(session.heartbeatTimer);
  }

  function finishUpstreamHandshake(record, upstream, context) {
    if (context.expiresAtMs <= now()) {
      cancelPending(record, new EventProxyError("AUTH_REQUIRED", 401));
      return;
    }
    if (!detachPending(record) || closed) {
      destroyWebSocket(upstream);
      return;
    }
    upstream.removeAllListeners();
    let completed = false;
    try {
      webSocketServer.handleUpgrade(
        record.request,
        record.socket,
        record.head,
        (downstream) => {
          completed = true;
          startSession(downstream, upstream, context, record.parsed.cursor);
          record.socket.resume();
        },
      );
    } catch {
      completed = false;
    }
    if (!completed) {
      destroyWebSocket(upstream);
      if (!record.socket.destroyed) {
        record.socket.destroy();
      }
    }
  }

  async function establishPending(record) {
    let context;
    try {
      context = await authorize(record.request, record.parsed.characterID);
      if (!pendingUpgrades.has(record) || closed) {
        return;
      }
      if (context.expiresAtMs <= now()) {
        throw new EventProxyError("AUTH_REQUIRED", 401);
      }
      const upstreamRequest = buildEventStreamRequest(
        context.accountID,
        context.characterID,
        record.parsed.cursor,
      );
      if (
        !upstreamRequest ||
        typeof upstreamRequest.url !== "string" ||
        !isPlainObject(upstreamRequest.headers) ||
        !isBoundedString(upstreamRequest.headers["x-evejs-web-token"], 4096)
      ) {
        throw new EventProxyError("EVENT_STREAM_CONFIGURATION", 503);
      }
      const upstreamUrl = new URL(upstreamRequest.url);
      if (
        (upstreamUrl.protocol !== "ws:" && upstreamUrl.protocol !== "wss:") ||
        upstreamUrl.username ||
        upstreamUrl.password ||
        upstreamUrl.hash ||
        upstreamUrl.pathname !== "/_evejs-web/v1/events" ||
        upstreamUrl.searchParams.getAll("accountID").length !== 1 ||
        upstreamUrl.searchParams.get("accountID") !== String(context.accountID) ||
        upstreamUrl.searchParams.getAll("characterID").length !== 1 ||
        upstreamUrl.searchParams.get("characterID") !== String(context.characterID) ||
        [...upstreamUrl.searchParams.keys()].some((key) =>
          !new Set(["accountID", "characterID", "epoch", "sequence"]).has(key)) ||
        (record.parsed.cursor
          ? upstreamUrl.searchParams.getAll("epoch").length !== 1 ||
            upstreamUrl.searchParams.get("epoch") !== record.parsed.cursor.epoch ||
            upstreamUrl.searchParams.getAll("sequence").length !== 1 ||
            upstreamUrl.searchParams.get("sequence") !==
              String(record.parsed.cursor.sequence)
          : upstreamUrl.searchParams.has("epoch") ||
            upstreamUrl.searchParams.has("sequence"))
      ) {
        throw new EventProxyError("EVENT_STREAM_CONFIGURATION", 503);
      }

      const upstream = new WebSocketClient(upstreamUrl, {
        headers: {
          "x-evejs-web-token": upstreamRequest.headers["x-evejs-web-token"],
        },
        followRedirects: false,
        handshakeTimeout: upgradeTimeoutMs,
        maxPayload: maxFrameBytes,
        perMessageDeflate: false,
      });
      record.upstream = upstream;
      upstream.once("open", () => finishUpstreamHandshake(record, upstream, context));
      upstream.once("error", () => cancelPending(
        record,
        new EventProxyError("EVENT_STREAM_UNAVAILABLE", 503),
      ));
      upstream.once("close", () => cancelPending(
        record,
        new EventProxyError("EVENT_STREAM_UNAVAILABLE", 503),
      ));
      upstream.once("unexpected-response", (upstreamRequestObject, response) => {
        void upstreamRequestObject;
        response.resume();
        cancelPending(
          record,
          new EventProxyError("EVENT_STREAM_UNAVAILABLE", 503),
        );
      });
    } catch (error) {
      const rejection = error instanceof EventProxyError
        ? error
        : error && error.name === "EveGatewayError"
          ? new EventProxyError("EVENT_STREAM_CONFIGURATION", 503)
          : new EventProxyError("EVENT_STREAM_UNAVAILABLE", 503);
      cancelPending(record, rejection);
    }
  }

  function handleUpgrade(request, socket, head) {
    if (closed) {
      writeUpgradeRejection(socket, 503, "EVENT_STREAM_UNAVAILABLE");
      return;
    }
    let parsed;
    try {
      parsed = parseUpgradeRequest(request);
    } catch (error) {
      const rejection = error instanceof EventProxyError
        ? error
        : new EventProxyError("EVENT_STREAM_NOT_FOUND", 404);
      writeUpgradeRejection(socket, rejection.statusCode, rejection.code);
      return;
    }

    socket.pause();
    const record = {
      request,
      socket,
      head,
      parsed,
      upstream: null,
      timer: null,
      onSocketClose: null,
      onSocketError: null,
    };
    record.onSocketClose = () => cancelPending(record);
    record.onSocketError = () => cancelPending(record);
    record.timer = setTimeoutFn(() => cancelPending(
      record,
      new EventProxyError("EVENT_STREAM_TIMEOUT", 503),
    ), upgradeTimeoutMs);
    if (record.timer && typeof record.timer.unref === "function") {
      record.timer.unref();
    }
    timers.add(record.timer);
    pendingUpgrades.add(record);
    socket.once("close", record.onSocketClose);
    socket.once("error", record.onSocketError);
    void establishPending(record);
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    if (attachedServer) {
      const server = attachedServer;
      server.removeListener("upgrade", handleUpgrade);
      server.removeListener("close", close);
      if (wrappedServerClose && server.close === wrappedServerClose) {
        server.close = originalServerClose;
      }
      attachedServer = null;
      originalServerClose = null;
      wrappedServerClose = null;
    }
    for (const record of [...pendingUpgrades]) {
      cancelPending(record);
    }
    for (const session of [...sessions]) {
      cleanupSession(session);
    }
    for (const socket of [...closingSockets]) {
      closingSockets.delete(socket);
      destroyWebSocket(socket);
    }
    for (const timer of [...timers]) {
      clearTimeoutFn(timer);
      clearIntervalFn(timer);
      timers.delete(timer);
    }
    try {
      webSocketServer.close();
    } catch {
      // The no-server WebSocket server was already closed.
    }
    webSocketServer.removeAllListeners();
  }

  function attach(server) {
    if (attachedServer || closed) {
      throw new Error("The character event proxy can only be attached once.");
    }
    attachedServer = server;
    originalServerClose = server.close;
    const closeServer = originalServerClose;
    server.on("upgrade", handleUpgrade);
    server.on("close", close);
    wrappedServerClose = function closeWithCharacterEvents(...args) {
      close();
      return closeServer.apply(this, args);
    };
    server.close = wrappedServerClose;
    return api;
  }

  function getDiagnostics() {
    return {
      attached: Boolean(attachedServer) && !closed,
      closed,
      pendingUpgrades: pendingUpgrades.size,
      sessions: sessions.size,
      sockets: pendingUpgrades.size + (sessions.size * 2) + closingSockets.size,
      timers: timers.size,
    };
  }

  const api = {
    attach,
    close,
    getDiagnostics,
  };
  return api;
}

module.exports = {
  API_VERSION,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_MAX_BUFFERED_BYTES,
  DEFAULT_MAX_FRAME_BYTES,
  DEFAULT_UPGRADE_TIMEOUT_MS,
  GATEWAY_SOURCE,
  STREAM_VERSION,
  acceptsNextCursor,
  createCharacterEventProxy,
  parseCursor,
  parseGatewayFrame,
  validateGatewayFrame,
};
