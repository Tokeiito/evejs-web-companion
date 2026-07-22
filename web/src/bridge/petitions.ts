// Decoding the petitioner (support) reads (goal R70, PLUMBING ONLY — no UI).
//
// GET /api/bridge/petitions returns the raw retail-shaped results of eight
// TOP-LEVEL petitioner reads. petitioner is a STUB support service in this world
// (server/src/services/support/petitionerService.js): every read answers
// constant/empty data with NO per-entity store lookup, so a foreign petitionID
// yields the SAME empty list — there is no cross-ticket access to decode against.
// Each shape below was read from the handler and pinned against the LIVE capture
// (Farmer 140000005, through the BFF, 2026-07-22):
//
//   GetMyPetitionsEx()             -> {type:"list", items:[]} (own tickets; empty).
//   GetCategories()                -> {type:"list", items:[]} (category taxonomy).
//   GetCategoryHierarchicalInfo()  -> a 4-TUPLE of empty {type:"dict"} — a bare JS
//                                     array [dict, dict, dict, dict].
//   GetPetitionMessages(petitionID)-> {type:"list", items:[]} (own ticket messages;
//                                     a foreign petitionID returns the SAME empty
//                                     list — no cross-ticket access).
//   MayPetition(cat, oocChar)      -> a BARE INT (-4 = petitioning disabled).
//   IsZendeskEnabled()             -> a BARE BOOLEAN (true).
//   GetZendeskJwtLink()            -> a BARE STRING support link. ⚠ CREDENTIAL: the
//                                     decoder passes it through UNTOUCHED and NEVER
//                                     logs it. (In this world it is a public help-
//                                     center URL, not a signed JWT, and carries no
//                                     session secret — but it is handled token-safe
//                                     so a real signed link would be safe too.)
//   GetUnreadMessages()            -> {type:"list", items:[]} (own unread; empty).
//
// The list/dict rows are returned as their raw wire items so a future UI has the
// data the moment the support surface is populated; nothing here forces an id
// into a label (R7d).

import { isListValue, readDictPairs, type DictEntry, type JsonValue } from "./wire.ts";

/** The rows of a marshaled {type:"list", items:[…]}; [] otherwise. */
function listItems(result: JsonValue | null | undefined): readonly JsonValue[] {
  return isListValue(result) ? result.items : [];
}

/**
 * Decode petitioner.GetMyPetitionsEx -> the session's own petitions. Empty is a
 * REAL "no petitions filed" answer (Farmer). The raw rows are returned for a
 * future UI.
 */
export function decodeMyPetitions(
  result: JsonValue | null | undefined,
): readonly JsonValue[] {
  return listItems(result);
}

/** Decode petitioner.GetCategories -> the petition categories (empty here). */
export function decodeCategories(
  result: JsonValue | null | undefined,
): readonly JsonValue[] {
  return listItems(result);
}

/**
 * Decode petitioner.GetCategoryHierarchicalInfo -> the four hierarchy dicts, each
 * as its raw [key, value] pairs. All four are empty in this world; a decoder that
 * assumed a single dict (not a 4-tuple) would silently drop them, so the shape is
 * pinned as an array of exactly four entry-lists.
 */
export function decodeCategoryHierarchicalInfo(
  result: JsonValue | null | undefined,
): readonly (readonly DictEntry[])[] {
  if (!Array.isArray(result)) {
    return [];
  }
  return result.map((entry) => readDictPairs(entry));
}

/**
 * Decode petitioner.GetPetitionMessages -> one ticket's messages. Empty for any
 * petitionID in this world (a foreign id returns the same empty list — no
 * cross-ticket access). The raw rows are returned for a future UI.
 */
export function decodePetitionMessages(
  result: JsonValue | null | undefined,
): readonly JsonValue[] {
  return listItems(result);
}

/**
 * Decode petitioner.MayPetition -> the may-petition code. A bare int: >= 0 means
 * petitioning is allowed; a negative code (−4 in this world) is a rejection
 * reason. null when the value was not a number (an absent / failed read).
 */
export function decodeMayPetition(
  result: JsonValue | null | undefined,
): number | null {
  return typeof result === "number" && Number.isFinite(result) ? Math.trunc(result) : null;
}

/** Whether a MayPetition code means the character may file a petition (>= 0). */
export function isPetitionAllowed(code: number | null): boolean {
  return code !== null && code >= 0;
}

/**
 * Decode petitioner.IsZendeskEnabled -> whether the Zendesk help desk is enabled.
 * A bare boolean on the wire; false when the value was not a boolean.
 */
export function decodeZendeskEnabled(result: JsonValue | null | undefined): boolean {
  return result === true;
}

/**
 * Decode petitioner.GetZendeskJwtLink -> the support link.
 *
 * ⚠ CREDENTIAL: this value is treated as a secret token. It is passed through
 * verbatim and MUST NEVER be logged, parsed, cached across sessions, or embedded
 * in a URL/query by any caller. This decoder does exactly one thing — return the
 * string unchanged — and deliberately performs no logging. null when the value
 * was not a string (an absent / failed read).
 */
export function decodeZendeskJwtLink(
  result: JsonValue | null | undefined,
): string | null {
  return typeof result === "string" ? result : null;
}

/**
 * Decode petitioner.GetUnreadMessages -> the session's own unread support
 * messages. Empty is a REAL "nothing unread" answer (Farmer). The raw rows are
 * returned for a future UI.
 */
export function decodeUnreadMessages(
  result: JsonValue | null | undefined,
): readonly JsonValue[] {
  return listItems(result);
}
