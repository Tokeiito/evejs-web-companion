// War reads decoded to plain rows (goal R66, PLUMBING ONLY — no UI).
//
// GET /api/bridge/wars bundles the warsInfoMgr reads. Wars are PUBLIC EVE data (a
// declaration is public knowledge) — the war records carry NO operational-calendar
// field like the structure reads had. Built from bytes captured LIVE from Farmer
// (corp 98000001) on 2026-07-22, cross-checked against the server builders (eve.js
// .../corporation/warsInfoMgrService.js).
//
// ⚠ Farmer's corp is in NO war and none is seeded, so every LIVE capture was the
// EMPTY path: GetWarsByOwnerID / GetTop50 returned a CachedMethodCallResult
// wrapping a CRowset with an EMPTY row list; GetWarsByOwners returned
// {98000001 -> {}} (a per-owner dict whose inner war dict is empty);
// GetWarsRequiringAssistance / GetWarsForStructure returned empty lists;
// GetPublicWarInfo returned null for an unknown warID. Those empty paths are
// asserted directly in the test; the POPULATED shapes below mirror the server's
// own buildWarPayload (KeyVal reads) and buildWarRowset (CRowset reads), captured
// descriptor and all, so the decoders are proven against the emitted shape.
//
// ⚠ TWO WIRE SHAPES for a war:
//   • buildWarPayload -> util.KeyVal (GetWarsByOwners inner values,
//     GetWarsRequiringAssistance, GetWarsForStructure, GetPublicWarInfo). Carries
//     warHQID, reward and an allies dict.
//   • buildWarRowset -> a CRowset of 17-column packedrows (GetWarsByOwnerID,
//     GetTop50), wrapped in a CachedMethodCallResult. Carries warHQ /
//     canBeRetracted / reasonEnded / noOfAllies / reasonStarted instead. The two
//     are decoded by decodeWar (KeyVal) and decodeWarRows (CRowset) respectively.
//
// R7d: every id (warID / declaredByID / againstID / retractedBy / billID / warHQID
// / allyID) survives as a numeric field; none is forced into a label. FILETIMEs
// (timeDeclared / timeStarted / timeFinished / retracted) are bigint-safe. reward
// is a bigint-safe ISK decimal string.

import { isListValue, readDictPairs, readRowField, unwrapLong, type JsonValue } from "./wire.ts";
import { toAmountString } from "./rewards.ts";
import { unwrapCachedResult } from "./market.ts";

/** One ally standing beside a war participant. */
export interface WarAlly {
  readonly allyID: number;
  readonly timeStarted: bigint | null;
  readonly timeFinished: bigint | null;
}

/** A war as the KeyVal payload (buildWarPayload) shape. */
export interface War {
  readonly warID: number;
  readonly declaredByID: number;
  readonly againstID: number;
  readonly warHQID: number | null;
  readonly timeDeclared: bigint | null;
  readonly timeStarted: bigint | null;
  readonly timeFinished: bigint | null;
  readonly retracted: bigint | null;
  readonly retractedBy: number | null;
  readonly billID: number | null;
  readonly mutual: boolean;
  readonly openForAllies: boolean;
  readonly createdFromWarID: number | null;
  /** The ally reward, a bigint-safe ISK decimal string. */
  readonly reward: string;
  readonly allies: readonly WarAlly[];
}

/** A war as the CRowset row (buildWarRowset) shape — the 17-column packedrow. */
export interface WarRow {
  readonly warID: number;
  readonly declaredByID: number;
  readonly againstID: number;
  readonly timeDeclared: bigint | null;
  readonly timeFinished: bigint | null;
  readonly retracted: bigint | null;
  readonly retractedBy: number | null;
  readonly timeStarted: bigint | null;
  readonly billID: number | null;
  readonly mutual: boolean;
  readonly createdFromWarID: number | null;
  readonly openForAllies: boolean;
  readonly canBeRetracted: boolean;
  readonly reasonEnded: number;
  readonly warHQ: number | null;
  readonly noOfAllies: number;
  readonly reasonStarted: number;
}

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

/** A positive entity id, or null when absent/zero. */
function toOptionalID(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const id = toNumber(value);
  return id > 0 ? id : null;
}

/** A FILETIME as a bigint; null when absent or a zero sentinel. */
function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/** A boolean from a wire field — a real bool or the number 1. */
function toBool(value: JsonValue | undefined): boolean {
  return value === true || toNumber(value) === 1;
}

/** Decode the allies dict of a war KeyVal into plain ally rows. */
function decodeAllies(value: JsonValue | undefined): WarAlly[] {
  const allies: WarAlly[] = [];
  for (const [, ally] of readDictPairs(value)) {
    const allyID = toOptionalID(readRowField(ally, "allyID"));
    if (allyID === null) {
      continue;
    }
    allies.push({
      allyID,
      timeStarted: toFiletime(readRowField(ally, "timeStarted")),
      timeFinished: toFiletime(readRowField(ally, "timeFinished")),
    });
  }
  return allies;
}

/**
 * Decode one war KeyVal (buildWarPayload). null when it carries no warID.
 */
