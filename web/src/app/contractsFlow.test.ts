// The R17 Contracts controller against a faked BFF: loadContracts decodes five
// independent reads into the store and asks for the NAME of everything it will
// render; openContract loads one in full.
//
// The properties that matter here are the ones that keep the panel honest:
//  - an EMPTY public browse must reach the store as an expected FACT
//    (`worldHasNoContracts`), and a FAILED browse must never set it — EveJS has
//    no contract generator, so an empty board is normal, but "nothing was
//    found" and "nothing could be looked up" are different things to say;
//  - an independent read failing must not blank the rest;
//  - EVERY id the panel will show is asked for by name, or a contract renders
//    as "someone" running to "an unnamed station";
//  - a lost session unwinds to character select.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";

const CHARACTER_ID = 7;
const ISSUER_ID = 140000009;
const ISSUER_CORP_ID = 98000000;
const ASSIGNEE_ID = 140000011;
const START_STATION = 60003760;
const END_STATION = 60008494;
const START_SYSTEM = 30000142;
const END_SYSTEM = 30002187;
const CONTRACT_ID = 8100;

function long(value: string): unknown {
  return { type: "long", value };
}

function list(items: readonly unknown[]): unknown {
  return { type: "list", items };
}

function keyVal(fields: Record<string, unknown>): unknown {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

function rowset(columns: readonly string[], lines: readonly unknown[]): unknown {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: { type: "dict", entries: [["columns", list(columns)], ["lines", list(lines)]] },
  };
}

function contractRow(overrides: Record<string, unknown> = {}): unknown {
  return keyVal({
    contractID: CONTRACT_ID,
    type: 3,
    status: 0,
    availability: 0,
    issuerID: ISSUER_ID,
    issuerCorpID: ISSUER_CORP_ID,
    forCorp: false,
    assigneeID: 0,
    acceptorID: 0,
    dateIssued: long("133000000000000000"),
    dateExpired: long("134000000000000000"),
    dateAccepted: long("0"),
    dateCompleted: long("0"),
    numDays: 7,
    startStationID: START_STATION,
    endStationID: END_STATION,
    startSolarSystemID: START_SYSTEM,
    endSolarSystemID: END_SYSTEM,
    price: 0,
    reward: 2500000,
    collateral: 10000000,
    volume: 1200,
    title: "Ore run",
    description: "",
    ...overrides,
  });
}

function searchResult(entries: readonly unknown[], numFound?: number): unknown {
  return keyVal({
    contracts: list(entries),
    numFound: numFound ?? entries.length,
    searchTime: 0,
    maxResults: 1000,
  });
}

function listBundle(rows: readonly unknown[]): unknown {
  return keyVal({ contracts: list(rows), items: { type: "dict", entries: [] } });
}

function loginInfo(): unknown {
  return keyVal({
    needsAttention: rowset(["contractID", "state"], []),
    inProgress: rowset(["contractID", "startStationID", "endStationID", "expires"], []),
    assignedToMe: rowset(["contractID", "issuerID"], []),
  });
}

function contractsPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    characterID: CHARACTER_ID,
    page: 0,
    pageSize: 100,
    browse: { result: searchResult([]), error: null },
    outstanding: { result: listBundle([]), error: null },
    accepted: { result: listBundle([]), error: null },
    expired: { result: listBundle([]), error: null },
    summary: { result: loginInfo(), error: null },
    worldHasNoContracts: true,
    ...overrides,
  };
}

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

