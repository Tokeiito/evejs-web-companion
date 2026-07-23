<script lang="ts">
  // The locked-targets bracket across the top of the space view — EVE's target
  // brackets. Each locked target shows its name + shield/armor/hull condition
  // from the live snapshot; a still-acquiring lock reads "Locking…"; a lock that
  // left grid reads "No longer in view". Renders nothing when nothing is locked.
  import { buildTargets, type TargetVM } from "./targetBracket.ts";
  import { resolvedName } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";

  let { store }: { store: ClientStore } = $props();

  // svelte-ignore state_referenced_locally
  const targeting = store.targeting;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const names = store.names;

  const targets = $derived(
    buildTargets(
      $targeting.lockedTargetIDs,
      $targeting.acquiringTargetIDs,
      $space.snapshot?.entities ?? null,
    ),
  );

  function targetName(t: TargetVM): string {
    if (!t.inView) return "No longer in view";
    return t.entityName ?? resolvedName($names.resolved, "type", t.typeID);
  }
  function pct(ratio: number | null): number | null {
    return ratio != null ? Math.round(ratio * 100) : null;
  }
  const CONDITION = [
    { cls: "shield", label: "S" },
    { cls: "armor", label: "A" },
    { cls: "hull", label: "H" },
  ] as const;
  function ratioFor(t: TargetVM, cls: string): number | null {
    return cls === "shield" ? t.shield : cls === "armor" ? t.armor : t.hull;
  }
</script>

{#if targets.length > 0}
  <div class="target-bracket" aria-label="Locked targets">
    {#each targets as t (t.itemID)}
      <div class="target-card" class:acquiring={t.acquiring} class:lost={!t.inView}>
        <span class="target-name">{targetName(t)}</span>
        {#if t.acquiring}
          <span class="target-locking">Locking…</span>
        {:else if t.inView}
          <div class="target-condition">
            {#each CONDITION as c (c.cls)}
              {@const v = pct(ratioFor(t, c.cls))}
              <div class="hud-gauge {c.cls}">
                <div class="hud-head">
                  <span class="hud-label">{c.label}</span>
                  <span class="hud-value">{v != null ? `${v}%` : "—"}</span>
                </div>
                <div class="hud-track">
                  {#if v != null}<span class="hud-fill" style={`width:${v}%`}></span>{/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
