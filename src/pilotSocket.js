"use strict";

// One WebSocket between a browser tab and the BFF.
//
// The plan's Phase 6a (docs/game-port-transport-plan.md): the browser reaches
// the BFF over one socket that carries named operations, the bodies of the
// existing routes unchanged, and the pushed notices. It replaces the HTTP
// carriage of those routes, the event stream, and the cap of four requests the
// page keeps because a browser has six connections to an origin and no more.
//
// The routes and the event stream stand beside it as they were: the socket
// carries what they carry, and nothing of them is taken away here.
//
// AN OPERATION IS A ROUTE, RUN WHERE IT IS. A frame names a method and a path
// and may carry a body; the app is handed a request made of them, in this
// process, and what the route answers is the reply. Nothing of a route is
// rewritten for it: its authentication, its checks, its errors and its answer
// are the route's own, which is what "unchanged" has to mean for four hundred
// and sixty of them. `dispatchInProcess` is that, and is also what a hosted bot
// wants in place of the loopback HTTP it makes today.
//
// THE WIRE. Text frames of JSON.
//
//   browser -> BFF   { "hello": { "token": "<the web session's token>" } }
//   BFF -> browser   { "hello": { "ok": true } }
//
//   browser -> BFF   { "id": 7, "method": "POST", "path": "/api/bridge/select", "body": { ... } }
//   BFF -> browser   { "id": 7, "status": 200, "body": { ... } }
//
//   BFF -> browser   { "id": 7, "error": { "code": "BAD_FRAME", "message": "..." } }
//
// The hello is first, and is the only place the token travels: never in the
// socket's address, where it would reach a history and a log. A socket that
// says nothing for a while, or says something else first, is closed. Every
// operation is then authenticated again by its own route, with that token, so a
// session that ends while the socket is open ends on the socket too.
//
// A reply is matched to its request by `id`, which is the browser's to choose.
// Replies come as their routes finish, not in the order asked.
//
// THE PUSHED NOTICES ARE THE EVENT STREAM'S, ON THE SOCKET. The BFF's event
// stream (GET /api/bridge/events, Server-Sent Events) is a route like the rest,
// except that it answers for as long as it is listened to. Asked for on the
// socket it is run where it is, like an operation (`streamInProcess`), and each
// frame it writes is handed on as it is written. So who may listen, what is
// refused, and every frame are the route's own.
//
//   browser -> BFF   { "events": "open", "n": 3 }
//   BFF -> browser   { "events": { "open": true, "n": 3 } }          the route answered 200
//   BFF -> browser   { "event": { ...one frame of the event stream... } }
//   BFF -> browser   { "events": { "ended": true, "n": 3, "status": 409, "body": { ... } } }
//   browser -> BFF   { "events": "close" }
//
// A socket has one event stream: asked for again, the one attached is let go
// and another attached. `n` is the browser's to choose and is said back, so
// that what is said of a stream it has since let go is not taken for the one it
// has now. `ended` is said when the route refuses (its status and answer are
// given) and when the route ends a stream it had opened (status 200, no body);
// it is not said for a stream the browser closed. A socket that closes takes
// its event stream with it.

const http = require("node:http");
const { Duplex } = require("node:stream");
const { WebSocketServer } = require("ws");

const SOCKET_PATH = "/api/socket";
const EVENTS_PATH = "/api/bridge/events";
/** The routes' own bodies are held to 64 KB (express.json in src/server.js); a frame is the body and a little more. */
const MAX_FRAME_BYTES = 256 * 1024;
const HELLO_WAIT_MS = 10_000;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
/** Closing codes of this socket's own (4000 to 4999 are an application's). */
const CLOSE = Object.freeze({ HELLO_EXPECTED: 4400, NOT_AUTHENTICATED: 4401 });

/**
 * A path that is an operation: one of the BFF's own API, and not the event
 * stream, which never answers (the socket carries the pushes itself).
 */
function isOperationPath(path) {
  if (typeof path !== "string" || !path.startsWith("/api/") || /[\r\n]/.test(path)) return false;
  const name = path.split("?")[0];
  return name !== SOCKET_PATH && name !== EVENTS_PATH;
}

