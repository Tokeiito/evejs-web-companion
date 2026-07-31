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
  import {
    buildModuleRack,
    rackClickAction,
    rackDamageText,
    rackIsEmpty,
    rackModuleBurntOut,
    rackSlotTitle,
  } from "./moduleRack.ts";
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
    buildModuleRack(
      $fitting.slots,
      $space.snapshot?.ship?.activeModuleIDs ?? null,
      $space.snapshot?.ship?.overloadedModuleIDs ?? null,
      $space.snapshot?.ship?.moduleDamage ?? null,
      $space.snapshot?.ship?.weaponBanks ?? null,
    ),
  );
  /**
   * Damaged modules, worst first — the repair list.
   *
   * It sits under the rack rather than on the tiles because repairing is a
   * deliberate act that consumes paste, and because a burnt-out module is
   * something a player needs told, not something they should have to hover
   * every tile to discover.
   */
  const damagedModules = $derived(
    rows
      .flatMap((row) => row.slots)
      .map((slot) => slot.module)
      .filter((module): module is RackModule => module !== null && (module.damage ?? 0) > 0)
      .sort((left, right) => (right.damage ?? 0) - (left.damage ?? 0)),
  );
  const unknown = $derived(!$fitting.loaded || rackIsEmpty(rows));
  /** Every high-slot module — banking only ever applies to weapons. */
  const weaponsCount = $derived(
    (rows.find((row) => row.family === "high")?.slots ?? []).filter((slot) => slot.module !== null)
      .length,
  );
  /** How many modules are in a bank right now (masters and slaves alike). */
  const bankedCount = $derived(
    rows
      .flatMap((row) => row.slots)
      .filter((slot) => slot.module !== null && slot.module.bankSize > 1).length,
  );

  async function setBanks(linked: boolean): Promise<void> {
    if (!flow || pendingItemID !== null) {
      return;
    }
    error = "";
    windingDown = "";
    try {
      await flow.setWeaponBanks(linked);
      const refusal = $targeting.actionError ?? $targeting.silentDecline;
      if (refusal) {
        error = refusal;
      }
    } catch (cause) {
      error = String(cause);
    }
  }
  /** The auto target: first LOCKED (not still-acquiring) target, else none. */
  const autoTargetID = $derived($targeting.lockedTargetIDs[0] ?? 0);

  /** The module a click is in flight for — that one tile shimmers, the rest stay live. */
  let pendingItemID = $state<number | null>(null);
  /** The server's refusal for the LAST rack click, read from the authority slots. */
  let error = $state("");
  /**
   * A module told to stop that is still cycling. NOT an error: retail stops a
   * module at the end of its current cycle, so the tile stays lit for a few
   * seconds and the player deserves to know why rather than wondering whether
   * the click registered.
   */
  let windingDown = $state("");

  function moduleName(typeID: number): string {
    return resolvedName($names.resolved, "type", typeID);
  }

  /** The loaded charge's NAME, or null when there is none to name. */
  function chargeName(module: RackModule): string | null {
    return module.charge ? moduleName(module.charge.typeID) : null;
  }

  /**
   * SHIFT-CLICK TOGGLES OVERLOAD — the retail modifier, and deliberately behind
   * one: overloading damages the module, so it must not share the plain click
   * that fires it. An offline module is inert here too.
   */
  async function shiftClickModule(module: RackModule): Promise<void> {
    if (!flow || !module.online || module.overloaded === null || pendingItemID !== null) {
      return;
    }
    pendingItemID = module.itemID;
    error = "";
    windingDown = "";
    try {
      await flow.setModuleOverload(module.itemID, !module.overloaded);
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

  async function repair(module: RackModule): Promise<void> {
    if (!flow || pendingItemID !== null) {
      return;
    }
    pendingItemID = module.itemID;
    error = "";
    windingDown = "";
    try {
      await flow.repairModule(module.itemID);
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

  async function clickModule(module: RackModule): Promise<void> {
    const action = rackClickAction(module);
    if (!flow || !action || pendingItemID !== null) {
      return;
    }
    pendingItemID = module.itemID;
    error = "";
    windingDown = "";
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
      } else if (
        action === "deactivate" &&
        ($space.snapshot?.ship?.activeModuleIDs ?? []).includes(module.itemID)
      ) {
        // Told to stop, still cycling — retail stops at the end of the current
        // cycle. Say so, or the still-lit tile reads as a click that did nothing.
        windingDown = `${moduleName(module.typeID)} stops when its current cycle ends.`;
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
                class:overloaded={slot.module.overloaded === true}
                disabled={!clickable || pendingItemID !== null}
                aria-pressed={slot.module.active}
                title={rackSlotTitle(nm, slot.module, chargeName(slot.module))}
                aria-label={rackSlotTitle(nm, slot.module, chargeName(slot.module))}
                onclick={(event) =>
                  slot.module &&
                  (event.shiftKey ? shiftClickModule(slot.module) : clickModule(slot.module))}
              >
                <TypeIcon typeID={slot.module.typeID} name={nm} size="sm" fallbackText={abbreviate(nm)} />
                {#if slot.module.overloaded === true}
                  <!-- Words carry the state (the title); this is the glance. -->
                  <span class="module-heat" aria-hidden="true">🔥</span>
                {/if}
                {#if rackModuleBurntOut(slot.module)}
                  <span class="module-burnt" aria-hidden="true">✖</span>
                {/if}
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
  {#if weaponsCount > 1}
    <!--
      Banking makes one click fire every gun in the group. The control says
      which way it will go, because the whole point is that the racks look
      identical either way — the difference is what a click does.
    -->
    <div class="rack-banks">
      <span class="rack-banks-state">
        {bankedCount > 0
          ? `${bankedCount} weapon${bankedCount === 1 ? "" : "s"} banked`
          : "Weapons fire one at a time"}
      </span>
      {#if flow}
        <button
          type="button"
          class="minor"
          disabled={pendingItemID !== null}
          onclick={() => setBanks(bankedCount === 0)}
        >{bankedCount > 0 ? "Unlink weapons" : "Link weapons"}</button>
      {/if}
    </div>
  {/if}
  {#if damagedModules.length > 0}
    <!--
      Repairing consumes nanite paste, so it is a deliberate act with its own
      control rather than another modifier on the tile. A BURNT OUT module is
      called out in words: it will not run at all until it is repaired, and a
      player who does not know that will keep clicking a dead tile.
    -->
    <div class="rack-damage">
      <span class="rack-damage-head">Damaged</span>
      <ul class="rack-damage-list">
        {#each damagedModules as module (module.itemID)}
          {@const nm = moduleName(module.typeID)}
          <li>
            <span class="rack-damage-name" class:burnt={rackModuleBurntOut(module)}>
              {nm} — {rackModuleBurntOut(module) ? "burnt out" : `${rackDamageText(module)} damaged`}
            </span>
            {#if flow}
              <button
                type="button"
                class="minor"
                disabled={pendingItemID !== null}
                title={`Repair ${nm} with nanite paste`}
                onclick={() => repair(module)}
              >Repair</button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if error}
    <p class="rack-error" role="alert">{error}</p>
  {:else if windingDown}
    <!-- A NOTE, not an alert: the module is doing exactly as it was told. -->
    <p class="rack-note" aria-live="polite">{windingDown}</p>
  {/if}
</div>
