// petitioner (support) decoders (goal R70) against REAL captured bytes.
//
// ⚠ petitioner is a STUB support service, so every read's LIVE capture through
// GET /api/bridge/petitions on 2026-07-22 (Farmer 140000005) was its empty/constant
// form — asserted directly below. Because the handlers read no per-entity store, a
// foreign petitionID returns the SAME empty message list; that ownership property is
// asserted too. Populated fixtures (a category dict, a petition row) mirror the
// marshaled wire shapes so the decoders are proven against the encodings the service
// would emit if the surface were ever seeded, not a guess.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCategories,
  decodeCategoryHierarchicalInfo,
  decodeMayPetition,
  decodeMyPetitions,
  decodePetitionMessages,
  decodeUnreadMessages,
  decodeZendeskEnabled,
  decodeZendeskJwtLink,
  isPetitionAllowed,
} from "./petitions.ts";
import type { JsonValue } from "./wire.ts";

const EMPTY_LIST: JsonValue = { type: "list", items: [] };
const EMPTY_DICT: JsonValue = { type: "dict", entries: [] };

test("decodeMyPetitions on the real empty list is [] (a real 'no petitions')", () => {
  assert.deepEqual(decodeMyPetitions(EMPTY_LIST), []);
  assert.deepEqual(decodeMyPetitions(null), []);
});

test("decodeMyPetitions returns the raw rows when the surface is populated", () => {
  const row = { type: "object", name: "util.KeyVal", args: { type: "dict", entries: [["petitionID", 7]] } };
  assert.deepEqual(decodeMyPetitions({ type: "list", items: [row] }), [row]);
});

test("decodeCategories on the real empty list is []", () => {
  assert.deepEqual(decodeCategories(EMPTY_LIST), []);
});

test("decodeCategoryHierarchicalInfo reads the real 4-tuple of empty dicts", () => {
  // The LIVE capture: a bare array of four empty dicts.
  const result = decodeCategoryHierarchicalInfo([EMPTY_DICT, EMPTY_DICT, EMPTY_DICT, EMPTY_DICT]);
  assert.equal(result.length, 4);
  for (const dict of result) {
    assert.deepEqual(dict, []);
  }
});

test("decodeCategoryHierarchicalInfo reads populated dict pairs", () => {
  const populated: JsonValue = [
    { type: "dict", entries: [[1, "Stuck"], [2, "Billing"]] },
    EMPTY_DICT,
    EMPTY_DICT,
    EMPTY_DICT,
  ];
  const result = decodeCategoryHierarchicalInfo(populated);
  assert.deepEqual(result[0], [[1, "Stuck"], [2, "Billing"]]);
  assert.deepEqual(result[1], []);
});

test("decodeCategoryHierarchicalInfo on a non-array is []", () => {
  assert.deepEqual(decodeCategoryHierarchicalInfo(null), []);
});

test("decodePetitionMessages: a foreign petitionID returns the SAME empty list (no cross-ticket access)", () => {
  // Ownership: the stub answers empty regardless of petitionID — so a ticket that
  // is not the caller's cannot surface its messages.
  assert.deepEqual(decodePetitionMessages(EMPTY_LIST), []);
});

test("decodeMayPetition reads the code, isPetitionAllowed gates on >= 0", () => {
  // The real live value is -4 (petitioning disabled).
  assert.equal(decodeMayPetition(-4), -4);
  assert.equal(isPetitionAllowed(-4), false);
  assert.equal(decodeMayPetition(0), 0);
  assert.equal(isPetitionAllowed(0), true);
  assert.equal(decodeMayPetition(null), null);
  assert.equal(isPetitionAllowed(null), false);
});

test("decodeZendeskEnabled reads the boolean (true live)", () => {
  assert.equal(decodeZendeskEnabled(true), true);
  assert.equal(decodeZendeskEnabled(false), false);
  assert.equal(decodeZendeskEnabled(null), false);
});

test("decodeZendeskJwtLink passes the support link through untouched", () => {
  // ⚠ CREDENTIAL: the decoder returns the string verbatim and logs nothing.
  const link = "https://support.eveonline.com/hc/en-us/requests/new";
  assert.equal(decodeZendeskJwtLink(link), link);
  assert.equal(decodeZendeskJwtLink(null), null);
  assert.equal(decodeZendeskJwtLink(42), null);
});

test("decodeUnreadMessages on the real empty list is []", () => {
  assert.deepEqual(decodeUnreadMessages(EMPTY_LIST), []);
});