function makeFakeFetch(
  responder: (path: string, method: string, body: Record<string, unknown>) => {
    status: number;
    body: unknown;
  },
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

function respondOk(
  extra: (path: string, method: string, body: Record<string, unknown>) => unknown = () => null,
) {
  return (path: string, method: string, body: Record<string, unknown>) => {
    const custom = extra(path, method, body);
    if (custom !== null && custom !== undefined) {
      return custom as { status: number; body: unknown };
    }
    if (path.startsWith("/api/bridge/contracts/detail")) {
      return {
        status: 200,
        body: {
          ok: true,
          contractID: CONTRACT_ID,
          detail: keyVal({
            items: list([keyVal({ typeID: 34, quantity: 500, inCrate: true })]),
            bids: list([]),
            contract: contractRow(),
            startSolarSystemID: START_SYSTEM,
            endSolarSystemID: END_SYSTEM,
          }),
        },
      };
    }
    if (path.startsWith("/api/bridge/contracts")) {
      return { status: 200, body: contractsPayload() };
    }
    if (path === "/api/names") {
      return { status: 200, body: { ok: true, names: {} } };
    }
    return { status: 200, body: { ok: true } };
  };
}

async function settleNames(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeFlow(responder: ReturnType<typeof respondOk>) {
  const store = createClientStore();
  const { fetch: fakeFetch, requests } = makeFakeFetch(responder);
  const flow = createAppFlow(store, { fetch: fakeFetch });
  return { store, flow, requests };
}

// --- the empty world --------------------------------------------------------

test("⚠ an empty browse reaches the store as an EXPECTED FACT, not an error", async () => {
  const { store, flow } = makeFlow(respondOk());
  await flow.loadContracts(0);

  const contracts = store.get().contracts;
  assert.equal(contracts.loaded, true);
  assert.deepEqual(contracts.browse, []);
  assert.equal(contracts.browseError, null, "the browse SUCCEEDED and found nothing");
  // EveJS has no NPC/seed contract generator, so this is normal. The panel says
  // "no public delivery jobs in this world yet" on the strength of this flag.
  assert.equal(contracts.worldHasNoContracts, true);
});

test("⚠ a FAILED browse must NOT claim the world is empty", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts") && !path.includes("/detail")
        ? {
            status: 200,
            body: contractsPayload({
              browse: { result: null, error: "CALL_FAILED" },
              worldHasNoContracts: false,
            }),
          }
        : null,
    ),
  );
  await flow.loadContracts(0);

  const contracts = store.get().contracts;
  assert.equal(contracts.browseError, "CALL_FAILED");
  // "Nothing was found" and "nothing could be looked up" are different facts,
  // and the panel words them differently.
  assert.equal(contracts.worldHasNoContracts, false);
});

// --- loading ----------------------------------------------------------------

test("a populated browse decodes the WRAPPED search entries", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts") && !path.includes("/detail")
        ? {
            status: 200,
            body: contractsPayload({
              browse: {
                result: searchResult([keyVal({ contract: contractRow(), items: list([]) })], 1),
                error: null,
              },
              worldHasNoContracts: false,
            }),
          }
        : null,
    ),
  );
  await flow.loadContracts(0);

  const contracts = store.get().contracts;
  assert.equal(contracts.browse.length, 1, "the nested contract must be unwrapped");
  assert.equal(contracts.browse[0]?.reward, "2500000", "ISK stays a decimal string");
  assert.equal(contracts.numFound, 1);
});

test("the player's own three lists land in their own places", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts") && !path.includes("/detail")
        ? {
            status: 200,
            body: contractsPayload({
              outstanding: { result: listBundle([contractRow({ contractID: 1 })]), error: null },
              accepted: { result: listBundle([contractRow({ contractID: 2 })]), error: null },
              expired: { result: listBundle([contractRow({ contractID: 3 })]), error: null },
            }),
          }
        : null,
    ),
  );
  await flow.loadContracts(0);

  const contracts = store.get().contracts;
  assert.deepEqual(contracts.outstanding.map((row) => row.contractID), [1]);
  assert.deepEqual(contracts.accepted.map((row) => row.contractID), [2]);
  assert.deepEqual(contracts.expired.map((row) => row.contractID), [3]);
});

test("⚠ a failed own-contract read never blanks the browse", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts") && !path.includes("/detail")
        ? {
            status: 200,
            body: contractsPayload({
              browse: {
                result: searchResult([keyVal({ contract: contractRow() })], 1),
                error: null,
              },
              outstanding: { result: null, error: "CALL_FAILED" },
              worldHasNoContracts: false,
            }),
          }
        : null,
    ),
  );
  await flow.loadContracts(0);

  const contracts = store.get().contracts;
  assert.equal(contracts.mineError, "CALL_FAILED");
  assert.equal(contracts.browse.length, 1, "the reads are independent");
});

test("a failed summary leaves the counts null rather than showing zeros", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts") && !path.includes("/detail")
        ? {
            status: 200,
            body: contractsPayload({ summary: { result: null, error: "CALL_FAILED" } }),
          }
        : null,
    ),
  );
  await flow.loadContracts(0);
  // Zeros would be a claim ("nothing needs your attention") that no read
  // supports.
  assert.equal(store.get().contracts.summary, null);
});

test("the page is carried through to the request", async () => {
  const { flow, requests } = makeFlow(respondOk());
  await flow.loadContracts(3);
  assert.ok(requests.some((entry) => entry.path === "/api/bridge/contracts?page=3"));
});

// --- names ------------------------------------------------------------------

