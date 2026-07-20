<script lang="ts">
  // Overview + ship condition (goal R11). What is around the ship, by name,
  // with a distance you can sort and filter on, and Warp to / Approach on every
  // row — so a player can finally fly to anything they can see.
  //
  // A pure reader of the store's space slice. The snapshot comes from the flow
  // (~1s poll while in space); the distance, ordering and filtering are computed
  // here in the browser from the reported positions, exactly the way the real
  // client does it. Movement always goes through the existing atomic moves.
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import { egoPosition } from "../bridge/space.ts";
  import {
    buildOverviewRows,
    formatDistance,
    overviewFilterIDs,
    ratioPercent,
    type OverviewSort,
  } from "../space/overview.ts";
  import { resolvedName, nameKey, type NameRef } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { SpaceEntity } from "../store/types.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  // How many rows we render. A busy grid can hold hundreds of objects and the
  // list re-renders every second, so the nearest few hundred is the useful set.
  const ROW_CAP = 200;

  let busy = $state(false);
  let error = $state("");
  let search = $state("");
  let sort = $state<OverviewSort>("distance");
  let categoryFilter = $state("");
  let groupFilter = $state("");

  const snapshot = $derived($space.snapshot);
  const inSpace = $derived(snapshot?.inSpace === true || $flight.status?.inSpace === true);
  const origin = $derived(egoPosition(snapshot));

  // Every name this panel shows resolves through the shared name cache: a TYPE
  // name and its GROUP / CATEGORY names, all keyed off the object's typeID.
  // Nothing numeric is ever rendered (R7d).
  function typeName(entity: { typeID: number | null }): string {
    return resolvedName($names.resolved, "type", entity.typeID, "—");
  }
  function groupName(entity: { typeID: number | null }): string {
    return resolvedName($names.resolved, "typeGroup", entity.typeID, "—");
  }
  function categoryName(typeID: number | null): string {
    return resolvedName($names.resolved, "typeCategory", typeID, "—");
  }

  // An object's display name: its own name where it has one (celestials and
  // stations are named), otherwise what kind of thing it is.
  function displayLabel(entity: SpaceEntity): string {
    if (entity.name && entity.name.length > 0) {
      return entity.name;
    }
    const type = resolvedName($names.resolved, "type", entity.typeID, "");
    return type.length > 0 ? type : "Unknown object";
  }

  // Ask the cache for every name the current snapshot needs, in one batch.
  $effect(() => {
    const refs: NameRef[] = [];
    for (const entity of snapshot?.entities ?? []) {
      if (entity.typeID !== null) {
        refs.push({ kind: "type", id: entity.typeID });
        refs.push({ kind: "typeGroup", id: entity.typeID });
        refs.push({ kind: "typeCategory", id: entity.typeID });
      }
    }
    const shipTypeID = snapshot?.ship?.typeID ?? null;
    if (shipTypeID !== null) {
      refs.push({ kind: "type", id: shipTypeID });
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // The category / group choices actually present around the ship. Each is
  // offered by NAME, using a representative object's typeID to resolve it; a
  // choice whose name has not resolved yet is simply not offered yet.
  interface FilterChoice {
    readonly id: number;
    readonly label: string;
  }

  const filterChoices = $derived.by<{
    categories: FilterChoice[];
    groups: FilterChoice[];
  }>(() => {
    const { categoryIDs, groupIDs } = overviewFilterIDs(snapshot);
    const categoryType = new Map<number, number>();
    const groupType = new Map<number, number>();
    for (const entity of snapshot?.entities ?? []) {
      if (entity.isSelf || entity.typeID === null) {
        continue;
      }
      if (entity.categoryID !== null && !categoryType.has(entity.categoryID)) {
        categoryType.set(entity.categoryID, entity.typeID);
      }
      if (entity.groupID !== null && !groupType.has(entity.groupID)) {
        groupType.set(entity.groupID, entity.typeID);
      }
    }
    const build = (ids: readonly number[], source: Map<number, number>, kind: "typeCategory" | "typeGroup"): FilterChoice[] =>
      ids
        .map((id) => ({
          id,
          label: resolvedName($names.resolved, kind, source.get(id) ?? null, ""),
        }))
        .filter((choice) => choice.label.length > 0)
        .sort((left, right) => left.label.localeCompare(right.label));
    return {
      categories: build(categoryIDs, categoryType, "typeCategory"),
      groups: build(groupIDs, groupType, "typeGroup"),
    };
  });

  // The rendered list: filtered, distance-sorted and capped, all client-side.
  const overview = $derived.by(() =>
    buildOverviewRows(snapshot, origin, {
      sort,
      cap: ROW_CAP,
      filter: {
        text: search,
        categoryID: categoryFilter === "" ? null : Number(categoryFilter),
        groupID: groupFilter === "" ? null : Number(groupFilter),
      },
      // Text search matches what the player sees, so it searches the resolved
      // type and group names too — not just the object's own name.
      names: (entity) => ({
        typeName: $names.resolved[nameKey("type", entity.typeID ?? 0)] ?? null,
        groupName: $names.resolved[nameKey("typeGroup", entity.typeID ?? 0)] ?? null,
      }),
    }),
  );

  const ship = $derived(snapshot?.ship ?? null);

  interface Gauge {
    readonly key: string;
    readonly label: string;
    readonly percent: number | null;
  }

  const gauges = $derived.by<Gauge[]>(() => [
    { key: "shield", label: "Shield", percent: ratioPercent(ship?.shieldRatio) },
    { key: "armor", label: "Armor", percent: ratioPercent(ship?.armorRatio) },
    { key: "hull", label: "Hull", percent: ratioPercent(ship?.hullRatio) },
    { key: "capacitor", label: "Capacitor", percent: ratioPercent(ship?.capacitorRatio) },
  ]);

  function shipLabel(): string {
    if (!ship) {
      return "—";
    }
    const type = resolvedName($names.resolved, "type", ship.typeID, "");
    if (type.length > 0) {
      return type;
    }
    return ship.name && ship.name.length > 0 ? ship.name : "your ship";
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        error = "The live session ended (idle timeout or another client took over).";
      } else {
        error =
          cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
      }
    } finally {
      busy = false;
    }
  }

  // The panel owns the poll's lifetime: it starts when the tab opens and stops
  // when the tab closes. The poll also stops itself once the ship docks.
  onMount(() => {
    void run(() => flow.loadSpaceSnapshot());
    flow.startSpacePolling();
    return () => flow.stopSpacePolling();
  });
</script>

<section>
  <h2>Around your ship</h2>
  <p class="note">
    Everything your ship can see, nearest first. Pick anything in the list to
    warp to it or fly towards it.
  </p>
  {#if error}
    <p class="error">{error}</p>
  {:else if $space.error}
    <p class="error">{$space.error}</p>
  {/if}
</section>

{#if !inSpace}
  <section>
    <p class="note">
      You are docked. Undock on the Flight tab to see what is around your ship.
    </p>
  </section>
{:else}
  <section>
    <h2>Ship condition</h2>
    {#if !ship}
      <p class="note">Reading your ship's condition…</p>
    {:else}
      <p class="note">{shipLabel()}</p>
      <div class="hud">
        {#each gauges as gauge (gauge.key)}
          <div class="hud-gauge {gauge.key}">
            <div class="hud-head">
              <span class="hud-label">{gauge.label}</span>
              <span class="hud-value">{gauge.percent === null ? "—" : `${gauge.percent}%`}</span>
            </div>
            <div
              class="hud-track"
              role="meter"
              aria-label={gauge.label}
              aria-valuenow={gauge.percent ?? 0}
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="hud-fill" style={`width: ${gauge.percent ?? 0}%`}></span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section>
    <h2>Overview</h2>
    <p class="controls">
      <label>
        Search
        <input type="search" bind:value={search} placeholder="name, type or group" />
      </label>
      <label>
        Category
        <select bind:value={categoryFilter}>
          <option value="">All</option>
          {#each filterChoices.categories as choice (choice.id)}
            <option value={String(choice.id)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Group
        <select bind:value={groupFilter}>
          <option value="">All</option>
          {#each filterChoices.groups as choice (choice.id)}
            <option value={String(choice.id)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Sort by
        <select bind:value={sort}>
          <option value="distance">Distance</option>
          <option value="name">Name</option>
        </select>
      </label>
    </p>

    {#if !$space.loaded}
      <p class="note">Looking around…</p>
    {:else if overview.rows.length === 0}
      <p class="note">Nothing matches — clear the search or filters to see everything.</p>
    {:else}
      <p class="note">
        Showing {overview.rows.length} of {overview.matched} nearby.
        {#if overview.matched > overview.rows.length}
          Search or filter to narrow the list.
        {/if}
      </p>
      <div class="table-wrap overflow-x-auto">
        <table class="guests overview reflow">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Group</th>
              <th>Distance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each overview.rows as row (row.itemID)}
              <tr>
                <td data-label="Name">{displayLabel(row)}</td>
                <td data-label="Type">{typeName(row)}</td>
                <td data-label="Group">{groupName(row)}</td>
                <td data-label="Distance">{formatDistance(row.distance)}</td>
                <td data-label="">
                  <span class="row-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.warpTo(row.itemID))}
                    >
                      Warp to
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.approach(row.itemID))}
                    >
                      Approach
                    </button>
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if $flight.actionError}
        <p class="error">{$flight.actionError}</p>
      {/if}
    {/if}
  </section>
{/if}
