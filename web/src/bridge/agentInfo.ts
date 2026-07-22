// R64 — decoding the agentMgr agent/mission READS (PLUMBING ONLY — no UI).
// GET /api/bridge/agent-info returns raw retail-shaped results for the NINE R64
// agentMgr reads; the decoders below were built from bytes captured LIVE from
// Farmer (char 140000005) against agent 3008416 (Antaken Kamola) on 2026-07-22.
//
//   OWNERSHIP-SAFETY (verified live): the agent-record reads return PUBLIC NPC
// reference info (agentTypeID / divisionID / level / stationID / corporationID /
// factionID …) — no player-private field; the epic-arc / career / journal reads
// are scoped off the session character server-side; GetDungeonShipRestrictions is
// static dungeon reference data. None leaks another entity's private data.
//
//   ⚠ TWO WIRE-SHAPE TRAPS captured live:
//   • The agent record (GetAgentStaticInfo / GetAgentByID) and the mission-journal
//     detail arrive as a BARE marshaled dict {type:"dict", entries:[…]} — read with
//     readDictEntry (NOT readKeyVal, which only reads the util.KeyVal wrapper).
//   • GetInfoServiceDetails arrives as a util.KeyVal WRAPPER — read with readKeyVal.
//   • GetDungeonShipRestrictions is returned by the handler DIRECTLY (not through
//     toMarshalSafe), so it crosses the wire as a PLAIN object
//     {allowedShipTypes:[…], restrictedShipTypes:[…], nonDefaultShipRestrictions}
//     with bare number arrays — no {type:"list"} wrapper. null when the dungeon is
//     unknown or unrestricted (a real "no restriction" state).
//
// R7d at the decoder level: every id (agentID / corporationID / factionID /
// stationID / solarSystemID / epicArcID / contentID / typeID) survives as a numeric
// field a future UI resolves; none is forced into a label, none is lost. FILETIME
// longs (epic-arc accepted/completed/quit dates, mission expiration) are read
// bigint-safe as decimal strings, never through Number. Empty results (no epic arc,
// no mission journal, no dungeon entry point) are legitimate states in Farmer's
// world, not failures.

import {
  isListValue,
  readDictEntry,
  readDictPairs,
  readKeyVal,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

// --- shared readers ---------------------------------------------------------

/** An integer-ish numeric (plain / {type:"long"} / decimal string); null when absent. */
function toNullableNumber(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : null;
}

/** A positive id, or null when absent / non-positive. */
function toPositiveID(value: JsonValue | undefined): number | null {
  const n = toNullableNumber(value);
  return n !== null && n > 0 ? n : null;
}

/** A possibly-fractional numeric (coordinates); null when absent. */
function toFloat(value: JsonValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const long = unwrapLong(value);
  return long !== null ? Number(long) : null;
}

/** A FILETIME / long as a bigint-safe decimal string; null when absent. */
function toDecimalString(value: JsonValue | undefined): string | null {
  const long = unwrapLong(value);
  return long !== null ? long.toString() : null;
}

/** A boolean from a wire field (true / 1 both read true). */
function toBool(value: JsonValue | undefined): boolean {
  return value === true || value === 1;
}

/** Unwrap a wstring / token wrapper or a bare string; "" otherwise. */
function readText(value: JsonValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "string") {
      return inner;
    }
  }
  return "";
}

/** Items of a {type:"list"} wrapper OR a bare JS array; [] otherwise. */
function listItems(value: JsonValue | null | undefined): readonly JsonValue[] {
  if (isListValue(value)) {
    return value.items;
  }
  return Array.isArray(value) ? value : [];
}

// --- agent record (GetAgentStaticInfo / GetAgentByID) -----------------------

/**
 * One public NPC agent's reference record. GetAgentStaticInfo and GetAgentByID
 * return the IDENTICAL shape (verified live). Every field here is public info the
 * Agent Finder already exposes; ids stay numeric for a future UI to resolve (R7d).
 * The eve.js-internal fields (missionPoolKey / missionTemplateIDs /
 * conversationMetadata) are deliberately not surfaced — they are not part of the
 * retail agent record.
 */
export interface AgentInfo {
  readonly agentID: number;
  readonly ownerName: string;
  readonly ownerTypeID: number | null;
  readonly gender: number | null;
  readonly agentTypeID: number | null;
  readonly divisionID: number | null;
  readonly level: number | null;
  readonly isLocator: boolean;
  readonly corporationID: number | null;
  readonly factionID: number | null;
  readonly stationID: number | null;
  readonly stationTypeID: number | null;
  readonly solarSystemID: number | null;
  readonly isInSpace: boolean;
  readonly raceID: number | null;
  readonly bloodlineID: number | null;
  readonly careerID: number | null;
  readonly schoolID: number | null;
  readonly specialityID: number | null;
  readonly missionKind: string;
  readonly missionTypeLabel: string;
  readonly importantMission: boolean;
}

