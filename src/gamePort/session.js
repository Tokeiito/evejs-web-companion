"use strict";

// ── A game-port session: the connection the retail client holds ─────────────
//
// One of these is one login on the eve.js game port (26000), kept open, doing
// on the wire what the retail client (build 3396210) does. It is written from
// the client's own source and checked against what a real server sends back:
//
//   handshake   carbon/common/script/net/GPS.py            Authenticate
//   after login carbon/common/script/net/machoNet.py       ConnectToServer
//               carbon/client/script/remote/connectionService.py
//                                                          Connect, PingLoop,
//                                                          ClockSyncDaemon
//   calls       ServiceCallGPCS.py, ObjectCallGPCS.py, moniker.py
//   packets     machoNetPacket.py, machoNetAddress.py, machoNetTransport.py
//
// docs/game-port-client-reference.md lists every point where this matches the
// client, and the ones that still need a recording of the real client to settle.
//
// ⚠ IT TAKES A FRAME TRANSPORT AND NEVER IMPORTS node:net. `transport` is
// anything with send(payload), close() and the onFrame / onClose hooks, so the
// same session can run over a TCP socket in Node (./tcp.js) or, later, over a
// relay from a browser.
//
// ⚠ ONE CHARACTER, ONE CONNECTION. Selecting a character here evicts any other
// session holding it, and closing this connection logs the character off. In
// space that is an emergency-warp logoff.

const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { marshalDecode } = require("../gameProtocol/marshal");
const { encodeClient, long } = require("./clientMarshal");
const {
  TYPE, anyAddress, buildPacket, clientAddress, dictGet, integer, nodeAddress, parsePacket, text, unwrapSubstream,
} = require("./packets");
const { caseFold, cryptoHash, passwordHash, randomBytes } = require("./placebo");
const { keywordOrder, orderEntries } = require("./py27");

/** What the client says it is. From the client's start.ini and GPS.py. */
const RETAIL_CLIENT = Object.freeze({
  handshakeSecret: 170472,
  machoVersion: 496,
  version: 24.01,
  build: 3396210,
  codename: "V24.01",
  region: "ccp",
});

/** boot.GetValue('handShakePaddingLength', 64): the client challenge's length. */
const HANDSHAKE_PADDING_LENGTH = 64;
/** prefs machoNet.minimumBytesToCompress. */
const COMPRESSION_THRESHOLD = 200;
/** globalConfig MAX_CONNECTION_IDLE_TIME_SECONDS_DEFAULT. */
const MAX_IDLE_SECONDS_DEFAULT = 60;
/** connectionService MAX_SYNC_TIME_IN_MINUTES. */
const CLOCK_SYNC_INTERVAL_MS = 3 * 60 * 1000;
const CLOCK_SYNC_ITERATIONS = 5;
const CALL_TIMEOUT_MS = 60_000;
const HANDSHAKE_TIMEOUT_MS = 20_000;
/** FILETIME ticks (100ns) between 1601 and 1970. */
const FILETIME_EPOCH_OFFSET = 116444736000000000n;

/**
 * What the retail client prints when it runs the function the server sends at
 * login, keyed by the SHA-256 of that function's source.
 *
 * The server sends Python and the client runs it and returns its output. We are
 * not a Python interpreter, so we answer with what the real client is recorded
 * answering for that exact source (eve.js _local/logs/tidi_probe.*.log). A
 * function we have never seen gets an empty answer and `unknownHandshakeFunction`
 * is set, rather than a guess.
 */
const KNOWN_HANDSHAKE_FUNCTIONS = new Map([
  [
    // eve.js handshake.js buildTidiSignedFunc, as sent by eve.js 7603a2966. The
    // retail client's answer to it, 75 bytes, logged on 2026-10-06.
    "86b3a18871f7e5091b1796b8b30655643424679928207124bf6274d243015e3e",
    ["TIDI_HANDLER:OK", "PORTRAIT_UPLOAD_HANDLER:OK", "SKILL_EXTRACTOR_ACCESS_TOKEN:OK", ""].join("\n"),
  ],
]);

const dict = (entries) => ({ type: "dict", entries });
/** A Python unicode object, as opposed to a byte string. */
const unicode = (value) => ({ type: "wstring", value });
const bytes = (buffer) => ({ type: "bytes", value: buffer });

class GamePortError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