test("⚠ every id the panel will render is asked for BY NAME", async () => {
  const { flow, requests } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts") && !path.includes("/detail")
        ? {
            status: 200,
            body: contractsPayload({
              browse: {
                result: searchResult([
                  keyVal({ contract: contractRow({ assigneeID: ASSIGNEE_ID }) }),
                ], 1),
                error: null,
              },
              worldHasNoContracts: false,
            }),
          }
        : null,
    ),
  );
  await flow.loadContracts(0);
  await settleNames();

  const nameRequest = requests.find((entry) => entry.path === "/api/names");
  assert.ok(nameRequest, "names resolve in ONE batched round-trip");
  const asked = (nameRequest.body.items as { kind: string; id: number }[]) ?? [];
  const keys = new Set(asked.map((ref) => `${ref.kind}:${ref.id}`));
  // Without these the board reads "someone" running to "an unnamed station".
  assert.ok(keys.has(`character:${ISSUER_ID}`), "who issued it");
  assert.ok(keys.has(`station:${START_STATION}`), "where it collects from");
  assert.ok(keys.has(`station:${END_STATION}`), "where it delivers to");
  assert.ok(keys.has(`system:${START_SYSTEM}`), "and the systems those sit in");
  assert.ok(keys.has(`system:${END_SYSTEM}`));
  assert.ok(keys.has(`corporation:${ISSUER_CORP_ID}`));
  // An assignee may be a character OR a corporation, so it resolves through
  // the "owner" kind that tries each in turn.
  assert.ok(keys.has(`owner:${ASSIGNEE_ID}`), "who it is reserved for");
});

test("a contract open to anyone asks for no assignee name", async () => {
  const { flow, requests } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts") && !path.includes("/detail")
        ? {
            status: 200,
            body: contractsPayload({
              browse: { result: searchResult([keyVal({ contract: contractRow() })], 1), error: null },
              worldHasNoContracts: false,
            }),
          }
        : null,
    ),
  );
  await flow.loadContracts(0);
  await settleNames();

  const nameRequest = requests.find((entry) => entry.path === "/api/names");
  const asked = (nameRequest?.body.items as { kind: string; id: number }[]) ?? [];
  assert.equal(
    asked.some((ref) => ref.kind === "owner"),
    false,
    "assigneeID 0 means open to anyone — there is no owner to name",
  );
});

// --- the detail --------------------------------------------------------------

test("openContract decodes the bundle and asks for its ITEM names", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadContracts(0);
  await flow.openContract(CONTRACT_ID);
  await settleNames();

  const detail = store.get().contracts.detail;
  assert.ok(detail);
  assert.equal(detail.contract.contractID, CONTRACT_ID);
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0]?.inCrate, true);

  const nameRequests = requests.filter((entry) => entry.path === "/api/names");
  const asked = nameRequests.flatMap(
    (entry) => (entry.body.items as { kind: string; id: number }[]) ?? [],
  );
  assert.ok(
    asked.some((ref) => ref.kind === "type" && ref.id === 34),
    "the items in a contract render as names, not type numbers",
  );
});

test("a detail request names the contract in its query", async () => {
  const { flow, requests } = makeFlow(respondOk());
  await flow.loadContracts(0);
  await flow.openContract(CONTRACT_ID);
  assert.ok(
    requests.some((entry) =>
      entry.path === `/api/bridge/contracts/detail?contractID=${CONTRACT_ID}`),
  );
});

test("a contract that is gone records a reason and does not throw", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts/detail")
        ? { status: 404, body: { ok: false, error: "CONTRACT_NOT_FOUND" } }
        : null,
    ),
  );
  await flow.loadContracts(0);
  await flow.openContract(CONTRACT_ID);
  assert.match(store.get().contracts.detailError ?? "", /no longer available/);
  assert.equal(store.get().contracts.detail, null);
});

test("closeContract drops the detail without touching the server", async () => {
  const { store, flow, requests } = makeFlow(respondOk());
  await flow.loadContracts(0);
  await flow.openContract(CONTRACT_ID);
  const before = requests.length;
  flow.closeContract();
  assert.equal(store.get().contracts.detail, null);
  assert.equal(requests.length, before, "closing is local");
});

// --- session loss ------------------------------------------------------------

test("a lost session unwinds to character select", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts")
        ? { status: 404, body: { ok: false, error: "SESSION_NOT_FOUND" } }
        : null,
    ),
  );
  await assert.rejects(() => flow.loadContracts(0));
  assert.equal(store.get().station.online, null);
});

test("going offline CLEARS the contracts — they must not outlive the character", async () => {
  const { store, flow } = makeFlow(
    respondOk((path) =>
      path.startsWith("/api/bridge/contracts") && !path.includes("/detail")
        ? {
            status: 200,
            body: contractsPayload({
              outstanding: { result: listBundle([contractRow()]), error: null },
            }),
          }
        : null,
    ),
  );
  await flow.loadContracts(0);
  assert.equal(store.get().contracts.outstanding.length, 1);

  store.apply({ type: "character/offline" });
  assert.deepEqual(store.get().contracts.outstanding, []);
  assert.equal(store.get().contracts.loaded, false);
  assert.equal(
    store.get().contracts.worldHasNoContracts,
    false,
    "and the empty-world claim resets — it is only ever earned by a real browse",
  );
});
