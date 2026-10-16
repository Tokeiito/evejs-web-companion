<script lang="ts">
  // The client's Ship Restrictions window (evedungeons/client/ship_restrictions_window.py ShipRestrictionsWindow), opened
  // on an acceleration gate's refusal of the ship in a dungeon the client knows (bridge/dungeonTracking.ts):
  //
  //   captioned UI/Dungeons/ShipRestrictionsWindow; headed with the dungeon's name (its dungeonNameID's message); a line
  //   saying the ship flown is or is not let through (DungeonShipRestrictionsListShipIsRestricted / IsNotRestricted, or
  //   ShowList with no ship); the box "Hide restricted ships" (ship_restrictions_hide_restricted_ships, on where none is
  //   kept); and the ship types let through, by group, each group with how many of its types are shown, as a fraction
  //   of the group's where some are restricted (_get_group_secondary_text). Unticked, the restricted types of those
  //   groups are shown too, in the danger colour (ShipTypeEntry).
  //
  // Not yet as the client has it: the groups are the inventory groups, by name, where the client's are its ship tree's
  // (evetypes.GetShipGroupID, SHIP_GROUP_ORDER); the box "Show unlocked ships only" (the pilot's skills per type); and
  // the gate's type list's own description, which the server's tables do not carry.
  import { formatTemplate, plainText } from "../bridge/clientWords.ts";
  import { SHIP_RESTRICTIONS_LABELS } from "../bridge/dungeonTracking.ts";
  import { resolvedName } from "../store/names.ts";
  import TypeIcon from "./TypeIcon.svelte";
  import type { Session } from "../app/sessions.ts";

  let { session, inFront }: { session: Session; inFront: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const flow = session.flow;
  // svelte-ignore state_referenced_locally
  const words = session.store.words;
  // svelte-ignore state_referenced_locally
  const names = session.store.names;
  // svelte-ignore state_referenced_locally
  const flight = session.store.flight;
  // svelte-ignore state_referenced_locally
  const open = flow.shipRestrictions;

  /** ship_restrictions_hide_restricted_ships (UserSettingBool, True where none is kept), kept in this browser. */
  const HIDE_KEPT = "evejs.ship_restrictions_hide_restricted_ships";
  let hideRestricted = $state((() => {
    try {
      return localStorage.getItem(HIDE_KEPT) !== "false";
    } catch {
      return true;
    }
  })());
  function setHideRestricted(value: boolean): void {
    hideRestricted = value;
    try {
      localStorage.setItem(HIDE_KEPT, String(value));
    } catch {
      // Storage refused: the box holds while the window is open.
    }
  }

  const nameOf = (kind: Parameters<typeof resolvedName>[1], id: number): string => resolvedName($names.resolved, kind, id, "");
  function word(label: string, args: Record<string, string | number> = {}): string {
    const template = $words.templates[label];
    return typeof template === "string" ? plainText(formatTemplate(template, args, { nameOf })) : "";
  }

  const restrictions = $derived($open?.restrictions ?? null);
  const shipTypeID = $derived($flight.status?.shipTypeID ?? null);
  const header = $derived(restrictions?.dungeonNameID ? word(`#${restrictions.dungeonNameID}`) : "");
  const infoText = $derived.by(() => {
    if (!restrictions || restrictions.allowed.length === 0) return "No ship restrictions found";
    if (shipTypeID === null) return word(SHIP_RESTRICTIONS_LABELS.showList);
    const allowedHere = restrictions.allowed.some((entry) => entry.typeID === shipTypeID);
    return word(allowedHere ? SHIP_RESTRICTIONS_LABELS.notRestricted : SHIP_RESTRICTIONS_LABELS.restricted, { shipTypeID });
  });
  const groups = $derived.by(() => {
    if (!restrictions) return [];
    const byGroup = new Map<number, { allowed: number[]; restricted: number[] }>();
    for (const entry of restrictions.allowed) {
      const group = byGroup.get(entry.groupID) ?? { allowed: [], restricted: [] };
      group.allowed.push(entry.typeID);
      byGroup.set(entry.groupID, group);
    }
    for (const entry of restrictions.restricted) {
      const group = byGroup.get(entry.groupID);
      if (group) group.restricted.push(entry.typeID);
    }
    const byName = (a: number, b: number) => nameOf("type", a).localeCompare(nameOf("type", b));
    return [...byGroup.entries()]
      .map(([groupID, group]) => {
        const shown = hideRestricted ? group.allowed : [...group.allowed, ...group.restricted];
        const total = group.allowed.length + group.restricted.length;
        return {
          groupID,
          name: nameOf("group", groupID),
          count: shown.length === total ? String(shown.length) : word("UI/Common/Formatting/Fraction", { a: shown.length, b: total }) || `${shown.length}/${total}`,
          types: [...shown].sort(byName).map((typeID) => ({ typeID, restricted: !group.allowed.includes(typeID) })),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  $effect(() => {
    if ($open === null) return;
    flow.requestWords([...Object.values(SHIP_RESTRICTIONS_LABELS), "UI/Common/Formatting/Fraction"]);
  });
  $effect(() => {
    if (restrictions === null) return;
    if (restrictions.dungeonNameID) flow.requestWords([`#${restrictions.dungeonNameID}`]);
    const groupIDs = [...new Set([...restrictions.allowed, ...restrictions.restricted].map((entry) => entry.groupID))];
    flow.requestNames([
      ...groupIDs.map((id) => ({ kind: "group" as const, id })),
      ...[...restrictions.allowed, ...restrictions.restricted].map((entry) => ({ kind: "type" as const, id: entry.typeID })),
      ...(shipTypeID !== null ? [{ kind: "type" as const, id: shipTypeID }] : []),
    ]);
  });
</script>

{#if $open !== null && inFront}
  <section class="ship-restrictions" aria-label={word(SHIP_RESTRICTIONS_LABELS.caption) || "Ship Restrictions"}>
    <header class="sr-head">
      <h3>{word(SHIP_RESTRICTIONS_LABELS.caption) || "Ship Restrictions"}</h3>
      <button type="button" class="sr-close" aria-label="Close" onclick={() => flow.closeShipRestrictions()}>×</button>
    </header>
    {#if !$open.loaded}
      <p class="sr-note">…</p>
    {:else}
      {#if header}<h4 class="sr-dungeon">{header}</h4>{/if}
      <p class="sr-info">{infoText}</p>
      <label class="sr-box">
        <input type="checkbox" checked={hideRestricted} onchange={(event) => setHideRestricted((event.currentTarget as HTMLInputElement).checked)} />
        {word(SHIP_RESTRICTIONS_LABELS.hideRestricted) || "Hide restricted ships"}
      </label>
      <div class="sr-list">
        {#each groups as group (group.groupID)}
          <div class="sr-group">
            <p class="sr-group-head"><span>{group.name}</span><span class="sr-count">{group.count}</span></p>
            <ul>
              {#each group.types as type (type.typeID)}
                <li class:sr-restricted={type.restricted}>
                  <TypeIcon typeID={type.typeID} name={nameOf("type", type.typeID)} size="sm" />
                  <span>{nameOf("type", type.typeID)}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .ship-restrictions {
    position: fixed;
    right: 16px;
    top: 72px;
    width: min(380px, calc(100vw - 32px));
    max-height: calc(100vh - 120px);
    display: grid;
    grid-template-rows: auto auto auto auto 1fr;
    gap: 8px;
    padding: 10px 12px;
    background: var(--panel-bg, #11161c);
    border: 1px solid var(--line, #2b3540);
    z-index: 60;
  }
  .sr-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sr-head h3,
  .sr-dungeon {
    margin: 0;
    font-size: 0.95rem;
  }
  .sr-close {
    background: none;
    border: none;
    color: inherit;
    font-size: 1.1rem;
    cursor: pointer;
  }
  .sr-info,
  .sr-note {
    margin: 0;
  }
  .sr-list {
    overflow-y: auto;
  }
  .sr-group-head {
    display: flex;
    justify-content: space-between;
    margin: 6px 0 2px;
    font-weight: 600;
  }
  .sr-count {
    opacity: 0.7;
  }
  .sr-group ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .sr-group li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  .sr-restricted {
    color: var(--color-danger, #e08a8a);
  }
</style>
