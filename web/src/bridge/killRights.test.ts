// Kill-rights decoder (goal R57) against REAL captured bytes + the server's own
// populated row shape.
//
// ⚠ Farmer holds no kill rights, so the LIVE capture through
// GET /api/bridge/kill-rights on 2026-07-22 was the empty list
// {type:"list", items:[]}. That empty path is asserted directly below. The
// POPULATED fixture is the exact output of the server's buildKillRightPayload
// (eve.js .../bounty/bountyProxyService.js:239) — a util.KeyVal carrying
// killRightID / fromID / toID / expiryTime (long) / price / restrictedTo — so the
// decoder is proven against the shape the handler actually emits, not a guess.
//
// ⚠ R7d: fromID / toID / restrictedTo are entity ids the decoder keeps as numeric
// fields for a future UI to resolve; the sweep below proves they survive as data
// (and its companion proves the sweep is not vacuous).

import test from "node:test";
import assert from "node:assert/strict";

import { decodeKillRights, decodeKillRightWriteAck } from "./killRights.ts";
import type { JsonValue } from "./wire.ts";

// buildKillRightPayload's exact shape, one for-sale right and one plain right.
const KILL_RIGHTS: JsonValue = {
  type: "list",
  items: [
    {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["killRightID", 5001],
          ["fromID", 140000178],
          ["toID", 140000005],
          ["expiryTime", { type: "long", value: "134285151537020000" }],
          ["price", 2500000],
          ["restrictedTo", 98000001],
        ],
      },
    },
    {
      type: "object",
      name: "util.KeyVal",
      args: {
        type: "dict",
        entries: [
          ["killRightID", 5002],
          ["fromID", 140000178],
          ["toID", 140000005],
          ["expiryTime", { type: "long", value: "0" }],
          ["price", null],
          ["restrictedTo", null],
        ],
      },
    },
  ],
};

test("decodeKillRights on the real empty list is [] (a real 'no kill rights')", () => {
  assert.deepEqual(decodeKillRights({ type: "list", items: [] }), []);
});

test("decodeKillRights decodes the server's populated kill-right rows", () => {
  const rows = decodeKillRights(KILL_RIGHTS);
  assert.equal(rows.length, 2);
  // A for-sale, restricted right: price kept as a bigint-safe string, expiry a bigint.
  assert.deepEqual(rows[0], {
    killRightID: 5001,
    fromID: 140000178,
    toID: 140000005,
    expiryTime: 134285151537020000n,
    price: "2500000",
    restrictedTo: 98000001,
  });
  // A plain right: no price (null), a zero-FILETIME expiry reads as null, no restriction.
  assert.deepEqual(rows[1], {
    killRightID: 5002,
    fromID: 140000178,
    toID: 140000005,
    expiryTime: null,
    price: null,
    restrictedTo: null,
  });
});

test("decodeKillRights drops a malformed row (no killRightID)", () => {
  const rows = decodeKillRights({
    type: "list",
    items: [{ type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["fromID", 1]] } }],
  });
  assert.deepEqual(rows, []);
});

// R7d id-sweep: fromID / toID / restrictedTo survive as numeric fields.
function killRightIdFields(row: {
  readonly fromID: number;
  readonly toID: number;
  readonly restrictedTo: number | null;
}): number[] {
  return [row.fromID, row.toID, ...(row.restrictedTo === null ? [] : [row.restrictedTo])];
}

test("R7d: a decoded kill right preserves fromID/toID/restrictedTo as numeric fields", () => {
  const [row] = decodeKillRights(KILL_RIGHTS);
  const ids = killRightIdFields(row!);
  assert.ok(ids.includes(140000178), "fromID preserved");
  assert.ok(ids.includes(140000005), "toID preserved");
  assert.ok(ids.includes(98000001), "restrictedTo preserved");
});

test("the kill-right id-field extractor actually reads the decoded content", () => {
  // Companion: distinct fields yield distinct ids, so the sweep is not vacuous.
  const ids = killRightIdFields({ fromID: 11, toID: 22, restrictedTo: 33 });
  assert.deepEqual(ids, [11, 22, 33]);
});

// --- R89 killRightMgr financial write acks (Phase-3 WRITES) -----------------

function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("R89 — a killRightMgr write ack decodes to {ok, applied}", () => {
  const ack = decodeKillRightWriteAck(plainAck({ ok: true, applied: true, result: null }));
  assert.deepEqual(ack, { ok: true, applied: true });
});

test("R89 — a declined kill-right write is read as not-applied, not a throw", () => {
  const ack = decodeKillRightWriteAck(plainAck({ ok: true, applied: false }));
  assert.equal(ack.ok, true);
  assert.equal(ack.applied, false);
});
