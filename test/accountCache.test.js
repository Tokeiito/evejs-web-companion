"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createAccountCache, DEFAULT_TTL_MS } = require("../src/accountCache");

function fakeClock(startMs = 1_000_000) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance(ms) {
      nowMs += ms;
    },
  };
}

function accountFor(username, extra = {}) {
  return { username, accountID: 3, banned: false, ...extra };
}

test("a fresh entry is served without calling the loader again", async () => {
  const clock = fakeClock();
  const cache = createAccountCache({ now: clock.now, ttlMs: 5_000 });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return accountFor("rrfarmer");
  };

  const first = await cache.resolve("rrfarmer", load);
  const second = await cache.resolve("rrfarmer", load);
  const third = await cache.resolve("rrfarmer", load);

  assert.equal(loads, 1, "only the first resolve hits the loader");
  assert.equal(second.username, "rrfarmer");
  assert.equal(third, first, "a hit returns the same cached object");
  assert.equal(cache.getStats().hits, 2);
});

test("the entry expires after its TTL and is re-read", async () => {
  const clock = fakeClock();
  const cache = createAccountCache({ now: clock.now, ttlMs: 5_000 });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return accountFor("rrfarmer");
  };

  await cache.resolve("rrfarmer", load);
  clock.advance(4_999);
  await cache.resolve("rrfarmer", load);
  assert.equal(loads, 1, "still fresh one millisecond before the deadline");

  clock.advance(1);
  await cache.resolve("rrfarmer", load);
  assert.equal(loads, 2, "expired exactly at the deadline");
});

test("a ban that lands after the TTL is seen", async () => {
  const clock = fakeClock();
  const cache = createAccountCache({ now: clock.now, ttlMs: 5_000 });
  let banned = false;
  const load = async () => accountFor("rrfarmer", { banned });

  assert.equal((await cache.resolve("rrfarmer", load)).banned, false);
  banned = true;
  // Within the TTL the stale record is still served — this is the documented,
  // bounded cost of caching.
  assert.equal((await cache.resolve("rrfarmer", load)).banned, false);
  clock.advance(5_000);
  assert.equal((await cache.resolve("rrfarmer", load)).banned, true);
});

test("invalidate drops the entry immediately", async () => {
  const clock = fakeClock();
  const cache = createAccountCache({ now: clock.now, ttlMs: 60_000 });
  let loads = 0;
  const load = async () => {
    loads += 1;
    return accountFor("rrfarmer");
  };

  await cache.resolve("rrfarmer", load);
  assert.equal(cache.invalidate("rrfarmer"), true);
  await cache.resolve("rrfarmer", load);
  assert.equal(loads, 2, "the invalidated entry was re-read despite a long TTL");
});

test("concurrent misses share ONE loader call", async () => {
  const clock = fakeClock();
  const cache = createAccountCache({ now: clock.now, ttlMs: 5_000 });
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const load = async () => {
    loads += 1;
    await gate;
    return accountFor("rrfarmer");
  };

  // The client fires snapshot + flight-status + targets at once; a bare TTL
  // cache would let all three start their own gateway call.
  const all = Promise.all([
    cache.resolve("rrfarmer", load),
    cache.resolve("rrfarmer", load),
    cache.resolve("rrfarmer", load),
  ]);
  release();
  const results = await all;

  assert.equal(loads, 1, "three simultaneous misses cost one lookup");
  assert.equal(results[0].username, "rrfarmer");
  assert.equal(results[1], results[0]);
  assert.equal(results[2], results[0]);
  assert.equal(cache.getStats().coalesced, 2);
});

test("a missing account is never cached", async () => {
  const clock = fakeClock();
  const cache = createAccountCache({ now: clock.now, ttlMs: 60_000 });
  let loads = 0;
  let exists = false;
  const load = async () => {
    loads += 1;
    return exists ? accountFor("newbie") : null;
  };

  assert.equal(await cache.resolve("newbie", load), null);
  assert.equal(await cache.resolve("newbie", load), null);
  assert.equal(loads, 2, "a negative result is re-read, not cached");

  // A freshly created account is visible at once rather than after the TTL.
  exists = true;
  assert.equal((await cache.resolve("newbie", load)).username, "newbie");
  assert.equal(loads, 3);
});

test("entries are capped so the map cannot grow without bound", async () => {
  const clock = fakeClock();
  const cache = createAccountCache({ now: clock.now, ttlMs: 60_000, maxEntries: 4 });
  for (let index = 0; index < 10; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await cache.resolve(`user${index}`, async () => accountFor(`user${index}`));
  }
  assert.ok(cache.getStats().size <= 4, `size ${cache.getStats().size} stayed within the cap`);
});

test("an empty username never reaches the loader", async () => {
  const cache = createAccountCache();
  let loads = 0;
  const result = await cache.resolve("", async () => {
    loads += 1;
    return accountFor("x");
  });
  assert.equal(result, null);
  assert.equal(loads, 0);
});

test("the shipped default TTL is short enough to bound a stale ban", () => {
  assert.ok(DEFAULT_TTL_MS <= 10_000, "default TTL stays in seconds, not minutes");
  assert.equal(createAccountCache().ttlMs, DEFAULT_TTL_MS);
});
