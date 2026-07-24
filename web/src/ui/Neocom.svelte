<script lang="ts">
  // The Neocom — the persistent launcher rail down the left, present in BOTH
  // states. It lists the panels openable in the current state (docked/in-space),
  // and clicking one opens it as a window on the desktop — or, if it is already
  // open, brings it to the front. Open panels stay highlighted so the rail
  // doubles as a "what's on my desktop" map; the front-most window is marked
  // current. The two fixed-chrome panels (Station / Overview) are not launched
  // here — they live in the top-right dock panel.
  //
  // Pure chrome: it holds no state, only reports the pick up via onSelect.
  import { visibleTabsFor, type TabID } from "./tabs.ts";
  import { isWindowTab } from "./desktop.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let {
    isDocked,
    openIds,
    focusedId,
    onSelect,
  }: {
    // store is accepted for forward-compat (badges/portraits later).
    store?: ClientStore;
    isDocked: boolean;
    openIds: Set<TabID>;
    focusedId: TabID | null;
    onSelect: (id: TabID) => void;
  } = $props();

  const tabs = $derived(visibleTabsFor(isDocked).filter((tab) => isWindowTab(tab.id)));
</script>

<nav class="neocom" aria-label="Panels">
  <div class="neocom-brand">
    <span class="neocom-brand-name">EVEJS</span>
    <span class="state-badge {isDocked ? 'docked' : 'in-space'}">{isDocked ? "Docked" : "In Space"}</span>
  </div>

  <ul class="neocom-list">
    {#each tabs as tab (tab.id)}
      <li>
        <button
          type="button"
          class="neocom-item"
          class:open={openIds.has(tab.id)}
          class:active={focusedId === tab.id}
          aria-pressed={openIds.has(tab.id)}
          onclick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      </li>
    {/each}
  </ul>
</nav>
