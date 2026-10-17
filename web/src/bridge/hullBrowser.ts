// The fitting browser's tree, as the client's builds it (fittingScreen/browsers/fittingBrowser.py
// HullBrowserListProvider.GetFittingScrolllist, 65 to 149): ship groups, each group's races, each race's hulls, and
// under each hull its fittings.
//
// - **The hulls:** with no owner's fittings asked for, every hull the market sells that the search, the current-hull
//   filter and the skills filter let through (GetAllShipGroupsAndShipsByGroupID, 359 to 383), and the hulls of the
//   fittings let through; with an owner's asked for, those fittings' hulls alone (GetShipsAndGroups, 322 to 352).
// - **A fitting's hull the client has not, or has unpublished:** the fitting goes in the Unsupported Ship group, shown
//   only with an owner's fittings asked for (AddUnsupportedGroup).
// - **The groups:** by name, as Python sorts text (SortListOfTuples). A special edition ship's group is its group
//   negated, and those groups go under one Special Edition Ships group after the rest (129 to 141).
// - **The races:** from a hull's faction (appConst.raceByFaction), else non-empire (NON_EMPIRE, -1). Sorted by the key
//   (raceIconID == NON_EMPIRE, raceName), whose first part is never true (a race's icon is no -1, and the non-empire
//   faction's is 1443), so by name alone (GetRacesForGroup, 215 to 243).
// - **The hulls of a race:** by (meta group, name), a hull without a meta group first, as Python sorts None
//   (GetShipGroupSubContent, 400 to 423).
// - **The fittings of a hull:** by owner (the pilot's, the corporation's, the community's, the alliance's) then by name in lower case
//   (GetFittingEntriesForType's sortBy, 459 to 470).
// - **Nothing Found:** where an owner's fittings are asked for and none is let through, or where nothing at all is
//   listed.
//
// A group or race holding the ship the pilot is in is marked so (isGroupForCurrentShip), as is the hull itself. A group
// or race node carries the hulls its Compare compares, in the order the client's node holds them (compareTypeIDs).

import { intDictOrder } from "./py27DictOrder.ts";

/** A type's facts as the client's data has them (GET /api/client-data/hull-browser); null for a type it has not. */
export interface HullFacts {
  readonly groupID: number | null;
  /** The group's category (evetypes.GetCategoryID): a structure's is 65 (categoryStructure). */
  readonly categoryID: number | null;
  readonly factionID: number | null;
  readonly metaGroupID: number | null;
  readonly published: boolean;
  /** evetypes.GetMarketGroupID: the type's market group; null for none (the type menu's View Market Details goes by it). */
  readonly marketGroupID: number | null;
}

/** One of a ship's traits (infobubbles' bonuses): its number where it has one, its order, its words' message and its unit. */
export interface ShipTraitBonus {
  readonly bonus: number | null;
  readonly importance: number;
  readonly nameID: number | null;
  readonly unitID: number | null;
}

/** A ship's traits (infobubbles.iter_ship_skill_bonuses, get_role_bonus, get_misc_bonus): per skill, its role's, others. */
export interface ShipTraits {
  readonly skills: readonly { readonly skillTypeID: number; readonly bonuses: readonly ShipTraitBonus[] }[];
  readonly role: readonly ShipTraitBonus[];
  readonly misc: readonly ShipTraitBonus[];
}

/** The ships' traits as read (null for a ship with none), and the units' names as the numbers of their messages. */
export interface ShipTraitsHeld {
  readonly traits: ReadonlyMap<number, ShipTraits | null>;
  readonly unitNameIDs: ReadonlyMap<number, number | null>;
}

/** The browser's hulls as the page keeps them (the flow's hullBrowser): as read, and each type's facts by its number. */
export interface HullBrowserData {
  readonly available: boolean;
  readonly hullTypeIDs: readonly number[];
  readonly specialTypeIDs: ReadonlySet<number>;
  readonly types: ReadonlyMap<number, HullFacts | null>;
  readonly raceNameIDs: Readonly<Record<number, number | null>>;
}

/** fittingBrowser.NON_EMPIRE: the race of a hull of no empire's faction. */
export const NON_EMPIRE = -1;

/** appConst.factionByRace, turned about (raceByFaction): the four empires' factions and their races. */
const RACE_BY_FACTION: Readonly<Record<number, number>> = { 500001: 1, 500002: 2, 500003: 4, 500004: 8 };

/** fittingBrowser._GetShipRaceID: the race of a hull's faction, else NON_EMPIRE. */
export function raceOfFaction(factionID: number | null): number {
  return factionID === null ? NON_EMPIRE : RACE_BY_FACTION[factionID] ?? NON_EMPIRE;
}

