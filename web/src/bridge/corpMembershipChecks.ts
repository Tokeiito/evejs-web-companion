// R82 — decoding the corpRegistry MEMBERSHIP-CHECK reads (PLUMBING ONLY — no UI).
//
// GET /api/bridge/corp-membership-checks carries three reads. Captured live from Farmer
// (char 140000005, corp 98000001) on 2026-07-22.
//
// WIRE SHAPES + OWNERSHIP (verified against bytes, cross-account Farmer vs Test Two):
//   • CanLeaveCurrentCorporation -> a 3-tuple [canLeave(0/1), errorCode(string|null),
//     details(dict)]. corp AND char both from the SESSION (resolveCharacterID(session, [])
//     IGNORES args) → SESSION-CHAR-SCOPED, SAFE. Live: Farmer (CEO) [0,"CrpCEOCanNotQuit",{}];
//     Test Two (ordinary member) [1, null, {}].
//   • CanBeKickedOut([charID]) -> a bare int 0/1. corp = resolveCorporationID(session); the
//     member lookup is scoped to the SESSION corp, so a foreign charID that is not a member
//     of the caller's corp just returns 0. Reveals only whether a char is a kickable member
//     of the caller's OWN corp → SAFE. Live: own CEO 140000005 -> 0, own member 998830009 ->
//     1, foreign 140000002 -> 0, no arg -> 0.
//   • CharGetAllyBaseCost([charID]) -> a bare ISK number. ⚠ ARG-INJECTION LEAK: args[0] is a
//     caller-chosen charID (fallback session char) and the cost is a deterministic function
//     of that char's Diplomatic Relations skill level (public base cost + modifier), so a
//     foreign charID leaks that char's private skill level via the derived figure. Live-
//     DIFFERENTIATED: Farmer own 7 500 000 vs foreign 140000002/140000003 -> 10 000 000
//     (Test Two's own is also 10 000 000). Kept pre-plumbed + FLAGGED in
//     docs/arg-injection-leak-handoff.md (operator flag-only; NOT de-allowlisted).

import { unwrapLong, type JsonValue } from "./wire.ts";

/** The result of CanLeaveCurrentCorporation. */
export interface CanLeaveCorporationResult {
  /** true when the session char may leave its corp now. */
  readonly canLeave: boolean;
  /** The retail refusal code when canLeave is false (e.g. "CrpCEOCanNotQuit"); null otherwise. */
  readonly errorCode: string | null;
}

function toNum(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

/**
 * Decode corpRegistry.CanLeaveCurrentCorporation -> {canLeave, errorCode}. `[]`/malformed
 * decodes to a refusal with no code.
 */
export function decodeCanLeaveCorporation(
  result: JsonValue | null | undefined,
): CanLeaveCorporationResult {
  const tuple = Array.isArray(result) ? result : [];
  const errorCode = tuple.length > 1 && typeof tuple[1] === "string" ? tuple[1] : null;
  return {
    canLeave: tuple.length > 0 && toNum(tuple[0]) === 1,
    errorCode,
  };
}

/**
 * Decode corpRegistry.CanBeKickedOut -> boolean. Anything non-1 (including 0 / null / a
 * foreign non-member charID) is false.
 */
export function decodeCanBeKickedOut(result: JsonValue | null | undefined): boolean {
  return toNum(result as JsonValue | undefined) === 1;
}

/**
 * Decode corpRegistry.CharGetAllyBaseCost -> the war-ally base cost in ISK (a plain number).
 * ⚠ Under arg-injection this is the target char's cost, not necessarily the caller's — the
 * leak is server-side and flagged; the decoder is shape-faithful either way.
 */
export function decodeAllyBaseCost(result: JsonValue | null | undefined): number {
  return toNum(result as JsonValue | undefined);
}
