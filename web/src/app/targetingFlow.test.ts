// The R23 slice A controller against a faked BFF: the GENERIC in-space action
// layer — lock / release a target, switch a module on / off.
//
// Two things are pinned here, and they are the whole point of the slice.
//
// GENERALITY. Nothing in the flow names mining or combat. activateModule takes
// a module and an OPTIONAL effect name; omit it and the SERVER resolves the
// module's own default activation effect. The same four methods drive a mining
// laser and a turret, so a later combat goal reuses them unchanged. There is a
// test below that switches on a combat module through the identical path.
//
// HONESTY. A 200 is not proof. Every mutation is verified against a server
// re-read, and the flow distinguishes THREE outcomes that a naive client would
// collapse into "it worked":
//   - refused        -> the server's own reason, verbatim
//   - silently declined -> accepted, nothing changed, no reason given, and the
//                       page says exactly that instead of inventing a cause
//   - unknown        -> the verification read could not answer, which is NOT
//                       reported as a decline

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function makeFakeFetch(
  responder: (
    path: string,
    method: string,
    body: Record<string, unknown>,
  ) => { status: number; body: unknown },
): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, method, body });
    const outcome = responder(path, method, body);
    return {
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      async json() {
        return outcome.body;
      },
    };
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, requests };
}

const ROCK_ID = 50001248;
const MODULE_ID = 7700001;

function snapshotBody(activeModuleIDs: number[] | null): unknown {
  const ship: Record<string, unknown> = { itemID: 9001, typeID: 606, name: "Ibis" };
  if (activeModuleIDs !== null) {
    ship.activeModuleIDs = activeModuleIDs;
  }
  return {
    ok: true,
    space: { inSpace: true, shipID: 9001, entities: [], ship },
    notifications: [],
  };
}

// --- Reading the locks ------------------------------------------------------

test("loadTargets puts the server's locked list in the store", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/targets") {
      return { status: 200, body: { ok: true, targetIDs: [ROCK_ID], notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  assert.equal(store.targeting.get().loaded, false);
  await flow.loadTargets();
  assert.deepEqual(store.targeting.get().lockedTargetIDs, [ROCK_ID]);
  assert.equal(store.targeting.get().loaded, true);
});

test("target IDs decode long-aware — a {type:'long'} wrapper is not zeroed", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, targetIDs: [{ type: "long", value: String(ROCK_ID) }], notifications: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadTargets();
  assert.deepEqual(store.targeting.get().lockedTargetIDs, [ROCK_ID]);
});

test("loadTargets swallows a transient read failure — no banner, last locks kept", async () => {
  const store = createClientStore();
  let failNext = false;
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/targets") {
      if (failNext) {
        throw new Error("gateway timeout"); // a transient, non-session-loss failure
      }
      return { status: 200, body: { ok: true, targetIDs: [ROCK_ID], notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadTargets();
  assert.deepEqual(store.targeting.get().lockedTargetIDs, [ROCK_ID]);
  assert.equal(store.targeting.get().actionError, null);

  // The read is best-effort (overview poll / mount). A transient timeout must NOT
  // raise a sticky banner, and must leave the last-known lock list in place.
  failNext = true;
  await flow.loadTargets();
  assert.equal(store.targeting.get().actionError, null, "a best-effort read failure must not surface a banner");
  assert.deepEqual(store.targeting.get().lockedTargetIDs, [ROCK_ID], "last-known locks are kept");
});

// --- Locking ----------------------------------------------------------------

test("lockTarget records the action and lands the server's re-read", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/targets/lock") {
      return {
        status: 200,
        body: { ok: true, locked: true, acquiring: false, targetIDs: [ROCK_ID], notifications: [] },
      };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.lockTarget(ROCK_ID);
  assert.deepEqual(requests[0]?.body, { targetID: ROCK_ID });
  const state = store.targeting.get();
  assert.deepEqual(state.lockedTargetIDs, [ROCK_ID]);
  assert.equal(state.lastAction, "Lock");
  assert.equal(state.actionError, null);
  assert.equal(state.silentDecline, null);
});

test("a lock still being ACQUIRED is a success, and is remembered as acquiring", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, locked: false, acquiring: true, targetIDs: [], notifications: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.lockTarget(ROCK_ID);
  const state = store.targeting.get();
  assert.deepEqual(state.acquiringTargetIDs, [ROCK_ID]);
  assert.deepEqual(state.lockedTargetIDs, []);
  assert.equal(
    state.silentDecline,
    null,
    "mid-acquisition is progress, not a decline — a lock takes time",
  );
});

