<script lang="ts">
  // CharacterChecker140-149/380-389; menusvc642-645. Membership is native GetMemberIDs.
  import { onMount, onDestroy } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { notify } from "./notices.ts";
  let { store, flow, ownerID, onDone }: { store: ClientStore; flow: AppFlow; ownerID: number; onDone: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  const authority = $derived(`${$station.online?.characterID}:${$station.online?.corporationID}:${$station.online?.corpRole}`);
  let offered = $state<"view" | "edit" | null>(null), error = $state("");
  let reading = 0;
  $effect(() => {
    void authority; const target = ownerID, request = ++reading; offered = null; error = "";
    void flow.corporationMemberMenu(target).then(value => { if (request === reading) offered = value; }).catch(cause => {
      if (request === reading && cause?.code !== "SESSION_REQUEST_RETIRED") error = cause instanceof Error ? cause.message : String(cause);
    });
  });
  function open() {
    const opening = flow.openCorporationMemberDetails(ownerID); onDone();
    void opening.catch(cause => { if (cause?.code !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Member details", detail: cause instanceof Error ? cause.message : String(cause) }); });
  }
  onMount(() => flow.requestWords(["UI/Corporations/Common/ViewCorpMemberDetails", "UI/Corporations/Common/EditCorpMember"]));
  onDestroy(() => reading++);
</script>

{#if offered !== null}
  <button type="button" class="minor" onclick={open}>{plainText($words.templates[offered === "edit" ? "UI/Corporations/Common/EditCorpMember" : "UI/Corporations/Common/ViewCorpMemberDetails"] ?? (offered === "edit" ? "Edit Corporation Member" : "View Corporation Member Details"))}</button>
{:else if error}<span class="note">{error}</span>{/if}
