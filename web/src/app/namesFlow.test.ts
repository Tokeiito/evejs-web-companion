// Goal R7c: the client name cache (names everywhere). flow.requestNames batches
// unresolved { kind, id } refs into ONE /api/names round-trip per microtask,
// caches each outcome (a name, or null for a definitive "unknown"), pushes them
// into the store's `names` slice for pure-reader components, never refetches a
// cached key, and does not cache a transient failure (so it can retry). The
// display helper (displayName) turns a previously-ID cell into a name once it
// lands. Fire-and-forget: requestNames never throws.

import test from "node:test";
import assert from "node:assert/strict";

import { createAppFlow } from "./flow.ts";
import { createClientStore } from "../store/clientStore.ts";
import { displayName } from "../store/names.ts";

interface Recorded {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

const FIXTURE: Record<string, string> = {
  "type:34": "Tritanium",
  "type:587": "Rifter",
  "station:60003760": "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
  "system:30000142": "Jita",
  "category:6": "Ship",
  "corporation:1000044": "School of Applied Knowledge",
};

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

// Resolve each requested item from the fixture (null = definitive unknown),
// exactly as the real /api/names route echoes every requested key.
function namesResponder(path: string, method: string, body: Record<string, unknown>) {
  if (path === "/api/names" && method === "POST") {
    const items = Array.isArray(body.items) ? (body.items as { kind: string; id: number }[]) : [];
    const names: Record<string, string | null> = {};
    for (const item of items) {
      const key = `${item.kind}:${item.id}`;
      names[key] = FIXTURE[key] ?? null;
    }
    return { status: 200, body: { ok: true, source: "static-data", names } };
  }
  throw new Error(`unexpected ${method} ${path}`);
}

async function waitFor(cond: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries && !cond(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function namesRequestCount(requests: Recorded[]): number {
  return requests.filter((r) => r.path === "/api/names").length;
}

test("requestNames batches all refs from one tick into a single round-trip", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(namesResponder);
  const flow = createAppFlow(store, { fetch });

  // Two calls in the same synchronous tick → coalesced into one POST.
  flow.requestNames([{ kind: "type", id: 34 }]);
  flow.requestNames([{ kind: "type", id: 587 }, { kind: "station", id: 60003760 }]);

  await waitFor(() => Object.keys(store.names.get().resolved).length >= 3);

  assert.equal(namesRequestCount(requests), 1);
  const posted = requests.find((r) => r.path === "/api/names")?.body as { items: unknown[] };
  assert.equal(posted.items.length, 3);
  const resolved = store.names.get().resolved;
  assert.equal(resolved["type:34"], "Tritanium");
  assert.equal(resolved["type:587"], "Rifter");
  assert.equal(resolved["station:60003760"], "Jita IV - Moon 4 - Caldari Navy Assembly Plant");
});

test("a cached name is never refetched", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(namesResponder);
  const flow = createAppFlow(store, { fetch });

  flow.requestNames([{ kind: "type", id: 34 }]);
  await waitFor(() => store.names.get().resolved["type:34"] !== undefined);
  const before = namesRequestCount(requests);

  // Requesting the same (already-cached) ref issues no new request.
  flow.requestNames([{ kind: "type", id: 34 }]);
  await waitFor(() => true);
  assert.equal(namesRequestCount(requests), before);
});

test("a definitive unknown is cached (null) and not refetched", async () => {
  const store = createClientStore();
  const { fetch, requests } = makeFakeFetch(namesResponder);
  const flow = createAppFlow(store, { fetch });

  flow.requestNames([{ kind: "type", id: 999999999 }]);
  await waitFor(() => "type:999999999" in store.names.get().resolved);
  assert.equal(store.names.get().resolved["type:999999999"], null);
  const before = namesRequestCount(requests);

  flow.requestNames([{ kind: "type", id: 999999999 }]);
  await waitFor(() => true);
  assert.equal(namesRequestCount(requests), before, "a definitive unknown must not refetch");
});

test("a transient failure is not cached and a later request retries", async () => {
  const store = createClientStore();
  let fail = true;
  const { fetch, requests } = makeFakeFetch((path, method, body) => {
    if (path === "/api/names" && fail) {
      return { status: 500, body: { ok: false, error: "BOOM" } };
    }
    return namesResponder(path, method, body);
  });
  const flow = createAppFlow(store, { fetch });

  flow.requestNames([{ kind: "type", id: 34 }]);
  await waitFor(() => namesRequestCount(requests) >= 1);
  // The failed resolve was not cached (a later request can retry it).
  assert.equal("type:34" in store.names.get().resolved, false);

  fail = false;
  flow.requestNames([{ kind: "type", id: 34 }]);
  await waitFor(() => store.names.get().resolved["type:34"] !== undefined);
  assert.equal(store.names.get().resolved["type:34"], "Tritanium");
  assert.ok(namesRequestCount(requests) >= 2, "the transient failure was retried");
});

test("requestNames never throws when the fetch itself rejects", async () => {
  const store = createClientStore();
  const rejectingFetch = (async () => {
    throw new Error("network down");
  }) as unknown as typeof globalThis.fetch;
  const flow = createAppFlow(store, { fetch: rejectingFetch });

  // Fire-and-forget: the synchronous call must not throw, and nothing is cached.
  assert.doesNotThrow(() => flow.requestNames([{ kind: "type", id: 34 }]));
  await waitFor(() => true);
  assert.equal("type:34" in store.names.get().resolved, false);
});

test("a previously-ID inventory Type/Cat cell now renders the resolved name", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(namesResponder);
  const flow = createAppFlow(store, { fetch });

  // The row the InventoryShip table renders: before resolution its Type cell
  // shows the raw typeID and its Cat cell the raw categoryID (the ID fallback).
  const row = { typeID: 34, categoryID: 6 };
  assert.equal(displayName(store.names.get().resolved, "type", row.typeID), "34");
  assert.equal(displayName(store.names.get().resolved, "category", row.categoryID), "6");

  flow.requestNames([
    { kind: "type", id: row.typeID },
    { kind: "category", id: row.categoryID },
  ]);
  await waitFor(() => store.names.get().resolved["type:34"] !== undefined);

  // After resolution the same cells render NAMES instead of IDs.
  assert.equal(displayName(store.names.get().resolved, "type", row.typeID), "Tritanium");
  assert.equal(displayName(store.names.get().resolved, "category", row.categoryID), "Ship");
});
