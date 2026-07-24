<script lang="ts">
  // The always-open desktop: a positioned surface the floating panel windows live
  // on. It renders one DesktopWindow per open window (a pure reader of the window
  // list App owns), wrapping the real panel via PanelHost. Windows whose tab is
  // not openable in the current state (a docked-only panel after undocking) are
  // hidden here but KEPT in the model, so they reappear on the return trip.
  import DesktopWindow from "./DesktopWindow.svelte";
  import PanelHost from "./PanelHost.svelte";
  import { tabLabel, isTabVisible, type TabID } from "./tabs.ts";
  import { isWindowTab, type WinState } from "./desktop.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let {
    store,
    flow,
    wins,
    focused,
    isDocked,
    onFocus,
    onClose,
    onToggleCollapse,
    onMove,
    onResize,
    onOpen,
  }: {
    store: ClientStore;
    flow: AppFlow;
    wins: WinState[];
    focused: TabID | null;
    isDocked: boolean;
    onFocus: (id: TabID) => void;
    onClose: (id: TabID) => void;
    onToggleCollapse: (id: TabID) => void;
    onMove: (id: TabID, x: number, y: number) => void;
    onResize: (id: TabID, w: number, h: number) => void;
    onOpen: (id: TabID) => void;
  } = $props();

  // Only real window tabs valid in the current state get rendered.
  const shown = $derived(wins.filter((w) => isWindowTab(w.id) && isTabVisible(w.id, isDocked)));
</script>

<div class="desktop">
  {#if shown.length === 0}
    <p class="desktop-empty">
      Open a panel from the left — it opens here as a window. They stay side by side, so you never
      lose sight of what you were doing.
    </p>
  {/if}
  {#each shown as win (win.id)}
    <DesktopWindow
      {win}
      title={tabLabel(win.id)}
      focused={focused === win.id}
      onFocus={() => onFocus(win.id)}
      onClose={() => onClose(win.id)}
      onToggleCollapse={() => onToggleCollapse(win.id)}
      onMove={(x, y) => onMove(win.id, x, y)}
      onResize={(w, h) => onResize(win.id, w, h)}
    >
      <PanelHost {store} {flow} tab={win.id} onOpen={onOpen} />
    </DesktopWindow>
  {/each}
</div>
