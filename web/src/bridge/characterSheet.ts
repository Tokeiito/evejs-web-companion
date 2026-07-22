// R56 — decoding the retail CHARACTER SHEET reads (top-level charMgr).
//
// The four shapes below were captured from LIVE bytes (Farmer, read through the
// BFF), not assumed — the orchestrator's briefs have guessed char-sheet shapes
// wrong before, so every one here is pinned against a real read:
//
//   GetPublicInfo3          -> {type:"list", items:[util.KeyVal{characterID,
//                              characterName, corporationID, allianceID|null,
//                              securityStatus (float), ...}]}
//                              ⚠ THE ROW IS items[0], A util.KeyVal — not a
//                              Rowset, not a bare dict. Reading `items` as the
//                              rows (as a Rowset decoder would) yields the KeyVal,
//                              and reading the KeyVal's own fields with a Rowset
//                              reader returns undefined for every one.
//   GetCharacterDescription -> a BARE JS STRING (the bio). No marshaled wrapper,
//                              no ids — the simplest read on the bridge.
//   GetHomeStation          -> a SINGLE util.KeyVal (not a list) carrying the home
//                              stationID plus a redundant name/type/system set.
//                              Only the stationID is decoded; the NAME comes from
//                              /api/names (R7d), never the redundant string here.
//   GetCloneInfo            -> a SINGLE util.KeyVal{homeStationID, cloneStationID,
//                              clones(dict), implants(dict), timeLastJump(long)}.
//                              `clones`/`implants` are {type:"dict", entries:[[key,
//                              util.KeyVal], ...]} and are EMPTY for a clean clone
//                              (Farmer, measured live, has neither) — a real
//                              answer the page renders honestly, not a failure.
//
// R7d is the crux. Only ids that can resolve to a NAME are carried out of here;
// the rest are omitted rather than rendered raw:
//   • corporationID / allianceID / home stationID / implant typeIDs are kept and
//     name-resolved by the page. An id static data cannot name (a PLAYER
//     corporation — Farmer's own 98000001 resolves to null) degrades to
//     "Unknown …", NEVER the number.
//   • securityStatus is a FLOAT, not an id — shown as-is.
//   • bloodlineID / raceID / ancestryID are in the GetPublicInfo3 bytes but have
//     NO name path (no /api/names kind, no staticData resolver), so they are
//     DELIBERATELY NOT DECODED. A number with nowhere to resolve is exactly what
//     R7d forbids on screen.

