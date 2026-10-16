// The probe scanner's results, as the retail client keeps them and lists them.
//
// THE NOTICE. scanSvc.OnSystemScanStopped(probes, results, absentTargets) (253 to 259) hands it to the scan handler of
// the session's solar system (scanHandlerBySystem, one for each system the session has been in): each probe idle,
// the scan over, the results registered in its ResultsHistory, the absent targets' results cleared
// (probescanning/scanHandler.py 46 to 58). Each result is a KeyVal: id, scanGroupID, groupID, typeID,
// strengthAttributeID, dungeonID, dungeonNameID, archetypeID, factionID, itemID, difficulty, certainty, data (the
// place where it is perfect, a tuple; else a deviation, a float, with pos the guess) and pos. EveJS sends these.
// Tranquility's recordings have no probe scan.
//
// THE HISTORY (probescanning/results.py). Each scan counts one. A result takes what an entry says, unless it is
// cached: an exploration site (a signature or an anomaly) once perfect stays as it was. Its certainty is kept by the
// scan it came in; its place is the data where that is a tuple, the pos where the data is a float. It is shown while
// it came in the last scan, or always where it is an exploration site (at nought where the last scan missed it).
// A result with a certainty of 0.25 is identified from then on.
//
// THE LIST (ui/inflight/scannerFiles/scanResults.py, scannerListEntries.ScanResultNew): distance from the ship, ID,
// name, group, signal strength (the certainty to a tenth of a per cent, cut down), by ID unless another column is
// chosen; "no results" where there are none. The name is the type's (an exploration site's: its dungeon's name)
// else the group's else the scan group's; the group is an exploration site's kind (scanSvc.GetGroupName,
// explorationSites.get_exploration_site_group_name) or the type group's name.
//
// Here it is plain text: no icon, no colour by certainty, no bar of the change, no tooltip; a perfect result in warp
// range has no Warp To button yet, and shows its 100%.

import { readKeyVal, type JsonValue } from "./wire.ts";

/** probescanning/const.py. */
export const PROBE_RESULT_PERFECT = 1.0;
export const PROBE_RESULT_GOOD = 0.25;
export const SCAN_GROUP = Object.freeze({
  starBase: 0, scrap: 1, fighters: 2, signatures: 3, ships: 4, structures: 5, drones: 6, celestials: 7, anomalies: 8,
  charges: 9, npcs: 10, orbitals: 11, deployable: 12, sovereignty: 13, abyssalTraces: 14,
});
const EXPLORATION_SITES: readonly number[] = [SCAN_GROUP.signatures, SCAN_GROUP.anomalies];

/** scanSvc.NAME_BY_SCANGROUPID. */
export const SCAN_GROUP_LABELS: Readonly<Record<number, string>> = Object.freeze({
  [SCAN_GROUP.anomalies]: "UI/Inflight/Scanner/CosmicAnomaly",
  [SCAN_GROUP.signatures]: "UI/Inflight/Scanner/CosmicSignature",
  [SCAN_GROUP.ships]: "UI/Inflight/Scanner/Ship",
  [SCAN_GROUP.structures]: "UI/Inflight/Scanner/Structure",
  [SCAN_GROUP.drones]: "UI/Inflight/Scanner/Drone",
  [SCAN_GROUP.charges]: "UI/Inflight/Scanner/Charge",
  [SCAN_GROUP.npcs]: "UI/Inflight/Scanner/NPC",
  [SCAN_GROUP.fighters]: "UI/Inflight/Scanner/Fighter",
  [SCAN_GROUP.starBase]: "UI/Inflight/Scanner/StarBase",
  [SCAN_GROUP.orbitals]: "UI/Inflight/Scanner/Orbital",
  [SCAN_GROUP.deployable]: "UI/Inflight/Scanner/Deployable",
  [SCAN_GROUP.sovereignty]: "UI/Inflight/Scanner/Sovereignty",
  [SCAN_GROUP.abyssalTraces]: "UI/Inflight/Scanner/AbyssalTrace",
});

