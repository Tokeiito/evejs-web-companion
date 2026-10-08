"use strict";

// Record what crosses the game port, between ANY client and the server.
//
// The retail client is the specification for the game-port session, and the one
// way to see exactly what it sends is to stand between it and the server. This
// is a pass-through: it listens where the client connects, forwards every byte
// both ways untouched, and writes each machoNet frame to a file.
//
//   node scripts/record-game-port.js record [listenPort] [upstreamPort] [outputPath]
//   node scripts/record-game-port.js describe <recording.jsonl>
//
// To record the real client without changing it or the launcher: start eve.js
// with EVEJS_SERVER_PORT=26005 (a stock setting), and run this on 26000
// forwarding to 26005. The client connects to 26000 as it always does.
//
// `describe` prints one line per frame: who sent it, what it is, and for a call
// its service, method, address and keyword names. It changes nothing.
//
// ⚠ A recording holds whatever the client sent, including the account's name
// and the hash of its password. Keep recordings out of the repository unless
// they were made with a throwaway account.

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const zlib = require("node:zlib");
const { marshalDecode } = require("../src/gameProtocol/marshal");
const { parsePacket, text, unwrapSubstream } = require("../src/gamePort/packets");
const { frameSplitter } = require("./capture-game-frames");

const DEFAULT_LISTEN_PORT = 26000;
const DEFAULT_UPSTREAM_PORT = 26005;

function record({ listenPort = DEFAULT_LISTEN_PORT, upstreamPort = DEFAULT_UPSTREAM_PORT, upstreamHost = "127.0.0.1", outputPath, log = console.log }) {
  const output = fs.createWriteStream(outputPath, { flags: "a" });
  const started = Date.now();
  let connections = 0;
  const server = net.createServer((client) => {
    connections += 1;
    const connection = connections;
    const write = (from) => frameSplitter((payload) => {
      output.write(`${JSON.stringify({ connection, at: Date.now() - started, from, hex: payload.toString("hex") })}\n`);
    });
    const upstream = net.connect({ host: upstreamHost, port: upstreamPort });
    const fromClient = write("client");
    const fromServer = write("server");
    client.on("data", (chunk) => {
      fromClient(chunk);
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      fromServer(chunk);
      client.write(chunk);
    });
    const end = () => {
      if (!client.destroyed) client.destroy();
      if (!upstream.destroyed) upstream.destroy();
    };
    for (const socket of [client, upstream]) {
      socket.setNoDelay(true);
      socket.on("error", end);
      socket.on("close", end);
    }
    log(`connection ${connection} from ${client.remoteAddress}:${client.remotePort}`);
  });
  server.listen(listenPort, "127.0.0.1", () => {
    log(`Recording 127.0.0.1:${listenPort} <-> ${upstreamHost}:${upstreamPort} into ${outputPath}`);
  });
  return server;
}

// ── describe ─────────────────────────────────────────────────────────────────

/** A value's shape in a few characters: enough to tell a str from a unicode from a long. */
function shape(value, depth = 0) {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return Number.isInteger(value) ? `int(${value})` : `float(${value})`;
  if (typeof value === "bigint") return `int64(${value})`;
  if (typeof value === "string") return `str(${JSON.stringify(value.slice(0, 40))})`;
  if (Buffer.isBuffer(value)) {
    const printable = /^[\x20-\x7e]*$/.test(value.toString("latin1"));
    return printable ? `str(${JSON.stringify(value.toString("latin1").slice(0, 40))})` : `str[${value.length} bytes]`;
  }
  if (Array.isArray(value)) return depth > 3 ? `tuple[${value.length}]` : `(${value.slice(0, 8).map((entry) => shape(entry, depth + 1)).join(", ")}${value.length > 8 ? ", ..." : ""})`;
  switch (value.type) {
    case "wstring": return `unicode(${JSON.stringify(String(value.value).slice(0, 40))})`;
    case "long": return `long(${value.value})`;
    case "dict": return depth > 3 ? `dict[${value.entries.length}]` : `{${value.entries.slice(0, 12).map(([key, entry]) => `${text(key) ?? shape(key, depth + 1)}: ${shape(entry, depth + 1)}`).join(", ")}${value.entries.length > 12 ? ", ..." : ""}}`;
    case "list": return depth > 3 ? `list[${value.items.length}]` : `[${value.items.slice(0, 8).map((entry) => shape(entry, depth + 1)).join(", ")}]`;
    case "substream": return `substream ${shape(value.value, depth + 1)}`;
    case "object": return `${String(text(value.name)).split(".").pop()}${shape(value.args, depth + 1)}`;
    default: return `<${value.type}>`;
  }
}

