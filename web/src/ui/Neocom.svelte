<script lang="ts">
  // The Neocom — the persistent navigation rail down the left, present in BOTH
  // states (docked and in space). It holds the STATIC tabs (the panels reachable
  // regardless of where the character is) plus a "home" control that returns to
  // the state shell. Web-native, not a floating window: selecting a tab fills
  // the main content area, and the rail collapses to a horizontal scroller on
  // phones (see .neocom in styles.css).
  //
  // Pure chrome: it holds no state, only reports the selection up via callbacks.
  import { staticTabs, type TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let {
    isDocked,
    selected,
    onSelect,
    onHome,
  }: {
    // store is accepted for forward-compat (badges/portraits later) though the
    // rail needs none of it yet.
    store?: ClientStore;
    isDocked: boolean;
    selected: TabID | null;
    onSelect: (id: TabID) => void;
    onHome: () => void;
  } = $props();

  const tabs = staticTabs();
</script>

<nav class="neocom" aria-label="Main menu">
  <button
    type="button"
    class="neocom-home"
    class:active={selected === null}
    aria-current={selected === null ? "page" : undefined}
    onclick={onHome}
  >
    <span class="state-badge {isDocked ? 'docked' : 'in-space'}">{isDocked ? "Docked" : "In Space"}</span>
    <span class="neocom-home-label">{isDocked ? "Station" : "Ship"}</span>
  </button>

  <ul class="neocom-list">
    {#each tabs as tab (tab.id)}
      <li>
        <button
          type="button"
          class="neocom-item"
          class:active={selected === tab.id}
          aria-current={selected === tab.id ? "page" : undefined}
          onclick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      </li>
    {/each}
  </ul>
</nav>
