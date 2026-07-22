// Standings decoders (goal R55) against REAL captured bytes.
//
// The fixtures below are the exact retail shapes captured live from Farmer
// (character 140000005, corp 98000001) through the BFF on 2026-07-21:
//   • standingMgr.GetCharStandings / GetCorpStandings — a header/lines Rowset
//     over ["fromID","standing"] (reused R6 decode)
//   • standingMgr.GetStandingTransactions — {type:"list", items:[util.KeyVal…]}
//   • standingMgr.GetStandingCompositions — a CachedMethodCallResult wrapping an
//     objectex2 CRowset whose packedrows carry [standing, ownerID]
//
// ⚠ R7d: a decoded row must never carry a raw entity id in a rendered field. The
// transaction rows drop fromID/toID/int_1..3 entirely; the sweep below proves
// that AND (its companion) that the sweep would catch an id if one leaked.

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyStandingKind,
  decodeCharStandings,
  decodeStandingCompositions,
  decodeStandingTransactions,
} from "./standings.ts";
import type { JsonValue } from "./wire.ts";

// The captured char-standings rows (11), verbatim.
const CHAR_ROWS: ReadonlyArray<readonly [number, number]> = [
  [500001, 2.14],
  [500010, -0.003],
  [1000002, 0.23],
  [1000005, -0.23],
  [1000006, 0.23],
  [1000030, 1.304],
  [1000031, -1.304],
  [1000033, 1.304],
  [1000044, 1.25],
  [3008416, 0.13],
  [3011918, 0.755],
];

function charStandingsResult(rows: ReadonlyArray<readonly [number, number]>): JsonValue {
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
            items: rows.map(([fromID, standing]) => ({
              type: "list",
              items: [fromID, standing],
            })),
          },
        ],
      ],
    },
  };
}

test("decodeCharStandings decodes the real GetCharStandings Rowset (fromID, standing)", () => {
  const rows = decodeCharStandings(charStandingsResult(CHAR_ROWS));
  assert.equal(rows.length, 11);
  // The faction, an NPC corp, and an agent all decode with their real values.
  assert.deepEqual(
    rows.find((row) => row.fromID === 500001),
    { fromID: 500001, standing: 2.14 },
  );
  assert.deepEqual(
    rows.find((row) => row.fromID === 1000030),
    { fromID: 1000030, standing: 1.304 },
  );
  assert.deepEqual(
    rows.find((row) => row.fromID === 3008416),
    { fromID: 3008416, standing: 0.13 },
  );
  // A negative standing survives (not zeroed).
  assert.equal(rows.find((row) => row.fromID === 1000031)?.standing, -1.304);
});

test("decodeCharStandings on an empty Rowset is [] (a real 'no standings')", () => {
  assert.deepEqual(decodeCharStandings(charStandingsResult([])), []);
});

// The classifier is the R7d crux: it maps a fromID to the /api/names kind by its
// EVE id range, exactly how the retail idCheckers groups standings owners.
test("classifyStandingKind maps each real fromID by its EVE id range", () => {
  // Factions (500000-599999).
  assert.equal(classifyStandingKind(500001), "faction");
  assert.equal(classifyStandingKind(500010), "faction");
  // NPC corporations (1000000-1999999).
  assert.equal(classifyStandingKind(1000030), "corporation");
  assert.equal(classifyStandingKind(1999999), "corporation");
  // Agents / NPC characters (3000000-3999999).
  assert.equal(classifyStandingKind(3008416), "agent");
  assert.equal(classifyStandingKind(3011918), "agent");
});

test("classifyStandingKind returns null outside every known range (degrades, never leaks)", () => {
  // A player character id, a player corp id, and junk are all "unknown kind".
  assert.equal(classifyStandingKind(140000005), null);
  assert.equal(classifyStandingKind(98000001), null);
  assert.equal(classifyStandingKind(0), null);
  assert.equal(classifyStandingKind(-1), null);
});

// The captured GetStandingTransactions list<KeyVal>, verbatim first row.
const REAL_TRANSACTION: JsonValue = {
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
};

test("decodeStandingTransactions decodes the real list<KeyVal> (date, eventTypeID, modification)", () => {
  const rows = decodeStandingTransactions({ type: "list", items: [REAL_TRANSACTION] });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row!.eventTypeID, 82);
  assert.equal(row!.modification, 0.023);
  // The FILETIME survives as a bigint (it exceeds 2^53).
  assert.equal(row!.date, 134288084070510000n);
});

test("decodeStandingTransactions on an empty list is [] (a real 'no history')", () => {
  assert.deepEqual(decodeStandingTransactions({ type: "list", items: [] }), []);
});

// R7d id-sweep: the decoded transaction must carry NO raw entity id — not the
// fromID (1000030), the toID (140000005), nor int_1 (1000033).
function transactionSweepText(rows: readonly { readonly id: string; readonly date: bigint | null; readonly eventTypeID: number; readonly modification: number }[]): string {
  return rows
    .map((row) => `${row.id}|${row.date === null ? "" : row.date.toString()}|${row.eventTypeID}|${row.modification}`)
    .join("\n");
}

test("R7d: a decoded transaction carries no fromID/toID/int_1", () => {
  const rows = decodeStandingTransactions({ type: "list", items: [REAL_TRANSACTION] });
  const text = transactionSweepText(rows);
  for (const id of ["1000030", "140000005", "1000033"]) {
    assert.equal(text.includes(id), false, `raw id ${id} leaked into a decoded transaction`);
  }
});

test("the transaction id-sweep matcher actually inspects the decoded content", () => {
  // Companion: a row that DID carry an id must be caught by the same sweep, so the
  // assertion above is not vacuously passing over content it never reads.
  const leaky = [{ id: "0:0", date: null, eventTypeID: 1000030, modification: 0 }];
  const text = transactionSweepText(leaky);
  assert.equal(text.includes("1000030"), true);
});

// The captured GetStandingCompositions — CachedMethodCallResult over an objectex2
// CRowset, verbatim. One packedrow: standing 1.304, ownerID 140000005 (Farmer).
const REAL_COMPOSITIONS: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    {
      type: "dict",
      entries: [
        [{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "5 minutes" }],
        [{ type: "rawstr", value: "sessionInfo" }, { type: "rawstr", value: "corpid" }],
      ],
    },
    {
      type: "substream",
      value: {
        type: "objectex2",
        header: [
          [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
          {
            type: "dict",
            entries: [
              [
                "header",
                {
                  type: "objectex1",
                  header: [
                    { type: "token", value: "blue.DBRowDescriptor" },
                    [[["standing", 5], ["ownerID", 3]]],
                  ],
                  list: [],
                  dict: [],
                },
              ],
            ],
          },
        ],
        list: [
          {
            type: "packedrow",
            columns: [["standing", 5], ["ownerID", 3]],
            values: [1.304, 140000005],
          },
        ],
        dict: [],
      },
    },
    { type: "list", items: [{ type: "long", value: "134291635989690000" }, -755355505] },
  ],
};

test("decodeStandingCompositions unwraps the cached CRowset to (ownerID, standing)", () => {
  const rows = decodeStandingCompositions(REAL_COMPOSITIONS);
  assert.deepEqual(rows, [{ ownerID: 140000005, standing: 1.304 }]);
});

test("decodeStandingCompositions on an empty CRowset is [] (a real 'no members')", () => {
  const empty: JsonValue = {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      { type: "dict", entries: [] },
      { type: "substream", value: { type: "objectex2", header: [], list: [], dict: [] } },
      { type: "list", items: [] },
    ],
  };
  assert.deepEqual(decodeStandingCompositions(empty), []);
});
