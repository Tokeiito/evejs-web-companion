// Wallet-read decoders (goal R50) against fixtures built the way the eve.js
// account service actually builds the result: account.GetWalletDivisionsInfo is
// `buildList` of `buildKeyVal([["key", …], ["balance", …]])` (server helper at
// server/src/services/account/accountService.js:77-90). Balances are kept as
// bigint-safe decimal strings; the key (1000..1006) maps to a 1..7 ordinal.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCashBalance,
  decodeCorpDivisions,
  decodeEntryTypeLabels,
  decodeJournal,
  decodeTransactions,
  normalizeDivisionNames,
  decodeAccountWriteAck,
  decodeGiveCashAck,
} from "./wallet.ts";
import type { JsonValue } from "./wire.ts";

// Exactly the shape the server helpers emit: buildKeyVal -> util.KeyVal wrapping
// a {type:"dict", entries}; buildList -> {type:"list", items}.
function keyVal(entries: ReadonlyArray<readonly [string, JsonValue]>): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

function divisionsList(rows: ReadonlyArray<readonly [number, JsonValue]>): JsonValue {
  return {
    type: "list",
    items: rows.map(([key, balance]) => keyVal([["key", key], ["balance", balance]])),
  };
}

test("decodeCashBalance keeps a >2^53 personal balance exact (long-aware)", () => {
  assert.equal(decodeCashBalance(1000165000), "1000165000");
  assert.equal(
    decodeCashBalance({ type: "long", value: "9007199254740993" } as JsonValue),
    "9007199254740993",
  );
  assert.equal(decodeCashBalance(null), null);
});

test("decodeCorpDivisions maps key->ordinal, pairs names, keeps ISK exact", () => {
  const raw = divisionsList([
    [1000, 250000000],
    [1001, { type: "long", value: "9007199254740993" }],
    [1006, 0],
  ]);
  const rows = decodeCorpDivisions(raw, { 1: "Master Wallet", 2: "R&D", 7: "" });
  assert.deepEqual(rows, [
    { key: 1000, division: 1, name: "Master Wallet", balance: "250000000" },
    // A >2^53 balance survives BECAUSE it never went through Number.
    { key: 1001, division: 2, name: "R&D", balance: "9007199254740993" },
    // A blank name falls back to null (panel shows "Division 7"); 0 ISK is real.
    { key: 1006, division: 7, name: null, balance: "0" },
  ]);
});

// COMPANION MATCHER PROOF. If the KeyVal reader silently missed the fields, the
// balance would read "0" and the key would read 0 — this pins that it actually
// extracts the real values (the failure mode of a decoder that matches nothing).
test("decodeCorpDivisions actually reads the KeyVal fields, not defaults", () => {
  const rows = decodeCorpDivisions(divisionsList([[1003, 42]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.key, 1003);
  assert.equal(rows[0]!.division, 4);
  assert.equal(rows[0]!.balance, "42");
  assert.notEqual(rows[0]!.balance, "0");
});

test("decodeCorpDivisions: a well-formed empty list -> [] (a real 'no divisions')", () => {
  assert.deepEqual(decodeCorpDivisions({ type: "list", items: [] }), []);
});

test("decodeCorpDivisions tolerates malformed input and drops out-of-range keys", () => {
  assert.deepEqual(decodeCorpDivisions(null as unknown as JsonValue), []);
  assert.deepEqual(decodeCorpDivisions(42 as unknown as JsonValue), []);
  // A key below the corp-wallet range is not a division and is dropped.
  assert.deepEqual(decodeCorpDivisions(divisionsList([[7, 5]])), []);
});

test("normalizeDivisionNames keys by 1..7 ordinal and tolerates string keys", () => {
  assert.deepEqual(normalizeDivisionNames({ "1": "Master Wallet", "3": "Ops" } as JsonValue), {
    1: "Master Wallet",
    3: "Ops",
  });
  assert.deepEqual(normalizeDivisionNames(null as unknown as JsonValue), {});
});

// --- R54 Wallet ledger (journal + transactions) -----------------------------
//
// Fixtures reproduce EXACTLY what the eve.js account service emitted for
// rrfarmer -> Farmer, captured live through the BFF on 2026-07-21 (documented in
// the AFK log): GetJournal is a util.Rowset (header + POSITIONAL lines,
// `buildJournalRowset`), GetTransactions a list<util.KeyVal>
// (`buildTransactionList`), GetEntryTypes a CachedMethodCallResult wrapping a
// list<KeyVal{entryTypeID, entryTypeName, …}>. The row VALUES below are the real
// bytes off the wire, not a guessed shape.

const JOURNAL_HEADER: readonly string[] = [
  "transactionID",
  "transactionDate",
  "referenceID",
  "entryTypeID",
  "ownerID1",
  "ownerID2",
  "accountKey",
  "amount",
  "balance",
  "description",
  "currency",
  "sortValue",
];

/** A util.Rowset exactly like `buildJournalRowset`: header list + positional line lists. */
function journalRowset(lines: ReadonlyArray<readonly JsonValue[]>): JsonValue {
  return {
    type: "object",
    name: "util.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: JOURNAL_HEADER as JsonValue[] }],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: lines.map((items) => ({ type: "list", items })) }],
      ],
    },
  };
}

