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
  // R23 slice A — the GENERIC in-space action layer: what is locked, and which
  // modules are running. Nothing here is mining-specific; the same two sections
  // serve a turret exactly as they serve a mining laser.
  // svelte-ignore state_referenced_locally
  const targeting = store.targeting;
  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // R23 slice B — the survey scanner. The scan is the only read that says how
  // much ore a rock has left when the snapshot could not; it is MERGED into the
  // rows here, never used to compute anything.
  // svelte-ignore state_referenced_locally
  const mining = store.mining;

  // How many rows we render. A busy grid can hold hundreds of objects and the
  // list re-renders every second, so the nearest few hundred is the useful set.
  const ROW_CAP = 200;

  // R13 flight ranges. Every one of these is a DISTANCE the player picks once
  // and then applies to any row, which is how the retail right-click submenus
  // work — putting a set of range pickers on all 200 rows would be unusable.
  // Labels are written out rather than formatted so a fixed menu reads as
  // "10 km", never "10.0 km" and never a raw metre count.
  interface RangeChoice {
    readonly metres: number;
    readonly label: string;
  }
  // Retail's warp-range menu, and retail's own default: right on top, not 10 km.
  const WARP_RANGES: readonly RangeChoice[] = [
    { metres: 0, label: "As close as it can" },
    { metres: 10000, label: "10 km" },
    { metres: 20000, label: "20 km" },
    { metres: 30000, label: "30 km" },
    { metres: 50000, label: "50 km" },
    { metres: 70000, label: "70 km" },
    { metres: 100000, label: "100 km" },
  ];
  // Orbit / hold distances, defaulting to retail's 1000 m.
  const HOLD_RANGES: readonly RangeChoice[] = [
    { metres: 500, label: "500 m" },
    { metres: 1000, label: "1 km" },
    { metres: 2500, label: "2.5 km" },
    { metres: 5000, label: "5 km" },
    { metres: 10000, label: "10 km" },
    { metres: 20000, label: "20 km" },
    { metres: 30000, label: "30 km" },
  ];

  let busy = $state(false);
  let error = $state("");
  let search = $state("");
  let sort = $state<OverviewSort>("distance");
  let categoryFilter = $state("");
  let groupFilter = $state("");
  let warpRange = $state("0");
  let orbitRange = $state("1000");
  let holdRange = $state("1000");

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

  // --- R23 slice A: targeting + module activation --------------------------
  //
  // GENERIC BY CONSTRUCTION. A target is a target and a module is a module; the
  // only thing that differs between mining and combat is WHICH module the
  // player switches on, which is their choice, not this panel's.

  const lockedIDs = $derived($targeting.lockedTargetIDs);
  const acquiringIDs = $derived($targeting.acquiringTargetIDs);

  function isLocked(itemID: number): boolean {
    return lockedIDs.includes(itemID);
  }
  function isAcquiring(itemID: number): boolean {
    return acquiringIDs.includes(itemID);
  }

  /**
   * The locked list, each entry named from the CURRENT snapshot. A target the
   * snapshot no longer carries has no name to show — so it says so plainly
   * rather than falling back to its itemID (R7d).
   */
  interface LockedRow {
    readonly itemID: number;
    readonly label: string;
    readonly typeLabel: string;
    readonly distance: string;
    readonly acquiring: boolean;
  }
  const lockedRows = $derived.by<LockedRow[]>(() => {
    const byID = new Map<number, SpaceEntity>();
    for (const entity of snapshot?.entities ?? []) {
      byID.set(entity.itemID, entity);
    }
    const rowDistance = new Map<number, number>();
    for (const row of overview.rows) {
      rowDistance.set(row.itemID, row.distance);
    }
    const ids = [...lockedIDs, ...acquiringIDs.filter((id) => !lockedIDs.includes(id))];
    return ids.map((itemID) => {
      const entity = byID.get(itemID) ?? null;
      const distance = rowDistance.get(itemID);
      return {
        itemID,
        label: entity ? displayLabel(entity) : "No longer in view",
        typeLabel: entity ? typeName(entity) : "—",
        distance: distance === undefined ? "—" : formatDistance(distance),
        acquiring: !lockedIDs.includes(itemID),
      };
    });
  });

  /**
   * The modules the player can switch on: everything ONLINE in the ship's
   * slots. Rigs and subsystems are never activated, so they are left out.
   * Whether a module is RUNNING comes from the snapshot's activeModuleIDs —
   * the server's own state — never from what this page remembers clicking.
   */
  interface ModuleRow {
    readonly itemID: number;
    readonly label: string;
    readonly slotLabel: string;
    readonly running: boolean | null;
  }
  const activeModuleIDs = $derived(snapshot?.ship?.activeModuleIDs ?? null);
  const moduleRows = $derived.by<ModuleRow[]>(() => {
    const rows: ModuleRow[] = [];
    for (const slot of $fitting.slots) {
      if (slot.family === "rig" || slot.family === "subsystem" || !slot.module) {
        continue;
      }
      if (!slot.module.online) {
        continue;
      }
      rows.push({
        itemID: slot.module.itemID,
        label: resolvedName($names.resolved, "type", slot.module.typeID, "Unknown module"),
        slotLabel:
          slot.family === "high" ? "High slot" : slot.family === "mid" ? "Mid slot" : "Low slot",
        // null = the server could not tell us. Rendered as "unknown", never
        // as "off" — a wrong "off" would invite a double activation.
        running: activeModuleIDs === null ? null : activeModuleIDs.includes(slot.module.itemID),
      });
    }
    return rows;
  });

  // --- R23 slice B: rocks in the overview ----------------------------------

  /**
   * How much ore a rock has left, as ONE number from two sources that agree by
   * construction: the snapshot's own reading, and the survey scanner's (which
   * reaches rocks the snapshot may not have a mining record for). The scan wins
   * when both exist, because the player asked for it and it is the fresher read.
   *
   * null is "not known" and renders as a dash. A rock with a real 0 is a
   * mined-out rock and says so — the two must never be shown the same way.
   */
  const surveyByID = $derived.by<Map<number, number | null>>(() => {
    const map = new Map<number, number | null>();
    for (const result of $mining.survey) {
      map.set(result.itemID, result.remainingQuantity);
    }
    return map;
  });
  function remainingOre(row: SpaceEntity): number | null {
    const scanned = surveyByID.get(row.itemID);
    if (scanned !== undefined) {
      return scanned;
    }
    return row.remainingQuantity;
  }
  function remainingLabel(row: SpaceEntity): string {
    if (row.kind !== "asteroid") {
      return "";
    }
    const remaining = remainingOre(row);
    if (remaining === null) {
      // Never a fabricated number, and never a 0 standing in for "unknown".
      return "—";
    }
    return remaining === 0 ? "Mined out" : `${remaining.toLocaleString()} units`;
  }
  const rockCount = $derived(
    (snapshot?.entities ?? []).filter((entity) => entity.kind === "asteroid").length,
  );

  // R24 slice B — a row you can DOCK at. The server tells us what each ball is
  // (its runtime kind), so a station is a station by data, not by guessing from
  // its name or its distance.
  function isDockable(row: SpaceEntity): boolean {
    return row.kind === "station" || row.kind === "structure";
  }

  // Which locked target a module is switched on AGAINST. Modules that act on
  // the ship itself ignore it; the server refuses with its own reason when a
  // module needs a target and none is chosen, and that reason is shown as-is.
  let actionTargetID = $state("");
  const effectiveTargetID = $derived(
    Number(actionTargetID) > 0 && isLocked(Number(actionTargetID)) ? Number(actionTargetID) : 0,
  );

  // Module names come from the same cache as everything else (R7d).
  $effect(() => {
    const refs: NameRef[] = [];
    for (const slot of $fitting.slots) {
      if (slot.module) {
        refs.push({ kind: "type", id: slot.module.typeID });
      }
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

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
    // R23: the ship's slots (so modules can be offered BY NAME) and the current
    // locks. Both are best-effort — neither may blank the overview if it fails.
    void flow.loadFitting().catch(() => {});
    void flow.loadTargets().catch(() => {});
    flow.startSpacePolling();
    return () => flow.stopSpacePolling();
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h2>Around your ship</h2>
  </header>
  <p class="note">
    Everything your ship can see, nearest first. Pick anything in the list to
    warp to it, fly towards it, orbit it, hold a distance from it or line your
    ship up with it.
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
    <h2>Flying</h2>
    <p class="note">
      Pick the distances you want first, then use the buttons on any row below.
      Stop cuts the engines — and switches the autopilot off, so nothing starts
      flying you somewhere again.
    </p>
    <p class="controls">
      <label>
        Warp to within
        <select bind:value={warpRange}>
          {#each WARP_RANGES as choice (choice.metres)}
            <option value={String(choice.metres)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Orbit at
        <select bind:value={orbitRange}>
          {#each HOLD_RANGES as choice (choice.metres)}
            <option value={String(choice.metres)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Hold at
        <select bind:value={holdRange}>
          {#each HOLD_RANGES as choice (choice.metres)}
            <option value={String(choice.metres)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <button type="button" disabled={busy} onclick={() => run(() => flow.stopShip())}>
        Stop the ship
      </button>
    </p>
  </section>

  <!--
    R23 slice A — the generic in-space action layer. Two sections, neither of
    which knows anything about mining: what you have locked, and what you can
    switch on. A later combat goal renders exactly these two sections.
  -->
  <section>
    <h2>Locked targets</h2>
    <p class="note">
      What your ship has a lock on. You need a lock before you can use most
      equipment on something. Locking takes a moment — your ship has to get a
      fix on it first.
    </p>
    {#if lockedRows.length === 0}
      <p class="empty">Nothing is locked. Use Lock on any row below.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Target</th>
              <th>Type</th>
              <th class="num">Distance</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each lockedRows as locked (locked.itemID)}
              <tr>
                <td data-label="Target">{locked.label}</td>
                <td data-label="Type">{locked.typeLabel}</td>
                <td class="num" data-label="Distance">{locked.distance}</td>
                <td data-label="State">{locked.acquiring ? "Locking…" : "Locked"}</td>
                <td data-label="">
                  <span class="row-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.unlockTarget(locked.itemID))}
                    >
                      Release lock
                    </button>
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section>
    <h2>Your equipment</h2>
    <p class="note">
      Everything switched on and ready to run. Pick a locked target first if the
      equipment needs one — your ship will say so if it does.
    </p>
    {#if moduleRows.length === 0}
      <p class="empty">
        Nothing is powered up. Turn equipment on in the Fitting tab first.
      </p>
    {:else}
      <p class="controls">
        <label>
          Use it on
          <select bind:value={actionTargetID}>
            <option value="">Nothing — just switch it on</option>
            {#each lockedRows.filter((entry) => !entry.acquiring) as locked (locked.itemID)}
              <option value={String(locked.itemID)}>{locked.label}</option>
            {/each}
          </select>
        </label>
      </p>
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Equipment</th>
              <th>Fitted in</th>
              <th>Running</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each moduleRows as module (module.itemID)}
              <tr>
                <td data-label="Equipment">{module.label}</td>
                <td data-label="Fitted in">{module.slotLabel}</td>
                <td data-label="Running">
                  {#if module.running === null}
                    <span class="stat-unavailable">Not known</span>
                  {:else}
                    {module.running ? "Running" : "Idle"}
                  {/if}
                </td>
                <td data-label="">
                  <span class="row-actions">
                    <button
                      type="button"
                      class={module.running === true ? "active" : ""}
                      disabled={busy || module.running === true}
                      onclick={() =>
                        run(() =>
                          flow.activateModule(module.itemID, {
                            targetID: effectiveTargetID > 0 ? effectiveTargetID : null,
                          }),
                        )}
                    >
                      Switch on
                    </button>
                    <button
                      type="button"
                      disabled={busy || module.running === false}
                      onclick={() => run(() => flow.deactivateModule(module.itemID))}
                    >
                      Switch off
                    </button>
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <!--
      Two different failures, said differently on purpose. A refusal carries the
      server's OWN words. A silent decline is when the call came back fine, the
      re-read showed nothing changed, and the server gave no reason — the page
      says exactly that rather than inventing a cause.
    -->
    {#if $targeting.actionError}
      <p class="error">{$targeting.actionError}</p>
    {/if}
    {#if $targeting.silentDecline}
      <p class="error">{$targeting.silentDecline}</p>
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
      <!--
        R23 slice B — the survey scanner. The ship can see the rocks around it
        without this, but not always how much ore is left in them; a scan fills
        the "Ore left" column in. Read-only: it mines nothing and moves nothing.
      -->
      <button type="button" disabled={busy} onclick={() => run(() => flow.runSurveyScan())}>
        Scan the rocks
      </button>
    </p>
    {#if $mining.surveyError}
      <p class="error">{$mining.surveyError}</p>
    {:else if $mining.surveyAtMs !== null && $mining.survey.length === 0}
      <p class="note">The scan came back empty — there was nothing minable in range.</p>
    {:else if rockCount > 0 && $mining.surveyAtMs === null}
      <p class="note">
        There are rocks here. Scan them to see how much ore each one still has.
      </p>
    {/if}

    {#if !$space.loaded}
      <p class="note">Looking around…</p>
    {:else if overview.rows.length === 0}
      <p class="empty">Nothing matches — clear the search or filters to see everything.</p>
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
              <th class="num">Distance</th>
              <!--
                R23 slice B — only meaningful for a rock, and blank for
                everything else. A dash means the amount is NOT KNOWN; a rock
                that really is empty says "Mined out". Run a survey scan to fill
                in what the ship could not see on its own.
              -->
              <th class="num">Ore left</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each overview.rows as row (row.itemID)}
              <tr>
                <td data-label="Name">{displayLabel(row)}</td>
                <td data-label="Type">{typeName(row)}</td>
                <td data-label="Group">{groupName(row)}</td>
                <td class="num" data-label="Distance">{formatDistance(row.distance)}</td>
                <td class="num" data-label="Ore left">{remainingLabel(row)}</td>
                <td data-label="">
                  <span class="row-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.warpTo(row.itemID, Number(warpRange)))}
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
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.orbit(row.itemID, Number(orbitRange)))}
                    >
                      Orbit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.keepAtRange(row.itemID, Number(holdRange)))}
                    >
                      Keep at range
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.alignTo(row.itemID))}
                    >
                      Align to
                    </button>
                    <!--
                      R24 slice B — Dock, and mean it. Unlike the buttons above
                      this is not a single move: it closes the distance itself
                      (warp, then approach) and docks when the ship is actually
                      in range, reporting each phase in the Travel readout and
                      stopping with the station's own reason if it cannot get
                      there. Only offered on something you can dock at.
                    -->
                    {#if isDockable(row)}
                      <button
                        type="button"
                        disabled={busy}
                        onclick={() => run(() => flow.dockAt(row.itemID))}
                      >
                        Dock
                      </button>
                    {/if}
                    <!--
                      R23 — lock / release. GENERIC: this is the same button a
                      later combat goal uses, on the same row, for the same
                      reason. Locking is not instant, so the middle state is
                      shown honestly rather than pretending the lock landed.
                    -->
                    {#if isLocked(row.itemID)}
                      <button
                        type="button"
                        class="active"
                        disabled={busy}
                        onclick={() => run(() => flow.unlockTarget(row.itemID))}
                      >
                        Release lock
                      </button>
                    {:else if isAcquiring(row.itemID)}
                      <button
                        type="button"
                        disabled={busy}
                        onclick={() => run(() => flow.unlockTarget(row.itemID))}
                      >
                        Locking… stop
                      </button>
                    {:else}
                      <button
                        type="button"
                        disabled={busy}
                        onclick={() => run(() => flow.lockTarget(row.itemID))}
                      >
                        Lock
                      </button>
                    {/if}
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
