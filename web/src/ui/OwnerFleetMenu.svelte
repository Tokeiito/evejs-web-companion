<script lang="ts">
  // menusvc.FleetMenu686-734; CharacterChecker.OfferFleetMenu; FleetMemberChecker465-535.
  import { onMount, type Snippet } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow, FleetMenuAction } from "../app/flow.ts";
  import { isNpcOwner } from "../bridge/mail.ts";
  import { memberMenu, rankLabel, type MemberMenuPlace, type MemberMenuWing, type MemberMenuSquad } from "../bridge/fleetMemberMenu.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { showInfo } from "./showInfo.ts";
  import { notify } from "./notices.ts";
  import FleetWarpMenu from "./FleetWarpMenu.svelte";

  let { store, flow, ownerID, onDone, onOpen, openWatchlist, navigation }: {
    store: ClientStore; flow: AppFlow; ownerID: number; onDone: () => void;
    onOpen?: () => void; openWatchlist?: () => void; navigation?: Snippet;
  } = $props();
  // svelte-ignore state_referenced_locally
  const fleet = store.fleet;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  const LABELS = {
    fleet: "UI/Fleet/Fleet", info: "UI/Commands/ShowInfo", kick: "UI/Fleet/KickFleetMember",
    confirm: "UI/Menusvc/ConfirmMenuOption", leader: "UI/Fleet/MakeFleetLeader", addWatch: "UI/Fleet/AddPilotToWatchlist",
    removeWatch: "UI/Fleet/RemovePilotFromWatchlist", travel: "UI/Fleet/FleetBroadcast/Commands/BroadcastTravelToMe",
    leave: "UI/Fleet/LeaveMyFleet", move: "UI/Fleet/FleetSubmenus/MoveFleetMember", wing: "UI/Fleet/FleetSubmenus/WingX",
    squad: "UI/Fleet/FleetSubmenus/SquadX", count: "UI/Fleet/FleetSubmenus/SquadNameWithNumMembers",
  };
  let expandedFor = $state<number | null>(null);
  const expanded = $derived(expandedFor === ownerID);
  let part = $state<"kick" | "leave" | "move" | null>(null);
  $effect(() => { ownerID; expandedFor = null; part = null; });
  const me = $derived($station.online?.characterID ?? null);
  const members = $derived($fleet.fleet?.initState.value.members ?? []);
  const mine = $derived(members.find(member => Number(member.charID) === me));
  const target = $derived(members.find(member => Number(member.charID) === ownerID));
  const offered = $derived($fleet.availability === "ready" && mine !== undefined && target !== undefined && !isNpcOwner(ownerID));
  const self = $derived(ownerID === me);
  const boss = $derived(mine !== undefined && (mine.job & 2) !== 0);
  // fleetSvc.IsMySubordinate1839: rank does not add a comparison with the target's rank.
  const subordinate = $derived(mine !== undefined && target !== undefined && (mine.role === 1
    || mine.role === 2 && String(mine.wingID) === String(target.wingID)
    || mine.role === 3 && String(mine.squadID) === String(target.squadID)));
  const favorite = $derived(($fleet.watchlist ?? []).includes(ownerID));
  const blocked = $derived($fleet.activeAction !== null);
  const word = (label: string, fallback: string): string => plainText($words.templates[label] ?? fallback);
  const filled = (label: string, fallback: string, values: Record<string, string>): string => plainText(formatTemplate($words.templates[label] ?? fallback, values, { nameOf: () => "" }));
  const rank = (place: MemberMenuPlace): string => word(rankLabel(place.role), place.role === 1 ? "Fleet Commander" : place.role === 2 ? "Wing Commander" : place.role === 3 ? "Squad Commander" : "Squad Member");
  const wing = (entry: MemberMenuWing): string => entry.name || filled(LABELS.wing, "Wing {wingNumber}", { wingNumber: String(entry.wingNumber) });
  const squad = (entry: MemberMenuSquad): string => filled(LABELS.count, "{squadName} ({numMembers})", {
    squadName: entry.name || filled(LABELS.squad, "Squad {squadNumber}", { squadNumber: String(entry.squadNumber) }), numMembers: String(entry.numMembers),
  });
  const numberOrNull = (id: number | string | null): number | null => id === null || id === "" || !Number.isFinite(Number(id)) ? null : Number(id);
  const placements = $derived(me === null || !offered ? [] : memberMenu({
    targetCharID: ownerID, me, isMove: true, isFreeMove: $fleet.fleet?.initState.value.options.isFreeMove === true,
    members: members.map(member => ({ charID: Number(member.charID), role: member.role, job: member.job, wingID: numberOrNull(member.wingID), squadID: numberOrNull(member.squadID) })),
    wings: ($fleet.fleet?.initState.value.wings ?? []).flatMap(entry => {
      const wingID = numberOrNull(entry.wingID);
      return wingID === null ? [] : [{ wingID, name: entry.name, squads: entry.squads.flatMap(child => {
        const squadID = numberOrNull(child.squadID); return squadID === null ? [] : [{ squadID, name: child.name }];
      }) }];
    }),
  }));

  function act(action: FleetMenuAction): void {
    if (blocked) return;
    const openingWatchlist = openWatchlist;
    // Start before closing: the flow captures this pilot and retains native questions after menu unmount.
    const pending = flow.fleetMenuAction(action);
    expandedFor = null;
    onDone();
    void pending.then(result => { if (result === "watchlist") openingWatchlist?.(); }).catch(error => {
      if (error?.code !== "SESSION_REQUEST_RETIRED" && error?.code !== "SESSION_LOST") notify({ kind: "danger", title: "Fleet action refused", detail: error instanceof Error ? error.message : String(error) });
    });
  }
  function move(place: MemberMenuPlace): void { act({ kind: "move", characterID: ownerID, wingID: place.wingID, squadID: place.squadID, role: place.role ?? 4 }); }
  onMount(() => {
    flow.requestWords([...Object.values(LABELS), ...[1, 2, 3, 4].map(rankLabel)]);
    if ($fleet.availability !== "ready" && $fleet.availability !== "not-in-fleet") void flow.loadFleet(true).catch(() => {});
  });
