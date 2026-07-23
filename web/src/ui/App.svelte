<script lang="ts">
  // Page flow, a pure reader of the client-state store: login form -> character
  // selection -> the workspace. The workspace is a persistent Neocom rail (the
  // STATIC tabs, present in both states) beside a main area that shows EITHER a
  // selected static panel OR the state-specific SHELL. Which shell is the
  // station interior when docked, the flight HUD in space — driven by the
  // authoritative flight flag (deriveDocked). All fetch/decode lives in
  // app/flow.ts; the store slices are Svelte-store-contract signals.
  import LoginForm from "./LoginForm.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import Neocom from "./Neocom.svelte";
  import StaticPanel from "./StaticPanel.svelte";
  import StationShell from "./StationShell.svelte";
  import SpaceShell from "./SpaceShell.svelte";
  import { deriveDocked, type TabID } from "./tabs.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // The store's identity is stable for the app's lifetime; capturing the slice
  // signals once is intended (they are Svelte-store-contract objects).
  // svelte-ignore state_referenced_locally
  const session = store.session;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;

  // Docked vs in space, from the authoritative flag (the rule lives in tabs.ts
  // so the shell switch and the Neocom badge share one source of truth).
  const isDocked = $derived(deriveDocked($flight.status, $station.online));

  // The selected static tab, or null to show the state shell ("home"). It is a
  // Neocom pick only (always a "both" tab), and it PERSISTS across dock/undock —
  // that a static panel stays put when the ship docks is the whole point.
  let selected = $state<TabID | null>(null);

  // Once a character is online, read the flight status so the docked/in-space
  // flag is authoritative (character select does not read it). Runs once —
  // subsequent flight steps (undock / dock / travel / autopilot) keep it fresh
  // through the same store slice. $effect never runs under SSR, so the initial
  // paint still relies on the station-context fallback in deriveDocked.
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
  <div class="app-shell">
    <Neocom
      {store}
      {isDocked}
      {selected}
      onSelect={(id) => (selected = id)}
      onHome={() => (selected = null)}
    />
    <main class="app-main">
      {#if selected !== null}
        <StaticPanel {store} {flow} tab={selected} />
      {:else if isDocked}
        <StationShell {store} />
      {:else}
        <SpaceShell {store} />
      {/if}
    </main>
  </div>
{/if}
