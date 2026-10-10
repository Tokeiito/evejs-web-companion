// The page's requests, carried on the tab's socket (src/pilotSocket.js; the
// plan's Phase 6a, docs/game-port-transport-plan.md).
//
// The BFF serves one socket on which a request is a frame — a method, a path
// and a body — answered by its id with the route's own status and answer. This
// is the page's end of it: a function of `fetch`'s own shape that sends a
// request that way and answers with a `Response`, so nothing that asks has to
// know which way it went.
//
// ⚠ HTTP IS THE WAY BACK, ALWAYS. A request is carried on the socket only when
// it can be: a path of the BFF's own API, authenticated by a token (the hello
// is that token; a request that rides a cookie has none to say), with a JSON
// body or none. Anything else is fetched as before. So is everything while the
// socket is down or was refused, and anything the BFF says it did not run.
//
// ⚠ ONE SOCKET FOR EACH TOKEN. A tab can hold several pilots, each signed in
// on its own web session (R107), and a socket's hello names one of them.
//
// ⚠ A SOCKET IS FOR A SESSION THAT STAYS. The page signs in for one question and
// out again all the time: the hangar reads each account's roster on a session it
// makes for the purpose and ends at once. A socket opened for each of those is a
// handshake to save one request, and (found in the browser, 2026-10-10) ten of
// them left open after a quarter of a minute. So a token's first requests go
// over HTTP and it is given a socket at its third; its socket is closed when the
// session is logged out on it; and one nothing has been asked on for a while is
// closed when something else is asked.
//
// ⚠ THE PUSHED NOTICES COME ON IT TOO. A session's event stream (the BFF's
// Server-Sent Events, GET /api/bridge/events) is listened to on its socket with
// `listen`: the BFF runs that route for as long as the page listens and hands
// each frame on. A session that is listened to is one that stays, so it is given
// its socket then, whatever it has asked so far, and a socket being listened on
// is not closed for having had nothing asked on it. Where the socket is not to
// be had, the listener is told so, and the page's `EventSource` is the way back
// (app/api.ts).
//
// ⚠ WHAT IS NOT KNOWN IS NOT RETRIED. A request sent and not answered when the
// socket closes may have been run: it fails, as a fetch cut off does, and the
// caller's own handling of a request that failed decides what happens next. A
// request that was never sent (the socket never opened) goes over HTTP.

/** As much of a WebSocket as this needs: the browser's own, or a stand-in. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface SocketFetchDeps {
  /** The way back: the page's fetch over HTTP. */
  readonly fetch: typeof fetch;
  /** Open a socket to the BFF's `/api/socket`. */
  readonly openSocket: () => SocketLike;
  /** A clock, for when a socket that went down may be tried again. */
  readonly now?: () => number;
  /** How long a socket that went down is left alone before it is tried again. */
  readonly retryMs?: number;
  /** How many of a token's requests go over HTTP before it is given a socket. */
  readonly warmUp?: number;
  /** How long a socket may have had nothing asked on it before it is closed. */
  readonly idleMs?: number;
}

export interface SocketFetchStats {
  /** Requests answered on a socket. */
  readonly carried: number;
  /** Requests fetched over HTTP: not carriable, or with no socket to carry them. */
  readonly fetched: number;
  /** Sockets open now. */
  readonly open: number;
}

/** What a listener to a session's pushed notices is told. */
export interface PushHandlers {
  /** The BFF has attached the session's event stream to the socket. */
  onOpen(): void;
  /** One frame of the event stream, as the BFF published it. */
  onFrame(frame: unknown): void;
  /** The BFF refused the stream, or ended it. Nothing more comes of this listening. */
  onEnded(): void;
  /** The socket is not to be had (it never opened, was refused, or went down): the pushes must come another way. */
  onUnavailable(): void;
}

export interface SocketFetch {
  readonly fetch: typeof fetch;
  /**
   * Listen to the pushed notices of a token's session, on its socket. One listener for a token: listening again
   * takes the place of the one before, which is told nothing. `close()` stops it.
   */
  listen(token: string, handlers: PushHandlers): { close(): void };
  /**
   * Whether this request, asked now, would be sent on a socket that is open. Asks nothing and changes nothing: it is
   * how the page's lane knows a request needs none of the browser's connections (app/transport.ts).
   */
  wouldCarry(input: unknown, init: RequestInit | undefined): boolean;
  stats(): SocketFetchStats;
  /** Close every socket. Requests after this are fetched over HTTP until one is opened again. */
  close(): void;
}

