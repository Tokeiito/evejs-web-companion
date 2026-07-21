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

  // DoAction(None) opens the conversation.
  assert.deepEqual(requests[0]!.body, { actionID: null });
  const agents = store.agents.get();
  assert.equal(agents.activeAgentID, 3008416);
  assert.equal(agents.conversation!.actions.length, 2);
  assert.equal(agents.conversation!.actions[0]!.buttonType, 3);
  assert.equal(agents.actionError, null);
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
    if (path === "/api/bridge/inventory/move") {
      return { status: 200, body: { ok: true, notifications: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadPackageIntoShip(3814);

  const move = requests.find((r) => r.path === "/api/bridge/inventory/move");
  assert.ok(move, "the matching package was moved");
  // The itemID whose typeID matches the cargo type is moved into the ship cargo.
  assert.equal(move!.body.itemID, 7777);
  assert.equal(move!.body.direction, "toCargo");
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

  await flow.loadPackageIntoShip(3814);

  assert.ok(!requests.some((r) => r.path === "/api/bridge/inventory/move"), "no move issued");
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
