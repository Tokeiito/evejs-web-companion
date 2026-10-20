<script lang="ts">
  import type { MedalDesignOption } from "../bridge/medalDesigner.ts";
  import { medalGraphicLayer } from "../bridge/corporationDecorations.ts";
  import MedalPreview from "./MedalPreview.svelte";
  let { options, part, label, selected, onSelect, previous, next }: {
    options: readonly MedalDesignOption[]; part: 1 | 2; label: string; selected: number | null;
    onSelect: (index: number) => void; previous: string; next: string;
  } = $props();
  let start = $state(0);
  let cursor = $state(0);
  // ImageSlider.Startup: 228/32 - 1 gives six visible items. Browse only
  // moves the viewport; native DelegateControl's arrows also select.
  const visible = 6;
  function browse(delta: number): void { start = Math.max(0, Math.min(Math.max(0, options.length - visible), start + delta)); }
  function key(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    cursor = Math.max(1, Math.min(options.length, cursor + direction));
    if (cursor - start < 0) cursor = Math.max(1, Math.min(options.length, start + 1));
    else if (cursor - start > visible + 1) cursor = Math.max(1, Math.min(options.length, start + visible));
    onSelect(cursor - 1);
    if (direction === 1 && cursor > start + visible || direction === -1 && cursor <= start) browse(direction);
  }
</script>

<div class="slider" role="toolbar" aria-label={label} tabindex="0" onkeydown={key}>
  <button type="button" class="browse" aria-label={`${label}: ${previous}`} disabled={start === 0} onclick={() => browse(-1)}>‹</button>
  <div class="items">{#each options.slice(start, start + visible) as option, offset (option.name)}
    {@const index = start + offset}
    <button type="button" class="item" class:selected={selected === index} aria-label={option.name} aria-pressed={selected === index} onclick={() => { cursor = index + 1; onSelect(index); }} tabindex="-1">
      <MedalPreview layers={option.graphics.map(graphic => medalGraphicLayer(part, graphic, -1)).reverse()} title={option.name} size={64} width={32} singlePart />
    </button>
  {/each}</div>
  <button type="button" class="browse" aria-label={`${label}: ${next}`} disabled={start >= options.length - visible} onclick={() => browse(1)}>›</button>
</div>

<style>
  .slider { display: flex; width: 228px; height: 32px; flex-shrink: 0; background: #0004; }
  .items { width: 192px; display: flex; overflow: hidden; }
  button { border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; padding: 0; }
  .browse { width: 18px; flex-shrink: 0; }
  .browse:disabled { opacity: .4; cursor: default; }
  .item { width: 32px; height: 32px; flex-shrink: 0; }
  .item.selected { border-color: var(--accent); background: #ffffff12; }
  .slider:focus-visible { outline: 1px solid var(--accent); }
</style>
