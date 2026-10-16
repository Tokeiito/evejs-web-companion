<script lang="ts">
  // The client's route window (autopilotSettings.py AutopilotSettings), opened from the route panel's Manage Route
  // (infoPanelRoute.py 123). Two tabs:
  //
  //   Waypoints (LoadWaypoints, 104 to 170): the pilot's system first; then each waypoint, numbered, with what it is
  //   and the places it is in, and before it, while Waypoints Expanded is ticked, each system the route goes through
  //   on the way. A waypoint dragged onto another is put where that one stood; let go on the list but on no entry, it
  //   is put last; let go on a system on the way, nothing changes (ChangeWaypointSorting, 71 to 97; AutoPilotItem,
  //   231 to 279). Under the list the tick and its note, and Optimize (the autopilot's OptimizeRoute).
  //
  //   Avoidance List (LoadAvoidance, 182 to 213): each place on the list, its kind and the places it is in, each with
  //   its location menu's Do Not Avoid (menusvc.py 2032 to 2033).
  //
  // A list is read again whenever the client's would be: the waypoints tab on OnDestinationSet, which the star map
  // sends on every change of the waypoints, of the autopilot's settings and of the pilot's system (starMapSvc.py
  // UpdateRoute, 2436 to 2501); the avoidance tab on OnAutopilotUpdated, a change of the settings.
  import { formatTemplate, plainText, type TemplateArguments } from "../bridge/clientWords.ts";
  import { resolvedName, type NameRef } from "../store/names.ts";
  import { avoidanceItems } from "../nav/autopilotSettings.ts";
  import { expandWaypoints, setExpandWaypoints } from "../app/expandWaypoints.ts";
  import { AVOID_WORDS, avoidEntryWords } from "./avoidLocation.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow, RouteWindowPlace, RouteWindowWaypoints } from "../app/flow.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const waypoints = flow.waypoints;
  // svelte-ignore state_referenced_locally
  const routeSettingsKept = flow.routeSettings;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const words = store.words;

  /** The window's words (autopilotSettings.py). */
  const WORDS = {
    waypointsTab: "UI/Map/MapPallet/tabWaypoints",
    avoidanceTab: "UI/Map/MapPallet/tabMapAdvoidance",
    currentLocation: "UI/Map/MapPallet/lblCurrentLocation",
    kind: "UI/Map/MapPallet/lblActiveColorCategory",
    onTheWay: "UI/Map/MapPallet/lblWaypointListEntryNoCount",
    waypoint: "UI/Map/MapPallet/lblWaypointListEntry",
    noWaypoints: "UI/Map/MapPallet/hintNoWaypoints",
    avoided: "UI/Map/MapPallet/lblAdvoidanceListEntry",
    noAvoided: "UI/Map/MapPallet/hintNoAdvoidanceItems",
    priority: "UI/Map/MapPallet/lblChangeWaypointPriority",
    expand: "UI/Map/MapPallet/cbExpandWaypoints",
    optimize: "UI/Map/MapPallet/btnOptimizeRoute",
  } as const;
  $effect(() => {
    flow.requestWords([...Object.values(WORDS), ...Object.values(AVOID_WORDS)]);
    flow.requestNames([5, 4, 3].map((id) => ({ kind: "typeGroup", id }) as NameRef));
  });

  /** The name kind a place is named by: a region, a constellation, a system, a station, or else a structure. */
  function placeKind(id: number): NameRef["kind"] {
    if (id >= 10_000_000 && id <= 19_999_999) return "region";
    if (id >= 20_000_000 && id <= 29_999_999) return "constellation";
    if (id >= 30_000_000 && id <= 39_999_999) return "system";
    if (id >= 60_000_000 && id < 64_000_000) return "station";
    return "structure";
  }
  const nameOf = (kind: NameRef["kind"], id: number): string => resolvedName($names.resolved, kind, id, "—");
  const placeName = (id: number): string => nameOf(placeKind(id), id);
  /** A label of the client's filled, as plain text; the page's own words where it is not to hand. */
  function said(label: string, args: TemplateArguments, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf })) : own;
  }
  /** A place's description (LoadWaypoints 124 to 130, LoadAvoidance 190 to 196): its kind, then each place it is in. */
  function description(place: RouteWindowPlace): string {
    const what = place.what === null ? "" : resolvedName($names.resolved, place.what.kind, place.what.id, "");
    return said(WORDS.kind, { activeLabel: what }, `(${what})`) + place.within.map((id) => ` / ${placeName(id)}`).join("");
  }

  let tab = $state<"waypoints" | "avoidance">("waypoints");

  // The waypoints tab's list.
  let listed = $state.raw<RouteWindowWaypoints | null>(null);
  let listFailed = $state(false);
  const pilotSystem = $derived($flight.status?.solarSystemID ?? $station.online?.solarSystemID ?? null);
  $effect(() => {
    if (tab !== "waypoints") return;
    void $waypoints;
    void $routeSettingsKept;
    void pilotSystem;
    let live = true;
    void flow.routeWindowWaypoints().then((read) => {
      if (!live) return;
      listed = read;
      listFailed = false;
    }, () => {
      if (!live) return;
      listed = null;
      listFailed = true;
    });
    return () => {
      live = false;
    };
  });

  // The avoidance tab's list.
  let avoidedPlaces = $state.raw<readonly RouteWindowPlace[]>([]);
  $effect(() => {
    if (tab !== "avoidance") return;
    void $routeSettingsKept;
    let live = true;
    void flow.routeWindowAvoidance().then((read) => {
      if (live) avoidedPlaces = read;
    }, () => undefined);
    return () => {
      live = false;
    };
  });

  // Every place either list names.
  $effect(() => {
    const refs: NameRef[] = [];
    const add = (place: RouteWindowPlace): void => {
      refs.push({ kind: placeKind(place.id), id: place.id }, ...place.within.map((id) => ({ kind: placeKind(id), id }) as NameRef));
      if (place.what !== null) refs.push(place.what);
    };
    if (listed !== null) {
      refs.push({ kind: "system", id: listed.currentSystemID });
      for (const waypoint of listed.waypoints) {
        add(waypoint);
        refs.push(...waypoint.between.map((id) => ({ kind: "system", id }) as NameRef));
      }
    }
    for (const place of avoidedPlaces) add(place);
    if (refs.length > 0) flow.requestNames(refs);
  });

  // Drag and drop: the waypoint being dragged (its number in the list, less one: the client's orderID), and the entry
  // it is over, drawn as the client draws it (a light bar above a waypoint, a red one above any other entry).
  let dragging = $state<number | null>(null);
  let over = $state<{ readonly at: string; readonly takes: boolean } | null>(null);
  function dropOn(orderID: number): void {
    if (dragging !== null) flow.moveWaypoint(dragging, orderID);
    dragging = null;
    over = null;
  }

  let optimizing = $state(false);
  async function optimize(): Promise<void> {
    if (optimizing) return;
    optimizing = true;
    try {
      await flow.optimizeRoute();
    } finally {
      optimizing = false;
    }
  }
