<script lang="ts">
  // The locked-targets bracket (goal R71) — EVE's target cards.
  //
  // Each locked target is a ROUND card: the thing's own picture in the middle,
  // its shield / armor / hull wrapped around it as three concentric arcs, and its
  // name and distance beneath. That is the retail shape, and it is the same
  // instrument as the ship HUD turned on its target — which is exactly the point.
  // A pilot who has learnt to read their own rings can read an enemy's without
  // being taught twice, and "how close is it to breaking" becomes a glance rather
  // than three percentages to compare.
  //
  // The geometry is `shipHudArcs.ts`, shared with the ship HUD so the two can
  // never drift apart.
  //
  // ⚠ THE THREE HONEST STATES ARE KEPT APART. A target still being acquired says
  // "Locking…" and draws no rings, because there is nothing to report yet. A lock
  // whose object has left the snapshot says "No longer in view" — it is NOT
  // dropped from the list, because a bracket that silently vanishes reads as a
  // client glitch rather than as a target that warped off. Only a live, locked
  // target draws condition, and a layer with no reading shows a dash.
  import TypeIcon from "./TypeIcon.svelte";
  import { buildTargets, type TargetVM } from "./targetBracket.ts";
  import { gaugeArc, gaugeTrack } from "./shipHudArcs.ts";
  import { formatDistance } from "../space/overview.ts";
  import { spaceSelection } from "../space/selection.ts";
  import { resolvedName } from "../store/names.ts";
  import { abbreviate } from "./fittingIcons.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store }: { store: ClientStore } = $props();

  // svelte-ignore state_referenced_locally
  const targeting = store.targeting;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  const selected = spaceSelection.selected;

  const targets = $derived(
    buildTargets(
      $targeting.lockedTargetIDs,
      $targeting.acquiringTargetIDs,
      $space.snapshot?.entities ?? null,
      $space.snapshot?.ship?.position ?? null,
    ),
  );

  // A 100x100 viewBox, as the ship HUD uses — every radius is a percentage, so
  // the card scales with its container and nothing is expressed in pixels.
  const CX = 50;
  const CY = 50;
  const RADII = { shield: 46, armor: 39, hull: 32 } as const;
  const LAYERS = [
    { key: "shield", label: "Shield" },
    { key: "armor", label: "Armor" },
    { key: "hull", label: "Hull" },
  ] as const;

  function targetName(target: TargetVM): string {
    if (!target.inView) {
      return "No longer in view";
    }
    return target.entityName ?? resolvedName($names.resolved, "type", target.typeID);
  }

  function ratioFor(target: TargetVM, key: (typeof LAYERS)[number]["key"]): number | null {
    return key === "shield" ? target.shield : key === "armor" ? target.armor : target.hull;
  }

  function pct(ratio: number | null): string {
    return ratio != null ? `${Math.round(ratio * 100)}%` : "—";
  }

  /** One sentence per card, so a screen reader is not handed three bare arcs. */
  function cardLabel(target: TargetVM): string {
    const name = targetName(target);
    if (target.acquiring) {
      return `${name} — locking`;
    }
    if (!target.inView) {
      return `${name} — the lock is lost`;
    }
    const condition = LAYERS.map((layer) => `${layer.label} ${pct(ratioFor(target, layer.key))}`).join(", ");
    const range = target.distance != null ? `, ${formatDistance(target.distance)} away` : "";
    return `${name} — ${condition}${range}. Select.`;
  }
</script>

{#if targets.length > 0}
  <div class="target-bracket" aria-label="Locked targets">
    {#each targets as target (target.itemID)}
      {@const name = targetName(target)}
      <!--
        A card is a BUTTON: picking a target here selects it everywhere — the
        tactical viewport rings the same bracket and the overview's verb bar
        points at it. One selection, three surfaces (space/selection.ts).
      -->
      <button
        type="button"
        class="target-card"
        class:acquiring={target.acquiring}
        class:lost={!target.inView}
        class:picked={$selected === target.itemID}
        aria-pressed={$selected === target.itemID}
        aria-label={cardLabel(target)}
        title={cardLabel(target)}
        onclick={() => spaceSelection.toggle(target.itemID)}
      >
        <span class="target-dial">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            {#each LAYERS as layer (layer.key)}
              <path class="dial-track" d={gaugeTrack(CX, CY, RADII[layer.key])} />
            {/each}
            {#if !target.acquiring && target.inView}
              {#each LAYERS as layer (layer.key)}
                {@const d = gaugeArc(ratioFor(target, layer.key), CX, CY, RADII[layer.key])}
                {#if d}
                  <path class={`dial-fill ${layer.key}`} {d} />
                {/if}
              {/each}
            {/if}
          </svg>
          <span class="target-portrait">
            {#if target.inView && target.typeID !== null}
              <TypeIcon typeID={target.typeID} {name} size="sm" fallbackText={abbreviate(name)} />
            {/if}
          </span>
        </span>

        <span class="target-name">{name}</span>
        {#if target.acquiring}
          <span class="target-locking">Locking…</span>
        {:else if target.inView}
          <!-- The numbers, as text: the rings are the fast read, never the only
               one, and this is what makes the card legible with no colour
               perception at all. -->
          <span class="target-figures">
            {#each LAYERS as layer (layer.key)}
              <span class={`target-figure ${layer.key}`}>{pct(ratioFor(target, layer.key))}</span>
            {/each}
          </span>
          <span class="target-range">
            {target.distance != null ? formatDistance(target.distance) : "—"}
          </span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
