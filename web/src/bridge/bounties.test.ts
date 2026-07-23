// Bounty-reads decoder (goal R66) against REAL captured bytes + the server's own
// populated builders.
//
// ⚠ Farmer's world has NO bounties placed and NO kill rights, so the LIVE captures
// through GET /api/bridge/bounties on 2026-07-22 were the zero/empty paths:
// GetBounties (no args) returned the whole known board as [targetID, KeyVal]
// tuples with bounty 0; GetMyBounties / GetKillRightsOnCharacters / the ranked
// leaderboards' inner lists were empty. Those real bytes are asserted directly
// below. The POPULATED fixtures mirror the server builders
// (buildBountyPayloadFromPool / buildContributionPayload / buildKillRightPayload,
// eve.js .../bounty/bountyProxyService.js), so the decoder is proven against the
// shapes the handlers actually emit — including the bigint-safe ISK path the
// zero-amount live world cannot exercise.
//
// ⚠ R7d: targetID / corporationID / allianceID / contributionID are entity ids the
// decoder keeps as numeric fields for a future UI; the sweep proves they survive.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeBountyPools,
  decodeBountyLeaderboard,
  decodeMyBounties,
  decodeBountiesAndKillRights,
  decodeBountyWriteAck,
} from "./bounties.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(entries: [string, JsonValue][]): JsonValue {
  return { type: "object", name: "util.KeyVal", args: { type: "dict", entries } };
}

// REAL bytes: GetBounties (no args) — three of the 18 board entries captured live.
// Each is a [targetID, util.KeyVal] tuple; bounty is 0 across the empty world.
const REAL_BOUNTIES: JsonValue = {
  type: "list",
  items: [
    [0, keyVal([["targetID", 0], ["bounty", 0]])],
    [140000005, keyVal([["targetID", 140000005], ["bounty", 0], ["corporationID", 98000001]])],
    [140000002, keyVal([["targetID", 140000002], ["bounty", 0], ["corporationID", 98000000], ["allianceID", 99000000]])],
  ],
};

// A POPULATED board (buildBountyPayloadFromPool shape) with real ISK amounts: a
// plain-number bounty and a {type:"long"} bounty at the 2^63-1 edge to prove the
// bigint-safe path the zero-amount live world never exercises.
const POPULATED_BOUNTIES: JsonValue = {
  type: "list",
  items: [
    [140000005, keyVal([["targetID", 140000005], ["bounty", 2500000000], ["corporationID", 98000001], ["allianceID", 99000000]])],
    [98000006, keyVal([["targetID", 98000006], ["bounty", { type: "long", value: "9223372036854775807" }], ["corporationID", 98000006]])],
  ],
};

// GetTopPilotBounties captured live: [emptyList, resultTime(long)].
const REAL_TOP_PILOTS: JsonValue = [
  { type: "list", items: [] },
  { type: "long", value: "134292041127520000" },
];

// A populated leaderboard: bare KeyVals (NOT [key, KeyVal] tuples) + a result time.
const POPULATED_LEADERBOARD: JsonValue = [
  {
    type: "list",
    items: [
      keyVal([["targetID", 140000005], ["bounty", 750000000], ["corporationID", 98000001]]),
      keyVal([["targetID", 140000002], ["bounty", 120000000]]),
    ],
  },
  { type: "long", value: "134292041127520000" },
];

// buildContributionPayload shape (GetMyBounties, populated).
const POPULATED_MY_BOUNTIES: JsonValue = {
  type: "list",
  items: [
    keyVal([
      ["contributionID", 9001],
      ["targetID", 140000178],
      ["amount", 5000000],
      ["corporationID", 1000044],
      ["allianceID", 0],
    ]),
  ],
};

// buildKillRightPayload shape, for GetBountiesAndKillRights' second half.
const KILL_RIGHT: JsonValue = keyVal([
  ["killRightID", 5001],
  ["fromID", 140000178],
  ["toID", 140000005],
  ["expiryTime", { type: "long", value: "134285151537020000" }],
  ["price", 2500000],
  ["restrictedTo", 98000001],
]);

// --- GetBounties (decodeBountyPools) -----------------------------------------

test("decodeBountyPools decodes the REAL live board (bounty 0, corp/alliance optional)", () => {
  const pools = decodeBountyPools(REAL_BOUNTIES);
  assert.equal(pools.length, 3);
  // targetID 0 is a REAL board entry (kept, not dropped); no corp/alliance.
  assert.deepEqual(pools[0], { targetID: 0, bounty: "0", corporationID: null, allianceID: null });
  assert.deepEqual(pools[1], { targetID: 140000005, bounty: "0", corporationID: 98000001, allianceID: null });
  assert.deepEqual(pools[2], { targetID: 140000002, bounty: "0", corporationID: 98000000, allianceID: 99000000 });
});

