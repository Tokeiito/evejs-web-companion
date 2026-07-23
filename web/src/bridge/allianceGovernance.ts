// R84 — decoding the allianceRegistry GOVERNANCE reads (contacts / applications /
// bulletins; PLUMBING ONLY — no UI). Captured live on 2026-07-22. Every read is
// STRICTLY SESSION-SCOPED and ignores args, so a browser only ever sees its OWN
// alliance's governance data (verified live: as Farmer, alliance-less, INJECTING a
// foreign allianceID 99000000 returned his own empty state, never Elysian's). As
// Test Two (corp 98000000, a member of Elysian 99000000) the alliance is seeded but
// carries no contacts / applications / bulletins, so the LIVE shapes are the empty
// forms; the populated fixtures in the test mirror the server builders exactly
// (buildDict / buildAllianceApplicationsIndexRowset / buildBulletinRow) — noted plainly.
//
//   • GetAllianceContacts -> a bare marshaled dict {contactID -> util.KeyVal(contactID
//       / relationshipID / labelMask)}.
//   • GetApplications -> an IndexRowset (eve.common.script.sys.rowset.IndexRowset) whose
//       rows live under "items" (a dict keyed by corporationID), each a list of
//       [allianceID, corporationID, applicationText, state, applicationDateTime].
//   • GetBulletins -> a list of blue.DBRow packed rows (bulletinID / ownerID /
//       createDateTime / editDateTime / editCharacterID / title / body / sortOrder).
//
// ⚠ VALUE ENCODING: contact / corp / char ids stay as data (R7d), plain numbers (< 2^53).
// FILETIMEs (applicationDateTime, create/edit DateTime) are kept as raw decimal STRINGS
// (they exceed 2^53). state / relationshipID / labelMask / sortOrder are small ints.

import {
  isListValue,
  readDictPairs,
  readRowField,
  type JsonValue,
} from "./wire.ts";
import {
  isRecord,
  longToDecimalString,
  toNum,
  toNumOrNull,
  toStr,
} from "./allianceInfo.ts";

/** One alliance standings-contact (GetAllianceContacts). */
export interface AllianceContact {
  readonly contactID: number | null;
  readonly relationshipID: number;
  readonly labelMask: number;
}

/** One incoming corp application (GetApplications). */
export interface AllianceApplication {
  readonly allianceID: number | null;
  readonly corporationID: number | null;
  readonly applicationText: string;
  readonly state: number;
  /** FILETIME — raw decimal string (may exceed 2^53). */
  readonly applicationDateTime: string | null;
}

/** One alliance bulletin (GetBulletins). */
export interface AllianceBulletin {
  readonly bulletinID: number | null;
  readonly ownerID: number | null;
  /** FILETIME — raw decimal string. */
  readonly createDateTime: string | null;
  /** FILETIME — raw decimal string. */
  readonly editDateTime: string | null;
  readonly editCharacterID: number | null;
  readonly title: string;
  readonly body: string;
  readonly sortOrder: number;
}

/**
 * Decode allianceRegistry.GetAllianceContacts -> the alliance's standings contacts.
 * The wire value is a BARE dict {contactID -> KeyVal}; `[]` is a real "no contacts /
 * alliance-less session" answer (verified live for both Farmer and Elysian).
 */
export function decodeAllianceContacts(
  result: JsonValue | null | undefined,
): AllianceContact[] {
  return readDictPairs(result).map(([key, value]) => ({
    // The dict key is the contactID (a wire number); the KeyVal repeats it.
    contactID: toNumOrNull(readRowField(value, "contactID") ?? (key as JsonValue)),
    relationshipID: toNum(readRowField(value, "relationshipID")),
    labelMask: toNum(readRowField(value, "labelMask")),
  }));
}

/**
 * Read the rows of an IndexRowset — the OTHER rowset shape on this wire. Unlike a
 * util.Rowset (rows under "lines"), an IndexRowset keeps its rows under "items", a dict
 * keyed by idName; each value is a {type:"list"} of cells positioned against `columns`
 * (falling back to `header`). `[]` when the value is not an IndexRowset or has no columns.
 */
function readIndexRowsetRows(
  result: JsonValue | null | undefined,
): readonly Readonly<Record<string, JsonValue>>[] {
  if (!isRecord(result) || result.type !== "object") {
    return [];
  }
  const args = result.args;
  if (!isRecord(args) || args.type !== "dict" || !Array.isArray(args.entries)) {
    return [];
  }
  const entries = args.entries as readonly JsonValue[];
  const byKey = (key: string): JsonValue | undefined => {
    const entry = entries.find((e) => Array.isArray(e) && e[0] === key);
    return Array.isArray(entry) ? (entry[1] as JsonValue) : undefined;
  };
  const columnsValue = byKey("columns") ?? byKey("header");
  const columns = isListValue(columnsValue)
    ? columnsValue.items.map((c) => (typeof c === "string" ? c : String(c)))
    : [];
  if (columns.length === 0) {
    return [];
  }
  return readDictPairs(byKey("items")).map(([, line]) => {
    const cells: readonly JsonValue[] = isListValue(line)
      ? line.items
      : Array.isArray(line)
        ? line
        : [];
    const record: Record<string, JsonValue> = {};
    columns.forEach((column, index) => {
      record[column] = (cells[index] ?? null) as JsonValue;
    });
    return record;
  });
}

/**
 * Decode allianceRegistry.GetApplications -> the alliance's incoming corp applications.
 * `[]` is a real "no pending applications / alliance-less" answer (verified live).
 */
export function decodeAllianceApplications(
  result: JsonValue | null | undefined,
): AllianceApplication[] {
  return readIndexRowsetRows(result).map((row) => ({
    allianceID: toNumOrNull(row.allianceID),
    corporationID: toNumOrNull(row.corporationID),
    applicationText: toStr(row.applicationText),
    state: toNum(row.state),
    applicationDateTime: longToDecimalString(row.applicationDateTime),
  }));
}

/**
 * Decode allianceRegistry.GetBulletins -> the alliance's bulletins, already in the
 * server's sortOrder. `[]` is a real "no bulletins / alliance-less" answer. Rows are
 * blue.DBRow packed rows, read through readRowField (never readKeyVal — a packedrow is
 * NOT a KeyVal and would silently decode to nothing).
 */
export function decodeAllianceBulletins(
  result: JsonValue | null | undefined,
): AllianceBulletin[] {
  if (!isListValue(result)) {
    return [];
  }
  return result.items.map((row) => ({
    bulletinID: toNumOrNull(readRowField(row, "bulletinID")),
    ownerID: toNumOrNull(readRowField(row, "ownerID")),
    createDateTime: longToDecimalString(readRowField(row, "createDateTime")),
    editDateTime: longToDecimalString(readRowField(row, "editDateTime")),
    editCharacterID: toNumOrNull(readRowField(row, "editCharacterID")),
    title: toStr(readRowField(row, "title")),
    body: toStr(readRowField(row, "body")),
    sortOrder: toNum(readRowField(row, "sortOrder")),
  }));
}
