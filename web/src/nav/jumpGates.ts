// The jump gates the client's pathfinder may take (clientPathfinderService.py GetAvailableJumpGateJumps, 205 to 228):
// none unless the route panel's Include Jump Gates is ticked (pathFinder_includeJumpGates, off until set); else each
// Ansiblex the pilot may use, of the pairs the structure directory names (GetJumpBridgesWithMyAccess: the pairs, then
// the structures the pilot has access to and those it has not), as a jump one way from its system to its pair's, where
// both are solar systems and no stargate already joins the two that way. The pathfinder takes them as jumps like any
// other (CreatePathfinderCore: eve_map.add_one_way_jumps).

import type { JumpBridgeAccess } from "../bridge/structures.ts";

/** A jump through an Ansiblex: from its system to its pair's, by the structure. */
export interface JumpGateJump {
  readonly fromSystemID: number;
  readonly toSystemID: number;
  readonly structureID: number;
}

const isSolarSystem = (id: number): boolean => id >= 30_000_000 && id <= 39_999_999;

/** GetAvailableJumpGateJumps's answer, from the directory's and the map's: one jump for each two systems, the last pair's kept. */
export function availableJumpGateJumps(access: JumpBridgeAccess, joinedByStargate: (fromSystemID: number, toSystemID: number) => boolean): JumpGateJump[] {
  const available = new Map<string, JumpGateJump>();
  const mayUse = new Set(access.hasAccess);
  for (const { source, destination } of access.pairs) {
    if (source === null || destination === null) continue;
    const a = source.solarSystemID;
    const b = destination.solarSystemID;
    if (!isSolarSystem(a) || !isSolarSystem(b)) continue;
    if (mayUse.has(source.structureID) && !joinedByStargate(a, b)) {
      available.set(`${a}:${b}`, { fromSystemID: a, toSystemID: b, structureID: source.structureID });
    }
    if (mayUse.has(destination.structureID) && !joinedByStargate(b, a)) {
      available.set(`${b}:${a}`, { fromSystemID: b, toSystemID: a, structureID: destination.structureID });
    }
  }
  return [...available.values()];
}