/** explorationSites.EXPLORATION_SITE_TYPES, by the site's strength attribute (dogma/const.py). */
const SITE_TYPE = Object.freeze({ ore: 211, gas: 209, relic: 210, data: 208, wormhole: 1908, combat: 1136 });
export const SITE_TYPE_LABELS: Readonly<Record<number, string>> = Object.freeze({
  [SITE_TYPE.ore]: "UI/Inflight/Scanner/OreSite",
  [SITE_TYPE.gas]: "UI/Inflight/Scanner/GasSite",
  [SITE_TYPE.relic]: "UI/Inflight/Scanner/RelicSite",
  [SITE_TYPE.data]: "UI/Inflight/Scanner/DataSite",
  [SITE_TYPE.wormhole]: "UI/Inflight/Scanner/Wormhole",
  [SITE_TYPE.combat]: "UI/Inflight/Scanner/CombatSite",
});
/** explorationSites.COMBAT_GROUP_NAMES_BY_ARCHETYPE (eve/common/lib/appConst.py's archetypes). */
const COMBAT_GROUP_LABELS: Readonly<Record<number, string>> = Object.freeze({
  70: "UI/Inflight/Scanner/HomefrontOperationSite",
  33: "UI/Inflight/Scanner/FactionalWarfareSite", 34: "UI/Inflight/Scanner/FactionalWarfareSite",
  35: "UI/Inflight/Scanner/FactionalWarfareSite", 36: "UI/Inflight/Scanner/FactionalWarfareSite",
  68: "UI/Inflight/Scanner/FactionalWarfareSite",
  72: "UI/Inflight/Scanner/InsurgencySite", 73: "UI/Inflight/Scanner/InsurgencySite", 74: "UI/Inflight/Scanner/InsurgencySite",
  75: "UI/Inflight/Scanner/InsurgencySite", 76: "UI/Inflight/Scanner/InsurgencySite", 77: "UI/Inflight/Scanner/InsurgencySite",
  78: "UI/Inflight/Scanner/InsurgencySite", 79: "UI/Inflight/Scanner/InsurgencySite",
});

export const PROBE_RESULT_LABELS = Object.freeze({
  distance: "UI/Common/Distance",
  id: "UI/Common/ID",
  name: "UI/Common/Name",
  group: "UI/Common/Group",
  signalStrength: "UI/Inflight/Scanner/SignalStrength",
  /** Takes percentage. */
  percentage: "UI/Common/Percentage",
  noResults: "UI/Inflight/Scanner/NoScanResults",
});
export const PROBE_RESULT_WORD_LABELS: readonly string[] = [
  ...new Set([...Object.values(PROBE_RESULT_LABELS), ...Object.values(SCAN_GROUP_LABELS), ...Object.values(SITE_TYPE_LABELS), ...Object.values(COMBAT_GROUP_LABELS)]),
];

export type Vec3 = readonly [number, number, number];

/** One result as the server sends it. */
export interface ProbeResultEntry {
  readonly id: string;
  readonly scanGroupID: number | null;
  readonly groupID: number | null;
  readonly typeID: number | null;
  readonly strengthAttributeID: number | null;
  readonly dungeonID: number | null;
  readonly dungeonNameID: number | null;
  readonly archetypeID: number | null;
  readonly factionID: number | null;
  readonly itemID: number | null;
  readonly difficulty: number | null;
  readonly certainty: number;
  /** A tuple: the place; a float: the deviation; a list of places; null for anything else. */
  readonly data: Vec3 | number | readonly Vec3[] | null;
  readonly pos: Vec3 | null;
}

export interface ScanStopped {
  readonly probeIDs: readonly number[];
  readonly results: readonly ProbeResultEntry[];
  readonly absentTargets: readonly string[];
}

const numberOf = (value: JsonValue | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const wrapped = value as { type?: unknown; value?: unknown };
    if ((wrapped.type === "long" || wrapped.type === "real" || wrapped.type === "float") && wrapped.value !== undefined) {
      const read = Number(wrapped.value);
      return Number.isFinite(read) ? read : null;
    }
  }
  return null;
};
const itemsOf = (value: JsonValue | undefined): readonly JsonValue[] | null => {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object" && (value as { type?: unknown }).type === "list" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: JsonValue[] }).items;
  }
  return null;
};
const vectorOf = (value: JsonValue | undefined): Vec3 | null => {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value.map((part) => numberOf(part));
  return x === null || x === undefined || y === null || y === undefined || z === null || z === undefined ? null : [x, y, z];
};

function dataOf(value: JsonValue | undefined): ProbeResultEntry["data"] {
  // A tuple (an array on the page's side) is a place; a list is places; a float is a deviation.
  if (Array.isArray(value)) return vectorOf(value);
  const list = itemsOf(value);
  if (list !== null) {
    const places = list.map((item) => vectorOf(item)).filter((place): place is Vec3 => place !== null);
    return places;
  }
  return numberOf(value);
}

/** A result's KeyVal; null for one with no id. */
export function decodeProbeResult(value: JsonValue): ProbeResultEntry | null {
  const field = (key: string) => readKeyVal(value, key);
  const idValue = field("id");
  const id = typeof idValue === "string" ? idValue : typeof idValue === "number" ? String(idValue) : null;
  if (id === null || id === "") return null;
  const optional = (key: string) => numberOf(field(key));
  return {
    id,
    scanGroupID: optional("scanGroupID"),
    groupID: optional("groupID"),
    typeID: optional("typeID"),
    strengthAttributeID: optional("strengthAttributeID"),
    dungeonID: optional("dungeonID"),
    dungeonNameID: optional("dungeonNameID"),
    archetypeID: optional("archetypeID"),
    factionID: optional("factionID"),
    itemID: optional("itemID"),
    difficulty: optional("difficulty"),
    certainty: optional("certainty") ?? 0,
    data: dataOf(field("data")),
    pos: vectorOf(field("pos")),
  };
}

