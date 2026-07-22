// Wallet + Corp Wallet reads decoded to plain rows (goal R50).
//
// GET /api/bridge/wallet returns three raw retail-shaped reads: the personal
// balance (account.GetCashBalance), the corporation division balances
// (account.GetWalletDivisionsInfo) and — decoded server-side — the division
// NAMES (corpRegistry.GetCorporation). This module turns the two raw AMOUNTS
// into bigint-safe decimal strings; names arrive already resolved.
//
// Decoder rule (docs/bridge-wire-contract.md): amounts are decoded long-aware
// and kept as bigint-safe decimal strings, never pushed through Number (which
// would zero a {type:"long"} value and round a big balance). ISK amounts can
// exceed 2^53, so they stay strings all the way to the panel's formatter.

import { isListValue, readRowField, type JsonValue } from "./wire.ts";
import { toAmountString } from "./rewards.ts";
import type { CorpWalletDivision } from "../store/types.ts";

// The retail account key of the first corporation wallet division (the "Master
// Wallet"). Keys run 1000..1006 for divisions 1..7. Never rendered — mapped to
// its 1..7 ordinal for the label.
const CORP_WALLET_KEY_START = 1000;

/** Personal ISK balance: a plain number or long wrapper; null when absent. */
export function decodeCashBalance(result: JsonValue): string | null {
  return toAmountString(result);
}

/**
 * Decode account.GetWalletDivisionsInfo: a {type:"list"} of util.KeyVal rows
 * `{key, balance}` (server helper `buildList`/`buildKeyVal`). Each key is a
 * corp account key (1000..1006); balances are kept as bigint-safe decimal
 * strings and a row whose balance is absent decodes to "0" (a real zero
 * balance), never dropped. `names` maps the 1..7 division ordinal to the
 * player-authored name (from the BFF's server-side GetCorporation decode).
 *
 * ⚠ Returns [] for a well-formed but empty list — a real "no corp wallet
 * divisions" answer. The flow distinguishes that from a FAILED read (which is
 * carried as an error and leaves corpDivisions null), so the two never look
 * alike (worldHasNoContracts precedent).
 */
export function decodeCorpDivisions(
  result: JsonValue,
  names: Readonly<Record<number, string | null>> = {},
): CorpWalletDivision[] {
  if (!isListValue(result)) {
    return [];
  }
  const rows: CorpWalletDivision[] = [];
  for (const item of result.items) {
    const key = Number(readRowField(item, "key") ?? 0);
    if (!Number.isInteger(key) || key < CORP_WALLET_KEY_START) {
      continue;
    }
    const division = key - CORP_WALLET_KEY_START + 1;
    const balance = toAmountString(readRowField(item, "balance")) ?? "0";
    const name = names[division];
    rows.push({
      key,
      division,
      name: typeof name === "string" && name.trim() !== "" ? name : null,
      balance,
    });
  }
  return rows;
}

/** The BFF's division-name map is keyed by 1..7 ordinal; tolerate string keys. */
export function normalizeDivisionNames(
  value: JsonValue,
): Record<number, string | null> {
  const names: Record<number, string | null> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return names;
  }
  for (const [key, name] of Object.entries(value as Record<string, JsonValue>)) {
    const division = Number(key);
    if (Number.isInteger(division)) {
      names[division] = typeof name === "string" ? name : null;
    }
  }
  return names;
}
