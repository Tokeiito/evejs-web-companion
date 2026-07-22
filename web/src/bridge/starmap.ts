// Map / starmap reads decoded to plain rows (goal R68, PLUMBING ONLY — no UI).
//
// GET /api/bridge/starmap bundles the whole `map` service read set. Built from
// bytes captured LIVE from Farmer (char 140000005, system 30000144, corp
// 98000001) on 2026-07-22 and cross-checked against the server builders
// (eve.js .../services/map/mapService.js + sovereignty/incursion payload modules).
//
// OWNERSHIP-SAFETY (R63, verified live across TWO sessions):
//   • GetMyExtraMapInfo / GetMyExtraMapInfoAgents return a HARDCODED empty rowset —
//     empty for every session, no data path, no leak.
//   • GetSolarSystemVisits is session-scoped: Farmer saw 13 own systems, a second
//     session saw a DIFFERENT 2, so a caller only ever reads its own visits.
//   • GetHistory is GLOBAL aggregate map stats (both sessions saw the identical
//     per-system jump/kill totals), never a personal history.
//
// Real captured shapes (empty ≠ failure — this seeded world has no incursions,
// no sov claims, no fac-war contest, no roaming weather, no active fleet beacons):
//   GetStationCount        -> {type:"list", items:[[solarSystemID, count], ...]} (8490 pairs)
//   GetSolarsystemItems    -> Rowset[groupID,typeID,itemID,itemName,locationID,orbitID,
//                             connector,x,y,z,celestialIndex,orbitIndex] (48 rows, bare-array lines)
//   GetHistory             -> CachedMethodCallResult{args:[details, substream:<Rowset
//                             [solarSystemID,value1,value2,value3]>, version]} (jumps: 8 rows)
//   GetSolarSystemVisits   -> Rowset[lastDateTime(long),solarSystemID,visits] (13 own rows)
//   GetBeaconCount         -> {type:"dict", entries:[[solarSystemID, count], ...]} (empty)
//   GetCurrentSovData      -> Rowset[locationID..claimTime(long)] (empty in highsec)
//   GetRecentSovActivity   -> Rowset[solarSystemID,ownerID,oldOwnerID,stationID,changeTime(long)] (empty)
//   GetFacWarZoneInfo      -> util.KeyVal{factionID, systemUpgradeLevel:dict} (empty dict)
//   GetDeadspaceAgentsMap  -> null ; GetDeadspaceComplexMap -> null
//   GetMyExtraMapInfo      -> Rowset[characterID,locationID] (empty)
//   GetMyExtraMapInfoAgents-> Rowset[fromID,rank] (empty)
//   GetConstellationLPData -> Rowset[solarSystemID,loyaltyPoints] (empty)
//   GetAllRoamingWeatherSystems -> Rowset[locationID,sceneType] (empty)
//   GetSecurityModifiedSystems  -> Rowset[solarSystemID] (empty)
//   GetIncursionGlobalReport    -> {type:"list", items:[util.KeyVal{...}]} | [] (empty)
//   GetSystemsInIncursions      -> Rowset[locationID,sceneType,templateNameID] (empty)
//
// R7d: every id (solarSystemID / constellationID / regionID / ownerID / typeID /
// itemID / ...) survives as a numeric field; none is forced into a label. FILETIMEs
// (lastDateTime / claimTime / changeTime) are bigint-safe. Loyalty points are kept
// as plain numbers (small in this data); no ISK crosses these reads.

import {
  isListValue,
  readDictPairs,
  readKeyVal,
  readRowsetRows,
  unwrapLong,
  type JsonValue,
} from "./wire.ts";

// --- shared field coercions -------------------------------------------------

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

/** A positive entity id, or null when absent/zero. Keeps ids as data (R7d). */
function toOptionalID(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const id = toNumber(value);
  return id > 0 ? id : null;
}

