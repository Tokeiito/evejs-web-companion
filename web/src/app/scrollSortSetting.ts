import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface ScrollSort { readonly by: string | null; readonly reversed: boolean }
export interface ScrollSortSetting { readonly value: ReadableSignal<ScrollSort>; set(by: string, reversed: boolean): void }
const stores = new WeakMap<StorageLike, Map<string, ScrollSortSetting>>();
const volatile = new Map<string, ScrollSortSetting>();

// Scroll.GetSortBy/GetSortDirection674-689, ChangeSortBy966-992:
// settings.user.ui.scrollsortby_3[scrollID] = (localized header, reversed).
export function scrollSortSetting(accountID: number | null, scrollID: string, storage: StorageLike | null): ScrollSortSetting {
  let entries = storage === null ? volatile : stores.get(storage);
  if (!entries) { entries = new Map(); stores.set(storage!, entries); }
  const id = `${accountID ?? 0}:${scrollID}`, previous = entries.get(id);
  if (previous) return previous;
  const key = `evejs.user.${accountID ?? 0}.scrollsortby_3`;
  function read(): Record<string, unknown> {
    try { const value: unknown = JSON.parse(storage?.getItem(key) ?? "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
    catch { return {}; }
  }
  const kept = read()[scrollID];
  const value = createSignal<ScrollSort>({ by: Array.isArray(kept) && typeof kept[0] === "string" ? kept[0] : null, reversed: Array.isArray(kept) && !!kept[1] });
  const setting: ScrollSortSetting = { value: readonlySignal(value), set(by, reversed) {
    value.set({ by, reversed });
    try { storage?.setItem(key, JSON.stringify({ ...read(), [scrollID]: [by, reversed] })); } catch { /* Retain in memory. */ }
  } };
  entries.set(id, setting);
  return setting;
}
