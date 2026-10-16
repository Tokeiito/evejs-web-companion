<script lang="ts">
  // The wallet's Give ISK tab (giveIskPanel.py; bridge/giveMoney.ts): a character found by the search (Transfer To, by
  // the Search By chosen; searchUtil.SearchCharacters: the search service's Query for characters, from three letters),
  // "Nothing Found" where none is; the one chosen shown with a way to choose again; the amount, from 0.1 to what the
  // pilot has, with its words beneath from ten thousand (GetQtyText); Transfer, which asks AskAreYouSure with the
  // tab's own words and gives the ISK (GiveCash(characterID, amount)), and where the server answers something clears
  // itself and says "Transfer Successful".
  //
  // Not done: the chosen character's portrait; Search By kept between sessions (the client keeps it in its settings).
  import { onMount } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { READABLE_ISK_LABELS, readableIsk, transferAmount } from "../bridge/giveMoney.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { MATCH_BY, MIN_WILDCARD_LENGTH } from "../bridge/searchMatch.ts";
  import { resolvedName, type NameKind } from "../store/names.ts";
  import type { JsonValue } from "../bridge/wire.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  const W = "UI/Wallet/WalletWindow";
  const WORDS = {
    transferTo: `${W}/TransferTo`,
    searchHint: "UI/ActivatePlex/SearchHint",
    searchBy: "UI/Common/SearchBy",
    nothingFound: "UI/Common/NothingFound",
    amount: `${W}/GiveAmount`,
    iskHint: `${W}/ISK`,
    transfer: "UI/HangarTransfer/TransferBtn",
    successful: `${W}/TransferSuccessful`,
    confirmation: `${W}/TransactionConfirmation`,
    partialTerms: "UI/Search/UniversalSearch/PartialTerms",
    exactTerms: "UI/Search/UniversalSearch/ExactTerms",
    exactPhrase: "UI/Search/UniversalSearch/ExactPhrase",
    onlyExactPhrase: "UI/Search/UniversalSearch/OnlyExactPhrase",
  } as const;
  $effect(() => {
    flow.requestWords([...Object.values(WORDS), ...READABLE_ISK_LABELS]);
  });
  const nameOf = (kind: NameKind, id: number): string => resolvedName($names.resolved, kind, id, "");
  const word = (label: string, own: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? plainText(template) : own;
  };
  const said = (label: string, args: Readonly<Record<string, JsonValue>>): string | null => {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf })) : null;
  };

  /** searchUtil.SEARCHBY_OPTIONS. */
  const SEARCH_BY: readonly (readonly [number, string, string])[] = [
    [MATCH_BY.partialTerms, WORDS.partialTerms, "Partial terms"],
    [MATCH_BY.exactTerms, WORDS.exactTerms, "Exact terms"],
    [MATCH_BY.exactPhrase, WORDS.exactPhrase, "Exact phrase"],
    [MATCH_BY.exactPhraseOnly, WORDS.onlyExactPhrase, "Only the exact phrase"],
  ];
  let searchBy = $state<number>(MATCH_BY.partialTerms);
  let searchText = $state("");
  let found = $state<readonly { readonly id: number; readonly name: string }[] | null>(null);
  let chosen = $state<{ readonly id: number; readonly name: string } | null>(null);
  let amountText = $state("");
  let wealth = $state<number | null>(null);
  let busy = $state(false);
  let failure = $state("");
  let succeeded = $state(false);

  // SearchForCharacter (172 to 182): from three letters, the search service's Query for characters by Search By.
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function searchSoon(): void {
    if (searchTimer !== null) clearTimeout(searchTimer);
    const text = searchText.replace(/\*/g, "").trim();
    if (text.length < 3) {
      found = null;
      return;
    }
    // The search's own refusal, for Partial Terms with no term of three letters (searchUtil._ValidateSearchInput).
    if (searchBy === MATCH_BY.partialTerms && !text.split(/\s+/).some((term) => [...term].length >= MIN_WILDCARD_LENGTH)) {
      found = [];
      return;
    }
    searchTimer = setTimeout(() => {
      void flow.searchOwners(text, [2], searchBy)
        .then((results) => {
          if (searchText.replace(/\*/g, "").trim() === text) found = results.get(2) ?? [];
        })
        .catch((cause) => {
          failure = panelErrorWords(cause);
        });
    }, 400);
  }

  // OnSearchEntrySelected and ResetSearch.
  function choose(character: { readonly id: number; readonly name: string }): void {
    chosen = character;
    searchText = "";
    found = null;
    succeeded = false;
  }
  function chooseAgain(): void {
    chosen = null;
  }

  const amount = $derived(transferAmount(amountText, wealth));
  const amountWords = $derived(amountText.trim() === "" ? null : readableIsk(amount, (label) => $words.templates[label] === undefined || typeof $words.templates[label] !== "string" ? null : plainText($words.templates[label] as string)));

  async function transfer(): Promise<void> {
    if (chosen === null || busy) return;
    busy = true;
    failure = "";
    try {
      // TransactionConfirmation: the amount as FmtAmt writes it (grouped, whole), the character by its name.
      const amountWritten = Math.trunc(amount).toLocaleString("en-US");
      const cons = said(WORDS.confirmation, { amount: amountWritten, player: chosen.id }) ?? `Give ${amountWritten} ISK to ${chosen.name}?`;
      const answered = await flow.giveIskFromWallet(chosen.id, amount, cons);
      if (answered) {
        chosen = null;
        amountText = "0";
        succeeded = true;
      }
    } catch (cause) {
      failure = panelErrorWords(cause);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    // The amount's most is what the pilot has (walletSvc.GetWealth), kept right as it changes.
    void flow.pilotWealth().then((value) => (wealth = value)).catch(() => undefined);
    return () => {
      if (searchTimer !== null) clearTimeout(searchTimer);
    };
  });
