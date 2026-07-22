// loadStandings + loadStandingDetail (goal R55) against the raw
// /api/bridge/standings envelope. The BFF ships the character's own standings
// (standingMgr.GetCharStandings) and the corporation's
// (standingMgr.GetCorpStandings) as raw retail Rowsets; the flow decodes them and
// — the crux — RESOLVES every entity `fromID` to a name by its classified kind.
//
// ⚠ R7d is the invariant under test: the flow must ask /api/names for each
// fromID under the RIGHT kind (faction / corporation / agent by id range). An
// agent asked for under the generic `owner` kind resolves to null (verified
// live), so the classification is load-bearing, not cosmetic.
// ⚠ empty ≠ failed: a FAILED char read leaves `char` null (with charError); a
// SUCCESSFUL empty read makes it [].

import test from "node:test";
import assert from "node:assert/strict";

import { createClientStore } from "../store/clientStore.ts";
import { createAppFlow } from "./flow.ts";
import type { JsonValue } from "../bridge/wire.ts";

// The real GetCharStandings / GetCorpStandings shape (header/lines Rowset).
function standingsRowset(rows: ReadonlyArray<readonly [number, number]>): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: ["fromID", "standing"] }],
        ["RowClass", { type: "token", value: "util.Row" }],
        [
          "lines",
          {
            type: "list",
            items: rows.map(([fromID, standing]) => ({ type: "list", items: [fromID, standing] })),
          },
        ],
      ],
    },
  };
}

// The captured transactions list<KeyVal> (one derived-standing row).
const REAL_TRANSACTIONS: JsonValue = {
  type: "list",
  items: [
    {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["eventTypeID", 82],
          ["eventDateTime", { type: "long", value: "134288084070510000" }],
          ["modification", 0.023],
          ["fromID", 1000030],
          ["toID", 140000005],
          ["msg", "Derived standings"],
          ["int_1", 1000033],
          ["int_2", null],
          ["int_3", null],
        ],
      },
    },
  ],
};

// The captured compositions CachedMethodCallResult over an objectex2 CRowset.
const REAL_COMPOSITIONS: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [] },
    {
      type: "substream",
      value: {
        type: "objectex2",
        header: [],
        list: [{ type: "packedrow", columns: [["standing", 5], ["ownerID", 3]], values: [1.304, 140000005] }],
        dict: [],
      },
    },
    { type: "list", items: [] },
  ],
};

const CHAR_ROWS: ReadonlyArray<readonly [number, number]> = [
  [500001, 2.14],
  [1000030, 1.304],
  [3008416, 0.13],
];

interface StandingsBody {
  readonly char?: JsonValue;
  readonly corp?: JsonValue;
  readonly fromID?: number | null;
  readonly transactions?: JsonValue;
  readonly compositions?: JsonValue;
  readonly errors?: Record<string, string | null>;
}

// A fetch that answers /api/bridge/standings (base + drill-down) and captures the
// /api/names request bodies so the classification can be asserted.
function standingsFetch(
  body: StandingsBody,
  nameRequests: { kind: string; id: number }[] = [],
): typeof fetch {
  return (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url === "/api/names") {
      const parsed = init && init.body ? JSON.parse(init.body) : { items: [] };
      for (const item of parsed.items ?? []) {
        nameRequests.push({ kind: String(item.kind), id: Number(item.id) });
      }
      // Echo a name for every requested key so nothing is left "pending".
      const names: Record<string, string> = {};
      for (const item of parsed.items ?? []) {
        names[`${item.kind}:${item.id}`] = `Name ${item.id}`;
      }
      return { ok: true, status: 200, async json() { return { ok: true, names, unresolved: [] }; } };
    }
    if (url.startsWith("/api/bridge/standings")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            char: body.char ?? null,
            corp: body.corp ?? null,
            fromID: body.fromID ?? null,
            transactions: body.transactions ?? null,
            compositions: body.compositions ?? null,
            errors: {
              char: null,
              corp: null,
              transactions: null,
              compositions: null,
              ...(body.errors ?? {}),
            },
          };
        },
      };
    }
    return { ok: true, status: 200, async json() { return { ok: true }; } };
  }) as unknown as typeof fetch;
}

