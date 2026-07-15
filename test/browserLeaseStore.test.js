"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createBrowserLeaseStore } = require("../src/browserLeaseStore");

test("lease credentials stay isolated by web session and character", () => {
  const store = createBrowserLeaseStore();
  store.put("session-a", 4, 7, {
    leaseID: "lease-a",
    leaseSecret: "secret-a",
    leaseExpiresAt: "2099-07-15T12:01:00.000Z",
  });
  store.put("session-a", 4, 8, {
    leaseID: "lease-b",
    leaseSecret: "secret-b",
  });
  store.put("session-b", 5, 7, {
    leaseID: "lease-c",
    leaseSecret: "secret-c",
  });

  const first = store.get("session-a", 7);
  assert.equal(first.accountID, 4);
  assert.equal(first.leaseSecret, "secret-a");
  first.leaseSecret = "changed-copy";
  assert.equal(store.get("session-a", 7).leaseSecret, "secret-a");
  assert.equal(store.get("session-b", 7).leaseSecret, "secret-c");
  assert.deepEqual(
    store.listForSession("session-a").map((record) => record.characterID).sort(),
    [7, 8],
  );

  assert.equal(store.remove("session-a", 7), true);
  assert.equal(store.get("session-a", 7), null);
  assert.equal(store.get("session-b", 7).leaseID, "lease-c");
  assert.equal(store.clearSession("session-a"), true);
  assert.deepEqual(store.listForSession("session-a"), []);
});

test("incomplete lease credentials are rejected", () => {
  const store = createBrowserLeaseStore();
  assert.throws(
    () => store.put("session-a", 4, 7, { leaseID: "lease-a" }),
    /Complete browser lease credentials/,
  );
  assert.deepEqual(store.listForSession("session-a"), []);
});

test("expired secrets are removed while a bounded secret-free marker remains", () => {
  let nowMs = Date.parse("2026-07-15T12:00:00.000Z");
  const timers = [];
  const cleared = [];
  const store = createBrowserLeaseStore({
    now: () => nowMs,
    setTimer(callback, delayMs) {
      const handle = { callback, delayMs };
      timers.push(handle);
      return handle;
    },
    clearTimer(handle) {
      cleared.push(handle);
    },
  });

  store.put("session-a", 4, 7, {
    leaseID: "lease-a",
    leaseSecret: "secret-a",
    leaseExpiresAt: "2026-07-15T12:01:00.000Z",
  });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 60_000);

  nowMs += 60_000;
  timers[0].callback();
  assert.equal(store.get("session-a", 7), null);
  assert.equal(store.getLeaseStatus("session-a", 7), "expired");
  assert.deepEqual(store.listForSession("session-a"), []);
  assert.equal(timers[1].delayMs, 15 * 60_000);

  assert.equal(store.remove("session-a", 7), true);
  assert.equal(store.getLeaseStatus("session-a", 7), "missing");

  store.put("session-a", 4, 8, {
    leaseID: "lease-b",
    leaseSecret: "secret-b",
    leaseExpiresAt: "2026-07-15T12:02:00.000Z",
  });
  nowMs += 120_000;
  assert.deepEqual(store.listForSession("session-a"), []);
  assert.equal(store.getLeaseStatus("session-a", 8), "expired");
  assert.equal(cleared.length >= 1, true);
});
