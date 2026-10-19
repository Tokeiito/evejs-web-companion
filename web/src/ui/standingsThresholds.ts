// The threshold icons above the client's standings bar (standings/standingsBar.py UpdateThresholdIcons and
// ThresholdIcon; standingsUIUtil.GetStandingThresholdIDs; standingUIConst): what an owner's standing toward the pilot
// opens or closes, each at its standing, lit where the standing the owner deals by (GetStandingUsed) reaches it.
//
// WHICH (GetStandingThresholdIDs), from an NPC only:
//   toward a corporation   Factional Warfare for an empire's faction, and the corporation's station services' groups
//   a faction              attacked in space; Factional Warfare for an empire's; where it has agents, no access to its
//                          agents and its agents of levels 2 to 5; its epic arcs; its station services' groups
//   a Resource Wars corp.  none (THRESHOLDS_RESOURCE_WARS is empty)
//   an NPC corporation     where it has agents, no access and levels 2 to 5; its epic arcs
//   an agent               above level 1: no access to it, and its offering missions at its level
// A station services' group is each required standing rounded (round(x) + 0), from the client's own table
// (evestations standingsrestriction: the corporation's office rental alone toward a corporation, the rest toward the
// pilot), in the order Python's set of them iterates.
//
// WHERE (GetThresholdValue): an agent's offering at its level's (GetAgentStandingThreshold), an epic arc at its
// starter agent's (no lower than nought), attacked in space at nought for the Triglavians and EDENCOM, a group at its
// own, the rest by THRESHOLD_VALUES_BY_THRESHOLDTYPE. A second icon at a standing another has is drawn below the bar,
// and two at nought hide the axis's nought.
//
// LIT (IsUnlocked): at or above its standing, or for attacked in space and no access at or below it.

import { pyIntDictOrder } from "../bridge/pyDictOrder.ts";

export const THRESHOLD = Object.freeze({
  attackedInSpace: 1,
  noAccessToAgents: 2,
  epicArcUnlock: 6,
  factionalWarfare: 7,
  agentsLvl2: 9,
  agentsLvl3: 10,
  agentsLvl4: 11,
  agentsLvl5: 12,
  agentOffersMissions: 13,
  noAccessToAgent: 14,
  stationService: 19,
  stationServiceCorporation: 20,
});

const VALUES: Readonly<Record<number, number>> = {
  [THRESHOLD.attackedInSpace]: -5.0,
  [THRESHOLD.noAccessToAgents]: -2.0,
  [THRESHOLD.noAccessToAgent]: -2.0,
  [THRESHOLD.factionalWarfare]: 0.0,
  [THRESHOLD.agentsLvl2]: 1.0,
  [THRESHOLD.agentsLvl3]: 3.0,
  [THRESHOLD.agentsLvl4]: 5.0,
  [THRESHOLD.agentsLvl5]: 7.0,
  [THRESHOLD.agentOffersMissions]: 0.0,
};
const ACTIVATE_AT_LESS_THAN: readonly number[] = [THRESHOLD.attackedInSpace, THRESHOLD.noAccessToAgents, THRESHOLD.noAccessToAgent];
const AGENT_THRESHOLDS: readonly number[] = [THRESHOLD.noAccessToAgents, THRESHOLD.agentsLvl2, THRESHOLD.agentsLvl3, THRESHOLD.agentsLvl4, THRESHOLD.agentsLvl5];

