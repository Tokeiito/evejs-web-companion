import { createSignal, readonlySignal } from "../store/signals.ts";
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const stores = new WeakMap<StorageLike, Map<number, ReturnType<typeof makeSetting>>>();
const volatile = new Map<number, ReturnType<typeof makeSetting>>();
function makeSetting(accountID: number, storage: StorageLike | null) {
  // systemmenu2427-2430; the user section is keyed by userid, not charid.
  const key = `evejs.user.${accountID}.useexistinginfownd`;
  let initial = true;
  try { initial = storage?.getItem(key) !== "0"; } catch { /* Native default1. */ }
  const value = createSignal(initial);
  return { value: readonlySignal(value), set(next: boolean): void {
    value.set(next);
    try { storage?.setItem(key, next ? "1" : "0"); } catch { /* Retain in memory. */ }
  } };
}
export function infoWindowSetting(accountID: number | null, storage: StorageLike | null) {
  let entries = storage === null ? volatile : stores.get(storage);
  if (!entries) { entries = new Map(); stores.set(storage!, entries); }
  const id = accountID ?? 0;
  let setting = entries.get(id);
  if (!setting) { setting = makeSetting(id, storage); entries.set(id, setting); }
  return setting;
}
