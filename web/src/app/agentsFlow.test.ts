// The R4 Agents & Missions controller against a faked BFF: loadAgents fills the
// roster, openConversation decodes the agent dialogue, accepting a courier
// pulls the briefing + journal, a refused action surfaces through the store,
// and a lost session unwinds to offline.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

// --- marshaled fixtures (handler-shaped) -----------------------------------

const AGENTS_RESPONSE = {
  ok: true,
  stationID: 60000004,
  agents: [
    {
      agentID: 3008416,
      agentTypeID: 2,
      divisionID: 22,
      level: 1,
      stationID: 60000004,
      corporationID: 1000002,
      missionKind: "courier",
      missionTypeLabel: "UI/Agents/MissionTypes/Courier",
    },
  ],
};

function offeredConversation() {
  return {
    ok: true,
    result: {
      type: "tuple",
      items: [
        {
          type: "tuple",
          items: [
            { type: "tuple", items: [127958, 1382] },
            { type: "list", items: [{ type: "tuple", items: [816, 3] }, { type: "tuple", items: [817, 9] }] },
          ],
        },
        { type: "dict", entries: [["missionDeclined", false], ["loyaltyPoints", 0]] },
      ],
    },
    notifications: [],
  };
}

function acceptedConversation() {
  return {
    ok: true,
    result: {
      type: "tuple",
      items: [
        {
          type: "tuple",
          items: [
            { type: "tuple", items: [127958, 1382] },
            { type: "list", items: [{ type: "tuple", items: [819, 6] }, { type: "tuple", items: [820, 11] }] },
          ],
        },
        { type: "dict", entries: [["missionCompleted", false], ["missionDeclined", false], ["loyaltyPoints", 0]] },
      ],
    },
    notifications: [],
  };
}

const BRIEFING_RESPONSE = {
  ok: true,
  agentID: 3008416,
  briefing: {
    type: "dict",
    entries: [
      ["Mission Title ID", 58607],
      ["AcceptTimestamp", { type: "long", value: "134289174004640000" }],
      ["Expiration Time", { type: "long", value: "134295222004640000" }],
    ],
  },
  objective: {
    type: "dict",
    entries: [
      [
        "objectives",
        {
          type: "list",
          items: [
            {
              type: "tuple",
              items: [
                "transport",
                {
                  type: "tuple",
                  items: [
                    1000002,
                    { type: "dict", entries: [["typeID", 1531], ["solarsystemID", 30002780], ["locationID", 60000004]] },
                    1000002,
                    { type: "dict", entries: [["typeID", 1531], ["solarsystemID", 30001399], ["locationID", 60000256]] },
                    { type: "dict", entries: [["volume", 0.1], ["typeID", 3814], ["quantity", 1]] },
                  ],
                },
              ],
            },
          ],
        },
      ],
      ["normalRewards", { type: "list", items: [{ type: "tuple", items: [29, 102000, null] }, { type: "tuple", items: [29, 38250, null] }] }],
      ["bonusRewards", { type: "list", items: [] }],
      ["loyaltyPoints", 213],
      ["missionTitleID", 58607],
    ],
  },
  location: { type: "dict", entries: [["locationID", 60000004]] },
  errors: { briefing: null, objective: null, location: null },
};

function journalResponse(active: readonly unknown[]) {
  return {
    ok: true,
    result: { type: "tuple", items: [{ type: "list", items: active }, { type: "list", items: [] }] },
  };
}

const ACTIVE_MISSION_ROW = {
  type: "tuple",
  items: [2, 0, "UI/Agents/MissionTypes/Courier", 58607, 3008416, { type: "long", value: "134295222004640000" }, { type: "list", items: [] }, 0, 0, 1382],
};

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function makeFakeFetch(
  responder: (path: string, method: string, body: Record<string, unknown>) => { status: number; body: unknown },
): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fakeFetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const method = (init && init.method) || "GET";
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, method, body });
    let outcome: { status: number; body: unknown };
    try {
      outcome = responder(path, method, body);
    } catch (cause) {
      // The window reads the mission's briefing for every layout. A test that is not about that read is
      // given the standing one.
      if (!/\/briefing$/.test(path)) throw cause;
      outcome = { status: 200, body: BRIEFING_RESPONSE };
    }
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

test("loadAgents fills the store's agent roster", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/agents") {
      return { status: 200, body: AGENTS_RESPONSE };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadAgents();

  const agents = store.agents.get();
  assert.equal(agents.loaded, true);
  assert.equal(agents.stationID, 60000004);
  assert.equal(agents.agents.length, 1);
  assert.equal(agents.agents[0]!.agentID, 3008416);
  assert.equal(agents.agents[0]!.missionKind, "courier");
});

test("openConversation decodes the agent dialogue into the store", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/agents/3008416/action") {
      return { status: 200, body: offeredConversation() };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.openConversation(3008416);

  // DoAction(None) opens the conversation; an offer is on the table, so nothing is pressed for the pilot.
  assert.deepEqual(requests[0]!.body, { actionID: null });
  // Then the layout: the briefing reads, and nothing else.
  assert.deepEqual(requests.map((request) => request.path), ["/api/bridge/agents/3008416/action", "/api/bridge/agents/3008416/briefing"]);
  const agents = store.agents.get();
  assert.equal(agents.activeAgentID, 3008416);
  assert.equal(agents.conversation!.actions.length, 2);
  assert.equal(agents.conversation!.actions[0]!.buttonType, 3);
  assert.equal(agents.actionError, null);
  // The offer's objectives are on show before it is accepted, as in the client's window.
  assert.equal(agents.briefing!.cargoTypeID, 3814);
});

