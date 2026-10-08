"use strict";

// The game-port transport for a selected pilot.
//
// src/pilotTransport.js sends a pilot's nine functions either to the web
// gateway or here. This implements them on a GamePortSession: the retail
// protocol on TCP 26000, one connection per pilot, logged in and kept alive as
// the retail client's is.
//
// The contract is the gateway client's (src/eveGatewayClient.js): the same
// arguments, the same answers, the same error codes. What the gateway does
// for each function was read from eve.js
// (server/src/_secondary/express/evejsWebGatewayRuntime.js) and is matched
// here, because everything above this module was written against it:
//
//   - A call's arguments are JSON in the marshaller's own tree, and its
//     answer is that tree as JSON (bridgeJson.js maps ours onto it).
//   - A session keeps a backlog of what the server pushed. Every answer
//     drains it; the event stream carries the same notifications as they
//     arrive. The stream is liveness, the drain is correctness.
//   - A refusal by the game is CALL_REFUSED with the handler's own words. A
//     session that is gone is SESSION_NOT_FOUND, which is what tells the BFF
//     to send the browser back to character selection.
//
// What is the game port's own:
//
//   - Selecting is what the retail client's character selection does: log in,
//     GetCharacterSelectionData, GetCharacterLockType, SelectCharacterID.
//   - The account is the one the BFF authenticated. The game port takes any
//     password on a development server, so the login name comes from the
//     BFF's signed session and the server's answer is checked against the
//     BFF's account ID before anything else is asked of it.
//   - The connection closing is the session ending. There is no time-to-live.
//
//   - A bound object is bound as the retail client binds it. The gateway's
//     "bind" calls a method as though it were a service's and keeps whatever
//     bound object comes back; the retail client first binds a service's
//     object for where the pilot is (eveMoniker.py) and then asks that for
//     the inventory (invCache.py). bindRetail() below is that translation,
//     one case per shape the BFF asks for.
//
// Not here yet (docs/game-port-transport-plan.md, Phase 4): anything in
// space. A pilot in space is refused at select, before the server is asked to
// bring it online, and undocking is refused.

const crypto = require("node:crypto");
const { GamePortSession } = require("./session");
const { connectTcp, gameEndpoint } = require("./tcp");
const { notificationToBridgeJson, sessionChangeToBridgeJson, wireToBridgeJson } = require("./bridgeJson");
const { GAME_PORT_HANDLE_PREFIX } = require("../pilotTransport");
const { createCallLedger, retailForm } = require("./retailCalls");
const contract = require("../../contracts/evejs-web-bridge-contract.json");

/** The gateway's own codes and statuses (WEB_CALL_ERROR_STATUS_CODES), plus the gateway client's two. */
const STATUS = Object.freeze({
  CALL_INVALID: 400,
  CALL_NOT_ALLOWED: 403,
  CALL_FAILED: 502,
  CALL_REFUSED: 409,
  SESSION_NOT_FOUND: 404,
  SESSION_SELECT_FAILED: 502,
  BOUND_HANDLE_NOT_FOUND: 404,
  BOUND_NO_OBJECT: 502,
  EVE_GATEWAY_TIMEOUT: 502,
  EVE_GATEWAY_UNREACHABLE: 502,
  PILOT_TRANSPORT_UNAVAILABLE: 501,
});

/** An error with the `code` and `statusCode` the BFF reads off a gateway error. */
class GamePortPilotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GamePortPilotError";
    this.code = code;
    this.statusCode = STATUS[code] || 502;
  }
}

const fail = (code, message) => new GamePortPilotError(code, message);

