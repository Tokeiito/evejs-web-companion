// Kill rights this character HOLDS, decoded to plain rows (goal R57, PLUMBING
// ONLY — no UI).
//
// GET /api/bridge/kill-rights returns the raw retail-shaped result of
// bountyProxy.GetMyKillRights — a marshaled LIST of util.KeyVal rows:
//
//   {type:"list", items:[util.KeyVal{
//       killRightID (int),
//       fromID (int),          // the character the kill right is FROM (aggressor)
//       toID (int),            // the character it is against
//       expiryTime ({type:"long", value:"<FILETIME>"}),
//       price (int | null),    // ISK asking price when the right is for sale
//       restrictedTo (int | null)}]}   // entity the sale is restricted to
//
// ⚠ Farmer holds no kill rights, so the LIVE capture on 2026-07-22 was the empty
// list {type:"list", items:[]} — a REAL "no kill rights" answer, not a failure.
// The populated row shape is the exact output of the server's buildKillRightPayload
// (eve.js .../bounty/bountyProxyService.js), which the test fixture mirrors.
//
// R7d: fromID / toID / restrictedTo are ENTITY ids kept here as plain numeric
// fields for a future UI to resolve to names — never rendered as numbers, never
// forced into a label in this file. `price` is an ISK amount kept as a bigint-safe
// decimal string (never zeroed by a `typeof === "number"` test). `expiryTime` is a
// FILETIME bigint.

import { isListValue, readKeyVal, readRowField, unwrapLong, type JsonValue } from "./wire.ts";
import { toAmountString } from "./rewards.ts";

/** One kill right the character holds. */
export interface KillRight {
  readonly killRightID: number;
  readonly fromID: number;
  readonly toID: number;
  /** The FILETIME the right expires (exceeds 2^53, so a bigint); null if absent. */
  readonly expiryTime: bigint | null;
  /** ISK asking price as a bigint-safe decimal string; null when not for sale. */
  readonly price: string | null;
  /** Entity the sale is restricted to; null when unrestricted. */
  readonly restrictedTo: number | null;
}

/** A number tolerant of a {type:"long"} wrapper and a numeric string; 0 otherwise. */
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

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value)
      ? BigInt(value)
      : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** A positive entity id, or null when absent/zero (the "unrestricted" sentinel). */
function toOptionalID(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const id = toNumber(value);
  return id > 0 ? id : null;
}

/**
 * Decode bountyProxy.GetMyKillRights into plain rows. A malformed row (no
 * killRightID) is dropped. `[]` is a real "no kill rights" answer.
 */
export function decodeKillRights(result: JsonValue): KillRight[] {
  if (!isListValue(result)) {
    return [];
  }
  const rows: KillRight[] = [];
  for (const item of result.items) {
    const killRightID = toNumber(readRowField(item, "killRightID"));
    if (killRightID <= 0) {
      continue;
    }
    const priceField = readRowField(item, "price");
    rows.push({
      killRightID,
      fromID: toNumber(readRowField(item, "fromID")),
      toID: toNumber(readRowField(item, "toID")),
      expiryTime: toFiletime(readRowField(item, "expiryTime")),
      // A null price means "not for sale"; a present price is kept bigint-safe.
      price: priceField === null || priceField === undefined ? null : toAmountString(priceField),
      restrictedTo: toOptionalID(readRowField(item, "restrictedTo")),
    });
  }
  return rows;
}

// --- R89 killRightMgr financial write acks ----------------------------------
//
// FAST-MODE educated-guess decoders for the confirm-gated killRightMgr WRITES
// (ActivateKillRight / BuyKillRight). Both return null server-side. ⚠ BuyKillRight
// SPENDS ISK (debited from the session character) and is NEVER fired live in the
// plumbing pass; ActivateKillRight acts on a kill right the session owns. Educated
// guesses from the client + server code, not captured bytes.

/** The uniform ack every confirm-gated killRightMgr write returns. */
export interface KillRightWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
}

function killRightAckTruthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** Decode a plain killRightMgr write ack (activate / buy a kill right). */
export function decodeKillRightWriteAck(response: JsonValue): KillRightWriteAck {
  return {
    ok: killRightAckTruthy(readKeyVal(response, "ok")),
    applied: killRightAckTruthy(readKeyVal(response, "applied")),
  };
}