/** A list<util.KeyVal> exactly like `buildTransactionList`. */
function txnList(rows: ReadonlyArray<Readonly<Record<string, JsonValue>>>): JsonValue {
  return {
    type: "list",
    items: rows.map((fields) =>
      keyVal(Object.entries(fields) as ReadonlyArray<readonly [string, JsonValue]>),
    ),
  };
}

/** The GetEntryTypes CachedMethodCallResult envelope, exactly as captured. */
function entryTypesEnvelope(
  pairs: ReadonlyArray<readonly [number, string]>,
): JsonValue {
  return {
    type: "object",
    name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
    args: [
      { type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "run" }]] },
      {
        type: "substream",
        value: {
          type: "list",
          items: pairs.map(([id, name]) =>
            keyVal([
              ["entryTypeID", id],
              ["entryTypeNameID", 0],
              ["entryTypeName", name],
              ["entryJournalMessageID", 0],
            ]),
          ),
        },
      },
    ],
  };
}

// The three real journal rows (BountyPrize / MarketTransaction /
// PlanetaryConstruction), value-for-value off the wire.
const REAL_JOURNAL_LINES: ReadonlyArray<readonly JsonValue[]> = [
  [1784675859816261, { type: "long", value: "134291494598160000" }, 21980, 17, 140000005, 140000005, 1000, 10000, 115789452720.04, "NBL:\n  21980: 1\nsolarSystemID: 30000144\nkills: 1", 1, 1],
  [1784621463235892, { type: "long", value: "134290950632350000" }, 60015261, 2, 140000005, 1000091, 1000, -1459390, 115789394220.04, "Market purchase of Fusion M (191)", 1, 1],
  [1784233305981917, { type: "long", value: "134287069059810000" }, 30000144, 98, 140000005, 140000005, 1000, -45000, 115700000000.04, "Planetary construction", 1, 1],
];

const REAL_LABELS = entryTypesEnvelope([
  [2, "MarketTransaction"],
  [3, "GMCashTransfer"],
  [17, "BountyPrize"],
  [98, "PlanetaryConstruction"],
]);

test("decodeEntryTypeLabels unwraps the cached envelope and humanizes the ref-type code (R9a)", () => {
  const labels = decodeEntryTypeLabels(REAL_LABELS);
  assert.equal(labels.get(2), "Market Transaction");
  // The ACRONYM->Word boundary: GMCashTransfer, not "GMCash Transfer" or the code.
  assert.equal(labels.get(3), "GM Cash Transfer");
  assert.equal(labels.get(17), "Bounty Prize");
  assert.equal(labels.get(98), "Planetary Construction");
});

// COMPANION MATCHER PROOF: the humanizer must actually change the code (insert a
// space). A no-op humanizer would pass any test that only checks "a non-empty
// label"; this pins that "MarketTransaction" is NOT what reaches the panel.
test("decodeEntryTypeLabels never leaves a run-together code as the label", () => {
  const labels = decodeEntryTypeLabels(REAL_LABELS);
  assert.notEqual(labels.get(2), "MarketTransaction");
  assert.match(labels.get(2) ?? "", / /);
});

test("decodeEntryTypeLabels: an unreadable map is empty (rows will fall back to 'Other')", () => {
  assert.equal(decodeEntryTypeLabels(null as unknown as JsonValue).size, 0);
  assert.equal(decodeEntryTypeLabels({ type: "list", items: [] } as JsonValue).size, 0);
});

test("decodeJournal decodes the real Rowset: amount bigint-safe, ref-type as words, date a FILETIME bigint", () => {
  const labels = decodeEntryTypeLabels(REAL_LABELS);
  const rows = decodeJournal(journalRowset(REAL_JOURNAL_LINES), labels);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    id: "1784675859816261",
    date: 134291494598160000n,
    amount: "10000",
    refType: "Bounty Prize",
  });
  // A DEBIT keeps its sign; the amount stays a decimal string, never Number.
  assert.equal(rows[1]!.amount, "-1459390");
  assert.equal(rows[1]!.refType, "Market Transaction");
  assert.equal(rows[2]!.refType, "Planetary Construction");
  // The FILETIME is a bigint (it exceeds 2^53) — never coerced to a number.
  assert.equal(typeof rows[0]!.date, "bigint");
});

