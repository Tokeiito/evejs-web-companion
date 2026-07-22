<script lang="ts">
  // Wallet page (goal R50): the character's personal ISK balance
  // (account.GetCashBalance, already allowlisted). A pure reader of the store;
  // the read lives in app/flow.ts (loadWallet) and the BFF holds the session.
  // The Corp Wallet tab reads the corporation divisions from the SAME pull.
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import { formatIsk } from "./isk.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const wallet = store.wallet;

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
        cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
    } finally {
      busy = false;
    }
  }

  function refresh(): void {
    void run(() => flow.loadWallet());
  }

  onMount(() => {
    refresh();
  });
</script>

<section>
  <h2>Wallet</h2>
  <p class="note">Your personal balance.</p>

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

  <p>
    <button type="button" disabled={busy} onclick={refresh}>Refresh</button>
  </p>
</section>
