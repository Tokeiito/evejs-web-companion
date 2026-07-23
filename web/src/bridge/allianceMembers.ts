// R83 — decoding the allianceRegistry MEMBER / TENURE / HISTORY reads (PLUMBING ONLY —
// no UI). Captured live on 2026-07-22. As Farmer (corp 98000001, ALLIANCE-LESS) the
// session forms return the empty state (empty member Rowset, empty tenure list, 0 days);
// the populated shapes come from an explicit allianceID (Elysian 99000000) / corpID —
// all EVE-public membership data, safe even for a foreign id (verified live).
//
//   • GetAllianceMembers([allianceID?]) -> a Rowset (eve.common.script.sys.rowset.Rowset)
//       of the alliance's member CORPORATIONS: corporationID / allianceID /
//       chosenExecutorID / startDate(FILETIME) / deleted.
//   • GetAllianceMembersOlderThan([allianceID?, minDays]) -> a list of member corpIDs
//       whose tenure ≥ minDays.
//   • GetDaysInAlliance([allianceID?, corporationID?]) -> an integer day count (0 unless
//       the corp is actually a member of that alliance; needs BOTH ids to be meaningful).
//   • GetEmploymentRecord([corporationID?]) -> a Rowset of a corp's ALLIANCE history:
//       allianceID(may be null for the pre-alliance origin row) / startDate(FILETIME) /
//       deleted. Falls back to the session alliance's single-row history when args[0] is
//       not a known corp.
//
// ⚠ VALUE ENCODING: corp / alliance ids stay as data (R7d), plain numbers (< 2^53).
// startDate FILETIMEs cross as {type:"long"} and EXCEED 2^53 — kept as decimal STRINGS.

import { readRowsetRows, isListValue, type JsonValue } from "./wire.ts";
import { toNum, toNumOrNull, longToDecimalString } from "./allianceInfo.ts";

/** One alliance member corporation (GetAllianceMembers). */
export interface AllianceMemberCorp {
  readonly corporationID: number | null;
  readonly allianceID: number | null;
  readonly chosenExecutorID: number | null;
  /** FILETIME — raw decimal string (may exceed 2^53). */
  readonly startDate: string | null;
  readonly deleted: boolean;
}

/** One corp alliance-history row (GetEmploymentRecord). */
export interface AllianceEmploymentRow {
  /** null on the pre-alliance origin row (corp created outside any alliance). */
  readonly allianceID: number | null;
  /** FILETIME — raw decimal string. */
  readonly startDate: string | null;
  readonly deleted: boolean;
}

/**
 * Decode allianceRegistry.GetAllianceMembers -> the alliance's member corporations. `[]`
 * is a real "no members / alliance-less session" answer (Farmer's case — verified live).
 */
export function decodeAllianceMembers(
  result: JsonValue | null | undefined,
): AllianceMemberCorp[] {
  return readRowsetRows(result).map((row) => ({
    corporationID: toNumOrNull(row.corporationID),
    allianceID: toNumOrNull(row.allianceID),
    chosenExecutorID: toNumOrNull(row.chosenExecutorID),
    startDate: longToDecimalString(row.startDate),
    deleted: toNum(row.deleted) !== 0,
  }));
}

/**
 * Decode allianceRegistry.GetAllianceMembersOlderThan -> the member corpIDs meeting the
 * tenure threshold, kept as data (R7d). `[]` is a real "none / alliance-less" answer.
 */
export function decodeAllianceMembersOlderThan(
  result: JsonValue | null | undefined,
): number[] {
  if (!isListValue(result)) {
    return [];
  }
  const ids: number[] = [];
  for (const item of result.items) {
    const id = toNumOrNull(item);
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Decode allianceRegistry.GetDaysInAlliance -> the integer day count. A bare number on
 * the wire; 0 is a real answer (corp not a member of that alliance, or ids omitted).
 */
export function decodeDaysInAlliance(result: JsonValue | null | undefined): number {
  return toNum(result ?? null);
}

/**
 * Decode allianceRegistry.GetEmploymentRecord -> a corp's alliance history rows, newest
 * first as the server ordered them. `[]` when the corp is unknown and the session is
 * alliance-less. The final origin row carries a null allianceID (verified live).
 */
export function decodeEmploymentRecord(
  result: JsonValue | null | undefined,
): AllianceEmploymentRow[] {
  return readRowsetRows(result).map((row) => ({
    allianceID: toNumOrNull(row.allianceID),
    startDate: longToDecimalString(row.startDate),
    deleted: toNum(row.deleted) !== 0,
  }));
}