/** The best one-line reading of an exception payload the server raised. */
function describeError(payload) {
  const seen = [];
  const walk = (value, depth) => {
    if (depth > 6 || seen.length > 8 || value === null || value === undefined) return;
    const asText = text(value);
    if (asText !== null) {
      if (asText.length > 0 && asText.length < 120) seen.push(asText);
      return;
    }
    if (Array.isArray(value)) value.forEach((entry) => walk(entry, depth + 1));
    else if (typeof value === "object") {
      if (value.type === "object") {
        walk(value.name, depth + 1);
        walk(value.args, depth + 1);
      } else if (value.type === "dict") {
        value.entries.forEach(([key, entry]) => {
          walk(key, depth + 1);
          walk(entry, depth + 1);
        });
      } else if (value.type === "substream" || value.type === "substruct") walk(value.value, depth + 1);
      else if (value.type === "list") value.items.forEach((entry) => walk(entry, depth + 1));
    }
  };
  walk(payload, 0);
  return seen.length > 0 ? seen.join(" / ") : "no reason given";
}

/**
 * A GPSTransportClosed sent where a frame's value should be, or null. The server
 * sends one to say why it is about to hang up; the client's unmarshaller raises
 * it. It is an object with constructor arguments (reason, reasonCode, reasonArgs).
 */
function readTransportClosed(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value)) return null;
  const header = Array.isArray(value.header) ? value.header : null;
  const name = text(header ? header[0] : value.name);
  if (!name || !/GPSTransportClosed$/.test(name)) return null;
  const args = header ? header[1] : value.args;
  const at = (index) => (Array.isArray(args) ? text(args[index]) : null);
  return { reason: at(0) ?? "Disconnected", reasonCode: at(1) };
}

/**
 * A pickle as a packet carries one: a substream, or a byte string that is
 * itself a marshal stream. (The server sends call answers the first way and
 * notifications the second.)
 */
function unpickle(value) {
  const inner = unwrapSubstream(value);
  if (Buffer.isBuffer(inner) && inner.length > 0 && inner[0] === 0x7e) return marshalDecode(inner);
  return inner;
}

/** The state of a decoded object of the class whose dotted name ends `suffix`, or null. */
function stateOfClass(value, suffix) {
  if (!value || typeof value !== "object" || value.type !== "object" || !Array.isArray(value.args)) return null;
  const name = text(value.name);
  return name && name.endsWith(suffix) ? value.args : null;
}

/** A value as a string that is the same for equal values: a cache key. */
function keyOf(value) {
  return JSON.stringify(value, (key, entry) => {
    if (typeof entry === "bigint") return `${entry}n`;
    if (entry && entry.type === "Buffer" && Array.isArray(entry.data)) return Buffer.from(entry.data).toString("latin1");
    return entry;
  });
}

/**
 * A notification, read the way the client's layers peel it:
 *   ObjectCallGPCS   body is (flag, pickle)
 *   ServiceCallGPCS  the pickle is (1, method, args[, kwargs]) for a service's
 *                    own notification, or (0, payload) for a broadcast
 *   BroadcastStuff   a broadcast's method is the address's broadcastID, and its
 *                    payload is (1, args)
 */
function readNotification(packet) {
  const outer = packet.body[0];
  const inner = Array.isArray(outer) ? unpickle(outer[1]) : null;
  const notification = {
    method: packet.destination.broadcastID ?? null,
    idtype: packet.destination.idtype ?? null,
    narrowcast: packet.destination.narrowcast ?? null,
    service: packet.destination.service ?? null,
    args: null,
    kwargs: null,
    packet,
  };
  if (!Array.isArray(inner)) return notification;
  if (inner[0]) {
    notification.method = text(inner[1]) ?? notification.method;
    notification.args = inner[2] ?? null;
    notification.kwargs = inner[3] ?? null;
  } else {
    const payload = inner[1];
    notification.args = Array.isArray(payload) && payload.length === 2 && payload[0] === 1 ? payload[1] : payload;
  }
  return notification;
}