const TEXTURES: Readonly<Record<number, string>> = {
  [THRESHOLD.attackedInSpace]: "res:/UI/Texture/Classes/Standings/Thresholds/attackedInSpace.png",
  [THRESHOLD.noAccessToAgents]: "res:/UI/Texture/Classes/Standings/Thresholds/noAccessToAgents.png",
  [THRESHOLD.noAccessToAgent]: "res:/UI/Texture/Classes/Standings/Thresholds/noAccessToAgents.png",
  [THRESHOLD.epicArcUnlock]: "res:/UI/Texture/Classes/Standings/Thresholds/epicArc.png",
  [THRESHOLD.factionalWarfare]: "res:/UI/Texture/Classes/Standings/Thresholds/factionalWarfare.png",
  [THRESHOLD.agentsLvl2]: "res:/UI/Texture/Classes/Standings/Thresholds/agentsLvl2.png",
  [THRESHOLD.agentsLvl3]: "res:/UI/Texture/Classes/Standings/Thresholds/agentsLvl3.png",
  [THRESHOLD.agentsLvl4]: "res:/UI/Texture/Classes/Standings/Thresholds/agentsLvl4.png",
  [THRESHOLD.agentsLvl5]: "res:/UI/Texture/Classes/Standings/Thresholds/agentsLvl5.png",
  [THRESHOLD.agentOffersMissions]: "res:/UI/Texture/Classes/Standings/Thresholds/agent.png",
  [THRESHOLD.stationService]: "res:/UI/Texture/WindowIcons/basicServices.png",
  [THRESHOLD.stationServiceCorporation]: "res:/UI/Texture/WindowIcons/basicServices.png",
};
/** LABELS_BY_THRESHOLDTYPEID: a tooltip's heading. */
export const THRESHOLD_LABELS: Readonly<Record<number, string>> = {
  [THRESHOLD.attackedInSpace]: "UI/Standings/Thresholds/AttackedInSpaceHeader",
  [THRESHOLD.noAccessToAgents]: "UI/Standings/Thresholds/AgentsRestricted",
  [THRESHOLD.noAccessToAgent]: "UI/Standings/Thresholds/NoAccessHeader",
  [THRESHOLD.epicArcUnlock]: "UI/Standings/Thresholds/EpicArcHeader",
  [THRESHOLD.factionalWarfare]: "UI/Standings/Thresholds/FactionalWarfareHeader",
  [THRESHOLD.agentsLvl2]: "UI/Standings/Thresholds/AgentLvl2Available",
  [THRESHOLD.agentsLvl3]: "UI/Standings/Thresholds/AgentLvl3Available",
  [THRESHOLD.agentsLvl4]: "UI/Standings/Thresholds/AgentLvl4Available",
  [THRESHOLD.agentsLvl5]: "UI/Standings/Thresholds/AgentLvl5Available",
  [THRESHOLD.agentOffersMissions]: "UI/Standings/Thresholds/AgentAvailableHeader",
  [THRESHOLD.stationService]: "UI/Station/StationServices",
  [THRESHOLD.stationServiceCorporation]: "UI/Station/StationServices",
};
/** HINTS_BY_THRESHOLDTYPEID: a tooltip's words (ownerName the owner's). */
export const THRESHOLD_HINTS: Readonly<Record<number, string>> = {
  [THRESHOLD.attackedInSpace]: "UI/Standings/Thresholds/AttackedInSpace",
  [THRESHOLD.noAccessToAgents]: "UI/Standings/Thresholds/NoAccessToAgents",
  [THRESHOLD.noAccessToAgent]: "UI/Standings/Thresholds/NoAccessToAgent",
  [THRESHOLD.epicArcUnlock]: "UI/Standings/Thresholds/EpicArc",
  [THRESHOLD.factionalWarfare]: "UI/Standings/Thresholds/FactinalWarfare",
  [THRESHOLD.agentsLvl2]: "UI/Standings/Thresholds/AgentsLvl2",
  [THRESHOLD.agentsLvl3]: "UI/Standings/Thresholds/AgentsLvl3",
  [THRESHOLD.agentsLvl4]: "UI/Standings/Thresholds/AgentsLvl4",
  [THRESHOLD.agentsLvl5]: "UI/Standings/Thresholds/AgentsLvl5",
  [THRESHOLD.agentOffersMissions]: "UI/Standings/Thresholds/Agent",
  [THRESHOLD.stationService]: "UI/Standings/Thresholds/StationServiceAccess",
  [THRESHOLD.stationServiceCorporation]: "UI/Standings/Thresholds/StationServiceAccess",
};
/** evestations standingsrestriction _restriction_labels: each restricted service's name. */
export const STATION_SERVICE_LABELS: Readonly<Record<number, string>> = {
  5: "UI/Station/ReprocessingPlant",
  13: "UI/Station/Repairshop",
  14: "UI/Industry/Industry",
  17: "UI/Station/Fitting",
  22: "UI/StructureSettings/ServiceDocking",
  23: "UI/StructureSettings/ServiceCorpOffices",
  24: "UI/Medical/JumpClone",
};
/** _requires_corporation: the services asked of a corporation's standing. */
const CORPORATION_SERVICES: readonly number[] = [23];

