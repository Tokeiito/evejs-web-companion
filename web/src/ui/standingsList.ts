// The Character Sheet's standings list, as the client builds it (charsheet/standingsPanel/standingsPanel.py
// PopulateOwnerScroll, standings/standingsUIUtil.py GetStandingScrollGroups, standingsFilterSettings.py).
//
// THE STANDINGS LISTED (standingsvc.py 111 to 138, 246 to 264): what standingMgr.GetCharStandings answered (the
// corporation's: GetCorpStandings), kept as a dict by fromID (Rowset.Index: a dict of the rows, in their order), and
// for the pilot's own the standing of its race's faction at nought where it has none (factionByRace). Listed in the
// dict's own order: pyIntDictOrder.
//
// THE GROUPS (CategoriseStandingsByOwnerType): the factions, the corporations, then the agents, each under its words;
// an NPC character that is no agent is left out, and so is anyone that is no NPC.
//
// AN ENTRY (StandingEntry.Load, StandingData): "<standing> <name>". The standing toward the panel's owner, with the
// pilot's skill bonus where the panel is the pilot's (_GetStandingWithBonus: the owner's faction's skill, 0.4 a level),
// 10.0 from 9.995, else rounded to two places (_GetStandingFormatted), written as Python's %s writes a float; the
// name is cfg.eveowners', an agent's with its level (GetAgentNameAndLevel: AgentEntryNameAndLevel, markup and all).
//
// THE SORT (get_nodes_sorted) is within each group, stable: by the owner's id (the default), by the standing up or
// down, by the name, or recently changed. Recently changed sorts by whether the entry's drawn row has been read: at a
// load nothing is drawn yet, so the entries stand in the dict's order (a re-sort of drawn rows puts them last: not
// done here, and no standing is held unread here either).
//
// THE SEARCH (search_entry) keeps an entry whose name, lowered, holds the text lowered.

import { pyIntDictOrder } from "../bridge/pyDictOrder.ts";
import { applyStandingBonus, standingBonusSkill } from "../bridge/effectiveStanding.ts";

/** standingsConst SORT_BY_OPTIONS: each sort's words and its setting's value, in the menu's order. */
export const STANDINGS_SORTS = [
  { label: "UI/Standings/DefaultFilter", value: "standings_sortedByID" },
  { label: "UI/Standings/AscendingFilter", value: "standings_sortedAscending" },
  { label: "UI/Standings/DescendingFilter", value: "standings_sortedDescending" },
  { label: "UI/Standings/NameFilter", value: "standings_sortedAlphabetically" },
  { label: "UI/Standings/RecentChangeFilter", value: "standing_sortedByRecentlyChanged" },
] as const;
export type StandingsSort = (typeof STANDINGS_SORTS)[number]["value"];
export const DEFAULT_STANDINGS_SORT: StandingsSort = "standings_sortedByID";

/** appConst.factionByRace: the race's faction. */
const FACTION_BY_RACE: Readonly<Record<number, number>> = { 1: 500001, 2: 500002, 4: 500003, 8: 500004 };

export type StandingsGroupKind = "faction" | "corporation" | "agent";
/** Each group's words (GetStandingScrollGroups). */
export const STANDINGS_GROUP_LABELS: Readonly<Record<StandingsGroupKind, string>> = {
  faction: "UI/Common/Factions",
  corporation: "UI/Common/Corporations",
  agent: "UI/Common/Agents",
};

export interface StandingsListEntry {
  readonly ownerID: number;
  /** GetStanding2To1: toward the panel's owner, the bonus applied for the pilot's own. */
  readonly standing: number;
  /** _GetStandingFormatted, as %s writes it. */
  readonly standingText: string;
  /** GetOwner2Name, markup and all: what the list sorts and searches by. */
  readonly ownerName: string;
}

export interface StandingsListGroup {
  readonly kind: StandingsGroupKind;
  readonly entries: readonly StandingsListEntry[];
}

/** An agent as the client's agents service has it (GetAgentByID): its level and its faction. */
export interface StandingsAgent {
  readonly level: number | null;
  readonly factionID: number | null;
}

export interface StandingsListInputs {
  /** The standings as answered, in their order. */
  readonly rows: readonly { readonly fromID: number; readonly standing: number }[];
  /** The panel is the pilot's own (toID == session.charid): the skill bonus, and the race's faction. */
  readonly forPilot: boolean;
  /** session.raceID, for the pilot's own; null where not known. */
  readonly raceID: number | null;
  /** An NPC character's agent (null where it is no agent; undefined while not known: left out until it is). */
  readonly agentOf: (ownerID: number) => StandingsAgent | null | undefined;
  /** An NPC corporation's faction (get_corporation_faction_id), or null. */
  readonly factionOfCorporation: (corporationID: number) => number | null;
  /** The pilot's trained level of a skill, nought where it has none. */
  readonly skillLevel: (typeID: number) => number;
  /** cfg.eveowners' name of an owner. */
  readonly ownerName: (ownerID: number) => string;
  /** GetAgentNameAndLevel. */
  readonly agentName: (agentID: number, level: number | null) => string;
}

