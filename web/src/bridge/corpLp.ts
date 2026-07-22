// R61 — decoding the CORP LP reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-lp returns two raw retail-shaped results, captured live
// from Farmer (corp 98000001) on 2026-07-22:
//
//   • balances = LPSvc.GetAllMyCorporationWalletLPBalances -> a CRowset
//     [issuerCorpID, loyaltyPoints]. EMPTY for Farmer's corp (no corp LP) — a
//     legitimate empty state, not a bug. ⚠ The CRowset shape is IDENTICAL to R6's
//     GetAllMyCharacterWalletLPBalances (both call buildWalletBalanceRowset), so
//     the corp balances REUSE the proven decodeLpBalances decoder rather than a
//     hand-rolled copy.
//   • offers   = LPStoreMgr.GetAvailableOffersFromCorp -> a {type:"list"} of offer
//     util.KeyVals {typeID, iskCost, akCost, reqItems, offerID, qty,
//     requiredStandings, corpID, lootItems, lpCost}. Farmer's read is the Heraldry
//     emblem store: 818 offers, every one LP-only (iskCost 0, empty reqItems /
//     lootItems, requiredStandings null). reqItems / lootItems are lists of
//     [typeID, quantity] pairs (empty in the live capture; decoded here so the
//     pair path is ready when a non-emblem corp store lands).
//
// R7d: issuerCorpID / offer typeID / corpID survive as numeric fields for a future
// UI to resolve; LP and ISK costs are kept as bigint-safe decimal strings (never
// zeroed by a `typeof === "number"` test).

import { isListValue, readKeyVal, unwrapLong, type JsonValue } from "./wire.ts";
import { decodeLpBalances, toAmountString } from "./rewards.ts";
import type { WalletLPBalance } from "../store/types.ts";

export interface LpRequirement {
  readonly typeID: number;
  readonly quantity: number;
}

export interface CorpLpOffer {
  readonly offerID: number;
  readonly typeID: number;
  readonly qty: number;
  /** LP price — bigint-safe decimal string. */
  readonly lpCost: string;
  /** ISK price — bigint-safe decimal string. */
  readonly iskCost: string;
  /** Analysis-kredit price — bigint-safe decimal string. */
  readonly akCost: string;
  readonly corpID: number;
  /** A required standing (a float) or null when the offer has none. */
  readonly requiredStandings: number | null;
  readonly reqItems: LpRequirement[];
  readonly lootItems: LpRequirement[];
}

/**
 * Decode LPSvc.GetAllMyCorporationWalletLPBalances -> the corp's per-issuer LP.
 * The CRowset shape is the R6 character-balances shape, so this delegates to the
 * shared decodeLpBalances. `[]` is a real "no corp LP" answer.
 */
export function decodeCorpLoyaltyPoints(result: JsonValue): WalletLPBalance[] {
  return decodeLpBalances(result);
}

function toInt(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

/** A required standing float, or null when the field is absent/null. */
function toOptionalFloat(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return Number(long);
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return null;
}

/** Decode a requirement/loot list -> [{typeID, quantity}]. Each pair is a [typeID, qty] list. */
function decodeRequirementPairs(value: JsonValue | undefined): LpRequirement[] {
  if (!isListValue(value)) {
    return [];
  }
  const pairs: LpRequirement[] = [];
  for (const pair of value.items) {
    const cells = isListValue(pair) ? pair.items : Array.isArray(pair) ? pair : [];
    const typeID = toInt(cells[0] as JsonValue);
    const quantity = toInt(cells[1] as JsonValue);
    if (typeID > 0) {
      pairs.push({ typeID, quantity });
    }
  }
  return pairs;
}

/**
 * Decode LPStoreMgr.GetAvailableOffersFromCorp -> the LP-store offers. A row with
 * no positive offerID is dropped. `[]` is a real "no offers" answer. typeIDs stay
 * data (R7d); costs stay bigint-safe strings.
 */
export function decodeCorpLpOffers(
  result: JsonValue | null | undefined,
): CorpLpOffer[] {
  if (!isListValue(result ?? null)) {
    return [];
  }
  const offers: CorpLpOffer[] = [];
  for (const row of (result as { items: readonly JsonValue[] }).items) {
    const offerID = toInt(readKeyVal(row, "offerID"));
    if (offerID <= 0) {
      continue;
    }
    offers.push({
      offerID,
      typeID: toInt(readKeyVal(row, "typeID")),
      qty: toInt(readKeyVal(row, "qty")),
      lpCost: toAmountString(readKeyVal(row, "lpCost")) ?? "0",
      iskCost: toAmountString(readKeyVal(row, "iskCost")) ?? "0",
      akCost: toAmountString(readKeyVal(row, "akCost")) ?? "0",
      corpID: toInt(readKeyVal(row, "corpID")),
      requiredStandings: toOptionalFloat(readKeyVal(row, "requiredStandings")),
      reqItems: decodeRequirementPairs(readKeyVal(row, "reqItems")),
      lootItems: decodeRequirementPairs(readKeyVal(row, "lootItems")),
    });
  }
  return offers;
}
