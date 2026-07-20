// The R23 slice B store slice. The interesting part is the LIFECYCLE, because
// the mining slice is the one slice whose right answer at a dock is "keep it".
//
// Docking clears the space and targeting slices — a docked ship sees nothing
// and has no locks. But docking is exactly where the rest of the mining loop
// happens: unload, quote, refine. Wiping the holds the moment the ship docks
// would blank the panel precisely when the player starts using it. Only the
// SURVEY goes, because it described rocks in a system the ship left.

import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "./clientStore.ts";

const ORE_STACK_ID = 8800001;

const HOLDS = [
  {
    key: "ore",
    label: "Ore hold",
    present: true,
    capacity: { capacity: 5000, used: 120 },
    items: [{ itemID: ORE_STACK_ID, typeID: 1230, quantity: 500 }],
    error: null,
  },
];

const SURVEY = [{ itemID: 50001248, yieldTypeID: 1230, remainingQuantity: 4200 }];

test("the slice starts empty, and the tax starts UNKNOWN rather than free", () => {
  const state = createClientStore().mining.get();
  assert.deepEqual(state.holds, []);
  assert.equal(state.holdsLoaded, false);
  assert.deepEqual(state.survey, []);
  assert.equal(
    state.taxRate,
    null,
    "a 0 before any quote would tell the player the refinery is free",
  );
});

test("a clean holds read clears the panel error but keeps each hold's own", () => {
  const store = createClientStore();
  store.apply({ type: "mining/holds-error", message: "boom" });
  store.apply({
    type: "mining/holds",
    holds: [{ ...HOLDS[0]!, error: "READ_FAILED" }] as never,
  });
  const state = store.mining.get();
  assert.equal(state.holdsError, null, "the panel-level error is cleared");
  assert.equal(state.holds[0]?.error, "READ_FAILED", "the per-hold error survives");
  assert.equal(state.holdsLoaded, true);
});

test("⚠ a failed quote CLEARS the previous one — a stale quote could arm a wrong confirm", () => {
  const store = createClientStore();
  store.apply({
    type: "mining/quotes",
    quotes: [{ itemID: ORE_STACK_ID, typeID: 1230, quantityToProcess: 500, leftOvers: 0, iskCost: 1, outputs: [] }],
    taxRate: 0.05,
    quotesFor: [ORE_STACK_ID],
  });
  assert.equal(store.mining.get().quotes.length, 1);

  store.apply({ type: "mining/quotes-error", message: "Dock first." });
  const state = store.mining.get();
  assert.deepEqual(state.quotes, []);
  assert.deepEqual(state.quotesFor, []);
  assert.equal(state.taxRate, null);
  assert.match(state.quotesError ?? "", /Dock first/);
});

test("a refusal and a silent decline are separate, and a success clears both", () => {
  const store = createClientStore();
  store.apply({ type: "mining/action-error", message: "Unload refused: NOT_DOCKED" });
  store.apply({ type: "mining/silent-decline", message: "…and gave no reason." });
  store.apply({ type: "mining/action", action: "Unload" });
  const state = store.mining.get();
  assert.equal(state.lastAction, "Unload");
  assert.equal(state.actionError, null);
  assert.equal(state.silentDecline, null);
});

// --- Lifecycle --------------------------------------------------------------

test("⚠ docking KEEPS the holds — that is when the player unloads and refines", () => {
  const store = createClientStore();
  store.apply({ type: "mining/holds", holds: HOLDS as never });
  store.apply({ type: "mining/survey", survey: SURVEY as never, atMs: 123 });

  store.apply({ type: "space/cleared" });
  const state = store.mining.get();
  assert.equal(state.holds.length, 1, "the ore is still in the hold; the panel must still show it");
  assert.equal(state.holdsLoaded, true);
  // ...but the survey described rocks in a system the ship is no longer in.
  assert.deepEqual(state.survey, []);
  assert.equal(state.surveyAtMs, null);
});

test("a character swap and a logout DO clear the whole slice", () => {
  for (const event of [
    { type: "character/offline" } as const,
    { type: "session/logged-out" } as const,
  ]) {
    const store = createClientStore();
    store.apply({ type: "mining/holds", holds: HOLDS as never });
    store.apply({
      type: "mining/quotes",
      quotes: [],
      taxRate: 0.05,
      quotesFor: [ORE_STACK_ID],
    });
    store.apply(event);
    const state = store.mining.get();
    assert.deepEqual(state.holds, [], `${event.type} must clear the holds`);
    assert.equal(state.holdsLoaded, false);
    assert.equal(state.taxRate, null, `${event.type} must clear the tax`);
    assert.deepEqual(state.quotesFor, []);
  }
});

test("one apply produces exactly one store notification", () => {
  const store = createClientStore();
  let notifications = 0;
  const stop = store.subscribe(() => {
    notifications += 1;
  });
  notifications = 0;
  store.apply({ type: "mining/holds", holds: HOLDS as never });
  assert.equal(notifications, 1);
  stop();
});