/** What the tree needs of a fitting. */
export interface TreeFitting {
  readonly fittingID: number;
  readonly shipTypeID: number;
  readonly name: string;
  readonly source: "personal" | "corporation" | "community" | "alliance";
}

export interface HullNode<F extends TreeFitting> {
  readonly typeID: number;
  readonly fittings: readonly F[];
  readonly isCurrent: boolean;
}

export interface RaceNode<F extends TreeFitting> {
  readonly raceID: number;
  readonly hulls: readonly HullNode<F>[];
  readonly hasCurrent: boolean;
  /** The hulls its Compare compares, in the client's order (the node's typeIDs: its race's set of hulls). */
  readonly compareTypeIDs: readonly number[];
}

export interface GroupNode<F extends TreeFitting> {
  /** The ship group, negated for a special edition ship's. */
  readonly groupID: number;
  /** A hull of it, by which its name is had (evetypes.GetGroupName). */
  readonly namedBy: number;
  readonly races: readonly RaceNode<F>[];
  readonly hasCurrent: boolean;
  /** The hulls its Compare compares, in the client's order (the node's typeIDs: each race's set, in its dict's order). */
  readonly compareTypeIDs: readonly number[];
}

export interface HullTree<F extends TreeFitting> {
  readonly groups: readonly GroupNode<F>[];
  readonly special: readonly GroupNode<F>[];
  /** Whether the ship the pilot is in is a special edition ship (the Special Edition Ships group's mark). */
  readonly specialHasCurrent: boolean;
  readonly unsupported: readonly F[];
  readonly nothingFound: boolean;
}

export interface HullTreeInput<F extends TreeFitting> {
  /** The fittings the filters let through (FilterOutFittings). */
  readonly fittings: readonly F[];
  readonly ownerFilterIsSet: boolean;
  /** With no owner's fittings asked for: the market's hulls the filters let through. */
  readonly marketHulls: readonly number[];
  /** Every one of the market's hulls, filtered or not: the set the client walks for them (for the order it walks). */
  readonly allMarketHulls?: readonly number[];
  readonly specialTypeIDs: ReadonlySet<number>;
  /** A type's facts; undefined while they are not had. */
  readonly facts: (typeID: number) => HullFacts | null | undefined;
  readonly typeName: (typeID: number) => string;
  readonly groupName: (typeID: number) => string;
  readonly raceName: (raceID: number) => string;
  readonly currentShipTypeID: number | null;
}

/** Python's ordering of two texts (by code point). */
const pyCompare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const OWNER_ORDER: Readonly<Record<TreeFitting["source"], number>> = { personal: 0, corporation: 1, community: 2, alliance: 3 };

