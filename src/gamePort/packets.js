"use strict";

// machoNet packets and addresses, laid out as the retail client lays them out.
//
// Source: the client's own carbon/common/script/net/machoNetPacket.py and
// machoNetAddress.py (__getstate__ in each). A packet is an object whose state
// is a 14-tuple; an address is an object whose state depends on its kind.

const PACKET_NAMESPACE = "carbon.common.script.net.machoNetPacket";

const TYPE = Object.freeze({
  CALL_REQ: 6,
  CALL_RSP: 7,
  TRANSPORT_CLOSED: 8,
  NOTIFICATION: 12,
  ERROR_RESPONSE: 15,
  SESSION_CHANGE: 16,
  SESSION_INITIAL_STATE: 18,
  PING_REQ: 20,
  PING_RSP: 21,
});

const CLASS_NAME = Object.freeze({
  [TYPE.CALL_REQ]: "CallReq",
  [TYPE.CALL_RSP]: "CallRsp",
  [TYPE.TRANSPORT_CLOSED]: "TransportClosed",
  [TYPE.NOTIFICATION]: "Notification",
  [TYPE.ERROR_RESPONSE]: "ErrorResponse",
  [TYPE.SESSION_CHANGE]: "SessionChangeNotification",
  [TYPE.SESSION_INITIAL_STATE]: "SessionInitialStateNotification",
  [TYPE.PING_REQ]: "PingReq",
  [TYPE.PING_RSP]: "PingRsp",
});

const ADDRESS = Object.freeze({ NODE: 1, CLIENT: 2, BROADCAST: 4, ANY: 8 });

const object = (name, args) => ({ type: "object", name: `${PACKET_NAMESPACE}.${name}`, args });

/** (ADDRESS_TYPE_NODE, nodeID, service, callID) */
const nodeAddress = (nodeID, service = null, callID = null) =>
  object("MachoAddress", [ADDRESS.NODE, nodeID, service, callID]);
/** (ADDRESS_TYPE_CLIENT, clientID, callID, service) */
const clientAddress = (clientID, callID = null, service = null) =>
  object("MachoAddress", [ADDRESS.CLIENT, clientID, callID, service]);
/** (ADDRESS_TYPE_ANY, service, callID) */
const anyAddress = (service = null, callID = null) =>
  object("MachoAddress", [ADDRESS.ANY, service, callID]);

/**
 * A packet as MachoPacket.__getstate__ writes it:
 * (command, source, destination, userID, body, oob, contextKey, journeyID,
 *  trace_id, parent_span_id, sampled, ingress_id, sample_rate, cut_parent)
 *
 * `oob` is None unless the packet carries out-of-band data. The six trace
 * fields are None on a client that is not sampling a trace.
 */
function buildPacket(command, { source, destination, userID = null, body, oob = null, journeyID = null }) {
  return object(CLASS_NAME[command], [
    command, source, destination, userID, body, oob,
    null, // contextKey: a client never sets it; the proxy refuses a packet that does
    journeyID,
    null, null, null, null, null, null,
  ]);
}

const text = (value) => {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("latin1");
  if (value && typeof value === "object" && (value.type === "wstring" || value.type === "token")) return value.value;
  return null;
};

const integer = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  if (value && typeof value === "object" && value.type === "long") return integer(value.value);
  return null;
};

const stateOf = (value) =>
  (value && typeof value === "object" && value.type === "object" && Array.isArray(value.args) ? value.args : null);

function parseAddress(value) {
  const state = stateOf(value);
  if (!state) return { kind: "unknown" };
  switch (state[0]) {
    case ADDRESS.NODE:
      return { kind: "node", nodeID: integer(state[1]), service: text(state[2]), callID: integer(state[3]) };
    case ADDRESS.CLIENT:
      return { kind: "client", clientID: integer(state[1]), callID: integer(state[2]), service: text(state[3]) };
    case ADDRESS.BROADCAST:
      return { kind: "broadcast", broadcastID: text(state[1]), narrowcast: state[2], idtype: text(state[3]) };
    case ADDRESS.ANY:
      return { kind: "any", service: text(state[1]), callID: integer(state[2]) };
    default:
      return { kind: "unknown" };
  }
}

/** A decoded frame as a packet, or null when it is not one. */
function parsePacket(value) {
  const state = stateOf(value);
  if (!state || state.length < 5 || typeof state[0] !== "number") return null;
  return {
    command: state[0],
    className: CLASS_NAME[state[0]] ?? null,
    source: parseAddress(state[1]),
    destination: parseAddress(state[2]),
    userID: integer(state[3]),
    body: Array.isArray(state[4]) ? state[4] : [],
    oob: state[5] ?? null,
  };
}

/** A dict value by key, for a decoded marshal dict. */
function dictGet(dict, key) {
  if (!dict || dict.type !== "dict" || !Array.isArray(dict.entries)) return undefined;
  for (const [entryKey, value] of dict.entries) {
    if (text(entryKey) === key) return value;
  }
  return undefined;
}

const unwrapSubstream = (value) =>
  (value && typeof value === "object" && value.type === "substream" ? value.value : value);

module.exports = {
  ADDRESS, CLASS_NAME, PACKET_NAMESPACE, TYPE,
  anyAddress, buildPacket, clientAddress, dictGet, integer, nodeAddress, parseAddress, parsePacket, text,
  unwrapSubstream,
};
