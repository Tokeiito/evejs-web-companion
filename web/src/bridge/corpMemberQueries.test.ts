// R81 corpRegistry member-id query decoders against REAL captured shapes.
//
// Fixtures are the EXACT retail shapes the server emits (buildList of member
// characterIDs — serviceHelpers.js), reconciled with bytes captured live through
// /api/bridge/call on 2026-07-22 as Farmer (character 140000005, corp 98000001). The
// four reads all resolve their corp from the session, so the ids are always the session
// corp's members; a foreign injected id cannot redirect the corp.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpMemberIdList,
  decodeCorpPendingAutoKicks,
} from "./corpMemberQueries.ts";
import type { JsonValue } from "./wire.ts";

function list(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items } as unknown as JsonValue;
}

test("member-id list decodes the session corp's member characterIDs in wire order", () => {
  // Farmer's corp 98000001 = {Farmer 140000005, asdf 998830009} (captured live).
  const ids = decodeCorpMemberIdList(list([140000005, 998830009]));
  assert.deepEqual(ids, [140000005, 998830009]);
});

test("member-id list tolerates {type:'long'} ids and drops non-numeric entries", () => {
  const ids = decodeCorpMemberIdList(
    list([140000005, { type: "long", value: "998830009" }, "not-an-id", null]),
  );
  assert.deepEqual(ids, [140000005, 998830009]);
});

test("member-id list returns [] for a real empty result", () => {
  assert.deepEqual(decodeCorpMemberIdList(list([])), []);
  assert.deepEqual(decodeCorpMemberIdList(null), []);
});

test("GetMemberIDsWithMoreThanAvgShares: a single above-average holder decodes", () => {
  // With the CEO holding all shares, only the CEO exceeds the average (captured live).
  assert.deepEqual(decodeCorpMemberIdList(list([140000005])), [140000005]);
});

test("GetPendingAutoKicks returns the raw entries; [] for a healthy corp (empty live)", () => {
  assert.deepEqual(decodeCorpPendingAutoKicks(list([])), []);
  assert.deepEqual(decodeCorpPendingAutoKicks(null), []);
  // The entry shape is passed through untouched (no populated queue seeded).
  assert.deepEqual(decodeCorpPendingAutoKicks(list([998830009])), [998830009]);
});
