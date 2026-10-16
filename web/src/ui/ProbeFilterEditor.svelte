<script lang="ts">
  // The client's scanner filter editor (eve/client/script/ui/inflight/scannerfiltereditor.py ScannerFilterEditor), for a
  // new filter of the pilot's own or one to edit:
  //
  //   Filter Name (64 characters at most), "Select groups to filter" with a search, and the scan groups the editor
  //   lists (SCAN_GROUP_NAMES), each a folder of boxes with Select All and Deselect All on its menu (GetSubFolderMenu):
  //   a cosmic signature's box for each of its site types, any other group's box by the group's name; a search leaves
  //   out the boxes whose name does not hold it (LoadTypes, 116 to 167). Save and Cancel.
  //
  //   Save (SaveChanges, 81 to 113) refuses, in the client's words, a filter with no name (PleaseNameFilter), one named
  //   Show all (CannotNameFilter), one with no group (SelectGroupsForFilter), and a new one named as one of the
  //   pilot's already is (FilterAlreadyExists); it asks OverwriteFilter where a name already held is saved with other
  //   groups, or a filter is renamed; then makes the filter, or saves it over the one edited.
  //
  // None of it is asked of the server: the filters are the client's own, kept in the user's settings.
  import { onMount } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import {
    FILTER_EDITOR_CATEGORIES,
    PROBE_RESULT_LABELS,
    RESULT_FILTER_NAME_MAX,
    type CustomResultFilter,
    type ResultFilterSettings,
  } from "../bridge/probeResults.ts";
  import { nameKey } from "../store/names.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store, flow, editing = null, settings, onDone }: {
    store: ClientStore;
    flow: AppFlow;
    /** The filter edited (EditFilter), or null for a new one (AddFilter). */
    editing?: CustomResultFilter | null;
    /** The pilot's filters as they are: the names already held. */
    settings: ResultFilterSettings;
    onDone: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  // LoadData (61 to 75): the edited filter's name and groups, or none.
  // svelte-ignore state_referenced_locally
  const originalName = editing?.name ?? "";
  // svelte-ignore state_referenced_locally
  const originalGroups = [...(editing?.groups ?? [])].sort();
  // svelte-ignore state_referenced_locally
  let name = $state(editing?.name ?? "");
  // svelte-ignore state_referenced_locally
  let chosen = $state<Set<string>>(new Set(editing?.groups ?? []));
  let search = $state("");
  let notice = $state<string | null>(null);
  let asking = $state(false);

  function word(label: string, own: string, args: Record<string, string | number> = {}): string {
    const template = $words.templates[label];
    return plainText(formatTemplate(typeof template === "string" ? template : own, args, { nameOf: () => "" }));
  }

  const itemLabel = (item: (typeof FILTER_EDITOR_CATEGORIES)[number]["items"][number]): string => {
    if (item.siteTypeLabel !== null) return word(item.siteTypeLabel, item.siteTypeLabel.split("/").at(-1) ?? "");
    const groupName = $names.resolved[nameKey("group", item.groupID)];
    return typeof groupName === "string" && groupName !== "" ? groupName : `Group ${item.groupID}`;
  };

  // LoadTypes: the categories by their names, each item by its name, those the search leaves out left out.
  const categories = $derived.by(() => {
    const text = search.toLowerCase();
    return FILTER_EDITOR_CATEGORIES
      .map((category) => ({
        ...category,
        title: word(category.label, category.label.split("/").at(-1) ?? ""),
        items: category.items
          .map((item) => ({ ...item, title: itemLabel(item) }))
          .filter((item) => text === "" || item.title.toLowerCase().includes(text))
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .filter((category) => category.items.length > 0)
      .sort((a, b) => a.title.localeCompare(b.title));
  });

  function toggle(key: string, on: boolean): void {
    const next = new Set(chosen);
    if (on) next.add(key);
    else next.delete(key);
    chosen = next;
  }

  // SelectGroup (178 to 188): every box of the folder.
  function selectCategory(scanGroup: number, on: boolean): void {
    const next = new Set(chosen);
    for (const item of FILTER_EDITOR_CATEGORIES.find((each) => each.scanGroup === scanGroup)?.items ?? []) {
      if (on) next.add(item.key);
      else next.delete(item.key);
    }
    chosen = next;
  }

  function save(): void {
    notice = null;
    if (name === "") {
      notice = word(PROBE_RESULT_LABELS.pleaseNameFilter, "Give the filter a name.");
      return;
    }
    if (name.toLowerCase() === word(PROBE_RESULT_LABELS.showAll, "Show all").toLowerCase()) {
      notice = word(PROBE_RESULT_LABELS.cannotNameFilter, "A filter cannot be called that.");
      return;
    }
    const groups = [...chosen];
    if (groups.length === 0) {
      notice = word(PROBE_RESULT_LABELS.selectGroupsForFilter, "Choose at least one group for the filter.");
      return;
    }
    const existingNames = settings.custom.map((each) => each.name);
    if (existingNames.includes(name) && !originalName) {
      notice = word(PROBE_RESULT_LABELS.filterAlreadyExists, "A filter of that name already exists.");
      return;
    }
    const sameGroups = groups.length === originalGroups.length && [...groups].sort().every((key, i) => key === originalGroups[i]);
    if ((existingNames.includes(name) && !sameGroups) || (name !== originalName && originalName)) {
      asking = true;
      return;
    }
    finish(groups);
  }

  function finish(groups: readonly string[]): void {
    if (editing === null) flow.createProbeResultFilter(name, groups);
    else flow.editProbeResultFilter(editing.id, name, groups);
    onDone();
  }

  onMount(() => {
    flow.requestWords([
      ...Object.values(PROBE_RESULT_LABELS),
      ...FILTER_EDITOR_CATEGORIES.flatMap((category) => [category.label, ...category.items.flatMap((item) => (item.siteTypeLabel === null ? [] : [item.siteTypeLabel]))]),
      "dialog:OverwriteFilter/title",
      "dialog:OverwriteFilter/body",
    ]);
    flow.requestNames(FILTER_EDITOR_CATEGORIES.flatMap((category) => category.items.filter((item) => item.siteTypeLabel === null).map((item) => ({ kind: "group" as const, id: item.groupID }))));
  });
</script>

<section class="filter-editor" aria-label={word(PROBE_RESULT_LABELS.filterEditor, "Scanner Filter Editor")}>
  <h3>{word(PROBE_RESULT_LABELS.filterEditor, "Scanner Filter Editor")}</h3>
  <label>{word(PROBE_RESULT_LABELS.filterName, "Filter name")}
    <input type="text" maxlength={RESULT_FILTER_NAME_MAX} bind:value={name} />
  </label>
  <p class="filter-editor-head">
    <span>{word(PROBE_RESULT_LABELS.selectGroupsToFilter, "Select the groups to filter")}</span>
    <input type="search" aria-label="Search" bind:value={search} />
  </p>
  <div class="filter-editor-groups">
    {#each categories as category (category.scanGroup)}
      <details>
        <summary>{category.title} [{category.items.length}]</summary>
        <p class="controls">
          <button type="button" class="minor" onclick={() => selectCategory(category.scanGroup, true)}>{word(PROBE_RESULT_LABELS.selectAll, "Select all")}</button>
          <button type="button" class="minor" onclick={() => selectCategory(category.scanGroup, false)}>{word(PROBE_RESULT_LABELS.deselectAll, "Deselect all")}</button>
        </p>
        {#each category.items as item (item.key)}
          <label class="filter-editor-item"><input type="checkbox" checked={chosen.has(item.key)}
            onchange={(event) => toggle(item.key, event.currentTarget.checked)} /> {item.title}</label>
        {/each}
      </details>
    {/each}
  </div>
  {#if notice !== null}
    <p class="error">{notice}</p>
  {/if}
  {#if asking}
    <!-- OverwriteFilter (SaveChanges, 102 to 104): Yes and No, nothing kept. -->
    <div class="filter-editor-question" role="alertdialog">
      <strong>{word("dialog:OverwriteFilter/title", "Overwrite?")}</strong>
      <p>{word("dialog:OverwriteFilter/body", "Save the filter {filter} over the one there is?", { filter: name })}</p>
      <p class="controls">
        <button type="button" onclick={() => { asking = false; finish([...chosen]); }}>{word(PROBE_RESULT_LABELS.yes, "Yes")}</button>
        <button type="button" class="minor" onclick={() => (asking = false)}>{word(PROBE_RESULT_LABELS.no, "No")}</button>
      </p>
    </div>
  {/if}
  <p class="controls">
    <button type="button" onclick={save}>{word(PROBE_RESULT_LABELS.save, "Save")}</button>
    <button type="button" class="minor" onclick={onDone}>{word(PROBE_RESULT_LABELS.cancel, "Cancel")}</button>
  </p>
</section>

<style>
  .filter-editor {
    border: 1px solid currentColor;
    padding: 0.5rem;
    margin: 0.4rem 0;
  }
  .filter-editor-head {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
  }
  .filter-editor-groups {
    max-height: 18rem;
    overflow-y: auto;
  }
  .filter-editor-item {
    display: block;
    margin-left: 1rem;
  }
  .filter-editor-question {
    border: 1px solid currentColor;
    padding: 0.4rem;
    margin: 0.4rem 0;
  }
</style>
