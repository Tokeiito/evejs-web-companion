<script lang="ts">
  // colorpicker.ColorPreview: one 24-swatch menu, swatch clicks retain it;
  // global mouse-up outside closes it and returns focus to the preview.
  import { onDestroy } from "svelte";
  import { MEDAL_COLOURS } from "../bridge/medalDesigner.ts";
  let { color, label, onSelect, onOpen }: { color: number; label: string; onSelect: (swatch: number) => void; onOpen: () => void } = $props();
  const id = $props.id();
  let button = $state<HTMLButtonElement>(), palette = $state<HTMLDivElement>();
  let expanded = $state(false), x = $state(0), y = $state(0);
  function open(): void {
    if (expanded || !button || !palette) return;
    const rect = button.getBoundingClientRect();
    x = rect.right + 112 > window.innerWidth ? rect.left - 112 : rect.right;
    y = rect.bottom + 62 > window.innerHeight ? rect.top - 62 : rect.bottom;
    onOpen(); expanded = true; palette.showPopover();
  }
  function close(focus = true): void {
    if (!expanded) return;
    palette?.hidePopover(); expanded = false;
    if (focus) button?.focus();
  }
  function outside(event: MouseEvent): void {
    if (expanded && event.target instanceof Node && !palette?.contains(event.target)) close();
  }
  onDestroy(() => close(false));
</script>

<svelte:window onmouseup={outside} onkeydown={event => { if (expanded && event.key === "Escape") close(); }} />
<button bind:this={button} type="button" class="colour-preview" aria-label={label} aria-expanded={expanded} aria-controls={id} style:background={`#${(color >>> 0 & 0xffffff).toString(16).padStart(6, "0")}`} onclick={open}></button>
<div bind:this={palette} {id} class="colour-palette" popover="manual" role="group" aria-label={`${label} palette`} style:left={`${x}px`} style:top={`${y}px`}>
  {#each MEDAL_COLOURS as hex, index}
    <button type="button" class="swatch" aria-label={`#${hex}`} style:background={`#${hex}`} onclick={() => onSelect(index)}></button>
  {/each}
</div>

<style>
  .colour-preview { width: 24px; min-width: 24px; height: 30px; min-height: 0; border: 1px solid #ffffff80; flex-shrink: 0; padding: 0; cursor: pointer; }
  .colour-palette { position: fixed; inset: auto; margin: 0; padding: 0; width: 112px; height: 62px; border: 0; outline: 6px solid #14202ef0; overflow: visible; background: #14202ef0; }
  .colour-palette:popover-open { display: grid; grid-template-columns: repeat(7, 16px); grid-auto-rows: 16px; align-content: start; }
  .swatch { box-sizing: border-box; width: 16px; min-width: 0; height: 16px; min-height: 0; border: 1px solid #ffffff80; margin: 0; padding: 0; cursor: pointer; }
  .swatch:focus-visible { outline: 1px solid white; outline-offset: -3px; }
</style>
