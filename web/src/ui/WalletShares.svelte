<script lang="ts">
  // The wallet's Shares tab (sharesPanel.py; bridge/walletShares.ts): each corporation the pilot holds shares in, by
  // the owner (the pilot), the corporation and the shares (FmtAmt), or the client's words for none. Its menu
  // (sharesUtil.GetSharesMenu): the owner's Show Info.
  //
  // Read as the tab is chosen (OnTabSelect) and again at OnShareChange.
  //
  // Not done: the menu's Votes (the corporation's voting window) and Give Shares (its dialog), and the corporation's
  // own menu.
  import { onMount } from "svelte";
  import { plainText } from "../bridge/clientWords.ts";
  import { resolvedName, type NameRef } from "../store/names.ts";
  import { showInfo } from "./showInfo.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const read = flow.walletShares;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // PersonalSharesPanel.GetOwnerID returns session.charid; the holding row has no owner column.
  const ownerID = $derived($station.online?.characterID ?? null);

  const W = "UI/Wallet/WalletWindow";
  const WORDS = {
    owner: `${W}/ColHeaderOwner`,
    corporation: `${W}/ColHeaderCorporation`,
    shares: `${W}/ColHeaderShares`,
    none: `${W}/HintNoShares`,
    menuOwner: `${W}/MenuOwner`,
  } as const;
  $effect(() => {
    flow.requestWords(Object.values(WORDS));
  });
  $effect(() => {
    const refs: NameRef[] = $read.holdings.map(holding => ({ kind: "owner", id: holding.corporationID }));
    if (ownerID !== null) refs.push({ kind: "owner", id: ownerID });
    if (refs.length > 0) flow.requestNames(refs);
  });
  const word = (label: string, own: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? plainText(template) : own;
  };
  const ownerName = (id: number): string => resolvedName($names.resolved, "owner", id, "");
  let menuFor = $state<number | null>(null);

  onMount(() => {
    void flow.loadWalletShares().catch(() => undefined);
  });
</script>

<div class="wallet-shares">
  {#if $read.error}
    <p class="error">The read failed: {$read.error}</p>
  {:else if !$read.loaded}
    <p class="empty">Reading…</p>
  {:else if $read.holdings.length === 0}
    <p class="empty">{word(WORDS.none, "You hold no shares.")}</p>
  {:else}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead>
          <tr>
            <th>{word(WORDS.owner, "Owner")}</th>
            <th>{word(WORDS.corporation, "Corporation")}</th>
            <th class="num">{word(WORDS.shares, "Shares")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each $read.holdings as holding (holding.corporationID)}
            <tr>
              <td data-label={word(WORDS.owner, "Owner")}>{ownerID === null ? "" : ownerName(ownerID)}</td>
              <td data-label={word(WORDS.corporation, "Corporation")}>{ownerName(holding.corporationID)}</td>
              <td class="num" data-label={word(WORDS.shares, "Shares")}>{Math.trunc(holding.shares).toLocaleString("en-US")}</td>
              <td data-label="">
                <button type="button" class="minor" aria-label="The holding's menu" aria-expanded={menuFor === holding.corporationID}
                  onclick={() => (menuFor = menuFor === holding.corporationID ? null : holding.corporationID)}>⋯</button>
                {#if menuFor === holding.corporationID && ownerID !== null}
                  <button type="button" class="minor" onclick={() => { menuFor = null; if (ownerID !== null) showInfo({ kind: "character", characterID: ownerID }); }}>{word(WORDS.menuOwner, "Owner")}</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