/** The BFF's closing code for a hello it does not know (src/pilotSocket.js, CLOSE.NOT_AUTHENTICATED). */
const NOT_AUTHENTICATED = 4401;
const DEFAULT_RETRY_MS = 5_000;
/** A session made for one question asks it and logs out: two requests. The third says the session is staying. */
const DEFAULT_WARM_UP = 2;
const DEFAULT_IDLE_MS = 120_000;
/** Tokens whose requests are being counted towards a socket: the newest of them, so that the count cannot grow for ever. */
const COUNTED_TOKENS = 64;
const LOGOUT_PATH = "/api/logout";
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

interface Operation {
  readonly token: string;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/**
 * The request as an operation, or null when it cannot be carried.
 *
 * Carriable: a relative path of the BFF's API (the page asks same-origin, with
 * no base URL), not the event stream, with a bearer token and a body that is
 * JSON text or absent.
 */
export function operationOf(input: unknown, init: RequestInit | undefined): Operation | null {
  if (typeof input !== "string" || !input.startsWith("/api/")) {
    return null;
  }
  const name = input.split("?")[0];
  if (name === "/api/bridge/events" || name === "/api/socket") {
    return null;
  }
  const method = String(init?.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) {
    return null;
  }
  const headers = init?.headers;
  // (A `Headers` object has no entries of its own to read below, so it carries no token here either.)
  if (headers === undefined || headers === null || typeof headers !== "object" || Array.isArray(headers)) {
    return null;
  }
  let token: string | null = null;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === "authorization" && typeof value === "string" && /^Bearer \S+$/.test(value)) {
      token = value.slice("Bearer ".length);
    }
  }
  if (token === null) {
    return null;
  }
  const raw = init?.body;
  if (raw === undefined || raw === null) {
    return { token, method, path: input, body: undefined };
  }
  if (typeof raw !== "string" || method === "GET") {
    return null;
  }
  try {
    return { token, method, path: input, body: JSON.parse(raw) as unknown };
  } catch {
    return null;
  }
}

/** A reply frame as the `Response` a fetch would have answered with. */
export function responseOf(status: unknown, body: unknown): Response {
  const code = typeof status === "number" && Number.isInteger(status) && status >= 200 && status <= 599 ? status : 502;
  // A status that allows no body is given none (the constructor refuses one).
  if (body === null || body === undefined || code === 204 || code === 205 || code === 304) {
    return new Response(null, { status: code });
  }
  return typeof body === "string"
    ? new Response(body, { status: code, headers: { "content-type": "text/plain; charset=utf-8" } })
    : new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json; charset=utf-8" } });
}

interface Waiting {
  readonly operation: Operation;
  readonly input: string;
  readonly init: RequestInit | undefined;
  readonly resolve: (response: Response | PromiseLike<Response>) => void;
  readonly reject: (cause: unknown) => void;
  readonly forget: () => void;
}

interface Listener {
  /** This listening's number, said to the BFF and said back: what is said of another is not this one's. */
  readonly n: number;
  /** The BFF has said this one's stream is attached: frames from here on are its own. */
  open: boolean;
  readonly handlers: PushHandlers;
}

/** One token's socket: not yet open, open, or down until a time (for good when the token was refused). */
interface Line {
  socket: SocketLike | null;
  state: "connecting" | "open" | "down";
  retryAt: number;
  refused: boolean;
  nextID: number;
  /** When something was last asked on it, by the clock handed in. */
  lastAsked: number;
  /** Asked while the socket was connecting: not sent yet. */
  readonly queued: Waiting[];
  /** Sent, and not yet answered. */
  readonly sent: Map<number, Waiting>;
  /** Who is listening to the session's pushed notices on it, if anyone. */
  listener: Listener | null;
}

