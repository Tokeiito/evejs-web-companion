<script lang="ts">
  // The client's Corporation window (neocom/corporation/corporationWindow.py): its tabs (Corporation, Alliances and,
  // for a director, Administration) and under Corporation its navigation tree (ConstructNavigationTree: Wars, Voting,
  // Standings, Members and the rest, each its panels). The page has Member List under Members and the Standings node's
  // Contacts form (TAB_CORPCONTACTS) and NPC Standings panel (toID the corporation, corpMode).
  //
  // Not here yet: the window's other tabs and nodes (the corporation's home, other member panels, wars, voting and
  // the rest).
  import Standings from "./Standings.svelte";
  import Contacts from "./Contacts.svelte";
  import CorporationMembers from "./CorporationMembers.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, openMail }: { store: ClientStore; flow: AppFlow; openMail?: () => void } = $props();

  let panel = $state<"contacts" | "npc" | "members">("contacts");
  let membersOpened = $state(false);
  // svelte-ignore state_referenced_locally
  const station = store.station;
  const playerCorporation = $derived(($station.online?.corporationID ?? 0) >= 98_000_000);
  // svelte-ignore state_referenced_locally
  const words = store.words;
  /** The window's names, with the page's own words where the install's are not had (corpPanelConst NAME_BY_PANEL_ID). */
  const WORDS: Readonly<Record<string, string>> = {
    "UI/Corporations/BaseCorporationUI/Corporation": "Corporation",
    "UI/InfoWindow/TabNames/Standings": "Standing",
    "UI/Corporations/BaseCorporationUI/Members": "Members",
    "UI/Corporations/BaseCorporationUI/MemberList": "Member List",
    "UI/Corporations/CorporationWindow/Standings/CorpContacts": "Contacts",
    "UI/Corporations/CorporationWindow/Standings/NPCStandings": "NPCs' standing",
  };
  const word = (label: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" ? template : WORDS[label] ?? "";
  };
  $effect(() => {
    flow.requestWords(Object.keys(WORDS));
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h2 class="panel-title">{word("UI/Corporations/BaseCorporationUI/Corporation")}</h2>
  </header>
  <div class="corp-window">
    <!-- The Standings node has the corporation Contacts form and NPC Standings panel. -->
    {#if playerCorporation}
    <nav class="corp-tree" aria-label={word("UI/Corporations/BaseCorporationUI/Corporation")}>
      <span class="corp-tree-group">{word("UI/Corporations/BaseCorporationUI/Members")}</span>
      <button type="button" class="corp-tree-node" class:active={panel === "members"} aria-current={panel === "members" ? "page" : undefined} onclick={() => { membersOpened = true; panel = "members"; }}>{word("UI/Corporations/BaseCorporationUI/MemberList")}</button>
      <span class="corp-tree-group">{word("UI/InfoWindow/TabNames/Standings")}</span>
      <button type="button" class="corp-tree-node" class:active={panel === "contacts"} aria-current={panel === "contacts" ? "page" : undefined} onclick={() => (panel = "contacts")}>{word("UI/Corporations/CorporationWindow/Standings/CorpContacts")}</button>
      <button type="button" class="corp-tree-node" class:active={panel === "npc"} aria-current={panel === "npc" ? "page" : undefined} onclick={() => (panel = "npc")}>{word("UI/Corporations/CorporationWindow/Standings/NPCStandings")}</button>
    </nav>
    <div class="corp-panel">
      {#key $station.online?.corporationID}
      {#if membersOpened}<div hidden={panel !== "members"}><CorporationMembers {store} {flow} {openMail} /></div>{/if}
      {#if panel === "contacts"}
        <Contacts {store} {flow} contactType="corpcontact" />
      {:else if panel === "npc"}
        <Standings {store} {flow} scopes={["corp"]} />
      {/if}
      {/key}
    </div>
    {:else}
      <p class="empty">Corporation member and standings panels are available for player corporations.</p>
    {/if}
  </div>
</section>

<style>
  .corp-window {
    display: grid;
    grid-template-columns: minmax(9rem, 12rem) minmax(0, 1fr);
    gap: 0.75rem;
  }
  @media (max-width: 720px) {
    .corp-window {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .corp-tree {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .corp-tree-group {
    color: var(--color-muted);
    font-size: 0.9em;
  }
  .corp-tree-node {
    text-align: left;
    border: 0;
    background: transparent;
    padding: 0.2rem 0.5rem;
    font: inherit;
    color: inherit;
  }
  .corp-tree-node.active {
    background: var(--color-panel-2);
    border-left: 2px solid var(--color-accent);
  }
  .corp-panel {
    min-width: 0;
  }
</style>
