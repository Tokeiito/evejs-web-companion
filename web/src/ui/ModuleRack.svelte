<script lang="ts">
  // The in-space HUD module rack — the ship's high / mid / low slots as EVE's
  // three activation racks. Reads the fitting slots (same source as the Fitting
  // window) and overlays the live snapshot's active modules: a cycling module
  // glows, an offline one is dimmed. Names come from the resolved names slice;
  // the tile falls back to abbreviated letters, never a raw id (R7d).
  import TypeIcon from "./TypeIcon.svelte";
  import { buildModuleRack, rackIsEmpty } from "./moduleRack.ts";
  import { abbreviate } from "./fittingIcons.ts";
  import { resolvedName } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store }: { store: ClientStore } = $props();

  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  const rows = $derived(
    buildModuleRack($fitting.slots, $space.snapshot?.ship?.activeModuleIDs ?? null),
  );
  const unknown = $derived(!$fitting.loaded || rackIsEmpty(rows));

  function moduleName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID);
  }
</script>

<div class="module-rack-rows" aria-label="Module rack">
  {#each rows as row (row.family)}
    <div class="rack-row">
      <span class="rack-row-label">{row.label}</span>
      <div class="rack-slots">
        {#if row.slots.length === 0}
          <span class="rack-empty muted">—</span>
        {:else}
          {#each row.slots as slot, i (i)}
            {#if slot.module}
              {@const nm = moduleName(slot.module.typeID)}
              <span
                class="module-slot filled"
                class:active={slot.module.active}
                class:offline={!slot.module.online}
                title={`${nm}${slot.module.active ? " — active" : ""}${!slot.module.online ? " — offline" : ""}`}
              >
                <TypeIcon typeID={slot.module.typeID} name={nm} size="sm" fallbackText={abbreviate(nm)} />
              </span>
            {:else}
              <span class="module-slot empty" title={`Empty ${row.label.toLowerCase()} slot`}></span>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  {/each}
  {#if unknown}
    <p class="rack-hint muted">Modules appear once your ship's fitting has loaded.</p>
  {/if}
</div>
