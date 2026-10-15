// The pilot's contacts, as the client's address book holds them (addressbookService.py GetContacts, 193 to 250).
//
// charMgr.GetContactList() answers a util.KeyVal of two rowsets: `addresses` (contactID, inWatchlist,
// relationshipID, labelMask) and `blocked` (senderID). Tranquility's are CRowsets of DBRows (the client's log of a
// login: `[<DBRow object [3009846, False, 0.0, 0L]>]`); a server that answers util.Rowsets is read the same.
//
// The address book keeps every address but an NPC character's, which is an agent's and kept apart (222 to 232),
// and every blocked owner but nought (234 to 238). The client's dict of contacts is keyed by the contact: its
// order is CPython's for those keys (bridge/pyDict.ts), which is the order its users go through it in.

import { pyIntDictOrder } from "./pyDict.ts";
import { readKeyVal, readRowField, readRowsetRows, unwrapBool, unwrapLong, unwrapReal, type JsonValue } from "./wire.ts";

/** One of the pilot's contacts. */
export interface Contact {
  readonly contactID: number;
  readonly inWatchlist: boolean;
  /** The standing the pilot gave the contact (+10, +5, 0, -5, -10). */
  readonly relationshipID: number;
  readonly labelMask: bigint;
}

/** What the address book keeps of charMgr.GetContactList. */
export interface AddressBook {
  /** The contacts, in the order the client's dict goes through them. */
  readonly contacts: readonly Contact[];
  /** The agents among the addresses (NPC characters, 3000000 to 3999999), apart. */
  readonly agents: readonly number[];
  /** The blocked owners, in the order the client's dict goes through them. */
  readonly blocked: readonly number[];
}

/** A contact with its name, as the client's entries show one (cfg.eveowners). */
export interface NamedContact extends Contact {
  readonly name: string;
}

/** The address book with every contact and blocked owner named, for the Contacts window. */
export interface NamedAddressBook {
  readonly contacts: readonly NamedContact[];
  readonly blocked: readonly { readonly ownerID: number; readonly name: string }[];
}

/** appConst's contact groups (1864 to 1872): the five standings, and the window's own groups. */
export const CONTACT_STANDING = Object.freeze({ high: 10, good: 5, neutral: 0, bad: -5, horrible: -10 });
export const CONTACT_GROUP = Object.freeze({ all: 100, blocked: 200, watchlist: 300, notifications: 400 });
/** appConst.maxContactsPerPage. */
export const MAX_CONTACTS_PER_PAGE = 50;

/** ContactsForm.CheckInGroup (contactsForm.py 317 to 334): whether a standing is in one of the five standing groups. */
export function inStandingGroup(groupID: number, relationshipID: number): boolean {
  switch (groupID) {
    case CONTACT_STANDING.high:
      return relationshipID > CONTACT_STANDING.good;
    case CONTACT_STANDING.good:
      return relationshipID > CONTACT_STANDING.neutral && relationshipID <= CONTACT_STANDING.good;
    case CONTACT_STANDING.neutral:
      return relationshipID === CONTACT_STANDING.neutral;
    case CONTACT_STANDING.bad:
      return relationshipID < CONTACT_STANDING.neutral && relationshipID >= CONTACT_STANDING.bad;
    case CONTACT_STANDING.horrible:
      return relationshipID < CONTACT_STANDING.bad;
    default:
      return false;
  }
}

/** idCheckers.IsNPCCharacter: an agent's range (minAgent, maxAgent). */
const isNpcCharacter = (ownerID: number): boolean => ownerID >= 3_000_000 && ownerID <= 3_999_999;

/** A rowset's rows, a CRowset's (its DBRows on `list`) or a util.Rowset's. */
function rowsOf(rowset: JsonValue | undefined): readonly unknown[] {
  if (typeof rowset === "object" && rowset !== null && !Array.isArray(rowset)) {
    const list = (rowset as { list?: unknown }).list;
    if (Array.isArray(list)) {
      return list;
    }
  }
  return readRowsetRows(rowset);
}

/** A row's column, whether the row is a DBRow or a util.Rowset's record. */
function fieldOf(row: unknown, key: string): JsonValue | undefined {
  const read = readRowField(row, key);
  if (read !== undefined) {
    return read;
  }
  return typeof row === "object" && row !== null && !Array.isArray(row) && key in row ? (row as Record<string, JsonValue>)[key] : undefined;
}

const wholeOf = (value: JsonValue | undefined): number | null => {
  const whole = typeof value === "number" ? value : value === undefined ? null : unwrapLong(value);
  const id = whole === null ? Number.NaN : Number(whole);
  return Number.isSafeInteger(id) ? id : null;
};

/** charMgr.GetContactList's answer, as the address book keeps it; an answer that is not one keeps nothing. */
export function addressBookOf(answer: JsonValue): AddressBook {
  const contacts = new Map<number, Contact>();
  const agents: number[] = [];
  for (const row of rowsOf(readKeyVal(answer, "addresses"))) {
    const contactID = wholeOf(fieldOf(row, "contactID"));
    if (contactID === null || contactID <= 0) {
      continue;
    }
    if (isNpcCharacter(contactID)) {
      agents.push(contactID);
      continue;
    }
    const watch = fieldOf(row, "inWatchlist");
    const standing = fieldOf(row, "relationshipID");
    const mask = fieldOf(row, "labelMask");
    contacts.set(contactID, {
      contactID,
      inWatchlist: (typeof watch === "number" ? watch !== 0 : unwrapBool(watch)) ?? false,
      relationshipID: (typeof standing === "number" ? standing : unwrapReal(standing)) ?? 0,
      labelMask: (typeof mask === "number" && Number.isSafeInteger(mask) ? BigInt(mask) : unwrapLong(mask)) ?? 0n,
    });
  }
  const blocked: number[] = [];
  for (const row of rowsOf(readKeyVal(answer, "blocked"))) {
    const senderID = wholeOf(fieldOf(row, "senderID"));
    if (senderID !== null && senderID !== 0 && !blocked.includes(senderID)) {
      blocked.push(senderID);
    }
  }
  return {
    contacts: pyIntDictOrder([...contacts.keys()]).flatMap((contactID) => {
      const contact = contacts.get(contactID);
      return contact === undefined ? [] : [contact];
    }),
    agents,
    blocked: pyIntDictOrder(blocked),
  };
}
