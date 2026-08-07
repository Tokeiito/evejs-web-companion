"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SESSION_CHANGE_COOLDOWN_MS,
  beginHeldTransition,
  evaluateReadiness,
  markTransitionFailed,
  publicTransition,
  resolveFailedTransition,
  waitForTransitionReady,
} = require("./transitionBarrier");

function held() {
  return { transitionEpoch: 0, transition: null, cooldownUntilMs: 0, activeShipID: 44, boundHandles: new Map([["old", "oid"]]) };
}

test("begin separates the ten-second mutation cooldown from readiness and invalidates bindings", () => {
  const state = held();
  const result = beginHeldTransition(state, "undock", { shipID: 44, toSolarSystemID: 3001 }, 1_000);
  assert.equal(result.ok, true);
  assert.equal(state.cooldownUntilMs, 1_000 + SESSION_CHANGE_COOLDOWN_MS);
  assert.equal(state.transition.phase, "requested");
  assert.equal(state.boundHandles.size, 0);
  assert.equal(publicTransition(state).sessionStable, false);
});

test("a different session mutation cannot overwrite one still in flight", () => {
  const state = held();
  beginHeldTransition(state, "stargate", { fromSolarSystemID: 3001, shipID: 44 }, 0);
  const overlap = beginHeldTransition(state, "dock", { stationID: 6001, shipID: 44 }, 1);
  assert.equal(overlap.ok, false);
  assert.equal(overlap.code, "SESSION_CHANGE_IN_PROGRESS");
  assert.equal(state.transition.kind, "stargate");
});

test("ten seconds elapsed is not readiness without the destination scene and ego", () => {
  const expected = { fromSolarSystemID: 3001, shipID: 44 };
  const source = evaluateReadiness("stargate", expected, { inSpace: true, solarSystemID: 3001, shipID: 44 }, { inSpace: true, ship: { itemID: 44 } });
  assert.equal(source.ready, false);
  const noEgo = evaluateReadiness("stargate", expected, { inSpace: true, solarSystemID: 3002, shipID: 44 }, { inSpace: true, ship: null });
  assert.equal(noEgo.locationReady, true);
  assert.equal(noEgo.ready, false);
  const ready = evaluateReadiness("stargate", expected, { inSpace: true, solarSystemID: 3002, shipID: 44 }, { inSpace: true, ship: { itemID: 44 } });
  assert.equal(ready.ready, true);
});

test("an unknown destination hull waits for a real active-ship change and matching space ego", () => {
  const expected = { fromShipID: 44 };
  const unchanged = evaluateReadiness(
    "board",
    expected,
    { inSpace: true, docked: false, solarSystemID: 3001, shipID: 44 },
    { inSpace: true, ship: { itemID: 44 } },
  );
  assert.equal(unchanged.ready, false);
  const staleScene = evaluateReadiness(
    "board",
    expected,
    { inSpace: true, docked: false, solarSystemID: 3001, shipID: 55 },
    { inSpace: true, ship: { itemID: 44 } },
  );
  assert.equal(staleScene.shipReady, true);
  assert.equal(staleScene.egoReady, false);
  assert.equal(staleScene.ready, false);
  const ready = evaluateReadiness(
    "board",
    expected,
    { inSpace: true, docked: false, solarSystemID: 3001, shipID: 55 },
    { inSpace: true, ship: { itemID: 55 } },
  );
  assert.equal(ready.ready, true);
});

test("a clone jump waits for its destination dock or a matching clone-vat scene", () => {
  const expected = { destinationLocationID: 6002 };
  const origin = evaluateReadiness(
    "clone",
    expected,
    { docked: true, inSpace: false, stationID: 6001, shipID: 44 },
    null,
  );
  assert.equal(origin.ready, false);
  const docked = evaluateReadiness(
    "clone",
    expected,
    { docked: true, inSpace: false, stationID: 6002, shipID: 44 },
    null,
  );
  assert.equal(docked.ready, true);
  const vat = evaluateReadiness(
    "clone",
    { destinationLocationID: 9009 },
    { docked: false, inSpace: true, solarSystemID: 3002, shipID: 55 },
    { inSpace: true, ship: { itemID: 55 } },
  );
  assert.equal(vat.ready, true);
});

test("the waiter handles a slow transition without repeating the write", async () => {
  const state = held();
  beginHeldTransition(state, "stargate", { fromSolarSystemID: 3001, shipID: 44 }, 0);
  let clock = 0;
  let reads = 0;
  const outcome = await waitForTransitionReady({
    held: state,
    kind: "stargate",
    expected: { fromSolarSystemID: 3001, shipID: 44 },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    readFlight: async () => {
      reads += 1;
      return { flight: { inSpace: true, solarSystemID: reads < 4 ? 3001 : 3002, shipID: 44 }, notifications: [] };
    },
    readSpace: async () => ({ space: { inSpace: true, ship: reads < 5 ? null : { itemID: 44 } }, notifications: [] }),
    timeoutMs: 5_000,
    pollMs: 250,
  });
  assert.equal(outcome.ok, true);
  assert.equal(reads, 5);
  assert.equal(state.transition.phase, "ready");
});

