// R82 corpRegistry settings decoders against REAL captured shapes (Farmer corp 98000001,
// 2026-07-22, via /api/bridge/call).

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeCorpAggressionSettings,
  decodeStructureReinforceDefault,
  decodeCorpFlag,
} from "./corpSettings.ts";
import type { JsonValue } from "./wire.ts";

// GetAggressionSettings — captured verbatim.
const AGGRESSION: JsonValue = {
  type: "object",
  name: "crimewatch.corp_aggression.settings.AggressionSettings",
  args: {
    type: "dict",
    entries: [
      ["_enableAfter", { type: "long", value: "0" }],
      ["_disableAfter", { type: "long", value: "134276026827950000" }],
    ],
  },
} as unknown as JsonValue;

test("GetAggressionSettings decodes the two friendly-fire FILETIME longs as strings", () => {
  const settings = decodeCorpAggressionSettings(AGGRESSION);
  assert.deepEqual(settings, {
    enableAfter: "0",
    disableAfter: "134276026827950000",
  });
});

test("GetAggressionSettings keeps a FILETIME that exceeds 2^53 exact", () => {
  const big = "134276026827950001";
  const bumped: JsonValue = {
    type: "object",
    name: "crimewatch.corp_aggression.settings.AggressionSettings",
    args: { type: "dict", entries: [["_enableAfter", { type: "long", value: "0" }], ["_disableAfter", { type: "long", value: big }]] },
  } as unknown as JsonValue;
  assert.equal(decodeCorpAggressionSettings(bumped).disableAfter, big);
});

test("GetAggressionSettings tolerates a null/absent result", () => {
  assert.deepEqual(decodeCorpAggressionSettings(null), { enableAfter: null, disableAfter: null });
});

test("GetStructureReinforceDefault decodes [weekday, hour] captured live as [255, 20]", () => {
  assert.deepEqual(decodeStructureReinforceDefault([255, 20]), {
    reinforceWeekday: 255,
    reinforceHour: 20,
  });
});

test("GetStructureReinforceDefault defaults sanely on a malformed array", () => {
  assert.deepEqual(decodeStructureReinforceDefault(null), { reinforceWeekday: 255, reinforceHour: 0 });
});

test("DoesMyCorpAcceptStructures / DoesCorpRestrictCorpMails decode the 0/1 flag", () => {
  // Captured live: both 0 for Farmer's corp.
  assert.equal(decodeCorpFlag(0), false);
  assert.equal(decodeCorpFlag(1), true);
  assert.equal(decodeCorpFlag(null), false);
});
