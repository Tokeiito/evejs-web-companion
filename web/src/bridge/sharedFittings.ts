// Corp / alliance / community saved-fitting libraries decoded to plain rows
// (goal R65, PLUMBING ONLY — no UI).
//
// GET /api/bridge/shared-fittings batches three reads that sit beside R57's
// CHARACTER fitting library (charFittingMgr.GetFittings):
//   • corpFittingMgr.GetFittings         — the SESSION corp's saved fits.
//   • corpFittingMgr.GetCommunityFittings — the PUBLIC community library.
//   • allianceFittingMgr.GetFittings     — the SESSION alliance's saved fits.
//
// All three call the SAME server builder (getOwnerFittingsResponse ->
// buildFittingPayload), so a fitting ROW is identical across char/corp/alliance
// and R57's decodeFittings decodes it. What differs is the ENVELOPE (verified live
// 2026-07-22 from Farmer): the two corpFittingMgr reads WRAP the dict in a retail
// CachedMethodCallResult (payload on args[1] as a substream), while
// allianceFittingMgr returns the RAW dict, like the char manager. unwrapCached
// Result (market.ts) peels the cache wrapper; a non-cached value passes through
// unchanged, so the corp decoder is safe even if a future build stops wrapping.
//
// R7d is inherited from decodeFittings: shipTypeID / module typeIDs / flagID /
// ownerID stay numeric fields. An empty library is a REAL "no shared fits" answer.

import { decodeFittings, type SavedFitting } from "./fittings.ts";
import { unwrapCachedResult } from "./market.ts";
import { type JsonValue } from "./wire.ts";

export type { SavedFitting } from "./fittings.ts";

/** Which library a fitting the refit block can apply came from. */
export type FittingSource = "personal" | "corporation";

/** A saved fitting tagged with the library it was read from. */
export interface SourcedFitting extends SavedFitting {
  readonly source: FittingSource;
}

/**
 * The library the refit block picks from: the character's own fits, then the
 * session corp's. Personal comes first so a name both libraries use resolves
 * to the pilot's own fit, as it did before corp fits were offered. The server
 * draws every owner's fittingID from one counter, so an id seen twice is the
 * same row and is kept once.
 */
export function refitLibrary(personal: readonly SavedFitting[], corporation: readonly SavedFitting[]): readonly SourcedFitting[] {
  const seen = new Set<number>();
  const out: SourcedFitting[] = [];
  for (const [rows, source] of [[personal, "personal"], [corporation, "corporation"]] as const) {
    for (const row of rows) {
      if (seen.has(row.fittingID)) continue;
      seen.add(row.fittingID);
      out.push({ ...row, source });
    }
  }
  return out;
}

/** Decode corpFittingMgr.GetFittings (a CachedMethodCallResult wrapping the dict). */
export function decodeCorpFittings(result: JsonValue): ReturnType<typeof decodeFittings> {
  return decodeFittings(unwrapCachedResult(result));
}

/** Decode corpFittingMgr.GetCommunityFittings (same cache-wrapped dict shape). */
export function decodeCommunityFittings(result: JsonValue): ReturnType<typeof decodeFittings> {
  return decodeFittings(unwrapCachedResult(result));
}

/** Decode allianceFittingMgr.GetFittings (a RAW dict, no cache wrapper). */
export function decodeAllianceFittings(result: JsonValue): ReturnType<typeof decodeFittings> {
  return decodeFittings(result);
}
