// The in-space ship readout: EVE's capacitor + shield/armor/hull. Pure model so
// the segment maths + the gauge list are unit-testable. The capacitor is EVE's
// discrete wheel — a count of filled segments, not a smooth bar; shield/armor/
// hull stay proportional bars. Ratios come straight from the live snapshot; null
// (no reading yet) is preserved, never coerced to a value.

export interface ResourceGauge {
  readonly key: "shield" | "armor" | "hull";
  readonly label: string;
  readonly ratio: number | null;
}

/** Shield / armor / hull, in EVE's outer-to-inner order. */
export function resourceGauges(
  ship: { shieldRatio: number | null; armorRatio: number | null; hullRatio: number | null } | null,
): readonly ResourceGauge[] {
  return [
    { key: "shield", label: "Shield", ratio: ship?.shieldRatio ?? null },
    { key: "armor", label: "Armor", ratio: ship?.armorRatio ?? null },
    { key: "hull", label: "Hull", ratio: ship?.hullRatio ?? null },
  ];
}

/**
 * How many of `count` capacitor segments are filled at this charge. A null ratio
 * (no reading) is zero filled; a ratio is clamped to [0,1] then rounded to the
 * nearest segment, so a nearly-empty cap never shows a stray lit segment and a
 * full one lights them all.
 */
export function capacitorSegments(ratio: number | null, count: number): number {
  if (ratio == null || count <= 0) return 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  return Math.round(clamped * count);
}
