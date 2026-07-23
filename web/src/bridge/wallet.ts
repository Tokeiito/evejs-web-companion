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

import {
  isListValue,
  readDictEntry,
  readKeyVal,
  readRowField,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";
import { toAmountString } from "./rewards.ts";
import { unwrapCachedResult } from "./market.ts";
import type { CorpWalletDivision, LedgerEntry } from "../store/types.ts";

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

// --- R54 Wallet ledger (journal + transactions) -----------------------------
//
// Two calls, one row shape. account.GetJournal answers a util.Rowset — a
// header list + positional line lists (`buildJournalRowset`); account.
// GetTransactions answers a list<util.KeyVal> (`buildTransactionList`). Both
// carry the SAME twelve fields, so both decode through the shared `readRowField`
// (a journal line is adapted into a positional packedrow view first) into one
// LedgerEntry. Ref-types come from account.GetEntryTypes (a cached list), turned
// into a entryTypeID -> human label map.
//
// ⚠ Decode hazards this obeys (R32): the FILETIME `transactionDate` may arrive
// as a {type:"long"} wrapper OR a bare decimal string, and `amount` is ISK that
// can exceed 2^53 — both are kept bigint-safe, never pushed through Number.
// ⚠ R7d: the row's referenceID/ownerIDs and the server's free-text description
// (which embeds typeIDs/systemIDs) are NOT decoded, so no raw id can reach the
// panel; transactionID is kept only as a non-rendered list key.

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A FILETIME instant as a bigint. Tolerant of the {type:"long"} wrapper AND a
 * bare decimal string (R32: the gateway flattens some BigInts to plain strings);
 * null for absent or a zero sentinel.
 */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value)
      ? BigInt(value)
      : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/**
 * transactionID as a bigint-safe decimal string — a STABLE LIST KEY, never
 * rendered (R7d). Accepts a {type:"long"}, a bare integer, or a decimal string;
 * "0" when absent (a keyless row still renders, just without a stable identity).
 */
function toIdString(value: JsonValue | undefined): string {
  const long = unwrapLong(value);
  if (long !== null) {
    return long.toString();
  }
  return typeof value === "string" && /^-?\d+$/.test(value) ? value : "0";
}

/**
 * Split a retail ref-type CODE ("MarketTransaction", "GMCashTransfer") into
 * plain words ("Market Transaction", "GM Cash Transfer") — R9a. Handles the
 * lower->Upper boundary and the ACRONYM->Word boundary.
 */
function humanizeRefType(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/**
 * account.GetEntryTypes -> a entryTypeID -> human ref-type label map. The result
 * is a cached envelope wrapping a list<KeyVal{entryTypeID, entryTypeName, …}>.
 * An unreadable/empty map is a legitimate (if degraded) state — the ledger then
 * labels rows "Other", never a raw code.
 */
export function decodeEntryTypeLabels(result: JsonValue): Map<number, string> {
  const labels = new Map<number, string>();
  const list = unwrapCachedResult(result);
  if (!isListValue(list)) {
    return labels;
  }
  for (const row of list.items) {
    const id = Number(readRowField(row, "entryTypeID") ?? NaN);
    const name = readRowField(row, "entryTypeName");
    if (Number.isInteger(id) && typeof name === "string" && name.trim() !== "") {
      labels.set(id, humanizeRefType(name));
    }
  }
  return labels;
}

/** Decode ONE ledger row (journal packedrow view OR transactions KeyVal). */
function decodeLedgerRow(
  row: JsonValue,
  labels: ReadonlyMap<number, string>,
): LedgerEntry {
  const entryTypeID = Number(readRowField(row, "entryTypeID") ?? NaN);
  const label = Number.isInteger(entryTypeID) ? labels.get(entryTypeID) : undefined;
  return {
    id: toIdString(readRowField(row, "transactionID")),
    date: toFiletime(readRowField(row, "transactionDate")),
    amount: toAmountString(readRowField(row, "amount")) ?? "0",
    refType: label ?? "Other",
  };
}

/**
 * Decode account.GetJournal — a util.Rowset. Each positional line is aligned to
 * the header and adapted into a packedrow view so the shared `readRowField`
 * reads it by name. Returns [] for a well-formed empty Rowset (a real "no
 * journal entries yet"); the FLOW tells that apart from a FAILED read.
 */
export function decodeJournal(
  result: JsonValue,
  labels: ReadonlyMap<number, string>,
): LedgerEntry[] {
  if (!isRecord(result) || result.type !== "object") {
    return [];
  }
  const args = result.args ?? null;
  const headerValue = readDictEntry(args, "header");
  const linesValue = readDictEntry(args, "lines");
  const header = isListValue(headerValue)
    ? headerValue.items.map((column) => String(column))
    : [];
  const lines = isListValue(linesValue) ? linesValue.items : [];
  if (header.length === 0) {
    return [];
  }
  return lines.map((line) => {
    const values = isListValue(line) ? line.items : Array.isArray(line) ? line : [];
    const packed: JsonValue = { type: "packedrow", columns: header, values };
    return decodeLedgerRow(packed, labels);
  });
}

/**
 * Decode account.GetTransactions — a list<util.KeyVal> (each row read directly
 * by `readRowField`). [] is a real "no transactions yet".
 */
export function decodeTransactions(
  result: JsonValue,
  labels: ReadonlyMap<number, string>,
): LedgerEntry[] {
  if (!isListValue(result)) {
    return [];
  }
  return result.items.map((row) => decodeLedgerRow(row, labels));
}

// --- R89 account financial write acks ---------------------------------------
//
// FAST-MODE educated-guess decoders for the confirm-gated account WRITES
// (SetContactCost / GiveCash / GiveCashFromCorpAccount). SetContactCost and a
// GiveCash to a CHARACTER return null server-side; a GiveCash to a CORPORATION
// answers a [fromBalance, toBalance] pair (surfaced via `result`). ⚠ GiveCash /
// GiveCashFromCorpAccount TRANSFER ISK and are NEVER fired live in the plumbing
// pass — these acks are educated guesses from the client + server code, not
// captured bytes; the funding source is always session-scoped (see server.js).

/** The uniform ack every confirm-gated account write returns. */
export interface AccountWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
}

function accountAckTruthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** Decode a plain account write ack (set-contact-cost / give-cash to a char / corp transfer). */
export function decodeAccountWriteAck(response: JsonValue): AccountWriteAck {
  return {
    ok: accountAckTruthy(readKeyVal(response, "ok")),
    applied: accountAckTruthy(readKeyVal(response, "applied")),
  };
}

/** A GiveCash-to-corp ack: `applied` plus the [from, to] wallet balances (null when a char transfer / declined). */
export interface GiveCashBalancesAck extends AccountWriteAck {
  readonly fromBalance: number | null;
  readonly toBalance: number | null;
}

export function decodeGiveCashAck(response: JsonValue): GiveCashBalancesAck {
  const result = readKeyVal(response, "result");
  const pair = isListValue(result) ? result.items : Array.isArray(result) ? result : [];
  const toBalanceNumber = (value: JsonValue | undefined): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    ok: accountAckTruthy(readKeyVal(response, "ok")),
    applied: accountAckTruthy(readKeyVal(response, "applied")),
    fromBalance: pair.length > 0 ? toBalanceNumber(pair[0] as JsonValue) : null,
    toBalance: pair.length > 1 ? toBalanceNumber(pair[1] as JsonValue) : null,
  };
}
