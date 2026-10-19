// The ship health alerts' settings as the client keeps them in settings.user.notifications (appConst.soundNotifications,
// eveaudio/shiphealthnotification.SoundNotification): for each of the shield, armour, hull, capacitor and cargo hold,
// <name>NotificationEnabled and <name>Threshold. Kept in this browser under evejs.notifications.<setting>, each a signal.
// A setting not set is not set: each reader gives its own default, as the client's do (the settings window's checkbox
// the notification's defaultStatus, the HUD's alert and the sound's 1 and True: shipAlert.IsLevelActive 168,
// ShipHealthNotifier.ProcessNotification).

import { createSignal, type ReadableSignal, type WritableSignal } from "./signals.ts";

/** appConst.soundNotifications (1835 to 1859): each one's threshold, enabled flag and words. */
export const HEALTH_NOTIFICATIONS = Object.freeze([
  { name: "shield", defaultThreshold: 0.25, defaultStatus: true, label: "UI/Inflight/NotifySettingsWindow/ShieldAlertLevel" },
  { name: "armour", defaultThreshold: 0.4, defaultStatus: true, label: "UI/Inflight/NotifySettingsWindow/ArmorAlertLevel" },
  { name: "hull", defaultThreshold: 0.95, defaultStatus: true, label: "UI/Inflight/NotifySettingsWindow/HullAlertLevel" },
  { name: "capacitor", defaultThreshold: 0.3, defaultStatus: true, label: "UI/Inflight/NotifySettingsWindow/CapacitorAlertLevel" },
  { name: "cargoHold", defaultThreshold: 0.2, defaultStatus: false, label: "UI/Inflight/NotifySettingsWindow/CargoHoldAlertLevel" },
] as const);

export type HealthNotificationName = (typeof HEALTH_NOTIFICATIONS)[number]["name"];

/** What is kept of one: whether it is on and its threshold, each null where never set. */
export interface HealthNotificationSetting {
  readonly enabled: boolean | null;
  readonly threshold: number | null;
}

const storageKey = (setting: string): string => `evejs.notifications.${setting}`;

function keptOf(name: HealthNotificationName): HealthNotificationSetting {
  try {
    const enabled = globalThis.localStorage?.getItem(storageKey(`${name}NotificationEnabled`)) ?? null;
    const threshold = globalThis.localStorage?.getItem(storageKey(`${name}Threshold`)) ?? null;
    const value = threshold === null ? NaN : Number(threshold);
    return { enabled: enabled === "1" ? true : enabled === "0" ? false : null, threshold: Number.isFinite(value) ? value : null };
  } catch {
    return { enabled: null, threshold: null };
  }
}

const settings: WritableSignal<Readonly<Record<HealthNotificationName, HealthNotificationSetting>>> = createSignal(
  Object.fromEntries(HEALTH_NOTIFICATIONS.map((each) => [each.name, keptOf(each.name)])) as Record<HealthNotificationName, HealthNotificationSetting>,
);

/** Every notification's setting, for a view to follow. */
export const healthNotificationSettings: ReadableSignal<Readonly<Record<HealthNotificationName, HealthNotificationSetting>>> = settings;

/** settings.user.notifications.Set(<name>NotificationEnabled, on). */
export function setHealthNotificationEnabled(name: HealthNotificationName, enabled: boolean): void {
  settings.set({ ...settings.get(), [name]: { ...settings.get()[name], enabled } });
  try {
    globalThis.localStorage?.setItem(storageKey(`${name}NotificationEnabled`), enabled ? "1" : "0");
  } catch {
    // Storage refused: the choice lasts the page.
  }
}

/** The slider's settings.user.notifications <name>Threshold, 0 to 1. */
export function setHealthNotificationThreshold(name: HealthNotificationName, threshold: number): void {
  const value = Math.min(1, Math.max(0, threshold));
  settings.set({ ...settings.get(), [name]: { ...settings.get()[name], threshold: value } });
  try {
    globalThis.localStorage?.setItem(storageKey(`${name}Threshold`), String(value));
  } catch {
    // Storage refused: the choice lasts the page.
  }
}
