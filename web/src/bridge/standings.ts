// Standings reads decoded to plain rows (goal R55).
//
// GET /api/bridge/standings returns the raw retail-shaped reads the retail
// standings panel issues (eve/client/.../neocom/charsheet/standingsPanel):
//   • standingMgr.GetCharStandings — "NPCs to my character"
//   • standingMgr.GetCorpStandings — "NPCs to my corporation"
//   • standingMgr.GetStandingTransactions(fromID, toID) — a char row's HISTORY
//   • standingMgr.GetStandingCompositions(fromID, toID) — a corp row's per-member
//     breakdown
// The two standings reads share ONE shape (a header/lines Rowset over columns
// ["fromID","standing"]) so both reuse the R6 decode. The history + composition
// reads are new shapes, decoded here from REAL captured bytes:
//   • transactions -> {type:"list", items:[util.KeyVal{eventTypeID, eventDateTime
//     (long FILETIME), modification, fromID, toID, msg, int_1..3}]}
//   • compositions -> a CachedMethodCallResult wrapping an objectex2 CRowset whose
//     packedrows carry [standing (double), ownerID (int)]
//
// R7d is the crux: a standing's `fromID` is an ENTITY id (NPC faction / NPC
// corporation / agent) and MUST resolve to a name, never render as a number.
// `classifyStandingKind` maps a fromID to the /api/names kind by its EVE id
// range — exactly how the retail client's idCheckers classifies an owner
// (inventorycommon/const: faction 500000-599999, NPC corporation
// 1000000-1999999, NPC character/agent 3000000-3999999). This is deliberate: the
// generic `owner` name-kind does NOT cover agents (verified live —
// owner:3008416 resolves to null while agent:3008416 resolves to "Antaken
// Kamola"), so an agent fromID must be asked for as an `agent`.

import {
  isListValue,
  readRowField,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";
import { unwrapCachedResult } from "./market.ts";
import { decodeCharStandings } from "./rewards.ts";
import type { NameKind } from "../store/names.ts";
import type {
  StandingComposition,
  StandingTransaction,
} from "../store/types.ts";

// The two standings reads (char + corp) are the same Rowset shape, so the R6
// decode covers both. Re-exported so the page has one standings-decode surface.
export { decodeCharStandings } from "./rewards.ts";

// EVE owner id ranges (inventorycommon/const.py, mirrored by the retail
// idCheckers the standings panel uses to group rows).
const FACTION_MIN = 500000;
const FACTION_MAX = 599999;
const NPC_CORP_MIN = 1000000;
const NPC_CORP_MAX = 1999999;
const AGENT_MIN = 3000000;
const AGENT_MAX = 3999999;

/**
 * The /api/names kind for a standings `fromID`, by its EVE id range — the R7d
 * classification. Returns null for an id outside every known range (the page
 * then degrades to a plain "Unknown entity" fallback, never the id).
 */
export function classifyStandingKind(fromID: number): NameKind | null {
  if (!Number.isFinite(fromID) || fromID <= 0) {
    return null;
  }
  if (fromID >= FACTION_MIN && fromID <= FACTION_MAX) {
    return "faction";
  }
  if (fromID >= NPC_CORP_MIN && fromID <= NPC_CORP_MAX) {
    return "corporation";
  }
  if (fromID >= AGENT_MIN && fromID <= AGENT_MAX) {
    return "agent";
  }
  return null;
}

function toNumber(value: JsonValue | undefined): number {
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
  return 0;
}

/**
 * A FILETIME instant as a bigint (it exceeds 2^53), tolerant of the
 * {type:"long"} wrapper and a bare decimal string (R32); null when absent or a
 * zero sentinel.
 */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value)
      ? BigInt(value)
      : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/**
 * Decode standingMgr.GetStandingCompositions — a CachedMethodCallResult wrapping
 * an objectex2 CRowset whose packedrow rows carry [standing, ownerID]. Rows live
 * on the CRowset's `list` (an objectex2's rows are NOT on `items`). A malformed
 * row (no ownerID) is dropped. `[]` is a real "no composition" answer, distinct
 * from a FAILED read (which the flow carries as an error).
 *
 * ⚠ R7d: `ownerID` is a corporation member's entity id and is kept only to be
 * name-resolved; the panel never renders it as a number.
 */
export function decodeStandingCompositions(
  result: JsonValue,
): StandingComposition[] {
  const rowset = unwrapCachedResult(result);
  const list =
    typeof rowset === "object" &&
    rowset !== null &&
    !Array.isArray(rowset) &&
    Array.isArray((rowset as { list?: unknown }).list)
      ? ((rowset as { list: readonly JsonValue[] }).list)
      : [];
  const rows: StandingComposition[] = [];
  for (const row of list) {
    const ownerID = toNumber(readRowField(row, "ownerID"));
    if (ownerID > 0) {
      rows.push({ ownerID, standing: toNumber(readRowField(row, "standing")) });
    }
  }
  return rows;
}

/**
 * Decode standingMgr.GetStandingTransactions — a {type:"list"} of util.KeyVal
 * rows. Only the RENDERABLE fields are kept: the event date, the eventTypeID
 * (mapped to a plain label by the page) and the raw modification. The row's
 * fromID/toID/int_1..3 are entity ids and are deliberately NOT decoded, so no
 * raw id can reach the panel (R7d). `[]` is a real "no history yet" answer.
 */
export function decodeStandingTransactions(
  result: JsonValue,
): StandingTransaction[] {
  if (!isListValue(result)) {
    return [];
  }
  const rows: StandingTransaction[] = [];
  result.items.forEach((row, index) => {
    const date = toFiletime(readRowField(row, "eventDateTime"));
    const eventTypeID = toNumber(readRowField(row, "eventTypeID"));
    const modification = toNumber(readRowField(row, "modification"));
    rows.push({
      // A stable list key from the date + position; never rendered.
      id: `${date === null ? "0" : date.toString()}:${index}`,
      date,
      eventTypeID,
      modification,
    });
  });
  return rows;
}
