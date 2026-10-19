<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { notify } from "./notices.ts";
  let { store, flow, ownerIDs, onDone }: { store: ClientStore; flow: AppFlow; ownerIDs: readonly number[]; onDone: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const station = store.station, words = store.words;
  const authority = $derived(`${$station.online?.characterID}:${$station.online?.corporationID}:${$station.online?.corpRole}`);
  const identity = $derived(ownerIDs.join(":"));
  let menu = $state<Awaited<ReturnType<AppFlow["corporationCashMenu"]>>>(null), error = $state(""), reading = 0;
  $effect(() => { void authority; const ids = identity, n = ++reading; menu = null; error = "";
    void flow.corporationCashMenu(ids.split(":").map(Number)).then(value => { if (reading === n) menu = value; }).catch(cause => { if (reading === n && cause?.code !== "SESSION_REQUEST_RETIRED") error = cause instanceof Error ? cause.message : String(cause); });
  });
  function transfer(): void {
    if (!menu) return;
    const action = menu.transfer(); onDone();
    void action.catch(error => { if (error?.code !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Transfer Money", detail: error instanceof Error ? error.message : String(error) }); });
  }
  onMount(() => flow.requestWords(["UI/Corporations/Common/TransferCorpCash"]));
  onDestroy(() => reading++);
</script>
{#if menu}<button type="button" class="minor" onclick={transfer}>{plainText($words.templates["UI/Corporations/Common/TransferCorpCash"] ?? "Transfer Corporation Cash")}</button>{/if}
{#if error}<span class="note">{error}</span>{/if}
