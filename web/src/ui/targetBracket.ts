// The in-space locked-targets bracket: EVE's row of target brackets across the
// top of the view. Pure model — map the targeting slice's locked/acquiring ids
// to the live snapshot entities so each target shows its name + shield/armor/
// hull condition. Kept out of the .svelte file so the mapping (order, acquiring
// flag, in-view detection) is unit-testable.
//
// Order mirrors the Overview's target list: locked first (in lock order), then
// anything still acquiring. A target the snapshot no longer carries is kept in
// the list but flagged out-of-view rather than dropped — a lock that just left
// grid should read as lost, not silently vanish.

import type { SpaceEntity, SpaceVector } from "../store/types.ts";
import { distanceMeters } from "../space/overview.ts";

export interface TargetVM {
  readonly itemID: number;
  readonly typeID: number | null;
  /** The entity's own name where it has one; null falls back to a type name. */
  readonly entityName: string | null;
  readonly shield: number | null;
  readonly armor: number | null;
  readonly hull: number | null;
  /** Still being acquired (the lock is not usable yet). */
  readonly acquiring: boolean;
  /** The snapshot still carries this object. */
  readonly inView: boolean;
  /**
   * Metres from the ship, or null when we cannot say — no origin was supplied,
   * or the target has left the snapshot.
   *
   * ⚠ NULL IS NOT ZERO, and on a target card the difference is the whole point:
   * a fabricated 0 m says the thing you are shooting is on top of you, which is
   * the one reading a pilot would act on immediately. R71 renders null as a dash.
   */
  readonly distance: number | null;
}

export function buildTargets(
  lockedIDs: readonly number[],
  acquiringIDs: readonly number[],
  entities: readonly SpaceEntity[] | null | undefined,
  /** The ship's position, so a card can say how far away its target is. */
  origin?: SpaceVector | null,
): readonly TargetVM[] {
  const byID = new Map<number, SpaceEntity>();
  for (const entity of entities ?? []) {
    byID.set(entity.itemID, entity);
  }
  const ids = [...lockedIDs, ...acquiringIDs.filter((id) => !lockedIDs.includes(id))];
  return ids.map((itemID) => {
    const entity = byID.get(itemID);
    return {
      itemID,
      typeID: entity?.typeID ?? null,
      entityName: entity?.name ?? null,
      shield: entity?.shieldRatio ?? null,
      armor: entity?.armorRatio ?? null,
      hull: entity?.hullRatio ?? null,
      acquiring: !lockedIDs.includes(itemID),
      inView: entity !== undefined,
      distance:
        entity !== undefined && origin != null
          ? distanceMeters(origin, entity.position)
          : null,
    };
  });
}