/**
 * What stands where a connection would: enough for the request to say who is asking, and nothing that reads or writes.
 *
 * It says it is readable. A body parser asks whether the request has already been finished before it reads one, and
 * takes a request whose connection is not readable for finished: said otherwise, every body is skipped unread.
 */
function noConnection(remoteAddress) {
  // A stream of its own kind, because the request's own code takes it for one (it watches it for an end).
  const quiet = new Duplex({ read() {}, write(chunk, encoding, callback) { callback(); } });
  quiet.remoteAddress = remoteAddress;
  quiet.encrypted = false;
  quiet.setTimeout = () => quiet;
  return quiet;
}

/**
 * Run one request through an Express app in this process, with no connection made.
 *
 *   dispatchInProcess(app, { method, path, headers, body, rawBody, remoteAddress })
 *     -> { status, headers, body }      body: what the route sent, as a Buffer
 *
 * `body`, where given, is sent as JSON and read by the app's own body parser, so
 * its limit and its refusals are the app's. `rawBody` is a body sent as it is
 * (text, or bytes), under the content type the headers give it: what a caller
 * that already has its request written out wants (src/inProcessFetch.js). A path no route has answers 404, as
 * it would over HTTP. What a route throws is answered by the app's own error
 * handler; only something thrown outside of every handler rejects.
 */
function dispatchInProcess(app, request = {}) {
  return new Promise((resolve, reject) => {
    const { req, res } = requestInProcess(request);
    const chunks = [];
    let answered = false;
    const take = (chunk, encoding) => {
      if (chunk === undefined || chunk === null || typeof chunk === "function") return;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8"));
    };
    const called = (...maybe) => maybe.find((each) => typeof each === "function");
    res.write = (chunk, encoding, callback) => {
      take(chunk, encoding);
      called(encoding, callback)?.();
      return true;
    };
    res.end = (chunk, encoding, callback) => {
      take(chunk, encoding);
      if (!answered) {
        answered = true;
        resolve({ status: res.statusCode, headers: res.getHeaders(), body: Buffer.concat(chunks) });
      }
      called(chunk, encoding, callback)?.();
      return res;
    };
    try {
      app(req, res, (error) => {
        if (answered) return;
        if (error) {
          answered = true;
          reject(error);
          return;
        }
        answered = true;
        resolve({ status: 404, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ ok: false, error: "NOT_FOUND" })) });
      });
    } catch (error) {
      if (!answered) {
        answered = true;
        reject(error);
      }
    }
  });
}

/** A request and the response it will be answered on, made of what an operation says and with no connection. */
function requestInProcess(request) {
  const method = String(request.method || "GET").toUpperCase();
  const raw = request.rawBody !== undefined && request.rawBody !== null;
  const payload = raw
    ? Buffer.from(request.rawBody)
    : request.body === undefined || request.body === null ? null : Buffer.from(JSON.stringify(request.body), "utf8");
  const headers = { host: "in-process" };
  for (const [name, value] of Object.entries(request.headers || {})) {
    if (typeof value === "string") headers[name.toLowerCase()] = value;
  }
  if (payload) {
    if (!raw) headers["content-type"] = "application/json";
    headers["content-length"] = String(payload.length);
  } else {
    delete headers["content-type"];
    delete headers["content-length"];
  }
  const req = new http.IncomingMessage(noConnection(String(request.remoteAddress || "127.0.0.1")));
  req.method = method;
  req.url = String(request.path || "/");
  req.headers = headers;
  req.httpVersion = "1.1";
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;
  if (payload) req.push(payload);
  req.push(null);
  // The whole of it is here: said so, or the request is taken for one cut off when its body has been read.
  req.complete = true;
  return { req, res: new http.ServerResponse(req) };
}

/**
 * Run a request whose route answers for as long as it is listened to, in this process: the event stream.
 *
 *   streamInProcess(app, { method, path, headers, remoteAddress }, { onHead(status, headers), onChunk(buffer), onEnd(), onError(error) })
 *     -> { close() }
 *
 * `onHead` is said once, with the route's status and its headers, before the
 * first of what it writes. `onChunk` is each thing the route writes, as it writes it. `onEnd` is
 * said once, when the route ends its answer; a path no route has ends with 404,
 * and something thrown outside of every handler with 500 (and `onError`).
 *
 * `close()` is the listener going away. The request is told it has closed, as a
 * connection lost tells it, which is what a route that streams waits for to let
 * go of what it holds; nothing the route writes after that is handed on, and
 * `onEnd` is not said.
 */
