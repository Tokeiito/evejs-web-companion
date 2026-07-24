// How much of a stack fits in a hold. Pure arithmetic over a stack's per-unit
// volume and a hold's free space, so the browser can move exactly what fits
// instead of asking the server to move the whole stack and be refused.
//
// The design rule the operator set: the SERVER judges validity (can this type go
// in this hold at all). This module only decides the QUANTITY, and only when it
// has the numbers — with an unknown volume or an unread capacity it hands the
// whole stack over and lets the server draw the line, never inventing a smaller
// number from missing data.

/** Free m³ in a hold, or null when its capacity has not been read. Never negative. */
export function holdFreeM3(capacity: { readonly capacity: number; readonly used: number } | null | undefined): number | null {
  if (capacity === null || capacity === undefined) {
    return null;
  }
  const free = capacity.capacity - capacity.used;
  return Number.isFinite(free) ? Math.max(0, free) : null;
}

/**
 * How many units of a stack fit in `freeM3` of hold space.
 *
 *   • `quantity`   — units in the stack (the ceiling; we never move more).
 *   • `unitVolume` — m³ per unit, or null/undefined when the static tables do not
 *                    know the type.
 *   • `freeM3`     — the hold's free space in m³, or null when unread.
 *
 * Unknown volume OR unknown free space ⇒ return the WHOLE quantity and let the
 * server judge the fit. Otherwise floor(free / unitVolume), clamped to [0, quantity].
 */
export function unitsThatFit(
  quantity: number,
  unitVolume: number | null | undefined,
  freeM3: number | null,
): number {
  if (!(quantity > 0)) {
    return 0;
  }
  if (
    unitVolume === null ||
    unitVolume === undefined ||
    !(unitVolume > 0) ||
    freeM3 === null ||
    !Number.isFinite(freeM3)
  ) {
    return quantity; // not enough info to compute a fit — the server decides
  }
  const fits = Math.floor(freeM3 / unitVolume);
  return Math.max(0, Math.min(quantity, fits));
}