/**
 * Decode GetAgentStaticInfo / GetAgentByID -> the public agent record. The wire is
 * a BARE marshaled dict ({type:"dict", entries:[…]}), so fields are read with
 * readDictEntry. null when the agent is unknown (the handler returns null, which
 * crosses the wire as null).
 */
export function decodeAgentInfo(result: JsonValue | null | undefined): AgentInfo | null {
  const value = (result ?? null) as JsonValue;
  const agentID = toPositiveID(readDictEntry(value, "agentID"));
  if (agentID === null) {
    return null;
  }
  return {
    agentID,
    ownerName: readText(readDictEntry(value, "ownerName")),
    ownerTypeID: toPositiveID(readDictEntry(value, "ownerTypeID")),
    gender: toNullableNumber(readDictEntry(value, "gender")),
    agentTypeID: toNullableNumber(readDictEntry(value, "agentTypeID")),
    divisionID: toNullableNumber(readDictEntry(value, "divisionID")),
    level: toNullableNumber(readDictEntry(value, "level")),
    isLocator: toBool(readDictEntry(value, "isLocator")),
    corporationID: toPositiveID(readDictEntry(value, "corporationID")),
    factionID: toPositiveID(readDictEntry(value, "factionID")),
    stationID: toPositiveID(readDictEntry(value, "stationID")),
    stationTypeID: toPositiveID(readDictEntry(value, "stationTypeID")),
    solarSystemID: toPositiveID(readDictEntry(value, "solarSystemID")),
    isInSpace: toBool(readDictEntry(value, "isInSpace")),
    raceID: toNullableNumber(readDictEntry(value, "raceID")),
    bloodlineID: toNullableNumber(readDictEntry(value, "bloodlineID")),
    careerID: toNullableNumber(readDictEntry(value, "careerID")),
    schoolID: toNullableNumber(readDictEntry(value, "schoolID")),
    specialityID: toNullableNumber(readDictEntry(value, "specialityID")),
    missionKind: readText(readDictEntry(value, "missionKind")),
    missionTypeLabel: readText(readDictEntry(value, "missionTypeLabel")),
    importantMission: toBool(readDictEntry(value, "importantMission")),
  };
}

// --- solar system of agent (GetSolarSystemOfAgent) --------------------------

/**
 * Decode GetSolarSystemOfAgent -> the agent's solarSystemID (a bare int on the
 * wire) or null when the agent is unknown / has no system. id stays data (R7d).
 */
export function decodeSolarSystemOfAgent(
  result: JsonValue | null | undefined,
): number | null {
  return toPositiveID((result ?? null) as JsonValue);
}

// --- epic arc status (GetMyEpicArcStatus) -----------------------------------

/** One mission's status within an epic arc (buildEpicArcStatusKeyVal). */
export interface EpicArcMissionStatus {
  readonly contentID: number;
  readonly nameID: number | null;
  /** FILETIME decimal string, or null when the mission is not in that state. */
  readonly acceptedDate: string | null;
  readonly completedDate: string | null;
  readonly quitDate: string | null;
}

/** The character's own progress through one epic arc. */
export interface EpicArcStatus {
  readonly epicArcID: number;
  readonly missions: readonly EpicArcMissionStatus[];
}

/**
 * Decode GetMyEpicArcStatus -> the character's OWN epic-arc progress. The wire is
 * a NESTED bare dict: {type:"dict"} keyed by epicArcID -> {type:"dict"} keyed by
 * contentID -> util.KeyVal{acceptedDate, completedDate, quitDate, nameID}. Captured
 * LIVE EMPTY (Farmer has started no epic arc) — a real state; the populated nesting
 * is pinned by a builder-shaped fixture test. FILETIMEs are bigint-safe; ids stay
 * data (R7d). Sorted by epicArcID.
 */