class GamePortSession {
  constructor({
    transport,
    client = RETAIL_CLIENT,
    languageID = "EN",
    handshakeFunctions = KNOWN_HANDSHAKE_FUNCTIONS,
    journeyID = crypto.randomUUID(),
    now = () => Date.now(),
    timers = { setTimeout, clearTimeout },
    callTimeoutMs = CALL_TIMEOUT_MS,
  } = {}) {
    if (!transport) throw new TypeError("A game-port session needs a transport.");
    this.transport = transport;
    this.client = client;
    this.languageID = languageID;
    this.handshakeFunctions = handshakeFunctions;
    this.journeyID = journeyID;
    this.now = now;
    this.timers = timers;
    this.callTimeoutMs = callTimeoutMs;

    this.closed = false;
    this.closeReason = null;
    this.loggedIn = false;
    this.handshakeInbox = [];
    this.handshakeWaiters = [];
    this.pending = new Map();
    this.nextCallID = 1;
    /** Cached objects fetched so far, by object ID: {stamp, checksum, value}. */
    this.cachedObjects = new Map();

    /** What the server told us at login (GPS.py's `response`). */
    this.loginResponse = null;
    this.userID = null;
    this.clientID = null;
    this.proxyNodeID = null;
    this.serviceInfo = null;
    this.logonQueuePosition = null;
    this.unknownHandshakeFunction = null;
    /** The session attributes, kept current from session-change packets. */
    this.attributes = {};
    /** Server clock minus ours, in milliseconds, from the last clock sync. */
    this.clockOffsetMs = 0;
    this.lastSentAt = this.now();
    this.counters = { sent: 0, received: 0, compressedSent: 0, compressedReceived: 0, unknownPackets: 0 };

    this.listeners = { notification: new Set(), sessionChange: new Set(), close: new Set(), packet: new Set() };
    this.backgroundTimers = new Set();

    transport.onFrame = (payload) => this._onFrame(payload);
    // The connection went away without our closing it: the server dropped us
    // (a takeover of the character does exactly this, with no notice) or the
    // network did.
    transport.onClose = (error) => this._onClosed(new GamePortError("CONNECTION_LOST", (error && error.message) || "The game connection closed.", error ?? null));
  }

  // ── listening ──────────────────────────────────────────────────────────────

  /** fn({method, idtype, narrowcast, service, args, kwargs, packet}) for every notification. */
  onNotification(listener) { return this._listen("notification", listener); }
  /** fn(changes, attributes): changes is {name: [old, new]}. */
  onSessionChange(listener) { return this._listen("sessionChange", listener); }
  /** fn(error) once, when the connection is gone. The character is logged off. */
  onClose(listener) { return this._listen("close", listener); }
  /** fn(packet, direction) for every packet, "in" or "out". For recording. */
  onPacket(listener) { return this._listen("packet", listener); }

  _listen(kind, listener) {
    this.listeners[kind].add(listener);
    return () => this.listeners[kind].delete(listener);
  }

  _emit(kind, ...args) {
    for (const listener of [...this.listeners[kind]]) {
      try {
        listener(...args);
      } catch {
        // A listener's failure is its own; it must not take the connection down.
      }
    }
  }

  // ── login: GPS.py Authenticate, then machoNet.ConnectToServer ──────────────

