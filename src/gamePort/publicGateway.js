"use strict";

// The public gateway, spoken as the retail client speaks it: the client's eve_public requests (skill plans and the
// rest it sends there rather than over machoNet) go as protobuf messages on one gRPC stream, Requests/Send, over
// HTTP/2 (publicGateway/grpc/requestBroker.py, its native CqrsBroker). Each request is an eve_public.Request whose
// payload is the request message packed in a google.protobuf.Any; each answer an eve_public.Response matched to it by
// its correlation_uuid, its status_code 200 when it went well (requestsMessenger._check_response_status).
//
// One connection per pilot, as each client has its own (and its own application_instance_uuid), shut when the pilot
// has asked nothing for a while. The envelope is RequestBroker.new_eve_public_request's: issued now, a new
// correlation_uuid, the client's external_origin ('eve-desktop-client/{build} {codename}'), the application instance,
// and the authoritative context: the tenant (lower case, '.' as '_'), the account as the authenticated user, and for a
// character request (send_character_request) the character as the active identity.
//
// The messages are the client's own, from its generated eveProto modules (eveProtoSchema.json; see
// scripts/eve-proto-schema.js).

const crypto = require("crypto");
const http2 = require("http2");
const { createSchema } = require("./protoCodec");
const { RETAIL_CLIENT } = require("./session");

const SEND_PATH = "/eve_public.gateway.Requests/Send";
const TYPE_URL_PREFIX = "type.googleapis.com/";
/** stackless_response_router DEFAULT_TIMEOUT_SECONDS: a request with no timeout of its own waits this long. */
const DEFAULT_TIMEOUT_MS = 10_000;
const IDLE_CLOSE_MS = 5 * 60_000;
const STATUS_OK = 200;

let defaultSchema = null;
function eveProtoSchema() {
  if (!defaultSchema) defaultSchema = createSchema(require("./eveProtoSchema.json"));
  return defaultSchema;
}

/** EVEJS_PUBLIC_GATEWAY_URL, else the game host's EveJS public gateway (its port 26003, TLS). */
function publicGatewayUrl(env = process.env, gameHost = "127.0.0.1") {
  const said = String(env.EVEJS_PUBLIC_GATEWAY_URL || "").trim();
  return said || `https://${gameHost}:26003`;
}

function frame(message) {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
}

function frameReader(onMessage) {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
    while (pending.length >= 5) {
      const length = pending.readUInt32BE(1);
      if (pending.length < 5 + length) break;
      if (pending[0] !== 0) throw new Error("The gateway sent a compressed message, which nothing asked for.");
      const message = pending.subarray(5, 5 + length);
      pending = pending.subarray(5 + length);
      onMessage(message);
    }
  };
}

