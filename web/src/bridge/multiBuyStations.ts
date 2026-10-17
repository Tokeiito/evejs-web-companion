// The multibuy window's station list (buyMultiFromBase.GetStations, 382 to 400): the markets of the pilot's region
// that lie in its system, other than where it is docked, sorted as the client sorts them, with where it is docked
// first ("Current Station - ..."; LoadStationOptions picks it, or the first where it is docked nowhere).
//
// The region's markets (structureDirectory.GetMarketDockableLocationsInRegion, structureDirectory.py 59 to 72): of
// what GetMyCharacterStructures answers, by number, those whose services hold SERVICE_MARKET (5). Tranquility answers
// NPC stations there too, a station service with no structure service as the key None (eve.js b5f7b0009).
//
// The system's items (mapSvc.GetSolarsystemItems): its NPC stations as the client's map data has them, each with its
// celestialIndex and orbitIndex, and its structures as GetStructureMapData answers them (None for both). Sorted by
// (celestialIndex, orbitIndex, itemName) as Python sorts tuples: None before any number, names by code point.

import { readDictPairs, type JsonValue } from "./wire.ts";

/** structures.SERVICE_MARKET. */
const SERVICE_MARKET = 5;

/** A dict's pairs, whether a dict or a KeyVal carries them. */
function pairsOf(value: JsonValue | undefined): ReadonlyArray<readonly [JsonValue, JsonValue]> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as { type?: unknown; args?: unknown };
  // A KeyVal carries its fields as a dict in its args.
  return readDictPairs(record.type === "dict" ? value : record.args) as ReadonlyArray<readonly [JsonValue, JsonValue]>;
}

const numberOf = (value: JsonValue | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (value as { type?: unknown }).type === "long") {
    const number = Number((value as { value?: unknown }).value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
};

/** GetMarketDockableLocationsInRegion: the numbers of the stations and structures whose services hold the market. */
export function marketDockableLocations(answer: JsonValue | null | undefined): Set<number> {
  const markets = new Set<number>();
  for (const [key, info] of pairsOf(answer ?? undefined)) {
    const structureID = numberOf(key);
    if (structureID === null || structureID <= 0) continue;
    const services = pairsOf(pairsOf(info).find(([name]) => name === "services")?.[1]);
    if (services.some(([serviceID]) => numberOf(serviceID) === SERVICE_MARKET)) markets.add(structureID);
  }
  return markets;
}

/** One of the system's items (GetSolarsystemItems' row): its number, name, celestialIndex and orbitIndex. */
export interface SystemItem {
  readonly itemID: number;
  readonly itemName: string;
  readonly celestialIndex: number | null;
  readonly orbitIndex: number | null;
}

/** Python 2's order of two numbers or Nones: None first. */
function compareNumbers(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}

/** Python 2's order of two unicode names: by code point. */
function compareNames(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  for (let at = 0; at < Math.min(a.length, b.length); at += 1) {
    const difference = a[at]!.codePointAt(0)! - b[at]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/**
 * GetStations: the system's items that are among the region's markets ({...} of them: each once), but where the pilot
 * is docked, sorted by (celestialIndex, orbitIndex, itemName); where it is docked first.
 */
export function multiBuyStationList(
  markets: ReadonlySet<number>,
  items: readonly SystemItem[],
  currentStationID: number | null,
): readonly SystemItem[] {
  const seen = new Set<number>();
  const others = items.filter((item) => {
    if (!markets.has(item.itemID) || item.itemID === currentStationID || seen.has(item.itemID)) return false;
    seen.add(item.itemID);
    return true;
  });
  others.sort((left, right) =>
    compareNumbers(left.celestialIndex, right.celestialIndex)
    || compareNumbers(left.orbitIndex, right.orbitIndex)
    || compareNames(left.itemName, right.itemName));
  return others;
}