  /**
   * Log in as `userName`, the way the client's login screen does.
   *
   * `password` is whatever was typed. eve.js does not check it, but the client
   * still hashes it and sends the hash, so we do too.
   */
  async login(userName, password = "") {
    // The login screen asks where it stands in the queue before the player has
    // typed anything, then logs in on the same connection.
    await this._exchangeVersions();
    this._writeRaw([null, "QC"]);
    this.logonQueuePosition = integer(await this._readRaw());

    await this._exchangeVersions();
    // The name comes from the login screen's edit box, so it is a unicode
    // object here and in the credentials below; everything else is a byte string.
    this._writeRaw([null, "VK", cryptoHash(unicode(caseFold(userName)))]);
    // (publicKeyVersion, cryptoContext.Initialize()): Placebo has no keys.
    this._writeRaw(["placebo", dict([])]);
    await this._readRaw(); // "OK CC"; the client reads it and does not look.

    const clientChallenge = randomBytes(HANDSHAKE_PADDING_LENGTH);
    const credentials = (passwordField, hashField) => dict(orderEntries([
      ["macho_version", this.client.machoVersion],
      ["boot_version", this.client.version],
      ["boot_build", this.client.build],
      ["boot_codename", this.client.codename],
      ["boot_region", this.client.region],
      ["user_name", unicode(userName)],
      ["user_password", passwordField],
      ["user_password_hash", hashField],
      ["user_languageid", this.languageID],
      ["user_affiliateid", 0],
      ["user_sso_token", null],
    ], { presized: 11 }));
    this._writeRaw([clientChallenge, credentials(null, bytes(passwordHash(userName, password)))]);
    const passwordVersion = await this._readRaw();
    if (passwordVersion === 1) {
      this._writeRaw([clientChallenge, credentials(password, null)]);
    } else if (passwordVersion !== 2) {
      throw this._fail(new GamePortError("LOGIN_REFUSED", `The game server refused the login: ${describeError(passwordVersion)}`, passwordVersion));
    }

    const handshake = await this._readRaw();
    if (!Array.isArray(handshake) || handshake.length < 4) {
      throw this._fail(new GamePortError("LOGIN_REFUSED", `The game server refused the login: ${describeError(handshake)}`, handshake));
    }
    const [serverChallenge, signedFunction, , response] = handshake;
    if (text(dictGet(response, "challenge_responsehash")) !== cryptoHash(clientChallenge)) {
      throw this._fail(new GamePortError("BAD_SERVER_SIGNATURE", "Server response signature incorrect, the server's crypto hash wasn't correct"));
    }
    const queued = integer(dictGet(response, "user_logonqueueposition")) ?? 0;
    if (queued >= 2) {
      this.logonQueuePosition = queued;
      throw this._fail(new GamePortError("LOGON_QUEUE", `The game server put this login at position ${queued} in its queue.`));
    }
    this._writeRaw([cryptoHash(text(serverChallenge) ?? ""), this._runHandshakeFunction(signedFunction), null]);

    const acknowledgement = await this._readRaw();
    if (!acknowledgement || acknowledgement.type !== "dict") {
      throw this._fail(new GamePortError("LOGIN_REFUSED", "Server didn't ACK our Challenge-Response", acknowledgement));
    }
    this.loginResponse = dict([...response.entries, ...acknowledgement.entries]);
    const sessionInit = dictGet(this.loginResponse, "session_init");
    this.userID = integer(dictGet(sessionInit, "userid"));
    this.clientID = integer(dictGet(this.loginResponse, "user_clientid"));
    this.proxyNodeID = integer(dictGet(this.loginResponse, "proxy_nodeid"));
    if (this.userID === null || this.proxyNodeID === null) {
      throw this._fail(new GamePortError("LOGIN_REFUSED", "The game server's login answer carried no session."));
    }
    if (sessionInit && sessionInit.type === "dict") {
      for (const [name, value] of sessionInit.entries) this.attributes[text(name)] = value;
    }

    // From here every frame is a packet.
    this.loggedIn = true;
    for (const value of this.handshakeInbox.splice(0)) this._dispatch(value);

    // machoNet.ConnectToServer's first call, then connectionService.Connect.
    this.serviceInfo = await this.proxyCall("machoNet", "GetServiceInfo");
    await this.synchronizeClock();
    this._startClockSyncDaemon();
    this._startPingLoop();
    return this.loginResponse;
  }

  async _exchangeVersions() {
    const server = await this._readRaw();
    if (!Array.isArray(server) || server.length < 6) {
      throw this._fail(new GamePortError("INCOMPATIBLE_PROTOCOL", "The game server did not open with a version exchange."));
    }
    // The checks GPS.py makes, in its order. A mismatch closes the connection.
    const [, machoVersion, , version, build, project] = server;
    const [codename, region = ""] = String(text(project) ?? "").split("@");
    const refuse = (code, what) => this._fail(new GamePortError(code, `Incompatible ${what}: the server is ${text(project)} ${version} build ${build}, protocol ${machoVersion}.`));
    if (region !== this.client.region) throw refuse("HANDSHAKE_INCOMPATIBLEREGION", "region");
    if (codename !== this.client.codename) throw refuse("HANDSHAKE_INCOMPATIBLERELEASE", "release");
    if (version !== this.client.version) throw refuse("HANDSHAKE_INCOMPATIBLEVERSION", "version");
    if (machoVersion !== this.client.machoVersion) throw refuse("HANDSHAKE_INCOMPATIBLEPROTOCOL", "protocol");
    if (this.client.build < build) throw refuse("HANDSHAKE_INCOMPATIBLEBUILD", "build");
    this.serverVersion = { machoVersion, userCount: integer(server[2]), version, build, codename, region };
    // (secret, macho.version, 0, boot.version, boot.build, codename@region)
    this._writeRaw([
      this.client.handshakeSecret, this.client.machoVersion, 0, this.client.version, this.client.build,
      `${this.client.codename}@${this.client.region}`,
    ]);
  }

