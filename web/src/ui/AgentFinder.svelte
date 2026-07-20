<script lang="ts">
  // Agent Finder page (goal R6a): find a courier agent to travel to. The
  // per-station agentMgr.GetAgents roster is unreliable for this (0 agents for a
  // character re-selected into a docked station, and only the current station),
  // so this lists agents from the static agentAuthority reference table
  // (GET /api/agents/find — read-only static data, not a gateway call), sorted
  // by jumps from the current system (a single client-side BFS, distancesFrom).
  // "Set destination" reuses the R5b browser autopilot (startRoute to the
  // agent's station); traveling there docks and populates the live agents
  // normally, so the player can accept a courier (R4/R6).
  //
  // A pure reader of the store's finder slice; all fetch/decode/distance logic
  // lives in app/flow.ts. Mission kind + level are server-side filters (a
  // re-find); the text search + nearest-sort + render cap are client-side over
  // the returned rows (like R6's roster), so ~11k agents stay responsive.
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { AgentFinderRow } from "../store/types.ts";
  import { resolvedName } from "../store/names.ts";

  let {
    store,
    flow,
    showTravel,
  }: { store: ClientStore; flow: AppFlow; showTravel?: () => void } = $props();

  // svelte-ignore state_referenced_locally
  const finder = store.finder;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  // R7c — the finder rows already carry server-resolved station/system names; the
  // one bare ID left is the origin system in the summary note. Resolve it.
  $effect(() => {
    const origin = $finder.originSystemID;
    if (origin) {
      flow.requestNames([{ kind: "system", id: origin }]);
    }
  });

  function originText(): string {
    return resolvedName($names.resolved, "system", $finder.originSystemID, "your current system");
  }

  const RENDER_CAP = 60;
  let kind = $state("courier");
  let levelFilter = $state("all");
  let searchText = $state("");
  let busy = $state(false);
  let error = $state("");

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        error = "The live session ended (idle timeout or another client took over).";
      } else {
        error = cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
      }
    } finally {
      busy = false;
    }
  }

  // Kind + level are server-side filters: changing them re-runs the find.
  function find(): Promise<void> {
    const level = levelFilter === "all" ? null : Number(levelFilter);
    return run(() => flow.findAgents({ kind, level }));
  }

  onMount(() => {
    void find();
  });

  // Text search is client-side over the already-nearest-sorted returned rows.
  const filteredAgents = $derived.by<AgentFinderRow[]>(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return [...$finder.agents];
    }
    return $finder.agents.filter((agent) => {
      const haystack = [
        agent.name,
        agent.solarSystemName ?? "",
        agent.stationName ?? "",
        agent.missionKind ?? "",
        `l${agent.level ?? ""}`,
        String(agent.agentID),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  });
  const cappedAgents = $derived(filteredAgents.slice(0, RENDER_CAP));

  function jumpsText(jumps: number | null): string {
    if (jumps === null) {
      return "unreachable";
    }
    if (jumps === 0) {
      return "0 (here)";
    }
    return `${jumps}`;
  }

  async function setDestination(agent: AgentFinderRow): Promise<void> {
    await run(async () => {
      await flow.setDestinationToAgent(agent.agentID);
      // Point the player at the Travel tab (the autopilot readout lives there).
      showTravel?.();
    });
  }
</script>

<section>
  <h2>Agent Finder</h2>
  <p class="note">
    Find a courier agent from static reference data and set the autopilot to it.
    Agents are listed from the agentAuthority table (not the unreliable
    per-station roster) and sorted by jumps from your current system. Set the
    destination on one, then watch the browser autopilot fly there on the Travel
    tab; on arrival, talk to the agent and accept a courier on the Agents &amp;
    Missions tab.
  </p>
</section>

<section>
  <h2>Filters</h2>
  <div class="agent-filter">
    <label>
      Mission kind
      <select bind:value={kind} disabled={busy} onchange={() => void find()}>
        <option value="courier">Courier</option>
        <option value="encounter">Encounter</option>
        <option value="mining">Mining</option>
        <option value="research">Research</option>
        <option value="all">All</option>
      </select>
    </label>
    <label>
      Level
      <select bind:value={levelFilter} disabled={busy} onchange={() => void find()}>
        <option value="all">All</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
      </select>
    </label>
    <label>
      Search (name / system)
      <input type="search" placeholder="name or system" bind:value={searchText} />
    </label>
    <button type="button" disabled={busy} onclick={() => void find()}>Refresh</button>
  </div>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $finder.error}
    <p class="error">{$finder.error}</p>
  {/if}
</section>

{#if $finder.target}
  <section>
    <h2>Autopilot target</h2>
    <p>
      Flying to <strong>{$finder.target.name}</strong>
      (L{$finder.target.level ?? "?"}) at
      {$finder.target.stationName ?? resolvedName($names.resolved, "station", $finder.target.stationID, "the station")}
      in {$finder.target.solarSystemName ?? resolvedName($names.resolved, "system", $finder.target.solarSystemID, "its system")}
      — {jumpsText($finder.target.jumps)} jumps.
    </p>
    <p class="note">
      The autopilot is running (see the Travel tab). When you arrive and dock,
      open Agents &amp; Missions to talk to the agent and accept a courier.
    </p>
    {#if showTravel}
      <p><button type="button" onclick={() => showTravel?.()}>Go to Travel tab</button></p>
    {/if}
  </section>
{/if}

<section>
  <h2>Agents</h2>
  {#if !$finder.loaded}
    <p class="note">Loading agents…</p>
  {:else if $finder.agents.length === 0}
    <p class="note">No agents match this filter.</p>
  {:else}
    <p class="note">
      Showing {cappedAgents.length} of {filteredAgents.length} matching
      ({$finder.total}{$finder.capped ? "+" : ""} in the dataset for this filter),
      sorted nearest-first from {originText()}.
      {#if $finder.capped}
        The dataset was capped server-side — add a level to narrow it.
      {:else if filteredAgents.length > cappedAgents.length}
        Refine the search to narrow the list.
      {/if}
    </p>
    {#if cappedAgents.length === 0}
      <p class="note">No agents match the search.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests agent-finder reflow">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Lvl</th>
              <th>Kind</th>
              <th>Station</th>
              <th>System</th>
              <th>Jumps</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each cappedAgents as agent (agent.agentID)}
              <tr class:self={agent.jumps === 0}>
                <td data-label="Agent">{agent.name}</td>
                <td data-label="Lvl">{agent.level ?? "?"}</td>
                <td data-label="Kind">{agent.missionKind ?? "—"}</td>
                <td data-label="Station">{agent.stationName ?? resolvedName($names.resolved, "station", agent.stationID, "—")}</td>
                <td data-label="System">{agent.solarSystemName ?? resolvedName($names.resolved, "system", agent.solarSystemID, "—")}</td>
                <td data-label="Jumps">{jumpsText(agent.jumps)}</td>
                <td data-label="">
                  <button
                    type="button"
                    disabled={busy || agent.stationID === null}
                    onclick={() => setDestination(agent)}
                  >
                    Set destination
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</section>
