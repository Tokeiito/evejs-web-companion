// The social reads (chat channels + default contact cost), decoded to plain
// values (goal R60, PLUMBING ONLY — no UI).
//
// GET /api/bridge/social returns two unrelated raw retail-shaped results.
// Captured live from Farmer (character 140000005) on 2026-07-22:
//
//   • channels = LSC.GetChannels() -> a util.Rowset with the 16 CHANNEL_HEADERS
//       (channelID, ownerID, displayName, motd, comparisonKey, memberless,
//       password, mailingList, cspa, temporary, languageRestriction,
//       groupMessageID, channelMessageID, mode, subscribed, estimatedMemberCount),
//       one line per channel the session is in. Live -> ONE row: the docked Local
//       channel (channelID 30000144, ownerID 1, displayName "Local", mode 3,
//       subscribed true, estimatedMemberCount 1). ⚠ This Rowset carries only
//       `header` (no `columns`) and its lines are {type:"list"} (util.Row)
//       wrappers — readRowsetRows reads both.
//   • defaultContactCost = account.GetDefaultContactCost() -> ⚠ null in this
//       world (a `return null` stub; the CSPA contact charge is not modelled). A
//       REAL "no default cost" answer, not a failure.
//
// R7d: channelID / ownerID stay plain numeric fields for a future UI to resolve —
// never forced into a label.

import { readRowsetRows, type JsonValue } from "./wire.ts";

/** One chat channel row (LSC.GetChannels). */
export interface ChatChannel {
  readonly channelID: number;
  /** The channel owner entity, kept as data for later resolution (R7d). */
  readonly ownerID: number;
  readonly displayName: string;
  readonly motd: string;
  readonly comparisonKey: string;
  readonly memberless: boolean;
  /** The channel password, or null when the channel has none. */
  readonly password: string | null;
  readonly mailingList: boolean;
  readonly cspa: number;
  readonly temporary: boolean;
  readonly languageRestriction: boolean;
  readonly groupMessageID: number;
  readonly channelMessageID: number;
  readonly mode: number;
  readonly subscribed: boolean;
  readonly estimatedMemberCount: number;
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

/** A non-empty string, or null when absent/empty. */
function toNullableString(value: JsonValue | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * Decode LSC.GetChannels — the channel Rowset into plain rows. `[]` is a real
 * "no channels" answer. Rows without a positive channelID are dropped.
 */
export function decodeChannels(
  result: JsonValue | null | undefined,
): readonly ChatChannel[] {
  const rows: ChatChannel[] = [];
  for (const row of readRowsetRows(result ?? undefined)) {
    const channelID = toNumber(row.channelID);
    if (channelID <= 0) {
      continue;
    }
    rows.push({
      channelID,
      ownerID: toNumber(row.ownerID),
      displayName: String(row.displayName ?? ""),
      motd: String(row.motd ?? ""),
      comparisonKey: String(row.comparisonKey ?? ""),
      memberless: row.memberless === true,
      password: toNullableString(row.password),
      mailingList: row.mailingList === true,
      cspa: toNumber(row.cspa),
      temporary: row.temporary === true,
      languageRestriction: row.languageRestriction === true,
      groupMessageID: toNumber(row.groupMessageID),
      channelMessageID: toNumber(row.channelMessageID),
      mode: toNumber(row.mode),
      subscribed: row.subscribed === true,
      estimatedMemberCount: toNumber(row.estimatedMemberCount),
    });
  }
  return rows;
}

/**
 * Decode account.GetDefaultContactCost — a number, or null when the read carries
 * no cost (the live "no default cost" state in this world). A negative or
 * non-numeric value also decodes to null.
 */
export function decodeDefaultContactCost(
  result: JsonValue | null | undefined,
): number | null {
  if (typeof result === "number" && Number.isFinite(result) && result >= 0) {
    return result;
  }
  return null;
}
