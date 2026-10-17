// The assets window's search, as the client makes it (eve/client/script/ui/shared/assetsWindow.py: Search_thread 407 to
// 457, _LoadSearch 805 to 849, GetSubContent 712 to 739, GetContainerGroupEntries 690 to 710, SearchTypeID and
// GetSearchTextForTypeID 971 to 981; eveAssets/assetSearchUtil.py: ParseString, IsPartOfText, the keywords and their
// match functions; eveAssets/assetSearching.py: GetSearchResults, MatchesTypeChecks, GetFakeRowset).
//
// The text is lowercased whole and split by ParseString into the plain words before the first "keyword:" and the
// keyword/value pairs. With plain words, an item is kept where its type's, group's or category's name holds them, and
// the keywords count for nothing; with none, every keyword's condition must hold. Each keyword is the first of the
// client's keywords, sorted by their words, that begins with what was typed; all seventeen are the page's.
//
// A keyword of a place (security, system, constellation, region, station) asks where each thing is: the station the
// client gives its row (AddStationIDToFakeRow: a container's station for what is in one, the location of what lies in
// a hangar or in asset safety). A thing with none, as a ship's cargo and fitting are, has no system to find: the
// client's lookup raises there (_GetSolarSystemID: neither GetStation nor GetStructureInfo has None), out of its search
// thread, and the search never finishes. The page's does the same (AssetSearchStopped).

/** One of the pilot's things as the search sees it (GetFakeRowset's row). */
export interface AssetSearchItem {
  readonly itemID: number;
  readonly typeID: number;
  readonly groupID: number;
  readonly categoryID: number;
  readonly locationID: number;
  readonly flagID: number;
  /** The row's quantity: -1 for a thing assembled. */
  readonly quantity: number;
}

/** The names the search compares, lowercased (SearchNamesHelper); null for a type the client does not know. */
export interface AssetSearchNames {
  typeName(typeID: number): string | null;
  groupName(typeID: number): string | null;
  categoryName(typeID: number): string | null;
}

/** The kinds of keyword (AssetKeywordSearch's Match functions). */
export type AssetKeywordKind =
  | "type" | "typeExact" | "group" | "category" | "minimumQuantity" | "maximumQuantity" | "metaLevel" | "metaGroup"
  | "techLevel" | "minSecurity" | "maxSecurity" | "securityClass" | "solarSystem" | "constellation" | "region"
  | "stationName" | "blueprint";

/** What the search knows of a station a thing is at, its names lowercased (GetSolarsystemName and the others). */
export interface AssetSearchStation {
  readonly stationName: string;
  readonly systemName: string;
  readonly constellationName: string;
  readonly regionName: string;
  /** mapSvc.GetSecurityStatus: the system's level, rounded to a place (FmtSystemSecStatus); null where not had. */
  readonly security: number | null;
}

/** What the conditions read besides the names: a type's meta and tech, a station's place, and the options' words. */
export interface AssetSearchFacts {
  /** evetypes.GetMetaLevel, GetMetaGroupID, GetTechLevel; null where the type has none. */
  metaLevel(typeID: number): number | null;
  metaGroupID(typeID: number): number | null;
  techLevel(typeID: number): number | null;
  /** metaGroups.get_name, lowercased. */
  metaGroupName(metaGroupID: number): string;
  /** The station's facts; null where the client's lookup of it would raise (no station, or none it knows). */
  station(stationID: number | null): AssetSearchStation | null;
  /** The options' words (OptionSecurityHigh and the rest), as the client's labels have them. */
  readonly options: Readonly<Record<AssetSearchOption, string>>;
}

export type AssetSearchOption = "high" | "low" | "null" | "zero" | "empire" | "safe" | "blueprintCopy" | "blueprintOriginal";

