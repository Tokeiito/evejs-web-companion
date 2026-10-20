import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface ScrollWidthsSetting { readonly value: ReadableSignal<Readonly<Record<string, number>>>; set(header: string, width: number): void }
const stores = new WeakMap<StorageLike, Map<string, ScrollWidthsSetting>>();
const volatile = new Map<string, ScrollWidthsSetting>();

// Scroll._on_column_scale_end452-472, ResetColumnWidth1133-1177:
// user columnWidths_3[scrollID][localized header], MINCOLUMNWIDTH=24.
export function scrollWidthsSetting(accountID: number | null, scrollID: string, storage: StorageLike | null): ScrollWidthsSetting {
  let entries = storage === null ? volatile : stores.get(storage);
  if (!entries) { entries = new Map(); stores.set(storage!, entries); }
  const id = `${accountID ?? 0}:${scrollID}`, previous = entries.get(id);
  if (previous) return previous;
  const key = `evejs.user.${accountID ?? 0}.columnWidths_3`;
  function read(): Record<string, unknown> {
    try { const value: unknown = JSON.parse(storage?.getItem(key) ?? "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
    catch { return {}; }
  }
  const kept = read()[scrollID];
  const initial = kept && typeof kept === "object" && !Array.isArray(kept) ? Object.fromEntries(Object.entries(kept).filter(([, width]) => typeof width === "number" && Number.isFinite(width) && width !== 0).map(([header, width]) => [header, Math.max(24, width as number)])) : {};
  const value = createSignal<Readonly<Record<string, number>>>(initial);
  const setting: ScrollWidthsSetting = { value: readonlySignal(value), set(header, width) {
    if (!Number.isFinite(width)) return;
    const next = { ...value.get(), [header]: Math.max(24, width) };
    value.set(next);
    try { storage?.setItem(key, JSON.stringify({ ...read(), [scrollID]: next })); } catch { /* Retain in memory. */ }
  } };
  entries.set(id, setting);
  return setting;
}
