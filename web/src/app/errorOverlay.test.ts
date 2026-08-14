// The one thing the error surface deliberately does NOT report.
//
// Filtering an error surface is how an error surface becomes useless, so the
// filter is exactly one known browser notice and these tests exist to keep it
// that way: everything that is actually an error must still get through.

import test from "node:test";
import assert from "node:assert/strict";

import { isBenignBrowserNotice } from "./errorOverlay.ts";

test("the ResizeObserver notice is swallowed, in both of its wordings", () => {
  // Not a script error: the browser is saying it deferred some resize
  // observations to the next frame to avoid re-dirtying layout. The page keeps
  // working, so the overlay's "the page may have stopped updating" headline
  // would be false and alarming.
  assert.equal(
    isBenignBrowserNotice("ResizeObserver loop completed with undelivered notifications."),
    true,
  );
  assert.equal(isBenignBrowserNotice("ResizeObserver loop limit exceeded"), true);
  // As it arrives from window.onerror, wrapped by the browser.
  assert.equal(
    isBenignBrowserNotice("Uncaught ResizeObserver loop completed with undelivered notifications."),
    true,
  );
});

test("a REAL error is never swallowed", () => {
  for (const message of [
    "TypeError: Cannot read properties of null (reading 'itemID')",
    "each_key_duplicate",
    "Unhandled promise rejection: bridge call failed",
    "Script error.",
    "",
  ]) {
    assert.equal(isBenignBrowserNotice(message), false, `"${message}" must be reported`);
  }
});

test("both halves of the match are required, so the filter cannot widen by accident", () => {
  // ⚠ A message merely mentioning ResizeObserver is NOT the benign notice — a
  // genuine crash inside an observer callback says so and must reach the
  // overlay. Equally, "limit exceeded" belongs to plenty of real errors.
  assert.equal(
    isBenignBrowserNotice("TypeError: ResizeObserver callback threw"),
    false,
    "a crash inside an observer is a real error",
  );
  assert.equal(
    isBenignBrowserNotice("ResizeObserver loop something else entirely"),
    false,
  );
  assert.equal(
    isBenignBrowserNotice("Quota limit exceeded writing to localStorage"),
    false,
    "an unrelated limit-exceeded error must be reported",
  );
  assert.equal(
    isBenignBrowserNotice("undelivered notifications from the push channel"),
    false,
  );
});

test("a non-string message is not treated as benign", () => {
  assert.equal(isBenignBrowserNotice(undefined as unknown as string), false);
  assert.equal(isBenignBrowserNotice(null as unknown as string), false);
});
