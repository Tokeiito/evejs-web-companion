// R84 — decoding the allianceRegistry FINANCIAL reads (bills / bill balance; PLUMBING
// ONLY — no UI). Captured live on 2026-07-22. Both reads are STRICTLY SESSION-SCOPED
// and ignore args: GetBills resolves the alliance from the session, GetBillBalance the
// corp + account key from the session. Verified live that a foreign allianceID injected
// by an alliance-less caller (Farmer) returns his OWN state (empty bills; his own corp's
// balance 80000, NOT the injected corp's) — no foreign alliance's financials leak.
//
// As Test Two (a member of Elysian 99000000) the alliance carries no bills, so the LIVE
// GetBills shape is the empty list and the LIVE GetBillBalance is 0; Farmer's LIVE
// GetBillBalance is 80000. The populated bill fixture in the test mirrors the server
// builder (buildBillPayload) exactly — noted plainly.
//
//   • GetBills -> a list of util.KeyVal bill rows (billID / billTypeID / amount /
//       interest / debtorID / creditorID / dueDateTime FILETIME / paid / paidDateTime
//       FILETIME|null / paidByOwnerID / externalID / externalID2).
//   • GetBillBalance -> a bare number: the session corp's wallet balance for its default
//       account key. 0 when corp-less.
//
// ⚠ VALUE ENCODING: ISK amounts (amount / interest / balance) are money that can exceed
// 2^53, so they are kept as raw decimal STRINGS, never coerced to a JS number. FILETIMEs
// (dueDateTime / paidDateTime) likewise. bill / owner ids stay as data (R7d), plain numbers.

import { isListValue, readRowField, type JsonValue } from "./wire.ts";
import { longToDecimalString, toNum, toNumOrNull } from "./allianceInfo.ts";

/** One alliance bill (GetBills). */
export interface AllianceBill {
  readonly billID: number | null;
  readonly billTypeID: number;
  /** ISK — raw decimal string (may exceed 2^53). */
  readonly amount: string | null;
  /** ISK — raw decimal string. */
  readonly interest: string | null;
  readonly debtorID: number | null;
  readonly creditorID: number | null;
  /** FILETIME — raw decimal string. */
  readonly dueDateTime: string | null;
  readonly paid: boolean;
  /** FILETIME — raw decimal string, or null when unpaid. */
  readonly paidDateTime: string | null;
  readonly paidByOwnerID: number | null;
  /** -1 on the wire when absent (kept as-is, not nulled). */
  readonly externalID: number | null;
  readonly externalID2: number | null;
}

/**
 * Decode allianceRegistry.GetBills -> the alliance's owed bills. `[]` is a real "no
 * bills / alliance-less" answer (verified live for both Farmer and Elysian). Rows are
 * util.KeyVals, read through readRowField.
 */
export function decodeAllianceBills(
  result: JsonValue | null | undefined,
): AllianceBill[] {
  if (!isListValue(result)) {
    return [];
  }
  return result.items.map((row) => ({
    billID: toNumOrNull(readRowField(row, "billID")),
    billTypeID: toNum(readRowField(row, "billTypeID")),
    amount: longToDecimalString(readRowField(row, "amount")),
    interest: longToDecimalString(readRowField(row, "interest")),
    debtorID: toNumOrNull(readRowField(row, "debtorID")),
    creditorID: toNumOrNull(readRowField(row, "creditorID")),
    dueDateTime: longToDecimalString(readRowField(row, "dueDateTime")),
    paid: toNum(readRowField(row, "paid")) !== 0,
    paidDateTime: longToDecimalString(readRowField(row, "paidDateTime")),
    paidByOwnerID: toNumOrNull(readRowField(row, "paidByOwnerID")),
    externalID: toNumOrNull(readRowField(row, "externalID")),
    externalID2: toNumOrNull(readRowField(row, "externalID2")),
  }));
}

/**
 * Decode allianceRegistry.GetBillBalance -> the session corp's wallet balance as a raw
 * decimal STRING (bigint-safe — a balance can exceed 2^53). Accepts the bare number the
 * wire actually sends and the {type:"long"} wrapper. `"0"` when corp-less; `null` only
 * for a genuinely non-numeric / absent value.
 */
export function decodeBillBalance(
  result: JsonValue | null | undefined,
): string | null {
  return longToDecimalString(result ?? null);
}
