// Unit tests for the plain-signal primitive under the client-state store
// (goal R1b). Runs under node --test via native TypeScript type stripping.

import test from "node:test";
import assert from "node:assert/strict";

import { createSignal, readonlySignal } from "./signals.ts";

test("subscribe calls the listener synchronously with the current value (Svelte store contract)", () => {
  const signal = createSignal(7);
  const seen: number[] = [];
  signal.subscribe((value) => seen.push(value));
  assert.deepEqual(seen, [7]);
});

test("set notifies subscribers with the new value; get reads it", () => {
  const signal = createSignal("idle");
  const seen: string[] = [];
  signal.subscribe((value) => seen.push(value));
  signal.set("connected");
  assert.deepEqual(seen, ["idle", "connected"]);
  assert.equal(signal.get(), "connected");
});

test("setting an Object.is-equal value does not notify", () => {
  const state = { phase: "logged-out" };
  const signal = createSignal(state);
  let calls = 0;
  signal.subscribe(() => {
    calls += 1;
  });
  signal.set(state);
  signal.set(state);
  assert.equal(calls, 1, "only the immediate subscribe call");
});

test("update derives the next value from the current one", () => {
  const signal = createSignal(1);
  signal.update((value) => value + 41);
  assert.equal(signal.get(), 42);
});

test("unsubscribe stops notifications without affecting other listeners", () => {
  const signal = createSignal(0);
  const first: number[] = [];
  const second: number[] = [];
  const unsubscribe = signal.subscribe((value) => first.push(value));
  signal.subscribe((value) => second.push(value));
  unsubscribe();
  signal.set(1);
  assert.deepEqual(first, [0]);
  assert.deepEqual(second, [0, 1]);
});

test("readonlySignal exposes get/subscribe but no setter surface", () => {
  const signal = createSignal(3);
  const readable = readonlySignal(signal);
  assert.equal(readable.get(), 3);
  const seen: number[] = [];
  readable.subscribe((value) => seen.push(value));
  signal.set(4);
  assert.deepEqual(seen, [3, 4]);
  assert.equal((readable as { set?: unknown }).set, undefined);
  assert.equal((readable as { update?: unknown }).update, undefined);
});