/** A number that preserves the absent/null distinction (null stays null, not 0). */
function toNullableNumber(value: JsonValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toNumber(value);
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

/** A string field, or null when absent. */
function toText(value: JsonValue | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

/**
 * Unwrap a CachedMethodCallResult to the value it carries. The wrapper is
 * {type:"object", name:<rawstr …CachedMethodCallResult>, args:[details,
 * {type:"substream", value:<payload>}, version]}; the payload lives in the
 * substream member of the args array. A value already the payload is returned
 * as-is. null otherwise. (Local copy — this file stays off market.ts, which a
 * separate session owns.)
 */
function unwrapCachedMethodCallResult(result: JsonValue | null | undefined): JsonValue | null {
  if (
    typeof result === "object" &&
    result !== null &&
    !Array.isArray(result) &&
    (result as { type?: unknown }).type === "object" &&
    Array.isArray((result as { args?: unknown }).args)
  ) {
    const args = (result as { args: readonly JsonValue[] }).args;
    for (const member of args) {
      if (
        typeof member === "object" &&
        member !== null &&
        !Array.isArray(member) &&
        (member as { type?: unknown }).type === "substream"
      ) {
        return ((member as { value?: JsonValue }).value ?? null) as JsonValue | null;
      }
    }
    return null;
  }
  return (result ?? null) as JsonValue | null;
}

// --- GetStationCount --------------------------------------------------------

export interface StationCount {
  readonly solarSystemID: number;
  readonly stationCount: number;
}

/**
 * Decode GetStationCount -> per-system station counts. The wire is a bare list of
 * [solarSystemID, count] pairs (NOT a rowset). Systems with zero stations are kept
 * (count 0 is a real answer). `[]` when the value is not a list.
 */
export function decodeStationCounts(result: JsonValue | null | undefined): StationCount[] {
  if (!isListValue(result)) {
    return [];
  }
  const counts: StationCount[] = [];
  for (const pair of result.items) {
    if (!Array.isArray(pair) || pair.length < 2) {
      continue;
    }
    const solarSystemID = toNumber(pair[0]);
    if (solarSystemID <= 0) {
      continue;
    }
    counts.push({ solarSystemID, stationCount: toNumber(pair[1]) });
  }
  return counts;
}

// --- GetSolarsystemItems ----------------------------------------------------

export interface SolarSystemItem {
  readonly groupID: number;
  readonly typeID: number;
  readonly itemID: number;
  readonly itemName: string | null;
  readonly locationID: number | null;
  readonly orbitID: number | null;
  readonly connector: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly celestialIndex: number | null;
  readonly orbitIndex: number | null;
}

/**
 * Decode GetSolarsystemItems -> the celestials/belts/stations/gates/structures in a
 * system. Rowset with bare-array lines. `[]` for an unknown/absent system.
 */
export function decodeSolarsystemItems(result: JsonValue | null | undefined): SolarSystemItem[] {
  const items: SolarSystemItem[] = [];
  for (const row of readRowsetRows(result)) {
    const itemID = toNumber(row.itemID);
    if (itemID <= 0) {
      continue;
    }
    items.push({
      groupID: toNumber(row.groupID),
      typeID: toNumber(row.typeID),
      itemID,
      itemName: toText(row.itemName),
      locationID: toOptionalID(row.locationID),
      orbitID: toOptionalID(row.orbitID),
      connector: toBool(row.connector),
      x: toNumber(row.x),
      y: toNumber(row.y),
      z: toNumber(row.z),
      celestialIndex: toNullableNumber(row.celestialIndex),
      orbitIndex: toNullableNumber(row.orbitIndex),
    });
  }
  return items;
}

// --- GetHistory -------------------------------------------------------------

export interface MapHistoryRow {
  readonly solarSystemID: number;
  readonly value1: number;
  readonly value2: number;
  readonly value3: number;
}

/**
 * Decode GetHistory -> per-system aggregate stat rows (statID selects jumps/kills/
 * facwar-kills). Unwraps the CachedMethodCallResult substream to reach the inner
 * Rowset, then reads the four columns. GLOBAL data, never personal. `[]` for a
 * statID with no activity.
 */
export function decodeMapHistory(result: JsonValue | null | undefined): MapHistoryRow[] {
  const inner = unwrapCachedMethodCallResult(result);
  const rows: MapHistoryRow[] = [];
  for (const row of readRowsetRows(inner)) {
    const solarSystemID = toNumber(row.solarSystemID);
    if (solarSystemID <= 0) {
      continue;
    }
    rows.push({
      solarSystemID,
      value1: toNumber(row.value1),
      value2: toNumber(row.value2),
      value3: toNumber(row.value3),
    });
  }
  return rows;
}

// --- GetSolarSystemVisits ---------------------------------------------------

export interface SolarSystemVisit {
  readonly lastDateTime: bigint | null;
  readonly solarSystemID: number;
  readonly visits: number;
}

/**
 * Decode GetSolarSystemVisits -> the SESSION character's own per-system visit tally.
 * lastDateTime is a bigint FILETIME. `[]` is a real "no visits" state.
 */
export function decodeSolarSystemVisits(result: JsonValue | null | undefined): SolarSystemVisit[] {
  const visits: SolarSystemVisit[] = [];
  for (const row of readRowsetRows(result)) {
    const solarSystemID = toNumber(row.solarSystemID);
    if (solarSystemID <= 0) {
      continue;
    }
    visits.push({
      lastDateTime: toFiletime(row.lastDateTime),
      solarSystemID,
      visits: toNumber(row.visits),
    });
  }
  return visits;
}

// --- GetBeaconCount ---------------------------------------------------------

export interface BeaconCount {
  readonly solarSystemID: number;
  readonly count: number;
}

/**
 * Decode GetBeaconCount -> active fleet-beacon count per system. The wire is a dict
 * keyed by solarSystemID -> count. `[]` when no fleet has lit a beacon.
 */
export function decodeBeaconCounts(result: JsonValue | null | undefined): BeaconCount[] {
  const counts: BeaconCount[] = [];
  for (const [key, value] of readDictPairs(result)) {
    const solarSystemID = Number(key);
    if (!Number.isInteger(solarSystemID) || solarSystemID <= 0) {
      continue;
    }
    counts.push({ solarSystemID, count: toNumber(value) });
  }
  return counts;
}

// --- GetCurrentSovData ------------------------------------------------------

export interface CurrentSovRow {
  readonly locationID: number | null;
  readonly solarSystemID: number | null;
  readonly constellationID: number | null;
  readonly regionID: number | null;
  readonly ownerID: number | null;
  readonly allianceID: number | null;
  readonly corporationID: number | null;
  readonly claimStructureID: number | null;
  readonly infrastructureHubID: number | null;
  readonly stationID: number | null;
  readonly claimTime: bigint | null;
}

/**
 * Decode GetCurrentSovData -> current sovereignty claims. Public; every id stays
 * data (R7d), claimTime a bigint FILETIME. `[]` in highsec (no claims).
 */
export function decodeCurrentSovData(result: JsonValue | null | undefined): CurrentSovRow[] {
  const rows: CurrentSovRow[] = [];
  for (const row of readRowsetRows(result)) {
    rows.push({
      locationID: toOptionalID(row.locationID),
      solarSystemID: toOptionalID(row.solarSystemID),
      constellationID: toOptionalID(row.constellationID),
      regionID: toOptionalID(row.regionID),
      ownerID: toOptionalID(row.ownerID),
      allianceID: toOptionalID(row.allianceID),
      corporationID: toOptionalID(row.corporationID),
      claimStructureID: toOptionalID(row.claimStructureID),
      infrastructureHubID: toOptionalID(row.infrastructureHubID),
      stationID: toOptionalID(row.stationID),
      claimTime: toFiletime(row.claimTime),
    });
  }
  return rows;
}

// --- GetRecentSovActivity ---------------------------------------------------

export interface RecentSovActivityRow {
  readonly solarSystemID: number | null;
  readonly ownerID: number | null;
  readonly oldOwnerID: number | null;
  readonly stationID: number | null;
  readonly changeTime: bigint | null;
}

/**
 * Decode GetRecentSovActivity -> recent sov ownership changes. changeTime a bigint
 * FILETIME. `[]` is a real "no recent activity" state.
 */
export function decodeRecentSovActivity(
  result: JsonValue | null | undefined,
): RecentSovActivityRow[] {
  const rows: RecentSovActivityRow[] = [];
  for (const row of readRowsetRows(result)) {
    rows.push({
      solarSystemID: toOptionalID(row.solarSystemID),
      ownerID: toOptionalID(row.ownerID),
      oldOwnerID: toOptionalID(row.oldOwnerID),
      stationID: toOptionalID(row.stationID),
      changeTime: toFiletime(row.changeTime),
    });
  }
  return rows;
}

// --- GetFacWarZoneInfo ------------------------------------------------------

export interface FacWarSystemUpgrade {
  readonly solarSystemID: number;
  readonly level: number;
}

export interface FacWarZoneInfo {
  readonly factionID: number | null;
  readonly systemUpgradeLevel: readonly FacWarSystemUpgrade[];
}

/**
 * Decode GetFacWarZoneInfo -> the militia faction's contested-zone summary. The
 * KeyVal carries factionID and a systemUpgradeLevel dict (solarSystemID -> level);
 * an empty dict is a real "no contest" state.
 */
export function decodeFacWarZoneInfo(result: JsonValue | null | undefined): FacWarZoneInfo {
  const upgrades: FacWarSystemUpgrade[] = [];
  for (const [key, value] of readDictPairs(readKeyVal(result, "systemUpgradeLevel"))) {
    const solarSystemID = Number(key);
    if (!Number.isInteger(solarSystemID) || solarSystemID <= 0) {
      continue;
    }
    upgrades.push({ solarSystemID, level: toNumber(value) });
  }
  return {
    factionID: toOptionalID(readKeyVal(result, "factionID")),
    systemUpgradeLevel: upgrades,
  };
}

// --- GetDeadspaceAgentsMap / GetDeadspaceComplexMap -------------------------

/**
 * Decode a deadspace-overlay read. The server returns null in this world (the
 * static deadspace overlays are not modelled), so this is [] for null. If a
 * populated Rowset ever ships, its rows come through as {column: value} records.
 */
export function decodeDeadspaceMap(
  result: JsonValue | null | undefined,
): readonly Readonly<Record<string, JsonValue>>[] {
  return readRowsetRows(result);
}

// --- GetMyExtraMapInfo / GetMyExtraMapInfoAgents ----------------------------

export interface ExtraMapMemberRow {
  readonly characterID: number | null;
  readonly locationID: number | null;
}

export interface ExtraMapAgentRow {
  readonly fromID: number | null;
  readonly rank: number;
}

/**
 * Decode GetMyExtraMapInfo -> the extra-map member layer. HARDCODED empty on the
 * server (no data path — see ownership note), so this is [] live; the row decode
 * exists so a future populated shape stays typed.
 */
export function decodeMyExtraMapInfo(result: JsonValue | null | undefined): ExtraMapMemberRow[] {
  return readRowsetRows(result).map((row) => ({
    characterID: toOptionalID(row.characterID),
    locationID: toOptionalID(row.locationID),
  }));
}

/** Decode GetMyExtraMapInfoAgents -> the extra-map agent-standing layer (empty live). */
export function decodeMyExtraMapInfoAgents(
  result: JsonValue | null | undefined,
): ExtraMapAgentRow[] {
  return readRowsetRows(result).map((row) => ({
    fromID: toOptionalID(row.fromID),
    rank: toNumber(row.rank),
  }));
}

// --- GetConstellationLPData -------------------------------------------------

export interface ConstellationLPRow {
  readonly solarSystemID: number;
  readonly loyaltyPoints: number;
}

/**
 * Decode GetConstellationLPData -> the fac-war LP-per-system overlay. Empty live
 * (the overlay is not seeded).
 */
export function decodeConstellationLPData(
  result: JsonValue | null | undefined,
): ConstellationLPRow[] {
  const rows: ConstellationLPRow[] = [];
  for (const row of readRowsetRows(result)) {
    const solarSystemID = toNumber(row.solarSystemID);
    if (solarSystemID <= 0) {
      continue;
    }
    rows.push({ solarSystemID, loyaltyPoints: toNumber(row.loyaltyPoints) });
  }
  return rows;
}

// --- GetAllRoamingWeatherSystems --------------------------------------------

export interface RoamingWeatherRow {
  readonly locationID: number | null;
  readonly sceneType: number;
}

/** Decode GetAllRoamingWeatherSystems -> roaming-weather systems (empty live). */
export function decodeRoamingWeatherSystems(
  result: JsonValue | null | undefined,
): RoamingWeatherRow[] {
  return readRowsetRows(result).map((row) => ({
    locationID: toOptionalID(row.locationID),
    sceneType: toNumber(row.sceneType),
  }));
}

// --- GetSecurityModifiedSystems ---------------------------------------------

/**
 * Decode GetSecurityModifiedSystems -> the list of solarSystemIDs whose security
 * was modified. Empty live (no modified systems seeded). The MAP read — distinct
 * from securityMgr.get_modified_systems.
 */
export function decodeSecurityModifiedSystems(result: JsonValue | null | undefined): number[] {
  const systems: number[] = [];
  for (const row of readRowsetRows(result)) {
    const solarSystemID = toNumber(row.solarSystemID);
    if (solarSystemID > 0) {
      systems.push(solarSystemID);
    }
  }
  return systems;
}

// --- GetIncursionGlobalReport -----------------------------------------------

export interface IncursionReport {
  readonly taleID: number;
  readonly templateClassID: number;
  readonly templateNameID: number;
  readonly stagingSolarSystemID: number;
  readonly aggressorFactionID: number;
  readonly state: number;
  readonly influence: number;
  readonly hasFinalEncounter: boolean;
  readonly effects: readonly number[];
  readonly rewardGroupID: number;
  readonly incursedSystems: readonly number[];
  readonly severity: number;
  readonly hasChat: boolean;
  readonly chatAnnouncementMessageId: number;
  readonly musicState: JsonValue;
}

function decodeNumberList(value: JsonValue | undefined): number[] {
  if (!isListValue(value)) {
    return [];
  }
  return value.items.map((item) => toNumber(item));
}

/**
 * Decode GetIncursionGlobalReport -> every active incursion as a plain object. The
 * wire is a list of util.KeyVals (buildIncursionReportEntry). `[]` is a real "no
 * incursions" state (this world seeds none). Entity ids stay data (R7d).
 */
export function decodeIncursionGlobalReport(
  result: JsonValue | null | undefined,
): IncursionReport[] {
  if (!isListValue(result)) {
    return [];
  }
  const reports: IncursionReport[] = [];
  for (const entry of result.items) {
    const stagingSolarSystemID = toNumber(readKeyVal(entry, "stagingSolarSystemID"));
    if (stagingSolarSystemID <= 0) {
      continue;
    }
    reports.push({
      taleID: toNumber(readKeyVal(entry, "taleID")),
      templateClassID: toNumber(readKeyVal(entry, "templateClassID")),
      templateNameID: toNumber(readKeyVal(entry, "templateNameID")),
      stagingSolarSystemID,
      aggressorFactionID: toNumber(readKeyVal(entry, "aggressorFactionID")),
      state: toNumber(readKeyVal(entry, "state")),
      influence: toNumber(readKeyVal(entry, "influence")),
      hasFinalEncounter: toBool(readKeyVal(entry, "hasFinalEncounter")),
      effects: decodeNumberList(readKeyVal(entry, "effects")),
      rewardGroupID: toNumber(readKeyVal(entry, "rewardGroupID")),
      incursedSystems: decodeNumberList(readKeyVal(entry, "incursedSystems")),
      severity: toNumber(readKeyVal(entry, "severity")),
      hasChat: toBool(readKeyVal(entry, "hasChat")),
      chatAnnouncementMessageId: toNumber(readKeyVal(entry, "chatAnnouncementMessageId")),
      musicState: (readKeyVal(entry, "musicState") ?? null) as JsonValue,
    });
  }
  return reports;
}

// --- GetSystemsInIncursions -------------------------------------------------

export interface IncursionSystemRow {
  readonly locationID: number;
  readonly sceneType: number;
  readonly templateNameID: number;
}

/**
 * Decode GetSystemsInIncursions -> the systems currently under incursion. `[]` is a
 * real "no incursions" state.
 */
export function decodeSystemsInIncursions(
  result: JsonValue | null | undefined,
): IncursionSystemRow[] {
  const rows: IncursionSystemRow[] = [];
  for (const row of readRowsetRows(result)) {
    const locationID = toNumber(row.locationID);
    if (locationID <= 0) {
      continue;
    }
    rows.push({
      locationID,
      sceneType: toNumber(row.sceneType),
      templateNameID: toNumber(row.templateNameID),
    });
  }
  return rows;
}
