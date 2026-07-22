// Abyssal PvP filament (pvpFilamentMgr) reads decoded to plain values (goal R69,
// PLUMBING ONLY — no UI).
//
// GET /api/bridge/pvp-filaments bundles the pvpFilamentMgr read set (the abyssal
// Proving-Grounds event surface). Built from bytes captured LIVE from Farmer (char
// 140000005) on 2026-07-22 and cross-checked against the server handlers
// (eve.js .../services/activity/pvpFilamentMgrService.js). This world seeds no Proving
// Grounds event, so every read is its legitimate EMPTY/zeroed state.
//
// ⚠ TWO of the six reads carry their data as a NOTIFICATION, not as the call result:
// GetLeaderboard and GetCharacterStatistics RETURN null and push OnPVPFilaments{
// Leaderboard,CharacterStatistics} via session.sendNotification. The gateway captures
// that in the response envelope's `notifications` array (drain-on-read), so those two
// decoders read from `notifications`, while the other four read from `result`.
//
// OWNERSHIP-SAFETY (R63): GetCharacterStatistics is the flagged seam — its handler takes
// [matchTypeID, scheduleID] and NOT a charID, and returns a HARDCODED all-zero statistics
// dict that reads NOTHING off any character store. There is no charID parameter and no
// per-character data path, so no foreign character's stats can be requested. Verified live:
// a second session got the identical zeroed dict. GetLeaderboard is a public ranking (also
// empty here). Safe.
//
// R7d: matchTypeID / scheduleID stay numeric; GetNextEventDate is a bigint FILETIME.

import {
  isListValue,
  readDictEntry,
  readDictPairs,
  unwrapLong,
  type BridgeNotification,
  type DictEntry,
  type JsonValue,
} from "./wire.ts";

// --- shared field coercions -------------------------------------------------

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/**
 * The payload argument of the FIRST captured notification whose method matches
 * `method`, or null when none is present. The gateway pushes a persistent-session
 * notification as `{kind, service, method, idType, args:[payload], kwargs}`; the
 * data is args[0].
 */
function findNotificationPayload(
  notifications: readonly BridgeNotification[] | null | undefined,
  method: string,
): JsonValue | null {
  if (!Array.isArray(notifications)) {
    return null;
  }
  for (const notification of notifications) {
    if (
      notification &&
      notification.method === method &&
      Array.isArray(notification.args) &&
      notification.args.length > 0
    ) {
      return (notification.args[0] ?? null) as JsonValue;
    }
  }
  return null;
}

// --- GetAllEvents / GetActiveEvents -----------------------------------------

/**
 * Decode an events read (GetAllEvents / GetActiveEvents) -> the raw [key, value] pairs
 * of the event dict. This world returns an empty dict (buildEmptyEventDict), so `[]` is
 * the real state; the raw pairs are surfaced since no per-event server builder exists.
 */
export function decodeEvents(result: JsonValue | null | undefined): readonly DictEntry[] {
  return readDictPairs(result);
}

// --- GetMostRecentEvent -----------------------------------------------------

/**
 * Decode GetMostRecentEvent -> the most-recent event payload, or null. The server
 * answers null in this world (no event) — a real state; a populated shape passes
 * through as its raw value for a future UI to read.
 */
export function decodeMostRecentEvent(result: JsonValue | null | undefined): JsonValue | null {
  return (result ?? null) as JsonValue | null;
}

// --- GetNextEventDate -------------------------------------------------------

/**
 * Decode GetNextEventDate -> the next event's start as a bigint FILETIME, or null when
 * there is no scheduled event (the real state here).
 */
export function decodeNextEventDate(result: JsonValue | null | undefined): bigint | null {
  return toFiletime(result ?? undefined);
}

// --- GetLeaderboard (via OnPVPFilamentsLeaderboard notification) -------------

export interface PvpLeaderboard {
  readonly matchTypeID: number;
  readonly scheduleID: number;
  /** Ranked entries; empty in this world (no Proving-Grounds event). */
  readonly entries: readonly JsonValue[];
}

/**
 * Decode GetLeaderboard from the captured OnPVPFilamentsLeaderboard notification. The
 * payload is buildLeaderboardInfo -> dict{matchTypeID, scheduleID, entries:list}. null
 * when the notification is absent.
 */
export function decodeLeaderboard(
  notifications: readonly BridgeNotification[] | null | undefined,
): PvpLeaderboard | null {
  const payload = findNotificationPayload(notifications, "OnPVPFilamentsLeaderboard");
  if (payload === null) {
    return null;
  }
  const entriesValue = readDictEntry(payload, "entries");
  return {
    matchTypeID: toNumber(readDictEntry(payload, "matchTypeID")),
    scheduleID: toNumber(readDictEntry(payload, "scheduleID")),
    entries: isListValue(entriesValue) ? entriesValue.items : [],
  };
}

// --- GetCharacterStatistics (via OnPVPFilamentsCharacterStatistics notification) --

export interface PvpCharacterStatistics {
  readonly matchTypeID: number;
  readonly scheduleID: number;
  readonly rank: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

/**
 * Decode GetCharacterStatistics from the captured OnPVPFilamentsCharacterStatistics
 * notification. The payload is buildCharacterStatisticsInfo -> dict{matchTypeID,
 * scheduleID, statistics: dict{rank, wins, losses, draws}}. All-zero here (the handler
 * returns hardcoded zeros; see ownership note). null when the notification is absent.
 */
export function decodeCharacterStatistics(
  notifications: readonly BridgeNotification[] | null | undefined,
): PvpCharacterStatistics | null {
  const payload = findNotificationPayload(notifications, "OnPVPFilamentsCharacterStatistics");
  if (payload === null) {
    return null;
  }
  const stats = readDictEntry(payload, "statistics");
  return {
    matchTypeID: toNumber(readDictEntry(payload, "matchTypeID")),
    scheduleID: toNumber(readDictEntry(payload, "scheduleID")),
    rank: toNumber(readDictEntry(stats, "rank")),
    wins: toNumber(readDictEntry(stats, "wins")),
    losses: toNumber(readDictEntry(stats, "losses")),
    draws: toNumber(readDictEntry(stats, "draws")),
  };
}
