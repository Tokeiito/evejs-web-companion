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

import type { SpaceEntity } from "../store/types.ts";

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
}

export function buildTargets(
  lockedIDs: readonly number[],
  acquiringIDs: readonly number[],
  entities: readonly SpaceEntity[] | null | undefined,
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
    };
  });
}
