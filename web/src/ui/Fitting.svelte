<script lang="ts">
  // Fitting page (goal R12): the active ship's slots grouped by family with
  // what is fitted in each BY NAME, its CPU / powergrid / capacitor /
  // calibration readings, and the fit / unfit / online / offline actions.
  //
  // A pure reader of the store's fitting + inventory slices. All bind /
  // ListByFlags / Add / SetModuleOnline logic lives on the BFF (which holds the
  // bound-object handles) and in app/flow.ts. Slots are addressed by FAMILY and
  // INDEX — no slot flagID, typeID or itemID is ever rendered.
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

  // R7c — resolve every fitted module's typeID and every fittable inventory
  // row's typeID to a display NAME. Fire-and-forget so the panel renders
  // immediately and swaps in names as they arrive.
  $effect(() => {
    const refs: NameRef[] = [];
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

  const activeShipName = $derived.by<string>(() => {
    const shipID = $fitting.activeShipID;
    if (shipID === null) {
      return "your ship";
    }
    const row =
      $inventory.hangar.rows.find((entry) => entry.itemID === shipID) ??
      $inventory.cargo.rows.find((entry) => entry.itemID === shipID);
    const typeName = row ? $names.resolved[nameKey("type", row.typeID)] : null;
    return typeName ?? "your ship";
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
      await flow.loadInventory();
    });
  }

  onMount(() => {
    void run(refresh);
  });
</script>

<section>
  <h2>
    Fitting
    <small class="note">{activeShipName()}</small>
  </h2>
  <p class="controls">
    <button type="button" disabled={busy} onclick={() => run(refresh)}>Refresh</button>
  </p>
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

  {#if $fitting.slotsError}
    <section>
      <p class="error">The ship's slots could not be loaded: {$fitting.slotsError}</p>
    </section>
  {/if}

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
