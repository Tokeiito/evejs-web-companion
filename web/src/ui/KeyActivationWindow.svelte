<script lang="ts">
  // The client's key activation window for an Abyssal filament (eve/client/script/ui/shared/abyss/keyActivationWindow.py
  // KeyActivationWindow), opened by the filament's Activate (menuFunctions.ActivateAbyssalKey):
  //
  //   captioned with the filament's name; its icon beside the filament's short description and its tier's description;
  //   the weather's icon, name and description; the timer's description (twenty minutes); the suspect's description
  //   where activating it here is suspicious; the combo of three, cruiser, destroyer and frigate, kept for the
  //   character; and under it the chosen mode's button (Layout, 216 to 274).
  //
  //   The button (activateButton.py) is enabled where the client's checks find nothing (ClientValidator.validate_deploy,
  //   bridge/abyssalKeys.ts validateDeploy), red otherwise, its tooltip the errors in the client's words. Solo's reads
  //   Activate, and Jumping while it acts; the fleet modes' Fleet, and Deploying. Pressed, the filament is deployed in
  //   the mode (DeployActivationController._Activate); an AbyssError's errors go on the button; once deployed the window
  //   closes a second later (UpdateState, _AnimCloseWindow).
  //
  // The rules and the words' labels are in bridge/abyssalKeys.ts; the text is the client's, from its install.
  import { onMount } from "svelte";
  import TypeIcon from "./TypeIcon.svelte";
  import { formatTemplate, plainText, templateNameRefs } from "../bridge/clientWords.ts";
  import { writtenInterval, INTERVAL_WORD_LABELS } from "../bridge/timeInterval.ts";
  import { fmtDist } from "../space/overview.ts";
  import { DISTANCE_WORD_LABELS, distanceSay } from "../space/distanceWords.ts";
  import {
    ABYSS_WINDOW_LABELS,
    CRIMINAL_TIMER_TIMEOUT,
    DEFAULT_ABYSS_CONTENT_DURATION,
    GAME_MODES,
    GAME_MODE_OPTIONS,
    TIER_DESCRIPTION_BY_TIER,
    WEATHER_DESCRIPTION_BY_TYPE,
    abyssErrorLabel,
    abyssErrorLabels,
    isSuspicious,
    validateDeploy,
    validateJump,
    JUMP_DESCRIPTION_LABELS,
    UNKNOWN_GAME_MODE,
    UNKNOWN_JUMP_DESCRIPTION_LABEL,
    type AbyssErrorEntry,
    type DeployFacts,
    type GameModeID,
  } from "../bridge/abyssalKeys.ts";
  import { nameKey, resolvedName } from "../store/names.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store, flow, item, trace = null, onClose }: {
    store: ClientStore;
    flow: AppFlow;
    /**
     * The filament, as its row has it: the pilot's own where the page lists it in the pilot's places. For a trace's
     * jump window, the trace (its itemID) and its filament (its slim item's abyssFilamentTypeID).
     */
    item: { readonly itemID: number; readonly typeID: number; readonly groupID: number | null; readonly quantity: number; readonly ownedByPilot: boolean };
    /**
     * A trace's jump window (AbyssJumpWindow.py AbyssActivationWindow) in place of a filament's key window: the trace's
     * game mode (its slim item's gameModeID, or none). Its first line is the mode's jump description, there is no
     * combo, its button jumps (JumpActivationController: validate_jump, Activate and Jumping), and nothing in it is
     * suspicious (AbyssEntranceWindowController.isSuspicious).
     */
    trace?: { readonly gameModeID: number | null } | null;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const fleet = store.fleet;
  // svelte-ignore state_referenced_locally
  const space = store.space;

  // svelte-ignore state_referenced_locally
  let chosen = $state<1 | 2 | 3>(flow.abyssGameModeSetting());
  let tier = $state<number | null>(null);
  let weather = $state<number | null>(null);
  let shipTypeLists = $state<readonly number[] | null>(null);
  let listsFor = $state<number | null>(null);
  let activating = $state(false);
  let finished = $state(false);
  /** The errors the server last said for each mode's button (BaseActivationController._remote_errors). */
  let remoteErrors = $state<Record<number, readonly AbyssErrorEntry[]>>({});

  const nameOf = (kind: Parameters<typeof resolvedName>[1], id: number): string => resolvedName($names.resolved, kind, id, "");
  function word(label: string, args: Record<string, string | number> = {}): string {
    const template = $words.templates[label];
    if (typeof template !== "string") return "";
    return plainText(formatTemplate(template, args, {
      nameOf,
      writeInterval: (ticks, _from, to) => writtenInterval(ticks, (to ?? "second") as "second", $words.templates, "day"),
      writeDistance: (meters, decimalPlaces) => fmtDist(meters, decimalPlaces, distanceSay($words.templates)),
    }));
  }
  /** FmtDate of an interval (format.py 85 to 89): written from days down to seconds. */
  const fmtInterval = (ticks: bigint): string => writtenInterval(ticks, "second", $words.templates, "day") ?? "";

  const status = $derived($flight.status);
  const solarSystemID = $derived(status?.solarSystemID ?? null);
  const security = $derived(solarSystemID === null ? null : ($names.systemSecurity[solarSystemID] ?? null));
  const shipTypeID = $derived(status?.inSpace || status?.docked ? (status?.shipTypeID ?? null) : null);
  const crimewatch = $derived($flight.crimewatch?.states ?? null);
  const pvpTimerState = $derived(crimewatch?.timers.find((timer) => timer.state >= 200 && timer.state < 300)?.state ?? null);
  const transition = $derived(status?.transition ?? null);
  const inFleet = $derived($fleet.loaded ? ($fleet.fleet?.fleetID ?? null) !== null : null);

  const facts = $derived<DeployFacts>({
    solarSystemID,
    security,
    docked: status?.docked === true,
    shipTypeID,
    shipTypeLists: listsFor === shipTypeID ? shipTypeLists : null,
    inWarp: status?.shipMode === "WARP",
    cloaked: false,
    selfDestructing: false,
    pvpTimerState,
    safetyLevel: crimewatch?.safetyLevel ?? null,
    sessionChangeInProgress: transition !== null && (["requested", "accepted", "session-changing"].includes(transition.phase)
      || (transition.cooldownUntilMs !== null && transition.cooldownUntilMs > Date.now())),
    inFleet,
    key: { groupID: item.groupID, ownedByPilot: item.ownedByPilot, quantity: item.quantity },
    keyTier: tier,
  });

  const option = $derived(GAME_MODE_OPTIONS.find((each) => each.value === chosen) ?? GAME_MODE_OPTIONS[0]!);
  // A trace's mode is its own (abyss.get_game_mode(slimItem.gameModeID or UNKNOWN)); the unknown one takes any hull.
  const mode = $derived(trace !== null
    ? (trace.gameModeID === 1 || trace.gameModeID === 2 || trace.gameModeID === 3 ? GAME_MODES[trace.gameModeID] : UNKNOWN_GAME_MODE)
    : GAME_MODES[option.mode]);
  /** Whether the trace is open (its slim item's isAbyssGateOpen), as the space read last had it. */
  const entranceOpen = $derived(trace === null
    ? true
    : (($space.snapshot?.entities ?? []).find((entity) => entity.itemID === item.itemID)?.isAbyssGateOpen ?? false) === true);
  const localErrors = $derived(trace !== null ? validateJump(facts, mode, entranceOpen) : validateDeploy(facts, mode));
  /** The button's errors (BaseActivationController.errors): its own checks' and the server's last, once each. */
  const errors = $derived.by(() => {
    const seen = new Set<string>();
    return [...localErrors, ...(remoteErrors[mode.id] ?? [])].filter((entry) => {
      const key = JSON.stringify(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  const ready = $derived(localErrors.length === 0 && !activating && !finished);
  const buttonText = $derived(trace !== null || mode.jumpsOnDeploy
    ? word(activating ? ABYSS_WINDOW_LABELS.jumping : ABYSS_WINDOW_LABELS.activate)
    : word(activating ? ABYSS_WINDOW_LABELS.deploying : ABYSS_WINDOW_LABELS.fleet));
  const suspicious = $derived(trace === null && isSuspicious(security, tier));
  const firstLine = $derived(trace !== null
    ? word(JUMP_DESCRIPTION_LABELS[trace.gameModeID ?? 0] ?? UNKNOWN_JUMP_DESCRIPTION_LABEL)
    : word(ABYSS_WINDOW_LABELS.shortDescription));
  const errorTexts = $derived(errors.map((entry) => {
    const { label, args } = abyssErrorLabel(entry);
    return word(label, args);
  }));

  // The ship's hulls, read again for a ship of another type.
  $effect(() => {
    const typeID = shipTypeID;
    if (typeID === null || listsFor === typeID) return;
    void flow.abyssShipTypeLists(typeID).then((lists) => {
      if (shipTypeID === typeID) {
        shipTypeLists = lists;
        listsFor = typeID;
      }
    }).catch(() => {});
  });
  $effect(() => {
    if (solarSystemID !== null) flow.requestSystemSecurity([solarSystemID]);
  });
  $effect(() => {
    const labels = errors.map((entry) => abyssErrorLabel(entry));
    flow.requestNames(labels.flatMap(({ label, args }) => {
      const template = $words.templates[label];
      return typeof template === "string" ? templateNameRefs(template, args) : [];
    }));
  });

  function chooseMode(value: 1 | 2 | 3): void {
    chosen = value;
    flow.keepAbyssGameModeSetting(value);
  }

  async function activate(): Promise<void> {
    if (!ready) return;
    const modeID = mode.id;
    remoteErrors = { ...remoteErrors, [modeID]: [] };
    activating = true;
    try {
      const outcome = trace !== null ? await flow.jumpThroughTrace(item.itemID) : await flow.deployAbyssalFilament(item.itemID, modeID as GameModeID);
      if (outcome.deployed) {
        finished = true;
        setTimeout(onClose, 1000);
      } else {
        remoteErrors = { ...remoteErrors, [modeID]: outcome.errors };
      }
    } finally {
      activating = false;
    }
  }

  onMount(() => {
    flow.requestWords([
      ...Object.values(ABYSS_WINDOW_LABELS),
      ...Object.values(TIER_DESCRIPTION_BY_TIER),
      ...Object.values(WEATHER_DESCRIPTION_BY_TYPE),
      ...GAME_MODE_OPTIONS.map((each) => each.label),
      ...Object.values(JUMP_DESCRIPTION_LABELS),
      ...abyssErrorLabels(),
      ...INTERVAL_WORD_LABELS,
      ...DISTANCE_WORD_LABELS,
    ]);
    flow.requestNames([{ kind: "type", id: item.typeID }]);
    if (!$fleet.loaded) void flow.loadFleet().catch(() => {});
    void flow.filamentFacts(item.typeID).then((read) => {
      tier = read.tier;
      weather = read.weather;
      if (read.weather !== null) flow.requestNames([{ kind: "type", id: read.weather }]);
    }).catch(() => {});
  });

  const filamentName = $derived(nameOf("type", item.typeID));
  const weatherName = $derived(weather === null ? "" : nameOf("type", weather));
</script>

<section class="key-window" aria-label={filamentName || "Filament"}>
  <header class="key-head">
    <h3>{filamentName}</h3>
    <button type="button" class="key-close" aria-label="Close" onclick={onClose}>×</button>
  </header>
  <div class="key-row">
    <TypeIcon typeID={item.typeID} name={filamentName} size="lg" />
    <div class="key-text">
      <p>{firstLine}</p>
      {#if tier !== null && TIER_DESCRIPTION_BY_TIER[tier]}
        <p>{word(TIER_DESCRIPTION_BY_TIER[tier]!)}</p>
      {/if}
    </div>
  </div>
  {#if weather !== null}
    <div class="key-row">
      <TypeIcon typeID={weather} name={weatherName} size="md" />
      <div class="key-text">
        <p class="key-weather-name">{weatherName}</p>
        {#if WEATHER_DESCRIPTION_BY_TYPE[weather]}
          <p>{word(WEATHER_DESCRIPTION_BY_TYPE[weather]!)}</p>
        {/if}
      </div>
    </div>
  {/if}
  <p class="key-warning">{word(ABYSS_WINDOW_LABELS.timerDescription, { color: "#ff0000", time: fmtInterval(DEFAULT_ABYSS_CONTENT_DURATION) })}</p>
  {#if suspicious}
    <p class="key-warning">{word(ABYSS_WINDOW_LABELS.suspectDescription, { color: "#ffff00", time: fmtInterval(CRIMINAL_TIMER_TIMEOUT) })}</p>
  {/if}
  <div class="key-bottom">
    {#if trace === null}
      <select class="key-mode" aria-label="Game mode" value={chosen} onchange={(event) => chooseMode(Number((event.currentTarget as HTMLSelectElement).value) as 1 | 2 | 3)}>
        {#each GAME_MODE_OPTIONS as each (each.value)}
          <option value={each.value}>{word(each.label)}</option>
        {/each}
      </select>
    {/if}
    <span class="key-activate">
      <button
        type="button"
        class="key-button"
        class:key-error={errors.length > 0 && !ready}
        disabled={!ready}
        onclick={() => void activate()}
      >{buttonText}</button>
      {#if errorTexts.length > 0}
        <ul class="key-errors" role="tooltip">
          {#each errorTexts as text, at (at)}
            <li>{text}</li>
          {/each}
        </ul>
      {/if}
    </span>
  </div>
</section>

<style>
  .key-window {
    position: absolute;
    left: 50%;
    top: 12px;
    transform: translateX(-50%);
    width: min(420px, calc(100% - 16px));
    z-index: 30;
    background: var(--panel-bg, #11161c);
    border: 1px solid var(--line, #2b3540);
    padding: 10px 12px 14px;
    display: grid;
    gap: 12px;
  }
  .key-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .key-head h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  .key-close {
    background: none;
    border: none;
    color: inherit;
    font-size: 1.1rem;
    cursor: pointer;
  }
  .key-row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
    align-items: start;
  }
  .key-text p {
    margin: 0 0 6px;
  }
  .key-weather-name {
    font-weight: 600;
  }
  .key-warning {
    margin: 0;
    padding: 12px;
    background: rgba(77, 26, 26, 0.5);
  }
  .key-bottom {
    display: grid;
    justify-items: center;
    gap: 12px;
  }
  .key-mode,
  .key-button {
    width: 140px;
    height: 30px;
  }
  .key-activate {
    position: relative;
    display: inline-block;
  }
  .key-button.key-error {
    border-color: #c33;
    color: #f88;
  }
  .key-errors {
    display: none;
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin: 4px 0 0;
    padding: 8px;
    list-style: none;
    width: max-content;
    max-width: 320px;
    background: var(--panel-bg, #11161c);
    border: 1px solid #c33;
    z-index: 31;
  }
  .key-errors li + li {
    margin-top: 4px;
  }
  .key-activate:hover .key-errors,
  .key-activate:focus-within .key-errors {
    display: block;
  }
</style>