const isFaction = (id: number): boolean => id >= 500_000 && id < 600_000;
const isCorporation = (id: number): boolean => (id >= 1_000_000 && id < 2_000_000) || (id >= 98_000_000 && id < 99_000_000);
/** idCheckers.IsNPC. */
const isNpc = (id: number): boolean => id > 10_000 && id < 90_000_000;

/** round(x, 2) as Python 2.7 rounds a float: the exact value's nearest, a tie away from nought. */
function pyRound2(value: number): number {
  const magnitude = Number(Math.abs(value).toFixed(2));
  return value < 0 || Object.is(value, -0) ? -magnitude : magnitude;
}
/** str(float) for such a number: an integral one with ".0", and -0.0 as Python writes it. */
function pyFloatText(value: number): string {
  if (Object.is(value, -0)) return "-0.0";
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}
/** RoundStandingTo10 and _GetStandingFormatted. */
const roundTo10 = (standing: number): number => (standing >= 9.995 ? 10.0 : standing);

/** GetFactionIDFromOwnerID: a faction itself, a corporation's faction, an agent's. */
function factionOfOwner(inputs: StandingsListInputs, ownerID: number): number | null {
  if (isCorporation(ownerID)) return inputs.factionOfCorporation(ownerID);
  if (isFaction(ownerID)) return ownerID;
  return inputs.agentOf(ownerID)?.factionID ?? null;
}

/** The groups and their entries, as GetStandingScrollGroups makes them and get_nodes_sorted orders them. */
export function standingsListGroups(inputs: StandingsListInputs, sort: StandingsSort, searchText: string): readonly StandingsListGroup[] {
  const byID = new Map<number, number>();
  for (const row of inputs.rows) if (!byID.has(row.fromID)) byID.set(row.fromID, row.standing);
  const raceFactionID = inputs.forPilot && inputs.raceID !== null ? (FACTION_BY_RACE[inputs.raceID] ?? null) : null;
  const inserted = [...byID.keys()];
  if (raceFactionID !== null && !byID.has(raceFactionID)) {
    byID.set(raceFactionID, 0.0);
    inserted.push(raceFactionID);
  }
  const groups: Record<StandingsGroupKind, StandingsListEntry[]> = { faction: [], corporation: [], agent: [] };
  for (const ownerID of pyIntDictOrder(inserted)) {
    const raw = roundTo10(byID.get(ownerID) ?? 0);
    let kind: StandingsGroupKind;
    let ownerName: string;
    if (isFaction(ownerID)) {
      kind = "faction";
      ownerName = inputs.ownerName(ownerID);
    } else if (isCorporation(ownerID)) {
      kind = "corporation";
      ownerName = inputs.ownerName(ownerID);
    } else if (isNpc(ownerID)) {
      const agent = inputs.agentOf(ownerID);
      if (agent === null || agent === undefined) continue;
      kind = "agent";
      ownerName = inputs.agentName(ownerID, agent.level);
    } else {
      continue;
    }
    let standing = raw;
    if (inputs.forPilot) {
      const skill = standingBonusSkill(factionOfOwner(inputs, ownerID), raw);
      standing = applyStandingBonus(skill === null ? 0 : inputs.skillLevel(skill) * 0.4, raw);
    }
    groups[kind].push({ ownerID, standing, standingText: pyFloatText(pyRound2(roundTo10(standing))), ownerName });
  }
  const wanted = searchText.toLowerCase();
  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = (entries: StandingsListEntry[]): StandingsListEntry[] => {
    // Array.prototype.sort is stable, as Python's sorted is; reverse=True keeps equal entries in their order too.
    switch (sort) {
      case "standings_sortedAscending":
        return [...entries].sort((a, b) => a.standing - b.standing);
      case "standings_sortedDescending":
        return [...entries].sort((a, b) => b.standing - a.standing);
      case "standings_sortedAlphabetically":
        return [...entries].sort((a, b) => compare(a.ownerName, b.ownerName));
      case "standing_sortedByRecentlyChanged":
        return entries;
      default:
        return [...entries].sort((a, b) => a.ownerID - b.ownerID);
    }
  };
  const out: StandingsListGroup[] = [];
  for (const kind of ["faction", "corporation", "agent"] as const) {
    const entries = wanted === "" ? groups[kind] : groups[kind].filter((entry) => entry.ownerName.toLowerCase().includes(wanted));
    if (entries.length > 0) out.push({ kind, entries: sorted(entries) });
  }
  return out;
}
