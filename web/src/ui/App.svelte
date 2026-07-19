<script lang="ts">
  // R2 page flow, a pure reader of the client-state store: login form ->
  // character selection -> docked station panel. All fetch/decode logic lives
  // in app/flow.ts; the store slices are Svelte-store-contract signals, so
  // $-auto-subscription reads them directly.
  import LoginForm from "./LoginForm.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import StationPanel from "./StationPanel.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // The store's identity is stable for the app's lifetime; capturing the
  // slice signals once is intended (they are Svelte-store-contract objects).
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const station = store.station;
</script>

<h1>EveJS Web</h1>
{#if $session.phase !== "logged-in"}
  <LoginForm {flow} />
{:else if $station.online === null}
  <CharacterSelect {store} {flow} />
{:else}
  <StationPanel {store} {flow} />
{/if}
