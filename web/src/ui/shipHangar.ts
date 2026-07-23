// The docked ship-hangar summary: the ship you are flying plus the other hulls
// in the station hangar. Pure model — split the hangar rows into the active
// ship and the rest, so StationShell can show an at-a-glance hangar without
// pulling in the full Inventory panel. Ships are category 6 (the same test the
// Inventory panel uses); the active ship is the row whose itemID is the active
// ship id, kept even if its category has not resolved yet.

import type { InventoryItemRow } from "../store/types.ts";

const CATEGORY_SHIP = 6;

export interface ShipHangarView {
  /** The hull currently being flown (from the hangar rows), or null. */
  readonly active: InventoryItemRow | null;
  /** The other hulls in the hangar, active excluded. */
  readonly others: readonly InventoryItemRow[];
  /** Total hulls in the hangar (active included). */
  readonly total: number;
}

export function buildShipHangar(
  activeShipID: number | null,
  hangarRows: readonly InventoryItemRow[],
): ShipHangarView {
  const active =
    activeShipID != null
      ? (hangarRows.find((row) => row.itemID === activeShipID) ?? null)
      : null;
  const others = hangarRows.filter(
    (row) => row.categoryID === CATEGORY_SHIP && row.itemID !== active?.itemID,
  );
  return { active, others, total: others.length + (active ? 1 : 0) };
}
