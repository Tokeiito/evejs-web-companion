<script lang="ts">
  // The wallet's Overview tab (overviewPanel.py; bridge/walletOverview.ts): the last thirty days' income or expenses as
  // a donut of their groups, each in its group's colour, with the total the short way in its middle; beside it Income
  // and Expenses, each with its total, and each group as "12.3% Name". A group chosen (its segment or its entry) shows
  // its kinds, in shades of its colour; Back returns to the groups.
  //
  // Read as the tab is shown (OnTabSelect), from what the account and market services keep.
  //
  // Not done: the donut's animation and its glow.
  import { onMount } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { GROUP_LABELS, SHORT_AMOUNT_LABELS, overviewSides, segmentColor, shortAmount, type OverviewGroup } from "../bridge/walletOverview.ts";
  import { resolvedName, type NameKind, type NameRef } from "../store/names.ts";
  import type { JsonValue } from "../bridge/wire.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const read = flow.walletOverview;
  // svelte-ignore state_referenced_locally
  const trades = flow.marketTransactions;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  const W = "UI/Wallet/WalletWindow";
  const WORDS = {
    income: `${W}/Income`,
    expenses: `${W}/Expenses`,
    last30Income: `${W}/Last30DaysIncome`,
    last30Expenses: `${W}/Last30DaysExpenses`,
    bought: `${W}/ItemsBought`,
    sold: `${W}/ItemsSold`,
    none: `${W}/HintNoTransactionsFound`,
    isk: "UI/Util/FmtIsk",
    back: "UI/Commands/Back",
  } as const;
  const nameOf = (kind: NameKind, id: number): string => resolvedName($names.resolved, kind, id, "");
  const word = (label: string, own: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? plainText(template) : own;
  };
  const said = (label: string, args: Readonly<Record<string, JsonValue>>): string | null => {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf })) : null;
  };

  // The words and names the groups need.
  $effect(() => {
    const labels = new Set<string>([...Object.values(WORDS), ...Object.values(GROUP_LABELS), ...SHORT_AMOUNT_LABELS]);
    for (const kind of $read.kinds.values()) if (kind.nameID) labels.add(`#${kind.nameID}`);
    flow.requestWords([...labels]);
    const refs: NameRef[] = $trades.transactions.map((trade) => ({ kind: "typeCategory", id: trade.typeID }));
    if (refs.length > 0) flow.requestNames(refs);
  });

  /** GetRefTypeKeyByID(...).entryTypeName: by its message, or the server's while that is not to hand; null for a kind GetEntryTypes has not. */
  function kindName(entryTypeID: number): string | null {
    const kind = $read.kinds.get(entryTypeID);
    if (kind === undefined) return null;
    const byMessage = kind.nameID ? $words.templates[`#${kind.nameID}`] : undefined;
    return typeof byMessage === "string" && byMessage !== "" ? plainText(byMessage) : kind.name;
  }

  let incomeShown = $state(true);
  let chosenGroup = $state<number | null>(null);
  const sides = $derived(overviewSides($read.lines, $trades.transactions, chosenGroup, {
    kindName,
    groupName: (group) => word(GROUP_LABELS[group] ?? GROUP_LABELS[7]!, "Other"),
    categoryName: (typeID) => nameOf("typeCategory", typeID),
    itemsWords: (bought, categoryName) => said(bought ? WORDS.bought : WORDS.sold, { groupName: categoryName }) ?? `${bought ? "Bought" : "Sold"}: ${categoryName}`,
  }));
  // The radio buttons' totals are the groups' (UpdateRadioButtons, before a group is chosen).
  let totals = $state({ income: 0, expenses: 0 });
  $effect(() => {
    if (chosenGroup === null) totals = { income: sides.totalIncome, expenses: sides.totalExpenses };
  });
  const groups = $derived(incomeShown ? sides.income : sides.expenses);
  const total = $derived(incomeShown ? sides.totalIncome : sides.totalExpenses);

  /** FmtISK: grouped, with its cents. */
  const isk = (amount: number): string => said(WORDS.isk, { amount }) ?? `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ISK`;
  /** OverviewPanelRadioButton.SetISKAmount: a "+" before an amount not less than nought. */
  const signed = (amount: number): string => `${amount >= 0 ? "+" : ""}${isk(amount)}`;
  const ratioText = (group: OverviewGroup): string => `${(group.ratio * 100).toFixed(1)}% ${group.name}`;

  // The donut (DonutChart): each segment its share, none under MIN_SEGMENT_SIZE of the circle.
  const RADIUS = 95;
  const LINE = 15;
  const CIRCLE = 2 * Math.PI * RADIUS;
  const MIN_SEGMENT = 0.02;
  const segments = $derived.by(() => {
    if (groups.length === 0) return [];
    const values = groups.map((group) => Math.abs(group.amount));
    const sum = values.reduce((a, b) => a + b, 0) || 1;
    const raised = values.map((value) => Math.max(MIN_SEGMENT, value / sum));
    const scale = raised.reduce((a, b) => a + b, 0);
    let start = 0;
    return groups.map((group, index) => {
      const share = raised[index]! / scale;
      const segment = { group, start, share, color: segmentColor(group, index, groups.length) };
      start += share;
      return segment;
    });
  });

  function choose(group: OverviewGroup): void {
    // OnSegmentClicked and Entry.OnClick: a group of groups is opened; a kind is not.
    if (group.refTypeID === null) chosenGroup = group.refGroupID;
  }

  onMount(() => {
    void flow.loadWalletOverview().catch(() => undefined);
  });