/** AssetKeywordSearch's option labels (__init__, 61 to 68). */
export const ASSET_SEARCH_OPTION_LABELS: Readonly<Record<AssetSearchOption, string>> = Object.freeze({
  safe: "UI/Inventory/AssetSearch/OptionSecuritySafe",
  high: "UI/Inventory/AssetSearch/OptionSecurityHigh",
  low: "UI/Inventory/AssetSearch/OptionSecurityLow",
  null: "UI/Inventory/AssetSearch/OptionSecurityNull",
  zero: "UI/Inventory/AssetSearch/OptionSecurityZero",
  empire: "UI/Inventory/AssetSearch/OptionSecurityEmpire",
  blueprintCopy: "UI/Inventory/AssetSearch/OptionBlueprintCopy",
  blueprintOriginal: "UI/Inventory/AssetSearch/OptionBlueprintOriginal",
});

/** The keywords whose conditions ask where a thing is, and those that ask of its type's meta and tech. */
export const PLACE_KEYWORDS: ReadonlySet<AssetKeywordKind> = new Set(["minSecurity", "maxSecurity", "securityClass", "solarSystem", "constellation", "region", "stationName"]);
export const META_KEYWORDS: ReadonlySet<AssetKeywordKind> = new Set(["metaLevel", "metaGroup", "techLevel"]);

/** The client's search thread raising: a thing's place asked of a row with none. */
export class AssetSearchStopped extends Error {
  constructor() {
    super("The search asked where a thing is that lies in no station.");
    this.name = "AssetSearchStopped";
  }
}

/** A condition of a keyword: of a thing, and the station its row is given (null for none). */
export type AssetSearchCondition = (item: AssetSearchItem, stationID: number | null) => boolean;

/** AssetKeywordSearch.GetSearchKeywords (408 to 435): each keyword's label, and its kind. */
export const ASSET_SEARCH_KEYWORDS: readonly { readonly label: string; readonly kind: AssetKeywordKind }[] = Object.freeze([
  { label: "UI/Inventory/AssetSearch/KeywordType", kind: "type" },
  { label: "UI/Inventory/AssetSearch/KeywordTypeExact", kind: "typeExact" },
  { label: "UI/Inventory/AssetSearch/KeywordGroup", kind: "group" },
  { label: "UI/Inventory/AssetSearch/KeywordCategory", kind: "category" },
  { label: "UI/Inventory/AssetSearch/KeywordMinimumQuantity", kind: "minimumQuantity" },
  { label: "UI/Inventory/AssetSearch/KeywordMaximumQuantity", kind: "maximumQuantity" },
  { label: "UI/Inventory/AssetSearch/KeywordMetalevel", kind: "metaLevel" },
  { label: "UI/Inventory/AssetSearch/KeywordMetagroup", kind: "metaGroup" },
  { label: "UI/Inventory/AssetSearch/KeywordTechLevel", kind: "techLevel" },
  { label: "UI/Inventory/AssetSearch/KeywordMinSecurityLevel", kind: "minSecurity" },
  { label: "UI/Inventory/AssetSearch/KeywordMaxSecurityLevel", kind: "maxSecurity" },
  { label: "UI/Inventory/AssetSearch/KeywordSecurityClass", kind: "securityClass" },
  { label: "UI/Inventory/AssetSearch/KeywordSolarSystem", kind: "solarSystem" },
  { label: "UI/Inventory/AssetSearch/KeywordConstellation", kind: "constellation" },
  { label: "UI/Inventory/AssetSearch/KeywordRegion", kind: "region" },
  { label: "UI/Inventory/AssetSearch/KeywordStationName", kind: "stationName" },
  { label: "UI/Inventory/AssetSearch/KeywordBlueprint", kind: "blueprint" },
]);

/** int(text) in Python: a whole number, spaces about it allowed; null where it raises ValueError. */
function pyInt(text: string): number | null {
  return /^\s*[+-]?\d+\s*$/.test(text) ? Number.parseInt(text.trim(), 10) : null;
}

/** float(text) in Python: a decimal, an exponent, inf or nan, spaces about it allowed; null where it raises. */
function pyFloat(text: string): number | null {
  const trimmed = text.trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  if (/^[+-]?inf(inity)?$/i.test(trimmed)) return trimmed.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(trimmed)) return Number.NaN;
  return null;
}

