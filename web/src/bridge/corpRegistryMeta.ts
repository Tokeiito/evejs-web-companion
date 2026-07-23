// R80 — decoding the corpRegistry TITLES / LABELS / CONTACTS / BULLETINS reads plus
// the character INFO-WINDOW read (PLUMBING ONLY — no UI). Captured live from Farmer
// (corp 98000001) on 2026-07-22; the empty shapes are real-captured (Farmer's corp
// seeds no labels/contacts/bulletins), and the populated-row structure is the same
// server builder (buildDbIndexRowset / buildDbRowset / buildContactKeyVal) that
// produced the captured descriptors, so the columns are identical — only rows differ.
//
//   • GetTitles()             -> a CIndexedRowset keyed by titleID; rows on `dict` as
//     [titleID, packedrow(values)]. The default 16-title scheme (1,2,4,…,32768) ships
//     even for an empty corp, with empty titleName and zero role masks.
//   • GetLabels()             -> a CIndexedRowset keyed by labelID (empty for Farmer).
//   • GetCorporateContacts()  -> a bare dict {contactID -> util.KeyVal} (empty).
//   • GetBulletins()          -> a CRowset; rows on `list` as packedrow(fields) (empty).
//   • GetInfoWindowDataForChar([charID]) -> a util.KeyVal (corpID/allianceID/factionID/
//     the char's title + title1..title16 name scheme). ⚠ CROSS-CHARACTER: args[0] is a
//     caller-chosen charID and the corp is derived from THAT char — a foreign charID
//     returns a foreign corp's identity + title scheme (flagged; see the leak handoff).
//
// ⚠ VALUE ENCODING: title role masks cross as {type:"long"}; the char info-window /
// contact / bulletin values are plain ints/strings and FILETIMEs are decimal strings.
// All ids and role bitmasks stay as data (R7d); nothing is forced into a label.

import {
  readDictPairs,
  readKeyVal,
  readRowField,
  type JsonValue,
} from "./wire.ts";
import { toBigDecimalString } from "./corpMembers.ts";

/** One corp title definition (GetTitles). */
export interface CorpTitle {
  readonly titleID: number;
  readonly titleName: string;
  readonly roles: string | null;
  readonly grantableRoles: string | null;
  readonly rolesAtHQ: string | null;
  readonly grantableRolesAtHQ: string | null;
  readonly rolesAtBase: string | null;
  readonly grantableRolesAtBase: string | null;
  readonly rolesAtOther: string | null;
  readonly grantableRolesAtOther: string | null;
}

/** One contact label (GetLabels). */
export interface CorpLabel {
  /** May exceed 2^53 (bitmask id) — raw decimal string. */
  readonly labelID: string | null;
  readonly name: string;
  readonly color: number;
}

/** One corporate contact (GetCorporateContacts). */
export interface CorpContact {
  readonly contactID: number;
  readonly relationshipID: number;
  /** Label bitmask — raw decimal string (may exceed 2^53). */
  readonly labelMask: string | null;
  readonly inWatchlist: boolean;
}

/** One corp bulletin (GetBulletins). */
export interface CorpBulletin {
  readonly bulletinID: number;
  readonly ownerID: number;
  readonly createCharacterID: number;
  readonly createDateTime: string | null;
  readonly editCharacterID: number;
  readonly editDateTime: string | null;
  readonly title: string;
  readonly body: string;
  readonly sortOrder: number;
}

/** The character info-window corp data (GetInfoWindowDataForChar). */
export interface CharInfoWindow {
  readonly corpID: number | null;
  readonly allianceID: number | null;
  readonly factionID: number | null;
  readonly title: string;
  /** title1..title16 corp title-scheme names, in order (index 0 = title1). */
  readonly titleScheme: readonly string[];
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumOrNull(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (isRecord(value) && value.type === "long") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "number") return inner;
    if (typeof inner === "string" && /^-?\d+$/.test(inner)) return Number(inner);
  }
  return null;
}

function toNum(value: JsonValue | undefined): number {
  return toNumOrNull(value) ?? 0;
}

