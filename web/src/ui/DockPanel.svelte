<script lang="ts">
  // The fixed top-right dock panel — your always-on situational awareness.
  // Docked: the live Station panel (services, identity, guests). In space: the
  // locked-target brackets down a narrow column on the LEFT, and the (compact)
  // Overview — what's around your ship — filling the rest. Ship condition and the
  // module rack are deliberately NOT here; they live in the persistent bottom HUD.
  // Collapsible to a thin strip, and expandable by dragging its left edge; both
  // the collapse state and the width are remembered per character.
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
    width,
    onToggle,
    onResize,
  }: {
    store: ClientStore;
    flow: AppFlow;
    isDocked: boolean;
    collapsed: boolean;
    width: number;
    onToggle: () => void;
    onResize: (w: number) => void;
  } = $props();

  const title = $derived(isDocked ? "Station" : "Around Your Ship");
  const MIN_W = 240;
  const MAX_W = 900;

  // Drag the left edge to widen/narrow. Dragging LEFT (negative dx) widens it.
  function startResize(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startW = width;
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent): void => {
      const next = startW - (e.clientX - startX);
      onResize(Math.max(MIN_W, Math.min(MAX_W, Math.round(next))));
    };
    const up = (): void => {
      target.releasePointerCapture(ev.pointerId);
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }
</script>

<aside class="dock-panel" class:collapsed style={collapsed ? "" : `width:${width}px`} aria-label={title}>
  {#if collapsed}
    <button type="button" class="dock-expand" title={`Show ${title}`} aria-label={`Show ${title}`} onclick={onToggle}>
      <span class="dock-expand-label">{title}</span>
    </button>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="dock-resize" title="Drag to resize" onpointerdown={startResize}></span>
    <header class="dock-panel-head">
      <h2>{title}</h2>
      <button type="button" class="dock-collapse" title="Collapse" aria-label="Collapse" onclick={onToggle}>›</button>
    </header>
    <div class="dock-panel-body">
      {#if isDocked}
        <StationPanel {store} {flow} />
      {:else}
        <div class="dock-inspace">
          <div class="dock-targets" aria-label="Locked targets">
            <h3>Locked targets</h3>
            <TargetBracket {store} />
          </div>
          <div class="dock-overview">
            <Overview {store} {flow} compact />
          </div>
        </div>
      {/if}
    </div>
  {/if}
</aside>
