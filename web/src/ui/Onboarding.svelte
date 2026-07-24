<script lang="ts">
  // R107 — one session's login → character-select flow, bound to that session's
  // own store+flow. Used twice: full-screen for the first pilot at boot, and
  // inside an overlay for "Add character" (App supplies the framing). The moment
  // the character comes online it hands the now-live session back to App via
  // `onOnline`, which adds it to the bar and makes it active.
  //
  // To make adding pilots quick it remembers every character list a sign-in
  // returns (knownCharacters.ts) and offers those pilots as one-click quick-adds
  // above the login form.
  import LoginForm from "./LoginForm.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import KnownCharacterPicker from "./KnownCharacterPicker.svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import {
    loadKnownCharacters,
    rememberCharacters,
    forgetKnownCharacter,
    type KnownCharacter,
  } from "../app/knownCharacters.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, onOnline, onlineIDs = new Set<number>() }: {
    store: ClientStore;
    flow: AppFlow;
    onOnline: () => void;
    /** Character IDs already online in this tab — quick-adds for them are disabled. */
    onlineIDs?: Set<number>;
  } = $props();

  // Stable store identity for this component's lifetime.
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const character = store.character;

  // Fire once, when select brings the character online. App unmounts this
  // component in response, so the guard is belt-and-suspenders.
  let handedOff = false;
  $effect(() => {
    if (!handedOff && $station.online !== null) {
      handedOff = true;
      onOnline();
    }
  });

  // Remember every character list a sign-in returns, so the picker can offer
  // these pilots next time. Upsert is idempotent, so re-recording is free.
  $effect(() => {
    const username = $session.username;
    const characters = $character.characters;
    if (username && characters.length > 0) {
      rememberCharacters(username, characters);
    }
  });

  // The roster shown before login (a snapshot at mount; reloaded after a forget).
  let known = $state<KnownCharacter[]>(loadKnownCharacters());
  let busyID = $state<number | null>(null);
  let error = $state("");

  // One click = sign in to the pilot's account (any password) + select it. A
  // failed login keeps us on the picker with the reason; a login that succeeds
  // but whose select is refused falls through to the normal character list.
  async function quickAdd(pick: KnownCharacter): Promise<void> {
    if (busyID !== null) return;
    busyID = pick.characterID;
    error = "";
    try {
      await flow.login(pick.accountName, "");
      await flow.selectCharacter(pick.characterID);
    } catch (cause) {
      error =
        cause instanceof BridgeCallError
          ? cause.code === "UNKNOWN_EVEJS_ACCOUNT"
            ? `Account "${pick.accountName}" no longer exists.`
            : cause.code === "CALL_REFUSED"
              ? cause.message
              : `${cause.code}: ${cause.message}`
          : String(cause);
    } finally {
      busyID = null;
    }
  }

  function forget(characterID: number): void {
    forgetKnownCharacter(characterID);
    known = loadKnownCharacters();
  }
</script>

{#if $session.phase !== "logged-in"}
  <KnownCharacterPicker {known} {onlineIDs} {busyID} onPick={quickAdd} onForget={forget} />
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <LoginForm {store} {flow} />
{:else if $station.online === null}
  <CharacterSelect {store} {flow} />
{/if}
