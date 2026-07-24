<script lang="ts">
  // The floating "Locked targets" panel — EVE's target brackets, lifted out of the
  // dock into a free-floating, draggable strip over the workspace. Horizontal by
  // default (the bracket cards lay left-to-right). Shown only while something is
  // locked or acquiring; its position is remembered per character.
  import TargetBracket from "./TargetBracket.svelte";
  import { buildTargets } from "./targetBracket.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let {
    store,
    x,
    y,
    onMove,
  }: { store: ClientStore; x: number; y: number; onMove: (x: number, y: number) => void } = $props();

  // svelte-ignore state_referenced_locally
  const targeting = store.targeting;
  // svelte-ignore state_referenced_locally
  const space = store.space;

  // Only render the panel when there is actually something to show.
  const count = $derived(
    buildTargets($targeting.lockedTargetIDs, $targeting.acquiringTargetIDs, $space.snapshot?.entities ?? null).length,
  );

  let el = $state<HTMLElement | null>(null);
  function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // Drag by the title bar; clamp so the panel stays within the work area.
  function startDrag(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    const parent = el?.parentElement;
    if (!parent || !el) return;
    const rect = parent.getBoundingClientRect();
    const self = el.getBoundingClientRect();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const originX = x;
    const originY = y;
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent): void => {
      onMove(
        clamp(originX + (e.clientX - startX), 0, Math.max(0, rect.width - self.width)),
        clamp(originY + (e.clientY - startY), 0, Math.max(0, rect.height - self.height)),
      );
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

{#if count > 0}
  <section class="targets-panel" bind:this={el} style="left:{x}px; top:{y}px" aria-label="Locked targets">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header class="targets-panel-bar" onpointerdown={startDrag} title="Drag to move">
      <span class="targets-panel-title">Locked targets</span>
    </header>
    <div class="targets-panel-body">
      <TargetBracket {store} />
    </div>
  </section>
{/if}