export function decodeEpicArcStatus(
  result: JsonValue | null | undefined,
): EpicArcStatus[] {
  const arcs: EpicArcStatus[] = [];
  for (const [arcKey, missionMap] of readDictPairs((result ?? null) as JsonValue)) {
    const epicArcID = Number(arcKey);
    if (!Number.isFinite(epicArcID) || epicArcID <= 0) {
      continue;
    }
    const missions: EpicArcMissionStatus[] = [];
    for (const [contentKey, statusKeyVal] of readDictPairs(missionMap)) {
      const contentID = Number(contentKey);
      if (!Number.isFinite(contentID)) {
        continue;
      }
      missions.push({
        contentID,
        nameID: toPositiveID(readKeyVal(statusKeyVal, "nameID")),
        acceptedDate: toDecimalString(readKeyVal(statusKeyVal, "acceptedDate")),
        completedDate: toDecimalString(readKeyVal(statusKeyVal, "completedDate")),
        quitDate: toDecimalString(readKeyVal(statusKeyVal, "quitDate")),
      });
    }
    arcs.push({ epicArcID, missions });
  }
  return arcs.sort((left, right) => left.epicArcID - right.epicArcID);
}

// --- completed career agents (GetCompletedCareerAgentIDs) -------------------

/** Whether the session character has completed one queried career agent. */
export interface CareerAgentCompletion {
  readonly agentID: number;
  readonly completed: boolean;
}

/**
 * Decode GetCompletedCareerAgentIDs -> for each queried agentID, whether the
 * SESSION character has completed it. The wire is a bare dict keyed by agentID (a
 * JSON NUMBER on the wire) -> boolean. Captured LIVE POPULATED
 * ({3008416: true, 3010879: false}); the empty-list query returns {} (a real
 * "asked about none"). agentID stays data (R7d). Sorted by agentID.
 */
export function decodeCompletedCareerAgents(
  result: JsonValue | null | undefined,
): CareerAgentCompletion[] {
  const rows: CareerAgentCompletion[] = [];
  for (const [key, value] of readDictPairs((result ?? null) as JsonValue)) {
    const agentID = Number(key);
    if (!Number.isFinite(agentID) || agentID <= 0) {
      continue;
    }
    rows.push({ agentID, completed: toBool(value) });
  }
  return rows.sort((left, right) => left.agentID - right.agentID);
}

// --- info service details (GetInfoServiceDetails, bound) --------------------

/** One service an agent offers (mission / locate …) and whether it is available. */
export interface AgentService {
  readonly agentServiceType: string;
  readonly available: boolean;
}

/** GetInfoServiceDetails -> the bound agent's info-window service detail. */
export interface InfoServiceDetails {
  readonly agentID: number;
  readonly stationID: number | null;
  readonly level: number | null;
  readonly services: readonly AgentService[];
  /** null in every observed case (a compatibility reason id when set); kept as data. */
  readonly incompatible: number | null;
}

/**
 * Decode GetInfoServiceDetails -> the bound agent's info-window detail. Dispatched
 * on the agent moniker (boundCall), so the result is the UNWRAPPED util.KeyVal
 * {agentID, stationID, level, services:[util.KeyVal{agentServiceType, available}],
 * incompatible} (verified live). null when the agent is unknown. `services` is a
 * bare JS array of util.KeyVals.
 */
export function decodeInfoServiceDetails(
  result: JsonValue | null | undefined,
): InfoServiceDetails | null {
  const value = (result ?? null) as JsonValue;
  const agentID = toPositiveID(readKeyVal(value, "agentID"));
  if (agentID === null) {
    return null;
  }
  const services: AgentService[] = [];
  for (const entry of listItems(readKeyVal(value, "services"))) {
    services.push({
      agentServiceType: readText(readKeyVal(entry, "agentServiceType")),
      available: toBool(readKeyVal(entry, "available")),
    });
  }
  return {
    agentID,
    stationID: toPositiveID(readKeyVal(value, "stationID")),
    level: toNullableNumber(readKeyVal(value, "level")),
    services,
    incompatible: toPositiveID(readKeyVal(value, "incompatible")),
  };
}

// --- mission journal info (GetMissionJournalInfo, bound) --------------------

/** GetMissionJournalInfo -> the char's own journal detail for the bound agent. */
export interface MissionJournalInfo {
  readonly missionNameID: number | null;
  readonly contentID: number | null;
  /** The briefing text key: an id, a wstring key, or null. Kept as raw data (R7d). */
  readonly briefingTextID: JsonValue | null;
  readonly missionState: number | null;
  /** FILETIME decimal string, bigint-safe; null when absent. */
  readonly expirationTime: string | null;
  readonly iconID: number | null;
  /** Objective / bookmark DETAIL is decoded by the existing objective decoder; the
   * plumbing keeps their counts so a future UI knows there is detail to fetch. */
  readonly objectiveCount: number;
  readonly bookmarkCount: number;
}