import {
  isKeyValValue,
  isListValue,
  readKeyVal,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";
import type {
  CharacterIdentity,
  CharacterImplant,
  CloneSummary,
} from "../store/types.ts";

/** An integer field, tolerant of a {type:"long"} wrapper or a bare digit string. */
function toInt(value: JsonValue | undefined): number {
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

/** A signed float (security status), tolerant of a decimal string. 0 when absent. */
function toFloat(value: JsonValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return 0;
}

function toStringOrEmpty(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * The one util.KeyVal row inside a GetPublicInfo3 result. The retail shape wraps
 * the KeyVal in a list; `items[0]` is the row. A bare KeyVal is tolerated too, so
 * a handler tweak that stops wrapping (GetPublicInfo, the non-"3" sibling, returns
 * one directly) would not silently blank the panel. null for any other shape.
 */
function publicInfoRow(result: JsonValue | null | undefined): JsonValue | null {
  if (isListValue(result)) {
    const first = result.items[0];
    return first === undefined ? null : first;
  }
  if (isKeyValValue(result)) {
    return result;
  }
  return null;
}

/**
 * Decode charMgr.GetPublicInfo3 -> the character's PUBLIC identity. Only the
 * name-resolvable ids and the plain security float are carried out; bloodline /
 * race / ancestry are deliberately dropped (no name path — R7d). null when the
 * read did not produce the KeyVal row (a shape we did not get / a failed read).
 */
export function decodeCharacterIdentity(
  result: JsonValue | null | undefined,
): CharacterIdentity | null {
  const row = publicInfoRow(result);
  if (row === null) {
    return null;
  }
  const characterID = toInt(readKeyVal(row, "characterID"));
  const characterName = toStringOrEmpty(readKeyVal(row, "characterName"));
  // A row that carries neither an id nor a name is not a public-info row.
  if (characterID <= 0 && characterName === "") {
    return null;
  }
  const allianceID = toInt(readKeyVal(row, "allianceID"));
  return {
    characterID,
    characterName,
    corporationID: toInt(readKeyVal(row, "corporationID")),
    // 0 (or absent) means no alliance; carried as null so the page omits the row.
    allianceID: allianceID > 0 ? allianceID : null,
    securityStatus: toFloat(readKeyVal(row, "securityStatus")),
  };
}

/**
 * Decode charMgr.GetCharacterDescription -> the bio. A bare string on the wire.
 * "" is a REAL empty bio (a character who wrote none); null means the value was
 * not a string (an absent / failed read), which the flow's error handling covers.
 */
export function decodeCharacterDescription(
  result: JsonValue | null | undefined,
): string | null {
  return typeof result === "string" ? result : null;
}

/**
 * Decode charMgr.GetHomeStation -> the home station's id (the medical-clone home).
 * Only the id: the NAME is resolved through /api/names (R7d), so the redundant
 * `stationName` in the payload is never trusted onto the screen. null when the
 * KeyVal is absent or carries no station.
 */
export function decodeHomeStationID(
  result: JsonValue | null | undefined,
): number | null {
  if (!isKeyValValue(result)) {
    return null;
  }
  const stationID = toInt(readKeyVal(result, "stationID"));
  return stationID > 0 ? stationID : null;
}

/** The `[key, value]` pairs of a marshaled `{type:"dict", entries:[...]}`. */
function dictEntries(
  value: JsonValue | undefined,
): readonly (readonly [JsonValue, JsonValue])[] {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { type?: unknown }).type !== "dict"
  ) {
    return [];
  }
  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.filter(
    (entry): entry is readonly [JsonValue, JsonValue] =>
      Array.isArray(entry) && entry.length >= 2,
  );
}

/**
 * Decode the `implants` dict of GetCloneInfo -> one row per implant. Each dict
 * VALUE is a util.KeyVal{typeID, name, slot}; the typeID is kept for name
 * resolution (R7d) and `name` in the bytes is ignored (the server sends "").
 * Sorted by slot so the same clone reads the same way twice running.
 */
function decodeImplants(
  value: JsonValue | undefined,
): readonly CharacterImplant[] {
  const rows: CharacterImplant[] = [];
  for (const [, entryValue] of dictEntries(value)) {
    const typeID = toInt(readKeyVal(entryValue, "typeID"));
    if (typeID <= 0) {
      continue;
    }
    rows.push({ typeID, slot: toInt(readKeyVal(entryValue, "slot")) });
  }
  return rows.sort((left, right) => left.slot - right.slot || left.typeID - right.typeID);
}

/**
 * Decode charMgr.GetCloneInfo -> the active clone's implants + the jump-clone
 * count. An empty implants dict is a real "clean clone" (Farmer live), not a
 * failure. null when the KeyVal is absent (a failed read; the flow carries the
 * reason).
 */
export function decodeCloneSummary(
  result: JsonValue | null | undefined,
): CloneSummary | null {
  if (!isKeyValValue(result)) {
    return null;
  }
  return {
    homeStationID: toInt(readKeyVal(result, "homeStationID")),
    cloneStationID: toInt(readKeyVal(result, "cloneStationID")),
    implants: decodeImplants(readKeyVal(result, "implants")),
    jumpCloneCount: dictEntries(readKeyVal(result, "clones")).length,
  };
}

/** The signed security status to two decimals, e.g. "+0.14" / "−1.30" / "0.00". */
export function formatSecurityStatus(status: number): string {
  const rounded = Math.round(status * 100) / 100;
  if (rounded > 0) {
    return `+${rounded.toFixed(2)}`;
  }
  if (rounded < 0) {
    // A real minus sign, not a hyphen.
    return `−${Math.abs(rounded).toFixed(2)}`;
  }
  return "0.00";
}