</script>

<section class="panel route-window">
  <nav class="tabs">
    <button type="button" class:active={tab === "waypoints"} onclick={() => (tab = "waypoints")}>{said(WORDS.waypointsTab, {}, "Waypoints")}</button>
    <button type="button" class:active={tab === "avoidance"} onclick={() => (tab = "avoidance")}>{said(WORDS.avoidanceTab, {}, "Avoided places")}</button>
  </nav>

  {#if tab === "waypoints"}
    {#if listFailed}
      <p class="error">The route could not be read.</p>
    {:else if listed === null}
      <p class="empty">{said(WORDS.noWaypoints, {}, "Nothing on the route")}</p>
    {:else}
      <ol
        class="entries"
        ondragover={(event) => { if (dragging !== null) event.preventDefault(); }}
        ondrop={(event) => { event.preventDefault(); dropOn(-1); }}
      >
        <li class:refused={over?.at === "here"} ondragenter={() => { if (dragging !== null) over = { at: "here", takes: false }; }} ondragover={(event) => event.stopPropagation()}>
          {said(WORDS.currentLocation, { locationName: nameOf("system", listed.currentSystemID) }, `Here: ${nameOf("system", listed.currentSystemID)}`)}
        </li>
        {#each listed.waypoints as waypoint, counter (counter)}
          {#if $expandWaypoints}
            {#each waypoint.between as systemID, i (`${counter}:${i}`)}
              <li class="on-the-way" class:refused={over?.at === `${counter}:${i}`}
                ondragenter={() => { if (dragging !== null) over = { at: `${counter}:${i}`, takes: false }; }} ondragover={(event) => event.stopPropagation()}>
                {said(WORDS.onTheWay, { itemName: nameOf("system", systemID) }, `· ${nameOf("system", systemID)}`)}
              </li>
            {/each}
          {/if}
          <li
            class="waypoint"
            class:taken={over?.at === `waypoint:${counter}`}
            draggable="true"
            ondragstart={(event) => { dragging = counter; event.dataTransfer?.setData("text/plain", String(waypoint.id)); }}
            ondragend={() => { dragging = null; over = null; }}
            ondragenter={() => { if (dragging !== null) over = { at: `waypoint:${counter}`, takes: true }; }}
            ondragover={(event) => { if (dragging !== null) { event.preventDefault(); event.stopPropagation(); } }}
            ondrop={(event) => { event.preventDefault(); event.stopPropagation(); dropOn(counter); }}
          >
            {said(WORDS.waypoint, { counter: counter + 1, itemName: placeName(waypoint.id), description: description(waypoint) }, `${counter + 1}. ${placeName(waypoint.id)}${description(waypoint)}`)}
          </li>
        {/each}
      </ol>
    {/if}
    <p class="note">{said(WORDS.priority, {}, "Drag a waypoint onto another to put it there.")}</p>
    <p class="controls">
      <label>
        <input type="checkbox" checked={$expandWaypoints} onchange={(event) => setExpandWaypoints(event.currentTarget.checked)} />
        {said(WORDS.expand, {}, "Show the systems on the way")}
      </label>
    </p>
    <p class="controls">
      <button type="button" disabled={optimizing} onclick={() => void optimize()}>{said(WORDS.optimize, {}, "Best order")}</button>
    </p>
  {:else}
    {#if avoidedPlaces.length === 0}
      <p class="empty">{said(WORDS.noAvoided, {}, "Nothing is avoided")}</p>
    {:else}
      <ul class="entries">
        {#each avoidedPlaces as place, i (`${place.id}:${i}`)}
          {@const avoided = avoidanceItems($routeSettingsKept).includes(place.id)}
          <li>
            {said(WORDS.avoided, { itemName: placeName(place.id), description: description(place) }, `${placeName(place.id)}${description(place)}`)}
            <button type="button" class="minor" onclick={() => (avoided ? flow.stopAvoidingLocation(place.id) : flow.avoidLocation(place.id))}>{avoidEntryWords(avoided, place.id, $words.templates, nameOf)}</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .route-window .entries { list-style: none; padding: 0; margin: 0.25rem 0; }
  .route-window .entries li { padding: 2px 4px; border-top: 2px solid transparent; }
  .route-window .waypoint { cursor: grab; }
  .route-window .on-the-way { opacity: 0.8; }
  /* AutoPilotItem's bar over the entry a waypoint is dragged over: light where it can be let go, red where not. */
  .route-window .taken { border-top-color: rgba(255, 255, 255, 0.5); }
  .route-window .refused { border-top-color: rgb(156, 13, 1); }
</style>