function timestamp(ms) {
  return { seconds: String(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
}

function gatewayError(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

/**
 * A public gateway client for the BFF's pilots.
 *   request(pilot, typeName, payload) -> {statusCode, statusMessage, typeName, payload}
 * pilot is {userID, characterID}; with no characterID it is a user request (send_user_request: no active identity).
 * payload, the answer's, is the decoded message where the schema knows its type, else null.
 */
function createPublicGateway({
  url = publicGatewayUrl(),
  tenant = "tranquility",
  origin = `eve-desktop-client/${RETAIL_CLIENT.build} ${RETAIL_CLIENT.codename}`,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  idleCloseMs = IDLE_CLOSE_MS,
  schema = eveProtoSchema(),
  connect = (target) => http2.connect(target, { rejectUnauthorized: false }),
  now = () => Date.now(),
} = {}) {
  const sanitizedTenant = String(tenant).replace(/\./g, "_").toLowerCase();
  const lines = new Map();

  function closeLine(key, error) {
    const line = lines.get(key);
    if (!line) return;
    lines.delete(key);
    clearTimeout(line.idle);
    for (const waiting of line.waiting.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error || gatewayError("GATEWAY_CLOSED", "The public gateway connection closed before it answered."));
    }
    line.waiting.clear();
    try { line.stream.close(); } catch {}
    try { line.session.close(); } catch {}
  }

  function lineFor(key) {
    const open = lines.get(key);
    if (open) return open;
    const session = connect(url);
    const stream = session.request({
      ":method": "POST",
      ":path": SEND_PATH,
      "content-type": "application/grpc+proto",
      te: "trailers",
      "grpc-accept-encoding": "identity",
    });
    const line = { session, stream, waiting: new Map(), idle: null, applicationInstance: crypto.randomUUID() };
    const read = frameReader((message) => {
      let response;
      try {
        response = schema.decode("eve_public.Response", message);
      } catch (error) {
        closeLine(key, gatewayError("GATEWAY_UNREADABLE", `The gateway's answer could not be read: ${error.message}`));
        return;
      }
      const waiting = line.waiting.get(response.correlation_uuid || "");
      if (!waiting) return;
      line.waiting.delete(response.correlation_uuid);
      clearTimeout(waiting.timer);
      waiting.resolve(response);
    });
    stream.on("data", (chunk) => {
      try { read(chunk); } catch (error) { closeLine(key, gatewayError("GATEWAY_UNREADABLE", error.message)); }
    });
    const lost = (error) => closeLine(key, error ? gatewayError("GATEWAY_UNREACHABLE", `The public gateway at ${url}: ${error.message}`) : undefined);
    stream.on("error", lost);
    stream.on("close", () => lost());
    session.on("error", lost);
    session.on("close", () => lost());
    lines.set(key, line);
    return line;
  }

  function touch(key, line) {
    clearTimeout(line.idle);
    line.idle = setTimeout(() => closeLine(key), idleCloseMs);
    if (line.idle.unref) line.idle.unref();
  }

  async function request(pilot, typeName, payload = {}) {
    if (!schema.hasMessage(typeName)) throw gatewayError("GATEWAY_UNKNOWN_REQUEST", `No message ${typeName} in the client's schema.`);
    const userID = Number(pilot && pilot.userID);
    const characterID = pilot && pilot.characterID !== undefined && pilot.characterID !== null ? Number(pilot.characterID) : null;
    if (!Number.isInteger(userID) || userID <= 0) throw gatewayError("GATEWAY_NO_USER", "A gateway request is made for an account.");
    const key = characterID === null ? `user:${userID}` : `character:${characterID}`;
    const line = lineFor(key);
    touch(key, line);
    const correlation = crypto.randomBytes(16);
    correlation[6] = (correlation[6] & 0x0f) | 0x40;
    correlation[8] = (correlation[8] & 0x3f) | 0x80;
    const authoritativeContext = {
      tenant: sanitizedTenant,
      authenticated_user: { sequential: userID },
      ...(characterID === null ? { no_active_identity: true } : { identity: { character: { sequential: characterID } } }),
    };
    const envelope = schema.encode("eve_public.Request", {
      issued: timestamp(now()),
      correlation_uuid: correlation,
      payload: { type_url: `${TYPE_URL_PREFIX}${typeName}`, value: schema.encode(typeName, payload) },
      external_origin: origin,
      application_instance_uuid: Buffer.from(line.applicationInstance.replace(/-/g, ""), "hex"),
      authoritative_context: authoritativeContext,
    });
    const response = await new Promise((resolve, reject) => {
      const id = correlation.toString("base64");
      const timer = setTimeout(() => {
        line.waiting.delete(id);
        reject(gatewayError("GATEWAY_TIMEOUT", `The public gateway did not answer ${typeName} in ${timeoutMs} ms.`));
      }, timeoutMs);
      line.waiting.set(id, { resolve, reject, timer });
      line.stream.write(frame(envelope), (error) => {
        if (!error) return;
        line.waiting.delete(id);
        clearTimeout(timer);
        reject(gatewayError("GATEWAY_UNREACHABLE", `The public gateway at ${url}: ${error.message}`));
      });
    });
    const any = response.payload || null;
    const answerType = any && any.type_url ? String(any.type_url).slice(String(any.type_url).lastIndexOf("/") + 1) : null;
    return {
      statusCode: Number(response.status_code || 0),
      statusMessage: response.status_message || "",
      typeName: answerType,
      payload: answerType && schema.hasMessage(answerType) ? schema.decode(answerType, Buffer.from(any.value || "", "base64")) : null,
    };
  }

  function close() {
    for (const key of [...lines.keys()]) closeLine(key);
  }

  return { request, close, STATUS_OK };
}

module.exports = { STATUS_OK, createPublicGateway, eveProtoSchema, publicGatewayUrl };
