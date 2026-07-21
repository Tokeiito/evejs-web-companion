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
import { displayName, resolvedName } from "../store/names.ts";

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

// --- R7d: the render path must never emit a raw numeric game ID -------------

test("resolvedName renders the name once resolved and never the raw ID (R7d)", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(namesResponder);
  const flow = createAppFlow(store, { fetch });

  // Before the name lands the cell shows the non-ID fallback — NOT the number.
  const before = resolvedName(store.names.get().resolved, "type", 34, "—");
  assert.equal(before, "—");
  assert.notEqual(before, "34");

  flow.requestNames([{ kind: "type", id: 34 }]);
  await waitFor(() => store.names.get().resolved["type:34"] !== undefined);

  // Once resolved the cell renders the NAME.
  assert.equal(resolvedName(store.names.get().resolved, "type", 34, "—"), "Tritanium");
});

test("resolvedName stays on the fallback for a definitive unknown, never the ID (R7d)", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch(namesResponder);
  const flow = createAppFlow(store, { fetch });

  // A nameless ID resolves to null (definitive unknown); the cell keeps the
  // non-ID fallback rather than falling back to the number.
  flow.requestNames([{ kind: "type", id: 999999999 }]);
  await waitFor(() => "type:999999999" in store.names.get().resolved);
  assert.equal(store.names.get().resolved["type:999999999"], null);

  const cell = resolvedName(store.names.get().resolved, "type", 999999999, "—");
  assert.equal(cell, "—");
  assert.notEqual(cell, "999999999");
});

test("resolvedName returns the fallback for a null/zero/invalid id, never a number (R7d)", () => {
  const resolved: Record<string, string | null> = {};
  assert.equal(resolvedName(resolved, "system", null, "—"), "—");
  assert.equal(resolvedName(resolved, "system", 0, "—"), "—");
  assert.equal(resolvedName(resolved, "system", undefined, "your current system"), "your current system");
  // A resolved name still comes through with a non-default fallback in play.
  assert.equal(resolvedName({ "system:30000142": "Jita" }, "system", 30000142, "—"), "Jita");
});

// --- R38 player-structure names --------------------------------------------
//
// A player-owned Upwell structure is runtime data, so /api/names can answer it
// only through a live read that may not be possible right now. That gives the
// route a THIRD outcome beyond "a name" and "a definitive unknown": a key it
// could not look up at all, reported in `unresolved`. The cache must treat that
// like a transient network failure — never stored — or one failed lookup would
// pin a real place to "an unnamed place" for the rest of the session.

const STRUCTURE_KEY = "station:1030000000001";
const STRUCTURE_NAME = "Perimeter - asdf";

test("a resolved player-structure name lands in the cache like any other name", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path, method, body) => {
    if (path === "/api/names" && method === "POST") {
      const items = Array.isArray(body.items) ? (body.items as { kind: string; id: number }[]) : [];
      const names: Record<string, string | null> = {};
      for (const item of items) {
        names[`${item.kind}:${item.id}`] = STRUCTURE_NAME;
      }
      return {
        status: 200,
        body: { ok: true, source: "static-data+runtime-structures", names, unresolved: [] },
      };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  flow.requestNames([{ kind: "station", id: 1030000000001 }]);
  await waitFor(() => STRUCTURE_KEY in store.names.get().resolved);
  assert.equal(store.names.get().resolved[STRUCTURE_KEY], STRUCTURE_NAME);
  // R7d — the rendered cell is the name, never the numeric ID.
  const cell = resolvedName(store.names.get().resolved, "station", 1030000000001, "an unnamed place");
  assert.equal(cell, STRUCTURE_NAME);
  assert.notEqual(cell, "1030000000001");
});

test("an UNRESOLVED structure key is not cached and a later request retries", async () => {
  // ⚠ The distinction the whole goal turns on. The server said null AND named
  // the key in `unresolved` — "we could not ask", not "there is no name".
  // Caching it would be the client inventing a finding.
  const store = createClientStore();
  let reachable = false;
  const { fetch, requests } = makeFakeFetch((path, method, body) => {
    if (path === "/api/names" && method === "POST") {
      const items = Array.isArray(body.items) ? (body.items as { kind: string; id: number }[]) : [];
      const names: Record<string, string | null> = {};
      const unresolved: string[] = [];
      for (const item of items) {
        const key = `${item.kind}:${item.id}`;
        if (reachable) {
          names[key] = STRUCTURE_NAME;
        } else {
          names[key] = null;
          unresolved.push(key);
        }
      }
      return { status: 200, body: { ok: true, source: "static-data", names, unresolved } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  flow.requestNames([{ kind: "station", id: 1030000000001 }]);
  await waitFor(() => namesRequestCount(requests) >= 1);
  await waitFor(() => true);
  // Nothing was written to the store: an unanswered question is not an answer.
  assert.equal(STRUCTURE_KEY in store.names.get().resolved, false);
  const before = namesRequestCount(requests);

  // The character comes online; the SAME ref is asked again rather than being
  // written off as nameless.
  reachable = true;
  flow.requestNames([{ kind: "station", id: 1030000000001 }]);
  await waitFor(() => STRUCTURE_KEY in store.names.get().resolved);
  assert.ok(namesRequestCount(requests) > before, "an unresolved key must be retried");
  assert.equal(store.names.get().resolved[STRUCTURE_KEY], STRUCTURE_NAME);
});

test("an unresolved structure still renders the honest fallback, never the ID (R7d)", async () => {
  const store = createClientStore();
  const { fetch } = makeFakeFetch((path, method, body) => {
    if (path === "/api/names" && method === "POST") {
      const items = Array.isArray(body.items) ? (body.items as { kind: string; id: number }[]) : [];
      const names: Record<string, string | null> = {};
      const unresolved: string[] = [];
      for (const item of items) {
        const key = `${item.kind}:${item.id}`;
        names[key] = null;
        unresolved.push(key);
      }
      return { status: 200, body: { ok: true, source: "static-data", names, unresolved } };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const flow = createAppFlow(store, { fetch });

  flow.requestNames([{ kind: "station", id: 1030000000001 }]);
  await waitFor(() => true);
  // Unknown stays honest: the plain-language fallback, never the number and
  // never a fabricated label.
  const cell = resolvedName(store.names.get().resolved, "station", 1030000000001, "an unnamed place");
  assert.equal(cell, "an unnamed place");
  assert.notEqual(cell, "1030000000001");
});
