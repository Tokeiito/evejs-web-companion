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

function isGamePortHandle(handle) {
  return typeof handle === "string" && handle.startsWith(GAME_PORT_HANDLE_PREFIX);
}

/**
 * Which transport an account's pilots use, from the environment:
 *
 *   EVEJS_PILOT_TRANSPORT            gateway (the default) or gameport
 *   EVEJS_PILOT_TRANSPORT_OVERRIDES  name=transport, comma separated, for
 *                                    single accounts: "test=gameport,rrfarmer=gateway"
 *
 * An account is named as it logs in. A value that is not a transport is an
 * error at start-up rather than a silent fall back to the other one.
 */
function pilotTransportSetting(env = process.env) {
  const read = (value, where) => {
    const transport = String(value || "").trim().toLowerCase();
    if (!TRANSPORTS.has(transport)) {
      throw new Error(`${where} must be "gateway" or "gameport", not "${value}".`);
    }
    return transport;
  };
  const fallback = env.EVEJS_PILOT_TRANSPORT ? read(env.EVEJS_PILOT_TRANSPORT, "EVEJS_PILOT_TRANSPORT") : "gateway";
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
  return new Proxy(gateway, {
    get(target, name) {
      if (!Object.hasOwn(PILOT_FUNCTIONS, name)) {
        return target[name];
      }
      if (!routed.has(name)) {
        routed.set(name, route(name, PILOT_FUNCTIONS[name]));
      }
      return routed.get(name);
    },
    has(target, name) {
      return Object.hasOwn(PILOT_FUNCTIONS, name)
        ? typeof target[name] === "function" || typeof gamePort[name] === "function"
        : name in target;
    },
  });
}

module.exports = {
  GAME_PORT_HANDLE_PREFIX,
  PILOT_FUNCTIONS,
  createPilotTransport,
  isGamePortHandle,
  pilotTransportSetting,
};
