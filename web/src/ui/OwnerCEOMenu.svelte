<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { notify } from "./notices.ts";
  let { store, flow, ownerIDs, onDone }: { store: ClientStore; flow: AppFlow; ownerIDs: readonly number[]; onDone: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  const authority = $derived(`${$station.online?.characterID}:${$station.online?.corporationID}:${$station.online?.corpRole}`);
  const identity = $derived(ownerIDs.join(":"));
  let menu = $state<Awaited<ReturnType<AppFlow["corporationCEOMenu"]>>>(null), expanded = $state(false), error = $state("");
  let reading = 0;
  $effect(() => {
    void authority; const targets = identity, request = ++reading; menu = null; expanded = false; error = "";
    void flow.corporationCEOMenu(targets.split(":").map(Number)).then(value => { if (request === reading) menu = value; }).catch(cause => {
      if (request === reading && cause?.code !== "SESSION_REQUEST_RETIRED") error = cause instanceof Error ? cause.message : String(cause);
    });
  });
  function confirm() {
    if (!menu) return;
    const action = menu.confirm(); onDone();
    void action.catch(cause => { if (cause?.code !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Corporation", detail: cause instanceof Error ? cause.message : String(cause) }); });
  }
  onMount(() => flow.requestWords(["UI/Corporations/Common/ResignAsCEO", "UI/Corporations/Common/ConfirmResignAsCEO"]));
  onDestroy(() => reading++);
</script>

{#if menu !== null}
  <button type="button" class="minor" aria-expanded={expanded} onclick={() => expanded = !expanded}>{plainText($words.templates["UI/Corporations/Common/ResignAsCEO"] ?? "Resign as CEO")} {expanded ? "▾" : "▸"}</button>
  {#if expanded}<button type="button" class="minor" onclick={confirm}>{plainText($words.templates["UI/Corporations/Common/ConfirmResignAsCEO"] ?? "Confirm Resignation")}</button>{/if}
{/if}
{#if error}<span class="note">{error}</span>{/if}
