<script lang="ts">
  // The mining loop's dockside half (goal R23 slice B): what you mined, getting
  // it out of the ship, and turning it into minerals.
  //
  // The other half — flying to a belt, locking a rock and running the laser —
  // is not here, and deliberately so: it is the GENERIC targeting and module
  // layer on the Around Your Ship tab, which a mining laser and a turret use
  // identically. This panel is only the parts that are actually about ore.
  //
  // A pure reader of the store's mining slice. It computes nothing about
  // mining: it does not predict a yield, does not price minerals, and does not
  // decide what reprocessing will produce. Every number on screen came from the
  // server, and anything the server did not give reads as "not known".
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  // R27 — the shared item icon: one cached picture per thing, falling back
  // to a name-derived tile whenever the icon cache has no entry (or no cache).
  import TypeIcon from "./TypeIcon.svelte";
  import { resolvedName, type NameRef } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { MiningHold } from "../store/types.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const mining = store.mining;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  let selected = $state<number[]>([]);
  // The armed half of the two-step reprocess. Keyed by the exact stacks it was
  // armed for, so changing the selection disarms it: a confirmation must never
  // outlive the thing it was shown for.
  let confirmingFor = $state<string | null>(null);

  const docked = $derived($flight.status?.docked === true);
  // Only holds worth showing: one the ship actually HAS, one with something in
  // it, or one whose read failed (which the player should know about). A hull
  // with no gas bay would otherwise draw an empty 0 / 0 bar that means nothing.
  const holds = $derived(
    $mining.holds.filter(
      (hold) => hold.present || (hold.items?.length ?? 0) > 0 || hold.error !== null,
    ),
  );

  function selectionKey(ids: readonly number[]): string {
    return [...ids].sort((a, b) => a - b).join(",");
  }
  const armed = $derived(confirmingFor !== null && confirmingFor === selectionKey(selected));

  function itemName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID, "Unknown");
  }

  /**
   * A hold's fill, as the SERVER reported it. Anything the ship did not say
   * reads as "not known" — never as 0, which would look like an empty hold.
   */
  function capacityText(hold: MiningHold): string {
    const capacity = hold.capacity;
    if (!capacity || capacity.capacity === null) {
      return "not known";
    }
    const used = capacity.used === null ? null : capacity.used;
    if (used === null) {
      return `holds ${capacity.capacity.toLocaleString()} m³`;
    }
    return `${used.toLocaleString()} of ${capacity.capacity.toLocaleString()} m³`;
  }
  function fillPercent(hold: MiningHold): number | null {
    const capacity = hold.capacity;
    if (!capacity || capacity.capacity === null || capacity.used === null || capacity.capacity <= 0) {
      return null;
    }
    return Math.min(100, Math.round((capacity.used / capacity.capacity) * 100));
  }

  const allItems = $derived(holds.flatMap((hold) => hold.items ?? []));

  function toggle(itemID: number): void {
    selected = selected.includes(itemID)
      ? selected.filter((id) => id !== itemID)
      : [...selected, itemID];
    // Any change to WHAT is selected disarms the confirmation.
    confirmingFor = null;
  }

  // Everything this panel names resolves through the shared name cache, so ore
  // and minerals read as "Veldspar" and "Tritanium" and never as a typeID (R7d).
  $effect(() => {
    const refs: NameRef[] = [];
    for (const item of allItems) {
      refs.push({ kind: "type", id: item.typeID });
    }
    for (const quote of $mining.quotes) {
      if (quote.typeID !== null) {
        refs.push({ kind: "type", id: quote.typeID });
      }
      for (const output of quote.outputs) {
        refs.push({ kind: "type", id: output.typeID });
      }
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // The tax the station will charge, as a percentage. null stays "not known":
  // reprocessing DEBITS this from the wallet, so a confident 0 would tell the
  // player the refinery is free.
  const taxText = $derived(
    $mining.taxRate === null ? null : `${($mining.taxRate * 100).toFixed(2)}%`,
  );

  /** A quote is on screen at all (server state, independent of what is picked). */
  const hasQuote = $derived($mining.quotesFor.length > 0);
  /**
   * ...and it is the quote for what is picked RIGHT NOW. Only then may the
   * destructive control appear: confirming against numbers computed for a
   * different set of stacks is exactly the mistake this gate exists to stop.
   */
  const quotedForSelection = $derived(
    hasQuote && selectionKey($mining.quotesFor) === selectionKey(selected),
  );

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

  async function unload(): Promise<void> {
    await run(() => flow.unloadMiningHolds(selected));
    selected = [];
    confirmingFor = null;
  }

  async function quote(): Promise<void> {
    await run(() => flow.loadReprocessingQuote(selected));
  }

  async function reprocess(): Promise<void> {
    await run(() => flow.reprocessItems(selected));
    selected = [];
    confirmingFor = null;
  }

  onMount(() => {
    void run(() => flow.loadMiningHolds());
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h2>Mining</h2>
    <span class="controls">
      <button type="button" disabled={busy} onclick={() => run(() => flow.loadMiningHolds())}>
        Refresh
      </button>
    </span>
  </header>
  <p class="note">
    What you have mined, and what to do with it. To actually mine, fly to a belt,
    then lock a rock and switch your mining equipment on from Around Your Ship.
  </p>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $mining.holdsError}
    <p class="error">{$mining.holdsError}</p>
  {/if}
  {#if $mining.actionError}
    <p class="error">{$mining.actionError}</p>
  {/if}
  {#if $mining.silentDecline}
    <p class="error">{$mining.silentDecline}</p>
  {/if}
</section>

<section>
  <h2>Your holds</h2>
  {#if !$mining.holdsLoaded}
    <p class="note">Looking in your holds…</p>
  {:else if holds.length === 0}
    <p class="empty">
      This ship has no mining hold, and nothing has been mined into its cargo.
    </p>
  {:else}
    {#each holds as hold (hold.key)}
      <h3>{hold.label} <small class="note">{capacityText(hold)}</small></h3>
      {#if fillPercent(hold) !== null}
        <div
          class="hud-track"
          role="meter"
          aria-label={`${hold.label} fill`}
          aria-valuenow={fillPercent(hold) ?? 0}
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span class="hud-fill" style={`width: ${fillPercent(hold)}%`}></span>
        </div>
      {/if}
      {#if hold.error}
        <p class="error">That hold could not be read, so what is in it is unknown.</p>
      {:else if hold.items === null}
        <p class="error">That hold could not be read, so what is in it is unknown.</p>
      {:else if hold.items.length === 0}
        <p class="empty">Nothing in here yet.</p>
      {:else}
        <div class="table-wrap overflow-x-auto">
          <table class="guests reflow">
            <thead>
              <tr>
                <th>Pick</th>
                <th>Ore</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {#each hold.items as item (item.itemID)}
                <tr>
                  <td data-label="Pick">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.itemID)}
                      onchange={() => toggle(item.itemID)}
                      aria-label={`Pick ${itemName(item.typeID)}`}
                    />
                  </td>
                  <td data-label="Ore">
                    <span class="cell-item">
                      <TypeIcon typeID={item.typeID} name={itemName(item.typeID)} />
                      {itemName(item.typeID)}
                    </span>
                  </td>
                  <td class="num" data-label="Amount">{item.quantity.toLocaleString()}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/each}
  {/if}
</section>

<section class="bulk">
  <h2>Move it to your hangar</h2>
  {#if !docked}
    <p class="note">Dock at a station to unload.</p>
  {:else if selected.length === 0}
    <p class="note">Pick what you want to unload from the list above.</p>
  {:else}
    <p class="controls">
      <button type="button" class="primary" disabled={busy} onclick={unload}>
        Unload {selected.length} to the hangar
      </button>
    </p>
  {/if}
</section>

<section class="bulk">
  <h2>Refine it into minerals</h2>
  <!--
    ⚠ Reprocessing CONSUMES the ore and CHARGES the station's tax in ISK. So it
    is two deliberate steps with the server's own numbers in between: ask the
    station what it would give you AND what it will take, and only then offer
    the button that actually does it. The BFF refuses this call outright without
    an explicit confirmation, so the gate exists on both sides.
  -->
  {#if !docked}
    <p class="note">Dock at a station to use its refinery.</p>
  {:else if selected.length === 0 && !hasQuote}
    <p class="note">Pick what you want to refine from the list above.</p>
  {:else}
    {#if selected.length > 0}
      <p class="controls">
        <button type="button" disabled={busy} onclick={quote}>
          What would I get for {selected.length}?
        </button>
      </p>
    {/if}
    {#if $mining.quotesError}
      <p class="error">{$mining.quotesError}</p>
    {:else if hasQuote}
      <p class="note">
        The station takes a cut of everything it refines:
        {#if taxText === null}
          <span class="stat-unavailable">its cut is not known</span>
        {:else}
          <strong>{taxText}</strong>
        {/if}
      </p>
      {#if $mining.quotes.length === 0}
        <p class="empty">The station would not refine any of that.</p>
      {:else}
        <div class="table-wrap overflow-x-auto">
          <table class="guests reflow">
            <thead>
              <tr>
                <th>Ore</th>
                <th class="num">Refined</th>
                <th class="num">Left over</th>
                <th class="num">Its cut</th>
                <th>You would get</th>
              </tr>
            </thead>
            <tbody>
              {#each $mining.quotes as quote (quote.itemID)}
                <tr>
                  <td data-label="Ore">
                    <span class="cell-item">
                      <TypeIcon
                        typeID={quote.typeID}
                        name={quote.typeID === null ? "Unknown" : itemName(quote.typeID)}
                      />
                      {quote.typeID === null ? "Unknown" : itemName(quote.typeID)}
                    </span>
                  </td>
                  <td class="num" data-label="Refined">
                    {quote.quantityToProcess === null
                      ? "—"
                      : quote.quantityToProcess.toLocaleString()}
                  </td>
                  <td class="num" data-label="Left over">
                    {quote.leftOvers === null ? "—" : quote.leftOvers.toLocaleString()}
                  </td>
                  <td class="num" data-label="Its cut">
                    {#if quote.iskCost === null}
                      <span class="stat-unavailable">not known</span>
                    {:else}
                      {quote.iskCost.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} ISK
                    {/if}
                  </td>
                  <td data-label="You would get">
                    {#if quote.outputs.length === 0}
                      <span class="stat-unavailable">not known</span>
                    {:else}
                      {quote.outputs
                        .map((out) => `${out.quantity.toLocaleString()} ${itemName(out.typeID)}`)
                        .join(", ")}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <!--
          The destructive control is reachable ONLY when the quote on screen is
          the quote for what is currently picked. Change the selection and this
          whole block goes away again — a confirmation must never outlive the
          numbers it was shown for.
        -->
        {#if quotedForSelection}
          <p class="controls">
            {#if armed}
              <button type="button" class="danger" disabled={busy} onclick={reprocess}>
                Yes, refine it
              </button>
              <button
                type="button"
                class="minor"
                disabled={busy}
                onclick={() => (confirmingFor = null)}
              >
                Keep the ore
              </button>
            {:else}
              <button
                type="button"
                class="minor"
                disabled={busy}
                onclick={() => (confirmingFor = selectionKey(selected))}
              >
                Refine it…
              </button>
            {/if}
          </p>
        {:else}
          <p class="note">
            That quote is for a different pick. Ask again for what you have
            picked now.
          </p>
        {/if}
        {#if armed}
          <p class="error">
            This uses up the ore for good, and the station takes
            {taxText === null ? "a cut it has not told us" : taxText} in ISK.
          </p>
        {/if}
      {/if}
    {:else}
      <p class="note">
        Ask first — the station tells you what you would get and what its cut is
        before anything is used up.
      </p>
    {/if}
  {/if}
</section>
