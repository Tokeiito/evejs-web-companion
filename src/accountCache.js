"use strict";

// A short-lived cache for the per-request account lookup on the auth path.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `makeRequireAuth` resolved the caller's account with `store.getAccount()` on
// EVERY authenticated request, and that call is a round trip to the EveJS
// gateway — which lands on the single authoritative world event loop like any
// other owner call. The session token already carries the username and
// accountID; the gateway read existed only to re-check that the account still
// exists and is not banned.
//
// Measured on a live two-client run (2026-08-31, 8 hours): 4,007 of 7,812
// gateway requests — 51% — were this one lookup. Every browser call cost TWO
// owner calls, one of them re-reading a value that had not changed. On the
// build where the gateway ran as a child process each of those was also a full
// IPC round trip whose handler did ~0.01ms of work.
//
// Caching it for a few seconds removes that amplification outright. Nothing
// else about the auth decision changes: the caller still must present a valid
// signed token, the accountID must still match, and a banned account is still
// refused. The ONLY thing that becomes eventually-consistent is how quickly a
// ban or a role change takes effect — bounded by `ttlMs`, five seconds by
// default, and `invalidate()` exists so a path that knows it changed an account
// can drop the entry immediately.
//
// ⚠ SUCCESSFUL LOOKUPS ONLY. A missing account is never cached: a negative
// entry would keep a freshly created account locked out for the whole TTL, and
// the failure path is not the hot one — there is nothing to optimise there.
//
// SINGLE-FLIGHT. The client issues several reads at once (snapshot, flight
// status, targets), so a bare TTL cache would still let a burst of simultaneous
// misses each start its own gateway call. Concurrent misses for one username
// share one in-flight promise, so a burst costs one lookup, not one per request.

const DEFAULT_TTL_MS = 5_000;

// A dev BFF serves a handful of accounts; the cap only stops an unbounded map
// if something ever calls this with attacker-supplied usernames.
const DEFAULT_MAX_ENTRIES = 256;

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

/**
 * @param {object} [options]
 * @param {number} [options.ttlMs]        How long a resolved account stays fresh.
 * @param {number} [options.maxEntries]   Hard cap on cached usernames.
 * @param {() => number} [options.now]    Clock injection, for tests.
 */
function createAccountCache(options = {}) {
  const ttlMs = positiveInteger(
    options.ttlMs !== undefined ? options.ttlMs : process.env.EVEJS_WEB_ACCOUNT_CACHE_MS,
    DEFAULT_TTL_MS,
  );
  const maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const now = typeof options.now === "function" ? options.now : Date.now;

  // username -> { account, expiresAtMs }
  const entries = new Map();
  // username -> Promise<account|null>, for concurrent misses.
  const inFlight = new Map();
  const stats = { hits: 0, misses: 0, coalesced: 0 };

  function evictIfFull() {
    if (entries.size < maxEntries) {
      return;
    }
    // Map preserves insertion order; drop the oldest. Exactness does not matter
    // here — this is a safety valve, not a working-set policy.
    const oldest = entries.keys().next();
    if (!oldest.done) {
      entries.delete(oldest.value);
    }
  }

  function peek(username) {
    const entry = entries.get(username);
    if (!entry) {
      return null;
    }
    if (now() >= entry.expiresAtMs) {
      entries.delete(username);
      return null;
    }
    return entry.account;
  }

  /**
   * Resolve an account, using the cache when it is fresh and `load` otherwise.
   * `load` is only ever called for a cache miss, and only once per username per
   * burst of concurrent misses.
   *
   * @param {string} username
   * @param {() => Promise<object|null>} load
   * @returns {Promise<object|null>}
   */
  async function resolve(username, load) {
    const key = String(username || "");
    if (!key) {
      return null;
    }
    const cached = peek(key);
    if (cached) {
      stats.hits += 1;
      return cached;
    }
    const pending = inFlight.get(key);
    if (pending) {
      stats.coalesced += 1;
      return pending;
    }
    stats.misses += 1;
    const promise = (async () => {
      const account = await load();
      // Only successful lookups are cached; see the note above.
      if (account) {
        evictIfFull();
        entries.set(key, { account, expiresAtMs: now() + ttlMs });
      }
      return account;
    })();
    inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  function invalidate(username) {
    const key = String(username || "");
    if (!key) {
      return false;
    }
    return entries.delete(key);
  }

  function clear() {
    entries.clear();
  }

  function getStats() {
    return { ...stats, size: entries.size, ttlMs };
  }

  return { clear, getStats, invalidate, resolve, ttlMs };
}

module.exports = { createAccountCache, DEFAULT_TTL_MS };
