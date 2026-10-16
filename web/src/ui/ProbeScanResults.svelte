<script lang="ts">
  // The probe scanner's results (bridge/probeResults.ts): the session's system's results as the client's scan handler
  // keeps them from OnSystemScanStopped, listed as its results scroll lists them (scanResults.py, ScanResultNew):
  // distance from the ship, ID, name, group and signal strength, by ID; the client's words for "no results" where
  // there are none. Plain text: no icon, no colour by certainty, no Warp To button for a perfect result yet.
  //
  // A row's menu has the client's two orders of its own (scanResults.result_menu, 188 and 189): Ignore Result and
  // Ignore Other Results, the row the menu is on (the client's selected rows, or that one). The ignored are left out
  // of the list and counted in the ignored box, shown where there is one (scannerToolsUIComponents.IgnoredBox, 121 to
  // 129), which lists each by "id (name)" to be shown again, and Clear All Ignored Results where there are two or
  // more (probeScannerPalette.LoadIgnoredTooltipPanel, 492 to 537). None of it is asked of the server.
  import { onMount } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { PROBE_RESULT_LABELS, PROBE_RESULT_WORD_LABELS, SCAN_GROUP, resultRows, type Vec3 } from "../bridge/probeResults.ts";
  import { fmtDist } from "../space/overview.ts";
  import { nameKey, type NameKind } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const scanner = store.scanner;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const space = store.space;

  const held = $derived($scanner.probeResults);

  // The distances are from the ship, as the space read has it (michelle.GetMyPosition). This window shows live space
  // data, so it claims the space feed as every such window does (HudBar, SpaceOverview): on a screen with no HUD (the
  // phone's layout) nothing else asked, and no distance was shown (seen 2026-10-15).
  onMount(() => {
    void flow.loadSpaceSnapshot().catch(() => {});
    flow.startSpacePolling();
    return () => flow.stopSpacePolling();
  });

  $effect(() => {
    flow.requestWords(PROBE_RESULT_WORD_LABELS);
  });
  // What the rows are named with: a type's name, a group's name, an exploration site's dungeon name.
  $effect(() => {
    const results = held?.results ?? [];
    const refs: Array<{ kind: NameKind; id: number }> = [];
    const messages: string[] = [];
    for (const result of results) {
      const site = result.scanGroupID === SCAN_GROUP.signatures || result.scanGroupID === SCAN_GROUP.anomalies;
      if (site && result.dungeonNameID !== null) messages.push(`#${result.dungeonNameID}`);
      if (!site && result.typeID !== null) refs.push({ kind: "type", id: result.typeID });
      if (!site && result.groupID !== null) refs.push({ kind: "group", id: result.groupID });
    }
    if (refs.length > 0) flow.requestNames(refs);
    if (messages.length > 0) flow.requestWords(messages);
  });

  const word = (label: string, args: Record<string, string | number> = {}): string | null => {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf: () => "" })).trim() : null;
  };
  const nameOf = (kind: NameKind, id: number): string | null => {
    const name = $names.resolved[nameKey(kind, id)];
    return typeof name === "string" && name.trim() !== "" ? name : null;
  };
  // michelle.GetMyPosition: the ship's own ball, as the page's space read has it.
  const myPosition = $derived.by((): Vec3 | null => {
    const position = $space.snapshot?.ship?.position ?? null;
    return position === null ? null : [position.x, position.y, position.z];
  });
  const wording = {
    words: word,
    typeName: (typeID: number) => nameOf("type", typeID),
    groupName: (groupID: number) => nameOf("group", groupID),
    messageText: (messageID: number) => word(`#${messageID}`),
  };
  const ignoredIDs = $derived(new Set((held?.ignored ?? []).map((result) => result.id)));
  // scanHandler.GetResults: the ignored left out, and counted.
  const rows = $derived(held === null ? [] : resultRows(held.results.filter((result) => !ignoredIDs.has(result.id)), myPosition, wording));
  const ignoredCount = $derived(held === null ? 0 : held.results.filter((result) => ignoredIDs.has(result.id)).length);
  // scanSvc.GetIgnoredResultsDesc: each ignored one held, by ID, with its name.
  const ignoredRows = $derived(held === null ? [] : resultRows(held.ignored, myPosition, wording));

  let menuFor = $state<string | null>(null);
  let ignoredOpen = $state(false);
</script>

{#if held !== null}
  <section class="probe-results">
    {#if ignoredCount > 0 || ignoredRows.length > 0}
      <div class="ignored-box">
        <button type="button" class="minor" title={word(PROBE_RESULT_LABELS.resetIgnored) ?? "Show ignored results again"}
          aria-expanded={ignoredOpen} onclick={() => (ignoredOpen = !ignoredOpen)}>
          {word(PROBE_RESULT_LABELS.ignored, { noIgnored: ignoredCount }) ?? `${ignoredCount} Ignored`}
        </button>
        {#if ignoredOpen}
          <ul class="ignored-list">
            {#if ignoredRows.length > 1}
              <li><button type="button" class="minor" onclick={() => { flow.clearIgnoredProbeResults(); ignoredOpen = false; }}>
                {word(PROBE_RESULT_LABELS.clearAllIgnored) ?? "Clear All Ignored Results"}
              </button></li>
            {/if}
            {#each ignoredRows as ignoredRow (ignoredRow.id)}
              <li><button type="button" class="minor" onclick={() => flow.showIgnoredProbeResult(ignoredRow.id)}>
                {ignoredRow.name
                  ? word(PROBE_RESULT_LABELS.resultIdAndDesc, { id: ignoredRow.id, desc: ignoredRow.name }) ?? `${ignoredRow.id} (${ignoredRow.name})`
                  : ignoredRow.id}
              </button></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
    {#if rows.length === 0}
      <p class="note">{word(PROBE_RESULT_LABELS.noResults) ?? "No signatures or anomalies in current system"}</p>
    {:else}
      <table class="guests">
        <thead>
          <tr>
            <th>{word(PROBE_RESULT_LABELS.distance) ?? "Distance"}</th>
            <th>{word(PROBE_RESULT_LABELS.id) ?? "ID"}</th>
            <th>{word(PROBE_RESULT_LABELS.name) ?? "Name"}</th>
            <th>{word(PROBE_RESULT_LABELS.group) ?? "Group"}</th>
            <th class="num">{word(PROBE_RESULT_LABELS.signalStrength) ?? "Signal"}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            <tr>
              <td class="num">{row.distance === null ? "" : fmtDist(row.distance)}</td>
              <td>{row.id}</td>
              <td>{row.name}</td>
              <td>{row.group}</td>
              <td class="num">{row.signal}</td>
              <td>
                <button type="button" class="minor" aria-label="Result menu" aria-expanded={menuFor === row.id}
                  onclick={() => (menuFor = menuFor === row.id ? null : row.id)}>⋯</button>
                {#if menuFor === row.id}
                  <span class="result-menu">
                    <button type="button" class="minor" onclick={() => { flow.ignoreProbeResults([row.id]); menuFor = null; }}>
                      {word(PROBE_RESULT_LABELS.ignoreResult) ?? "Ignore Result"}
                    </button>
                    <button type="button" class="minor" onclick={() => { flow.ignoreOtherProbeResults([row.id]); menuFor = null; }}>
                      {word(PROBE_RESULT_LABELS.ignoreOtherResults) ?? "Ignore Other Results"}
                    </button>
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{/if}

<style>
  .ignored-box {
    margin-bottom: 0.4rem;
  }
  .ignored-list {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
  }
  .result-menu {
    display: inline-flex;
    gap: 0.3rem;
    margin-left: 0.3rem;
  }
</style>
