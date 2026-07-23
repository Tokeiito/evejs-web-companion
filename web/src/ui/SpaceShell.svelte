<script lang="ts">
  // The IN-SPACE shell: a HUD over a space viewport. The overview sits to the
  // right, the ship's resource gauges + module rack + nav readout dock along the
  // bottom, and the selected-item panel floats over the viewport — the retail
  // client's spatial arrangement. This first pass renders PLACEHOLDER panels in
  // each slot (shell.ts names the real panel destined for each).
  //
  // A pure reader of the store. The header + gauges show the live flight context
  // already loaded (system name, ship mode/speed, resource ratios from the last
  // space snapshot); no fetch of its own. Gauges fall back to a dashed "no
  // reading yet" state before the first snapshot rather than inventing a value.
  import { SPACE_PANELS, type ShellSlot } from "./shell.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store }: { store: ClientStore } = $props();

  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const space = store.space;

  const systemName = $derived($flight.solarSystemName ?? null);
  const shipMode = $derived($flight.status?.shipMode ?? null);
  const speedPct = $derived(
    $flight.status?.shipSpeedFraction != null
      ? Math.round($flight.status.shipSpeedFraction * 100)
      : null,
  );

  function slot(id: string): ShellSlot {
    return (
      SPACE_PANELS.find((s) => s.id === id) ?? { id, label: id, wires: null, hint: "" }
    );
  }
  const overview = $derived(slot("hud-overview"));
  const selected = $derived(slot("hud-selected"));
  const nav = $derived(slot("hud-nav"));
  const modules = $derived(slot("hud-modules"));

  // The ship resource triad + capacitor, from the last snapshot. A ratio of null
  // (no snapshot yet, or the server did not send it) renders as a dashed empty
  // gauge, never a fabricated bar.
  const gauges = $derived(
    (() => {
      const ship = $space.snapshot?.ship ?? null;
      return [
        { cls: "shield", label: "Shield", ratio: ship?.shieldRatio ?? null },
        { cls: "armor", label: "Armor", ratio: ship?.armorRatio ?? null },
        { cls: "hull", label: "Hull", ratio: ship?.hullRatio ?? null },
        { cls: "capacitor", label: "Capacitor", ratio: ship?.capacitorRatio ?? null },
      ];
    })(),
  );
</script>

<section class="space-shell">
  <header class="shell-head">
    <span class="state-badge in-space">In Space</span>
    <div class="shell-head-where">
      <strong>{systemName ?? "In space"}</strong>
      {#if shipMode}<span class="muted">{shipMode}{#if speedPct !== null} · {speedPct}%{/if}</span>{/if}
    </div>
  </header>

  <div class="space-viewport" aria-label="Space viewport">
    <p class="viewport-note">Space view</p>
    <section class="panel placeholder-panel floating-selected" aria-labelledby="hud-selected-h">
      <div class="panel-head">
        <h3 id="hud-selected-h">{selected.label}</h3>
        <span class="controls"><span class="soon-pill">placeholder</span></span>
      </div>
      <p class="placeholder-hint">{selected.hint}</p>
    </section>
  </div>

  <aside class="overview-hud" aria-label="Overview">
    <section class="panel placeholder-panel" aria-labelledby="hud-overview-h">
      <div class="panel-head">
        <h2 id="hud-overview-h">{overview.label}</h2>
        <span class="controls"><span class="soon-pill">placeholder</span></span>
      </div>
      <p class="placeholder-hint">{overview.hint}</p>
    </section>
  </aside>

  <div class="hud-dock">
    <section class="hud-cluster ship-gauges" aria-label="Ship status">
      <div class="hud">
        {#each gauges as g (g.cls)}
          <div class="hud-gauge {g.cls}">
            <div class="hud-head">
              <span class="hud-label">{g.label}</span>
              <span class="hud-value">{g.ratio != null ? `${Math.round(g.ratio * 100)}%` : "—"}</span>
            </div>
            <div class="hud-track">
              {#if g.ratio != null}
                <span class="hud-fill" style={`width:${Math.round(g.ratio * 100)}%`}></span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </section>

    <section class="hud-cluster module-rack" aria-labelledby="hud-modules-h">
      <div class="panel-head">
        <h3 id="hud-modules-h">{modules.label}</h3>
        <span class="controls"><span class="soon-pill">placeholder</span></span>
      </div>
      <div class="module-slots">
        {#each ["High", "High", "High", "Mid", "Mid", "Low", "Low", "Low"] as rack, i (i)}
          <span class="module-slot" title={`${rack} slot`}>{rack[0]}</span>
        {/each}
      </div>
    </section>

    <section class="hud-cluster nav-readout" aria-labelledby="hud-nav-h">
      <div class="panel-head">
        <h3 id="hud-nav-h">{nav.label}</h3>
        <span class="controls"><span class="soon-pill">placeholder</span></span>
      </div>
      <p class="placeholder-hint">{nav.hint}</p>
    </section>
  </div>
</section>
