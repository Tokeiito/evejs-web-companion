<script lang="ts">
  // The HUD's utility buttons (shipUI's hudButtons: hudButtonsCont.HudButtonsCont.construct_buttons), those of the
  // client's the page has a part for, in the order of their column: Cargo (LeftSideButtonCargo), Scanner
  // (LeftSideButtonScanner) and Autopilot (LeftSideButtonAutopilot). The camera buttons, the tactical overlay's and the
  // zoom buttons want the client's three-dimensional view, which the page has not. All of them are hidden where the HUD
  // options' Display Utility Buttons is off (shipUI.ToggleHudButtons, settings.user.ui hudButtonsExpanded).
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { hudSetting } from "../store/hudSettings.ts";
  import { toggleWindow } from "./windowToggle.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const autopilotOn = flow.autopilotOn;
  const shown = hudSetting("hudButtonsExpanded");

  const LABELS = [
    "UI/Generic/Cargo",
    "UI/Generic/Scanner",
    "UI/Generic/Autopilot",
    "UI/Inflight/ActivateAutopilot",
    "UI/Inflight/DeactivateAutopilot",
    "UI/Inflight/Scanner/ProbeScanner",
  ];
  $effect(() => {
    flow.requestWords(LABELS);
  });
  const said = (label: string, own: string): string => $words.templates[label] || own;

  /**
   * The cargo button's fill (LeftSideButtonCargo.SetFillRatio, by the hold tracker's main hold, the cargo): the share
   * of the cargo taken, the glow at least 0.4 bright; null where the cargo was not read.
   */
  const cargoFill = $derived.by(() => {
    const capacity = $inventory.cargo.capacity;
    return capacity && capacity.capacity > 0 ? Math.min(1, Math.max(0, capacity.used / capacity.capacity)) : null;
  });

  /**
   * The scanner button's menu (LeftSideButtonScanner.OnMouseDown: ExpandRadialMenu, RadialMenuScanner): of its Moon
   * Analysis, Directional Scanner, Solar System Map and Probe Scanner, the page has the probe scanner.
   */
  let scannerMenuOpen = $state(false);

  /** LeftSideButtonAutopilot.OnClick: autoPilot.SetOn, or SetOff where it is on. */
  function toggleAutopilot(): void {
    if ($autopilotOn) flow.deactivateAutopilot();
    else void flow.activateAutopilot().catch(() => {});
  }
</script>

{#if $shown}
  <div class="hud-buttons" role="toolbar" aria-label="Utility buttons">
    <!-- Inventory.OpenOrShow of the active ship's cargo, toggled (the workspace's windowToggle). -->
    <button
        type="button"
        class="hud-button"
        title={cargoFill === null ? said("UI/Generic/Cargo", "Cargo hold") : `${said("UI/Generic/Cargo", "Cargo hold")} ${Math.round(cargoFill * 100)}%`}
        aria-label={said("UI/Generic/Cargo", "Cargo hold")}
        onclick={() => toggleWindow("inventory")}
      >
        {#if cargoFill !== null}
          <span class="hud-button-fill" style={`height:${cargoFill * 100}%;opacity:${Math.max(0.4, cargoFill)}`}></span>
        {/if}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l8-4 8 4v8l-8 4-8-4z" /><path d="M4 8l8 4 8-4M12 12v8" /></svg>
      </button>
      <span class="hud-button-wrap">
        <button
          type="button"
          class="hud-button"
          title={said("UI/Generic/Scanner", "Scanners")}
          aria-label={said("UI/Generic/Scanner", "Scanners")}
          aria-haspopup="menu"
          aria-expanded={scannerMenuOpen}
          onclick={() => (scannerMenuOpen = !scannerMenuOpen)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 12l6-6" /></svg>
        </button>
        {#if scannerMenuOpen}
          <span class="hud-button-menu" role="menu">
            <button type="button" role="menuitem" onclick={() => { scannerMenuOpen = false; toggleWindow("scanner"); }}>
              {said("UI/Inflight/Scanner/ProbeScanner", "Probes")}
            </button>
          </span>
        {/if}
      </span>
    <button
      type="button"
      class="hud-button"
      class:busy={$autopilotOn}
      aria-pressed={$autopilotOn}
      title={$autopilotOn ? said("UI/Inflight/DeactivateAutopilot", "Stop the autopilot") : said("UI/Inflight/ActivateAutopilot", "Start the autopilot")}
      aria-label={said("UI/Generic/Autopilot", "Autopilot control")}
      onclick={toggleAutopilot}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19l7-14 7 14-7-4z" /></svg>
    </button>
  </div>
{/if}
