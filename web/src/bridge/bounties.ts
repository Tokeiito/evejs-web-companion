// Bounty reads decoded to plain rows (goal R66, PLUMBING ONLY — no UI).
//
// GET /api/bridge/bounties bundles the bountyProxy reads. The shapes below were
// built from bytes captured LIVE from Farmer (char 140000005, corp 98000001) on
// 2026-07-22, cross-checked against the server builders (eve.js
// .../bounty/bountyProxyService.js). Bounties are LARGELY PUBLIC EVE data.
//
// ⚠ TWO DISTINCT LIST SHAPES on this one service:
//   • GetBounties / SearchCharBounties items are [key, util.KeyVal] TUPLES — the
//     key is the targetID (GetBounties) or the rank (SearchCharBounties), and the
//     pool payload rides in tuple[1]. Captured GetBounties (no args) returned the
//     whole known board as 18 such tuples, e.g. [140000005, KeyVal{targetID,
//     bounty, corporationID}].
//   • The ranked leaderboards (GetTop{Pilot,Corp,Alliance}Bounties) return a
//     2-tuple [list<util.KeyVal>, resultTime(long)] whose list items are BARE
//     KeyVals (no [key, …] wrapper). Captured EMPTY: [list(0), long(...)].
//   • GetMyBounties returns a plain list<util.KeyVal> (contributions). Captured
//     EMPTY (Farmer has placed none) — a REAL "no bounties placed" state.
//
// R7d: targetID / corporationID / allianceID / contributionID are ENTITY ids kept
// as plain numeric fields for a future UI to resolve — never rendered as numbers,
// never forced into a label here. bounty / amount are ISK amounts kept as bigint-
// safe decimal strings (never zeroed by a `typeof === "number"` test).

import { isListValue, readRowField, unwrapLong, type JsonValue } from "./wire.ts";
import { toAmountString } from "./rewards.ts";
import { decodeKillRights, type KillRight } from "./killRights.ts";

/** A bounty POOL on one target (character / corporation / alliance). */
export interface BountyPool {
  readonly targetID: number;
  /** Total bounty on the target, a bigint-safe ISK decimal string ("0" when none). */
  readonly bounty: string;
  /** Present only when the target rides under a corporation; null otherwise. */
  readonly corporationID: number | null;
  /** Present only when the target rides under an alliance; null otherwise. */
  readonly allianceID: number | null;
}

/** One bounty THIS character has placed (a contribution). */
export interface BountyContribution {
  readonly contributionID: number;
  readonly targetID: number;
  /** The contributed amount, a bigint-safe ISK decimal string. */
  readonly amount: string;
  readonly corporationID: number | null;
  readonly allianceID: number | null;
}

/** A ranked bounty leaderboard: the top pools + the server's result timestamp. */
export interface BountyLeaderboard {
  readonly pools: readonly BountyPool[];
  /** The FILETIME the ranking was computed (exceeds 2^53, so a bigint); null if absent. */
  readonly resultTime: bigint | null;
}

/** GetBountiesAndKillRights' 2-tuple, decoded into its two halves. */
export interface BountiesAndKillRights {
  readonly bounties: readonly BountyPool[];
  readonly killRights: readonly KillRight[];
}

/** A positive entity id, or null when absent/zero. */
function toOptionalID(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value > 0 ? value : null;
  }
  const long = unwrapLong(value);
  if (long !== null) {
    return long > 0n ? Number(long) : null;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const numeric = Number(value);
    return numeric > 0 ? numeric : null;
  }
  return null;
}

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/**
 * The util.KeyVal payload of a list item, from either shape: a bare KeyVal (the
 * leaderboards) or a [key, KeyVal] tuple (GetBounties / SearchCharBounties). The
 * tuple's key (targetID or rank) is NOT lost — the pool KeyVal carries targetID
 * itself, and the rank is the list position.
 */
function keyValOfItem(item: JsonValue): JsonValue | undefined {
  if (Array.isArray(item) && item.length >= 2) {
    return item[1] as JsonValue;
  }
  return item;
}

/** Decode one bounty-pool KeyVal; null when it carries no targetID. */
function decodeBountyPool(keyval: JsonValue | undefined): BountyPool | null {
  if (keyval === undefined) {
    return null;
  }
  const targetIDField = readRowField(keyval, "targetID");
  // ⚠ targetID 0 is a REAL board entry (the "no owner" pool captured live), so
  // absence — not zero — is what disqualifies a row.
  if (targetIDField === undefined) {
    return null;
  }
  const targetID = toOptionalID(targetIDField) ?? (typeof targetIDField === "number" ? 0 : -1);
  if (targetID < 0) {
    return null;
  }
  return {
    targetID,
    bounty: toAmountString(readRowField(keyval, "bounty")) ?? "0",
    corporationID: toOptionalID(readRowField(keyval, "corporationID")),
    allianceID: toOptionalID(readRowField(keyval, "allianceID")),
  };
}

/**
 * Decode a bounty-pool list (GetBounties / SearchCharBounties / a leaderboard's
 * inner list) into plain pools. `[]` is a real "no bounties" answer.
 */
export function decodeBountyPools(value: JsonValue | null | undefined): BountyPool[] {
  if (!isListValue(value)) {
    return [];
  }
  const pools: BountyPool[] = [];
  for (const item of value.items) {
    const pool = decodeBountyPool(keyValOfItem(item));
    if (pool !== null) {
      pools.push(pool);
    }
  }
  return pools;
}

/**
 * Decode a ranked leaderboard's [list<KeyVal>, resultTime(long)] 2-tuple.
 * A non-tuple (or empty) decodes to no pools and a null time.
 */
export function decodeBountyLeaderboard(
  value: JsonValue | null | undefined,
): BountyLeaderboard {
  if (!Array.isArray(value)) {
    return { pools: [], resultTime: null };
  }
  return {
    pools: decodeBountyPools(value[0] as JsonValue),
    resultTime: toFiletime(value[1] as JsonValue),
  };
}

/** Decode GetMyBounties -> the contributions this character has placed. */
export function decodeMyBounties(value: JsonValue | null | undefined): BountyContribution[] {
  if (!isListValue(value)) {
    return [];
  }
  const rows: BountyContribution[] = [];
  for (const item of value.items) {
    const keyval = keyValOfItem(item);
    const contributionID = toOptionalID(readRowField(keyval, "contributionID"));
    const targetIDField = readRowField(keyval, "targetID");
    if (contributionID === null && targetIDField === undefined) {
      continue;
    }
    rows.push({
      contributionID: contributionID ?? 0,
      targetID: toOptionalID(targetIDField) ?? 0,
      amount: toAmountString(readRowField(keyval, "amount")) ?? "0",
      corporationID: toOptionalID(readRowField(keyval, "corporationID")),
      allianceID: toOptionalID(readRowField(keyval, "allianceID")),
    });
  }
  return rows;
}

/**
 * Decode GetBountiesAndKillRights' [bountiesList, killRightsList] 2-tuple. The
 * kill-rights half is the SAME shape as GetMyKillRights (buildKillRightPayload),
 * so it reuses decodeKillRights (R57).
 */
export function decodeBountiesAndKillRights(
  value: JsonValue | null | undefined,
): BountiesAndKillRights {
  if (!Array.isArray(value)) {
    return { bounties: [], killRights: [] };
  }
  return {
    bounties: decodeBountyPools(value[0] as JsonValue),
    killRights: decodeKillRights(value[1] as JsonValue),
  };
}
