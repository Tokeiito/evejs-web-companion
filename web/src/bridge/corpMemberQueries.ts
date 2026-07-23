// R81 — decoding the corpRegistry MEMBER-ID QUERY reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-membership-queries returns the raw retail-shaped corpRegistry
// results, captured live from Farmer (corp 98000001) on 2026-07-22. Every handler
// resolves its corp from the SESSION (resolveCorporationID); args cannot redirect the
// corp, and corpRegistry.MachoBindObject is NOT allowlisted — so all four are session-
// corp-scoped.
//
// FOUR reads decode here — each a plain {type:"list"} of characterIDs (verified):
//   • GetMemberIDsByQuery([])               -> the session corp's member characterIDs
//     (an empty query = ALL members).
//   • GetMemberIDsWithMoreThanAvgShares()   -> members above the corp share average.
//   • GetNumberOfPotentialCEOs()            -> member ids eligible to become CEO.
//   • GetPendingAutoKicks()                 -> the pending auto-kick queue (raw entries;
//     empty for a healthy corp — Farmer's is empty live).
//
// ⚠ VALUE ENCODING: the three member-id lists are built from member.characterID (plain
// ints). Ids stay data (R7d) — never forced into a label. The auto-kick entries are
// passed through untouched (their populated shape is not seeded in this world).

import { isListValue, type JsonValue } from "./wire.ts";

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The items of a {type:"list"} wrapper, or `[]`. */
function listItems(value: JsonValue | null | undefined): readonly JsonValue[] {
  return isListValue(value) ? value.items : [];
}

function toNumOrNull(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (isRecord(value) && value.type === "long") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "number") return inner;
    if (typeof inner === "string" && /^-?\d+$/.test(inner)) return Number(inner);
  }
  return null;
}

/**
 * Decode a corpRegistry member-id list (GetMemberIDsByQuery /
 * GetMemberIDsWithMoreThanAvgShares / GetNumberOfPotentialCEOs) -> the characterIDs, in
 * wire order. Non-numeric entries are dropped. `[]` is a real "no matching members"
 * answer.
 */
export function decodeCorpMemberIdList(
  result: JsonValue | null | undefined,
): number[] {
  const ids: number[] = [];
  for (const item of listItems(result)) {
    const id = toNumOrNull(item);
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Decode corpRegistry.GetPendingAutoKicks -> the raw pending auto-kick entries, in wire
 * order. `[]` is a real "no pending kicks" answer (Farmer's corp is empty live); the
 * entry shape is passed through untouched because no populated queue is seeded here.
 */
export function decodeCorpPendingAutoKicks(
  result: JsonValue | null | undefined,
): readonly JsonValue[] {
  return listItems(result);
}
