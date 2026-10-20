<script lang="ts">
  import type { MedalLayer } from "../bridge/corporationDecorations.ts";
  let { layers, title, size = 26, width }: { layers: readonly MedalLayer[]; title: string; size?: number; width?: number } = $props();
  const uid = $props.id();
  // MedalRibbon.Startup244-268: two half-size parts, with a 20/128 overlap
  // and Python int truncation of the medal's vertical offset.
  const half = $derived(Math.floor(size / 2));
  const medalTop = $derived(Math.trunc(half - half * 20 / 128));
  // TriColor.PyFromInt302-316 preserves signed ARGB bits. carbonui.util.color
  // HextoiRGBA256-275 documents the channels; -1 leaves the sprite white.
  function tint(color: number): string {
    const rgba = color === -1 ? [1, 1, 1, 1] : [(color >>> 16 & 255) / 255, (color >>> 8 & 255) / 255, (color & 255) / 255, (color >>> 24) / 255];
    return `${rgba[0]} 0 0 0 0 0 ${rgba[1]} 0 0 0 0 0 ${rgba[2]} 0 0 0 0 0 ${rgba[3]} 0`;
  }
</script>

<svg width={width ?? size} height={size} viewBox={`0 0 ${width ?? size} ${size}`} role="img" aria-label={title}>
  <title>{title}</title>
  <defs>{#each layers as layer, i}
    <filter id={`${uid}-${i}`} color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values={tint(layer.color)} /></filter>
  {/each}</defs>
  {#each layers as layer, i}
    <svg x="0" y={layer.part === 1 ? 0 : medalTop} width={half} height={half} viewBox={`${layer.left} ${layer.top} 128 128`} overflow="hidden">
      <image href={layer.url} x="0" y="0" width="256" height="256" filter={`url(#${uid}-${i})`} />
    </svg>
  {/each}
</svg>
