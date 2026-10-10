// Which way the page's requests go: over HTTP, or on the tab's socket.
//
// The plan's Phase 6a (docs/game-port-transport-plan.md) moves the page's
// requests from one HTTP request each to frames on one socket
// (app/socketFetch.ts). This is where that is chosen, in one place, for the
// three sites that ask: `requestJson` (app/api.ts), `callMethod`
// (bridge/callMethod.ts) and the fleet's fenced fetch (app/flow.ts).
//
// ⚠ IT IS A SETTING, AND HTTP IS WHAT IT IS UNLESS SAID. The routes still stand
// over HTTP and the event stream still carries the pushes; the socket carries
// requests beside them. Set `evejs-web-transport:v1` to "socket" in this
// browser's local storage and reload to have requests carried on it; remove
// the key, or set anything else, to go back.
//
// ⚠ NOT IN NODE. The hosted bots run this same code in the BFF's process
// (src/botHost.js) with a fetch of their own, and there is no page there: with
// no `location` or no `WebSocket`, the answer is the world's fetch, whatever
// the setting says.

import { createSocketFetch, type SocketFetch, type SocketLike } from "./socketFetch.ts";

export const TRANSPORT_SETTING_KEY = "evejs-web-transport:v1";

export type PageTransport = "socket" | "http";

/** What the setting says. Storage that cannot be read (a private window, a test) says HTTP. */
export function transportSetting(storage: Pick<Storage, "getItem"> | null = pageStorage()): PageTransport {
  try {
    return storage?.getItem(TRANSPORT_SETTING_KEY) === "socket" ? "socket" : "http";
  } catch {
    return "http";
  }
}

function pageStorage(): Pick<Storage, "getItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The socket's address, from the page's own: the same host, `wss` where the page is `https`. */
export function socketAddress(at: Pick<Location, "protocol" | "host">): string {
  return `${at.protocol === "https:" ? "wss" : "ws"}://${at.host}/api/socket`;
}

let carried: SocketFetch | null = null;

/** The socket's fetch, once made: for the page to say how much went which way. Null while requests go over HTTP. */
export function socketTransport(): SocketFetch | null {
  return carried;
}

/**
 * The fetch the page's requests are made with.
 *
 * Asked at each request, not once: the setting is read as it stands, so a page
 * that is told to go back does so at its next request, and the socket's fetch
 * is made only when one is first wanted.
 */
export function pageFetch(): typeof fetch {
  if (typeof location === "undefined" || typeof WebSocket === "undefined" || transportSetting() !== "socket") {
    return globalThis.fetch;
  }
  carried ??= createSocketFetch({
    fetch: (input, init) => globalThis.fetch(input, init),
    openSocket: () => socketOver(new WebSocket(socketAddress(location))),
  });
  return carried.fetch;
}

/** The browser's socket as the little of one the socket's fetch asks for. */
export function socketOver(socket: WebSocket): SocketLike {
  const like: SocketLike = {
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.onopen = (event) => like.onopen?.(event);
  socket.onmessage = (event) => like.onmessage?.({ data: event.data });
  socket.onclose = (event) => like.onclose?.({ code: event.code });
  socket.onerror = (event) => like.onerror?.(event);
  return like;
}
