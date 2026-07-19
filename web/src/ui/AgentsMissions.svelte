<script lang="ts">
  // Agents & Missions page (goal R4; extended for the R6 courier capstone): the
  // docked station's agents (with a courier/level/text filter + capped render so
  // the page stays responsive with ~1,700 agents), an agent conversation,
  // accepting a courier in person, the mission briefing (with load-package-into-
  // ship + set-autopilot-to-dropoff controls), Complete, and the post-completion
  // wallet / LP / standings readout. A pure reader of the store; all bind /
  // DoAction / GetMission* / Step-12 logic lives on the BFF (which holds the
  // bound agent handle) and in app/flow.ts. The browser addresses agents and
  // missions by their game IDs only.
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { AgentAction, AgentRow, JournalMission } from "../store/types.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const agents = store.agents;
  // svelte-ignore state_referenced_locally
  const rewards = store.rewards;

  let busy = $state(false);
  let error = $state("");

  // Agent-roster filter (the live-test found the raw ~1,678-agent render — Jita
  // 4-4 alone has 882 courier agents — strains the browser). Default to
  // courier-only since that is the milestone; the render is capped and the count
  // is shown so the operator can refine rather than scroll a 1,700-row list.
  const RENDER_CAP = 60;
  let courierOnly = $state(true);
  let levelFilter = $state("all");
  let searchText = $state("");

  const filteredAgents = $derived.by<AgentRow[]>(() => {
    const query = searchText.trim().toLowerCase();
    const level = levelFilter === "all" ? null : Number(levelFilter);
    return $agents.agents.filter((agent) => {
      if (courierOnly && (agent.missionKind ?? "").toLowerCase() !== "courier") {
        return false;
      }
      if (level !== null && agent.level !== level) {
        return false;
      }
      if (query) {
        const haystack = [
          String(agent.agentID),
          agent.missionKind ?? "",
          agent.missionTypeLabel ?? "",
          `l${agent.level ?? ""}`,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      return true;
    });
  });
  const cappedAgents = $derived(filteredAgents.slice(0, RENDER_CAP));

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
        error =
          cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
      }
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void run(async () => {
      await flow.loadAgents();
      await flow.loadJournal();
    });
  });

  function agentLabel(agent: AgentRow): string {
    const kind = agent.missionKind ? ` · ${agent.missionKind}` : "";
    return `Agent ${agent.agentID} (L${agent.level ?? "?"}${kind})`;
  }

  function missionLabel(mission: JournalMission): string {
    const type = mission.missionTypeLabel ? mission.missionTypeLabel.split("/").pop() : "Mission";
    return `${type} · title ${mission.missionTitleID ?? "—"} · agent ${mission.agentID ?? "—"}`;
  }
</script>

