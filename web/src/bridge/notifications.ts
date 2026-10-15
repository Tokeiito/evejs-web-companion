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
//
// Tranquility's answer to the three reads is a CRowset (carbon.common.script.sys.crowset.CRowset) of DBRows of
// eight columns, notificationID, typeID, senderID, receiverID, processed, created, data and deleted, the data the
// notification's data as YAML text (its recordings: "Logging In To Space.txt", "Resign As CEO - Corp Disbands.txt";
// notificationSvc.py TryUnYamlNotificationData loads it), and EveJS answers so (eve.js notificationState.js
// buildNotificationRowset). Both shapes are read: a row a KeyVal or a packed row, the data a dict as it came or
// YAML text read as the client's loader reads it (notificationYaml.ts).

import {
  isKeyValValue,
  isListValue,
  isPackedRowValue,
  readPlainJsonField,
  readRowField,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";
import { notificationDataOfYaml } from "./notificationYaml.ts";

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

/** A row's data: YAML text read as the client's loader reads it (null where it cannot be), anything else as it came. */
function dataOf(value: JsonValue | undefined): JsonValue | null {
  if (value === undefined) return null;
  if (typeof value === "string") return notificationDataOfYaml(value);
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (value as { type?: unknown }).type === "wstring") {
    return notificationDataOfYaml(String((value as { value?: unknown }).value ?? ""));
  }
  return value;
}

/** Decode one notification row, a KeyVal DTO or a CRowset's DBRow. undefined when the value is neither. */
function decodeNotification(row: JsonValue): Notification | undefined {
  if (!isKeyValValue(row) && !isPackedRowValue(row)) {
    return undefined;
  }
  const processed = readRowField(row, "processed");
  return {
    notificationID: toNumber(readRowField(row, "notificationID")),
    typeID: toNumber(readRowField(row, "typeID")),
    senderID: toNumber(readRowField(row, "senderID")),
    receiverID: toNumber(readRowField(row, "receiverID")),
    processed: processed === true || processed === 1,
    created: unwrapLong(readRowField(row, "created")),
    data: dataOf(readRowField(row, "data")),
  };
}

/** The rows of a read's answer: a bare array, a list, or a CRowset (its rows on `list`). */
export function notificationRows(result: JsonValue | null | undefined): readonly JsonValue[] {
  if (Array.isArray(result)) return result;
  if (isListValue(result)) return result.items;
  if (result !== null && typeof result === "object" && !Array.isArray(result)) {
    const list = (result as { list?: unknown }).list;
    if (Array.isArray(list)) return list as JsonValue[];
  }
  return [];
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
  const notifications: Notification[] = [];
  for (const row of notificationRows(result)) {
    const decoded = decodeNotification(row);
    if (decoded) {
      notifications.push(decoded);
    }
  }
  return notifications;
}

// --- R87 write acks ---------------------------------------------------------
//
// The Phase-3 notificationMgr WRITES (Mark*/Delete*/LogNotificationInteraction).
// FAST-MODE educated-guess decoders: the BFF turns each server return (every
// notification write answers null) into a small JSON ack, so this only reads the
// uniform `applied` flag the confirm-gated route emits. The panel re-reads the
// notification list to prove the mutation. These are EDUCATED GUESSES from the
// client + server code, not captured real bytes (QA/real-impl comes later).

/** The uniform ack every confirm-gated notification write returns. */
export interface NotificationWriteAck {
  readonly ok: boolean;
  readonly applied: boolean;
}

function truthy(value: JsonValue | undefined): boolean {
  return value === true;
}

/** Decode a notification write ack (Mark / Delete / LogNotificationInteraction). */
export function decodeNotificationWriteAck(response: JsonValue): NotificationWriteAck {
  return {
    ok: truthy(readPlainJsonField(response, "ok")),
    applied: truthy(readPlainJsonField(response, "applied")),
  };
}
