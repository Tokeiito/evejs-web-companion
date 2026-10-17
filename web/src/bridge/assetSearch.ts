// The assets window's search, as the client makes it (eve/client/script/ui/shared/assetsWindow.py: Search_thread 407 to
// 457, _LoadSearch 805 to 849, GetSubContent 712 to 739, GetContainerGroupEntries 690 to 710, SearchTypeID and
// GetSearchTextForTypeID 971 to 981; eveAssets/assetSearchUtil.py: ParseString, IsPartOfText, the keywords and their
// match functions; eveAssets/assetSearching.py: GetSearchResults, MatchesTypeChecks, GetFakeRowset).
//
// The text is lowercased whole and split by ParseString into the plain words before the first "keyword:" and the
// keyword/value pairs. With plain words, an item is kept where its type's, group's or category's name holds them, and
// the keywords count for nothing; with none, every keyword's condition must hold. Each keyword is the first of the
// client's keywords, sorted by their words, that begins with what was typed. Of them the page has the four that go by
// a name (type, typeExact, group, category); any other typed is passed over and said so.

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

/** The kinds of keyword the page searches by; null for one it does not. */
export type AssetKeywordKind = "type" | "typeExact" | "group" | "category" | null;

/** AssetKeywordSearch.GetSearchKeywords (408 to 435): each keyword's label, and what the page does with it. */
export const ASSET_SEARCH_KEYWORDS: readonly { readonly label: string; readonly kind: AssetKeywordKind }[] = Object.freeze([
  { label: "UI/Inventory/AssetSearch/KeywordType", kind: "type" },
  { label: "UI/Inventory/AssetSearch/KeywordTypeExact", kind: "typeExact" },
  { label: "UI/Inventory/AssetSearch/KeywordGroup", kind: "group" },
  { label: "UI/Inventory/AssetSearch/KeywordCategory", kind: "category" },
  { label: "UI/Inventory/AssetSearch/KeywordMinimumQuantity", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordMaximumQuantity", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordMetalevel", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordMetagroup", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordTechLevel", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordMinSecurityLevel", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordMaxSecurityLevel", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordSecurityClass", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordSolarSystem", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordConstellation", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordRegion", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordStationName", kind: null },
  { label: "UI/Inventory/AssetSearch/KeywordBlueprint", kind: null },
]);

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

/**
 * GetConditions (387 to 401) with the keywords' words (localization.util.Sort of them; here a case-blind compare):
 * each typed keyword's condition, from the first keyword that begins with it (IsPartOfText). Answers the conditions and
 * the keywords typed that the page does not search by.
 */
export function assetSearchConditions(
  matches: readonly (readonly [string, string])[],
  keywordWords: Readonly<Record<string, string>>,
  names: AssetSearchNames,
): { readonly conditions: readonly ((item: AssetSearchItem) => boolean)[]; readonly unsupported: readonly string[] } {
  const keywords = ASSET_SEARCH_KEYWORDS
    .map((keyword) => ({ word: keywordWords[keyword.label] ?? "", kind: keyword.kind }))
    .filter((keyword) => keyword.word !== "")
    .sort((left, right) => left.word.localeCompare(right.word, undefined, { sensitivity: "base" }));
  // The per-run caches (ResetPerRunDicts): type and typeExact share theirs, by the type's number.
  const typeMatched = new Map<number, boolean>();
  const groupMatched = new Map<number, boolean>();
  const categoryMatched = new Map<number, boolean>();
  const conditions: ((item: AssetSearchItem) => boolean)[] = [];
  const unsupported: string[] = [];
  for (const [word, value] of matches) {
    const keyword = keywords.find((each) => each.word.toLowerCase().startsWith(word.toLowerCase()));
    if (keyword === undefined) continue;
    if (keyword.kind === null) {
      unsupported.push(keyword.word);
      continue;
    }
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
    } else {
      conditions.push((item) => cached(categoryMatched, item.categoryID, () => (names.categoryName(item.typeID) ?? "").includes(value)));
    }
  }
  return { conditions, unsupported };
}

/** const.groupSecureCargoContainer, groupAuditLogSecureContainer, groupFreightContainer, groupCargoContainer. */
const CONTAINER_GROUPS: ReadonlySet<number> = new Set([340, 448, 649, 12]);
/** const.typeAssetSafetyWrap, typePlasticWrap. */
const TYPE_ASSET_SAFETY_WRAP = 60;
const TYPE_PLASTIC_WRAP = 3468;
/** const.flagHangar, flagWallet, flagAssetSafety: what a station's search results list of what lies there. */
const LISTED_FLAGS: ReadonlySet<number> = new Set([4, 1, 36]);

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
  conditions: readonly ((item: AssetSearchItem) => boolean)[],
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
    } else if (!conditions.every((condition) => condition(item))) {
      continue;
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