test("decodeBountyPools keeps ISK amounts bigint-safe (plain number AND {type:'long'})", () => {
  const pools = decodeBountyPools(POPULATED_BOUNTIES);
  assert.equal(pools[0]!.bounty, "2500000000");
  // 2^63-1 survives exactly as a string — never through Number.
  assert.equal(pools[1]!.bounty, "9223372036854775807");
  assert.equal(typeof pools[1]!.bounty, "string");
});

test("decodeBountyPools returns [] for a real empty list", () => {
  assert.deepEqual(decodeBountyPools({ type: "list", items: [] }), []);
  assert.deepEqual(decodeBountyPools(null), []);
});

// --- ranked leaderboards (decodeBountyLeaderboard) ---------------------------

test("decodeBountyLeaderboard on the REAL empty leaderboard: no pools, real time", () => {
  const board = decodeBountyLeaderboard(REAL_TOP_PILOTS);
  assert.deepEqual(board.pools, []);
  assert.equal(board.resultTime, 134292041127520000n);
});

test("decodeBountyLeaderboard decodes bare-KeyVal pool items + the result time", () => {
  const board = decodeBountyLeaderboard(POPULATED_LEADERBOARD);
  assert.equal(board.pools.length, 2);
  assert.deepEqual(board.pools[0], { targetID: 140000005, bounty: "750000000", corporationID: 98000001, allianceID: null });
  assert.deepEqual(board.pools[1], { targetID: 140000002, bounty: "120000000", corporationID: null, allianceID: null });
  assert.equal(board.resultTime, 134292041127520000n);
});

// --- GetMyBounties (decodeMyBounties) ----------------------------------------

test("decodeMyBounties on the REAL empty list is []", () => {
  assert.deepEqual(decodeMyBounties({ type: "list", items: [] }), []);
});

test("decodeMyBounties decodes the server's populated contribution row", () => {
  const rows = decodeMyBounties(POPULATED_MY_BOUNTIES);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    contributionID: 9001,
    targetID: 140000178,
    amount: "5000000",
    corporationID: 1000044,
    // allianceID 0 reads as null (the "no alliance" sentinel).
    allianceID: null,
  });
});

// --- GetBountiesAndKillRights (decodeBountiesAndKillRights) -------------------

test("decodeBountiesAndKillRights splits the [bounties, killRights] 2-tuple", () => {
  const both = decodeBountiesAndKillRights([POPULATED_BOUNTIES, { type: "list", items: [KILL_RIGHT] }]);
  assert.equal(both.bounties.length, 2);
  assert.equal(both.bounties[0]!.targetID, 140000005);
  assert.equal(both.killRights.length, 1);
  assert.equal(both.killRights[0]!.killRightID, 5001);
  assert.equal(both.killRights[0]!.price, "2500000");
});

test("decodeBountiesAndKillRights on the REAL empty 2-tuple is two empty halves", () => {
  // The live capture: bounties resolved to the board, kill rights empty.
  const both = decodeBountiesAndKillRights([REAL_BOUNTIES, { type: "list", items: [] }]);
  assert.equal(both.bounties.length, 3);
  assert.deepEqual(both.killRights, []);
});

// --- R7d id-sweep + its non-vacuous companion --------------------------------

function poolIdFields(pool: { targetID: number; corporationID: number | null; allianceID: number | null }): number[] {
  return [pool.targetID, ...(pool.corporationID === null ? [] : [pool.corporationID]), ...(pool.allianceID === null ? [] : [pool.allianceID])];
}

test("R7d: a decoded pool preserves targetID/corporationID/allianceID as numeric fields", () => {
  const pools = decodeBountyPools(REAL_BOUNTIES);
  const ids = poolIdFields(pools[2]!);
  assert.ok(ids.includes(140000002), "targetID preserved");
  assert.ok(ids.includes(98000000), "corporationID preserved");
  assert.ok(ids.includes(99000000), "allianceID preserved");
});

test("the pool id-field extractor actually reads the decoded content", () => {
  assert.deepEqual(poolIdFields({ targetID: 11, corporationID: 22, allianceID: 33 }), [11, 22, 33]);
  assert.deepEqual(poolIdFields({ targetID: 11, corporationID: null, allianceID: null }), [11]);
});

// --- R89 bountyProxy financial write acks (Phase-3 WRITES) ------------------

function bountyAckKeyVal(fields: Record<string, JsonValue>): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: Object.entries(fields) },
  };
}

test("R89 — a bountyProxy write ack decodes to {ok, applied}", () => {
  const ack = decodeBountyWriteAck(bountyAckKeyVal({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("R89 — a declined bounty write is read as not-applied, not a throw", () => {
  const ack = decodeBountyWriteAck(bountyAckKeyVal({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
});