</script>

<div class="wallet-overview">
  {#if $read.error}
    <p class="error">The read failed: {$read.error}</p>
  {:else if !$read.loaded}
    <p class="empty">Reading…</p>
  {:else}
    <div class="overview-body">
      <svg class="donut" viewBox="-115 -115 230 230" role="img" aria-label={incomeShown ? word(WORDS.last30Income, "30 Days Income") : word(WORDS.last30Expenses, "30 Days Expenses")}>
        {#if segments.length === 0}
          <circle r={RADIUS} fill="none" stroke="currentColor" stroke-opacity="0.1" stroke-width={LINE} />
        {:else}
          {#each segments as segment (segment.group.key)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle r={RADIUS} fill="none" stroke={segment.color} stroke-width={LINE}
              stroke-dasharray={`${segment.share * CIRCLE} ${CIRCLE}`} stroke-dashoffset={-segment.start * CIRCLE}
              transform="rotate(-90)" class:clickable={segment.group.refTypeID === null}
              onclick={() => choose(segment.group)}>
              <title>{ratioText(segment.group)}{"\n"}{isk(segment.group.amount)}</title>
            </circle>
          {/each}
        {/if}
        <text class="caption" text-anchor="middle" y={chosenGroup === null ? -2 : -14}>{shortAmount(total, said) ?? Math.trunc(total).toLocaleString("en-US")}</text>
        {#if chosenGroup !== null}
          <text class="title" text-anchor="middle" y="8">{word(GROUP_LABELS[chosenGroup] ?? GROUP_LABELS[7]!, "Other")}</text>
        {/if}
        <text class="sub" text-anchor="middle" y={chosenGroup === null ? 18 : 26}>{incomeShown ? word(WORDS.last30Income, "30 Days Income") : word(WORDS.last30Expenses, "30 Days Expenses")}</text>
      </svg>

      <div class="overview-side">
        <label class="side-choice">
          <input type="radio" name="wallet-overview-side" checked={incomeShown} onchange={() => (incomeShown = true)} />
          <span>{word(WORDS.income, "Income")}<br /><strong>{signed(totals.income)}</strong></span>
        </label>
        <label class="side-choice">
          <input type="radio" name="wallet-overview-side" checked={!incomeShown} onchange={() => (incomeShown = false)} />
          <span>{word(WORDS.expenses, "Expenses")}<br /><strong>{signed(totals.expenses)}</strong></span>
        </label>
        <ul class="overview-entries">
          {#each segments as segment (segment.group.key)}
            <li>
              <button type="button" class="overview-entry" title={isk(segment.group.amount)} onclick={() => choose(segment.group)}>
                <span class="swatch" style:background={segment.color}></span>{ratioText(segment.group)}
              </button>
            </li>
          {:else}
            <li class="empty">{word(WORDS.none, "No transactions found")}</li>
          {/each}
        </ul>
        {#if chosenGroup !== null}
          <button type="button" class="minor" onclick={() => (chosenGroup = null)}>{word(WORDS.back, "Back")}</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .wallet-overview .overview-body { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; }
  .wallet-overview .donut { width: min(100%, 15rem); height: auto; color: var(--color-text); }
  .wallet-overview .donut .clickable { cursor: pointer; }
  .wallet-overview .donut .caption { font-size: 22px; fill: var(--color-text-bright); }
  .wallet-overview .donut .title { font-size: 11px; font-weight: 600; fill: var(--color-text); }
  .wallet-overview .donut .sub { font-size: 10px; fill: var(--color-muted); }
  .wallet-overview .overview-side { display: flex; flex-direction: column; gap: 0.35rem; min-width: 12rem; }
  .wallet-overview .side-choice { display: flex; gap: 0.4rem; align-items: flex-start; }
  .wallet-overview .overview-entries { list-style: none; margin: 0.5rem 0 0; padding: 0; }
  .wallet-overview .overview-entry { background: none; border: none; padding: 0.1rem 0; font: inherit; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 0.4rem; text-align: left; }
  .wallet-overview .swatch { display: inline-block; width: 10px; height: 10px; flex: none; }
</style>
