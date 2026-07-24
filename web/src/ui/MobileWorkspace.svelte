<script lang="ts">
  // The simplified MOBILE workspace — a floating-window desktop is wrong for a
  // small touch screen, so on narrow viewports the UI collapses to one panel at a
  // time with a scrollable bottom tab bar (classic mobile navigation). "Home" is
  // your situational awareness: the Station panel when docked, or the ship gauges
  // + module rack over the Overview in space. Same panels as the desktop (via
  // PanelHost) — just one at a time, no windows, no drag.
  import WorkspaceHeader from "./WorkspaceHeader.svelte";
  import PanelHost from "./PanelHost.svelte";
  import Overview from "./Overview.svelte";
  import StationPanel from "./StationPanel.svelte";
  import ShipHud from "./ShipHud.svelte";
  import ModuleRack from "./ModuleRack.svelte";
  import TargetBracket from "./TargetBracket.svelte";
  import { visibleTabsFor, type TabID } from "./tabs.ts";
  import { isWindowTab } from "./desktop.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, isDocked }: { store: ClientStore; flow: AppFlow; isDocked: boolean } = $props();

  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // The module rack needs the ship's fit (Fitting is docked-only) — pull once.
  $effect(() => {
    if (!$fitting.loaded) void flow.loadFitting().catch(() => {});
  });

  // The openable panels for the current state (chrome tabs excluded); "home" is
  // the null selection.
  const tabs = $derived(visibleTabsFor(isDocked).filter((tab) => isWindowTab(tab.id)));
  let selected = $state<TabID | null>(null);
  // Drop a selection the current state no longer offers (docked-only after undock).
  const effective = $derived(selected !== null && tabs.some((t) => t.id === selected) ? selected : null);
</script>

<div class="mobile-ws">
  <WorkspaceHeader {store} {flow} {isDocked} />

  <main class="mobile-main">
    {#if effective !== null}
      <PanelHost {store} {flow} tab={effective} onOpen={(id) => (selected = id)} />
    {:else if isDocked}
      <StationPanel {store} {flow} />
    {:else}
      <section class="mobile-hud">
        <ShipHud {store} />
        <ModuleRack {store} />
      </section>
      <TargetBracket {store} />
      <Overview {store} {flow} />
    {/if}
  </main>

  <nav class="mobile-nav" aria-label="Panels">
    <button
      type="button"
      class="mobile-nav-item mobile-nav-home"
      class:active={effective === null}
      onclick={() => (selected = null)}
    >{isDocked ? "Station" : "Ship"}</button>
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class="mobile-nav-item"
        class:active={effective === tab.id}
        onclick={() => (selected = tab.id)}
      >{tab.label}</button>
    {/each}
  </nav>
</div>
