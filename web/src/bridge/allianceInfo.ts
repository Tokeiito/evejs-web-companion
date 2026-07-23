// R83 — decoding the allianceRegistry ALLIANCE-IDENTITY reads (PLUMBING ONLY — no UI).
// Captured live on 2026-07-22: as Farmer (corp 98000001, ALLIANCE-LESS) the session
// forms return the empty state (GetAlliance() -> null); the populated shapes come from
// an explicit allianceID (Elysian 99000000) — an EVE-public identity lookup, safe even
// for a foreign allianceID (verified live: only public info-panel fields are returned).
//
//   • GetAlliance([allianceID?]) / GetAlliancePublicInfo([allianceID?])
//       -> a util.KeyVal of the alliance identity (allianceID/name/shortName/executor+
//          creator corp/description/url/memberCount/sovereignty prime+capital info), or
//          `null` when the alliance does not exist / the session is alliance-less.
//   • GetRankedAlliances([maxLen]) -> a list of util.Row (name:"util.Row", args.dict of
//       [header, line]) — the same 18-column identity scheme, no session needed.
//
// ⚠ VALUE ENCODING: alliance / corp / char ids stay as data (R7d), plain numbers here
// (all < 2^53). FILETIMEs (startDate, newPrimeHourValidAfter, newCapitalSystemValidAfter)
// cross as {type:"long"} and EXCEED 2^53 (e.g. 134274243506850000) — kept as decimal
// STRINGS, never coerced to a JS number. dictatorial/allowWar/deleted are 0/1 flags.

import { isListValue, readKeyVal, type JsonValue } from "./wire.ts";

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A number, a numeric string, or a {type:"long"} wrapper -> number; null otherwise. */
export function toNumOrNull(value: JsonValue | undefined): number | null {
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

export function toNum(value: JsonValue | undefined): number {
  return toNumOrNull(value) ?? 0;
}

export function toStr(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * A retail long / FILETIME (or bare int, or numeric string) as a raw decimal STRING —
 * never a JS number, because these can exceed 2^53. `null` for absent / non-numeric.
 */
export function longToDecimalString(value: JsonValue | undefined): string | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return value;
  }
  if (isRecord(value) && value.type === "long") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "number" && Number.isInteger(inner)) return String(inner);
    if (typeof inner === "string" && /^-?\d+$/.test(inner)) return inner;
  }
  return null;
}

/** One alliance identity record (GetAlliance / GetAlliancePublicInfo / a ranked row). */
export interface AllianceInfo {
  readonly allianceID: number | null;
  readonly allianceName: string;
  readonly shortName: string;
  readonly executorCorpID: number | null;
  readonly creatorCorpID: number | null;
  readonly creatorCharID: number | null;
  readonly warFactionID: number | null;
  readonly description: string;
  readonly url: string | null;
  /** FILETIME — raw decimal string (may exceed 2^53). */
  readonly startDate: string | null;
  readonly memberCount: number;
  readonly dictatorial: boolean;
  readonly allowWar: boolean;
  readonly currentCapital: number | null;
  readonly currentPrimeHour: number;
  readonly newPrimeHour: number;
  /** FILETIME — raw decimal string. */
  readonly newPrimeHourValidAfter: string | null;
  readonly deleted: boolean;
}

/** The two sovereignty-capital fields carried by the KeyVal reads (not the Row list). */
export interface AllianceInfoExtra extends AllianceInfo {
  readonly currentCapitalSystem: number | null;
  readonly newCapitalSystem: number | null;
  /** FILETIME — raw decimal string. */
  readonly newCapitalSystemValidAfter: string | null;
}

type FieldReader = (key: string) => JsonValue | undefined;

function buildAllianceInfo(read: FieldReader): AllianceInfo {
  return {
    allianceID: toNumOrNull(read("allianceID")),
    allianceName: toStr(read("allianceName")),
    shortName: toStr(read("shortName")),
    executorCorpID: toNumOrNull(read("executorCorpID")),
    creatorCorpID: toNumOrNull(read("creatorCorpID")),
    creatorCharID: toNumOrNull(read("creatorCharID")),
    warFactionID: toNumOrNull(read("warFactionID")),
    description: toStr(read("description")),
    url: typeof read("url") === "string" ? (read("url") as string) : null,
    startDate: longToDecimalString(read("startDate")),
    memberCount: toNum(read("memberCount")),
    dictatorial: toNum(read("dictatorial")) !== 0,
    allowWar: toNum(read("allowWar")) !== 0,
    currentCapital: toNumOrNull(read("currentCapital")),
    currentPrimeHour: toNum(read("currentPrimeHour")),
    newPrimeHour: toNum(read("newPrimeHour")),
    newPrimeHourValidAfter: longToDecimalString(read("newPrimeHourValidAfter")),
    deleted: toNum(read("deleted")) !== 0,
  };
}

/**
 * Decode allianceRegistry.GetAlliance / GetAlliancePublicInfo -> the alliance identity
 * KeyVal, plus the two sovereignty-capital fields. `null` when the value is not a
 * util.KeyVal (a real "no such alliance" / alliance-less-session answer).
 */
export function decodeAllianceInfo(
  result: JsonValue | null | undefined,
): AllianceInfoExtra | null {
  if (!isRecord(result) || result.type !== "object" || result.name !== "util.KeyVal") {
    return null;
  }
  const read: FieldReader = (key) => readKeyVal(result, key);
  return {
    ...buildAllianceInfo(read),
    currentCapitalSystem: toNumOrNull(read("currentCapitalSystem")),
    newCapitalSystem: toNumOrNull(read("newCapitalSystem")),
    newCapitalSystemValidAfter: longToDecimalString(read("newCapitalSystemValidAfter")),
  };
}

/**
 * Read a util.Row (`{type:"object", name:"util.Row", args.dict[header, line]}`) into a
 * `{column: cell}` field reader. `null` when the value is not a util.Row. header/line
 * arrive as {type:"list"} wrappers (GetRankedAlliances) but bare arrays are tolerated.
 */
function utilRowReader(row: JsonValue): FieldReader | null {
  if (!isRecord(row) || row.type !== "object" || row.name !== "util.Row") {
    return null;
  }
  const args = row.args;
  const entries =
    isRecord(args) && Array.isArray((args as { entries?: unknown }).entries)
      ? ((args as { entries: readonly JsonValue[] }).entries)
      : [];
  const byKey = (key: string): JsonValue | undefined => {
    const entry = entries.find((e) => Array.isArray(e) && e[0] === key);
    return Array.isArray(entry) ? (entry[1] as JsonValue) : undefined;
  };
  const cells = (value: JsonValue | undefined): readonly JsonValue[] =>
    Array.isArray(value) ? value : isListValue(value) ? value.items : [];
  const header = cells(byKey("header")).map((c) => (typeof c === "string" ? c : String(c)));
  const line = cells(byKey("line"));
  if (header.length === 0) {
    return null;
  }
  return (key) => {
    const index = header.indexOf(key);
    return index >= 0 ? (line[index] ?? null) : undefined;
  };
}

/**
 * Decode allianceRegistry.GetRankedAlliances -> the alliance-browser identity rows (the
 * 18-column scheme; no sovereignty-capital extras). `[]` is a real "no alliances" answer.
 */
export function decodeRankedAlliances(
  result: JsonValue | null | undefined,
): AllianceInfo[] {
  if (!isListValue(result)) {
    return [];
  }
  const rows: AllianceInfo[] = [];
  for (const item of result.items) {
    const read = utilRowReader(item);
    if (read) {
      rows.push(buildAllianceInfo(read));
    }
  }
  return rows;
}
