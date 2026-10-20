<script lang="ts">
  import type { Session } from "../app/sessions.ts";
  import DirectTradeWindow from "./DirectTradeWindow.svelte";
  let { session, inFront }: { session: Session; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const windows = session.flow.directTrades.windows, station = session.store.station;
</script>
{#if $station.online}
  {#each $windows as trade (trade.state.containerID)}
    <DirectTradeWindow {session} {trade} {inFront} />
  {/each}
{/if}
