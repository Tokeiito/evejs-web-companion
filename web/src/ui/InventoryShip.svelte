<script lang="ts">
  // Inventory & Ship page (goals R3 + R14, recast by R40): the docked station
  // hangar, the ships the player owns and what is inside each of their bays,
  // any container they have opened, and the corporation hangar's divisions —
  // all driven through the bound-object bridge. A pure reader of the store's
  // inventory slice; every bind / List / Add / MultiAdd / MultiMerge /
  // TrashItems call lives on the BFF (which holds the bound-object handles)
  // and in app/flow.ts.
  //
  // R40 SPLIT THIS INTO TWO CARDS, because a ship and a crate of ore are not
  // the same kind of thing and reading them out of one mixed table made both
  // harder to find:
  //
  //   SHIPS            every hull the player owns. Clicking one reveals ITS
  //                    BAYS — and a hull can have several (a Procurer has a
  //                    cargo hold, a drone bay and a 16,000 m³ ore hold) —
  //                    each with how full it is and what is inside.
  //   HANGAR INVENTORY everything that is not a ship, as a grid of pictures
  //                    captioned with the name and the amount.
  //
  // A BAY IS AN INVENTORY FLAG, the same mechanism R12's fitting window uses
  // for slots. The flag numbers never reach this file — the BFF enumerates the
  // bays and hands over a label per bay (R7d/R9a). This file has no idea 134
  // exists, exactly as it has no idea 4, 5 or 115-121 do.
  //
  // ABSENT IS NOT EMPTY. A hull that has no ore hold, a hull whose ore hold we
  // could not read, and an ore hold that is genuinely empty are three different
  // states and are drawn three different ways. Collapsing them is the mistake
  // `worldHasNoContracts` exists to prevent.
  import { onMount } from "svelte";
  import {
    canMergeStacks,
    divisionLabel,
    isBoardableShip,
    isOpenableContainer,
  } from "../bridge/inventoryShip.ts";
  import { presentBays, unreadableBays } from "../bridge/shipBays.ts";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  // R27 — the shared item icon: one cached picture per thing, falling back
  // to a name-derived tile whenever the icon cache has no entry (or no cache).
  import TypeIcon from "./TypeIcon.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type {
    CapacityInfo,
    InventoryItemRow,
    InventoryPlace,
    ShipBay,
  } from "../store/types.ts";
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

  const CATEGORY_SHIP = 6;

  function isShip(row: InventoryItemRow): boolean {
    return row.categoryID === CATEGORY_SHIP;
  }

  // R7c — resolve every row's typeID -> type name and categoryID -> category
  // name (batched + cached by the flow's name cache). Fire-and-forget in an
  // effect so rows render immediately and swap to names as they arrive.
  $effect(() => {
    const refs: NameRef[] = [];
    const openShip = $inventory.openShip;
    const everyRow = [
      ...$inventory.hangar.rows,
      ...$inventory.cargo.rows,
      ...($inventory.container ? $inventory.container.rows : []),
      ...$inventory.corp.divisions.flatMap((division) => division.rows),
      // R40 — the things inside the open ship's bays need names too, or the
      // grid captions them all "—".
      ...(openShip ? openShip.bays.flatMap((bay) => bay.items ?? []) : []),
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
    if (openShip && openShip.typeID > 0) {
      refs.push({ kind: "type", id: openShip.typeID });
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

  function typeName(typeID: number | null): string {
    if (typeID === null || typeID <= 0) {
      return "your ship";
    }
    return $names.resolved[nameKey("type", typeID)] ?? "your ship";
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

  onMount(() => {
    void run(async () => {
      await flow.loadInventory();
      await flow.loadCorpHangar();
    });
  });

  function amount(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  /**
   * How full a bay is, in words. A capacity the ship did not report reads "not
   * known" and NEVER 0 — a confident "0 of 0 m³" would tell the player the bay
   * is unusable when in truth we simply failed to ask.
   */
  function capacityText(capacity: CapacityInfo | null): string {
    if (!capacity) {
      return "not known";
    }
    return `${amount(capacity.used)} of ${amount(capacity.capacity)} m³`;
  }

  /**
   * Room used in the STATION HANGAR, which has no meaningful limit. eve.js
   * returns a 1,000,000 m³ default for the unmapped hangar flag (R40) — a
   * phantom ceiling, not a real one — so the hangar shows only how much room is
   * used, with no "of {capacity}" and no gauge to fill toward. This is chosen by
   * WHERE it is rendered (the station-hangar card), never by sniffing the
   * 1,000,000 value, which is fragile and could legitimately appear elsewhere.
   * Ship bays with a real finite capacity keep `capacityText` and their gauge.
   */
  function roomUsedText(capacity: CapacityInfo | null): string {
    if (!capacity) {
      return "not known";
    }
    return `${amount(capacity.used)} m³`;
  }

  /** The gauge's fill, clamped. Zero capacity means no meaningful bar. */
  function fillPercent(capacity: CapacityInfo | null): number {
    if (!capacity || !(capacity.capacity > 0)) {
      return 0;
    }
    return Math.max(0, Math.min(100, (capacity.used / capacity.capacity) * 100));
  }

  /** What a tile says under the name: an amount, or that the thing is one object. */
  function amountText(row: InventoryItemRow): string {
    return row.singleton ? "assembled" : amount(row.quantity);
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
    if (left.kind === "shipBay" && right.kind === "shipBay") {
      // A tick made in the ore hold must not be treated as a tick in the drone
      // bay: each bay is its own place.
      return left.bay === right.bay;
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

  function isPicked(row: InventoryItemRow, place: InventoryPlace): boolean {
    return samePlace(selectionPlace, place) && selection.includes(row.itemID);
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
    if (place.kind === "shipBay") {
      const bay = $inventory.openShip?.bays.find((entry) => entry.key === place.bay);
      return bay?.items ?? [];
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
    if (place.kind === "shipBay") {
      const bay = $inventory.openShip?.bays.find((entry) => entry.key === place.bay);
      return bay ? bay.label : "Ship bay";
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

  // --- R40 the ships card ---------------------------------------------------

  /**
   * Every hull the player owns HERE, plus the one they are flying.
   *
   * The active ship is normally a hangar row while docked, but a player in
   * space has no station hangar to read — so when the active ship is not among
   * the hangar rows it is added from what the slice does know. Otherwise the
   * one ship they are definitely in would be the one ship they could not open.
   */
  const ships = $derived.by<InventoryItemRow[]>(() => {
    const rows = $inventory.hangar.rows.filter(isShip);
    const activeID = $inventory.activeShipID;
    if (activeID !== null && !rows.some((row) => row.itemID === activeID)) {
      rows.unshift({
        itemID: activeID,
        typeID: activeShipTypeID ?? 0,
        groupID: null,
        categoryID: CATEGORY_SHIP,
        flagID: null,
        quantity: 1,
        singleton: true,
      });
    }
    return rows;
  });

  /** Everything in the hangar that is NOT a ship — the second card's contents. */
  const hangarThings = $derived($inventory.hangar.rows.filter((row) => !isShip(row)));

  const openShip = $derived($inventory.openShip);

  /** The bays this hull actually has. Only these are ever drawn. */
  const shownBays = $derived.by<readonly ShipBay[]>(() =>
    openShip ? presentBays(openShip.bays) : [],
  );

  /**
   * Bays we could not READ. These are named out loud: without them, a hull
   * whose ore hold failed to read would look exactly like a hull that has no
   * ore hold, and the player would believe a bay does not exist when in fact
   * nobody managed to look.
   */
  const uncheckedBays = $derived.by<readonly ShipBay[]>(() =>
    openShip ? unreadableBays(openShip.bays) : [],
  );

  async function toggleShip(row: InventoryItemRow): Promise<void> {
    const already = openShip !== null && openShip.itemID === row.itemID;
    await run(() => flow.openShipBays(already ? null : row.itemID));
  }

  /**
   * Can the player act on what is in this bay from here?
   *
   * ANY bay of the ACTIVE ship (R51). The BFF can now address a bay by its key
   * as a transfer source — the ore hold, the drone bay and the cargo hold are
   * all valid sources — so a stack in any of them can be moved into the station
   * hangar. There is still no addressing for "the ore hold of the ship I am not
   * flying" (it has no source location), so a bay on an inactive hull stays
   * read-only and the card says to board instead.
   */
  function bayIsActionable(shipItemID: number, bay: ShipBay): boolean {
    return shipItemID === $inventory.activeShipID && bay.present === true;
  }

  /**
   * The place descriptor that addresses this bay as a transfer source. The
   * cargo hold keeps its own long-standing "cargo" place; every other bay is a
   * "shipBay" named by its key. The flag behind the key never leaves the BFF.
   */
  function bayPlace(bay: ShipBay): InventoryPlace {
    return bay.key === "cargo" ? { kind: "cargo" } : { kind: "shipBay", bay: bay.key };
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

<!--
  ONE tile grid, used by the hangar, an open container, a corporation division
  and a ship's cargo bay. Every place shows the same thing — a picture, the
  NAME, and the AMOUNT underneath (the operator's ask) — so they are one
  snippet rather than four copies that drift apart.

  `actions` decides which buttons a tile offers, because what you can do with a
  thing depends on where it is sitting. `readOnly` drops selection and actions
  entirely: that is a bay the bridge gives us no way to act on, and a button
  that cannot work must not be drawn.
-->
{#snippet itemGrid(
  rows: readonly InventoryItemRow[],
  place: InventoryPlace,
  actions: "toCargo" | "toHangar" | "none",
  readOnly: boolean = false,
)}
  <ul class="item-grid">
    {#each rows as row (row.itemID)}
      <li class="item-tile {isPicked(row, place) ? 'picked' : ''}">
        <TypeIcon
          typeID={row.typeID}
          name={resolvedName($names.resolved, "type", row.typeID)}
          size="lg"
        />
        <span class="item-tile-name">{resolvedName($names.resolved, "type", row.typeID)}</span>
        <span class="item-tile-amount">{amountText(row)}</span>
        {#if !readOnly}
          <label class="item-tile-pick">
            <input
              type="checkbox"
              aria-label="Select {resolvedName($names.resolved, 'type', row.typeID)}"
              checked={isPicked(row, place)}
              disabled={busy}
              onchange={() => toggle(row, place)}
            />
            Select
          </label>
          <span class="item-tile-actions">
            {#if isOpenableContainer(row)}
              <button
                type="button"
                disabled={busy}
                onclick={() => run(() => flow.openContainer(row.itemID))}
              >
                Open
              </button>
            {:else if actions === "toCargo"}
              <button
                type="button"
                disabled={busy}
                onclick={() =>
                  run(() =>
                    flow.transferItems([row.itemID], place, { kind: "cargo" }, qtyArg()),
                  )}
              >
                → Cargo
              </button>
            {:else if actions === "toHangar"}
              <button
                type="button"
                disabled={busy}
                onclick={() =>
                  run(() =>
                    flow.transferItems([row.itemID], place, { kind: "hangar" }, qtyArg()),
                  )}
              >
                → Hangar
              </button>
            {/if}
          </span>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

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
            if ($inventory.openShip) {
              await flow.openShipBays($inventory.openShip.itemID);
            }
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

<!-- ============================================================ CARD 1 — SHIPS -->
<section>
  <h2>Your ships</h2>
  {#if $inventory.hangar.error}
    <p class="error">Your ships could not be listed: {$inventory.hangar.error}</p>
  {/if}
  {#if ships.length === 0}
    <p class="empty">
      {$inventory.loaded ? "You have no ships here." : "Looking for your ships…"}
    </p>
  {:else}
    <p class="note">Pick a ship to see its bays and what is in them.</p>
    <ul class="item-grid">
      {#each ships as ship (ship.itemID)}
        <li
          class="item-tile {ship.itemID === $inventory.activeShipID ? 'self' : ''} {openShip &&
          openShip.itemID === ship.itemID
            ? 'picked'
            : ''}"
        >
          <TypeIcon
            typeID={ship.typeID}
            name={resolvedName($names.resolved, "type", ship.typeID)}
            size="lg"
          />
          <span class="item-tile-name">{resolvedName($names.resolved, "type", ship.typeID)}</span>
          <span class="item-tile-amount">
            {ship.itemID === $inventory.activeShipID ? "you are flying this" : "docked here"}
          </span>
          <span class="item-tile-actions">
            <button type="button" disabled={busy} onclick={() => toggleShip(ship)}>
              {openShip && openShip.itemID === ship.itemID ? "Hide bays" : "Show bays"}
            </button>
            {#if isBoardableShip(ship, $inventory.activeShipID)}
              <button
                type="button"
                class="minor"
                disabled={busy}
                onclick={() => run(() => flow.boardShip(ship.itemID))}
              >
                Board
              </button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if openShip}
    <h3>{typeName(openShip.typeID)} — its bays</h3>
    {#if openShip.error}
      <!-- The read failed outright, so NOTHING is known about this hull's bays.
           That is emphatically not "this ship has no bays". -->
      <p class="error">
        This ship's bays could not be read, so we cannot say what it has: {openShip.error}
      </p>
    {:else if !openShip.loaded}
      <p class="empty">Looking inside this ship…</p>
    {:else if shownBays.length === 0}
      <p class="note">
        {uncheckedBays.length > 0
          ? "None of this ship's bays could be read, so we cannot say what it has."
          : "This ship has no bays that can hold anything."}
      </p>
    {:else}
      {#each shownBays as bay (bay.key)}
        <div class="bay">
          <div class="bay-head">
            <strong>{bay.label}</strong>
            <span class={bay.capacity ? "hud-value" : "stat-unavailable"}>
              {capacityText(bay.capacity)}
            </span>
          </div>
          {#if bay.capacity && bay.capacity.capacity > 0}
            <!-- The bar is a summary; the numbers above it are the real reading,
                 so the bar is never the only way to tell how full a bay is. -->
            <div class="hud-track">
              <span class="hud-fill" style="width: {fillPercent(bay.capacity)}%"></span>
            </div>
          {/if}
          {#if bay.error}
            <p class="error">What is in here could not be read: {bay.error}</p>
          {:else if bay.items === null}
            <p class="error">What is in here could not be read.</p>
          {:else if bay.items.length === 0}
            <p class="empty">Nothing in here yet.</p>
          {:else if bayIsActionable(openShip.itemID, bay)}
            {@render itemGrid(bay.items, bayPlace(bay), "toHangar")}
          {:else}
            {@render itemGrid(bay.items, bayPlace(bay), "none", true)}
          {/if}
          {#if bay.key === "cargo" && bayIsActionable(openShip.itemID, bay) && bay.items && bay.items.length > 0}
            <!-- Stack-all is a cargo-hold convenience (`stackContainer` only
                 knows "cargo" and "hangar"); it is not offered for other bays. -->
            <p>
              <button
                type="button"
                class="minor"
                disabled={busy}
                onclick={() => run(() => flow.stackContainer("cargo"))}
              >
                Stack all (cargo)
              </button>
            </p>
          {/if}
        </div>
      {/each}
      {#if openShip.itemID !== $inventory.activeShipID}
        <p class="note">
          Board this ship to move things in and out of it.
        </p>
      {/if}
    {/if}
    {#if uncheckedBays.length > 0 && !openShip.error}
      <!-- Named out loud, so a bay we failed to check is never mistaken for a
           bay the hull does not have. -->
      <p class="note">
        These bays could not be checked, so we cannot say whether this ship has them:
        {uncheckedBays.map((bay) => bay.label).join(", ")}.
      </p>
    {/if}
  {/if}
</section>

<!-- ================================================ CARD 2 — HANGAR INVENTORY -->
<section>
  <h2>
    Hangar inventory
    <!-- A station has no capacity limit: only room USED, never "of {capacity}"
         and never a gauge (R51). -->
    <small class="note">Room used: {roomUsedText($inventory.hangar.capacity)}</small>
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
  {:else if hangarThings.length === 0}
    <p class="empty">
      {$inventory.loaded
        ? "Nothing here but your ships."
        : "Looking through your hangar…"}
    </p>
  {:else}
    {@render itemGrid(hangarThings, { kind: "hangar" }, "toCargo")}
  {/if}
</section>

{#if $inventory.container}
  <section>
    <h2>
      {containerName()}
      <small class="note">room used {capacityText($inventory.container.capacity)}</small>
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
      {@render itemGrid(
        $inventory.container.rows,
        { kind: "container", itemID: $inventory.container.itemID },
        "toHangar",
      )}
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
        {@render itemGrid(
          selectedDivision.rows,
          { kind: "corp", division: selectedDivision.division },
          "toHangar",
        )}
      {/if}
    {/if}
  {/if}
</section>
