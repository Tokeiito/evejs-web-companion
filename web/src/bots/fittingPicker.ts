// The refit block's fitting picker: saved fits grouped under their hull, and
// narrowed by a free-text filter. Fit names are the player's own words and
// often leave the hull out ("T1", "T1 Ore"), so the hull is the heading.

/** One fit the picker can offer. `source` absent is a personal fit. */
export interface PickerFitting {
  readonly fittingID: number;
  readonly name: string;
  readonly shipTypeID?: number;
  readonly shipName?: string | null;
  readonly source?: "personal" | "corporation";
}

export interface PickerGroup {
  readonly label: string;
  readonly fittings: readonly { readonly fittingID: number; readonly label: string }[];
}

function hullLabel(fit: PickerFitting): string {
  if (fit.shipName) return fit.shipName;
  return fit.shipTypeID ? `Ship type ${fit.shipTypeID}` : "Unknown hull";
}

/**
 * Group `fittings` by hull, hulls and fits sorted by name, keeping only fits
 * whose hull and name together contain every word of `query`. The fit already
 * picked (`selectedID`) is always kept, so filtering never blanks the select.
 * A fit is marked "(corp)" only when both libraries are on offer.
 */
export function fittingPickerGroups(
  fittings: readonly PickerFitting[],
  query: string,
  selectedID: number | null,
): readonly PickerGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const mixed = fittings.some((f) => f.source === "corporation") && fittings.some((f) => f.source !== "corporation");
  const groups = new Map<string, { fittingID: number; label: string }[]>();
  for (const fit of fittings) {
    const hull = hullLabel(fit);
    const haystack = `${hull} ${fit.name}`.toLowerCase();
    if (fit.fittingID !== selectedID && !words.every((w) => haystack.includes(w))) continue;
    const label = mixed && fit.source === "corporation" ? `${fit.name} (corp)` : fit.name;
    const rows = groups.get(hull) ?? [];
    rows.push({ fittingID: fit.fittingID, label });
    groups.set(hull, rows);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, rows]) => ({ label, fittings: rows.sort((a, b) => a.label.localeCompare(b.label)) }));
}