/** Let the queued name-resolution microtask + its fetch settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("loadStandings decodes char + corp standings", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ char: standingsRowset(CHAR_ROWS), corp: standingsRowset([[500001, 1.445]]) }),
  });

  await flow.loadStandings();

  const standings = store.standings.get();
  assert.equal(standings.loaded, true);
  assert.equal(standings.char?.length, 3);
  assert.deepEqual(standings.char?.find((row) => row.fromID === 1000030), { fromID: 1000030, standing: 1.304 });
  // Corp's faction standing differs from the character's — both survive.
  assert.deepEqual(standings.corp, [{ fromID: 500001, standing: 1.445 }]);
});

test("R7d: loadStandings asks /api/names for each fromID under its CLASSIFIED kind", async () => {
  const store = createClientStore();
  const nameRequests: { kind: string; id: number }[] = [];
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ char: standingsRowset(CHAR_ROWS), corp: standingsRowset([]) }, nameRequests),
  });

  await flow.loadStandings();
  await settle();

  // Each id is requested under the kind its EVE id range implies — the agent as
  // `agent`, NOT the generic `owner` kind (which does not resolve agents).
  assert.deepEqual(
    nameRequests.find((ref) => ref.id === 500001),
    { kind: "faction", id: 500001 },
  );
  assert.deepEqual(
    nameRequests.find((ref) => ref.id === 1000030),
    { kind: "corporation", id: 1000030 },
  );
  assert.deepEqual(
    nameRequests.find((ref) => ref.id === 3008416),
    { kind: "agent", id: 3008416 },
  );
  // No id was ever asked for under `owner` (the classification is specific).
  assert.equal(nameRequests.some((ref) => ref.kind === "owner"), false);
});

test("loadStandings: a FAILED char read leaves char null and sets charError; corp survives", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: standingsFetch({
      char: null,
      corp: standingsRowset([[500001, 1.445]]),
      errors: { char: "READ_FAILED" },
    }),
  });

  await flow.loadStandings();

  const standings = store.standings.get();
  // ⚠ null, NOT [] — a failed read must never look like "no standings".
  assert.equal(standings.char, null);
  assert.match(standings.charError ?? "", /READ_FAILED/);
  // The corporation's standings survived the character-side failure.
  assert.deepEqual(standings.corp, [{ fromID: 500001, standing: 1.445 }]);
});

test("loadStandings: a SUCCESSFUL empty read is [] (a real 'no standings')", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ char: standingsRowset([]), corp: standingsRowset([]) }),
  });

  await flow.loadStandings();

  const standings = store.standings.get();
  // ⚠ [] not null — genuinely no standings, distinct from a failed read.
  assert.deepEqual(standings.char, []);
  assert.deepEqual(standings.corp, []);
  assert.equal(standings.charError, null);
});

test("loadStandingDetail(char) decodes the standing HISTORY (transactions)", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ fromID: 1000030, transactions: REAL_TRANSACTIONS }),
  });

  await flow.loadStandingDetail(1000030, "char");

  const standings = store.standings.get();
  assert.equal(standings.detailFromID, 1000030);
  assert.equal(standings.detailScope, "char");
  assert.equal(standings.transactions?.length, 1);
  assert.equal(standings.transactions?.[0]?.eventTypeID, 82);
  assert.equal(standings.transactions?.[0]?.modification, 0.023);
  // A char drill-down carries no composition.
  assert.equal(standings.compositions, null);
});

test("loadStandingDetail(corp) decodes the per-member COMPOSITION", async () => {
  const store = createClientStore();
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ fromID: 1000030, compositions: REAL_COMPOSITIONS }),
  });

  await flow.loadStandingDetail(1000030, "corp");

  const standings = store.standings.get();
  assert.equal(standings.detailScope, "corp");
  assert.deepEqual(standings.compositions, [{ ownerID: 140000005, standing: 1.304 }]);
  assert.equal(standings.transactions, null);
});