/** OnSystemScanStopped's three arguments. */
export function decodeScanStopped(args: readonly JsonValue[]): ScanStopped {
  const probeIDs = (itemsOf(args[0]) ?? []).map((id) => numberOf(id)).filter((id): id is number => id !== null);
  const results = (itemsOf(args[1]) ?? []).map((entry) => decodeProbeResult(entry)).filter((entry): entry is ProbeResultEntry => entry !== null);
  const absentTargets = (itemsOf(args[2]) ?? []).map((id) => (typeof id === "string" ? id : typeof id === "number" ? String(id) : null)).filter((id): id is string => id !== null);
  return { probeIDs, results, absentTargets };
}

const isExplorationSite = (scanGroupID: number | null): boolean => scanGroupID !== null && EXPLORATION_SITES.includes(scanGroupID);
/** util.IsPerfectResult: perfect, and its data a place. */
const isPerfectEntry = (entry: ProbeResultEntry): boolean => entry.certainty >= PROBE_RESULT_PERFECT && entry.data !== null && typeof entry.data !== "number" && entry.data.length === 3 && typeof entry.data[0] === "number";

/** One result as the history holds it (results.Result). */
interface HeldResult {
  readonly entry: ProbeResultEntry;
  readonly pos: Vec3 | null;
  /** (scan number, certainty), in the order they came. */
  readonly certainties: ReadonlyArray<readonly [number, number]>;
  readonly scanNumberPerfect: number | null;
  readonly isPerfect: boolean;
  readonly isIdentified: boolean;
}

export interface ResultsHistory {
  readonly scanNumber: number;
  readonly results: ReadonlyMap<string, HeldResult>;
}

export const EMPTY_RESULTS_HISTORY: ResultsHistory = Object.freeze({ scanNumber: 0, results: new Map() });

/** Result._GetPosition. */
function placeOf(entry: ProbeResultEntry): Vec3 | null {
  const data = entry.data;
  if (typeof data === "number") return entry.pos;
  if (data === null) return null;
  if (data.length === 3 && typeof data[0] === "number") return data as Vec3;
  const places = data as readonly Vec3[];
  if (places.length === 0) return [0, 0, 0];
  const sum = places.reduce<[number, number, number]>((acc, place) => [acc[0] + place[0], acc[1] + place[1], acc[2] + place[2]], [0, 0, 0]);
  return [sum[0] / places.length, sum[1] / places.length, sum[2] / places.length];
}

/** Result.AddEntry: the persistable attributes are kept where the entry says nothing of them. */
function withEntry(held: HeldResult | undefined, entry: ProbeResultEntry, scanNumber: number): HeldResult {
  if (held !== undefined && held.scanNumberPerfect !== null) return held;
  const before = held?.entry;
  const keep = <K extends keyof ProbeResultEntry>(key: K): ProbeResultEntry[K] => (entry[key] ?? before?.[key] ?? null) as ProbeResultEntry[K];
  const merged: ProbeResultEntry = {
    ...entry,
    itemID: keep("itemID"), typeID: keep("typeID"), groupID: keep("groupID"), strengthAttributeID: keep("strengthAttributeID"),
    dungeonNameID: keep("dungeonNameID"), dungeonID: keep("dungeonID"), archetypeID: keep("archetypeID"), factionID: keep("factionID"),
  };
  const perfect = isPerfectEntry(entry);
  return {
    entry: merged,
    pos: placeOf(entry),
    certainties: [...(held?.certainties ?? []), [scanNumber, entry.certainty]],
    scanNumberPerfect: isExplorationSite(entry.scanGroupID) && perfect ? scanNumber : null,
    isPerfect: perfect,
    isIdentified: held?.isIdentified === true || entry.certainty >= PROBE_RESULT_GOOD,
  };
}

/** ResultsHistory.RegisterResults: one more scan, and what it found. */
export function registerResults(history: ResultsHistory, entries: readonly ProbeResultEntry[]): ResultsHistory {
  const scanNumber = history.scanNumber + 1;
  const results = new Map(history.results);
  for (const entry of entries) results.set(entry.id, withEntry(results.get(entry.id), entry, scanNumber));
  return { scanNumber, results };
}