/** The browser's tree for what the filters let through. */
export function hullTree<F extends TreeFitting>(input: HullTreeInput<F>): HullTree<F> {
  const shipsByGroupAndRace = new Map<number, Map<number, Set<number>>>();
  const fittingsByType = new Map<number, F[]>();
  const namedBy = new Map<number, number>();
  const unsupported: F[] = [];
  const place = (typeID: number, facts: HullFacts): void => {
    if (facts.groupID === null) return;
    const groupID = input.specialTypeIDs.has(typeID) ? -facts.groupID : facts.groupID;
    if (!namedBy.has(groupID)) namedBy.set(groupID, typeID);
    const races = shipsByGroupAndRace.get(groupID) ?? new Map<number, Set<number>>();
    shipsByGroupAndRace.set(groupID, races);
    const raceID = raceOfFaction(facts.factionID);
    const ships = races.get(raceID) ?? new Set<number>();
    races.set(raceID, ships);
    ships.add(typeID);
  };
  if (!input.ownerFilterIsSet) {
    for (const typeID of input.marketHulls) {
      const facts = input.facts(typeID);
      if (facts) place(typeID, facts);
    }
  }
  for (const fitting of input.fittings) {
    const facts = input.facts(fitting.shipTypeID);
    if (facts === undefined) continue;
    if (facts === null || !facts.published) {
      unsupported.push(fitting);
      continue;
    }
    place(fitting.shipTypeID, facts);
    fittingsByType.set(fitting.shipTypeID, [...(fittingsByType.get(fitting.shipTypeID) ?? []), fitting]);
  }
  // The order the client's nodes hold their hulls in, which is the order a node's Compare compares them in
  // (ShipParentGroup.GetMenu: menusvc.CompareTypes(node.typeIDs)). GetAllShipGroupsAndShipsByGroupID (359 to 383) walks
  // the set of the market's hulls, putting each the filters let through in a set of its group's race (a dict of
  // races by group, defaultdict(set)); GetShipsAndGroups (322 to 352) then puts each fitting's hull in too. A race
  // node's typeIDs are its set; a group node's are its races' sets one after another, in the dict's order
  // (GetScrollListForShipGroups, 107: itertools.chain of the dict's values). Python 2.7 iterates a set of whole numbers
  // as its dict does (intDictOrder; measured against the client's python27.dll, sixty sets of up to 700 hulls). The
  // market's set is filled from its groups' lists (marketQuote.AddTypesToMarketGroups: each the keys of a dict merged
  // from its subgroups), an order not had here: the hulls go in by number, and the fittings in the page's order (the
  // client merges its owners' dicts of them). Either changes only which of two hulls that fall on one slot comes first.
  const raceOrder = new Map<number, number[]>();
  const raceSets = new Map<string, number[]>();
  const note = (typeID: number, facts: HullFacts): void => {
    if (facts.groupID === null) return;
    const groupID = input.specialTypeIDs.has(typeID) ? -facts.groupID : facts.groupID;
    const raceID = raceOfFaction(facts.factionID);
    const races = raceOrder.get(groupID) ?? [];
    raceOrder.set(groupID, races);
    if (!races.includes(raceID)) races.push(raceID);
    const ships = raceSets.get(`${groupID}:${raceID}`) ?? [];
    raceSets.set(`${groupID}:${raceID}`, ships);
    if (!ships.includes(typeID)) ships.push(typeID);
  };
  if (!input.ownerFilterIsSet) {
    const shown = new Set(input.marketHulls);
    for (const typeID of intDictOrder(input.allMarketHulls ?? input.marketHulls)) {
      const facts = shown.has(typeID) ? input.facts(typeID) : null;
      if (facts) note(typeID, facts);
    }
  }
  for (const fitting of input.fittings) {
    const facts = input.facts(fitting.shipTypeID);
    if (facts && facts.published) note(fitting.shipTypeID, facts);
  }
  const raceCompare = (groupID: number, raceID: number): number[] => intDictOrder(raceSets.get(`${groupID}:${raceID}`) ?? []);
  const groupCompare = (groupID: number): number[] => intDictOrder(raceOrder.get(groupID) ?? []).flatMap((raceID) => raceCompare(groupID, raceID));

  const current = input.currentShipTypeID;
  const metaKey = (typeID: number): number => input.facts(typeID)?.metaGroupID ?? Number.NEGATIVE_INFINITY;
  const groupNode = (groupID: number, races: Map<number, Set<number>>): GroupNode<F> => {
    const raceNodes = [...races].map(([raceID, ships]): RaceNode<F> => ({
      raceID,
      hasCurrent: current !== null && ships.has(current),
      compareTypeIDs: raceCompare(groupID, raceID),
      hulls: [...ships]
        .sort((left, right) => metaKey(left) - metaKey(right) || pyCompare(input.typeName(left), input.typeName(right)))
        .map((typeID) => ({
          typeID,
          isCurrent: typeID === current,
          fittings: (fittingsByType.get(typeID) ?? []).slice().sort((left, right) => OWNER_ORDER[left.source] - OWNER_ORDER[right.source] || pyCompare(left.name.toLowerCase(), right.name.toLowerCase())),
        })),
    })).sort((left, right) => pyCompare(input.raceName(left.raceID), input.raceName(right.raceID)));
    return { groupID, namedBy: namedBy.get(groupID) ?? 0, races: raceNodes, hasCurrent: raceNodes.some((race) => race.hasCurrent), compareTypeIDs: groupCompare(groupID) };
  };
  const byName = (left: GroupNode<F>, right: GroupNode<F>): number => pyCompare(input.groupName(left.namedBy), input.groupName(right.namedBy));
  const all = [...shipsByGroupAndRace].map(([groupID, races]) => groupNode(groupID, races));
  const groups = all.filter((group) => group.groupID > 0).sort(byName);
  const special = all.filter((group) => group.groupID < 0).sort(byName);
  const shownUnsupported = input.ownerFilterIsSet ? unsupported : [];
  const nothingFound = (input.fittings.length === 0 && input.ownerFilterIsSet)
    || (groups.length === 0 && special.length === 0 && shownUnsupported.length === 0);
  return {
    groups,
    special,
    specialHasCurrent: current !== null && input.specialTypeIDs.has(current),
    unsupported: shownUnsupported,
    nothingFound,
  };
}
