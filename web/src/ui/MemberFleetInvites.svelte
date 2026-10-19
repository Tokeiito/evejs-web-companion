<script lang="ts">
  // CharacterChecker162-207; menusvc736-754/2707-2730; compiled menuMerge.
  import { onMount, onDestroy } from "svelte";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import { isNpcOwner } from "../bridge/mail.ts";
  import { memberMenu, rankLabel, type MemberMenuPlace, type MemberMenuWing, type MemberMenuSquad } from "../bridge/fleetMemberMenu.ts";
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";

  let { store, flow, targets, onDone }: { store: ClientStore; flow: AppFlow; targets: readonly number[]; onDone: () => void } = $props();
  // svelte-ignore state_referenced_locally
  const fleet = store.fleet;
  // svelte-ignore state_referenced_locally
  const station = store.station;
  // svelte-ignore state_referenced_locally
  const words = store.words;
  let busy = $state(false);
  let error = $state("");
  let disposed = false;
  const me = $derived($station.online?.characterID ?? null);
  const ready = $derived($fleet.availability === "ready");
  const none = $derived($fleet.availability === "not-in-fleet");
  const members = $derived(ready ? $fleet.fleet?.initState.value.members ?? [] : []);
  const memberIDs = $derived(new Set(members.map(member => Number(member.charID))));
  const commands = $derived(members.some(member => Number(member.charID) === me && ((member.job & 2) !== 0 || [1, 2, 3].includes(member.role))));
  const eligible = $derived(targets.filter(id => !isNpcOwner(id) && (none || ready && commands && !memberIDs.has(id))));
  const blocked = $derived(busy || $fleet.activeAction !== null);
  const FORM = "UI/Fleet/FormFleetWith", INVITE = "UI/Fleet/InvitePilotToFleet";
  const WING = "UI/Fleet/FleetSubmenus/WingX", SQUAD = "UI/Fleet/FleetSubmenus/SquadX", COUNT = "UI/Fleet/FleetSubmenus/SquadNameWithNumMembers";
  const word = (label: string, fallback: string): string => plainText($words.templates[label] ?? fallback);
  const filled = (label: string, fallback: string, values: Record<string, string>): string => plainText(formatTemplate($words.templates[label] ?? fallback, values, { nameOf: () => "" }));
  const rank = (place: MemberMenuPlace): string => word(rankLabel(place.role), place.role === 1 ? "Fleet Commander" : place.role === 2 ? "Wing Commander" : place.role === 3 ? "Squad Commander" : "Squad Member");
  const wing = (entry: MemberMenuWing): string => entry.name || filled(WING, "Wing {wingNumber}", { wingNumber: String(entry.wingNumber) });
  const squad = (entry: MemberMenuSquad): string => filled(COUNT, "{squadName} ({numMembers})", {
    squadName: entry.name || filled(SQUAD, "Squad {squadNumber}", { squadNumber: String(entry.squadNumber) }), numMembers: String(entry.numMembers),
  });
  const numberOrNull = (id: number | string | null): number | null => id === null || id === "" || !Number.isFinite(Number(id)) ? null : Number(id);
  const placements = $derived(me === null || targets.length !== 1 || eligible.length !== 1 ? [] : memberMenu({
    targetCharID: eligible[0]!, me, isMove: false, isFreeMove: $fleet.fleet?.initState.value.options.isFreeMove === true,
    members: members.map(member => ({ charID: Number(member.charID), role: member.role, job: member.job, wingID: numberOrNull(member.wingID), squadID: numberOrNull(member.squadID) })),
    wings: ($fleet.fleet?.initState.value.wings ?? []).flatMap(entry => {
      const wingID = numberOrNull(entry.wingID);
      return wingID === null ? [] : [{ wingID, name: entry.name, squads: entry.squads.flatMap(child => {
        const squadID = numberOrNull(child.squadID); return squadID === null ? [] : [{ squadID, name: child.name }];
      }) }];
    }),
  }));

  async function invite(form: boolean, place?: MemberMenuPlace): Promise<void> {
    if (blocked) return;
    const ids = [...eligible];
    if (ids.length === 0) return;
    busy = true;
    error = "";
    try {
      // The flow owns the captured selection through all callbacks and fences
      // it to this pilot even if this menu closes or another pilot is selected.
      await flow.inviteFleetSelection(ids, form, place);
      const state = store.fleet.get();
      if (state.actionError && !state.actionErrorSaid && !error) error = state.actionError;
      if (!disposed && !error) onDone();
    } catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (!disposed) busy = false; }
  }
  onMount(() => {
    flow.requestWords([FORM, INVITE, WING, SQUAD, COUNT, ...[1, 2, 3, 4].map(rankLabel)]);
    void flow.loadFleet(true).catch(cause => { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); });
  });
  onDestroy(() => { disposed = true; });
</script>

{#if error}<span role="alert">{error}</span>{/if}
{#if none && eligible.length > 0}
  <button type="button" class="minor" disabled={blocked} onclick={() => void invite(true)}>{word(FORM, "Form Fleet With")}</button>
{:else if ready && eligible.length > 0}
  {#if targets.length > 1}
    <button type="button" class="minor" disabled={blocked} onclick={() => void invite(false)}>{word(INVITE, "Invite to Fleet")}</button>
  {:else}
    <details class="fleet-invite-menu">
      <summary>{word(INVITE, "Invite to Fleet")}</summary>
      <div class="controls" aria-label="Fleet invitation placement">
        {#each placements as entry, i (i)}
          {#if entry.kind === "place"}
            <button type="button" class="minor" disabled={blocked} onclick={() => void invite(false, entry)}>{rank(entry)}</button>
          {:else}
            <span>{wing(entry)}:
              {#each entry.entries as child, j (j)}
                {#if child.kind === "place"}
                  <button type="button" class="minor" disabled={blocked} onclick={() => void invite(false, child)}>{rank(child)}</button>
                {:else}
                  <span>{squad(child)}:
                    {#each child.places as place, k (k)}<button type="button" class="minor" disabled={blocked} onclick={() => void invite(false, place)}>{rank(place)}</button>{/each}
                  </span>
                {/if}
              {/each}
            </span>
          {/if}
        {/each}
      </div>
    </details>
  {/if}
{/if}

<style>
  .fleet-invite-menu { max-width: 100%; }
  .fleet-invite-menu summary { cursor: pointer; }
</style>
