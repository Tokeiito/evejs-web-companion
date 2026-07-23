// R83 — decoding the allianceRegistry GetRelationships read (PLUMBING ONLY — no UI).
// Captured live on 2026-07-22. SESSION-ALLIANCE-SCOPED: the handler resolves the alliance
// from the SESSION only (resolveAllianceIDFromSession) and IGNORES args, so a browser can
// only ever read its OWN alliance's standings — an injected allianceID is dropped
// (verified live: as Farmer, GetRelationships([99000000]) returned Farmer's own — empty —
// standings, not Elysian's). Empty {} is a real answer for an alliance-less session
// (Farmer) and for an alliance that seeds no standings (Elysian — verified as Test Two).
//
//   • GetRelationships() -> a bare marshaled dict {ownerID -> relationship}. Owner ids
//     stay as data (R7d); the relationship value is kept as a number (standings/relation
//     code, float-tolerant).

import { readDictPairs, type JsonValue } from "./wire.ts";
import { toNumOrNull } from "./allianceInfo.ts";

/** One alliance standing/relationship entry (GetRelationships). */
export interface AllianceRelationship {
  readonly ownerID: number | null;
  /** Standing / relationship value — number (float-tolerant); null when unreadable. */
  readonly relationship: number | null;
}

/**
 * Decode allianceRegistry.GetRelationships -> the session alliance's standings, in wire
 * order. `[]` is a real "no standings / alliance-less session" answer. The dict KEY is
 * the ownerID (a numeric id on the wire), the value the relationship.
 */
export function decodeAllianceRelationships(
  result: JsonValue | null | undefined,
): AllianceRelationship[] {
  const entries: AllianceRelationship[] = [];
  for (const [key, value] of readDictPairs(result)) {
    entries.push({
      ownerID: toNumOrNull(key as JsonValue),
      relationship: toNumOrNull(value),
    });
  }
  return entries;
}
