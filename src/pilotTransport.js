"use strict";

// One pilot, one transport: the seam the game port goes in behind.
//
// Everything the BFF does for a selected pilot it does through nine functions
// of the gateway client, each of which names the pilot's session by an opaque
// handle (`bridgeSessionID`). This module stands where that client stood and
// sends each of those nine to whichever transport holds the handle:
//
//   the web gateway   HTTP to eve.js on :26002 (src/eveGatewayClient.js)
//   the game port     the retail protocol on :26000 (src/gamePort/)
//
// The choice is made once, when a character is selected, and the handle that
// comes back says which it was. Nothing above this module knows or asks: the
// 360-odd call sites in src/server.js, the hosted bots and the tests all keep
// calling `gateway.callMethod(...)` exactly as before.
//
// Everything that is not about a selected pilot (accounts, the character list,
// offline skill queues, health) goes to the web gateway, always. The retail
// protocol only ever sees the character that is logged in.
//
// One thing lies between: what the retail client asks BEFORE a character is
// chosen. On its character selection and creation screens it is logged in as
// the account, and asks `charUnboundMgr`. That is `accountCall` here, a tenth
// function this seam adds: for an account on the game port it is made there,
// logged in as the client logs in, and for any other it is the gateway's
// `callMethod` on a session that names the account and nothing else, exactly
// as before. For an account on the game port nothing else is an account's
// call: the retail client has no pilot's call to make before a pilot is chosen,
// so the seam refuses it rather than have the gateway make it as nobody.
//
// What the BFF itself asks the gateway as a pilot who is not logged in (an
// offline pilot's structure access, a training pilot's corporation) does not
// come through `accountCall`: those are the gateway's own `callMethod`, with
// no session handle, and stay the gateway's (the plan's section 2.3).
//
// The plan is docs/game-port-transport-plan.md, Phase 3.

/** What marks a handle as a game-port session. A gateway handle is base64url and has no colon. */
const GAME_PORT_HANDLE_PREFIX = "gp:";

/**
 * The nine pilot-level functions, and where each one's session handle is in
 * its arguments. This list IS the pilot interface: a transport is something
 * that implements these nine with the gateway client's own signatures and
 * answers.
 *
 *   selectCharacter(args, kwargs, sessionFields)
 *       -> { bridgeSessionID, service, method, result, notifications, session }
 *   callMethod(service, method, args, kwargs, sessionFields, bridgeSessionID)
 *       -> { service, method, result, notifications }
 *   bindObject(service, method, args, kwargs, sessionFields, bridgeSessionID)
 *       -> { boundHandle, service, method, notifications }
 *   callBoundMethod(service, method, args, kwargs, sessionFields, bridgeSessionID, boundHandle)
 *       -> { service, method, result, notifications }
 *   releaseBridgeSession(bridgeSessionID, sessionFields) -> { released, characterID }
 *   readFlightStatus(bridgeSessionID, sessionFields)     -> { flight, notifications }
 *   readScannerState(bridgeSessionID, sessionFields)     -> { scanner, notifications }
 *   readSpaceSnapshot(bridgeSessionID, sessionFields)    -> { space, notifications }
 *   openSessionEventStream({ bridgeSessionID, userid, cursor, onFrame, onOpen, onClose })
 *       -> { close() }
 */
const PILOT_FUNCTIONS = Object.freeze({
  selectCharacter: null, // chosen by the setting, not by a handle
  callMethod: (args) => args[5],
  bindObject: (args) => args[5],
  callBoundMethod: (args) => args[5],
  releaseBridgeSession: (args) => args[0],
  readFlightStatus: (args) => args[0],
  readScannerState: (args) => args[0],
  readSpaceSnapshot: (args) => args[0],
  openSessionEventStream: (args) => args[0] && args[0].bridgeSessionID,
});

const TRANSPORTS = new Set(["gateway", "gameport"]);

/** The service the retail client asks before a character is chosen (charUnboundMgr: "unbound" is "no character yet"). */
const ACCOUNT_SERVICES = new Set(["charUnboundMgr"]);

/**
 * A call the seam will not make. The code and the status are the web gateway's
 * own for a call it refuses, so the page reads the two refusals the same way.
 */
function notAllowed(message) {
  const error = new Error(message);
  error.name = "PilotTransportError";
  error.code = "CALL_NOT_ALLOWED";
  error.statusCode = 403;
  return error;
}

function isGamePortHandle(handle) {
  return typeof handle === "string" && handle.startsWith(GAME_PORT_HANDLE_PREFIX);
}

/**
 * Which transport an account's pilots use, from the environment:
 *
 *   EVEJS_PILOT_TRANSPORT            gameport (the default) or gateway
 *   EVEJS_PILOT_TRANSPORT_OVERRIDES  name=transport, comma separated, for
 *                                    single accounts: "test=gameport,rrfarmer=gateway"
 *
 * An account is named as it logs in. A value that is not a transport is an
 * error at start-up rather than a silent fall back to the other one. Unset or
 * empty (a compose file passes an unset one on as empty) is the default.
 *
 * The default was the gateway until the plan's cutover (Phase 5, 2026-10-10).
 * `gateway` stays selectable as the way back.
 */
