<script lang="ts">
  // The planets window's Launches tab (planetWindow.py LaunchesPanel, 74 to 133; bridge/planetLaunches.ts): each of the
  // pilot's launches with the time left before its container re-enters, counted down each second (or the words for one
  // burned up), its solar system, its planet and when it was launched. Its menu (journal.py
  // PlanetaryInteractionLaunchEntry.GetMenu, 425 to 444): the system's route entries and, in the pilot's own system in
  // space, Approach Location or Warp To; Remove for one burned up.
  //
  // The space feed is claimed while the tab is open, for the distance to a launch in the pilot's own system.
  import { onMount } from "svelte";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { filetimeAt, launchMenu, reentryLeft } from "../bridge/planetLaunches.ts";
  import { panelErrorWords } from "../bridge/refusals.ts";
  import { SHORT_INTERVAL_WORD_LABELS, shortWrittenInterval } from "../bridge/timeInterval.ts";
  import { celestialRouteEntries } from "../nav/waypoints.ts";
  import { resolvedName, type NameRef } from "../store/names.ts";
  import type { LaunchDetail } from "../bridge/piColonies.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, nowMs }: { store: ClientStore; flow: AppFlow; nowMs: number } = $props();
  // svelte-ignore state_referenced_locally
  const launchesRead = flow.planetLaunches;
  // svelte-ignore state_referenced_locally
  const waypoints = flow.waypoints;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const space = store.space;

  const WORDS = {
    reentry: "UI/Journal/JournalWindow/PI/HeaderReentry",
    system: "UI/Journal/JournalWindow/PI/HeaderSolarSystem",
    planet: "UI/Journal/JournalWindow/PI/HeaderPlanet",
    launchTime: "UI/Journal/JournalWindow/PI/HeaderLaunchTime",
    none: "UI/Journal/JournalWindow/PI/NoActiveLaunches",
    burnedUp: "UI/Journal/JournalWindow/PI/BurnedUp",
    // FmtDate's default format, 'll' (carbon format.py 71 to 114).
    date: "/Carbon/UI/Common/DateTime/SimpleDateUTC",
    setDestination: "UI/Inflight/SetDestination",
    addWaypoint: "UI/Inflight/AddWaypoint",
    removeWaypoint: "UI/Inflight/RemoveWaypoint",
    approach: "UI/Inflight/ApproachLocation",
    warp: "UI/Inflight/WarpToBookmark",
    remove: "UI/Commands/Remove",
  } as const;
  $effect(() => {
    flow.requestWords([...Object.values(WORDS), ...SHORT_INTERVAL_WORD_LABELS]);
  });
  const word = (label: string, own: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? plainText(template) : own;
  };

  // Each launch's system and planet by name.
  $effect(() => {
    const refs: NameRef[] = [];
    for (const launch of $launchesRead.launches) {
      if (launch.solarSystemID > 0) refs.push({ kind: "system", id: launch.solarSystemID });
      if (launch.planetID > 0) refs.push({ kind: "planet", id: launch.planetID });
    }
    if (refs.length > 0) flow.requestNames(refs);
  });

  const now = $derived(filetimeAt(nowMs));

  /** AutoUpdateLaunchDecayTimes: the time left, the short way, or the words for one burned up. */
  function reentryWords(left: bigint | null): string {
    if (left === null) return word(WORDS.burnedUp, "Burned up");
    return shortWrittenInterval(left, $words.templates) ?? "…";
  }

  /** FmtDate(launchTime): its date and time as the client's label words them. */
  function launchedWords(launch: LaunchDetail): string {
    if (launch.launchTime === null) return "-";
    const template = $words.templates[WORDS.date];
    return typeof template === "string"
      ? plainText(formatTemplate(template, { datetime: String(launch.launchTime) }, { nameOf: () => "" }))
      : new Date(Number((launch.launchTime - 116_444_736_000_000_000n) / 10_000n)).toUTCString();
  }

  let menuFor = $state<number | null>(null);
  let busy = $state(false);
  let failure = $state("");

  const pilot = $derived({
    inSpaceSystemID: $flight.status?.inSpace ? ($flight.status.solarSystemID ?? null) : null,
    shipPosition: $space.snapshot?.ship?.position ?? null,
  });
  const here = $derived($flight.status?.solarSystemID ?? null);

  async function act(action: () => Promise<void>): Promise<void> {
    menuFor = null;
    busy = true;
    failure = "";
    try {
      await action();
    } catch (cause) {
      failure = panelErrorWords(cause);
    } finally {
      busy = false;
    }
  }

  function route(systemID: number, how: "destination" | "add" | "remove"): void {
    menuFor = null;
    if (how === "destination") flow.setDestination(systemID);
    else if (how === "add") flow.addWaypoint(systemID);
    else flow.clearWaypoints(systemID);
  }

  onMount(() => {
    void flow.loadPlanetLaunches().catch(() => undefined);
    flow.startSpacePolling();
    return () => flow.stopSpacePolling();
  });
