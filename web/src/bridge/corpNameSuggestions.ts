// R82 — decoding the corpRegistry NAME-SUGGESTION reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-name-suggestions carries two PUBLIC generators — neither handler
// takes a session or reads corp/char data, so there is nothing to own or leak. Captured
// live from Farmer on 2026-07-22.
//
// WIRE SHAPES (verified against bytes): both return a {type:"list"} of util.KeyVal rows.
//   • GetSuggestedTickerNames        -> [KeyVal{tickerName:"WGGL"}] (a RANDOM 4-letter
//     ticker — the value differs per call; the decoder extracts whatever strings arrive).
//   • GetSuggestedAllianceShortNames([name]) -> KeyVal{shortName} variants of a caller-
//     supplied base name: no arg -> ["ALLY","ALLX"]; "Test Alliance" -> ["TESTA","TEST","TESX"].

import { isListValue, readKeyVal, type JsonValue } from "./wire.ts";

function suggestionStrings(result: JsonValue | null | undefined, field: string): string[] {
  if (!isListValue(result)) {
    return [];
  }
  const out: string[] = [];
  for (const item of result.items) {
    const value = readKeyVal(item, field);
    if (typeof value === "string") {
      out.push(value);
    }
  }
  return out;
}

/**
 * Decode corpRegistry.GetSuggestedTickerNames -> the suggested corp ticker strings.
 * `[]` when the list is empty/malformed. (The values are randomly generated server-side.)
 */
export function decodeSuggestedTickerNames(
  result: JsonValue | null | undefined,
): string[] {
  return suggestionStrings(result, "tickerName");
}

/**
 * Decode corpRegistry.GetSuggestedAllianceShortNames -> the suggested alliance short-name
 * strings (derived from the caller-supplied base name). `[]` when empty/malformed.
 */
export function decodeSuggestedAllianceShortNames(
  result: JsonValue | null | undefined,
): string[] {
  return suggestionStrings(result, "shortName");
}
