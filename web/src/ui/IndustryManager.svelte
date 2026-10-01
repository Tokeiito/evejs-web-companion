<script lang="ts">
  // INDUSTRY MANAGER (R109 slice 2): choose a blueprint, owned by a pilot or
  // any at all, and see everything it takes to build, down to raw materials.
  //
  // ⚠ A GLOBAL WINDOW WITH NO STORE, like Planetary Industry. A plan spans
  // every signed-in pilot's blueprints, so it reads each pilot's own industry
  // read on that pilot's own session and takes neither store nor flow.
  //
  // ⚠ NOTHING HERE SELECTS OR SIGNS IN A PILOT. The blueprint list is each
  // already-online pilot's industry read (the same read their Industry panel
  // makes); a pilot not online in this tab contributes nothing, and the picker
  // says so rather than reaching for them.
  //
  // ⚠ THE ARITHMETIC IS NOT HERE. bridge/industryChain.ts works the plan, once
  // per type, with the server's own rounding; this file draws it.
  import { onMount, untrack } from "svelte";
  import type { Session } from "../app/sessions.ts";
  import type { ApiOptions } from "../app/api.ts";
  import { getIndustryRecipeClosure, searchIndustryBlueprints } from "../app/api.ts";
  import {
    decodeBlueprintSearch,
    decodeRecipeClosure,
    type IndustryBlueprintMatch,
    type IndustryRecipeBook,
  } from "../bridge/industryRecipes.ts";
  import {
    resolveIndustryChain,
    shortLines,
    type IndustryLine,
    type IndustryNode,
  } from "../bridge/industryChain.ts";
  import {
    ownedBlueprints,
    ownedTerms,
    ownedWords,
    type OwnedBlueprint,
    type PilotBlueprintRead,
  } from "../bridge/industryOwned.ts";
  import { countWords } from "../bridge/piStock.ts";
  import TypeIcon from "./TypeIcon.svelte";

  let { sessions = [] }: { sessions?: readonly Session[] } = $props();

  /** What the plan is built from. */
  interface Target {
    readonly productTypeID: number;
    readonly blueprintName: string | null;
    readonly productName: string | null;
  }

  type Source = "owned" | "any";
  let source = $state<Source>("owned");

  // Bumped whenever a pilot's store moves, so the owned list re-reads.
  let storeTick = $state(0);
  let refreshing = $state(false);

  // The "Any" search.
  let query = $state("");
  let searching = $state(false);
  let searchError = $state<string | null>(null);
  let matches = $state<readonly IndustryBlueprintMatch[]>([]);
  let searchTotal = $state(0);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchSerial = 0;

  // The chosen target and its recipe book.
  let target = $state<Target | null>(null);
  let runsText = $state("1");
  let book = $state<IndustryRecipeBook | null>(null);
  let bookError = $state<string | null>(null);
  let loadingBook = $state(false);
  const books = new Map<number, IndustryRecipeBook>();

  // The player's choices for this plan: buy instead of build, per type.
  let buying = $state<Set<number>>(new Set());
  // Which tree nodes are folded or unfolded by hand; the rest follow depth.
  let treeOverride = $state<Map<string, boolean>>(new Map());

  /** Pilots online in this tab, each with its own session's request options. */
  function onlineSessions(): { session: Session; characterID: number; characterName: string }[] {
    const online: { session: Session; characterID: number; characterName: string }[] = [];
    for (const session of sessions) {
      const character = session.store.station.get().online;
      if (character) {
        online.push({ session, characterID: character.characterID, characterName: character.characterName });
      }
    }
    return online;
  }

  /**
   * Request options for the static reads. Any online pilot's session will do:
   * the answer is the same for everyone. With none online, the tab's own
   * sign-in is used.
   */
  function staticOptions(): ApiOptions {
    const first = onlineSessions()[0];
    return first ? first.session.flow.requestOptions() : {};
  }

  const reads = $derived.by((): PilotBlueprintRead[] => {
    void storeTick;
    return onlineSessions().map(({ session, characterID, characterName }) => {
      const industry = session.store.industry.get();
      return { characterID, characterName, blueprints: industry.blueprints, definitions: industry.definitions };
    });
  });
  const onlineCount = $derived(reads.length);
  const owned = $derived(ownedBlueprints(reads));
  const terms = $derived(ownedTerms(owned));
  const ownedChoice = $derived(
    target === null ? "" : String(owned.find((blueprint) => blueprint.productTypeID === target?.productTypeID)?.itemID ?? ""),
  );

  const runs = $derived.by((): number | null => {
    const value = Number(runsText.trim());
    return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000 ? value : null;
  });

  const chain = $derived.by(() => {
    if (target === null || book === null || runs === null) {
      return null;
    }
    const obtain = new Map<number, "build" | "buy">();
    for (const typeID of buying) {
      obtain.set(typeID, "buy");
    }
    return resolveIndustryChain({
      book,
      productTypeID: target.productTypeID,
      runs,
      choices: { obtain, blueprints: terms },
    });
  });
  const toBuy = $derived(chain ? shortLines(chain).filter((line) => line.obtain === "buy") : []);
  const jobCount = $derived(
    chain ? [...chain.lines.values()].reduce((sum, line) => sum + line.jobRuns.length, 0) : 0,
  );
  const targetName = $derived(
    (target && book?.types.get(target.productTypeID)?.name) ?? target?.productName ?? target?.blueprintName ?? null,
  );

  function nameOf(line: IndustryLine): string {
    return line.name ?? "An unnamed item";
  }

  async function refreshOwned(): Promise<void> {
    const online = onlineSessions();
    if (online.length === 0) {
      return;
    }
    refreshing = true;
    try {
      // Each pilot's own read, on its own session. One failing does not stop
      // the others; its blueprints simply stay as they were.
      await Promise.allSettled(online.map(({ session }) => session.flow.loadIndustry()));
    } finally {
      refreshing = false;
      storeTick += 1;
    }
  }

  async function loadBook(productTypeID: number): Promise<void> {
    const cached = books.get(productTypeID);
    if (cached) {
      book = cached;
      bookError = null;
      return;
    }
    loadingBook = true;
    bookError = null;
    book = null;
    try {
      const decoded = decodeRecipeClosure(await getIndustryRecipeClosure([productTypeID], staticOptions()));
      if (!decoded.readable) {
        bookError = "The recipes could not be read just now.";
        return;
      }
      books.set(productTypeID, decoded);
      if (target?.productTypeID === productTypeID) {
        book = decoded;
      }
    } catch {
      bookError = "The recipes could not be read just now.";
    } finally {
      loadingBook = false;
    }
  }

  function choose(next: Target, defaultRuns: number): void {
    target = next;
    runsText = String(defaultRuns);
    buying = new Set();
    treeOverride = new Map();
    void loadBook(next.productTypeID);
  }

  function chooseOwned(itemID: string): void {
    const blueprint = owned.find((candidate) => String(candidate.itemID) === itemID);
    if (!blueprint) {
      return;
    }
    choose(
      { productTypeID: blueprint.productTypeID, blueprintName: blueprint.blueprintName, productName: null },
      blueprint.runs ?? 1,
    );
  }

  function chooseMatch(match: IndustryBlueprintMatch): void {
    choose(
      { productTypeID: match.productTypeID, blueprintName: match.blueprintName, productName: match.productName },
      1,
    );
  }

  function onQuery(): void {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
    }
    const text = query.trim();
    if (text.length < 2) {
      matches = [];
      searchTotal = 0;
      searchError = null;
      return;
    }
    searchTimer = setTimeout(() => void runSearch(text), 250);
  }

  async function runSearch(text: string): Promise<void> {
    const serial = ++searchSerial;
    searching = true;
    searchError = null;
    try {
      const result = decodeBlueprintSearch(await searchIndustryBlueprints(text, staticOptions()));
      if (serial !== searchSerial) {
        return;
      }
      matches = result.matches;
      searchTotal = result.total;
    } catch {
      if (serial === searchSerial) {
        searchError = "The search could not be run just now.";
      }
    } finally {
      if (serial === searchSerial) {
        searching = false;
      }
    }
  }

  function setBuying(typeID: number, buy: boolean): void {
    const next = new Set(buying);
    if (buy) {
      next.add(typeID);
    } else {
      next.delete(typeID);
    }
    buying = next;
  }

  /** Open by default to two levels below the target; deeper folds. */
  function isOpen(node: IndustryNode): boolean {
    const forced = treeOverride.get(node.key);
    return forced ?? node.key.split(">").length <= 2;
  }

  function toggle(node: IndustryNode): void {
    const next = new Map(treeOverride);
    next.set(node.key, !isOpen(node));
    treeOverride = next;
  }

  function obtainWord(line: IndustryLine): string {
    return line.obtain === "react" ? "react" : line.obtain;
  }

  // Each pilot's store, watched so a read made elsewhere (their Industry panel,
  // a Refresh here) shows up in the list without asking again. Re-subscribed
  // when a pilot joins or leaves the tab.
  // ⚠ `subscribe` calls back at once, and the callback reads `storeTick` to
  // bump it; untracked, or this effect would depend on its own write.
  $effect(() => {
    const list = sessions;
    const stops = untrack(() =>
      list.flatMap((session) => [
        session.store.industry.subscribe(() => (storeTick += 1)),
        session.store.station.subscribe(() => (storeTick += 1)),
      ]),
    );
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  });

  onMount(() => {
    // Read the blueprints of any online pilot whose industry was never read.
    const unread = onlineSessions().filter(({ session }) => !session.store.industry.get().loaded);
    if (unread.length > 0) {
      refreshing = true;
      void Promise.allSettled(unread.map(({ session }) => session.flow.loadIndustry())).finally(() => {
        refreshing = false;
        storeTick += 1;
      });
    }
    return () => {
      if (searchTimer !== null) {
        clearTimeout(searchTimer);
      }
    };
  });
