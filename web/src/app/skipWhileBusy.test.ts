// The in-flight guard for periodic reads (goal R92).
//
// These are mostly about what must NOT happen: a second request while the first
// is outstanding, a rejection escaping into a timer callback, and a guard that
// stays stuck after a failure.

import test from "node:test";
import assert from "node:assert/strict";

import { skipWhileBusy } from "./skipWhileBusy.ts";

/** A read the test decides when to answer. */
function deferred(): { promise: Promise<void>; settle: () => void; fail: () => void } {
  let settle = (): void => {};
  let fail = (): void => {};
  const promise = new Promise<void>((resolve, reject) => {
    settle = () => resolve();
    fail = () => reject(new Error("the connection to the server dropped"));
  });
  return { promise, settle, fail };
}

test("a beat while a read is outstanding is SKIPPED, not queued", async () => {
  // ⚠ The whole point. Queueing here is what fills the browser's ~6 connections
  // with stalled polls and makes every OTHER request in the tab fail to send.
  let calls = 0;
  const pending = deferred();
  const poll = skipWhileBusy(() => {
    calls += 1;
    return pending.promise;
  });

  void poll();
  void poll();
  void poll();
  await Promise.resolve();

  assert.equal(calls, 1, "three beats must produce ONE request");
  assert.equal(poll.skipped(), 2);
  pending.settle();
});

test("the next beat after the read comes back runs normally", async () => {
  let calls = 0;
  let pending = deferred();
  const poll = skipWhileBusy(() => {
    calls += 1;
    return pending.promise;
  });

  const first = poll();
  pending.settle();
  await first;

  pending = deferred();
  const second = poll();
  assert.equal(calls, 2, "the guard must not latch shut");
  pending.settle();
  await second;
});

test("a FAILED read releases the guard", async () => {
  // ⚠ A guard that survives a rejection is worse than no guard: the panel stops
  // polling for good, silently, and the first sign of it is stale data that
  // never recovers. Failure is the common case here — this only matters when
  // the server is having trouble.
  let calls = 0;
  let pending = deferred();
  const poll = skipWhileBusy(() => {
    calls += 1;
    return pending.promise;
  });

  const first = poll();
  pending.fail();
  await first;

  pending = deferred();
  void poll();
  assert.equal(calls, 2, "one failed read stopped the poll for ever");
  pending.settle();
});

test("a failed read NEVER rejects out of the guard", async () => {
  // It is called from a `setInterval` callback, where a rejection is an
  // unhandled promise rejection — which this app's error overlay turns into a
  // page-covering script error for one dropped poll.
  const poll = skipWhileBusy(() => Promise.reject(new Error("dropped")));
  await poll();
});

test("a read that throws SYNCHRONOUSLY is contained too", async () => {
  const poll = skipWhileBusy(() => {
    throw new Error("decode blew up");
  });
  await poll();
  assert.equal(poll.busy(), false, "a synchronous throw must still release the guard");
});

test("busy() reports what is actually outstanding", async () => {
  const pending = deferred();
  const poll = skipWhileBusy(() => pending.promise);
  assert.equal(poll.busy(), false);
  const run = poll();
  assert.equal(poll.busy(), true);
  pending.settle();
  await run;
  assert.equal(poll.busy(), false);
});

test("the skip COUNT is the server telling you it cannot keep up", async () => {
  // Worth having: a climbing count is the evidence that a panel is polling
  // faster than the server can answer, which is otherwise invisible.
  const pending = deferred();
  const poll = skipWhileBusy(() => pending.promise);
  void poll();
  for (let beat = 0; beat < 5; beat += 1) {
    void poll();
  }
  assert.equal(poll.skipped(), 5);
  pending.settle();
});

test("a read that answers promptly never skips a beat", async () => {
  const poll = skipWhileBusy(() => Promise.resolve());
  await poll();
  await poll();
  await poll();
  assert.equal(poll.skipped(), 0, "the healthy case must be unaffected");
});
