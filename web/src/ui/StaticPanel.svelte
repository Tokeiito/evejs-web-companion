<script lang="ts">
  // The main-area host for a selected STATIC tab (a Neocom pick). Unlike the two
  // state shells, the static panels are the pre-existing, working panels — so
  // this wires the REAL components, keyed by the tab id. It is the one place the
  // static-tab -> component mapping lives; App stays a thin router.
  import InventoryShip from "./InventoryShip.svelte";
  import Market from "./Market.svelte";
  import Industry from "./Industry.svelte";
  import Contracts from "./Contracts.svelte";
  import PersonalAssets from "./PersonalAssets.svelte";
  import AgentsMissions from "./AgentsMissions.svelte";
  import AgentFinder from "./AgentFinder.svelte";
  import Skills from "./Skills.svelte";
  import Planets from "./Planets.svelte";
  import Mail from "./Mail.svelte";
  import Chat from "./Chat.svelte";
  import Wallet from "./Wallet.svelte";
  import CorpWallet from "./CorpWallet.svelte";
  import Standings from "./Standings.svelte";
  import CharacterSheet from "./CharacterSheet.svelte";
  import type { TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, tab }: { store: ClientStore; flow: AppFlow; tab: TabID } = $props();
</script>

{#if tab === "inventory"}
  <InventoryShip {store} {flow} />
{:else if tab === "market"}
  <Market {store} {flow} />
{:else if tab === "industry"}
  <Industry {store} {flow} />
{:else if tab === "contracts"}
  <Contracts {store} {flow} />
{:else if tab === "assets"}
  <PersonalAssets {store} {flow} />
{:else if tab === "agents"}
  <AgentsMissions {store} {flow} />
{:else if tab === "finder"}
  <AgentFinder {store} {flow} showTravel={() => {}} />
{:else if tab === "skills"}
  <Skills {store} {flow} />
{:else if tab === "planets"}
  <Planets {store} {flow} />
{:else if tab === "mail"}
  <Mail {store} {flow} />
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
