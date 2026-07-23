<script lang="ts">
  // Page flow, a pure reader of the client-state store: login form -> character
  // selection -> one of TWO top-level SHELLS. Which shell renders is driven by
  // whether the character is DOCKED or IN SPACE (the authoritative flight flag,
  // via deriveDocked) — the whole UI, not just a tab set, follows that state:
  // the station interior when docked, the flight HUD in space. Each shell hosts
  // its own panels (this pass: placeholders — see shell.ts). All fetch/decode
  // lives in app/flow.ts; the store slices are Svelte-store-contract signals.
  import LoginForm from "./LoginForm.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import StationShell from "./StationShell.svelte";
  import SpaceShell from "./SpaceShell.svelte";
  import { deriveDocked } from "./tabs.ts";
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
  // so both the shell switch here and any tab logic share one source of truth).
  const isDocked = $derived(deriveDocked($flight.status, $station.online));

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
{:else if isDocked}
  <StationShell {store} />
{:else}
  <SpaceShell {store} />
{/if}
