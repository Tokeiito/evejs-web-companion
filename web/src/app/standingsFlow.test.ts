// loadStandings + loadStandingDetail (goal R55). The page asks the standings'
// calls itself, by the generic call (bridge/standingsReads.ts; the plan's Phase
// 6b): the character's own standings (standingMgr.GetCharStandings) and the
// corporation's (standingMgr.GetCorpStandings), raw retail Rowsets; and for an
// entity opened, its history or its composition. The flow decodes them and
// — the crux — RESOLVES every entity `fromID` to a name by its classified kind.
// Each test describes the answers and their failures; the stand-in for the BFF
// answers each call from that.
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
  readonly transactions?: JsonValue;
  readonly compositions?: JsonValue;
  /** Why each call fails, where it does. */
  readonly errors?: Record<string, string | null>;
  /** The pilot the session is of, once one is chosen. */
  readonly pilot?: { readonly characterID: number; readonly corporationID: number | null };
}

const PILOT = { characterID: 140000005, corporationID: 98000001 };

// A fetch that answers the standings' four calls by the generic call, and the choosing of a pilot; it captures
// the /api/names request bodies so the classification can be asserted, and what was asked of the standings' service.
function standingsFetch(
  body: StandingsBody,
  nameRequests: { kind: string; id: number }[] = [],
  asked: string[] = [],
): typeof fetch {
  const answers: Record<string, readonly [JsonValue, string | null | undefined]> = {
    GetCharStandings: [body.char ?? null, body.errors?.char],
    GetCorpStandings: [body.corp ?? null, body.errors?.corp],
    GetStandingTransactions: [body.transactions ?? null, body.errors?.transactions],
    GetStandingCompositions: [body.compositions ?? null, body.errors?.compositions],
  };
  return (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url === "/api/bridge/select") {
      const pilot = body.pilot ?? PILOT;
      return { ok: true, status: 200, async json() { return { ok: true, character: { characterID: pilot.characterID, characterName: "A Pilot", stationID: 60003760, structureID: null, solarSystemID: 30000142, corporationID: pilot.corporationID }, station: null, notifications: [] }; } };
    }
    if (url === "/api/bridge/call") {
      const call = JSON.parse(init?.body ?? "{}") as { service: string; method: string; args: JsonValue[] };
      if (call.service === "standingMgr") {
        asked.push(`${call.method}(${JSON.stringify(call.args).slice(1, -1)})`);
        const [result, failure] = answers[call.method] ?? [null, "CALL_NOT_ALLOWED"];
        return failure
          ? { ok: false, status: 502, async json() { return { ok: false, error: failure, message: `${call.method} failed.` }; } }
          : { ok: true, status: 200, async json() { return { ok: true, service: call.service, method: call.method, result, notifications: [] }; } };
      }
      return { ok: true, status: 200, async json() { return { ok: true, service: call.service, method: call.method, result: null, notifications: [] }; } };
    }
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
  const asked: string[] = [];
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ char: standingsRowset(CHAR_ROWS), corp: standingsRowset([[500001, 1.445]]) }, [], asked),
    eventSource: () => ({ onmessage: null, onopen: null, onerror: null, close() {} }),
  });
  await flow.selectCharacter(PILOT.characterID);

  await flow.loadStandings();
  // Asked as the client's standings service asks, with nothing: the two lists, and of no route of the standings' own.
  assert.deepEqual(asked.slice().sort(), ["GetCharStandings()", "GetCorpStandings()"]);

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

