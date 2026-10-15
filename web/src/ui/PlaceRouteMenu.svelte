<script lang="ts">
  // A place's Location menu, as far as it is the route (menusvc.py _CelestialMenu, 2003 to 2008), for a window that
  // lists places: the market's orders (entries.py GetMenu, 111 to 123: Location, the station's or structure's
  // celestial menu). Its button opens it; it offers what the client's checkers allow (nav/waypoints.ts
  // celestialRouteEntries); each entry closes it.
  //
  // A structure is taken as one the structure directory knows (CanBeWaypoint, by GetWaypointSolarsystemID): the flow
  // asks the directory before it sets one, and refuses it as the client's star map does where it is not known.
  import { plainText } from "../bridge/clientWords.ts";
  import { celestialRouteEntries, isPlayerItemID, isWaypointPlace } from "../nav/waypoints.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow, placeID }: { store: ClientStore; flow: AppFlow; placeID: number } = $props();
  // svelte-ignore state_referenced_locally
  const waypoints = flow.waypoints;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const station = store.station;

  const WORDS = {
    location: "UI/Common/Location",
    setDestination: "UI/Inflight/SetDestination",
    addWaypoint: "UI/Inflight/AddWaypoint",
    removeWaypoint: "UI/Inflight/RemoveWaypoint",
  } as const;
  $effect(() => {
    flow.requestWords(Object.values(WORDS));
  });
  const word = (label: string, own: string): string => {
    const template = $words.templates[label];
    return typeof template === "string" && template !== "" ? plainText(template) : own;
  };

  let open = $state(false);
  const here = $derived($flight.status?.solarSystemID ?? $station.online?.solarSystemID ?? null);
  const entries = $derived(celestialRouteEntries(placeID, isWaypointPlace(placeID) || isPlayerItemID(placeID), here, $waypoints));

  function choose(how: "destination" | "add" | "remove"): void {
    open = false;
    if (how === "destination") flow.setDestination(placeID);
    else if (how === "add") flow.addWaypoint(placeID);
    else flow.clearWaypoints(placeID);
  }
</script>

<span class="place-route">
  <button
    type="button"
    class="minor"
    aria-label={word(WORDS.location, "Where")}
    title={word(WORDS.location, "Where")}
    aria-expanded={open}
    onclick={(event) => {
      event.stopPropagation();
      open = !open;
    }}
  >⋯</button>
  {#if open}
    <span class="place-route-menu">
      {#if entries.setDestination}
        <button type="button" class="minor" onclick={() => choose("destination")}>{word(WORDS.setDestination, "Head there")}</button>
      {/if}
      {#if entries.addWaypoint}
        <button type="button" class="minor" onclick={() => choose("add")}>{word(WORDS.addWaypoint, "Put on the route")}</button>
      {:else if entries.removeWaypoint}
        <button type="button" class="minor" onclick={() => choose("remove")}>{word(WORDS.removeWaypoint, "Take off the route")}</button>
      {/if}
    </span>
  {/if}
</span>

<style>
  .place-route { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; }
  .place-route-menu { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; }
</style>