// R7d STRUCTURAL PROOF: the decoded row carries ONLY {id,date,amount,refType} —
// no referenceID (21980) and no ownerID (140000005) survive decoding, so neither
// can ever reach rendered text.
test("decodeJournal drops every raw id (no referenceID/ownerID in the decoded row)", () => {
  const rows = decodeJournal(journalRowset(REAL_JOURNAL_LINES), new Map());
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["amount", "date", "id", "refType"]);
  const serialized = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assert.equal(serialized.includes("21980"), false, "referenceID must not survive");
  assert.equal(serialized.includes("140000005"), false, "ownerID must not survive");
  assert.equal(serialized.includes("30000144"), false, "solarSystemID must not survive");
});

// COMPANION to the sweep above: prove the includes()-matcher actually fires when
// an id IS present, so the "does not include" assertions above aren't vacuous.
test("the id-absence matcher would catch a leaked id", () => {
  const withId = JSON.stringify([{ leak: "the ownerID is 140000005 here" }]);
  assert.equal(withId.includes("140000005"), true);
});

// An ISK amount past 2^53 stays EXACT: the wire contract lets a long cross as
// {type:"long"}, and a bare decimal string is the R32 flattened form. Both must
// survive without Number rounding.
test("decodeJournal keeps a >2^53 amount exact (long wrapper AND bare decimal string)", () => {
  const asLong = decodeJournal(
    journalRowset([[1, { type: "long", value: "1" }, 0, 2, 0, 0, 1000, { type: "long", value: "9007199254740993" }, 0, "", 1, 1]]),
    new Map(),
  );
  assert.equal(asLong[0]!.amount, "9007199254740993");
  const asString = decodeJournal(
    journalRowset([[1, "134291494598160000", 0, 2, 0, 0, 1000, "9007199254740993", 0, "", 1, 1]]),
    new Map(),
  );
  // R32: a FILETIME that arrived as a BARE STRING still decodes to the bigint.
  assert.equal(asString[0]!.date, 134291494598160000n);
  assert.equal(asString[0]!.amount, "9007199254740993");
});

test("decodeJournal: a well-formed empty Rowset -> [] (a real 'no journal entries yet')", () => {
  assert.deepEqual(decodeJournal(journalRowset([]), new Map()), []);
  assert.deepEqual(decodeJournal(null as unknown as JsonValue, new Map()), []);
});

test("decodeTransactions decodes the real list<KeyVal> rows and labels them", () => {
  const labels = decodeEntryTypeLabels(REAL_LABELS);
  const raw = txnList([
    { transactionID: 1784675859816261, transactionDate: { type: "long", value: "134291494598160000" }, referenceID: 21980, entryTypeID: 17, ownerID1: 140000005, ownerID2: 140000005, accountKey: 1000, amount: 10000, balance: 115789452720.04, description: "NBL:\n  21980: 1", currency: 1, sortValue: 1 },
  ]);
  const rows = decodeTransactions(raw, labels);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.amount, "10000");
  assert.equal(rows[0]!.refType, "Bounty Prize");
  assert.equal(rows[0]!.date, 134291494598160000n);
  // No raw id survives here either.
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0]!, "referenceID"), false);
});

test("decodeTransactions: a well-formed empty list -> [] (a real 'no transactions yet')", () => {
  assert.deepEqual(decodeTransactions({ type: "list", items: [] }, new Map()), []);
  assert.deepEqual(decodeTransactions(null as unknown as JsonValue, new Map()), []);
});

// COMPANION MATCHER PROOF for the ledger row: without the entry-types map a row
// still decodes, but labels "Other" — proving the label really comes from the
// map (not a hardcoded default that would pass regardless).
test("decodeJournal falls back to 'Other' (never a raw code) when the label is unknown", () => {
  const rows = decodeJournal(journalRowset(REAL_JOURNAL_LINES), new Map());
  assert.equal(rows[0]!.refType, "Other");
  assert.notEqual(rows[0]!.refType, "17");
});

// --- R89 account financial write acks (Phase-3 WRITES) ----------------------

/** A util.KeyVal wrapper around plain fields (the BFF write-ack shape the decoder reads). */
function accountAckKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

test("R89 — an account write ack decodes to {ok, applied}", () => {
  const ack = decodeAccountWriteAck(accountAckKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("R89 — a declined account write is read as not-applied, not a throw", () => {
  const ack = decodeAccountWriteAck(accountAckKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
});

test("R89 — a GiveCash-to-corp ack surfaces the [from, to] balances from result", () => {
  const ack = decodeGiveCashAck(
    accountAckKeyVal({ ok: true, applied: true, result: { type: "list", items: [1000, 5000] } }),
  );
  assert.equal(ack.applied, true);
  assert.equal(ack.fromBalance, 1000);
  assert.equal(ack.toBalance, 5000);
});

test("R89 — a GiveCash-to-char ack (null result) reads both balances null", () => {
  const ack = decodeGiveCashAck(accountAckKeyVal({ ok: true, applied: true, result: null }));
  assert.equal(ack.fromBalance, null);
  assert.equal(ack.toBalance, null);
});