</script>

<section class="panel im-manager">
  <header class="panel-head">
    <h2 class="panel-title">Industry Manager</h2>
    <span class="controls">
      <button type="button" disabled={refreshing || onlineCount === 0} onclick={() => void refreshOwned()}>
        {refreshing ? "Looking..." : "Refresh"}
      </button>
    </span>
  </header>

  <div class="im-plan">
    <div class="im-pick">
      <div class="im-source" role="radiogroup" aria-label="Choose from">
        <button type="button" role="radio" class="im-source-item" class:on={source === "owned"} aria-checked={source === "owned"} onclick={() => (source = "owned")}>Owned</button>
        <button type="button" role="radio" class="im-source-item" class:on={source === "any"} aria-checked={source === "any"} onclick={() => (source = "any")}>Any</button>
      </div>

      {#if source === "owned"}
        {#if onlineCount === 0}
          <p class="im-note">Sign a pilot in here to list their blueprints.</p>
        {:else if owned.length === 0}
          <p class="im-note">{refreshing ? "Looking at your blueprints..." : "None of your signed-in pilots holds a blueprint."}</p>
        {:else}
          <label class="im-field im-grow">
            <span>Blueprint</span>
            <select value={ownedChoice} onchange={(event) => chooseOwned(event.currentTarget.value)}>
              <option value="">Choose a blueprint</option>
              {#each owned as blueprint (blueprint.itemID)}
                <option value={String(blueprint.itemID)}>
                  {blueprint.blueprintName ?? "An unnamed blueprint"} - {ownedWords(blueprint)} - {blueprint.characterName}{blueprint.busy ? " (in a job)" : ""}
                </option>
              {/each}
            </select>
          </label>
        {/if}
      {:else}
        <label class="im-field im-grow">
          <span>Find a blueprint</span>
          <input type="search" placeholder="Hobgoblin II" bind:value={query} oninput={onQuery} />
        </label>
      {/if}

      <label class="im-field im-runs">
        <span>Runs</span>
        <input inputmode="numeric" bind:value={runsText} aria-invalid={target !== null && runs === null} />
      </label>
    </div>

    {#if source === "any"}
      {#if searchError}
        <p class="im-error" role="alert">{searchError}</p>
      {:else if query.trim().length >= 2 && !searching && matches.length === 0}
        <p class="im-note">No blueprint is called that.</p>
      {:else if matches.length > 0}
        <ul class="im-matches" aria-label="Blueprints found">
          {#each matches as match (match.blueprintTypeID)}
            <li>
              <button type="button" class="im-match" class:on={target?.productTypeID === match.productTypeID} onclick={() => chooseMatch(match)}>
                <TypeIcon typeID={match.productTypeID} name={match.productName ?? match.blueprintName} />
                <span>{match.blueprintName}</span>
                {#if match.activity === "reaction"}<span class="im-chip">reaction</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if searchTotal > matches.length}
          <p class="im-note">Showing {matches.length} of {countWords(searchTotal)}. Type more to narrow it.</p>
        {/if}
      {/if}
    {/if}

    {#if target === null}
      <p class="im-empty">Choose a blueprint and this will work out everything it takes to build.</p>
    {:else}
      <header class="im-head">
        <span class="im-head-icon">
          <TypeIcon typeID={target.productTypeID} name={targetName} size="lg" />
        </span>
        <div class="im-head-title">
          <h3>{targetName ?? "An unnamed item"}</h3>
          {#if chain}
            {@const top = chain.lines.get(target.productTypeID)}
            {#if top?.blueprint}
              <p class="im-note">
                {top.blueprint.assumed ? "No owned blueprint - assumed" : "Owned blueprint -"}
                material {top.blueprint.materialEfficiency}%, time {top.blueprint.timeEfficiency}%.
                No facility bonus counted.
              </p>
            {/if}
          {/if}
        </div>
      </header>

      {#if runs === null}
        <p class="im-error" role="alert">Enter a number of runs.</p>
      {:else if loadingBook}
        <p class="im-note">Working out the recipes...</p>
      {:else if bookError}
        <p class="im-error" role="alert">{bookError}</p>
      {:else if book?.capped}
        <p class="im-error" role="alert">This tree is too large to show in full.</p>
      {:else if chain}
        <p class="im-verdict">
          {countWords(chain.root.quantity)} {targetName ?? "items"}: {countWords(jobCount)} {jobCount === 1 ? "job" : "jobs"},
          {countWords(toBuy.length)} {toBuy.length === 1 ? "thing" : "things"} to buy.
        </p>

        {#if toBuy.length > 0}
          <h4 class="im-section-title">To buy</h4>
          <ul class="im-buy" aria-label="To buy">
            {#each toBuy as line (line.typeID)}
              <li class="im-buy-row">
                <span class="im-buy-name">
                  <TypeIcon typeID={line.typeID} name={line.name} />
                  {nameOf(line)}
                  {#if line.planetary}<span class="im-chip">PI</span>{/if}
                </span>
                <span class="im-buy-count">{countWords(line.short)}</span>
              </li>
            {/each}
          </ul>
        {/if}

        <!-- THE TREE. Each type is worked once for the whole plan; a type
             that appears again is marked "above" rather than drawn twice. -->
        {#snippet treeNode(node: IndustryNode, isRoot: boolean)}
          {@const line = node.line}
          {@const open = node.children.length > 0 && isOpen(node)}
          <li role="treeitem" aria-selected="false" aria-expanded={node.children.length > 0 ? open : undefined}>
            <div class="im-node obtain-{line.obtain}">
              {#if node.children.length > 0}
                <button type="button" class="im-node-name" onclick={() => toggle(node)}>
                  <span class="im-chevron" aria-hidden="true">{open ? "v" : ">"}</span>
                  <TypeIcon typeID={node.typeID} name={line.name} />
                  <span>{nameOf(line)}</span>
                </button>
              {:else}
                <span class="im-node-name">
                  <span class="im-chevron" aria-hidden="true"></span>
                  <TypeIcon typeID={node.typeID} name={line.name} />
                  <span>{nameOf(line)}</span>
                </span>
              {/if}
              <span class="im-tags">
                {#if node.repeat}
                  <span class="im-tag" title="Drawn in full above">above</span>
                {/if}
                {#if line.planetary}<span class="im-tag">PI</span>{/if}
                {#if line.obtain !== "buy" && line.runs > 0}
                  <span class="im-tag">{countWords(line.runs)} {line.runs === 1 ? "run" : "runs"}</span>
                {/if}
                {#if line.leftover > 0}
                  <span class="im-tag" title="Whole runs make more than the plan needs">{countWords(line.leftover)} left over</span>
                {/if}
                {#if line.blueprint?.invention}
                  <span class="im-tag act" title="Each success gives a copy with {line.blueprint.invention.runsPerCopy} runs">
                    needs {line.blueprint.invention.copies} invented {line.blueprint.invention.copies === 1 ? "copy" : "copies"}
                  </span>
                {/if}
                {#if line.blueprint && !isRoot && line.blueprint.assumed}
                  <span class="im-tag" title="No pilot here owns this blueprint">assumed material {line.blueprint.materialEfficiency}%</span>
                {/if}
                {#if line.buyReason === "cycle"}
                  <span class="im-tag bad">made from itself</span>
                {/if}
              </span>
              <span class="im-count">{countWords(node.quantity)}</span>
              {#if !isRoot && line.canBuild && line.buyReason !== "cycle"}
                <button
                  type="button"
                  class="im-obtain"
                  aria-pressed={line.obtain === "buy"}
                  title={line.obtain === "buy" ? "Build this instead of buying it" : "Buy this instead of building it"}
                  onclick={() => setBuying(node.typeID, line.obtain !== "buy")}
                >{obtainWord(line)}</button>
              {:else}
                <span class="im-obtain-fixed">{obtainWord(line)}</span>
              {/if}
            </div>
            {#if open}
              <ul class="im-tree-kids" role="group">
                {#each node.children as child (child.key)}
                  {@render treeNode(child, false)}
                {/each}
              </ul>
            {/if}
          </li>
        {/snippet}

        <h4 class="im-section-title">Build tree</h4>
        <ul class="im-tree" role="tree" aria-label="Build tree">
          {@render treeNode(chain.root, true)}
        </ul>
      {/if}
    {/if}
  </div>
</section>

<style>
  /* Square, like the rest of the app (R53): corners go through the tokens. */
  .im-plan {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.75rem;
    padding: 1rem 1.1rem;
    background: var(--color-panel-3);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-frame);
    min-width: 0;
  }
  .im-pick {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.75rem;
  }
  .im-source {
    display: flex;
    border: 1px solid var(--color-line-strong);
  }
  /* ⚠ NOT `class:active` — a bare `button.active` is a filled accent control
   * in the app's component layer. */
  .im-source-item {
    min-height: 38px;
    padding: 0 0.9rem;
    background: transparent;
    border: 0;
    color: var(--color-muted);
    cursor: pointer;
  }
  .im-source-item.on {
    background: var(--color-panel-2);
    color: var(--color-text-bright);
  }
  .im-field {
    display: grid;
    gap: 0.25rem;
    color: var(--color-muted);
    font-size: 0.8rem;
  }
  .im-field input,
  .im-field select {
    min-height: 38px;
  }
  .im-grow {
    flex: 1 1 18rem;
    min-width: 0;
  }
  .im-runs input {
    width: 6rem;
  }
  .im-note,
  .im-empty {
    margin: 0;
    color: var(--color-muted);
    font-size: 0.85rem;
  }
  .im-error {
    margin: 0;
    color: var(--color-danger);
    font-size: 0.85rem;
  }
  .im-matches,
  .im-buy,
  .im-tree,
  .im-tree-kids {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .im-matches {
    display: grid;
    max-height: 16rem;
    overflow-y: auto;
    border: 1px solid var(--color-line);
  }
  .im-match {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    min-height: 40px;
    padding: 0 0.6rem;
    background: transparent;
    border: 0;
    border-top: 1px solid var(--color-row-line);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }
  .im-match.on {
    background: var(--color-panel-2);
    color: var(--color-text-bright);
  }
  .im-chip,
  .im-tag {
    font-size: 11px;
    padding: 0 0.4rem;
    border: 1px solid var(--color-line-strong);
    color: var(--color-cell);
    white-space: nowrap;
  }
  .im-tag.act {
    border-color: var(--color-warn);
    color: var(--color-warn);
  }
  .im-tag.bad {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  .im-head {
    display: flex;
    align-items: flex-start;
    gap: 0.9rem;
  }
  .im-head-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.25rem;
    height: 3.25rem;
    background: var(--color-panel-2);
    border: 1px solid var(--color-line);
  }
  .im-head-title {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }
  .im-head-title h3 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--color-text-bright);
  }
  .im-verdict {
    margin: 0;
    color: var(--color-text);
  }
  .im-section-title {
    margin: 0.4rem 0 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }
  .im-buy-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7rem;
    gap: 0.6rem;
    align-items: center;
    min-height: 36px;
    padding: 0.2rem 0.6rem;
    border-top: 1px solid var(--color-line);
    border-left: 3px solid var(--color-warn);
  }
  .im-buy-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
    color: var(--color-text-bright);
  }
  .im-buy-count,
  .im-count {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--color-text);
  }
  .im-tree-kids {
    margin-left: 0.9rem;
    padding-left: 0.8rem;
    border-left: 1px dashed var(--color-line-strong);
  }
  .im-node {
    display: grid;
    grid-template-columns: minmax(12rem, 1.3fr) minmax(0, 1.4fr) 6rem 4.5rem;
    gap: 0.75rem;
    align-items: center;
    margin: 0.3rem 0;
    padding: 0.4rem 0.6rem;
    background: var(--color-panel);
    border-left: 3px solid var(--color-accent-dim);
  }
  .im-node.obtain-react {
    border-left-color: var(--color-powergrid);
  }
  .im-node.obtain-buy {
    border-left-color: var(--color-warn);
  }
  .im-node-name {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    min-height: 0;
    padding: 0;
    background: none;
    border: 0;
    color: var(--color-text-bright);
    text-align: left;
  }
  button.im-node-name {
    cursor: pointer;
  }
  .im-chevron {
    display: inline-block;
    width: 0.8rem;
    color: var(--color-muted);
    font-size: 11px;
  }
  .im-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .im-obtain,
  .im-obtain-fixed {
    justify-self: end;
    font-size: 11px;
    min-width: 4rem;
    text-align: center;
  }
  .im-obtain {
    min-height: 28px;
    padding: 0 0.5rem;
  }
  .im-obtain-fixed {
    color: var(--color-muted);
  }
  @container (max-width: 640px) {
    .im-pick > * {
      flex: 1 1 100%;
    }
    .im-runs input {
      width: 100%;
    }
    .im-node {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .im-tags {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .im-obtain,
    .im-obtain-fixed {
      min-height: 40px;
    }
  }
</style>
