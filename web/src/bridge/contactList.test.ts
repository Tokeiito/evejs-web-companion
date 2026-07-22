// Contact-list decoder (goal R58) against REAL captured bytes + the server's own
// populated row shape.
//
// ⚠ Farmer has no contacts and no blocked owners, so the LIVE capture through
// GET /api/bridge/contact-list on 2026-07-22 was a util.KeyVal carrying two
// EMPTY Rowsets (lines:[]). That empty path is asserted directly. The POPULATED
// fixtures mirror the server's buildContactRow / buildBlockedRow
// (eve.js .../character/charMgrService.js) — bare-array rows
// [contactID, inWatchlist(0|1), relationshipID, labelMask] and [senderID] — so
// the decoder is proven against the shape the handler actually emits, not a guess.
//
// ⚠ R7d: contactID / senderID are entity ids the decoder keeps as numeric fields
// for a future UI to resolve; the sweep below proves they survive as data (and
// its companion proves the sweep is not vacuous).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeContactList } from "./contactList.ts";
import type { JsonValue } from "./wire.ts";

function rowset(columns: readonly string[], lines: readonly JsonValue[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: columns }],
        ["columns", { type: "list", items: columns }],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: lines }],
      ],
    },
  };
}

function contactList(addresses: JsonValue, blocked: JsonValue): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: [["addresses", addresses], ["blocked", blocked]] },
  };
}

const ADDRESS_COLUMNS = ["contactID", "inWatchlist", "relationshipID", "labelMask"];

// The EXACT live empty capture (Farmer): two rowsets, both lines:[].
const EMPTY_LIVE = contactList(rowset(ADDRESS_COLUMNS, []), rowset(["senderID"], []));

// A populated capture mirroring buildContactRow / buildBlockedRow: one watchlisted
// contact with a label mask, and one blocked owner.
const POPULATED = contactList(
  rowset(ADDRESS_COLUMNS, [
    [140000178, 1, 5, 6],
    [140000200, 0, 0, 0],
  ]),
  rowset(["senderID"], [[140000250]]),
);

test("decodeContactList on the real empty capture is empty (a real 'no contacts')", () => {
  assert.deepEqual(decodeContactList(EMPTY_LIVE), { contacts: [], blocked: [] });
});

test("decodeContactList decodes the server's populated contact + blocked rows", () => {
  const decoded = decodeContactList(POPULATED);
  assert.equal(decoded.contacts.length, 2);
  // A watchlisted contact: inWatchlist 1 -> true, labelMask kept bigint-safe.
  assert.deepEqual(decoded.contacts[0], {
    contactID: 140000178,
    inWatchlist: true,
    relationshipID: 5,
    labelMask: "6",
  });
  // A plain contact: not watchlisted, no label.
  assert.deepEqual(decoded.contacts[1], {
    contactID: 140000200,
    inWatchlist: false,
    relationshipID: 0,
    labelMask: "0",
  });
  assert.deepEqual(decoded.blocked, [{ senderID: 140000250 }]);
});

test("decodeContactList keeps a large labelMask bigint-safe (long wrapper, never 0)", () => {
  const bigMask = "9007199254740993"; // 2^53 + 1
  const decoded = decodeContactList(
    contactList(
      rowset(ADDRESS_COLUMNS, [[140000178, 0, 0, { type: "long", value: bigMask }]]),
      rowset(["senderID"], []),
    ),
  );
  assert.equal(decoded.contacts[0]!.labelMask, bigMask);
});

test("decodeContactList drops a contact with no positive contactID", () => {
  const decoded = decodeContactList(
    contactList(rowset(ADDRESS_COLUMNS, [[0, 1, 0, 0]]), rowset(["senderID"], [])),
  );
  assert.deepEqual(decoded.contacts, []);
});

test("decodeContactList on a non-KeyVal is empty (a failed read, not a throw)", () => {
  assert.deepEqual(decodeContactList(null), { contacts: [], blocked: [] });
  assert.deepEqual(decodeContactList({ type: "list", items: [] }), { contacts: [], blocked: [] });
});

// R7d id-sweep: contactID / senderID survive as numeric fields.
function contactListIds(list: ReturnType<typeof decodeContactList>): number[] {
  return [...list.contacts.map((c) => c.contactID), ...list.blocked.map((b) => b.senderID)];
}

test("R7d: a decoded contact list preserves contactID / senderID as numeric fields", () => {
  const ids = contactListIds(decodeContactList(POPULATED));
  assert.ok(ids.includes(140000178), "contactID preserved");
  assert.ok(ids.includes(140000250), "senderID preserved");
});

test("the contact-list id extractor actually reads the decoded content", () => {
  // Companion: distinct ids yield distinct output, so the sweep is not vacuous.
  const ids = contactListIds({
    contacts: [{ contactID: 11, inWatchlist: false, relationshipID: 0, labelMask: "0" }],
    blocked: [{ senderID: 22 }],
  });
  assert.deepEqual(ids, [11, 22]);
});
