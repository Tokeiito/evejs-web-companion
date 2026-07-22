// Corp / alliance / community saved-fitting library decoders (goal R65) against
// REAL captured bytes.
//
// The corp and alliance fitting managers share the CHARACTER manager's row shape
// (all three call getOwnerFittingsResponse -> buildFittingPayload), so the row
// decoder is R57's decodeFittings, reused. What differs is the ENVELOPE:
//   • corpFittingMgr.GetFittings / GetCommunityFittings WRAP the dict in a retail
//     CachedMethodCallResult (captured live from Farmer 2026-07-22 as an EMPTY
//     corp/community library) — the payload rides args[1] as {type:"substream",
//     value:<dict>}, peeled with unwrapCachedResult (market.ts), the SAME double
//     step corpAssets/standings use.
//   • allianceFittingMgr.GetFittings returns the RAW dict (no cache wrapper), like
//     the char manager. Farmer is in NO alliance, so the live call answered
//     409 OWNER_SCOPE_DENIED (a real "no alliance" state, gated off the session —
//     never a leak); the populated-dict path below therefore reuses R57's real
//     Farmer fitting row (identical buildFittingPayload shape) as the fixture.
//
// R7d: shipTypeID / module typeIDs / flagID / ownerID stay numeric fields.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeAllianceFittings,
  decodeCommunityFittings,
  decodeCorpFittings,
} from "./sharedFittings.ts";
import type { JsonValue } from "./wire.ts";

// The EXACT empty corp/community envelope captured live (CachedMethodCallResult
// whose substream carries an empty dict).
const EMPTY_CACHED: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "15 minutes" }]] },
    { type: "substream", value: { type: "dict", entries: [] } },
    { type: "list", items: [{ type: "long", value: "134292024069930000" }, 61145237] },
  ],
};

// One saved fitting, the R57 real Farmer row (shipTypeID 588, three modules), in
// the shared buildFittingPayload shape.
const FITTING_ROW: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["description", ""],
      [
        "fitData",
        {
          type: "list",
          items: [
            { type: "tuple", items: [3651, 28, 1] },
            { type: "tuple", items: [21857, 19, 1] },
            { type: "tuple", items: [3636, 27, 1] },
          ],
        },
      ],
      ["fittingID", 1],
      ["name", "asdf"],
      ["ownerID", 98000001],
      ["savedDate", { type: "long", value: "134285151537020000" }],
      ["shipTypeID", 588],
    ],
  },
};

const FITTING_DICT: JsonValue = { type: "dict", entries: [[1, FITTING_ROW]] };

// A CachedMethodCallResult wrapping the populated dict (the corp non-empty shape).
const POPULATED_CACHED: JsonValue = {
  type: "object",
  name: { type: "rawstr", value: "carbon.common.script.net.objectCaching.CachedMethodCallResult" },
  args: [
    { type: "dict", entries: [[{ type: "rawstr", value: "versionCheck" }, { type: "rawstr", value: "15 minutes" }]] },
    { type: "substream", value: FITTING_DICT },
    { type: "list", items: [{ type: "long", value: "134292024069930000" }, 61145237] },
  ],
};

test("decodeCorpFittings on the real empty cached envelope is [] (empty corp library)", () => {
  assert.deepEqual(decodeCorpFittings(EMPTY_CACHED), []);
});

test("decodeCorpFittings unwraps the cache envelope and decodes the fitting rows", () => {
  const rows = decodeCorpFittings(POPULATED_CACHED);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.fittingID, 1);
  assert.equal(rows[0]!.name, "asdf");
  assert.equal(rows[0]!.shipTypeID, 588);
  assert.equal(rows[0]!.ownerID, 98000001);
  assert.equal(rows[0]!.savedDate, 134285151537020000n);
  assert.deepEqual(rows[0]!.modules, [
    { typeID: 3651, flagID: 28, quantity: 1 },
    { typeID: 21857, flagID: 19, quantity: 1 },
    { typeID: 3636, flagID: 27, quantity: 1 },
  ]);
});

test("decodeCommunityFittings on the real empty cached envelope is []", () => {
  assert.deepEqual(decodeCommunityFittings(EMPTY_CACHED), []);
});

test("decodeAllianceFittings decodes a RAW dict (no cache wrapper)", () => {
  const rows = decodeAllianceFittings(FITTING_DICT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.shipTypeID, 588);
  assert.equal(rows[0]!.ownerID, 98000001);
});

test("decodeAllianceFittings on an empty dict is [] (a real 'no alliance fits')", () => {
  assert.deepEqual(decodeAllianceFittings({ type: "dict", entries: [] }), []);
});
