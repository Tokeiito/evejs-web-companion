<script lang="ts">
  // The persistent flying HUD — a bottom bar shown only in space (the retail
  // client's spatial arrangement): the ship's resource gauges, the module rack,
  // the live "Shots fired" combat log, and quick-nav buttons for the flight
  // panels. Reads the last space snapshot; opening Flight/Mining raises those
  // windows on the desktop via onOpen.
  import ModuleRack from "./ModuleRack.svelte";
  import ShipHud from "./ShipHud.svelte";
  import { SPACE_PANELS } from "./shell.ts";
  import { resolvedName } from "../store/names.ts";
  import type { TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { DamageEvent, SpaceEntity } from "../store/types.ts";

  let { store, flow, onOpen }: { store: ClientStore; flow: AppFlow; onOpen: (tab: TabID) => void } = $props();

  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // svelte-ignore state_referenced_locally
  const targeting = store.targeting;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  // The module rack needs the ship's fit; Fitting is a docked-only tab, so pull
  // it once here. Fire-and-forget; $effect never runs under SSR.
  $effect(() => {
    if (!$fitting.loaded) void flow.loadFitting().catch(() => {});
  });

  // Nav buttons: the flight panels that open a window (the overview is the fixed
  // top-right dock, not a window, so it is excluded).
  const navSlots = $derived(SPACE_PANELS.filter((s) => s.wires !== null && s.wires !== "overview"));

  // --- Shots fired (moved out of the Overview cockpit into the HUD) -----------
  // Newest first. Names resolve through the shared cache the dock Overview keeps
  // primed (both are mounted in space); an id is never shown (R7d).
  interface ShotRow {
    readonly id: number;
    readonly summary: string;
    readonly weaponLabel: string;
    readonly amountLabel: string;
  }
  function entityLabel(entity: SpaceEntity | null): string {
    if (!entity) return "something no longer in view";
    if (entity.name && entity.name.length > 0) return entity.name;
    const type = resolvedName($names.resolved, "type", entity.typeID, "");
    return type.length > 0 ? type : "Unknown object";
  }
  const shotRows = $derived.by<ShotRow[]>(() => {
    const byID = new Map<number, SpaceEntity>();
    for (const entity of $space.snapshot?.entities ?? []) {
      byID.set(entity.itemID, entity);
    }
    return [...$targeting.damageLog].reverse().map((shot: DamageEvent) => {
      const other = shot.otherPartyID === null ? null : (byID.get(shot.otherPartyID) ?? null);
      const otherLabel = entityLabel(other);
      const missed = shot.amount <= 0;
      return {
        id: shot.id,
        summary:
          shot.direction === "dealt"
            ? missed
              ? `You shot at ${otherLabel} and missed`
              : `You hit ${otherLabel}`
            : missed
              ? `${otherLabel} shot at you and missed`
              : `${otherLabel} hit you`,
        weaponLabel: shot.weaponTypeID === null ? "—" : resolvedName($names.resolved, "type", shot.weaponTypeID, "—"),
        amountLabel: missed ? "—" : shot.amount.toFixed(1),
      };
    });
  });
</script>

<div class="hud-bar">
  <section class="hud-cluster ship-gauges" aria-label="Ship status">
    <ShipHud {store} />
  </section>

  <section class="hud-cluster module-rack" aria-labelledby="hud-modules-h">
    <div class="panel-head"><h3 id="hud-modules-h">Modules</h3></div>
    <ModuleRack {store} {flow} />
  </section>

  <section class="hud-cluster hud-shots" aria-labelledby="hud-shots-h">
    <div class="panel-head"><h3 id="hud-shots-h">Shots fired</h3></div>
    {#if shotRows.length === 0}
      <p class="hud-shots-empty">No shots yet.</p>
    {:else}
      <ul class="hud-shots-list">
        {#each shotRows.slice(0, 30) as shot (shot.id)}
          <li>
            <span class="hud-shot-summary">{shot.summary}</span>
            <span class="hud-shot-meta">{shot.weaponLabel} · {shot.amountLabel}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <nav class="hud-cluster hud-nav" aria-label="Flight panels">
    {#each navSlots as slot (slot.id)}
      <button type="button" class="hud-nav-item" title={slot.hint} onclick={() => onOpen(slot.wires as TabID)}>
        {slot.label}
      </button>
    {/each}
  </nav>
</div>
