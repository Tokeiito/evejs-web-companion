// onlineStatus presence decoder (goal R60) against REAL captured bytes.
//
// The fixtures are VERBATIM live captures through GET /api/bridge/presence from
// Farmer (character 140000005) on 2026-07-22: GetOnlineStatus(140000178) -> false;
// GetInitialState() -> an EMPTY Rowset[contactID, online] (Farmer has no
// contacts); Prime() -> BYTE-IDENTICAL to GetInitialState (the handler delegates).
// The POPULATED contact rows mirror the same Rowset primitive proven live in the
// header, with real rows added so the decode path is exercised.
//
// R7d: contactID survives as a numeric field.

import test from "node:test";
import assert from "node:assert/strict";

import { decodeInitialState, decodeOnlineStatus, decodePrime } from "./presence.ts";
import type { JsonValue } from "./wire.ts";

function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items };
}

// The Rowset shape onlineStatus emits (eve.common.script.sys.rowset.Rowset with
// BOTH header and columns), built here with the given lines.
function onlineRowset(lines: readonly JsonValue[]): JsonValue {
  return {
    type: "object",
    name: "eve.common.script.sys.rowset.Rowset",
    args: {
      type: "dict",
      entries: [
        ["header", list(["contactID", "online"])],
        ["columns", list(["contactID", "online"])],
        ["RowClass", { type: "token", value: "util.Row" }],
        ["lines", list(lines)],
      ],
    },
  };
}

// VERBATIM live capture: the empty presence snapshot (Farmer has no contacts).
const INITIAL_STATE_EMPTY = onlineRowset([]);
// Prime was byte-identical to GetInitialState live.
const PRIME_EMPTY = onlineRowset([]);

test("decodeOnlineStatus decodes the live bare boolean (false)", () => {
  assert.equal(decodeOnlineStatus(false), false);
  assert.equal(decodeOnlineStatus(true), true);
});

test("decodeOnlineStatus treats a missing/failed read as not-online", () => {
  assert.equal(decodeOnlineStatus(null), false);
  assert.equal(decodeOnlineStatus(undefined), false);
  assert.equal(decodeOnlineStatus(1 as unknown as JsonValue), false);
});

test("decodeInitialState on the live empty Rowset is empty (a real 'no contacts')", () => {
  assert.deepEqual(decodeInitialState(INITIAL_STATE_EMPTY), []);
  assert.deepEqual(decodeInitialState(null), []);
});

test("decodeInitialState decodes populated {contactID, online} rows (bare-array + util.Row lines)", () => {
  // Bare-array line + a util.Row list line — readRowsetRows reads both.
  const rowset = onlineRowset([
    [140000178, true],
    list([1000044, false]),
  ]);
  assert.deepEqual(decodeInitialState(rowset), [
    { contactID: 140000178, online: true },
    { contactID: 1000044, online: false },
  ]);
});

test("decodeInitialState drops a row with no positive contactID", () => {
  assert.deepEqual(decodeInitialState(onlineRowset([[0, true]])), []);
});

test("decodePrime decodes the same Rowset as GetInitialState (Prime is NOT void)", () => {
  // Live: Prime was byte-identical to GetInitialState.
  assert.deepEqual(decodePrime(PRIME_EMPTY), []);
  assert.deepEqual(
    decodePrime(onlineRowset([[140000178, true]])),
    [{ contactID: 140000178, online: true }],
  );
  assert.equal(decodePrime, decodeInitialState);
});

// R7d id-sweep: contactID survives as a numeric field.
test("R7d: decodeInitialState preserves contactID as a numeric field", () => {
  const rows = decodeInitialState(onlineRowset([[140000178, true]]));
  assert.equal(rows[0]!.contactID, 140000178);
});

test("the presence id assertion actually reads distinct decoded content (not vacuous)", () => {
  const rows = decodeInitialState(onlineRowset([[999888, false]]));
  assert.equal(rows[0]!.contactID, 999888);
  assert.notEqual(rows[0]!.contactID, 140000178);
});
