// The dock target for the in-space Dock control: the nearest station or
// structure on this grid. Pure — EVE only lets you dock at something on grid,
// nearest first, so this picks the closest dockable entity from the live
// snapshot by centre-to-centre distance. Null means nothing on this grid can be
// docked at (the control disables and says so). It never reaches for a station
// out of view — a dock is only offered for what the snapshot actually carries.

import { isDockableKind } from "../space/rowActions.ts";
import type { SpaceEntity, SpaceVector } from "../store/types.ts";

export interface DockTarget {
  readonly itemID: number;
  readonly typeID: number | null;
  /** The entity's own name where it has one; null falls back to a type name. */
  readonly name: string | null;
}

function distanceSquared(a: SpaceVector, b: SpaceVector): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function nearestDockable(
  entities: readonly SpaceEntity[] | null | undefined,
  shipPosition: SpaceVector | null | undefined,
): DockTarget | null {
  let best: SpaceEntity | null = null;
  let bestDistance = Infinity;
  for (const entity of entities ?? []) {
    if (entity.isSelf || !isDockableKind(entity.kind)) {
      continue;
    }
    const distance = shipPosition ? distanceSquared(shipPosition, entity.position) : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entity;
    }
  }
  return best ? { itemID: best.itemID, typeID: best.typeID, name: best.name } : null;
}
