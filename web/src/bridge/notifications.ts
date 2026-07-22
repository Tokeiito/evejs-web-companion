// The notificationMgr reads, decoded to plain notification records (goal R59,
// PLUMBING ONLY — no UI).
//
// GET /api/bridge/notifications returns three raw retail-shaped results —
// GetAllNotifications / GetUnprocessed / GetByGroupID — each a BARE JSON ARRAY
// (not a {type:"list"} wrapper) of util.KeyVal notification DTOs. Captured live
// from Farmer (character 140000005) on 2026-07-22: 213 notifications across 22
// typeIDs, 211 unprocessed. One DTO:
//
//   {type:"object", name:"util.KeyVal", args:{type:"dict", entries:[
//     ["notificationID", 2877],
//     ["typeID",         35],
//     ["senderID",       1000113],
//     ["receiverID",     140000005],
//     ["processed",      false],
//     ["created",        {type:"long", value:"134282765436910000"}],
//     ["data",           {type:"dict", entries:[["itemID",9988400082811],["payout",true]]}]]}}
//
// ⚠ `created` is a FILETIME long that EXCEEDS 2^53, so it is unwrapped to bigint
// (a plain Number would lose precision). ⚠ `data` is a per-typeID marshaled
// payload (a dict or list whose keys differ by notification type) — it is CARRIED
// THROUGH untouched as a raw JsonValue for a future UI to interpret per type;
// this decoder does not impose a schema on it.
//
// R7d: senderID (and any id inside `data`) is an ENTITY id kept as a plain
// numeric field for a future UI to resolve to a name — never rendered as a
// number, never forced into a label. An empty array is a REAL "no notifications"
// answer (Farmer's own GetByGroupID/GetUnprocessed can legitimately be empty).

import { isKeyValValue, readKeyVal, unwrapLong, type JsonValue } from "./wire.ts";

/** One notification, envelope decoded; its per-type `data` carried raw. */
export interface Notification {
  readonly notificationID: number;
  readonly typeID: number;
  /** The sender entity id (character/corp/NPC), kept as data for later resolution (R7d). */
  readonly senderID: number;
  readonly receiverID: number;
  readonly processed: boolean;
  /** Creation FILETIME as a bigint (exceeds 2^53); null when absent. */
  readonly created: bigint | null;
  /** The per-typeID payload, carried through untouched (a dict/list this decoder does not schema). */
  readonly data: JsonValue | null;
}

/** An integer tolerant of a {type:"long"} wrapper and a numeric string; 0 otherwise. */
function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
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

/** Decode one notification KeyVal DTO. undefined when the value is not a KeyVal. */
function decodeNotification(row: JsonValue): Notification | undefined {
  if (!isKeyValValue(row)) {
    return undefined;
  }
  const data = readKeyVal(row, "data");
  return {
    notificationID: toNumber(readKeyVal(row, "notificationID")),
    typeID: toNumber(readKeyVal(row, "typeID")),
    senderID: toNumber(readKeyVal(row, "senderID")),
    receiverID: toNumber(readKeyVal(row, "receiverID")),
    processed: readKeyVal(row, "processed") === true,
    created: unwrapLong(readKeyVal(row, "created")),
    data: data === undefined ? null : data,
  };
}

/**
 * Decode a notificationMgr read (GetAllNotifications / GetUnprocessed /
 * GetByGroupID). The result is a BARE ARRAY of KeyVal DTOs; a non-array (or an
 * empty array) yields []. Rows that are not KeyVals are dropped rather than
 * emitted as empty records.
 */
export function decodeNotifications(
  result: JsonValue | null | undefined,
): readonly Notification[] {
  if (!Array.isArray(result)) {
    return [];
  }
  const notifications: Notification[] = [];
  for (const row of result) {
    const decoded = decodeNotification(row);
    if (decoded) {
      notifications.push(decoded);
    }
  }
  return notifications;
}