/** ResultsHistory.ClearResults. */
export function clearResults(history: ResultsHistory, targetIDs: readonly string[]): ResultsHistory {
  if (targetIDs.length === 0) return history;
  const results = new Map(history.results);
  for (const id of targetIDs) results.delete(id);
  return { scanNumber: history.scanNumber, results };
}

/** What the list shows of one result (Result.GetAsDict). */
export interface ShownResult extends ProbeResultEntry {
  readonly prevCertainty: number;
  readonly pos: Vec3 | null;
  readonly isPerfect: boolean;
  readonly isIdentified: boolean;
}

const certaintyAt = (held: HeldResult, scanNumber: number): number => held.certainties.find(([scan]) => scan === scanNumber)?.[1] ?? 0;

/** ResultsHistory.LastResultIterator: the results still valid, as the list has them. */
export function lastResults(history: ResultsHistory): ShownResult[] {
  const shown: ShownResult[] = [];
  const scanNumber = history.scanNumber;
  for (const held of history.results.values()) {
    const lastScan = held.certainties.at(-1)?.[0] ?? null;
    if (!isExplorationSite(held.entry.scanGroupID) && lastScan !== scanNumber) continue;
    const [certainty, prevCertainty] = held.scanNumberPerfect !== null
      ? [PROBE_RESULT_PERFECT, held.scanNumberPerfect === scanNumber ? certaintyAt(held, scanNumber - 1) : PROBE_RESULT_PERFECT]
      : [certaintyAt(held, scanNumber), certaintyAt(held, scanNumber - 1)];
    shown.push({ ...held.entry, certainty, prevCertainty, pos: held.pos, isPerfect: held.isPerfect, isIdentified: held.isIdentified });
  }
  return shown;
}

/** The words a result's row is made of. */
export interface ResultRow {
  readonly id: string;
  readonly distance: number | null;
  readonly name: string;
  readonly group: string;
  readonly signal: string;
  readonly certainty: number;
}

export interface ResultWording {
  readonly words: (label: string, args?: Record<string, string | number>) => string | null;
  /** A type's name, a group's name (by its ID), a message's text; null where it cannot be had yet. */
  readonly typeName: (typeID: number) => string | null;
  readonly groupName: (groupID: number) => string | null;
  readonly messageText: (messageID: number) => string | null;
}

/** get_exploration_site_group_name. */
function siteGroupName(result: ShownResult, wording: ResultWording): string | null {
  const siteType = result.strengthAttributeID;
  if (siteType === null) return null;
  const combat = siteType === SITE_TYPE.combat && result.archetypeID !== null ? COMBAT_GROUP_LABELS[result.archetypeID] : undefined;
  if (combat !== undefined) {
    const first = wording.words(combat);
    const second = wording.words(SITE_TYPE_LABELS[SITE_TYPE.combat]!);
    return first === null || second === null ? null : `${first} - ${second}`;
  }
  const label = SITE_TYPE_LABELS[siteType];
  return label === undefined ? null : wording.words(label);
}

/** scanSvc.GetGroupName. */
function groupNameOf(result: ShownResult, wording: ResultWording): string {
  if (isExplorationSite(result.scanGroupID)) return siteGroupName(result, wording) ?? "";
  return result.groupID === null ? "" : wording.groupName(result.groupID) ?? "";
}

/** scanSvc.GetTypeName. */
function typeNameOf(result: ShownResult, wording: ResultWording): string {
  if (isExplorationSite(result.scanGroupID)) return result.dungeonNameID === null ? "" : wording.messageText(result.dungeonNameID) ?? "";
  return result.typeID === null ? "" : wording.typeName(result.typeID) ?? "";
}

/** The rows of the list, by ID (the client's default column, ascending). */
export function resultRows(results: readonly ShownResult[], myPosition: Vec3 | null, wording: ResultWording): ResultRow[] {
  return results.map((result) => {
    // scanSvc.GetDisplayName: the type's name, else the group's, else the scan group's.
    let name = result.typeID ? typeNameOf(result, wording) : "";
    if (name === "" && result.groupID) name = groupNameOf(result, wording);
    if (name === "") name = (result.scanGroupID === null ? null : SCAN_GROUP_LABELS[result.scanGroupID] ? wording.words(SCAN_GROUP_LABELS[result.scanGroupID]!) : null) ?? "";
    const distance = myPosition === null || result.pos === null ? null : Math.hypot(result.pos[0] - myPosition[0], result.pos[1] - myPosition[1], result.pos[2] - myPosition[2]);
    // ScanResultNew.Load: the certainty to a tenth of a per cent, cut down.
    const percentage = Math.floor(result.certainty * 1000) / 10;
    return {
      id: result.id,
      distance,
      name,
      group: groupNameOf(result, wording),
      signal: wording.words(PROBE_RESULT_LABELS.percentage, { percentage }) ?? `${percentage}%`,
      certainty: result.certainty,
    };
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
