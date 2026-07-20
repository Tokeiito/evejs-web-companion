<script lang="ts">
  // Inventory & Ship page (goals R3 + R14): the docked station hangar, the
  // active ship's cargo, any container the player has opened, and the
  // corporation hangar's divisions — all driven through the bound-object
  // bridge. A pure reader of the store's inventory slice; every bind / List /
  // Add / MultiAdd / MultiMerge / TrashItems call lives on the BFF (which holds
  // the bound-object handles) and in app/flow.ts.
  //
  // The browser addresses items by their game IDs and places by NAME — a
  // container by which container, a corporation division by its name. Retail
  // flag numbers (4 hangar, 5 cargo, 0 container contents, 115-121 divisions)
  // never reach this file.
  import { onMount } from "svelte";
  import {
    canMergeStacks,
    divisionLabel,
    isBoardableShip,
    isOpenableContainer,
  } from "../bridge/inventoryShip.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { InventoryItemRow, InventoryPlace } from "../store/types.ts";
  import { resolvedName, nameKey, type NameRef } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const inventory = store.inventory;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  let moveQty = $state("");
  // Which place the current tick-selection was made in. A selection only ever
  // means something inside one place, so ticking a row somewhere else starts a
  // fresh selection rather than mixing two.
  let selectionPlace = $state<InventoryPlace | null>(null);
  // The two-step confirm in front of the destroy. Trashing is irreversible, so
  // the first press only arms it; the BFF then demands its own explicit
  // confirmation flag behind that.
  let trashArmed = $state(false);

  // R7c — resolve every row's typeID -> type name and categoryID -> category
  // name (batched + cached by the flow's name cache). Fire-and-forget in an
  // effect so rows render immediately and swap to names as they arrive.
  $effect(() => {
    const refs: NameRef[] = [];
    const everyRow = [
      ...$inventory.hangar.rows,
      ...$inventory.cargo.rows,
      ...($inventory.container ? $inventory.container.rows : []),
      ...$inventory.corp.divisions.flatMap((division) => division.rows),
    ];
    for (const row of everyRow) {
      refs.push({ kind: "type", id: row.typeID });
      if (row.categoryID) {
        refs.push({ kind: "category", id: row.categoryID });
      }
    }
    if ($inventory.container) {
      refs.push({ kind: "type", id: $inventory.container.typeID });
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
    // Ship TYPE name only (e.g. "Algos"); the raw item ID is never rendered.
    const typeName =
      activeShipTypeID !== null ? $names.resolved[nameKey("type", activeShipTypeID)] : null;
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
    void run(async () => {
      await flow.loadInventory();
      await flow.loadCorpHangar();
    });
  });

  function capacityText(capacity: { capacity: number; used: number } | null): string {
    if (!capacity) {
      return "—";
    }
    return `${capacity.used.toFixed(2)} / ${capacity.capacity.toFixed(2)} m³`;
  }

  // --- selection ------------------------------------------------------------

  function samePlace(left: InventoryPlace | null, right: InventoryPlace): boolean {
    if (!left || left.kind !== right.kind) {
      return false;
    }
    if (left.kind === "container" && right.kind === "container") {
      return left.itemID === right.itemID;
    }
    if (left.kind === "corp" && right.kind === "corp") {
      return left.division === right.division;
    }
    return true;
  }

  function toggle(row: InventoryItemRow, place: InventoryPlace): void {
    if (!samePlace(selectionPlace, place)) {
      // Ticking in a new place starts over — a tick made in the hangar must
      // never be applied to a corporation division.
      flow.clearSelection();
      selectionPlace = place;
      flow.toggleSelection(row.itemID);
      trashArmed = false;
      return;
    }
    flow.toggleSelection(row.itemID);
    trashArmed = false;
  }

  const selection = $derived($inventory.selection);
  const selectedCount = $derived(selection.length);

  // Every row currently ticked, resolved back to its row so the bulk bar can
  // reason about types (for the merge offer).
  const selectedRows = $derived.by<InventoryItemRow[]>(() => {
    const place = selectionPlace;
    if (!place) {
      return [];
    }
    return rowsOf(place).filter((row) => selection.includes(row.itemID));
  });

  function rowsOf(place: InventoryPlace): readonly InventoryItemRow[] {
    if (place.kind === "hangar") {
      return $inventory.hangar.rows;
    }
    if (place.kind === "cargo") {
      return $inventory.cargo.rows;
    }
    if (place.kind === "container") {
      return $inventory.container && $inventory.container.itemID === place.itemID
        ? $inventory.container.rows
        : [];
    }
    const division = $inventory.corp.divisions.find((entry) => entry.division === place.division);
    return division ? division.rows : [];
  }

  // Exactly two same-type loose stacks in one place can be re-merged.
  const mergeable = $derived.by<boolean>(
    () =>
      selectedRows.length === 2 && canMergeStacks(selectedRows[0]!, selectedRows[1]!),
  );

  function placeName(place: InventoryPlace | null): string {
    if (!place) {
      return "";
    }
    if (place.kind === "hangar") {
      return "Station hangar";
    }
    if (place.kind === "cargo") {
      return "Ship cargo";
    }
    if (place.kind === "container") {
      return containerName();
    }
    const division = $inventory.corp.divisions.find((entry) => entry.division === place.division);
    return `Corporation hangar — ${divisionLabel(place.division, division ? division.name : null)}`;
  }

  function containerName(): string {
    const container = $inventory.container;
    if (!container) {
      return "Container";
    }
    return resolvedName($names.resolved, "type", container.typeID) || "Container";
  }

  // --- bulk destinations ----------------------------------------------------

  // Where a selection may be sent. The current place is excluded (moving items
  // to where they already are is a no-op), and the corporation divisions only
  // appear when the corporation actually has an office here.
  const destinations = $derived.by<{ label: string; place: InventoryPlace }[]>(() => {
    const options: { label: string; place: InventoryPlace }[] = [];
    const current = selectionPlace;
    if (!samePlace(current, { kind: "hangar" })) {
      options.push({ label: "Station hangar", place: { kind: "hangar" } });
    }
    if ($inventory.activeShipID && !samePlace(current, { kind: "cargo" })) {
      options.push({ label: "Ship cargo", place: { kind: "cargo" } });
    }
    const container = $inventory.container;
    if (container && !samePlace(current, { kind: "container", itemID: container.itemID })) {
      options.push({
        label: containerName(),
        place: { kind: "container", itemID: container.itemID },
      });
    }
    if ($inventory.corp.available) {
      for (const division of $inventory.corp.divisions) {
        if (samePlace(current, { kind: "corp", division: division.division })) {
          continue;
        }
        options.push({
          label: divisionLabel(division.division, division.name),
          place: { kind: "corp", division: division.division },
        });
      }
    }
    return options;
  });

  async function moveSelectionTo(destination: InventoryPlace): Promise<void> {
    const from = selectionPlace;
    if (!from || selection.length === 0) {
      return;
    }
    const qty = selection.length === 1 ? qtyArg() : null;
    await run(async () => {
      await flow.transferItems([...selection], from, destination, qty);
      selectionPlace = null;
    });
  }

  async function mergeSelection(): Promise<void> {
    const place = selectionPlace;
    if (!place || selectedRows.length !== 2) {
      return;
    }
    // Merge the SMALLER stack into the larger one, which is what dragging one
    // onto the other does in practice.
    const [first, second] = selectedRows;
    const source = first!.quantity <= second!.quantity ? first! : second!;
    const destination = source === first! ? second! : first!;
    await run(async () => {
      await flow.mergeStacks(source.itemID, destination.itemID, place);
      selectionPlace = null;
    });
  }

  async function trashSelection(): Promise<void> {
    const place = selectionPlace;
    if (!place || selection.length === 0) {
      return;
    }
    await run(async () => {
      await flow.trashItems([...selection], place);
      selectionPlace = null;
      trashArmed = false;
    });
  }

  // --- corporation hangar ---------------------------------------------------

  const selectedDivision = $derived(
    $inventory.corp.divisions.find(
      (entry) => entry.division === $inventory.corp.selectedDivision,
    ) ?? null,
  );

  /**
   * Whether the character can see anything in a division. The server filters a
   * division the character lacks the role for down to nothing, so an empty
   * read is indistinguishable here from a genuinely empty division — which is
   * why this only ever DIMS the label and never gates the action. If the player
   * tries anyway, the server's own refusal is what they are shown.
   */
  function divisionLooksAccessible(division: { rows: readonly InventoryItemRow[] }): boolean {
    return division.rows.length > 0;
  }
</script>

<section class="panel">
  <header class="panel-head">
    <h2>Inventory &amp; Ship</h2>
    <p class="controls">
      <label>
        Move quantity (blank = whole stack):
        <input type="number" min="1" bind:value={moveQty} disabled={busy} />
      </label>
      <button
        type="button"
        class="primary"
        disabled={busy}
        onclick={() =>
          run(async () => {
            await flow.loadInventory();
            await flow.loadCorpHangar();
          })}
      >
        Refresh
      </button>
    </p>
  </header>
  {#if $inventory.lastOutcome}
    <!-- What the server actually did, re-read after the call — not an echo of
         the request. A refusal with no reason says so plainly. -->
    <p class={$inventory.lastOutcome.applied ? "note" : "error"}>
      {$inventory.lastOutcome.message}
    </p>
  {/if}
  {#if $inventory.actionError}
    <p class="error">Last action failed: {$inventory.actionError}</p>
  {/if}
  {#if error}
    <p class="error">{error}</p>
  {/if}
</section>

{#if selectedCount > 0 && selectionPlace}
  <section class="bulk">
    <h2>{selectedCount} selected in {placeName(selectionPlace)}</h2>
    <p class="row-actions">
      {#each destinations as destination (destination.label)}
        <button type="button" disabled={busy} onclick={() => moveSelectionTo(destination.place)}>
          Move to {destination.label}
        </button>
      {/each}
      {#if mergeable}
        <button type="button" class="minor" disabled={busy} onclick={() => mergeSelection()}>
          Merge the two stacks
        </button>
      {/if}
      <button
        type="button"
        class="minor"
        disabled={busy}
        onclick={() => {
          flow.clearSelection();
          selectionPlace = null;
          trashArmed = false;
        }}
      >
        Clear selection
      </button>
    </p>
    <p class="row-actions">
      <!-- Two-step destroy: the first press only arms it. -->
      {#if trashArmed}
        <button type="button" class="danger" disabled={busy} onclick={() => trashSelection()}>
          Destroy {selectedCount} permanently — confirm
        </button>
        <button type="button" class="minor" disabled={busy} onclick={() => (trashArmed = false)}>
          Cancel
        </button>
      {:else}
        <button type="button" class="minor" disabled={busy} onclick={() => (trashArmed = true)}>
          Trash…
        </button>
      {/if}
    </p>
    {#if trashArmed}
      <p class="error">
        Trashing destroys these items permanently. There is no way to get them back.
      </p>
    {/if}
  </section>
{/if}

<section>
  <h2>
    Station hangar
    <small class="note">capacity {capacityText($inventory.hangar.capacity)}</small>
  </h2>
  <p>
    <button
      type="button"
      class="minor"
      disabled={busy}
      onclick={() => run(() => flow.stackContainer("hangar"))}
    >
      Stack all (hangar)
    </button>
  </p>
  {#if $inventory.hangar.error}
    <p class="error">The hangar could not be loaded: {$inventory.hangar.error}</p>
  {/if}
  {#if $inventory.hangar.rows.length === 0}
    <p class="empty">{$inventory.loaded ? "Hangar is empty." : "Loading hangar…"}</p>
  {:else}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead>
          <tr><th>Select</th><th>Type</th><th>Cat</th><th class="num">Qty</th><th>Action</th></tr>
        </thead>
        <tbody>
          {#each $inventory.hangar.rows as row (row.itemID)}
            <tr class={row.itemID === $inventory.activeShipID ? "self" : ""}>
              <td data-label="Select">
                <input
                  type="checkbox"
                  aria-label="Select {resolvedName($names.resolved, 'type', row.typeID)}"
                  checked={samePlace(selectionPlace, { kind: "hangar" }) &&
                    selection.includes(row.itemID)}
                  disabled={busy}
                  onchange={() => toggle(row, { kind: "hangar" })}
                />
              </td>
              <td data-label="Type">{resolvedName($names.resolved, "type", row.typeID)}</td>
              <td data-label="Cat">{resolvedName($names.resolved, "category", row.categoryID)}</td>
              <td class="num" data-label="Qty">{row.singleton ? "(assembled)" : row.quantity}</td>
              <td data-label="Action">
                <span class="row-actions">
                  {#if isOpenableContainer(row)}
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.openContainer(row.itemID))}
                    >
                      Open
                    </button>
                  {/if}
                  {#if isShip(row)}
                    {#if isBoardableShip(row, $inventory.activeShipID)}
                      <button
                        type="button"
                        disabled={busy}
                        onclick={() => run(() => flow.boardShip(row.itemID))}
                      >
                        Board
                      </button>
                    {:else}
                      <span class="note">active ship</span>
                    {/if}
                  {:else if !isOpenableContainer(row)}
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() =>
                        run(() =>
                          flow.transferItems(
                            [row.itemID],
                            { kind: "hangar" },
                            { kind: "cargo" },
                            qtyArg(),
                          ),
                        )}
                    >
                      → Cargo
                    </button>
                  {/if}
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
  <h2>
    Active ship cargo
    <small class="note">
      {activeShipHeader()} · capacity {capacityText($inventory.cargo.capacity)}
    </small>
  </h2>
  <p>
    <button
      type="button"
      class="minor"
      disabled={busy || !$inventory.activeShipID}
      onclick={() => run(() => flow.stackContainer("cargo"))}
    >
      Stack all (cargo)
    </button>
  </p>
  {#if $inventory.cargo.error}
    <p class="error">The cargo hold could not be loaded: {$inventory.cargo.error}</p>
  {/if}
  {#if !$inventory.activeShipID}
    <p class="note">No active ship — board a ship in the hangar to see its cargo.</p>
  {:else if $inventory.cargo.rows.length === 0}
    <p class="empty">{$inventory.loaded ? "Cargo hold is empty." : "Loading cargo…"}</p>
  {:else}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead>
          <tr><th>Select</th><th>Type</th><th>Cat</th><th class="num">Qty</th><th>Action</th></tr>
        </thead>
        <tbody>
          {#each $inventory.cargo.rows as row (row.itemID)}
            <tr>
              <td data-label="Select">
                <input
                  type="checkbox"
                  aria-label="Select {resolvedName($names.resolved, 'type', row.typeID)}"
                  checked={samePlace(selectionPlace, { kind: "cargo" }) &&
                    selection.includes(row.itemID)}
                  disabled={busy}
                  onchange={() => toggle(row, { kind: "cargo" })}
                />
              </td>
              <td data-label="Type">{resolvedName($names.resolved, "type", row.typeID)}</td>
              <td data-label="Cat">{resolvedName($names.resolved, "category", row.categoryID)}</td>
              <td class="num" data-label="Qty">{row.singleton ? "(assembled)" : row.quantity}</td>
              <td data-label="Action">
                <span class="row-actions">
                  {#if isOpenableContainer(row)}
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.openContainer(row.itemID))}
                    >
                      Open
                    </button>
                  {:else}
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() =>
                        run(() =>
                          flow.transferItems(
                            [row.itemID],
                            { kind: "cargo" },
                            { kind: "hangar" },
                            qtyArg(),
                          ),
                        )}
                    >
                      → Hangar
                    </button>
                  {/if}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

{#if $inventory.container}
  <section>
    <h2>
      {containerName()}
      <small class="note">capacity {capacityText($inventory.container.capacity)}</small>
    </h2>
    <p>
      <button type="button" class="minor" disabled={busy} onclick={() => run(() => flow.openContainer(null))}>
        ← Back to the hangar
      </button>
    </p>
    {#if $inventory.container.error}
      <p class="error">This container could not be opened: {$inventory.container.error}</p>
    {:else if $inventory.container.rows.length === 0}
      <p class="empty">This container is empty.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr><th>Select</th><th>Type</th><th>Cat</th><th class="num">Qty</th><th>Action</th></tr>
          </thead>
          <tbody>
            {#each $inventory.container.rows as row (row.itemID)}
              <tr>
                <td data-label="Select">
                  <input
                    type="checkbox"
                    aria-label="Select {resolvedName($names.resolved, 'type', row.typeID)}"
                    checked={samePlace(selectionPlace, {
                      kind: "container",
                      itemID: $inventory.container.itemID,
                    }) && selection.includes(row.itemID)}
                    disabled={busy}
                    onchange={() =>
                      toggle(row, { kind: "container", itemID: $inventory.container!.itemID })}
                  />
                </td>
                <td data-label="Type">{resolvedName($names.resolved, "type", row.typeID)}</td>
                <td data-label="Cat">{resolvedName($names.resolved, "category", row.categoryID)}</td>
                <td class="num" data-label="Qty">{row.singleton ? "(assembled)" : row.quantity}</td>
                <td data-label="Action">
                  <button
                    type="button"
                    disabled={busy}
                    onclick={() =>
                      run(() =>
                        flow.transferItems(
                          [row.itemID],
                          { kind: "container", itemID: $inventory.container!.itemID },
                          { kind: "hangar" },
                          qtyArg(),
                        ),
                      )}
                  >
                    → Hangar
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

<section>
  <h2>Corporation hangar</h2>
  {#if !$inventory.corp.loaded}
    <p class="note">Loading the corporation hangar…</p>
  {:else if !$inventory.corp.available}
    <p class="note">
      {#if $inventory.corp.reason === "NO_CORP_OFFICE"}
        Your corporation has no office at this station.
      {:else}
        The corporation hangar could not be read: {$inventory.corp.reason ?? "unknown reason"}
      {/if}
    </p>
  {:else}
    <p class="controls">
      <label>
        Division:
        <select
          disabled={busy}
          value={$inventory.corp.selectedDivision}
          onchange={(event) =>
            flow.selectCorpDivision(Number((event.currentTarget as HTMLSelectElement).value))}
        >
          {#each $inventory.corp.divisions as division (division.division)}
            <option value={division.division}>
              {divisionLabel(division.division, division.name)}{divisionLooksAccessible(division)
                ? ""
                : " (empty or not visible to you)"}
            </option>
          {/each}
        </select>
      </label>
    </p>
    {#if selectedDivision}
      {#if selectedDivision.error}
        <p class="error">
          This division could not be read: {selectedDivision.error}
        </p>
      {:else if selectedDivision.rows.length === 0}
        <p class="note">
          Nothing here. This division is either empty or your corporation roles do not let
          you see it — the server decides, and it does not say which.
        </p>
      {:else}
        <div class="table-wrap overflow-x-auto">
          <table class="guests reflow">
            <thead>
              <tr><th>Select</th><th>Type</th><th>Cat</th><th class="num">Qty</th><th>Action</th></tr>
            </thead>
            <tbody>
              {#each selectedDivision.rows as row (row.itemID)}
                <tr>
                  <td data-label="Select">
                    <input
                      type="checkbox"
                      aria-label="Select {resolvedName($names.resolved, 'type', row.typeID)}"
                      checked={samePlace(selectionPlace, {
                        kind: "corp",
                        division: selectedDivision.division,
                      }) && selection.includes(row.itemID)}
                      disabled={busy}
                      onchange={() =>
                        toggle(row, { kind: "corp", division: selectedDivision!.division })}
                    />
                  </td>
                  <td data-label="Type">{resolvedName($names.resolved, "type", row.typeID)}</td>
                  <td data-label="Cat">
                    {resolvedName($names.resolved, "category", row.categoryID)}
                  </td>
                  <td class="num" data-label="Qty">{row.singleton ? "(assembled)" : row.quantity}</td>
                  <td data-label="Action">
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() =>
                        run(() =>
                          flow.transferItems(
                            [row.itemID],
                            { kind: "corp", division: selectedDivision!.division },
                            { kind: "hangar" },
                            qtyArg(),
                          ),
                        )}
                    >
                      → Hangar
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  {/if}
</section>
