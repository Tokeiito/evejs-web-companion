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
  import Fitting from "./Fitting.svelte";
  import Industry from "./Industry.svelte";
  import AgentsMissions from "./AgentsMissions.svelte";
  import AgentFinder from "./AgentFinder.svelte";
  import Flight from "./Flight.svelte";
  import Overview from "./Overview.svelte";
  import Travel from "./Travel.svelte";
  import Chat from "./Chat.svelte";
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
  let page = $state<
    | "station"
    | "inventory"
    | "fitting"
    | "industry"
    | "agents"
    | "finder"
    | "flight"
    | "overview"
    | "travel"
    | "chat"
  >("station");
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
    <button type="button" class:active={page === "fitting"} onclick={() => (page = "fitting")}>
      Fitting
    </button>
    <button type="button" class:active={page === "industry"} onclick={() => (page = "industry")}>
      Industry
    </button>
    <button type="button" class:active={page === "agents"} onclick={() => (page = "agents")}>
      Agents &amp; Missions
    </button>
    <button type="button" class:active={page === "finder"} onclick={() => (page = "finder")}>
      Agent Finder
    </button>
    <button type="button" class:active={page === "flight"} onclick={() => (page = "flight")}>
      Flight
    </button>
    <button type="button" class:active={page === "overview"} onclick={() => (page = "overview")}>
      Around Your Ship
    </button>
    <button type="button" class:active={page === "travel"} onclick={() => (page = "travel")}>
      Travel
    </button>
    <button type="button" class:active={page === "chat"} onclick={() => (page = "chat")}>
      Chat
    </button>
  </nav>
  {#if page === "station"}
    <StationPanel {store} {flow} />
  {:else if page === "inventory"}
    <InventoryShip {store} {flow} />
  {:else if page === "fitting"}
    <Fitting {store} {flow} />
  {:else if page === "industry"}
    <Industry {store} {flow} />
  {:else if page === "agents"}
    <AgentsMissions {store} {flow} />
  {:else if page === "finder"}
    <AgentFinder {store} {flow} showTravel={() => (page = "travel")} />
  {:else if page === "flight"}
    <Flight {store} {flow} />
  {:else if page === "overview"}
    <Overview {store} {flow} />
  {:else if page === "travel"}
    <Travel {store} {flow} />
  {:else}
    <Chat {store} {flow} />
  {/if}
{/if}
