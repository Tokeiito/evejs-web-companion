<script lang="ts">
  // CharacterChecker.OfferTradeWithCharacter281-290 / IsGuest403-408.
  import { onMount } from "svelte";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import { isNpcOwner } from "../bridge/mail.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { failureCode } from "../bridge/ask.ts";
  import { notify } from "./notices.ts";
  let { store, flow, ownerID, onDone }: { store: ClientStore; flow: AppFlow; ownerID: number; onDone: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const station = store.station, flight = store.flight, words = store.words;
  const offered = $derived($station.online !== null && ($flight.status?.docked ?? true)
    && ownerID !== $station.online.characterID && !isNpcOwner(ownerID)
    && $station.guests.some(guest => guest.characterID === ownerID));
  const LABEL = "UI/Market/TradeWithCharacter";
  function start(): void {
    const sent = flow.startDirectTrade(ownerID); onDone();
    void sent.catch(cause => { if (failureCode(cause) !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Trade", detail: String(cause) }); });
  }
  onMount(() => flow.requestWords([LABEL]));
</script>
{#if offered}<button type="button" class="minor" onclick={start}>{plainText($words.templates[LABEL] ?? "Trade")}</button>{/if}