function describeFrame(frame) {
  const bytes = Buffer.from(frame.hex, "hex");
  const compressed = bytes.length > 0 && bytes[0] !== 0x7e && bytes[0] !== 0x7d;
  let value;
  try {
    value = marshalDecode(compressed ? zlib.inflateSync(bytes) : bytes);
  } catch (error) {
    return `undecodable (${error.message})`;
  }
  const size = `${bytes.length}b${compressed ? " zlib" : ""}`;
  // Whether the stream shares objects: blue writes a count of them after the
  // header, and the stock encoder here always writes zero.
  const plain = compressed ? zlib.inflateSync(bytes) : bytes;
  const shared = plain.length >= 5 ? plain.readUInt32LE(1) : 0;
  const head = `${size}${shared > 0 ? ` shared=${shared}` : ""}`;
  const packet = parsePacket(value);
  if (!packet || packet.className === null) return `${head} ${shape(value)}`;
  const address = (entry) => {
    if (entry.kind === "client") return `client(${entry.clientID}, call ${entry.callID})`;
    if (entry.kind === "node") return `node(${entry.nodeID}${entry.service ? `, ${entry.service}` : ""}${entry.callID !== null ? `, call ${entry.callID}` : ""})`;
    if (entry.kind === "any") return `any(${entry.service ?? ""}${entry.callID !== null ? `, call ${entry.callID}` : ""})`;
    if (entry.kind === "broadcast") return `broadcast(${entry.broadcastID}, ${entry.idtype})`;
    return "?";
  };
  let detail = "";
  if (packet.className === "CallReq") {
    const [flag, pickle] = packet.body[0] ?? [];
    const call = unwrapSubstream(pickle);
    if (Array.isArray(call)) {
      const keywords = call[3] && call[3].type === "dict" ? call[3].entries.map(([key, entry]) => `${text(key)}=${shape(entry)}`).join(",") : shape(call[3]);
      detail = ` ${flag ? text(call[0]) : packet.destination.service}.${text(call[1])}${shape(call[2])} kw{${keywords}} callID=${shape(value.args[1].args[2])}`;
    }
  }
  const trailer = value.args.slice(5).map((entry) => shape(entry)).join(" ");
  return `${head} ${packet.className} ${address(packet.source)} -> ${address(packet.destination)} user=${shape(value.args[3])}${detail} | oob.. ${trailer}`;
}

function describe(recordingPath, log = console.log) {
  const lines = fs.readFileSync(recordingPath, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const frame = JSON.parse(line);
    log(`${String(frame.connection).padStart(2)} ${String(frame.at).padStart(8)}ms ${frame.from.padEnd(6)} ${describeFrame(frame)}`);
  }
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === "describe" && rest[0]) {
    describe(rest[0]);
    return;
  }
  if (command === "record") {
    const [listenPort, upstreamPort, outputPath] = rest;
    record({
      listenPort: Number(listenPort) || DEFAULT_LISTEN_PORT,
      upstreamPort: Number(upstreamPort) || DEFAULT_UPSTREAM_PORT,
      outputPath: outputPath ?? path.join(process.cwd(), `game-port-recording-${Date.now()}.jsonl`),
    });
    return;
  }
  throw new Error("Usage: node scripts/record-game-port.js record [listenPort] [upstreamPort] [outputPath]\n       node scripts/record-game-port.js describe <recording.jsonl>");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { describe, describeFrame, record, shape };