function toStr(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * The [key, packedrow] pairs of an objectex2 CIndexedRowset: they live on `dict`.
 * `[]` for a non-indexed-rowset or an empty one.
 */
function cindexedPairs(
  rowset: JsonValue | null | undefined,
): readonly (readonly [JsonValue, JsonValue])[] {
  if (isRecord(rowset) && Array.isArray((rowset as { dict?: unknown }).dict)) {
    return ((rowset as { dict: readonly JsonValue[] }).dict).filter(
      (entry): entry is readonly [JsonValue, JsonValue] =>
        Array.isArray(entry) && entry.length >= 2,
    );
  }
  return [];
}

/** The rows of an objectex2 CRowset: they live on `list`. */
function crowsetRows(rowset: JsonValue | null | undefined): readonly JsonValue[] {
  if (isRecord(rowset) && Array.isArray((rowset as { list?: unknown }).list)) {
    return (rowset as { list: readonly JsonValue[] }).list;
  }
  return [];
}

/**
 * Decode corpRegistry.GetTitles -> the session corp's title definitions, in dict
 * order. A row with no titleID is dropped. The default 16-title scheme is a real
 * populated answer even for a fresh corp.
 */
export function decodeCorpTitles(result: JsonValue | null | undefined): CorpTitle[] {
  const titles: CorpTitle[] = [];
  for (const [, row] of cindexedPairs(result)) {
    const titleID = toNum(readRowField(row, "titleID"));
    if (titleID <= 0) {
      continue;
    }
    titles.push({
      titleID,
      titleName: toStr(readRowField(row, "titleName")),
      roles: toBigDecimalString(readRowField(row, "roles")),
      grantableRoles: toBigDecimalString(readRowField(row, "grantableRoles")),
      rolesAtHQ: toBigDecimalString(readRowField(row, "rolesAtHQ")),
      grantableRolesAtHQ: toBigDecimalString(readRowField(row, "grantableRolesAtHQ")),
      rolesAtBase: toBigDecimalString(readRowField(row, "rolesAtBase")),
      grantableRolesAtBase: toBigDecimalString(readRowField(row, "grantableRolesAtBase")),
      rolesAtOther: toBigDecimalString(readRowField(row, "rolesAtOther")),
      grantableRolesAtOther: toBigDecimalString(readRowField(row, "grantableRolesAtOther")),
    });
  }
  return titles;
}

/**
 * Decode corpRegistry.GetLabels -> the session corp's contact labels. `[]` is a real
 * "no labels" answer (Farmer's corp seeds none — verified live).
 */
export function decodeCorpLabels(result: JsonValue | null | undefined): CorpLabel[] {
  const labels: CorpLabel[] = [];
  for (const [, row] of cindexedPairs(result)) {
    labels.push({
      labelID: toBigDecimalString(readRowField(row, "labelID")),
      name: toStr(readRowField(row, "name")),
      color: toNum(readRowField(row, "color")),
    });
  }
  return labels;
}

/**
 * Decode corpRegistry.GetCorporateContacts -> the session corp's contacts, keyed by
 * contactID in the wire dict. `[]` is a real "no contacts" answer (empty live).
 */
export function decodeCorpContacts(result: JsonValue | null | undefined): CorpContact[] {
  const contacts: CorpContact[] = [];
  for (const [, keyVal] of readDictPairs(result)) {
    const contactID = toNum(readKeyVal(keyVal, "contactID"));
    if (contactID <= 0) {
      continue;
    }
    contacts.push({
      contactID,
      relationshipID: toNum(readKeyVal(keyVal, "relationshipID")),
      labelMask: toBigDecimalString(readKeyVal(keyVal, "labelMask")),
      inWatchlist: toNum(readKeyVal(keyVal, "inWatchlist")) !== 0,
    });
  }
  return contacts;
}

/**
 * Decode corpRegistry.GetBulletins -> the session corp's bulletins (CRowset rows on
 * `list`). A row with no bulletinID is dropped. `[]` is a real "no bulletins" answer.
 */
export function decodeCorpBulletins(result: JsonValue | null | undefined): CorpBulletin[] {
  const bulletins: CorpBulletin[] = [];
  for (const row of crowsetRows(result)) {
    const bulletinID = toNum(readRowField(row, "bulletinID"));
    if (bulletinID <= 0) {
      continue;
    }
    bulletins.push({
      bulletinID,
      ownerID: toNum(readRowField(row, "ownerID")),
      createCharacterID: toNum(readRowField(row, "createCharacterID")),
      createDateTime: toBigDecimalString(readRowField(row, "createDateTime")),
      editCharacterID: toNum(readRowField(row, "editCharacterID")),
      editDateTime: toBigDecimalString(readRowField(row, "editDateTime")),
      title: toStr(readRowField(row, "title")),
      body: toStr(readRowField(row, "body")),
      sortOrder: toNum(readRowField(row, "sortOrder")),
    });
  }
  return bulletins;
}

/**
 * Decode corpRegistry.GetInfoWindowDataForChar -> the corp identity + title scheme for
 * the requested character. ⚠ CROSS-CHARACTER: the corp is the TARGET char's corp, not
 * the caller's (a foreign charID returns a foreign corp's identity — flagged leak).
 * null when the value is not a KeyVal.
 */
export function decodeCharInfoWindow(
  result: JsonValue | null | undefined,
): CharInfoWindow | null {
  if (!isRecord(result) || result.type !== "object" || result.name !== "util.KeyVal") {
    return null;
  }
  const titleScheme: string[] = [];
  for (let index = 1; index <= 16; index += 1) {
    titleScheme.push(toStr(readKeyVal(result, `title${index}`)));
  }
  return {
    corpID: toNumOrNull(readKeyVal(result, "corpID")),
    allianceID: toNumOrNull(readKeyVal(result, "allianceID")),
    factionID: toNumOrNull(readKeyVal(result, "factionID")),
    title: toStr(readKeyVal(result, "title")),
    titleScheme,
  };
}