/**
 * Decode GetMissionJournalInfo -> the character's OWN journal detail for the bound
 * agent's mission. Dispatched on the agent moniker (boundCall). The wire is a BARE
 * marshaled dict {type:"dict", entries:[…]} (missionNameID, contentID,
 * briefingTextID, missionImage, expirationTime(long), missionState, objectives,
 * bookmarks, iconID). Captured LIVE null (Farmer has no active mission with the
 * agent) — a real state; the populated dict is pinned by a builder-shaped fixture
 * test. FILETIME bigint-safe; ids stay data (R7d).
 */
export function decodeMissionJournalInfo(
  result: JsonValue | null | undefined,
): MissionJournalInfo | null {
  const value = (result ?? null) as JsonValue;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  if ((value as { type?: unknown }).type !== "dict") {
    return null;
  }
  const briefing = readDictEntry(value, "briefingTextID");
  return {
    missionNameID: toPositiveID(readDictEntry(value, "missionNameID")),
    contentID: toPositiveID(readDictEntry(value, "contentID")),
    briefingTextID: briefing === undefined ? null : briefing,
    missionState: toNullableNumber(readDictEntry(value, "missionState")),
    expirationTime: toDecimalString(readDictEntry(value, "expirationTime")),
    iconID: toNullableNumber(readDictEntry(value, "iconID")),
    objectiveCount: listItems(readDictEntry(value, "objectives")).length,
    bookmarkCount: listItems(readDictEntry(value, "bookmarks")).length,
  };
}

// --- mission entry point (GetEntryPoint, bound) -----------------------------

/** A 3D entry point (the mission dungeon's landing coordinates). */
export interface EntryPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Decode GetEntryPoint -> the [x, y, z] entry point of the bound agent's mission
 * dungeon. Dispatched on the agent moniker (boundCall), so the result is the bare
 * 3-element coordinate array (the handler returns [x, y, z]) or null when there is
 * no active dungeon. Captured LIVE null (no active mission dungeon) — a real state;
 * the populated point is pinned by a fixture test. Coordinates are floats.
 */
export function decodeEntryPoint(
  result: JsonValue | null | undefined,
): EntryPoint | null {
  if (!Array.isArray(result) || result.length < 3) {
    return null;
  }
  const x = toFloat(result[0]);
  const y = toFloat(result[1]);
  const z = toFloat(result[2]);
  if (x === null || y === null || z === null) {
    return null;
  }
  return { x, y, z };
}

// --- dungeon ship restrictions (GetDungeonShipRestrictions) -----------------

/** GetDungeonShipRestrictions -> which ship types may / may not enter a dungeon. */
export interface DungeonShipRestrictions {
  readonly allowedShipTypes: readonly number[];
  readonly restrictedShipTypes: readonly number[];
  /** false when only the default acceleration-gate blacklist applies. */
  readonly nonDefaultShipRestrictions: boolean;
}

/**
 * Decode GetDungeonShipRestrictions -> the ship-type restriction lists for a
 * dungeon. ⚠ The handler returns this DIRECTLY (not through toMarshalSafe), so the
 * wire is a PLAIN object {allowedShipTypes:[typeID…], restrictedShipTypes:[typeID…],
 * nonDefaultShipRestrictions:bool} with BARE number arrays — no {type:"list"}
 * wrapper. Captured LIVE POPULATED (dungeon 43, 222 allowed / many restricted,
 * nonDefault true). null when the dungeon is unknown or has no restriction (a real
 * "all ships allowed" state — the retail client treats null the same way). typeIDs
 * stay data (R7d).
 */
export function decodeDungeonShipRestrictions(
  result: JsonValue | null | undefined,
): DungeonShipRestrictions | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return null;
  }
  const record = result as {
    allowedShipTypes?: unknown;
    restrictedShipTypes?: unknown;
    nonDefaultShipRestrictions?: unknown;
  };
  if (!Array.isArray(record.allowedShipTypes) && !Array.isArray(record.restrictedShipTypes)) {
    return null;
  }
  const toTypeIDs = (value: unknown): number[] =>
    (Array.isArray(value) ? value : [])
      .map((entry) => toNullableNumber(entry as JsonValue))
      .filter((id): id is number => id !== null && id > 0);
  return {
    allowedShipTypes: toTypeIDs(record.allowedShipTypes),
    restrictedShipTypes: toTypeIDs(record.restrictedShipTypes),
    nonDefaultShipRestrictions: record.nonDefaultShipRestrictions === true,
  };
}
