// The client's menu of where a fleet member may go (evefleet/client/menu.py MemberMenu, 18 to 186): the ranks a
// pilot may give the member, and the fleet's wings and squads with the ranks it may give there. Move Fleet Member
// (menusvc.FleetMenu: GetFleetMemberMenu2(charID, fleetSvc.MoveMember, True)) and the invite menu
// (FleetInviteMenu, isMove False) are both it. Each place is the arguments the callback is given: the member, the
// wing, the squad and the role (MoveMember(charID, wingID, squadID, role), Invite(...)), None for one not given.
//
// The client lists the wings by number (sorted(wings.iteritems())) and a wing's squads in its dict's order; the
// squads are kept here in the order the fleet's read gave them.

/** evefleet/const.py: the roles, the creator's job, and the most members a squad holds. */
export const FLEET_ROLE = Object.freeze({ leader: 1, wingCmdr: 2, squadCmdr: 3, member: 4 });
const FLEET_JOB_CREATOR = 2;
const MAX_MEMBERS_IN_SQUAD = 256;

/** RANK_LABELS (menu.py 9 to 15): each role's word, a squad member's for any other. */
export function rankLabel(role: number | null): string {
  if (role === FLEET_ROLE.leader) return "UI/Fleet/Ranks/FleetCommander";
  if (role === FLEET_ROLE.wingCmdr) return "UI/Fleet/Ranks/WingCommander";
  if (role === FLEET_ROLE.squadCmdr) return "UI/Fleet/Ranks/SquadCommander";
  return "UI/Fleet/Ranks/SquadMember";
}

/** One place to put the member: its rank's word and the callback's arguments. */
export interface MemberMenuPlace {
  readonly kind: "place";
  readonly role: number | null;
  readonly wingID: number | null;
  readonly squadID: number | null;
}

/** A squad and its places: its own name, or none (SquadX by its number among all), and how many are in it. */
export interface MemberMenuSquad {
  readonly kind: "squad";
  readonly squadID: number;
  readonly name: string;
  readonly squadNumber: number;
  readonly numMembers: number;
  readonly places: readonly MemberMenuPlace[];
}

/** A wing and what is in it: its own name, or none (WingX by its number), its wing commander's place and its squads. */
export interface MemberMenuWing {
  readonly kind: "wing";
  readonly wingID: number;
  readonly name: string;
  readonly wingNumber: number;
  readonly entries: readonly (MemberMenuPlace | MemberMenuSquad)[];
}

export type MemberMenuEntry = MemberMenuPlace | MemberMenuWing;

export interface MenuFleetMember {
  readonly charID: number;
  readonly role: number;
  readonly job: number;
  readonly wingID: number | null;
  readonly squadID: number | null;
}

export interface MenuFleetWing {
  readonly wingID: number;
  readonly name: string;
  readonly squads: readonly { readonly squadID: number; readonly name: string }[];
}

export interface MemberMenuInput {
  /** The member the menu is for. */
  readonly targetCharID: number;
  /** The pilot's own character. */
  readonly me: number;
  readonly members: readonly MenuFleetMember[];
  readonly wings: readonly MenuFleetWing[];
  /** The fleet's free move option (fleetSvc.GetOptions().isFreeMove). */
  readonly isFreeMove: boolean;
  /** Move Fleet Member (True), or the invite menu (False). */
  readonly isMove: boolean;
}

