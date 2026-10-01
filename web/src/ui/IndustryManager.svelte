<script lang="ts">
  // INDUSTRY MANAGER (R109 slices 2 and 3): choose a blueprint, owned by a
  // pilot or any at all, see everything it takes to build, and keep it as a
  // plan. Option A of the 2026-10-01 mockups: your plans down the left, the
  // open plan on the right, as in Planetary Industry's planner.
  //
  // ⚠ A GLOBAL WINDOW WITH NO STORE, like Planetary Industry. A plan spans
  // every signed-in pilot's blueprints, so it reads each pilot's own industry
  // read on that pilot's own session and takes neither store nor flow.
  //
  // ⚠ NOTHING HERE SELECTS A PILOT. The blueprint list is each already-online
  // pilot's industry read. Plans and recipes are asked through an online
  // pilot's session, or, with nobody online, a throwaway sign-in of a hangar
  // account (app/industryPlans.ts), exactly as PI's saved plans are.
  //
  // ⚠ A PLAN IS INTENT. The server keeps the product, the runs, the note and
  // the choices; every number on screen is worked again by
  // bridge/industryChain.ts each time, so a plan reopened next week is never
  // a week stale.
  import { onMount, untrack } from "svelte";
  import type { Session } from "../app/sessions.ts";
  import type { ApiOptions } from "../app/api.ts";
  import { getIndustryRecipeClosure, searchIndustryBlueprints } from "../app/api.ts";
  import { loadKnownCharacters } from "../app/knownCharacters.ts";
  import {
    askAsAnyone,
    createIndustryPlan,
    deleteIndustryPlan,
    loadIndustryPlans,
    NO_CHOICES,
    resolverChoices,
    updateIndustryPlan,
    withBuying,
    withIndustryPlan,
    withoutIndustryPlan,
    type IndustryAskers,
    type IndustryPlanChoices,
    type IndustryPlanFields,
    type SavedIndustryPlan,
  } from "../app/industryPlans.ts";
  import {
    loadIndustryPlanView,
    pruneIndustryPlanView,
    saveIndustryPlanView,
    withFolds,
    withOpenIndustryPlan,
    type IndustryPlanView,
  } from "../app/industryPlanView.ts";
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
    type PilotBlueprintRead,
  } from "../bridge/industryOwned.ts";
  import { countWords } from "../bridge/piStock.ts";
  import TypeIcon from "./TypeIcon.svelte";

  let { sessions = [] }: { sessions?: readonly Session[] } = $props();

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

  // Saved plans, and the one open. `openPlan === null` with a target set is a
  // new plan not saved yet.
  let plans = $state<SavedIndustryPlan[]>([]);
  let plansLoaded = $state(false);
  let plansError = $state<string | null>(null);
  let openPlanID = $state<string | null>(null);
  let planError = $state<string | null>(null);
  let planSaving = $state(false);
  let view = $state<IndustryPlanView>(loadIndustryPlanView());

  // What is on the right: a product, runs, choices and a note. For a saved
  // plan these mirror it and every change is saved; for a new one they are a
  // draft until Save.
  let productTypeID = $state<number | null>(null);
  let draftName = $state<string | null>(null);
  let runsText = $state("1");
  let choices = $state<IndustryPlanChoices>(NO_CHOICES);
  let noteText = $state("");

  // Recipe books, one per product, read once per open window.
  let books = $state<Map<number, IndustryRecipeBook>>(new Map());
  let bookErrors = $state<Map<number, string>>(new Map());
  const booksAsked = new Set<number>();

  /** Pilots online in this tab, each with its own session. */
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

  /** Who may be asked for plans and recipes: online pilots, then hangar accounts. */
  function askers(): IndustryAskers {
    return {
      online: onlineSessions().map(({ session }) => session.flow.requestOptions()),
      accounts: loadKnownCharacters().map((pilot) => pilot.accountName),
    };
  }

  function ask<T>(call: (options: ApiOptions) => Promise<T>): Promise<T> {
    return askAsAnyone(askers(), call);
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

  const openPlan = $derived(plans.find((entry) => entry.planID === openPlanID) ?? null);
  const activePlans = $derived(plans.filter((entry) => entry.status === "active"));
  const donePlans = $derived(plans.filter((entry) => entry.status === "done"));

  const runs = $derived.by((): number | null => {
    const value = Number(runsText.trim());
    return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000 ? value : null;
  });
  const book = $derived(productTypeID === null ? null : books.get(productTypeID) ?? null);
  const bookError = $derived(productTypeID === null ? null : bookErrors.get(productTypeID) ?? null);

  const chain = $derived.by(() => {
    if (productTypeID === null || book === null || runs === null) {
      return null;
    }
    return resolveIndustryChain({ book, productTypeID, runs, choices: resolverChoices(choices, terms) });
  });
  const toBuy = $derived(chain ? shortLines(chain).filter((line) => line.obtain === "buy") : []);
  const jobCount = $derived(
    chain ? [...chain.lines.values()].reduce((sum, line) => sum + line.jobRuns.length, 0) : 0,
  );
  const productName = $derived(productTypeID === null ? null : nameFor(productTypeID) ?? draftName);
  const folds = $derived(openPlanID === null ? {} : view.folds[openPlanID] ?? {});
  let draftFolds = $state<Record<string, boolean>>({});
  const ownedChoice = $derived(
    productTypeID === null ? "" : String(owned.find((blueprint) => blueprint.productTypeID === productTypeID)?.itemID ?? ""),
  );

  /** A product's name from whichever recipe book has it. */
  function nameFor(typeID: number): string | null {
    for (const candidate of books.values()) {
      const name = candidate.types.get(typeID)?.name;
      if (name) return name;
    }
    return null;
  }

  function lineName(line: IndustryLine): string {
    return line.name ?? "An unnamed item";
  }

  function planTitle(entry: SavedIndustryPlan): string {
    return nameFor(entry.productTypeID) ?? "A plan";
  }

  // --- reads ------------------------------------------------------------------

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

  async function loadBook(typeID: number): Promise<void> {
    if (booksAsked.has(typeID)) {
      return;
    }
    booksAsked.add(typeID);
    try {
      const decoded = decodeRecipeClosure(await ask((options) => getIndustryRecipeClosure([typeID], options)));
      if (!decoded.readable) {
        throw new Error("unreadable");
      }
      books = new Map(books).set(typeID, decoded);
    } catch {
      // Asked again on the next open of this product.
      booksAsked.delete(typeID);
      bookErrors = new Map(bookErrors).set(typeID, "The recipes could not be read just now.");
    }
  }

  async function loadPlans(): Promise<void> {
    plansError = null;
    try {
      plans = await loadIndustryPlans(askers());
      plansLoaded = true;
      view = pruneIndustryPlanView(view, plans.map((entry) => entry.planID));
      saveIndustryPlanView(view);
      for (const entry of plans) {
        void loadBook(entry.productTypeID);
      }
      const remembered = plans.find((entry) => entry.planID === view.openID);
      if (remembered && openPlanID === null && productTypeID === null) {
        showPlan(remembered);
      }
    } catch (error) {
      plansError = error instanceof Error ? error.message : "Your saved plans could not be read just now.";
    }
  }

  // --- the open plan ---------------------------------------------------------

  function showPlan(entry: SavedIndustryPlan | null): void {
    planError = null;
    draftFolds = {};
    openPlanID = entry?.planID ?? null;
    view = withOpenIndustryPlan(view, openPlanID);
    saveIndustryPlanView(view);
    if (entry === null) {
      productTypeID = null;
      draftName = null;
      runsText = "1";
      choices = NO_CHOICES;
      noteText = "";
      return;
    }
    productTypeID = entry.productTypeID;
    draftName = null;
    runsText = String(entry.runs);
    choices = entry.choices;
    noteText = entry.note;
    clearBookError(entry.productTypeID);
    void loadBook(entry.productTypeID);
  }

  /** Forget a failed read so the product is asked for again. */
  function clearBookError(typeID: number): void {
    if (bookErrors.has(typeID)) {
      const next = new Map(bookErrors);
      next.delete(typeID);
      bookErrors = next;
    }
  }

  /** Start a new, unsaved plan for a product. */
  function draft(typeID: number, name: string | null, defaultRuns: number): void {
    showPlan(null);
    productTypeID = typeID;
    draftName = name;
    runsText = String(defaultRuns);
    clearBookError(typeID);
    void loadBook(typeID);
  }

  function chooseOwned(itemID: string): void {
    const blueprint = owned.find((candidate) => String(candidate.itemID) === itemID);
    if (blueprint) {
      draft(blueprint.productTypeID, blueprint.blueprintName, blueprint.runs ?? 1);
    }
  }

  function chooseMatch(match: IndustryBlueprintMatch): void {
    draft(match.productTypeID, match.productName ?? match.blueprintName, 1);
  }

  // Saves run one after another, each on the newest revision, so quick clicks
  // never race each other into a conflict.
  let saveChain: Promise<void> = Promise.resolve();

  function save(fields: IndustryPlanFields): Promise<void> {
    const planID = openPlanID;
    if (planID === null) {
      return Promise.resolve();
    }
    saveChain = saveChain.then(async () => {
      const current = plans.find((entry) => entry.planID === planID);
      if (!current) return;
      planSaving = true;
      try {
        plans = withIndustryPlan(plans, await updateIndustryPlan(askers(), current, fields));
        planError = null;
      } catch (error) {
        planError = error instanceof Error ? error.message : "That change could not be saved.";
        // A conflict or a refusal: take the server's copy as it stands.
        await loadPlans();
        const fresh = plans.find((entry) => entry.planID === planID);
        if (fresh && openPlanID === planID) {
          runsText = String(fresh.runs);
          choices = fresh.choices;
          noteText = fresh.note;
        }
      } finally {
        planSaving = false;
      }
    });
    return saveChain;
  }

  async function saveNew(): Promise<void> {
    if (productTypeID === null || runs === null) {
      planError = "Enter a number of runs.";
      return;
    }
    planSaving = true;
    planError = null;
    try {
      const created = await createIndustryPlan(askers(), {
        productTypeID,
        runs,
        choices,
        note: noteText,
      });
      plans = withIndustryPlan(plans, created);
      const keptFolds = draftFolds;
      showPlan(created);
      if (Object.keys(keptFolds).length > 0) {
        view = withFolds(view, created.planID, keptFolds);
        saveIndustryPlanView(view);
      }
    } catch (error) {
      planError = error instanceof Error ? error.message : "The plan could not be saved.";
    } finally {
      planSaving = false;
    }
  }

  function commitRuns(): void {
    if (runs === null) {
      planError = "Enter a number of runs.";
      return;
    }
    if (openPlan && openPlan.runs !== runs) {
      void save({ runs });
    }
  }

  function commitNote(): void {
    if (openPlan && openPlan.note !== noteText.trim()) {
      void save({ note: noteText });
    }
  }

  function setBuying(typeID: number, buy: boolean): void {
    choices = withBuying(choices, typeID, buy);
    if (openPlan) {
      void save({ choices });
    }
  }

  async function setStatus(status: "active" | "done"): Promise<void> {
    await save({ status });
  }

  async function removePlan(entry: SavedIndustryPlan): Promise<void> {
    planSaving = true;
    try {
      await deleteIndustryPlan(askers(), entry.planID);
      plans = withoutIndustryPlan(plans, entry.planID);
      showPlan(null);
    } catch (error) {
      planError = error instanceof Error ? error.message : "The plan could not be deleted.";
    } finally {
      planSaving = false;
    }
  }

  // --- the search -------------------------------------------------------------

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
      const result = decodeBlueprintSearch(await ask((options) => searchIndustryBlueprints(text, options)));
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

  // --- the tree ---------------------------------------------------------------

  /** Open by default to two levels below the target; deeper folds. */
  function isOpen(node: IndustryNode): boolean {
    const hand = openPlanID === null ? draftFolds[node.key] : folds[node.key];
    return hand ?? node.key.split(">").length <= 2;
  }

  function toggle(node: IndustryNode): void {
    const next = { ...(openPlanID === null ? draftFolds : folds), [node.key]: !isOpen(node) };
    if (openPlanID === null) {
      draftFolds = next;
      return;
    }
    view = withFolds(view, openPlanID, next);
    saveIndustryPlanView(view);
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
    void loadPlans();
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
      <button
        type="button"
        disabled={refreshing}
        onclick={() => {
          void refreshOwned();
          void loadPlans();
        }}
      >
        {refreshing ? "Looking..." : "Refresh"}
      </button>
    </span>
  </header>

  <div class="im-body">
    <!-- YOUR PLANS. Active first, done below; a card opens its plan. -->
    <aside class="im-plans" aria-label="Your plans">
      <div class="im-plans-head">
        <h3>Your plans</h3>
        <button type="button" class="im-new" onclick={() => showPlan(null)}>+ New plan</button>
      </div>
      {#snippet planCard(entry: SavedIndustryPlan)}
        <li>
          <button
            type="button"
            class="im-plan-card"
            class:on={entry.planID === openPlanID}
            aria-current={entry.planID === openPlanID ? "true" : undefined}
            onclick={() => showPlan(entry)}
          >
            <TypeIcon typeID={entry.productTypeID} name={planTitle(entry)} size="md" />
            <span class="im-plan-card-text">
              <span class="im-plan-card-name">{planTitle(entry)}</span>
              <span class="im-plan-card-sub">
                {countWords(entry.runs)} {entry.runs === 1 ? "run" : "runs"}{entry.note ? ` - ${entry.note}` : ""}
              </span>
            </span>
          </button>
        </li>
      {/snippet}
      {#if plansError}
        <p class="im-error" role="alert">{plansError}</p>
      {:else if !plansLoaded}
        <p class="im-note">Reading your saved plans...</p>
      {:else if activePlans.length === 0}
        <p class="im-note">No plans yet. Choose a blueprint and save it.</p>
      {:else}
        <ul class="im-plan-list">
          {#each activePlans as entry (entry.planID)}
            {@render planCard(entry)}
          {/each}
        </ul>
      {/if}
      {#if donePlans.length > 0}
        <h4 class="im-section-title">Done</h4>
        <ul class="im-plan-list">
          {#each donePlans as entry (entry.planID)}
            {@render planCard(entry)}
          {/each}
        </ul>
      {/if}
    </aside>

    <div class="im-plan">
      {#if openPlan === null}
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
                  <button type="button" class="im-match" class:on={productTypeID === match.productTypeID} onclick={() => chooseMatch(match)}>
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
      {/if}

      {#if productTypeID === null}
        <p class="im-empty">Choose a blueprint and this will work out everything it takes to build.</p>
      {:else}
        <header class="im-head">
          <span class="im-head-icon">
            <TypeIcon typeID={productTypeID} name={productName} size="lg" />
          </span>
          <div class="im-head-title">
            <h3>
              {productName ?? "An unnamed item"}
              {#if openPlan?.status === "done"}<span class="im-chip">done</span>{/if}
              {#if openPlan === null}<span class="im-chip">not saved</span>{/if}
            </h3>
            <input
              class="im-note-input"
              aria-label="Note"
              placeholder="Add a note"
              maxlength="500"
              bind:value={noteText}
              onchange={commitNote}
            />
            {#if chain}
              {@const top = chain.lines.get(productTypeID)}
              {#if top?.blueprint}
                <p class="im-note">
                  {top.blueprint.assumed ? "No owned blueprint - assumed" : "Owned blueprint -"}
                  material {top.blueprint.materialEfficiency}%, time {top.blueprint.timeEfficiency}%.
                  No facility bonus counted.
                </p>
              {/if}
            {/if}
          </div>
          <div class="im-head-actions">
            <label class="im-runs">
              <span>Runs</span>
              <input
                inputmode="numeric"
                bind:value={runsText}
                aria-invalid={runs === null}
                oninput={() => (planError = null)}
                onchange={commitRuns}
                onkeydown={(event) => event.key === "Enter" && commitRuns()}
              />
            </label>
            {#if openPlan === null}
              <button type="button" class="primary" disabled={planSaving || runs === null} onclick={() => void saveNew()}>Save plan</button>
            {:else if openPlan.status === "active"}
              <button type="button" disabled={planSaving} onclick={() => void setStatus("done")}>Mark done</button>
            {:else}
              <button type="button" disabled={planSaving} onclick={() => void setStatus("active")}>Reopen</button>
              <button type="button" class="danger" disabled={planSaving} onclick={() => openPlan && void removePlan(openPlan)}>Delete</button>
            {/if}
          </div>
        </header>
        {#if planError}
          <p class="im-error" role="alert">{planError}</p>
        {/if}

        {#if runs === null}
          <p class="im-error" role="alert">Enter a number of runs.</p>
        {:else if bookError}
          <p class="im-error" role="alert">{bookError}</p>
        {:else if book === null}
          <p class="im-note">Working out the recipes...</p>
        {:else if book.capped}
          <p class="im-error" role="alert">This tree is too large to show in full.</p>
        {:else if chain}
          <p class="im-verdict">
            {countWords(chain.root.quantity)} {productName ?? "items"}: {countWords(jobCount)} {jobCount === 1 ? "job" : "jobs"},
            {countWords(toBuy.length)} {toBuy.length === 1 ? "thing" : "things"} to buy.
          </p>

          {#if toBuy.length > 0}
            <h4 class="im-section-title">To buy</h4>
            <ul class="im-buy" aria-label="To buy">
              {#each toBuy as line (line.typeID)}
                <li class="im-buy-row">
                  <span class="im-buy-name">
                    <TypeIcon typeID={line.typeID} name={line.name} />
                    {lineName(line)}
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
                    <span>{lineName(line)}</span>
                  </button>
                {:else}
                  <span class="im-node-name">
                    <span class="im-chevron" aria-hidden="true"></span>
                    <TypeIcon typeID={node.typeID} name={line.name} />
                    <span>{lineName(line)}</span>
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
                  >{line.obtain}</button>
                {:else}
                  <span class="im-obtain-fixed">{line.obtain}</span>
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
  </div>
</section>

<style>
  /* Square, like the rest of the app (R53): corners go through the tokens. */
  .im-body {
    display: grid;
    grid-template-columns: minmax(13rem, 16rem) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
    margin-top: 0.75rem;
  }
  .im-plans,
  .im-plan {
    background: var(--color-panel-3);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-frame);
    min-width: 0;
  }
  .im-plans {
    display: grid;
    gap: 0.4rem;
    padding: 0.6rem;
  }
  .im-plan {
    display: grid;
    gap: 0.75rem;
    padding: 1rem 1.1rem;
  }
  .im-plans-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .im-plans-head h3,
  .im-section-title {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
  }
  .im-new {
    min-height: 28px;
    padding: 0 0.6rem;
  }
  .im-plan-list,
  .im-matches,
  .im-buy,
  .im-tree,
  .im-tree-kids {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .im-plan-list {
    display: grid;
    gap: 0.3rem;
  }
  .im-plan-card {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    min-height: 44px;
    padding: 0.45rem 0.55rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-control);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }
  .im-plan-card:hover:not(.on) {
    background: var(--color-panel);
    border-color: var(--color-line);
  }
  .im-plan-card.on {
    background: var(--color-panel-2);
    border-color: var(--color-accent-dim);
  }
  .im-plan-card-text {
    display: grid;
    min-width: 0;
  }
  .im-plan-card-name {
    color: var(--color-text-bright);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .im-plan-card-sub {
    color: var(--color-muted);
    font-size: 0.8rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
    flex-wrap: wrap;
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
    flex: 1 1 14rem;
    gap: 0.2rem;
    min-width: 0;
  }
  .im-head-title h3 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--color-text-bright);
  }
  .im-note-input {
    min-height: 28px;
    padding: 0 0.3rem;
    background: transparent;
    border: 1px solid transparent;
    color: var(--color-muted);
    font-size: 0.85rem;
  }
  .im-note-input:hover,
  .im-note-input:focus {
    border-color: var(--color-line-strong);
    background: var(--color-field);
    color: var(--color-text);
  }
  .im-head-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .im-head-actions button {
    min-height: 34px;
  }
  .im-runs {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--color-muted);
    font-size: 0.85rem;
  }
  .im-runs input {
    width: 5.5rem;
    min-height: 34px;
  }
  .im-verdict {
    margin: 0;
    color: var(--color-text);
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
    .im-body {
      grid-template-columns: minmax(0, 1fr);
    }
    .im-pick > * {
      flex: 1 1 100%;
    }
    .im-head-actions {
      flex: 1 1 100%;
    }
    .im-head-actions button {
      flex: 1 1 auto;
      min-height: 40px;
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
