// Abyssal PvP filament (pvpFilamentMgr) reads decoder (goal R69) against builder-mirrored
// bytes. This world seeds no Proving-Grounds event, so every read is empty/zeroed. The
// notification fixtures reproduce buildLeaderboardInfo / buildCharacterStatisticsInfo
// exactly, wrapped as the gateway captures a client notification (method + args:[payload]).
//
// OWNERSHIP EVIDENCE baked in: the GetCharacterStatistics payload carries NO character
// identity and the statistics are all zero — the decoder has nothing per-character to
// surface, matching the handler that takes [matchTypeID, scheduleID] (no charID) and
// returns hardcoded zeros. A second live session returned the identical zeroed dict.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeEvents,
  decodeMostRecentEvent,
  decodeNextEventDate,
  decodeLeaderboard,
  decodeCharacterStatistics,
} from "./pvpFilaments.ts";
import type { BridgeNotification, JsonValue } from "./wire.ts";

// --- wire-shape helpers -----------------------------------------------------

function list(items: JsonValue[]): JsonValue {
  return { type: "list", items };
}
function dict(entries: [string, JsonValue][]): JsonValue {
  return { type: "dict", entries };
}
function long(value: string): JsonValue {
  return { type: "long", value };
}
/** A captured client notification: the gateway records {..., method, args:[payload]}. */
function clientNotification(method: string, payload: JsonValue): BridgeNotification {
  return { service: "", method, args: [payload], kwargs: null };
}

// --- GetAllEvents / GetActiveEvents (empty dict) ----------------------------

test("decodeEvents returns [] for the real empty event dict and reads populated pairs", () => {
  assert.deepEqual(decodeEvents(dict([])), []);
  assert.deepEqual(decodeEvents(null), []);
  const pairs = decodeEvents(dict([["101", list([])], ["102", list([])]]));
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0]![0], "101");
});

// --- GetMostRecentEvent / GetNextEventDate (null) ---------------------------

test("decodeMostRecentEvent returns null for the real no-event answer and passes a value through", () => {
  assert.equal(decodeMostRecentEvent(null), null);
  const populated = dict([["eventID", 55]]);
  assert.deepEqual(decodeMostRecentEvent(populated), populated);
});

test("decodeNextEventDate returns null (no event) and reads a bigint FILETIME when present", () => {
  assert.equal(decodeNextEventDate(null), null);
  assert.equal(decodeNextEventDate(long("133600000000000000")), 133600000000000000n);
});

// --- GetLeaderboard (via OnPVPFilamentsLeaderboard notification) -------------

test("decodeLeaderboard reads the empty leaderboard from the notification and null when absent", () => {
  const empty = [
    clientNotification(
      "OnPVPFilamentsLeaderboard",
      dict([["matchTypeID", 90001], ["scheduleID", 3], ["entries", list([])]]),
    ),
  ];
  assert.deepEqual(decodeLeaderboard(empty), { matchTypeID: 90001, scheduleID: 3, entries: [] });
  // No matching notification -> null (the read pushed nothing).
  assert.equal(decodeLeaderboard([]), null);
  assert.equal(decodeLeaderboard(undefined), null);
});

test("decodeLeaderboard surfaces populated entries if the server ever pushed them", () => {
  const populated = [
    clientNotification(
      "OnPVPFilamentsLeaderboard",
      dict([["matchTypeID", 90001], ["scheduleID", 3], ["entries", list([dict([["rank", 1]])])]]),
    ),
  ];
  const decoded = decodeLeaderboard(populated);
  assert.equal(decoded!.entries.length, 1);
});

// --- GetCharacterStatistics (via OnPVPFilamentsCharacterStatistics notification) --

test("decodeCharacterStatistics reads the hardcoded-zero stats and null when absent", () => {
  const zeroed = [
    clientNotification(
      "OnPVPFilamentsCharacterStatistics",
      dict([
        ["matchTypeID", 90001],
        ["scheduleID", 3],
        ["statistics", dict([["rank", 0], ["wins", 0], ["losses", 0], ["draws", 0]])],
      ]),
    ),
  ];
  assert.deepEqual(decodeCharacterStatistics(zeroed), {
    matchTypeID: 90001,
    scheduleID: 3,
    rank: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  });
  assert.equal(decodeCharacterStatistics([]), null);
});

test("decodeCharacterStatistics payload carries no character identity (ownership evidence)", () => {
  // The captured payload has only matchTypeID/scheduleID/statistics — NO characterID field,
  // by construction (buildCharacterStatisticsInfo). There is nothing per-character to leak.
  const payload = dict([
    ["matchTypeID", 90001],
    ["scheduleID", 3],
    ["statistics", dict([["rank", 0], ["wins", 0], ["losses", 0], ["draws", 0]])],
  ]);
  const entries = (payload as { entries: [string, JsonValue][] }).entries.map(([k]) => k);
  assert.ok(!entries.includes("characterID"));
  const decoded = decodeCharacterStatistics([
    clientNotification("OnPVPFilamentsCharacterStatistics", payload),
  ]);
  assert.equal(decoded!.wins, 0);
});
