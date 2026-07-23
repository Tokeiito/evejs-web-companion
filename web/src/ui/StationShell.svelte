<script lang="ts">
  // The DOCKED shell: a station interior. A services rail down the left (the
  // retail station-services column), the docked context in the header, and the
  // main station panels to its right. This first pass renders PLACEHOLDER panels
  // in each slot — the slot model (shell.ts) names the real panel destined for
  // each, so wiring them in later is a mechanical swap, not a redesign.
  //
  // A pure reader of the store: the header shows the live docked context that is
  // already loaded (station identity + who is online), no fetch of its own.
  import { STATION_SERVICES, STATION_PANELS } from "./shell.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store }: { store: ClientStore } = $props();

  // Stable store identity; slice signals are Svelte-store-contract objects.
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;

  // The station name comes from the client-local static identity (as retail
  // resolves station names from its static DB); fall back to the resolved
  // flight-location name, then a neutral label. The raw ID is never shown.
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
          <button type="button" class="rail-item" class:unbuilt={svc.wires === null} disabled title={svc.hint}>
            <span class="rail-item-label">{svc.label}</span>
            <span class="rail-item-tag">soon</span>
          </button>
        </li>
      {/each}
    </ul>
  </aside>

  <div class="shell-main">
    {#each STATION_PANELS as slot (slot.id)}
      <section class="panel placeholder-panel" aria-labelledby={`${slot.id}-h`}>
        <div class="panel-head">
          <h2 id={`${slot.id}-h`}>{slot.label}</h2>
          <span class="controls"><span class="soon-pill">placeholder</span></span>
        </div>
        <p class="placeholder-hint">{slot.hint}</p>
      </section>
    {/each}
  </div>
</section>
