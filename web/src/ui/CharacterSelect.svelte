<script lang="ts">
  // Character selection: rows come from the typed retail reference call
  // charUnboundMgr.GetCharacterSelectionData (applied to the store by
  // flow.login). Clicking a character dispatches the retail
  // SelectCharacterID tuple onto a persistent browser-backed session.
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import ServerBots from "./ServerBots.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";

  let { store, flow, botFlownIDs = new Set<number>(), onCreate = null }: {
    store: ClientStore;
    flow: AppFlow;
    /** Pilots a SERVER BOT is flying right now — marked so a click isn't a surprise refusal. */
    botFlownIDs?: Set<number>;
    /**
     * Go to the create-character screen. Null hides the affordance entirely —
     * an embedding that has nowhere to send the player must not offer it. When
     * this account has NO characters, this is the only way off this screen.
     */
    onCreate?: (() => void) | null;
  } = $props();

  // Stable store identity; slice signals are Svelte-store-contract objects.
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const character = store.character;

  let busyCharacterID = $state<number | null>(null);
  let error = $state("");

  async function select(characterID: number): Promise<void> {
    if (busyCharacterID !== null) {
      return;
    }
    busyCharacterID = characterID;
    error = "";
    try {
      await flow.selectCharacter(characterID);
    } catch (cause) {
      error =
        cause instanceof BridgeCallError
          ? cause.code === "CALL_REFUSED"
            ? cause.message
            : panelErrorWords(cause)
          : String(cause);
    } finally {
      busyCharacterID = null;
    }
  }

  async function logout(): Promise<void> {
    error = "";
    try {
      await flow.logout();
    } catch (cause) {
      error = String(cause);
    }
  }
</script>

<section class="panel">
  <header class="panel-head">
    <h2>Select character</h2>
  </header>
  {#if $session.accountCreated}
    <!-- R2: this login minted the account (the server had never seen the
         name). Words, not inference — a brand-new account also has zero
         characters, and "no characters yet" alone reads like data loss to
         someone who expected an existing account. -->
    <p class="note" role="status">
      New account <strong>{$session.username}</strong> created.
    </p>
  {:else}
    <p class="note">
      Signed in as <strong>{$session.username}</strong>. Select a character to
      bring it online — a character already in use elsewhere cannot be selected.
    </p>
  {/if}
  {#if $character.characters.length === 0}
    <!-- Before creation existed this was a dead end: an account with no pilots
         had nothing to click but "Log out". -->
    <p class="empty">
      This account has no characters yet.
      {#if onCreate}Create one to start flying.{/if}
    </p>
  {:else}
    <ul class="character-list">
      {#each $character.characters as row (row.characterID)}
        {@const botFlown = botFlownIDs.has(row.characterID)}
        <li>
          <button
            type="button"
            class="character"
            disabled={busyCharacterID !== null}
            onclick={() => select(row.characterID)}
          >
            <span class="name">
              {row.characterName}
              {#if botFlown}
                <!-- Words with the mark, never the mark alone (R9a). -->
                <span class="bot-flying-badge" title="A server bot is flying this pilot">⚙ Bot flying</span>
              {/if}
            </span>
            <span class="detail">
              {row.shipName ?? "No ship"}
              · {row.skillPoints ?? 0} SP
              · {row.balance ?? 0} ISK
            </span>
            {#if busyCharacterID === row.characterID}
              <span class="detail">Entering station…</span>
            {:else if botFlown}
              <span class="detail">A server bot is flying this pilot — stop it below to fly it yourself.</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}
    <p class="error">{error}</p>
  {/if}
  <p class="select-actions">
    {#if onCreate}
      <button
        type="button"
        class={$character.characters.length === 0 ? "primary" : "minor"}
        disabled={busyCharacterID !== null}
        onclick={onCreate}
      >Create character</button>
    {/if}
    <button type="button" class="minor" onclick={logout}>Log out</button>
  </p>
</section>

<!--
  The server-bot readout lives HERE as well as on the Bots panel: handing a
  hull to a server bot drops this tab to this screen, and the player must
  still be able to see — and stop — the bot without bringing a character
  online first.
-->
<ServerBots />