const DEFAULT_TRANSPORT = "gameport";
function pilotTransportSetting(env = process.env) {
  const read = (value, where) => {
    const transport = String(value || "").trim().toLowerCase();
    if (!TRANSPORTS.has(transport)) {
      throw new Error(`${where} must be "gateway" or "gameport", not "${value}".`);
    }
    return transport;
  };
  const fallback = env.EVEJS_PILOT_TRANSPORT ? read(env.EVEJS_PILOT_TRANSPORT, "EVEJS_PILOT_TRANSPORT") : DEFAULT_TRANSPORT;
  const overrides = new Map();
  for (const part of String(env.EVEJS_PILOT_TRANSPORT_OVERRIDES || "").split(",")) {
    if (!part.trim()) continue;
    const [name, value, ...rest] = part.split("=");
    if (!name.trim() || value === undefined || rest.length > 0) {
      throw new Error(`EVEJS_PILOT_TRANSPORT_OVERRIDES entry "${part.trim()}" is not name=transport.`);
    }
    overrides.set(name.trim().toLowerCase(), read(value, `EVEJS_PILOT_TRANSPORT_OVERRIDES for "${name.trim()}"`));
  }
  return {
    fallback,
    overrides,
    /** The transport for the account with this login name. */
    transportFor({ userName } = {}) {
      return overrides.get(String(userName || "").trim().toLowerCase()) ?? fallback;
    },
  };
}

/**
 * The gateway client's shape, with the pilot's nine functions sent to the
 * transport that holds the session.
 *
 * `gamePort` is the game-port transport, or null when this process has none.
 * With none, what comes back behaves exactly as `gateway` does: the same
 * functions, present or absent, with nothing in between.
 *
 * `transportFor({ accountID, characterID, userName })` answers "gateway" or
 * "gameport" for a character about to be selected.
 */
function createPilotTransport({ gateway, gamePort = null, transportFor = () => "gateway" }) {
  if (!gamePort) {
    return gateway;
  }
  const routed = new Map();
  const route = (name, pick) => {
    const viaGateway = gateway[name];
    const viaGamePort = gamePort[name];
    if (typeof viaGateway !== "function" && typeof viaGamePort !== "function") {
      return undefined;
    }
    return (...args) => {
      const onGamePort = pick === null
        ? transportFor({
            accountID: Number(args[2] && args[2].userid) || null,
            characterID: Number(args[0] && args[0][0]) || null,
            userName: String((args[2] && args[2].userName) || ""),
          }) === "gameport"
        : isGamePortHandle(pick(args));
      const [target, fn] = onGamePort ? [gamePort, viaGamePort] : [gateway, viaGateway];
      if (typeof fn !== "function") {
        throw Object.assign(new Error(`${name} is not available on the ${onGamePort ? "game port" : "gateway"}.`), {
          code: "PILOT_TRANSPORT_UNAVAILABLE",
          statusCode: 501,
        });
      }
      return fn.apply(target, args);
    };
  };
  /**
   * accountCall(service, method, args, kwargs, { accountID, userName, fields })
   *     -> { service, method, result, notifications }
   *
   * A call of the account's own, with no character chosen. The account's login
   * name says which transport the account is on; the gateway is never told it.
   * `fields` is what else the gateway's session is told (how the browser wants
   * things shown), and is the gateway's alone.
   *
   * For an account on the game port only the selection screen's services are
   * asked (ACCOUNT_SERVICES), there. Anything else is refused here: before the
   * cutover it went to the gateway, which made the call as a session naming the
   * account and no character. A game port that cannot make an account's call at
   * all leaves the account to the gateway, as an account on the gateway is.
   */
  const accountCall = (service, method, args, kwargs, account = {}) => {
    const accountID = Number(account && account.accountID) || null;
    const userName = String((account && account.userName) || "");
    const onGamePort = typeof gamePort.accountCall === "function" &&
      transportFor({ accountID, characterID: null, userName }) === "gameport";
    const shown = account && account.fields && typeof account.fields === "object" ? account.fields : {};
    if (!onGamePort) {
      return gateway.callMethod(service, method, args, kwargs, { ...shown, userid: accountID });
    }
    if (!ACCOUNT_SERVICES.has(service)) {
      return Promise.reject(notAllowed(`${service}.${method} needs a pilot: with none chosen, an account asks only what the selection screen asks.`));
    }
    return gamePort.accountCall(service, method, args, kwargs, { userid: accountID, userName });
  };
  /**
   * getSelectTransport({ accountID, characterID, userName }) -> "gateway" | "gameport"
   *
   * Which transport this pilot would be chosen on. Asked by what must act
   * differently before a pilot is chosen at all. Named as a read, which it is.
   */
  const getSelectTransport = (who = {}) => transportFor({
    accountID: Number(who.accountID) || null,
    characterID: Number(who.characterID) || null,
    userName: String(who.userName || ""),
  });
  return new Proxy(gateway, {
    get(target, name) {
      if (name === "accountCall") {
        return accountCall;
      }
      if (name === "getSelectTransport") {
        return getSelectTransport;
      }
      if (!Object.hasOwn(PILOT_FUNCTIONS, name)) {
        return target[name];
      }
      if (!routed.has(name)) {
        routed.set(name, route(name, PILOT_FUNCTIONS[name]));
      }
      return routed.get(name);
    },
    has(target, name) {
      if (name === "accountCall" || name === "getSelectTransport") return true;
      return Object.hasOwn(PILOT_FUNCTIONS, name)
        ? typeof target[name] === "function" || typeof gamePort[name] === "function"
        : name in target;
    },
  });
}

module.exports = {
  ACCOUNT_SERVICES,
  GAME_PORT_HANDLE_PREFIX,
  PILOT_FUNCTIONS,
  createPilotTransport,
  isGamePortHandle,
  pilotTransportSetting,
};
