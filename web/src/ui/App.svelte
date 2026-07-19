<script lang="ts">
  // R2/R3 page flow, a pure reader of the client-state store: login form ->
  // character selection -> docked station panel, with a tab to the R3
  // Inventory & Ship page. All fetch/decode logic lives in app/flow.ts; the
  // store slices are Svelte-store-contract signals, so $-auto-subscription
  // reads them directly.
  import LoginForm from "./LoginForm.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import StationPanel from "./StationPanel.svelte";
  import InventoryShip from "./InventoryShip.svelte";
  import AgentsMissions from "./AgentsMissions.svelte";
  import Flight from "./Flight.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // The store's identity is stable for the app's lifetime; capturing the
  // slice signals once is intended (they are Svelte-store-contract objects).
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  // Which docked page is showing. Local UI state only (the store mirrors EveJS
  // state, not view navigation).
  let page = $state<"station" | "inventory" | "agents" | "flight">("station");
</script>

<h1>EveJS Web</h1>
{#if $session.phase !== "logged-in"}
  <LoginForm {flow} />
{:else if $station.online === null}
  <CharacterSelect {store} {flow} />
{:else}
  <nav class="tabs">
    <button type="button" class:active={page === "station"} onclick={() => (page = "station")}>
      Station
    </button>
    <button type="button" class:active={page === "inventory"} onclick={() => (page = "inventory")}>
      Inventory &amp; Ship
    </button>
    <button type="button" class:active={page === "agents"} onclick={() => (page = "agents")}>
      Agents &amp; Missions
    </button>
    <button type="button" class:active={page === "flight"} onclick={() => (page = "flight")}>
      Flight
    </button>
  </nav>
  {#if page === "station"}
    <StationPanel {store} {flow} />
  {:else if page === "inventory"}
    <InventoryShip {store} {flow} />
  {:else if page === "agents"}
    <AgentsMissions {store} {flow} />
  {:else}
    <Flight {store} {flow} />
  {/if}
{/if}