/** MemberMenu.Get (55 to 68): what the pilot may do with the member, in the client's order. None where it is in no fleet. */
export function memberMenu(input: MemberMenuInput): MemberMenuEntry[] {
  const { targetCharID, me, members, wings, isFreeMove, isMove } = input;
  const self = members.find((member) => member.charID === me);
  if (self === undefined) return [];
  const target = members.find((member) => member.charID === targetCharID) ?? null;
  const isSquadCmdr = self.role === FLEET_ROLE.squadCmdr;
  const isWingCmdr = self.role === FLEET_ROLE.wingCmdr;
  const isFleetLeader = self.role === FLEET_ROLE.leader || (self.job & FLEET_JOB_CREATOR) !== 0;
  const freeMove = isFreeMove && targetCharID === me;
  const place = (role: number | null, wingID: number | null, squadID: number | null): MemberMenuPlace => ({ kind: "place", role, wingID, squadID });
  const wingsWithCmdrs = members.filter((member) => member.role === FLEET_ROLE.wingCmdr).map((member) => member.wingID);
  const squadsWithCmdrs = members.filter((member) => member.role === FLEET_ROLE.squadCmdr).map((member) => member.squadID);
  const menu: MemberMenuEntry[] = [];

  // SetValidFleetLeaderMoves (73 to 82).
  if (isFleetLeader) {
    if (!members.some((member) => member.role === FLEET_ROLE.leader)) menu.push(place(FLEET_ROLE.leader, null, null));
    if (target !== null && (target.role === FLEET_ROLE.member || target.role === FLEET_ROLE.squadCmdr) && !wingsWithCmdrs.includes(target.wingID)) {
      menu.push(place(FLEET_ROLE.wingCmdr, target.wingID, null));
    }
  }
  // SetValidFreeMoves (84 to 91).
  if (freeMove && target !== null) {
    if (target.role === FLEET_ROLE.member && !squadsWithCmdrs.includes(target.squadID)) menu.push(place(FLEET_ROLE.squadCmdr, target.wingID, target.squadID));
    if (target.role === FLEET_ROLE.squadCmdr) menu.push(place(FLEET_ROLE.member, target.wingID, target.squadID));
  }
  // IsInviteToFleet: the invite menu's first, a squad member with no place said.
  if (!isMove) menu.push(place(null, null, null));
  // SetValidWingAndSquadMoves (113 to 123).
  if (isFleetLeader || isWingCmdr || isSquadCmdr || freeMove) {
    const sortedWings = [...wings].sort((a, b) => a.wingID - b.wingID);
    const sortedSquads = wings.flatMap((wing) => wing.squads.map((squad) => squad.squadID)).sort((a, b) => a - b);
    sortedWings.forEach((wing, wingIndex) => {
      if (isWingCmdr && target !== null && target.wingID !== self.wingID) return;
      if (!(isFleetLeader || freeMove) && wing.wingID !== self.wingID) return;
      // GetSubSquads (167 to 177): the wing commander's place, for the fleet's leader, where the wing has none.
      const entries: (MemberMenuPlace | MemberMenuSquad)[] = [];
      if (isFleetLeader && !wingsWithCmdrs.includes(wing.wingID)) entries.push(place(FLEET_ROLE.wingCmdr, wing.wingID, null));
      // GetSquads (125 to 143) and SetValidSquadMoves (145 to 154).
      for (const squad of wing.squads) {
        if (isSquadCmdr && !isFleetLeader && !freeMove && squad.squadID !== self.squadID) continue;
        const numMembers = members.filter((member) => member.squadID === squad.squadID).length;
        if (numMembers >= MAX_MEMBERS_IN_SQUAD && (target === null || target.squadID !== squad.squadID)) continue;
        const places: MemberMenuPlace[] = [];
        if (!squadsWithCmdrs.includes(squad.squadID)) places.push(place(FLEET_ROLE.squadCmdr, wing.wingID, squad.squadID));
        if (target === null || target.squadID !== squad.squadID || target.role === FLEET_ROLE.squadCmdr) places.push(place(FLEET_ROLE.member, wing.wingID, squad.squadID));
        if (places.length > 0) {
          entries.push({ kind: "squad", squadID: squad.squadID, name: squad.name, squadNumber: sortedSquads.indexOf(squad.squadID) + 1, numMembers, places });
        }
      }
      if (entries.length > 0) menu.push({ kind: "wing", wingID: wing.wingID, name: wing.name, wingNumber: wingIndex + 1, entries });
    });
  }
  return menu;
}