  /** What the client's stdout held after running the server's login function. */
  _runHandshakeFunction(signedFunction) {
    const marshaled = Array.isArray(signedFunction) ? signedFunction[0] : signedFunction;
    const source = Buffer.isBuffer(marshaled) ? marshaled : Buffer.from(String(text(marshaled) ?? ""), "latin1");
    const digest = crypto.createHash("sha256").update(source).digest("hex");
    const known = this.handshakeFunctions.get(digest);
    if (known === undefined) {
      this.unknownHandshakeFunction = digest;
      return "";
    }
    return known;
  }

  // ── calls: ServiceCallGPCS, ObjectCallGPCS, moniker ────────────────────────

  /** sm.RemoteSvc(service).method(*args, **kwargs) */
  call(service, method, args = [], kwargs = null) {
    return this._call({ destination: anyAddress(service), boundObject: null, service, method, args, kwargs });
  }

  /** sm.ProxySvc(service).method(*args, **kwargs): addressed to our proxy node. */
  proxyCall(service, method, args = [], kwargs = null) {
    return this._call({ destination: nodeAddress(this.proxyNodeID, service), boundObject: null, service, method, args, kwargs });
  }

  /**
   * Bind a service's object, as a Moniker does: ask any node which node holds
   * the object (MachoResolveObject), then bind it on that node
   * (MachoBindObject). Returns {objectID, nodeID, result}; `result` is the
   * answer to `call`, a (method, args, kwargs) the bind can carry along.
   */
  async bind(service, bindParams, call = null) {
    const nodeID = integer(await this.call(service, "MachoResolveObject", [bindParams]));
    if (nodeID === null) throw new GamePortError("RESOLVE_FAILED", `${service} could not say where its object lives.`);
    const reply = await this._call({
      destination: nodeAddress(nodeID, service), boundObject: null, service, method: "MachoBindObject", args: [bindParams, call], kwargs: null,
    });
    const head = Array.isArray(reply) ? reply[0] : null;
    const pair = unwrapSubstream(head && typeof head === "object" && head.type === "substruct" ? head.value : head);
    const objectID = Array.isArray(pair) ? text(pair[0]) : text(pair);
    if (!objectID || !objectID.startsWith("N=")) {
      throw new GamePortError("BIND_FAILED", `${service} did not return a bound object.`, reply);
    }
    return { objectID, nodeID, result: Array.isArray(reply) ? reply[1] : null };
  }

  /** A call on a bound object, by the "N=node:id" a bind returned. */
  callBound(objectID, method, args = [], kwargs = null) {
    // ObjectCallGPCS: MachoAddress(nodeID=long(nid)), read out of the object's ID.
    const nodeID = Number(String(objectID).slice(2).split(":")[0]);
    return this._call({ destination: nodeAddress(long(nodeID)), boundObject: objectID, service: null, method, args, kwargs });
  }