const SESSION_GONE = "Unknown, expired, or released bridge session.";
/** The gateway's event-stream envelope. The browser checks `source`, so it is the contract, not a label. */
const STREAM_SOURCE = "evejs-web-gateway";
const STREAM_HISTORY_LIMIT = 256;
/** A backlog nobody drains must not grow for ever; the stream and the next read still tell the story. */
const BACKLOG_LIMIT = 4096;
/** The gateway drops these on purpose: nothing above reads them, and they arrive ten times a second. */
const SUPPRESSED_NOTIFICATIONS = new Set(["DoDestinyUpdate"]);
/** appConst.charLockInTransferQueue, charLockOnSale: what characterSelection.py refuses with. */
const LOCK_REFUSALS = new Map([[1, "CharacterTransferring"], [2, "CharacterOnSale"]]);
const GROUP_CAPSULE = 29;
/** inventorycommon/const.py */
const GROUP_SOLAR_SYSTEM = 5;
const GROUP_STATION = 15;
const CONTAINER_HANGAR = 10004;
const CONTAINER_STRUCTURE = 10014;
/**
 * Services whose object is bound for where the pilot is. The retail client's
 * moniker for one carries a session check, and is bound afresh when the pilot
 * moves; here the handle is dropped, and the BFF binds again.
 */
const LOCATION_SERVICES = new Set(["invbroker", "ship", "dogmaIM", "crimewatch", "reprocessingSvc", "entity", "beyonce", "scanMgr"]);
const LOCATION_ATTRIBUTES = ["stationid", "structureid", "solarsystemid", "locationid"];

