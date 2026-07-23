<script lang="ts">
  // The DOCKED shell: a station interior. A services rail down the left (the
  // retail station-services column — Fitting, Market, Industry, Travel, Bots,
  // plus the not-yet-built station services), the docked context in the header,
  // and the live station panel as the main "home" content. Rail items and the
  // hangar shortcut open their real panel via onOpen; the station itself
  // (identity, services row, guests) renders inline from the store.
  import StationPanel from "./StationPanel.svelte";
  import { STATION_SERVICES, STATION_PANELS } from "./shell.ts";
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
    <button type="button" class="undock-btn" disabled title="Undocking is wired in a later pass">
      Undock
    </button>
  </header>

  <aside class="services-rail" aria-label="Station services">
    <h2 class="rail-title">Services</h2>
    <ul>
      {#each STATION_SERVICES as svc (svc.id)}
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
  </aside>

  <div class="shell-main">
    {#each STATION_PANELS as slot (slot.id)}
      <button
        type="button"
        class="hangar-shortcut"
        title={slot.hint}
        onclick={() => slot.wires && onOpen(slot.wires)}
      >
        <span class="hangar-shortcut-label">{slot.label}</span>
        <span class="muted">{slot.hint}</span>
      </button>
    {/each}
    <StationPanel {store} {flow} />
  </div>
</section>