  _call({ destination, boundObject, service, method, args, kwargs }) {
    if (!this.loggedIn || this.closed) {
      return Promise.reject(new GamePortError("NOT_CONNECTED", "The game connection is not logged in."));
    }
    const callID = this.nextCallID;
    this.nextCallID += 1;
    // Every call's keywords carry machoVersion, 1 unless a cached answer says
    // otherwise, and go out in the order the client's own dict would hold them:
    // a service's method and a bound object's method build that dict differently.
    const written = new Map(kwargs && kwargs.type === "dict" ? kwargs.entries : Object.entries(kwargs ?? {}));
    written.set("machoVersion", 1);
    const names = [...written.keys()].filter((name) => name !== "machoVersion");
    const keywords = dict(keywordOrder(names, { via: boundObject === null ? "function" : "object" }).map((name) => [name, written.get(name)]));
    // ObjectCallGPCS: (0, pickle((1, method, args, kw))) for a service,
    // (1, pickle((objectID, method, args, kw))) for a bound object.
    const body = boundObject === null
      ? [0, { type: "substream", value: [1, method, args, keywords] }]
      : [1, { type: "substream", value: [boundObject, method, args, keywords] }];
    const packet = buildPacket(TYPE.CALL_REQ, {
      // machoNet._BlockingCall: MachoAddress(clientID=0, callID=callID). The
      // counter starts life as 1L, so the call ID is a long however small.
      source: clientAddress(0, long(callID)),
      destination,
      userID: this.userID,
      body: [body],
      journeyID: this.journeyID,
    });
    const answered = new Promise((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        this.pending.delete(callID);
        reject(new GamePortError("CALL_TIMEOUT", `${service ?? boundObject}.${method} got no answer from the game server.`));
      }, this.callTimeoutMs);
      this.pending.set(callID, { label: `${service ?? boundObject}.${method}`, resolve, reject, timer });
      try {
        this._writePacket(packet);
      } catch (error) {
        this.timers.clearTimeout(timer);
        this.pending.delete(callID);
        reject(error);
      }
    });
    return answered.then((result) => this._unwrapCachedResult(result));
  }

  // ── cached answers: objectCaching ──────────────────────────────────────────

  /**
   * What the caller of a remote call gets when the server answers with a
   * CachedMethodCallResult, which is the answer itself and not the wrapper
   * (ServiceCallGPCS: `ret = ret.GetResult()`). Its state is
   * (details, result, version), and `result` is one of two things:
   *
   *   a marshal string      the answer, inline
   *   a util.CachedObject   a reference; the object is fetched from
   *                         objectCaching on first use
   *
   * Anything else is returned as it came.
   */
  async _unwrapCachedResult(value) {
    const state = stateOfClass(value, "objectCaching.CachedMethodCallResult");
    if (!state) return value;
    const reference = stateOfClass(state[1], "cachedObject.CachedObject");
    return reference ? this.fetchCachedObject(state[1]) : unpickle(state[1]);
  }

  /**
   * The object a util.CachedObject refers to. Its state is
   * (objectID, nodeID, objectVersion[, shared]); `shared` is left out when true.
   *
   * objectCaching.GetCachableObject: a shared object is asked for through our
   * proxy node, any other from the node that holds it. The answer is an
   * objectCaching.CachedObject, state (version, object, nodeID, shared, pickle,
   * compressed, objectID), whose pickle is zlib when `compressed` is set.
   *
   * Like the client, we keep what we fetched. A version is (timestamp,
   * checksum), and the client asks again only when the checksum differs AND
   * what it holds is older (objectCaching.__OlderVersion). The timestamp alone
   * changing, which it does on every answer, is not a new version.
   */
  async fetchCachedObject(reference) {
    const state = stateOfClass(reference, "cachedObject.CachedObject");
    if (!state) throw new GamePortError("NOT_A_CACHED_OBJECT", "That value is not a cached object reference.");
    const [objectID, nodeID, objectVersion, sharedField] = state;
    const shared = state.length < 4 ? 1 : sharedField;
    const key = keyOf(objectID);
    const [stamp, checksum] = Array.isArray(objectVersion) ? objectVersion.map((part) => BigInt(integer(part) ?? 0)) : [0n, 0n];
    const kept = this.cachedObjects.get(key);
    if (kept && !(kept.checksum !== checksum && kept.stamp < stamp)) return kept.value;

    const remote = await this._call({
      destination: nodeAddress(shared ? this.proxyNodeID : integer(nodeID), "objectCaching"),
      boundObject: null,
      service: "objectCaching",
      method: "GetCachableObject",
      args: [shared, objectID, objectVersion, nodeID],
      kwargs: null,
    });
    const container = stateOfClass(remote, "objectCaching.CachedObject");
    if (!container) throw new GamePortError("BAD_CACHED_OBJECT", "objectCaching did not answer with a cached object.", remote);
    const [, object, , , pickle, compressed] = container;
    let value = object;
    if (value === null || value === undefined) {
      if (!Buffer.isBuffer(pickle)) throw new GamePortError("BAD_CACHED_OBJECT", "Getting cached object contents, but both the object and the pickle are none");
      value = marshalDecode(compressed ? zlib.inflateSync(pickle) : pickle);
    }
    this.cachedObjects.set(key, { stamp, checksum, value });
    return value;
  }

  // ── clock and keep-alive: connectionService ────────────────────────────────

  /** SynchronizeClock: up to five GetTime calls, stopping after three good ones. */
  async synchronizeClock(iterations = CLOCK_SYNC_ITERATIONS) {
    let good = 0;
    let lastElapsed = null;
    for (let index = 0; index < iterations; index += 1) {
      const started = this.now();
      const serverTime = integer(await this.proxyCall("machoNet", "GetTime"));
      const elapsed = this.now() - started;
      if (serverTime === null) continue;
      if (lastElapsed === null || (elapsed < lastElapsed && elapsed < 1000)) {
        const serverMs = Number((BigInt(serverTime) - FILETIME_EPOCH_OFFSET) / 10000n) + elapsed / 2;
        this.clockOffsetMs = serverMs - this.now();
        lastElapsed = elapsed;
        good += 1;
      }
      if (good >= 3) break;
    }
    return this.clockOffsetMs;
  }

  /** The server's clock, as far as the last sync could tell. */
  serverNow() {
    return this.now() + this.clockOffsetMs;
  }

  _startClockSyncDaemon() {
    this._every(CLOCK_SYNC_INTERVAL_MS, () => this.synchronizeClock(CLOCK_SYNC_ITERATIONS));
  }

  /** PingLoop: pingService.Ping() once the connection has been idle a minute. */
  _startPingLoop() {
    const configured = integer(dictGet(dictGet(this.loginResponse, "config_vals"), "maxConnectionIdleTimeSeconds"));
    const maxIdleMs = (configured ?? MAX_IDLE_SECONDS_DEFAULT) * 1000;
    if (maxIdleMs <= 0) return;
    const tick = () => {
      if (this.closed) return;
      const idle = this.now() - this.lastSentAt;
      let wait = maxIdleMs - idle;
      if (idle >= maxIdleMs) {
        this.proxyCall("pingService", "Ping").catch(() => {});
        wait = maxIdleMs;
      }
      this._later(wait, tick);
    };
    this._later(maxIdleMs, tick);
  }

  _later(delayMs, action) {
    const timer = this.timers.setTimeout(() => {
      this.backgroundTimers.delete(timer);
      action();
    }, delayMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    this.backgroundTimers.add(timer);
  }

  _every(intervalMs, action) {
    const tick = () => {
      if (this.closed) return;
      Promise.resolve().then(action).catch(() => {}).finally(() => this._later(intervalMs, tick));
    };
    this._later(intervalMs, tick);
  }

  // ── closing ────────────────────────────────────────────────────────────────

  /** Close the connection. The server logs the character off. */
  close() {
    this._onClosed(new GamePortError("CONNECTION_CLOSED", "The game connection closed."));
  }

  _fail(error) {
    this._onClosed(error);
    return error;
  }

  _onClosed(error) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = error;
    for (const timer of this.backgroundTimers) this.timers.clearTimeout(timer);
    this.backgroundTimers.clear();
    for (const waiter of this.handshakeWaiters.splice(0)) waiter.reject(error);
    for (const [, waiter] of this.pending) {
      this.timers.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
    this.handshakeInbox = [];
    try {
      this.transport.close();
    } catch {
      // Already gone.
    }
    this._emit("close", error);
  }

  // ── frames ─────────────────────────────────────────────────────────────────

  _onFrame(payload) {
    if (this.closed) return;
    this.counters.received += 1;
    let data = payload;
    // machoNetTransport.Read: anything not starting '~' or '}' is zlib.
    if (data.length > 0 && data[0] !== 0x7e && data[0] !== 0x7d) {
      try {
        data = zlib.inflateSync(data);
        this.counters.compressedReceived += 1;
      } catch (error) {
        this._onClosed(new GamePortError("BAD_FRAME", `Decompression Failure: ${error.message}`));
        return;
      }
    }
    let value;
    try {
      value = marshalDecode(data);
    } catch (error) {
      this._onClosed(new GamePortError("BAD_FRAME", `The game server sent a frame that does not decode: ${error.message}`));
      return;
    }
    const closedBy = readTransportClosed(value);
    if (closedBy) {
      this._onClosed(new GamePortError("TRANSPORT_CLOSED", `The game server closed the connection: ${closedBy.reasonCode ?? closedBy.reason}`, closedBy));
      return;
    }
    if (!this.loggedIn) {
      const waiter = this.handshakeWaiters.shift();
      if (waiter) waiter.resolve(value);
      else this.handshakeInbox.push(value);
      return;
    }
    this._dispatch(value);
  }

  _readRaw() {
    if (this.handshakeInbox.length > 0) return Promise.resolve(this.handshakeInbox.shift());
    if (this.closed) return Promise.reject(this.closeReason);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (value) => { this.timers.clearTimeout(timer); resolve(value); },
        reject: (error) => { this.timers.clearTimeout(timer); reject(error); },
      };
      const timer = this.timers.setTimeout(() => {
        const index = this.handshakeWaiters.indexOf(waiter);
        if (index >= 0) this.handshakeWaiters.splice(index, 1);
        waiter.reject(new GamePortError("HANDSHAKE_TIMEOUT", "The game server stopped answering the handshake."));
      }, HANDSHAKE_TIMEOUT_MS);
      this.handshakeWaiters.push(waiter);
    });
  }

  _writeRaw(value) {
    this._send(encodeClient(value));
  }

  _writePacket(packet) {
    this._emit("packet", parsePacket(packet), "out");
    let pickle = encodeClient(packet);
    // machoNetTransport.Write: compress a packet over the threshold, and keep
    // the compressed form only when it is smaller by more than five percent.
    if (pickle.length > COMPRESSION_THRESHOLD) {
      const compressed = zlib.deflateSync(pickle, { level: 1 });
      if (compressed.length <= pickle.length && (pickle.length - compressed.length) * 100 / pickle.length > 5) {
        pickle = compressed;
        this.counters.compressedSent += 1;
      }
    }
    this._send(pickle);
  }

  _send(payload) {
    if (this.closed) throw this.closeReason;
    this.counters.sent += 1;
    this.lastSentAt = this.now();
    this.transport.send(payload);
  }

  // ── packets from the server: machoNet's transport reader ───────────────────

  _dispatch(value) {
    const packet = parsePacket(value);
    if (!packet || packet.className === null) {
      this.counters.unknownPackets += 1;
      this._emit("packet", packet ?? { command: null, raw: value }, "in");
      return;
    }
    this._emit("packet", packet, "in");
    switch (packet.command) {
      case TYPE.CALL_RSP:
      case TYPE.ERROR_RESPONSE:
        this._settleCall(packet);
        return;
      case TYPE.PING_RSP:
        this._settleCall(packet);
        return;
      case TYPE.NOTIFICATION:
        this._emit("notification", readNotification(packet));
        return;
      case TYPE.SESSION_CHANGE:
        this._applySessionChange(packet.body[1]);
        return;
      case TYPE.SESSION_INITIAL_STATE:
        this._applyInitialState(packet.body[2]);
        return;
      case TYPE.PING_REQ: {
        // Add our turnaround time and send the times straight back.
        const stamp = { type: "long", value: BigInt(Math.round(this.serverNow())) * 10000n + FILETIME_EPOCH_OFFSET };
        const times = packet.body[0] && packet.body[0].type === "list" ? [...packet.body[0].items] : [];
        times.push([stamp, stamp, "client::turnaround"]);
        this._writePacket(buildPacket(TYPE.PING_RSP, {
          source: value.args[2],
          destination: value.args[1],
          userID: packet.userID,
          body: [{ type: "list", items: times }],
          journeyID: this.journeyID,
        }));
        return;
      }
      case TYPE.TRANSPORT_CLOSED:
        this._onClosed(new GamePortError("TRANSPORT_CLOSED", "Session terminated due to remote transport closed notification"));
        return;
      default:
        this.counters.unknownPackets += 1;
    }
  }

  _settleCall(packet) {
    const callID = packet.destination.callID;
    const waiter = callID === null || callID === undefined ? undefined : this.pending.get(Number(callID));
    if (!waiter) return;
    this.pending.delete(Number(callID));
    this.timers.clearTimeout(waiter.timer);
    if (packet.command === TYPE.ERROR_RESPONSE) {
      // (originalCommand, code, payload)
      const detail = packet.body[2];
      waiter.reject(new GamePortError("GAME_CALL_REFUSED", `${waiter.label} was refused by the server: ${describeError(detail)}`, detail));
      return;
    }
    waiter.resolve(unwrapSubstream(packet.body[0]));
  }

  /** change is (clueless, {attribute: (old, new)}). */
  _applySessionChange(change) {
    const changes = Array.isArray(change) ? change[1] : null;
    if (!changes || changes.type !== "dict") return;
    const applied = {};
    for (const [name, pair] of changes.entries) {
      const key = text(name);
      if (key === null || !Array.isArray(pair)) continue;
      applied[key] = [pair[0], pair[1]];
      this.attributes[key] = pair[1];
    }
    this._emit("sessionChange", applied, this.attributes);
  }

  _applyInitialState(initialState) {
    if (!initialState || initialState.type !== "dict") return;
    const applied = {};
    for (const [name, value] of initialState.entries) {
      const key = text(name);
      if (key === null) continue;
      applied[key] = [this.attributes[key] ?? null, value];
      this.attributes[key] = value;
    }
    this._emit("sessionChange", applied, this.attributes);
  }
}

module.exports = {
  CLOCK_SYNC_INTERVAL_MS, COMPRESSION_THRESHOLD, GamePortError, GamePortSession, KNOWN_HANDSHAKE_FUNCTIONS,
  MAX_IDLE_SECONDS_DEFAULT, RETAIL_CLIENT, describeError,
};
