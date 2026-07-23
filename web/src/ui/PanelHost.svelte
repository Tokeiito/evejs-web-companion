<script lang="ts">
  // The main-area host for a SELECTED tab — static (a Neocom pick) or
  // state-specific (a shell control). One place the tab -> real component
  // mapping lives, so App and both shells stay thin routers. Every panel here is
  // a pre-existing, working component; only the two state SHELLS themselves are
  // still placeholder chrome.
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
  import CharacterSheet from "./CharacterSheet.svelte";
  import type { TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let {
    store,
    flow,
    tab,
    onOpen,
  }: {
    store: ClientStore;
    flow: AppFlow;
    tab: TabID;
    // Lets a panel navigate to another tab (e.g. Agent Finder -> Travel).
    onOpen?: (tab: TabID) => void;
  } = $props();
</script>

{#if tab === "station"}
  <StationPanel {store} {flow} />
{:else if tab === "inventory"}
  <InventoryShip {store} {flow} />
{:else if tab === "fitting"}
  <Fitting {store} {flow} />
{:else if tab === "industry"}
  <Industry {store} {flow} />
{:else if tab === "market"}
  <Market {store} {flow} />
{:else if tab === "mail"}
  <Mail {store} {flow} />
{:else if tab === "contracts"}
  <Contracts {store} {flow} />
{:else if tab === "assets"}
  <PersonalAssets {store} {flow} />
{:else if tab === "agents"}
  <AgentsMissions {store} {flow} />
{:else if tab === "finder"}
  <AgentFinder {store} {flow} showTravel={() => onOpen?.("travel")} />
{:else if tab === "flight"}
  <Flight {store} {flow} />
{:else if tab === "overview"}
  <Overview {store} {flow} />
{:else if tab === "mining"}
  <Mining {store} {flow} />
{:else if tab === "skills"}
  <Skills {store} {flow} />
{:else if tab === "planets"}
  <Planets {store} {flow} />
{:else if tab === "travel"}
  <Travel {store} {flow} />
{:else if tab === "bots"}
  <Bots {store} {flow} />
{:else if tab === "wallet"}
  <Wallet {store} {flow} />
{:else if tab === "corpWallet"}
  <CorpWallet {store} {flow} />
{:else if tab === "standings"}
  <Standings {store} {flow} />
{:else if tab === "characterSheet"}
  <CharacterSheet {store} {flow} />
{:else}
  <Chat {store} {flow} />
{/if}
