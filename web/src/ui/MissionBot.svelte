<script lang="ts">
  // The distribution-mission bot's controls and readout (goal R36).
  //
  // A pure reader of the store's `missionBot` slice plus the agent picker. It
  // decides NOTHING about missions: the ladder, the gates, the bounds and the
  // reasons all live in nav/missionBotLoop.ts, and every word on screen here
  // came from that loop or from the server.
  //
  // ⚠ THE POINT OF THIS PANEL IS THE "WHY". A bot you cannot interrogate is one
  // you cannot trust, so the reason for the LAST thing it did is on screen at
  // all times — not only when it stops. If it is flying, this says where and how
  // far; if it turned a job down, this says which gate refused it and with what
  // numbers; if it stopped, it says what stopped it.
  //
  // ⚠ AND THE CAUTION IS NOT A FAILURE. `caution` is the bot declaring that a
  // step it took could not be made CERTAIN — the hangar held more than one stack
  // identical in type and quantity to the mission package, and nothing readable
  // by any client can tell them apart. It renders as its own note, because
  // showing it as success would be a lie and showing it as an error would be
  // wrong.
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import { resolvedName, type NameRef } from "../store/names.ts";
  import { filterAgentChoices } from "./missionAgentFilter.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const missionBot = store.missionBot;
  // svelte-ignore state_referenced_locally
  const agents = store.agents;
  // svelte-ignore state_referenced_locally
  const finder = store.finder;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  let agentChoice = $state("");
  // The picker's own filters (type-to-search + Level / Corporation, like the
  // Agent Finder's row). All client-side over the choices already built below.
  let agentSearch = $state("");
  let agentLevel = $state("all");
  let agentCorp = $state("all");
  /**
   * The player's limits, and they are the whole reason this is safe to walk
   * away from. A courier dropoff is the corp's lowest-numbered station, so
   * routes are long by construction and can cross lowsec — the bot refuses a
   * job past these rather than committing your ship to a trip you never saw.
   */
  let maxJumps = $state(10);
  let maxMissions = $state(0);

  const running = $derived($missionBot.status === "running");
  const paused = $derived($missionBot.status === "paused");
  const active = $derived(running || paused);
  const docked = $derived($flight.status?.docked === true);

  /**
   * One agent the bot could work for.
   *
   * ⚠ IT CARRIES ITS OWN STATION, and that is not a detail. Jobs must be taken
   * on IN PERSON, so the bot flies to the agent before it asks for work — which
   * means the station in the plan has to be the AGENT'S, not wherever the player
   * happens to be standing when they press Start. Reading the current station
   * here would send the bot to ask for work from an agent who is not there.
   */
  interface Choice {
    readonly id: number;
    readonly label: string;
    readonly stationID: number;
    readonly stationName: string | null;
    /** Shown so the player can see what they are committing the ship to. */
    readonly jumps: number | null;
    readonly here: boolean;
    /** For the picker's Level / Corporation filters; null = the server did not say. */
    readonly level: number | null;
    readonly corporationID: number | null;
  }

  /**
   * Every distribution agent the player could send the bot to: the ones at this
   * station first, then anything the Agent Finder has already turned up.
   *
   * ⚠ THE FINDER HALF IS NOT A CONVENIENCE. A station with no distribution agent
   * is the ordinary case — the live R36 run started at one — and without this the
   * panel could only ever offer "no delivery agents here", while the ladder
   * underneath was perfectly capable of flying to one. The control would have
   * been narrower than the bot.
   *
   * Both halves filter on what the SERVER said an agent deals in
   * (`missionKind` / `missionTypeLabel`), never on a guess from the name.
   */
  const choices = $derived.by<Choice[]>(() => {
    const isDistribution = (kind: string | null, label: string | null): boolean =>
      /courier|distribution/i.test(kind ?? label ?? "");

    const here: Choice[] = $agents.agents
      .filter((agent) => isDistribution(agent.missionKind, agent.missionTypeLabel))
      .map((agent) => ({
        id: agent.agentID,
        label: resolvedName($names.resolved, "agent", agent.agentID, "Agent"),
        stationID: agent.stationID ?? $agents.stationID ?? 0,
        stationName: $station.station?.stationName ?? null,
        jumps: 0,
        here: true,
        level: agent.level,
        corporationID: agent.corporationID,
      }));

    const seen = new Set(here.map((row) => row.id));
    const elsewhere: Choice[] = $finder.agents
      .filter(
        (agent) =>
          !seen.has(agent.agentID) &&
          agent.stationID !== null &&
          isDistribution(agent.missionKind, agent.missionTypeLabel),
      )
      .map((agent) => ({
        id: agent.agentID,
        label: agent.name,
        stationID: agent.stationID as number,
        stationName: agent.stationName,
        jumps: agent.jumps,
        here: false,
        level: agent.level,
        corporationID: agent.corporationID,
      }))
      // Nearest first, with unreachable / unknown-distance agents last.
      .sort((a, b) => (a.jumps ?? Number.MAX_SAFE_INTEGER) - (b.jumps ?? Number.MAX_SAFE_INTEGER));

    return [...here.sort((a, b) => a.label.localeCompare(b.label)), ...elsewhere];
  });

  // The picker's filters, applied client-side over the built choices. `chosen`
  // derives from the FILTERED list so narrowing it narrows what Start can use;
  // a remembered pick that a filter hides falls back to the first match.
  const filteredChoices = $derived(
    filterAgentChoices(choices, {
      searchText: agentSearch,
      level: agentLevel === "all" ? null : Number(agentLevel),
      corporationID: agentCorp === "all" ? null : Number(agentCorp),
    }),
  );

  /**
   * The Corporation filter's options: every employer across the choices, by
   * name. Built from the UNFILTERED list so picking one never prunes the others
   * away. The names resolve asynchronously (the $effect below requests them);
   * an option reads as a placeholder for the beat before its name lands —
   * never as a raw corporation ID (R7d).
   */
  const corpOptions = $derived.by<{ id: number; label: string }[]>(() => {
    const ids = new Set<number>();
    for (const choice of choices) {
      if (choice.corporationID !== null) {
        ids.add(choice.corporationID);
      }
    }
    return [...ids]
      .map((id) => ({ id, label: resolvedName($names.resolved, "corporation", id, "(loading…)") }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  // Resolve the names this panel shows by ID: the here-agents' names (the
  // finder half already carries its names) and every employer for the
  // Corporation filter. Batched + cached by the flow; fire-and-forget.
  $effect(() => {
    const refs: NameRef[] = [];
    for (const choice of choices) {
      if (choice.here) {
        refs.push({ kind: "agent", id: choice.id });
      }
      if (choice.corporationID !== null) {
        refs.push({ kind: "corporation", id: choice.corporationID });
      }
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  const chosen = $derived(
    filteredChoices.find((row) => row.id === Number(agentChoice)) ?? filteredChoices[0] ?? null,
  );
  const agentID = $derived(chosen?.id ?? 0);
  const agentLabel = $derived(chosen?.label ?? null);
  // The AGENT's station, from the chosen row — never the one we are standing in.
  const stationID = $derived(chosen?.stationID ?? 0);
  const stationLabel = $derived(chosen?.stationName ?? null);
  const canStart = $derived(docked && agentID > 0 && stationID > 0 && !active);

  function choiceLabel(choice: Choice): string {
    if (choice.here) {
      return `${choice.label} — here`;
    }
    const where = choice.stationName ?? "another station";
    return choice.jumps === null
      ? `${choice.label} — ${where}`
      : `${choice.label} — ${where} (${choice.jumps} ${choice.jumps === 1 ? "jump" : "jumps"})`;
  }

  /** ISK/LP are bigint-safe decimal strings — format without going through Number. */
  function amount(value: string | null): string {
    if (value === null) {
      return "—";
    }
    // Fixed-point, never Number: the whole part groups through BigInt (ISK can
    // exceed 2^53) and a fractional part rides along verbatim — a wallet
    // difference like "129271601.6" is a real payout, not a formatting error.
    const match = /^(-?\d+)(?:\.(\d+))?$/.exec(value);
    if (match === null) {
      return value;
    }
    const whole = BigInt(match[1]).toLocaleString();
    return match[2] !== undefined ? `${whole}.${match[2]}` : whole;
  }

  async function run(action: () => Promise<void> | void): Promise<void> {
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

  async function start(): Promise<void> {
    await run(() =>
      flow.startMissionBot({
        agentID,
        agentName: agentLabel,
        agentStationID: stationID,
        agentStationName: stationLabel,
        maxJumps: Math.min(30, Math.max(1, maxJumps)),
        maxMissions: Math.max(0, maxMissions),
      }),
    );
  }
</script>

<section class="panel">
  <header class="panel-head">
    <h2>Mission bot</h2>
    <span class="controls">
      {#if running}
        <button type="button" disabled={busy} onclick={() => run(() => flow.pauseMissionBot())}>
          Pause
        </button>
        <button type="button" class="danger" disabled={busy} onclick={() => run(() => flow.stopMissionBot())}>
          Stop
        </button>
      {:else if paused}
        <button type="button" class="primary" disabled={busy} onclick={() => run(() => flow.resumeMissionBot())}>
          Carry on
        </button>
        <button type="button" class="danger" disabled={busy} onclick={() => run(() => flow.stopMissionBot())}>
          Stop
        </button>
      {:else}
        <button type="button" class="primary" disabled={busy || !canStart} onclick={start}>
          Start
        </button>
      {/if}
    </span>
  </header>
  <p class="note">
    Asks an agent for delivery work, turns down anything that will not fit or is
    further than you allow, collects the cargo, flies it there, hands it in and
    goes again. It runs in this tab: close it and your ship finishes what it was
    last told to do and sits.
  </p>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $missionBot.startError}
    <p class="error">{$missionBot.startError}</p>
  {/if}
</section>

{#if active}
  <!--
    THE READOUT. `why` is the field this whole panel exists for: whatever the
    bot is doing, the player can see the reason for it without asking.
  -->
  <section>
    <h2>What it is doing</h2>
    <p class="stat-line">
      <strong>{$missionBot.phase ?? "Working"}</strong>
      {#if $missionBot.action}<span class="note"> — {$missionBot.action}</span>{/if}
    </p>
    {#if $missionBot.why}
      <p class="note"><strong>Why:</strong> {$missionBot.why}</p>
    {/if}
    {#if $missionBot.caution}
      <p class="warn"><strong>Worth knowing:</strong> {$missionBot.caution}</p>
    {/if}
    {#if $missionBot.failureReason}
      <p class="error">{$missionBot.failureReason}</p>
    {/if}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Job</th>
            <th>Cargo</th>
            <th>Heading for</th>
            <th class="num">Jumps left</th>
            <th class="num">Jobs done</th>
            <th class="num">ISK earned</th>
            <th class="num">LP earned</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="Agent">{$missionBot.agentName ?? "—"}</td>
            <td data-label="Job">{$missionBot.missionName ?? "—"}</td>
            <td data-label="Cargo">{$missionBot.cargoText ?? "—"}</td>
            <td data-label="Heading for">{$missionBot.destinationName ?? "—"}</td>
            <td class="num" data-label="Jumps left">
              {$missionBot.jumpsRemaining === null ? "—" : $missionBot.jumpsRemaining.toLocaleString()}
            </td>
            <td class="num" data-label="Jobs done">{$missionBot.missionsCompleted.toLocaleString()}</td>
            <td class="num" data-label="ISK earned">{amount($missionBot.iskEarned)}</td>
            <td class="num" data-label="LP earned">{amount($missionBot.lpEarned)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    {#if paused}
      <p class="note">
        Paused. Your ship keeps doing whatever it was last told to — press Carry
        on to pick the run back up, or Stop to leave it alone.
      </p>
    {/if}
  </section>
{:else}
  <section>
    <h2>Set it up</h2>
    {#if !docked}
      <p class="note">
        Dock first. Jobs have to be taken on in person, so the bot starts from
        the station the agent is in.
      </p>
    {:else if choices.length === 0}
      <p class="empty">
        No delivery agents here, and none found yet. Search for one under Agent
        Finder and it will appear in this list — the bot will fly to them.
      </p>
    {:else}
      <div class="agent-filter">
        <label>
          Search (name / station)
          <input type="search" placeholder="type to filter" bind:value={agentSearch} />
        </label>
        <label>
          Level
          <select bind:value={agentLevel}>
            <option value="all">All</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </label>
        <label>
          Corporation
          <select bind:value={agentCorp}>
            <option value="all">All</option>
            {#each corpOptions as corp (corp.id)}
              <option value={String(corp.id)}>{corp.label}</option>
            {/each}
          </select>
        </label>
      </div>
      {#if filteredChoices.length === 0}
        <p class="empty">
          No delivery agents match the filter — clear it to see all
          {choices.length}.
        </p>
      {:else}
        <p class="field">
          <label for="mission-agent">Agent to work for</label>
          <select
            id="mission-agent"
            value={String(chosen?.id ?? "")}
            onchange={(event) => (agentChoice = event.currentTarget.value)}
          >
            {#each filteredChoices as choice (choice.id)}
              <option value={String(choice.id)}>{choiceLabel(choice)}</option>
            {/each}
          </select>
        </p>
        {#if filteredChoices.length < choices.length}
          <p class="note">
            Showing {filteredChoices.length} of {choices.length} delivery agents.
          </p>
        {/if}
      {/if}
      {#if chosen && !chosen.here}
        <p class="note">
          The bot will fly to {chosen.stationName ?? "them"} first — jobs have to
          be taken on in person.
        </p>
      {/if}
      <p class="field">
        <label for="mission-jumps">Turn down anything further than</label>
        <input id="mission-jumps" type="number" min="1" max="30" step="1" bind:value={maxJumps} />
        <span class="note">jumps</span>
      </p>
      <p class="note">
        Delivery points are often a long way off and the route can pass through
        dangerous space, so this limit is what keeps your ship on trips you are
        happy with.
      </p>
      <p class="field">
        <label for="mission-count">Stop after</label>
        <input id="mission-count" type="number" min="0" max="99" step="1" bind:value={maxMissions} />
        <span class="note">jobs (0 keeps going until you stop it)</span>
      </p>
    {/if}
    {#if $missionBot.caution}
      <h3>Worth knowing about the last run</h3>
      <p class="warn">{$missionBot.caution}</p>
    {/if}
    {#if $missionBot.failureReason}
      <h3>Last time it stopped</h3>
      <p class="error">{$missionBot.failureReason}</p>
    {/if}
  </section>
{/if}

<style>
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  #mission-jumps,
  #mission-count {
    width: 5rem;
  }
  /*
    A caution is neither success nor failure, so it reads as neither. It is the
    bot telling you something it could not be sure of.
  */
  .warn {
    border-left: 3px solid currentColor;
    padding-left: 0.6rem;
    opacity: 0.9;
  }
</style>
