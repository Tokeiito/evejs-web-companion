// R83 allianceRegistry alliance-identity decoders against REAL captured bytes.
//
// Fixtures are the EXACT retail shapes captured live through /api/bridge/call on
// 2026-07-22: as Farmer (character 140000005, corp 98000001, ALLIANCE-LESS) the session
// forms returned the empty state (GetAlliance() -> null), and the populated shapes came
// from an explicit allianceID (Elysian 99000000) — the arg-injection probe that confirmed
// these reads expose only EVE-public alliance identity. FILETIMEs exceed 2^53 and are
// asserted to survive as raw decimal STRINGS.

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeAllianceInfo,
  decodeRankedAlliances,
  longToDecimalString,
} from "./allianceInfo.ts";
import type { JsonValue } from "./wire.ts";

// Elysian's REAL identity KeyVal (allianceID 99000000), verbatim from the capture.
const REAL_ELYSIAN_KEYVAL: JsonValue = {
  type: "object",
  name: "util.KeyVal",
  args: {
    type: "dict",
    entries: [
      ["allianceID", 99000000],
      ["allianceName", "Elysian"],
      ["shortName", "ELYSI"],
      ["executorCorpID", 98000000],
      ["creatorCorpID", 98000000],
      ["creatorCharID", 140000003],
      ["warFactionID", null],
      ["description", "Capsuleer alliance Elysian."],
      ["url", null],
      ["startDate", { type: "long", value: "134274243506850000" }],
      ["memberCount", 2],
      ["dictatorial", 0],
      ["allowWar", 1],
      ["currentCapital", null],
      ["currentPrimeHour", 2],
      ["newPrimeHour", 2],
      ["newPrimeHourValidAfter", { type: "long", value: "0" }],
      ["deleted", 0],
      ["__header__", [
        "allianceID", "allianceName", "shortName", "executorCorpID", "creatorCorpID",
        "creatorCharID", "warFactionID", "description", "url", "startDate", "memberCount",
        "dictatorial", "allowWar", "currentCapital", "currentPrimeHour", "newPrimeHour",
        "newPrimeHourValidAfter", "deleted",
      ]],
      ["currentCapitalSystem", null],
      ["newCapitalSystem", null],
      ["newCapitalSystemValidAfter", { type: "long", value: "0" }],
    ],
  },
};

// Elysian's REAL ranked-list util.Row (GetRankedAlliances([100])), verbatim.
const REAL_RANKED_LIST: JsonValue = {
  type: "list",
  items: [
    {
      type: "object",
      name: "util.Row",
      args: {
        type: "dict",
        entries: [
          ["header", { type: "list", items: [
            "allianceID", "allianceName", "shortName", "executorCorpID", "creatorCorpID",
            "creatorCharID", "warFactionID", "description", "url", "startDate", "memberCount",
            "dictatorial", "allowWar", "currentCapital", "currentPrimeHour", "newPrimeHour",
            "newPrimeHourValidAfter", "deleted",
          ] }],
          ["line", { type: "list", items: [
            99000000, "Elysian", "ELYSI", 98000000, 98000000, 140000003, null,
            "Capsuleer alliance Elysian.", null,
            { type: "long", value: "134274243506850000" },
            2, 0, 1, null, 2, 2, { type: "long", value: "0" }, 0,
          ] }],
        ],
      },
    },
  ],
};

test("decodeAllianceInfo reads the identity KeyVal, keeping the >2^53 FILETIME as a string", () => {
  const info = decodeAllianceInfo(REAL_ELYSIAN_KEYVAL);
  assert.ok(info);
  assert.equal(info.allianceID, 99000000);
  assert.equal(info.allianceName, "Elysian");
  assert.equal(info.shortName, "ELYSI");
  assert.equal(info.executorCorpID, 98000000);
  assert.equal(info.creatorCorpID, 98000000);
  assert.equal(info.creatorCharID, 140000003);
  assert.equal(info.warFactionID, null);
  assert.equal(info.description, "Capsuleer alliance Elysian.");
  assert.equal(info.url, null);
  // FILETIME kept exact — Number() would round the last digits.
  assert.equal(info.startDate, "134274243506850000");
  assert.equal(typeof info.startDate, "string");
  assert.equal(info.memberCount, 2);
  assert.equal(info.dictatorial, false);
  assert.equal(info.allowWar, true);
  assert.equal(info.deleted, false);
  assert.equal(info.currentPrimeHour, 2);
  assert.equal(info.newPrimeHour, 2);
  assert.equal(info.newPrimeHourValidAfter, "0");
  assert.equal(info.currentCapitalSystem, null);
  assert.equal(info.newCapitalSystem, null);
  assert.equal(info.newCapitalSystemValidAfter, "0");
});

test("decodeAllianceInfo returns null for the alliance-less-session answer (real null)", () => {
  assert.equal(decodeAllianceInfo(null), null);
  assert.equal(decodeAllianceInfo(undefined), null);
  // A non-KeyVal (e.g. a bare list) is not an alliance identity.
  assert.equal(decodeAllianceInfo({ type: "list", items: [] }), null);
});

test("decodeRankedAlliances reads the util.Row list into identity rows", () => {
  const rows = decodeRankedAlliances(REAL_RANKED_LIST);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.allianceID, 99000000);
  assert.equal(row.allianceName, "Elysian");
  assert.equal(row.shortName, "ELYSI");
  assert.equal(row.executorCorpID, 98000000);
  assert.equal(row.creatorCharID, 140000003);
  assert.equal(row.startDate, "134274243506850000");
  assert.equal(row.memberCount, 2);
  assert.equal(row.allowWar, true);
  assert.equal(row.dictatorial, false);
});

test("decodeRankedAlliances returns [] for a non-list / empty list", () => {
  assert.deepEqual(decodeRankedAlliances(null), []);
  assert.deepEqual(decodeRankedAlliances({ type: "list", items: [] }), []);
});

test("longToDecimalString keeps >2^53 values exact and rejects non-integers", () => {
  assert.equal(longToDecimalString({ type: "long", value: "134274243506850000" }), "134274243506850000");
  assert.equal(longToDecimalString(42), "42");
  assert.equal(longToDecimalString("99000000"), "99000000");
  assert.equal(longToDecimalString(null), null);
  assert.equal(longToDecimalString("not-a-number"), null);
  // A precision-lossy boundary value: the decoder must NOT route through Number()
  // (Number("…007") rounds to "…000"). Proves the raw wire string is preserved.
  assert.equal(longToDecimalString({ type: "long", value: "134274243506850007" }), "134274243506850007");
  assert.notEqual(String(Number("134274243506850007")), "134274243506850007");
});
