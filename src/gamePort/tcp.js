"use strict";

// The game port over a TCP socket: the Node binding for a GamePortSession.
//
// This is the only file in src/gamePort/ that knows about sockets. It turns a
// TCP byte stream into the frames the session works with, and back. The framing
// is machoNet's: a 4-byte little-endian length, then that many bytes of payload.

const net = require("node:net");

const DEFAULT_GAME_PORT = 26000;
const CONNECT_TIMEOUT_MS = 10_000;
/** eve.js's own ceiling for one frame. A longer one is a protocol error. */
const MAX_FRAME_LENGTH = 10_000_000;

/**
 * Connect to a game port and resolve to a frame transport:
 * { send(payload), close(), onFrame, onClose }. Frames that arrive before
 * `onFrame` is assigned are kept and delivered when it is.
 */
function connectTcp({ host = "127.0.0.1", port = DEFAULT_GAME_PORT, connect = net.connect, timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = Buffer.alloc(0);
    let closed = false;
    let connected = false;
    const early = [];
    let frameHandler = null;
    let closeHandler = null;

    const transport = {
      send(payload) {
        const header = Buffer.alloc(4);
        header.writeUInt32LE(payload.length, 0);
        socket.write(Buffer.concat([header, payload]));
      },
      close() {
        closed = true;
        // A finished session releases its connection even when the peer keeps
        // its writable side open after our FIN.
        if (!socket.destroyed) socket.destroy();
      },
      get onFrame() { return frameHandler; },
      set onFrame(handler) {
        frameHandler = handler;
        while (frameHandler && early.length > 0) frameHandler(early.shift());
      },
      get onClose() { return closeHandler; },
      set onClose(handler) { closeHandler = handler; },
    };

    const fail = (error) => {
      if (closed) return;
      closed = true;
      if (!socket.destroyed) socket.destroy();
      if (!connected) reject(error);
      else if (closeHandler) closeHandler(error);
    };

    const timer = setTimeout(() => fail(new Error(`The game server at ${host}:${port} did not answer.`)), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      connected = true;
      socket.setNoDelay(true);
      resolve(transport);
    });
    socket.on("data", (chunk) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (length > MAX_FRAME_LENGTH) {
          fail(new Error(`The game server announced a ${length}-byte frame.`));
          return;
        }
        if (buffer.length < 4 + length) return;
        const payload = buffer.subarray(4, 4 + length);
        buffer = buffer.subarray(4 + length);
        if (frameHandler) frameHandler(payload);
        else early.push(payload);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      fail(new Error("The game connection closed."));
    });
  });
}

/**
 * The game server's host and port. Defaults to the gateway's own host - they
 * are the same process. EVEJS_GAME_HOST and EVEJS_GAME_PORT override it.
 */
function gameEndpoint(env = process.env) {
  let host = String(env.EVEJS_GAME_HOST || "").trim();
  if (!host) {
    try {
      host = new URL(String(env.EVEJS_GATEWAY_URL || "")).hostname || "127.0.0.1";
    } catch {
      host = "127.0.0.1";
    }
  }
  return { host, port: Number(env.EVEJS_GAME_PORT) || DEFAULT_GAME_PORT };
}

module.exports = { DEFAULT_GAME_PORT, MAX_FRAME_LENGTH, connectTcp, gameEndpoint };