</script>

<div class="wallet-give-isk">
  {#if chosen === null}
    <p class="controls">
      <label class="give-field">{word(WORDS.transferTo, "Transfer to:")}
        <input type="text" maxlength="64" placeholder={word(WORDS.searchHint, "A character's name")} bind:value={searchText} oninput={searchSoon} />
      </label>
      <label class="give-field">{word(WORDS.searchBy, "Search by")}
        <select bind:value={searchBy} onchange={searchSoon}>
          {#each SEARCH_BY as [value, label, own] (value)}
            <option {value}>{word(label, own)}</option>
          {/each}
        </select>
      </label>
    </p>
    {#if found !== null && found.length === 0}
      <p class="nothing-found">{word(WORDS.nothingFound, "No one found")}</p>
    {:else if found !== null}
      <ul class="give-found">
        {#each found as character (character.id)}
          <li><button type="button" class="minor" onclick={() => choose(character)}>{character.name}</button></li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="give-chosen">
      <strong>{chosen.name}</strong>
      <button type="button" class="minor" aria-label="Choose someone else" onclick={chooseAgain}>✕</button>
    </p>
  {/if}

  <p class="controls">
    <label class="give-field">{word(WORDS.amount, "Amount")}
      <input type="text" inputmode="decimal" placeholder={word(WORDS.iskHint, "ISK")} bind:value={amountText}
        onblur={() => { if (amountText.trim() !== "") amountText = String(amount); }} />
    </label>
  </p>
  {#if amountWords}
    <p class="note">{amountWords}</p>
  {/if}

  <p class="controls">
    <button type="button" disabled={chosen === null || busy} onclick={() => void transfer()}>{word(WORDS.transfer, "Transfer")}</button>
    {#if succeeded}
      <span class="give-done">{word(WORDS.successful, "The ISK was given")}</span>
    {/if}
  </p>
  {#if failure}
    <p class="error">{failure}</p>
  {/if}
</div>

<style>
  .wallet-give-isk .give-field { display: inline-flex; flex-direction: column; gap: 0.2rem; }
  .wallet-give-isk .give-found { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .wallet-give-isk .give-chosen { display: flex; gap: 0.5rem; align-items: center; }
  /* The client's warning orange and success green, as the page's tokens. */
  .wallet-give-isk .nothing-found { color: var(--color-warn); }
  .wallet-give-isk .give-done { color: var(--color-good); }
</style>
