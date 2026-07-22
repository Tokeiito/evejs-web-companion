// structureAssetSafety's four reads decoded to plain records (goal R71, PLUMBING
// ONLY — no UI).
//
// GET /api/bridge/asset-safety bundles four independent reads. Every shape below was
// captured LIVE from Farmer (char 140000005, corp 98000001) on 2026-07-22; Farmer has
// no asset-safety wraps, so the EMPTY paths are live and the POPULATED wrap/target/name
// shapes are pinned to the server builders (structureAssetSafetyService.js buildWrap
// Payload / buildStationInfoPayload). Both handlers that read wraps scope OFF THE
// SESSION (session.characterID / session.corporationID) — verified: a second session
// (Test Two, corp 98000000) saw its own empty corp set, never Farmer's.
//
//   • charItems = GetItemsInSafetyForCharacter() -> {type:"list", items:[util.KeyVal
//     wrap]} — the session character's own wraps (LIVE empty).
//   • corpItems = GetItemsInSafetyForCorp()      -> a CachedMethodCallResult whose
//     args[1] is a {type:"substream", value:{type:"list", items:[…wraps…]}} — the
//     session CORP's wraps, same wrap shape (LIVE empty substream, versionCheck "1
//     minute"). ⚠ THE WRAP LIST IS NESTED in the substream, not at the top level.
//   • deliverTo = GetStructuresICanDeliverTo(solarSystemID) -> a 2-TUPLE
//     [ {type:"list", items:[KeyVal structure]} | empty , stationInfo(KeyVal) | null ]
//     — the session's deliverable structures in a system (LIVE [emptyList, null]).
//   • wrapNames = GetWrapNames([wrapIDs]) -> {type:"dict", entries:[[wrapID, name|null]]}
//     — a name lookup (LIVE {} for no ids).
//
// A wrap KeyVal carries: solarSystemID, assetWrapID, wrapName, ejectTime(long FILETIME),
// daysUntilCanDeliverConst, daysUntilAutoMoveConst, nearestNPCStationInfo(KeyVal|null).
// R7d: ids (assetWrapID / solarSystemID / itemID / typeID) survive as numeric fields;
// the server-supplied names (wrapName / itemName) are carried, not dropped. ejectTime is
// a FILETIME bigint.

