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

import { decodeFittings } from "./fittings.ts";
import { unwrapCachedResult } from "./market.ts";
import { type JsonValue } from "./wire.ts";

export type { SavedFitting } from "./fittings.ts";

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
