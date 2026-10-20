<script lang="ts">
  // CharacterChecker.OfferDuelMenuEntry127-138 and SessionChecker.IsInZeroSec89.
  import { onMount } from "svelte";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import { isNpcOwner } from "../bridge/mail.ts";
  import { securityClass, SECURITY_CLASS } from "../bridge/systemSecurity.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import { failureCode } from "../bridge/ask.ts";
  import { notify } from "./notices.ts";
  let { store, flow, ownerID, onDone }: { store: ClientStore; flow: AppFlow; ownerID: number; onDone: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const station = store.station, flight = store.flight, names = store.names, words = store.words;
  const systemID = $derived($station.online?.solarSystemID ?? null);
  $effect(() => { if (systemID !== null) flow.requestSystemSecurity([systemID]); });
  const security = $derived(systemID === null ? null : $names.systemSecurity[systemID] ?? $station.station?.security ?? null);
  const offered = $derived($station.online !== null && ownerID !== $station.online.characterID && !isNpcOwner(ownerID)
    && security !== null && securityClass(security) !== SECURITY_CLASS.zero && $flight.crimewatch !== null
    && !$flight.crimewatch.states.engagements.some(entry => Number(entry.characterID) === ownerID));
  const LABEL = "UI/Crimewatch/Duel/DuelMenuEntry";
  function challenge(): void {
    const sent = flow.startDuel(ownerID); onDone();
    void sent.catch(cause => { if (failureCode(cause) !== "SESSION_REQUEST_RETIRED") notify({ kind: "danger", title: "Duel", detail: String(cause) }); });
  }
  onMount(() => flow.requestWords([LABEL]));
</script>
{#if offered}<button type="button" class="minor" onclick={challenge}>{plainText($words.templates[LABEL] ?? "Invite to Duel")}</button>{/if}
