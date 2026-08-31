import test from "node:test";
import assert from "node:assert/strict";

import {
  HEALTH_POLL_FALLBACK_MS,
  HEALTH_POLL_LIVE_MS,
  healthPollIntervalMs,
  resolveServerStatus,
} from "./serverStatus.ts";

test("an open push stream reports online even when the health poll was starved", () => {
  // The regression this whole module exists for: the health ping loses a lane
  // under the page's own load and resolves not-ready, while the stream — which
  // cannot be starved, because it is already connected — is carrying fine.
  assert.equal(resolveServerStatus({ live: "live", healthReady: false }), "online");
  assert.equal(resolveServerStatus({ live: "live", healthReady: null }), "online");
  assert.equal(resolveServerStatus({ live: "live", healthReady: true }), "online");
});

test("without a stream the health poll still decides, exactly as before", () => {
  for (const live of ["idle", "connecting", "degraded", "ended"] as const) {
    assert.equal(resolveServerStatus({ live, healthReady: true }), "online", live);
    assert.equal(resolveServerStatus({ live, healthReady: false }), "offline", live);
    assert.equal(resolveServerStatus({ live, healthReady: null }), "checking", live);
  }
});

test("a genuinely unreachable server is still reported offline", () => {
  // The stream drops -> EventSource onerror -> "degraded", and the health poll
  // fails too. Nothing here can paper over a real outage.
  assert.equal(resolveServerStatus({ live: "degraded", healthReady: false }), "offline");
  assert.equal(resolveServerStatus({ live: "ended", healthReady: false }), "offline");
});

test("the character-select screen (no pilot, no stream) still shows checking then online", () => {
  assert.equal(resolveServerStatus({ live: "idle", healthReady: null }), "checking");
  assert.equal(resolveServerStatus({ live: "idle", healthReady: true }), "online");
});

test("the poll slows down while the stream carries, and snaps back when it does not", () => {
  assert.equal(healthPollIntervalMs("live"), HEALTH_POLL_LIVE_MS);
  for (const live of ["idle", "connecting", "degraded", "ended"] as const) {
    assert.equal(healthPollIntervalMs(live), HEALTH_POLL_FALLBACK_MS, live);
  }
  assert.ok(
    HEALTH_POLL_LIVE_MS > HEALTH_POLL_FALLBACK_MS,
    "the live cadence must be the slower of the two",
  );
});

test("the poll is never disabled outright", () => {
  // A held bridge session has an idle TTL, and the BFF itself is not covered by
  // the gateway stream, so the beat has to keep happening at some cadence.
  assert.ok(HEALTH_POLL_LIVE_MS > 0);
  assert.ok(Number.isFinite(HEALTH_POLL_LIVE_MS));
});