test("a pilot in an NPC corporation: its corporation's standings, never asked for, are none and not unread", async () => {
  // standingsvc.py 118: the client asks for the pilot's own alone and takes the corporation's to be {}.
  // So does the page: the corporation's are not asked for, and are none with no error.
  const store = createClientStore();
  const asked: string[] = [];
  const flow = createAppFlow(store, {
    // (Were the corporation's asked for, this stand-in would answer a list with something in it.)
    fetch: standingsFetch({ char: standingsRowset(CHAR_ROWS), corp: standingsRowset([[500001, 9.9]]), pilot: { characterID: 140000002, corporationID: 1000044 } }, [], asked),
    eventSource: () => ({ onmessage: null, onopen: null, onerror: null, close() {} }),
  });
  await flow.selectCharacter(140000002);

  await flow.loadStandings();
  assert.deepEqual(asked, ["GetCharStandings()"]);

  const standings = store.standings.get();
  assert.equal(standings.char?.length, 3);
  assert.deepEqual([standings.corp, standings.corpError], [[], null]);
});

test("loadStandingDetail(char) decodes the standing HISTORY (transactions)", async () => {
  const store = createClientStore();
  const asked: string[] = [];
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ transactions: REAL_TRANSACTIONS, compositions: REAL_COMPOSITIONS }, [], asked),
    eventSource: () => ({ onmessage: null, onopen: null, onerror: null, close() {} }),
  });
  // Before a pilot is chosen there is nobody whose history it would be: said, and nothing asked.
  await flow.loadStandingDetail(1000030, "char");
  assert.deepEqual([store.standings.get().detailError, asked], ["No pilot is chosen.", []]);
  await flow.selectCharacter(PILOT.characterID);

  await flow.loadStandingDetail(1000030, "char");
  // standingsPanel.py 86: the character's row asks for the history, of the entity with the character, and for
  // nothing else.
  assert.deepEqual(asked, ["GetStandingTransactions(1000030,140000005)"]);

  const standings = store.standings.get();
  assert.equal(standings.detailFromID, 1000030);
  assert.equal(standings.detailScope, "char");
  assert.equal(standings.transactions?.length, 1);
  assert.equal(standings.transactions?.[0]?.eventTypeID, 82);
  assert.equal(standings.transactions?.[0]?.modification, 0.023);
  // A char drill-down carries no composition.
  assert.equal(standings.compositions, null);
});

test("an entity's detail that cannot be read says why by its call's code; a corporation's row asks nothing where no corporation is known", async () => {
  const store = createClientStore();
  const asked: string[] = [];
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ errors: { transactions: "CALL_REFUSED" }, compositions: REAL_COMPOSITIONS, pilot: { characterID: 140000002, corporationID: null } }, [], asked),
    eventSource: () => ({ onmessage: null, onopen: null, onerror: null, close() {} }),
  });
  await flow.selectCharacter(140000002);

  await flow.loadStandingDetail(1000030, "char");
  // As the route said of a read that failed: the code, and not the words that came with it.
  assert.deepEqual([store.standings.get().detailError, asked], ["CALL_REFUSED", ["GetStandingTransactions(1000030,140000002)"]]);
  await flow.loadStandingDetail(1000030, "corp");
  assert.deepEqual([store.standings.get().detailError, asked.length], ["The pilot's corporation is not known.", 1]);
});

test("loadStandingDetail(corp) decodes the per-member COMPOSITION", async () => {
  const store = createClientStore();
  const asked: string[] = [];
  const flow = createAppFlow(store, {
    fetch: standingsFetch({ transactions: REAL_TRANSACTIONS, compositions: REAL_COMPOSITIONS }, [], asked),
    eventSource: () => ({ onmessage: null, onopen: null, onerror: null, close() {} }),
  });
  await flow.selectCharacter(PILOT.characterID);

  await flow.loadStandingDetail(1000030, "corp");
  // The corporation's row asks for the composition, of the entity with the corporation, and for nothing else.
  assert.deepEqual(asked, ["GetStandingCompositions(1000030,98000001)"]);

  const standings = store.standings.get();
  assert.equal(standings.detailScope, "corp");
  assert.deepEqual(standings.compositions, [{ ownerID: 140000005, standing: 1.304 }]);
  assert.equal(standings.transactions, null);
});