test("an acquiring note is retired the moment the server reports the lock landed", async () => {
  const store = createClientStore();
  let landed = false;
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/targets/lock") {
      return {
        status: 200,
        body: { ok: true, locked: false, acquiring: true, targetIDs: [], notifications: [] },
      };
    }
    if (path === "/api/bridge/targets") {
      return {
        status: 200,
        body: { ok: true, targetIDs: landed ? [ROCK_ID] : [], notifications: [] },
      };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.lockTarget(ROCK_ID);
  assert.deepEqual(store.targeting.get().acquiringTargetIDs, [ROCK_ID]);

  landed = true;
  await flow.loadTargets();
  const state = store.targeting.get();
  assert.deepEqual(state.lockedTargetIDs, [ROCK_ID]);
  assert.deepEqual(state.acquiringTargetIDs, [], "the page must not still say 'Locking…'");
});

test("a lock the server REFUSES surfaces the server's own reason", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 409,
    body: { ok: false, error: "CALL_REFUSED", message: "TargetTooFar" },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.lockTarget(ROCK_ID);
  const state = store.targeting.get();
  // R31 — the server's reason still reaches the player, now as its meaning
  // rather than its name. `TargetTooFar` is dogma's TARGET_OUT_OF_RANGE arm.
  assert.equal(state.actionError, "Lock refused: That is too far away. Get closer and try again.");
  assert.equal(state.silentDecline, null, "a refusal is not a silent decline");
  assert.deepEqual(state.lockedTargetIDs, []);
});

test("a lock the server SILENTLY declines is reported as such, with no invented cause", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, locked: false, acquiring: false, targetIDs: [], notifications: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.lockTarget(ROCK_ID);
  const state = store.targeting.get();
  assert.equal(state.actionError, null, "nothing was refused, so there is no refusal to show");
  assert.match(state.silentDecline ?? "", /gave no reason/i);
  // The message must not speculate about WHY.
  assert.doesNotMatch(state.silentDecline ?? "", /range|capacitor|too many|scrambl/i);
});

// --- Unlocking --------------------------------------------------------------

test("unlockTarget lands the re-read, and an ignored unlock is called out", async () => {
  const store = createClientStore();
  let released = true;
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: {
      ok: true,
      released,
      targetIDs: released ? [] : [ROCK_ID],
      notifications: [],
    },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.unlockTarget(ROCK_ID);
  assert.deepEqual(store.targeting.get().lockedTargetIDs, []);
  assert.equal(store.targeting.get().silentDecline, null);

  released = false;
  await flow.unlockTarget(ROCK_ID);
  const state = store.targeting.get();
  assert.deepEqual(state.lockedTargetIDs, [ROCK_ID], "it is still locked, so show it still locked");
  assert.match(state.silentDecline ?? "", /did not release/i);
});

// --- Module activation ------------------------------------------------------

test("activateModule sends the module ALONE by default — the server picks the effect", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/modules/activate") {
      return {
        status: 200,
        body: { ok: true, active: true, activeModuleIDs: [MODULE_ID], notifications: [] },
      };
    }
    if (path === "/api/bridge/space/snapshot") {
      return { status: 200, body: snapshotBody([MODULE_ID]) };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.activateModule(MODULE_ID);
  // No effect name, no target, no repeat: the browser does not know or guess
  // what kind of module this is, and does not have to.
  assert.deepEqual(requests[0]?.body, { itemID: MODULE_ID });
  assert.equal(store.targeting.get().lastAction, "Switch on");
  assert.equal(store.targeting.get().silentDecline, null);
});

