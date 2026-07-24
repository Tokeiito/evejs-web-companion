<script lang="ts">
  // R107 — one session's login → character-select flow, bound to that session's
  // own store+flow. Used twice: full-screen for the first pilot at boot, and
  // inside an overlay for "Add character" (App supplies the framing). The moment
  // the character comes online it hands the now-live session back to App via
  // `onOnline`, which adds it to the bar and makes it active.
  import LoginForm from "./LoginForm.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, onOnline }: {
    store: ClientStore;
    flow: AppFlow;
    onOnline: () => void;
  } = $props();

  // Stable store identity for this component's lifetime.
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  // Fire once, when select brings the character online. App unmounts this
  // component in response, so the guard is belt-and-suspenders.
  let handedOff = false;
  $effect(() => {
    if (!handedOff && $station.online !== null) {
      handedOff = true;
      onOnline();
    }
  });
</script>

{#if $session.phase !== "logged-in"}
  <LoginForm {store} {flow} />
{:else if $station.online === null}
  <CharacterSelect {store} {flow} />
{/if}
