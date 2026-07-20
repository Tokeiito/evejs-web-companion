<script lang="ts">
  // Market page (goal R16): an item's order book by station name, the player's
  // own orders, their trades, what they have locked in escrow, and their ISK.
  //
  // A pure reader of the store's market slice. Every call lives on the BFF and
  // in app/flow.ts; every identifier is translated to a name in
  // bridge/market.ts or resolved through the shared name cache before it
  // reaches this file. Nothing here shows a typeID, a stationID, a systemID or
  // an orderID (R7d) — an order is identified by what it is for, where it is
  // and at what price. Prices are decimal strings formatted by `formatIsk`,
  // never JS numbers, because ISK exceeds 2^53 in ordinary play.
  //
  // THE SORTING AND FILTERING HERE IS THE POINT. Retail implements it in a
  // client-local service called `marketQuote`; there is no server call for it.
  // So it is implemented client-side here too, which is also why re-sorting the
  // book costs no round-trip.
  import { onMount } from "svelte";
  import {
    FILL_STATE_LABELS,
    bestPrices,
    distanceLabel,
    filterByJumps,
    formatIsk,
    rangeLabel,
    sortOrderBook,
  } from "../bridge/market.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { MarketTypeMatch } from "../app/api.ts";
  import type { MarketOwnOrderRow } from "../store/types.ts";
  import { resolvedName } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const market = store.market;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");

  /** Which of the four views is showing. */
  let tab = $state<"book" | "orders" | "trades" | "escrow">("book");

  // --- Item search ---------------------------------------------------------
  let query = $state("");
  let matches = $state<readonly MarketTypeMatch[]>([]);
  let chosenName = $state("");

  // --- Client-local book controls (retail's `marketQuote`) -----------------
  /** -1 means "no limit"; anything else caps how far away an order may be. */
  let maxJumps = $state(-1);

  function typeName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID, "an unnamed item");
  }

  function stationName(stationID: number): string {
    return resolvedName($names.resolved, "station", stationID, "an unnamed station");
  }

  function systemName(solarSystemID: number): string {
    return resolvedName($names.resolved, "system", solarSystemID, "an unknown system");
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

  function search(): void {
    void run(async () => {
      matches = await flow.findMarketTypes(query);
    });
  }

  function chooseItem(match: MarketTypeMatch): void {
    chosenName = match.name;
    matches = [];
    query = "";
    void run(() => flow.loadMarket(match.typeID));
  }

  function refresh(): void {
    void run(() => flow.loadMarket($market.typeID));
  }

  // --- The book, sorted and filtered client-side ---------------------------

  const sells = $derived.by(() =>
    filterByJumps(sortOrderBook($market.sells, "sell"), maxJumps),
  );
  const buys = $derived.by(() =>
    filterByJumps(sortOrderBook($market.buys, "buy"), maxJumps),
  );
  const best = $derived.by(() => bestPrices({ sells: $market.sells, buys: $market.buys }));

  const openOrders = $derived.by(() =>
    $market.ownOrders.filter((order) => order.state === "open"),
  );

  onMount(() => {
    void run(() => flow.loadMarket(null));
  });
</script>

<section>
  <h2>Market</h2>
  <p class="controls">
    <input
      type="search"
      bind:value={query}
      placeholder="Search for an item to trade"
      onkeydown={(event) => event.key === "Enter" && search()}
    />
    <button type="button" disabled={busy || query.trim().length < 2} onclick={search}>
      Search
    </button>
    <button type="button" class="minor" disabled={busy} onclick={refresh}>Refresh</button>
  </p>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $market.marketUnavailable}
    <p class="error">{$market.marketUnavailable}</p>
  {/if}
  {#if matches.length > 0}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead>
          <tr><th>Item</th><th>Kind</th><th>Action</th></tr>
        </thead>
        <tbody>
          {#each matches as match (match.typeID)}
            <tr>
              <td data-label="Item">{match.name}</td>
              <td data-label="Kind">{match.groupName}</td>
              <td data-label="Action">
                <div class="row-actions">
                  <button type="button" disabled={busy} onclick={() => chooseItem(match)}>
                    Show the market
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if !$market.loaded}
    <p class="note">Loading the market…</p>
  {:else}
    <p class="note">
      Your ISK: <strong>{formatIsk($market.cashBalance)}</strong>.
      {#if $market.escrow}
        {formatIsk($market.escrow.isk)} of it is tied up in buy orders.
      {/if}
    </p>
  {/if}
</section>

{#if $market.loaded}
  <section>
    <p class="controls">
      <button type="button" class:active={tab === "book"} onclick={() => (tab = "book")}>
        What is on sale
      </button>
      <button type="button" class:active={tab === "orders"} onclick={() => (tab = "orders")}>
        Your orders
      </button>
      <button type="button" class:active={tab === "trades"} onclick={() => (tab = "trades")}>
        Your trades
      </button>
      <button type="button" class:active={tab === "escrow"} onclick={() => (tab = "escrow")}>
        What is tied up
      </button>
    </p>
  </section>
{/if}

{#if $market.loaded && tab === "book"}
  <section>
    <h2>
      {#if $market.typeID === null}
        Pick an item
      {:else}
        {chosenName || typeName($market.typeID)}
      {/if}
    </h2>
    {#if $market.typeID === null}
      <p class="note">Search for an item above to see who is buying and selling it.</p>
    {:else}
      {#if $market.bookError}
        <p class="error">This item's market could not be read: {$market.bookError}</p>
      {/if}
      <p class="note">
        Cheapest on sale: <strong>{formatIsk(best.bestSell)}</strong> ·
        Best price anyone is paying: <strong>{formatIsk(best.bestBuy)}</strong>.
        These are what is on offer right now — the server works out what a trade
        actually costs when you place an order.
      </p>
      <p class="controls">
        <label>
          Show orders
          <select bind:value={maxJumps}>
            <option value={-1}>Anywhere in the region</option>
            <option value={0}>Where you are only</option>
            <option value={1}>Within 1 jump</option>
            <option value={5}>Within 5 jumps</option>
            <option value={10}>Within 10 jumps</option>
          </select>
        </label>
      </p>

      <h3>On sale (you can buy these)</h3>
      {#if sells.length === 0}
        <p class="note">Nobody is selling this here right now.</p>
      {:else}
        <div class="table-wrap overflow-x-auto">
          <table class="guests reflow">
            <thead>
              <tr>
                <th>Price each</th>
                <th>How many</th>
                <th>Where</th>
                <th>System</th>
                <th>Distance</th>
                <th>Smallest deal</th>
              </tr>
            </thead>
            <tbody>
              {#each sells as order (order.orderID)}
                <tr>
                  <td data-label="Price each">{formatIsk(order.price)}</td>
                  <td data-label="How many">{order.volumeRemaining}</td>
                  <td data-label="Where">{stationName(order.stationID)}</td>
                  <td data-label="System">{systemName(order.solarSystemID)}</td>
                  <td data-label="Distance">{distanceLabel(order.jumps)}</td>
                  <td data-label="Smallest deal">{order.minimumVolume}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <h3>Wanted (you can sell to these)</h3>
      {#if buys.length === 0}
        <p class="note">Nobody is buying this here right now.</p>
      {:else}
        <div class="table-wrap overflow-x-auto">
          <table class="guests reflow">
            <thead>
              <tr>
                <th>Price each</th>
                <th>How many</th>
                <th>Where</th>
                <th>System</th>
                <th>Distance</th>
                <th>Reaches</th>
              </tr>
            </thead>
            <tbody>
              {#each buys as order (order.orderID)}
                <tr>
                  <td data-label="Price each">{formatIsk(order.price)}</td>
                  <td data-label="How many">{order.volumeRemaining}</td>
                  <td data-label="Where">{stationName(order.stationID)}</td>
                  <td data-label="System">{systemName(order.solarSystemID)}</td>
                  <td data-label="Distance">{distanceLabel(order.jumps)}</td>
                  <td data-label="Reaches">{rangeLabel(order.range)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if $market.priceHistory.length > 0}
        <h3>Recent prices</h3>
        <div class="table-wrap overflow-x-auto">
          <table class="guests reflow">
            <thead>
              <tr><th>Day</th><th>Lowest</th><th>Highest</th><th>Average</th><th>Traded</th></tr>
            </thead>
            <tbody>
              {#each $market.priceHistory as day (day.day)}
                <tr>
                  <td data-label="Day">{dateText(day.day)}</td>
                  <td data-label="Lowest">{formatIsk(day.low)}</td>
                  <td data-label="Highest">{formatIsk(day.high)}</td>
                  <td data-label="Average">{formatIsk(day.average)}</td>
                  <td data-label="Traded">{day.volume}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </section>
{/if}

{#if $market.loaded && tab === "orders"}
  <section>
    <h2>Orders you have open</h2>
    {#if $market.ownOrdersError}
      <p class="error">Your orders could not be read: {$market.ownOrdersError}</p>
    {/if}
    {#if openOrders.length === 0}
      <p class="note">You have no orders open right now.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Item</th>
              <th>Buying or selling</th>
              <th>Price each</th>
              <th>Left</th>
              <th>Where</th>
              <th>Tied up</th>
            </tr>
          </thead>
          <tbody>
            {#each openOrders as order (order.orderID)}
              <tr>
                <td data-label="Item">{typeName(order.typeID)}</td>
                <td data-label="Buying or selling">
                  {order.side === "buy" ? "Buying" : "Selling"}
                </td>
                <td data-label="Price each">{formatIsk(order.price)}</td>
                <td data-label="Left">{order.volumeRemaining} of {order.volumeEntered}</td>
                <td data-label="Where">{stationName(order.stationID)}</td>
                <td data-label="Tied up">
                  {order.side === "buy" ? formatIsk(order.escrow) : "—"}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  {#if $market.orderHistory.length > 0}
    <section>
      <h2>Orders that have finished</h2>
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Item</th>
              <th>Buying or selling</th>
              <th>Price each</th>
              <th>Where</th>
              <th>What happened</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {#each $market.orderHistory as order (order.orderID)}
              <tr>
                <td data-label="Item">{typeName(order.typeID)}</td>
                <td data-label="Buying or selling">
                  {order.side === "buy" ? "Buying" : "Selling"}
                </td>
                <td data-label="Price each">{formatIsk(order.price)}</td>
                <td data-label="Where">{stationName(order.stationID)}</td>
                <td data-label="What happened">{FILL_STATE_LABELS[order.state]}</td>
                <td data-label="Placed">{dateText(order.issuedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
{/if}

{#if $market.loaded && tab === "trades"}
  <section>
    <h2>Trades you have made</h2>
    {#if $market.transactionsError}
      <p class="error">Your trades could not be read: {$market.transactionsError}</p>
    {/if}
    {#if $market.transactions.length === 0}
      <p class="note">You have not traded anything yet.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Item</th>
              <th>Bought or sold</th>
              <th>How many</th>
              <th>Price each</th>
              <th>Where</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {#each $market.transactions as trade (trade.transactionID)}
              <tr>
                <td data-label="Item">{typeName(trade.typeID)}</td>
                <td data-label="Bought or sold">
                  {trade.side === "bought"
                    ? "You bought"
                    : trade.side === "sold"
                      ? "You sold"
                      : "—"}
                </td>
                <td data-label="How many">{trade.quantity}</td>
                <td data-label="Price each">{formatIsk(trade.price)}</td>
                <td data-label="Where">{stationName(trade.stationID)}</td>
                <td data-label="When">{dateText(trade.transactedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

{#if $market.loaded && tab === "escrow"}
  <section>
    <h2>What your orders have tied up</h2>
    {#if $market.escrow === null}
      <p class="note">This could not be read right now.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <tbody>
            <tr>
              <th>ISK held for your buy orders</th>
              <td data-label="ISK held for your buy orders">
                {formatIsk($market.escrow.isk)}
              </td>
            </tr>
            <tr>
              <th>Goods held for your sell orders</th>
              <td data-label="Goods held for your sell orders">
                {$market.escrow.items}
              </td>
            </tr>
            <tr>
              <th>ISK you can still spend</th>
              <td data-label="ISK you can still spend">{formatIsk($market.cashBalance)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="note">
        When you offer to buy something, the ISK is set aside straight away and
        held until the order is filled or you take it down. Goods you have
        offered for sale are held the same way.
      </p>
    {/if}
  </section>
{/if}