/** "not x" in Python, for a number or None: nought and None are false; nan is not. */
const pyNot = (value: number | null): boolean => value === null || value === 0;

/** IsPartOfText(text, value): the text begins with the value, both lowercased. */
const isPartOfText = (text: string, value: string): boolean => text.toLowerCase().startsWith(value.toLowerCase());

/** appConst.securityClassZeroSec and the others (eveuniverse/security.py), and SecurityClassFromLevel. */
const SECURITY_CLASS = { zero: 0, low: 1, high: 2, safe: 3 } as const;
function securityClassFromLevel(level: number): number {
  if (level <= 0) return SECURITY_CLASS.zero;
  if (level < 0.45) return SECURITY_CLASS.low;
  if (level < 0.95) return SECURITY_CLASS.high;
  return SECURITY_CLASS.safe;
}

/** inventorycommon.const.categoryBlueprint; appConst.singletonBlueprintCopy. */
const CATEGORY_BLUEPRINT = 9;
const SINGLETON_BLUEPRINT_COPY = 2;

// assetSearchUtil.REGEX: a word followed by ':' (a keyword), then a decimal, a whole number, or a run of word
// characters, spaces and some others; not followed by a word character, '+' or ':' (the next keyword's start). Python's
// \w and \b under re.UNICODE, here by Unicode classes.
const KEYWORD_PATTERN = /(?<![\p{L}\p{N}_])([\p{L}\p{N}_]+):\s*([-+]?\p{Nd}+\.\p{Nd}+|[-+]?\p{Nd}+|[\p{L}\p{N}_\s'()\][."/,&!#-]+)(?![\p{L}\p{N}_+:])/giu;

/**
 * ParseString (30 to 38): the text before the first keyword, stripped, and each keyword with its value (the value's
 * trailing spaces stripped). The text is cut where the first keyword (as matched, with its ':') is first found in it.
 */
export function parseAssetSearch(text: string): { readonly searchType: string; readonly matches: readonly (readonly [string, string])[] } {
  const matches = [...text.matchAll(KEYWORD_PATTERN)].map((match) => [match[1]!, match[2]!] as const);
  let rest = text;
  if (matches.length > 0) {
    const key = `${matches[0]![0]}:`;
    const at = text.indexOf(key);
    rest = at < 0 ? text.slice(0, -1) : text.slice(0, at);
  }
  return { searchType: rest.trim(), matches: matches.map(([key, value]) => [key, value.replace(/\s+$/u, "")] as const) };
}

/** The keywords in the client's order (localization.util.Sort by their words; here a case-blind compare). */
function sortedKeywords(keywordWords: Readonly<Record<string, string>>): { readonly word: string; readonly kind: AssetKeywordKind }[] {
  return ASSET_SEARCH_KEYWORDS
    .map((keyword) => ({ word: keywordWords[keyword.label] ?? "", kind: keyword.kind }))
    .filter((keyword) => keyword.word !== "")
    .sort((left, right) => left.word.localeCompare(right.word, undefined, { sensitivity: "base" }));
}

/** The kinds of the keywords typed (each the first keyword that begins with the word typed): what the search must read. */
export function assetSearchKinds(matches: readonly (readonly [string, string])[], keywordWords: Readonly<Record<string, string>>): Set<AssetKeywordKind> {
  const keywords = sortedKeywords(keywordWords);
  const kinds = new Set<AssetKeywordKind>();
  for (const [word] of matches) {
    const keyword = keywords.find((each) => isPartOfText(each.word, word));
    if (keyword !== undefined) kinds.add(keyword.kind);
  }
  return kinds;
}

/**
 * GetConditions (387 to 401) with the keywords' words: each typed keyword's condition, from the first keyword that
 * begins with it (IsPartOfText), as its Match function makes it (assetSearchUtil.py 89 to 406).
 */
export function assetSearchConditions(
  matches: readonly (readonly [string, string])[],
  keywordWords: Readonly<Record<string, string>>,
  names: AssetSearchNames,
  facts: AssetSearchFacts,
): readonly AssetSearchCondition[] {
  const keywords = sortedKeywords(keywordWords);
  // The per-run caches (ResetPerRunDicts): type and typeExact share theirs, by the type's number.
  const typeMatched = new Map<number, boolean>();
  const groupMatched = new Map<number, boolean>();
  const categoryMatched = new Map<number, boolean>();
  const conditions: AssetSearchCondition[] = [];
  /** _GetSolarSystemID's raising, where the row has no station the client can find. */
  const placeOf = (stationID: number | null): AssetSearchStation => {
    const station = facts.station(stationID);
    if (station === null) throw new AssetSearchStopped();
    return station;
  };
  for (const [word, value] of matches) {
    const keyword = keywords.find((each) => isPartOfText(each.word, word));
    if (keyword === undefined) continue;
    const cached = (cache: Map<number, boolean>, key: number, decide: () => boolean): boolean => {
      const had = cache.get(key);
      if (had !== undefined) return had;
      const matched = decide();
      cache.set(key, matched);
      return matched;
    };
    if (keyword.kind === "type") {
      conditions.push((item) => cached(typeMatched, item.typeID, () => (names.typeName(item.typeID) ?? "").includes(value)));
    } else if (keyword.kind === "typeExact") {
      conditions.push((item) => cached(typeMatched, item.typeID, () => (names.typeName(item.typeID) ?? "").trim() === value));
    } else if (keyword.kind === "group") {
      conditions.push((item) => cached(groupMatched, item.groupID, () => (names.groupName(item.typeID) ?? "").includes(value)));
    } else if (keyword.kind === "category") {
      conditions.push((item) => cached(categoryMatched, item.categoryID, () => (names.categoryName(item.typeID) ?? "").includes(value)));
    } else if (keyword.kind === "minimumQuantity" || keyword.kind === "maximumQuantity") {
      // MatchMinimumQuantity, MatchMaximumQuantity: a whole number (none, and nought, match only an empty value) and
      // the stack's size against it.
      const quantity = pyInt(value);
      const atLeast = keyword.kind === "minimumQuantity";
      conditions.push((item) => {
        if (pyNot(quantity)) return value === "";
        const stacksize = item.quantity < 0 ? 1 : item.quantity;
        return atLeast ? stacksize >= quantity! : stacksize <= quantity!;
      });
    } else if (keyword.kind === "metaLevel" || keyword.kind === "techLevel") {
      // MatchMetalevel, MatchTechlevel: the level asked (nought too matching only an empty value), the type's own
      // (GetMetaLevel: nought where none; GetTechLevel: one where none).
      const level = pyInt(value);
      const meta = keyword.kind === "metaLevel";
      conditions.push((item) => {
        if (pyNot(level)) return value === "";
        const own = meta ? Math.trunc(facts.metaLevel(item.typeID) || 0) : Math.trunc(facts.techLevel(item.typeID) || 1);
        return level === own;
      });
    } else if (keyword.kind === "metaGroup") {
      // MatchMetagroup: the type's meta group's name holds the value; a type with none matches nothing.
      const matched = new Map<number, boolean>();
      conditions.push((item) => {
        const metaGroupID = Math.trunc(facts.metaGroupID(item.typeID) || 0);
        return cached(matched, metaGroupID, () => metaGroupID > 0 && facts.metaGroupName(metaGroupID).includes(value));
      });
    } else if (keyword.kind === "minSecurity" || keyword.kind === "maxSecurity") {
      // MatchMinSecurity, MatchMaxSecurity: a number (none, and nought, match only an empty value) against the
      // rounded level of the system the thing's station is in.
      const secLevel = pyFloat(value);
      const atLeast = keyword.kind === "minSecurity";
      const matched = new Map<number | null, boolean>();
      conditions.push((item, stationID) => {
        if (pyNot(secLevel)) return value === "";
        const had = matched.get(stationID);
        if (had !== undefined) return had;
        const security = placeOf(stationID).security;
        const result = security !== null && (atLeast ? security >= secLevel! : security <= secLevel!);
        matched.set(stationID, result);
        return result;
      });
    } else if (keyword.kind === "securityClass") {
      // MatchSecurityClass: the option the value begins (high, low, null or zero, empire, safe, in that order), and the
      // class of the thing's system's rounded level among the option's.
      const options = facts.options;
      const classes: readonly number[] | null = isPartOfText(options.high, value) ? [SECURITY_CLASS.high]
        : isPartOfText(options.low, value) ? [SECURITY_CLASS.low]
        : isPartOfText(options.null, value) || isPartOfText(options.zero, value) ? [SECURITY_CLASS.zero]
        : isPartOfText(options.empire, value) ? [SECURITY_CLASS.safe, SECURITY_CLASS.high, SECURITY_CLASS.low]
        : isPartOfText(options.safe, value) ? [SECURITY_CLASS.safe]
        : null;
      const matched = new Map<number | null, boolean>();
      conditions.push((item, stationID) => {
        if (classes === null) return value === "";
        const had = matched.get(stationID);
        if (had !== undefined) return had;
        const security = placeOf(stationID).security;
        const result = security !== null && classes.includes(securityClassFromLevel(security));
        matched.set(stationID, result);
        return result;
      });
    } else if (keyword.kind === "solarSystem" || keyword.kind === "constellation" || keyword.kind === "region" || keyword.kind === "stationName") {
      // MatchSolarSystem, MatchConstellation, MatchRegion, MatchStationName: the lowercased name of the thing's
      // station's system, constellation, region, or of the station itself, holds the value.
      const kind = keyword.kind;
      const matched = new Map<number | null, boolean>();
      conditions.push((item, stationID) => {
        const had = matched.get(stationID);
        if (had !== undefined) return had;
        const place = placeOf(stationID);
        const name = kind === "solarSystem" ? place.systemName
          : kind === "constellation" ? place.constellationName
          : kind === "region" ? place.regionName
          : place.stationName;
        const result = name.includes(value);
        matched.set(stationID, result);
        return result;
      });
    } else {
      // MatchBlueprint: copy or original by the option the value begins (copy first); an empty value matches all, an
      // unknown one nothing; a blueprint an original where its singleton is not the copy's.
      const isOriginal = isPartOfText(facts.options.blueprintCopy, value) ? false
        : isPartOfText(facts.options.blueprintOriginal, value) ? true
        : null;
      conditions.push((item) => {
        if (value === "") return true;
        if (isOriginal === null) return false;
        if (item.categoryID !== CATEGORY_BLUEPRINT) return false;
        const singleton = item.quantity < 0 ? -item.quantity : 0;
        return isOriginal ? singleton !== SINGLETON_BLUEPRINT_COPY : singleton === SINGLETON_BLUEPRINT_COPY;
      });
    }
  }
  return conditions;
}

/** const.groupSecureCargoContainer, groupAuditLogSecureContainer, groupFreightContainer, groupCargoContainer. */
const CONTAINER_GROUPS: ReadonlySet<number> = new Set([340, 448, 649, 12]);
/** const.typeAssetSafetyWrap, typePlasticWrap. */
const TYPE_ASSET_SAFETY_WRAP = 60;
const TYPE_PLASTIC_WRAP = 3468;
/** const.flagHangar, flagWallet, flagAssetSafety: what a station's search results list of what lies there. */
const LISTED_FLAGS: ReadonlySet<number> = new Set([4, 1, 36]);
/** const.flagHangar, flagAssetSafety: what AddStationIDToFakeRow gives its location as its station. */
const STATION_FLAGS: ReadonlySet<number> = new Set([4, 36]);

/** A station of the results: the things there, and its containers with the things in them that matched. */
export interface AssetSearchLocation {
  readonly stationID: number;
  readonly solarSystemID: number;
  /** The things lying at the station itself (only those of the hangar, wallet and asset safety are listed). */
  readonly items: readonly AssetSearchItem[];
  readonly containers: readonly { readonly container: AssetSearchItem; readonly items: readonly AssetSearchItem[] }[];
  /** _LoadSearch's count: the things at the station and in its containers. */
  readonly itemCount: number;
}

/**
 * GetSearchResults (11 to 61) and Search_thread's grouping (424 to 452): the things that match, by where they lie;
 * a container's (not plastic wrap) under its station; each station that the pilot's stations list (ListStations)
 * holds, sorted by system and station. A thing whose type the client does not know, or whose stack is empty, is left
 * out; so is anything lying in a ship (its location is no station).
 */
export function searchAssets(
  items: readonly AssetSearchItem[],
  searchType: string,
  conditions: readonly AssetSearchCondition[],
  names: AssetSearchNames,
  ownerStations: ReadonlyMap<number, { readonly solarSystemID: number }>,
): AssetSearchLocation[] {
  const containers = new Map<number, AssetSearchItem>();
  for (const item of items) {
    if (CONTAINER_GROUPS.has(item.groupID) || item.typeID === TYPE_ASSET_SAFETY_WRAP) containers.set(item.itemID, item);
  }
  const stations = new Map<number, AssetSearchItem[]>();
  const itemsByContainer = new Map<number, AssetSearchItem[]>();
  const failedTypeCheck = new Set<number>();
  for (const item of items) {
    if (names.typeName(item.typeID) === null) continue;
    // GetListForFakeItemRow: stacksize is 1 for a thing assembled (quantity -1), else its quantity.
    const stacksize = item.quantity < 0 ? 1 : item.quantity;
    if (stacksize === 0) continue;
    if (searchType) {
      if (failedTypeCheck.has(item.typeID)) continue;
      // MatchesTypeChecks (64 to 74): the type's, the group's or the category's name holds the words.
      const matches = [names.typeName(item.typeID), names.groupName(item.typeID), names.categoryName(item.typeID)]
        .some((name) => name !== null && name.includes(searchType));
      if (!matches) {
        failedTypeCheck.add(item.typeID);
        continue;
      }
    } else {
      // AddStationIDToFakeRow (35 to 43): a container's station for what is in it, the location of what lies in a
      // hangar or asset safety, else none.
      const container = containers.get(item.locationID);
      const stationID = container !== undefined ? container.locationID : STATION_FLAGS.has(item.flagID) ? item.locationID : null;
      if (!conditions.every((condition) => condition(item, stationID))) continue;
    }
    if (containers.has(item.locationID)) {
      const held = itemsByContainer.get(item.locationID) ?? [];
      if (!held.some((each) => each.itemID === item.itemID)) held.push(item);
      itemsByContainer.set(item.locationID, held);
    } else {
      stations.set(item.locationID, [...(stations.get(item.locationID) ?? []), item]);
    }
  }
  const containersByStation = new Map<number, { container: AssetSearchItem; items: AssetSearchItem[] }[]>();
  for (const [containerID, inContainer] of itemsByContainer) {
    const container = containers.get(containerID);
    if (container === undefined || container.typeID === TYPE_PLASTIC_WRAP) continue;
    containersByStation.set(container.locationID, [...(containersByStation.get(container.locationID) ?? []), { container, items: inContainer }]);
  }
  for (const stationID of containersByStation.keys()) if (!stations.has(stationID)) stations.set(stationID, []);
  const locations: AssetSearchLocation[] = [];
  for (const [stationID, stationItems] of stations) {
    const station = ownerStations.get(stationID);
    if (station === undefined) continue;
    const held = containersByStation.get(stationID) ?? [];
    locations.push({
      stationID,
      solarSystemID: station.solarSystemID,
      items: stationItems.filter((item) => LISTED_FLAGS.has(item.flagID)),
      containers: held.sort((left, right) => left.container.itemID - right.container.itemID),
      itemCount: stationItems.length + held.reduce((sum, each) => sum + each.items.length, 0),
    });
  }
  return locations.sort((left, right) => left.solarSystemID - right.solarSystemID || left.stationID - right.stationID);
}

/** GetSearchTextForTypeID (980 to 981): the exact-type keyword and the type's name. */
export function assetSearchTextForType(typeExactWord: string, typeName: string): string {
  return `${typeExactWord}:${typeName}`;
}
