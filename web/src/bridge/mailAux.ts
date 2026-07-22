// The mail LABELS + MAILING LISTS reads, decoded to plain records (goal R59,
// PLUMBING ONLY — no UI). These hang beside the R17 mailbox reads.
//
// GET /api/bridge/mail-aux returns five raw retail-shaped results:
//
//   • labels       = mailMgr.GetLabels()            -> {type:"dict"} of
//       labelID -> util.KeyVal{labelID, name, color}. The mail folders/labels.
//   • joinedLists  = mailingListsMgr.GetJoinedLists()-> {type:"dict"} of
//       listID -> util.KeyVal{id, name, displayName, isMuted, isOperator, isOwner}.
//   • listInfo     = mailingListsMgr.GetInfo(listID)   -> util.KeyVal{...} | null.
//   • listMembers  = mailingListsMgr.GetMembers(listID)-> {type:"dict"} of
//       memberID -> accessLevel(int).
//   • listSettings = mailingListsMgr.GetSettings(listID)-> util.KeyVal{
//       defaultAccess, defaultMemberAccess, cost, access:{type:"dict"} of
//       entityID -> accessLevel} | null.
//
// ⚠ Farmer belongs to NO mailing lists and has NO custom labels, so the LIVE
// capture on 2026-07-22 was FIVE EMPTY answers (two empty dicts, two nulls, one
// empty dict) — a REAL "no labels / no lists" state, not a failure. The populated
// shapes below mirror the server's own builders (mailMgrService.buildLabelKeyVal,
// mailingListsMgrService.buildMailingListInfoKeyVal / buildMailingListSettingsKeyVal
// and the GetMembers dict), so the tests pin BOTH the empty live bytes and the
// populated builder shape using the same dict/KeyVal wire primitives proven live
// in the notification + calendar captures.
//
// R7d: every id — labelID, listID, memberID, and the access-map entityID — is
// kept as a plain numeric field for a future UI to resolve; none is forced into a
// label or dropped.

import {
  isKeyValValue,
  readDictPairs,
  readKeyVal,
  type JsonValue,
} from "./wire.ts";

/** One mail label/folder. */
export interface MailLabel {
  readonly labelID: number;
  readonly name: string;
  /** The label colour as a packed integer (0 when none). */
  readonly color: number;
}

/** One mailing list this character has joined (GetJoinedLists / GetInfo). */
export interface MailingList {
  readonly listID: number;
  readonly name: string;
  readonly displayName: string;
  readonly isMuted: boolean;
  readonly isOperator: boolean;
  readonly isOwner: boolean;
}

/** One mailing-list member and its access level. */
export interface MailingListMember {
  /** The member entity id, kept as data for later resolution (R7d). */
  readonly memberID: number;
  readonly accessLevel: number;
}

/** One entity's access grant within a list's settings. */
export interface MailingListAccessEntry {
  readonly entityID: number;
  readonly accessLevel: number;
}

/** A mailing list's access settings (GetSettings). */
export interface MailingListSettings {
  readonly defaultAccess: number;
  readonly defaultMemberAccess: number;
  readonly cost: number;
  readonly access: readonly MailingListAccessEntry[];
}

/** An integer from a bare number or numeric string; 0 otherwise. */
function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

/** Decode one MailingList KeyVal (the shared shape of GetJoinedLists rows + GetInfo). */
function decodeMailingList(row: JsonValue): MailingList | undefined {
  if (!isKeyValValue(row)) {
    return undefined;
  }
  return {
    listID: toNumber(readKeyVal(row, "id")),
    name: String(readKeyVal(row, "name") ?? ""),
    displayName: String(readKeyVal(row, "displayName") ?? ""),
    isMuted: readKeyVal(row, "isMuted") === true,
    isOperator: readKeyVal(row, "isOperator") === true,
    isOwner: readKeyVal(row, "isOwner") === true,
  };
}

/**
 * Decode mailMgr.GetLabels — a dict of labelID -> KeyVal{labelID, name, color}.
 * Empty is a real "no labels" answer. A label whose KeyVal has no positive
 * labelID is dropped.
 */
export function decodeMailLabels(
  result: JsonValue | null | undefined,
): readonly MailLabel[] {
  const labels: MailLabel[] = [];
  for (const [, value] of readDictPairs(result)) {
    if (!isKeyValValue(value)) {
      continue;
    }
    const labelID = toNumber(readKeyVal(value, "labelID"));
    if (labelID <= 0) {
      continue;
    }
    labels.push({
      labelID,
      name: String(readKeyVal(value, "name") ?? ""),
      color: toNumber(readKeyVal(value, "color")),
    });
  }
  return labels;
}

/**
 * Decode mailingListsMgr.GetJoinedLists — a dict of listID -> MailingList KeyVal.
 * Empty is a real "in no lists" answer. A list with no positive listID is dropped.
 */
export function decodeJoinedLists(
  result: JsonValue | null | undefined,
): readonly MailingList[] {
  const lists: MailingList[] = [];
  for (const [, value] of readDictPairs(result)) {
    const list = decodeMailingList(value);
    if (list && list.listID > 0) {
      lists.push(list);
    }
  }
  return lists;
}

/**
 * Decode mailingListsMgr.GetInfo — a single MailingList KeyVal, or null for an
 * unknown list (the server builder returns null when the summary is absent).
 */
export function decodeMailingListInfo(
  result: JsonValue | null | undefined,
): MailingList | null {
  return decodeMailingList(result as JsonValue) ?? null;
}

/**
 * Decode mailingListsMgr.GetMembers — a dict of memberID -> accessLevel(int).
 * Empty is a real "no members / unknown list" answer. A member with no positive
 * id is dropped.
 */
export function decodeMailingListMembers(
  result: JsonValue | null | undefined,
): readonly MailingListMember[] {
  const members: MailingListMember[] = [];
  for (const [key, value] of readDictPairs(result)) {
    const memberID = toNumber(key);
    if (memberID <= 0) {
      continue;
    }
    members.push({ memberID, accessLevel: toNumber(value) });
  }
  return members;
}

/**
 * Decode mailingListsMgr.GetSettings — a KeyVal{defaultAccess, defaultMemberAccess,
 * cost, access:dict of entityID -> accessLevel}, or null for an unknown list.
 */
export function decodeMailingListSettings(
  result: JsonValue | null | undefined,
): MailingListSettings | null {
  if (!isKeyValValue(result)) {
    return null;
  }
  const access: MailingListAccessEntry[] = [];
  for (const [key, value] of readDictPairs(readKeyVal(result, "access"))) {
    const entityID = toNumber(key);
    if (entityID <= 0) {
      continue;
    }
    access.push({ entityID, accessLevel: toNumber(value) });
  }
  return {
    defaultAccess: toNumber(readKeyVal(result, "defaultAccess")),
    defaultMemberAccess: toNumber(readKeyVal(result, "defaultMemberAccess")),
    cost: toNumber(readKeyVal(result, "cost")),
    access,
  };
}
