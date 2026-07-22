// LP store reads decoded to plain rows (goal R57, PLUMBING ONLY — no UI).
//
// GET /api/bridge/lp returns three raw retail-shaped LPSvc results, captured live
// from Farmer (character 140000005) on 2026-07-22:
//
//   • balances  = LPSvc.GetLPsForCharacter -> {type:"list", items:[{type:"list",
//     items:[issuerCorpID, loyaltyPoints]}, …]}. Farmer had three issuers, so
//     this is a POPULATED capture: [1000002, 213], [1000033, 1500],
//     [1000035, 100067000]. This is the same data as R6's
//     GetAllMyCharacterWalletLPBalances (the /rewards CRowset) but in the retail
//     LP-store LIST-of-pairs shape.
//   • exchangeRates = LPSvc.GetLPExchangeRates -> {type:"list", items:[]}
//   • offers        = LPSvc.GetAvailableOffersFromCorp -> {type:"list", items:[]}
//
// ⚠ exchangeRates and offers are EMPTY-BY-DESIGN in this world — the handlers
// return buildList([]) with no seed data. An empty list is a legitimate "no rates
// / no offers yet" state, NOT a bridge bug. Their populated row shape is therefore
// unknown (nothing has ever produced one), so their decoders preserve the raw
// items without guessing a schema — the plumbing is here for when data lands.
//
// R7d: issuerCorpID is an entity id kept as a numeric field for a future UI to
// resolve to a corporation name; loyaltyPoints is kept as a bigint-safe decimal
// string (never zeroed by a `typeof === "number"` test).

import { isListValue, unwrapLong, type JsonValue } from "./wire.ts";
import { toAmountString } from "./rewards.ts";

/** One issuer's LP balance for this character. */
export interface LoyaltyPointBalance {
  readonly issuerCorpID: number;
  readonly loyaltyPoints: string;
}

/** The items of a marshaled list wrapper, or a bare array; [] otherwise. */
function listItems(value: JsonValue | undefined): readonly JsonValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isListValue(value)) {
    return value.items;
  }
  return [];
}

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
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

/**
 * Decode LPSvc.GetLPsForCharacter — a list of [issuerCorpID, loyaltyPoints]
 * pairs. A malformed pair (no positive issuerCorpID) is dropped; `[]` is a real
 * "no loyalty points" answer.
 */
export function decodeCharacterLoyaltyPoints(result: JsonValue): LoyaltyPointBalance[] {
  const rows: LoyaltyPointBalance[] = [];
  for (const pair of listItems(result)) {
    const fields = listItems(pair);
    const issuerCorpID = toNumber(fields[0]);
    if (issuerCorpID <= 0) {
      continue;
    }
    rows.push({
      issuerCorpID,
      loyaltyPoints: toAmountString(fields[1]) ?? "0",
    });
  }
  return rows;
}

/**
 * Decode LPSvc.GetLPExchangeRates — EMPTY-BY-DESIGN in this world. Returns the
 * raw list items so no data is lost when the handler eventually produces some;
 * the populated shape is not yet known, so no schema is imposed here. Today this
 * always returns [].
 */
export function decodeLpExchangeRates(result: JsonValue): readonly JsonValue[] {
  return listItems(result);
}

/**
 * Decode LPSvc.GetAvailableOffersFromCorp — EMPTY-BY-DESIGN in this world, same
 * treatment as decodeLpExchangeRates. Today this always returns [].
 */
export function decodeLpOffers(result: JsonValue): readonly JsonValue[] {
  return listItems(result);
}
