// CorpQueryMembersForm INCLUDE_IMPLIED_SETTING/SEARCH_TITLES_SETTING: user UI, false by default.
import { createSignal, readonlySignal } from "../store/signals.ts";
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
type Name = "FMBQincludeImplied" | "FMBQsearchTitles";
const stores = new WeakMap<StorageLike, Map<string, ReturnType<typeof makeSetting>>>();
const volatile = new Map<string, ReturnType<typeof makeSetting>>();
function makeSetting(accountID: number, name: Name, storage: StorageLike | null) {
  const key = `evejs.user.${accountID}.${name}`;
  let initial = false;
  try { initial = storage?.getItem(key) === "true"; } catch { /* Native default. */ }
  const value = createSignal(initial);
  return { value: readonlySignal(value), set(next: boolean): void {
    if (next === value.get()) return;
    value.set(next);
    try { storage?.setItem(key, String(next)); } catch { /* Retain for this page. */ }
  } };
}
export function memberQuerySetting(accountID: number | null, name: Name, storage: StorageLike | null) {
  let entries = storage === null ? volatile : stores.get(storage);
  if (!entries) { entries = new Map(); stores.set(storage!, entries); }
  const id = `${accountID ?? 0}:${name}`;
  let setting = entries.get(id);
  if (!setting) { setting = makeSetting(accountID ?? 0, name, storage); entries.set(id, setting); }
  return setting;
}
