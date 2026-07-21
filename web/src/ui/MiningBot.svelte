<script lang="ts">
  // The mining bot's controls and readout (goal R26).
  //
  // A pure reader of the store's `bot` slice plus the pickers. It decides
  // NOTHING about mining: the ladder, the bounds and the reasons all live in
  // nav/miningBotLoop.ts, and every word on screen here came from that loop or
  // from the server.
  //
  // ⚠ THE POINT OF THIS PANEL IS THE "WHY". A bot you cannot interrogate is one
  // you cannot trust, so the reason for the LAST thing it did is on screen at
  // all times — not only when it stops. If it is sitting still, this panel says
  // what it is waiting for; if it broke off, it says what drove it off.
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import { formatDistance } from "../space/overview.ts";
  // R30 slice E — the mining-equipment guess, shared with the cockpit's
  // "Mine this" so the bot and the one-click verb can never run different sets.
  import { activatableModules, looksLikeMiningEquipment } from "../space/rowActions.ts";
  import { nameKey } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const bot = store.bot;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  let busy = $state(false);
  let error = $state("");
  let beltChoice = $state("");
  let stationChoice = $state("");
  let picked = $state<number[]>([]);
  let pickedTouched = $state(false);
  let guardDrones = $state(true);
  /**
   * The safety floor, as a percentage the player sets. Half health is the
   * default because it is early enough to still get away — the point of a floor
   * on an unattended ship is to leave while leaving is still possible.
   */
  let floorPercent = $state(50);

  const snapshot = $derived($space.snapshot);
  const inSpace = $derived($flight.status?.docked !== true && (snapshot?.inSpace ?? false));
  const running = $derived($bot.status === "running");
  const paused = $derived($bot.status === "paused");
  const active = $derived(running || paused);

  const origin = $derived(snapshot?.ship?.position ?? { x: 0, y: 0, z: 0 });
  const shipRadius = $derived(snapshot?.ship?.radius ?? 0);

  // R30 slice B — this panel claims the space feed in its OWN right.
  //
  // It reads the snapshot directly (belt and rock distances, the health floor)
  // and it is deliberately rendered outside the Overview's in-space guard,
  // because the bot docks itself to unload and a player must still be able to
  // watch it and stop it from inside the station. Its claim is therefore not
  // redundant with the Overview's: it is the claim that survives the dock, and
  // the one that re-arms the feed the moment the bot undocks again.
  onMount(() => {
    flow.startSpacePolling();
    return () => flow.stopSpacePolling();
  });

  function surfaceTo(entity: { position: { x: number; y: number; z: number }; radius: number }): number {
    const dx = entity.position.x - origin.x;
    const dy = entity.position.y - origin.y;
    const dz = entity.position.z - origin.z;
    const centres = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Math.max(0, centres - shipRadius - entity.radius);
  }

  interface Choice {
    readonly id: number;
    readonly label: string;
    readonly distance: string;
  }

  /**
   * The belts the ship can see, BY NAME.
   *
   * The static map search knows systems and stations, not belts, so the belt a
   * player picks is one the ship is actually looking at. That is why the panel
   * asks them to undock first, and says so rather than showing an empty list.
   */
  const belts = $derived.by<Choice[]>(() => {
    const rows = (snapshot?.entities ?? [])
      .filter((entity) => !entity.isSelf && /belt/i.test(entity.name ?? ""))
      .map((entity) => ({
        id: entity.itemID,
        label: entity.name ?? "Asteroid belt",
        distance: formatDistance(surfaceTo(entity)),
      }));
    if (rows.length > 0) {
      return rows.sort((a, b) => a.label.localeCompare(b.label));
    }
    // No belt object on the grid but rocks all around: the ship is IN a belt,
    // so offer that, described rather than numbered (R7d).
    const rock = (snapshot?.entities ?? []).find(
      (entity) => entity.beltID !== null && !entity.isSelf,
    );
    return rock?.beltID
      ? [{ id: rock.beltID, label: "The belt you are in", distance: "here" }]
      : [];
  });

  /** Somewhere to put the ore: a station in view, plus the one you came from. */
  const stations = $derived.by<Choice[]>(() => {
    const rows = (snapshot?.entities ?? [])
      .filter((entity) => entity.kind === "station" && !entity.isSelf)
      .map((entity) => ({
        id: entity.itemID,
        label: entity.name ?? "Station",
        distance: formatDistance(surfaceTo(entity)),
      }));
    const home = $station.station;
    if (home && !rows.some((row) => row.id === home.stationID)) {
      rows.push({ id: home.stationID, label: home.stationName, distance: "where you docked" });
    }
    return rows;
  });

  /**
   * The equipment the bot may run: everything ONLINE in the ship's slots, by
   * name. Rigs and subsystems are never activated, so they are left out.
   *
   * ⚠ R43 — THE DERIVATION MOVED, THE MEANING DID NOT. It now comes from
   * `space/rowActions.ts` so that this list, the cockpit's "Mine this" and the
   * launcher's "have you got a miner?" preflight are one function rather than
   * three that agree today. See that file for the Ice Harvester rig that a
   * separately-written version of this gets wrong.
   */
  interface Equipment {
    readonly itemID: number;
    readonly label: string;
  }
  const equipment = $derived.by<Equipment[]>(() =>
    activatableModules($fitting.slots, (typeID) =>
      // A name that has not landed yet is null in the shared derivation; only
      // this RENDERING layer substitutes a placeholder for it.
      $names.resolved[nameKey("type", typeID)] ?? null,
    )
      .filter((row) => row.online)
      .map((row) => ({ itemID: row.itemID, label: row.label ?? "Unknown module" })),
  );

  /**
   * A CONVENIENCE default, not a claim: equipment whose name reads like a
   * mining laser is ticked to begin with. It is a guess about a NAME, so the
   * player can change it — the browser never decides which of your modules is a
   * mining laser, because a wrong guess fires a turret at a rock.
   *
   * ⚠ THE EXCLUSION IS FROM A LIVE RUN, and it now lives in ONE place —
   * `space/rowActions.ts`, shared with the cockpit's "Mine this" (R30 slice E),
   * which reaches for exactly the same set. Two copies of a guess drifting
   * apart would mean the bot and the one-click verb ran different equipment
   * while the page implied they ran the same.
   */
  const suggested = $derived(
    equipment.filter((row) => looksLikeMiningEquipment(row.label)).map((row) => row.itemID),
  );
  const chosenEquipment = $derived(pickedTouched ? picked : suggested);

  function toggleEquipment(itemID: number): void {
    const current = chosenEquipment;
    picked = current.includes(itemID)
      ? current.filter((id) => id !== itemID)
      : [...current, itemID];
    pickedTouched = true;
  }

  const beltID = $derived(Number(beltChoice) || belts[0]?.id || 0);
  const stationID = $derived(Number(stationChoice) || stations[0]?.id || 0);
  const beltLabel = $derived(belts.find((row) => row.id === beltID)?.label ?? null);
  const stationLabel = $derived(stations.find((row) => row.id === stationID)?.label ?? null);
  const canStart = $derived(
    inSpace && beltID > 0 && stationID > 0 && chosenEquipment.length > 0 && !active,
  );

  /** The hold, as the SERVER reported it. Unknown never renders as empty. */
  const holdText = $derived(
    $bot.holdCapacity === null
      ? "not known"
      : `${($bot.holdUsed ?? 0).toLocaleString()} of ${$bot.holdCapacity.toLocaleString()} m³`,
  );
  const holdPercent = $derived(
    $bot.holdCapacity === null || $bot.holdUsed === null || $bot.holdCapacity <= 0
      ? null
      : Math.min(100, Math.round(($bot.holdUsed / $bot.holdCapacity) * 100)),
  );

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
      flow.startMiningBot({
        beltID,
        beltName: beltLabel,
        stationID,
        stationName: stationLabel,
        miningModuleIDs: chosenEquipment,
        healthFloor: Math.min(95, Math.max(5, floorPercent)) / 100,
        useDrones: guardDrones,
      }),
    );
  }