/** appConst.factionsEmpires, factionsWithoutAgents; the factions attacked in space from nought. */
const EMPIRES: readonly number[] = [500003, 500001, 500004, 500002];
const FACTIONS_WITHOUT_AGENTS: readonly number[] = [500024, 500005, 500006, 500017, 500026, 500027];
const ATTACK_AT_NOUGHT: readonly number[] = [500026, 500027];
/** rwservice RW_CORPORATIONS. */
const RW_CORPORATIONS: readonly number[] = [1000283, 1000284, 1000285, 1000286];
/** standingUIConst.EPIC_ARC_STARTER_AGENTS. */
export const EPIC_ARC_STARTER_AGENTS: readonly number[] = [3019415, 3019396, 3019412, 3019411, 3019467, 3019465, 3019466, 3019460, 3019463, 3019462, 3019464, 3019457, 3019356];

/** agentUtil.GetAgentStandingThreshold. */
function agentStandingThreshold(level: number | null): number | null {
  return ({ 1: -10.0, 2: 1.0, 3: 3.0, 4: 5.0, 5: 7.0 } as Record<number, number>)[level ?? 0] ?? null;
}

export interface ThresholdAgent {
  readonly level: number | null;
  readonly corporationID: number | null;
  readonly factionID: number | null;
}

