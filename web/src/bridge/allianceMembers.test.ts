// R83 allianceRegistry member / tenure / history decoders against REAL captured bytes.
//
// Fixtures are the EXACT retail shapes captured live through /api/bridge/call on
// 2026-07-22: as Farmer (character 140000005, corp 98000001, ALLIANCE-LESS) the session
// forms returned the empty state; the populated shapes came from an explicit allianceID
// (Elysian 99000000) / corpID (98000000 Test Two, 98000001 Farmer). startDate FILETIMEs
// exceed 2^53 and are asserted to survive as raw decimal STRINGS.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeAllianceMembers,
  decodeAllianceMembersOlderThan,
  decodeDaysInAlliance,
  decodeEmploymentRecord,
} from "./allianceMembers.ts";
import type { JsonValue } from "./wire.ts";

function rowset(header: readonly string[], lines: readonly JsonValue[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", { type: "list", items: [...header] }],
        ["columns", { type: "list", items: [...header] }],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", { type: "list", items: [...lines] }],
      ],
    },
  };
}

const MEMBER_HEADER = ["corporationID", "allianceID", "chosenExecutorID", "startDate", "deleted"];

// Elysian's REAL member Rowset (GetAllianceMembers([99000000])), verbatim.
const REAL_MEMBERS = rowset(MEMBER_HEADER, [
  { type: "list", items: [98000000, 99000000, 98000000, { type: "long", value: "134274243506850000" }, 0] },
]);

// Farmer's REAL empty member Rowset (GetAllianceMembers() — alliance-less), verbatim.
const REAL_MEMBERS_EMPTY = rowset(MEMBER_HEADER, []);

const HISTORY_HEADER = ["allianceID", "startDate", "deleted"];

// Test Two's corp 98000000 REAL employment record (GetEmploymentRecord([98000000])).
const REAL_EMPLOYMENT_98000000 = rowset(HISTORY_HEADER, [
  { type: "list", items: [99000000, { type: "long", value: "134274243506850000" }, 0] },
  { type: "list", items: [null, { type: "long", value: "134274243506800000" }, 0] },
]);

// Farmer's corp 98000001 REAL employment record (never in an alliance) — one origin row.
const REAL_EMPLOYMENT_98000001 = rowset(HISTORY_HEADER, [
  { type: "list", items: [null, { type: "long", value: "134276026827950000" }, 0] },
]);

test("decodeAllianceMembers reads member corps, keeping the join FILETIME as a string", () => {
  const members = decodeAllianceMembers(REAL_MEMBERS);
  assert.equal(members.length, 1);
  const m = members[0]!;
  assert.equal(m.corporationID, 98000000);
  assert.equal(m.allianceID, 99000000);
  assert.equal(m.chosenExecutorID, 98000000);
  assert.equal(m.startDate, "134274243506850000");
  assert.equal(typeof m.startDate, "string");
  assert.equal(m.deleted, false);
});

test("decodeAllianceMembers returns [] for the alliance-less-session empty Rowset", () => {
  assert.deepEqual(decodeAllianceMembers(REAL_MEMBERS_EMPTY), []);
  assert.deepEqual(decodeAllianceMembers(null), []);
});

test("decodeAllianceMembersOlderThan reads member corpIDs, [] when none", () => {
  assert.deepEqual(decodeAllianceMembersOlderThan({ type: "list", items: [98000000] }), [98000000]);
  assert.deepEqual(decodeAllianceMembersOlderThan({ type: "list", items: [] }), []);
  assert.deepEqual(decodeAllianceMembersOlderThan(null), []);
});

test("decodeDaysInAlliance reads the bare integer day count", () => {
  assert.equal(decodeDaysInAlliance(21), 21);
  assert.equal(decodeDaysInAlliance(0), 0);
  assert.equal(decodeDaysInAlliance(null), 0);
});

test("decodeEmploymentRecord reads a corp alliance history, null on the origin row", () => {
  const rows = decodeEmploymentRecord(REAL_EMPLOYMENT_98000000);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.allianceID, 99000000);
  assert.equal(rows[0]!.startDate, "134274243506850000");
  assert.equal(rows[0]!.deleted, false);
  // The origin row (corp created outside any alliance) carries a null allianceID.
  assert.equal(rows[1]!.allianceID, null);
  assert.equal(rows[1]!.startDate, "134274243506800000");
});

test("decodeEmploymentRecord reads the alliance-less corp's single origin row", () => {
  const rows = decodeEmploymentRecord(REAL_EMPLOYMENT_98000001);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.allianceID, null);
  assert.equal(rows[0]!.startDate, "134276026827950000");
});
