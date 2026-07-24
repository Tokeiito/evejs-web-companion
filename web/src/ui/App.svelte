<script lang="ts">
  // Page flow + the workspace, a pure reader of the client-state store: login ->
  // character select -> the WORKSPACE. The workspace is an always-open desktop:
  //   • the Neocom launcher rail down the left (opens panels as windows),
  //   • a context header (where you are + Dock/Undock),
  //   • the desktop itself — floating, self-contained panel windows you keep open
  //     side by side, so opening Market never hides your Inventory,
  //   • a fixed, collapsible top-right dock panel (Overview in space / Station
  //     services when docked), and
  //   • a persistent bottom HUD bar while in space (gauges, module rack, nav).
  // The open windows + dock-collapse state are remembered per character. All
  // fetch/decode lives in app/flow.ts; the store slices are store-contract signals.
  import LoginForm from "./LoginForm.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import Neocom from "./Neocom.svelte";
  import Desktop from "./Desktop.svelte";
  import DockPanel from "./DockPanel.svelte";
  import HudBar from "./HudBar.svelte";
  import WorkspaceHeader from "./WorkspaceHeader.svelte";
  import MobileWorkspace from "./MobileWorkspace.svelte";
  import CustomBotReadout from "./CustomBotReadout.svelte";
  import { deriveDocked, type TabID } from "./tabs.ts";
  import {
    openWindow,
    focusWindow,
    closeWindow,
    moveWindow,
    resizeWindow,
    toggleCollapse,
    focusedId as computeFocusedId,
    loadLayout,
    saveLayout,
    type WinState,
  } from "./desktop.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // The store's identity is stable for the app's lifetime; capturing the slice
  // signals once is intended (they are store-contract objects).
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;

  // Docked vs in space, from the authoritative flag (rule lives in tabs.ts).
  const isDocked = $derived(deriveDocked($flight.status, $station.online));

  // Narrow viewport -> the simplified single-panel mobile UI instead of the
  // floating-window desktop (a desktop of draggable windows is unusable on a
  // phone). matchMedia so it flips live when the window crosses the breakpoint.
  let isMobile = $state(false);
  $effect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const update = (): void => { isMobile = mq.matches; };
    update();
    // Both signals: matchMedia fires on the breakpoint crossing, resize covers
    // environments (and rotations) where the media-change event is unreliable.
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  });

  // ── the desktop: open windows + the collapsible dock panel ──────────────
  let wins = $state<WinState[]>([]);
  let dockCollapsed = $state(false);
  const openIds = $derived(new Set(wins.map((w) => w.id)));
  const focused = $derived(computeFocusedId(wins));

  const open = (id: TabID): void => { wins = openWindow(wins, id); };
  const focus = (id: TabID): void => { wins = focusWindow(wins, id); };
  const close = (id: TabID): void => { wins = closeWindow(wins, id); };
  const move = (id: TabID, x: number, y: number): void => { wins = moveWindow(wins, id, x, y); };
  const resize = (id: TabID, w: number, h: number): void => { wins = resizeWindow(wins, id, w, h); };
  const collapse = (id: TabID): void => { wins = toggleCollapse(wins, id); };
  const toggleDock = (): void => { dockCollapsed = !dockCollapsed; };

  // Restore the saved layout when a character comes online (keyed by characterID)
  // and clear it on logout, so a different pilot in the same tab gets their own
  // desktop. Guarded on the loaded id so it runs once per character.
  let loadedFor = $state<number | null>(null);
  $effect(() => {
    const online = $station.online;
    if (online && loadedFor !== online.characterID) {
      const saved = loadLayout(online.characterID);
      wins = saved ? saved.wins.slice() : [];
      dockCollapsed = saved ? saved.dockCollapsed : false;
      loadedFor = online.characterID;
    } else if (!online && loadedFor !== null) {
      wins = [];
      dockCollapsed = false;
      loadedFor = null;
    }
  });

  // Persist on any layout change, debounced so a drag doesn't hammer storage.
  $effect(() => {
    const id = loadedFor;
    const layout = { wins: wins.map((w) => ({ ...w })), dockCollapsed };
    if (id === null) return;
    const handle = setTimeout(() => saveLayout(id, layout), 300);
    return () => clearTimeout(handle);
  });

  // Read flight status once online so the docked/in-space flag is authoritative
  // (character select does not read it). Subsequent flight steps keep it fresh.
  $effect(() => {
    if ($session.phase === "logged-in" && $station.online !== null && $flight.status === null) {
      void flow.loadFlightStatus().catch(() => {});
    }
  });
</script>

{#if $session.phase !== "logged-in"}
  <h1>EveJS Web</h1>
  <LoginForm {store} {flow} />
{:else if $station.online === null}
  <h1>EveJS Web</h1>
  <CharacterSelect {store} {flow} />
{:else if isMobile}
  <MobileWorkspace {store} {flow} {isDocked} />
{:else}
  <div class="workspace" class:in-space={!isDocked}>
    <Neocom {store} {isDocked} {openIds} focusedId={focused} onSelect={open} />
    <div class="work">
      <WorkspaceHeader {store} {flow} {isDocked} />
      <!-- A running bot's readout, always visible while it runs, nothing when idle. -->
      <CustomBotReadout {store} {flow} />
      <div class="work-main">
        <Desktop
          {store}
          {flow}
          {wins}
          {focused}
          {isDocked}
          onFocus={focus}
          onClose={close}
          onToggleCollapse={collapse}
          onMove={move}
          onResize={resize}
          onOpen={open}
        />
        <DockPanel {store} {flow} {isDocked} collapsed={dockCollapsed} onToggle={toggleDock} />
      </div>
      {#if !isDocked}
        <HudBar {store} {flow} onOpen={open} />
      {/if}
    </div>
  </div>
{/if}
