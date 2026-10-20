<script lang="ts">
  // corp_ui_member_decorations.LoadDecorations/GetDecorationSubContent/
  // GetMedalSubContent55-149: catalogue, local preview, then lazy awardees.
  import { onMount, untrack } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { medalLayersOf, type CorporationDecoration, type CorporationDecorationGraphic, type CorporationMedalAwardee, type MedalLayer } from "../bridge/corporationDecorations.ts";
  import MedalPreview from "./MedalPreview.svelte";
  import { showInfo } from "./showInfo.ts";
  import { DATE_LABELS, formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { resolvedName } from "../store/names.ts";
  let { store, flow, active }: { store: ClientStore; flow: AppFlow; active: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words, names = store.names, changed = flow.corporationDecorationsChanged;
  const PREFIX = "UI/Corporations/CorporationWindow/Members/Decorations/";
  const HEADERS = [
    [PREFIX + "DecorationRecipient", "Decoration / Recipient"],
    [PREFIX + "DecorationIssuer", "Issuer"], ["UI/Common/Date", "Date"],
    [PREFIX + "DecorationReason", "Reason"], [PREFIX + "DecorationAwardedCount", "Awarded"],
  ];
  const TITLE = "UI/Corporations/BaseCorporationUI/Decorations";
  const EMPTY = PREFIX + "NoDecorationsFound";
  const AWARDEES = PREFIX + "ViewAwardees", INFO = "UI/Commands/ShowInfo";
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  let rows = $state<readonly CorporationDecoration[] | null>(null);
  let graphics = $state<readonly CorporationDecorationGraphic[]>([]);
  let expanded = $state(new Set<number>());
  let previews = $state(new Map<number, readonly MedalLayer[]>());
  let awardeesOpen = $state(new Set<number>());
  let awardees = $state(new Map<number, readonly CorporationMedalAwardee[]>());
  let awardeeErrors = $state(new Map<number, string>());
  let previewErrors = $state(new Map<number, string>());
  let awardeeLoading = $state(new Set<number>());
  let error = $state("");
  let disposed = false, serial = 0, lastRevision = -1, wasActive = false;
  async function load(): Promise<void> {
    const request = ++serial;
    error = "";
    awardeeLoading = new Set();
    try {
      const answer = await flow.corporationDecorations();
      if (!disposed && request === serial) {
        rows = answer.medals; graphics = answer.graphics;
        expanded = new Set(); previews = new Map(); previewErrors = new Map();
        awardeesOpen = new Set(); awardees = new Map(); awardeeErrors = new Map(); awardeeLoading = new Set();
      }
    } catch (cause) {
      if (!disposed && request === serial) error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  $effect(() => {
    const shown = active, revision = $changed;
    const reload = shown && !wasActive || lastRevision !== -1 && revision !== lastRevision;
    wasActive = shown; lastRevision = revision;
    if (reload) untrack(() => { void load(); });
  });
  onMount(() => {
    flow.requestWords([TITLE, EMPTY, AWARDEES, INFO, DATE_LABELS.ss!, ...HEADERS.map(([label]) => label!)]);
    return () => { disposed = true; ++serial; };
  });
  function date(value: bigint): string {
    return plainText(formatTemplate($words.templates[DATE_LABELS.ss!] ?? "", { datetime: { type: "long", value: value.toString() } }, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }
  function expand(medalID: number): void {
    if (expanded.has(medalID)) { expanded = new Set([...expanded].filter(id => id !== medalID)); return; }
    try {
      const layers = medalLayersOf(graphics.filter(row => row.medalID === medalID));
      previews = new Map(previews).set(medalID, layers);
    } catch (cause) { previewErrors = new Map(previewErrors).set(medalID, String(cause instanceof Error ? cause.message : cause)); }
    expanded = new Set(expanded).add(medalID);
  }
  async function expandAwardees(medalID: number): Promise<void> {
    if (awardeesOpen.has(medalID)) { awardeesOpen = new Set([...awardeesOpen].filter(id => id !== medalID)); return; }
    awardeesOpen = new Set(awardeesOpen).add(medalID);
    if (awardeeLoading.has(medalID)) return;
    awardeeLoading = new Set(awardeeLoading).add(medalID);
    awardeeErrors = new Map([...awardeeErrors].filter(([id]) => id !== medalID));
    const request = serial;
    try {
      const answer = await flow.corporationMedalAwardees(medalID);
      if (!disposed && request === serial) awardees = new Map(awardees).set(medalID, answer);
    } catch (cause) {
      if (!disposed && request === serial) awardeeErrors = new Map(awardeeErrors).set(medalID, cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!disposed && request === serial) awardeeLoading = new Set([...awardeeLoading].filter(id => id !== medalID));
    }
  }
</script>

<section class="decorations" aria-label={word(TITLE, "Decorations")}>
  <header class="panel-head"><h2 class="panel-title">{word(TITLE, "Decorations")}</h2></header>
  {#if error}<p class="error">{error}</p>{/if}
  {#if rows === null}<p class="note">Loading…</p>
  {:else if rows.length === 0}<p class="empty">{word(EMPTY, "No decorations found")}</p>
  {:else}
    <div class="table-scroll"><table>
      <thead><tr>{#each HEADERS as [label, fallback]}<th>{word(label!, fallback!)}</th>{/each}</tr></thead>
      <tbody>{#each rows as row (row.medalID)}
        <tr title={plainText(row.description)} data-medal={row.medalID}>
          <td><button type="button" class="group" aria-expanded={expanded.has(row.medalID)} onclick={() => expand(row.medalID)}>{expanded.has(row.medalID) ? "▾" : "▸"} {plainText(row.title)}</button></td><td>{resolvedName($names.resolved, "owner", row.creatorID, "…")}</td>
          <td>{date(row.date)}</td><td></td><td>{row.awarded}</td>
        </tr>
        {#if expanded.has(row.medalID)}
          {#if previewErrors.has(row.medalID)}<tr><td colspan="5" class="error">{previewErrors.get(row.medalID)}</td></tr>
          {:else}
            <tr><td colspan="5"><div class="medal-entry"><MedalPreview layers={previews.get(row.medalID) ?? []} title={plainText(row.title)} /><div><strong>{plainText(row.title)}</strong><div class="description">{plainText(row.description)}</div></div></div></td></tr>
            <tr><td colspan="5" class="awardee-group"><button type="button" class="group" aria-expanded={awardeesOpen.has(row.medalID)} onclick={() => { void expandAwardees(row.medalID); }}>{awardeesOpen.has(row.medalID) ? "▾" : "▸"} {word(AWARDEES, "View Awardees")}</button></td></tr>
            {#if awardeesOpen.has(row.medalID)}
              {#if awardeeLoading.has(row.medalID)}<tr><td colspan="5" class="note">Loading…</td></tr>
              {:else if awardeeErrors.has(row.medalID)}<tr><td colspan="5" class="error">{awardeeErrors.get(row.medalID)}</td></tr>
              {:else}{#each awardees.get(row.medalID) ?? [] as awardee (awardee.recipientID)}
                <tr data-awardee={awardee.recipientID}>
                  <td class="awardee"><span>{resolvedName($names.resolved, "owner", awardee.recipientID, "…")}</span> <button type="button" class="minor" aria-label={`${word(INFO, "Show Info")}: ${resolvedName($names.resolved, "owner", awardee.recipientID, "…")}`} onclick={() => showInfo({ kind: "character", characterID: awardee.recipientID })}>i</button></td>
                  <td>{resolvedName($names.resolved, "owner", awardee.issuerID, "…")}</td><td>{date(awardee.date)}</td><td>{plainText(awardee.reason)}</td><td>{awardee.awarded}</td>
                </tr>
              {/each}{/if}
            {/if}
          {/if}
        {/if}
      {/each}</tbody>
    </table></div>
  {/if}
</section>

<style>
  .table-scroll { overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 7px 10px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
  th { color: var(--muted); font-weight: 500; }
  .group { border: 0; background: transparent; color: inherit; padding: 0; text-align: left; cursor: pointer; }
  .medal-entry { display: flex; align-items: flex-start; gap: 6px; padding-left: 16px; }
  .description { white-space: normal; }
  .awardee-group { padding-left: 26px; }
  .awardee { padding-left: 42px; }
</style>
