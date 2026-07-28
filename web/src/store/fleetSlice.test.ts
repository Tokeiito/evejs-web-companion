import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "./clientStore.ts";
import { decodeFleetCenter } from "../bridge/fleetCenter.ts";

const readNames = [
  "GetInitState",
  "GetWings",
  "GetMotd",
  "GetJoinRequests",
  "GetFleetComposition",
] as const;

function noFleet() {
  return decodeFleetCenter({
    ok: true,
    characterID: 140000005,
    fleetID: null,
    reads: Object.fromEntries(
      readNames.map((name) => [name, { error: "CALL_REFUSED", message: "FleetNotFound" }]),
    ),
  });
}

test("fleet slice keeps not-in-fleet distinct from unread and unavailable", () => {
  const store = createClientStore();
  assert.equal(store.get().fleet.loaded, false);
  assert.equal(store.get().fleet.availability, "unknown");

  const snapshot = noFleet();
  store.apply({ type: "fleet/loading" });
  store.apply({
    type: "fleet/loaded",
    ...snapshot,
    readError: null,
    refreshedAtMs: 100,
  });
  assert.equal(store.get().fleet.loaded, true);
  assert.equal(store.get().fleet.loading, false);
  assert.equal(store.get().fleet.availability, "not-in-fleet");
});
test("fleet actions and invitations settle without erasing the authoritative read", () => {
  const store = createClientStore();
  const snapshot = noFleet();
  store.apply({
    type: "fleet/loaded",
    ...snapshot,
    readError: null,
    refreshedAtMs: 100,
  });
  store.apply({
    type: "fleet/pending-invite",
    invite: { fleetID: 654500010000, inviterID: 140000002, receivedAtMs: 200 },
  });
  store.apply({ type: "fleet/action-started", action: "accept" });
  store.apply({ type: "fleet/action-finished", error: "The invitation expired." });

  const fleet = store.get().fleet;
  assert.equal(fleet.availability, "not-in-fleet");
  assert.equal(fleet.pendingInvite?.fleetID, 654500010000);
  assert.equal(fleet.activeAction, null);
  assert.equal(fleet.actionError, "The invitation expired.");
});

test("offline and logout clear character-specific fleet state", () => {
  for (const event of [
    { type: "character/offline" } as const,
    { type: "session/logged-out" } as const,
    { type: "fleet/cleared" } as const,
  ]) {
    const store = createClientStore();
    const snapshot = noFleet();
    store.apply({
      type: "fleet/loaded",
      ...snapshot,
      readError: null,
      refreshedAtMs: 100,
    });
    store.apply(event);
    assert.equal(store.get().fleet.loaded, false);
    assert.equal(store.get().fleet.availability, "unknown");
  }
});
