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
  import { resolvedName, type NameRef } from "../store/names.ts";
  // R36 — the mission bot sits with the agents it works for.
  import MissionBot from "./MissionBot.svelte";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { offerOpen } from "../bridge/agents.ts";
  import { MISSION_TIME_WORD_LABELS, missionTimeShown, missionTimeText } from "../bridge/missionTime.ts";
  import { INTERVAL_WORD_LABELS } from "../bridge/timeInterval.ts";
  import { questionText, wordsLabels, wordsNameRefs, type ClientWording } from "../bridge/questions.ts";
  import { filetimeOf, journalRowAsks, journalRowText, journalRowWords } from "../bridge/journalWords.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const agents = store.agents;
  // svelte-ignore state_referenced_locally
  const rewards = store.rewards;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  let busy = $state(false);
  let error = $state("");

  // What the agent says, in the retail client's own words when the BFF has a
  // client to read. The client adds the agent's own IDs to every agent message
  // (agents.py GetAgentArgs) and the player to every message at all.
  const saysClient = $derived.by<ClientWording>(() => {
    const agentID = $agents.activeAgentID;
    const row = $agents.agents.find((agent) => agent.agentID === agentID) ?? null;
    const contentID = $agents.conversation?.contentID ?? null;
    return {
      templates: $words.templates,
      playerID: $station.online?.characterID ?? null,
      // The mission's keywords first, then the agent's own IDs over them, as the client orders them.
      extra: {
        ...((agentID !== null && contentID !== null ? $agents.missionKeywords[`${agentID}:${contentID}`] : null) ?? {}),
        agentID: agentID ?? undefined,
        agentCorpID: row?.corporationID ?? undefined,
        agentStationID: row?.stationID ?? undefined,
        agentLocation: row?.stationID ?? undefined,
      },
    };
  });
  const saysName = (kind: NameRef["kind"], id: number): string => resolvedName($names.resolved, kind, id, `${kind} ${id}`);
  const saysText = $derived(
    $agents.conversation?.agentSaysWords
      ? questionText($agents.conversation.agentSaysWords, saysName, saysClient)
      : $agents.conversation?.agentSays ?? "",
  );
  $effect(() => {
    const agentID = $agents.activeAgentID;
    const contentID = $agents.conversation?.contentID ?? null;
    if (agentID !== null && contentID !== null) {
      flow.requestMissionKeywords(agentID, contentID);
    }
    const said = [$agents.conversation?.agentSaysWords ?? null];
    const labels = wordsLabels(said);
    if (labels.length > 0) {
      flow.requestWords(labels);
    }
    const refs = wordsNameRefs(said, saysClient);
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // The mission's time, under what the agent says (agentDialogueWindow.GetMissionTimeText): what declining
  // would cost and for how long, or when the mission expires. In the client's words or not at all.
  const missionTime = $derived(missionTimeShown($agents.conversation) ? missionTimeText($agents.missionTimes, $words.templates) : null);
  $effect(() => {
    if ($agents.conversation) {
      flow.requestWords([...MISSION_TIME_WORD_LABELS, ...INTERVAL_WORD_LABELS]);
    }
  });

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

  // R7c — resolve names for everything the page shows by ID: the rendered agents
  // + the open conversation + journal agents (→ agent names), the briefing's
  // cargo type / pickup / destination (→ type + station + system names), and the
  // reward LP corps + standings (→ corp / owner names). Batched + cached by the
  // flow; fire-and-forget so IDs render immediately and swap to names as they land.
  $effect(() => {
    const refs: NameRef[] = [];
    for (const agent of cappedAgents) {
      refs.push({ kind: "agent", id: agent.agentID });
    }
    if ($agents.activeAgentID) {
      refs.push({ kind: "agent", id: $agents.activeAgentID });
    }
    const journal = $agents.journal;
    if (journal) {
      for (const mission of [...journal.active, ...journal.offered]) {
        if (mission.agentID) {
          refs.push({ kind: "agent", id: mission.agentID });
        }
      }
    }
    const briefing = $agents.briefing;
    if (briefing) {
      if (briefing.cargoTypeID) {
        refs.push({ kind: "type", id: briefing.cargoTypeID });
      }
      for (const stationID of [briefing.pickupLocationID, briefing.destinationLocationID]) {
        if (stationID) {
          refs.push({ kind: "station", id: stationID });
        }
      }
      for (const systemID of [briefing.pickupSystemID, briefing.destinationSystemID]) {
        if (systemID) {
          refs.push({ kind: "system", id: systemID });
        }
      }
    }
    for (const lp of $rewards.lpBalances) {
      refs.push({ kind: "corporation", id: lp.issuerCorpID });
    }
    for (const standing of $rewards.standings) {
      refs.push({ kind: "owner", id: standing.fromID });
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

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
          panelErrorWords(cause);
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

  // Agent name (R7c/R7d) from the name cache — never the raw agent ID (it stays
  // in the onclick / key args); "—" until it resolves.
  function agentName(agentID: number | null): string {
    return resolvedName($names.resolved, "agent", agentID, "—");
  }

  function agentLabel(agent: AgentRow): string {
    const kind = agent.missionKind ? ` · ${agent.missionKind}` : "";
    const name = resolvedName($names.resolved, "agent", agent.agentID, "Agent");
    return `${name} (L${agent.level ?? "?"}${kind})`;
  }

  function stationText(id: number | null): string {
    return resolvedName($names.resolved, "station", id, "—");
  }

  function systemText(id: number | null): string {
    return resolvedName($names.resolved, "system", id, "—");
  }

  // A journal line as the retail client's journal words it: state, agent, the mission's name, its type, when
  // it expires (bridge/journalWords.ts). The name and the type are the client's own text when the BFF has a
  // client to read; without one the name is left out (it is only a message's number) and the type is the last
  // part of its label. The time is this browser's clock, read when the line is drawn.
  const journalClient = $derived<ClientWording>({ templates: $words.templates, playerID: $station.online?.characterID ?? null });
  const hasWords = (key: string): boolean => typeof $words.templates[key] === "string";
  function missionLabel(mission: JournalMission): string {
    const row = journalRowWords(mission, filetimeOf(Date.now()));
    const text = journalRowText(row, (words) => questionText(words, saysName, journalClient), hasWords);
    return [text.state, agentName(mission.agentID), text.name, text.type || "Mission", text.expiration].filter((part) => part !== "").join(" · ");
  }
  $effect(() => {
    const journal = $agents.journal;
    if (!journal) {
      return;
    }
    const now = filetimeOf(Date.now());
    const asks = [...journal.active, ...journal.offered].flatMap((mission) => journalRowAsks(journalRowWords(mission, now)));
    const labels = wordsLabels(asks);
    if (labels.length > 0) {
      flow.requestWords(labels);
    }
  });

  // The mission's title, which the client's agent window shows above what the agent says whenever there is a
  // mission between the two (agentDialogueWindow.py _GetMissionTitleHTML): the title's message, filled like
  // everything else the agent says about the mission. The client takes its number from the briefing it reads
  // for the layout, and so does this when a briefing is held; otherwise it comes with the mission's line in
  // the journal (an agent has one mission with a pilot at a time). Shown only when the page has the
  // client's text for it.
  const talkTitleID = $derived.by<number | null>(() => {
    const agentID = $agents.activeAgentID;
    const briefed = $agents.briefing?.missionTitleID ?? null;
    if (agentID !== null && briefed !== null && briefed > 0) {
      return briefed;
    }
    const journal = $agents.journal;
    if (agentID === null || !journal) {
      return null;
    }
    const row = [...journal.active, ...journal.offered].find((mission) => mission.agentID === agentID);
    return row?.missionTitleID ?? null;
  });
  const titleText = (titleID: number | null, client: ClientWording): string =>
    titleID !== null && titleID > 0 && hasWords(`#${titleID}`)
      ? questionText({ label: null, parameters: null, text: null, messageID: titleID }, saysName, client)
      : "";
  const talkTitle = $derived(titleText(talkTitleID, saysClient));
  const briefingTitle = $derived(titleText($agents.briefing?.missionTitleID ?? null, saysClient));
  $effect(() => {
    const ids = [talkTitleID, $agents.briefing?.missionTitleID ?? null].filter((id): id is number => id !== null && id > 0);
    if (ids.length > 0) {
      flow.requestWords(ids.map((id) => `#${id}`));
    }
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h2 class="panel-title">Agents &amp; Missions</h2>
    <p class="controls">
      <button type="button" class="primary" disabled={busy} onclick={() => run(async () => { await flow.loadAgents(); await flow.loadJournal(); })}>
        Refresh
      </button>
    </p>
  </header>
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
      <input type="search" placeholder="mission type or level" bind:value={searchText} />
    </label>
  </div>
  {#if $agents.agents.length === 0}
    <p class="empty">{$agents.loaded ? "No agents at this station." : "Loading agents…"}</p>
  {:else}
    <p class="note">
      Showing {cappedAgents.length} of {filteredAgents.length} matching
      ({$agents.agents.length} at this station).
      {#if filteredAgents.length > cappedAgents.length}
        Refine the filter to narrow the list.
      {/if}
    </p>
    {#if cappedAgents.length === 0}
      <p class="empty">No agents match the filter.</p>
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
    <h2>Conversation · {agentName($agents.activeAgentID)}</h2>
    {#if talkTitle}
      <h3 class="mission-title">{talkTitle}</h3>
    {/if}
    <p class="agent-says" style="white-space: pre-line">{saysText}</p>
    {#if missionTime}
      <p class="note mission-time">{missionTime}</p>
    {/if}
    <p class="controls">
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
    <h2>Courier briefing{briefingTitle ? ` · ${briefingTitle}` : ""}</h2>
    <table class="guests">
      <tbody>
        <tr><th>Cargo type</th><td>{resolvedName($names.resolved, "type", $agents.briefing.cargoTypeID, "—")}</td></tr>
        <tr><th>Quantity</th><td class="num">{$agents.briefing.cargoQuantity ?? "—"}</td></tr>
        <tr><th>Volume (m³)</th><td class="num">{$agents.briefing.cargoVolume ?? "—"}</td></tr>
        <tr><th>Pickup</th><td>{stationText($agents.briefing.pickupLocationID)} · {systemText($agents.briefing.pickupSystemID)}</td></tr>
        <tr><th>Destination</th><td>{stationText($agents.briefing.destinationLocationID)} · {systemText($agents.briefing.destinationSystemID)}</td></tr>
        <tr><th>Reward (ISK)</th><td class="num">{$agents.briefing.rewardISK ?? "—"}</td></tr>
        <tr><th>Time bonus (ISK)</th><td class="num">{$agents.briefing.bonusISK ?? "—"}</td></tr>
        <tr><th>Loyalty points</th><td class="num">{$agents.briefing.loyaltyPoints ?? "—"}</td></tr>
      </tbody>
    </table>
    {#if offerOpen($agents.conversation)}
      <!-- The client's window shows an offer's objectives before it is taken. The package is handed over on accepting. -->
      <p class="note mission-offered">This is the offer. Accept it in the conversation to be given the package.</p>
    {:else}
    <p class="controls">
      <button
        type="button"
        disabled={busy || $agents.briefing.cargoTypeID === null}
        onclick={() =>
          run(() =>
            flow.loadPackageIntoShip(
              $agents.briefing!.cargoTypeID as number,
              ($agents.briefing!.cargoQuantity ?? 1) as number,
            ),
          )}
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
    {/if}
  </section>
{/if}

{#if $rewards.loaded}
  <section>
    <h2>Reward &amp; wallet</h2>
    {#if $rewards.error}
      <p class="error">Some reward details could not be loaded: {$rewards.error}</p>
    {/if}
    <table class="guests">
      <tbody>
        <tr><th>Wallet balance (ISK)</th><td class="num">{$rewards.cashBalance ?? "—"}</td></tr>
      </tbody>
    </table>
    <h3 class="note">Loyalty points ({$rewards.lpBalances.length})</h3>
    {#if $rewards.lpBalances.length === 0}
      <p class="empty">No loyalty-point balances.</p>
    {:else}
      <ul class="journal">
        {#each $rewards.lpBalances as lp (lp.issuerCorpID)}
          <li>{resolvedName($names.resolved, "corporation", lp.issuerCorpID, "—")} · {lp.loyaltyPoints} LP</li>
        {/each}
      </ul>
    {/if}
    <h3 class="note">Standings ({$rewards.standings.length})</h3>
    {#if $rewards.standings.length === 0}
      <p class="empty">No standings.</p>
    {:else}
      <ul class="journal">
        {#each $rewards.standings as standing (standing.fromID)}
          <li>toward {resolvedName($names.resolved, "owner", standing.fromID, "—")} · {standing.standing}</li>
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
      <p class="empty">No active missions.</p>
    {:else}
      <ul class="journal">
        {#each $agents.journal.active as mission (mission.missionID)}
          <li>{missionLabel(mission)}</li>
        {/each}
      </ul>
    {/if}
    <h3 class="note">Offered ({$agents.journal.offered.length})</h3>
    {#if $agents.journal.offered.length === 0}
      <p class="empty">No offered missions.</p>
    {:else}
      <ul class="journal">
        {#each $agents.journal.offered as mission (mission.missionID)}
          <li>{missionLabel(mission)}</li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<MissionBot {store} {flow} />
