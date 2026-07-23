// R82 corpRegistry name-suggestion decoders against REAL captured shapes (Farmer, 2026-07-22).

import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeSuggestedTickerNames,
  decodeSuggestedAllianceShortNames,
} from "./corpNameSuggestions.ts";
import type { JsonValue } from "./wire.ts";

function keyVal(field: string, value: string): JsonValue {
  return {
    type: "object",
    name: "util.KeyVal",
    args: { type: "dict", entries: [[field, value]] },
  } as unknown as JsonValue;
}
function suggestionList(items: readonly JsonValue[]): JsonValue {
  return { type: "list", items: [...items] } as unknown as JsonValue;
}

test("GetSuggestedTickerNames extracts the tickerName strings (captured: one random ticker)", () => {
  const names = decodeSuggestedTickerNames(suggestionList([keyVal("tickerName", "WGGL")]));
  assert.deepEqual(names, ["WGGL"]);
});

test("GetSuggestedAllianceShortNames extracts shortName variants (captured: 'Test Alliance')", () => {
  const names = decodeSuggestedAllianceShortNames(
    suggestionList([
      keyVal("shortName", "TESTA"),
      keyVal("shortName", "TEST"),
      keyVal("shortName", "TESX"),
    ]),
  );
  assert.deepEqual(names, ["TESTA", "TEST", "TESX"]);
});

test("GetSuggestedAllianceShortNames decodes the no-arg fallback captured live (ALLY/ALLX)", () => {
  const names = decodeSuggestedAllianceShortNames(
    suggestionList([keyVal("shortName", "ALLY"), keyVal("shortName", "ALLX")]),
  );
  assert.deepEqual(names, ["ALLY", "ALLX"]);
});

test("name suggestions return [] for an empty/malformed list", () => {
  assert.deepEqual(decodeSuggestedTickerNames(suggestionList([])), []);
  assert.deepEqual(decodeSuggestedTickerNames(null), []);
  assert.deepEqual(decodeSuggestedAllianceShortNames(null), []);
});
