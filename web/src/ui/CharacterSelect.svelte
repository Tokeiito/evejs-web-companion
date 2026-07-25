<script lang="ts">
  // Character selection: rows come from the typed retail reference call
  // charUnboundMgr.GetCharacterSelectionData (applied to the store by
  // flow.login). Clicking a character dispatches the retail
  // SelectCharacterID tuple onto a persistent browser-backed session.
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import ServerBots from "./ServerBots.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

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
            : `${cause.code}: ${cause.message}`
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
  <p class="note">
    Signed in as <strong>{$session.username}</strong>. Select a character to
    bring it online — a character already in use elsewhere cannot be selected.
  </p>
  {#if $character.characters.length === 0}
    <p class="empty">This account has no characters.</p>
  {:else}
    <ul class="character-list">
      {#each $character.characters as row (row.characterID)}
        <li>
          <button
            type="button"
            class="character"
            disabled={busyCharacterID !== null}
            onclick={() => select(row.characterID)}
          >
            <span class="name">{row.characterName}</span>
            <span class="detail">
              {row.shipName ?? "No ship"}
              · {row.skillPoints ?? 0} SP
              · {row.balance ?? 0} ISK
            </span>
            {#if busyCharacterID === row.characterID}
              <span class="detail">Entering station…</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}
    <p class="error">{error}</p>
  {/if}
  <p><button type="button" class="minor" onclick={logout}>Log out</button></p>
</section>

<!--
  The server-bot readout lives HERE as well as on the Bots panel: handing a
  hull to a server bot drops this tab to this screen, and the player must
  still be able to see — and stop — the bot without bringing a character
  online first.
-->
<ServerBots />