</script>

<section class="panel">
  <header class="panel-head">
    <h2>Mining bot</h2>
    <span class="controls">
      {#if running}
        <button type="button" disabled={busy} onclick={() => run(() => flow.pauseMiningBot())}>
          Pause
        </button>
        <button type="button" class="danger" disabled={busy} onclick={() => run(() => flow.stopMiningBot())}>
          Stop
        </button>
      {:else if paused}
        <button type="button" class="primary" disabled={busy} onclick={() => run(() => flow.resumeMiningBot())}>
          Carry on
        </button>
        <button type="button" class="danger" disabled={busy} onclick={() => run(() => flow.stopMiningBot())}>
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
    Picks rocks, runs your mining equipment, sends the drones out if a pirate
    turns up, hauls a full hold back and unloads it — then goes again. It runs in
    this tab: close it and your ship finishes what it was last told to do and
    sits.
  </p>
  {#if error}
    <p class="error">{error}</p>
  {/if}
  {#if $bot.startError}
    <p class="error">{$bot.startError}</p>
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
      <strong>{$bot.phase ?? "Working"}</strong>
      {#if $bot.action}<span class="note"> — {$bot.action}</span>{/if}
    </p>
    {#if $bot.why}
      <p class="note"><strong>Why:</strong> {$bot.why}</p>
    {/if}
    {#if $bot.failureReason}
      <p class="error">{$bot.failureReason}</p>
    {/if}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead>
          <tr>
            <th>Belt</th>
            <th>Taking it to</th>
            <th>Rock</th>
            <th class="num">Loads hauled</th>
            <th class="num">Ore mined</th>
            <th>Hold</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td data-label="Belt">{$bot.beltName ?? "—"}</td>
            <td data-label="Taking it to">{$bot.stationName ?? "—"}</td>
            <td data-label="Rock">{$bot.rockName ?? "—"}</td>
            <td class="num" data-label="Loads hauled">{$bot.cyclesCompleted.toLocaleString()}</td>
            <td class="num" data-label="Ore mined">{$bot.oreUnitsMined.toLocaleString()}</td>
            <td data-label="Hold">{holdText}</td>
          </tr>
        </tbody>
      </table>
    </div>
    {#if holdPercent !== null}
      <div
        class="hud-track"
        role="meter"
        aria-label="Ore hold fill"
        aria-valuenow={holdPercent}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span class="hud-fill" style={`width: ${holdPercent}%`}></span>
      </div>
    {/if}
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
    {#if !inSpace}
      <p class="note">
        Undock first. The bot works a belt your ship can actually see, so it has
        to be out there to pick one.
      </p>
    {:else if belts.length === 0}
      <p class="empty">
        No asteroid belt in view. Warp to one and this will fill in.
      </p>
    {:else}
      <p class="field">
        <label for="bot-belt">Belt to work</label>
        <select id="bot-belt" bind:value={beltChoice}>
          {#each belts as choice (choice.id)}
            <option value={String(choice.id)}>{choice.label} ({choice.distance})</option>
          {/each}
        </select>
      </p>
      <p class="field">
        <label for="bot-station">Take the ore to</label>
        <select id="bot-station" bind:value={stationChoice}>
          {#each stations as choice (choice.id)}
            <option value={String(choice.id)}>{choice.label} ({choice.distance})</option>
          {/each}
        </select>
      </p>
      {#if stations.length === 0}
        <p class="error">Nowhere to take the ore — no station in view or on record.</p>
      {/if}

      <h3>Equipment to run</h3>
      {#if equipment.length === 0}
        <!--
          R30 slice E — this line used to end by sending the player to the
          Fitting tab to power equipment up. That instruction is DELETED, not
          reworded: Around Your Ship lists offline equipment with a Power up
          control on the row, so the tab it pointed at is no longer where that
          click lives. A test asserts the sentence cannot come back — which is
          why this comment describes it rather than quoting it.
        -->
        <p class="empty">
          Nothing powered up. Power your mining equipment up under Your equipment
          above, then come back.
        </p>
      {:else}
        <p class="note">
          Tick what the bot should run on the rock. Anything that looks like a
          mining laser is ticked already — change it if that is not right.
        </p>
        {#each equipment as row (row.itemID)}
          <label class="check">
            <input
              type="checkbox"
              checked={chosenEquipment.includes(row.itemID)}
              onchange={() => toggleEquipment(row.itemID)}
            />
            {row.label}
          </label>
        {/each}
      {/if}

      <h3>Keeping your ship alive</h3>
      <label class="check">
        <input type="checkbox" bind:checked={guardDrones} />
        Send the drones out if a pirate turns up (they defend the ship on their own)
      </label>
      <p class="field">
        <label for="bot-floor">Break off and dock below</label>
        <input id="bot-floor" type="number" min="5" max="95" step="5" bind:value={floorPercent} />
        <span class="note">% of shield, armour or hull</span>
      </p>
      {#if !canStart && chosenEquipment.length === 0}
        <p class="note">Pick at least one piece of equipment before starting.</p>
      {/if}
    {/if}
    {#if $bot.failureReason}
      <h3>Last time it stopped</h3>
      <p class="error">{$bot.failureReason}</p>
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
  .check {
    display: block;
    margin: 0.25rem 0;
  }
  #bot-floor {
    width: 5rem;
  }
</style>
