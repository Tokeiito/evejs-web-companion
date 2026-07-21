// The R23 slice B controller against a faked BFF: holds, survey, quote,
// unload, reprocess.
//
// What is pinned here is mostly what the flow REFUSES to claim. Both mutating
// actions move or consume real property, so neither trusts its own 200: the BFF
// re-reads and the flow reports what that re-read said. Three outcomes stay
// distinct, where a naive client would collapse all of them into "done":
//
//   refused             -> the server's own reason, verbatim
//   changed nothing     -> a silent decline, said plainly, with no cause invented
//   could not be checked -> "unknown", which is neither success nor decline
//
// And one number gets special care: the station's reprocessing TAX is debited
// from the player's wallet, so an unknown rate must never render as 0.

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

const ORE_STACK_ID = 8800001;
const ICE_STACK_ID = 8800002;

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

function holdsBody(): unknown {
  return { ok: true, activeShipID: 9001, stationID: 60003760, holds: HOLDS };
}

// --- Reads ------------------------------------------------------------------

test("loadMiningHolds lands the holds, by name", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/ship/ore-hold") {
      return { status: 200, body: holdsBody() };
    }
    throw new Error(`unexpected ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadMiningHolds();
  const state = store.mining.get();
  assert.equal(state.holdsLoaded, true);
  assert.equal(state.holds[0]?.label, "Ore hold");
  assert.equal(state.holds[0]?.items?.length, 1);
});

test("a failed holds read is surfaced, not swallowed", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 409,
    body: { ok: false, error: "NO_ACTIVE_SHIP", message: "No active ship." },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadMiningHolds();
  assert.equal(
    store.mining.get().holdsError,
    "Your holds could not be read: You are not in a ship right now.",
  );
});

test("runSurveyScan lands what the scanner saw, with its zeroes intact", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: {
      ok: true,
      results: [
        [50001248, 1230, 4200],
        [50001249, 1228, 0],
      ],
      notifications: [],
    },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.runSurveyScan();
  const survey = store.mining.get().survey;
  assert.equal(survey.length, 2);
  assert.equal(survey[1]?.remainingQuantity, 0, "a mined-out rock is a real answer");
  assert.ok((store.mining.get().surveyAtMs ?? 0) > 0, "the scan is timestamped");
});

test("loadReprocessingQuote lands the quote AND the station's tax", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(() => ({
    status: 200,
    body: {
      ok: true,
      stationID: 60003760,
      taxRate: 0.05,
      quotes: [
        {
          itemID: ORE_STACK_ID,
          typeID: 1230,
          quantityToProcess: 500,
          leftOvers: 0,
          iskCost: 1234.5,
          outputs: [{ typeID: 34, quantity: 1000 }],
        },
      ],
    },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadReprocessingQuote([ORE_STACK_ID]);
  const state = store.mining.get();
  assert.equal(state.taxRate, 0.05);
  assert.equal(state.quotes[0]?.iskCost, 1234.5);
  assert.deepEqual(state.quotesFor, [ORE_STACK_ID]);
  assert.match(requests[0]?.path ?? "", /itemIDs=/);
});

test("⚠ an unknown tax rate stays NULL — never 0", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 200,
    body: { ok: true, stationID: 1, taxRate: null, quotes: [] },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.loadReprocessingQuote([ORE_STACK_ID]);
  assert.equal(
    store.mining.get().taxRate,
    null,
    "reprocessing debits this from the wallet — a wrong 0 says the refinery is free",
  );
});

test("a failed quote CLEARS the previous one rather than leaving stale numbers up", async () => {
  const store = createClientStore();
  let fail = false;
  const { fetch } = makeFakeFetch(() =>
    fail
      ? { status: 409, body: { ok: false, error: "NOT_DOCKED", message: "Dock first." } }
      : {
          status: 200,
          body: {
            ok: true,
            stationID: 1,
            taxRate: 0.05,
            quotes: [{ itemID: ORE_STACK_ID, typeID: 1230, outputs: [] }],
          },
        },
  );
  const flow = createAppFlow(store, { fetch });

  await flow.loadReprocessingQuote([ORE_STACK_ID]);
  assert.equal(store.mining.get().quotes.length, 1);

  fail = true;
  await flow.loadReprocessingQuote([ICE_STACK_ID]);
  const state = store.mining.get();
  assert.deepEqual(state.quotes, [], "a stale quote could arm a confirmation for other stacks");
  assert.equal(state.taxRate, null);
  // R31 — the refusal still says the quote failed and why; NOT_DOCKED is now
  // explained rather than named.
  assert.equal(
    state.quotesError,
    "The refinery could not quote that: Your ship is in space. That can only be done while docked.",
  );
});

// --- Unloading --------------------------------------------------------------

test("unloadMiningHolds reports success quietly, and re-reads the holds", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/ship/ore-hold/unload") {
      return {
        status: 200,
        body: { ok: true, requested: [ORE_STACK_ID], moved: [ORE_STACK_ID], remaining: [] },
      };
    }
    return { status: 200, body: holdsBody() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.unloadMiningHolds([ORE_STACK_ID]);
  const state = store.mining.get();
  assert.equal(state.lastAction, "Unload");
  assert.equal(state.silentDecline, null);
  assert.equal(state.actionError, null);
  assert.ok(
    requests.some((entry) => entry.path === "/api/bridge/ship/ore-hold"),
    "the holds are re-read so the panel shows the truth after the move",
  );
});

test("an unload that moved NOTHING is a silent decline, with no cause invented", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/ship/ore-hold/unload") {
      return {
        status: 200,
        body: { ok: true, requested: [ORE_STACK_ID], moved: [], remaining: [ORE_STACK_ID] },
      };
    }
    return { status: 200, body: holdsBody() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.unloadMiningHolds([ORE_STACK_ID]);
  const state = store.mining.get();
  assert.equal(state.actionError, null, "nothing was refused");
  assert.match(state.silentDecline ?? "", /gave no reason/i);
  assert.doesNotMatch(state.silentDecline ?? "", /full|capacity|space|room/i);
});

test("a PARTIAL unload says exactly how much moved", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/ship/ore-hold/unload") {
      return {
        status: 200,
        body: {
          ok: true,
          requested: [ORE_STACK_ID, ICE_STACK_ID],
          moved: [ORE_STACK_ID],
          remaining: [ICE_STACK_ID],
        },
      };
    }
    return { status: 200, body: holdsBody() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.unloadMiningHolds([ORE_STACK_ID, ICE_STACK_ID]);
  assert.match(store.mining.get().silentDecline ?? "", /Only 1 of 2/);
});

test("an unload that could not be VERIFIED says 'unknown', not success", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/ship/ore-hold/unload") {
      // moved: null — the BFF could not re-read the holds.
      return {
        status: 200,
        body: { ok: true, requested: [ORE_STACK_ID], moved: null, remaining: null },
      };
    }
    return { status: 200, body: holdsBody() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.unloadMiningHolds([ORE_STACK_ID]);
  assert.match(store.mining.get().silentDecline ?? "", /unknown/i);
});

test("an unload refusal carries the server's own reason", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 409,
    body: { ok: false, error: "NOT_DOCKED", message: "Dock at a station before unloading." },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.unloadMiningHolds([ORE_STACK_ID]);
  // R31 — NOT_DOCKED is explained rather than shown. The refusal is still a
  // refusal, and silentDecline is still null, which is what this test is for.
  assert.equal(
    store.mining.get().actionError,
    "Unload refused: Your ship is in space. That can only be done while docked.",
  );
  assert.equal(store.mining.get().silentDecline, null);
});

// --- Reprocessing -----------------------------------------------------------

test("⚠ reprocessItems always sends confirm:true — it is never a variable", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch((path) => {
    if (path === "/api/bridge/reprocessing/reprocess") {
      return {
        status: 200,
        body: { ok: true, requested: [ORE_STACK_ID], processed: [ORE_STACK_ID], remaining: [] },
      };
    }
    return { status: 200, body: holdsBody() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.reprocessItems([ORE_STACK_ID]);
  const post = requests.find((entry) => entry.path === "/api/bridge/reprocessing/reprocess");
  assert.equal(post?.body.confirm, true, "never without an explicit confirmation");
  assert.deepEqual(post?.body.itemIDs, [ORE_STACK_ID]);
});

test("after reprocessing, the stale quote is dropped", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/reprocessing/quote") {
      return { status: 200, body: { ok: true, taxRate: 0.05, quotes: [] } };
    }
    if (path.startsWith("/api/bridge/reprocessing/quote")) {
      return {
        status: 200,
        body: {
          ok: true,
          taxRate: 0.05,
          quotes: [{ itemID: ORE_STACK_ID, typeID: 1230, outputs: [] }],
        },
      };
    }
    if (path === "/api/bridge/reprocessing/reprocess") {
      return {
        status: 200,
        body: { ok: true, requested: [ORE_STACK_ID], processed: [ORE_STACK_ID], remaining: [] },
      };
    }
    return { status: 200, body: holdsBody() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.loadReprocessingQuote([ORE_STACK_ID]);
  await flow.reprocessItems([ORE_STACK_ID]);
  const state = store.mining.get();
  assert.deepEqual(state.quotes, [], "the quote described stacks that no longer exist");
  assert.equal(state.taxRate, null);
});

test("a reprocess that consumed NOTHING is a silent decline", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path) => {
    if (path === "/api/bridge/reprocessing/reprocess") {
      return {
        status: 200,
        body: { ok: true, requested: [ORE_STACK_ID], processed: [], remaining: [ORE_STACK_ID] },
      };
    }
    return { status: 200, body: holdsBody() };
  });
  const flow = createAppFlow(store, { fetch });

  await flow.reprocessItems([ORE_STACK_ID]);
  assert.match(store.mining.get().silentDecline ?? "", /Nothing was reprocessed/i);
});

test("a refinery refusal carries the server's own reason", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(() => ({
    status: 409,
    body: {
      ok: false,
      error: "CALL_REFUSED",
      message: "You do not have enough ISK to pay the reprocessing tax.",
    },
  }));
  const flow = createAppFlow(store, { fetch });

  await flow.reprocessItems([ORE_STACK_ID]);
  assert.match(store.mining.get().actionError ?? "", /enough ISK/);
});
