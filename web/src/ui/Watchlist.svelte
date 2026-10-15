<script lang="ts">
  // The fleet's watch list, as the client's WatchListPanel shows it (fleetWatchList.py): the pilot's watchlist in the
  // order its members were added, each by name; and its ship's shield, armour and hull where the ship is in the
  // pilot's ballpark (WatchListEntry.UpdateDamage, its ship by SlimItemFromCharID), with the ship's type beside it
  // (UpdateShipIcon, InBubble), and none where it is not. With nobody on it, the client's hint. Members are added and
  // taken off by the fleet's menu for a member (Contacts); the client opens this window on an add (AddFavorite, 676).
  // Not here yet: the window's own menu (colours, damage updates off, clearing), its two columns and dragging, the
  // broadcasts' icons, and the damage of a member out of the ballpark (OnFleetDamageStateChange, which EveJS never
  // sends).
  import type { AppFlow } from "../app/flow.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import { resolvedName } from "../store/names.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();
  // svelte-ignore state_referenced_locally
  const fleet = store.fleet;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const words = store.words;

  const WORDS = {
    caption: "UI/Fleet/WatchList",
    empty: "UI/Fleet/Watchlist/DropFleetMembers",
  } as const;

  function word(label: string, own: string): string {
    const template = $words.templates[label];
    return typeof template === "string" ? template : own;
  }

  const watched = $derived($fleet.watchlist ?? []);

  /** The member's ship as the pilot's ballpark has it, or none where it is not there (SlimItemFromCharID). */
  function shipOf(characterID: number) {
    const snapshot = $space.snapshot;
    if (snapshot === null || !snapshot.inSpace) return null;
    return snapshot.entities.find((entity) => entity.characterID === characterID && !entity.isSelf) ?? null;
  }

  $effect(() => {
    flow.requestWords(Object.values(WORDS));
  });
  $effect(() => {
    const refs: { kind: "character" | "type"; id: number }[] = watched.map((id) => ({ kind: "character" as const, id }));
    for (const id of watched) {
      const ship = shipOf(id);
      if (ship !== null && ship.typeID !== null) refs.push({ kind: "type", id: ship.typeID });
    }
    if (refs.length > 0) flow.requestNames(refs);
  });

  const percent = (ratio: number | null): string => (ratio === null ? "" : `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`);
</script>

<section class="watchlist" aria-label="{word(WORDS.caption, 'Watch List')} [{watched.length}]">
  <h3>{word(WORDS.caption, "Watch List")} [{watched.length}]</h3>
  {#if watched.length === 0}
    <p class="empty">{word(WORDS.empty, "Add fleet members to watch them here.")}</p>
  {:else}
    <ul>
      {#each watched as characterID (characterID)}
        {@const ship = shipOf(characterID)}
        <li data-character-id={characterID}>
          <span class="name">{resolvedName($names.resolved, "character", characterID, `Pilot ${characterID}`)}</span>
          {#if ship !== null}
            <span class="ship">{ship.typeID === null ? "" : resolvedName($names.resolved, "type", ship.typeID, "")}</span>
            <span class="gauges" title="shield {percent(ship.shieldRatio)}, armour {percent(ship.armorRatio)}, hull {percent(ship.hullRatio)}">
              {#each [ship.shieldRatio, ship.armorRatio, ship.hullRatio] as ratio, index (index)}
                <span class="gauge" data-part={["shield", "armor", "hull"][index]}><span class="fill" style:width={percent(ratio) || "0%"}></span></span>
              {/each}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .watchlist { display: flex; flex-direction: column; gap: 0.4rem; }
  h3 { margin: 0; font-size: 0.9rem; letter-spacing: 0.04em; text-transform: uppercase; }
  .empty { margin: 0; opacity: 0.75; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  li { display: flex; align-items: center; gap: 0.5rem; min-height: 24px; }
  .name { flex: 1 1 auto; }
  .ship { opacity: 0.75; font-size: 0.85rem; }
  .gauges { display: flex; flex-direction: column; gap: 2px; width: 78px; }
  .gauge { display: block; height: 4px; background: rgba(255, 255, 255, 0.12); }
  .fill { display: block; height: 100%; background: #6fa8dc; }
  .gauge[data-part="armor"] .fill { background: #c9c9c9; }
  .gauge[data-part="hull"] .fill { background: #d9a441; }
</style>