export function decodeWar(keyval: JsonValue | null | undefined): War | null {
  if (keyval === null || keyval === undefined) {
    return null;
  }
  const warID = toNumber(readRowField(keyval, "warID"));
  if (warID <= 0) {
    return null;
  }
  return {
    warID,
    declaredByID: toNumber(readRowField(keyval, "declaredByID")),
    againstID: toNumber(readRowField(keyval, "againstID")),
    warHQID: toOptionalID(readRowField(keyval, "warHQID")),
    timeDeclared: toFiletime(readRowField(keyval, "timeDeclared")),
    timeStarted: toFiletime(readRowField(keyval, "timeStarted")),
    timeFinished: toFiletime(readRowField(keyval, "timeFinished")),
    retracted: toFiletime(readRowField(keyval, "retracted")),
    retractedBy: toOptionalID(readRowField(keyval, "retractedBy")),
    billID: toOptionalID(readRowField(keyval, "billID")),
    mutual: toBool(readRowField(keyval, "mutual")),
    openForAllies: toBool(readRowField(keyval, "openForAllies")),
    createdFromWarID: toOptionalID(readRowField(keyval, "createdFromWarID")),
    reward: toAmountString(readRowField(keyval, "reward")) ?? "0",
    allies: decodeAllies(readRowField(keyval, "allies")),
  };
}

/**
 * Decode a plain list of war KeyVals (GetWarsRequiringAssistance /
 * GetWarsForStructure). `[]` is a real "no such wars" answer.
 */
export function decodeWarList(value: JsonValue | null | undefined): War[] {
  if (!isListValue(value)) {
    return [];
  }
  const wars: War[] = [];
  for (const item of value.items) {
    const war = decodeWar(item);
    if (war !== null) {
      wars.push(war);
    }
  }
  return wars;
}

/** One owner's wars from GetWarsByOwners. */
export interface OwnerWars {
  readonly ownerID: number;
  readonly wars: readonly War[];
}

/**
 * Decode GetWarsByOwners -> [{ownerID, wars}]. The wire is a dict keyed by ownerID
 * whose value is a dict keyed by warID -> war KeyVal. An owner with no wars keeps
 * its (empty) entry — captured live as {98000001 -> {}}, a REAL "no wars" state.
 */
export function decodeWarsByOwners(value: JsonValue | null | undefined): OwnerWars[] {
  const result: OwnerWars[] = [];
  for (const [ownerKey, warDict] of readDictPairs(value)) {
    const ownerID = Number(ownerKey);
    if (!Number.isInteger(ownerID) || ownerID <= 0) {
      continue;
    }
    const wars: War[] = [];
    for (const [, warKeyVal] of readDictPairs(warDict)) {
      const war = decodeWar(warKeyVal);
      if (war !== null) {
        wars.push(war);
      }
    }
    result.push({ ownerID, wars });
  }
  return result;
}

/** Decode GetPublicWarInfo -> one war, or null for an unknown warID. */
export function decodePublicWarInfo(value: JsonValue | null | undefined): War | null {
  return decodeWar(value);
}

/**
 * Decode GetWarsByOwnerID / GetTop50 -> war rows. The wire is a
 * CachedMethodCallResult wrapping a CRowset (objectex2): `unwrapCachedResult`
 * (market.ts) peels the cache substream, then the rows live on the objectex2's
 * `list` as 17-column positional packedrows, read by name through readRowField.
 * `[]` is a real "no wars" answer (captured live).
 */
export function decodeWarRows(value: JsonValue | null | undefined): WarRow[] {
  const rowset = unwrapCachedResult((value ?? null) as JsonValue);
  const list =
    typeof rowset === "object" &&
    rowset !== null &&
    !Array.isArray(rowset) &&
    Array.isArray((rowset as { list?: unknown }).list)
      ? (rowset as { list: readonly JsonValue[] }).list
      : [];
  const rows: WarRow[] = [];
  for (const row of list) {
    const warID = toNumber(readRowField(row, "warID"));
    if (warID <= 0) {
      continue;
    }
    rows.push({
      warID,
      declaredByID: toNumber(readRowField(row, "declaredByID")),
      againstID: toNumber(readRowField(row, "againstID")),
      timeDeclared: toFiletime(readRowField(row, "timeDeclared")),
      timeFinished: toFiletime(readRowField(row, "timeFinished")),
      retracted: toFiletime(readRowField(row, "retracted")),
      retractedBy: toOptionalID(readRowField(row, "retractedBy")),
      timeStarted: toFiletime(readRowField(row, "timeStarted")),
      billID: toOptionalID(readRowField(row, "billID")),
      mutual: toBool(readRowField(row, "mutual")),
      createdFromWarID: toOptionalID(readRowField(row, "createdFromWarID")),
      openForAllies: toBool(readRowField(row, "openForAllies")),
      canBeRetracted: toBool(readRowField(row, "canBeRetracted")),
      reasonEnded: toNumber(readRowField(row, "reasonEnded")),
      warHQ: toOptionalID(readRowField(row, "warHQ")),
      noOfAllies: toNumber(readRowField(row, "noOfAllies")),
      reasonStarted: toNumber(readRowField(row, "reasonStarted")),
    });
  }
  return rows;
}
