// The market's quickbar as this browser keeps it: the client's user setting (settings.user.ui 'quickbar' and
// 'quickbar_lastid'), kept here as the page keeps the user's other settings, and read by every window that shows or
// changes it (the market window's Quickbar, the multibuy's Add Order to Quickbar). Each change is kept at once and seen
// at once, as the client's OnMarketQuickbarChange is.

import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
import { EMPTY_QUICKBAR, quickbarFromJson, type Quickbar } from "../bridge/marketQuickbar.ts";

const KEPT = "evejs.quickbar";

function readKept(): Quickbar {
  try {
    return quickbarFromJson(globalThis.localStorage?.getItem(KEPT) ?? null);
  } catch {
    return EMPTY_QUICKBAR;
  }
}

const quickbarSignal = createSignal<Quickbar>(readKept());

export const marketQuickbar: ReadableSignal<Quickbar> = readonlySignal(quickbarSignal);

/** A change to the quickbar (one of bridge/marketQuickbar.ts's), kept and shown. */
export function changeQuickbar(change: (quickbar: Quickbar) => Quickbar): Quickbar {
  const next = change(quickbarSignal.get());
  if (next === quickbarSignal.get()) return next;
  quickbarSignal.set(next);
  try {
    globalThis.localStorage?.setItem(KEPT, JSON.stringify(next));
  } catch {
    // Kept for this page only where the browser keeps nothing.
  }
  return next;
}
