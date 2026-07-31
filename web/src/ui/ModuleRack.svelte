<script lang="ts">
  // The in-space HUD module rack — the ship's high / mid / low slots as EVE's
  // three activation racks, and now the place they are CLICKED: an idle module
  // activates, a cycling one deactivates, exactly the retail F-row. Reads the
  // fitting slots (same source as the Fitting window) and overlays the live
  // snapshot's active modules: a cycling module glows, an offline one is dimmed
  // and inert (onlining is a Fitting-window decision, not a rack misclick).
  //
  // TARGETED MODULES USE THE FIRST LOCKED TARGET. The rack cannot know which
  // modules need a target (no allowlisted read answers it), so every activation
  // carries the first locked target when one exists — the same auto convention
  // the Overview's action picker defaults to — and none when nothing is locked.
  // A module that needed one is refused by the SERVER with its own reason, and
  // that reason is what renders: the rack never pre-judges a click.
  //
  // THE GLOW IS NOT OPTIMISTIC. active comes from the snapshot's
  // activeModuleIDs, so a click changes the glow only when the next space poll
  // proves the server agrees. The pending shimmer between click and proof is
  // presentation, never a claim.
  import TypeIcon from "./TypeIcon.svelte";
  import { buildModuleRack, rackClickAction, rackIsEmpty, rackSlotTitle } from "./moduleRack.ts";
  import { abbreviate } from "./fittingIcons.ts";
  import { resolvedName } from "../store/names.ts";
  import type { RackModule } from "./moduleRack.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";

  let { store, flow = null }: {
    store: ClientStore;
    /**
     * Null renders the rack read-only (a mount with no live flow — tests,
     * embeddings). Every real mount passes the session's flow.
     */
    flow?: AppFlow | null;
  } = $props();

  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // svelte-ignore state_referenced_locally
  const targeting = store.targeting;

  const rows = $derived(
    buildModuleRack($fitting.slots, $space.snapshot?.ship?.activeModuleIDs ?? null),
  );
  const unknown = $derived(!$fitting.loaded || rackIsEmpty(rows));
  /** The auto target: first LOCKED (not still-acquiring) target, else none. */
  const autoTargetID = $derived($targeting.lockedTargetIDs[0] ?? 0);

  /** The module a click is in flight for — that one tile shimmers, the rest stay live. */
  let pendingItemID = $state<number | null>(null);
  /** The server's refusal for the LAST rack click, read from the authority slots. */
  let error = $state("");

  function moduleName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID);
  }

  async function clickModule(module: RackModule): Promise<void> {
    const action = rackClickAction(module);
    if (!flow || !action || pendingItemID !== null) {
      return;
    }
    pendingItemID = module.itemID;
    error = "";
    try {
      if (action === "deactivate") {
        // typeID rides along so the BFF can name a prop mod's effect — an
        // afterburner only stops when Deactivate says which effect to stop.
        await flow.deactivateModule(module.itemID, { typeID: module.typeID });
      } else {
        await flow.activateModule(module.itemID, {
          targetID: autoTargetID > 0 ? autoTargetID : null,
        });
      }
      // Read the AUTHORITY, not the resolved promise: the flow's targeting
      // wrapper swallows refusals into these two slots (Overview reads them the
      // same way), and a 200 with a silent decline is still not a success.
      const refusal = $targeting.actionError ?? $targeting.silentDecline;
      if (refusal) {
        error = `${moduleName(module.typeID)}: ${refusal}`;
      }
    } catch (cause) {
      error = `${moduleName(module.typeID)}: ${String(cause)}`;
    } finally {
      pendingItemID = null;
    }
  }
</script>

<div class="module-rack-rows" aria-label="Module rack">
  {#each rows as row (row.family)}
    <div class="rack-row">
      <span class="rack-row-label">{row.label}</span>
      <div class="rack-slots">
        {#if row.slots.length === 0}
          <span class="rack-empty muted">—</span>
        {:else}
          {#each row.slots as slot, i (i)}
            {#if slot.module}
              {@const nm = moduleName(slot.module.typeID)}
              {@const clickable = flow !== null && rackClickAction(slot.module) !== null}
              <button
                type="button"
                class="module-slot filled"
                class:active={slot.module.active}
                class:offline={!slot.module.online}
                class:pending={pendingItemID === slot.module.itemID}
                disabled={!clickable || pendingItemID !== null}
                aria-pressed={slot.module.active}
                title={rackSlotTitle(nm, slot.module)}
                aria-label={rackSlotTitle(nm, slot.module)}
                onclick={() => slot.module && clickModule(slot.module)}
              >
                <TypeIcon typeID={slot.module.typeID} name={nm} size="sm" fallbackText={abbreviate(nm)} />
              </button>
            {:else}
              <span class="module-slot empty" title={rackSlotTitle("", null)}></span>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  {/each}
  {#if unknown}
    <p class="rack-hint muted">Modules appear once your ship's fitting has loaded.</p>
  {/if}
  {#if error}
    <p class="rack-error" role="alert">{error}</p>
  {/if}
</div>
