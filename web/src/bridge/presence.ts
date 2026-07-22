// The onlineStatus presence reads, decoded to plain values (goal R60, PLUMBING
// ONLY — no UI).
//
// GET /api/bridge/presence?targetID= returns three raw retail-shaped results.
// Captured live from Farmer (character 140000005) on 2026-07-22:
//
//   • onlineStatus  = GetOnlineStatus(targetID) -> a BARE BOOLEAN (is that
//       character online, from this observer's view). Live -> false.
//   • initialState  = GetInitialState() -> a Rowset[contactID, online] — the
//       observer's whole contact-presence snapshot. Live -> EMPTY (Farmer has no
//       contacts; lines:[]), a REAL "no contacts" answer.
//   • prime         = Prime() -> ⚠ NOT void: the handler delegates to
//       GetInitialState, so the LIVE capture was BYTE-IDENTICAL to initialState
//       (the same empty Rowset). Decoded with the same reader.
//
// The Rowset here is the eve.common.script.sys.rowset.Rowset form carrying BOTH
// `header` and `columns` (["contactID","online"]); readRowsetRows reads either.
// R7d: contactID stays a plain numeric field for a future UI to resolve — never
// forced into a label.

import { readRowsetRows, type JsonValue } from "./wire.ts";

/** One contact's presence row (GetInitialState / Prime). */
export interface PresenceContact {
  /** The contact character, kept as data for later resolution (R7d). */
  readonly contactID: number;
  readonly online: boolean;
}

/** An integer tolerant of a numeric string; 0 otherwise. */
function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

/**
 * Decode GetOnlineStatus — a bare boolean. Anything that is not the boolean true
 * decodes to false (a missing/failed read is "not known to be online").
 */
export function decodeOnlineStatus(result: JsonValue | null | undefined): boolean {
  return result === true;
}

/**
 * Decode GetInitialState (and Prime, which returns the same shape) — a
 * Rowset[contactID, online] into plain rows. `[]` is a real "no contacts" answer.
 * Rows without a positive contactID are dropped.
 */
export function decodeInitialState(
  result: JsonValue | null | undefined,
): readonly PresenceContact[] {
  const rows: PresenceContact[] = [];
  for (const row of readRowsetRows(result ?? undefined)) {
    const contactID = toNumber(row.contactID);
    if (contactID <= 0) {
      continue;
    }
    rows.push({ contactID, online: row.online === true });
  }
  return rows;
}

/** Prime returns the same Rowset as GetInitialState; decode it identically. */
export const decodePrime = decodeInitialState;