import {
  isKeyValValue,
  isListValue,
  readDictPairs,
  readRowField,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

/** A station/structure reduced to its ids + server-supplied name. */
export interface AssetSafetyPlace {
  readonly itemID: number;
  readonly typeID: number;
  readonly solarSystemID: number;
  readonly itemName: string;
}

/** One asset-safety wrap. */
export interface AssetSafetyWrap {
  readonly assetWrapID: number;
  readonly solarSystemID: number;
  readonly wrapName: string;
  /** FILETIME the wrap ejects/auto-moves (a bigint); null when absent/zero. */
  readonly ejectTime: bigint | null;
  readonly daysUntilCanDeliver: number;
  readonly daysUntilAutoMove: number;
  readonly nearestNPCStation: AssetSafetyPlace | null;
}

/** The GetStructuresICanDeliverTo result: deliverable structures + nearest NPC station. */
export interface DeliveryTargets {
  readonly structures: readonly AssetSafetyPlace[];
  readonly nearestNPCStation: AssetSafetyPlace | null;
}

/** One wrap-name lookup result. */
export interface WrapName {
  readonly wrapID: number;
  readonly name: string | null;
}

function toNumber(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : 0;
}

function toStringOrEmpty(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function toFiletime(value: JsonValue | undefined): bigint | null {
  const long =
    typeof value === "string" && /^-?\d+$/.test(value) ? BigInt(value) : unwrapLong(value);
  return long !== null && long > 0n ? long : null;
}

/**
 * Unwrap a CachedMethodCallResult to the value its substream carries. The wrapper is
 * {type:"object", name:<rawstr …CachedMethodCallResult>, args:[details, {type:
 * "substream", value:<payload>}, version]}; the payload lives in the substream member.
 * A value that is already the payload (a bare list) is returned as-is. null otherwise
 * (e.g. a proxyCache reference, which carries a CachedObject member, not a substream).
 */
function unwrapCachedSubstream(result: JsonValue | null | undefined): JsonValue | null {
  if (isListValue(result)) {
    return result;
  }
  if (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    (result as { type?: unknown }).type === "object" &&
    Array.isArray((result as { args?: unknown }).args)
  ) {
    for (const member of (result as { args: readonly JsonValue[] }).args) {
      if (
        typeof member === "object" &&
        member !== null &&
        !Array.isArray(member) &&
        (member as { type?: unknown }).type === "substream"
      ) {
        return ((member as { value?: JsonValue }).value ?? null) as JsonValue | null;
      }
    }
  }
  return null;
}

/** Decode a stationInfo/structure KeyVal, or null when the payload carries no id. */
function decodePlace(value: JsonValue | null | undefined): AssetSafetyPlace | null {
  if (!isKeyValValue(value)) {
    return null;
  }
  const itemID = toNumber(readRowField(value, "itemID"));
  if (itemID <= 0) {
    return null;
  }
  return {
    itemID,
    typeID: toNumber(readRowField(value, "typeID")),
    solarSystemID: toNumber(readRowField(value, "solarSystemID")),
    itemName: toStringOrEmpty(readRowField(value, "itemName")),
  };
}

function decodeWrap(row: JsonValue): AssetSafetyWrap | null {
  const assetWrapID = toNumber(readRowField(row, "assetWrapID"));
  if (assetWrapID <= 0) {
    return null;
  }
  const station = readRowField(row, "nearestNPCStationInfo");
  return {
    assetWrapID,
    solarSystemID: toNumber(readRowField(row, "solarSystemID")),
    wrapName: toStringOrEmpty(readRowField(row, "wrapName")),
    ejectTime: toFiletime(readRowField(row, "ejectTime")),
    daysUntilCanDeliver: toNumber(readRowField(row, "daysUntilCanDeliverConst")),
    daysUntilAutoMove: toNumber(readRowField(row, "daysUntilAutoMoveConst")),
    nearestNPCStation: decodePlace((station ?? null) as JsonValue | null),
  };
}

function wrapsFromList(list: JsonValue | null | undefined): readonly AssetSafetyWrap[] {
  if (!isListValue(list)) {
    return [];
  }
  const wraps: AssetSafetyWrap[] = [];
  for (const item of list.items) {
    const wrap = decodeWrap(item);
    if (wrap) {
      wraps.push(wrap);
    }
  }
  return wraps.sort((left, right) => left.assetWrapID - right.assetWrapID);
}

/**
 * Decode GetItemsInSafetyForCharacter -> the session character's own wraps (a bare
 * marshaled list). Empty is a real "no items in asset safety" state.
 */
export function decodeCharacterWraps(
  result: JsonValue | null | undefined,
): readonly AssetSafetyWrap[] {
  return wrapsFromList(result);
}

/**
 * Decode GetItemsInSafetyForCorp -> the session corp's wraps. Unwraps the Cached
 * MethodCallResult substream first (the wrap list is nested there). Empty is a real
 * "no corp items in asset safety" state.
 */
export function decodeCorpWraps(
  result: JsonValue | null | undefined,
): readonly AssetSafetyWrap[] {
  return wrapsFromList(unwrapCachedSubstream(result));
}

/**
 * Decode GetStructuresICanDeliverTo -> the deliverable structures + nearest NPC
 * station for a system. The result is a 2-tuple [structuresList|empty, station|null];
 * an empty tuple ([emptyList, null], Farmer's live state) yields {structures:[],
 * nearestNPCStation:null}.
 */
export function decodeDeliveryTargets(
  result: JsonValue | null | undefined,
): DeliveryTargets {
  if (!Array.isArray(result)) {
    return { structures: [], nearestNPCStation: null };
  }
  const list = result[0];
  const structures: AssetSafetyPlace[] = [];
  if (isListValue(list)) {
    for (const item of list.items) {
      const place = decodePlace(item);
      if (place) {
        structures.push(place);
      }
    }
  }
  return {
    structures: structures.sort((left, right) => left.itemID - right.itemID),
    nearestNPCStation: decodePlace((result[1] ?? null) as JsonValue | null),
  };
}

/**
 * Decode GetWrapNames -> the wrapID -> name lookup, as an array of {wrapID, name}.
 * A wrap whose name is unknown carries name:null (never a fabricated label). Keys
 * arrive from the wire as JSON numbers. Empty dict -> [].
 */
export function decodeWrapNames(
  result: JsonValue | null | undefined,
): readonly WrapName[] {
  const names: WrapName[] = [];
  for (const [key, value] of readDictPairs(result)) {
    const wrapID = Number(key) || 0;
    if (wrapID <= 0) {
      continue;
    }
    names.push({ wrapID, name: typeof value === "string" ? value : null });
  }
  return names.sort((left, right) => left.wrapID - right.wrapID);
}
