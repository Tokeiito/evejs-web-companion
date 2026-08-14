// The dock / undock transition (goal R75): it plays on a real change and never
// on the first reading — which is what stops every login and every page refresh
// from blacking the screen for a docking that did not happen.

import test from "node:test";
import assert from "node:assert/strict";

import { DOCK_WIPE_MS, dockWipeLabel, shouldPlayDockWipe } from "./dockTransition.ts";

test("undocking plays the transition", () => {
  assert.equal(shouldPlayDockWipe(true, false), true);
});

test("docking plays the transition", () => {
  assert.equal(shouldPlayDockWipe(false, true), true);
});

test("no change plays nothing", () => {
  assert.equal(shouldPlayDockWipe(true, true), false);
  assert.equal(shouldPlayDockWipe(false, false), false);
});

test("the FIRST reading never plays, whichever state it is", () => {
  // ⚠ The failure this exists to prevent: a pilot signing in while docked
  // produces a first `isDocked` of true out of nowhere, and "it differs from my
  // default, so animate" blacks the screen on every login and every refresh.
  assert.equal(shouldPlayDockWipe(null, true), false);
  assert.equal(shouldPlayDockWipe(null, false), false);
});

test("the reading is three-valued for a reason", () => {
  // If `previous` defaulted to `false` instead of `null`, "signed in while in
  // space" and "just undocked" would be the same input — and one of them must
  // not animate. This is that claim, written down.
  assert.equal(shouldPlayDockWipe(null, false), false, "signed in while in space: no wipe");
  assert.equal(shouldPlayDockWipe(true, false), true, "actually undocked: wipe");
});

test("the transition says which way it went", () => {
  assert.equal(dockWipeLabel(true), "Docking");
  assert.equal(dockWipeLabel(false), "Undocking");
});

test("the transition is short enough not to be in the way", () => {
  // A fade is atmosphere; a wait is a bug. Anything past about a second stops
  // reading as a transition and starts reading as the client having hung.
  assert.ok(DOCK_WIPE_MS > 200, "too short to register as a transition");
  assert.ok(DOCK_WIPE_MS < 1000, "long enough to feel like a stall");
});