<section>
  <h2>Agents &amp; Missions</h2>
  <p class="note">
    agentMgr bridge: the station's agents come from agentMgr.GetAgents; the agent
    moniker (Moniker('agentMgr', agentID)) is bound on the BFF, and DoAction /
    GetMission* dispatch on it. Talk to an agent, request and accept a courier in
    person, load the package, autopilot to the dropoff, then Complete and see the
    reward. The browser never sees a bound handle.
  </p>
  <p>
    <button type="button" disabled={busy} onclick={() => run(async () => { await flow.loadAgents(); await flow.loadJournal(); })}>
      Refresh
    </button>
  </p>
  {#if $agents.actionError}
    <p class="error">Last agent action failed: {$agents.actionError}</p>
  {/if}
  {#if error}
    <p class="error">{error}</p>
  {/if}
</section>

<section>
  <h2>Station agents</h2>
  <div class="agent-filter">
    <label>
      <input type="checkbox" bind:checked={courierOnly} />
      Courier only
    </label>
    <label>
      Level
      <select bind:value={levelFilter}>
        <option value="all">All</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
      </select>
    </label>
    <label>
      Search
      <input type="search" placeholder="agent id / type" bind:value={searchText} />
    </label>
  </div>
  {#if $agents.agents.length === 0}
    <p class="note">{$agents.loaded ? "No agents at this station." : "Loading agents…"}</p>
  {:else}
    <p class="note">
      Showing {cappedAgents.length} of {filteredAgents.length} matching
      ({$agents.agents.length} at this station).
      {#if filteredAgents.length > cappedAgents.length}
        Refine the filter to narrow the list.
      {/if}
    </p>
    {#if cappedAgents.length === 0}
      <p class="note">No agents match the filter.</p>
    {:else}
      <ul class="agent-list">
        {#each cappedAgents as agent (agent.agentID)}
          <li>
            <button
              type="button"
              class:active={agent.agentID === $agents.activeAgentID}
              disabled={busy}
              onclick={() => run(() => flow.openConversation(agent.agentID))}
            >
              {agentLabel(agent)}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

{#if $agents.conversation}
  <section>
    <h2>Conversation · agent {$agents.activeAgentID}</h2>
    <p class="agent-says">{$agents.conversation.agentSays}</p>
    <p>
      {#each $agents.conversation.actions as action (action.actionID)}
        <button
          type="button"
          disabled={busy}
          onclick={() => run(() => flow.chooseAction($agents.activeAgentID as number, action as AgentAction))}
        >
          {action.label}
        </button>
      {/each}
      {#if $agents.conversation.actions.length === 0}
        <span class="note">No actions available.</span>
      {/if}
    </p>
    {#if $agents.conversation.lastActionInfo.missionCompleted}
      <p class="note">Mission completed — reward applied.</p>
    {/if}
    {#if $agents.conversation.lastActionInfo.missionDeclined}
      <p class="note">Mission declined.</p>
    {/if}
  </section>
{/if}

{#if $agents.briefing}
  <section>
    <h2>Courier briefing</h2>
    <table class="guests">
      <tbody>
        <tr><th>Cargo type</th><td>{$agents.briefing.cargoTypeID ?? "—"}</td></tr>
        <tr><th>Quantity</th><td>{$agents.briefing.cargoQuantity ?? "—"}</td></tr>
        <tr><th>Volume (m³)</th><td>{$agents.briefing.cargoVolume ?? "—"}</td></tr>
        <tr><th>Pickup</th><td>station {$agents.briefing.pickupLocationID ?? "—"} · system {$agents.briefing.pickupSystemID ?? "—"}</td></tr>
        <tr><th>Destination</th><td>station {$agents.briefing.destinationLocationID ?? "—"} · system {$agents.briefing.destinationSystemID ?? "—"}</td></tr>
        <tr><th>Reward (ISK)</th><td>{$agents.briefing.rewardISK ?? "—"}</td></tr>
        <tr><th>Time bonus (ISK)</th><td>{$agents.briefing.bonusISK ?? "—"}</td></tr>
        <tr><th>Loyalty points</th><td>{$agents.briefing.loyaltyPoints ?? "—"}</td></tr>
      </tbody>
    </table>
    <p>
      <button
        type="button"
        disabled={busy || $agents.briefing.cargoTypeID === null}
        onclick={() => run(() => flow.loadPackageIntoShip($agents.briefing!.cargoTypeID as number))}
      >
        Load package into ship
      </button>
      <button
        type="button"
        disabled={busy || $agents.briefing.destinationLocationID === null}
        onclick={() => run(() => flow.setAutopilotToDropoff($agents.briefing!.destinationLocationID as number))}
      >
        Set autopilot to dropoff
      </button>
    </p>
    <p class="note">
      Load the package into the active ship, autopilot to the dropoff station,
      dock, then Complete Mission in the agent conversation.
    </p>
  </section>
{/if}

{#if $rewards.loaded}
  <section>
    <h2>Reward &amp; wallet (post-completion)</h2>
    {#if $rewards.error}
      <p class="error">Some reward reads failed: {$rewards.error}</p>
    {/if}
    <table class="guests">
      <tbody>
        <tr><th>Wallet balance (ISK)</th><td>{$rewards.cashBalance ?? "—"}</td></tr>
      </tbody>
    </table>
    <h3 class="note">Loyalty points ({$rewards.lpBalances.length})</h3>
    {#if $rewards.lpBalances.length === 0}
      <p class="note">No loyalty-point balances.</p>
    {:else}
      <ul class="journal">
        {#each $rewards.lpBalances as lp (lp.issuerCorpID)}
          <li>corp {lp.issuerCorpID} · {lp.loyaltyPoints} LP</li>
        {/each}
      </ul>
    {/if}
    <h3 class="note">Standings ({$rewards.standings.length})</h3>
    {#if $rewards.standings.length === 0}
      <p class="note">No standings.</p>
    {:else}
      <ul class="journal">
        {#each $rewards.standings as standing (standing.fromID)}
          <li>toward {standing.fromID} · {standing.standing}</li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<section>
  <h2>Mission journal</h2>
  {#if !$agents.journal}
    <p class="note">Loading journal…</p>
  {:else}
    <h3 class="note">Active ({$agents.journal.active.length})</h3>
    {#if $agents.journal.active.length === 0}
      <p class="note">No active missions.</p>
    {:else}
      <ul class="journal">
        {#each $agents.journal.active as mission (mission.missionID)}
          <li>{missionLabel(mission)}</li>
        {/each}
      </ul>
    {/if}
    <h3 class="note">Offered ({$agents.journal.offered.length})</h3>
    {#if $agents.journal.offered.length === 0}
      <p class="note">No offered missions.</p>
    {:else}
      <ul class="journal">
        {#each $agents.journal.offered as mission (mission.missionID)}
          <li>{missionLabel(mission)}</li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
