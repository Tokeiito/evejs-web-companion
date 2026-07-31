// Drone RECOVERY through the page controller: reconnect and scoop, the two
// verbs that reach a drone this hull cannot fly.
//
// An orphaned drone — one this character owns after a lost session, a ship swap
// or a pod and reboard — used to be unreachable from the web client entirely.
// Recall and Engage both need control the ship does not have, so the panel
// could show the drone and do nothing about it.
//
// The other claim here is about HONESTY, and it is the one that bit: a scoop
// the server declines answers with a per-drone CustomNotify ("That drone cannot
// currently be scooped into the drone bay" — captured live from Farmer's
// Warrior II). Those sentences render as order reports, so a verifier that also
// says "and the server gave no reason" is contradicting what is on screen a
// line above.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const DRONE_ID = 9500001;
const OTHER_DRONE_ID = 9500002;

function droneRow(itemID: number, controlled: boolean) {
  return {
    itemID,
    typeID: 2488,
    name: "Warrior II",
    controlled,
    activity: "idle",
    targetID: null,
    shieldRatio: 1,
    armorRatio: 1,
    hullRatio: 1,
  };
}

interface Recorded {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

/**
 * A BFF whose drone list is whatever the case says it becomes AFTER the write —
 * the re-read is the only authority either verb trusts.
 */
function makeFakeBff(options: {
  inSpaceAfter: unknown[];
  /** The retail per-drone refusal dict, when the case is testing one. */
  result?: unknown;
}) {
  const requests: Recorded[] = [];
  const fakeFetch = (async (input: unknown, init?: { body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, body });
    const respond = (payload: unknown) => ({
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
    });
    if (path === "/api/login") {
      return respond({ ok: true, account: { accountID: 2, username: "test2" } });
    }
    if (
      path === "/api/bridge/entity/drones/reconnect" ||
      path === "/api/bridge/drones/scoop"
    ) {
      return respond({
        ok: true,
        inSpace: options.inSpaceAfter,
        launched: [],
        result: options.result ?? null,
        notifications: [],
      });
    }
    if (path === "/api/bridge/drones") {
      return respond({ ok: true, bay: [], inSpace: options.inSpaceAfter, shipInfo: null, errors: {} });
    }
    return respond({ ok: true });
  }) as unknown as typeof fetch;
  return { fetch: fakeFetch, requests };
}

test("reconnect asks the BFF with confirm, and lands the re-read", async () => {
  const store = createClientStore();
  const bff = makeFakeBff({ inSpaceAfter: [droneRow(DRONE_ID, true)] });
  const flow = createAppFlow(store, { fetch: bff.fetch });

  await flow.reconnectDrones([DRONE_ID]);

  const write = bff.requests.find((r) => r.path === "/api/bridge/entity/drones/reconnect");
  assert.deepEqual(write?.body, { droneIDs: [DRONE_ID], confirm: true });
  const state = store.drones.get();
  assert.equal(state.lastAction, "Reconnect");
  assert.equal(state.silentDecline, null, "it worked — the drone is controlled now");
  assert.equal(state.inSpace?.[0]?.controlled, true);
});

test("⚠ reconnect judges by CONTROL, not by presence — the drone was never missing", async () => {
  const store = createClientStore();
  // Still in space, still not ours: the call achieved nothing.
  const bff = makeFakeBff({ inSpaceAfter: [droneRow(DRONE_ID, false)] });
  const flow = createAppFlow(store, { fetch: bff.fetch });

  await flow.reconnectDrones([DRONE_ID]);

  assert.match(store.drones.get().silentDecline ?? "", /none of them answered/i);
});

test("scoop judges by the drone LEAVING space", async () => {
  const store = createClientStore();
  const bff = makeFakeBff({ inSpaceAfter: [] });
  const flow = createAppFlow(store, { fetch: bff.fetch });

  await flow.scoopDrones([DRONE_ID]);

  const write = bff.requests.find((r) => r.path === "/api/bridge/drones/scoop");
  assert.deepEqual(write?.body, { droneIDs: [DRONE_ID], confirm: true });
  assert.equal(store.drones.get().silentDecline, null);
  assert.equal(store.drones.get().lastAction, "Scoop");
});

test("a scoop that moved only some of them counts the ones left behind", async () => {
  const store = createClientStore();
  const bff = makeFakeBff({ inSpaceAfter: [droneRow(OTHER_DRONE_ID, true)] });
  const flow = createAppFlow(store, { fetch: bff.fetch });

  await flow.scoopDrones([DRONE_ID, OTHER_DRONE_ID]);

  assert.match(store.drones.get().silentDecline ?? "", /1 of 2 stayed in space/i);
});

// ⚠ THE REGRESSION THIS PINS. The server's own sentence and "gave no reason"
// cannot both be true, and they would have rendered one line apart.
test("⚠ when the server DID explain, the decline stays silent about silence", async () => {
  const store = createClientStore();
  const bff = makeFakeBff({
    inSpaceAfter: [droneRow(DRONE_ID, true)],
    // The exact retail shape captured live from a refused scoop.
    result: {
      type: "dict",
      entries: [
        [
          DRONE_ID,
          [
            "CustomNotify",
            {
              type: "dict",
              entries: [["notify", "That drone cannot currently be scooped into the drone bay."]],
            },
          ],
        ],
      ],
    },
  });
  const flow = createAppFlow(store, { fetch: bff.fetch });

  await flow.scoopDrones([DRONE_ID]);

  const state = store.drones.get();
  // The server's words reached the player…
  assert.equal(state.orderReports.length, 1);
  assert.match(state.orderReports[0]!.text, /cannot currently be scooped/i);
  // …so nothing claims it said nothing.
  assert.equal(
    state.silentDecline,
    null,
    "a silent-decline note beside the server's own sentence is a contradiction",
  );
});
