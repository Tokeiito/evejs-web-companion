// The pilot's effective standing with an agent, as the retail client works it out.
//
// standingsvc.GetEffectiveStandingWithAgent (200 to 214) takes three standings towards the pilot, the
// agent's faction's, its corporation's and the agent's own, each raised by a skill, and says:
//
//   the least of them, when it is -2.0 or worse (the label EffectiveStandingLow)
//   otherwise the greatest of them            (the label EffectiveStanding)
//
// A standing is what standingMgr.GetCharStandings lists for that owner, and nought for one it does not
// list. The skill (standingUtil.GetStandingBonusSkillTypeID) goes by the agent's faction for all three:
//
//   none at all for four factions whose standings no skill moves
//   Diplomacy for a standing below nought
//   Criminal Connections for nought or better with a pirate faction
//   Connections for nought or better with anyone else
//
// and it is worth 0.4 a level, applied as standingUtil.ApplyBonusToStanding applies it: the bonus closes
// that share of the gap to 10.
//
// The level used is the one the pilot has trained. The client uses the skill's "effective" level, which is
// lower for a clone that may not use all it has trained; this page does not know that.

/** inventorycommon.const: the three skills. */
export const STANDING_SKILLS = Object.freeze({ diplomacy: 3357, connections: 3359, criminalConnections: 3361 });

/** appConst.factionsPirates. */
const PIRATE_FACTIONS: readonly number[] = [500011, 500010, 500012, 500019, 500020, 500029];
/** appConst.factionsWhoseStandingsAreNotAffectedBySkillBonuses: Drifters, Rogue Drones, Triglavian, EDENCOM. */
const UNMOVED_FACTIONS: readonly number[] = [500024, 500025, 500026, 500027];
/** At this or worse, the least standing is the effective one. */
const LOW = -2.0;

/** The skill that raises a standing of this size from this faction, or null for none. */
export function standingBonusSkill(fromFactionID: number | null, standing: number): number | null {
  if (fromFactionID !== null && UNMOVED_FACTIONS.includes(fromFactionID)) {
    return null;
  }
  if (standing < 0) {
    return STANDING_SKILLS.diplomacy;
  }
  return fromFactionID !== null && PIRATE_FACTIONS.includes(fromFactionID) ? STANDING_SKILLS.criminalConnections : STANDING_SKILLS.connections;
}

/** A standing with a bonus applied: no bonus changes nothing. */
export function applyStandingBonus(bonus: number, standing: number): number {
  return bonus ? (1 - (1 - standing / 10) * (1 - bonus / 10)) * 10 : standing;
}

export interface EffectiveStanding {
  readonly value: number;
  /** Whether it is the least of the three that counts (the client words that one differently). */
  readonly low: boolean;
}

/** Who the standings are with: the agent, its corporation, and that corporation's faction. */
export interface StandingAgent {
  readonly agentID: number;
  readonly corporationID: number | null;
  readonly factionID: number | null;
}

/**
 * The effective standing with an agent. `standings` is what the server lists towards the pilot, by owner;
 * `skillLevel` is the level the pilot has in a skill, and nought for one it has not.
 */
export function effectiveStandingWithAgent(
  agent: StandingAgent,
  standings: ReadonlyMap<number, number>,
  skillLevel: (typeID: number) => number,
): EffectiveStanding {
  const raised = [agent.factionID, agent.corporationID, agent.agentID].map((fromID) => {
    // An owner there is none of gives nought, and no skill is asked about it.
    if (fromID === null) {
      return 0;
    }
    const standing = standings.get(fromID) ?? 0;
    const skill = standingBonusSkill(agent.factionID, standing);
    return applyStandingBonus(skill === null ? 0 : skillLevel(skill) * 0.4, standing);
  });
  const least = Math.min(...raised);
  return least <= LOW ? { value: least, low: true } : { value: Math.max(...raised), low: false };
}
