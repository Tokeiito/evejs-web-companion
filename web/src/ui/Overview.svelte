<script lang="ts">
  // Overview + ship condition (goal R11). What is around the ship, by name,
  // with a distance you can sort and filter on, and Warp to / Approach on every
  // row — so a player can finally fly to anything they can see.
  //
  // A pure reader of the store's space slice. The snapshot comes from the flow
  // (~1s poll while in space); the distance, ordering and filtering are computed
  // here in the browser from the reported positions, exactly the way the real
  // client does it. Movement always goes through the existing atomic moves.
  import { onMount } from "svelte";
  import { BridgeCallError } from "../bridge/callMethod.ts";
  import { isSessionLost } from "../app/flow.ts";
  import { egoPosition } from "../bridge/space.ts";
  import {
    buildOverviewRows,
    formatDistance,
    healthIsDropping,
    hostileLabel,
    hostileRows,
    isHostile,
    newlyArrivedHostiles,
    overviewFilterIDs,
    ratioPercent,
    type OverviewRow,
    type OverviewSort,
  } from "../space/overview.ts";
  import { droneActivityLabel, droneIsBusy } from "../bridge/drones.ts";
  // R30 slice A — what a stargate row could never say: which system is through
  // it. Read from the route graph the autopilot already caches.
  import { gateLinkFor } from "../space/gateLinks.ts";
  // R30 slice D — the verbs for the thing you picked, decided as DATA in a pure
  // module rather than as a wall of {#if} blocks inside the grid's last column.
  import {
    actionsForRow,
    SELECTION_GONE,
    type RowAction,
  } from "../space/rowActions.ts";
  import MiningBot from "./MiningBot.svelte";
  // R27 — the shared item icon: one cached picture per thing, falling back
  // to a name-derived tile whenever the icon cache has no entry (or no cache).
  import TypeIcon from "./TypeIcon.svelte";
  import { resolvedName, nameKey, type NameRef } from "../store/names.ts";
  import type { ClientStore } from "../store/clientStore.ts";
  import type { AppFlow } from "../app/flow.ts";
  import type { ModuleCycle, SpaceEntity } from "../store/types.ts";

  let { store, flow }: { store: ClientStore; flow: AppFlow } = $props();

  // svelte-ignore state_referenced_locally
  const space = store.space;
  // svelte-ignore state_referenced_locally
  const flight = store.flight;
  // svelte-ignore state_referenced_locally
  const names = store.names;
  // R23 slice A — the GENERIC in-space action layer: what is locked, and which
  // modules are running. Nothing here is mining-specific; the same two sections
  // serve a turret exactly as they serve a mining laser.
  // svelte-ignore state_referenced_locally
  const targeting = store.targeting;
  // svelte-ignore state_referenced_locally
  const fitting = store.fitting;
  // R23 slice B — the survey scanner. The scan is the only read that says how
  // much ore a rock has left when the snapshot could not; it is MERGED into the
  // rows here, never used to compute anything.
  // svelte-ignore state_referenced_locally
  const mining = store.mining;
  // R25 slice A — drones. The bay, what is in space, and the two limits the
  // server enforces on a launch.
  // svelte-ignore state_referenced_locally
  const drones = store.drones;
  // R30 slice C — the two things that fly the ship for you. Read ONLY so the
  // flight strip can quote what they say about themselves; this panel never
  // writes to either and never invents narration on their behalf.
  // svelte-ignore state_referenced_locally
  const bot = store.bot;
  // svelte-ignore state_referenced_locally
  const travel = store.travel;

  // How many rows we render. A busy grid can hold hundreds of objects and the
  // list re-renders every second, so the nearest few hundred is the useful set.
  const ROW_CAP = 200;

  // R13 flight ranges. Every one of these is a DISTANCE the player picks once
  // and then applies to any row, which is how the retail right-click submenus
  // work — putting a set of range pickers on all 200 rows would be unusable.
  // Labels are written out rather than formatted so a fixed menu reads as
  // "10 km", never "10.0 km" and never a raw metre count.
  interface RangeChoice {
    readonly metres: number;
    readonly label: string;
  }
  // Retail's warp-range menu, and retail's own default: right on top, not 10 km.
  const WARP_RANGES: readonly RangeChoice[] = [
    { metres: 0, label: "As close as it can" },
    { metres: 10000, label: "10 km" },
    { metres: 20000, label: "20 km" },
    { metres: 30000, label: "30 km" },
    { metres: 50000, label: "50 km" },
    { metres: 70000, label: "70 km" },
    { metres: 100000, label: "100 km" },
  ];
  // Orbit / hold distances, defaulting to retail's 1000 m.
  const HOLD_RANGES: readonly RangeChoice[] = [
    { metres: 500, label: "500 m" },
    { metres: 1000, label: "1 km" },
    { metres: 2500, label: "2.5 km" },
    { metres: 5000, label: "5 km" },
    { metres: 10000, label: "10 km" },
    { metres: 20000, label: "20 km" },
    { metres: 30000, label: "30 km" },
  ];

  let busy = $state(false);
  let error = $state("");
  let search = $state("");
  let sort = $state<OverviewSort>("distance");
  let categoryFilter = $state("");
  let groupFilter = $state("");
  let warpRange = $state("0");
  let orbitRange = $state("1000");
  let holdRange = $state("1000");

  const snapshot = $derived($space.snapshot);
  const inSpace = $derived(snapshot?.inSpace === true || $flight.status?.inSpace === true);
  const origin = $derived(egoPosition(snapshot));

  // R30 slice A — the stargates on this grid and where they lead.
  //
  // WHY THIS EXISTS: a gate was a row like any other. You could warp to it and
  // approach it, but the moment your destination was in the next system the
  // panel had nothing more to offer and you had to leave for the Flight tab and
  // type two raw gate IDs by hand. The graph that answers "which system is
  // through this gate" was already in the browser, cached by the autopilot.
  //
  // The links arrive WITH the snapshot, through the space slice, and this panel
  // stays what it has always been: a pure reader.
  //
  // It was originally a component-local `$state` filled by an `$effect` that
  // awaited `flow.nearbyGates`, and that DID NOT WORK — the write landed (the
  // effect could read all seven links back immediately afterwards) but the
  // template never saw it, on the same component instance. A synchronous write
  // in the same effect rendered fine; every asynchronous one was invisible.
  // Rather than keep guessing at the framework, the links now travel the exact
  // path the rest of this panel's data travels — the store, re-rendered every
  // second — which is the mechanism the whole app already depends on.
  //
  // It is also the better design: the links are computed from the SAME snapshot
  // that produced the rows, so a gate can never be labelled with a destination
  // worked out for a different system than the grid it is sitting on.
  const gateLinks = $derived($space.gateLinks);
  const gateLinksError = $derived($space.gateLinksError);

  // --- R30 slice C: the flight strip ---------------------------------------
  //
  // Three lines, and each answers a question the player previously had to leave
  // this tab to ask: WHERE am I, what is happening, and what went wrong. The
  // "where" line in particular did not exist anywhere on this page — Overview
  // never showed location at all, which is a large part of why setting a
  // destination meant a trip to another tab and back.

  /**
   * WHERE. Assembled only from what the flight slice actually reported; every
   * part that is unknown is simply left out rather than filled with a guess or
   * a placeholder. Names only, never an id (R7d).
   */
  const whereText = $derived.by(() => {
    const status = $flight.status;
    if (!status) {
      return "Finding out where you are…";
    }
    const parts: string[] = [];
    if (status.inSpace) {
      parts.push(`In space${$flight.solarSystemName ? ` · ${$flight.solarSystemName}` : ""}`);
    } else if (status.stationID !== null) {
      parts.push(`Docked at ${$flight.stationName ?? "the station"}`);
    } else if (status.structureID !== null) {
      parts.push(`Docked at ${$flight.structureName ?? "a structure"}`);
    } else {
      parts.push("Docked");
    }
    // The active ship, by TYPE name, from the snapshot that is already on
    // screen. Docked there is no snapshot, so the ship is simply not named.
    const shipTypeID = snapshot?.ship?.typeID ?? null;
    if (shipTypeID !== null) {
      const name = resolvedName($names.resolved, "type", shipTypeID, "");
      if (name.length > 0) {
        parts.push(name);
      }
    }
    return parts.join(" · ");
  });

  /**
   * DOING — and ONLY when something is genuinely driving the ship.
   *
   * ⚠ This is passed straight through from the bot's or the autopilot's own
   * `{phase, action, why}`. It is NEVER synthesized. Hand-flying produces no
   * narration at all, because there is no authority to quote: inventing one
   * ("Approaching…", "Idle") would make a sentence the browser guessed
   * indistinguishable from a sentence the loop actually reported, which is
   * exactly the line `cycleProgressPercent` already refuses to cross.
   */
  const doingText = $derived.by(() => {
    // The mining bot first: when it is running it is the thing flying the ship.
    if ($bot.status === "running" || $bot.status === "paused") {
      const said = [$bot.phase, $bot.action, $bot.why].filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      );
      return said.length > 0 ? said.join(" · ") : null;
    }
    if ($travel.status === "running") {
      const said = [$travel.phase, $travel.action].filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      );
      return said.length > 0 ? said.join(" · ") : null;
    }
    return null;
  });

  /**
   * WRONG. The first reason any of the four sources is currently carrying, so a
   * refusal is visible from the cockpit instead of only on the tab that owns it.
   * Each source keeps rendering its own error where it happens; this is a
   * summary, not a replacement.
   */
  const wrongText = $derived(
    $flight.actionError ?? $travel.failureReason ?? $bot.failureReason ?? $targeting.actionError ?? null,
  );

  const docked = $derived($flight.status !== null && !$flight.status.inSpace);

  /**
   * Per-concern busy tracking.
   *
   * ⚠ DO NOT CLEAN THIS UP INTO A SINGLE `busy` FLAG. The whole reason it is a
   * SET is that one shared flag greys out every control whenever any one of
   * them is in flight — including Stop, in the middle of a fight, because a
   * lock request happened to be pending. A control may only be disabled by its
   * OWN concern being busy.
   */
  type Concern = "move" | "lock" | "module" | "drone" | "hold" | "route";
  let busyConcerns = $state<readonly Concern[]>([]);
  /**
   * And the other half of the same rule: a failure is remembered PER CONCERN so
   * it can be drawn next to the control that caused it. One shared error string
   * at the top of the panel makes a refused lock and a refused warp look like
   * the same event, and puts both of them a screen away from the button that
   * was pressed.
   */
  let concernErrors = $state<Partial<Record<Concern, string>>>({});
  function concernBusy(concern: Concern): boolean {
    return busyConcerns.includes(concern);
  }
  async function runFor(concern: Concern, action: () => Promise<void>): Promise<void> {
    if (concernBusy(concern)) {
      return;
    }
    busyConcerns = [...busyConcerns, concern];
    const message = await carry(action);
    concernErrors = { ...concernErrors, [concern]: message };
    busyConcerns = busyConcerns.filter((entry) => entry !== concern);
  }

  /**
   * Run something with NO busy guard at all.
   *
   * ⚠ This exists for Stop and nothing else, and it is the other half of the
   * "Stop is never disabled" rule. Leaving the button enabled but dropping the
   * click because a concern was already in flight would be the same failure
   * wearing a friendlier face: the player presses Stop, the ship keeps going,
   * and nothing says why. Re-issuing Stop is harmless — it means the same thing
   * every time.
   */
  async function runUnguarded(action: () => Promise<void>): Promise<void> {
    error = await carry(action);
  }

  /** Runs it, and hands back the words to show — "" when nothing went wrong. */
  async function carry(action: () => Promise<void>): Promise<string> {
    error = "";
    try {
      await action();
      return "";
    } catch (cause) {
      if (isSessionLost(cause)) {
        return "The live session ended (idle timeout or another client took over).";
      }
      return cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
    }
  }

  // Every name this panel shows resolves through the shared name cache: a TYPE
  // name and its GROUP / CATEGORY names, all keyed off the object's typeID.
  // Nothing numeric is ever rendered (R7d).
  function typeName(entity: { typeID: number | null }): string {
    return resolvedName($names.resolved, "type", entity.typeID, "—");
  }
  function groupName(entity: { typeID: number | null }): string {
    return resolvedName($names.resolved, "typeGroup", entity.typeID, "—");
  }
  function categoryName(typeID: number | null): string {
    return resolvedName($names.resolved, "typeCategory", typeID, "—");
  }

  // An object's display name: its own name where it has one (celestials and
  // stations are named), otherwise what kind of thing it is.
  function displayLabel(entity: SpaceEntity): string {
    if (entity.name && entity.name.length > 0) {
      return entity.name;
    }
    const type = resolvedName($names.resolved, "type", entity.typeID, "");
    return type.length > 0 ? type : "Unknown object";
  }

  // Ask the cache for every name the current snapshot needs, in one batch.
  $effect(() => {
    const refs: NameRef[] = [];
    for (const entity of snapshot?.entities ?? []) {
      if (entity.typeID !== null) {
        refs.push({ kind: "type", id: entity.typeID });
        refs.push({ kind: "typeGroup", id: entity.typeID });
        refs.push({ kind: "typeCategory", id: entity.typeID });
      }
    }
    const shipTypeID = snapshot?.ship?.typeID ?? null;
    if (shipTypeID !== null) {
      refs.push({ kind: "type", id: shipTypeID });
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // The category / group choices actually present around the ship. Each is
  // offered by NAME, using a representative object's typeID to resolve it; a
  // choice whose name has not resolved yet is simply not offered yet.
  interface FilterChoice {
    readonly id: number;
    readonly label: string;
  }

  const filterChoices = $derived.by<{
    categories: FilterChoice[];
    groups: FilterChoice[];
  }>(() => {
    const { categoryIDs, groupIDs } = overviewFilterIDs(snapshot);
    const categoryType = new Map<number, number>();
    const groupType = new Map<number, number>();
    for (const entity of snapshot?.entities ?? []) {
      if (entity.isSelf || entity.typeID === null) {
        continue;
      }
      if (entity.categoryID !== null && !categoryType.has(entity.categoryID)) {
        categoryType.set(entity.categoryID, entity.typeID);
      }
      if (entity.groupID !== null && !groupType.has(entity.groupID)) {
        groupType.set(entity.groupID, entity.typeID);
      }
    }
    const build = (ids: readonly number[], source: Map<number, number>, kind: "typeCategory" | "typeGroup"): FilterChoice[] =>
      ids
        .map((id) => ({
          id,
          label: resolvedName($names.resolved, kind, source.get(id) ?? null, ""),
        }))
        .filter((choice) => choice.label.length > 0)
        .sort((left, right) => left.label.localeCompare(right.label));
    return {
      categories: build(categoryIDs, categoryType, "typeCategory"),
      groups: build(groupIDs, groupType, "typeGroup"),
    };
  });

  // The rendered list: filtered, distance-sorted and capped, all client-side.
  const overview = $derived.by(() =>
    buildOverviewRows(snapshot, origin, {
      sort,
      cap: ROW_CAP,
      filter: {
        text: search,
        categoryID: categoryFilter === "" ? null : Number(categoryFilter),
        groupID: groupFilter === "" ? null : Number(groupFilter),
      },
      // Text search matches what the player sees, so it searches the resolved
      // type and group names too — not just the object's own name.
      names: (entity) => ({
        typeName: $names.resolved[nameKey("type", entity.typeID ?? 0)] ?? null,
        groupName: $names.resolved[nameKey("typeGroup", entity.typeID ?? 0)] ?? null,
      }),
    }),
  );

  /**
   * R30 slice A — the rows the table iterates, each carrying its own gate link
   * (null for everything that is not a stargate).
   *
   * The link is folded into the ROW rather than looked up inside the loop. That
   * is not a style choice: a `{@const}` at the top of the keyed `{#each}`, and
   * even a lookup in an `{#if}` condition, both kept the `null` they were first
   * rendered with when the gate links arrived asynchronously a moment later —
   * the store held all seven correct links and not one button appeared. Folding
   * them in here means the links are part of the item identity, so the rows the
   * each block receives are genuinely new and cannot render a stale answer.
   * Cost is one shallow copy per visible row per poll, which is nothing.
   */
  const gateRows = $derived(
    overview.rows.map((row) => ({
      ...row,
      gateLink: gateLinkFor(gateLinks, row.itemID),
    })),
  );

  // --- R30 slice D: one selection, one bar of verbs ------------------------
  //
  // The grid's last column used to hold up to nine buttons on every one of up
  // to 200 rows. It is now a single Select, and the verbs act on what you
  // picked — which is both how the retail client works and the only version of
  // this that fits on a phone.

  let selectedID = $state<number | null>(null);
  /**
   * ⚠ SELECTION NEVER SILENTLY RETARGETS.
   *
   * `selectedRow` is looked up in the CURRENT rows every time. It deliberately
   * does not keep a copy of the row it was given when the player clicked: a
   * rock gets mined out, a ship warps off, and a bar still holding the old row
   * would keep offering verbs for something that is not there — or, worse, a
   * bar that fell back to "the first row" would quietly point Warp to at a
   * different destination than the one the player is looking at.
   */
  const selectedRow = $derived(
    selectedID === null ? null : (gateRows.find((row) => row.itemID === selectedID) ?? null),
  );
  /** Said in words when the thing you picked leaves the snapshot. */
  let selectionNotice = $state("");

  function selectRow(itemID: number): void {
    selectedID = selectedID === itemID ? null : itemID;
    selectionNotice = "";
    // A fresh pick starts with a clean slate: the refusal from the last thing
    // you acted on is not a fact about this one.
    concernErrors = {};
  }

  /**
   * The moment the selection stops existing, say so and let it go.
   *
   * Guarded on being in space with a LOADED snapshot: docking legitimately
   * empties the grid, and a poll that has not answered yet is not evidence that
   * anything vanished. Announcing on either would cry wolf.
   */
  $effect(() => {
    if (selectedID === null || !inSpace || !$space.loaded) {
      return;
    }
    const stillThere = (snapshot?.entities ?? []).some((entity) => entity.itemID === selectedID);
    if (!stillThere) {
      selectionNotice = SELECTION_GONE;
      selectedID = null;
    }
  });

  /** The verbs on offer for the current selection. Empty when nothing is picked. */
  const selectionActions = $derived.by<readonly RowAction[]>(() => {
    const row = selectedRow;
    if (!row) {
      return [];
    }
    return actionsForRow({
      kind: row.kind,
      locked: isLocked(row.itemID),
      acquiring: isAcquiring(row.itemID),
      gateLink: row.gateLink,
    });
  });

  /**
   * The ONE place a selection-bar verb turns into a server call.
   *
   * Every branch goes through `runFor`, so each verb is disabled only by its
   * own concern and its failure lands on its own control. An action carrying an
   * `unavailable` reason is never dispatched — the button is already disabled
   * and wearing that sentence, and this is the belt to that pair of braces.
   */
  async function runRowAction(action: RowAction): Promise<void> {
    const row = selectedRow;
    if (!row || action.unavailable !== null) {
      return;
    }
    await runFor(action.concern, async () => {
      switch (action.id) {
        case "warp":
          await flow.warpTo(row.itemID, Number(warpRange));
          return;
        case "approach":
          await flow.approach(row.itemID);
          return;
        case "orbit":
          await flow.orbit(row.itemID, Number(orbitRange));
          return;
        case "keepAtRange":
          await flow.keepAtRange(row.itemID, Number(holdRange));
          return;
        case "align":
          await flow.alignTo(row.itemID);
          return;
        // R24 slice B — the LADDER (close the distance, then dock), never the
        // raw single command, which fails unless the ship is already in range.
        case "dock":
          await flow.dockAt(row.itemID);
          return;
        case "jump": {
          const link = row.gateLink;
          if (link) {
            await flow.jump(row.itemID, link.destinationGateID);
          }
          return;
        }
        case "lock":
          await flow.lockTarget(row.itemID);
          return;
        case "unlock":
          await flow.unlockTarget(row.itemID);
          return;
      }
    });
  }

  const ship = $derived(snapshot?.ship ?? null);

  interface Gauge {
    readonly key: string;
    readonly label: string;
    readonly percent: number | null;
  }

  const gauges = $derived.by<Gauge[]>(() => [
    { key: "shield", label: "Shield", percent: ratioPercent(ship?.shieldRatio) },
    { key: "armor", label: "Armor", percent: ratioPercent(ship?.armorRatio) },
    { key: "hull", label: "Hull", percent: ratioPercent(ship?.hullRatio) },
    { key: "capacitor", label: "Capacitor", percent: ratioPercent(ship?.capacitorRatio) },
  ]);

  function shipLabel(): string {
    if (!ship) {
      return "—";
    }
    const type = resolvedName($names.resolved, "type", ship.typeID, "");
    if (type.length > 0) {
      return type;
    }
    return ship.name && ship.name.length > 0 ? ship.name : "your ship";
  }

  // --- R23 slice A: targeting + module activation --------------------------
  //
  // GENERIC BY CONSTRUCTION. A target is a target and a module is a module; the
  // only thing that differs between mining and combat is WHICH module the
  // player switches on, which is their choice, not this panel's.

  const lockedIDs = $derived($targeting.lockedTargetIDs);
  const acquiringIDs = $derived($targeting.acquiringTargetIDs);

  function isLocked(itemID: number): boolean {
    return lockedIDs.includes(itemID);
  }
  function isAcquiring(itemID: number): boolean {
    return acquiringIDs.includes(itemID);
  }

  /**
   * The locked list, each entry named from the CURRENT snapshot. A target the
   * snapshot no longer carries has no name to show — so it says so plainly
   * rather than falling back to its itemID (R7d).
   */
  interface LockedRow {
    readonly itemID: number;
    readonly label: string;
    /** R27 — for the row's icon only; never rendered as a number. */
    readonly typeID: number | null;
    readonly typeLabel: string;
    readonly distance: string;
    readonly acquiring: boolean;
    /**
     * R29 — how battered the thing you locked is, as whole percentages. The
     * server has been sending these on every snapshot row since R11 and the
     * page has never drawn them.
     *
     * PERCENTAGES ONLY, and deliberately so: the wire carries a RATIO for other
     * ships, and the capacities needed to turn that into "412 of 500" exist for
     * your own ship alone. There is no honest way to show a rat's hit points or
     * a time-to-kill, so neither is shown.
     */
    readonly shield: number | null;
    readonly armor: number | null;
    readonly hull: number | null;
  }
  const lockedRows = $derived.by<LockedRow[]>(() => {
    const byID = new Map<number, SpaceEntity>();
    for (const entity of snapshot?.entities ?? []) {
      byID.set(entity.itemID, entity);
    }
    const rowDistance = new Map<number, number>();
    for (const row of overview.rows) {
      rowDistance.set(row.itemID, row.distance);
    }
    const ids = [...lockedIDs, ...acquiringIDs.filter((id) => !lockedIDs.includes(id))];
    return ids.map((itemID) => {
      const entity = byID.get(itemID) ?? null;
      const distance = rowDistance.get(itemID);
      return {
        itemID,
        label: entity ? displayLabel(entity) : "No longer in view",
        typeID: entity ? entity.typeID : null,
        typeLabel: entity ? typeName(entity) : "—",
        distance: distance === undefined ? "—" : formatDistance(distance),
        acquiring: !lockedIDs.includes(itemID),
        shield: ratioPercent(entity?.shieldRatio),
        armor: ratioPercent(entity?.armorRatio),
        hull: ratioPercent(entity?.hullRatio),
      };
    });
  });

  /**
   * R29 — the shots, newest FIRST for reading (the store keeps them in arrival
   * order). Everything here is named: the other party through the snapshot's
   * own rows, the weapon through the name cache. No id is ever rendered.
   *
   * Damage is shown to one decimal because the server sends fractions and
   * rounding 0.4 to "0" would make a landed hit look like a miss. A genuine
   * zero is labelled as a miss in words rather than shown as a bare number.
   */
  interface DamageRow {
    readonly id: number;
    readonly summary: string;
    readonly weaponLabel: string;
    readonly amountLabel: string;
  }
  const damageRows = $derived.by<DamageRow[]>(() => {
    const byID = new Map<number, SpaceEntity>();
    for (const entity of snapshot?.entities ?? []) {
      byID.set(entity.itemID, entity);
    }
    return [...$targeting.damageLog].reverse().map((shot) => {
      const other = shot.otherPartyID === null ? null : (byID.get(shot.otherPartyID) ?? null);
      const otherLabel = other ? displayLabel(other) : "something no longer in view";
      const missed = shot.amount <= 0;
      return {
        id: shot.id,
        summary: shot.direction === "dealt"
          ? missed
            ? `You shot at ${otherLabel} and missed`
            : `You hit ${otherLabel}`
          : missed
            ? `${otherLabel} shot at you and missed`
            : `${otherLabel} hit you`,
        weaponLabel:
          shot.weaponTypeID === null
            ? "—"
            : resolvedName($names.resolved, "type", shot.weaponTypeID, "—"),
        amountLabel: missed ? "—" : shot.amount.toFixed(1),
      };
    });
  });

  /**
   * The modules the player can switch on: everything ONLINE in the ship's
   * slots. Rigs and subsystems are never activated, so they are left out.
   * Whether a module is RUNNING comes from the snapshot's activeModuleIDs —
   * the server's own state — never from what this page remembers clicking.
   */
  interface ModuleRow {
    readonly itemID: number;
    readonly label: string;
    readonly slotLabel: string;
    readonly running: boolean | null;
    // R24 slice C — how long one cycle takes, and whether that figure is the
    // pilot's real one or the type's starting point. null = we have neither.
    readonly cycle: ModuleCycle | null;
  }
  const activeModuleIDs = $derived(snapshot?.ship?.activeModuleIDs ?? null);
  const moduleRows = $derived.by<ModuleRow[]>(() => {
    const rows: ModuleRow[] = [];
    for (const slot of $fitting.slots) {
      if (slot.family === "rig" || slot.family === "subsystem" || !slot.module) {
        continue;
      }
      if (!slot.module.online) {
        continue;
      }
      rows.push({
        itemID: slot.module.itemID,
        label: resolvedName($names.resolved, "type", slot.module.typeID, "Unknown module"),
        slotLabel:
          slot.family === "high" ? "High slot" : slot.family === "mid" ? "Mid slot" : "Low slot",
        // null = the server could not tell us. Rendered as "unknown", never
        // as "off" — a wrong "off" would invite a double activation.
        running: activeModuleIDs === null ? null : activeModuleIDs.includes(slot.module.itemID),
        cycle: $targeting.moduleCycles[slot.module.itemID] ?? null,
      });
    }
    return rows;
  });

  // --- R24 slice C: cycle times --------------------------------------------
  //
  // Two things are shown and they are NOT the same claim:
  //   * how long one cycle takes — from the server's own cycle event where one
  //     has arrived (that duration already has the pilot's skills and bonuses
  //     in it), otherwise from the module type's base duration;
  //   * how far through the current cycle the module is — only ever animated
  //     from a cycle event, because that is the only thing that tells us when
  //     a cycle actually began.
  // A module we have no figure for says so. It never gets a made-up one.

  /** A cycle length as a player reads it. */
  function cycleLengthLabel(cycle: ModuleCycle | null): string {
    if (!cycle || !(cycle.durationMs > 0)) {
      return "";
    }
    const seconds = cycle.durationMs / 1000;
    return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
  }

  // A ticking clock, so a running cycle's bar actually moves. Only while
  // something is running — an idle panel does not need a 10 Hz timer.
  let clockMs = $state(Date.now());
  $effect(() => {
    const anyRunning = moduleRows.some((row) => row.cycle?.startedAtMs !== null && row.cycle);
    if (!anyRunning) {
      return;
    }
    const timer = setInterval(() => {
      clockMs = Date.now();
    }, 200);
    return () => clearInterval(timer);
  });

  /**
   * How far through the current cycle, 0-100 — or null when we cannot honestly
   * say. `null` covers both "no cycle event has ever told us when this started"
   * and "the module is not running", and the panel shows neither as 0%: an
   * empty bar reads as "just started", which would be a claim we cannot make.
   */
  function cycleProgressPercent(cycle: ModuleCycle | null): number | null {
    if (!cycle || cycle.startedAtMs === null || !(cycle.durationMs > 0)) {
      return null;
    }
    const elapsed = clockMs - cycle.startedAtMs;
    if (elapsed < 0) {
      return null;
    }
    // A repeating module runs cycle after cycle off the one start event, which
    // is exactly what the retail client does with it.
    const within = cycle.repeating ? elapsed % cycle.durationMs : Math.min(elapsed, cycle.durationMs);
    return Math.max(0, Math.min(100, Math.round((within / cycle.durationMs) * 100)));
  }

  // --- R24 slice D: the live hold on the in-space screen --------------------
  //
  // A ship HAS a hold iff its capacity attribute is populated — the BFF turns
  // each specialty hold into a named reading and says `present`, so nothing
  // here knows or cares which flag is behind "Ore hold" (R7d/R9a). A hull with
  // no specialty hold simply shows its cargo.
  const shipHolds = $derived(
    $mining.holds.filter((hold) => hold.present || (hold.items?.length ?? 0) > 0),
  );

  /** How full a hold is, or an honest "not known" when the ship did not say. */
  function holdFillText(hold: { readonly capacity: { capacity: number | null; used: number | null } | null }): string {
    const reading = hold.capacity;
    if (!reading || reading.capacity === null || reading.used === null) {
      return "not known";
    }
    // Whole cubic metres: the fractional part of an ore hold is noise a player
    // watching a laser run does not need.
    return `${Math.round(reading.used).toLocaleString()} / ${Math.round(reading.capacity).toLocaleString()} m³`;
  }

  // --- R23 slice B: rocks in the overview ----------------------------------

  /**
   * How much ore a rock has left, as ONE number from two sources that agree by
   * construction: the snapshot's own reading, and the survey scanner's (which
   * reaches rocks the snapshot may not have a mining record for). The scan wins
   * when both exist, because the player asked for it and it is the fresher read.
   *
   * null is "not known" and renders as a dash. A rock with a real 0 is a
   * mined-out rock and says so — the two must never be shown the same way.
   */
  const surveyByID = $derived.by<Map<number, number | null>>(() => {
    const map = new Map<number, number | null>();
    for (const result of $mining.survey) {
      map.set(result.itemID, result.remainingQuantity);
    }
    return map;
  });
  function remainingOre(row: SpaceEntity): number | null {
    const scanned = surveyByID.get(row.itemID);
    if (scanned !== undefined) {
      return scanned;
    }
    return row.remainingQuantity;
  }
  function remainingLabel(row: SpaceEntity): string {
    if (row.kind !== "asteroid") {
      return "";
    }
    const remaining = remainingOre(row);
    if (remaining === null) {
      // Never a fabricated number, and never a 0 standing in for "unknown".
      return "—";
    }
    return remaining === 0 ? "Mined out" : `${remaining.toLocaleString()} units`;
  }
  const rockCount = $derived(
    (snapshot?.entities ?? []).filter((entity) => entity.kind === "asteroid").length,
  );

  // R24 slice B — "a row you can DOCK at" moved to `space/rowActions.ts` as
  // `isDockableKind`, which is where the whole verb set now lives. It is still
  // the server's own runtime kind for the ball that decides it — never the
  // name, the distance or the category number.

  // Which locked target a module is switched on AGAINST.
  //
  // Locking something MAKES it the thing your equipment acts on — that is what
  // a player expects, and it is what retail does. So the default ("") is AUTO:
  // whatever is locked. Defaulting to "no target" instead meant a player could
  // lock a rock, hit Switch on, and be refused "You need an active target"
  // while staring at the rock they had just locked.
  //
  // "none" is the explicit opt-out, for equipment that acts on the ship itself.
  // An id that is no longer locked falls back to auto rather than sending a
  // stale target the server would refuse.
  const AUTO_TARGET = "";
  const NO_TARGET = "none";
  let actionTargetID = $state(AUTO_TARGET);
  /** Locked (not still-acquiring) targets, in the order they were locked. */
  const selectableTargets = $derived(lockedRows.filter((entry) => !entry.acquiring));
  const effectiveTargetID = $derived.by(() => {
    if (actionTargetID === NO_TARGET) {
      return 0;
    }
    if (actionTargetID !== AUTO_TARGET) {
      const chosen = Number(actionTargetID);
      if (chosen > 0 && isLocked(chosen)) {
        return chosen;
      }
    }
    // Auto (or a stale pick): use what is locked.
    return selectableTargets.length > 0 ? selectableTargets[0].itemID : 0;
  });

  // Module names come from the same cache as everything else (R7d). The weapons
  // in the damage log go through the same cache: a shot arrives carrying only
  // the weapon's typeID, and an id must never reach the screen.
  $effect(() => {
    const refs: NameRef[] = [];
    for (const slot of $fitting.slots) {
      if (slot.module) {
        refs.push({ kind: "type", id: slot.module.typeID });
      }
    }
    for (const shot of $targeting.damageLog) {
      if (shot.weaponTypeID !== null) {
        refs.push({ kind: "type", id: shot.weaponTypeID });
      }
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // --- R25 slice A: drones -------------------------------------------------
  //
  // ⚠ LAUNCHING IS THE DEFENCE. An idle combat drone auto-engages whatever
  // shoots the ship it came from — the server's own behaviour, on by default —
  // so a miner who launches is defended without another click. Engage below is
  // for CHOOSING a victim, and the panel says so in as many words rather than
  // leaving a player to think they have to babysit it.

  const droneBay = $derived($drones.bay);
  const dronesInSpace = $derived($drones.inSpace);
  const droneLimits = $derived($drones.limits);

  /** The bay's stacks, by NAME. The bay's flagID never reaches this file. */
  const bayRows = $derived.by(() =>
    (droneBay ?? []).map((stack) => ({
      itemID: stack.itemID,
      label: resolvedName($names.resolved, "type", stack.typeID, "Unknown drone"),
      quantity: stack.quantity,
    })),
  );

  /** Drones in space, the ones with a job first so a busy flight reads at a glance. */
  const spaceRows = $derived.by(() => {
    const byID = new Map<number, SpaceEntity>();
    for (const entity of snapshot?.entities ?? []) {
      byID.set(entity.itemID, entity);
    }
    return (dronesInSpace ?? [])
      .map((drone) => {
        const target = drone.targetID === null ? null : byID.get(drone.targetID) ?? null;
        return {
          itemID: drone.itemID,
          label:
            drone.name && drone.name.length > 0
              ? drone.name
              : resolvedName($names.resolved, "type", drone.typeID, "Drone"),
          activity: droneActivityLabel(drone.activity),
          busy: droneIsBusy(drone.activity),
          // The ball it is busy with, by NAME. A target the snapshot no longer
          // carries simply has no name to show, so it shows none (R7d).
          targetLabel: target === null ? "" : displayLabel(target),
        };
      })
      .sort((left, right) => Number(right.busy) - Number(left.busy));
  });

  /** Every drone in space, for the "all of them" buttons. */
  const allDroneIDs = $derived(spaceRows.map((row) => row.itemID));

  const droneLimitText = $derived.by(() => {
    const parts: string[] = [];
    // null is "not known", never 0 — a hull with no drone bay and a read that
    // failed look identical from here, and neither may be shown as a hard zero.
    parts.push(
      droneLimits.maxActiveDrones === null
        ? "Drones at once: not known"
        : `Drones at once: ${spaceRows.length} of ${droneLimits.maxActiveDrones}`,
    );
    parts.push(
      droneLimits.droneBandwidth === null
        ? "Bandwidth: not known"
        : `Bandwidth: ${droneLimits.droneBandwidth} Mbit/sec`,
    );
    return parts.join(" · ");
  });

  // Which bay stacks the player has picked to launch.
  let launchPicks = $state<Record<number, boolean>>({});
  const pickedForLaunch = $derived(
    bayRows.filter((row) => launchPicks[row.itemID] === true).map((row) => row.itemID),
  );
  function toggleLaunchPick(itemID: number): void {
    launchPicks = { ...launchPicks, [itemID]: launchPicks[itemID] !== true };
  }

  // Drone names come from the same cache as everything else (R7d).
  $effect(() => {
    const refs: NameRef[] = [];
    for (const stack of droneBay ?? []) {
      refs.push({ kind: "type", id: stack.typeID });
    }
    for (const drone of dronesInSpace ?? []) {
      if (drone.typeID !== null) {
        refs.push({ kind: "type", id: drone.typeID });
      }
    }
    if (refs.length > 0) {
      flow.requestNames(refs);
    }
  });

  // --- R25 slice B: hostile awareness --------------------------------------
  //
  // ⚠ THE FINDING THAT SHAPES ALL OF THIS: a belt rat is `kind: "ship"`, built
  // through the same server path as the player parked next to you. Nothing in
  // the snapshot separated them before R25, which is why `isNpc` /
  // `npcEntityType` exist and why every threat decision on this page reads them
  // and nothing else.
  //
  // Threats are deliberately NOT just rows in the overview. The overview is
  // searchable, filterable and capped at 200 — a player who filtered to
  // "Veldspar" while mining would have filtered away the thing shooting them.
  // The threat list below reads the WHOLE snapshot, ignores every filter, and
  // is never capped.

  const threats = $derived(hostileRows(snapshot, origin));

  /** Warn ONLY about arrivals. A rat that was already here when you landed is
   * not news; the one that just warped in is. The seen-set is primed from the
   * FIRST snapshot for exactly that reason — otherwise landing in an occupied
   * belt would announce every rat in it as an arrival. */
  let seenHostileIDs = $state<ReadonlySet<number>>(new Set<number>());
  let primedHostiles = $state(false);
  let arrivalNotice = $state("");
  $effect(() => {
    if (!inSpace) {
      // A dock (or a system change) resets the whole idea of "who was here".
      seenHostileIDs = new Set<number>();
      primedHostiles = false;
      arrivalNotice = "";
      return;
    }
    if (!$space.loaded) {
      return;
    }
    const current = threats;
    if (!primedHostiles) {
      seenHostileIDs = new Set(current.map((row) => row.itemID));
      primedHostiles = true;
      return;
    }
    const arrived = newlyArrivedHostiles(current, seenHostileIDs);
    if (arrived.length > 0) {
      const label = hostileLabel(arrived[0]) ?? "hostile";
      arrivalNotice =
        arrived.length === 1
          ? `A ${label.toLowerCase()} has arrived — ${displayLabel(arrived[0])}, ${formatDistance(arrived[0].distance)} away.`
          : `${arrived.length} hostiles have arrived. The nearest is ${displayLabel(arrived[0])}, ${formatDistance(arrived[0].distance)} away.`;
    }
    // Forget the ones that are gone, so a rat that leaves and comes back warns
    // again rather than sneaking in on a stale id.
    seenHostileIDs = new Set(current.map((row) => row.itemID));
  });

  /**
   * ARE YOU BEING SHOT? The honest version.
   *
   * What two consecutive HUD readings show: a health layer that went down. That
   * is a fact, and it is enough to make a dropping shield legible at a glance.
   *
   * ⚠ R29 found there IS a damage log after all — `OnDamageMessage` is pushed
   * for shots in both directions, and "Shots fired" below renders it. This
   * indicator is deliberately NOT rebuilt on it. The push channel may drop
   * frames, so silence there is not proof nobody is shooting; the ship's own
   * two readings cannot lie about having gone down. The log names the attacker,
   * this proves the damage.
   */
  let previousHealth = $state<{
    shieldRatio: number | null;
    armorRatio: number | null;
    hullRatio: number | null;
  } | null>(null);
  let takingDamageUntilMs = $state(0);
  let damageClock = $state(Date.now());
  $effect(() => {
    const current = ship
      ? { shieldRatio: ship.shieldRatio, armorRatio: ship.armorRatio, hullRatio: ship.hullRatio }
      : null;
    if (healthIsDropping(previousHealth, current)) {
      // Held briefly so a warning does not blink out between two polls that
      // happen to read the same value.
      takingDamageUntilMs = Date.now() + 6000;
    }
    previousHealth = current;
  });
  $effect(() => {
    if (takingDamageUntilMs <= 0) {
      return;
    }
    const timer = setInterval(() => {
      damageClock = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });
  const takingDamage = $derived(takingDamageUntilMs > damageClock);

  /** Overview rows get a hostile marker so the list itself is readable too. */
  function rowIsHostile(row: OverviewRow): boolean {
    return isHostile(row);
  }
  function rowBadge(row: OverviewRow): string {
    return hostileLabel(row) ?? "";
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    busy = true;
    error = "";
    try {
      await action();
    } catch (cause) {
      if (isSessionLost(cause)) {
        error = "The live session ended (idle timeout or another client took over).";
      } else {
        error =
          cause instanceof BridgeCallError ? `${cause.code}: ${cause.message}` : String(cause);
      }
    } finally {
      busy = false;
    }
  }

  // R30 slice B — this panel CLAIMS the space feed; it no longer owns it.
  // Other panels that show live space data claim it too, so leaving this tab
  // hands the feed over rather than switching it off. The feed still stops on
  // its own when the ship docks or the browser tab is hidden.
  onMount(() => {
    void run(() => flow.loadSpaceSnapshot());
    // R23: the ship's slots (so modules can be offered BY NAME) and the current
    // locks. Both are best-effort — neither may blank the overview if it fails.
    void flow.loadFitting().catch(() => {});
    void flow.loadTargets().catch(() => {});
    // R24 slice D — the ship's holds, so the in-space screen shows what is
    // actually accumulating. One read at open; after that the LIVE push channel
    // drives it (every OnItemsChanged the ore grant emits triggers a re-read),
    // so there is no second poll competing with the snapshot cadence.
    void flow.loadMiningHolds().catch(() => {});
    // R25 — the drone bay and what is already in space. Best-effort like the
    // reads above: a hull with no drone bay must not blank the overview.
    void flow.loadDrones().catch(() => {});
    flow.startSpacePolling();
    return () => flow.stopSpacePolling();
  });
</script>

<section class="panel">
  <header class="panel-head">
    <h2>Around your ship</h2>
  </header>
  <p class="note">
    Everything your ship can see, nearest first. Pick something in the list and
    the bar above it shows everything you can do to it.
  </p>
  {#if error}
    <p class="error">{error}</p>
  {:else if $space.error}
    <p class="error">{$space.error}</p>
  {/if}
</section>

<!--
  R30 slice C — the flight strip. Where you are, what is happening, what went
  wrong, and the one control that matters right now.

  This replaced a line that told a docked player to go to another tab to do the
  single thing they needed. Undock is here now, so that sentence is gone —
  deleted, not reworded, and a test asserts it cannot come back.
-->
<section class="flight-strip">
  <p class="strip-where">{whereText}</p>
  <!--
    Only rendered when a bot or the autopilot is actually running, and it is
    THEIR words. Hand-flying shows nothing here on purpose — see doingText.
  -->
  {#if doingText}
    <p class="strip-doing">{doingText}</p>
  {/if}
  {#if wrongText}
    <p class="strip-wrong error">{wrongText}</p>
  {/if}
  <p class="controls">
    {#if docked}
      <button
        type="button"
        class="primary"
        disabled={concernBusy("move")}
        onclick={() => runFor("move", () => flow.undock())}
      >
        Undock
      </button>
      <!--
        R30 slice D — the refusal, at the control that caused it. Docked, the
        selection bar is not on screen at all, so this is the only place a move
        failure can be read; in space it is the bar's job and this is not drawn.
      -->
      {#if concernErrors.move}
        <span class="error">{concernErrors.move}</span>
      {/if}
    {:else}
      <!--
        ⚠ STOP HAS NO `disabled` AND MUST NEVER GET ONE. DO NOT CLEAN THIS UP.
        It is the control a player reaches for when something is going wrong,
        which is exactly when other requests are in flight — so any busy state,
        even its own, would grey it out at the only moment it matters. Issuing
        it twice is harmless: it cuts the engines and switches the autopilot
        off, and doing that again is the same instruction, not a conflicting one.
      -->
      <button type="button" class="primary" onclick={() => runUnguarded(() => flow.stopShip())}>
        Stop the ship
      </button>
    {/if}
  </p>
</section>

{#if !inSpace}
  <section>
    <p class="note">Undock to see what is around your ship.</p>
  </section>
{:else}
  <section>
    <h2>Ship condition</h2>
    {#if !ship}
      <p class="note">Reading your ship's condition…</p>
    {:else}
      <p class="note">{shipLabel()}</p>
      <div class="hud">
        {#each gauges as gauge (gauge.key)}
          <div class="hud-gauge {gauge.key}">
            <div class="hud-head">
              <span class="hud-label">{gauge.label}</span>
              <span class="hud-value">{gauge.percent === null ? "—" : `${gauge.percent}%`}</span>
            </div>
            <div
              class="hud-track"
              role="meter"
              aria-label={gauge.label}
              aria-valuenow={gauge.percent ?? 0}
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="hud-fill" style={`width: ${gauge.percent ?? 0}%`}></span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
    <!--
      R24 slice D — the LIVE hold, on the in-space screen rather than a tab away.
      Only holds this hull actually HAS appear: whether a ship has an ore hold,
      a gas hold, an ice hold or an asteroid hold is decided by whether the
      capacity attribute is populated, so a Venture and a Mammoth differ by DATA
      and nothing here special-cases either of them. What is not known reads as
      not known — an unknown fill is not an empty one.

      It stays fresh off the PUSH channel, not a poll: mining grants ore and
      emits OnItemsChanged, that frame reaches the browser, and the browser
      re-reads the hold from the ship. The notification is the trigger; the ship
      is the authority.
    -->
    {#if shipHolds.length > 0}
      <ul class="hold-strip">
        {#each shipHolds as hold (hold.key)}
          <li>
            <span class="hold-name">{hold.label}</span>
            <span class="hold-fill">{holdFillText(hold)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!--
    R25 slice B — the threat block. Deliberately ABOVE everything a player is
    likely to be reading while mining, and deliberately NOT a row in the
    overview: the overview is searchable, filterable and capped at 200 rows, so
    a miner who filtered to "Veldspar" would have filtered away the thing
    shooting them. This list reads the whole snapshot every poll.
  -->
  {#if takingDamage || threats.length > 0}
    <section class="threat" class:under-attack={takingDamage}>
      <h2>{takingDamage ? "You are taking damage" : "Hostiles nearby"}</h2>
      {#if takingDamage}
        <!--
          The honest version of "you are under attack": this says only what two
          consecutive readings of your own ship showed — a health layer went
          down. See the Ship condition bars above for which one, and "Shots
          fired" below for who has been shooting. This banner is NOT driven by
          that log: the live channel can drop frames, and a dropping shield is
          the fact that cannot be missed.
        -->
        <p class="note">
          Your ship's shield, armour or hull dropped in the last few seconds.
        </p>
      {/if}
      {#if arrivalNotice}
        <p class="arrival">{arrivalNotice}</p>
      {/if}
      {#if threats.length === 0}
        <p class="note">Nothing hostile is in range right now.</p>
      {:else}
        <ul class="threat-list">
          {#each threats as threat (threat.itemID)}
            <li>
              <span class="threat-badge">{rowBadge(threat)}</span>
              <span class="threat-name">{displayLabel(threat)}</span>
              <span class="threat-distance">{formatDistance(threat.distance)}</span>
              <span class="row-actions">
                {#if isLocked(threat.itemID)}
                  <button
                    type="button"
                    class="active"
                    disabled={busy}
                    onclick={() => run(() => flow.unlockTarget(threat.itemID))}
                  >
                    Release lock
                  </button>
                {:else if isAcquiring(threat.itemID)}
                  <button type="button" disabled>Locking…</button>
                {:else}
                  <button
                    type="button"
                    disabled={busy}
                    onclick={() => run(() => flow.lockTarget(threat.itemID))}
                  >
                    Lock
                  </button>
                {/if}
                {#if allDroneIDs.length > 0}
                  <button
                    type="button"
                    disabled={busy}
                    onclick={() => run(() => flow.engageDrones(allDroneIDs, threat.itemID))}
                  >
                    Send drones
                  </button>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

  <!--
    R25 slice A — drones. Two lists, because they are two different things: what
    is sitting in the bay (launchable) and what is already flying (orderable).

    ⚠ LAUNCHING IS THE DEFENCE. The server auto-engages idle combat drones
    against whatever shoots your ship, so a miner who launches is defended
    without touching Engage at all. The note below says that plainly, because a
    player who does not know it will sit there clicking.

    The two limits are SHOWN and never enforced here: the server owns both, and
    a browser that pre-guessed them would either block a legal launch or promise
    an illegal one.
  -->
  <section>
    <h2>Drones</h2>
    <p class="note">
      Drones you launch defend you on their own — they will attack anything that
      shoots your ship, without you doing anything else. Use Attack to pick a
      target yourself, or Bring home to call them back.
    </p>
    <p class="note">{droneLimitText}</p>
    {#if $drones.error}
      <p class="error">{$drones.error}</p>
    {/if}
    {#if $drones.actionError}
      <p class="error">{$drones.actionError}</p>
    {/if}
    {#if $drones.silentDecline}
      <p class="error">{$drones.silentDecline}</p>
    {/if}

    <h3>In space</h3>
    {#if dronesInSpace === null}
      <!-- null is "we could not look", which must never read as "none out". -->
      <p class="note">
        {$drones.loaded ? "Your drones in space could not be read." : "Looking…"}
      </p>
    {:else if spaceRows.length === 0}
      <p class="empty">No drones out.</p>
    {:else}
      <ul class="drone-list">
        {#each spaceRows as drone (drone.itemID)}
          <li>
            <span class="drone-name">{drone.label}</span>
            <span class="drone-activity">
              {drone.activity}{drone.targetLabel ? ` — ${drone.targetLabel}` : ""}
            </span>
            <span class="row-actions">
              <button
                type="button"
                disabled={busy}
                onclick={() => run(() => flow.recallDrones([drone.itemID]))}
              >
                Bring home
              </button>
            </span>
          </li>
        {/each}
      </ul>
      <p class="controls">
        <!--
          Acting on the LOCKED target, reusing R23's auto-target default:
          locking something makes it what your equipment acts on, and drones are
          no different. (The server does not actually require a lock for
          CmdEngage — this is a UI choice, so a player only ever sends drones at
          something they deliberately picked.)
        -->
        <button
          type="button"
          disabled={busy || effectiveTargetID <= 0}
          onclick={() => run(() => flow.engageDrones(allDroneIDs, effectiveTargetID))}
        >
          Attack what I have locked
        </button>
        <button
          type="button"
          disabled={busy || effectiveTargetID <= 0}
          onclick={() => run(() => flow.mineWithDrones(allDroneIDs, effectiveTargetID))}
        >
          Mine what I have locked
        </button>
        <button
          type="button"
          disabled={busy}
          onclick={() => run(() => flow.recallDrones(allDroneIDs))}
        >
          Bring them all home
        </button>
      </p>
      {#if effectiveTargetID <= 0}
        <p class="note">Lock something first to give your drones a target.</p>
      {/if}
    {/if}

    <h3>In the bay</h3>
    {#if droneBay === null}
      <p class="note">
        {$drones.loaded ? "Your drone bay could not be read." : "Looking…"}
      </p>
    {:else if bayRows.length === 0}
      <p class="empty">Nothing in the drone bay.</p>
    {:else}
      <ul class="drone-list">
        {#each bayRows as stack (stack.itemID)}
          <li>
            <label class="drone-pick">
              <input
                type="checkbox"
                checked={launchPicks[stack.itemID] === true}
                onchange={() => toggleLaunchPick(stack.itemID)}
              />
              <span class="drone-name">{stack.label}</span>
            </label>
            <span class="drone-activity">In the bay</span>
            <span class="row-actions">
              <button
                type="button"
                disabled={busy}
                onclick={() => run(() => flow.launchDrones([stack.itemID]))}
              >
                Launch
              </button>
            </span>
          </li>
        {/each}
      </ul>
      <p class="controls">
        <button
          type="button"
          disabled={busy || pickedForLaunch.length === 0}
          onclick={() => run(() => flow.launchDrones(pickedForLaunch))}
        >
          Launch the ones I picked
        </button>
      </p>
    {/if}
  </section>

  <section>
    <h2>Flying</h2>
    <p class="note">
      Pick the distances you want first, then use the buttons on any row below.
      Stop cuts the engines — and switches the autopilot off, so nothing starts
      flying you somewhere again.
    </p>
    <p class="controls">
      <label>
        Warp to within
        <select bind:value={warpRange}>
          {#each WARP_RANGES as choice (choice.metres)}
            <option value={String(choice.metres)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Orbit at
        <select bind:value={orbitRange}>
          {#each HOLD_RANGES as choice (choice.metres)}
            <option value={String(choice.metres)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Hold at
        <select bind:value={holdRange}>
          {#each HOLD_RANGES as choice (choice.metres)}
            <option value={String(choice.metres)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <button type="button" disabled={busy} onclick={() => run(() => flow.stopShip())}>
        Stop the ship
      </button>
    </p>
  </section>

  <!--
    R23 slice A — the generic in-space action layer. Two sections, neither of
    which knows anything about mining: what you have locked, and what you can
    switch on. A later combat goal renders exactly these two sections.
  -->
  <section>
    <h2>Locked targets</h2>
    <p class="note">
      What your ship has a lock on. You need a lock before you can use most
      equipment on something. Locking takes a moment — your ship has to get a
      fix on it first.
    </p>
    <p class="note">
      Condition is shown as percentages because that is all the server sends for
      anything other than your own ship — there is no way to show a target's
      hit points, or how long it will take to break. A full shield bar on
      something you have not shot yet may just mean it has no shield to speak
      of: it will drop to nothing the moment you land a hit.
    </p>
    {#if lockedRows.length === 0}
      <p class="empty">Nothing is locked. Use Lock on any row below.</p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Target</th>
              <th>Type</th>
              <th class="num">Distance</th>
              <th>State</th>
              <th>Condition</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each lockedRows as locked (locked.itemID)}
              <tr>
                <td data-label="Target">{locked.label}</td>
                <td data-label="Type">
                  <span class="cell-item">
                    <TypeIcon typeID={locked.typeID} name={locked.typeLabel} />
                    {locked.typeLabel}
                  </span>
                </td>
                <td class="num" data-label="Distance">{locked.distance}</td>
                <td data-label="State">{locked.acquiring ? "Locking…" : "Locked"}</td>
                <td data-label="Condition">
                  {#if locked.shield === null && locked.armor === null && locked.hull === null}
                    <span class="stat-unavailable">Not known</span>
                  {:else}
                    <span class="target-condition">
                      {#each [{ key: "shield", label: "Shield", percent: locked.shield }, { key: "armor", label: "Armour", percent: locked.armor }, { key: "hull", label: "Hull", percent: locked.hull }] as layer (layer.key)}
                        <span class="hud-gauge {layer.key}">
                          <span class="hud-head">
                            <span class="hud-label">{layer.label}</span>
                            <span class="hud-value"
                              >{layer.percent === null ? "—" : `${layer.percent}%`}</span
                            >
                          </span>
                          <span
                            class="hud-track"
                            role="meter"
                            aria-label={`${layer.label} on ${locked.label}`}
                            aria-valuenow={layer.percent ?? 0}
                            aria-valuemin="0"
                            aria-valuemax="100"
                          >
                            <span class="hud-fill" style={`width: ${layer.percent ?? 0}%`}></span>
                          </span>
                        </span>
                      {/each}
                    </span>
                  {/if}
                </td>
                <td data-label="">
                  <span class="row-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onclick={() => run(() => flow.unlockTarget(locked.itemID))}
                    >
                      Release lock
                    </button>
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <section>
    <h2>Your equipment</h2>
    <p class="note">
      Everything switched on and ready to run. Pick a locked target first if the
      equipment needs one — your ship will say so if it does.
    </p>
    {#if moduleRows.length === 0}
      <p class="empty">
        Nothing is powered up. Turn equipment on in the Fitting tab first.
      </p>
    {:else}
      <p class="controls">
        <label>
          Use it on
          <select bind:value={actionTargetID}>
            {#if selectableTargets.length > 0}
              <option value={AUTO_TARGET}>
                What I have locked ({selectableTargets[0].label})
              </option>
              {#each selectableTargets as locked (locked.itemID)}
                <option value={String(locked.itemID)}>{locked.label}</option>
              {/each}
            {:else}
              <option value={AUTO_TARGET}>Nothing locked yet</option>
            {/if}
            <option value={NO_TARGET}>Nothing — just switch it on</option>
          </select>
        </label>
      </p>
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>Equipment</th>
              <th>Fitted in</th>
              <th>Running</th>
              <!--
                R24 slice C — one cycle's length. Where the ship has reported a
                cycle it is the pilot's real figure, skills and bonuses already
                counted; otherwise it is the equipment's own starting figure and
                the row SAYS so rather than quietly passing it off as the
                other one.
              -->
              <th>Cycle</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each moduleRows as module (module.itemID)}
              <tr>
                <td data-label="Equipment">{module.label}</td>
                <td data-label="Fitted in">{module.slotLabel}</td>
                <td data-label="Running">
                  {#if module.running === null}
                    <span class="stat-unavailable">Not known</span>
                  {:else}
                    {module.running ? "Running" : "Idle"}
                  {/if}
                </td>
                <td data-label="Cycle">
                  {#if !module.cycle}
                    <span class="stat-unavailable">Not known</span>
                  {:else}
                    <span>{cycleLengthLabel(module.cycle)}</span>
                    {#if module.cycle.source === "base"}
                      <!--
                        R9a in one word: "before skills". The player is told
                        plainly that this is the equipment's own figure and not
                        theirs, rather than being handed a number that will not
                        match what their ship does.
                      -->
                      <span class="note"> before skills</span>
                    {/if}
                    {#if cycleProgressPercent(module.cycle) !== null}
                      <progress
                        max="100"
                        value={cycleProgressPercent(module.cycle)}
                        aria-label="Cycle progress"
                      ></progress>
                    {/if}
                  {/if}
                </td>
                <td data-label="">
                  <span class="row-actions">
                    <button
                      type="button"
                      class={module.running === true ? "active" : ""}
                      disabled={busy || module.running === true}
                      onclick={() =>
                        run(() =>
                          flow.activateModule(module.itemID, {
                            targetID: effectiveTargetID > 0 ? effectiveTargetID : null,
                          }),
                        )}
                    >
                      Switch on
                    </button>
                    <button
                      type="button"
                      disabled={busy || module.running === false}
                      onclick={() => run(() => flow.deactivateModule(module.itemID))}
                    >
                      Switch off
                    </button>
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    <!--
      Two different failures, said differently on purpose. A refusal carries the
      server's OWN words. A silent decline is when the call came back fine, the
      re-read showed nothing changed, and the server gave no reason — the page
      says exactly that rather than inventing a cause.
    -->
    {#if $targeting.actionError}
      <p class="error">{$targeting.actionError}</p>
    {/if}
    {#if $targeting.silentDecline}
      <p class="error">{$targeting.silentDecline}</p>
    {/if}
  </section>

  <section>
    <h2>Shots fired</h2>
    <p class="note">
      Every hit the server told us about, newest first — both the ones you land
      and the ones you take. This is a running commentary, not a tally: the live
      channel is allowed to drop and pick up again, so shots can be missing from
      this list. The condition bars above are read from your ship and your
      target, and those are the numbers to trust.
    </p>
    {#if damageRows.length === 0}
      <p class="empty">
        Nothing has been shot at, or by, your ship since this page came online.
      </p>
    {:else}
      <div class="table-wrap overflow-x-auto">
        <table class="guests reflow">
          <thead>
            <tr>
              <th>What happened</th>
              <th>Weapon</th>
              <th class="num">Damage</th>
            </tr>
          </thead>
          <tbody>
            {#each damageRows as shot (shot.id)}
              <tr>
                <td data-label="What happened">{shot.summary}</td>
                <td data-label="Weapon">{shot.weaponLabel}</td>
                <td class="num" data-label="Damage">{shot.amountLabel}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!--
    R30 slice D — THE SELECTION BAR.

    One bar, acting on one thing, replacing up to nine buttons on every one of
    up to 200 rows. What it offers is not decided here: `space/rowActions.ts`
    returns the verb list as data, and this renders it. That split is the whole
    point — a decision spelled out as {#if} blocks in markup can only be checked
    by a regex over markup, which proves nothing about the decision.

    It is `position: sticky` at desktop width so it stays reachable while you
    scroll a long grid. Sticky, NOT fixed: a sticky element still takes up its
    own space in the flow, so it cannot occlude the last row of the table the
    way a floating bar would — and that occlusion would be invisible at desktop
    width, which is where it would be shipped from. The fixed-bottom phone bar
    is a separate piece of work with its own body padding to compensate.
  -->
  <section class="selection-bar" aria-label="What you have picked">
    {#if selectionNotice}
      <!--
        ⚠ The selection is CLEARED and SAID, never silently moved. A bar that
        fell back to "the first row" would have the player press Warp to
        expecting one destination and get another.
      -->
      <p class="error">{selectionNotice}</p>
    {/if}
    {#if !selectedRow}
      <p class="note">
        Pick anything in the list below to warp to it, fly towards it, orbit it,
        hold a distance from it, line your ship up with it or lock it.
      </p>
    {:else}
      <p class="selection-name">{displayLabel(selectedRow)}</p>
      <p class="selection-what">
        {typeName(selectedRow)} · {formatDistance(selectedRow.distance)}
      </p>
      <span class="row-actions">
        {#each selectionActions as action (action.id + action.label)}
          <!--
            An action that cannot be used right now is still DRAWN, disabled,
            wearing the sentence that says why (as its label and as its
            title/aria-description). Never a silent grey rectangle, and never
            missing entirely — a player cannot tell a forgotten button from a
            deliberate one.
          -->
          <button
            type="button"
            class={action.id === "unlock" ? "active" : ""}
            disabled={concernBusy(action.concern) || action.unavailable !== null}
            title={action.unavailable ?? ""}
            onclick={() => runRowAction(action)}
          >
            {action.unavailable ?? action.label}
          </button>
        {/each}
      </span>
      <!--
        The failure lands HERE, beside the buttons that caused it, and it is
        kept per concern — so a refused lock does not read as a refused warp,
        and neither of them greys out anything else.
      -->
      {#each ["move", "lock", "module", "hold", "route"] as const as concern (concern)}
        {#if concernErrors[concern]}
          <p class="error">{concernErrors[concern]}</p>
        {/if}
      {/each}
    {/if}
  </section>

  <section>
    <h2>Overview</h2>
    <p class="controls">
      <label>
        Search
        <input type="search" bind:value={search} placeholder="name, type or group" />
      </label>
      <label>
        Category
        <select bind:value={categoryFilter}>
          <option value="">All</option>
          {#each filterChoices.categories as choice (choice.id)}
            <option value={String(choice.id)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Group
        <select bind:value={groupFilter}>
          <option value="">All</option>
          {#each filterChoices.groups as choice (choice.id)}
            <option value={String(choice.id)}>{choice.label}</option>
          {/each}
        </select>
      </label>
      <label>
        Sort by
        <select bind:value={sort}>
          <option value="distance">Distance</option>
          <option value="name">Name</option>
        </select>
      </label>
      <!--
        R23 slice B — the survey scanner. The ship can see the rocks around it
        without this, but not always how much ore is left in them; a scan fills
        the "Ore left" column in. Read-only: it mines nothing and moves nothing.
      -->
      <button type="button" disabled={busy} onclick={() => run(() => flow.runSurveyScan())}>
        Scan the rocks
      </button>
    </p>
    {#if $mining.surveyError}
      <p class="error">{$mining.surveyError}</p>
    {:else if $mining.surveyAtMs !== null && $mining.survey.length === 0}
      <p class="note">The scan came back empty — there was nothing minable in range.</p>
    {:else if rockCount > 0 && $mining.surveyAtMs === null}
      <p class="note">
        There are rocks here. Scan them to see how much ore each one still has.
      </p>
    {/if}

    {#if !$space.loaded}
      <p class="note">Looking around…</p>
    {:else if overview.rows.length === 0}
      <p class="empty">Nothing matches — clear the search or filters to see everything.</p>
    {:else}
      <p class="note">
        Showing {overview.rows.length} of {overview.matched} nearby.
        {#if overview.matched > overview.rows.length}
          Search or filter to narrow the list.
        {/if}
      </p>
      <div class="table-wrap overflow-x-auto">
        <table class="guests overview reflow">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Group</th>
              <th class="num">Distance</th>
              <!--
                R23 slice B — only meaningful for a rock, and blank for
                everything else. A dash means the amount is NOT KNOWN; a rock
                that really is empty says "Mined out". Run a survey scan to fill
                in what the ship could not see on its own.
              -->
              <th class="num">Ore left</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each gateRows as row (row.itemID)}
              <!--
                R25 slice B — a hostile row is visually distinct IN the list as
                well as pulled out above it. The badge carries the word, so the
                colour is never the only signal (a player who cannot tell red
                from grey still reads "Pirate").
              -->
              <tr class:hostile={rowIsHostile(row)}>
                <td data-label="Name">
                  {#if rowIsHostile(row)}<span class="threat-badge">{rowBadge(row)}</span>{/if}
                  {displayLabel(row)}
                </td>
                <td data-label="Type">
                  <span class="cell-item">
                    <TypeIcon typeID={row.typeID} name={typeName(row)} />
                    {typeName(row)}
                  </span>
                </td>
                <td data-label="Group">{groupName(row)}</td>
                <td class="num" data-label="Distance">{formatDistance(row.distance)}</td>
                <td class="num" data-label="Ore left">{remainingLabel(row)}</td>
                <!--
                  R30 slice D — the whole per-row `.row-actions` block that used
                  to live here is GONE, and this single control replaces it.

                  There were up to nine buttons on every one of up to 200 rows,
                  re-rendered every poll. The names and distances a player is
                  actually reading were squeezed into whatever the buttons left,
                  and at the phone breakpoint each row became a stack of nine
                  full-width buttons you had to scroll past to reach the next
                  row. Picking a thing and acting on it is how the retail client
                  works, and it is the only version of this that fits.
                -->
                <td data-label="">
                  <span class="row-actions">
                    <button
                      type="button"
                      class={selectedID === row.itemID ? "active" : ""}
                      aria-pressed={selectedID === row.itemID}
                      onclick={() => selectRow(row.itemID)}
                    >
                      {selectedID === row.itemID ? "Selected" : "Select"}
                    </button>
                  </span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if $flight.actionError}
        <p class="error">{$flight.actionError}</p>
      {/if}
      <!--
        R30 slice A — an honest silence. If the star map could not be read we
        say so, because "this gate offers no jump" and "I could not tell where
        this gate goes" are different facts and a player acts differently on
        each. Warp to / Approach still work on the gate row regardless.
      -->
      {#if gateLinksError}
        <p class="note">{gateLinksError}</p>
      {/if}
    {/if}
  </section>
{/if}

<!--
  R26 — the mining bot. Deliberately OUTSIDE the in-space guard above: the bot
  docks itself to unload, and a player must still be able to see what it is
  doing, and stop it, while the ship is in the station.
-->
<MiningBot {store} {flow} />

