<script lang="ts">
  // Original compiled CorpQueryMembersForm and CorpMembersViewSimple.
  import { onMount, onDestroy } from "svelte";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import { MEMBER_QUERY_LABEL as P, MEMBER_QUERY_PROPERTIES, memberQueryControl, memberQueryOperators, memberQueryDate, type MemberQueryCriterion, type MemberQueryProperty, type MemberQueryControl, type MemberQueryContext } from "../bridge/corporationMemberQuery.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import type { JsonValue } from "../bridge/wire.ts";
  import { resolvedName } from "../store/names.ts";
  import { showOwnerInfo } from "./ownerInfo.ts";
  import { doubleClickOwner } from "./ownerDoubleClick.ts";
  let { store, flow, active = false }: { store: ClientStore; flow: AppFlow; active?: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally (flow and account are fixed for this panel instance)
  const implied = flow.memberQueryPreference("FMBQincludeImplied");
  // svelte-ignore state_referenced_locally (flow and account are fixed for this panel instance)
  const titles = flow.memberQueryPreference("FMBQsearchTitles");
  const impliedValue = implied.value, titlesValue = titles.value;
  let context = $state<MemberQueryContext | null>(null), error = $state("");
  let opened = $state(false), showQuery = $state(true), showOptions = $state(false);
  $effect(() => { if (active) opened = true; });
  let property = $state<MemberQueryProperty>("roles"), operator = $state(7), join = $state<1 | 2>(1);
  const control = $derived(memberQueryControl(property));
  let values = $state<Record<MemberQueryControl, string | number | bigint | null>>({ role: null, locational: null, title: null, base: null, date: null, text: "" });
  let bases = $state<readonly { readonly stationID: number; readonly name: string }[] | null>(null);
  let dateParts = $state<readonly [number, number, number]>([2003, 1, 1]), dateMaxYear = $state(2003);
  let dateReady = $state(false);
  type Node = { readonly row: MemberQueryCriterion; readonly label: string };
  let nodes = $state<Node[]>([]), editing = $state<Node | null>(null), editMode = $state(false);
  let ids = $state<readonly number[]>([]), viewFrom = $state(0), perPage = $state(10), pending = $state(0);
  const pageIDs = $derived(ids.slice(viewFrom, viewFrom + perPage));
  let chosen = $state<number[]>([]);
  let anchor: number | null = null, disposed = false;
  const current = () => { if (disposed) throw new Error("This member query window has closed."); };
  const word = (key: string, fallback = key) => plainText($words.templates[key.includes("/") ? key : P + key] ?? fallback);
  const formatted = (key: string, args: Record<string, JsonValue>, fallback: string) => plainText(formatTemplate($words.templates[P + key] ?? fallback, args, { nameOf: (kind, id) => resolvedName($names.resolved, kind, id, String(id)) }));
  const asWire = (value: MemberQueryCriterion["value"]): JsonValue => typeof value === "bigint" ? { type: "long", value: String(value) } : value;
  function label(row: MemberQueryCriterion): string {
    const propertyName = word(MEMBER_QUERY_PROPERTIES.find(p => p[0] === row.property)![1]);
    const operatorName = word(memberQueryOperators(row.property).find(o => o[0] === row.operator)?.[1] ?? "", "");
    const joinName = row.join === null ? "" : word(row.join === 1 ? "LogicalOR" : "LogicalAND");
    const kind = memberQueryControl(row.property);
    let value = "";
    if (row.value) {
      if (kind === "role" || kind === "locational") value = context?.roles.find(r => r.value === BigInt(row.value!))?.name ?? "";
      else if (kind === "title") value = context?.titles.find(t => t.titleID === Number(row.value))?.titleName ?? "";
      else if (kind === "base") value = formatted("SearchQueryLocation", { location: asWire(row.value) }, "{location}");
      else if (kind === "date") value = formatted("SearchQueryDate", { date: asWire(row.value) }, "{[datetime]date}");
      else value = String(row.value);
    }
    const key = row.join && row.operator && row.value ? "FullSearchLabel" : row.join && row.operator ? "JoinOperatorSearchLabel" : row.join && row.value ? "JoinValueSearchLabel" : row.operator && row.value ? "OperatorValueSearchLabel" : row.operator ? "OperatorSearchLabel" : row.value ? "ValueSearchLabel" : row.join ? "JoinSearchLabel" : "DefaultSearchLabel";
    const fallback = [row.join ? "{joinOperator}" : "", "{property}", row.operator ? "{operator}" : "", row.value ? "{value}" : ""].filter(Boolean).join(" ");
    return formatted(key, { joinOperator: joinName, property: propertyName, operator: operatorName, value }, fallback);
  }
  function draft(): MemberQueryCriterion {
    const value = control === "text" ? String(values.text ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;") : values[control];
    return { join: editing && editMode ? editing.row.join === null ? null : join : nodes.length ? join : null, property, operator, value };
  }
  async function propertyChanged(next: MemberQueryProperty): Promise<void> {
    property = next; operator = memberQueryOperators(next)[0]![0];
    if (memberQueryControl(next) === "base" && bases === null) {
      try { bases = await flow.corporationMemberQueryBases(current); } catch (cause) { if (!disposed) error = String(cause); }
    }
    if (memberQueryControl(next) === "date" && !dateReady) {
      try {
        const latest = await flow.corporationMemberQueryContext(current); current();
        dateParts = latest.today; dateMaxYear = latest.today[0]; values.date = memberQueryDate(...dateParts); dateReady = true;
      } catch (cause) { if (!disposed) error = String(cause); }
    }
  }
  function updateDate(part: number, value: number): void {
    const next = [...dateParts] as [number, number, number]; next[part] = value;
    next[2] = Math.min(next[2], new Date(Date.UTC(next[0], next[1], 0)).getUTCDate());
    dateParts = next; values.date = memberQueryDate(...next);
  }
  async function add(): Promise<void> {
    const row = draft();
    if (!row.value) {
      try { await flow.corporationMemberQueryNeedsValue(current); } catch (cause) { if (!disposed) error = String(cause); }
      return;
    }
    nodes = [...nodes, { row, label: label(row) }];
  }
  async function edit(node: Node): Promise<void> {
    // Native TwoButtons passes the label, and GetEntryByLabel finds the first.
    editing = nodes.find(n => n.label === node.label) ?? null;
    if (!editing) return;
    const row = editing.row;
    await propertyChanged(row.property); if (disposed) return;
    operator = row.operator; if (row.join !== null) join = row.join;
    values[memberQueryControl(row.property)] = row.property === "characterID" && typeof row.value === "string" ? row.value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").slice(0, 37) : row.value;
    if (memberQueryControl(row.property) === "date" && typeof row.value === "bigint") {
      const date = new Date(Number((row.value - 116444736000000000n) / 10000n));
      dateParts = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    }
    editMode = true;
  }
  function save(): void {
    if (!editing) return;
    const row = draft();
    nodes = nodes.map(node => node === editing ? { row, label: label(row) } : node);
    editing = null; editMode = false;
  }
  function remove(node: Node): void {
    const target = nodes.find(n => n.label === node.label);
    nodes = nodes.filter(n => n !== target);
    if (nodes[0]?.row.join !== null && nodes[0]) {
      const row = { ...nodes[0].row, join: null };
      nodes = [{ row, label: label(row) }, ...nodes.slice(1)];
    }
    editMode = false;
  }
  async function execute(): Promise<void> {
    pending++; error = "";
    try { const result = await flow.corporationMemberQuery(nodes.map(n => n.row), current); if (!disposed) { ids = result; chosen = []; } }
    catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (!disposed) pending--; }
  }
  function select(event: MouseEvent | KeyboardEvent, id: number): void {
    // SimpleView slices before Scroll.Load: selection operates on this page's nodes.
    const at = pageIDs.indexOf(id), ctrl = event.ctrlKey || event.metaKey;
    const ranged = anchor !== null && anchor !== at;
    const range = ranged ? pageIDs.slice(Math.min(anchor!, at), Math.max(anchor!, at) + 1) : [];
    if (event.shiftKey && ctrl) { if (ranged) chosen = [...new Set([...chosen, ...range])]; }
    else if (event.shiftKey && ranged) { chosen = [...range]; return; }
    else if (ctrl) chosen = chosen.includes(id) ? chosen.filter(n => n !== id) : [...chosen, id];
    else chosen = [id];
    anchor = at;
  }
  function info(id: number, double = false): void {
    void (double ? doubleClickOwner(flow, id) : showOwnerInfo(flow, id)).catch(cause => { if (!disposed) error = String(cause); });
  }
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  onMount(() => {
    const labels = ["HideQuery", "ShowQuery", "LogicalOR", "LogicalAND", "AddCriteria", "Save", "Edit", "Remove", "ExecuteQuery", "SearchTitles", "IncludeImpliedRoles", "NoQueryCriteriaAdded", "SimpleList", "SearchQueryLocation", "SearchQueryDate", "FullSearchLabel", "JoinOperatorSearchLabel", "JoinValueSearchLabel", "OperatorValueSearchLabel", "OperatorSearchLabel", "ValueSearchLabel", "JoinSearchLabel", "DefaultSearchLabel", "SimpleView/MembersPerPage", ...MEMBER_QUERY_PROPERTIES.map(p => p[1]), ...MEMBER_QUERY_PROPERTIES.flatMap(p => memberQueryOperators(p[0]).map(o => o[1]))];
    flow.requestWords([...labels.map(l => P + l), "UI/Commands/Cancel", "UI/Common/Previous", "UI/Common/ViewMore", "UI/Wallet/WalletWindow/SearchNoResults", "UI/Commands/ShowInfo", ...["Year", "Month", "Day"].map(p => "UI/Common/DateWords/" + p), ...MONTHS.map(m => "UI/Common/Months/" + m)]);
    void flow.corporationMemberQueryContext(current).then(result => {
      if (disposed) return;
      context = result; values.role = result.roles.find(r => !r.locational)?.value ?? null; values.locational = result.roles.find(r => r.locational)?.value ?? null; values.title = result.titles[0]?.titleID ?? null;
    }, cause => { if (!disposed) error = String(cause); });
    const unsubscribes = [impliedValue, titlesValue].map(signal => {
      let first = true;
      return signal.subscribe(() => { if (first) { first = false; return; } if (opened) void execute(); });
    });
    return () => unsubscribes.forEach(unsubscribe => unsubscribe());
  });
  onDestroy(() => { disposed = true; });
</script>

{#if opened}
<section aria-label={word("UI/Corporations/BaseCorporationUI/FindMemberInRole", "Find Member in Role")}>
  {#if error}<p class="error">{error}</p>{/if}
  {#if context}
    <div class="query-toggle"><button type="button" class="minor" onclick={() => showQuery = !showQuery}>{word(showQuery ? "HideQuery" : "ShowQuery")}</button></div>
    <div hidden={!showQuery}>
      <div class="criteria-inputs">
        {#if editMode ? editing?.row.join !== null : nodes.length > 0}<select aria-label="Join operator" bind:value={join}><option value={1}>{word("LogicalOR")}</option><option value={2}>{word("LogicalAND")}</option></select>{/if}
        <select aria-label="Query property" value={property} onchange={event => { void propertyChanged(event.currentTarget.value as MemberQueryProperty); }}>{#each MEMBER_QUERY_PROPERTIES as p}<option value={p[0]}>{word(p[1])}</option>{/each}</select>
        <select aria-label="Comparison operator" bind:value={operator}>{#each memberQueryOperators(property) as op}<option value={op[0]}>{word(op[1])}</option>{/each}</select>
        {#if control === "role" || control === "locational"}
          <select aria-label="Query role" bind:value={values[control]}>{#each context.roles.filter(r => r.locational === (control === "locational")) as role}<option value={role.value}>{role.name}</option>{/each}</select>
        {:else if control === "title"}
          <select aria-label="Query title" bind:value={values.title}>{#each context.titles as title}<option value={title.titleID}>{title.titleName}</option>{/each}</select>
        {:else if control === "base"}
          <select aria-label="Query base" bind:value={values.base}><option value={null}>-</option>{#each bases ?? [] as base}<option value={base.stationID}>{base.name}</option>{/each}</select>
        {:else if control === "date"}
          {#if dateReady}<div class="date-inputs">
            <label>{word("UI/Common/DateWords/Year", "Year")}<select aria-label="Query year" value={dateParts[0]} onchange={e => updateDate(0, Number(e.currentTarget.value))}>{#each Array.from({ length: dateMaxYear - 2003 + 1 }, (_, i) => i + 2003) as year}<option value={year}>{year}</option>{/each}</select></label>
            <label>{word("UI/Common/DateWords/Month", "Month")}<select aria-label="Query month" value={dateParts[1]} onchange={e => updateDate(1, Number(e.currentTarget.value))}>{#each MONTHS as month, i}<option value={i + 1}>{word("UI/Common/Months/" + month, month)}</option>{/each}</select></label>
            <label>{word("UI/Common/DateWords/Day", "Day")}<select aria-label="Query day" value={dateParts[2]} onchange={e => updateDate(2, Number(e.currentTarget.value))}>{#each Array.from({ length: new Date(Date.UTC(dateParts[0], dateParts[1], 0)).getUTCDate() }, (_, i) => i + 1) as day}<option value={day}>{day}</option>{/each}</select></label>
          </div>{/if}
        {:else}
          <input aria-label="Query name" maxlength="37" bind:value={values.text} />
        {/if}
        {#if editMode}<button type="button" onclick={save}>{word("Save")}</button><button type="button" onclick={() => editMode = false}>{word("UI/Commands/Cancel", "Cancel")}</button>
        {:else}<button type="button" onclick={() => { void add(); }}>{word("AddCriteria")}</button>{/if}
      </div>
      <div class="criteria-list" role="list" aria-label="Query criteria">
        {#each nodes as node}<div role="listitem" class="criterion"><span>{node.label}</span><button type="button" onclick={() => { void edit(node); }}>{word("Edit")}</button><button type="button" onclick={() => remove(node)}>{word("Remove")}</button></div>
        {:else}<p>{word("NoQueryCriteriaAdded")}</p>{/each}
      </div>
      <div class="query-run"><button type="button" onclick={() => { void execute(); }}>{word("ExecuteQuery")}</button><button type="button" aria-label="Query options" aria-expanded={showOptions} onclick={() => showOptions = !showOptions}>⚙</button></div>
      {#if showOptions}<div class="query-options"><label><input type="checkbox" checked={$titlesValue} onchange={e => titles.set(e.currentTarget.checked)} />{word("SearchTitles")}</label><label><input type="checkbox" checked={$impliedValue} onchange={e => implied.set(e.currentTarget.checked)} />{word("IncludeImpliedRoles")}</label></div>{/if}
    </div>
    <h3>{word("SimpleList")}</h3>
    <div class="browse"><select aria-label="Members per page" bind:value={perPage} onchange={() => chosen = []}>{#each [10, 25, 50, 100, 500] as count}<option value={count}>{formatted("SimpleView/MembersPerPage", { num: count }, "{num} members per page")}</option>{/each}</select><span>{pending ? "…" : ""}</span>
      {#if viewFrom > 0}<button type="button" onclick={() => { viewFrom = Math.max(0, viewFrom - perPage); chosen = []; }}>{word("UI/Common/Previous", "Previous")}</button>{/if}
      {#if viewFrom + perPage < ids.length}<button type="button" onclick={() => { viewFrom += perPage; chosen = []; }}>{word("UI/Common/ViewMore", "View More")}</button>{/if}
    </div>
    <ul class="query-results" aria-label="Member query results">{#each pageIDs as id}
      {@const name = resolvedName($names.resolved, "owner", id, String(id))}
      <li class:selected={chosen.includes(id)}><button type="button" class="member-name" aria-pressed={chosen.includes(id)} onclick={event => select(event, id)} ondblclick={() => info(id, true)} onkeydown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); chosen = [...pageIDs]; } }}>{name}</button><button type="button" aria-label={`Show Info: ${name}`} onclick={() => info(id)}>ⓘ</button></li>
    {:else}<li>{word("UI/Wallet/WalletWindow/SearchNoResults", "No results found")}</li>{/each}</ul>
  {/if}
</section>
{/if}

<style>
  .query-toggle { display: flex; justify-content: flex-end; }
  .criteria-inputs, .query-run, .query-options, .browse, .date-inputs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .criteria-inputs { margin: 8px 0; }
  .criteria-inputs select, .criteria-inputs input { width: 146px; max-width: 100%; }
  .criteria-inputs > select[aria-label="Query property"] { width: 128px; }
  .criteria-inputs > select[aria-label="Comparison operator"] { width: 80px; }
  .criteria-inputs > select[aria-label="Join operator"] { width: 70px; }
  .date-inputs label { display: grid; gap: 2px; }
  .criteria-list { height: 110px; overflow: auto; margin-top: 16px; }
  .criterion { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
  .criterion span { flex: 1; }
  .query-run { justify-content: center; margin-top: 16px; }
  .query-options { margin-top: 8px; }
  .query-options label { display: flex; align-items: center; gap: 4px; }
  .browse { margin: 8px 0; }
  .browse span { flex: 1; }
  .query-results { list-style: none; padding: 0; max-height: 280px; overflow: auto; }
  .query-results li { display: flex; align-items: center; gap: 4px; padding: 4px; }
  .query-results .selected { outline: 1px solid var(--color-accent); }
  .member-name { flex: 1; text-align: left; }
</style>
