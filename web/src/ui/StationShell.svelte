<script lang="ts">
  // The DOCKED shell: a station interior. A services rail down the left (the
  // retail station-services column — Fitting, Market, Industry, Travel, Bots,
  // plus the not-yet-built station services), the docked context in the header,
  // and the live station panel as the main "home" content. Rail items and the
  // hangar shortcut open their real panel via onOpen; the station itself
  // (identity, services row, guests) renders inline from the store.
  import StationPanel from "./StationPanel.svelte";
  import ShipHangar from "./ShipHangar.svelte";
  import { STATION_SERVICE_GROUPS } from "./shell.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let {
    store,
    flow,
    onOpen,
  }: { store: ClientStore; flow: AppFlow; onOpen: (tab: TabID) => void } = $props();

  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;

  // Populate the hangar summary. Fire-and-forget; $effect never runs under SSR.
  $effect(() => {
    if (!$inventory.loaded) {
      void flow.loadInventory().catch(() => {});
    }
  });

  // Undock is a one-click movement write (as in EVE — no confirm dialog); the
  // BFF confirm is handled inside flow.undock(). Success flips the flight flag,
  // and App swaps this shell for the space HUD on its own. The run() guard
  // mirrors the Flight panel's: one action at a time, the server's own refusal.
  let busy = $state(false);
  let error = $state("");
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        error = "The live session ended (idle timeout or another client took over).";
      } else {
        error = cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
      }
    } finally {
      busy = false;
    }
  }

  const stationName = $derived(
    $station.station?.stationName ?? $flight.stationName ?? "this station",
  );
  const systemName = $derived(
    $station.station?.solarSystemName ?? $flight.solarSystemName ?? null,
  );
  const regionName = $derived($station.station?.regionName ?? null);
</script>

<section class="station-shell">
  <header class="shell-head">
    <span class="state-badge docked">Docked</span>
    <div class="shell-head-where">
      <strong>{stationName}</strong>
      {#if systemName}
        <span class="muted">
          {systemName}{#if regionName} · {regionName}{/if}
        </span>
      {/if}
    </div>
    {#if $station.online}
      <span class="shell-head-pilot">{$station.online.characterName}</span>
    {/if}
    <button type="button" class="undock-btn" disabled={busy} onclick={() => run(() => flow.undock())}>
      {busy ? "Undocking…" : "Undock"}
    </button>
  </header>

  <aside class="services-rail" aria-label="Station services">
    {#each STATION_SERVICE_GROUPS as group (group.label)}
      {#if group.slots.length > 0}
        <h2 class="rail-title">{group.label}</h2>
        <ul>
          {#each group.slots as svc (svc.id)}
            <li>
              {#if svc.wires !== null}
                <button type="button" class="rail-item" title={svc.hint} onclick={() => onOpen(svc.wires as TabID)}>
                  <span class="rail-item-label">{svc.label}</span>
                </button>
              {:else}
                <button type="button" class="rail-item unbuilt" disabled title={svc.hint}>
                  <span class="rail-item-label">{svc.label}</span>
                  <span class="rail-item-tag">soon</span>
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </aside>

  <div class="shell-main">
    {#if error}
      <p class="shell-error" role="alert">{error}</p>
    {/if}
    <ShipHangar {store} {onOpen} />
    <StationPanel {store} {flow} />
  </div>
</section>
