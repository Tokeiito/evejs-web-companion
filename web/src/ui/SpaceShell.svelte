<script lang="ts">
  // The IN-SPACE shell: a HUD over the overview. The overview (what's around the
  // ship) is the main "home" content; the ship's resource gauges + module rack +
  // nav controls dock along the bottom, always visible — the retail client's
  // spatial arrangement. Flight and Mining open as full panels from the dock via
  // onOpen. Gauges read the last space snapshot; a null ratio renders dashed
  // rather than inventing a value.
  import Overview from "./Overview.svelte";
  import ModuleRack from "./ModuleRack.svelte";
  import TargetBracket from "./TargetBracket.svelte";
  import { SPACE_PANELS, type ShellSlot } from "./shell.ts";
  import { nearestDockable } from "./dockTarget.ts";
  import { resolvedName } from "../store/names.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let {
    store,
    flow,
    onOpen,
  }: { store: ClientStore; flow: AppFlow; onOpen: (tab: TabID) => void } = $props();

  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  // The Dock control targets the nearest station/structure on grid (EVE only
  // docks at something in view). Docking is one-click (the BFF confirm lives in
  // flow.dockAt); success flips the flight flag and App swaps in the station
  // shell. Disabled when nothing on grid can be docked at.
  const dockTarget = $derived(
    nearestDockable($space.snapshot?.entities, $space.snapshot?.ship?.position ?? null),
  );
  const dockName = $derived(
    dockTarget ? (dockTarget.name ?? resolvedName($names.resolved, "type", dockTarget.typeID)) : null,
  );

  let busy = $state(false);
  let error = $state("");
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        error = "The live session ended (idle timeout or another client took over).";
      } else {
        error = cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
      }
    } finally {
      busy = false;
    }
  }

  // The HUD module rack needs the ship's fit, but Fitting is a docked-only tab —
  // so pull it once here. Fire-and-forget: if the read is unavailable the rack
  // stays empty with its neutral hint. $effect never runs under SSR.
  $effect(() => {
    if (!$fitting.loaded) {
      void flow.loadFitting().catch(() => {});
    }
  });

  const systemName = $derived($flight.solarSystemName ?? null);
  const shipMode = $derived($flight.status?.shipMode ?? null);
  const speedPct = $derived(
    $flight.status?.shipSpeedFraction != null
      ? Math.round($flight.status.shipSpeedFraction * 100)
      : null,
  );

  // The HUD dock's nav buttons — everything in SPACE_PANELS that opens a panel
  // other than the overview (which is the inline home content).
  const navSlots = $derived(SPACE_PANELS.filter((s) => s.wires !== null && s.wires !== "overview"));

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
    <div class="shell-head-actions">
      {#if dockTarget}
        <button type="button" class="dock-btn" disabled={busy} title={`Dock at ${dockName}`} onclick={() => run(() => flow.dockAt(dockTarget.itemID))}>
          {busy ? "Docking…" : "Dock"}
        </button>
      {:else}
        <button type="button" class="dock-btn" disabled title="No station on this grid to dock at">Dock</button>
      {/if}
    </div>
  </header>

  <div class="space-viewport">
    {#if error}
      <p class="shell-error" role="alert">{error}</p>
    {/if}
    <TargetBracket {store} />
    <Overview {store} {flow} />
  </div>

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
        <h3 id="hud-modules-h">Modules</h3>
      </div>
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
</section>
