<script lang="ts">
  // The workspace context bar across the top of the work area: state badge, where
  // you are (station + system docked / system + ship mode in space), the pilot,
  // and the one primary movement action for the current state — Undock when
  // docked, Dock (at the nearest station on grid) in space. Owns its own busy /
  // error guard: one action at a time, and the server's own refusal on failure.
  import { nearestDockable } from "./dockTarget.ts";
  import { resolvedName } from "../store/names.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, isDocked }: { store: ClientStore; flow: AppFlow; isDocked: boolean } = $props();

  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const names = store.names;

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

  const stationName = $derived($station.station?.stationName ?? $flight.stationName ?? "this station");
  const systemName = $derived($station.station?.solarSystemName ?? $flight.solarSystemName ?? null);
  const regionName = $derived($station.station?.regionName ?? null);
  const spaceSystem = $derived($flight.solarSystemName ?? null);
  const shipMode = $derived($flight.status?.shipMode ?? null);
  const speedPct = $derived(
    $flight.status?.shipSpeedFraction != null ? Math.round($flight.status.shipSpeedFraction * 100) : null,
  );

  const dockTarget = $derived(
    nearestDockable($space.snapshot?.entities, $space.snapshot?.ship?.position ?? null),
  );
  const dockName = $derived(
    dockTarget ? (dockTarget.name ?? resolvedName($names.resolved, "type", dockTarget.typeID)) : null,
  );
</script>

<header class="ws-head">
  <span class="state-badge {isDocked ? 'docked' : 'in-space'}">{isDocked ? "Docked" : "In Space"}</span>
  <div class="ws-head-where">
    {#if isDocked}
      <strong>{stationName}</strong>
      {#if systemName}
        <span class="muted">{systemName}{#if regionName} · {regionName}{/if}</span>
      {/if}
    {:else}
      <strong>{spaceSystem ?? "In space"}</strong>
      {#if shipMode}<span class="muted">{shipMode}{#if speedPct !== null} · {speedPct}%{/if}</span>{/if}
    {/if}
  </div>

  <!-- No pilot name here: the character bar's chip is the one authoritative
       "who am I flying" indicator (it stays right in multibox, where this
       single-slot copy could not). -->
  <div class="ws-head-actions">
    {#if error}<span class="ws-head-error" role="alert">{error}</span>{/if}
    {#if isDocked}
      <button type="button" class="undock-btn" disabled={busy} onclick={() => run(() => flow.undock())}>
        {busy ? "Undocking…" : "Undock"}
      </button>
    {:else if dockTarget}
      <button
        type="button"
        class="dock-btn"
        disabled={busy}
        title={`Dock at ${dockName}`}
        onclick={() => run(() => flow.dockAt(dockTarget.itemID))}
      >
        {busy ? "Docking…" : "Dock"}
      </button>
    {:else}
      <button type="button" class="dock-btn" disabled title="No station on this grid to dock at">Dock</button>
    {/if}
  </div>
</header>
