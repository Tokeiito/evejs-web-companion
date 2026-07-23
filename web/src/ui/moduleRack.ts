// The in-space HUD module rack: the ship's high / mid / low slots, EVE's three
// activation racks. Pure model, kept out of the .svelte file so the grouping +
// activation logic is unit-testable. It reads the SAME fitting slots the Fitting
// window uses (bridge/fitting.ts) and overlays which modules are currently
// cycling from the live space snapshot's activeModuleIDs — so a module the
// server reports active glows, and one the fit says is offline reads dimmed.
//
// Only high/mid/low: EVE's HUD activation rack never holds rigs or subsystems
// (they are passive), so they stay in the Fitting window, not the rack.

import { slotsOfFamily } from "../bridge/fitting.ts";
import type { FittingSlot } from "../store/types.ts";

export type RackFamily = "high" | "mid" | "low";
export const RACK_FAMILIES: readonly RackFamily[] = ["high", "mid", "low"];
export const RACK_LABELS: Readonly<Record<RackFamily, string>> = {
  high: "High",
  mid: "Mid",
  low: "Low",
};

export interface RackModule {
  readonly typeID: number;
  /** The fit reports it online (vs. fitted-but-offline). */
  readonly online: boolean;
  /** The live snapshot reports it currently cycling. */
  readonly active: boolean;
}

export interface RackSlotVM {
  readonly module: RackModule | null;
}

export interface RackRow {
  readonly family: RackFamily;
  readonly label: string;
  readonly slots: readonly RackSlotVM[];
}

/**
 * Build the three racks from the fitting slots + the snapshot's active module
 * itemIDs. A null/absent activeModuleIDs (no snapshot yet) means nothing glows —
 * never a guess.
 */
export function buildModuleRack(
  slots: readonly FittingSlot[],
  activeModuleIDs: readonly number[] | null | undefined,
): readonly RackRow[] {
  const active = new Set(activeModuleIDs ?? []);
  return RACK_FAMILIES.map((family) => ({
    family,
    label: RACK_LABELS[family],
    slots: slotsOfFamily(slots, family).map((slot) => ({
      module: slot.module
        ? {
            typeID: slot.module.typeID,
            online: slot.module.online,
            active: active.has(slot.module.itemID),
          }
        : null,
    })),
  }));
}

/** True when there are no slots at all — the fit is not known yet. */
export function rackIsEmpty(rows: readonly RackRow[]): boolean {
  return rows.every((row) => row.slots.length === 0);
}
