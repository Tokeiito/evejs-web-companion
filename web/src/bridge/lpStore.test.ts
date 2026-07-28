// LP store decoders (goal R57) against REAL captured bytes.
//
// The fixtures below are the EXACT retail shapes captured live from Farmer
// (character 140000005) through GET /api/bridge/lp on 2026-07-22:
//   • GetLPsForCharacter — POPULATED: three [issuerCorpID, loyaltyPoints] pairs.
//   • GetLPExchangeRates / GetAvailableOffersFromCorp — EMPTY {type:"list",
//     items:[]} (empty-by-design in this world; a legitimate state, not a bug).
//
// ⚠ R7d: issuerCorpID survives as a numeric field (for a future UI to resolve to
// a corporation name); loyaltyPoints stays a bigint-safe decimal string.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCharacterLoyaltyPoints,
  decodeLpExchangeRates,
  decodeLpOffers,
  decodeTakeOfferAck,
} from "./lpStore.ts";
import type { JsonValue } from "./wire.ts";

// The captured GetLPsForCharacter list, verbatim.
const REAL_BALANCES: JsonValue = {
  type: "list",
  items: [
    { type: "list", items: [1000002, 213] },
    { type: "list", items: [1000033, 1500] },
    { type: "list", items: [1000035, 100067000] },
  ],
};

test("decodeCharacterLoyaltyPoints decodes the real GetLPsForCharacter pairs", () => {
  const rows = decodeCharacterLoyaltyPoints(REAL_BALANCES);
  assert.deepEqual(rows, [
    { issuerCorpID: 1000002, loyaltyPoints: "213" },
    { issuerCorpID: 1000033, loyaltyPoints: "1500" },
    { issuerCorpID: 1000035, loyaltyPoints: "100067000" },
  ]);
});

test("decodeCharacterLoyaltyPoints keeps a long-encoded LP amount bigint-safe", () => {
  // A balance beyond 2^53 must not be zeroed or rounded — it stays a decimal string.
  const big: JsonValue = {
    type: "list",
    items: [{ type: "list", items: [1000044, { type: "long", value: "9007199254740993" }] }],
  };
  assert.deepEqual(decodeCharacterLoyaltyPoints(big), [
    { issuerCorpID: 1000044, loyaltyPoints: "9007199254740993" },
  ]);
});

test("decodeCharacterLoyaltyPoints on an empty list is [] (a real 'no loyalty points')", () => {
  assert.deepEqual(decodeCharacterLoyaltyPoints({ type: "list", items: [] }), []);
});

test("decodeCharacterLoyaltyPoints drops a pair with no positive issuerCorpID", () => {
  const rows = decodeCharacterLoyaltyPoints({
    type: "list",
    items: [{ type: "list", items: [0, 500] }],
  });
  assert.deepEqual(rows, []);
});

test("decodeLpExchangeRates / decodeLpOffers on the real empty list are [] (empty-by-design)", () => {
  assert.deepEqual(decodeLpExchangeRates({ type: "list", items: [] }), []);
  assert.deepEqual(decodeLpOffers({ type: "list", items: [] }), []);
});

test("decodeLpExchangeRates / decodeLpOffers preserve raw items without imposing a schema", () => {
  // If the stub handlers ever produce rows, the plumbing must not drop them: the
  // decoders pass the raw list items through unchanged (shape decided later).
  const someRows: JsonValue = { type: "list", items: [{ type: "tuple", items: [1, 2] }, 3] };
  assert.deepEqual(decodeLpExchangeRates(someRows), [{ type: "tuple", items: [1, 2] }, 3]);
  assert.deepEqual(decodeLpOffers(someRows), [{ type: "tuple", items: [1, 2] }, 3]);
});

test("R7d: a decoded LP balance preserves issuerCorpID as a numeric field", () => {
  const rows = decodeCharacterLoyaltyPoints(REAL_BALANCES);
  const corpIDs = rows.map((row) => row.issuerCorpID);
  assert.deepEqual(corpIDs, [1000002, 1000033, 1000035]);
});

// --- R89 LPStoreMgr financial write acks (Phase-3 WRITES) -------------------

function plainAck(fields: Record<string, JsonValue>): JsonValue {
  return { ...fields };
}

test("R89 — a TakeOfferForCharacter ack surfaces taken:true from result", () => {
  const ack = decodeTakeOfferAck(plainAck({ ok: true, applied: true, result: true }));
  assert.deepEqual(ack, { ok: true, applied: true, taken: true });
});

test("R89 — a stub/declined TakeOffer (null result) reads taken:false, not a throw", () => {
  const ack = decodeTakeOfferAck(plainAck({ ok: true, applied: true, result: null }));
  assert.equal(ack.applied, true);
  assert.equal(ack.taken, false);
});