test("the SAME method drives a mining module and a combat module — no new surface", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/modules/activate") {
      return { status: 200, body: { ok: true, active: true, activeModuleIDs: [], notifications: [] } };
    }
    return { status: 200, body: snapshotBody([]) };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.activateModule(MODULE_ID, { effect: "miningLaser", targetID: ROCK_ID, repeat: -1 });
  await flow.activateModule(MODULE_ID, { effect: "useMissiles", targetID: ROCK_ID });

  const posts = requests.filter((entry) => entry.path === "/api/bridge/modules/activate");
  assert.deepEqual(posts[0]?.body, { itemID: MODULE_ID, effect: "miningLaser", targetID: ROCK_ID });
  assert.deepEqual(posts[1]?.body, { itemID: MODULE_ID, effect: "useMissiles", targetID: ROCK_ID });
});

test("repeat: 0 (a single cycle) is sent; the default -1 is left off the wire", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/modules/activate") {
      return { status: 200, body: { ok: true, active: true, activeModuleIDs: [], notifications: [] } };
    }
    return { status: 200, body: snapshotBody([]) };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.activateModule(MODULE_ID, { repeat: 0 });
  const post = requests.find((entry) => entry.path === "/api/bridge/modules/activate");
  assert.deepEqual(post?.body, { itemID: MODULE_ID, repeat: 0 });
});

test("a module accepted and then NOT run is a silent decline", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/modules/activate") {
      return { status: 200, body: { ok: true, active: false, activeModuleIDs: [], notifications: [] } };
    }
    return { status: 200, body: snapshotBody([]) };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.activateModule(MODULE_ID);
  const state = store.targeting.get();
  assert.equal(state.actionError, null);
  assert.match(state.silentDecline ?? "", /did not run it, and gave no reason/i);
});

test("UNKNOWN is not a decline: a verification read that cannot answer says nothing", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/modules/activate") {
      // active: null — the snapshot had no activeModuleIDs to check against.
      return { status: 200, body: { ok: true, active: null, activeModuleIDs: null, notifications: [] } };
    }
    return { status: 200, body: snapshotBody(null) };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.activateModule(MODULE_ID);
  const state = store.targeting.get();
  assert.equal(state.silentDecline, null, "we do not know, so we must not claim it declined");
  assert.equal(state.actionError, null);
  // And the snapshot slice keeps "unknown" as null rather than an empty list.
  assert.equal(store.space.get().snapshot?.ship?.activeModuleIDs, null);
});

test("a module refusal surfaces the server's own reason", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 409,
    body: {
      ok: false,
      error: "CALL_REFUSED",
      message: "You must be targeting something to activate that module.",
    },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.activateModule(MODULE_ID);
  assert.match(store.targeting.get().actionError ?? "", /targeting something/i);
  assert.equal(store.targeting.get().silentDecline, null);
});

test("deactivateModule verifies the module actually stopped", async () => {
  const store = createClientStore();
  let stopped = true;
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/modules/deactivate") {
      return { status: 200, body: { ok: true, stopped, activeModuleIDs: [], notifications: [] } };
    }
    return { status: 200, body: snapshotBody([]) };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.deactivateModule(MODULE_ID);
  assert.deepEqual(
    requests.find((entry) => entry.path === "/api/bridge/modules/deactivate")?.body,
    { itemID: MODULE_ID },
  );
  assert.equal(store.targeting.get().silentDecline, null);

  stopped = false;
  await flow.deactivateModule(MODULE_ID);
  assert.match(store.targeting.get().silentDecline ?? "", /did not stop/i);
});

// --- A successful action clears the previous failure -------------------------

test("a later success clears both the stale refusal AND the stale silent decline", async () => {
  const store = createClientStore();
  let fail = true;
  const { fetch } = makeFakeFetch(() =>
    fail
      ? { status: 409, body: { ok: false, error: "CALL_REFUSED", message: "TargetTooFar" } }
      : {
          status: 200,
          body: { ok: true, locked: true, acquiring: false, targetIDs: [ROCK_ID], notifications: [] },
        },
  );
  const flow = createAppFlow(store, { fetch });

  await flow.lockTarget(ROCK_ID);
  assert.ok(store.targeting.get().actionError);

  fail = false;
  await flow.lockTarget(ROCK_ID);
  const state = store.targeting.get();
  assert.equal(state.actionError, null, "the refusal described the PREVIOUS action");
  assert.equal(state.silentDecline, null);
});
