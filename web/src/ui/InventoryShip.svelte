<script lang="ts">
  // Inventory & Ship page (goal R3): the docked station hangar and the active
  // ship's cargo, driven through the bound-object bridge. A pure reader of the
  // store's inventory slice; all bind/List/Add/StackAll/Board logic lives on
  // the BFF (which holds the bound-object handles) and in app/flow.ts. The
  // browser addresses items and ships by their game IDs only.
  import { onMount } from "svelte";
  import { isBoardableShip } from "../bridge/inventoryShip.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { InventoryItemRow } from "../store/types.ts";
  import { resolvedName, nameKey, type NameRef } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  let moveQty = $state("");

  // R7c — resolve every row's typeID → type name and categoryID → category name
  // (batched + cached by the flow's name cache). Fire-and-forget in an effect so
  // the rows render immediately (raw IDs) and swap to names as they arrive.
  $effect(() => {
    const refs: NameRef[] = [];
    for (const row of [...$inventory.hangar.rows, ...$inventory.cargo.rows]) {
      refs.push({ kind: "type", id: row.typeID });
      if (row.categoryID) {
        refs.push({ kind: "category", id: row.categoryID });
      }
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // The active ship's typeID (it sits in the hangar/cargo rows as the row whose
  // itemID is the active ship), so its header can show the SHIP TYPE name.
  const activeShipTypeID = $derived.by<number | null>(() => {
    const id = $inventory.activeShipID;
    if (id === null) {
      return null;
    }
    const row =
      $inventory.hangar.rows.find((r) => r.itemID === id) ??
      $inventory.cargo.rows.find((r) => r.itemID === id);
    return row ? row.typeID : null;
  });

  function activeShipHeader(): string {
    if ($inventory.activeShipID === null) {
      return "—";
    }
    // Ship TYPE name only (e.g. "Algos"); the raw item ID is never rendered
    // (it stays internal for the move/board onclick args).
    const typeName = activeShipTypeID !== null ? $names.resolved[nameKey("type", activeShipTypeID)] : null;
    return typeName ?? "active ship";
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

  function qtyArg(): number | null {
    const parsed = Number(moveQty);
    return moveQty.trim() !== "" && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function isShip(row: InventoryItemRow): boolean {
    return row.categoryID === 6;
  }

  onMount(() => {
    void run(() => flow.loadInventory());
  });

  function capacityText(capacity: { capacity: number; used: number } | null): string {
    if (!capacity) {
      return "—";
    }
    return `${capacity.used.toFixed(2)} / ${capacity.capacity.toFixed(2)} m³`;
  }
</script>

<section>
  <h2>Inventory &amp; Ship</h2>
  <p class="note">
    Bound-object bridge: the station hangar and active-ship cargo are bound
    with invbroker (GetInventory / GetInventoryFromId); List / Add / StackAll /
    Board dispatch on those handles. The browser never sees a handle — it moves
    items and boards ships by their game IDs.
  </p>
  <p>
    <label>
      Move quantity (blank = whole stack):
      <input type="number" min="1" bind:value={moveQty} disabled={busy} style="width: 8em" />
    </label>
    <button type="button" disabled={busy} onclick={() => run(() => flow.loadInventory())}>
      Refresh
    </button>
  </p>
  {#if $inventory.actionError}
    <p class="error">Last action failed: {$inventory.actionError}</p>
  {/if}
  {#if error}
    <p class="error">{error}</p>
  {/if}
</section>

<section>
  <h2>
    Station hangar
    <small class="note">capacity {capacityText($inventory.hangar.capacity)}</small>
  </h2>
  <p>
    <button type="button" class="minor" disabled={busy} onclick={() => run(() => flow.stackContainer("hangar"))}>
      Stack all (hangar)
    </button>
  </p>
  {#if $inventory.hangar.error}
    <p class="error">Hangar read failed: {$inventory.hangar.error}</p>
  {/if}
  {#if $inventory.hangar.rows.length === 0}
    <p class="note">{$inventory.loaded ? "Hangar is empty." : "Loading hangar…"}</p>
  {:else}
    <table class="guests">
      <thead>
        <tr><th>Type</th><th>Cat</th><th>Qty</th><th>Action</th></tr>
      </thead>
      <tbody>
        {#each $inventory.hangar.rows as row (row.itemID)}
          <tr class={row.itemID === $inventory.activeShipID ? "self" : ""}>
            <td>{resolvedName($names.resolved, "type", row.typeID)}</td>
            <td>{resolvedName($names.resolved, "category", row.categoryID)}</td>
            <td>{row.singleton ? "(assembled)" : row.quantity}</td>
            <td>
              {#if isShip(row)}
                {#if isBoardableShip(row, $inventory.activeShipID)}
                  <button type="button" disabled={busy} onclick={() => run(() => flow.boardShip(row.itemID))}>
                    Board
                  </button>
                {:else}
                  <span class="note">active ship</span>
                {/if}
              {:else}
                <button type="button" disabled={busy} onclick={() => run(() => flow.moveItem(row.itemID, "toCargo", qtyArg()))}>
                  → Cargo
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<section>
  <h2>
    Active ship cargo
    <small class="note">
      {activeShipHeader()} · capacity {capacityText($inventory.cargo.capacity)}
    </small>
  </h2>
  <p>
    <button type="button" class="minor" disabled={busy || !$inventory.activeShipID} onclick={() => run(() => flow.stackContainer("cargo"))}>
      Stack all (cargo)
    </button>
  </p>
  {#if $inventory.cargo.error}
    <p class="error">Cargo read failed: {$inventory.cargo.error}</p>
  {/if}
  {#if !$inventory.activeShipID}
    <p class="note">No active ship — board a ship in the hangar to see its cargo.</p>
  {:else if $inventory.cargo.rows.length === 0}
    <p class="note">{$inventory.loaded ? "Cargo hold is empty." : "Loading cargo…"}</p>
  {:else}
    <table class="guests">
      <thead>
        <tr><th>Type</th><th>Cat</th><th>Qty</th><th>Action</th></tr>
      </thead>
      <tbody>
        {#each $inventory.cargo.rows as row (row.itemID)}
          <tr>
            <td>{resolvedName($names.resolved, "type", row.typeID)}</td>
            <td>{resolvedName($names.resolved, "category", row.categoryID)}</td>
            <td>{row.singleton ? "(assembled)" : row.quantity}</td>
            <td>
              <button type="button" disabled={busy} onclick={() => run(() => flow.moveItem(row.itemID, "toHangar", qtyArg()))}>
                → Hangar
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
