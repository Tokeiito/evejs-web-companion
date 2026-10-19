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
import { readDictPairs, readKeyVal, readRowField, readRowsetRows, unwrapBool, unwrapLong, unwrapReal, type JsonValue } from "./wire.ts";

/** The two ContactsForm owners currently drawn by the page. */
export type ContactScope = "contact" | "corpcontact" | "alliancecontact";

/** One of the pilot's contacts. */
export interface Contact {
  readonly contactID: number;
  readonly inWatchlist: boolean;
  /** The contact standing: five levels for personal contacts, tenths from -10 to +10 for corporation contacts. */
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

/** One of the pilot's contact labels (charMgr.GetLabels): its bit, its name and its colour, none where it has none. */
export interface ContactLabel {
  readonly labelID: bigint;
  readonly name: string;
  readonly color: number | null;
}

/**
 * charMgr.GetLabels' answer: a dict of the labels by their bits, each a util.KeyVal (labelID, name, color), in the
 * order the client's dict goes through them. A label marked static is none of the pilot's own, and the form shows
 * none (contactsForm.py GetLabelsSubContent, 195 to 213).
 */
export function contactLabelsOf(answer: JsonValue): readonly ContactLabel[] {
  const labels: ContactLabel[] = [];
  // corpRegistry.GetLabels answers a CIndexedRowset: its DBRows live in objectex2.dict.
  const indexed = answer !== null && typeof answer === "object" && !Array.isArray(answer)
    ? (answer as { dict?: readonly (readonly [JsonValue, JsonValue])[] }).dict : undefined;
  for (const [key, value] of indexed ?? readDictPairs(answer)) {
    const field = (name: string) => readKeyVal(value, name) ?? readRowField(value, name);
    const labelID = unwrapLong(field("labelID") ?? key);
    const name = field("name");
    if (labelID === null || labelID <= 0n || field("static") === true) {
      continue;
    }
    const color = field("color");
    labels.push({ labelID, name: typeof name === "string" ? name : "", color: typeof color === "number" ? color : null });
  }
  const order = pyIntDictOrder(labels.map((label) => Number(label.labelID)));
  return order.flatMap((labelID) => labels.filter((label) => Number(label.labelID) === labelID));
}

/** ContactsForm.CheckHasLabel (335 to 343): "No Label" (-1) holds those with none; a label, those with its bit. */
export function hasContactLabel(labelID: bigint, labelMask: bigint): boolean {
  if (labelID === -1n) {
    return labelMask === 0n;
  }
  return (labelMask & labelID) === labelID;
}

/** appConst.maxLong: every bit a label may have. */
export const MAX_LONG = 9_223_372_036_854_775_807n;

/** Names in the order SortListOfTuples gives them by the key made of each. */
const byKey = <T>(items: readonly T[], key: (item: T) => string): T[] =>
  items.map((item, place) => ({ item, place, key: key(item) }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : left.place - right.place))
    .map(({ item }) => item);

/**
 * addressbookService.GetAssignLabelMenu (1149 to 1167): the labels not every one of the entries has (their masks'
 * AND, from maxLong), by name in lower case. An entry with no mask leaves the AND as it is.
 */
export function labelsToAssign(masks: readonly (bigint | null)[], labels: readonly ContactLabel[]): ContactLabel[] {
  const all = masks.reduce<bigint>((mask, each) => (each === null ? mask : mask & each), MAX_LONG);
  return byKey(labels.filter((label) => (all & label.labelID) !== label.labelID), (label) => label.name.toLowerCase());
}

/** GetRemoveLabelMenu (1169 to 1187): the labels any of the entries has (their masks' OR), by name as it is. */
export function labelsToRemove(masks: readonly (bigint | null)[], labels: readonly ContactLabel[]): ContactLabel[] {
  const any = masks.reduce<bigint>((mask, each) => (each === null ? mask : mask | each), 0n);
  return byKey(labels.filter((label) => (any & label.labelID) === label.labelID), (label) => label.name);
}

/** GetLabelNameList (1204 to 1213; mailSvc.GetLabelMaskAsList): the names of the pilot's labels a mask has, by name in lower case. */
export function labelNamesOf(labelMask: bigint, labels: readonly ContactLabel[]): string[] {
  return labelsOf(labelMask, labels).map((label) => label.name);
}

/** The pilot's labels a mask has, by name in lower case (GetLabelNameList, as above). */
export function labelsOf(labelMask: bigint, labels: readonly ContactLabel[]): ContactLabel[] {
  return byKey(labels.filter((label) => label.labelID > 0n && (labelMask & label.labelID) === label.labelID), (label) => label.name.toLowerCase());
}

/** The labels' colours, which the contacts' labels share with the mail's (bridge/labelSwatches.ts). */
export { SWATCH_COLORS, labelSwatch } from "./labelSwatches.ts";

/** A mask with bits taken off it, as the client takes them (labelMask & const.maxLong - labelID: 1084, 1145). */
export function labelMaskWithout(labelMask: bigint, bits: bigint): bigint {
  return labelMask & (MAX_LONG - bits);
}

/**
 * A label's bit, or a sum of them, as the page sends it: a number where a number holds it exactly, and past that
 * the text of its digits, which the game port's table sends as a long.
 */
export function labelBitsSent(bits: bigint): number | string {
  return bits <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bits) : bits.toString();
}

