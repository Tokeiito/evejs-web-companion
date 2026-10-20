<script lang="ts">
  // InfoWindowMonolith: caption1450-1453, header675-687, supplied abstract
  // icon1347-1352. The ordinary info manager retains graphics through history.
  import { onMount } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { InfoReadScope } from "../app/infoReadScope.ts";
  import type { InfoSubject } from "../bridge/infoWindow.ts";
  import { medalLayersOf, type MedalInfo } from "../bridge/corporationDecorations.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { isNpcCorporation } from "../bridge/ownerInfo.ts";
  import { resolvedName } from "../store/names.ts";
  import { clientTexture } from "./skillGroupIcons.ts";
  import { showInfo } from "./showInfo.ts";
  import MedalPreview from "./MedalPreview.svelte";
  import CorpLogo from "./CorpLogo.svelte";
  let { store, flow, subject, reads }: { store: ClientStore; flow: AppFlow; subject: Extract<InfoSubject, { kind: "medal" }>; reads: InfoReadScope } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words, names = store.names, logos = flow.corpLogos, library = flow.corpLogoLibrary, ownerLogos = flow.ownerLogos;
  const ISSUED = "UI/InfoWindow/MedalIssuedBy", COUNT = "UI/InfoWindow/NumberOfTimesAwarded", CLICK = "UI/InfoWindow/ClickForCorpInfo", DESCRIPTION = "UI/InfoWindow/TabNames/Description";
  let info = $state<MedalInfo | null>(null), error = $state("");
  const layers = $derived(medalLayersOf(subject.graphics));
  const corpName = $derived(info ? resolvedName($names.resolved, "owner", info.ownerID, "…") : "");
  const corpLogo = $derived(info ? $logos[String(info.ownerID)] ?? null : null);
  const npcLogo = $derived(info ? $ownerLogos?.corporations[String(info.ownerID)] ?? null : null);
  function word(label: string, fallback: string): string { return plainText($words.templates[label] ?? fallback); }
  function formatted(label: string, fallback: string, args: Record<string, string | number>): string {
    return plainText(formatTemplate($words.templates[label] ?? fallback, args, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }
  onMount(() => {
    flow.requestWords([ISSUED, COUNT, CLICK, DESCRIPTION]);
    flow.requestNames([{ kind: "type", id: 29496 }]);
    flow.loadOwnerLogos();
    let mounted = true;
    void flow.medalShowInfo(subject.itemID, reads).then(answer => { if (mounted) info = answer; }, cause => {
      if (mounted && cause?.code !== "INFO_RECONSTRUCTION_RETIRED" && cause?.code !== "SESSION_REQUEST_RETIRED") error = cause instanceof Error ? cause.message : String(cause);
    });
    return () => { mounted = false; };
  });
</script>

<section class="medal-info" aria-label={resolvedName($names.resolved, "type", 29496, "Medal")}>
  {#if error}<p class="error">{error}</p>
  {:else if info === null}<p class="note">Loading…</p>
  {:else}
    <div class="medal-header">
      <MedalPreview {layers} title={plainText(info.title)} size={256} width={128} />
      <div class="medal-heading"><h2>{resolvedName($names.resolved, "type", 29496, "Medal")}</h2><h3>{plainText(info.title)}</h3>
        {#if info.ownerID}
          <div class="issuer"><button type="button" class="logo" title={word(CLICK, "Click For Corporation Information")} aria-label={corpName} onclick={() => showInfo({ kind: "corporation", corporationID: info!.ownerID })}>
            {#if corpLogo && $library}<CorpLogo library={$library} logo={corpLogo} name={corpName} />
            {:else if npcLogo}<img src={clientTexture(npcLogo)} alt={corpName} />{:else}<span>{corpName}</span>{/if}
          </button>
          {#if !isNpcCorporation(info.ownerID)}<p>{formatted(ISSUED, "Issued by {corpName} [{tickerName}]", { corpName, tickerName: info.ticker ?? "" })}</p>{/if}</div>
        {/if}
        <p>{formatted(COUNT, "Awarded {numTimes} times", { numTimes: info.awarded })}</p>
      </div>
    </div>
    <h3 class="description-tab">{word(DESCRIPTION, "Description")}</h3><p class="description">{plainText(info.description)}</p>
  {/if}
</section>

<style>
  .medal-header { display: flex; align-items: flex-start; gap: 12px; }
  .medal-header :global(svg[role="img"]) { flex-shrink: 0; width: 128px; }
  .medal-heading { min-width: 0; }
  h2, h3 { margin: 0 0 8px; }
  .issuer { display: flex; align-items: flex-start; gap: 8px; }
  .logo { width: 64px; height: 64px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; flex-shrink: 0; }
  .logo img { width: 64px; height: 64px; object-fit: contain; }
  .description-tab { border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  .description { white-space: pre-wrap; }
</style>
