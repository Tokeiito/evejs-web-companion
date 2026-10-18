<script lang="ts">
  // The client's Corporation window (neocom/corporation/corporationWindow.py): its tabs (Corporation, Alliances and,
  // for a director, Administration) and under Corporation its navigation tree (ConstructNavigationTree: Wars, Voting,
  // Standings, Members and the rest, each its panels). The page has, of it, the Corporation tab's Standings node with
  // its NPC Standings panel (CorpPanel.NPC_STANDINGS: the corporation's StandingsPanel, toID the corporation,
  // corpMode).
  //
  // Not here yet: the window's other tabs and nodes (the corporation's home, members, wars, voting, its contacts and
  // the rest).
  import Standings from "./Standings.svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  /** The window's names, with the page's own words where the install's are not had (corpPanelConst NAME_BY_PANEL_ID). */
  const WORDS: Readonly<Record<string, string>> = {
    "UI/Corporations/BaseCorporationUI/Corporation": "Corporation",
    "UI/InfoWindow/TabNames/Standings": "Standing",
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
    <!-- The navigation tree (Corporation > Standings > NPC Standings), the one node the page has selected. -->
    <nav class="corp-tree" aria-label={word("UI/Corporations/BaseCorporationUI/Corporation")}>
      <span class="corp-tree-group">{word("UI/InfoWindow/TabNames/Standings")}</span>
      <button type="button" class="corp-tree-node active" aria-current="page">{word("UI/Corporations/CorporationWindow/Standings/NPCStandings")}</button>
    </nav>
    <div class="corp-panel">
      <Standings {store} {flow} scopes={["corp"]} />
    </div>
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
