// The HUD's settings as the client keeps them in settings.user.ui (shipUI.GetHUDOptionMenu, 624 on, and what goes by
// them), kept in this browser under evejs.ui.<name> ("1" or "0"), each a signal the rack and the ship's readout follow.

import { createSignal, type ReadableSignal, type WritableSignal } from "./signals.ts";

/** Each setting's name in settings.user.ui, and its default as the client asks for it (Get(name, default)). */
export const HUD_SETTING_DEFAULTS = Object.freeze({
  /** shipUI 625, slotsContainer._FitSlot 522: modules with no activatable default effect drawn on the rack. */
  showPassiveModules: true,
  /** 628, slotsContainer.CheckButtonVisibility: the empty slots drawn. */
  showEmptySlots: false,
  /** 631, CheckShowReadoutCont: the shield, armor and structure readout shown. */
  showReadout: false,
  /** 634, UpdateReadouts: the readout as percentages (else as hit points left of the whole). */
  readoutType: true,
  /** 644, shipmodulebutton.OnMouseEnter 1088: a module's tooltip shown. */
  showModuleTooltips: true,
  /** 657, shipmodulebutton.ToggleOverload 221 and GetMenu 467: the overload state locked. */
  lockOverload: false,
});

export type HudSettingName = keyof typeof HUD_SETTING_DEFAULTS;

const storageKey = (name: HudSettingName): string => `evejs.ui.${name}`;

function kept(name: HudSettingName): boolean {
  try {
    const value = globalThis.localStorage?.getItem(storageKey(name));
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    // Storage refused: the default.
  }
  return HUD_SETTING_DEFAULTS[name];
}

const signals = new Map<HudSettingName, WritableSignal<boolean>>();

function signalOf(name: HudSettingName): WritableSignal<boolean> {
  let signal = signals.get(name);
  if (!signal) {
    signal = createSignal(kept(name));
    signals.set(name, signal);
  }
  return signal;
}

/** The setting as a signal, for a view to follow. */
export function hudSetting(name: HudSettingName): ReadableSignal<boolean> {
  return signalOf(name);
}

/** The setting now. */
export function hudSettingNow(name: HudSettingName): boolean {
  return signalOf(name).get();
}

/** settings.user.ui.Set(name, value): the setting kept, and every view told. */
export function setHudSetting(name: HudSettingName, value: boolean): void {
  signalOf(name).set(value);
  try {
    globalThis.localStorage?.setItem(storageKey(name), value ? "1" : "0");
  } catch {
    // Storage refused: the choice lasts the page.
  }
}