/** A positive whole number, however the wire or the JSON spelled it; else null. */
const positive = (value) => {
  const number = typeof value === "number" || typeof value === "bigint" ? Number(value) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

/** JSON arguments as the BFF sends them, into what the client's marshaller takes. */
function argumentsToWire(value) {
  if (Array.isArray(value)) return value.map(argumentsToWire);
  if (value === null || typeof value !== "object") return value;
  switch (value.type) {
    case "Buffer":
      return Buffer.from(Array.isArray(value.data) ? value.data : []);
    case "bytes":
      return argumentsToWire(value.value);
    case "tuple":
    case "list":
      return { ...value, items: (value.items ?? []).map(argumentsToWire) };
    case "dict":
      return { ...value, entries: (value.entries ?? []).map(([key, entry]) => [argumentsToWire(key), argumentsToWire(entry)]) };
    case "object":
      return { ...value, args: argumentsToWire(value.args) };
    default:
      return value;
  }
}

/**
 * The "N=node:id" of the first bound object in an answer, or null. A bound
 * object arrives as a substruct holding a substream of (id, timestamp), alone
 * or inside the (object, result) pair a bind answers with.
 */
function boundObjectID(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object" || Buffer.isBuffer(value)) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = boundObjectID(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value.type === "substruct" && value.value) {
    const pair = value.value.type === "substream" ? value.value.value : value.value;
    const id = Array.isArray(pair) ? pair[0] : null;
    const name = Buffer.isBuffer(id) ? id.toString("utf8") : typeof id === "string" ? id : "";
    if (name.startsWith("N=")) return name;
  }
  for (const inner of [value.value, value.items, value.args]) {
    const found = boundObjectID(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

/** One field of a util.KeyVal, in bridge JSON. */
function keyValField(row, name) {
  const entries = row && row.type === "object" && row.args && Array.isArray(row.args.entries) ? row.args.entries : [];
  const entry = entries.find((candidate) => Array.isArray(candidate) && candidate[0] === name);
  return entry ? entry[1] : undefined;
}

/** A character's row in GetCharacterSelectionData's answer (userDetails, training, characters, wars), or null. */
function selectionRow(selection, characterID) {
  const characters = Array.isArray(selection) ? selection[2] : null;
  const rows = characters && characters.type === "list" && Array.isArray(characters.items) ? characters.items : [];
  return rows.find((row) => positive(keyValField(row, "characterID")) === characterID) ?? null;
}

/**
 * The game-port transport.
 *
 *   connect()           -> a frame transport to the game server
 *   createSession(t)    -> a GamePortSession on it
 *   passwordFor(name)   -> the password to log in with (a development server takes any)
 *   isOnline(accountID, characterID) -> whether the server still has the character
 *                          in game; asked after a release so "released" means it
 *   allowed             -> the "service.method" pairs a pilot may call
 *   shape(service, method, args, kwargs) -> the call as the retail client sends it (retailCalls.js)
 */
function createGamePortPilots({
  endpoint = gameEndpoint(),
  connect = () => connectTcp(endpoint),
  createSession = (transport) => new GamePortSession({ transport }),
  passwordFor = () => "",
  isOnline = null,
  allowed = new Set(contract.gatewayAllowlist.pairs),
  shape = retailForm,
  selectSettleMs = 5000,
  releaseSettleMs = 5000,
  randomBytes = crypto.randomBytes,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const sessions = new Map();
  const epoch = randomBytes(12).toString("base64url");
  /** Every call made, by pair and by how it compares with the retail client's (retailCalls.js). */
  const ledger = createCallLedger();
  const BOUND_AS_THE_CLIENT_BINDS = Object.freeze({ status: "reshaped", source: "eve/common/script/net/eveMoniker.py, eve/client/script/environment/invCache.py", note: null });

  // ── errors ────────────────────────────────────────────────────────────────

  /** A failure of the session, in the gateway's terms. */
  function toPilotError(error, service, method) {
    if (error instanceof GamePortPilotError) return error;
    const code = error && error.code;
    const detail = String((error && error.message) || error).slice(0, 300);
    if (code === "GAME_CALL_REFUSED" && error.refusal && error.refusal.reason) {
      return fail("CALL_REFUSED", String(error.refusal.reason));
    }
    if (["CONNECTION_LOST", "CONNECTION_CLOSED", "TRANSPORT_CLOSED", "NOT_CONNECTED", "BAD_FRAME"].includes(code)) {
      return fail("SESSION_NOT_FOUND", SESSION_GONE);
    }
    if (code === "CALL_TIMEOUT" || code === "HANDSHAKE_TIMEOUT") {
      return fail("EVE_GATEWAY_TIMEOUT", "The game server did not answer in time.");
    }
    if (/^Cannot marshal/.test(detail)) {
      return fail("CALL_INVALID", `${service}.${method} was given an argument that cannot be sent: ${detail}`);
    }
    return fail("CALL_FAILED", `${service}.${method} failed: ${detail}`);
  }

  function assertAllowed(service, method) {
    if (!allowed.has(`${service}.${method}`)) {
      throw fail("CALL_NOT_ALLOWED", `${service}.${method} is not on the web-call allowlist.`);
    }
  }

  // ── what the server pushes ────────────────────────────────────────────────

  function record(entry, notification) {
    if (SUPPRESSED_NOTIFICATIONS.has(notification.method)) return;
    entry.backlog.push(notification);
    if (entry.backlog.length > BACKLOG_LIMIT) entry.backlog.splice(0, entry.backlog.length - BACKLOG_LIMIT);
    entry.sequence += 1;
    const frame = Object.freeze({
      source: STREAM_SOURCE,
      apiVersion: 1,
      streamVersion: 1,
      type: "event",
      cursor: Object.freeze({ epoch, sequence: entry.sequence }),
      event: { kind: "notification", notification },
    });
    entry.history.push(frame);
    if (entry.history.length > STREAM_HISTORY_LIMIT) entry.history.shift();
    for (const subscriber of [...entry.subscribers]) deliver(subscriber, frame);
  }

  function deliver(subscriber, frame) {
    if (subscriber.closed) return;
    try {
      subscriber.onFrame(frame);
    } catch {
      // A listener's failure is its own; the session and the other listeners carry on.
    }
  }

  const drain = (entry) => entry.backlog.splice(0);

  // ── sessions ──────────────────────────────────────────────────────────────

  /** The live session a handle names, or SESSION_NOT_FOUND. */
  function held(handle, sessionFields) {
    const entry = sessions.get(String(handle || ""));
    const asked = sessionFields && sessionFields.userid !== undefined ? Number(sessionFields.userid) : undefined;
    if (!entry || entry.ended || (asked !== undefined && asked !== entry.accountID)) {
      throw fail("SESSION_NOT_FOUND", SESSION_GONE);
    }
    return entry;
  }

  /** The session is over: forget it, close it, and tell whoever is listening. */
  function end(entry, reason, refusalStatus = 404) {
    if (entry.ended) return;
    entry.ended = true;
    sessions.delete(entry.handle);
    entry.session.close();
    for (const subscriber of [...entry.subscribers]) {
      entry.subscribers.delete(subscriber);
      if (subscriber.closed) continue;
      subscriber.closed = true;
      try {
        subscriber.onClose({ code: 0, reason, refusalStatus });
      } catch {
        // As above.
      }
    }
  }

  /** Run one request on a session, with its failures in the gateway's terms. */
  async function run(entry, service, method, request) {
    try {
      return await request();
    } catch (error) {
      const mapped = toPilotError(error, service, method);
      if (mapped.code === "SESSION_NOT_FOUND") end(entry, "connection_closed");
      throw mapped;
    }
  }

  const attribute = (entry, name) => positive(entry.session.attributes[name]);

  // ── the nine ──────────────────────────────────────────────────────────────

  async function selectCharacter(args = [], kwargs = null, sessionFields = {}) {
    const accountID = positive(sessionFields && sessionFields.userid);
    const userName = String((sessionFields && sessionFields.userName) || "").trim();
    const characterID = positive(Array.isArray(args) ? args[0] : null);
    if (accountID === null) throw fail("CALL_INVALID", "Call session requires a positive integer userid.");
    if (!userName) throw fail("CALL_INVALID", "A game-port login needs the account's name.");
    if (characterID === null) throw fail("CALL_INVALID", "SelectCharacterID needs a character.");

    let transport;
    try {
      transport = await connect();
    } catch {
      throw fail("EVE_GATEWAY_UNREACHABLE", "The game server is unreachable.");
    }
    const session = createSession(transport);
    const entry = {
      handle: `${GAME_PORT_HANDLE_PREFIX}${randomBytes(24).toString("base64url")}`,
      session,
      accountID,
      userName,
      characterID,
      backlog: [],
      sequence: 0,
      history: [],
      subscribers: new Set(),
      ship: null,
      /** boundHandle -> { objectID, service }: what the BFF holds, and what it names here. */
      bound: new Map(),
      /** The two inventory managers invCache keeps, by which: the "N=..." of each. */
      inventoryManagers: new Map(),
      ended: false,
    };
    session.onNotification((notification) => record(entry, notificationToBridgeJson(notification)));
    session.onSessionChange((changes) => {
      if (LOCATION_ATTRIBUTES.some((name) => name in changes)) forgetLocationObjects(entry);
      record(entry, sessionChangeToBridgeJson(changes));
    });

    let result;
    let row;
    try {
      await session.login(userName, passwordFor(userName));
      if (positive(session.attributes.userid) !== accountID) {
        throw fail("SESSION_SELECT_FAILED", "The game server logged that name in as a different account.");
      }
      // The character selection screen, as the retail client fills and leaves it.
      for (const method of ["GetCharacterSelectionData", "GetCharacterLockType", "SelectCharacterID"]) {
        ledger.note("charUnboundMgr", method, shape("charUnboundMgr", method, [], null));
      }
      row = selectionRow(wireToBridgeJson(await session.call("charUnboundMgr", "GetCharacterSelectionData", [])), characterID);
      if (!row) throw fail("CALL_REFUSED", "That character is not on this account.");
      if (!positive(keyValField(row, "stationID")) && !positive(keyValField(row, "structureID"))) {
        throw fail(
          "PILOT_TRANSPORT_UNAVAILABLE",
          "This pilot is in space, and a pilot on the game-port transport cannot fly yet. Select it on the gateway transport.",
        );
      }
      const lockType = await session.call("charUnboundMgr", "GetCharacterLockType", [characterID]);
      if (lockType !== null && lockType !== undefined) {
        throw fail("CALL_REFUSED", LOCK_REFUSALS.get(Number(lockType)) ?? "CharacterLocked");
      }
      // The gateway's session begins at this call, so what the server pushed
      // while logging in (the account's own session change) is not part of it.
      entry.backlog.length = 0;
      entry.history.length = 0;
      entry.sequence = 0;
      result = await session.call("charUnboundMgr", "SelectCharacterID", argumentsToWire(args), kwargs);
      // The session change that puts the character on the session arrives
      // before the answer. Give a slow server a moment, then take it at its word.
      for (let waited = 0; positive(session.attributes.charid) !== characterID && waited < selectSettleMs; waited += 50) {
        await sleep(50);
      }
      if (positive(session.attributes.charid) !== characterID) {
        throw fail("SESSION_SELECT_FAILED", "charUnboundMgr.SelectCharacterID completed without bringing a character online.");
      }
    } catch (error) {
      session.close();
      // The login failing is not the select call failing; say what the session said.
      if (/^(LOGIN_REFUSED|LOGON_QUEUE|BAD_SERVER_SIGNATURE|INCOMPATIBLE_PROTOCOL|HANDSHAKE_INCOMPATIBLE)/.test(String(error && error.code))) {
        throw fail("SESSION_SELECT_FAILED", String(error.message));
      }
      const mapped = toPilotError(error, "charUnboundMgr", "SelectCharacterID");
      // No session was ever handed out, so there is none to have lost.
      throw mapped.code === "SESSION_NOT_FOUND"
        ? fail("SESSION_SELECT_FAILED", "The game server closed the connection during character selection.")
        : mapped;
    }

    sessions.set(entry.handle, entry);
    session.onClose(() => end(entry, "connection_closed"));
    return {
      bridgeSessionID: entry.handle,
      service: "charUnboundMgr",
      method: "SelectCharacterID",
      result: wireToBridgeJson(result === undefined ? null : result),
      notifications: drain(entry),
      session: {
        userid: accountID,
        characterID,
        characterName: String(keyValField(row, "characterName") || ""),
        stationID: attribute(entry, "stationid"),
        structureID: attribute(entry, "structureid"),
        solarSystemID: attribute(entry, "solarsystemid2") ?? attribute(entry, "solarsystemid"),
        corporationID: attribute(entry, "corpid"),
        shipID: attribute(entry, "shipid"),
      },
    };
  }

  async function callMethod(service, method, args = [], kwargs = null, sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    assertAllowed(service, method);
    const form = shape(service, method, args, kwargs);
    ledger.note(service, method, form);
    const result = await run(entry, service, method, async () =>
      entry.session.call(service, method, argumentsToWire(form.args), form.kwargs));
    return {
      service,
      method,
      result: wireToBridgeJson(result === undefined ? null : result),
      notifications: drain(entry),
    };
  }

  async function releaseBridgeSession(bridgeSessionID, sessionFields = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    end(entry, "session_released");
    // Closing the connection is the whole of a retail logoff, and the server
    // acts on it a moment later. "Released" is only said once it has.
    if (typeof isOnline === "function") {
      for (let waited = 0; waited < releaseSettleMs; waited += 100) {
        if ((await isOnline(entry.accountID, entry.characterID)) === false) {
          return { released: true, characterID: entry.characterID };
        }
        await sleep(100);
      }
      return { released: false, characterID: entry.characterID };
    }
    return { released: true, characterID: entry.characterID };
  }

  /** The active ship's type and whether it is a capsule, from the server's own row for it. */
  async function shipFacts(entry, shipID) {
    if (entry.ship && entry.ship.shipID === shipID) return entry.ship;
    let typeID = null;
    let groupID = null;
    try {
      const info = wireToBridgeJson(await entry.session.call("dogmaIM", "ShipGetInfo", []));
      const pair = info && Array.isArray(info.entries) ? info.entries.find(([key]) => positive(key) === shipID) : null;
      const item = pair ? keyValField(pair[1], "invItem") : null;
      const fields = item && item.fields ? item.fields : {};
      typeID = positive(fields.typeID);
      groupID = positive(fields.groupID);
    } catch (error) {
      const mapped = toPilotError(error, "dogmaIM", "ShipGetInfo");
      if (mapped.code === "SESSION_NOT_FOUND") {
        end(entry, "connection_closed");
        throw mapped;
      }
      // Location is still worth reporting. An unknown type says so; it is never guessed.
    }
    const facts = { shipID, typeID, isCapsule: typeID === null || groupID === null ? null : groupID === GROUP_CAPSULE };
    if (typeID !== null) entry.ship = facts;
    return facts;
  }

  /** Where the session says the pilot is. In space is `solarsystemid` set, as on any retail session. */
  function whereabouts(entry) {
    const stationID = attribute(entry, "stationid");
    const structureID = attribute(entry, "structureid");
    const inSpace = !stationID && !structureID && attribute(entry, "solarsystemid") !== null;
    return {
      inSpace,
      stationID,
      structureID,
      solarSystemID: attribute(entry, "solarsystemid2") ?? attribute(entry, "solarsystemid"),
      shipID: attribute(entry, "shipid"),
    };
  }

  function assertNotFlying(place, what) {
    if (place.inSpace) {
      throw fail("PILOT_TRANSPORT_UNAVAILABLE", `${what} needs a ballpark, which a pilot on the game-port transport does not have yet.`);
    }
  }

  async function readFlightStatus(bridgeSessionID, sessionFields = {}) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    const ship = place.shipID ? await shipFacts(entry, place.shipID) : null;
    return {
      flight: {
        inSpace: place.inSpace,
        docked: !place.inSpace && Boolean(place.stationID || place.structureID),
        solarSystemID: place.solarSystemID,
        stationID: place.stationID,
        structureID: place.structureID,
        shipID: place.shipID,
        shipTypeID: ship ? ship.typeID : null,
        shipIsCapsule: ship ? ship.isCapsule : null,
        // Movement comes from the ballpark, which this transport does not have yet.
        shipMode: null,
        shipSpeedFraction: null,
      },
      notifications: drain(entry),
    };
  }

  async function readSpaceSnapshot(bridgeSessionID, sessionFields = {}) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    assertNotFlying(place, "The space snapshot");
    return {
      space: { inSpace: false, solarSystemID: place.solarSystemID, shipID: place.shipID, sampledAtMs: now(), entities: [], ship: null },
      notifications: drain(entry),
    };
  }

  async function readScannerState(bridgeSessionID, sessionFields = {}) {
    const entry = held(bridgeSessionID, sessionFields);
    const place = whereabouts(entry);
    assertNotFlying(place, "The scanner");
    return {
      scanner: { inSpace: false, solarSystemID: place.solarSystemID, shipID: place.shipID, maxActiveProbes: 0, launcher: null, probes: [] },
      notifications: drain(entry),
    };
  }

  // ── bound objects ─────────────────────────────────────────────────────────

  /** The pilot moved: what was bound for the old place is the old place's. */
  function forgetLocationObjects(entry) {
    entry.inventoryManagers.clear();
    for (const [handle, object] of entry.bound) {
      if (LOCATION_SERVICES.has(object.service)) entry.bound.delete(handle);
    }
  }

  /** eveMoniker.GetLocationBindParams: the solar system when the session has one, else the station. */
  function locationBindParams(entry) {
    const solarSystemID = attribute(entry, "solarsystemid");
    if (solarSystemID !== null) return [solarSystemID, GROUP_SOLAR_SYSTEM];
    const stationID = attribute(entry, "stationid");
    if (stationID !== null) return [stationID, GROUP_STATION];
    throw fail("CALL_FAILED", "You have no place to go");
  }

  /**
   * What a service's Moniker is made with (eveMoniker.py), or undefined where the
   * retail client makes none. `given` is what the BFF passed, for the ones that take it.
   */
  function monikerParams(entry, service, given) {
    switch (service) {
      case "ship": // GetShipAccess
      case "invbroker": // GetInventoryMgr
      case "dogmaIM": // CharGetDogmaLocation
      case "crimewatch": // CharGetCrimewatchLocation
        return locationBindParams(entry);
      case "entity": // GetEntityAccess: only with session.solarsystemid
        return attribute(entry, "solarsystemid") === null ? undefined : attribute(entry, "solarsystemid2");
      case "beyonce": // GetBallPark
        return attribute(entry, "solarsystemid") ?? undefined;
      case "reprocessingSvc": // GetReprocessingManager
        return attribute(entry, "structureid") ?? attribute(entry, "stationid") ?? undefined;
      case "fleetObjectHandler": // GetFleet: Moniker(fleetID or session.fleetid), which is None outside a fleet
        return positive(Array.isArray(given) ? given[0] : given) ?? attribute(entry, "fleetid");
      default: // agentMgr (agentID), planetMgr (planetID), charMgr ((charid, containerGlobal)): as given
        return argumentsToWire(given === undefined ? null : given);
    }
  }

  /** invCache's `inventorymgr` (where the pilot is) or `stationInventoryMgr` (its station), bound on first use. */
  async function inventoryManager(entry, which) {
    if (!entry.inventoryManagers.has(which)) {
      const stationID = attribute(entry, "stationid");
      if (which === "station" && stationID === null) throw fail("CALL_FAILED", "CharacterNotAtStation");
      const params = which === "station" ? [stationID, GROUP_STATION] : locationBindParams(entry);
      entry.inventoryManagers.set(which, (await entry.session.bind("invbroker", params)).objectID);
    }
    return entry.inventoryManagers.get(which);
  }

  /**
   * Make the bind the BFF asked the gateway for, as the retail client makes
   * it. Answers the bound object's "N=...", or null when the server handed
   * none back.
   */
  async function bindRetail(entry, service, method, args, kwargs) {
    const { session } = entry;
    if (method === "MachoBindObject") {
      const params = monikerParams(entry, service, args[0]);
      if (params === undefined) return null;
      return (await session.bind(service, params)).objectID;
    }
    if (service === "invbroker" && method === "GetInventory") {
      // invCache.GetInventory(const.containerHangar): the station's hangar from
      // the station's manager, or the structure's from the location's.
      const asked = positive(args[0]);
      const structureID = attribute(entry, "structureid");
      if (asked !== (structureID ?? attribute(entry, "stationid"))) {
        throw fail("CALL_REFUSED", "The pilot is not docked there.");
      }
      const manager = await inventoryManager(entry, structureID === null ? "station" : "location");
      return boundObjectID(await session.callBound(manager, "GetInventory", [structureID === null ? CONTAINER_HANGAR : CONTAINER_STRUCTURE, null]));
    }
    if (service === "invbroker" && method === "GetInventoryFromId") {
      // invCache.GetInventoryFromId(itemid, passive=0): both positional.
      const passive = kwargs && kwargs.passive !== undefined ? kwargs.passive : args[1] ?? 0;
      return boundObjectID(await session.callBound(await inventoryManager(entry, "location"), "GetInventoryFromId", [argumentsToWire(args[0]), passive]));
    }
    // A service's own method that answers with a bound object:
    // sm.RemoteSvc('scanMgr').GetSystemScanMgr(), sm.RemoteSvc('fleetObjectHandler').CreateFleet().
    return boundObjectID(await session.call(service, method, argumentsToWire(args), kwargs ?? null));
  }

  async function bindObject(service, method, args = [], kwargs = null, sessionFields = {}, bridgeSessionID = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    assertAllowed(service, method);
    ledger.note(service, method, BOUND_AS_THE_CLIENT_BINDS);
    let objectID;
    try {
      objectID = await run(entry, service, method, async () => bindRetail(entry, service, method, Array.isArray(args) ? args : [], kwargs));
    } catch (error) {
      // The session's own word for a bind the server answered without an object.
      if (error.code === "CALL_FAILED" && / did not return a bound object\.| could not say where its object lives\./.test(error.message)) objectID = null;
      else throw error;
    }
    if (!objectID) throw fail("BOUND_NO_OBJECT", `${service}.${method} did not return a bound object.`);
    const boundHandle = randomBytes(24).toString("base64url");
    entry.bound.set(boundHandle, { objectID, service });
    return { boundHandle, service, method, notifications: drain(entry) };
  }

  async function callBoundMethod(service, method, args = [], kwargs = null, sessionFields = {}, bridgeSessionID = undefined, boundHandle = undefined) {
    const entry = held(bridgeSessionID, sessionFields);
    const object = entry.bound.get(String(boundHandle || ""));
    if (!object) throw fail("BOUND_HANDLE_NOT_FOUND", "Unknown bound-object handle for this session.");
    if (object.service !== service) throw fail("BOUND_HANDLE_NOT_FOUND", "Bound-object handle does not belong to the requested service.");
    assertAllowed(service, method);
    if (service === "ship" && method === "Undock") {
      throw fail("PILOT_TRANSPORT_UNAVAILABLE", "Undocking needs a ballpark, which a pilot on the game-port transport does not have yet.");
    }
    const form = shape(service, method, args, kwargs);
    ledger.note(service, method, form);
    const result = await run(entry, service, method, async () =>
      entry.session.callBound(object.objectID, method, argumentsToWire(form.args), form.kwargs));
    return {
      service,
      method,
      result: wireToBridgeJson(result === undefined ? null : result),
      notifications: drain(entry),
    };
  }

  /**
   * The session's notifications as they arrive, in the gateway's frames. A
   * cursor from this process that is still in the history is replayed from;
   * any other gets a snapshot frame, which tells the reader to re-read.
   */
  function openSessionEventStream({ bridgeSessionID, userid, cursor = null, onFrame, onOpen, onClose } = {}) {
    const subscriber = {
      onFrame: typeof onFrame === "function" ? onFrame : () => {},
      onClose: typeof onClose === "function" ? onClose : () => {},
      closed: false,
    };
    let entry;
    try {
      entry = held(bridgeSessionID, userid === undefined ? undefined : { userid });
    } catch {
      // Deferred, as the gateway client's is: the caller must be holding the
      // handle this returns by the time its close handler runs.
      queueMicrotask(() => {
        if (subscriber.closed) return;
        subscriber.closed = true;
        subscriber.onClose({ code: 0, reason: "session not found", refusalStatus: 404 });
      });
      return { close() { subscriber.closed = true; } };
    }
    const sequence = cursor && cursor.epoch === epoch ? Number(cursor.sequence) : NaN;
    const oldest = entry.history.length > 0 ? entry.history[0].cursor.sequence : entry.sequence + 1;
    const replayable = Number.isSafeInteger(sequence) && sequence >= 0 && sequence <= entry.sequence && sequence >= oldest - 1;
    const first = replayable
      ? entry.history.filter((frame) => frame.cursor.sequence > sequence)
      : [Object.freeze({
          source: STREAM_SOURCE,
          apiVersion: 1,
          streamVersion: 1,
          type: "snapshot",
          cursor: Object.freeze({ epoch, sequence: entry.sequence }),
          reason: cursor ? "cursor_not_replayable" : "no_cursor",
        })];
    // Subscribed before the first frames go out, so nothing published while
    // they are being read is lost; they go out on the next tick, behind onOpen.
    const pending = [...first];
    const live = subscriber.onFrame;
    subscriber.onFrame = (frame) => pending.push(frame);
    entry.subscribers.add(subscriber);
    queueMicrotask(() => {
      if (subscriber.closed) return;
      if (typeof onOpen === "function") {
        try {
          onOpen();
        } catch {
          // The stream is open whether or not the listener liked hearing so.
        }
      }
      subscriber.onFrame = live;
      for (const frame of pending.splice(0)) deliver(subscriber, frame);
    });
    return {
      close() {
        subscriber.closed = true;
        entry.subscribers.delete(subscriber);
      },
    };
  }

  /** Close every session: the BFF is stopping, and each pilot logs off as a closed client's would. */
  function shutdown() {
    for (const entry of [...sessions.values()]) end(entry, "transport_shutdown");
  }

  return {
    selectCharacter,
    callMethod,
    bindObject,
    callBoundMethod,
    releaseBridgeSession,
    readFlightStatus,
    readScannerState,
    readSpaceSnapshot,
    openSessionEventStream,
    shutdown,
    /** Every pair called since this transport was made, most called first, with how each compares with the retail client's. */
    callLedger: () => ledger.rows(),
    /** How many pilots are on the game port now. */
    get size() {
      return sessions.size;
    },
  };
}

module.exports = { GamePortPilotError, argumentsToWire, boundObjectID, createGamePortPilots };
