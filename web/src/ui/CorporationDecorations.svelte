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
  import { sortScrollRows } from "../bridge/scrollSort.ts";
  let { store, flow, active }: { store: ClientStore; flow: AppFlow; active: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words, names = store.names, changed = flow.corporationDecorationsChanged;
  // Ordinary Scroll; this preference belongs to the account's user section.
  // svelte-ignore state_referenced_locally
  const sortSetting = flow.scrollSortPreference("corp_decorations_scroll"), sortPreference = sortSetting.value;
  // svelte-ignore state_referenced_locally
  const widthsSetting = flow.scrollWidthsPreference("corp_decorations_scroll"), widthPreference = widthsSetting.value;
  const PREFIX = "UI/Corporations/CorporationWindow/Members/Decorations/";
  const HEADERS = [
    [PREFIX + "DecorationRecipient", "Decoration / Recipient"],
    [PREFIX + "DecorationIssuer", "Issuer"], ["UI/Common/Date", "Date"],
    [PREFIX + "DecorationReason", "Reason"], [PREFIX + "DecorationAwardedCount", "Awarded"],
  ];
  const TITLE = "UI/Corporations/BaseCorporationUI/Decorations";
  const EMPTY = PREFIX + "NoDecorationsFound";
  const AWARDEES = PREFIX + "ViewAwardees", INFO = "UI/Commands/ShowInfo";
  const NO_ITEM = "/Carbon/UI/Controls/Common/NoItem";
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  const headerNames = $derived(HEADERS.map(([label, fallback]) => word(label!, fallback!)));
  const sortIndex = $derived(Math.max(0, headerNames.indexOf($sortPreference.by ?? "")));
  let table = $state<HTMLTableElement>(), tableScroll = $state<HTMLDivElement>();
  let autoWidths = $state([120, 100, 150, 100, 80]);
  const columnWidths = $derived(headerNames.map((header, index) => Math.max(24, $widthPreference[header] ?? autoWidths[index]!)));
  let resizing = $state<{ index: number; pointer: number; startX: number; startWidth: number; left: number; max: number; line: number; guide: number } | null>(null);
  // GetTabStops1208-1252/MeasureTabstops306-343 fit loaded column text and
  // headers, with two 8px margins and an automatic minimum of32. This client
  // measures its own rendered font; persisted/manual widths have minimum24.
  function measureColumns(): number[] {
    if (!table) return autoWidths;
    const widthOf = (element: Element): number => {
      const range = document.createRange(); range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    };
    const measured = [...table.querySelectorAll("thead .sort-label")].map(element => Math.max(32, Math.ceil(widthOf(element) + 16)));
    for (const row of table.querySelectorAll<HTMLTableRowElement>("tbody tr[data-medal], tbody tr[data-awardee]")) {
      [...row.cells].forEach((cell, index) => {
        const style = getComputedStyle(cell), margins = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        measured[index] = Math.max(measured[index] ?? 32, Math.ceil(widthOf(cell) + margins));
      });
    }
    autoWidths = measured;
    return measured;
  }
  $effect(() => {
    const shown = active, currentTable = table, catalogue = rows, recipients = awardees, headers = headerNames, resolved = $names.resolved;
    if (shown && currentTable && catalogue) untrack(measureColumns);
  });
  function fitColumn(index: number): void { widthsSetting.set(headerNames[index]!, measureColumns()[index]!); }
  function startResize(event: PointerEvent, index: number): void {
    if (event.button !== 0 || !tableScroll) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLButtonElement;
    handle.setPointerCapture(event.pointerId);
    const cell = handle.closest("th")!.getBoundingClientRect(), scroll = tableScroll.getBoundingClientRect();
    const left = event.clientX - cell.width;
    resizing = { index, pointer: event.pointerId, startX: event.clientX, startWidth: cell.width, left, max: left + Math.max(24, scroll.right - 24 - cell.left), line: event.clientX, guide: event.clientX - scroll.left + tableScroll.scrollLeft };
  }
  function moveResize(event: PointerEvent): void {
    if (!resizing || event.pointerId !== resizing.pointer || !tableScroll) return;
    const line = Math.max(resizing.left + 24, Math.min(event.clientX, resizing.max));
    resizing = { ...resizing, line, guide: line - tableScroll.getBoundingClientRect().left + tableScroll.scrollLeft };
  }
  function endResize(event: PointerEvent, cancelled = false): void {
    if (!resizing || event.pointerId !== resizing.pointer) return;
    if (!cancelled && resizing.line !== resizing.startX) widthsSetting.set(headerNames[resizing.index]!, Math.max(24, Math.round(resizing.startWidth + resizing.line - resizing.startX)));
    resizing = null;
    const handle = event.currentTarget as HTMLButtonElement;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  function changeSort(index: number): void {
    sortSetting.set(headerNames[index]!, index === sortIndex ? !$sortPreference.reversed : false);
  }
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
  let canCreate = $state(false);
  let disposed = false, serial = 0, lastRevision = -1, wasActive = false;
  async function load(): Promise<void> {
    const request = ++serial;
    error = "";
    awardeeLoading = new Set();
    try {
      const enabled = await flow.corporationDecorationCreationEnabled();
      if (!disposed && request === serial) canCreate = enabled;
      const answer = await flow.corporationDecorations();
      if (!disposed && request === serial) {
        rows = answer.medals; graphics = answer.graphics;
        expanded = new Set(); previews = new Map(); previewErrors = new Map();
        awardeesOpen = new Set(); awardees = new Map(); awardeeErrors = new Map(); awardeeLoading = new Set();
        // Scroll.AddNode/PrepareSubContent1300-1339 reconstruct remembered
        // groups in catalogue order; nested remembered groups read lazily here.
        for (const row of answer.medals) {
          if (disposed || request !== serial) break;
          if (flow.corporationDecorationGroupOpen(row.medalID, false)) await expand(row.medalID, false);
        }
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
    flow.requestWords([TITLE, EMPTY, AWARDEES, INFO, NO_ITEM, PREFIX + "CreateDecorationButton", DATE_LABELS.ss!, ...HEADERS.map(([label]) => label!)]);
    void document.fonts.ready.then(() => { if (!disposed) measureColumns(); });
    return () => { disposed = true; ++serial; };
  });
  function date(value: bigint): string {
    return plainText(formatTemplate($words.templates[DATE_LABELS.ss!] ?? "", { datetime: { type: "long", value: value.toString() } }, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
  }
  function sortedAwardees(medalID: number): readonly CorporationMedalAwardee[] {
    return sortScrollRows(awardees.get(medalID) ?? [], row => [
      resolvedName($names.resolved, "owner", row.recipientID, "…"),
      resolvedName($names.resolved, "owner", row.issuerID, "…"),
      date(row.date), row.reason, String(row.awarded),
    ].join("<t>"), sortIndex, $sortPreference.reversed);
  }
  async function expand(medalID: number, remember = true): Promise<void> {
    const opening = !expanded.has(medalID);
    if (remember) flow.corporationDecorationGroupOpen(medalID, false, opening);
    if (!opening) {
      expanded = new Set([...expanded].filter(id => id !== medalID));
      awardeesOpen = new Set([...awardeesOpen].filter(id => id !== medalID));
      return;
    }
    try {
      const layers = medalLayersOf(graphics.filter(row => row.medalID === medalID));
      previews = new Map(previews).set(medalID, layers);
    } catch (cause) { previewErrors = new Map(previewErrors).set(medalID, String(cause instanceof Error ? cause.message : cause)); }
    expanded = new Set(expanded).add(medalID);
    if (!previewErrors.has(medalID) && flow.corporationDecorationGroupOpen(medalID, true)) await openAwardees(medalID);
  }
  async function expandAwardees(medalID: number): Promise<void> {
    const opening = !awardeesOpen.has(medalID);
    flow.corporationDecorationGroupOpen(medalID, true, opening);
    if (!opening) { awardeesOpen = new Set([...awardeesOpen].filter(id => id !== medalID)); return; }
    await openAwardees(medalID);
  }
  async function openAwardees(medalID: number): Promise<void> {
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
    <div class="table-scroll" bind:this={tableScroll}><table bind:this={table} style:width={`${columnWidths.reduce((sum, width) => sum + width, 0)}px`}>
      <colgroup>{#each columnWidths as width}<col style:width={`${width}px`} />{/each}</colgroup>
      <thead><tr>{#each headerNames as label, index}<th aria-sort={sortIndex === index ? $sortPreference.reversed ? "descending" : "ascending" : "none"}>
        <button type="button" class="sort" onclick={event => { if (event.detail === 0 || event.detail % 2 === 1) changeSort(index); }} ondblclick={() => fitColumn(index)}><span class="sort-label">{label}</span>{#if sortIndex === index}<span class="sort-arrow">{$sortPreference.reversed ? "▼" : "▲"}</span>{/if}</button>
        <button type="button" class="column-resize" aria-label={`Resize ${label}`} onpointerdown={event => startResize(event, index)} onpointermove={moveResize} onpointerup={event => endResize(event)} onpointercancel={event => endResize(event, true)} ondblclick={() => fitColumn(index)}></button>
      </th>{/each}</tr></thead>
      <tbody>{#each rows as row (row.medalID)}
        <tr title={plainText(row.description)} data-medal={row.medalID}>
          <td><button type="button" class="group" aria-expanded={expanded.has(row.medalID)} onclick={() => expand(row.medalID)}>{expanded.has(row.medalID) ? "▾" : "▸"} {plainText(row.title)}</button></td><td>{resolvedName($names.resolved, "owner", row.creatorID, "…")}</td>
          <td>{date(row.date)}</td><td></td><td>{row.awarded}</td>
        </tr>
        {#if expanded.has(row.medalID)}
          {#if previewErrors.has(row.medalID)}<tr><td colspan="5" class="error">{previewErrors.get(row.medalID)}</td></tr>
          {:else}
            <!-- Scroll.SortAsRoot keeps groups before ordinary entries. -->
            <tr><td colspan="5" class="awardee-group"><button type="button" class="group" aria-expanded={awardeesOpen.has(row.medalID)} onclick={() => { void expandAwardees(row.medalID); }}>{awardeesOpen.has(row.medalID) ? "▾" : "▸"} {word(AWARDEES, "View Awardees")}</button></td></tr>
            {#if awardeesOpen.has(row.medalID)}
              {#if awardeeLoading.has(row.medalID)}<tr><td colspan="5" class="note">Loading…</td></tr>
              {:else if awardeeErrors.has(row.medalID)}<tr><td colspan="5" class="error">{awardeeErrors.get(row.medalID)}</td></tr>
              {:else}{#each sortedAwardees(row.medalID) as awardee (awardee.recipientID)}
                <tr data-awardee={awardee.recipientID}>
                  <td class="awardee"><span>{resolvedName($names.resolved, "owner", awardee.recipientID, "…")}</span> <button type="button" class="minor" aria-label={`${word(INFO, "Show Info")}: ${resolvedName($names.resolved, "owner", awardee.recipientID, "…")}`} onclick={() => showInfo({ kind: "character", characterID: awardee.recipientID })}>i</button></td>
                  <td>{resolvedName($names.resolved, "owner", awardee.issuerID, "…")}</td><td>{date(awardee.date)}</td><td>{plainText(awardee.reason)}</td><td>{awardee.awarded}</td>
                </tr>
              {:else}<tr><td colspan="5" class="awardee note">{word(NO_ITEM, "No Item")}</td></tr>{/each}{/if}
            {/if}
            <tr><td colspan="5"><div class="medal-entry"><MedalPreview layers={previews.get(row.medalID) ?? []} title={plainText(row.title)} /><div><strong>{plainText(row.title)}</strong><div class="description">{plainText(row.description)}</div></div><button type="button" class="minor" aria-label={`${word(INFO, "Show Info")}: ${plainText(row.title)}`} onclick={() => showInfo({ kind: "medal", typeID: 29496, itemID: row.medalID, graphics: graphics.filter(g => g.medalID === row.medalID) })}>i</button></div></td></tr>
          {/if}
        {/if}
      {/each}</tbody>
    </table>{#if resizing}<div class="column-guide" style:left={`${resizing.guide}px`}></div>{/if}</div>
  {/if}
  {#if canCreate}<div class="creation"><button type="button" onclick={() => flow.showMedalDesigner()}>{word(PREFIX + "CreateDecorationButton", "Create Decoration")}</button></div>{/if}
</section>

<style>
  .creation { display: flex; justify-content: center; margin-top: 16px; }
  .table-scroll { overflow: auto; position: relative; }
  table { border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 7px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
  td:not([colspan]) { overflow: hidden; }
  th { color: var(--muted); font-weight: 500; position: relative; }
  .sort { border: 0; background: transparent; color: inherit; padding: 0; cursor: pointer; font: inherit; display: flex; width: 100%; text-align: left; min-width: 0; }
  .sort-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sort-arrow { flex: none; width: 16px; }
  .column-resize { position: absolute; right: -4px; top: 0; height: 100%; width: 8px; border: 0; background: transparent; padding: 0; cursor: col-resize; touch-action: none; z-index: 1; }
  .column-resize:hover, .column-resize:focus-visible { background: var(--border); }
  .column-guide { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--muted); pointer-events: none; }
  .group { border: 0; background: transparent; color: inherit; padding: 0; text-align: left; cursor: pointer; }
  .medal-entry { display: flex; align-items: flex-start; gap: 6px; padding-left: 16px; }
  .description { white-space: normal; }
  .awardee-group { padding-left: 26px; }
  .awardee { padding-left: 42px; }
</style>
