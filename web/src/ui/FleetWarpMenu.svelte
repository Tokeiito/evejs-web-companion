<script lang="ts">
  // menusvc.FleetMenu686-734/WarpToMenu2254; FleetMemberChecker532-563; compiled oracle cdx974.
  import { onMount } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { fleetWarpOffers } from "../bridge/fleetWarpMenu.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { fmtDist } from "../space/overview.ts";
  import { DISTANCE_WORD_LABELS, distanceSay } from "../space/distanceWords.ts";
  import { WARP_RANGES } from "./flyingDistances.ts";

  let { store, flow, ownerID, blocked, warp, onDone }: {
    store: ClientStore; flow: AppFlow; ownerID: number; blocked: boolean;
    warp: (range: number, group: boolean) => void; onDone: () => void;
  } = $props();
  // svelte-ignore state_referenced_locally
  const fleet = store.fleet;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  // svelte-ignore state_referenced_locally
  const warpDistance = flow.warpDistance;
  const me = $derived($station.online?.characterID ?? null);
  const mine = $derived($fleet.fleet?.initState.value.members.find(member => Number(member.charID) === me));
  const offers = $derived(fleetWarpOffers(me, ownerID, mine?.role ?? null, $flight.status, $space.snapshot));
  let part = $state<"warp" | "group" | "default" | "groupDefault" | null>(null);
  const LABELS = {
    warp: "UI/Fleet/WarpToMember", warpWithin: "UI/Fleet/WarpToMemberSubmenuOption",
    within: "UI/Inflight/WarpToWithin", default: "UI/Inflight/Submenus/SetDefaultWarpRange", point: "UI/Fleet/FleetFormations/Point",
    fleet: "UI/Fleet/WarpFleetToMember", fleetWithin: "UI/Fleet/FleetSubmenus/WarpFleetToMember",
    wing: "UI/Fleet/WarpWingToMember", wingWithin: "UI/Fleet/FleetSubmenus/WarpWingToMember",
    squad: "UI/Fleet/WarpSquadToMember", squadWithin: "UI/Fleet/FleetSubmenus/WarpSquadToMember",
  };
  const say = $derived(distanceSay($words.templates));
  const word = (label: string, fallback: string): string => plainText($words.templates[label] ?? fallback);
  const filled = (label: string, fallback: string, values: Record<string, string>): string => plainText(formatTemplate($words.templates[label] ?? fallback, values, { nameOf: () => "" }));
  const groupWord = (group: "fleet" | "wing" | "squad", within: boolean): string => filled(
    LABELS[within ? `${group}Within` as const : group], `Warp ${group} to member ({fleetFormation})`, { fleetFormation: word(LABELS.point, "Point") });
  function keep(metres: number): void { flow.keepWarpDistance(metres); onDone(); }
  onMount(() => {
    flow.requestWords([...Object.values(LABELS), ...DISTANCE_WORD_LABELS]);
    if ($flight.status?.inSpace) void flow.loadSpaceSnapshot().catch(() => {});
  });
</script>

{#if offers.warp}
  <button type="button" class="minor" disabled={blocked} onclick={() => warp($warpDistance, false)}>{word(LABELS.warp, "Warp to Member")}</button>
  <button type="button" class="minor" aria-expanded={part === "warp" || part === "default"} onclick={() => part = part === "warp" || part === "default" ? null : "warp"}>{word(LABELS.warpWithin, "Warp to Member Within")} {part === "warp" || part === "default" ? "▾" : "▸"}</button>
  {#if part === "warp" || part === "default"}
    {@render ranges(false)}
  {/if}
  {#if offers.group}
    <button type="button" class="minor" disabled={blocked} onclick={() => warp($warpDistance, true)}>{groupWord(offers.group, false)}</button>
    <button type="button" class="minor" aria-expanded={part === "group" || part === "groupDefault"} onclick={() => part = part === "group" || part === "groupDefault" ? null : "group"}>{groupWord(offers.group, true)} {part === "group" || part === "groupDefault" ? "▾" : "▸"}</button>
    {#if part === "group" || part === "groupDefault"}{@render ranges(true)}{/if}
  {/if}
{/if}

{#snippet ranges(group: boolean)}
  <span class="fleet-warp-ranges">
    {#each WARP_RANGES as choice (choice.metres)}
      <button type="button" class="minor" disabled={blocked} onclick={() => warp(choice.metres, group)}>{filled(LABELS.within, "Warp to within {distance}", { distance: fmtDist(choice.metres, 2, say) })}</button>
    {/each}
    <button type="button" class="minor" aria-expanded={part === (group ? "groupDefault" : "default")} onclick={() => part = part === (group ? "groupDefault" : "default") ? (group ? "group" : "warp") : (group ? "groupDefault" : "default")}>{word(LABELS.default, "Set Default Warp Range")} {part === (group ? "groupDefault" : "default") ? "▾" : "▸"}</button>
    {#if part === (group ? "groupDefault" : "default")}
      {#each WARP_RANGES as choice (choice.metres)}
        <button type="button" class="minor" disabled={blocked} aria-pressed={choice.metres === $warpDistance} onclick={() => keep(choice.metres)}>{fmtDist(choice.metres, 2, say)}</button>
      {/each}
    {/if}
  </span>
{/snippet}

<style>
  .fleet-warp-ranges { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; max-width: 100%; }
</style>
