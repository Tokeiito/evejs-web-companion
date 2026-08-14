// The shared in-space selection (goal R70): one picked object across the
// viewport and the overview, a selection that is never silently retargeted, and
// a vanish check that knows the "Somewhere else…" row is not a ball in space.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SELECTION_GONE,
  SOMEWHERE_ELSE,
  createSpaceSelection,
  selectionHasVanished,
  spaceSelection,
} from "./selection.ts";

test("nothing is picked to begin with", () => {
  const selection = createSpaceSelection();
  assert.equal(selection.selected.get(), null);
  assert.equal(selection.notice.get(), "");
});

test("select picks the object", () => {
  const selection = createSpaceSelection();
  selection.select(4242);
  assert.equal(selection.selected.get(), 4242);
});

test("toggle picks, then unpicks the same object", () => {
  const selection = createSpaceSelection();
  selection.toggle(7);
  assert.equal(selection.selected.get(), 7);
  selection.toggle(7);
  assert.equal(selection.selected.get(), null);
});

test("toggle on a DIFFERENT object moves the selection rather than clearing it", () => {
  const selection = createSpaceSelection();
  selection.toggle(7);
  selection.toggle(9);
  assert.equal(selection.selected.get(), 9);
});

test("a subscriber is told the moment the selection changes", () => {
  // This is the whole point of the module: the viewport and the overview both
  // subscribe, so a click in one repaints the other.
  const selection = createSpaceSelection();
  const seen: (number | null)[] = [];
  const stop = selection.selected.subscribe((value) => seen.push(value));
  selection.select(11);
  selection.clear();
  stop();
  selection.select(99);
  // Svelte store contract: the current value arrives synchronously on subscribe.
  assert.deepEqual(seen, [null, 11, null]);
});

test("a fresh pick clears the reason the last selection went away", () => {
  const selection = createSpaceSelection();
  selection.dropWithNotice(SELECTION_GONE);
  assert.equal(selection.notice.get(), SELECTION_GONE);
  selection.select(3);
  assert.equal(selection.notice.get(), "", "a stale notice must not haunt a new pick");
});

test("dropping with a notice clears the selection AND says why", () => {
  const selection = createSpaceSelection();
  selection.select(3);
  selection.dropWithNotice(SELECTION_GONE);
  assert.equal(selection.selected.get(), null);
  assert.equal(selection.notice.get(), SELECTION_GONE);
});

test("clearing on the player's own say-so says nothing", () => {
  // A player who unpicks something does not need to be told they did.
  const selection = createSpaceSelection();
  selection.select(3);
  selection.clear();
  assert.equal(selection.selected.get(), null);
  assert.equal(selection.notice.get(), "");
});

test("a notice can be dismissed without touching the selection", () => {
  const selection = createSpaceSelection();
  selection.dropWithNotice(SELECTION_GONE);
  selection.select(5);
  selection.dropWithNotice("something else");
  selection.clearNotice();
  assert.equal(selection.notice.get(), "");
  assert.equal(selection.selected.get(), null);
});

test("two selections built separately do not share state", () => {
  // The factory is what lets a test hold one no other test can reach.
  const a = createSpaceSelection();
  const b = createSpaceSelection();
  a.select(1);
  assert.equal(b.selected.get(), null);
});

test("the app's shared selection is a real selection", () => {
  assert.equal(typeof spaceSelection.toggle, "function");
  assert.ok(spaceSelection.selected.get() === null || typeof spaceSelection.selected.get() === "number");
});

// --- the vanish check --------------------------------------------------------

test("a selection still on the grid has not vanished", () => {
  assert.equal(selectionHasVanished(5, new Set([1, 5, 9])), false);
});

test("a selection that left the grid has vanished", () => {
  assert.equal(selectionHasVanished(5, new Set([1, 9])), true);
});

test("nothing picked never counts as vanished", () => {
  assert.equal(selectionHasVanished(null, new Set()), false);
});

test("the Somewhere else row is never announced as vanished", () => {
  // It is not a ball in space, so it can never leave one. Without this the panel
  // would announce it as destroyed on every single poll.
  assert.equal(selectionHasVanished(SOMEWHERE_ELSE, new Set()), false);
  assert.equal(selectionHasVanished(SOMEWHERE_ELSE, new Set([1, 2])), false);
});

test("the Somewhere else sentinel cannot collide with a real object id", () => {
  // Every itemID the server issues is positive.
  assert.ok(SOMEWHERE_ELSE < 0);
});
