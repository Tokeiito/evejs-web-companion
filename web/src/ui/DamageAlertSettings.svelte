<script lang="ts">
  // The HUD options' Damage Alert Settings (shipUI.ShowNotifySettingsWindow: notifySettingsWindow.NotifySettingsWindow),
  // a row for each of the shield, armour, hull, capacitor and cargo hold (ConstructLayout, its list of names from the
  // compiled module: the decompiled text prints their places): whether it alerts, a checkbox showing the notification's
  // defaultStatus where never set, and its threshold, a slider from 0 to 1 whose hint is its percentage
  // (GetSliderHint). What they change is store/notifySettings.ts, which the HUD's alerts go by (shipAlert.ts).
  import type { ClientStore } from "../store/clientStore.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import {
    HEALTH_NOTIFICATIONS,
    healthNotificationSettings,
    setHealthNotificationEnabled,
    setHealthNotificationThreshold,
  } from "../store/notifySettings.ts";

  let { store, onClose }: { store: ClientStore; onClose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  const kept = healthNotificationSettings;
  const said = (label: string, own: string): string => $words.templates[label] || own;
  /** UI/Common/Formatting/Percentage of a share. */
  function percentage(share: number): string {
    const template = $words.templates["UI/Common/Formatting/Percentage"];
    return typeof template === "string" && template !== ""
      ? plainText(formatTemplate(template, { percentage: share * 100 }, { nameOf: (_kind, id) => String(id) }))
      : `${Math.round(share * 100)}%`;
  }
  const OWN: Readonly<Record<string, string>> = {
    shield: "Alert below this much shield",
    armour: "Alert below this much armor",
    hull: "Alert below this much hull",
    capacitor: "Alert below this much capacitor",
    cargoHold: "Alert below this much free cargo room",
  };
</script>

<div class="damage-alerts" role="dialog" aria-label={said("UI/Inflight/NotifySettingsWindow/DamageAlertSettings", "Ship health alerts")}>
  <div class="damage-alerts-head">
    <span>{said("UI/Inflight/NotifySettingsWindow/DamageAlertSettings", "Ship health alerts")}</span>
    <button type="button" class="damage-alerts-close" aria-label="Close" onclick={onClose}>✕</button>
  </div>
  {#each HEALTH_NOTIFICATIONS as notification (notification.name)}
    {@const setting = $kept[notification.name]}
    {@const threshold = setting.threshold ?? notification.defaultThreshold}
    <div class="damage-alerts-row">
      <label class="damage-alerts-check">
        <input type="checkbox" checked={setting.enabled ?? notification.defaultStatus}
          onchange={(event) => setHealthNotificationEnabled(notification.name, event.currentTarget.checked)} />
        {said(notification.label, OWN[notification.name] ?? notification.name)}
      </label>
      <input type="range" min="0" max="1" step="0.01" value={threshold} title={percentage(threshold)}
        aria-label={said(notification.label, OWN[notification.name] ?? notification.name)}
        oninput={(event) => setHealthNotificationThreshold(notification.name, Number(event.currentTarget.value))} />
    </div>
  {/each}
</div>
