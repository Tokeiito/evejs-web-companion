// Personal contacts / watchlist / blocked owners, decoded to plain rows
// (goal R58, PLUMBING ONLY — no UI).
//
// GET /api/bridge/contact-list returns the raw retail-shaped result of
// charMgr.GetContactList — a util.KeyVal carrying two Rowsets:
//
//   {type:"object", name:"util.KeyVal", args:{type:"dict", entries:[
//     ["addresses", Rowset[contactID, inWatchlist, relationshipID, labelMask]],
//     ["blocked",   Rowset[senderID]]]}}
//
// ⚠ Farmer has no contacts and no blocked owners, so the LIVE capture on
// 2026-07-22 was two EMPTY rowsets (`lines:[]`) — a REAL "no contacts" answer,
// not a failure. The populated `addresses` row shape mirrors the server's
// buildContactRow (charMgrService.js): a bare array
// [contactID, inWatchlist(0|1), relationshipID, labelMask], where labelMask is a
// number or a {type:"long"} wrapper (toMarshalMaskValue). The test fixture pins
// that populated shape so the decoder is proven against real bytes AND the
// server's own builder.
//
// R7d: contactID and senderID (blocked owner) are ENTITY ids kept here as plain
// numeric fields for a future UI to resolve to names — never rendered as numbers,
// never forced into a label. labelMask is a bitmask kept as a bigint-safe decimal
// string (never zeroed by a `typeof === "number"` test on a long wrapper).

import {
  isKeyValValue,
  readKeyVal,
  readRowsetRows,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";
import { toAmountString } from "./rewards.ts";

/** One personal contact. */
export interface Contact {
  readonly contactID: number;
  readonly inWatchlist: boolean;
  readonly relationshipID: number;
  /** The label bitmask as a bigint-safe decimal string ("0" when none). */
  readonly labelMask: string;
}

/** One blocked owner (an entity whose mail is blocked). */
export interface BlockedOwner {
  readonly senderID: number;
}

/** The decoded contact list: contacts (with watchlist flag) + blocked owners. */
export interface ContactList {
  readonly contacts: readonly Contact[];
  readonly blocked: readonly BlockedOwner[];
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

/** A retail 0|1 (or boolean) flag → boolean. */
function toBoolean(value: JsonValue | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return toNumber(value) !== 0;
}

/**
 * Decode charMgr.GetContactList. Both rowsets are read through readRowsetRows,
 * which tolerates the bare-array line shape these rows use. A contact with no
 * positive contactID is dropped; a blocked row with no positive senderID is
 * dropped. Two empty rowsets is a real "no contacts / none blocked" answer.
 */
export function decodeContactList(result: JsonValue | null | undefined): ContactList {
  if (!isKeyValValue(result)) {
    return { contacts: [], blocked: [] };
  }
  const contacts: Contact[] = [];
  for (const row of readRowsetRows(readKeyVal(result, "addresses"))) {
    const contactID = toNumber(row.contactID);
    if (contactID <= 0) {
      continue;
    }
    contacts.push({
      contactID,
      inWatchlist: toBoolean(row.inWatchlist),
      relationshipID: toNumber(row.relationshipID),
      labelMask: toAmountString(row.labelMask) ?? "0",
    });
  }
  const blocked: BlockedOwner[] = [];
  for (const row of readRowsetRows(readKeyVal(result, "blocked"))) {
    const senderID = toNumber(row.senderID);
    if (senderID > 0) {
      blocked.push({ senderID });
    }
  }
  return { contacts, blocked };
}
