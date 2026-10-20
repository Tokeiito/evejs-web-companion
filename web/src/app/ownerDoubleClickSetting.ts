// systemmenu.ConstructChatSettings1197-1206: user.ui dblClickUser, default0.
// SettingsSvc.LoadSettings stores the user section under userid, separately
// from charid. Share the choice between this account's pilots in this browser.
import { createSignal, readonlySignal } from "../store/signals.ts";

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const stores = new WeakMap<StorageLike, Map<number, ReturnType<typeof makeSetting>>>();
const volatile = new Map<number, ReturnType<typeof makeSetting>>();
function makeSetting(accountID: number, storage: StorageLike | null) {
  const key = `evejs.user.${accountID}.dblClickUser`;
  let initial: 0 | 1 = 0;
  try { if (storage?.getItem(key) === "1") initial = 1; } catch { /* Default Show Info. */ }
  const value = createSignal<0 | 1>(initial);
  return {
    value: readonlySignal(value),
    set(next: 0 | 1): void {
      if (next !== 0 && next !== 1) return;
      value.set(next);
      try { storage?.setItem(key, String(next)); } catch { /* Keep for this page. */ }
    },
  };
}
export function ownerDoubleClickSetting(accountID: number | null, storage: StorageLike | null) {
  let entries = storage === null ? volatile : stores.get(storage);
  if (!entries) { entries = new Map(); stores.set(storage!, entries); }
  const id = accountID ?? 0;
  let setting = entries.get(id);
  if (!setting) { setting = makeSetting(id, storage); entries.set(id, setting); }
  return setting;
}