test("timeout is visible and never declares a false ready state", async () => {
  const state = held();
  beginHeldTransition(state, "undock", { shipID: 44 }, 0);
  let clock = 0;
  const outcome = await waitForTransitionReady({
    held: state,
    kind: "undock",
    expected: { shipID: 44 },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    readFlight: async () => ({ flight: { inSpace: false, docked: true, shipID: 44 }, notifications: [] }),
    readSpace: async () => ({ space: null, notifications: [] }),
    timeoutMs: 500,
    pollMs: 250,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "TRANSITION_TIMEOUT");
  assert.equal(state.transition.phase, "failed");
  assert.match(state.transition.failure, /did not become ready/i);
});

test("a poll that cannot be read is a missed observation, not a failed transition", async () => {
  const state = held();
  beginHeldTransition(state, "stargate", { fromSolarSystemID: 3001, shipID: 44 }, 0);
  let clock = 0;
  let reads = 0;
  const outcome = await waitForTransitionReady({
    held: state,
    kind: "stargate",
    expected: { fromSolarSystemID: 3001, shipID: 44 },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    readFlight: async () => {
      reads += 1;
      // The gateway is busiest mid-scene-load: the first two polls abort the
      // way a 10 s AbortError surfaces (EVE_GATEWAY_TIMEOUT), then the world
      // answers and shows the jump landed.
      if (reads < 3) {
        const error = new Error("EveJS gateway timed out.");
        error.code = "EVE_GATEWAY_TIMEOUT";
        throw error;
      }
      return { flight: { inSpace: true, solarSystemID: 3002, shipID: 44 }, notifications: [] };
    },
    readSpace: async () => ({ space: { inSpace: true, ship: { itemID: 44 } }, notifications: [] }),
    timeoutMs: 5_000,
    pollMs: 250,
  });
  assert.equal(outcome.ok, true);
  assert.equal(reads, 3);
  assert.equal(state.transition.phase, "ready");
});

test("a lost session ends the wait immediately instead of polling out the deadline", async () => {
  const state = held();
  beginHeldTransition(state, "stargate", { fromSolarSystemID: 3001, shipID: 44 }, 0);
  let clock = 0;
  await assert.rejects(
    waitForTransitionReady({
      held: state,
      kind: "stargate",
      expected: { fromSolarSystemID: 3001, shipID: 44 },
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      readFlight: async () => {
        const error = new Error("gone");
        error.code = "SESSION_NOT_FOUND";
        throw error;
      },
      readSpace: async () => ({ space: null, notifications: [] }),
      timeoutMs: 5_000,
      pollMs: 250,
    }),
    (error) => error.code === "SESSION_NOT_FOUND",
  );
});

test("a non-latching probe reports its timeout without condemning the transition", async () => {
  const state = held();
  beginHeldTransition(state, "dock", { stationID: 6001, shipID: 44 }, 0);
  let clock = 0;
  const outcome = await waitForTransitionReady({
    held: state,
    kind: "dock",
    expected: { stationID: 6001, shipID: 44 },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    readFlight: async () => ({ flight: { inSpace: true, docked: false, solarSystemID: 3001, shipID: 44 }, notifications: [] }),
    readSpace: async () => ({ space: null, notifications: [] }),
    timeoutMs: 500,
    pollMs: 250,
    latchOnTimeout: false,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "TRANSITION_PROBE_TIMEOUT");
  // The row is NOT failed: the caller decides what a not-yet-ready probe means.
  assert.notEqual(state.transition.phase, "failed");
  assert.equal(state.transition.failure, null);
});

test("a latched transition is adopted when a fresh read shows the write landed", () => {
  const state = held();
  beginHeldTransition(state, "stargate", { fromSolarSystemID: 3001, toSolarSystemID: 3002, shipID: 44 }, 0);
  markTransitionFailed(state, "The session change did not become ready in time. No command was repeated.");
  assert.equal(state.transition.phase, "failed");
  // A later authoritative read shows the ship sitting in the destination
  // system: the write landed after the last poll. The latch resolves to ready.
  const resolution = resolveFailedTransition(state, { inSpace: true, docked: false, solarSystemID: 3002, shipID: 44 });
  assert.equal(resolution, "landed");
  assert.equal(state.transition.phase, "ready");
  assert.equal(state.transition.failure, null);
  assert.equal(publicTransition(state).sessionStable, true);
});

test("a latched transition is released when a fresh read shows the write never took", () => {
  const state = held();
  beginHeldTransition(state, "dock", { stationID: 6001, shipID: 44 }, 0);
  markTransitionFailed(state, "The session change did not become ready in time. No command was repeated.");
  // The ship reads fully in space in a known system — not docked, not
  // mid-transition. The dock never took; the latch is released so the next
  // command is legal, and the cooldown keeps running.
  const cooldownBefore = state.cooldownUntilMs;
  const resolution = resolveFailedTransition(state, { inSpace: true, docked: false, solarSystemID: 3001, shipID: 44 });
  assert.equal(resolution, "reverted");
  assert.equal(state.transition, null);
  assert.equal(state.cooldownUntilMs, cooldownBefore);
  const next = beginHeldTransition(state, "dock", { stationID: 6001, shipID: 44 }, 1);
  assert.equal(next.ok, true);
});

test("an unstable read resolves nothing and the latch holds", () => {
  const state = held();
  beginHeldTransition(state, "stargate", { fromSolarSystemID: 3001, toSolarSystemID: 3002, shipID: 44 }, 0);
  markTransitionFailed(state, "timed out");
  // Neither docked nor readable in space: the outcome is still unknown.
  assert.equal(resolveFailedTransition(state, { inSpace: false, docked: false }), null);
  assert.equal(state.transition.phase, "failed");
  // And a transition that is not failed is never touched.
  const live = held();
  beginHeldTransition(live, "stargate", { fromSolarSystemID: 3001, shipID: 44 }, 0);
  assert.equal(resolveFailedTransition(live, { inSpace: true, docked: false, solarSystemID: 3001, shipID: 44 }), null);
  assert.equal(live.transition.phase, "requested");
});
