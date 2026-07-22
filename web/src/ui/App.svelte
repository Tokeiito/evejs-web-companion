<script lang="ts">
  // R2/R3 page flow, a pure reader of the client-state store: login form ->
  // character selection -> the tabbed app. Which tabs show and which is selected
  // are driven by whether the character is DOCKED or IN SPACE (goal R50), from
  // the authoritative flight flag — not a hardcoded default. All fetch/decode
  // logic lives in app/flow.ts; the store slices are Svelte-store-contract
  // signals, so $-auto-subscription reads them directly.
  import LoginForm from "./LoginForm.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import StationPanel from "./StationPanel.svelte";
  import InventoryShip from "./InventoryShip.svelte";
  import Fitting from "./Fitting.svelte";
  import Industry from "./Industry.svelte";
  import Market from "./Market.svelte";
  import Mail from "./Mail.svelte";
  import Contracts from "./Contracts.svelte";
  import PersonalAssets from "./PersonalAssets.svelte";
  import AgentsMissions from "./AgentsMissions.svelte";
  import AgentFinder from "./AgentFinder.svelte";
  import Flight from "./Flight.svelte";
  import Overview from "./Overview.svelte";
  import Mining from "./Mining.svelte";
  import Skills from "./Skills.svelte";
  import Planets from "./Planets.svelte";
  import Travel from "./Travel.svelte";
  import Bots from "./Bots.svelte";
  import Chat from "./Chat.svelte";
  import Wallet from "./Wallet.svelte";
  import CorpWallet from "./CorpWallet.svelte";
  import Standings from "./Standings.svelte";
  import { visibleTabsFor, resolvePage, deriveDocked, type TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // The store's identity is stable for the app's lifetime; capturing the
  // slice signals once is intended (they are Svelte-store-contract objects).
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;

  // Docked vs in space, and the tabs + selection that follow from it. The tab
  // TABLE and every rule live in tabs.ts (goal R50 items 1 + 4) so this stays a
  // thin renderer; changing which set a tab is in is a one-line edit there.
  const isDocked = $derived(deriveDocked($flight.status, $station.online));
  const visibleTabs = $derived(visibleTabsFor(isDocked));

  // The tab the player explicitly chose, or null to follow the state default.
  let selected = $state<TabID | null>(null);

  // The effective page: the player's choice while it is still visible, otherwise
  // the current state's default. So the FIRST paint matches where the character
  // actually is, and docking / undocking that hides the chosen tab falls back to
  // that state's default instead of showing a blank or the wrong panel.
  const page = $derived(resolvePage(selected, isDocked));

  function selectTab(id: TabID): void {
    selected = id;
  }

  // Once a character is online, read the flight status so the docked/in-space
  // flag is authoritative (character select does not read it). Runs once —
  // subsequent flight steps (undock / dock / travel / autopilot) keep it fresh
  // through the same store slice. $effect never runs under SSR, so the initial
  // paint still relies on the station-context fallback above.
  $effect(() => {
    if ($session.phase === "logged-in" && $station.online !== null && $flight.status === null) {
      void flow.loadFlightStatus().catch(() => {});
    }
  });
</script>

<h1>EveJS Web</h1>
{#if $session.phase !== "logged-in"}
  <LoginForm {flow} />
{:else if $station.online === null}
  <CharacterSelect {store} {flow} />
{:else}
  <nav class="tabs">
    {#each visibleTabs as tab (tab.id)}
      <button type="button" class:active={page === tab.id} onclick={() => selectTab(tab.id)}>
        {tab.label}
      </button>
    {/each}
  </nav>
  {#if page === "station"}
    <StationPanel {store} {flow} />
  {:else if page === "inventory"}
    <InventoryShip {store} {flow} />
  {:else if page === "fitting"}
    <Fitting {store} {flow} />
  {:else if page === "industry"}
    <Industry {store} {flow} />
  {:else if page === "market"}
    <Market {store} {flow} />
  {:else if page === "mail"}
    <Mail {store} {flow} />
  {:else if page === "contracts"}
    <Contracts {store} {flow} />
  {:else if page === "assets"}
    <PersonalAssets {store} {flow} />
  {:else if page === "agents"}
    <AgentsMissions {store} {flow} />
  {:else if page === "finder"}
    <AgentFinder {store} {flow} showTravel={() => selectTab("travel")} />
  {:else if page === "flight"}
    <Flight {store} {flow} />
  {:else if page === "overview"}
    <Overview {store} {flow} />
  {:else if page === "mining"}
    <Mining {store} {flow} />
  {:else if page === "skills"}
    <Skills {store} {flow} />
  {:else if page === "planets"}
    <Planets {store} {flow} />
  {:else if page === "travel"}
    <Travel {store} {flow} />
  {:else if page === "bots"}
    <Bots {store} {flow} />
  {:else if page === "wallet"}
    <Wallet {store} {flow} />
  {:else if page === "corpWallet"}
    <CorpWallet {store} {flow} />
  {:else if page === "standings"}
    <Standings {store} {flow} />
  {:else}
    <Chat {store} {flow} />
  {/if}
{/if}
