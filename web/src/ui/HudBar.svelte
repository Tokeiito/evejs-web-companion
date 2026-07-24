<script lang="ts">
  // The persistent flying HUD — a bottom bar shown only in space (the retail
  // client's spatial arrangement): the ship's resource gauges, the module rack,
  // and quick-nav buttons for the flight panels. Reads the last space snapshot;
  // opening Flight/Mining raises those windows on the desktop via onOpen.
  import ModuleRack from "./ModuleRack.svelte";
  import ShipHud from "./ShipHud.svelte";
  import { SPACE_PANELS } from "./shell.ts";
  import type { TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, onOpen }: { store: ClientStore; flow: AppFlow; onOpen: (tab: TabID) => void } = $props();

  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;

  // The module rack needs the ship's fit; Fitting is a docked-only tab, so pull
  // it once here. Fire-and-forget; $effect never runs under SSR.
  $effect(() => {
    if (!$fitting.loaded) void flow.loadFitting().catch(() => {});
  });

  // Nav buttons: the flight panels that open a window (the overview is the fixed
  // top-right dock, not a window, so it is excluded).
  const navSlots = $derived(SPACE_PANELS.filter((s) => s.wires !== null && s.wires !== "overview"));
</script>

<div class="hud-bar">
  <section class="hud-cluster ship-gauges" aria-label="Ship status">
    <ShipHud {store} />
  </section>

  <section class="hud-cluster module-rack" aria-labelledby="hud-modules-h">
    <div class="panel-head"><h3 id="hud-modules-h">Modules</h3></div>
    <ModuleRack {store} />
  </section>

  <nav class="hud-cluster hud-nav" aria-label="Flight panels">
    {#each navSlots as slot (slot.id)}
      <button type="button" class="hud-nav-item" title={slot.hint} onclick={() => onOpen(slot.wires as TabID)}>
        {slot.label}
      </button>
    {/each}
  </nav>
</div>