/** charMgr.CreateLabel's answer: the new label's bit, or null for what is none. */
export function createdLabelOf(answer: JsonValue): bigint | null {
  const bits = typeof answer === "number" && Number.isSafeInteger(answer) ? BigInt(answer) : unwrapLong(answer);
  return bits !== null && bits > 0n ? bits : null;
}

/** onlineStatus.GetInitialState's answer, indexed by contactID as the client's service indexes it: online or not. */
export function onlineStatesOf(answer: JsonValue): Readonly<Record<number, boolean>> {
  const online: Record<number, boolean> = {};
  for (const row of rowsOf(answer)) {
    const contactID = wholeOf(fieldOf(row, "contactID"));
    const state = fieldOf(row, "online");
    if (contactID !== null && contactID > 0) {
      online[contactID] = (typeof state === "number" ? state !== 0 : unwrapBool(state)) ?? false;
    }
  }
  return online;
}

/** What the contact management window sends (ContactManagementWnd.Confirm: contactManagementWindow.py 146 to 160). */
export interface ContactWrite {
  readonly contactID: number;
  /** One of five personal standings, or a corporation standing rounded to one decimal. */
  readonly relationshipID: number;
  readonly inWatchlist: boolean;
  readonly sendNotification: boolean;
  /** What is typed in the message's editor, sent as its markup. */
  readonly message: string;
  /** Whether the owner is a character, whose online state the service keeps where it is a buddy. */
  readonly isCharacter: boolean;
}

/** A contact with its name, as the client's entries show one (cfg.eveowners). */
export interface NamedContact extends Contact {
  readonly name: string;
}

/** The address book with every contact and blocked owner named, for the Contacts window. */
export interface NamedAddressBook {
  readonly contacts: readonly NamedContact[];
  readonly blocked: readonly { readonly ownerID: number; readonly name: string }[];
  /** The pilot's contact labels; null where they could not be read. */
  readonly labels: readonly ContactLabel[] | null;
  /** The agents among the addresses, kept apart as the address book keeps them (addressbookService.py 222 to 232), named. */
  readonly agents: readonly { readonly agentID: number; readonly name: string }[];
}

/**
 * The Agents tab's folders, as the client's registry keeps them for the character (carbonui/services/registry.py
 * GetAllGroups: settings.char.ui 'listgroups', under 'agentgroups'): the locked "All Agents" group's open state,
 * and each folder the pilot made, its name, the agents put in it and whether it is open.
 */
export interface AgentFolder {
  /** The folder's key (registry.AddListGroup: the wallclock time it was made, as text). */
  readonly id: string;
  readonly label: string;
  readonly groupItems: readonly number[];
  readonly open: boolean;
}
export interface AgentFolders {
  readonly allOpen: boolean;
  readonly folders: readonly AgentFolder[];
}

/** What was kept of the folders, read back; none for anything that is not. "All Agents" is open where nothing says otherwise (ShowAgents). */
export function agentFoldersOf(kept: unknown): AgentFolders {
  const held = typeof kept === "object" && kept !== null ? (kept as { allOpen?: unknown; folders?: unknown }) : {};
  const folders = Array.isArray(held.folders) ? held.folders : [];
  return {
    allOpen: held.allOpen !== false,
    folders: folders.flatMap((each): AgentFolder[] => {
      const folder = typeof each === "object" && each !== null ? (each as Record<string, unknown>) : {};
      if (typeof folder.id !== "string" || typeof folder.label !== "string") return [];
      const items = Array.isArray(folder.groupItems) ? folder.groupItems.filter((id): id is number => Number.isSafeInteger(id) && (id as number) > 0) : [];
      return [{ id: folder.id, label: folder.label, groupItems: [...new Set(items)], open: folder.open === true }];
    }),
  };
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

/** addressbook.GetContacts: corporation contacts are a dict of KeyVals, without personal agents or blocked owners. */
export function corporateAddressBookOf(answer: JsonValue): AddressBook {
  const contacts = readDictPairs(answer).flatMap(([key, row]): Contact[] => {
    const contactID = wholeOf(readKeyVal(row, "contactID") ?? key);
    if (contactID === null || contactID <= 0) return [];
    const standing = readKeyVal(row, "relationshipID");
    return [{ contactID, relationshipID: (typeof standing === "number" ? standing : unwrapReal(standing)) ?? 0,
      labelMask: unwrapLong(readKeyVal(row, "labelMask")) ?? 0n, inWatchlist: false }];
  });
  return { contacts: pyIntDictOrder(contacts.map(row => row.contactID)).flatMap(id => contacts.filter(row => row.contactID === id)), blocked: [], agents: [] };
}

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
