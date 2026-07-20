<script lang="ts">
  // Contracts page (goal R17, Slice B): the public delivery-job board, the
  // player's own contracts, and one contract in full.
  //
  // A pure reader of the store's contracts slice. Every identifier is
  // translated to a name in bridge/contracts.ts or resolved through the shared
  // name cache before it reaches this file. Nothing here shows a contractID, a
  // stationID, a systemID or a characterID (R7d) — a contract is identified by
  // who issued it, where it runs from and to, and what it pays. ISK is
  // formatted from decimal strings by `formatIsk`, never JS numbers, because it
  // exceeds 2^53 in ordinary play.
  //
  // ⚠ THE BOARD IS EXPECTED TO BE EMPTY, AND THE PANEL SAYS SO. EveJS has no
  // NPC/seed contract generator, so nothing exists to find until a player
  // creates a contract. That is a fact about this world, not a failure, and it
  // is stated plainly — and only when the browse actually SUCCEEDED and
  // returned nothing, never when it failed.
  //
  // READS ONLY. Every contract mutator is refused at the gateway, so there is
  // no take/accept action here.
  import { onMount } from "svelte";
  import {
    contractStatusLabel,
    contractTypeLabel,
    formatIsk,
    formatVolume,
  } from "../bridge/contracts.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ContractRow } from "../store/types.ts";
  import { resolvedName } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const contracts = store.contracts;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  let tab = $state<"board" | "mine">("board");
  let mineView = $state<"outstanding" | "accepted" | "expired">("outstanding");

  /** Always a NAME, never an id — and never an id-shaped fallback either. */
  function stationName(stationID: number): string {
    return resolvedName($names.resolved, "station", stationID, "an unnamed station");
  }

  function systemName(systemID: number): string {
    return resolvedName($names.resolved, "system", systemID, "an unnamed system");
  }

  function personName(characterID: number): string {
    return resolvedName($names.resolved, "character", characterID, "someone");
  }

  function ownerName(ownerID: number): string {
    return resolvedName($names.resolved, "owner", ownerID, "someone");
  }

  function itemName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID, "an unnamed item");
  }

  /** A retail FILETIME as a plain date. Never rendered as a number. */
  function dateText(filetime: bigint | null): string {
    if (filetime === null) {
      return "—";
    }
    const unixMs = Number(filetime / 10000n - 11644473600000n);
    if (!Number.isFinite(unixMs) || unixMs <= 0) {
      return "—";
    }
    return new Date(unixMs).toLocaleDateString();
  }

  /** Where a delivery runs, in words. */
  function routeText(row: ContractRow): string {
    if (row.endStationID <= 0) {
      return stationName(row.startStationID);
    }
    return `${stationName(row.startStationID)} → ${stationName(row.endStationID)}`;
  }

  const mineRows = $derived(
    mineView === "outstanding"
      ? $contracts.outstanding
      : mineView === "accepted"
        ? $contracts.accepted
        : $contracts.expired,
  );

  const mineCount = $derived(
    $contracts.outstanding.length + $contracts.accepted.length + $contracts.expired.length,
  );

  async function run(action: () => Promise<void>): Promise<void> {
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      error = isSessionLost(cause)
        ? "Your session ended. Pick your character again."
        : cause instanceof Error
          ? cause.message
          : String(cause);
    } finally {
      busy = false;
    }
  }

  function open(contractID: number): void {
    void run(() => flow.openContract(contractID));
  }

  onMount(() => {
    void run(() => flow.loadContracts(0));
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h1>Contracts</h1>
    <p class="controls">
      <button type="button" disabled={busy} onclick={() => void run(() => flow.loadContracts(0))}>
        Refresh
      </button>
    </p>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if $contracts.summary && ($contracts.summary.needsAttention > 0 || $contracts.summary.inProgress > 0 || $contracts.summary.assignedToMe > 0)}
    <p class="note">
      {#if $contracts.summary.needsAttention > 0}
        {$contracts.summary.needsAttention} need your attention.
      {/if}
      {#if $contracts.summary.inProgress > 0}
        {$contracts.summary.inProgress} in progress.
      {/if}
      {#if $contracts.summary.assignedToMe > 0}
        {$contracts.summary.assignedToMe} waiting for you.
      {/if}
    </p>
  {/if}

  <nav class="tabs">
    <button type="button" class:active={tab === "board"} onclick={() => (tab = "board")}>
      Jobs on offer
    </button>
    <button type="button" class:active={tab === "mine"} onclick={() => (tab = "mine")}>
      Yours{mineCount > 0 ? ` (${mineCount})` : ""}
    </button>
  </nav>

  {#if tab === "board"}
    {#if !$contracts.loaded}
      <p class="note">Looking for jobs…</p>
    {:else if $contracts.browseError}
      <!-- A FAILED browse. Deliberately worded differently from an empty one:
           "nothing was found" and "nothing could be looked up" are different
           facts and the player must be able to tell them apart. -->
      <p class="error">
        The job board could not be loaded just now, so there may be jobs you
        cannot see. Try again in a moment.
      </p>
    {:else if $contracts.worldHasNoContracts}
      <!-- ⚠ EXPECTED, NOT AN ERROR. Nobody has created a contract in this
           world yet, and there is no system that creates them automatically.
           Said plainly so the empty page reads as a fact, not a fault. -->
      <p class="note">
        There are no public delivery jobs in this world yet. Jobs appear here
        once a player creates one — nothing posts them automatically.
      </p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Issued by</th>
              <th>Route</th>
              <th>Pays</th>
              <th>You must cover</th>
              <th>Cargo</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each $contracts.browse as row (row.contractID)}
              <tr>
                <td data-label="Issued by">{personName(row.issuerID)}</td>
                <td data-label="Route">{routeText(row)}</td>
                <td data-label="Pays">{formatIsk(row.reward)}</td>
                <td data-label="You must cover">{formatIsk(row.collateral)}</td>
                <td data-label="Cargo">{formatVolume(row.volume)}</td>
                <td data-label="Expires">{dateText(row.dateExpired)}</td>
                <td data-label="">
                  <div class="row-actions">
                    <button type="button" disabled={busy} onclick={() => open(row.contractID)}>
                      See details
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if $contracts.numFound > $contracts.browse.length}
        <p class="note">
          Showing the first {$contracts.browse.length} of {$contracts.numFound} jobs.
        </p>
      {/if}
    {/if}
  {:else}
    <nav class="tabs">
      <button
        type="button"
        class:active={mineView === "outstanding"}
        onclick={() => (mineView = "outstanding")}
      >
        Waiting ({$contracts.outstanding.length})
      </button>
      <button
        type="button"
        class:active={mineView === "accepted"}
        onclick={() => (mineView = "accepted")}
      >
        Taken on ({$contracts.accepted.length})
      </button>
      <button
        type="button"
        class:active={mineView === "expired"}
        onclick={() => (mineView = "expired")}
      >
        Expired ({$contracts.expired.length})
      </button>
    </nav>

    {#if $contracts.mineError}
      <p class="error">
        Some of your contracts could not be loaded, so this list may be
        incomplete.
      </p>
    {/if}

    {#if !$contracts.loaded}
      <p class="note">Looking up your contracts…</p>
    {:else if mineRows.length === 0}
      <p class="note">
        {mineView === "outstanding"
          ? "You have no contracts waiting."
          : mineView === "accepted"
            ? "You have not taken on any contracts."
            : "You have no expired contracts."}
      </p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Route</th>
              <th>Pays</th>
              <th>Status</th>
              <th>Issued</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each mineRows as row (row.contractID)}
              <tr>
                <td data-label="Kind">{contractTypeLabel(row.type)}</td>
                <td data-label="Route">{routeText(row)}</td>
                <td data-label="Pays">{formatIsk(row.reward ?? row.price)}</td>
                <td data-label="Status">{contractStatusLabel(row.status)}</td>
                <td data-label="Issued">{dateText(row.dateIssued)}</td>
                <td data-label="">
                  <div class="row-actions">
                    <button type="button" disabled={busy} onclick={() => open(row.contractID)}>
                      See details
                    </button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}

  {#if $contracts.detailError}
    <p class="error">{$contracts.detailError}</p>
  {/if}

  {#if $contracts.detail !== null}
    <section class="bulk">
      <h2>{$contracts.detail.contract.title || contractTypeLabel($contracts.detail.contract.type)}</h2>
      <div class="table-wrap overflow-x-auto">
        <table class="guests">
          <tbody>
            <tr>
              <th>Kind</th>
              <td>{contractTypeLabel($contracts.detail.contract.type)}</td>
            </tr>
            <tr>
              <th>Issued by</th>
              <td>{personName($contracts.detail.contract.issuerID)}</td>
            </tr>
            <tr>
              <th>Status</th>
              <td>{contractStatusLabel($contracts.detail.contract.status)}</td>
            </tr>
            <tr>
              <th>Collect from</th>
              <td>
                {stationName($contracts.detail.contract.startStationID)}
                in {systemName($contracts.detail.startSolarSystemID)}
              </td>
            </tr>
            {#if $contracts.detail.contract.endStationID > 0}
              <tr>
                <th>Deliver to</th>
                <td>
                  {stationName($contracts.detail.contract.endStationID)}
                  in {systemName($contracts.detail.endSolarSystemID)}
                </td>
              </tr>
            {/if}
            <tr>
              <th>Pays</th>
              <td>{formatIsk($contracts.detail.contract.reward)}</td>
            </tr>
            <tr>
              <th>You must cover</th>
              <td>{formatIsk($contracts.detail.contract.collateral)}</td>
            </tr>
            <tr>
              <th>Cargo size</th>
              <td>{formatVolume($contracts.detail.contract.volume)}</td>
            </tr>
            <tr>
              <th>Time allowed</th>
              <td>
                {$contracts.detail.contract.numDays > 0
                  ? `${$contracts.detail.contract.numDays} days`
                  : "—"}
              </td>
            </tr>
            {#if $contracts.detail.contract.assigneeID !== null}
              <tr>
                <th>Reserved for</th>
                <td>{ownerName($contracts.detail.contract.assigneeID)}</td>
              </tr>
            {/if}
            {#if $contracts.detail.contract.acceptorID !== null}
              <tr>
                <th>Taken on by</th>
                <td>{ownerName($contracts.detail.contract.acceptorID)}</td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>

      {#if $contracts.detail.contract.description}
        <p class="note">{$contracts.detail.contract.description}</p>
      {/if}

      {#if $contracts.detail.items.length > 0}
        <h3>What is in it</h3>
        <div class="table-wrap overflow-x-auto">
          <table class="guests reflow">
            <thead>
              <tr>
                <th>Item</th>
                <th>How many</th>
                <th>Which way</th>
              </tr>
            </thead>
            <tbody>
              {#each $contracts.detail.items as item, index (`${item.typeID}-${index}`)}
                <tr>
                  <td data-label="Item">{itemName(item.typeID)}</td>
                  <td data-label="How many">{item.quantity}</td>
                  <!-- inCrate distinguishes what is being handed over from what
                       is being asked for — a gift from a trade. -->
                  <td data-label="Which way">
                    {item.inCrate ? "Being handed over" : "Being asked for"}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="note">This contract lists no items.</p>
      {/if}

      <p class="controls">
        <button type="button" class="minor" disabled={busy} onclick={() => flow.closeContract()}>
          Close
        </button>
      </p>
    </section>
  {/if}
</section>
