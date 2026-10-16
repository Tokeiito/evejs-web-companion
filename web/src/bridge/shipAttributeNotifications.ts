// The server's word of an item's attribute changing, read for one item: the pilot's own ship, whose attributes the
// Fitting window's figures are made of.
//
// godma keeps the ship's attributes as the server tells of each change (godma.OnModuleAttributeChange and its batch,
// OnModuleAttributeChanges; and the changes riding an OnMultiEvent, which godma's OnMultiEvent scatters one by one),
// and the client's windows read them from there. A module fitted and put online docked is a change of the ship's
// cpuLoad and powerLoad the server sends at its next tick, in an OnMultiEvent, after the call that onlined it has
// been answered: the page's re-read of the fit, made on that answer, comes before it (2026-10-16, a Damage Control
// fitted on the game port: the re-read said CPU 19 and the push that followed said 19 to 44).
//
// Wire shape of one change (attributeChangeNotification.js buildAttributeChange; godma's OnModuleAttributeChange):
//
//   ["OnModuleAttributeChange", ownerID, itemID, attributeID, time, newValue, oldValue, time]
//
// OnModuleAttributeChange carries it as its arguments; OnModuleAttributeChanges as a list in its first; an
// OnMultiEvent as entries of its first, each [the change, when it was made].

import { unwrapLong, unwrapReal } from "./wire.ts";

function itemsOf(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value !== null && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return null;
}

/** A whole number or a real off the wire, as a number; null for anything else. */
function numberOf(value: unknown): number | null {
  const real = unwrapReal(value);
  if (real !== null) return real;
  const whole = unwrapLong(value);
  return whole === null ? null : Number(whole);
}

/**
 * The attribute changes a notice tells of for one item, by attribute: its new value each, the last told where one
 * is told twice. Null where the notice tells of none for that item.
 */
export function decodeItemAttributeChanges(
  method: string | null,
  args: readonly unknown[],
  itemID: number,
): ReadonlyMap<number, number> | null {
  const found = new Map<number, number>();
  const take = (change: readonly unknown[] | null) => {
    if (!change || change[0] !== "OnModuleAttributeChange") return;
    const item = unwrapLong(change[2]);
    if (item === null || Number(item) !== itemID) return;
    const attributeID = unwrapLong(change[3]);
    const value = numberOf(change[5]);
    if (attributeID === null || value === null) return;
    found.set(Number(attributeID), value);
  };
  if (method === "OnModuleAttributeChange") {
    take(["OnModuleAttributeChange", ...args]);
  } else if (method === "OnModuleAttributeChanges") {
    for (const change of itemsOf(args[0]) ?? []) take(itemsOf(change));
  } else if (method === "OnMultiEvent") {
    for (const entry of itemsOf(args[0]) ?? []) {
      const told = itemsOf(itemsOf(entry)?.[0]);
      if (!told) continue;
      if (told[0] === "OnModuleAttributeChange") take(told);
      else if (told[0] === "OnModuleAttributeChanges") for (const change of itemsOf(told[1]) ?? []) take(itemsOf(change));
    }
  } else {
    return null;
  }
  return found.size > 0 ? found : null;
}