</script>

<div class="planet-launches">
  {#if failure}
    <p class="error">{failure}</p>
  {/if}
  {#if $launchesRead.error}
    <p class="error">Your launches could not be read just now.</p>
  {/if}
  {#if $launchesRead.launches.length === 0}
    <p class="note">{word(WORDS.none, "No launches in orbit.")}</p>
  {:else}
    <div class="table-wrap overflow-x-auto">
      <table class="guests reflow">
        <thead>
          <tr>
            <th>{word(WORDS.reentry, "Re-entry")}</th>
            <th>{word(WORDS.system, "System")}</th>
            <th>{word(WORDS.planet, "Planet")}</th>
            <th>{word(WORDS.launchTime, "Launched")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each $launchesRead.launches as launch (launch.launchID)}
            {@const left = reentryLeft(launch, now)}
            {@const menu = launchMenu(launch, left === null, pilot)}
            <tr>
              <td data-label={word(WORDS.reentry, "Re-entry")} class={left === null ? "burned-up" : "in-orbit"}>{reentryWords(left)}</td>
              <td data-label={word(WORDS.system, "System")}>{resolvedName($names.resolved, "system", launch.solarSystemID, "an unnamed system")}</td>
              <td data-label={word(WORDS.planet, "Planet")}>{resolvedName($names.resolved, "planet", launch.planetID, "an unnamed planet")}</td>
              <td data-label={word(WORDS.launchTime, "Launched")}>{launchedWords(launch)}</td>
              <td data-label="">
                <button type="button" class="minor" aria-label="The launch's menu" aria-expanded={menuFor === launch.launchID} disabled={busy}
                  onclick={() => (menuFor = menuFor === launch.launchID ? null : launch.launchID)}>⋯</button>
                {#if menuFor === launch.launchID}
                  <span class="launch-menu">
                    {#if menu.routeSystemID !== null}
                      {@const entries = celestialRouteEntries(menu.routeSystemID, true, here, $waypoints)}
                      {#if entries.setDestination}
                        <button type="button" class="minor" onclick={() => route(menu.routeSystemID!, "destination")}>{word(WORDS.setDestination, "Head there")}</button>
                      {/if}
                      {#if entries.addWaypoint}
                        <button type="button" class="minor" onclick={() => route(menu.routeSystemID!, "add")}>{word(WORDS.addWaypoint, "Put on the route")}</button>
                      {:else if entries.removeWaypoint}
                        <button type="button" class="minor" onclick={() => route(menu.routeSystemID!, "remove")}>{word(WORDS.removeWaypoint, "Take off the route")}</button>
                      {/if}
                    {/if}
                    {#if menu.move === "approach"}
                      <button type="button" class="minor" onclick={() => void act(() => flow.approachPlanetLaunch(launch.itemID))}>{word(WORDS.approach, "Fly to it")}</button>
                    {:else if menu.move === "warp"}
                      <button type="button" class="minor" onclick={() => void act(() => flow.warpToPlanetLaunch(launch.launchID))}>{word(WORDS.warp, "Warp to it")}</button>
                    {/if}
                    {#if menu.remove}
                      <button type="button" class="minor" onclick={() => void act(() => flow.removePlanetLaunch(launch.launchID))}>{word(WORDS.remove, "Take it off the list")}</button>
                    {/if}
                  </span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  /* The client's countdown is yellow, and the words for one burned up orange-red (planetWindow.py 125 and 127): the
     page's own warning and danger colours, which read in both themes. */
  .planet-launches .in-orbit { color: var(--color-warn); }
  .planet-launches .burned-up { color: var(--color-danger); }
  .planet-launches .launch-menu { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; margin-left: 0.25rem; }
</style>