export interface ThresholdInputs {
  /** The selected owner (StandingData's ownerID2) and the panel's owner (ownerID1). */
  readonly fromID: number;
  readonly toID: number;
  readonly toIsCorporation: boolean;
  /** GetStandingUsed's standing: what lights an icon. */
  readonly standing: number;
  /** An agent (GetAgentByID), or null where it is none or not known. */
  readonly agentOf: (agentID: number) => ThresholdAgent | null;
  /** Whether an NPC corporation has agents (GetAgentsByCorpID); null while not known. */
  readonly corporationHasAgents: (corporationID: number) => boolean | null;
  /** The client's stations' standings restrictions, by owner and service. */
  readonly restrictions: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface ThresholdIcon {
  readonly key: string;
  readonly typeID: number;
  readonly texture: string;
  /** standingThreshold. */
  readonly threshold: number;
  readonly unlocked: boolean;
  /** A second at a standing another has: drawn below the bar. */
  readonly duplicate: boolean;
  /** A station services group's services, (round(standing, 2), service) in the order GetStationServiceRestrictionsForThreshold sorts them. */
  readonly services: readonly { readonly standing: number; readonly serviceID: number }[];
}

const isNpc = (id: number): boolean => id > 10_000 && id < 90_000_000;
const isFaction = (id: number): boolean => id >= 500_000 && id < 600_000;
const isCorporation = (id: number): boolean => (id >= 1_000_000 && id < 2_000_000) || (id >= 98_000_000 && id < 99_000_000);
const isNpcCharacter = (id: number): boolean => id >= 3_000_000 && id < 4_000_000;
/** Python 2's round(x) of a float, + 0 (nought, never minus nought). */
const pyRound0 = (value: number): number => (value < 0 ? -Number(Math.abs(value).toFixed(0)) : Number(value.toFixed(0))) + 0;

/** The owner's station services as the client groups them (_GetStationServiceThresholdIDs). */
function stationServiceGroups(inputs: ThresholdInputs, forCorporation: boolean): [number, number][] {
  const typeID = forCorporation ? THRESHOLD.stationServiceCorporation : THRESHOLD.stationService;
  const services = inputs.restrictions[String(inputs.fromID)] ?? {};
  const groups: number[] = [];
  for (const [serviceID, standing] of Object.entries(services)) {
    if (CORPORATION_SERVICES.includes(Number(serviceID)) !== forCorporation) continue;
    const group = pyRound0(standing);
    if (!groups.includes(group)) groups.push(group);
  }
  return pyIntDictOrder(groups).map((group) => [typeID, group]);
}

/** GetStandingThresholdIDs: (type, value) for each icon, in the client's order. */
function thresholdIDs(inputs: ThresholdInputs): [number, number | null][] {
  const { fromID } = inputs;
  if (!isNpc(fromID)) return [];
  const epicArcs = (): [number, number][] =>
    EPIC_ARC_STARTER_AGENTS.flatMap((agentID): [number, number][] => {
      const agent = inputs.agentOf(agentID);
      return agent !== null && (agent.factionID === fromID || agent.corporationID === fromID) ? [[THRESHOLD.epicArcUnlock, agentID]] : [];
    });
  if (inputs.toIsCorporation) {
    return [...(EMPIRES.includes(fromID) ? ([[THRESHOLD.factionalWarfare, inputs.toID]] as [number, number][]) : []), ...stationServiceGroups(inputs, true)];
  }
  if (isFaction(fromID)) {
    return [
      [THRESHOLD.attackedInSpace, null],
      ...(EMPIRES.includes(fromID) ? ([[THRESHOLD.factionalWarfare, null]] as [number, null][]) : []),
      ...(FACTIONS_WITHOUT_AGENTS.includes(fromID) ? [] : AGENT_THRESHOLDS.map((typeID): [number, null] => [typeID, null])),
      ...epicArcs(),
      ...stationServiceGroups(inputs, false),
    ];
  }
  if (RW_CORPORATIONS.includes(fromID)) return [];
  if (isCorporation(fromID)) {
    return [...(inputs.corporationHasAgents(fromID) ? AGENT_THRESHOLDS.map((typeID): [number, null] => [typeID, null]) : []), ...epicArcs()];
  }
  if (isNpcCharacter(fromID)) {
    const agent = inputs.agentOf(fromID);
    return agent !== null && (agent.level ?? 0) > 1 ? [[THRESHOLD.noAccessToAgent, null], [THRESHOLD.agentOffersMissions, agent.level]] : [];
  }
  return [];
}

/** GetThresholdValue. */
function thresholdValue(inputs: ThresholdInputs, typeID: number, valueID: number | null): number | null {
  if (isNpcCharacter(inputs.fromID) && typeID === THRESHOLD.agentOffersMissions) return agentStandingThreshold(inputs.agentOf(inputs.fromID)?.level ?? null);
  if (typeID === THRESHOLD.epicArcUnlock) {
    const value = valueID === null ? null : agentStandingThreshold(inputs.agentOf(valueID)?.level ?? null);
    return value === null ? null : Math.max(value, 0.0);
  }
  if (typeID === THRESHOLD.attackedInSpace && ATTACK_AT_NOUGHT.includes(inputs.fromID)) return 0.0;
  if (typeID === THRESHOLD.stationService || typeID === THRESHOLD.stationServiceCorporation) return valueID;
  return VALUES[typeID] ?? null;
}

/** The icons above the bar, and whether the axis's nought is hidden (two icons at nought). */
export function standingThresholdIcons(inputs: ThresholdInputs): { readonly icons: readonly ThresholdIcon[]; readonly hideZeroLabel: boolean } {
  const icons: ThresholdIcon[] = [];
  const seen = new Set<number>();
  let hideZeroLabel = false;
  for (const [typeID, valueID] of thresholdIDs(inputs)) {
    const threshold = thresholdValue(inputs, typeID, valueID);
    if (threshold === null) continue;
    const duplicate = seen.has(threshold);
    if (duplicate && threshold === 0) hideZeroLabel = true;
    seen.add(threshold);
    const texture = typeID === THRESHOLD.agentOffersMissions
      ? ({ 2: TEXTURES[THRESHOLD.agentsLvl2], 3: TEXTURES[THRESHOLD.agentsLvl3], 4: TEXTURES[THRESHOLD.agentsLvl4], 5: TEXTURES[THRESHOLD.agentsLvl5] } as Record<number, string | undefined>)[valueID ?? 0]
      : TEXTURES[typeID];
    if (texture === undefined) continue;
    const unlocked = ACTIVATE_AT_LESS_THAN.includes(typeID) ? inputs.standing <= threshold : inputs.standing >= threshold;
    const services = typeID === THRESHOLD.stationService || typeID === THRESHOLD.stationServiceCorporation
      ? Object.entries(inputs.restrictions[String(inputs.fromID)] ?? {})
          .filter(([serviceID]) => CORPORATION_SERVICES.includes(Number(serviceID)) === (typeID === THRESHOLD.stationServiceCorporation))
          .filter(([, standing]) => pyRound0(standing) === threshold)
          .map(([serviceID, standing]) => ({ standing: Number((Math.round(Math.abs(standing) * 100) / 100 * Math.sign(standing)).toFixed(2)), serviceID: Number(serviceID) }))
          .sort((a, b) => a.standing - b.standing || a.serviceID - b.serviceID)
      : [];
    icons.push({ key: `${typeID}:${valueID ?? ""}`, typeID, texture, threshold, unlocked, duplicate, services });
  }
  return { icons, hideZeroLabel };
}
