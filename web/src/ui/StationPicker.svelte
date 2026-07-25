<script lang="ts">
  // A station picker for the Bot Builder: search the static map by name (any
  // station in the galaxy, not just where you are docked), or one click to use
  // the station you're at. Station ids are GLOBAL in EVE, so a picked station
  // stays valid in a saved script wherever it later runs — unlike belts, which
  // are grid-local and resolve to "nearest" at run time.
  //
  // The search hits flow.searchDestinations (the read-only /api/map/find route
  // the Travel panel uses — login-gated, no live session). Under SSR no handler
  // runs, so this renders as a plain input + buttons.

  import type { AppFlow } from "../app/flow.ts";
  import type { DestinationMatch } from "../store/types.ts";
  import { BOARD_SLOTS, boardSlotStation, startingStation, type BoardSlot, type WorldRef } from "../bots/botScript.ts";
  import { boardSlotPhrase } from "../bots/scriptText.ts";

  let {
    flow,
    value,
    current,
    onPick,
  }: {
    flow: AppFlow;
    value: WorldRef;
    /** The station the player is docked at, offered as a one-click choice. */
    current: { id: number; name: string } | null;
    onPick: (ref: WorldRef) => void;
  } = $props();

  let query = $state("");
  let results = $state<DestinationMatch[]>([]);
  let searching = $state(false);
  let error = $state<string | null>(null);

  async function search(): Promise<void> {
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      return;
    }
    searching = true;
    error = null;
    try {
      results = await flow.searchDestinations(q, "station");
      if (results.length === 0) {
        error = "No stations matched that name.";
      }
    } catch {
      error = "Could not search just now — try again.";
      results = [];
    } finally {
      searching = false;
    }
  }

  function choose(match: DestinationMatch): void {
    onPick({ entity: "station", id: match.id, name: match.name, systemName: match.solarSystemName });
    results = [];
    query = "";
    error = null;
  }
  function chooseCurrent(): void {
    if (current !== null) {
      onPick({ entity: "station", id: current.id, name: current.name, systemName: null });
    }
  }
  function chooseStarting(): void {
    onPick(startingStation());
  }
  function chooseSlot(slot: BoardSlot): void {
    onPick(boardSlotStation(slot));
  }
  function clearChoice(): void {
    onPick({ entity: "station", id: null, name: null, systemName: null });
  }
</script>

<span class="station-picker">
  {#if value.slot !== undefined}
    <span class="picked">{boardSlotPhrase(value.slot)}</span>
    <button class="tiny" onclick={clearChoice}>Change</button>
  {:else if value.starting === true}
    <span class="picked">Your starting station</span>
    <button class="tiny" onclick={clearChoice}>Change</button>
  {:else if value.id !== null}
    <span class="picked">
      {value.name ?? "A station"}{#if value.systemName} · {value.systemName}{/if}
    </span>
    <button class="tiny" onclick={clearChoice}>Change</button>
  {:else}
    <button class="tiny primary" onclick={chooseStarting}>Starting station</button>
    <input
      class="q"
      placeholder="…or search a station by name"
      bind:value={query}
      onkeydown={(e) => {
        if (e.key === "Enter") search();
      }}
    />
    <button class="tiny" onclick={search} disabled={searching}>{searching ? "Searching…" : "Search"}</button>
    {#if current !== null}
      <button class="tiny" onclick={chooseCurrent}>Use current station</button>
    {/if}
    <!-- Runtime bindings: follow whatever an earlier block found, instead of a
         station pinned now. -->
    {#each BOARD_SLOTS as slot (slot)}
      <button class="tiny" onclick={() => chooseSlot(slot)}>{boardSlotPhrase(slot)}</button>
    {/each}
    {#if error}<span class="prob">{error}</span>{/if}
    {#if results.length > 0}
      <ul class="results">
        {#each results.slice(0, 8) as match (match.id)}
          <li>
            <button class="tiny result" onclick={() => choose(match)}>
              {match.name}{#if match.solarSystemName} · {match.solarSystemName}{/if}{#if match.jumps !== null}
                ({match.jumps} jump{match.jumps === 1 ? "" : "s"}){/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</span>

<style>
  .station-picker {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
  }
  .picked {
    color: var(--color-text-bright);
  }
  input.q {
    min-width: 12rem;
  }
  .results {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
    flex-basis: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    max-height: 12rem;
    overflow-y: auto;
  }
  button.tiny {
    min-height: 32px;
    padding: 0.1rem 0.5rem;
  }
  button.result {
    text-align: left;
    width: 100%;
  }
  .prob {
    color: var(--color-danger);
    font-size: 0.85rem;
  }
</style>