function streamInProcess(app, request = {}, handlers = {}) {
  const { req, res } = requestInProcess(request);
  let headSaid = false;
  let over = false;
  // Headers handed straight to `writeHead` are written out and not kept where they can be read back: kept here.
  const written = {};
  const writeHead = res.writeHead;
  res.writeHead = (...given) => {
    const named = given.find((each) => each !== null && typeof each === "object" && !Array.isArray(each));
    Object.assign(written, named);
    return writeHead.apply(res, given);
  };
  const head = () => {
    if (headSaid) return;
    headSaid = true;
    handlers.onHead?.(res.statusCode, { ...written, ...res.getHeaders() });
  };
  const take = (chunk, encoding) => {
    if (over || chunk === undefined || chunk === null || typeof chunk === "function") return;
    head();
    handlers.onChunk?.(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === "string" ? encoding : "utf8"));
  };
  const finish = () => {
    if (over) return;
    head();
    over = true;
    handlers.onEnd?.();
  };
  const called = (...maybe) => maybe.find((each) => typeof each === "function");
  res.write = (chunk, encoding, callback) => {
    take(chunk, encoding);
    called(encoding, callback)?.();
    return true;
  };
  res.end = (chunk, encoding, callback) => {
    take(chunk, encoding);
    finish();
    called(chunk, encoding, callback)?.();
    return res;
  };
  const outside = (error) => {
    if (error) handlers.onError?.(error);
    res.statusCode = error ? 500 : 404;
    finish();
  };
  try {
    app(req, res, outside);
  } catch (error) {
    outside(error);
  }
  return {
    close() {
      if (over) return;
      over = true;
      req.emit("close");
    },
  };
}

/** The frames in what an event stream has written: each `data:` line of each record that is whole, and what is left over. */
function eventFrames(text) {
  const frames = [];
  let rest = text;
  for (let at = rest.indexOf("\n\n"); at >= 0; at = rest.indexOf("\n\n")) {
    const record = rest.slice(0, at);
    rest = rest.slice(at + 2);
    for (const line of record.split("\n")) {
      // A comment (the stream's opening line, its heartbeat) is nothing to hand on.
      if (!line.startsWith("data:")) continue;
      try {
        frames.push(JSON.parse(line.slice(5)));
      } catch {
        // Not a frame: the stream's own readers let it pass too.
      }
    }
  }
  return { frames, rest };
}

