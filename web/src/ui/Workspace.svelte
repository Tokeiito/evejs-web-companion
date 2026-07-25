<script lang="ts">
  // R107 — ONE pilot's workspace, a pure reader of that pilot's store. Extracted
  // from App.svelte so the multibox App can mount exactly one of these (the
  // ACTIVE pilot) above the character bar while every other pilot's store+flow
  // stay live in memory. The workspace is an always-open desktop:
  //   • the Neocom launcher rail down the left (opens panels as windows),
  //   • a context header (where you are + Dock/Undock),
  //   • the desktop itself — floating, self-contained panel windows,
  //   • a fixed, collapsible top-right dock panel (Overview in space / Station
  //     services when docked), and
  //   • a persistent bottom HUD bar while in space.
  // The open windows + dock-collapse state are remembered per character. Below
  // 720px it swaps to the single-panel MobileWorkspace. All fetch/decode lives
  // in app/flow.ts; the store slices are store-contract signals.
  import Neocom from "./Neocom.svelte";
  import Desktop from "./Desktop.svelte";
  import DockPanel from "./DockPanel.svelte";
  import HudBar from "./HudBar.svelte";
  import WorkspaceHeader from "./WorkspaceHeader.svelte";
  import MobileWorkspace from "./MobileWorkspace.svelte";
  import TargetsPanel from "./TargetsPanel.svelte";
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
    DEFAULT_DOCK_WIDTH,
    DEFAULT_TARGETS_POS,
    type WinState,
  } from "./desktop.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // The store's identity is stable for this component's lifetime (App keys each
  // Workspace by session id, so store/flow never change under a mounted one);
  // capturing the slice signals once is intended.
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;

  // Docked vs in space, from the authoritative flag (rule lives in tabs.ts).
  const isDocked = $derived(deriveDocked($flight.status, $station.online));

  // Narrow viewport -> the simplified single-panel mobile UI instead of the
  // floating-window desktop. matchMedia so it flips live at the breakpoint.
  let isMobile = $state(false);
  $effect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const update = (): void => { isMobile = mq.matches; };
    update();
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
  let dockWidth = $state(DEFAULT_DOCK_WIDTH);
  let targetsX = $state(DEFAULT_TARGETS_POS.x);
  let targetsY = $state(DEFAULT_TARGETS_POS.y);
  const openIds = $derived(new Set(wins.map((w) => w.id)));
  const focused = $derived(computeFocusedId(wins));

  const open = (id: TabID): void => { wins = openWindow(wins, id); };
  // The Neocom pick, with one de-dupe: while docked, Inventory & Ship IS the
  // permanent dock panel — expand it, snap it to the Ship Inventory tab (the
  // visible response when it was already expanded, e.g. sitting on Station
  // Services), and fold any open inventory window in, instead of putting a
  // second identical copy on screen. In space, and for every other tab, it
  // opens/focuses a window as always.
  let dockInventoryPing = $state(0);
  const openFromNeocom = (id: TabID): void => {
    if (id === "inventory" && isDocked) {
      dockCollapsed = false;
      dockInventoryPing += 1;
      wins = closeWindow(wins, "inventory");
      return;
    }
    open(id);
  };
  // The rail highlights what is on screen. While docked, the expanded dock
  // panel IS the Inventory & Ship content, so its entry lights up like an
  // open window's would (openIds itself only tracks floating windows).
  const neocomOpenIds = $derived(
    isDocked && !dockCollapsed ? new Set<TabID>([...openIds, "inventory"]) : openIds,
  );
  const focus = (id: TabID): void => { wins = focusWindow(wins, id); };
  const close = (id: TabID): void => { wins = closeWindow(wins, id); };
  const move = (id: TabID, x: number, y: number): void => { wins = moveWindow(wins, id, x, y); };
  const resize = (id: TabID, w: number, h: number): void => { wins = resizeWindow(wins, id, w, h); };
  const collapse = (id: TabID): void => { wins = toggleCollapse(wins, id); };
  const toggleDock = (): void => { dockCollapsed = !dockCollapsed; };

  // Restore the saved layout when a character comes online (keyed by characterID)
  // and clear it on logout, so a different pilot gets their own desktop. Guarded
  // on the loaded id so it runs once per character.
  let loadedFor = $state<number | null>(null);
  $effect(() => {
    const online = $station.online;
    if (online && loadedFor !== online.characterID) {
      const saved = loadLayout(online.characterID);
      wins = saved ? saved.wins.slice() : [];
      dockCollapsed = saved ? saved.dockCollapsed : false;
      dockWidth = saved ? saved.dockWidth : DEFAULT_DOCK_WIDTH;
      targetsX = saved ? saved.targetsX : DEFAULT_TARGETS_POS.x;
      targetsY = saved ? saved.targetsY : DEFAULT_TARGETS_POS.y;
      loadedFor = online.characterID;
    } else if (!online && loadedFor !== null) {
      wins = [];
      dockCollapsed = false;
      dockWidth = DEFAULT_DOCK_WIDTH;
      targetsX = DEFAULT_TARGETS_POS.x;
      targetsY = DEFAULT_TARGETS_POS.y;
      loadedFor = null;
    }
  });

  // Persist on any layout change, debounced so a drag doesn't hammer storage.
  $effect(() => {
    const id = loadedFor;
    const layout = { wins: wins.map((w) => ({ ...w })), dockCollapsed, dockWidth, targetsX, targetsY };
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

<!-- Guard: App prunes a pilot the instant its store goes offline, but this
     component can outlive that store update by a tick; render nothing rather
     than let a child dereference a null $station.online. -->
{#if $station.online === null}
  <div class="workspace-shell-empty"></div>
{:else if isMobile}
  <MobileWorkspace {store} {flow} {isDocked} />
{:else}
  <div class="workspace" class:in-space={!isDocked}>
    <Neocom {store} {isDocked} openIds={neocomOpenIds} focusedId={focused} onSelect={openFromNeocom} />
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
        <DockPanel
          {store}
          {flow}
          {isDocked}
          inventoryPing={dockInventoryPing}
          collapsed={dockCollapsed}
          width={dockWidth}
          onToggle={toggleDock}
          onResize={(w) => (dockWidth = w)}
        />
        {#if !isDocked}
          <TargetsPanel {store} x={targetsX} y={targetsY} onMove={(nx, ny) => { targetsX = nx; targetsY = ny; }} />
        {/if}
      </div>
      {#if !isDocked}
        <HudBar {store} {flow} onOpen={open} />
      {/if}
    </div>
  </div>
{/if}