</script>

{#if offered}
  <button type="button" class="minor" aria-expanded={expanded} onclick={() => { expandedFor = expanded ? null : ownerID; part = null; if (expanded) onOpen?.(); }}>{word(LABELS.fleet, "Fleet")} {expanded ? "▾" : "▸"}</button>
  {#if expanded}
    <span class="owner-fleet-menu">
      <button type="button" class="minor" onclick={() => { expandedFor = null; onDone(); showInfo({ kind: "character", characterID: ownerID }); }}>{word(LABELS.info, "Show Info")}</button>
      {#if !self && (boss || subordinate)}
        <button type="button" class="minor" aria-expanded={part === "kick"} onclick={() => part = part === "kick" ? null : "kick"}>{word(LABELS.kick, "Kick Fleet Member")} {part === "kick" ? "▾" : "▸"}</button>
        {#if part === "kick"}<button type="button" class="minor" disabled={blocked} onclick={() => act({ kind: "kick", characterID: ownerID })}>{word(LABELS.confirm, "Confirm")}</button>{/if}
      {/if}
      {#if !self && boss}<button type="button" class="minor" disabled={blocked} onclick={() => act({ kind: "leader", characterID: ownerID })}>{word(LABELS.leader, "Make Fleet Leader")}</button>{/if}
      {#if !self}<button type="button" class="minor" disabled={blocked} onclick={() => act({ kind: "watch", characterID: ownerID, add: !favorite })}>{word(favorite ? LABELS.removeWatch : LABELS.addWatch, favorite ? "Remove Pilot from Watchlist" : "Add Pilot to Watchlist")}</button>{/if}
      {#if self && (boss || mine && [1, 2, 3].includes(mine.role))}<button type="button" class="minor" disabled={blocked} onclick={() => act({ kind: "travelToMe" })}>{word(LABELS.travel, "Broadcast: Travel To Me")}</button>{/if}
      <FleetWarpMenu {store} {flow} {ownerID} {blocked} warp={(range, group) => act({ kind: "warp", characterID: ownerID, range, group })} onDone={() => { expandedFor = null; onDone(); }} />
      {@render navigation?.()}
      {#if self}
        <button type="button" class="minor" aria-expanded={part === "leave"} onclick={() => part = part === "leave" ? null : "leave"}>{word(LABELS.leave, "Leave My Fleet")} {part === "leave" ? "▾" : "▸"}</button>
        {#if part === "leave"}<button type="button" class="minor" disabled={blocked} onclick={() => act({ kind: "leave" })}>{word(LABELS.confirm, "Confirm")}</button>{/if}
      {/if}
      {#if placements.length > 0}
        <button type="button" class="minor" aria-expanded={part === "move"} onclick={() => part = part === "move" ? null : "move"}>{word(LABELS.move, "Move Fleet Member")} {part === "move" ? "▾" : "▸"}</button>
        {#if part === "move"}
          {#each placements as entry, i (i)}
            {#if entry.kind === "place"}<button type="button" class="minor" disabled={blocked} onclick={() => move(entry)}>{rank(entry)}</button>
            {:else}<span>{wing(entry)}:
              {#each entry.entries as child, j (j)}
                {#if child.kind === "place"}<button type="button" class="minor" disabled={blocked} onclick={() => move(child)}>{rank(child)}</button>
                {:else}<span>{squad(child)}:
                  {#each child.places as place, k (k)}<button type="button" class="minor" disabled={blocked} onclick={() => move(place)}>{rank(place)}</button>{/each}
                </span>{/if}
              {/each}
            </span>{/if}
          {/each}
        {/if}
      {/if}
    </span>
  {/if}
{/if}

<style>
  .owner-fleet-menu { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; max-width: 100%; }
</style>
