// The R23 slice A store slice: what is locked, what is still being acquired,
// and how the two failure modes are kept apart.
//
// The lifecycle resets are the part most likely to rot, so they are pinned
// hardest: a docked ship has no locks and nothing cycling, and carrying either
// across a dock, a character swap or a logout would be a lie the moment the
// page rendered it.

import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "./clientStore.ts";

const ROCK_ID = 50001248;
const OTHER_ID = 50001249;

test("the slice starts empty and unloaded", () => {
  const state = createClientStore().targeting.get();
  assert.deepEqual(state.lockedTargetIDs, []);
  assert.deepEqual(state.acquiringTargetIDs, []);
  assert.equal(state.loaded, false);
  assert.equal(state.actionError, null);
  assert.equal(state.silentDecline, null);
});

test("the server's target list replaces the slice wholesale", () => {
  const store = createClientStore();
  store.apply({ type: "targeting/targets", targetIDs: [ROCK_ID, OTHER_ID] });
  assert.deepEqual(store.targeting.get().lockedTargetIDs, [ROCK_ID, OTHER_ID]);
  assert.equal(store.targeting.get().loaded, true);

  // A later read that drops one is the whole truth, not a merge: the server is
  // the only authority on what is locked.
  store.apply({ type: "targeting/targets", targetIDs: [OTHER_ID] });
  assert.deepEqual(store.targeting.get().lockedTargetIDs, [OTHER_ID]);
});

test("an acquiring note is retired as soon as the target appears in the locked list", () => {
  const store = createClientStore();
  store.apply({ type: "targeting/acquiring", targetID: ROCK_ID });
  assert.deepEqual(store.targeting.get().acquiringTargetIDs, [ROCK_ID]);

  store.apply({ type: "targeting/targets", targetIDs: [ROCK_ID] });
  const state = store.targeting.get();
  assert.deepEqual(state.lockedTargetIDs, [ROCK_ID]);
  assert.deepEqual(state.acquiringTargetIDs, [], "it landed, so stop saying 'Locking…'");
});

test("an acquiring note is never duplicated, and never shadows a landed lock", () => {
  const store = createClientStore();
  store.apply({ type: "targeting/acquiring", targetID: ROCK_ID });
  store.apply({ type: "targeting/acquiring", targetID: ROCK_ID });
  assert.deepEqual(store.targeting.get().acquiringTargetIDs, [ROCK_ID]);

  store.apply({ type: "targeting/targets", targetIDs: [ROCK_ID] });
  store.apply({ type: "targeting/acquiring", targetID: ROCK_ID });
  assert.deepEqual(
    store.targeting.get().acquiringTargetIDs,
    [],
    "something already locked is not 'being acquired'",
  );
});

test("a refusal and a silent decline are separate fields, and a success clears both", () => {
  const store = createClientStore();
  store.apply({ type: "targeting/action-error", message: "Lock refused: TargetTooFar" });
  store.apply({ type: "targeting/silent-decline", message: "…and gave no reason." });
  let state = store.targeting.get();
  assert.match(state.actionError ?? "", /TargetTooFar/);
  assert.match(state.silentDecline ?? "", /no reason/);

  // Both described the PREVIOUS action.
  store.apply({ type: "targeting/action", action: "Lock" });
  state = store.targeting.get();
  assert.equal(state.lastAction, "Lock");
  assert.equal(state.actionError, null);
  assert.equal(state.silentDecline, null);
});

// --- Lifecycle: nothing survives a dock, a swap or a logout ------------------

test("docking clears the slice — a docked ship has no locks", () => {
  const store = createClientStore();
  store.apply({ type: "targeting/targets", targetIDs: [ROCK_ID] });
  store.apply({ type: "targeting/acquiring", targetID: OTHER_ID });

  store.apply({ type: "space/cleared" });
  const state = store.targeting.get();
  assert.deepEqual(state.lockedTargetIDs, []);
  assert.deepEqual(state.acquiringTargetIDs, []);
  assert.equal(state.loaded, false);
});

test("a character swap and a logout each clear the slice too", () => {
  for (const event of [
    { type: "character/offline" } as const,
    { type: "session/logged-out" } as const,
  ]) {
    const store = createClientStore();
    store.apply({ type: "targeting/targets", targetIDs: [ROCK_ID] });
    store.apply({ type: "targeting/action-error", message: "stale" });
    store.apply(event);
    const state = store.targeting.get();
    assert.deepEqual(state.lockedTargetIDs, [], `${event.type} must clear the locks`);
    assert.equal(state.actionError, null, `${event.type} must clear the refusal`);
  }
});

test("one apply produces exactly one store notification", () => {
  const store = createClientStore();
  let notifications = 0;
  const stop = store.subscribe(() => {
    notifications += 1;
  });
  notifications = 0; // subscribe fires once with the current value
  store.apply({ type: "targeting/targets", targetIDs: [ROCK_ID] });
  assert.equal(notifications, 1);
  stop();
});
