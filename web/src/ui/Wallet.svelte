<script lang="ts">
  // Wallet page (goal R50, extended R54): the character's personal ISK balance
  // (account.GetCashBalance) plus the personal LEDGER — the wallet's activity,
  // which the retail client reads as account.GetTransactions and lists as
  // "Transactions" — ref-types labelled from account.GetEntryTypes. (The client's
  // "Market Transactions" are another read, marketProxy.CharGetTransactions, and
  // are on the Market page here.) A
  // pure reader of the store; the read lives in app/flow.ts (loadWallet) and the
  // BFF holds the session. The Corp Wallet tab reads divisions from the SAME pull.
  //
  // ⚠ R7d: a ledger row shows only WHEN, WHAT (the human ref-type label) and the
  // ISK amount — never a raw refID/ownerID (those are dropped in the decoder) and
  // never the server's free-text description (it embeds typeIDs/systemIDs).
  // ⚠ empty vs failed. `journal` is null while unread OR when the
  // read FAILED (the reason is in the matching *Error); an empty list is the real
  // "no wallet activity yet" answer (worldHasNoContracts precedent).
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import { formatIsk } from "./isk.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { plainText } from "../bridge/clientWords.ts";
  import WalletMarketTransactions from "./WalletMarketTransactions.svelte";
  import WalletJournal from "./WalletJournal.svelte";
  import WalletOverview from "./WalletOverview.svelte";
  import WalletGiveIsk from "./WalletGiveIsk.svelte";
  import WalletShares from "./WalletShares.svelte";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const wallet = store.wallet;
  // svelte-ignore state_referenced_locally
  const words = store.words;

  // The personal wallet's tabs (personalISKPanel.py GetMainTabs, 22 to 23), as far as the page has them: Overview
  // (WalletOverview), the first, which the window opens on; Transactions (WalletJournal); Market Transactions
  // (WalletMarketTransactions).
  const TAB_WORDS = {
    overview: "UI/Wallet/WalletWindow/TabOverview",
    transactions: "UI/Wallet/WalletWindow/TabTransactions",
    market: "UI/Wallet/WalletWindow/MarketTransactions",
    shares: "UI/Wallet/WalletWindow/TabShares",
    give: "UI/Wallet/WalletWindow/GiveMoney",
  } as const;
  $effect(() => {
    flow.requestWords(Object.values(TAB_WORDS));
  });
  function tabWord(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? plainText(template) : own;
  }
  let tab = $state<"overview" | "transactions" | "market" | "shares" | "give">("overview");

  let busy = $state(false);
  let error = $state("");

  async function run(action: () => Promise<void> | void): Promise<void> {
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        return;
      }
      error =
        panelErrorWords(cause);
    } finally {
      busy = false;
    }
  }

  // The button asks the server again. The window opening takes what the wallet's services have kept
  // (bridge/walletReads.ts), which the server's own word keeps right, and asks only for what they have not.
  function refresh(): void {
    void run(() => flow.loadWallet({ fresh: true }));
  }

  onMount(() => {
    void run(() => flow.loadWallet());
  });

</script>

<section class="panel">
  <!-- ⚠ REFRESH LIVES IN THE STRIP, NOT AT THE BOTTOM OF THE PAGE. It used
       to be a bare <p><button> after the last section, so this window put its
       one action somewhere no other window puts one — below content of
       unpredictable length, which on a full read meant scrolling past
       everything to reach it. Nothing was added or taken away; the control
       moved to the band every other window keeps its controls in. -->
  <header class="panel-head">
    <h2 class="panel-title">Wallet</h2>
    <span class="controls">
      <button type="button" disabled={busy} onclick={refresh}>Refresh</button>
    </span>
  </header>

  {#if error}
    <p class="error">Could not read the wallet: {error}</p>
  {/if}
  {#if $wallet.cashError}
    <p class="error">The balance read failed: {$wallet.cashError}</p>
  {/if}

  {#if !$wallet.loaded}
    <p class="empty">Reading your balance…</p>
  {:else}
    <table class="guests">
      <tbody>
        <tr>
          <th scope="row">Balance</th>
          <td class="num">{formatIsk($wallet.cashBalance)}</td>
        </tr>
      </tbody>
    </table>
  {/if}

  <nav class="tabs">
    <button type="button" class:active={tab === "overview"} onclick={() => (tab = "overview")}>{tabWord(TAB_WORDS.overview, "Overview")}</button>
    <button type="button" class:active={tab === "transactions"} onclick={() => (tab = "transactions")}>{tabWord(TAB_WORDS.transactions, "Transactions")}</button>
    <button type="button" class:active={tab === "market"} onclick={() => (tab = "market")}>{tabWord(TAB_WORDS.market, "Market Transactions")}</button>
    <button type="button" class:active={tab === "shares"} onclick={() => (tab = "shares")}>{tabWord(TAB_WORDS.shares, "Shares")}</button>
    <button type="button" class:active={tab === "give"} onclick={() => (tab = "give")}>{tabWord(TAB_WORDS.give, "Give ISK")}</button>
  </nav>

  {#if tab === "overview"}
    <WalletOverview {store} {flow} />
  {:else if tab === "market"}
    <WalletMarketTransactions {store} {flow} />
  {:else if tab === "shares"}
    <WalletShares {store} {flow} />
  {:else if tab === "give"}
    <WalletGiveIsk {store} {flow} />
  {:else}
    <WalletJournal {store} {flow} />
  {/if}

</section>