test("accepting a courier posts DoAction(accept) then pulls the briefing and journal", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/agents/3008416/action") {
      return { status: 200, body: acceptedConversation() };
    }
    if (path === "/api/bridge/agents/3008416/briefing") {
      return { status: 200, body: BRIEFING_RESPONSE };
    }
    if (path === "/api/bridge/journal") {
      return { status: 200, body: journalResponse([ACTIVE_MISSION_ROW]) };
    }
    throw new Error(`unexpected ${path} ${JSON.stringify(body)}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.chooseAction(3008416, { actionID: 816, buttonType: 3, label: "Accept" });

  // The accept posted the token, then the briefing + journal were pulled.
  const action = requests.find((r) => r.path === "/api/bridge/agents/3008416/action");
  assert.deepEqual(action!.body, { actionID: 816 });
  assert.ok(requests.some((r) => r.path === "/api/bridge/agents/3008416/briefing"));
  assert.ok(requests.some((r) => r.path === "/api/bridge/journal"));

  const agents = store.agents.get();
  // Briefing shows the courier cargo / destination / reward / time bonus.
  assert.equal(agents.briefing!.cargoTypeID, 3814);
  assert.equal(agents.briefing!.destinationLocationID, 60000256);
  assert.equal(agents.briefing!.rewardISK, "102000");
  assert.equal(agents.briefing!.bonusISK, "38250");
  // Journal shows the accepted mission.
  assert.equal(agents.journal!.active.length, 1);
  assert.equal(agents.journal!.active[0]!.missionID, 1382);
});

test("declining clears the briefing and refreshes the journal", async () => {
  const store = createClientStore();
  // Seed a stale briefing so the decline must clear it.
  store.apply({
    type: "agents/briefing",
    briefing: {
      missionTitleID: 1,
      cargoTypeID: 3814,
      cargoQuantity: 1,
      cargoVolume: 0.1,
      pickupLocationID: 1,
      pickupSystemID: 1,
      destinationLocationID: 2,
      destinationSystemID: 2,
      rewardISK: "1",
      bonusISK: null,
      loyaltyPoints: 1,
      expirationTime: null,
      acceptTimestamp: null,
    },
  });
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/agents/3008416/action") {
      return {
        status: 200,
        body: {
          ok: true,
          result: { type: "tuple", items: [{ type: "tuple", items: [{ type: "tuple", items: ["idle", { type: "dict", entries: [] }] }, { type: "list", items: [] }] }, { type: "dict", entries: [["missionDeclined", true]] }] },
          notifications: [],
        },
      };
    }
    if (path === "/api/bridge/journal") {
      return { status: 200, body: journalResponse([]) };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.chooseAction(3008416, { actionID: 817, buttonType: 9, label: "Decline" });

  assert.equal(store.agents.get().briefing, null, "the stale briefing is cleared");
  assert.ok(requests.some((r) => r.path === "/api/bridge/journal"));
  assert.equal(store.agents.get().journal!.active.length, 0);
});

test("a refused agent action is surfaced through the store, not thrown", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/agents/3008416/action") {
      return { status: 403, body: { ok: false, error: "CALL_NOT_ALLOWED", message: "nope" } };
    }
    return { status: 200, body: journalResponse([]) };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.openConversation(3008416);

  // R31 — the player reads the refusal, not the wire code that carried it.
  assert.equal(
    store.agents.get().actionError,
    "This client is not allowed to ask the game server for that.",
  );
});

// A completed-courier conversation: the agent re-offers (Request(821,2)) and
// lastActionInfo.missionCompleted is true.
function completedConversation() {
  return {
    ok: true,
    result: {
      type: "tuple",
      items: [
        {
          type: "tuple",
          items: [
            { type: "tuple", items: [127959, 1383] },
            { type: "list", items: [{ type: "tuple", items: [821, 2] }] },
          ],
        },
        { type: "dict", entries: [["missionCompleted", true], ["missionDeclined", false], ["loyaltyPoints", 213]] },
      ],
    },
    notifications: [],
  };
}

// The reward reads BFF response (wallet / LP / standings), retail-shaped.
const REWARDS_RESPONSE = {
  ok: true,
  cash: 1000165000,
  lp: {
    type: "objectex2",
    header: [],
    list: [
      { type: "packedrow", columns: [["issuerCorpID", 3], ["loyaltyPoints", 3]], values: [1000002, 213] },
    ],
    dict: [],
  },
  standings: {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: ["fromID", "standing"] }],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: [{ type: "list", items: [1000002, 0.42] }] }],
      ],
    },
  },
  errors: { cash: null, lp: null, standings: null },
};

test("completing a courier posts DoAction(complete), clears the briefing, and pulls the reward reads + journal", async () => {
  const store = createClientStore();
  // Seed a stale briefing so completion must clear it.
  store.apply({
    type: "agents/briefing",
    briefing: {
      missionTitleID: 58607, cargoTypeID: 3814, cargoQuantity: 1, cargoVolume: 0.1,
      pickupLocationID: 60000004, pickupSystemID: 30002780, destinationLocationID: 60000256,
      destinationSystemID: 30001399, rewardISK: "102000", bonusISK: null, loyaltyPoints: 213,
      expirationTime: null, acceptTimestamp: null,
    },
  });
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/agents/3008416/action") {
      return { status: 200, body: completedConversation() };
    }
    if (path === "/api/bridge/rewards") {
      return { status: 200, body: REWARDS_RESPONSE };
    }
    if (path === "/api/bridge/journal") {
      return { status: 200, body: journalResponse([]) };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  // The Complete button is buttonType 6.
  await flow.chooseAction(3008416, { actionID: 819, buttonType: 6, label: "Complete Mission" });

  // Complete posted the token, then the reward reads + journal were pulled.
  const action = requests.find((r) => r.path === "/api/bridge/agents/3008416/action");
  assert.deepEqual(action!.body, { actionID: 819 });
  assert.ok(requests.some((r) => r.path === "/api/bridge/rewards"), "rewards pulled");
  assert.ok(requests.some((r) => r.path === "/api/bridge/journal"), "journal pulled");

  const agents = store.agents.get();
  assert.equal(agents.briefing, null, "the briefing is cleared after completion");
  assert.equal(agents.journal!.active.length, 0, "the mission left the journal");

  // The reward readout reflects the payout.
  const rewards = store.rewards.get();
  assert.equal(rewards.loaded, true);
  assert.equal(rewards.cashBalance, "1000165000");
  assert.deepEqual(rewards.lpBalances, [{ issuerCorpID: 1000002, loyaltyPoints: "213" }]);
  assert.deepEqual(rewards.standings, [{ fromID: 1000002, standing: 0.42 }]);
  assert.equal(rewards.error, null);
});

test("loadPackageIntoShip finds the matching hangar stack and moves it to cargo", async () => {
  const store = createClientStore();
  const inventoryResponse = {
    ok: true,
    stationID: 60000004,
    activeShipID: 9001,
    hangar: {
      list: {
        type: "list",
        items: [
          { type: "packedrow", fields: { itemID: 7777, typeID: 3814, quantity: 1, flagID: 4 } },
          { type: "packedrow", fields: { itemID: 8888, typeID: 34, quantity: 500, flagID: 4 } },
        ],
      },
      capacity: null,
      error: null,
    },
    cargo: { shipID: 9001, list: { type: "list", items: [] }, capacity: null, error: null },
  };
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory") {
      return { status: 200, body: inventoryResponse };
    }
    if (path === "/api/bridge/inventory/transfer") {
      return {
        status: 200,
        body: { ok: true, applied: true, moved: [7777], reminted: [], declined: [], declinedSilently: false, notFound: [] },
      };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadPackageIntoShip(3814, 1);

  // R35: the move now goes through the VERIFYING /transfer route, and the stack
  // is chosen by the mission's type AND quantity.
  const move = requests.find((r) => r.path === "/api/bridge/inventory/transfer");
  assert.ok(move, "the matching package was moved");
  assert.deepEqual(move!.body.itemIDs, [7777]);
  assert.deepEqual(move!.body.to, { kind: "cargo" });
  assert.equal(store.agents.get().actionError, null);
});

test("loadPackageIntoShip surfaces a clear error when the package is not in the hangar", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory") {
      return {
        status: 200,
        body: {
          ok: true, stationID: 60000004, activeShipID: 9001,
          hangar: { list: { type: "list", items: [] }, capacity: null, error: null },
          cargo: { shipID: 9001, list: { type: "list", items: [] }, capacity: null, error: null },
        },
      };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadPackageIntoShip(3814, 1);

  assert.ok(!requests.some((r) => r.path === "/api/bridge/inventory/transfer"), "no move issued");
  assert.match(store.agents.get().actionError ?? "", /not in the station hangar/);
});

test("a lost session during an agent read flips the character offline and rethrows", async () => {
  const store = createClientStore();
  store.apply({
    type: "character/online",
    character: {
      characterID: 140000003,
      characterName: "Test Three",
      stationID: 60000004,
      structureID: null,
      solarSystemID: 30002780,
      corporationID: 1000002,
    },
    station: null,
  });
  const { fetch } = makeFakeFetch(() => ({
    status: 404,
    body: { ok: false, error: "SESSION_NOT_FOUND", message: "gone" },
  }));
  const flow = createAppFlow(store, { fetch });

  await assert.rejects(() => flow.loadAgents());
  assert.equal(store.station.get().online, null, "character flipped offline");
});

// --- R35: the three predicates that used to lie ----------------------------
// Every fixture below is built from bytes CAPTURED on the live rail (agent
// 3008416 Antaken Kamola, mission "Tidings of Conflict (1 of 2)", package
// Reports x1 from Muvolailen 60000004 to Elonaya 60000256), not from a guess.

/**
 * The REFUSED Complete, exactly as the live server answered it when the button
 * was pressed docked at the PICKUP station instead of the dropoff.
 *
 * Note what this actually is, because it is not what the code assumed:
 *   * HTTP 200, ok:true — a refusal is indistinguishable from success by status
 *   * missionCompleted is `null`, NOT `false`
 *   * the available-actions list is EMPTY (no Complete, no Quit)
 *   * the only reason given is an OnMissionsUpdated notification naming the
 *     unmet objective: ["TransportItemsPresent", "3814", "60000256", "1"]
 */
function refusedCompleteConversation() {
  return {
    ok: true,
    result: {
      type: "tuple",
      items: [
        {
          type: "tuple",
          items: [
            { type: "tuple", items: [127958, 1382] },
            { type: "list", items: [] },
          ],
        },
        {
          type: "dict",
          entries: [
            ["missionCompleted", null],
            ["missionQuit", null],
            ["missionCantReplay", null],
            ["loyaltyPoints", 0],
            ["missionDeclined", null],
          ],
        },
      ],
    },
    notifications: [
      {
        kind: "client",
        service: null,
        method: "OnMissionsUpdated",
        idType: "charid",
        args: [
          [
            {
              type: "dict",
              entries: [
                ["info", { type: "list", items: ["TransportItemsPresent", "3814", "60000256", "1"] }],
                ["agentID", 3008416],
              ],
            },
          ],
        ],
        kwargs: null,
      },
    ],
  };
}

const LIVE_BRIEFING = {
  missionTitleID: 58607, cargoTypeID: 3814, cargoQuantity: 1, cargoVolume: 0.1,
  pickupLocationID: 60000004, pickupSystemID: 30002780, destinationLocationID: 60000256,
  destinationSystemID: 30001399, rewardISK: "102000", bonusISK: null, loyaltyPoints: 213,
  expirationTime: null, acceptTimestamp: null,
};

test("R35 predicate 1: a REFUSED Complete keeps the briefing and pulls no reward reads", async () => {
  const store = createClientStore();
  store.apply({ type: "agents/briefing", briefing: { ...LIVE_BRIEFING } });
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/agents/3008416/action") {
      return { status: 200, body: refusedCompleteConversation() };
    }
    if (path === "/api/bridge/journal") {
      return { status: 200, body: journalResponse([ACTIVE_MISSION_ROW]) };
    }
    if (path === "/api/bridge/rewards") {
      return { status: 200, body: REWARDS_RESPONSE };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.chooseAction(3008416, { actionID: 819, buttonType: 6, label: "Complete Mission" });

  // The mission did NOT complete, so nothing may be reported as if it had.
  assert.ok(
    !requests.some((r) => r.path === "/api/bridge/rewards"),
    "a refused Complete must not pull the payout reads — there was no payout",
  );
  const agents = store.agents.get();
  // Read again for this layout, and still shown: the last action ended nothing.
  assert.ok(requests.some((r) => r.path === "/api/bridge/agents/3008416/briefing"));
  assert.equal(agents.briefing!.cargoTypeID, LIVE_BRIEFING.cargoTypeID, "the mission is still accepted, so its briefing must survive a refusal");
  assert.equal(agents.briefing!.destinationLocationID, LIVE_BRIEFING.destinationLocationID);
  // The journal still refreshes: the accepted row is genuinely still there.
  assert.equal(agents.journal!.active.length, 1, "the mission is still in the journal");
});

test("R35 predicate 1: a SUCCESSFUL Complete (missionCompleted true) still clears and pays out", async () => {
  const store = createClientStore();
  store.apply({ type: "agents/briefing", briefing: { ...LIVE_BRIEFING } });
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/agents/3008416/action") {
      return { status: 200, body: completedConversation() };
    }
    if (path === "/api/bridge/rewards") {
      return { status: 200, body: REWARDS_RESPONSE };
    }
    if (path === "/api/bridge/journal") {
      return { status: 200, body: journalResponse([]) };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.chooseAction(3008416, { actionID: 821, buttonType: 6, label: "Complete Mission" });

  assert.ok(requests.some((r) => r.path === "/api/bridge/rewards"), "rewards pulled on a real completion");
  assert.equal(store.agents.get().briefing, null, "a real completion clears the briefing");
});

test("R35 predicate 2: loadPackageIntoShip picks the mission's stack, not the first of that type", async () => {
  const store = createClientStore();
  // The player's OWN Reports sit in the hangar first (a bigger stack, and the
  // one `.find(row => row.typeID === cargoTypeID)` used to grab). The mission
  // package is the stack whose quantity is the mission's quantity.
  const inventoryResponse = {
    ok: true,
    stationID: 60000004,
    activeShipID: 9988400091900,
    hangar: {
      list: {
        type: "list",
        items: [
          { type: "packedrow", fields: { itemID: 5555, typeID: 3814, quantity: 40, flagID: 4 } },
          { type: "packedrow", fields: { itemID: 9988400091901, typeID: 3814, quantity: 1, flagID: 4 } },
        ],
      },
      capacity: null,
      error: null,
    },
    cargo: { shipID: 9988400091900, list: { type: "list", items: [] }, capacity: null, error: null },
  };
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory") {
      return { status: 200, body: inventoryResponse };
    }
    if (path === "/api/bridge/inventory/transfer") {
      return {
        status: 200,
        body: { ok: true, applied: true, moved: [9988400091901], reminted: [], declined: [], declinedSilently: false, notFound: [] },
      };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadPackageIntoShip(3814, 1);

  const transfer = requests.find((r) => r.path === "/api/bridge/inventory/transfer");
  assert.ok(transfer, "the package was transferred");
  assert.deepEqual(
    transfer!.body.itemIDs,
    [9988400091901],
    "the stack matching the MISSION quantity is the package — not the player's own 40",
  );
  assert.equal(transfer!.body.qty, 1, "exactly the mission quantity moves");
  assert.equal(store.agents.get().actionError, null);
});

test("R35 predicate 3: the courier load goes through the VERIFYING transfer route", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory") {
      return {
        status: 200,
        body: {
          ok: true, stationID: 60000004, activeShipID: 9988400091900,
          hangar: {
            list: { type: "list", items: [{ type: "packedrow", fields: { itemID: 9988400091901, typeID: 3814, quantity: 1, flagID: 4 } }] },
            capacity: null, error: null,
          },
          cargo: { shipID: 9988400091900, list: { type: "list", items: [] }, capacity: null, error: null },
        },
      };
    }
    if (path === "/api/bridge/inventory/transfer") {
      return { status: 200, body: { ok: true, applied: true, moved: [9988400091901], reminted: [], declined: [], declinedSilently: false, notFound: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadPackageIntoShip(3814, 1);

  assert.ok(
    !requests.some((r) => r.path === "/api/bridge/inventory/move"),
    "the unverified /move route must no longer carry the mission package",
  );
  const transfer = requests.find((r) => r.path === "/api/bridge/inventory/transfer");
  assert.ok(transfer, "the verifying /transfer route carries it instead");
  assert.deepEqual(transfer!.body.from, { kind: "hangar" });
  assert.deepEqual(transfer!.body.to, { kind: "cargo" });
});

test("R35 predicate 3: a SILENTLY DECLINED package move is reported, not passed off as loaded", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/inventory") {
      return {
        status: 200,
        body: {
          ok: true, stationID: 60000004, activeShipID: 9988400091900,
          hangar: {
            list: { type: "list", items: [{ type: "packedrow", fields: { itemID: 9988400091901, typeID: 3814, quantity: 1, flagID: 4 } }] },
            capacity: null, error: null,
          },
          cargo: { shipID: 9988400091900, list: { type: "list", items: [] }, capacity: null, error: null },
        },
      };
    }
    if (path === "/api/bridge/inventory/transfer") {
      // The shape /move could never see: a 200 in which nothing moved.
      return {
        status: 200,
        body: { ok: true, applied: false, moved: [], reminted: [], declined: [9988400091901], declinedSilently: true, notFound: [] },
      };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadPackageIntoShip(3814, 1);

  assert.match(
    store.agents.get().actionError ?? "",
    /did not move|could not be loaded|refused/i,
    "a silent decline must reach the player, not be reported as a successful load",
  );
});

// --- the window as the client lays it out ------------------------------------

/** A conversation with these (actionID, buttonType) on offer and this said of the last action. */
function conversationWith(actions: readonly (readonly [number, number])[], info: readonly (readonly [string, unknown])[] = [["loyaltyPoints", 0]]) {
  return {
    ok: true,
    result: {
      type: "tuple",
      items: [
        {
          type: "tuple",
          items: [
            { type: "tuple", items: [127958, 1382] },
            { type: "list", items: actions.map(([actionID, buttonType]) => ({ type: "tuple", items: [actionID, buttonType] })) },
          ],
        },
        { type: "dict", entries: info.map(([name, value]) => [name, value]) },
      ],
    },
    notifications: [],
  };
}

/** A flow whose agent answers each DoAction from `answers`, by the action pressed (null for the opening). */
async function talking(answers: Record<string, ReturnType<typeof conversationWith>>, agentTypeID: number | null = 2) {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path, _method, body) => {
    if (path === "/api/bridge/agents") {
      return { status: 200, body: { ...AGENTS_RESPONSE, agents: agentTypeID === null ? [] : [{ ...AGENTS_RESPONSE.agents[0]!, agentTypeID }] } };
    }
    if (path === "/api/bridge/agents/3008416/action") {
      const answer = answers[String(body.actionID)];
      if (!answer) throw new Error(`no answer for action ${String(body.actionID)}`);
      return { status: 200, body: answer };
    }
    if (path === "/api/bridge/journal") {
      return { status: 200, body: journalResponse([]) };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });
  await flow.loadAgents();
  requests.length = 0;
  const pressed = () => requests.filter((request) => request.path.endsWith("/action")).map((request) => request.body.actionID);
  return { store, flow, requests, pressed };
}

test("opening an agent's window presses Request Mission at once, as the client's window does", async () => {
  const { store, flow, requests, pressed } = await talking({
    null: conversationWith([[821, 2]]),
    821: conversationWith([[816, 3], [817, 9]]),
  });
  await flow.openConversation(3008416);
  assert.deepEqual(pressed(), [null, 821]);
  // One layout, of what came of the press: the briefing read once, after both. Then the journal, which the press changed.
  assert.deepEqual(requests.map((request) => request.path.split("/").at(-1)), ["action", "action", "briefing", "journal"]);
  assert.notEqual(store.agents.get().journal, null);
  const agents = store.agents.get();
  assert.deepEqual(agents.conversation!.actions.map((action) => action.buttonType), [3, 9]);
  assert.equal(agents.briefing!.cargoTypeID, 3814);
  assert.equal(agents.actionError, null);
});

test("the opening press is for an agent with nothing else to do: not a locator, not a research agent, unless it is all there is", async () => {
  const offer = conversationWith([[816, 3], [817, 9]]);
  // View Mission first, with more on offer, from an ordinary agent: pressed.
  const ordinary = await talking({ null: conversationWith([[900, 1], [901, 10]]), 900: offer });
  await ordinary.flow.openConversation(3008416);
  assert.deepEqual(ordinary.pressed(), [null, 900]);
  // The same from a research agent: left for the pilot.
  const research = await talking({ null: conversationWith([[900, 1], [901, 13], [902, 14]]) }, 4);
  await research.flow.openConversation(3008416);
  assert.deepEqual(research.pressed(), [null]);
  assert.deepEqual(research.store.agents.get().conversation!.actions.map((action) => action.buttonType), [1, 13, 14]);
  // And from an agent that also locates characters.
  const locator = await talking({ null: conversationWith([[900, 2], [903, 15]]) });
  await locator.flow.openConversation(3008416);
  assert.deepEqual(locator.pressed(), [null]);
  // A research agent with only the mission on offer: pressed.
  const only = await talking({ null: conversationWith([[900, 2]]), 900: offer }, 4);
  await only.flow.openConversation(3008416);
  assert.deepEqual(only.pressed(), [null, 900]);
  // Something other than a mission first: nothing is pressed.
  const other = await talking({ null: conversationWith([[816, 3], [900, 2]]) });
  await other.flow.openConversation(3008416);
  assert.deepEqual(other.pressed(), [null]);
  // An agent the roster does not have: only when it is all there is.
  const unknown = await talking({ null: conversationWith([[900, 2], [901, 10]]) }, null);
  await unknown.flow.openConversation(3008416);
  assert.deepEqual(unknown.pressed(), [null]);
  // Nothing on offer at all.
  const silent = await talking({ null: conversationWith([]) });
  await silent.flow.openConversation(3008416);
  assert.deepEqual(silent.pressed(), [null]);
  // With nothing pressed, nothing changed, and the journal is not read again.
  assert.equal(silent.requests.some((request) => request.path === "/api/bridge/journal"), false);
});

test("the briefing and the objectives are read for every layout, whatever was pressed", async () => {
  const { store, flow, requests } = await talking({ 818: conversationWith([[816, 3], [817, 9]]) });
  // Defer: not an accept, a decline or a completion.
  await flow.chooseAction(3008416, { actionID: 818, buttonType: 10, label: "Defer" });
  assert.deepEqual(requests.map((request) => request.path.split("/").at(-1)), ["action", "briefing", "journal"]);
  assert.equal(store.agents.get().briefing!.cargoTypeID, 3814);
});

test("the objectives are not shown when the last action ended the mission, or the agent said not yet", async () => {
  for (const [name, value] of [["missionCompleted", true], ["missionDeclined", true], ["missionQuit", true], ["missionCantReplay", 3_600_000]] as const) {
    const { store, flow, requests } = await talking({ 820: conversationWith([[821, 2]], [[name, value], ["loyaltyPoints", 0]]) });
    await flow.chooseAction(3008416, { actionID: 820, buttonType: 11, label: "Quit" });
    // Read all the same, as the client reads it; it is the showing that the rule decides.
    assert.ok(requests.some((request) => request.path.endsWith("/briefing")), name);
    assert.equal(store.agents.get().briefing, null, name);
  }
  // None of them said: shown.
  const still = await talking({ 820: conversationWith([[819, 6]], [["missionCompleted", false], ["missionDeclined", null], ["missionCantReplay", 0]]) });
  await still.flow.chooseAction(3008416, { actionID: 820, buttonType: 8, label: "Continue" });
  assert.equal(still.store.agents.get().briefing!.cargoTypeID, 3814);
});

test("a briefing that cannot be read leaves the conversation on show and says what went wrong", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/agents/3008416/action") return { status: 200, body: offeredConversation() };
    if (path === "/api/bridge/agents/3008416/briefing") return { status: 502, body: { ok: false, error: "CALL_FAILED", message: "no" } };
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });
  await flow.openConversation(3008416);
  const agents = store.agents.get();
  assert.equal(agents.conversation!.actions.length, 2);
  assert.equal(agents.briefing, null);
  assert.notEqual(agents.actionError, null);
});

// --- the window listens, as the client's does ---------------------------------
//
// agentDialogueWindow has two notify events: OnAgentMissionChange and OnSessionChanged. These tests push
// them down the live channel, as the server does.

const LISTENING_PILOT = 140000002;
const OTHER_AGENT = 3008417;

interface PushSource {
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

/**
 * A pilot online with its live channel open and the Agents panel loaded. Its agents answer each DoAction
 * from `answers`, by the action pressed (null for the opening). `hold` makes every DoAction wait.
 */
async function listening(answers: Record<string, ReturnType<typeof conversationWith>>, options: { journal?: boolean } = {}) {
  const store = createClientStore();
  const requests: Recorded[] = [];
  const state: {
    hold: Promise<void> | null;
    /** One action made to wait, by what was pressed (null for the opening). */
    holdAction: { actionID: number | null; wait: Promise<void> } | null;
    journalHold: Promise<void> | null;
    failAction: boolean;
    sessionGone: boolean;
    failJournal: boolean;
    /** How many more DoActions the BFF refuses because the pilot is busy with a write. */
    busyFor: number;
  } = { hold: null, holdAction: null, journalHold: null, failAction: false, sessionGone: false, failJournal: false, busyFor: 0 };
  const fetchImpl = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const path = String(input);
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : {};
    requests.push({ path, method: (init && init.method) || "GET", body });
    let status = 200;
    let answer: unknown = { ok: true };
    if (path === "/api/bridge/call") {
      // What coming online reads of the station: answered with nothing, in the route's own envelope.
      answer = { ok: true, service: body.service, method: body.method, result: null, notifications: [] };
    } else if (path === "/api/bridge/select") {
      answer = {
        ok: true,
        character: { characterID: LISTENING_PILOT, characterName: "Test Two", stationID: 60000004, structureID: null, solarSystemID: 30002780, corporationID: 1000002 },
        station: null,
        notifications: [],
      };
    } else if (path === "/api/bridge/agents") {
      answer = { ...AGENTS_RESPONSE, agents: [AGENTS_RESPONSE.agents[0]!, { ...AGENTS_RESPONSE.agents[0]!, agentID: OTHER_AGENT }] };
    } else if (/^\/api\/bridge\/agents\/\d+\/action$/.test(path)) {
      if (state.hold) await state.hold;
      if (state.holdAction && state.holdAction.actionID === body.actionID) await state.holdAction.wait;
      if (state.busyFor > 0) {
        state.busyFor -= 1;
        status = 409;
        answer = { ok: false, error: "CHARACTER_IN_USE", message: "This pilot is busy with another action." };
      } else if (state.sessionGone) {
        status = 404;
        answer = { ok: false, error: "SESSION_NOT_FOUND", message: "The game session is gone." };
      } else if (state.failAction) {
        status = 409;
        answer = { ok: false, error: "CALL_REFUSED", message: "The agent will not talk now." };
      } else {
        answer = answers[String(body.actionID)];
        if (!answer) throw new Error(`no answer for action ${String(body.actionID)}`);
      }
    } else if (/\/briefing$/.test(path)) {
      answer = BRIEFING_RESPONSE;
    } else if (path === "/api/bridge/journal") {
      if (state.journalHold) await state.journalHold;
      if (state.failJournal) {
        status = 502;
        answer = { ok: false, error: "EVE_GATEWAY_UNREACHABLE", message: "The game server is unreachable." };
      } else {
        answer = journalResponse([ACTIVE_MISSION_ROW]);
      }
    }
    return { ok: status >= 200 && status < 300, status, async json() { return answer; } };
  }) as unknown as typeof fetch;
  const sources: PushSource[] = [];
  const eventSource = (): PushSource => {
    const source: PushSource = { onmessage: null, onopen: null, onerror: null, close() {} };
    sources.push(source);
    return source;
  };
  const flow = createAppFlow(store, { fetch: fetchImpl, eventSource, agentTalkAgainWaitMs: 2 });
  await flow.selectCharacter(LISTENING_PILOT);
  const source = sources[0];
  assert.ok(source, "coming online opens the live channel");
  source.onopen?.();
  await flow.loadAgents();
  if (options.journal !== false) await flow.loadJournal();
  requests.length = 0;
  let sequence = 0;
  /** The server pushes a notification, and what it sets going is given time to finish. */
  const push = async (method: string, args: readonly unknown[], kind = "client") => {
    sequence += 1;
    source.onmessage?.({
      data: JSON.stringify({
        source: "evejs-web-gateway",
        apiVersion: 1,
        type: "event",
        cursor: { epoch: "epoch-1", sequence },
        event: { kind: "notification", notification: { kind, service: null, method, args, kwargs: null } },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  };
  /** What was asked about agents and the journal, each by its last word (and the action pressed), sorted. */
  const asked = () => requests
    .filter((request) => request.path.startsWith("/api/bridge/agents/") || request.path === "/api/bridge/journal")
    .map((request) => (request.path.endsWith("/action") ? `${request.path.split("/").at(-2)}:action:${String(request.body.actionID)}` : request.path.split("/").at(-1) ?? ""))
    .sort();
  return { store, flow, requests, push, asked, state };
}

const ACCEPTED = conversationWith([[819, 6], [822, 11]]);

/** Waits until something is so, for two seconds at most. */
async function until(what: () => boolean): Promise<void> {
  for (let waited = 0; waited < 2000 && !what(); waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("told its mission was modified, the open window talks to its agent again, and the journal is read again", async () => {
  const { store, flow, requests, push, asked } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  requests.length = 0;

  await push("OnAgentMissionChange", ["modified", 3008416]);
  // The whole opening again, and its layout: what the agent says, then the mission beside it.
  assert.deepEqual(asked(), ["3008416:action:null", "briefing", "journal"]);
  assert.equal(store.agents.get().activeAgentID, 3008416);
  assert.deepEqual(store.agents.get().conversation?.actions.map((action) => action.buttonType), [6, 11]);
  assert.equal(store.agents.get().actionError, null);
});

test("talking again is the opening again: a mission to view is pressed for, as when the window opened", async () => {
  const { flow, requests, push, asked } = await listening({ null: conversationWith([[900, 1]]), 900: ACCEPTED });
  await flow.openConversation(3008416);
  requests.length = 0;
  await push("OnAgentMissionChange", ["modified", 3008416]);
  // The journal twice: once for the change the server told of, and once for the window's own press, as at any opening.
  assert.deepEqual(asked(), ["3008416:action:900", "3008416:action:null", "briefing", "journal", "journal"]);
});

test("another agent's mission modified leaves the window alone; the journal is still out of date", async () => {
  const { flow, requests, push, asked } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  requests.length = 0;
  await push("OnAgentMissionChange", ["modified", OTHER_AGENT]);
  assert.deepEqual(asked(), ["journal"]);
});

test("what else the server says of a mission leaves the window as it is, and the journal is read again each time", async () => {
  const { store, flow, requests, push, asked } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  for (const action of ["accepted", "completed", "offered", "offer_declined", "quit", "failed", "prolong"]) {
    requests.length = 0;
    await push("OnAgentMissionChange", [action, 3008416]);
    assert.deepEqual(asked(), ["journal"], action);
    assert.equal(store.agents.get().activeAgentID, 3008416, action);
  }
});

test("the offer taken away, the mission reset, or the talk done: the window on that agent closes", async () => {
  for (const action of ["offer_removed", "reset", "talk_to_completed"]) {
    const { store, flow, requests, push, asked } = await listening({ null: ACCEPTED });
    await flow.openConversation(3008416);
    assert.notEqual(store.agents.get().briefing, null, "a mission is laid out beside what the agent says");
    requests.length = 0;

    // About another agent: nothing closes.
    await push("OnAgentMissionChange", [action, OTHER_AGENT]);
    assert.equal(store.agents.get().activeAgentID, 3008416, action);

    await push("OnAgentMissionChange", [action, 3008416]);
    const agents = store.agents.get();
    assert.equal(agents.activeAgentID, null, action);
    assert.equal(agents.conversation, null, action);
    assert.equal(agents.briefing, null, action);
    // The roster and the journal are still there, and nothing was asked of the agent.
    assert.equal(agents.agents.length, 2);
    assert.notEqual(agents.journal, null);
    assert.deepEqual(asked(), ["journal", "journal"], action);
  }
});

test("with no window open a mission change is the journal's alone, and a journal never read is not read", async () => {
  const read = await listening({ null: ACCEPTED });
  await read.push("OnAgentMissionChange", ["modified", 3008416]);
  assert.deepEqual(read.asked(), ["journal"]);

  const unread = await listening({ null: ACCEPTED }, { journal: false });
  await unread.push("OnAgentMissionChange", ["modified", 3008416]);
  await unread.push("OnAgentMissionChange", ["reset", null]);
  assert.deepEqual(unread.asked(), []);
});

test("a window that is talking to its agent is not made to start again", async () => {
  const { flow, requests, push, asked, state } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  requests.length = 0;

  let release!: () => void;
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  const opening = flow.openConversation(3008416);
  // While that DoAction is out: the server says modified twice, and the pilot changes station.
  await push("OnAgentMissionChange", ["modified", 3008416]);
  await push("OnAgentMissionChange", ["modified", 3008416]);
  await push("OnSessionChanged", [{ stationid: [60000004, null] }], "sessionchange");
  release();
  await opening;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(asked().filter((word) => word !== "journal"), ["3008416:action:null", "briefing"]);

  // Once it has finished, it can be told again.
  state.hold = null;
  requests.length = 0;
  await push("OnAgentMissionChange", ["modified", 3008416]);
  assert.deepEqual(asked(), ["3008416:action:null", "briefing", "journal"]);
});

test("a button pressed while the window is talking to that agent does nothing; another agent's window is its own", async () => {
  const { store, flow, requests, asked, state } = await listening({ null: ACCEPTED, 819: conversationWith([], [["missionCompleted", true]]) });
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  const opening = flow.openConversation(3008416);
  const pressed = flow.chooseAction(3008416, { actionID: 819, buttonType: 6, label: "Complete Mission" });
  const other = flow.openConversation(OTHER_AGENT);
  release();
  await Promise.all([opening, pressed, other]);
  assert.deepEqual(asked().filter((word) => word.includes(":action:")), ["3008416:action:null", "3008417:action:null"]);
  // Afterwards the button works.
  state.hold = null;
  requests.length = 0;
  await flow.chooseAction(3008416, { actionID: 819, buttonType: 6, label: "Complete Mission" });
  assert.deepEqual(asked().filter((word) => word.includes(":action:")), ["3008416:action:819"]);
  assert.equal(store.agents.get().actionError, null);
});

test("changes that come while the journal is being read are answered by one more read, not one each", async () => {
  const { push, asked, state } = await listening({ null: ACCEPTED });
  let release!: () => void;
  state.journalHold = new Promise<void>((resolve) => { release = resolve; });
  await push("OnAgentMissionChange", ["completed", 3008416]);
  await push("OnAgentMissionChange", ["offered", OTHER_AGENT]);
  await push("OnAgentMissionChange", ["accepted", OTHER_AGENT]);
  assert.deepEqual(asked(), ["journal"], "one read is out");
  state.journalHold = null;
  release();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(asked(), ["journal", "journal"]);
  // And the next change after that is read for as usual.
  await push("OnAgentMissionChange", ["quit", OTHER_AGENT]);
  assert.deepEqual(asked(), ["journal", "journal", "journal"]);
});

test("the pilot changes station, and the open window talks to its agent again", async () => {
  const { store, flow, requests, push, asked } = await listening({ null: ACCEPTED });
  // No window open: a change of station asks nothing of any agent.
  await push("OnSessionChanged", [{ stationid: [60000004, null], solarsystemid: [null, 30002780] }], "sessionchange");
  assert.deepEqual(asked(), []);

  await flow.openConversation(3008416);
  requests.length = 0;
  // Undocked: the station is one of the things that changed.
  await push("OnSessionChanged", [{ stationid: [60000004, null], solarsystemid: [null, 30002780] }], "sessionchange");
  assert.deepEqual(asked(), ["3008416:action:null", "briefing"]);
  // Something else changed (another ship boarded): the window stays as it is.
  requests.length = 0;
  await push("OnSessionChanged", [{ shipid: [1, 2] }], "sessionchange");
  await push("OnSessionChanged", [null], "sessionchange");
  assert.deepEqual(asked(), []);
  assert.equal(store.agents.get().activeAgentID, 3008416);
});

test("the agent refusing to talk again is shown where the conversation is, and nothing is thrown", async () => {
  const { store, flow, push, state } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  state.failAction = true;
  await push("OnAgentMissionChange", ["modified", 3008416]);
  assert.match(store.agents.get().actionError ?? "", /will not talk now/);
  // The conversation that was on show stays on show.
  assert.equal(store.agents.get().activeAgentID, 3008416);
  assert.deepEqual(store.agents.get().conversation?.actions.map((action) => action.buttonType), [6, 11]);
});

test("the session going while the window talks again takes the pilot offline, and nothing is left unhandled", async () => {
  const { store, flow, push, state } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  assert.notEqual(store.station.get().online, null);
  state.sessionGone = true;
  await push("OnSessionChanged", [{ stationid: [60000004, null] }], "sessionchange");
  assert.equal(store.station.get().online, null);
});

test("a journal that cannot be read stays as it was, and the next change reads it again", async () => {
  const { store, push, asked, state } = await listening({ null: ACCEPTED });
  const before = store.agents.get().journal;
  state.failJournal = true;
  await push("OnAgentMissionChange", ["offered", OTHER_AGENT]);
  assert.deepEqual(asked(), ["journal"]);
  assert.equal(store.agents.get().journal, before);
  state.failJournal = false;
  await push("OnAgentMissionChange", ["accepted", OTHER_AGENT]);
  assert.deepEqual(asked(), ["journal", "journal"]);
  assert.notEqual(store.agents.get().journal, null);
});

test("a window the server closes while its own press is out is not opened again by the answer", async () => {
  // Declining: the server answers with the agent's parting words, and on the way says the mission was reset.
  const { store, flow, requests, push, asked, state } = await listening({ null: ACCEPTED, 817: conversationWith([[821, 2]], [["missionDeclined", true]]) });
  await flow.openConversation(3008416);
  requests.length = 0;

  let release!: () => void;
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  const pressed = flow.chooseAction(3008416, { actionID: 817, buttonType: 9, label: "Decline" });
  await push("OnAgentMissionChange", ["reset", 3008416]);
  assert.equal(store.agents.get().activeAgentID, null, "the window closed when it was told");
  release();
  await pressed;
  const agents = store.agents.get();
  assert.equal(agents.activeAgentID, null, "and the answer did not open it again");
  assert.equal(agents.conversation, null);
  assert.equal(agents.briefing, null);
  // Nothing was read for a layout nobody will see.
  assert.deepEqual(asked().filter((word) => word !== "journal"), ["3008416:action:817"]);

  // Clicked again, the agent is talked to as from new.
  state.hold = null;
  requests.length = 0;
  await flow.openConversation(3008416);
  assert.equal(store.agents.get().activeAgentID, 3008416);
  assert.deepEqual(asked(), ["3008416:action:null", "briefing"]);
});

test("a window closed while it was opening stays closed, at either of its two questions", async () => {
  for (const under of [null, 900]) {
    const { store, flow, push, asked, state } = await listening({ null: conversationWith([[900, 1]]), 900: ACCEPTED });
    let release!: () => void;
    state.holdAction = { actionID: under, wait: new Promise<void>((resolve) => { release = resolve; }) };
    const opening = flow.openConversation(3008416);
    // Time for the window to reach the question it is to be closed under.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await push("OnAgentMissionChange", ["reset", 3008416]);
    release();
    await opening;
    assert.equal(store.agents.get().activeAgentID, null, String(under));
    assert.equal(store.agents.get().conversation, null, String(under));
    assert.equal(store.agents.get().actionError, null, "and stopping there is not a failure");
    // It stopped where it was closed: no further question, and nothing read for a layout.
    assert.deepEqual(asked().filter((word) => word !== "journal"), under === null ? ["3008416:action:null"] : ["3008416:action:900", "3008416:action:null"], String(under));
  }
});

test("a close told of another agent, or with nothing out, does not swallow the next answer", async () => {
  const { store, flow, push, state } = await listening({ null: ACCEPTED, 819: conversationWith([], [["missionCompleted", true]]) });
  await flow.openConversation(3008416);
  // Closed with nothing out, then opened again: the opening is laid out.
  await push("OnAgentMissionChange", ["reset", 3008416]);
  await flow.openConversation(3008416);
  assert.equal(store.agents.get().activeAgentID, 3008416);

  // A press is out, and ANOTHER agent's mission is reset: this window's answer is laid out.
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  const pressed = flow.chooseAction(3008416, { actionID: 819, buttonType: 6, label: "Complete Mission" });
  await push("OnAgentMissionChange", ["reset", OTHER_AGENT]);
  release();
  await pressed;
  assert.equal(store.agents.get().activeAgentID, 3008416);
  assert.equal(store.agents.get().conversation?.lastActionInfo.missionCompleted, true);
});

test("one agent's window closed under its question leaves another's answer to be laid out", async () => {
  const { store, flow, push, state } = await listening({ null: ACCEPTED });
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  const first = flow.openConversation(3008416);
  const second = flow.openConversation(OTHER_AGENT);
  await new Promise((resolve) => setTimeout(resolve, 25));
  await push("OnAgentMissionChange", ["reset", 3008416]);
  release();
  await Promise.all([first, second]);
  assert.equal(store.agents.get().activeAgentID, OTHER_AGENT);
  assert.notEqual(store.agents.get().conversation, null);
});

test("told to talk again while the pilot's own write is out, the window asks until the pilot is free", async () => {
  const { store, flow, requests, push, asked, state } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  requests.length = 0;
  // The undock that changed the station is still out: the BFF refuses twice, then answers.
  state.busyFor = 2;
  await push("OnSessionChanged", [{ stationid: [60000004, null] }], "sessionchange");
  await until(() => asked().includes("briefing"));
  assert.deepEqual(asked(), ["3008416:action:null", "3008416:action:null", "3008416:action:null", "briefing"]);
  assert.equal(store.agents.get().actionError, null);
  assert.equal(store.agents.get().activeAgentID, 3008416);
});

test("a pilot that stays busy is given up on after fifteen tries, and the window says why", async () => {
  const { store, flow, requests, push, asked, state } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  requests.length = 0;
  state.busyFor = 100;
  await push("OnAgentMissionChange", ["modified", 3008416]);
  await until(() => store.agents.get().actionError !== null);
  assert.equal(asked().filter((word) => word === "3008416:action:null").length, 15);
  assert.match(store.agents.get().actionError ?? "", /busy with another action/);
});

test("an agent clicked while the pilot is busy is refused at once, as any click is", async () => {
  const { store, flow, requests, asked, state } = await listening({ null: ACCEPTED });
  state.busyFor = 1;
  await flow.openConversation(3008416);
  assert.deepEqual(asked(), ["3008416:action:null"]);
  assert.match(store.agents.get().actionError ?? "", /busy with another action/);
  assert.equal(store.agents.get().activeAgentID, null);
  void requests;
});

test("only being busy is waited out: any other refusal of the window's own question is shown at once", async () => {
  const { store, flow, requests, push, asked, state } = await listening({ null: ACCEPTED });
  await flow.openConversation(3008416);
  requests.length = 0;
  state.failAction = true;
  await push("OnAgentMissionChange", ["modified", 3008416]);
  assert.deepEqual(asked().filter((word) => word.includes(":action:")), ["3008416:action:null"]);
  assert.match(store.agents.get().actionError ?? "", /will not talk now/);
});
