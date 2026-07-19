<script lang="ts">
  // Agents & Missions page (goal R4): the docked station's agents, an agent
  // conversation, accepting a courier in person, and the mission briefing +
  // journal. A pure reader of the store's agents slice; all bind / DoAction /
  // GetMission* / GetMyJournalDetails logic lives on the BFF (which holds the
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
    person, and see it in your journal. The browser never sees a bound handle.
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
  {#if $agents.agents.length === 0}
    <p class="note">{$agents.loaded ? "No agents at this station." : "Loading agents…"}</p>
  {:else}
    <ul class="agent-list">
      {#each $agents.agents as agent (agent.agentID)}
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