export function createSocketFetch(deps: SocketFetchDeps): SocketFetch {
  const now = deps.now ?? (() => Date.now());
  const retryMs = deps.retryMs ?? DEFAULT_RETRY_MS;
  const warmUp = deps.warmUp ?? DEFAULT_WARM_UP;
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  const lines = new Map<string, Line>();
  /** How many requests each token without a socket has made. */
  const asked = new Map<string, number>();
  let listenings = 0;

  /** Let a token's socket go: closed if it is there, and nothing kept of it. What waited on it is dealt with as when it goes down. */
  function letGo(token: string): void {
    const line = lines.get(token);
    if (line === undefined) return;
    const socket = line.socket;
    // Let go on purpose (a logout, a socket left idle, the page closing them all): its listener is not sent another way.
    line.listener = null;
    down(line, token, undefined);
    lines.delete(token);
    try {
      socket?.close();
    } catch {
      // Already gone.
    }
  }

  /** Close what has had nothing asked on it for too long, and has nothing waiting. */
  function sweep(keep: string): void {
    for (const [token, line] of lines) {
      if (token === keep || line.queued.length > 0 || line.sent.size > 0 || line.listener !== null) continue;
      if (now() - line.lastAsked >= idleMs) letGo(token);
    }
  }
  let carried = 0;
  let fetched = 0;

  const overHttp = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetched += 1;
    return deps.fetch(input, init);
  };

  function send(line: Line, waiting: Waiting): void {
    const id = (line.nextID += 1);
    line.sent.set(id, waiting);
    try {
      line.socket?.send(JSON.stringify({ id, method: waiting.operation.method, path: waiting.operation.path, body: waiting.operation.body }));
    } catch {
      // It could not be put on the socket at all, so it was not run: over HTTP it goes.
      line.sent.delete(id);
      waiting.forget();
      waiting.resolve(overHttp(waiting.input, waiting.init));
    }
  }

  function down(line: Line, token: string, code: number | undefined): void {
    if (line.state === "down") {
      return;
    }
    const wasOpen = line.state === "open";
    line.state = "down";
    line.socket = null;
    line.refused = !wasOpen && code === NOT_AUTHENTICATED;
    line.retryAt = now() + retryMs;
    // Never sent: nothing of them was run, and HTTP answers them.
    for (const waiting of line.queued.splice(0)) {
      waiting.forget();
      waiting.resolve(overHttp(waiting.input, waiting.init));
    }
    // Sent and unanswered: they may have been run. They fail, as a fetch cut off does.
    for (const waiting of line.sent.values()) {
      waiting.forget();
      waiting.reject(new TypeError(`The socket closed before ${waiting.operation.path} was answered.`));
    }
    line.sent.clear();
    // Whoever listened here is told the socket is not to be had, and is nothing of this line's any more.
    const listener = line.listener;
    line.listener = null;
    listener?.handlers.onUnavailable();
    void token;
  }

  /** Ask the BFF to attach the session's event stream, for the line's listener. */
  function askForPushes(line: Line): void {
    const listener = line.listener;
    if (listener === null) return;
    try {
      line.socket?.send(JSON.stringify({ events: "open", n: listener.n }));
    } catch {
      // It could not be asked for on this socket: another way, then.
      line.listener = null;
      listener.handlers.onUnavailable();
    }
  }

  function connect(token: string): Line {
    const line: Line = lines.get(token) ?? { socket: null, state: "down", retryAt: 0, refused: false, nextID: 0, lastAsked: now(), queued: [], sent: new Map(), listener: null };
    lines.set(token, line);
    line.state = "connecting";
    let socket: SocketLike;
    try {
      socket = deps.openSocket();
    } catch {
      down(line, token, undefined);
      return line;
    }
    line.socket = socket;
    socket.onopen = () => {
      // Ignore a socket this line has already given up on.
      if (line.socket !== socket) return;
      socket.send(JSON.stringify({ hello: { token } }));
    };
    socket.onmessage = (event) => {
      if (line.socket !== socket) return;
      let frame: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        frame = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
      } catch {
        frame = null;
      }
      if (frame === null) {
        return;
      }
      if (frame.hello !== undefined) {
        // (Said again on an open socket, it finds nothing waiting and changes nothing.)
        const wasOpen = line.state === "open";
        line.state = "open";
        for (const waiting of line.queued.splice(0)) send(line, waiting);
        // Listened to before the socket was open: asked for now that it is.
        if (!wasOpen) askForPushes(line);
        return;
      }
      if (frame.events !== undefined) {
        const said = frame.events !== null && typeof frame.events === "object" ? (frame.events as Record<string, unknown>) : {};
        const listener = line.listener;
        // Said of a stream this line has since let go: nothing to the one it has now.
        if (listener === null || said.n !== listener.n) return;
        if (said.open === true) {
          listener.open = true;
          listener.handlers.onOpen();
        } else if (said.ended === true) {
          line.listener = null;
          listener.handlers.onEnded();
        }
        return;
      }
      if (frame.event !== undefined) {
        // A frame that comes before this listener's stream is said to be attached is the last of another's.
        if (line.listener?.open === true) line.listener.handlers.onFrame(frame.event);
        return;
      }
      const id = typeof frame.id === "number" ? frame.id : null;
      const waiting = id === null ? undefined : line.sent.get(id);
      if (id === null || waiting === undefined) {
        return;
      }
      line.sent.delete(id);
      waiting.forget();
      if (frame.error !== undefined) {
        // The BFF says it did not run this as an operation: it is fetched instead.
        waiting.resolve(overHttp(waiting.input, waiting.init));
        return;
      }
      carried += 1;
      try {
        waiting.resolve(responseOf(frame.status, frame.body));
      } catch (cause) {
        waiting.reject(cause);
      }
      // The session was logged out on this socket: nothing more will be asked with its token.
      if (waiting.operation.path.split("?")[0] === LOGOUT_PATH && typeof frame.status === "number" && frame.status < 400) {
        letGo(token);
      }
    };
    socket.onclose = (event) => {
      if (line.socket !== socket) return;
      down(line, token, event?.code);
    };
    socket.onerror = () => {
      // A close follows an error; the close is what is acted on.
    };
    return line;
  }

  const socketFetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const operation = operationOf(input, init);
    if (operation === null) {
      return overHttp(input, init);
    }
    sweep(operation.token);
    let line = lines.get(operation.token);
    if (line === undefined) {
      // Not yet a session that stays: its first requests are fetched, and counted.
      const count = (asked.get(operation.token) ?? 0) + 1;
      if (count <= warmUp) {
        asked.set(operation.token, count);
        if (asked.size > COUNTED_TOKENS) asked.delete(asked.keys().next().value as string);
        return overHttp(input, init);
      }
      asked.delete(operation.token);
    }
    if (line === undefined || (line.state === "down" && !line.refused && now() >= line.retryAt)) {
      line = connect(operation.token);
    }
    if (line.state === "down") {
      return overHttp(input, init);
    }
    line.lastAsked = now();
    const signal = init?.signal ?? null;
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    const current = line;
    return new Promise<Response>((resolve, reject) => {
      let onAbort: (() => void) | null = null;
      const waiting: Waiting = {
        operation,
        input: input as string,
        init,
        resolve,
        reject,
        forget: () => {
          if (onAbort !== null) signal?.removeEventListener("abort", onAbort);
          onAbort = null;
        },
      };
      if (signal) {
        onAbort = () => {
          // Given up on by the asker: its reply, if one comes, has nobody waiting.
          const queuedAt = current.queued.indexOf(waiting);
          if (queuedAt >= 0) current.queued.splice(queuedAt, 1);
          for (const [id, each] of current.sent) if (each === waiting) current.sent.delete(id);
          waiting.forget();
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
      if (current.state === "open") send(current, waiting);
      else current.queued.push(waiting);
    });
  }) as typeof fetch;

  return {
    fetch: socketFetch,
    listen(token, handlers) {
      // A session that is listened to is one that stays: its socket is made now, whatever it has asked so far.
      let line = lines.get(token);
      if (line === undefined || (line.state === "down" && !line.refused && now() >= line.retryAt)) {
        line = connect(token);
      }
      if (line.state === "down") {
        handlers.onUnavailable();
        return { close() {} };
      }
      const current = line;
      const listener: Listener = { n: (listenings += 1), open: false, handlers };
      current.listener = listener;
      if (current.state === "open") askForPushes(current);
      return {
        close() {
          if (current.listener !== listener) return;
          current.listener = null;
          if (current.state !== "open") return;
          try {
            current.socket?.send(JSON.stringify({ events: "close" }));
          } catch {
            // The socket is going: its stream goes with it.
          }
        },
      };
    },
    wouldCarry(input, init) {
      const operation = operationOf(input, init);
      return operation !== null && lines.get(operation.token)?.state === "open";
    },
    stats: () => ({ carried, fetched, open: [...lines.values()].filter((line) => line.state === "open").length }),
    close() {
      for (const token of [...lines.keys()]) letGo(token);
    },
  };
}