/** What a route sent, as the frame carries it: JSON where it is JSON, the text where it is not, null where there is none. */
function replyBody(buffer) {
  const text = buffer.toString("utf8");
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Serve the socket on an HTTP server that serves `app`.
 *
 *   attachPilotSocket(server, app, { verify, onError, helloWaitMs })
 *     -> { path, sockets(), close() }
 *
 * `verify(token)` says whether a token is a web session's (truthy) or not. It
 * is asked once, at the hello; each operation's route asks again for itself.
 */
function attachPilotSocket(server, app, options = {}) {
  const verify = typeof options.verify === "function" ? options.verify : () => false;
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  const helloWaitMs = Number.isFinite(options.helloWaitMs) ? options.helloWaitMs : HELLO_WAIT_MS;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  const onUpgrade = (request, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(request.url, "http://in-process").pathname;
    } catch {
      pathname = "";
    }
    if (pathname !== SOCKET_PATH) {
      // Nothing else of this server's is a socket: an upgrade asked of any other path is refused, not left hanging.
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => serve(ws, request));
  };
  server.on("upgrade", onUpgrade);

  function serve(ws, request) {
    let token = null;
    const remoteAddress = request.socket ? request.socket.remoteAddress : "127.0.0.1";
    const say = (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    const waiting = setTimeout(() => ws.close(CLOSE.HELLO_EXPECTED, "hello expected"), helloWaitMs);
    waiting.unref?.();
    /** The event stream attached to this socket, where there is one. */
    let events = null;
    const letEventsGo = () => {
      const attached = events;
      events = null;
      // (Closing one its route has already ended tells nobody anything.)
      attached?.close();
    };
    const attachEvents = (n) => {
      letEventsGo();
      let status = 0;
      let unread = "";
      const refusal = [];
      events = streamInProcess(app, { method: "GET", path: EVENTS_PATH, headers: { authorization: `Bearer ${token}` }, remoteAddress }, {
        onHead(code) {
          status = code;
          if (code === 200) say({ events: { open: true, n } });
        },
        onChunk(buffer) {
          if (status !== 200) {
            refusal.push(buffer);
            return;
          }
          const read = eventFrames(unread + buffer.toString("utf8"));
          unread = read.rest;
          for (const frame of read.frames) say({ event: frame });
        },
        onEnd() {
          say({ events: { ended: true, n, status, body: status === 200 ? null : replyBody(Buffer.concat(refusal)) } });
        },
        onError: (error) => onError(error),
      });
    };
    ws.on("close", () => {
      clearTimeout(waiting);
      letEventsGo();
    });
    ws.on("error", (error) => onError(error));
    ws.on("message", (data, isBinary) => {
      let frame = null;
      try {
        frame = isBinary ? null : JSON.parse(data.toString("utf8"));
      } catch {
        frame = null;
      }
      if (token === null) {
        const offered = frame && frame.hello && typeof frame.hello.token === "string" ? frame.hello.token : "";
        if (!frame || !frame.hello) {
          ws.close(CLOSE.HELLO_EXPECTED, "hello expected");
          return;
        }
        let known = false;
        try {
          known = Boolean(offered) && Boolean(verify(offered));
        } catch (error) {
          onError(error);
        }
        if (!known) {
          ws.close(CLOSE.NOT_AUTHENTICATED, "not authenticated");
          return;
        }
        token = offered;
        clearTimeout(waiting);
        say({ hello: { ok: true } });
        return;
      }
      if (frame === null || typeof frame !== "object" || Array.isArray(frame)) {
        say({ id: null, error: { code: "BAD_FRAME", message: "A frame is a JSON object, sent as text." } });
        return;
      }
      if (frame.events !== undefined) {
        if (frame.events === "open") attachEvents(typeof frame.n === "number" ? frame.n : null);
        else if (frame.events === "close") letEventsGo();
        else say({ id: null, error: { code: "BAD_FRAME", message: "The event stream is asked to open or to close." } });
        return;
      }
      const id = typeof frame.id === "number" || typeof frame.id === "string" ? frame.id : null;
      const method = typeof frame.method === "string" ? frame.method.toUpperCase() : "";
      if (id === null || !METHODS.has(method) || typeof frame.path !== "string") {
        say({ id, error: { code: "BAD_FRAME", message: "An operation has an id, a method and a path." } });
        return;
      }
      if (!isOperationPath(frame.path)) {
        say({ id, error: { code: "NOT_AN_OPERATION", message: "Only the BFF's own API is carried, and the event stream is not an operation." } });
        return;
      }
      dispatchInProcess(app, {
        method,
        path: frame.path,
        body: method === "GET" ? undefined : frame.body,
        headers: { authorization: `Bearer ${token}` },
        remoteAddress,
      }).then(
        (answer) => say({ id, status: answer.status, body: replyBody(answer.body) }),
        (error) => {
          onError(error);
          say({ id, status: 500, body: { ok: false, error: "SERVER_ERROR", message: "The operation failed outside of its route." } });
        },
      );
    });
  }

  return {
    path: SOCKET_PATH,
    /** How many sockets are open. */
    sockets: () => wss.clients.size,
    /** Close every socket and stop taking new ones. */
    close() {
      server.off("upgrade", onUpgrade);
      for (const client of wss.clients) client.terminate();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}

module.exports = { CLOSE, EVENTS_PATH, MAX_FRAME_BYTES, SOCKET_PATH, attachPilotSocket, dispatchInProcess, eventFrames, isOperationPath, streamInProcess };
