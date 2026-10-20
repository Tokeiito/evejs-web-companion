<script lang="ts">
  // corp_ui_member_decorations.LoadDecorations55-87: the catalogue slice.
  // Expanding medal details/awardees and the creation window are separate ports.
  import { onMount, untrack } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { CorporationDecoration } from "../bridge/corporationDecorations.ts";
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
  const word = (label: string, fallback: string) => plainText($words.templates[label] ?? fallback);
  let rows = $state<readonly CorporationDecoration[] | null>(null);
  let error = $state("");
  let disposed = false, serial = 0, lastRevision = -1, wasActive = false;
  async function load(): Promise<void> {
    const request = ++serial;
    error = "";
    try {
      const answer = await flow.corporationDecorations();
      if (!disposed && request === serial) rows = answer.medals;
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
    flow.requestWords([TITLE, EMPTY, DATE_LABELS.ss!, ...HEADERS.map(([label]) => label!)]);
    return () => { disposed = true; ++serial; };
  });
  function date(row: CorporationDecoration): string {
    return plainText(formatTemplate($words.templates[DATE_LABELS.ss!] ?? "", { datetime: { type: "long", value: row.date.toString() } }, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, "") }));
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
          <td>{plainText(row.title)}</td><td>{resolvedName($names.resolved, "owner", row.creatorID, "…")}</td>
          <td>{date(row)}</td><td></td><td>{row.awarded}</td>
        </tr>
      {/each}</tbody>
    </table></div>
  {/if}
</section>

<style>
  .table-scroll { overflow: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 7px 10px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
  th { color: var(--muted); font-weight: 500; }
</style>
