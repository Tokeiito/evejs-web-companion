"use strict";

// From what the game port decodes to, to the JSON the browser's decoders read.
//
// The browser's bridge decoders (web/src/bridge/*.ts, through the readers in
// web/src/bridge/wire.ts) were written against the web gateway's answers. The
// gateway never marshals anything: it takes the value a handler returned, still
// in the server's own pre-marshal form, and prints it as JSON
// (evejsWebGatewayRuntime.js encodeJsonSafeCallValue). The game port sends the
// same value marshalled, and the codec decodes it into a slightly different
// form. This maps the second onto the first, so the same decoders can read
// answers from either transport.
//
// What the wire cannot tell us, and what this does about it:
//
//   str vs buffer   Both decode to a Buffer. A handler's string was UTF-8 text;
//                   a handler's Buffer was binary. Bytes that read back as
//                   clean text become a string, anything else the gateway's
//                   {type:"Buffer", data:[...]}.
//   64-bit integers A handler's big plain number, its {type:"long"} and its bare
//                   BigInt all arrive as a 64-bit integer. One that a JS number
//                   holds exactly becomes a number, which is what the gateway
//                   prints for the commonest of the three (an item ID). A larger
//                   one (a timestamp) becomes {type:"long", value:"<digits>"},
//                   which the decoders' unwrapLong reads. The gateway prints a
//                   bare BigInt as a bare string of digits instead; the parity
//                   report counts those.
//   real wrappers   {type:"real", value:x} arrives as the number x. unwrapReal
//                   reads both.
//
// scripts/parity-harness.js measures how well this holds, call by call.

/** Bytes a handler would have held as a string: valid UTF-8 with no control characters. */
function asText(buffer) {
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) return null;
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) ? null : text;
}

const bufferJson = (buffer) => ({ type: "Buffer", data: [...buffer] });

function wireToBridgeJson(value) {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : { type: "long", value: value.toString() };
    case "object":
      break;
    default:
      return null;
  }
  if (Buffer.isBuffer(value)) return asText(value) ?? bufferJson(value);
  if (Array.isArray(value)) return value.map(wireToBridgeJson);
  switch (value.type) {
    case "dict":
      return { type: "dict", entries: value.entries.map(([key, entry]) => [wireToBridgeJson(key), wireToBridgeJson(entry)]) };
    case "list":
      return { type: "list", items: value.items.map(wireToBridgeJson) };
    case "object":
      return { type: "object", name: wireToBridgeJson(value.name), args: wireToBridgeJson(value.args) };
    case "objectex1":
    case "objectex2":
      return {
        type: value.type,
        header: wireToBridgeJson(value.header),
        list: (value.list ?? []).map(wireToBridgeJson),
        dict: (value.dict ?? []).map(([key, entry]) => [wireToBridgeJson(key), wireToBridgeJson(entry)]),
      };
    case "packedrow": {
      // The codec gives both forms the server's two row builders use: `fields`
      // by name and `values` by position. The raw packed bytes are dropped.
      const fields = value.fields && typeof value.fields === "object"
        ? Object.fromEntries(Object.entries(value.fields).map(([name, entry]) => [name, wireToBridgeJson(entry)]))
        : undefined;
      return {
        type: "packedrow",
        header: wireToBridgeJson(value.header),
        columns: wireToBridgeJson(value.columns ?? []),
        ...(fields ? { fields } : {}),
        values: (value.values ?? []).map(wireToBridgeJson),
      };
    }
    case "substream":
      return "raw" in value ? { type: "substream", raw: bufferJson(value.raw) } : { type: "substream", value: wireToBridgeJson(value.value) };
    case "substruct":
      return { type: "substruct", value: wireToBridgeJson(value.value) };
    case "checksummed":
      return { type: "checksummed", checksum: value.checksum, value: wireToBridgeJson(value.value) };
    case "cpicked":
      return { type: "cpicked", data: bufferJson(value.data) };
    case "wstring":
    case "token":
      return { type: value.type, value: String(value.value ?? "") };
    default:
      // A codec form this does not know. Keep it visible instead of guessing.
      return { type: "unmapped", codecType: String(value.type ?? "none") };
  }
}

/**
 * A notification from the game-port session, in the shape the gateway hands
 * the BFF one: {kind, service, method, idType, args, kwargs}.
 *
 *   kind "client"    a broadcast (ClientSession.sendNotification)
 *   kind "service"   a service's own notification (sendServiceNotification)
 */
function notificationToBridgeJson(notification) {
  const args = wireToBridgeJson(notification.args);
  return {
    kind: notification.service ? "service" : "client",
    service: notification.service ?? null,
    method: notification.method ?? null,
    idType: notification.service ? null : notification.idtype ?? null,
    args: Array.isArray(args) ? args : args === null ? [] : [args],
    kwargs: wireToBridgeJson(notification.kwargs),
  };
}

/**
 * A session change from the game-port session ({name: [old, new]}), in the
 * shape the gateway reports one: a notification whose one argument is a plain
 * object of the changes.
 */
function sessionChangeToBridgeJson(changes) {
  return {
    kind: "sessionchange",
    service: null,
    method: "OnSessionChanged",
    args: [Object.fromEntries(Object.entries(changes).map(([name, pair]) => [name, wireToBridgeJson(pair)]))],
    kwargs: null,
  };
}

module.exports = { notificationToBridgeJson, sessionChangeToBridgeJson, wireToBridgeJson };
