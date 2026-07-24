<script lang="ts">
  // The fixed top-right dock panel — your always-on situational awareness. In
  // space it is the Overview (what's around your ship) with the locked-target
  // brackets above it; docked it is the live Station panel (services, identity,
  // guests). Collapsible to a thin strip to hand its width back to the desktop
  // (the collapsed state is remembered per character alongside the windows).
  import Overview from "./Overview.svelte";
  import StationPanel from "./StationPanel.svelte";
  import TargetBracket from "./TargetBracket.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let {
    store,
    flow,
    isDocked,
    collapsed,
    onToggle,
  }: {
    store: ClientStore;
    flow: AppFlow;
    isDocked: boolean;
    collapsed: boolean;
    onToggle: () => void;
  } = $props();

  const title = $derived(isDocked ? "Station" : "Around Your Ship");
</script>

<aside class="dock-panel" class:collapsed aria-label={title}>
  {#if collapsed}
    <button type="button" class="dock-expand" title={`Show ${title}`} aria-label={`Show ${title}`} onclick={onToggle}>
      <span class="dock-expand-label">{title}</span>
    </button>
  {:else}
    <header class="dock-panel-head">
      <h2>{title}</h2>
      <button type="button" class="dock-collapse" title="Collapse" aria-label="Collapse" onclick={onToggle}>›</button>
    </header>
    <div class="dock-panel-body">
      {#if isDocked}
        <StationPanel {store} {flow} />
      {:else}
        <TargetBracket {store} />
        <Overview {store} {flow} />
      {/if}
    </div>
  {/if}
</aside>
