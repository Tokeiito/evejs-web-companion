<script lang="ts">
  // The fitting window (goals R12 + R21): the active ship in the middle with
  // its slots as SOCKETS on arcs around it, the same fit as a list below the
  // R8 breakpoint, and the ship's readings alongside.
  //
  // A pure reader of the store's fitting + inventory slices. All bind /
  // ListByFlags / Add / SetModuleOnline logic lives on the BFF (which holds the
  // bound-object handles) and in app/flow.ts. Slots are addressed by FAMILY and
  // INDEX — no slot flagID, typeID or itemID is ever rendered.
  //
  // R21 adds the radial layout on top of R12's actions WITHOUT reimplementing
  // them: a socket click routes into the very same fitModule / unfitModule /
  // setModuleOnline / destroyRig calls the list view uses, including the rig's
  // two-step destroy confirm.
  //
  // The server stays authoritative: nothing here decides whether a fit is
  // legal. Buttons are only disabled for what is plainly impossible (fitting
  // into a slot that is already full), and every refusal shown is the server's.
  import { onMount } from "svelte";
  import {
    SLOT_FAMILY_LABELS,
    SLOT_FAMILY_ORDER,
    isFittableRow,
    slotsOfFamily,
  } from "../bridge/fitting.ts";
  import { OUTER_RADIUS_PERCENT, countByFamily, placeFamily } from "./fittingGeometry.ts";
  import { abbreviate } from "./fittingIcons.ts";
  // R27 — the shared item icon. The fitting window used to own the only two
  // `<img>` tags in the app, with its own 404 bookkeeping; both are now the
  // same component every other panel uses, so the fallback behaves identically
  // here and in Overview, Inventory, Market and Industry.
  import TypeIcon from "./TypeIcon.svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type {
    FittingResource,
    FittingSlot,
    InventoryItemRow,
    SlotFamily,
  } from "../store/types.ts";
  import { resolvedName, nameKey, type NameRef } from "../store/names.ts";
  import { LAYERS, type LayerName, type Stat } from "../bridge/shipStats.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  /** Which module the player picked to fit, and where it is coming from. */
  let pickedItemID = $state<number | null>(null);
  let pickedSource = $state<"hangar" | "cargo">("hangar");
  /** The rig awaiting an explicit "yes, destroy it" — never a one-click loss. */
  let confirmingRigID = $state<number | null>(null);

  // --- R21 the radial window ------------------------------------------------

  /**
   * Which layout the player is looking at. The default is decided on mount
   * from the viewport (list on a phone, radial above the R8 breakpoint) and
   * then REMEMBERED, so an explicit choice always beats the guess.
   *
   * It starts as "radial" rather than reading the viewport here because this
   * component also renders under the server generator (panelFirstMount), where
   * there is no `window` at all.
   */
  let view = $state<"radial" | "list">("radial");
  const VIEW_STORAGE_KEY = "evejs.fitting.view";

  /** Which socket the player has selected; its actions show beneath the ring. */
  let selected = $state<{ family: SlotFamily; index: number } | null>(null);

  function chooseView(next: "radial" | "list"): void {
    view = next;
    selected = null;
    try {
      globalThis.localStorage?.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // A browser with storage blocked still gets the toggle, just not the
      // memory of it. Never let that break the panel.
    }
  }

  /** The sockets to draw, with each one's placement and what is in it. */
  const sockets = $derived.by(() => {
    const counts = countByFamily($fitting.slots);
    const placed: {
      slot: FittingSlot;
      xPercent: number;
      yPercent: number;
    }[] = [];
    for (const family of SLOT_FAMILY_ORDER) {
      const placements = placeFamily(family, counts[family], OUTER_RADIUS_PERCENT);
      const familySlots = slotsOfFamily($fitting.slots, family);
      for (const placement of placements) {
        const slot = familySlots[placement.index];
        if (slot) {
          placed.push({
            slot,
            xPercent: placement.xPercent,
            yPercent: placement.yPercent,
          });
        }
      }
    }
    return placed;
  });

  /** A key per family for the legend: label, how many, how many filled. */
  const legend = $derived.by(() =>
    SLOT_FAMILY_ORDER.map((family) => {
      const familySlots = slotsOfFamily($fitting.slots, family);
      return {
        family,
        label: SLOT_FAMILY_LABELS[family],
        total: familySlots.length,
        filled: familySlots.filter((slot) => slot.module !== null).length,
      };
    }).filter((entry) => entry.total > 0),
  );

  const selectedSlot = $derived.by<FittingSlot | null>(() => {
    if (selected === null) {
      return null;
    }
    return (
      $fitting.slots.find(
        (slot) => slot.family === selected!.family && slot.index === selected!.index,
      ) ?? null
    );
  });

  function isSelected(slot: FittingSlot): boolean {
    return selected !== null && selected.family === slot.family && selected.index === slot.index;
  }

  /**
   * Clicking a socket. Holding a module and tapping an EMPTY socket fits it
   * straight in — that is the gesture the layout exists for. Anything else
   * selects the socket and shows its actions underneath.
   */
  function clickSocket(slot: FittingSlot): void {
    if (slot.module === null && pickedItemID !== null) {
      fitInto(slot);
      return;
    }
    selected = isSelected(slot) ? null : { family: slot.family, index: slot.index };
    confirmingRigID = null;
  }

  /** What an EMPTY socket shows: its number within its family. */
  function socketText(slot: FittingSlot): string {
    return String(slot.index + 1);
  }

  /** The full spoken/hover description of a socket — never an abbreviation. */
  function socketDescription(slot: FittingSlot): string {
    if (!slot.module) {
      return `${slotName(slot)}, empty`;
    }
    const name = moduleName(slot.module.typeID);
    if (slot.family === "rig" || slot.family === "subsystem") {
      return `${slotName(slot)}, ${name}`;
    }
    return `${slotName(slot)}, ${name}, ${slot.module.online ? "online" : "offline"}`;
  }

  // R7c — resolve the ACTIVE SHIP's typeID, every fitted module's typeID and
  // every fittable inventory row's typeID to a display NAME. Fire-and-forget so
  // the panel renders immediately and swaps in names as they arrive.
  //
  // The ship's own type belongs in this batch: without it the header falls back
  // to "your ship" whenever Fitting is the first panel opened, because nothing
  // else has warmed the flow's name cache for it yet. R21 adds the ship's
  // GROUP, which is what names its class ("Battlecruiser") in the header.
  $effect(() => {
    const refs: NameRef[] = [];
    if (activeShipTypeID !== null) {
      refs.push({ kind: "type", id: activeShipTypeID });
      refs.push({ kind: "typeGroup", id: activeShipTypeID });
    }
    for (const slot of $fitting.slots) {
      if (slot.module) {
        refs.push({ kind: "type", id: slot.module.typeID });
      }
    }
    for (const row of fittableRows()) {
      refs.push({ kind: "type", id: row.row.typeID });
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  /** Modules sitting in the hangar or the ship's cargo that could be fitted. */
  function fittableRows(): { row: InventoryItemRow; source: "hangar" | "cargo" }[] {
    const rows: { row: InventoryItemRow; source: "hangar" | "cargo" }[] = [];
    for (const row of $inventory.hangar.rows) {
      if (isFittableRow(row.categoryID)) {
        rows.push({ row, source: "hangar" });
      }
    }
    for (const row of $inventory.cargo.rows) {
      if (isFittableRow(row.categoryID)) {
        rows.push({ row, source: "cargo" });
      }
    }
    return rows;
  }

  const fittable = $derived.by(() => fittableRows());

  function moduleName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID);
  }

  const pickedName = $derived.by<string | null>(() => {
    if (pickedItemID === null) {
      return null;
    }
    const match = fittable.find((entry) => entry.row.itemID === pickedItemID);
    return match ? moduleName(match.row.typeID) : null;
  });

  /** The active ship's TYPE (what names it) — never its item ID. */
  const activeShipTypeID = $derived.by<number | null>(() => {
    const shipID = $fitting.activeShipID;
    if (shipID === null) {
      return null;
    }
    const row =
      $inventory.hangar.rows.find((entry) => entry.itemID === shipID) ??
      $inventory.cargo.rows.find((entry) => entry.itemID === shipID);
    return row ? row.typeID : null;
  });

  const activeShipName = $derived.by<string>(() => {
    if (activeShipTypeID === null) {
      return "your ship";
    }
    const typeName = $names.resolved[nameKey("type", activeShipTypeID)];
    return typeName ?? "your ship";
  });

  /** The hull's class ("Battlecruiser") — its type GROUP, resolved to a name. */
  const activeShipClass = $derived.by<string | null>(() => {
    if (activeShipTypeID === null) {
      return null;
    }
    return $names.resolved[nameKey("typeGroup", activeShipTypeID)] ?? null;
  });

  /** A slot's position in plain language: "High slot 3", never "flag 29". */
  function slotName(slot: FittingSlot): string {
    const family = SLOT_FAMILY_LABELS[slot.family];
    // "High slots" -> "High slot 3"; "Rigs" -> "Rig 1".
    const singular = family.endsWith("slots")
      ? family.replace(/slots$/, "slot")
      : family.replace(/s$/, "");
    return `${singular} ${slot.index + 1}`;
  }

  function resourceText(resource: FittingResource, unit: string): string {
    if (!resource.known) {
      return "—";
    }
    return `${round(resource.used)} / ${round(resource.total)} ${unit}`;
  }

  function round(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function percent(resource: FittingResource): number | null {
    if (!resource.known || resource.total <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, Math.round((resource.used / resource.total) * 100)));
  }

  const gauges = $derived.by(() => [
    { key: "cpu", label: "CPU", text: resourceText($fitting.resources.cpu, "tf"), pct: percent($fitting.resources.cpu) },
    {
      key: "powergrid",
      label: "Powergrid",
      text: resourceText($fitting.resources.powergrid, "MW"),
      pct: percent($fitting.resources.powergrid),
    },
    {
      key: "capacitor",
      label: "Capacitor",
      text: $fitting.resources.capacitor.known
        ? `${round($fitting.resources.capacitor.total)} GJ`
        : "—",
      pct: $fitting.resources.capacitor.known ? 100 : null,
    },
    {
      key: "calibration",
      label: "Calibration",
      text: resourceText($fitting.resources.calibration, ""),
      pct: percent($fitting.resources.calibration),
    },
  ]);

  // --- R21 formatting for the statistic panels ------------------------------
  //
  // Every one of these takes a number the SERVER produced (or pure arithmetic
  // over server numbers) and makes it readable. None of them invents a value:
  // a statistic we could not source arrives as an unknown `Stat` and is
  // rendered by the `statValue` snippet below as the word "Unavailable", with
  // the reason on hover — never as 0 and never as an empty cell.

  const NUMBER = new Intl.NumberFormat("en-GB");

  function whole(value: number): string {
    return NUMBER.format(Math.round(value));
  }

  function toFixed(value: number, digits: number): string {
    return NUMBER.format(Number(value.toFixed(digits)));
  }

  function asPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  /** Metres, shown as km once the number gets long — the way EVE reads them. */
  function asDistance(value: number): string {
    return value >= 1000 ? `${toFixed(value / 1000, 1)} km` : `${whole(value)} m`;
  }

  function asSeconds(value: number): string {
    return `${toFixed(value, 2)} s`;
  }

  function asVolume(value: number): string {
    return `${toFixed(value, 1)} m³`;
  }

  const layerLabels: Readonly<Record<LayerName, string>> = {
    shield: "Shield",
    armor: "Armor",
    hull: "Structure",
  };

  const stats = $derived.by(() => $fitting.stats);

  /** The resistance grid: one row per layer, four damage types across. */
  const defenceRows = $derived.by(() =>
    LAYERS.map((layer) => ({
      layer,
      label: layerLabels[layer],
      tank: stats.tank[layer],
    })),
  );

  const damageProfileText = $derived.by(() => {
    const profile = stats.damageProfile;
    const parts = [profile.em, profile.thermal, profile.kinetic, profile.explosive].map((share) =>
      Math.round(share * 100),
    );
    return parts.join("/");
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

  async function refresh(): Promise<void> {
    // The hangar / cargo rows feed the "what can I fit" list, so the fitting
    // panel refreshes both reads together.
    await flow.loadInventory();
    await flow.loadFitting();
  }

  function fitInto(slot: FittingSlot): void {
    const itemID = pickedItemID;
    if (itemID === null) {
      return;
    }
    const source = pickedSource;
    void run(async () => {
      await flow.fitModule(itemID, source, { family: slot.family, index: slot.index });
      pickedItemID = null;
      await flow.loadInventory();
    });
  }

  function fitAnywhere(): void {
    const itemID = pickedItemID;
    if (itemID === null) {
      return;
    }
    const source = pickedSource;
    void run(async () => {
      await flow.fitModule(itemID, source, "auto");
      pickedItemID = null;
      await flow.loadInventory();
    });
  }

  function pick(itemID: number, source: "hangar" | "cargo"): void {
    pickedItemID = pickedItemID === itemID ? null : itemID;
    pickedSource = source;
  }

  function unfit(itemID: number): void {
    void run(async () => {
      await flow.unfitModule(itemID, "hangar");
      selected = null;
      await flow.loadInventory();
    });
  }

  function toggleOnline(itemID: number, online: boolean): void {
    void run(() => flow.setModuleOnline(itemID, online));
  }

  function destroyRig(itemID: number): void {
    confirmingRigID = null;
    void run(async () => {
      await flow.destroyRig(itemID);
      selected = null;
      await flow.loadInventory();
    });
  }

  onMount(() => {
    // The remembered choice wins; with none, the viewport decides. This is the
    // R8 contract — list on a phone, radial above the breakpoint — but the
    // player can always override it, in either direction.
    let remembered: string | null = null;
    try {
      remembered = globalThis.localStorage?.getItem(VIEW_STORAGE_KEY) ?? null;
    } catch {
      remembered = null;
    }
    if (remembered === "radial" || remembered === "list") {
      view = remembered;
    } else if (globalThis.matchMedia?.("(max-width: 640px)").matches) {
      view = "list";
    }
    void run(refresh);
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h2>
      Fitting
      <small class="note">
        {activeShipName}{activeShipClass ? ` · ${activeShipClass}` : ""}
      </small>
    </h2>
    <p class="controls">
      <span class="fit-views">
        <button
          type="button"
          class={view === "radial" ? "active" : "minor"}
          aria-pressed={view === "radial"}
          onclick={() => chooseView("radial")}
        >
          Ship view
        </button>
        <button
          type="button"
          class={view === "list" ? "active" : "minor"}
          aria-pressed={view === "list"}
          onclick={() => chooseView("list")}
        >
          List view
        </button>
      </span>
      <button type="button" class="primary" disabled={busy} onclick={() => run(refresh)}>
        Refresh
      </button>
    </p>
  </header>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $fitting.actionError}
    <p class="error">Last change failed: {$fitting.actionError}</p>
  {/if}
  {#if $fitting.resourcesError}
    <p class="error">The ship's readings could not be loaded: {$fitting.resourcesError}</p>
  {/if}
  {#if !$fitting.activeShipID}
    <p class="note">
      No active ship — board a ship on the Inventory &amp; Ship page to fit it.
    </p>
  {/if}
</section>

{#if $fitting.activeShipID}
  <section>
    <h2>Ship resources</h2>
    <div class="hud">
      {#each gauges as gauge (gauge.key)}
        <div class="hud-gauge {gauge.key}">
          <div class="hud-head">
            <span class="hud-label">{gauge.label}</span>
            <span class="hud-value">{gauge.text}</span>
          </div>
          <div
            class="hud-track"
            role="meter"
            aria-label={gauge.label}
            aria-valuenow={gauge.pct ?? 0}
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span class="hud-fill" style={`width: ${gauge.pct ?? 0}%`}></span>
          </div>
        </div>
      {/each}
    </div>
  </section>

  {#if $fitting.slotsError}
    <section>
      <p class="error">The ship's slots could not be loaded: {$fitting.slotsError}</p>
    </section>
  {/if}

  <!-- ===================== the fit, as a ring or as a list ================ -->
  {#if view === "radial"}
    <section>
      <h2>Your fit</h2>
      <p class="note">
        {#if pickedItemID}
          Choose an empty slot to fit {pickedName} there.
        {:else}
          Choose a slot to see what is in it and what you can do with it.
        {/if}
      </p>

      <div class="fit-ring-wrap overflow-x-auto">
      <div class="fit-ring">
        <div class="fit-ring-guide" aria-hidden="true"></div>
        <div class="fit-hull">
          <TypeIcon typeID={activeShipTypeID} name={activeShipName} size="lg" />
          <span class="fit-hull-name">{activeShipName}</span>
          {#if activeShipClass}
            <span class="fit-hull-class">{activeShipClass}</span>
          {/if}
        </div>

        {#each sockets as socket (`${socket.slot.family}:${socket.slot.index}`)}
          {@const slot = socket.slot}
          <button
            type="button"
            class="fit-socket family-{slot.family}"
            class:empty={slot.module === null}
            class:offline={slot.module !== null &&
              !slot.module.online &&
              slot.family !== "rig" &&
              slot.family !== "subsystem"}
            class:armed={isSelected(slot)}
            style={`left: ${socket.xPercent}%; top: ${socket.yPercent}%`}
            title={socketDescription(slot)}
            aria-label={socketDescription(slot)}
            aria-pressed={isSelected(slot)}
            disabled={busy}
            onclick={() => clickSocket(slot)}
          >
            {#if slot.module}
              {@const moduleLabel = moduleName(slot.module.typeID)}
              <TypeIcon
                typeID={slot.module.typeID}
                name={moduleLabel}
                size="socket"
                fallbackText={abbreviate(moduleLabel)}
              />
            {:else}
              <span class="fit-socket-text">{socketText(slot)}</span>
            {/if}
          </button>
        {/each}
      </div>
      </div>

      <!-- The family key. Each arc's rim colour is repeated here WITH its name
           and counts, so the colour is reinforcement and never the only signal. -->
      <ul class="fit-legend">
        {#each legend as entry (entry.family)}
          <li>
            <span class="badge">{entry.label}: {entry.filled} of {entry.total} filled</span>
          </li>
        {/each}
      </ul>

      {#if selectedSlot}
        <div class="fit-detail">
          <div class="fit-detail-head">
            <span class="fit-detail-slot">{slotName(selectedSlot)}</span>
            <span class="fit-detail-name">
              {selectedSlot.module ? moduleName(selectedSlot.module.typeID) : "Empty"}
            </span>
            {#if selectedSlot.module && selectedSlot.family !== "rig" && selectedSlot.family !== "subsystem"}
              <span class="badge {selectedSlot.module.online ? 'good' : 'warn'}">
                {selectedSlot.module.online ? "Online" : "Offline"}
              </span>
            {/if}
          </div>
          <div class="row-actions">
            {#if !selectedSlot.module}
              <button
                type="button"
                disabled={busy || pickedItemID === null}
                onclick={() => fitInto(selectedSlot!)}
              >
                Fit here
              </button>
              {#if pickedItemID === null}
                <span class="note">Pick a module below first.</span>
              {/if}
            {:else if selectedSlot.family === "rig"}
              {#if confirmingRigID === selectedSlot.module.itemID}
                <button
                  type="button"
                  class="danger"
                  disabled={busy}
                  onclick={() => destroyRig(selectedSlot!.module!.itemID)}
                >
                  Yes, destroy it
                </button>
                <button
                  type="button"
                  class="minor"
                  disabled={busy}
                  onclick={() => (confirmingRigID = null)}
                >
                  Keep it
                </button>
              {:else}
                <button
                  type="button"
                  class="minor"
                  disabled={busy}
                  onclick={() => (confirmingRigID = selectedSlot!.module!.itemID)}
                >
                  Destroy rig…
                </button>
              {/if}
            {:else if selectedSlot.family === "subsystem"}
              <span class="note">Subsystems stay fitted.</span>
            {:else}
              <button
                type="button"
                disabled={busy}
                onclick={() =>
                  toggleOnline(selectedSlot!.module!.itemID, !selectedSlot!.module!.online)}
              >
                {selectedSlot.module.online ? "Take offline" : "Bring online"}
              </button>
              <button
                type="button"
                class="minor"
                disabled={busy}
                onclick={() => unfit(selectedSlot!.module!.itemID)}
              >
                Unfit
              </button>
            {/if}
          </div>
          {#if selectedSlot.family === "rig" && confirmingRigID !== null}
            <p class="error">
              Destroying a rig is permanent — it is not returned to your hangar.
            </p>
          {/if}
        </div>
      {/if}
    </section>
  {:else}
    {#each SLOT_FAMILY_ORDER as family (family)}
      {@const slots = slotsOfFamily($fitting.slots, family as SlotFamily)}
      {#if slots.length > 0}
        <section>
          <h2>{SLOT_FAMILY_LABELS[family as SlotFamily]}</h2>
          {#if family === "rig"}
            <p class="note">
              Rigs cannot be taken off a ship. Removing one destroys it for good.
            </p>
          {/if}
          <div class="table-wrap overflow-x-auto">
            <table class="guests reflow">
              <thead>
                <tr><th>Slot</th><th>Fitted</th><th>State</th><th>Action</th></tr>
              </thead>
              <tbody>
                {#each slots as slot (`${slot.family}:${slot.index}`)}
                  <tr>
                    <td data-label="Slot">{slotName(slot)}</td>
                    <td data-label="Fitted">
                      {slot.module ? moduleName(slot.module.typeID) : "Empty"}
                    </td>
                    <td data-label="State">
                      {#if !slot.module}
                        <span class="note">—</span>
                      {:else if family === "rig" || family === "subsystem"}
                        <span class="note">Always on</span>
                      {:else}
                        {slot.module.online ? "Online" : "Offline"}
                      {/if}
                    </td>
                    <td data-label="Action">
                      <div class="row-actions">
                        {#if !slot.module}
                          <button
                            type="button"
                            disabled={busy || pickedItemID === null}
                            onclick={() => fitInto(slot)}
                          >
                            Fit here
                          </button>
                        {:else if family === "rig"}
                          {#if confirmingRigID === slot.module.itemID}
                            <button
                              type="button"
                              class="danger"
                              disabled={busy}
                              onclick={() => destroyRig(slot.module!.itemID)}
                            >
                              Yes, destroy it
                            </button>
                            <button
                              type="button"
                              class="minor"
                              disabled={busy}
                              onclick={() => (confirmingRigID = null)}
                            >
                              Keep it
                            </button>
                          {:else}
                            <button
                              type="button"
                              class="minor"
                              disabled={busy}
                              onclick={() => (confirmingRigID = slot.module!.itemID)}
                            >
                              Destroy rig…
                            </button>
                          {/if}
                        {:else if family === "subsystem"}
                          <span class="note">Subsystems stay fitted</span>
                        {:else}
                          <button
                            type="button"
                            disabled={busy}
                            onclick={() => toggleOnline(slot.module!.itemID, !slot.module!.online)}
                          >
                            {slot.module.online ? "Take offline" : "Bring online"}
                          </button>
                          <button
                            type="button"
                            class="minor"
                            disabled={busy}
                            onclick={() => unfit(slot.module!.itemID)}
                          >
                            Unfit
                          </button>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if family === "rig" && confirmingRigID !== null && slots.some((s) => s.module?.itemID === confirmingRigID)}
            <p class="error">
              Destroying a rig is permanent — it is not returned to your hangar.
            </p>
          {/if}
        </section>
      {/if}
    {/each}
  {/if}

  <!-- ============================ the statistic panels ==================== -->
  <!--
    Everything below is derived from the SAME `ShipGetInfo` attribute map the
    resource bars read — no extra call, and nothing re-simulated in the
    browser. Anything we could not honestly source says so in words.
  -->

  {#snippet statValue(stat: Stat, format: (value: number) => string)}
    {#if stat.known}
      {format(stat.value)}
    {:else}
      <span class="stat-unavailable" title={stat.why}>Unavailable</span>
    {/if}
  {/snippet}

  {#snippet statRow(label: string, stat: Stat, format: (value: number) => string)}
    <tr>
      <th scope="row">{label}</th>
      <td class="num">{@render statValue(stat, format)}</td>
    </tr>
  {/snippet}

  <section>
    <h2>Defence</h2>
    <p class="note">
      Effective hit points are worked out against an even {damageProfileText} spread
      of the four damage types.
    </p>
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead>
          <tr>
            <th>Layer</th>
            <th class="num">EM</th>
            <th class="num">Thermal</th>
            <th class="num">Kinetic</th>
            <th class="num">Explosive</th>
            <th class="num">Hit points</th>
            <th class="num">Effective HP</th>
          </tr>
        </thead>
        <tbody>
          {#each defenceRows as row (row.layer)}
            <tr>
              <td data-label="Layer"><span class="layer-{row.layer}">{row.label}</span></td>
              <td class="num" data-label="EM">
                {@render statValue(row.tank.resistances.em, asPercent)}
              </td>
              <td class="num" data-label="Thermal">
                {@render statValue(row.tank.resistances.thermal, asPercent)}
              </td>
              <td class="num" data-label="Kinetic">
                {@render statValue(row.tank.resistances.kinetic, asPercent)}
              </td>
              <td class="num" data-label="Explosive">
                {@render statValue(row.tank.resistances.explosive, asPercent)}
              </td>
              <td class="num" data-label="Hit points">
                {@render statValue(row.tank.hp, whole)}
              </td>
              <td class="num" data-label="Effective HP">
                {@render statValue(row.tank.ehp, whole)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="hud">
      {#each defenceRows as row (row.layer)}
        <div class="hud-gauge {row.layer === 'hull' ? 'hull' : row.layer}">
          <div class="hud-head">
            <span class="hud-label">{row.label} effective HP</span>
            <span class="hud-value">{@render statValue(row.tank.ehp, whole)}</span>
          </div>
        </div>
      {/each}
      <div class="hud-gauge">
        <div class="hud-head">
          <span class="hud-label">Total effective HP</span>
          <span class="hud-value">{@render statValue(stats.totalEhp, whole)}</span>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>Firepower</h2>
    <div class="table-wrap overflow-x-auto">
      <table class="guests">
        <tbody>
          {@render statRow("Damage per second", stats.firepower.dps, whole)}
          {@render statRow("Volley damage", stats.firepower.volley, whole)}
          {@render statRow("Drone damage per second", stats.firepower.droneDps, whole)}
          {@render statRow("Mining yield", stats.mining.cubicMetresPerSecond, asVolume)}
        </tbody>
      </table>
    </div>
    <p class="note">
      Your ship tells us about itself, but not yet about each module you have
      fitted — so anything that has to be added up across your guns, launchers,
      drones or miners cannot be worked out here yet.
    </p>
  </section>

  <section>
    <h2>Capacitor</h2>
    <div class="table-wrap overflow-x-auto">
      <table class="guests">
        <tbody>
          {@render statRow("Capacity", stats.capacitor.capacity, (v) => `${whole(v)} GJ`)}
          {@render statRow("Recharge time", stats.capacitor.rechargeSeconds, asSeconds)}
          {@render statRow("Net change per second", stats.capacitor.deltaPerSecond, (v) => whole(v))}
          {@render statRow("Lasts for", stats.capacitor.lastsForSeconds, asSeconds)}
        </tbody>
      </table>
    </div>
    <p class="note">
      Whether a fit runs its capacitor dry is not something we can work out yet,
      so it is not shown rather than guessed.
    </p>
  </section>

  <section>
    <h2>Repairs</h2>
    <div class="table-wrap overflow-x-auto">
      <table class="guests">
        <tbody>
          {@render statRow("Shield repaired per second", stats.repairs.shield, whole)}
          {@render statRow("Armor repaired per second", stats.repairs.armor, whole)}
          {@render statRow("Structure repaired per second", stats.repairs.hull, whole)}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Navigation</h2>
    <div class="table-wrap overflow-x-auto">
      <table class="guests">
        <tbody>
          {@render statRow("Top speed", stats.navigation.maxVelocity, (v) => `${toFixed(v, 1)} m/s`)}
          {@render statRow("Time to align", stats.navigation.alignTimeSeconds, asSeconds)}
          {@render statRow(
            "Warp speed",
            stats.navigation.warpSpeedAuPerSecond,
            (v) => `${toFixed(v, 2)} AU/s`,
          )}
          {@render statRow(
            "Signature radius",
            stats.navigation.signatureRadius,
            (v) => `${whole(v)} m`,
          )}
          {@render statRow("Mass", stats.navigation.mass, (v) => `${whole(v)} kg`)}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Targeting</h2>
    <div class="table-wrap overflow-x-auto">
      <table class="guests">
        <tbody>
          {@render statRow("Targeting range", stats.targeting.maxTargetRange, asDistance)}
          {@render statRow("Targets at once", stats.targeting.maxLockedTargets, whole)}
          {@render statRow(
            "Scan resolution",
            stats.targeting.scanResolution,
            (v) => `${toFixed(v, 1)} mm`,
          )}
          {@render statRow(
            stats.targeting.sensorName
              ? `${stats.targeting.sensorName} sensor strength`
              : "Sensor strength",
            stats.targeting.sensorStrength,
            (v) => toFixed(v, 1),
          )}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Bays</h2>
    <div class="table-wrap overflow-x-auto">
      <table class="guests">
        <tbody>
          {@render statRow("Cargo space", stats.bays.cargoCapacity, asVolume)}
          {@render statRow("Drone bay", stats.bays.droneCapacity, asVolume)}
          {@render statRow(
            "Drone bandwidth",
            stats.bays.droneBandwidth,
            (v) => `${toFixed(v, 0)} Mbit/s`,
          )}
          {@render statRow("Drone control range", stats.bays.droneControlRange, asDistance)}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>
      Modules you can fit
      {#if pickedName}
        <small class="note">holding {pickedName}</small>
      {/if}
    </h2>
    {#if pickedItemID !== null}
      <p class="controls">
        <button type="button" disabled={busy} onclick={fitAnywhere}>
          Fit {pickedName} in the first free slot
        </button>
        <button type="button" class="minor" disabled={busy} onclick={() => (pickedItemID = null)}>
          Put it back down
        </button>
      </p>
    {:else}
      <p class="note">Pick a module below, then choose an empty slot to put it in.</p>
    {/if}
    {#if fittable.length === 0}
      <p class="note">
        {$inventory.loaded
          ? "No modules in your hangar or cargo hold to fit."
          : "Loading your hangar…"}
      </p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr><th>Module</th><th>Where it is</th><th>Action</th></tr>
          </thead>
          <tbody>
            {#each fittable as entry (entry.row.itemID)}
              <tr class={entry.row.itemID === pickedItemID ? "self" : ""}>
                <td data-label="Module">{moduleName(entry.row.typeID)}</td>
                <td data-label="Where it is">
                  {entry.source === "hangar" ? "Station hangar" : "Cargo hold"}
                </td>
                <td data-label="Action">
                  <button
                    type="button"
                    disabled={busy}
                    onclick={() => pick(entry.row.itemID, entry.source)}
                  >
                    {entry.row.itemID === pickedItemID ? "Put down" : "Pick up"}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}
