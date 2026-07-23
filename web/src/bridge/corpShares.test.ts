// R81 corpRegistry share-ledger decoders against REAL captured shapes.
//
// Fixtures are the EXACT retail shapes the server builders emit (buildRowset for
// GetShareholders, buildDbRowset CRowset for GetSharesByShareholder — serviceHelpers.js),
// reconciled with bytes captured live through /api/bridge/call on 2026-07-22 as Farmer
// (character 140000005, corp 98000001). The arg-injection probe (as Farmer, injecting
// Test Two's corp 98000000) is asserted to still DECODE the (leaked) foreign ledger —
// the leak is server-side and flagged; the decoder is shape-faithful either way.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpShareholders,
  decodeCorpSharesByShareholder,
} from "./corpShares.ts";
import type { JsonValue } from "./wire.ts";

const SHARE_COLUMNS = [
  ["shareholderID", 3],
  ["corporationID", 3],
  ["shares", 3],
];

// GetShareholders — a util.Rowset with header/columns and {type:"list"} lines.
function shareholdersRowset(
  rows: readonly (readonly [number, number, number])[],
): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: ["shareholderID", "corporationID", "shares"] }],
        ["columns", { type: "list", items: ["shareholderID", "corporationID", "shares"] }],
        ["RowClass", { type: "token", value: "util.Row" }],
        [
          "lines",
          {
            type: "list",
            items: rows.map((cells) => ({ type: "list", items: [...cells] })),
          },
        ],
      ],
    },
  } as unknown as JsonValue;
}

// GetSharesByShareholder — a CRowset (objectex2) whose rows live on `list` as one
// POSITIONAL packedrow (`values`, not `fields`).
function sharesCrowset(
  rows: readonly (readonly [number, number, number])[],
): JsonValue {
  return {
    type: "objectex2",
    header: [
      [{ type: "token", value: "carbon.common.script.sys.crowset.CRowset" }],
      { type: "dict", entries: [["header", { type: "objectex1", header: [], list: [], dict: [] }]] },
    ],
    list: rows.map((cells) => ({
      type: "packedrow",
      columns: SHARE_COLUMNS,
      values: [...cells],
    })),
    dict: [],
  } as unknown as JsonValue;
}

test("GetShareholders decodes each ledger row (shareholderID / corporationID / shares)", () => {
  // Farmer's own corp 98000001 holds its OWN founding 1000 shares (captured live:
  // lines=[[98000001, 98000001, 1000]] — the corp is its own sole shareholder).
  const rows = decodeCorpShareholders(
    shareholdersRowset([[98000001, 98000001, 1000]]),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    shareholderID: 98000001,
    corporationID: 98000001,
    shares: 1000,
  });
});

test("GetShareholders decodes multiple holders in wire order", () => {
  // Same builder, more rows (a corp with the CEO also holding some shares).
  const rows = decodeCorpShareholders(
    shareholdersRowset([
      [98000001, 98000001, 900],
      [140000005, 98000001, 100],
    ]),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.shareholderID, 98000001);
  assert.equal(rows[1]!.shareholderID, 140000005);
  assert.equal(rows[1]!.shares, 100);
});

test("GetShareholders returns [] for a real empty ledger", () => {
  assert.deepEqual(decodeCorpShareholders(shareholdersRowset([])), []);
  assert.deepEqual(decodeCorpShareholders(null), []);
});

test("GetShareholders under arg-injection still decodes the (leaked) foreign ledger", () => {
  // As Farmer, injecting corp 98000000 (Test Two's) — the handler applies no session
  // check, so a foreign row comes back and the decoder is shape-faithful to it.
  const rows = decodeCorpShareholders(
    shareholdersRowset([[140000002, 98000000, 1000]]),
  );
  assert.equal(rows[0]!.corporationID, 98000000);
  assert.equal(rows[0]!.shareholderID, 140000002);
});

test("GetSharesByShareholder decodes the caller's own single holding from the CRowset", () => {
  // Captured live: flag=0 (personal) → the session char holds 0 shares in its corp.
  const personal = decodeCorpSharesByShareholder(
    sharesCrowset([[140000005, 98000001, 0]]),
  );
  assert.ok(personal);
  assert.deepEqual(personal, {
    shareholderID: 140000005,
    corporationID: 98000001,
    shares: 0,
  });
  // flag=1 (company) → the session CORP's own 1000 shares (captured live).
  const company = decodeCorpSharesByShareholder(
    sharesCrowset([[98000001, 98000001, 1000]]),
  );
  assert.deepEqual(company, {
    shareholderID: 98000001,
    corporationID: 98000001,
    shares: 1000,
  });
});

test("GetSharesByShareholder returns null for an empty CRowset", () => {
  assert.equal(decodeCorpSharesByShareholder(sharesCrowset([])), null);
  assert.equal(decodeCorpSharesByShareholder(null), null);
});
