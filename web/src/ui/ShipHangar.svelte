<script lang="ts">
  // The docked ship-hangar summary — the hull you are flying + the other ships
  // in the station, at a glance. Read-only: it names and counts the hulls and
  // opens the full Inventory panel for boarding / cargo (onOpen). Names resolve
  // through the names slice; the tile falls back to letters, never a raw id.
  import TypeIcon from "./TypeIcon.svelte";
  import { buildShipHangar } from "./shipHangar.ts";
  import { resolvedName } from "../store/names.ts";
  import type { TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { InventoryItemRow } from "../store/types.ts";

  let { store, onOpen }: { store: ClientStore; onOpen: (tab: TabID) => void } = $props();

  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  const view = $derived(buildShipHangar($inventory.activeShipID, $inventory.hangar.rows));

  function hullName(row: InventoryItemRow): string {
    return resolvedName($names.resolved, "type", row.typeID);
  }
</script>

<section class="panel ship-hangar" aria-labelledby="ship-hangar-h">
  <div class="panel-head">
    <h2 id="ship-hangar-h">Ship Hangar</h2>
    <span class="controls">
      <button type="button" onclick={() => onOpen("inventory")}>Open hangar</button>
    </span>
  </div>

  {#if !$inventory.loaded}
    <p class="muted">Loading your hangar…</p>
  {:else if view.total === 0}
    <p class="muted">No ships in this station's hangar.</p>
  {:else}
    {#if view.active}
      <div class="hull-row active">
        <TypeIcon typeID={view.active.typeID} name={hullName(view.active)} size="sm" />
        <span class="hull-name">{hullName(view.active)}</span>
        <span class="hull-tag">Active</span>
      </div>
    {/if}
    {#if view.others.length > 0}
      <ul class="hull-list">
        {#each view.others as hull (hull.itemID)}
          <li class="hull-row">
            <TypeIcon typeID={hull.typeID} name={hullName(hull)} size="sm" />
            <span class="hull-name">{hullName(hull)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
