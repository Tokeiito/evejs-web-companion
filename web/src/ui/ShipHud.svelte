<script lang="ts">
  // The in-space ship readout — EVE's capacitor wheel + shield/armor/hull. The
  // capacitor is the centrepiece: a ring of discrete segments (the retail cap is
  // never a smooth bar) with its charge beneath. Shield/armor/hull sit under it
  // as their three coloured bars, outer to inner. All ratios come from the live
  // snapshot; a null reading shows a dash, never a fabricated level.
  import { resourceGauges, capacitorSegments } from "./shipHud.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store }: { store: ClientStore } = $props();

  // svelte-ignore state_referenced_locally
  const space = store.space;

  const SEGMENTS = 12;
  const ship = $derived($space.snapshot?.ship ?? null);
  const capRatio = $derived(ship?.capacitorRatio ?? null);
  const capFilled = $derived(capacitorSegments(capRatio, SEGMENTS));
  const capPct = $derived(capRatio != null ? Math.round(capRatio * 100) : null);
  const gauges = $derived(resourceGauges(ship));
</script>

<div class="ship-hud">
  <div class="cap-wheel" role="img" aria-label={`Capacitor ${capPct != null ? `${capPct}%` : "unknown"}`}>
    <div class="cap-ring">
      {#each Array.from({ length: SEGMENTS }) as _, i (i)}
        <span class="cap-seg" class:filled={i < capFilled}></span>
      {/each}
    </div>
    <div class="cap-readout">
      <span class="cap-value">{capPct != null ? `${capPct}%` : "—"}</span>
      <span class="cap-label">Capacitor</span>
    </div>
  </div>

  <div class="ship-resources">
    {#each gauges as g (g.key)}
      {@const pct = g.ratio != null ? Math.round(g.ratio * 100) : null}
      <div class="hud-gauge {g.key}">
        <div class="hud-head">
          <span class="hud-label">{g.label}</span>
          <span class="hud-value">{pct != null ? `${pct}%` : "—"}</span>
        </div>
        <div class="hud-track">
          {#if pct != null}<span class="hud-fill" style={`width:${pct}%`}></span>{/if}
        </div>
      </div>
    {/each}
  </div>
</div>
