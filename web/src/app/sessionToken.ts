// R42 — the web session token, held PER TAB.
//
// The BFF used to hand the signed login token out as an httpOnly cookie and
// nothing else. Cookies belong to the browser profile, not to the tab, so a
// second tab logging in as another account overwrote the first tab's session
// and every open tab collapsed onto the last account to sign in. The operator
// wants ten tabs running ten accounts, so the token now lives in
// `sessionStorage` — which is per-tab by specification, and survives a reload
// of that tab — and is sent as `Authorization: Bearer <token>`.
//
// SECURITY TRADE, DELIBERATE AND LOCAL TO THIS POC: a token this module can
// read is a token an XSS bug can steal. `httpOnly` existed to stop exactly
// that, and moving off it gives that protection up. Acceptable HERE because
// the BFF is a companion to a local dev emulator whose login accepts ANY
// password for ANY existing username (src/server.js /api/login, goal R1) —
// there is no secret left to protect. DO NOT COPY THIS into anything a network
// can reach; see the matching note above `setSessionCookie` in src/server.js.
//
// There is no per-call token override here on purpose. In a browser each tab is
// its own JavaScript realm with its own copy of this module, so "the module's
// token" IS "this tab's token" — modelling several tokens inside one realm
// would model something that cannot happen.

const STORAGE_KEY = "evejs_web_poc_session";

/** The slice of `Storage` this module needs; tests supply their own. */
export interface SessionTokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function detectStorage(): SessionTokenStorage | null {
  try {
    const candidate = (globalThis as { sessionStorage?: SessionTokenStorage | null })
      .sessionStorage;
    if (
      candidate &&
      typeof candidate.getItem === "function" &&
      typeof candidate.setItem === "function" &&
      typeof candidate.removeItem === "function"
    ) {
      return candidate;
    }
  } catch {
    // Some privacy modes throw on even touching sessionStorage. Fall back to
    // the in-memory copy below: the tab still works, it just forgets on reload.
  }
  return null;
}

let storage: SessionTokenStorage | null = detectStorage();
let cachedToken: string | null = null;

/**
 * Point this module at a different store (tests, and any host with no
 * sessionStorage). Passing null forces the in-memory fallback.
 */
export function setSessionTokenStorage(next: SessionTokenStorage | null): void {
  storage = next;
  cachedToken = null;
}

/** Remember this tab's session token. Passing null/"" forgets it. */
export function setSessionToken(token: string | null): void {
  cachedToken = typeof token === "string" && token.length > 0 ? token : null;
  if (!storage) {
    return;
  }
  try {
    if (cachedToken === null) {
      storage.removeItem(STORAGE_KEY);
    } else {
      storage.setItem(STORAGE_KEY, cachedToken);
    }
  } catch {
    // A full or unavailable store costs persistence across a reload, not the
    // session: cachedToken still carries it for the life of this page.
  }
}

/** This tab's session token, or null when it is signed out. */
export function getSessionToken(): string | null {
  if (storage) {
    try {
      const stored = storage.getItem(STORAGE_KEY);
      if (typeof stored === "string" && stored.length > 0) {
        return stored;
      }
    } catch {
      // Fall through to the in-memory copy.
    }
  }
  return cachedToken;
}

/** Sign this tab out locally. The BFF clears its cookie separately. */
export function clearSessionToken(): void {
  setSessionToken(null);
}

/**
 * The Authorization header for this tab, or nothing at all when signed out —
 * an absent header lets the legacy cookie carry the request during migration,
 * where an empty one would not.
 */
export function sessionAuthHeaders(): Readonly<Record<string, string>> {
  const token = getSessionToken();
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

/**
 * Put the token in a URL's query string. ONLY for the SSE stream, whose
 * `EventSource` cannot set headers — see `requireStreamAuth` in src/server.js
 * for why a credential in a URL is tolerable there and refused everywhere else.
 */
export function withSessionTokenQuery(url: string): string {
  const token = getSessionToken();
  if (token === null) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
}
